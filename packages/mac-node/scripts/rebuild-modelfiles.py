#!/usr/bin/env python3
"""Re-apply the `modelfile:` block from models.yaml to an already-pulled
Ollama tag, without re-downloading or re-merging the GGUF.

Why this exists:
  download-models.py writes the Modelfile (template + sampler params)
  at `ollama create` time during the merge-gguf flow. If you add or
  change a `modelfile:` block in models.yaml AFTER the model has been
  pulled, you don't want to wait for another 65GB download just to
  re-template it. This script reads the current FROM blob path from
  `ollama show <name> --modelfile`, splices in the new modelfile body,
  and re-runs `ollama create` against the same blob.

Usage:
  python3 scripts/rebuild-modelfiles.py                       # all
  python3 scripts/rebuild-modelfiles.py --only qwen3-coder-opus,behemoth-x
  python3 scripts/rebuild-modelfiles.py --dry-run             # show plans

Only models with a non-empty `modelfile:` block in models.yaml are
processed; everything else is skipped (they're either ollama-pull
tags with templates baked into the upstream Modelfile, or community
tags we trust as-is).
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

from _chat_templates import render_modelfile_body

HERE = Path(__file__).resolve().parent
MAC_NODE = HERE.parent
MODELS_PATH = MAC_NODE / "models.yaml"


def load_targets(only: list[str]) -> list[tuple[str, str]]:
    """Return [(name, modelfile_body), ...] for mac-targeted entries
    that resolve to a non-empty Modelfile body (either via `modelfile:`
    or `pull.template_from` + `parameters:`). `only` filters by alias
    or name."""
    cfg = yaml.safe_load(MODELS_PATH.read_text())
    out: list[tuple[str, str]] = []
    for m in cfg.get("ollama", {}).get("models", []) or []:
        if "mac" not in m.get("target", ["mac", "runpod"]):
            continue
        pull_cfg = m.get("pull") or {}
        body = render_modelfile_body(
            template_from=str(pull_cfg.get("template_from") or ""),
            parameters=dict(m.get("parameters") or {}),
            raw_modelfile=str(m.get("modelfile") or ""),
        )
        if not body:
            continue
        if only and m["alias"] not in only and m["name"] not in only:
            continue
        out.append((m["name"], body))
    return out


def current_from(tag: str) -> str | None:
    """Read the FROM path from the model's current Modelfile via
    `ollama show <tag> --modelfile`. Returns None if the tag is absent."""
    try:
        r = subprocess.run(
            ["ollama", "show", tag, "--modelfile"],
            check=True, capture_output=True, text=True, timeout=10,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return None
    for line in r.stdout.splitlines():
        m = re.match(r"\s*FROM\s+(\S+)\s*$", line)
        if m:
            return m.group(1)
    return None


def rebuild(tag: str, modelfile_body: str, dry_run: bool = False) -> bool:
    """Write a temp Modelfile combining the existing FROM line and the
    new body, then `ollama create` over the same tag. Returns True on
    success."""
    from_path = current_from(tag)
    if not from_path:
        print(f"✗ {tag}: not present in ollama (skip; `task models:download` first)")
        return False

    body = f"FROM {from_path}\n\n{modelfile_body}"

    if dry_run:
        print(f"==> would rebuild {tag} (FROM {from_path})")
        for line in body.splitlines():
            print(f"    {line}")
        return True

    with tempfile.NamedTemporaryFile("w", suffix=".modelfile", delete=False) as f:
        f.write(body)
        mfpath = f.name

    print(f"==> rebuilding {tag} (FROM {from_path[-60:]})")
    try:
        r = subprocess.run(
            ["ollama", "create", tag, "-f", mfpath],
            capture_output=True, text=True, timeout=120,
        )
    finally:
        Path(mfpath).unlink(missing_ok=True)

    if r.returncode != 0:
        sys.stderr.write(r.stdout)
        sys.stderr.write(r.stderr)
        print(f"✗ {tag}: ollama create exited {r.returncode}")
        return False

    print(f"✓ {tag}: rebuilt")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", default="", help="Comma-separated aliases/names to limit to")
    ap.add_argument("--dry-run", action="store_true", help="Print plans; don't write")
    args = ap.parse_args()

    only = [s.strip() for s in args.only.split(",") if s.strip()]
    targets = load_targets(only)
    if not targets:
        print("Nothing to do — no matching entries with `modelfile:` blocks.")
        return 0

    print(f"Found {len(targets)} entries with modelfile blocks:")
    for tag, _ in targets:
        print(f"  - {tag}")
    print()

    failed = 0
    for tag, body in targets:
        if not rebuild(tag, body, dry_run=args.dry_run):
            failed += 1

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
