#!/usr/bin/env python3
"""Pull every mac-targeted Ollama model from models.yaml in parallel.

models.yaml is the single source of truth — this script reads it on each
invocation, filters the entries `target` includes ``mac`` (or has no
target field, which defaults to both targets), and calls ``ollama pull``
on each one through a bounded asyncio pool.

Dependencies
------------
* `pyyaml`             — always required (for parsing models.yaml).
* `huggingface_hub`    — required when any entry has
                         `pull.strategy: merge-gguf` (provides the `hf`
                         CLI used to fetch the shards).
* `llama.cpp` (brew)   — required when any entry has
                         `pull.strategy: merge-gguf` (provides
                         `llama-gguf-split --merge`).
* `ollama`             — always required (target for `ollama pull`
                         and `ollama create`).

These are wired into `mac-node/pyproject.toml` (Python deps) and
`mac-node/Brewfile` (system deps), so `task setup` installs everything
in one shot. If you're running this script outside `task setup`, see
the README in this dir.

Usage:
    python3 scripts/download-models.py
    python3 scripts/download-models.py --concurrency 3
    python3 scripts/download-models.py --only "qwen3-coder,deepseek-r1"
    python3 scripts/download-models.py --skip "behemoth-x"   # known-sharded
    python3 scripts/download-models.py --dry-run             # plan only

Output is interleaved by model alias prefix so you can `grep` a single
download's progress out of the stream:

    [qwen3-coder] pulling manifest
    [qwen3-coder] pulling 7d2f9b5b... 100% ▕████████████████▏ 18 GB
    [deepseek-r1] pulling 4cd576d9... 67%  ▕███████████░░░░░▏ 13 GB

Sharded GGUF entries (Ollama #5245 — currently unsupported) fail the
pull with a 400; those models are listed in the failure summary so you
can decide between (a) dropping them, (b) using a smaller single-file
quant, or (c) merging shards manually with llama.cpp gguf-split.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

REPO_DIR = Path(__file__).resolve().parent.parent
MODELS_PATH = REPO_DIR / "models.yaml"

# ANSI for friendly progress in a TTY; degrades cleanly in a pipe.
_TTY = sys.stdout.isatty()
_C = {
    "g":  "\033[32m" if _TTY else "",
    "r":  "\033[31m" if _TTY else "",
    "y":  "\033[33m" if _TTY else "",
    "b":  "\033[34m" if _TTY else "",
    "p":  "\033[35m" if _TTY else "",
    "c":  "\033[36m" if _TTY else "",
    "d":  "\033[2m"  if _TTY else "",
    "x":  "\033[0m"  if _TTY else "",
}


@dataclass
class PullSpec:
    """How to materialize the model on disk. Default strategy is the
    direct ``ollama pull <name>`` path; ``merge-gguf`` is the workaround
    for sharded HF GGUF repos (ollama/ollama#5245)."""

    strategy: str = "ollama-pull"      # "ollama-pull" | "merge-gguf"
    hf_repo: str = ""                  # required for merge-gguf
    hf_pattern: str = "*.gguf"         # glob the shards we need
    scratch_root: str = ""             # override default scratch dir
    keep_shards: bool = False          # don't delete shards after merge


@dataclass
class Job:
    alias: str         # registry alias — used as the log prefix
    name: str          # ollama tag — the *resulting* tag for merge-gguf
    description: str = ""
    pull: PullSpec = field(default_factory=PullSpec)
    status: str = "pending"   # pending | running | ok | fail
    detail: str = ""
    duration_s: float = 0.0


@dataclass
class Plan:
    jobs: list[Job] = field(default_factory=list)


def load_plan(only: list[str], skip: list[str]) -> Plan:
    """Read models.yaml and produce the list of jobs that match filters."""
    cfg = yaml.safe_load(MODELS_PATH.read_text())
    jobs: list[Job] = []
    for m in cfg.get("ollama", {}).get("models", []) or []:
        targets = m.get("target", ["mac", "runpod"])
        if "mac" not in targets:
            # Runpod-only entries don't get pulled on this node.
            continue
        alias = str(m["alias"])
        name = str(m["name"])
        if only and alias not in only and name not in only:
            continue
        if alias in skip or name in skip:
            continue
        pull_cfg = m.get("pull") or {}
        pull = PullSpec(
            strategy=str(pull_cfg.get("strategy", "ollama-pull")),
            hf_repo=str(pull_cfg.get("hf_repo", "")),
            hf_pattern=str(pull_cfg.get("hf_pattern", "*.gguf")),
            scratch_root=str(pull_cfg.get("scratch_root", "")),
            keep_shards=bool(pull_cfg.get("keep_shards", False)),
        )
        jobs.append(
            Job(
                alias=alias,
                name=name,
                description=m.get("description", ""),
                pull=pull,
            )
        )
    return Plan(jobs=jobs)


async def _stream(cmd: list[str], prefix: str, env: Optional[dict] = None) -> tuple[int, str]:
    """Run a subprocess streaming merged stdout+stderr with a per-line
    prefix. Returns (exit_code, last_line). Centralized so both pull
    paths get identical logging behavior."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=env,
    )
    last_line = ""
    assert proc.stdout is not None
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        text = line.decode("utf-8", "replace").rstrip("\r\n")
        if not text:
            continue
        last_line = text
        print(prefix + text, flush=True)
    rc = await proc.wait()
    return rc, last_line


def _which(*candidates: str) -> Optional[str]:
    """Return the first command in PATH from a list of alternatives."""
    for c in candidates:
        path = shutil.which(c)
        if path:
            return path
    return None


def _scratch_dir(job: Job) -> Path:
    """Where shards + merged GGUF land during merge-gguf workflows.
    Default `~/.cache/catalyst-llm/pull/<alias>/` — unified location
    so cleanup is `rm -rf ~/.cache/catalyst-llm/pull` if you need
    to recover disk."""
    if job.pull.scratch_root:
        return Path(job.pull.scratch_root).expanduser() / job.alias
    return Path.home() / ".cache" / "catalyst-llm" / "pull" / job.alias


def _find_first_shard(work: Path) -> Optional[Path]:
    """Locate the `*-00001-of-NNNNN.gguf` shard. llama-gguf-split
    --merge expects the first part; it walks the rest itself."""
    # GGUF shard naming convention: `<base>-00001-of-NNNNN.gguf`
    candidates = sorted(work.rglob("*-00001-of-*.gguf"))
    if candidates:
        return candidates[0]
    # Fallback for older quanters that use 1-based without zero-padding
    candidates = sorted(work.rglob("*-1-of-*.gguf"))
    if candidates:
        return candidates[0]
    # Last-ditch: just take the lexicographically first GGUF
    candidates = sorted(work.rglob("*.gguf"))
    return candidates[0] if candidates else None


async def pull_via_ollama(job: Job, prefix: str) -> None:
    """The default path: `ollama pull <name>` straight through."""
    rc, last = await _stream(["ollama", "pull", job.name], prefix)
    if rc == 0:
        job.status = "ok"
        job.detail = "done"
    else:
        job.status = "fail"
        # Surface the last line — usually the real reason (sharded
        # GGUF 400, manifest 404, network, disk-full).
        job.detail = last or f"exit code {rc}"


async def pull_via_merge_gguf(job: Job, prefix: str) -> None:
    """Sharded-GGUF workaround: download shards from HF, merge via
    `llama-gguf-split --merge`, then `ollama create` the resulting
    single-file model under job.name as the local tag."""
    if not job.pull.hf_repo:
        job.status = "fail"
        job.detail = "merge-gguf strategy requires pull.hf_repo in models.yaml"
        return

    hf = _which("hf", "huggingface-cli")
    if not hf:
        job.status = "fail"
        job.detail = "neither `hf` nor `huggingface-cli` found in PATH (pip install huggingface_hub)"
        return

    splitter = _which("llama-gguf-split", "gguf-split")
    if not splitter:
        job.status = "fail"
        job.detail = "llama-gguf-split not found in PATH (brew install llama.cpp)"
        return

    work = _scratch_dir(job)
    work.mkdir(parents=True, exist_ok=True)

    # Step 1 — download matching shards from HF. The `hf download` and
    # the legacy `huggingface-cli download` share most flags.
    print(f"{prefix}fetching shards from {job.pull.hf_repo} -> {work}", flush=True)
    download_cmd = [
        hf,
        "download",
        job.pull.hf_repo,
        "--include",
        job.pull.hf_pattern,
        "--local-dir",
        str(work),
    ]
    rc, last = await _stream(download_cmd, prefix)
    if rc != 0:
        job.status = "fail"
        job.detail = f"hf download failed: {last}"
        return

    first = _find_first_shard(work)
    if not first:
        job.status = "fail"
        job.detail = f"no GGUF shards found under {work} (pattern={job.pull.hf_pattern})"
        return
    print(f"{prefix}first shard: {first.name}", flush=True)

    # Step 2 — merge the shards. The output filename is anchored at
    # `merged.gguf` in the same dir so we know how to clean up later.
    merged = work / "merged.gguf"
    if merged.exists():
        # Re-run safety: stale merged file from an interrupted run.
        merged.unlink()
    rc, last = await _stream(
        [splitter, "--merge", str(first), str(merged)],
        prefix,
    )
    if rc != 0:
        job.status = "fail"
        job.detail = f"llama-gguf-split --merge failed: {last}"
        return

    # Step 3 — register the merged file as an Ollama model. We hand
    # `ollama create` a Modelfile with a single FROM line; no other
    # parameters by default (the GGUF carries its own template).
    modelfile = work / "Modelfile"
    modelfile.write_text(f"FROM {merged}\n")
    rc, last = await _stream(
        ["ollama", "create", job.name, "-f", str(modelfile)],
        prefix,
    )
    if rc != 0:
        job.status = "fail"
        job.detail = f"ollama create failed: {last}"
        return

    # Step 4 — optional cleanup. `keep_shards: true` is for when you
    # plan to merge a different quant from the same repo and want to
    # save the bandwidth. Default is to free the ~75GB of shards now
    # that Ollama owns the merged copy in its own model store.
    if not job.pull.keep_shards:
        for f in work.rglob("*.gguf"):
            try:
                f.unlink()
            except OSError:
                pass  # best-effort
        try:
            modelfile.unlink()
        except OSError:
            pass

    job.status = "ok"
    job.detail = f"merged {first.name} -> ollama tag {job.name}"


async def pull_one(job: Job, prefix_width: int) -> None:
    """Dispatch on pull strategy and stream output with a prefix."""
    job.status = "running"
    started = time.monotonic()
    pad = job.alias.ljust(prefix_width)
    prefix = f"{_C['c']}[{pad}]{_C['x']} "
    try:
        if job.pull.strategy == "merge-gguf":
            await pull_via_merge_gguf(job, prefix)
        else:
            await pull_via_ollama(job, prefix)
    finally:
        job.duration_s = time.monotonic() - started


async def run_plan(plan: Plan, concurrency: int) -> None:
    """Run all jobs through a bounded semaphore. We keep the semaphore
    rather than asyncio.gather'ing N coroutines because Ollama pulls
    are I/O-heavy and saturating the LAN with 5 concurrent downloads
    just makes them all slow."""
    if not plan.jobs:
        return
    width = max(len(j.alias) for j in plan.jobs)
    sem = asyncio.Semaphore(concurrency)

    async def runner(j: Job) -> None:
        async with sem:
            await pull_one(j, width)

    await asyncio.gather(*(runner(j) for j in plan.jobs))


def print_summary(plan: Plan) -> int:
    """Print the post-run report; returns process exit code."""
    print()
    print(f"{_C['p']}── Summary ──{_C['x']}")
    ok = [j for j in plan.jobs if j.status == "ok"]
    fail = [j for j in plan.jobs if j.status == "fail"]
    pending = [j for j in plan.jobs if j.status == "pending"]
    print(
        f"  {_C['g']}✓ ok{_C['x']:<10} {len(ok):>3}   "
        f"{_C['r']}✗ failed{_C['x']:<6} {len(fail):>3}   "
        f"{_C['y']}? pending{_C['x']:<5} {len(pending):>3}   "
        f"{_C['d']}total{_C['x']}    {len(plan.jobs):>3}"
    )
    if fail:
        print()
        print(f"{_C['r']}── Failures (need attention) ──{_C['x']}")
        for j in fail:
            print(f"  {_C['r']}✗{_C['x']} {j.alias:<24} {_C['d']}{j.name}{_C['x']}")
            if j.detail:
                print(f"      {j.detail[:160]}")
    return 0 if not fail else 1


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Parallel pull every mac-targeted Ollama model from models.yaml",
    )
    p.add_argument(
        "--concurrency", "-j",
        type=int,
        default=int(os.environ.get("OLLAMA_PULL_CONCURRENCY", "2")),
        help="Max simultaneous `ollama pull` invocations (default 2)",
    )
    p.add_argument(
        "--only",
        default="",
        help="Comma-separated alias or name list — only pull these",
    )
    p.add_argument(
        "--skip",
        default="",
        help="Comma-separated alias or name list — exclude from pull",
    )
    p.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="Print the plan and exit without pulling",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    skip = [s.strip() for s in args.skip.split(",") if s.strip()]

    plan = load_plan(only=only, skip=skip)
    if not plan.jobs:
        print(f"{_C['y']}No matching models in models.yaml{_C['x']}")
        return 0

    print(
        f"{_C['p']}── Pulling {len(plan.jobs)} model(s) "
        f"with concurrency {args.concurrency} ──{_C['x']}"
    )
    width = max(len(j.alias) for j in plan.jobs)
    for j in plan.jobs:
        strat = "" if j.pull.strategy == "ollama-pull" else f" {_C['y']}[{j.pull.strategy}]{_C['x']}"
        print(f"  {j.alias:<{width}}  {_C['d']}{j.name}{_C['x']}{strat}")
    print()

    if args.dry_run:
        return 0

    try:
        asyncio.run(run_plan(plan, concurrency=args.concurrency))
    except KeyboardInterrupt:
        print(f"\n{_C['y']}Interrupted — partial results below{_C['x']}")
    return print_summary(plan)


if __name__ == "__main__":
    sys.exit(main())
