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

Capability enrichment:
  - For each Ollama model we query /api/show on the local daemon to read its
    real `context_length`. Cached in-memory per run so a generate is a
    single round-trip per unique tag. Set OLLAMA_PROBE=0 to skip probing
    (useful when running from a machine that can't reach the mac node).
  - tags from models.yaml drive supports_* flags so /model/info reports
    capabilities to consumers (the playground, langgraph-dev, etc.):
      reasoning  → supports_reasoning: true
      vision     → supports_vision: true
      coding     → supports_function_calling: true (most coders do tools)
      embedding  → mode: embedding
"""
import os
import re
import sys
import json
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

import yaml

START = "# >>> mac-node:auto-generated:start <<<"
END = "# >>> mac-node:auto-generated:end <<<"
INDENT = "  "  # 2 spaces — entries live inside the `model_list:` array

script_dir = Path(__file__).resolve().parent
repo_dir = script_dir.parent
models_path = repo_dir / "models.yaml"

default_target = repo_dir.parents[1] / "k8s" / "base" / "litellm" / "config.yaml"
target = Path(os.environ.get("LITELLM_CLUSTER_CONFIG", default_target))


def _ollama_show(name: str, base: str) -> dict | None:
    """Query Ollama /api/show for a single model. Returns None on failure."""
    try:
        req = Request(
            f"{base}/api/show",
            data=json.dumps({"model": name}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(req, timeout=4) as resp:
            return json.loads(resp.read().decode())
    except (URLError, OSError, json.JSONDecodeError):
        return None


def _ctx_from_show(show: dict | None) -> int | None:
    """Pull context_length out of an /api/show payload, regardless of which
    family-keyed field it hides under (each Ollama family namespaces it)."""
    if not show:
        return None
    info = show.get("model_info") or {}
    # Ollama nests context_length under a family-prefixed key like
    # "qwen3.context_length" or "llama.context_length". Find any of them.
    for k, v in info.items():
        if k.endswith(".context_length") and isinstance(v, int):
            return v
    direct = info.get("context_length")
    return direct if isinstance(direct, int) else None


_HF_CARD_CACHE: dict[str, dict | None] = {}
_HF_RESOLVE_CACHE: dict[str, str | None] = {}


def _hf_get(url: str) -> dict | list | None:
    """Anonymous GET against the HF API. Returns None on failure."""
    try:
        req = Request(url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode())
    except (URLError, OSError, json.JSONDecodeError):
        return None


def _ollama_to_hf_query(name: str) -> str:
    """Turn an Ollama model name into an HF search query.

    Examples:
      ``qwen3:32b``        -> ``qwen3 32b``
      ``deepseek-r1:7b``   -> ``deepseek r1 7b``
      ``llama3.2:latest``  -> ``llama 3.2``
      ``hf.co/foo/bar:Q4`` -> ``foo/bar`` (already an HF ref)
    """
    # Already an HF reference inside Ollama (`hf.co/<org>/<repo>:<quant>`).
    if name.startswith("hf.co/"):
        rest = name[len("hf.co/") :]
        return rest.split(":")[0]
    base = name.split(":")[0]
    tag = name.split(":")[1] if ":" in name else ""
    # Drop "latest" — adds noise to search.
    if tag == "latest":
        tag = ""
    # Replace separators with spaces and add the size tag if any.
    cleaned = base.replace("-", " ").replace("_", " ").replace(".", " ")
    return f"{cleaned} {tag}".strip()


def _hf_resolve(ollama_name: str) -> str | None:
    """Heuristically map an Ollama model name to a Hugging Face repo.

    Strategy: hit HF's model search with a query derived from the Ollama
    name and pick the top result. Cached per-process to keep one round-trip
    per unique upstream model. Set HF_PROBE=0 to disable network entirely.
    """
    if os.environ.get("HF_PROBE", "1") == "0":
        return None
    if ollama_name in _HF_RESOLVE_CACHE:
        return _HF_RESOLVE_CACHE[ollama_name]
    query = _ollama_to_hf_query(ollama_name)
    url = (
        "https://huggingface.co/api/models"
        f"?search={query.replace(' ', '+')}&limit=5&sort=downloads"
    )
    data = _hf_get(url)
    repo = None
    if isinstance(data, list) and data:
        # Prefer the highest-downloaded GGUF-free repo (we want the
        # canonical model card, not someone's quant fork).
        for item in data:
            modelId = item.get("modelId") or item.get("id") or ""
            if not modelId:
                continue
            if "GGUF" in modelId.upper():
                continue
            repo = modelId
            break
        if not repo:
            repo = (data[0].get("modelId") or data[0].get("id"))
    _HF_RESOLVE_CACHE[ollama_name] = repo
    return repo


def _hf_card(ollama_name: str) -> tuple[str | None, dict | None]:
    """Fetch the canonical HF model card for an Ollama model. Returns
    (resolved_repo, card_payload). Either may be None on failure."""
    repo = _hf_resolve(ollama_name)
    if not repo:
        return (None, None)
    if repo in _HF_CARD_CACHE:
        return (repo, _HF_CARD_CACHE[repo])
    card = _hf_get(f"https://huggingface.co/api/models/{repo}")
    payload = card if isinstance(card, dict) else None
    _HF_CARD_CACHE[repo] = payload
    return (repo, payload)


def _hf_supplement(card: dict | None) -> dict:
    """Extract LiteLLM-relevant fields from an HF model card payload.

    We're conservative — only return values where HF's data is reliably
    structured. License is the highest-signal field (compliance!), the
    rest is informational (param count, pipeline tag for routing hints).
    """
    if not card:
        return {}
    out: dict = {}
    card_data = card.get("cardData") or {}
    license_ = card_data.get("license") or card.get("license")
    if license_:
        out["license"] = license_
    pipeline_tag = card.get("pipeline_tag")
    if pipeline_tag:
        out["pipeline_tag"] = pipeline_tag
    # Most HF cards encode capability as tags/labels — surface the curated
    # ones directly so the SDK can show vision/multilingual/etc badges.
    tags = card.get("tags") or []
    if isinstance(tags, list):
        for t in tags:
            t = str(t).lower()
            if t in {"multilingual"}:
                out.setdefault("hf_tags", []).append(t)
            if t == "vision-language" or t == "image-text-to-text":
                out["supports_vision"] = True
    # HF safetensors block has parameter counts when the repo uses safetensors.
    safe = card.get("safetensors") or {}
    total = safe.get("total")
    if isinstance(total, int):
        out["param_count"] = total
    return out


def _capabilities_from_tags(tags: list[str]) -> dict:
    """Map models.yaml tags onto LiteLLM model_info capability fields."""
    out: dict = {}
    if "reasoning" in tags:
        out["supports_reasoning"] = True
    if "vision" in tags:
        out["supports_vision"] = True
    # Coding models are usually fine-tuned for tool-use too. Conservative:
    # only flag for models tagged `coding` AND not `embedding`.
    if "coding" in tags and "embedding" not in tags:
        out["supports_function_calling"] = True
    return out


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
    # Probe Ollama for real context windows. Set OLLAMA_PROBE=0 when running
    # this script from a host that can't reach the mac node (CI etc.).
    probe = os.environ.get("OLLAMA_PROBE", "1") != "0"
    probe_base = os.environ.get(
        "OLLAMA_PROBE_BASE", f"http://{node_ip}:{port}"
    )

    hf_probe = os.environ.get("HF_PROBE", "1") != "0"

    out: list[str] = []
    probed = 0
    hf_resolved = 0
    for m in cfg["ollama"]["models"]:
        if "mac" not in m.get("target", ["mac", "runpod"]):
            continue
        litellm_params = {
            "model": f"ollama/{m['name']}",
            "api_base": f"http://{node_ip}:{port}",
        }
        tags = m.get("tags", [])
        is_embedding = "embedding" in tags

        # Capability flags from yaml + context window from a live probe.
        caps = _capabilities_from_tags(tags)
        ctx_len: int | None = None
        if probe and not is_embedding:
            ctx_len = _ctx_from_show(_ollama_show(m["name"], probe_base))
            if ctx_len:
                probed += 1

        # HF model-card supplement (license / pipeline_tag / extra capability
        # flags). We resolve the canonical HF repo by searching with a query
        # derived from the Ollama name; cached per-run.
        hf_data: dict = {}
        hf_repo: str | None = None
        if hf_probe and not is_embedding:
            hf_repo, card = _hf_card(m["name"])
            if hf_repo:
                hf_resolved += 1
                hf_data = _hf_supplement(card)

        info: dict = {
            "description": f"{m['description']} - Mac {chip} Metal",
            **caps,
            **hf_data,  # may add license, pipeline_tag, supports_vision, etc.
        }
        if hf_repo:
            info["hf_repo"] = hf_repo
        if ctx_len:
            info["max_input_tokens"] = ctx_len
            info["max_tokens"] = ctx_len
        if is_embedding:
            info["mode"] = "embedding"

        # Primary entry.
        out.append(render_entry({
            "model_name": f"mac/{m['alias']}",
            "litellm_params": dict(litellm_params),
            "model_info": info,
        }))

        # Extra aliases (e.g. routing aliases like mac/gemma4-vision).
        for extra in m.get("extra_aliases", []) or []:
            alias_info = {
                "description": (
                    f"alias of mac/{m['alias']} ({m['name']}) "
                    f"- Mac {chip} Metal"
                ),
                **caps,
            }
            if ctx_len:
                alias_info["max_input_tokens"] = ctx_len
                alias_info["max_tokens"] = ctx_len
            if is_embedding:
                alias_info["mode"] = "embedding"
            out.append(render_entry({
                "model_name": f"mac/{extra}",
                "litellm_params": dict(litellm_params),
                "model_info": alias_info,
            }))

    if probe:
        print(f"  Probed Ollama for context_length on {probed} models")
    if hf_probe:
        print(f"  Resolved {hf_resolved} models to Hugging Face")
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
