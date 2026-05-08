#!/bin/bash
# Bootstrap and run ComfyUI from persistent volume.
# First boot: clones repo + installs deps (~5 min).
# Subsequent boots: just starts the server.

set -e

COMFYUI_DIR="${COMFYUI_DIR:-/workspace/comfyui}"

# --- First boot: install ComfyUI ---
if [ ! -f "$COMFYUI_DIR/main.py" ]; then
    echo "=== ComfyUI: first boot, installing... ==="
    git clone https://github.com/comfyanonymous/ComfyUI.git "$COMFYUI_DIR"
    cd "$COMFYUI_DIR"
    pip install --no-cache-dir -r requirements.txt

    # Install ComfyUI Manager (model browser, node installer)
    cd "$COMFYUI_DIR/custom_nodes"
    git clone https://github.com/ltdrdata/ComfyUI-Manager.git
    pip install --no-cache-dir -r ComfyUI-Manager/requirements.txt

    echo "=== ComfyUI: install complete ==="
fi

# --- Create model directories ---
mkdir -p "$COMFYUI_DIR/models/checkpoints"
mkdir -p "$COMFYUI_DIR/models/loras"
mkdir -p "$COMFYUI_DIR/models/vae"
mkdir -p "$COMFYUI_DIR/models/unet"
mkdir -p "$COMFYUI_DIR/models/clip"
mkdir -p "$COMFYUI_DIR/models/clip_vision"
mkdir -p "$COMFYUI_DIR/models/controlnet"

# --- Start ComfyUI ---
cd "$COMFYUI_DIR"
exec python main.py \
    --listen 0.0.0.0 \
    --port 8188 \
    --enable-cors-header
