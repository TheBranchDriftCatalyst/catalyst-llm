#!/bin/bash
# vLLM OpenAI-compatible server launcher for RunPod serverless.
# Reads worker-vllm-style env vars and execs the api_server.
#
# Required:
#   MODEL_NAME                HF model id (e.g. Qwen/Qwen3.6-35B-A3B)
#
# Optional (defaults in Dockerfile):
#   SERVED_MODEL_NAME         Override /v1/models response name
#   HOST / PORT
#   DTYPE                     bfloat16 | float16 | auto
#   QUANTIZATION              fp8 | awq | gptq | bitsandbytes | ...
#   MAX_MODEL_LEN
#   GPU_MEMORY_UTILIZATION    0.0-1.0 (claimed at startup, never released)
#   TENSOR_PARALLEL_SIZE
#   TRUST_REMOTE_CODE         true|false
#   ENABLE_PREFIX_CACHING     true|false
#   ENABLE_AUTO_TOOL_CHOICE   true|false
#   TOOL_CALL_PARSER          hermes | mistral | llama3_json | gemma4 | ...
#   SPECULATIVE_CONFIG        JSON string (e.g. {"method":"mtp","num_speculative_tokens":1})
#   LIMIT_MM_PER_PROMPT       e.g. "image=2,audio=0"
#   VLLM_EXTRA_ARGS           Raw passthrough for unenumerated flags

set -e

if [ -z "$MODEL_NAME" ]; then
    echo "FATAL: MODEL_NAME env var is required" >&2
    exit 1
fi

cmd=(
    python3 -m vllm.entrypoints.openai.api_server
    --model "$MODEL_NAME"
    --host "${HOST:-0.0.0.0}"
    --port "${PORT:-8000}"
    --dtype "${DTYPE:-bfloat16}"
    --max-model-len "${MAX_MODEL_LEN:-32768}"
    --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION:-0.92}"
    --tensor-parallel-size "${TENSOR_PARALLEL_SIZE:-1}"
)

[ -n "$SERVED_MODEL_NAME"    ] && cmd+=( --served-model-name   "$SERVED_MODEL_NAME" )
[ -n "$QUANTIZATION"         ] && cmd+=( --quantization        "$QUANTIZATION" )
[ -n "$TOOL_CALL_PARSER"     ] && cmd+=( --tool-call-parser    "$TOOL_CALL_PARSER" )
[ -n "$SPECULATIVE_CONFIG"   ] && cmd+=( --speculative-config  "$SPECULATIVE_CONFIG" )
[ -n "$LIMIT_MM_PER_PROMPT"  ] && cmd+=( --limit-mm-per-prompt "$LIMIT_MM_PER_PROMPT" )

[ "$ENABLE_AUTO_TOOL_CHOICE" = "true" ] && cmd+=( --enable-auto-tool-choice )
[ "$ENABLE_PREFIX_CACHING"   = "true" ] && cmd+=( --enable-prefix-caching )
[ "$TRUST_REMOTE_CODE"       = "true" ] && cmd+=( --trust-remote-code )

# RunPod handles auth at the proxy layer — disable vLLM's own gate
cmd+=( --api-key "" )

if [ -n "$VLLM_EXTRA_ARGS" ]; then
    # shellcheck disable=SC2206
    cmd+=( $VLLM_EXTRA_ARGS )
fi

echo "vLLM launch: ${cmd[*]}"
exec "${cmd[@]}"
