#!/bin/bash
# Auto-generated from models.yaml — do not edit manually.
# Regenerate with: python3 scripts/gen-pull-models.py --target mac
# Target: mac
#
# Models: 37 total

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
ollama pull gemma4:27b                                    # Gemma 4 27B multimodal + thinking mode
ollama pull gemma4:e4b                                    # Gemma 4 E4B MoE (multimodal + thinking)
ollama pull phi4:14b                                      # Phi-4 14B — punches above its weight
ollama pull dolphin3:8b                                   # Dolphin 3 8B uncensored
ollama pull wizardlm-uncensored:13b                       # WizardLM 13B — classic abliterated model

# ══════════════════════════════════════════════════════════════════════
# Finance / domain-specific
# ══════════════════════════════════════════════════════════════════════

echo "--- Finance / domain-specific ---"
ollama pull 0xroyce/plutus                                # Llama 3.1 8B fine-tuned for finance

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
# Utility models
# ══════════════════════════════════════════════════════════════════════

echo "--- Utility models ---"
ollama pull nuextract:latest                              # NuExtract structured extraction (v1.0)

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
