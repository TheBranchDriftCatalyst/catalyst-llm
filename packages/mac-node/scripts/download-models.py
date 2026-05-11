#!/usr/bin/env python3
"""Pull every mac-targeted Ollama model from models.yaml in parallel.

models.yaml is the single source of truth — this script reads it on each
invocation, filters to entries where ``target`` includes ``mac`` (or has
no target field, which defaults to both targets), and runs ``ollama
pull`` on each one through a bounded asyncio pool.

UX: a Rich-rendered live dashboard with one row per model, in-place
progress bars, speed, and ETA. Falls back to per-line streamed output
when stdout is not a TTY (CI logs, redirected to a file, etc.) so logs
remain greppable.

Two pull strategies live in the same pipeline:

  ollama-pull (default):     ollama pull <name>     — straight through
  merge-gguf:                hf download shards     — for sharded GGUF
                             llama-gguf-split       repos that exceed
                             ollama create          HF's single-file cap

Dependencies
------------
* ``pyyaml``           — always required (parses models.yaml).
* ``rich``             — always required (live progress dashboard).
* ``huggingface_hub``  — required when any entry has
                         ``pull.strategy: merge-gguf`` (provides ``hf``).
* ``llama.cpp`` (brew) — required when any entry has
                         ``pull.strategy: merge-gguf`` (provides
                         ``llama-gguf-split --merge``).
* ``ollama``           — always required (target for ``ollama pull``
                         and ``ollama create``).

These are wired into ``mac-node/pyproject.toml`` (Python deps) and
``mac-node/Brewfile`` (system deps), so ``task setup`` installs
everything in one shot.

Usage
-----
    python3 scripts/download-models.py
    python3 scripts/download-models.py --concurrency 3
    python3 scripts/download-models.py --only "qwen3-coder,deepseek-r1"
    python3 scripts/download-models.py --skip "behemoth-x"
    python3 scripts/download-models.py --dry-run
    python3 scripts/download-models.py --plain   # disable Rich UI
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import shutil
import signal
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator, Optional

import yaml

REPO_DIR = Path(__file__).resolve().parent.parent
MODELS_PATH = REPO_DIR / "models.yaml"

# Set from --force / FORCE_REPULL=1 in main(). When true, the
# "already in ollama" pre-checks are skipped and every job runs the
# full pull pipeline. Use this when the upstream model has been
# re-uploaded and you actually want to overwrite the local copy.
_FORCE_REPULL = False


# ───────────────────────────────────────────────────────────────────────
# Domain types
# ───────────────────────────────────────────────────────────────────────


@dataclass
class PullSpec:
    """How to materialize the model on disk.

    - ``ollama-pull`` (default): straight ``ollama pull <name>``.
    - ``merge-gguf``: ``hf download`` the shards, run
      ``llama-gguf-split --merge`` (skipped if there's only one file),
      then ``ollama create``. The fallback path for sharded GGUF
      (ollama/ollama#5245) and for HF realm-host bugs that ``ollama
      pull hf.co/...`` chokes on.
    - ``local-only``: skip the network round-trip; just verify the
      tag is already present in ``ollama list``. Used for community
      Ollama tags whose upstream manifests have disappeared but which
      we still have locally."""

    strategy: str = "ollama-pull"      # "ollama-pull" | "merge-gguf" | "local-only"
    hf_repo: str = ""
    hf_pattern: str = "*.gguf"
    scratch_root: str = ""
    keep_shards: bool = False


@dataclass
class JobState:
    """Live, mutable view of a single model's pull progress.

    The renderer reads this every refresh tick — we only need the
    fields the UI shows, so derived bytes/speed/eta are stored as
    pre-formatted strings."""

    alias: str
    name: str
    pull: PullSpec = field(default_factory=PullSpec)
    description: str = ""

    # Status: "queued" | "running" | "done" | "fail"
    status: str = "queued"
    # Stage: human-readable verb describing the current step.
    # Examples: "manifest", "layer 1bdf4b…", "downloading shards",
    # "merging gguf", "creating ollama model", "verifying", "writing".
    stage: str = "queued"
    percent: float = 0.0
    bytes_done: int = 0
    bytes_total: int = 0
    speed_str: str = ""
    eta_str: str = ""
    detail: str = ""           # last informational line
    error: str = ""            # set when status == "fail"
    started_at: float = 0.0
    ended_at: float = 0.0

    @property
    def elapsed(self) -> float:
        if not self.started_at:
            return 0.0
        end = self.ended_at or time.monotonic()
        return end - self.started_at


# ───────────────────────────────────────────────────────────────────────
# Plan loading
# ───────────────────────────────────────────────────────────────────────


def load_plan(only: list[str], skip: list[str]) -> list[JobState]:
    """Read models.yaml and produce the list of jobs that match filters."""
    cfg = yaml.safe_load(MODELS_PATH.read_text())
    out: list[JobState] = []
    for m in cfg.get("ollama", {}).get("models", []) or []:
        targets = m.get("target", ["mac", "runpod"])
        if "mac" not in targets:
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
        out.append(
            JobState(
                alias=alias,
                name=name,
                pull=pull,
                description=m.get("description", ""),
            )
        )
    return out


# ───────────────────────────────────────────────────────────────────────
# Output parsing
#
# Both `ollama pull` and `hf download` use \r-overwriting progress
# lines, which asyncio's readline() (which only splits on \n) misses.
# We read raw chunks and split on either \r or \n so each progress
# update lands as its own "line".
# ───────────────────────────────────────────────────────────────────────


async def stream_lines(stream: asyncio.StreamReader) -> AsyncIterator[str]:
    buf = bytearray()
    while True:
        chunk = await stream.read(256)
        if not chunk:
            if buf:
                yield bytes(buf).decode("utf-8", "replace")
            return
        for byte in chunk:
            if byte in (0x0d, 0x0a):  # \r or \n
                if buf:
                    yield bytes(buf).decode("utf-8", "replace")
                    buf.clear()
            else:
                buf.append(byte)


# Matches one of:
#   pulling 1bdf4b8469bf: 47%
#   pulling 1bdf4b8469bf:  47% ▕███░░░░░░░▏   20 GB/  42 GB    13 MB/s   26m54s
#   pulling abc:  100% ▕....▏  1.5 KB
_OLLAMA_LAYER_RE = re.compile(
    r"""^pulling\ ([a-f0-9]{6,}):\s*
        (?P<pct>\d+)%
        (?:\s*[▕|\[].*?[▏\]|])?         # progress bar (optional)
        \s*
        (?:(?P<done>[\d.]+\s*[KMGTP]?B)
            (?:\s*/\s*(?P<total>[\d.]+\s*[KMGTP]?B))?)?
        (?:\s+(?P<speed>[\d.]+\s*[KMGTP]?B/s))?
        (?:\s+(?P<eta>\S+))?
        \s*$""",
    re.VERBOSE,
)

# `Fetching 2 files:  47%|███▎       | 1/2 [10:00<10:00, ...]`
_HF_FETCH_RE = re.compile(
    r"^Fetching\s+(?P<total>\d+)\s+files?:\s*(?P<pct>\d+)%.*?(?P<done>\d+)/(?P<total2>\d+)"
)
# Per-file download progress within hf download:
#   foo.gguf:  47%|███▎     | 19.8G/42.1G [10:00<11:00,  35MB/s]
#
# We anchor on `\.gguf:` so the aggregate `Fetching N files:` line
# can't accidentally match (its only B-unit measurement is item-count,
# which surfaces as "?it/s" in the speed slot — not what we want).
# We also explicitly require the speed slot to end in "B/s" so partial
# tqdm states ("?it/s", "?B/s") don't fall through.
_HF_FILE_RE = re.compile(
    r"""^.*?\.gguf[^:]*:\s*               # filename ending in .gguf
        (?P<pct>\d+)%                     # 47%
        .*?\|\s*                          # progress bar
        (?P<done>[\d.]+\s*[KMGTP]?B?)     # 19.8G
        /\s*
        (?P<total>[\d.]+\s*[KMGTP]?B?)    # 42.1G
        \s*\[
        (?P<elapsed>[^,\]]+)              # 10:00<11:00
        ,\s*
        (?P<speed>[\d.]+\s*[KMGTP]?B/s)   # 35MB/s — must end in B/s
        \]""",
    re.VERBOSE,
)

_BYTES_RE = re.compile(r"^([\d.]+)\s*([KMGTP]?B)$", re.IGNORECASE)


def _parse_size(s: str) -> int:
    s = s.strip()
    m = _BYTES_RE.match(s)
    if not m:
        return 0
    n = float(m.group(1))
    unit = m.group(2).upper()
    mult = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}.get(unit, 1)
    return int(n * mult)


def parse_ollama_line(line: str, job: JobState) -> None:
    """Mutate `job` to reflect what `line` from ollama pull tells us.

    Tolerant to stripped whitespace and missing optional fields; if the
    line doesn't match any known pattern we just drop it into `detail`."""
    s = line.strip()
    if not s:
        return
    if s.startswith("pulling manifest"):
        job.stage = "manifest"
        job.detail = "pulling manifest"
        return
    if s.startswith("verifying"):
        job.stage = "verifying"
        job.detail = "verifying sha256"
        job.percent = 99.0
        return
    if s.startswith("writing manifest"):
        job.stage = "writing"
        job.detail = "writing manifest"
        job.percent = 99.5
        return
    if s == "success":
        job.percent = 100.0
        job.detail = "success"
        return
    m = _OLLAMA_LAYER_RE.match(s)
    if m:
        digest = s.split(":", 1)[0].split(" ", 1)[1][:8]
        job.stage = f"layer {digest}"
        job.percent = float(m.group("pct"))
        if m.group("done"):
            job.bytes_done = _parse_size(m.group("done") or "")
        if m.group("total"):
            job.bytes_total = _parse_size(m.group("total") or "")
        job.speed_str = (m.group("speed") or "").strip()
        job.eta_str = (m.group("eta") or "").strip()
        job.detail = s[:120]
        return
    # Unrecognized — keep as detail so the failure summary can show it
    # if the pull craps out right after.
    job.detail = s[:160]


def parse_hf_line(line: str, job: JobState) -> None:
    """Best-effort parser for `hf download` tqdm output.

    hf prints one bar for the overall N-files job and another per file
    being downloaded; we prefer the per-file bar because it carries
    speed + bytes."""
    s = line.strip()
    if not s:
        return
    m = _HF_FILE_RE.match(s)
    if m:
        job.stage = "downloading shard"
        job.percent = float(m.group("pct"))
        job.bytes_done = _parse_size(m.group("done"))
        job.bytes_total = _parse_size(m.group("total"))
        job.speed_str = (m.group("speed") or "").strip()
        job.detail = s[:120]
        return
    m = _HF_FETCH_RE.match(s)
    if m:
        # Translate "1/2 files done" into a coarse percentage so the
        # bar still moves between per-file updates.
        try:
            done = int(m.group("done"))
            total = int(m.group("total2"))
            if total:
                job.percent = max(job.percent, 100.0 * done / total)
        except (TypeError, ValueError):
            pass
        job.stage = f"downloading shards ({m.group('done')}/{m.group('total2')})"
        return
    if "Downloading" in s:
        job.stage = "downloading shard"
        job.detail = s[:120]


# ───────────────────────────────────────────────────────────────────────
# Subprocess runners
# ───────────────────────────────────────────────────────────────────────


def _which(*candidates: str) -> Optional[str]:
    for c in candidates:
        path = shutil.which(c)
        if path:
            return path
    return None


def _scratch_dir(job: JobState) -> Path:
    if job.pull.scratch_root:
        return Path(job.pull.scratch_root).expanduser() / job.alias
    return Path.home() / ".cache" / "catalyst-llm" / "pull" / job.alias


def _find_first_shard(work: Path) -> Optional[Path]:
    candidates = sorted(work.rglob("*-00001-of-*.gguf"))
    if candidates:
        return candidates[0]
    candidates = sorted(work.rglob("*-1-of-*.gguf"))
    if candidates:
        return candidates[0]
    candidates = sorted(work.rglob("*.gguf"))
    return candidates[0] if candidates else None


async def _terminate_proc_tree(proc: asyncio.subprocess.Process, *, grace: float = 3.0) -> None:
    """Kill `proc` and any subprocess it spawned (its whole session).

    Each subprocess in this script is started with `start_new_session=True`
    so it lives in its own process group; we send SIGTERM to the whole
    group, wait briefly, then escalate to SIGKILL. This matters because
    `hf download` spawns its own worker processes for parallel chunk
    fetches — terminating just the parent leaves orphans.
    """
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(proc.wait(), timeout=grace)
    except asyncio.TimeoutError:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass


async def _run_streamed(
    cmd: list[str],
    job: JobState,
    parse: callable,
    *,
    env: Optional[dict] = None,
) -> tuple[int, str]:
    """Spawn `cmd`, stream output through `parse(line, job)`, return
    (exit_code, last_line). The parser owns mutating the job state.

    On cancellation (Ctrl-C → CancelledError), the subprocess and any
    of its children are terminated via `_terminate_proc_tree` before
    the exception propagates."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )
    last = ""
    assert proc.stdout is not None
    try:
        async for line in stream_lines(proc.stdout):
            if line.strip():
                last = line
                try:
                    parse(line, job)
                except Exception as exc:
                    # Never let a parser bug crash the whole pull — just
                    # store the error and keep the subprocess running.
                    job.detail = f"parse error: {exc}"
        rc = await proc.wait()
        return rc, last
    except (asyncio.CancelledError, KeyboardInterrupt):
        job.stage = "cancelling"
        job.detail = "received interrupt — terminating subprocess"
        await _terminate_proc_tree(proc)
        raise


async def pull_via_ollama(job: JobState) -> None:
    # Skip the network round-trip (manifest fetch + layer-hash check)
    # if we already have this exact tag locally. Ollama would normally
    # short-circuit identical layers itself, but the manifest call still
    # waits on the registry — annoying when N models are queued and only
    # one is actually missing.
    job.stage = "checking ollama"
    if not _FORCE_REPULL and await _ollama_lists_tag(job.name):
        job.status = "done"
        job.stage = "already present"
        job.percent = 100.0
        job.detail = f"{job.name} already in ollama — skipped"
        return

    rc, last = await _run_streamed(["ollama", "pull", job.name], job, parse_ollama_line)
    if rc == 0:
        job.status = "done"
        job.percent = 100.0
        job.detail = "done"
    else:
        job.status = "fail"
        job.error = last or f"exit code {rc}"


async def _ollama_lists_tag(tag: str) -> bool:
    """True iff `ollama list` reports `tag` (with or without :latest)."""
    proc = await asyncio.create_subprocess_exec(
        "ollama", "list",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        stdout_b, _ = await proc.communicate()
    except (asyncio.CancelledError, KeyboardInterrupt):
        await _terminate_proc_tree(proc)
        raise
    if proc.returncode != 0:
        return False
    text = stdout_b.decode("utf-8", "replace")
    # `ollama list` first column is the tag; cheap substring check is
    # robust enough since Ollama tags don't contain whitespace.
    aliases = {tag, tag.removesuffix(":latest"), f"{tag}:latest"}
    for line in text.splitlines()[1:]:  # skip header row
        first = line.strip().split()
        if first and first[0] in aliases:
            return True
    return False


async def pull_via_local_only(job: JobState) -> None:
    """For tags that are present locally but whose upstream manifest
    has disappeared. We do nothing on the network — just verify the
    model is there and report accordingly."""
    job.stage = "verifying local"
    if await _ollama_lists_tag(job.name):
        job.status = "done"
        job.stage = "already present"
        job.percent = 100.0
        job.detail = "local-only — upstream manifest unavailable; tag is on disk"
        return
    job.status = "fail"
    job.error = (
        f"tag {job.name!r} is marked pull.strategy=local-only but is not present "
        f"in `ollama list`. Bring it back manually or change the strategy."
    )


async def _hf_auth_check(hf_bin: str) -> Optional[str]:
    """Return None if `hf` is authenticated (or HF_TOKEN env is set);
    otherwise return a human-readable hint string. Cheap — runs
    `hf auth whoami` synchronously with a 5s cap."""
    if os.environ.get("HF_TOKEN"):
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            hf_bin, "auth", "whoami",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        try:
            _, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        except asyncio.TimeoutError:
            await _terminate_proc_tree(proc, grace=1.0)
            return "hf auth whoami timed out"
        except (asyncio.CancelledError, KeyboardInterrupt):
            await _terminate_proc_tree(proc, grace=1.0)
            raise
        if proc.returncode == 0:
            return None
        return "hf is not logged in (run `hf auth login` and paste a read token from https://hf.co/settings/tokens)"
    except FileNotFoundError:
        return "hf CLI missing (pip install huggingface_hub)"


def _expected_bytes_for_repo(repo_id: str, pattern: str) -> int:
    """Ask HF for the total bytes we expect to download. Returns 0 if
    huggingface_hub isn't importable or the API is unreachable; the
    poller falls back to "bytes-so-far without %" in that case."""
    try:
        from fnmatch import fnmatch
        from huggingface_hub import HfApi  # type: ignore[import-untyped]

        api = HfApi(token=os.environ.get("HF_TOKEN"))
        info = api.repo_info(repo_id=repo_id, files_metadata=True)
        total = 0
        for sib in getattr(info, "siblings", []) or []:
            name = getattr(sib, "rfilename", None) or ""
            if not fnmatch(name, pattern):
                continue
            size = getattr(sib, "size", None) or 0
            total += size
        return int(total)
    except Exception:
        # Network blip or older huggingface_hub without files_metadata —
        # not worth failing the download over. Return 0 and the dashboard
        # just won't show a total/percentage during the fetch step.
        return 0


def _dir_size_bytes(root: Path, pattern: str = "*") -> int:
    """Sum the on-disk size of files relevant to the *current* download.

    Counts:
      - top-level files matching `pattern` (completed downloads
        for the active hf_pattern), and
      - any `.incomplete` files under `<root>/.cache/huggingface/download/`
        (hf-download's in-progress target — name is a hash, so we can't
        filter it by pattern; in practice only one is live at a time).

    Skips top-level files from prior runs that match a *different*
    pattern (e.g. a stale Q4_K_M.gguf when we're now pulling Q8_0).

    Recursive only into the hf-download cache subtree; everything else
    is checked at the top level."""
    import fnmatch

    total = 0
    try:
        for f in root.iterdir():
            try:
                if f.is_file() and fnmatch.fnmatch(f.name, pattern):
                    total += f.stat().st_size
            except OSError:
                pass
    except OSError:
        pass

    incomplete_dir = root / ".cache" / "huggingface" / "download"
    try:
        for f in incomplete_dir.iterdir():
            try:
                if f.is_file() and f.name.endswith(".incomplete"):
                    total += f.stat().st_size
            except OSError:
                pass
    except (OSError, FileNotFoundError):
        pass

    return total


async def _poll_download_progress(job: JobState, work: Path, expected_bytes: int) -> None:
    """Background coroutine: poll the working dir's on-disk size and
    update job progress. Speed is computed over a rolling sample
    window so a brief stall (between files, during hashing) doesn't
    zero out the speed/ETA columns and cause the dashboard to flicker.

    Window: last ~6 seconds at a 0.5s sample rate (12 samples). A
    real stall (no new bytes for the entire window) is the only
    time we blank the speed; otherwise we keep showing the
    window-average rate."""
    from collections import deque

    poll_interval = 0.5
    window_samples = 12       # 12 * 0.5s = ~6s rolling window
    samples: deque = deque(maxlen=window_samples)
    job.bytes_total = expected_bytes

    pattern = job.pull.hf_pattern or "*.gguf"

    while True:
        try:
            await asyncio.sleep(poll_interval)
            now_t = time.monotonic()
            now_bytes = _dir_size_bytes(work, pattern)
            samples.append((now_t, now_bytes))

            # Update bytes / percent immediately every tick — those are
            # snapshot-style, no smoothing needed.
            job.bytes_done = now_bytes
            if expected_bytes > 0:
                job.percent = min(99.9, 100.0 * now_bytes / expected_bytes)

            # Compute rate over the full window (oldest -> newest).
            # Need at least 2 samples and meaningful elapsed time.
            if len(samples) >= 2:
                t0, b0 = samples[0]
                t1, b1 = samples[-1]
                dt = t1 - t0
                db = b1 - b0
                if dt >= 1.0 and db > 0:
                    rate = db / dt
                    job.speed_str = f"{_human_bytes(int(rate))}/s"
                    if expected_bytes > 0:
                        remaining = max(0, expected_bytes - now_bytes)
                        eta_s = remaining / rate
                        job.eta_str = _human_elapsed(eta_s)
                # If db==0 across the entire window we don't touch
                # speed_str / eta_str — they stay at their last
                # known values rather than flickering to empty.
                # Only when the window is fully stalled (no growth
                # for ~6s) AND we've been here a while do we clear.
                elif len(samples) == window_samples and db == 0:
                    job.speed_str = ""
                    job.eta_str = ""
        except asyncio.CancelledError:
            return
        except Exception:
            # Never let a poll error crash the download — just retry.
            continue


async def pull_via_merge_gguf(job: JobState) -> None:
    if not job.pull.hf_repo:
        job.status = "fail"
        job.error = "merge-gguf needs pull.hf_repo in models.yaml"
        return

    # Pre-check: if the target tag is already in `ollama list`, the
    # bytes are already content-addressed in ~/.ollama/models/blobs.
    # Re-running the full hf-download → merge → ollama-create pipeline
    # would just re-fetch the same shards (HF's CAS backend in particular
    # is intermittent on retries that touch leftover local state). Skip.
    job.stage = "checking ollama"
    if not _FORCE_REPULL and await _ollama_lists_tag(job.name):
        job.status = "done"
        job.stage = "already present"
        job.percent = 100.0
        job.detail = f"{job.name} already in ollama — skipped re-pull"
        return

    hf = _which("hf", "huggingface-cli")
    if not hf:
        job.status = "fail"
        job.error = "neither `hf` nor `huggingface-cli` in PATH (pip install huggingface_hub)"
        return

    auth_hint = await _hf_auth_check(hf)
    if auth_hint:
        job.status = "fail"
        job.error = auth_hint
        return

    work = _scratch_dir(job)
    work.mkdir(parents=True, exist_ok=True)

    # Pre-flight: ask HF how big the download will be. This is a single
    # cheap API call; if it fails we still proceed with the download
    # but the dashboard won't show a total/percentage during fetch.
    job.stage = "querying repo size"
    loop = asyncio.get_running_loop()
    expected = await loop.run_in_executor(
        None,
        _expected_bytes_for_repo,
        job.pull.hf_repo,
        job.pull.hf_pattern,
    )
    if expected:
        job.bytes_total = expected

    # Step 1 — fetch shards from HF. Two coroutines run in parallel:
    #   - the actual `hf download` subprocess (we only watch its
    #     errors via parse_hf_line — its tqdm bar buffers when piped
    #     and is unreliable);
    #   - a directory-size poller that updates job.bytes_done /
    #     percent / speed / eta from on-disk reality every second.
    # The poller is the real progress source and is independent of
    # whatever `hf` emits to stdout.
    job.stage = "downloading shards"
    env = {**os.environ}
    poller = asyncio.create_task(_poll_download_progress(job, work, expected))
    try:
        rc, last = await _run_streamed(
            [hf, "download", job.pull.hf_repo, "--include", job.pull.hf_pattern,
             "--local-dir", str(work)],
            job,
            parse_hf_line,
            env=env,
        )
    finally:
        poller.cancel()
        try:
            await poller
        except (asyncio.CancelledError, Exception):
            pass

    if rc != 0:
        hint = ""
        last_lower = last.lower()
        if "invalid username" in last_lower or "401" in last_lower or "unauthorized" in last_lower:
            hint = " — run `hf auth login` and paste a read token from https://hf.co/settings/tokens"
        elif "gated repo" in last_lower or ("access" in last_lower and "denied" in last_lower):
            hint = " — repo is gated; visit the HF page, accept the terms, then re-run"
        elif "404" in last_lower or "not found" in last_lower:
            hint = " — check pull.hf_repo in models.yaml; HF says it doesn't exist"
        elif "cas service error" in last_lower or "cas error" in last_lower:
            # HF's new content-addressed storage backend chokes when
            # local cache state diverges from server state (typically
            # after a partial download from a different storage tier).
            # Nuking the staging dir for this job and retrying is the
            # canonical workaround.
            hint = (
                f" — HF CAS backend error. Try: rm -rf {work} && task models:download "
                f"ONLY={job.alias}"
            )
        job.status = "fail"
        job.error = f"hf download failed: {last}{hint}"
        return

    # Snap to 100% once the subprocess exits cleanly (the poller may
    # have stopped one tick short of the real total).
    if expected:
        job.bytes_done = expected
        job.percent = 100.0
    job.speed_str = ""
    job.eta_str = ""

    first = _find_first_shard(work)
    if not first:
        job.status = "fail"
        job.error = f"no GGUF files under {work} (pattern={job.pull.hf_pattern})"
        return

    # Step 2 — if it's a multi-shard set ("…-00001-of-NNNNN.gguf"),
    # merge with llama-gguf-split. If it's a single non-sharded file
    # we just point the Modelfile straight at it; this lets the same
    # strategy double as a generic "hf download then ollama create"
    # path for repos where `ollama pull hf.co/…` itself misbehaves
    # (HF realm-host bug etc.).
    is_sharded = bool(re.search(r"-\d+-of-\d+\.gguf$", first.name))
    if is_sharded:
        splitter = _which("llama-gguf-split", "gguf-split")
        if not splitter:
            job.status = "fail"
            job.error = "llama-gguf-split not in PATH (brew install llama.cpp)"
            return
        merged = work / "merged.gguf"
        if merged.exists():
            merged.unlink()
        job.stage = "merging gguf"
        job.percent = 0.0
        job.bytes_done = 0
        job.bytes_total = 0
        job.speed_str = ""
        job.eta_str = ""
        rc, last = await _run_streamed(
            [splitter, "--merge", str(first), str(merged)],
            job,
            # llama-gguf-split's progress is byte-count per part; not
            # structured enough to parse cleanly. Stage label conveys
            # the activity and Rich's refresh keeps the row live.
            lambda line, j: setattr(j, "detail", line.strip()[:120]),
        )
        if rc != 0:
            job.status = "fail"
            job.error = f"llama-gguf-split --merge failed: {last}"
            return
    else:
        # Single-file path — no merge step needed.
        merged = first
        job.stage = "single file (no merge)"
        job.detail = f"using {first.name} directly"

    # Step 3 — register with Ollama under the configured local tag.
    modelfile = work / "Modelfile"
    modelfile.write_text(f"FROM {merged}\n")
    job.stage = "ollama create"
    job.percent = 0.0
    rc, last = await _run_streamed(
        ["ollama", "create", job.name, "-f", str(modelfile)],
        job,
        parse_ollama_line,
    )
    if rc != 0:
        job.status = "fail"
        job.error = f"ollama create failed: {last}"
        return

    # Step 4 — clean up. Ollama owns the bytes now (content-addressed
    # blob in ~/.ollama/models/blobs), so the entire scratch dir is
    # redundant. Wipe it: the merged .gguf, the original shards, AND
    # the hf-download cache (.metadata + .lock + sparse `.incomplete`
    # files that CAS-backed pulls leave behind, easily 10s of GB each).
    if not job.pull.keep_shards:
        try:
            shutil.rmtree(work, ignore_errors=True)
        except OSError:
            # Best-effort fallback: at minimum remove the GGUF and
            # any *.incomplete files individually.
            for pattern in ("*.gguf", "*.incomplete"):
                for f in work.rglob(pattern):
                    try:
                        f.unlink()
                    except OSError:
                        pass
            try:
                modelfile.unlink()
            except OSError:
                pass

    job.status = "done"
    job.percent = 100.0
    job.detail = f"merged {first.name} -> ollama tag {job.name}"


async def run_one(job: JobState) -> None:
    job.status = "running"
    job.started_at = time.monotonic()
    try:
        if job.pull.strategy == "merge-gguf":
            await pull_via_merge_gguf(job)
        elif job.pull.strategy == "local-only":
            await pull_via_local_only(job)
        else:
            await pull_via_ollama(job)
    except Exception as exc:  # pragma: no cover — defensive
        job.status = "fail"
        job.error = f"{type(exc).__name__}: {exc}"
    finally:
        job.ended_at = time.monotonic()


# ───────────────────────────────────────────────────────────────────────
# Rendering
# ───────────────────────────────────────────────────────────────────────


def _human_bytes(n: int) -> str:
    if n <= 0:
        return ""
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    f = float(n)
    while f >= 1024 and i < len(units) - 1:
        f /= 1024
        i += 1
    if f >= 100:
        return f"{f:.0f} {units[i]}"
    if f >= 10:
        return f"{f:.1f} {units[i]}"
    return f"{f:.2f} {units[i]}"


def _human_elapsed(s: float) -> str:
    if s < 60:
        return f"{s:.0f}s"
    m, s = divmod(int(s), 60)
    if m < 60:
        return f"{m}m{s:02d}s"
    h, m = divmod(m, 60)
    return f"{h}h{m:02d}m"


def render_dashboard(jobs: list[JobState], concurrency: int):
    """Build the Rich Table that the Live display refreshes."""
    from rich.table import Table
    from rich.text import Text
    from rich import box

    done = sum(1 for j in jobs if j.status == "done")
    fail = sum(1 for j in jobs if j.status == "fail")
    running = sum(1 for j in jobs if j.status == "running")
    queued = sum(1 for j in jobs if j.status == "queued")

    title = (
        f"[bold magenta]models:download[/]  "
        f"[dim]· {len(jobs)} jobs · concurrency {concurrency} · "
        f"[green]✓ {done}[/] · [yellow]→ {running}[/] · "
        f"[dim]queued {queued}[/] · [red]✗ {fail}[/][/dim]"
    )
    table = Table(
        title=title,
        title_justify="left",
        box=box.SIMPLE_HEAD,
        expand=True,
        padding=(0, 1),
        header_style="bold cyan",
    )
    table.add_column("", width=2, no_wrap=True)                 # status glyph
    table.add_column("model", style="bold", no_wrap=True)       # alias
    table.add_column("stage", no_wrap=True, max_width=44)       # widened so error msgs fit
    table.add_column("progress", min_width=24, ratio=2)         # bar
    table.add_column("size", justify="right", no_wrap=True)
    table.add_column("speed", justify="right", no_wrap=True)
    table.add_column("eta", justify="right", no_wrap=True)
    table.add_column("elapsed", justify="right", no_wrap=True)

    for j in jobs:
        glyph, glyph_style, row_style = {
            "queued":  ("·", "dim", "dim"),
            "running": ("◐", "yellow", ""),
            "done":    ("✓", "green", "green"),
            "fail":    ("✗", "red", "red"),
        }[j.status]
        bar = _bar(j.percent, j.status)
        size = ""
        if j.bytes_total:
            size = f"{_human_bytes(j.bytes_done)} / {_human_bytes(j.bytes_total)}"
        elif j.bytes_done:
            size = _human_bytes(j.bytes_done)
        elif j.percent and j.status == "running":
            size = f"{j.percent:.0f}%"
        elapsed = _human_elapsed(j.elapsed) if j.started_at else ""

        # Stage label: for failures we surface a truncated error so
        # the user doesn't have to wait for the summary panel. For
        # queued merge-gguf entries we annotate the strategy.
        if j.status == "fail":
            stage_label = "failed"
            if j.error:
                stage_label = f"failed: {j.error[:36]}"
        elif j.pull.strategy == "merge-gguf" and j.status == "queued":
            stage_label = "queued (merge)"
        elif j.pull.strategy == "local-only" and j.status == "queued":
            stage_label = "queued (local-only)"
        else:
            stage_label = j.stage
        table.add_row(
            Text(glyph, style=glyph_style),
            Text(j.alias, style=row_style or "bold"),
            Text(stage_label, style=row_style),
            bar,
            Text(size, style="dim"),
            Text(j.speed_str or "", style="dim"),
            Text(j.eta_str or "", style="dim"),
            Text(elapsed, style="dim"),
        )

    return table


def _bar(percent: float, status: str):
    """Hand-rolled fixed-width Unicode progress bar — Rich's BarColumn
    can't be embedded as a cell easily, so we draw our own."""
    from rich.text import Text

    width = 20
    pct = max(0.0, min(100.0, percent))
    filled = int(round(width * pct / 100.0))
    color = {
        "done": "green",
        "fail": "red",
        "running": "magenta",
    }.get(status, "dim")
    bar = Text()
    bar.append("▕", style="dim")
    bar.append("█" * filled, style=color)
    bar.append("░" * (width - filled), style="dim")
    bar.append("▏", style="dim")
    bar.append(f" {pct:5.1f}%", style=color if status == "running" else "dim")
    return bar


# ───────────────────────────────────────────────────────────────────────
# Orchestration
# ───────────────────────────────────────────────────────────────────────


async def run_with_dashboard(
    jobs: list[JobState], concurrency: int, plain: bool
) -> None:
    """Drive the worker pool and either redraw the Rich Live dashboard
    or stream plain-text status lines (for non-TTY / --plain mode).

    On SIGINT/SIGTERM we cancel the gather, which propagates
    CancelledError into each runner — _run_streamed catches it and
    process-tree-kills the subprocess before re-raising. A second
    interrupt forces immediate exit (any still-alive children become
    the operator's problem to clean up)."""
    from rich.console import Console
    from rich.live import Live

    console = Console()
    use_rich = console.is_terminal and not plain

    sem = asyncio.Semaphore(concurrency)

    async def runner(j: JobState) -> None:
        async with sem:
            try:
                await run_one(j)
            except asyncio.CancelledError:
                # Mark the job as cancelled so the summary reports it
                # accurately. _run_streamed has already torn down the
                # subprocess by the time we get here.
                if j.status not in ("done", "fail"):
                    j.status = "fail"
                    j.error = j.error or "cancelled by user"
                    j.stage = "cancelled"
                raise

    loop = asyncio.get_running_loop()
    main_task: Optional[asyncio.Task] = None
    interrupt_count = 0

    def handle_interrupt() -> None:
        nonlocal interrupt_count
        interrupt_count += 1
        if interrupt_count == 1:
            try:
                console.print(
                    "\n[yellow]Interrupt received — terminating downloads "
                    "(press Ctrl-C again to force-quit)…[/]"
                )
            except Exception:
                pass
            if main_task and not main_task.done():
                main_task.cancel()
        else:
            try:
                console.print("\n[red]Force-quit.[/]")
            except Exception:
                pass
            # Cancel every running task; rely on per-subprocess setsid
            # to keep grandchildren reachable for any cleanup that
            # finishes before the process exits.
            for task in asyncio.all_tasks(loop):
                task.cancel()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_interrupt)
        except (NotImplementedError, RuntimeError):
            # Windows / non-main-thread fallback: rely on default
            # KeyboardInterrupt path. Mac-node is mac-only so this is
            # belt-and-suspenders.
            pass

    if not use_rich:
        # Plain mode: print one event per state transition. We poll the
        # job list at the same cadence as the rich refresh.
        async def watcher():
            seen: dict[str, str] = {}
            while True:
                for j in jobs:
                    key = f"{j.status}:{j.stage}:{int(j.percent)}"
                    if seen.get(j.alias) != key:
                        seen[j.alias] = key
                        print(
                            f"[{j.alias:<22}] {j.status:<7} "
                            f"{j.stage:<22} {j.percent:5.1f}% "
                            f"{j.detail[:80]}",
                            flush=True,
                        )
                if all(j.status in ("done", "fail") for j in jobs):
                    return
                await asyncio.sleep(0.5)

        main_task = asyncio.gather(
            watcher(), *(runner(j) for j in jobs), return_exceptions=False
        )
        try:
            await main_task
        except asyncio.CancelledError:
            pass
        return

    # Rich live dashboard mode.
    with Live(
        render_dashboard(jobs, concurrency),
        console=console,
        refresh_per_second=8,
        transient=False,
    ) as live:
        async def refresher():
            while True:
                live.update(render_dashboard(jobs, concurrency))
                if all(j.status in ("done", "fail") for j in jobs):
                    return
                await asyncio.sleep(0.15)

        main_task = asyncio.gather(
            refresher(), *(runner(j) for j in jobs), return_exceptions=False
        )
        try:
            await main_task
        except asyncio.CancelledError:
            pass


def print_summary(jobs: list[JobState]) -> int:
    """Post-run report. Returns process exit code."""
    from rich.console import Console
    from rich.text import Text

    console = Console()
    ok = [j for j in jobs if j.status == "done"]
    fail = [j for j in jobs if j.status == "fail"]
    pending = [j for j in jobs if j.status not in ("done", "fail")]
    console.print()
    console.rule("[bold magenta]summary[/]", align="left")
    console.print(
        f"  [green]✓ ok[/] {len(ok):>3}    "
        f"[red]✗ failed[/] {len(fail):>3}    "
        f"[yellow]? pending[/] {len(pending):>3}    "
        f"[dim]total[/] {len(jobs):>3}"
    )
    if fail:
        console.print()
        console.rule("[bold red]failures[/]", align="left")
        for j in fail:
            console.print(
                Text.assemble(
                    ("  ✗ ", "bold red"),
                    (f"{j.alias:<24}", "bold"),
                    (f" {j.name}", "dim"),
                )
            )
            if j.error:
                console.print(Text(f"      {j.error[:200]}", style="red"))
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
    p.add_argument("--only", default="", help="Comma-separated allow-list (alias or name)")
    p.add_argument("--skip", default="", help="Comma-separated deny-list (alias or name)")
    p.add_argument("--dry-run", "-n", action="store_true",
                   help="Print the plan and exit without pulling")
    p.add_argument("--plain", action="store_true",
                   help="Disable Rich live UI; stream per-line state transitions")
    p.add_argument("--force", action="store_true",
                   help="Re-pull even if the tag is already in `ollama list`")
    return p.parse_args()


def main() -> int:
    global _FORCE_REPULL
    args = parse_args()
    _FORCE_REPULL = args.force or os.environ.get("FORCE_REPULL") == "1"
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    skip = [s.strip() for s in args.skip.split(",") if s.strip()]

    jobs = load_plan(only=only, skip=skip)
    if not jobs:
        print("No matching models in models.yaml")
        return 0

    from rich.console import Console
    console = Console()
    width = max(len(j.alias) for j in jobs)
    console.print(f"[bold magenta]── {len(jobs)} job(s) · concurrency {args.concurrency} ──[/]")
    for j in jobs:
        strat = "" if j.pull.strategy == "ollama-pull" else f" [yellow]{j.pull.strategy}[/]"
        console.print(f"  [bold]{j.alias:<{width}}[/]  [dim]{j.name}[/]{strat}")
    console.print()

    if args.dry_run:
        return 0

    try:
        asyncio.run(run_with_dashboard(jobs, args.concurrency, args.plain))
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted — partial results below[/]")
    return print_summary(jobs)


if __name__ == "__main__":
    sys.exit(main())
