#!/bin/bash
# Auto-generated from models.yaml — do not edit manually.
# Regenerate with: python3 scripts/gen-pull-models.py --target runpod
# Target: runpod
#
# Models: 24 total

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
ollama pull qwen3-coder:30b-a3b-q8_0                      # Qwen3-Coder 30B-A3B MoE @ Q8_0 (~33GB) — 256K ctx, ~Sonnet 4.5-class agentic coding, BFCL v3 top tier. Q8 over Q4 because MoE active path is small and we have the memory.
ollama pull deepseek-r1:32b-qwen-distill-q8_0             # DeepSeek R1 Distill Qwen 32B @ Q8_0 (~34GB) — beats o1-mini on math/code reasoning. ~7-9 tok/s on M5 Max. Q8 over Q4 because CoT amplifies quant noise.
ollama pull gemma4:26b-a4b-it-q8_0                        # Gemma 4 26B-A4B MoE @ Q8_0 (~28GB, multimodal + thinking). Vision routing alias for the playground until qwen3-vl is pulled and verified. MoE → Q8 cost is small.
ollama pull gemma4:e4b                                    # Gemma 4 E4B MoE (multimodal + thinking) — fast vision-capable daily. Kept at Ollama default (Q4_K_M) because speed is the whole point.
ollama pull phi4:14b-q8_0                                 # Phi-4 14B @ Q8_0 (~16GB) — punches above its weight, default daily driver under 14B. Q8 because at this size it costs nothing.
ollama pull nuextract2:latest                             # NuExtract-2.0-8B (Qwen2.5-VL based) — beats GPT-4.1 by +9 F-score on schema extraction. Generalist extractor.
ollama pull nuextract1.5:latest                           # NuExtract 1.5 — template-based JSON fill (### Template / ### Text shape). Kept for legacy prompts.
ollama pull universalner:latest                           # UniversalNER 7B — zero-shot named-entity recognition ("What describes <type> in the text?"). Specialist for ad-hoc NER.
ollama pull qwen3-vl:latest                               # Qwen3-VL 2B (latest) — fast OCR + visual QA, beats InternVL3 on DocVQA / OS-World at this size. Sub-second on M5 Max for screenshot-class tasks.

# ══════════════════════════════════════════════════════════════════════
# Embedding models
# ══════════════════════════════════════════════════════════════════════

echo "--- Embedding models ---"
ollama pull qwen3-embedding:8b                            # Qwen3 Embedding 8B — #1 MTEB multilingual at 70.58, 100+ langs, dims 32-4096. The single embedding model we need.

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

echo ""
echo "=== All models ==="
ollama list

echo ""
echo "=== Done ==="
echo "Total disk usage:"
du -sh /workspace/ollama-models 2>/dev/null || echo "(could not read model dir)"
