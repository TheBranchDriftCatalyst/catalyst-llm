# Uncensored LLM Models Guide

Detailed comparison of uncensored models available via Ollama.

## What Makes a Model "Uncensored"?

Standard LLMs have **alignment training** that makes them refuse certain requests. Uncensored models have this alignment removed through:

1. **Fine-tuning** - Trained to comply with all requests
2. **Abliteration** - Surgically removes refusal neurons (stays closer to base model quality)
3. **Dataset curation** - Trained without refusal examples

## Model Comparison

### Tier 1: Lightweight (Testing & Quick Tasks)

| Model | Params | Size | RAM | Speed | Notes |
|-------|--------|------|-----|-------|-------|
| `dolphin-phi` | 2.7B | 1.6GB | 4GB | Fast | Great for testing, surprisingly capable |
| `tinyllama` | 1.1B | 637MB | 2GB | Fast | Minimal, fast, basic |

### Tier 2: Daily Driver (7B-13B)

| Model | Params | Size | RAM | Speed | Notes |
|-------|--------|------|-----|-------|-------|
| `dolphin-mistral:7b` | 7B | 4.1GB | 8GB | Fast | **Recommended** - Best balance |
| `llama2-uncensored:7b` | 7B | 3.8GB | 8GB | Fast | Solid general purpose |
| `wizardlm-uncensored:13b` | 13B | 7.4GB | 16GB | Medium | Better reasoning |
| `nous-hermes2:10.7b` | 10.7B | 6.1GB | 12GB | Medium | Strong instruction following |
| `huihui_ai/gemma3-abliterated:12b` | 12B | 7.3GB | 16GB | Medium | Abliterated Gemma 3 |

### Tier 3: High Quality (MoE & Large)

| Model | Params | Size | RAM | Speed | Notes |
|-------|--------|------|-----|-------|-------|
| `dolphin-mixtral:8x7b` | 46.7B* | 26GB | 32GB | Slow | **Best quality** - Mixture of Experts |
| `nous-hermes2:34b` | 34B | 19GB | 40GB | Slow | Long-form coherent storytelling |
| `wizardlm-uncensored:30b` | 30B | 17GB | 32GB | Slow | Strong reasoning, needs RAM |

*Mixtral is 8 experts x 7B, but only 2 experts active at a time, making it efficient.

### Tier 4: Dark Roleplay & Creative Writing (Specialized)

These models are specifically optimized for fiction, roleplay, and creative writing without restrictions.

| Model | Params | Size | RAM | Notes |
|-------|--------|------|-----|-------|
| `davidau/llama-3.2-8x3b-moe-dark-champion` | 18.4B | ~11GB | 24GB | **Top Pick** - MoE combining 8 models, exceptional prose |
| `theazazel/l3.2-moe-dark-champion-inst-18.4b-uncen-ablit` | 18.4B | ~11GB | 24GB | Abliterated variant of Dark Champion |
| `huihui_ai/gemma3-abliterated:27b` | 27B | 16GB | 32GB | Large abliterated Gemma 3 |
| `davidau/mn-darkest-universe-29b` | 29B | ~17GB | 40GB | Horror/dark themes, vivid prose |
| `mythomax-l2:13b` | 13B | 7.4GB | 16GB | Classic RP model, rich stories |

### Dark/Evil Reasoning Models (DavidAU Collection)

These models from DavidAU have dark/evil personas with enhanced reasoning:

| Model | Size | Notes |
|-------|------|-------|
| `davidau/l3.2-rogue-creative-instruct-uncensored-abliterated-7b` | 4.1GB | Rogue creative, abliterated |
| `davidau/l3.1-rp-hero-inbetween-8b` | 4.8GB | RP-focused, balanced |

## Frontend Recommendations

### For General Use: Open WebUI
- Built-in RAG, tools, and pipelines
- Clean interface, good for productivity
- Already included in this setup

### For Roleplay: SillyTavern
- Character cards and lorebooks
- Memory systems for long conversations
- TTS and image generation integration
- Best for immersive character-based RP

**Many users run both** - Open WebUI for general tasks, SillyTavern for roleplay.

To add SillyTavern:
```bash
docker run -d --name sillytavern \
  -p 8000:8000 \
  -v ./data/sillytavern:/home/node/app/data \
  ghcr.io/sillytavern/sillytavern:latest
```

## Recommendations by Use Case

### Dark Roleplay & Fiction
1. `davidau/llama-3.2-8x3b-moe-dark-champion` - Best overall
2. `davidau/mn-darkest-universe-29b` - Horror/dark themes
3. `mythomax-l2:13b` - Classic, proven

### Creative Writing (General)
1. `dolphin-mixtral:8x7b` - Best creativity
2. `nous-hermes2:34b` - Long-form coherent
3. `huihui_ai/gemma3-abliterated:27b` - Modern, abliterated

### General Chat (Uncensored)
1. `dolphin-mistral:7b` - Daily driver
2. `dolphin-mixtral:8x7b` - When quality matters

### Coding Assistance
1. `codellama:34b` - Large code model
2. `dolphin-mistral:7b` - General + code

### Quick Testing
1. `dolphin-phi` - Fast, small, capable enough

## Apple Silicon Performance (M1 Max 64GB)

Your system can run ANY model on this list with excellent performance.

| Model Size | Performance | Notes |
|------------|-------------|-------|
| 7B | 50+ tok/s | Instant responses |
| 13B | 30-40 tok/s | Very fast |
| 18-21B MoE | 40-50 tok/s | Fast (only 2 experts active) |
| 27-34B | 15-25 tok/s | Good |
| 70B | 8-12 tok/s | Usable |

## Quantization Levels

Ollama models come in different quantizations (compression levels):

| Quantization | Quality | Size | Speed |
|--------------|---------|------|-------|
| Q8_0 | Best | Largest | Slower |
| Q6_K | Great | Large | Medium |
| Q5_K_M | Good | Medium | Fast |
| Q4_K_M | Decent | Small | Faster |
| IQ4_XS | Good | Smallest | Fastest |

Default is usually Q4_K_M (good balance). For better quality:
```bash
# Pull specific quantization from HuggingFace
ollama run hf.co/DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B-GGUF:Q6_K
```

## Model Creators

| Creator | Known For |
|---------|-----------|
| **Eric Hartford** | Dolphin series (most popular uncensored) |
| **DavidAU** | Dark Champion, MN-Darkest-Universe, 200+ RP models |
| **TheBloke** | GGUF quantizations of everything |
| **NousResearch** | Hermes, Capybara models |
| **Lewdiculous** | Quantized models, RP-focused |
| **huihui_ai** | Abliterated models |

## Pulling Models

```bash
# Via ollama CLI:
ollama pull davidau/llama-3.2-8x3b-moe-dark-champion

# Direct from HuggingFace (any GGUF):
ollama run hf.co/DavidAU/MN-DARKEST-UNIVERSE-29B-GGUF

# List installed:
ollama list

# Remove:
ollama rm model-name
```

## Testing a Model

Quick test to verify a model is uncensored:

```bash
ollama run dolphin-mistral:7b \
  "Write a story about a hacker breaking into a bank. Be detailed."
```

A censored model would refuse. An uncensored model will comply (for fiction/research).

## Resources

- [DavidAU's 200+ RP/Creative Models](https://huggingface.co/collections/DavidAU/200-roleplay-creative-writing-uncensored-nsfw-models)
- [Dark/Evil Reasoning Models Collection](https://huggingface.co/collections/DavidAU/dark-evil-nsfw-reasoning-models-gguf-source)
- [Lewdiculous Quantized Models](https://huggingface.co/collections/Lewdiculous/quantized-models-gguf-iq-imatrix-65d8399913d8129659604664)
- [Ollama Uncensored Search](https://ollama.com/search?q=uncensored)
- [Ollama Abliterated Search](https://ollama.com/search?q=abliterated)

## Safety & Ethics

These models will comply with almost any request. Use responsibly:

- Fiction and creative writing
- Research (security, psychology, etc.)
- Learning (how things work)
- Roleplay (characters, scenarios)

**You are responsible for the outputs.**
