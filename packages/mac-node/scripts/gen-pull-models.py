#!/usr/bin/env python3
"""Generate pull-models.sh for mac and runpod from models.yaml.

Usage:
    python3 scripts/gen-pull-models.py              # generate both
    python3 scripts/gen-pull-models.py --target mac  # mac only
    python3 scripts/gen-pull-models.py --target runpod
"""
import argparse
import os
from collections import defaultdict

import yaml

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_PATH = os.path.join(REPO_DIR, "models.yaml")

CATEGORY_ORDER = [
    "serving",
    "benchmark",
    "community",
    "finance",
    "legal",
    "embedding",
    "reranker",
    "vision",
    "utility",
    "heavyweight",
    "moe-200b",
    "obscene",
]

CATEGORY_LABELS = {
    "serving": "Serving: primary mac-node models",
    "benchmark": "Benchmark: catalyst-data test models",
    "community": "Community: bleeding edge + abliterated",
    "finance": "Finance / domain-specific",
    "legal": "Legal / Government",
    "embedding": "Embedding models",
    "reranker": "Reranking models",
    "vision": "Vision models",
    "utility": "Utility models",
    "heavyweight": "Heavyweight: 70B+ (RunPod-only)",
    "moe-200b": "200B+ quantized MoE",
    "obscene": "OBSCENE: multi-GPU required",
}


def models_for_target(cfg: dict, target: str) -> list[dict]:
    """Filter models to those that should be installed on the given target."""
    result = []
    for m in cfg["ollama"]["models"]:
        targets = m.get("target", ["mac", "runpod"])
        if target in targets:
            result.append(m)
    return result


def generate_script(cfg: dict, target: str) -> str:
    """Generate a pull-models.sh script for the given target."""
    models = models_for_target(cfg, target)

    # Group by category
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for m in models:
        by_cat[m.get("category", "utility")].append(m)

    lines = [
        "#!/bin/bash",
        "# Auto-generated from models.yaml — do not edit manually.",
        f"# Regenerate with: python3 scripts/gen-pull-models.py --target {target}",
        f"# Target: {target}",
        "#",
        f"# Models: {len(models)} total",
        "",
        'set -e',
        "",
        'echo "=== Pulling Ollama Models ==="',
        'echo "Waiting for Ollama to be ready..."',
        'until curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; do',
        '    sleep 2',
        'done',
        'echo "Ollama is up."',
        'echo ""',
    ]

    for cat in CATEGORY_ORDER:
        cat_models = by_cat.get(cat, [])
        if not cat_models:
            continue

        label = CATEGORY_LABELS.get(cat, cat)
        lines.append("")
        lines.append(f"# {'═' * 70}")
        lines.append(f"# {label}")
        lines.append(f"# {'═' * 70}")
        lines.append("")
        lines.append(f'echo "--- {label} ---"')

        for m in cat_models:
            name = m["name"]
            desc = m["description"]
            fallback = m.get("fallback")

            if fallback:
                lines.append(f'ollama pull {name} \\')
                lines.append(f'    || ollama pull {fallback} \\')
                lines.append(f'    || echo "WARNING: {name} not available"')
            else:
                lines.append(f'ollama pull {name:<45s} # {desc}')

    # Modelfiles
    modelfiles = cfg["ollama"].get("modelfiles", [])
    if modelfiles:
        lines.append("")
        lines.append(f"# {'═' * 70}")
        lines.append("# Custom modelfiles")
        lines.append(f"# {'═' * 70}")
        lines.append("")
        for mf in modelfiles:
            mf_name = mf["name"]
            mf_from = mf["from"]
            lines.append(f'ollama create {mf_name} -f - <<\'MODELFILE\'')
            lines.append(f'FROM {mf_from}')
            for k, v in mf.get("parameters", {}).items():
                lines.append(f'PARAMETER {k} {v}')
            lines.append("MODELFILE")
            lines.append("")

    lines.extend([
        "",
        'echo ""',
        'echo "=== All models ==="',
        'ollama list',
        "",
        'echo ""',
        'echo "=== Done ==="',
    ])

    if target == "runpod":
        lines.append('echo "Total disk usage:"')
        lines.append('du -sh /workspace/ollama-models 2>/dev/null || echo "(could not read model dir)"')

    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description="Generate pull-models.sh from models.yaml")
    parser.add_argument("--target", choices=["mac", "runpod", "both"], default="both")
    args = parser.parse_args()

    with open(MODELS_PATH) as f:
        cfg = yaml.safe_load(f)

    targets = ["mac", "runpod"] if args.target == "both" else [args.target]

    for target in targets:
        if target == "runpod":
            out_path = os.path.join(REPO_DIR, "runpod", "scripts", "pull-models.sh")
        else:
            out_path = os.path.join(REPO_DIR, "scripts", "pull-ollama-models.sh")

        script = generate_script(cfg, target)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w") as f:
            f.write(script)
        os.chmod(out_path, 0o755)

        model_count = len(models_for_target(cfg, target))
        print(f"  Generated {out_path} ({model_count} models)")


if __name__ == "__main__":
    main()
