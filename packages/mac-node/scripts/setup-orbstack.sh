#!/usr/bin/env bash
set -euo pipefail

echo "=== OrbStack + Liqo Setup for Dagster Runner Node ==="

# ─── OrbStack ─────────────────────────────────────────────────────
if ! command -v orbctl &>/dev/null; then
  echo "Installing OrbStack..."
  brew install orbstack
  echo "Open OrbStack.app to complete setup, then re-run this script."
  open -a OrbStack
  exit 0
fi

echo "OrbStack installed: $(orbctl version 2>/dev/null || echo 'unknown')"

# Verify K8s is running
if ! kubectl --context orbstack get nodes &>/dev/null; then
  echo "OrbStack K8s not ready. Open OrbStack.app and enable Kubernetes."
  exit 1
fi

echo "OrbStack K8s nodes:"
kubectl --context orbstack get nodes -o wide

# ─── Node Labels ──────────────────────────────────────────────────
echo ""
echo "Applying node labels for Dagster targeting..."
NODE_NAME=$(kubectl --context orbstack get nodes -o jsonpath='{.items[0].metadata.name}')

kubectl --context orbstack label node "$NODE_NAME" \
  node.kubernetes.io/workload-type=ml-inference \
  node.kubernetes.io/gpu-type=apple-metal \
  topology.kubernetes.io/zone=homelab-mac \
  --overwrite

echo "Labels applied to $NODE_NAME"

# ─── Liqo ─────────────────────────────────────────────────────────
echo ""
echo "=== Liqo Federation Setup ==="

if ! command -v liqoctl &>/dev/null; then
  echo "Installing liqoctl..."
  brew install liqotech/tap/liqoctl
fi

echo "liqoctl version: $(liqoctl version --client 2>/dev/null || echo 'unknown')"

echo ""
echo "Next steps for Liqo federation:"
echo ""
echo "  1. Install Liqo on OrbStack cluster (provider):"
echo "     kubectl config use-context orbstack"
echo "     liqoctl install k3s --cluster-name mac-m3-node"
echo ""
echo "  2. Install Liqo on Talos cluster (consumer) if not already:"
echo "     kubectl config use-context admin@talos-default"
echo "     liqoctl install kubeadm --cluster-name talos-homelab"
echo ""
echo "  3. Generate peering command on Talos:"
echo "     liqoctl generate peer-command"
echo ""
echo "  4. Execute peering on OrbStack:"
echo "     kubectl config use-context orbstack"
echo "     liqoctl peer out-of-band <talos-cluster> --auth-url ..."
echo ""
echo "  5. Verify virtual node appears in Talos:"
echo "     kubectl --context admin@talos-default get nodes"
echo "     # Should show: liqo-mac-m3-node   Ready   virtual-node"
