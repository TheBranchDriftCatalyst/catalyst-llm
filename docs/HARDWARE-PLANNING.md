# Hardware Planning: Mac Studio M5 Ultra 512GB

Research and planning document for migrating local inference to a Mac Studio M5 Ultra with 512GB unified memory.

**Date:** 2026-03-14
**Status:** Planning / Awaiting M5 Ultra Release (est. mid-2026)

## Current Setup

- **Machine:** M1 Max, 64GB unified memory, 32 GPU cores
- **Inference:** Ollama (native Metal), max 2 models loaded, 4 concurrent requests
- **Models in use:** 7B-27B range (dolphin-mistral, dark-champion MoE, gemma3-abliterated, etc.)
- **Stack:** Ollama → LiteLLM proxy → Open WebUI / LobeChat / SillyTavern / OpenClaw
- **Supporting services:** SearXNG, PostgreSQL+pgvector, Poisonarr (Playwright)
- **Cloud fallback:** OpenAI (gpt-4o), Anthropic (claude-opus-4) via LiteLLM

## Target Setup

- **Machine:** Mac Studio M5 Ultra, 512GB unified memory, ~80 GPU cores
- **Expected bandwidth:** ~1,100 GB/s (vs 819 GB/s M3 Ultra, vs 400 GB/s M1 Max)
- **Release:** Mid-2026 (WWDC 2026 timeframe)

### Caveat: 512GB Availability

Apple **pulled the 512GB option** from the M3 Ultra Mac Studio due to memory supply constraints. It's uncertain whether 512GB returns for M5 Ultra. Apple also **skipped M4 Ultra entirely** — jumping M3 Ultra → M5 Ultra. If 512GB isn't available, 256GB still handles everything up to ~130B Q4, which covers 99% of use cases.

## What 512GB Unlocks

### Model Capacity

| Model Class | VRAM (Q4) | Fits? | Est. tok/s (M5 Ultra) |
|-------------|-----------|-------|----------------------|
| 7B-8B (current daily drivers) | ~5GB | Yes — run 5+ simultaneously | 35-50 |
| 13B (mythomax, llava) | ~8GB | Yes | 20-30 |
| 27B (gemma3-abliterated) | ~16GB | Yes | 12-18 |
| 70B (llama3.3, qwen72b) | ~40GB | Yes — new daily driver tier | 10-15 |
| Mixtral 8x22B MoE | ~80GB | Yes | 8-14 |
| dark-champion 8x3B MoE | ~18GB | Yes | 15-25 |
| dolphin-mixtral 8x7B | ~26GB | Yes | 10-16 |
| **405B (llama3.1)** | ~203-243GB | **Yes — with headroom** | 3-6 |
| DeepSeek-V3 671B MoE (Q4) | ~350GB | Borderline | 1-3 |

### Multi-Model Concurrency

Current config: `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_NUM_PARALLEL=4`

With 512GB, after loading a 70B Q4 model (~40GB), there's still ~470GB free. Could realistically:
- Load 1x 70B + 3-4x 7B models simultaneously
- Load 1x 405B Q4 + leave ~260GB for KV cache and services
- Load 2-3x 70B models for A/B comparison

## Whisper Transcription

Whisper.cpp on Apple Silicon is a clear win — no NVIDIA needed.

| Model | Size | Speed (est. M5 Ultra) | Real-time Factor |
|-------|------|-----------------------|-----------------|
| tiny | 39MB | <0.3s per 10s audio | 30x+ faster |
| base | 74MB | ~0.4s per 10s audio | 25x faster |
| small | 244MB | ~0.8s per 10s audio | 12x faster |
| large-v3-turbo (q5_0) | ~1GB | ~1.0s per 10s audio | 10x faster |
| large-v3 | ~3GB | ~2-3s per 10s audio | 3-5x faster |

- Metal GPU + Core ML (ANE) acceleration both supported
- Live mic streaming works with sub-second latency
- Peak memory: under 2GB even for large models
- Can run alongside entire LLM stack with zero contention

## vLLM on Metal (Alternative to Ollama)

Two implementations now exist (as of late 2025):

### vLLM-Metal (Official)
- Under `vllm-project` GitHub org
- Uses MLX backend with Metal GPU acceleration
- Paged attention for efficient KV cache
- OpenAI-compatible API (drop-in for LiteLLM)
- Available via Docker Model Runner

### vLLM-MLX (Community)
- 21-87% faster throughput than llama.cpp across model sizes
- Up to 525 tok/s on small models (Qwen3-0.6B, M4 Max)
- Full OpenAI/Anthropic-compatible API

### When to Switch from Ollama

| Use Case | Recommendation |
|----------|---------------|
| Single user, simple serving | Ollama (simpler, well-optimized) |
| Multi-user batched serving | vLLM-Metal (paged attention, batching) |
| Maximum throughput | vLLM-MLX (fastest benchmarks) |
| Model management & pull UX | Ollama (better CLI/ecosystem) |

## Fine-Tuning Capabilities

### What Works on Apple Silicon (MLX)

| Technique | Max Practical Model Size | Time Estimate |
|-----------|-------------------------|---------------|
| LoRA | Up to 70B (on 512GB) | Minutes to hours |
| QLoRA (4-bit) | Up to 70B (on 256GB) | Similar |
| Full fine-tune | Up to 7B (on 64GB+) | Hours to days |

MLX supports LoRA, DoRA, QLoRA natively via `mlx-lm`. Integrated with Hugging Face hub. Good for rapid iteration and experimentation.

### What Still Needs NVIDIA

| Workload | Why |
|----------|-----|
| Full fine-tune 70B+ | Memory bandwidth bottleneck, no Flash Attention |
| Distributed training | No multi-node support on Apple Silicon |
| Production-scale fine-tuning | CUDA ecosystem (DeepSpeed, Megatron, FSDP) |
| High-throughput serving (100+ users) | H100 has ~4x memory bandwidth |

**Strategy:** Prototype LoRA/QLoRA on Mac Studio → scale to RunPod/EC2 H100 for production fine-tuning. LiteLLM config already has RunPod endpoint templated.

## Cost Analysis

### Mac Studio vs Alternatives

| Option | Upfront | Monthly | Runs 405B Q4? |
|--------|---------|---------|---------------|
| Mac Studio M5 Ultra 512GB (est.) | ~$8,000-10,000 | ~$15 electricity | Yes |
| Mac Studio M5 Ultra 256GB (est.) | ~$6,000-7,000 | ~$15 electricity | No (up to ~130B) |
| Cloud H100 24/7 (single, 80GB) | $0 | $1,500-3,600 | No |
| Cloud 2x H100 24/7 | $0 | $3,000-7,200 | Yes |
| Self-hosted H100 (single) | $25,000-40,000 | ~$50 electricity | No |
| NVIDIA DGX Spark (128GB) | $3,999 | ~$20 electricity | No |

### Break-Even vs Cloud

- Mac Studio ($8K) vs H100 cloud ($2.10/hr): **~4 months** at 24/7 usage
- At 8 hrs/day usage: **~12 months** break-even
- After break-even: zero marginal cost for inference

### Mac Studio Advantages for This Workload

- 512GB unified memory fits models no single NVIDIA GPU can hold (80GB max per H100)
- Silent desktop form factor vs datacenter cooling requirements
- Zero ongoing cost after purchase
- Privacy — everything stays local
- Already running Ollama/Metal stack, zero migration friction

## Migration Plan

### Phase 1: Day-One Setup (Mac Studio M5 Ultra arrives)
1. Install Ollama, transfer model library
2. `docker compose up` — entire catalyst-llm stack runs as-is
3. Update Ollama config: `OLLAMA_MAX_LOADED_MODELS=4-5`, bump `OLLAMA_NUM_PARALLEL`
4. Pull 70B models as new daily drivers (llama3.3:70b, qwen2.5:72b)
5. Install whisper.cpp with Metal + Core ML support
6. Test vLLM-Metal as potential Ollama replacement

### Phase 2: Expand Model Library
1. Pull 405B Q4 model — test feasibility and tok/s
2. Experiment with Mixtral 8x22B and DeepSeek MoE models
3. Set up dedicated embedding model (keep loaded permanently)
4. Configure Open WebUI RAG with larger local embedding model

### Phase 3: Fine-Tuning Experiments
1. Install MLX and mlx-lm
2. LoRA fine-tune 7B-13B models on custom datasets
3. QLoRA experiments on 70B models
4. Evaluate results before committing to NVIDIA for production fine-tuning

### Phase 4: NVIDIA (Future — When Needed)
1. Provision RunPod/EC2 H100 instance for production fine-tuning
2. Use existing LiteLLM RunPod endpoint config
3. Train on cloud, deploy to Mac Studio for inference
4. Consider self-hosted NVIDIA only if fine-tuning becomes a regular workflow

## Ollama Config Changes for 512GB

```bash
# Current (M1 Max 64GB)
OLLAMA_KEEP_ALIVE=10m
OLLAMA_NUM_PARALLEL=4
OLLAMA_MAX_LOADED_MODELS=2

# Proposed (M5 Ultra 512GB)
OLLAMA_KEEP_ALIVE=30m          # Models cheap to keep loaded
OLLAMA_NUM_PARALLEL=8           # More concurrent requests
OLLAMA_MAX_LOADED_MODELS=5      # Multiple models ready to serve
OLLAMA_FLASH_ATTENTION=1        # Enable if supported
```

## Key Risks

1. **512GB may not be offered** — Apple pulled it from M3 Ultra; may not return
2. **M5 Ultra timing** — Expected mid-2026 but Apple hasn't confirmed
3. **vLLM-Metal maturity** — Still relatively new; Ollama is the safer bet initially
4. **405B performance** — 3-6 tok/s may be too slow for interactive use (better for batch/async)
5. **MLX ecosystem** — Growing but still smaller than CUDA for fine-tuning tooling

## Decision Summary

| Question | Answer |
|----------|--------|
| Can I skip NVIDIA for inference? | **Yes** — Mac Studio handles all current + planned models |
| Can I skip NVIDIA for Whisper? | **Yes** — Metal acceleration is excellent for transcription |
| Can I skip NVIDIA for fine-tuning? | **Partially** — LoRA/QLoRA experiments work; production fine-tuning still needs CUDA |
| When do I need NVIDIA? | When fine-tuning becomes a regular production workflow |
| Is the investment worth it? | Breaks even vs cloud in ~4-12 months; zero marginal cost after |
