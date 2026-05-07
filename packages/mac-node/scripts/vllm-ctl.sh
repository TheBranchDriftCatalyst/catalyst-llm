#!/usr/bin/env bash
# Manage vLLM-MLX instances — reads models.yaml for service names.
# Usage: vllm-ctl.sh [start|stop|status]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ACTION="${1:-status}"

services=$(python3 -c "
import yaml
with open('${REPO_DIR}/models.yaml') as f:
    cfg = yaml.safe_load(f)
for inst in cfg['vllm']['instances']:
    print(inst['launchd'])
")

case "$ACTION" in
  start)
    for svc in $services; do
      launchctl start "$svc" 2>/dev/null && echo "Started $svc" || echo "$svc not loaded"
    done
    ;;
  stop)
    for svc in $services; do
      launchctl stop "$svc" 2>/dev/null || true
    done
    echo "All vLLM instances stopped"
    ;;
  status)
    python3 -c "
import yaml, urllib.request, json
with open('${REPO_DIR}/models.yaml') as f:
    cfg = yaml.safe_load(f)
print(f'{\"Port\":<6} {\"Label\":<16} {\"Model\":<52} {\"Status\"}')
print(f'{\"-\"*6} {\"-\"*16} {\"-\"*52} {\"-\"*8}')
for inst in cfg['vllm']['instances']:
    port = inst['port']
    try:
        with urllib.request.urlopen(f'http://localhost:{port}/v1/models', timeout=3) as r:
            data = json.loads(r.read())
            model = data['data'][0]['id'] if data['data'] else '?'
            status = 'UP'
    except Exception:
        model = inst['model']
        status = 'DOWN'
    print(f'{port:<6} {inst[\"label\"]:<16} {model:<52} {status}')
"
    ;;
  services)
    # Just print service names (used by Taskfile)
    echo "$services"
    ;;
esac
