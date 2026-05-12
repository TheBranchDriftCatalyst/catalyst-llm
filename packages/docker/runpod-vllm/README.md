# runpod-vllm

Single Docker image, multiple RunPod serverless deployments.

`vllm/vllm-openai` base + thin env-driven launcher. Each RunPod endpoint
runs the same image with a different `MODEL_NAME` and tuned engine flags.
RunPod proxies `/openai/v1/*` directly to the vLLM HTTP server on port
8000 — no custom handler, no RunPod SDK marshalling.

## Layout

```
packages/docker/runpod-vllm/
├── Dockerfile               vllm/vllm-openai base + runpod SDK + hf_transfer
├── scripts/
│   ├── run-vllm.sh          env → vllm.entrypoints.openai.api_server flags
│   └── gen-litellm.py       endpoints.yaml → k8s/base/litellm/config.yaml splice
├── endpoints.yaml           SOURCE OF TRUTH — defines every deployment
├── Taskfile.yaml            build / push / release / generate
├── cliff.toml               git-cliff config (tag pattern: runpod-vllm-v*)
├── VERSION                  current image version
├── CHANGELOG.md             auto-generated from conventional commits
└── README.md                this file
```

## Endpoints

Defined in `endpoints.yaml`. Currently:

| Alias | HF model | Quant | Tool parser | Spec decode | GPU |
|---|---|---|---|---|---|
| `qwen3.6-35b-a3b` | `Qwen/Qwen3.6-35B-A3B` | FP8 | hermes | MTP (1 token) | 1× A100/H100 80GB |
| `qwen3.6-27b` | `Qwen/Qwen3.6-27B` | FP8 | hermes | MTP (1 token) | 1× A6000 48GB or A100 80GB |

Add a third endpoint by appending to `endpoints:` in `endpoints.yaml`,
then `task generate` to refresh the LiteLLM config.

## Workflow

### 1. Build & push

```bash
# One-off build
task build

# Build + push to GHCR with registry-side cache
task push

# Cut a versioned release (semver bump, tag, changelog)
task release -- patch     # or minor / major
git push --follow-tags    # triggers CI build via .github/workflows/runpod-vllm.yml
```

### 2. Create a RunPod endpoint

For each entry in `endpoints.yaml`:

1. Console → Serverless → Endpoints → New Endpoint
2. **Container Image**: `ghcr.io/thebranchdriftcatalyst/runpod-vllm:latest`
3. **GPU**: per the `gpu_recommendation` in the YAML
4. **Container Disk**: 50 GB
5. **Network Volume**: 500 GB at `/runpod-volume` (so HF cache survives between cold starts)
6. **Container Start Command**: leave default (uses Dockerfile `CMD`)
7. **Environment Variables**: paste the `env:` block from the endpoint definition.
   For gated models, also set `HF_TOKEN`.
8. Copy the endpoint id (e.g. `fa625vcnpdv1vr`) and paste it into
   `endpoints.yaml` as `runpod_endpoint_id`.
9. `task generate` to splice the new endpoint into the LiteLLM config.

### 3. Use it

The LiteLLM gateway exposes the endpoint as `runpod/<alias>`:

```bash
curl https://litellm.example.com/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_API_KEY" \
  -d '{
    "model": "runpod/qwen3.6-35b-a3b",
    "messages": [{"role": "user", "content": "hi"}],
    "tools": [...]
  }'
```

## Environment variables

`run-vllm.sh` consumes worker-vllm-style names (no `VLLM_` prefix) so
deploy templates stay clean and portable.

| Var | Default | Purpose |
|---|---|---|
| `MODEL_NAME` | — (required) | HF model id |
| `SERVED_MODEL_NAME` | (= MODEL_NAME) | Override `/v1/models` response name |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | Listen socket — RunPod expects 8000 |
| `DTYPE` | `bfloat16` | `bfloat16` / `float16` / `auto` |
| `QUANTIZATION` | (unset) | `fp8` / `awq` / `gptq` / `bitsandbytes` |
| `MAX_MODEL_LEN` | `32768` | Context window |
| `GPU_MEMORY_UTILIZATION` | `0.92` | Claimed at startup, never released |
| `TENSOR_PARALLEL_SIZE` | `1` | # GPUs to shard across |
| `TRUST_REMOTE_CODE` | `true` | Required by some Qwen / DeepSeek configs |
| `ENABLE_PREFIX_CACHING` | `true` | Free win — same-prefix requests reuse KV |
| `ENABLE_AUTO_TOOL_CHOICE` | `false` | Set `true` to enable tool-call routing |
| `TOOL_CALL_PARSER` | (unset) | `hermes` (Qwen3+), `mistral`, `llama3_json`, `gemma4` |
| `SPECULATIVE_CONFIG` | (unset) | JSON, e.g. `{"method":"mtp","num_speculative_tokens":1}` |
| `LIMIT_MM_PER_PROMPT` | (unset) | e.g. `image=2,audio=0` |
| `VLLM_EXTRA_ARGS` | (unset) | Raw passthrough for any unenumerated flag |

## Why this shape

- **Serverless, not persistent pod** → scale to zero, per-second billing.
- **One image, N templates** → rightsize hardware per model without
  duplicating Dockerfiles or rebuilding.
- **`endpoints.yaml` as SoT** → adding/changing a model is a YAML edit
  and a `task generate`; no manual hand-editing of the LiteLLM config.
- **vllm/vllm-openai base** → all CUDA / PyTorch / FlashInfer / Triton
  layers come pre-built; we only add `runpod`, `hf_transfer`, and one
  shell launcher.
- **Worker-vllm env conventions** → portable templates, easy migration
  if you ever swap the base image.

## CI

`.github/workflows/runpod-vllm.yml` builds on tag push `runpod-vllm-v*`,
pushes `:VERSION`, `:VERSION-amd64`, and `:latest` to GHCR with
registry-side cache (`type=registry,mode=max`).

## VRAM math reminder

vLLM **claims `GPU_MEMORY_UTILIZATION × total_vram` at startup and never
releases it.** Sequential vs. concurrent traffic doesn't change the
footprint — only KV-cache fill, which is already pre-allocated. Pick
your GPU so model weights + KV cache + ~10% headroom fits in that
budget.

| Model | BF16 weights | FP8 weights | + KV @ 64k×8 | Total claim @ 0.92 util |
|---|---|---|---|---|
| Qwen3.6-35B-A3B | ~72 GB | ~36 GB | ~6 GB | ~46 GB FP8 → A100/H100 80GB |
| Qwen3.6-27B | ~56 GB | ~28 GB | ~6 GB | ~38 GB FP8 → A6000 48GB tight, A100 80GB easy |
