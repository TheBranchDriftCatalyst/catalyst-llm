#!/usr/bin/env python3
"""Remove Ollama tags that aren't in models.yaml anymore.

When you bump a model's quant in models.yaml (e.g. ``qwen3-coder:30b`` →
``qwen3-coder:30b-a3b-q8_0``) the new tag gets pulled, but the old one
sits in ``~/.ollama/models`` taking gigabytes. This script diffs
``ollama list`` against the mac-targeted entries in models.yaml and
``ollama rm`` anything that no longer has a manifest entry.

Defaults to dry-run for safety. Pass ``--yes`` (or set ``FORCE=1``) to
actually delete.

Usage
-----
    python3 scripts/cleanup-ollama.py                # dry-run preview
    python3 scripts/cleanup-ollama.py --yes          # actually delete
    python3 scripts/cleanup-ollama.py --keep <tag>   # protect specific tags
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import yaml

REPO_DIR = Path(__file__).resolve().parent.parent
MODELS_PATH = REPO_DIR / "models.yaml"


def _expected_tags() -> set[str]:
    """Set of `name:` values for mac-targeted models in models.yaml,
    plus a few sensible always-keep entries."""
    cfg = yaml.safe_load(MODELS_PATH.read_text())
    out: set[str] = set()
    for m in cfg.get("ollama", {}).get("models", []) or []:
        targets = m.get("target", ["mac", "runpod"])
        if "mac" not in targets:
            continue
        out.add(str(m["name"]))
    return out


def _ollama_list() -> list[tuple[str, str]]:
    """Return [(tag, size_str), ...] from `ollama list`."""
    proc = subprocess.run(
        ["ollama", "list"], check=False, capture_output=True, text=True
    )
    if proc.returncode != 0:
        print(f"ollama list failed: {proc.stderr}", file=sys.stderr)
        sys.exit(1)
    out: list[tuple[str, str]] = []
    lines = proc.stdout.strip().splitlines()
    for line in lines[1:]:  # skip header
        cols = line.split()
        if len(cols) >= 4:
            tag = cols[0]
            # SIZE is two tokens (e.g. "32 GB"); ID and MODIFIED bracket it
            size = f"{cols[2]} {cols[3]}"
            out.append((tag, size))
    return out


def _normalize(tag: str) -> str:
    """Ollama treats ``foo`` and ``foo:latest`` as equivalent. Match them
    consistently when comparing against models.yaml."""
    return tag if ":" in tag else f"{tag}:latest"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "--yes",
        action="store_true",
        help="Actually delete (default: dry-run preview).",
    )
    p.add_argument(
        "--keep",
        action="append",
        default=[],
        help="Tag to protect even if it isn't in models.yaml. Repeatable.",
    )
    args = p.parse_args()

    apply = args.yes or os.environ.get("FORCE") == "1"
    expected = {_normalize(t) for t in _expected_tags()}
    keep = {_normalize(t) for t in args.keep}

    installed = _ollama_list()
    if not installed:
        print("No models installed.")
        return 0

    to_keep: list[tuple[str, str]] = []
    to_remove: list[tuple[str, str]] = []
    for tag, size in installed:
        if _normalize(tag) in expected or _normalize(tag) in keep:
            to_keep.append((tag, size))
        else:
            to_remove.append((tag, size))

    print(f"models.yaml expects {len(expected)} mac-targeted tags.")
    print(f"ollama has installed {len(installed)} tags.\n")

    if to_keep:
        print(f"KEEP ({len(to_keep)}):")
        for tag, size in to_keep:
            print(f"  ✓ {tag:55s} {size}")
        print()

    if not to_remove:
        print("Nothing to remove — every installed tag is in models.yaml.")
        return 0

    print(f"REMOVE ({len(to_remove)}):")
    for tag, size in to_remove:
        print(f"  ✗ {tag:55s} {size}")
    print()

    if not apply:
        print("Dry-run. Re-run with --yes (or FORCE=1) to actually delete.")
        return 0

    failures: list[str] = []
    for tag, _size in to_remove:
        proc = subprocess.run(
            ["ollama", "rm", tag], check=False, capture_output=True, text=True
        )
        if proc.returncode == 0:
            print(f"  removed {tag}")
        else:
            failures.append(tag)
            print(f"  FAILED  {tag}: {proc.stderr.strip()}")

    if failures:
        print(f"\n{len(failures)} removal(s) failed.")
        return 1
    print(f"\n✓ Removed {len(to_remove)} tag(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
