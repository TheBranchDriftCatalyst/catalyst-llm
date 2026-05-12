#!/bin/bash
# Auto-generated from models.yaml — do not edit manually.
# Regenerate with: python3 scripts/gen-pull-models.py --target mac
# Target: mac
#
# Models: 20 total

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
ollama pull qwen3:8b                                      # Qwen3 8B (general chat) @ Q4_K_M (default) — small, fast, most-stable Ollama tool-caller in its size class (F1 0.933 on Docker's local-tool-use eval; rarely hallucinates calls). Ideal council member when council_size ≥ 2 — sub-second per turn on M5 Max, leaves headroom for parallel members.
ollama pull glm-4.5-air:Q4_K_M                            # GLM-4.5 Air 106B-A12B MoE @ Q4_K_M (~62GB, 12B active) — top open-weight BFCL v3 tier (~76.7%). MoE keeps wall-clock close to a 14B dense at full quality. Agentic-generalist trained — strong tool calling under streaming=off. ChatML.
ollama pull qwen3-coder-opus:Q6_K                         # Qwen3-Coder-Next (~80B base) + Opus-4.6 reasoning distill (samuelcardillo, full SFT) @ Q6_K (~65GB) — Opus-style multi-step planning. Reasoning distills benefit from higher quants (CoT noise compounds). ChatML; temp 0.6.
ollama pull qwen3-coder-opus-uncensored:i1-Q6_K           # Huihui-Qwen3-Coder-Next-Opus-4.6 abliterated (mradermacher i1) @ Q6_K (~65GB) — uncensored sibling of qwen3-coder-opus. Same Opus-distilled reasoning, fewer refusals, imatrix-calibrated. ChatML; temp 0.6.
ollama pull deepseek-r1:32b-qwen-distill-q8_0             # DeepSeek R1 Distill Qwen 32B @ Q8_0 (~34GB) — beats o1-mini on math/code reasoning. ~7-9 tok/s on M5 Max. Q8 over Q4 because CoT amplifies quant noise.
ollama pull gemma4:26b-a4b-it-q8_0                        # Gemma 4 26B-A4B MoE @ Q8_0 (~28GB, multimodal + thinking). Vision routing alias for the playground until qwen3-vl is pulled and verified. MoE → Q8 cost is small.
ollama pull gemma4:e4b                                    # Gemma 4 E4B MoE (multimodal + thinking) — fast vision-capable daily. Kept at Ollama default (Q4_K_M) because speed is the whole point.
ollama pull phi4:14b-q8_0                                 # Phi-4 14B @ Q8_0 (~16GB) — punches above its weight, default daily driver under 14B. Q8 because at this size it costs nothing.
ollama pull nuextract2:latest                             # NuExtract-2.0-8B (Qwen2.5-VL based) — beats GPT-4.1 by +9 F-score on schema extraction. Generalist extractor.
ollama pull nuextract1.5:latest                           # NuExtract 1.5 — template-based JSON fill (### Template / ### Text shape). Kept for legacy prompts.
ollama pull universalner:latest                           # UniversalNER 7B — zero-shot named-entity recognition ("What describes <type> in the text?"). Specialist for ad-hoc NER.
ollama pull qwen3-vl:latest                               # Qwen3-VL 2B (latest) — fast OCR + visual QA, beats InternVL3 on DocVQA / OS-World at this size. Sub-second on M5 Max for screenshot-class tasks.
ollama pull qwen3-vl:30b-a3b-thinking-q8_0                # Qwen3-VL 30B-A3B Thinking @ Q8_0 (~33GB, 3B active) — heavyweight vision reasoning with <think> traces. For charts, multi-step doc analysis, visual planning. MoE keeps it usable on M5 Max.

# ══════════════════════════════════════════════════════════════════════
# Embedding models
# ══════════════════════════════════════════════════════════════════════

echo "--- Embedding models ---"
ollama pull qwen3-embedding:8b                            # Qwen3 Embedding 8B — #1 MTEB multilingual at 70.58, 100+ langs, dims 32-4096. The single embedding model we need.

echo ""
echo "=== All models ==="
ollama list

echo ""
echo "=== Done ==="
