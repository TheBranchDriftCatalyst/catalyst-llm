#!/usr/bin/env python3
"""Splice mac-node model entries into k8s/base/litellm/config.yaml.

Source of truth: packages/mac-node/models.yaml
Target: k8s/base/litellm/config.yaml (between anchor markers).

The target file is read, the block between
    # >>> mac-node:auto-generated:start <<<
    # >>> mac-node:auto-generated:end <<<
is replaced with freshly generated entries, and the file is written back.
Idempotent: re-running with unchanged inputs produces a byte-identical file.

Override the target with the LITELLM_CLUSTER_CONFIG env var.
"""
import os
import re
import sys
from pathlib import Path

import yaml

START = "# >>> mac-node:auto-generated:start <<<"
END = "# >>> mac-node:auto-generated:end <<<"
INDENT = "  "  # 2 spaces — entries live inside the `model_list:` array

script_dir = Path(__file__).resolve().parent
repo_dir = script_dir.parent
models_path = repo_dir / "models.yaml"

default_target = repo_dir.parents[1] / "k8s" / "base" / "litellm" / "config.yaml"
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


def build_ollama_entries(cfg: dict) -> list[str]:
    """Render LiteLLM entries for every mac-targeted Ollama model.

    Each model emits one entry under ``mac/<alias>``. If the model has an
    ``extra_aliases: [...]`` field, additional entries are emitted under
    ``mac/<extra>`` pointing at the same backend — used for stable routing
    aliases (e.g. ``mac/gemma4-vision``) that downstreams target without
    coupling to the underlying engine/quant.
    """
    node_ip = cfg["node"]["ip"]
    chip = cfg["node"]["chip"]
    port = cfg["ollama"]["port"]
    out: list[str] = []
    for m in cfg["ollama"]["models"]:
        if "mac" not in m.get("target", ["mac", "runpod"]):
            continue
        litellm_params = {
            "model": f"ollama/{m['name']}",
            "api_base": f"http://{node_ip}:{port}",
        }
        is_embedding = "embedding" in m.get("tags", [])

        # Primary entry.
        entry = {
            "model_name": f"mac/{m['alias']}",
            "litellm_params": dict(litellm_params),
            "model_info": {
                "description": f"{m['description']} - Mac {chip} Metal",
            },
        }
        if is_embedding:
            entry["model_info"]["mode"] = "embedding"
        out.append(render_entry(entry))

        # Extra aliases (e.g. routing aliases like mac/gemma4-vision).
        for extra in m.get("extra_aliases", []) or []:
            alias_entry = {
                "model_name": f"mac/{extra}",
                "litellm_params": dict(litellm_params),
                "model_info": {
                    "description": (
                        f"alias of mac/{m['alias']} ({m['name']}) "
                        f"- Mac {chip} Metal"
                    ),
                },
            }
            if is_embedding:
                alias_entry["model_info"]["mode"] = "embedding"
            out.append(render_entry(alias_entry))
    return out


def build_vllm_entries(cfg: dict) -> list[str]:
    """Render LiteLLM entries for every vLLM-MLX instance.

    Same ``extra_aliases`` pattern as ollama models — additional model_names
    pointing at the same backend, used for stable routing aliases.
    """
    node_ip = cfg["node"]["ip"]
    chip = cfg["node"]["chip"]
    out: list[str] = []
    for inst in cfg["vllm"]["instances"]:
        litellm_params = {
            "model": f"openai/{inst['model'].split('/')[-1]}",
            "api_base": f"http://{node_ip}:{inst['port']}/v1",
            "api_key": "not-needed",
        }
        out.append(render_entry({
            "model_name": f"mac/{inst['label']}",
            "litellm_params": dict(litellm_params),
            "model_info": {
                "description": f"{inst['description']} via vLLM-MLX - Mac {chip} Metal",
            },
        }))
        for extra in inst.get("extra_aliases", []) or []:
            out.append(render_entry({
                "model_name": f"mac/{extra}",
                "litellm_params": dict(litellm_params),
                "model_info": {
                    "description": (
                        f"alias of mac/{inst['label']} "
                        f"({inst['model']}) via vLLM-MLX - Mac {chip} Metal"
                    ),
                },
            }))
    return out


def build_image_gen_entries(cfg: dict) -> list[str]:
    """Render LiteLLM entries for ComfyUI shim pipelines.

    Each pipeline emits one entry under ``mac/<alias>`` with
    ``mode: image_generation`` so LiteLLM routes /v1/images/generations
    requests through. Same ``extra_aliases`` pattern as ollama/vllm.
    """
    image_cfg = cfg.get("image_gen") or {}
    pipelines = image_cfg.get("pipelines") or []
    if not pipelines:
        return []
    node_ip = cfg["node"]["ip"]
    chip = cfg["node"]["chip"]
    shim_port = image_cfg.get("shim_port", 8012)
    out: list[str] = []
    for p in pipelines:
        litellm_params = {
            "model": f"openai/{p['name']}",
            "api_base": f"http://{node_ip}:{shim_port}/v1",
            "api_key": "not-needed",
        }
        out.append(render_entry({
            "model_name": f"mac/{p['alias']}",
            "litellm_params": dict(litellm_params),
            "model_info": {
                "description": f"{p['description']} via ComfyUI shim - Mac {chip} Metal",
                "mode": "image_generation",
            },
        }))
        for extra in p.get("extra_aliases", []) or []:
            out.append(render_entry({
                "model_name": f"mac/{extra}",
                "litellm_params": dict(litellm_params),
                "model_info": {
                    "description": (
                        f"alias of mac/{p['alias']} ({p['name']}) "
                        f"via ComfyUI shim - Mac {chip} Metal"
                    ),
                    "mode": "image_generation",
                },
            }))
    return out


def main() -> int:
    cfg = yaml.safe_load(models_path.read_text())
    ollama = build_ollama_entries(cfg)
    vllm = build_vllm_entries(cfg)
    image_gen = build_image_gen_entries(cfg)

    block_lines = [
        f"{INDENT}{START}",
        f"{INDENT}# DO NOT EDIT — managed by packages/mac-node/scripts/gen-litellm.py",
        f"{INDENT}# Source of truth: packages/mac-node/models.yaml "
        f"({len(ollama)} ollama, {len(vllm)} vllm-mlx, {len(image_gen)} image_gen)",
        f"{INDENT}# Regenerate: cd packages/mac-node && task generate",
        "",
        f"{INDENT}# ─── Ollama (Metal accelerated) ───────────────────────────────────",
        *_interleave_blank(ollama),
        "",
        f"{INDENT}# ─── vLLM-MLX (high throughput, OpenAI-compatible) ────────────────",
        *_interleave_blank(vllm),
    ]
    if image_gen:
        block_lines += [
            "",
            f"{INDENT}# ─── Image generation (ComfyUI shim, OpenAI-compatible) ───────────",
            *_interleave_blank(image_gen),
        ]
    block_lines.append(f"{INDENT}{END}")
    new_block = "\n".join(block_lines)

    if not target.exists():
        sys.exit(f"ERROR: target file not found: {target}")

    text = target.read_text()
    pattern = re.compile(
        r"^[ \t]*#\s*>>> mac-node:auto-generated:start <<<.*?"
        r"^[ \t]*#\s*>>> mac-node:auto-generated:end <<<[ \t]*$",
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
        print(f"  No changes to {target.relative_to(Path.cwd()) if target.is_relative_to(Path.cwd()) else target}")
    else:
        target.write_text(new_text)
        print(
            f"  Spliced {len(ollama) + len(vllm) + len(image_gen)} models "
            f"into {target}"
        )


def _interleave_blank(entries: list[str]) -> list[str]:
    """Yield each entry followed by a blank line, no trailing blank."""
    out: list[str] = []
    for i, e in enumerate(entries):
        out.append(e)
        if i < len(entries) - 1:
            out.append("")
    return out


if __name__ == "__main__":
    sys.exit(main() or 0)
