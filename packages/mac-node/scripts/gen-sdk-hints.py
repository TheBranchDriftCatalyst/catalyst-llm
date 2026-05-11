#!/usr/bin/env python3
"""Emit catalyst-llm-sdk/src/client/generated/modelHints.json from models.yaml.

The TypeScript SDK's `inferModelHints()` first consults this generated table
(keyed by Ollama name AND by each LiteLLM alias) and only falls back to the
hand-written regex rules in modelHints.ts for models we don't know about.

That keeps the source of truth in one place — adding a new model to
models.yaml automatically updates the SDK heuristics on the next
`task -d packages/mac-node generate`.

Run:
    python3 scripts/gen-sdk-hints.py

Or via Taskfile:
    task -d packages/mac-node generate
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
MAC_NODE = HERE.parent
REPO_ROOT = MAC_NODE.parent.parent

MODELS_PATH = MAC_NODE / "models.yaml"
SDK_GEN_DIR = REPO_ROOT / "packages" / "catalyst-llm-sdk" / "src" / "client" / "generated"
OUT_PATH = SDK_GEN_DIR / "modelHints.json"


def hints_from_tags(tags: list[str]) -> dict:
    """Mirror of gen-litellm.py's _capabilities_from_tags, with shape suited
    to the SDK's HintRule type (camelCase booleans + isEmbedding shortcut)."""
    out: dict = {
        "supportsReasoning": "reasoning" in tags,
        "supportsVision": "vision" in tags,
        "supportsFunctionCalling": (
            "coding" in tags and "embedding" not in tags
        ),
        "isEmbedding": "embedding" in tags,
    }
    return out


def build_entries(cfg: dict) -> list[dict]:
    """Build the flat list the SDK will load. Each entry is keyed by the
    Ollama tag (`name`) plus all of its LiteLLM aliases (`alias` + every
    `extra_alias`), so the SDK can look up either form without a fuzzy match."""
    out: list[dict] = []
    for m in cfg["ollama"]["models"]:
        # Skip runpod-only models — the SDK only sees what LiteLLM proxies,
        # and the proxy filters those out (see gen-litellm.py).
        if "mac" not in m.get("target", ["mac", "runpod"]):
            continue

        tags = m.get("tags", [])
        hints = hints_from_tags(tags)

        # Heuristic for max_input_tokens: gen-litellm.py probes Ollama at
        # config-generation time and bakes it into LiteLLM's /model/info.
        # Here we DON'T probe — we let the SDK pick up max_input_tokens from
        # LiteLLM's metadata at runtime, and only fall back to whatever
        # static value the regex rules in modelHints.ts supply.
        aliases = [m["alias"]] + (m.get("extra_aliases") or [])
        keys = [m["name"]] + [f"mac/{a}" for a in aliases]

        out.append({
            "name": m["name"],
            "aliases": aliases,
            "tags": tags,
            "category": m.get("category"),
            "keys": keys,  # all forms by which the SDK might reference this
            **hints,
        })
    return out


def main() -> int:
    if not MODELS_PATH.exists():
        print(f"models.yaml not found at {MODELS_PATH}", file=sys.stderr)
        return 1

    with MODELS_PATH.open() as f:
        cfg = yaml.safe_load(f)

    entries = build_entries(cfg)
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z") or time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": "packages/mac-node/models.yaml",
        "models": entries,
    }

    SDK_GEN_DIR.mkdir(parents=True, exist_ok=True)
    out_json = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"

    # Idempotent write — skip if unchanged so file mtime stays stable on
    # no-op runs (useful for Tilt's deps-trigger feedback loop).
    if OUT_PATH.exists() and OUT_PATH.read_text() == out_json:
        print(f"==> {OUT_PATH.relative_to(REPO_ROOT)} unchanged ({len(entries)} models)")
        return 0

    OUT_PATH.write_text(out_json)
    print(f"==> wrote {OUT_PATH.relative_to(REPO_ROOT)} ({len(entries)} models)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
