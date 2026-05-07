# RunPod serverless vLLM worker — single Docker image, multiple deployments.
#
# Each RunPod endpoint deploys this image with its own MODEL_NAME / template env
# (see endpoints.yaml for the canonical preset list). RunPod proxies
# /openai/v1/* requests directly to the vLLM HTTP server on port 8000.
#
# Build:
#   docker buildx build --platform linux/amd64 \
#     -t ghcr.io/thebranchdriftcatalyst/runpod-vllm:latest .
#
# Layer cache strategy (top = changes least, bottom = changes most):
#   1. Base image (vllm/vllm-openai)        monthly with vLLM releases
#   2. apt deps (build-essential)           rare
#   3. pip deps (runpod, hf_transfer)       occasional
#   4. Scripts (run-vllm.sh)                frequent

FROM vllm/vllm-openai:latest

ENV DEBIAN_FRONTEND=noninteractive

# C compiler for Triton / torch.compile JIT kernel codegen.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
        "runpod>=1.7.0" \
        "huggingface_hub[hf_transfer]" \
        hf_transfer

COPY scripts/run-vllm.sh /opt/scripts/run-vllm.sh
RUN chmod +x /opt/scripts/run-vllm.sh

# ── Defaults — every value is overridable per RunPod template ────────
# RunPod worker-vllm style env names: MODEL_NAME / MAX_MODEL_LEN / etc.
# (no VLLM_ prefix) so deploy templates stay clean and portable.
ENV \
    # HF cache lives on the persistent network volume
    HF_HOME=/runpod-volume/huggingface-cache \
    HUGGINGFACE_HUB_CACHE=/runpod-volume/huggingface-cache \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    \
    # vLLM listen socket — RunPod proxies /openai/v1/* here
    HOST=0.0.0.0 \
    PORT=8000 \
    \
    # Model — REQUIRED. Set per template (e.g. Qwen/Qwen3.6-35B-A3B).
    MODEL_NAME="" \
    SERVED_MODEL_NAME="" \
    \
    # Engine knobs (worker-vllm conventions)
    DTYPE=bfloat16 \
    QUANTIZATION="" \
    MAX_MODEL_LEN=32768 \
    GPU_MEMORY_UTILIZATION=0.92 \
    TENSOR_PARALLEL_SIZE=1 \
    TRUST_REMOTE_CODE=true \
    ENABLE_PREFIX_CACHING=true \
    LIMIT_MM_PER_PROMPT="" \
    \
    # Tool calling — Hermes parser works for Qwen3+ family
    ENABLE_AUTO_TOOL_CHOICE=false \
    TOOL_CALL_PARSER="" \
    \
    # Speculative decoding (e.g. Qwen3.6 MTP head):
    #   {"method":"mtp","num_speculative_tokens":1}
    SPECULATIVE_CONFIG="" \
    \
    # Raw passthrough for any flag not enumerated above
    VLLM_EXTRA_ARGS="" \
    \
    # Quiet telemetry
    RAY_METRICS_EXPORT_ENABLED=0 \
    TOKENIZERS_PARALLELISM=false

EXPOSE 8000

# vllm/vllm-openai sets ENTRYPOINT to its own server — clear it so our
# script gets to assemble flags from env first.
ENTRYPOINT []
CMD ["/opt/scripts/run-vllm.sh"]
