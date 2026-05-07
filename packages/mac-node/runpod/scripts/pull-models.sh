#!/bin/bash
# Auto-generated from models.yaml — do not edit manually.
# Regenerate with: python3 scripts/gen-pull-models.py --target runpod
# Target: runpod
#
# Models: 63 total

set -e

echo "=== Pulling Ollama Models ==="
echo "Waiting for Ollama to be ready..."
until curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; do
    sleep 2
done
echo "Ollama is up."
echo ""

# ══════════════════════════════════════════════════════════════════════
# Serving: primary mac-node models
# ══════════════════════════════════════════════════════════════════════

echo "--- Serving: primary mac-node models ---"
ollama pull devstral:latest                               # Devstral 24B coding
ollama pull deepseek-r1:32b                               # DeepSeek R1 32B reasoning
ollama pull qwen3:32b                                     # Qwen3 32B general purpose
ollama pull qwen3-coder:latest \
    || ollama pull hf.co/bartowski/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M \
    || echo "WARNING: qwen3-coder:latest not available"
ollama pull mistral-nemo:latest                           # Mistral Nemo 12B
ollama pull dolphin-mistral:7b                            # Uncensored Mistral 7B
ollama pull qwen2.5-coder:7b                              # Qwen 2.5 Coder 7B
ollama pull deepseek-r1:7b                                # DeepSeek R1 reasoning 7B

# ══════════════════════════════════════════════════════════════════════
# Benchmark: catalyst-data test models
# ══════════════════════════════════════════════════════════════════════

echo "--- Benchmark: catalyst-data test models ---"
ollama pull nuextract1.5:latest                           # NuExtract 1.5 structured extraction
ollama pull nuextract2:latest                             # NuExtract 2.0 8B multimodal extraction
ollama pull universalner:latest                           # UniversalNER 7B zero-shot NER
ollama pull gemma3:12b                                    # Gemma3 12B — best ≤12B on LLMStructBench
ollama pull mistral:latest                                # Mistral 7B — best recall in our benchmarks
ollama pull qwen2.5:7b-instruct                           # Qwen 2.5 7B Instruct — best balanced extraction
ollama pull llama3.1:8b                                   # Llama 3.1 8B — best SPO extraction
ollama pull llama3.2:latest                               # Llama 3.2 3B — fastest (116 tok/s)
ollama pull gemma3:4b                                     # Gemma3 4B — smallest high scorer

# ══════════════════════════════════════════════════════════════════════
# Community: bleeding edge + abliterated
# ══════════════════════════════════════════════════════════════════════

echo "--- Community: bleeding edge + abliterated ---"
ollama pull qwen3.6:27b                                   # Qwen 3.6 27B — SWE-bench 77.2%
ollama pull gemma4:26b                                    # Gemma 4 26B-A4B MoE (multimodal + thinking, Q4_K_M)
ollama pull gemma4:26b-mlx-bf16                           # Gemma 4 26B-A4B MoE — MLX-converted BF16 safetensors (text-only: ships without vision projector on Ollama)
ollama pull gemma4:e4b                                    # Gemma 4 E4B MoE (multimodal + thinking)
ollama pull phi4:14b                                      # Phi-4 14B — punches above its weight
ollama pull dolphin3:8b                                   # Dolphin 3 8B uncensored
ollama pull huihui_ai/dolphin3-abliterated:32b            # Dolphin 3 32B — refusal direction removed
ollama pull huihui_ai/qwen2.5-abliterated:32b             # Qwen 2.5 32B abliterated — no guardrails
ollama pull wizardlm-uncensored:13b                       # WizardLM 13B — classic abliterated model
ollama pull hf.co/unsloth/Qwen3.6-27B-GGUF:UD-Q4_K_XL     # Qwen 3.6 27B Unsloth Dynamic quant — <1pt accuracy loss
ollama pull hf.co/unsloth/gemma-4-31B-it-GGUF:Q4_K_M      # Gemma 4 31B full — community quant

# ══════════════════════════════════════════════════════════════════════
# Finance / domain-specific
# ══════════════════════════════════════════════════════════════════════

echo "--- Finance / domain-specific ---"
ollama pull 0xroyce/plutus                                # Llama 3.1 8B fine-tuned for finance

# ══════════════════════════════════════════════════════════════════════
# Legal / Government
# ══════════════════════════════════════════════════════════════════════

echo "--- Legal / Government ---"
ollama pull hf.co/TheBloke/SaulLM-7B-Instruct-GGUF:Q4_K_M # SaulLM 7B — legal domain LLM trained on 30B legal tokens
ollama pull hf.co/Equall/Saul-Instruct-v1-GGUF:Q4_K_M     # Saul Instruct — legal QA, contract analysis, compliance

# ══════════════════════════════════════════════════════════════════════
# Embedding models
# ══════════════════════════════════════════════════════════════════════

echo "--- Embedding models ---"
ollama pull qwen3-embedding:8b                            # #1 MTEB multilingual (70.58), 100+ langs, dims 32-4096
ollama pull qwen3-embedding:4b                            # ~67 MTEB, half the VRAM of 8B
ollama pull jina-embeddings-v4                            # Multimodal (text+images+docs), 30+ langs
ollama pull bge-m3                                        # 568M, dense+sparse+ColBERT, 100+ langs, 8K ctx
ollama pull snowflake-arctic-embed2                       # 568M, multilingual, best retrieval under 500M
ollama pull mxbai-embed-large                             # 335M, 1024 dims, strong MTEB English
ollama pull granite-embedding:278m                        # IBM Granite MoE embedding, low latency
ollama pull nomic-embed-text:latest                       # 137M, 768 dims, 8K ctx — the reliable workhorse
ollama pull snowflake-arctic-embed:335m                   # 335M, best retrieval-specific MTEB under 500M
ollama pull snowflake-arctic-embed:110m                   # 110M, good speed/quality tradeoff
ollama pull all-minilm                                    # 23M, 384 dims — fastest, good for prototyping
ollama pull qwen3-embedding:0.6b                          # ~60 MTEB, tiny but surprisingly capable

# ══════════════════════════════════════════════════════════════════════
# Reranking models
# ══════════════════════════════════════════════════════════════════════

echo "--- Reranking models ---"
ollama pull bge-reranker-v2-m3                            # BAAI multilingual reranker, pairs with bge-m3
ollama pull jina-reranker-v2-base-multilingual            # Jina reranker, 278M, 8K ctx, 30+ langs

# ══════════════════════════════════════════════════════════════════════
# Vision models
# ══════════════════════════════════════════════════════════════════════

echo "--- Vision models ---"
ollama pull llava:13b-v1.6-vicuna-q4_K_M                  # LLaVA 1.6 Vicuna 13B Q4_K_M — strong general vision
ollama pull minicpm-v                                     # MiniCPM-V — OCR + document understanding
ollama pull moondream                                     # 1.8B, tiny but capable vision model

# ══════════════════════════════════════════════════════════════════════
# Utility models
# ══════════════════════════════════════════════════════════════════════

echo "--- Utility models ---"
ollama pull nuextract:latest                              # NuExtract structured extraction (v1.0)

# ══════════════════════════════════════════════════════════════════════
# Heavyweight: 70B+ (RunPod-only)
# ══════════════════════════════════════════════════════════════════════

echo "--- Heavyweight: 70B+ (RunPod-only) ---"
ollama pull llama3.3:70b                                  # Meta's best open model — strong structured output
ollama pull qwen2.5:72b-instruct                          # 72B, elite structured output + extraction
ollama pull deepseek-r1:70b                               # Best open reasoning model at scale
ollama pull mistral-large:latest                          # Mistral's flagship, 123B
ollama pull gemma3:27b                                    # Step up from 12B benchmark tier
ollama pull qwen2.5-coder:32b                             # Strongest open coding model
ollama pull command-r:35b                                 # Cohere's RAG-optimized model

# ══════════════════════════════════════════════════════════════════════
# 200B+ quantized MoE
# ══════════════════════════════════════════════════════════════════════

echo "--- 200B+ quantized MoE ---"
ollama pull qwen3:235b-a22b                               # 235B MoE (22B active), rivals GPT-4o — fits 1x A100 80GB
ollama pull qwen3.5:122b-a10b                             # 122B MoE (10B active), ~25GB Q4

# ══════════════════════════════════════════════════════════════════════
# OBSCENE: multi-GPU required
# ══════════════════════════════════════════════════════════════════════

echo "--- OBSCENE: multi-GPU required ---"
ollama pull llama3.1:405b                                 # Meta's largest — the open-source GPT-4 class (~230GB Q4)
ollama pull deepseek-v3:671b                              # 671B MoE (37B active), frontier-class reasoning (~400GB Q4)
ollama pull qwen2.5:110b                                  # Alibaba's largest dense model (~63GB Q4)
ollama pull command-r-plus:104b                           # Cohere's largest — RAG monster (~60GB Q4)
ollama pull falcon3:180b                                  # TII's flagship (~100GB Q4)

# ══════════════════════════════════════════════════════════════════════
# Custom modelfiles
# ══════════════════════════════════════════════════════════════════════

ollama create embedding-server -f - <<'MODELFILE'
FROM nomic-embed-text:latest
PARAMETER num_ctx 8192
MODELFILE


echo ""
echo "=== All models ==="
ollama list

echo ""
echo "=== Done ==="
echo "Total disk usage:"
du -sh /workspace/ollama-models 2>/dev/null || echo "(could not read model dir)"
