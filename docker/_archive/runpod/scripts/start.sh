#!/bin/bash
set -e

echo "=== mac-node RunPod starting ==="

# --- RunPod environment export ---
# Persist RUNPOD_* and service env vars so they're available in SSH sessions
printenv | grep -E '^RUNPOD_|^OLLAMA_|^WHISPER_|^PATH=' | \
    awk -F= '{ print "export " $1 "=\"" $2 "\"" }' > /etc/rp_environment
echo 'source /etc/rp_environment' >> /root/.bashrc

# --- SSH setup ---
# RunPod injects PUBLIC_KEY env var for key-based auth
if [[ -n "$PUBLIC_KEY" ]]; then
    echo "$PUBLIC_KEY" >> /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
    echo "SSH: public key installed"
fi
# Start sshd in background (supervisor manages the main services)
service ssh start

# --- Workspace directories ---
mkdir -p /workspace/ollama-models
mkdir -p /workspace/whisper-models
mkdir -p /workspace/comfyui

# --- GPU info ---
echo ""
echo "--- GPU ---"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "No GPU detected"
echo ""

# --- Start services ---
exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
