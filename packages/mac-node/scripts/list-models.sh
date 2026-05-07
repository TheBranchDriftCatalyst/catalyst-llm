#!/usr/bin/env bash
# Reads models.yaml and shows live status of all model endpoints.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_FILE="${REPO_DIR}/models.yaml"

if ! command -v python3 &>/dev/null; then
  echo "python3 required" >&2; exit 1
fi

python3 - "$MODELS_FILE" <<'PYEOF'
import sys, yaml, urllib.request, json

with open(sys.argv[1]) as f:
    cfg = yaml.safe_load(f)

node_ip = cfg["node"]["ip"]
chip = cfg["node"]["chip"]

print(f"Mac Node ({chip}) — {node_ip}")
print("=" * 70)

# Ollama
ollama_port = cfg["ollama"]["port"]
try:
    with urllib.request.urlopen(f"http://localhost:{ollama_port}/api/tags", timeout=3) as r:
        live = {m["name"] for m in json.loads(r.read())["models"]}
    ollama_up = True
except Exception:
    live = set()
    ollama_up = False

print(f"\n  Ollama :{ollama_port}  {'UP' if ollama_up else 'DOWN'}")
print(f"  {'Model':<40} {'Status':<10} {'Tags'}")
print(f"  {'-'*40} {'-'*10} {'-'*20}")
for m in cfg["ollama"]["models"]:
    name = m["name"]
    # Check if model is pulled (match with or without tag)
    found = any(name in l or name.split(":")[0] in l for l in live)
    status = "pulled" if found else "missing"
    tags = ", ".join(m.get("tags", []))
    print(f"  {name:<40} {status:<10} {tags}")

# vLLM
print(f"\n  vLLM-MLX instances")
print(f"  {'Label':<16} {'Port':<6} {'Model':<52} {'Status'}")
print(f"  {'-'*16} {'-'*6} {'-'*52} {'-'*8}")
for inst in cfg["vllm"]["instances"]:
    port = inst["port"]
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/v1/models", timeout=3) as r:
            data = json.loads(r.read())
            served = data["data"][0]["id"] if data["data"] else "?"
            status = "UP"
    except Exception:
        served = inst["model"]
        status = "DOWN"
    print(f"  {inst['label']:<16} {port:<6} {served:<52} {status}")

# OpenAI-compatible endpoint summary
print(f"\n  OpenAI-compatible endpoints:")
for inst in cfg["vllm"]["instances"]:
    print(f"    http://{node_ip}:{inst['port']}/v1  ({inst['label']})")
print(f"    http://{node_ip}:{ollama_port}      (ollama)")
PYEOF
