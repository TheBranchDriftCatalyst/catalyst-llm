#!/usr/bin/env bash
# Idempotent k3d cluster bring-up for catalyst-llm dev.
#
#   ./scripts/k3d-up.sh         # create if absent, no-op if exists
#   ./scripts/k3d-up.sh --force # recreate from scratch
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER="catalyst-llm"
CONFIG="$REPO_ROOT/k3d-config.yaml"

if ! command -v k3d >/dev/null 2>&1; then
    echo "error: k3d not installed. Install with: brew install k3d" >&2
    exit 1
fi

if [[ "${1:-}" == "--force" ]]; then
    echo "==> Deleting existing cluster '$CLUSTER' (--force)"
    k3d cluster delete "$CLUSTER" 2>/dev/null || true
fi

if k3d cluster list -o json 2>/dev/null | grep -q "\"name\":\"$CLUSTER\""; then
    echo "==> Cluster '$CLUSTER' already exists; skipping create."
    echo "    (use --force to recreate)"
else
    echo "==> Creating k3d cluster '$CLUSTER' from $CONFIG"
    k3d cluster create --config "$CONFIG"
fi

echo "==> kubectl context:"
kubectl config current-context

echo ""
echo "==> Cluster ready. Next:"
echo "    tilt up                          # bring up catalyst-llm dev stack"
echo "    kubectl get pods -n catalyst-llm # inspect"
