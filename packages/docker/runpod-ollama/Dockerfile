# RunPod Single-Pod LLM Inference + Image Generation Stack
# Ollama (OpenAI-compatible API) + Whisper + ComfyUI
#
# GPU recommendation:
#   A100 80GB  — 2-3 large (32B Q4) LLMs + FLUX image gen simultaneously
#   H100 80GB  — same capacity, faster inference
#   A6000 48GB — 1-2 large LLMs, FLUX still fits
#
# RunPod ports (auto-proxied):
#   8188  → ComfyUI (API + UI) https://{POD_ID}-8188.proxy.runpod.net
#   8787  → Whisper API        https://{POD_ID}-8787.proxy.runpod.net
#   11434 → Ollama API         https://{POD_ID}-11434.proxy.runpod.net
#   22    → SSH                ssh root@{POD_IP} -p {EXTERNAL_PORT}
#
# Ollama exposes OpenAI-compatible endpoints:
#   POST /v1/chat/completions
#   POST /v1/completions
#   POST /v1/embeddings
#   GET  /v1/models
#
# Build & push:
#   task push      (from packages/docker/runpod-ollama)
#
# RunPod template settings:
#   Image:            ghcr.io/thebranchdriftcatalyst/runpod-ollama:latest
#   Container disk:   50 GB
#   Volume disk:      500 GB
#   Volume mount:     /workspace
#   Ports:            11434/http,8188/http,8787/http,22/tcp
#   Environment:      (all baked into image, override as needed)
#
# Volume layout (/workspace — persistent across pod restarts):
#   /workspace/ollama-models   Ollama model cache
#   /workspace/whisper-models  Whisper model cache (~3GB)
#   /workspace/comfyui         ComfyUI install + models
#
# Layer cache strategy (top = changes least, bottom = changes most):
#   1. Base image + apt deps        (months between changes)
#   2. PyTorch                       (months — pinned version)
#   3. Ollama binary                 (weeks)
#   4. pip deps (whisper, flask)     (weeks)
#   5. Config files (supervisord)    (occasionally)
#   6. Application scripts           (frequently)

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# ── Layer 1: System deps (rarely changes) ────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget git \
    python3 python3-pip python3-venv python3-dev \
    supervisor \
    openssh-server \
    ffmpeg \
    build-essential \
    libgl1-mesa-glx libglib2.0-0 \
    zstd \
    && rm -rf /var/lib/apt/lists/*

# SSH setup — RunPod injects PUBLIC_KEY env var for key-based auth
RUN mkdir -p /var/run/sshd /root/.ssh && \
    chmod 700 /root/.ssh && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin without-password/' /etc/ssh/sshd_config && \
    ssh-keygen -A

# ── Layer 2: PyTorch (huge, changes rarely — pinned) ─────────────
RUN python3 -m venv /opt/venv
RUN pip install --no-cache-dir \
    torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 \
    --index-url https://download.pytorch.org/whl/cu124

# ── Layer 3: Ollama binary (changes occasionally) ────────────────
RUN curl -fsSL https://ollama.com/install.sh | sh

# ── Layer 4: Python deps (changes occasionally) ──────────────────
RUN pip install --no-cache-dir \
    faster-whisper \
    flask \
    gunicorn

# ── Layer 5: Config files (changes sometimes) ────────────────────
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY whisper_server.py /opt/whisper_server.py

# ── Layer 6: Scripts (changes most often) ─────────────────────────
# Split into separate COPYs so changing pull-models.sh
# doesn't invalidate start.sh cache
COPY scripts/start.sh /opt/scripts/start.sh
COPY scripts/run-comfyui.sh /opt/scripts/run-comfyui.sh
COPY scripts/watchdog.sh /opt/scripts/watchdog.sh
COPY scripts/pull-models.sh /opt/scripts/pull-models.sh
COPY scripts/pull-image-models.sh /opt/scripts/pull-image-models.sh
RUN chmod +x /opt/scripts/*.sh

# ── Runtime config ────────────────────────────────────────────────
ENV OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_MODELS=/workspace/ollama-models \
    OLLAMA_MAX_LOADED_MODELS=3 \
    OLLAMA_NUM_PARALLEL=4 \
    OLLAMA_FLASH_ATTENTION=1 \
    OLLAMA_KEEP_ALIVE=30m \
    WHISPER_MODEL_DIR=/workspace/whisper-models \
    WHISPER_MODEL_SIZE=large-v3-turbo \
    COMFYUI_DIR=/workspace/comfyui \
    # Service toggles (true/false) — disable what you don't need
    ENABLE_OLLAMA=true \
    ENABLE_WHISPER=true \
    ENABLE_COMFYUI=false \
    # Auto-shutdown: stop pod after idle period (empty = disabled)
    # Formats: "60m", "2h", "1h30m", "3600" (bare number = seconds)
    SUICIDE_TTL=""

EXPOSE 22 8188 8787 11434
VOLUME /workspace
CMD ["/opt/scripts/start.sh"]
