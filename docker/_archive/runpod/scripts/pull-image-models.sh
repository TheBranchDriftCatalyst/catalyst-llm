#!/bin/bash
# Download image generation models for ComfyUI.
# Run after pod starts: /opt/scripts/pull-image-models.sh
#
# Disk space needed:
#   FLUX models:     ~35GB total (dev ~24GB, schnell ~24GB, shared components)
#   SDXL models:     ~7GB each checkpoint
#   Uncensored CKPTs: ~7-12GB each
#   LoRAs:           ~100-500MB each
#   Total:           ~80-120GB depending on selection
#
# All models download to /workspace/comfyui/models/

set -e

MODELS_DIR="${COMFYUI_DIR:-/workspace/comfyui}/models"
cd "$MODELS_DIR"

echo "=== Pulling Image Generation Models ==="
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# FLUX — Best overall quality (Black Forest Labs)
# Architecture: 32B parameter DiT, requires CLIP + T5 text encoders
# ═══════════════════════════════════════════════════════════════════════════

echo "--- FLUX models ---"

# FLUX.1 Dev — highest quality, ~20 steps
wget -c -P unet/ \
    "https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors" \
    || echo "WARNING: FLUX.1 Dev requires HF auth — download manually or set HF_TOKEN"

# FLUX.1 Schnell — fast, ~4 steps, Apache licensed
wget -c -P unet/ \
    "https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/flux1-schnell.safetensors" \
    || echo "WARNING: FLUX.1 Schnell requires HF auth — download manually or set HF_TOKEN"

# FLUX shared components (CLIP-L + T5-XXL text encoders, VAE)
mkdir -p clip/
wget -c -P clip/ \
    "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
wget -c -P clip/ \
    "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors"
wget -c -P vae/ \
    "https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors" \
    || echo "WARNING: FLUX VAE requires HF auth"

# ═══════════════════════════════════════════════════════════════════════════
# Uncensored checkpoints — no safety filters, no restrictions
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "--- Uncensored: FLUX-based ---"

# CHROMA — FLUX-based, fully uncensored, next-gen quality
wget -c -P unet/ \
    "https://huggingface.co/lodestone-horizon/chroma/resolve/main/chroma-unlocked-v35.safetensors" \
    || echo "NOTE: Check HF for latest CHROMA version"

echo ""
echo "--- Uncensored: SDXL-based (photorealistic) ---"

# Juggernaut XL v9 — best photorealistic, uncensored
wget -c -P checkpoints/ \
    "https://civitai.com/api/download/models/782002" \
    -O checkpoints/juggernautXL_v9.safetensors \
    || echo "NOTE: Download Juggernaut XL from civitai.com/models/133005"

# RealVisXL V5 — best realistic output
wget -c -P checkpoints/ \
    "https://civitai.com/api/download/models/789646" \
    -O checkpoints/realvisxl_v5.safetensors \
    || echo "NOTE: Download RealVisXL V5 from civitai.com/models/139562"

echo ""
echo "--- Uncensored: SDXL-based (anime / stylized) ---"

# Pony Diffusion V7 — largest LoRA ecosystem, anime/stylized
wget -c -P checkpoints/ \
    "https://civitai.com/api/download/models/821538" \
    -O checkpoints/ponyDiffusionV7.safetensors \
    || echo "NOTE: Download Pony V7 from civitai.com/models/257749"

# Illustrious XL — cleanest anime line work
wget -c -P checkpoints/ \
    "https://civitai.com/api/download/models/795765" \
    -O checkpoints/illustriousXL.safetensors \
    || echo "NOTE: Download Illustrious XL from civitai.com/models/795765"

# ═══════════════════════════════════════════════════════════════════════════
# Stable Diffusion 3.5 — Stability AI's latest
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "--- Stable Diffusion 3.5 ---"

# SD 3.5 Large — 8B params, best official SD model
wget -c -P checkpoints/ \
    "https://huggingface.co/stabilityai/stable-diffusion-3.5-large/resolve/main/sd3.5_large.safetensors" \
    || echo "WARNING: SD 3.5 requires HF auth + license acceptance"

# ═══════════════════════════════════════════════════════════════════════════
# HiDream — natively uncensored, no safety filter by design
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "--- HiDream ---"

# HiDream I1 Full — uncensored by design, strong prompt adherence
wget -c -P checkpoints/ \
    "https://huggingface.co/Vivago/HiDream-I1-Full/resolve/main/hidream_i1_full.safetensors" \
    || echo "NOTE: Check HF for latest HiDream version"

# ═══════════════════════════════════════════════════════════════════════════
# ControlNet + utilities
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "--- ControlNet (SDXL) ---"

# Canny edge detection
wget -c -P controlnet/ \
    "https://huggingface.co/diffusers/controlnet-canny-sdxl-1.0/resolve/main/diffusion_pytorch_model.fp16.safetensors" \
    -O controlnet/controlnet-canny-sdxl.safetensors

# Depth
wget -c -P controlnet/ \
    "https://huggingface.co/diffusers/controlnet-depth-sdxl-1.0/resolve/main/diffusion_pytorch_model.fp16.safetensors" \
    -O controlnet/controlnet-depth-sdxl.safetensors

# ═══════════════════════════════════════════════════════════════════════════
# SDXL VAE (shared)
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "--- SDXL VAE ---"
wget -c -P vae/ \
    "https://huggingface.co/stabilityai/sdxl-vae/resolve/main/sdxl_vae.safetensors"

echo ""
echo "=== Done ==="
echo "Model directory sizes:"
du -sh checkpoints/ unet/ clip/ vae/ controlnet/ loras/ 2>/dev/null
echo ""
echo "Total:"
du -sh "$MODELS_DIR"
