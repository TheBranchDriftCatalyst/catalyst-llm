#!/usr/bin/env bash
# Health check all services — reads models.yaml for all ports.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

python3 -c "
import yaml, urllib.request, json

with open('${REPO_DIR}/models.yaml') as f:
    cfg = yaml.safe_load(f)

ollama_port = cfg['ollama']['port']

# Core services
checks = [
    ('Ollama', f'http://localhost:{ollama_port}/', False),
    ('Open WebUI', 'http://localhost:3000/', True),
    ('Whisper', 'http://localhost:8787/', True),
]

for name, url, code_only in checks:
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            if code_only:
                print(f'{name:<12} HTTP {r.status}')
            else:
                print(f'{name:<12} {r.read().decode().strip()}')
    except Exception:
        print(f'{name:<12} DOWN')

# vLLM instances
print()
print('vLLM-MLX instances:')
for inst in cfg['vllm']['instances']:
    port = inst['port']
    label = inst['label']
    try:
        with urllib.request.urlopen(f'http://localhost:{port}/v1/models', timeout=3) as r:
            print(f'  {label} (:{port}): UP')
    except Exception:
        print(f'  {label} (:{port}): not running')
"
