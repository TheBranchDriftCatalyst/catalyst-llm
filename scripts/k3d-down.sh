#!/usr/bin/env bash
# Tear down the catalyst-llm dev k3d cluster.
set -euo pipefail

CLUSTER="catalyst-llm"

if ! command -v k3d >/dev/null 2>&1; then
    echo "error: k3d not installed." >&2
    exit 1
fi

if k3d cluster list -o json 2>/dev/null | grep -q "\"name\":\"$CLUSTER\""; then
    echo "==> Deleting k3d cluster '$CLUSTER'"
    k3d cluster delete "$CLUSTER"
else
    echo "==> No cluster '$CLUSTER' to delete."
fi
