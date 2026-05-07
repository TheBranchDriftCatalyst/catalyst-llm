# RunPod Inference Pod

Single GPU pod running the full mac-node model stack on NVIDIA hardware.
Ollama serves all models via OpenAI-compatible API. Whisper handles transcription.
ComfyUI handles image generation with uncensored checkpoints.

## Architecture

```
RunPod GPU Pod
├── Ollama          :11434   OpenAI-compatible LLM API
├── ComfyUI         :8188    Image generation (API + UI)
├── Whisper API     :8787    OpenAI-compatible transcription
├── SSH             :22      Pod access
└── supervisord              Process manager
    └── /workspace           Persistent volume (models survive restarts)
        ├── ollama-models/
        ├── comfyui/         ComfyUI + checkpoints, LoRAs, VAEs
        └── whisper-models/
```

## Quick Start

### 1. Build and push the image

```bash
# From the mac-node repo root
docker build -t ghcr.io/thebranchdriftcatalyst/mac-node-runpod:latest ./runpod
docker push ghcr.io/thebranchdriftcatalyst/mac-node-runpod:latest
```

### 2. Create the RunPod template

Go to [RunPod Templates](https://www.runpod.io/console/user/templates) and create a new template:

| Setting          | Value                                                       |
|------------------|-------------------------------------------------------------|
| Template Name    | `mac-node-inference`                                        |
| Image Name       | `ghcr.io/thebranchdriftcatalyst/mac-node-runpod:latest`     |
| Container Disk   | `50 GB`                                                     |
| Volume Disk      | `500 GB`                                                    |
| Volume Mount     | `/workspace`                                                |
| Expose Ports     | `11434/http,8188/http,8787/http,22/tcp`                     |

No environment variables needed -- defaults are baked into the image.
Override any at template or pod level (see [Configuration](#configuration)).

### 3. Launch a pod

Create a GPU pod from the template. Select GPU based on your workload:

#### Single GPU

| GPU           | VRAM  | Can run                          | Notes                  |
|---------------|-------|----------------------------------|------------------------|
| 1x H100 80GB  | 80 GB | 70B Q4 + FLUX + Whisper          | Fastest inference      |
| 1x A100 80GB  | 80 GB | 70B Q4 + FLUX + Whisper          | Best price/performance |
| 1x A6000 48GB | 48 GB | 32B Q4 + SDXL + Whisper          | Skip FLUX + heavyweights |

#### Multi-GPU (recommended for full stack)

| GPU Config    | Total VRAM | Can run                                    | Notes                   |
|---------------|------------|--------------------------------------------|-------------------------|
| 2x A100 80GB  | 160 GB     | 70B LLM + FLUX + multiple loaded models    | Sweet spot              |
| 4x A100 80GB  | 320 GB     | 405B LLM, or everything simultaneously     | OBSCENE territory       |
| 8x H100 80GB  | 640 GB     | DeepSeek V3 671B. Flex on your cloud bill  | God mode                |

To select multi-GPU on RunPod: pick an instance type with the GPU count you want (e.g. "2x A100 80GB SXM"). All GPUs appear automatically as `CUDA_VISIBLE_DEVICES=0,1,...` -- no container config changes needed.

#### Multi-GPU behavior per service

| Service    | Multi-GPU behavior | Config needed |
|------------|--------------------|---------------|
| **Ollama** | Auto-detects all GPUs. Splits large models across GPUs via tensor parallelism. | None |
| **ComfyUI** | Single GPU by default. Install `ComfyUI-MultiGPU` to split across GPUs. | See below |
| **Whisper** | Single GPU (~3GB VRAM). Not worth splitting. | None |

**ComfyUI multi-GPU setup** (after first boot):

```bash
cd /workspace/comfyui/custom_nodes
git clone https://github.com/neuratech-ai/ComfyUI-MultiGPU.git
pip install -r ComfyUI-MultiGPU/requirements.txt
supervisorctl restart comfyui
```

Adds GPU selection dropdowns to loader nodes. Assign UNet to GPU 0 and CLIP/VAE to GPU 1 to maximize diffusion VRAM.

### 4. Pull models (first boot only)

Models download to the persistent volume (~450GB total). Only needed once -- they survive pod restarts.

```bash
# SSH into the pod (connection info on RunPod dashboard)
ssh root@<POD_IP> -p <EXTERNAL_PORT> -i ~/.ssh/id_ed25519

# Pull all LLM models
/opt/scripts/pull-models.sh

# Pull image generation models (some need HF_TOKEN)
export HF_TOKEN="hf_your_token_here"   # only if pulling FLUX / SD 3.5
/opt/scripts/pull-image-models.sh

# Or pull individual models
ollama pull qwen3:32b
```

### 5. Connect

```
Ollama API (OpenAI-compatible):  https://<POD_ID>-11434.proxy.runpod.net
ComfyUI (web UI + API):         https://<POD_ID>-8188.proxy.runpod.net
Whisper API:                     https://<POD_ID>-8787.proxy.runpod.net
```

Find your `POD_ID` on the RunPod dashboard under your running pod.

## Configuration

All environment variables have sensible defaults baked into the image. Override at template or pod level as needed.

### Service toggles

| Variable         | Default | Description                     |
|------------------|---------|---------------------------------|
| `ENABLE_OLLAMA`  | `true`  | Enable Ollama LLM server        |
| `ENABLE_WHISPER` | `true`  | Enable Whisper transcription API |
| `ENABLE_COMFYUI` | `true`  | Enable ComfyUI image generation  |

Set to `false` to disable a service (saves VRAM and startup time).

### Ollama tuning

| Variable                     | Default          | Description                       |
|------------------------------|------------------|-----------------------------------|
| `OLLAMA_MAX_LOADED_MODELS`   | `3`              | Max models in VRAM simultaneously |
| `OLLAMA_NUM_PARALLEL`        | `4`              | Concurrent requests per model     |
| `OLLAMA_KEEP_ALIVE`          | `30m`            | Idle model unload timeout         |

### Whisper

| Variable             | Default          | Description              |
|----------------------|------------------|--------------------------|
| `WHISPER_MODEL_SIZE` | `large-v3-turbo` | Whisper model variant    |

### Auto-shutdown (save money)

| Variable       | Default    | Description                                             |
|----------------|------------|---------------------------------------------------------|
| `SUICIDE_TTL`  | _(empty)_  | Shut down pod after this idle period. Empty = disabled   |

Formats: `60m`, `2h`, `1h30m`, `3600` (bare number = seconds).

The watchdog checks real activity -- not health probes:
- **Ollama**: models loaded in VRAM (`ollama ps`)
- **ComfyUI**: items in generation queue
- **Whisper**: recent transcription requests

If no real work for `SUICIDE_TTL`, the pod stops via `runpodctl stop pod`.

## Models

All LLM, embedding, reranker, and vision models are served by Ollama. Includes the mac-node serving stack and all catalyst-data benchmark models.

### LLMs

#### Large (mac-node primary -- vLLM-MLX equivalents)

| Model                | Ollama Tag            | Size   | Use Case             |
|----------------------|-----------------------|--------|----------------------|
| Devstral 24B         | `devstral:latest`     | ~14GB  | Coding               |
| DeepSeek R1 32B      | `deepseek-r1:32b`     | ~20GB  | Reasoning            |
| Qwen3 32B            | `qwen3:32b`           | ~20GB  | General + reasoning  |
| Qwen3 Coder 30B MoE  | `qwen3-coder:latest`  | ~18GB  | Coding (MoE)         |

#### Medium / Small (mac-node secondary)

| Model                | Ollama Tag            | Size  | Use Case             |
|----------------------|-----------------------|-------|----------------------|
| Mistral Nemo 12B     | `mistral-nemo:latest` | ~8GB  | Chat                 |
| Dolphin Mistral 7B   | `dolphin-mistral:7b`  | ~4GB  | Chat (uncensored)    |
| Qwen 2.5 Coder 7B   | `qwen2.5-coder:7b`    | ~4GB  | Coding               |
| DeepSeek R1 7B       | `deepseek-r1:7b`      | ~4GB  | Reasoning            |

#### Benchmark: extraction specialists

Source: `catalyst-data/tests/benchmark_config.py`

| Model                | Ollama Tag            | Size  | Use Case              |
|----------------------|-----------------------|-------|-----------------------|
| NuExtract 1.5        | `nuextract1.5:latest` | ~2GB  | Structured extraction |
| NuExtract 2.0 8B     | `nuextract2:latest`   | ~5GB  | Multimodal extraction |
| UniversalNER 7B      | `universalner:latest` | ~4GB  | Zero-shot NER         |

GLiNER models (encoder-based, ~300M) run in-process via Python, not Ollama.

#### Benchmark: general LLMs (Tier 1 + Tier 2)

| Model                  | Ollama Tag              | Size  | Notes                        |
|------------------------|-------------------------|-------|------------------------------|
| Gemma3 12B             | `gemma3:12b`            | ~8GB  | Best <=12B, ensemble member (Tier 1, LLMStructBench) |
| Mistral 7B             | `mistral:latest`        | ~4GB  | Best recall, ensemble member |
| Qwen 2.5 7B Instruct  | `qwen2.5:7b-instruct`   | ~4GB  | Best balanced                |
| Llama 3.1 8B           | `llama3.1:8b`           | ~5GB  | Best SPO extraction          |
| Llama 3.2 3B           | `llama3.2:latest`       | ~2GB  | Fastest (116 tok/s)          |
| Gemma3 4B              | `gemma3:4b`             | ~3GB  | Smallest high scorer         |

#### RunPod-only: mid-tier (27-35B)

| Model                | Ollama Tag              | Size   | Notes                              |
|----------------------|-------------------------|--------|------------------------------------|
| Gemma3 27B           | `gemma3:27b`            | ~16GB  | Step up from 12B benchmark tier    |
| Qwen 2.5 Coder 32B  | `qwen2.5-coder:32b`     | ~20GB  | Strongest open coding model        |
| Command R 35B        | `command-r:35b`         | ~20GB  | Cohere's RAG-optimized model       |

#### RunPod-only: heavyweights (70B+)

Too large for Apple Silicon.

| Model                | Ollama Tag              | Size   | Notes                                              |
|----------------------|-------------------------|--------|----------------------------------------------------|
| Llama 3.3 70B        | `llama3.3:70b`          | ~40GB  | Meta's best open model, strong structured output   |
| Qwen3 235B MoE       | `qwen3:235b-a22b`       | ~45GB  | 235B total / 22B active, rivals GPT-4o             |
| Qwen 2.5 72B         | `qwen2.5:72b-instruct`  | ~42GB  | Elite extraction + structured output               |
| DeepSeek R1 70B      | `deepseek-r1:70b`       | ~40GB  | Best open reasoning model at scale                 |
| Mistral Large 123B   | `mistral-large:latest`  | ~45GB  | Mistral's flagship, strong multilingual            |

Qwen3 235B MoE fits in ~45GB on a single GPU (only 22B params active).

#### RunPod-only: OBSCENE (multi-GPU required)

| Model                  | Ollama Tag            | Size    | Notes                                         |
|------------------------|-----------------------|---------|-----------------------------------------------|
| Llama 3.1 405B         | `llama3.1:405b`       | ~230GB  | Meta's largest -- open-source GPT-4 class     |
| DeepSeek V3 671B MoE   | `deepseek-v3:671b`    | ~400GB  | 671B total / 37B active, frontier reasoning   |
| Qwen 2.5 110B          | `qwen2.5:110b`        | ~63GB   | Alibaba's largest dense model                 |
| Command R+ 104B        | `command-r-plus:104b` | ~60GB   | Cohere's largest -- RAG monster               |
| Falcon 3 180B          | `falcon3:180b`        | ~100GB  | TII's flagship                                |

These add ~850GB to disk and need 2x+ A100/H100. Ollama handles tensor parallelism automatically.

#### Utility LLMs

| Model                | Ollama Tag            | Size  | Use Case              |
|----------------------|-----------------------|-------|-----------------------|
| NuExtract 1.0        | `nuextract:latest`    | ~4GB  | Structured extraction |

### Embeddings

#### Heavyweight (LLM-scale)

| Model                | Ollama Tag            | Size   | MTEB  | Notes                                              |
|----------------------|-----------------------|--------|-------|----------------------------------------------------|
| Qwen3 Embedding 8B   | `qwen3-embedding:8b`  | ~5GB   | 70.58 | #1 MTEB multilingual, 100+ langs, dims 32-4096    |
| Qwen3 Embedding 4B   | `qwen3-embedding:4b`  | ~2.5GB | ~67   | Half the VRAM, 90% the quality                     |
| Jina Embeddings v4    | `jina-embeddings-v4`  | ~2GB   | --    | Multimodal: text + images + docs, 30+ langs       |

#### Mid-tier (best bang for buck)

| Model                | Ollama Tag               | Size   | Notes                                      |
|----------------------|--------------------------|--------|--------------------------------------------|
| BGE-M3               | `bge-m3`                 | ~1.2GB | Dense + sparse + ColBERT, 100+ langs, 8K ctx |
| Arctic Embed 2       | `snowflake-arctic-embed2`| ~1.2GB | Multilingual, best retrieval under 500M    |
| MxBAI Embed Large    | `mxbai-embed-large`      | ~670MB | 1024 dims, strong English MTEB             |
| Granite Embedding    | `granite-embedding:278m` | ~560MB | IBM MoE architecture, low latency          |

#### Lightweight (fast / baseline)

| Model                  | Ollama Tag                      | Size   | Notes                                     |
|------------------------|---------------------------------|--------|-------------------------------------------|
| Nomic Embed Text       | `nomic-embed-text:latest`       | ~275MB | 768 dims, 8K ctx -- the reliable workhorse |
| Arctic Embed 335M      | `snowflake-arctic-embed:335m`   | ~670MB | Best retrieval-specific MTEB under 500M   |
| Arctic Embed 110M      | `snowflake-arctic-embed:110m`   | ~220MB | Good speed/quality tradeoff               |
| All-MiniLM             | `all-minilm`                    | ~45MB  | 384 dims -- fastest, good for prototyping |
| Qwen3 Embedding 0.6B   | `qwen3-embedding:0.6b`          | ~400MB | Tiny but surprisingly capable (~60 MTEB)  |

### Rerankers

Run as a second pass after embedding retrieval to re-score candidates.

| Model                | Ollama Tag                           | Size   | Notes                           |
|----------------------|--------------------------------------|--------|---------------------------------|
| BGE Reranker v2 M3   | `bge-reranker-v2-m3`                | ~1.2GB | Multilingual, pairs with bge-m3 |
| Jina Reranker v2     | `jina-reranker-v2-base-multilingual` | ~560MB | 278M, 8K ctx, 30+ langs        |

### Vision

| Model                | Ollama Tag        | Size  | Notes                           |
|----------------------|-------------------|-------|---------------------------------|
| LLaVA 13B            | `llava:13b`       | ~8GB  | Strong general vision + Q&A     |
| MiniCPM-V             | `minicpm-v`       | ~5GB  | OCR + document understanding    |
| Moondream             | `moondream`       | ~1GB  | 1.8B, tiny but capable          |

### Whisper (transcription)

| Model              | Served by      | Size  | Notes               |
|--------------------|----------------|-------|---------------------|
| Whisper Large v3   | faster-whisper  | ~3GB  | Auto-downloaded     |

### Sentiment analysis note

The general LLMs in this pod are excellent at sentiment (Llama 3.3: F1 ~0.97, Mistral 7B: 94% accuracy). For high-throughput classification, use smaller models with a system prompt (see [Usage Examples](#usage-examples)).

For domain-specific sentiment (financial, social media), specialized encoder models like FinBERT and Twitter-RoBERTa are available on HuggingFace but require sentence-transformers or a custom serving wrapper -- not native Ollama models.

## Image Generation (ComfyUI)

ComfyUI runs on port `8188` with both a web UI and a REST API.
First boot auto-installs ComfyUI + ComfyUI-Manager into `/workspace/comfyui`.

### FLUX (Black Forest Labs) -- best overall quality

| Model          | Path    | Size   | Notes                            |
|----------------|---------|--------|----------------------------------|
| FLUX.1 Dev     | `unet/` | ~24GB  | Highest quality, ~20 steps       |
| FLUX.1 Schnell | `unet/` | ~24GB  | Fast (~4 steps), Apache licensed |
| CLIP-L         | `clip/` | ~250MB | Shared text encoder              |
| T5-XXL FP16    | `clip/` | ~10GB  | Shared text encoder              |
| FLUX VAE       | `vae/`  | ~335MB | Shared autoencoder               |

### Uncensored: FLUX-based

| Model   | Path    | Size   | Notes                                        |
|---------|---------|--------|----------------------------------------------|
| CHROMA  | `unet/` | ~24GB  | FLUX architecture, fully uncensored, top quality |

### Uncensored: SDXL photorealistic

| Model            | Path           | Size  | Notes                       |
|------------------|----------------|-------|-----------------------------|
| Juggernaut XL v9 | `checkpoints/` | ~7GB  | Best photorealistic, no filters |
| RealVisXL V5     | `checkpoints/` | ~7GB  | Best realistic output       |

### Uncensored: SDXL anime / stylized

| Model            | Path           | Size  | Notes                          |
|------------------|----------------|-------|--------------------------------|
| Pony Diffusion V7 | `checkpoints/` | ~7GB | Largest LoRA ecosystem         |
| Illustrious XL   | `checkpoints/` | ~7GB  | Cleanest anime line work       |

### Other architectures

| Model          | Path           | Size   | Notes                              |
|----------------|----------------|--------|------------------------------------|
| SD 3.5 Large   | `checkpoints/` | ~12GB  | Stability AI's latest, 8B params  |
| HiDream I1     | `checkpoints/` | ~12GB  | Natively uncensored by design     |

### Image utilities (ControlNet, VAE)

| Model               | Path          | Size   | Notes                           |
|----------------------|---------------|--------|---------------------------------|
| ControlNet Canny     | `controlnet/` | ~2.5GB | Edge-guided generation (SDXL)   |
| ControlNet Depth     | `controlnet/` | ~2.5GB | Depth-guided generation (SDXL)  |
| SDXL VAE             | `vae/`        | ~335MB | Shared for all SDXL checkpoints |

Some models (FLUX, SD 3.5) require a HuggingFace token -- set `HF_TOKEN` before running `pull-image-models.sh`. Or download models manually via ComfyUI-Manager in the web UI.

## Usage Examples

### Chat completion (OpenAI-compatible)

```bash
curl https://<POD_ID>-11434.proxy.runpod.net/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3:32b",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### List available models

```bash
curl https://<POD_ID>-11434.proxy.runpod.net/v1/models
```

### Embeddings

```bash
curl https://<POD_ID>-11434.proxy.runpod.net/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-embed-text:latest",
    "input": "The quick brown fox"
  }'
```

### Transcription (Whisper)

```bash
curl https://<POD_ID>-8787.proxy.runpod.net/v1/audio/transcriptions \
  -F file=@recording.wav
```

### Sentiment classification

```bash
curl https://<POD_ID>-11434.proxy.runpod.net/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2:latest",
    "messages": [
      {"role": "system", "content": "Classify sentiment as positive, negative, or neutral. Respond with only the label."},
      {"role": "user", "content": "This product exceeded all my expectations!"}
    ]
  }'
```

### Image generation (ComfyUI API)

```bash
# Queue a prompt (workflow JSON exported from the UI)
curl -X POST https://<POD_ID>-8188.proxy.runpod.net/prompt \
  -H "Content-Type: application/json" \
  -d @my_workflow.json

# Get generated images
curl https://<POD_ID>-8188.proxy.runpod.net/view?filename=ComfyUI_00001_.png
```

Or open `https://<POD_ID>-8188.proxy.runpod.net` in a browser for the full node editor.

### Point LiteLLM at the pod

```yaml
model_list:
  - model_name: runpod/qwen3-32b
    litellm_params:
      model: openai/qwen3:32b
      api_base: https://<POD_ID>-11434.proxy.runpod.net/v1
      api_key: not-needed

  - model_name: runpod/deepseek-r1-32b
    litellm_params:
      model: openai/deepseek-r1:32b
      api_base: https://<POD_ID>-11434.proxy.runpod.net/v1
      api_key: not-needed
```

## Logs and Debugging

```bash
# SSH into the pod, then:

# Service status
supervisorctl status

# Logs
tail -f /var/log/ollama.log
tail -f /var/log/whisper.log
tail -f /var/log/comfyui.log
tail -f /var/log/supervisord.log

# Restart a service
supervisorctl restart ollama
supervisorctl restart whisper
supervisorctl restart comfyui

# GPU utilization
nvidia-smi
watch -n1 nvidia-smi

# Which models are loaded in VRAM
ollama ps

# Disk usage
du -sh /workspace/ollama-models
du -sh /workspace/whisper-models
```

## File Layout

```
runpod/
├── Dockerfile              CUDA 12.4 + Ollama + Whisper + ComfyUI + SSH
├── supervisord.conf        Process manager (ollama, whisper, comfyui)
├── whisper_server.py       OpenAI-compatible /v1/audio/transcriptions
├── scripts/
│   ├── start.sh            Entrypoint (env export, SSH, supervisord)
│   ├── pull-models.sh      LLM model download (Ollama)
│   ├── pull-image-models.sh  Image gen model download (ComfyUI)
│   └── run-comfyui.sh      ComfyUI bootstrap + launcher
└── README.md               This file
```

## Cost Notes

- Models are stored on the persistent volume -- you only download them once
- Stop the pod when not in use; the volume persists and costs ~$0.10/GB/month
- A 500GB volume is ~$50/month even when the pod is stopped
- GPU cost is only while the pod is running
- Start with fewer models and pull more later -- comment out heavyweights in `pull-models.sh` to save disk
- Use `SUICIDE_TTL` to auto-shutdown idle pods (see [Configuration](#configuration))
