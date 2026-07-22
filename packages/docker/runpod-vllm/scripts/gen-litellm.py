#!/usr/bin/env python3
"""Splice runpod-vllm endpoints into k8s/base/litellm/config.yaml.

Source of truth: packages/docker/runpod-vllm/endpoints.yaml
Target: k8s/base/litellm/config.yaml (between anchor markers).

Mirrors ../mac-sdlc-node/scripts/gen-litellm.py:
  - Reads the source YAML
  - Renders one LiteLLM model_list entry per endpoint
  - Splices the rendered block between
        # >>> runpod-vllm:auto-generated:start <<<
        # >>> runpod-vllm:auto-generated:end <<<
  - Idempotent: re-running with unchanged inputs produces a byte-identical file.

Endpoints with no `runpod_endpoint_id` are emitted as a commented-out
placeholder — the generated config remains valid YAML, and the next
regen after deployment lights them up.

Override the target with the LITELLM_CLUSTER_CONFIG env var.
"""
import os
import re
import sys
from pathlib import Path

import yaml

START = "# >>> runpod-vllm:auto-generated:start <<<"
END = "# >>> runpod-vllm:auto-generated:end <<<"
INDENT = "  "  # 2 spaces — entries live inside the `model_list:` array

script_dir = Path(__file__).resolve().parent
pkg_dir = script_dir.parent
endpoints_path = pkg_dir / "endpoints.yaml"

repo_root = pkg_dir.parents[2]
default_target = repo_root / "k8s" / "base" / "litellm" / "config.yaml"
target = Path(os.environ.get("LITELLM_CLUSTER_CONFIG", default_target))


def render_entry(entry: dict) -> str:
    """Dump a single list entry as YAML, indented to fit inside model_list."""
    raw = yaml.dump(
        [entry],
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=120,
    ).rstrip()
    return "\n".join(INDENT + line if line else line for line in raw.splitlines())


def render_commented(entry: dict, reason: str) -> str:
    """Render an entry as a commented-out block with a TODO header."""
    raw = yaml.dump(
        [entry],
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=120,
    ).rstrip()
    body = "\n".join(f"{INDENT}# {line}" if line else f"{INDENT}#" for line in raw.splitlines())
    header = f"{INDENT}# TODO ({reason}) — uncomment after setting runpod_endpoint_id"
    return f"{header}\n{body}"


def build_endpoint_entry(ep: dict) -> dict:
    """Build the LiteLLM model_list entry for one runpod-vllm endpoint."""
    served = ep.get("served_model_name") or ep["alias"]
    endpoint_id = ep.get("runpod_endpoint_id") or "<ENDPOINT_ID>"
    description = (ep.get("description") or "").strip().replace("\n", " ")
    return {
        "model_name": f"runpod/{ep['alias']}",
        "litellm_params": {
            "model": f"openai/{served}",
            "api_base": f"https://api.runpod.ai/v2/{endpoint_id}/openai/v1",
            "api_key": "os.environ/RUNPOD_API_KEY",
            "timeout": 300,
        },
        "model_info": {
            "description": description or f"runpod-vllm: {ep['hf_model']}",
        },
    }


def build_entries(cfg: dict) -> tuple[list[str], int, int]:
    """Render LiteLLM entries for every endpoint. Returns (lines, deployed, pending)."""
    out: list[str] = []
    deployed = 0
    pending = 0
    for ep in cfg.get("endpoints", []):
        entry = build_endpoint_entry(ep)
        if ep.get("runpod_endpoint_id"):
            out.append(render_entry(entry))
            deployed += 1
        else:
            out.append(render_commented(entry, f"endpoint not yet created: {ep['alias']}"))
            pending += 1
    return out, deployed, pending


def _interleave_blank(entries: list[str]) -> list[str]:
    """Yield each entry followed by a blank line, no trailing blank."""
    out: list[str] = []
    for i, e in enumerate(entries):
        out.append(e)
        if i < len(entries) - 1:
            out.append("")
    return out


def main() -> int:
    cfg = yaml.safe_load(endpoints_path.read_text())
    entries, deployed, pending = build_entries(cfg)

    block_lines = [
        f"{INDENT}{START}",
        f"{INDENT}# DO NOT EDIT — managed by packages/docker/runpod-vllm/scripts/gen-litellm.py",
        f"{INDENT}# Source of truth: packages/docker/runpod-vllm/endpoints.yaml "
        f"({deployed} deployed, {pending} pending)",
        f"{INDENT}# Regenerate: cd packages/docker/runpod-vllm && task generate",
        "",
        *_interleave_blank(entries),
        f"{INDENT}{END}",
    ]
    new_block = "\n".join(block_lines)

    if not target.exists():
        sys.exit(f"ERROR: target file not found: {target}")

    text = target.read_text()
    pattern = re.compile(
        r"^[ \t]*#\s*>>> runpod-vllm:auto-generated:start <<<.*?"
        r"^[ \t]*#\s*>>> runpod-vllm:auto-generated:end <<<[ \t]*$",
        re.MULTILINE | re.DOTALL,
    )
    if not pattern.search(text):
        sys.exit(
            f"ERROR: marker pair not found in {target}.\n"
            f"  Add `{START}` and `{END}` (each on its own line, 2-space indented)\n"
            f"  inside `model_list:` and rerun."
        )

    new_text = pattern.sub(lambda _: new_block, text)
    if new_text == text:
        rel = target.relative_to(Path.cwd()) if target.is_relative_to(Path.cwd()) else target
        print(f"  No changes to {rel}  ({deployed} deployed, {pending} pending)")
    else:
        target.write_text(new_text)
        print(f"  Spliced {deployed + pending} endpoints into {target}")
        print(f"    {deployed} deployed (live), {pending} pending (commented-out)")


if __name__ == "__main__":
    sys.exit(main() or 0)
