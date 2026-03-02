#!/bin/bash
# Pull recommended uncensored models
# Usage: ./scripts/pull-models.sh [tier]
#   tier: small, medium, large, creative, darkrp, all (default: small)

set -e

TIER="${1:-small}"

echo "Catalyst LLM - Model Puller"
echo "==============================="
echo "Tier: $TIER"
echo ""

pull_model() {
    local model="$1"
    echo "Pulling $model..."
    ollama pull "$model"
    echo "$model ready"
    echo ""
}

# Define model sets (keep in sync with MODELS.md and Tiltfile)
MODELS_SMALL=(
    "dolphin-phi"
)

MODELS_MEDIUM=(
    "dolphin-phi"
    "dolphin-mistral:7b"
    "llama2-uncensored:7b"
)

MODELS_LARGE=(
    "dolphin-phi"
    "dolphin-mistral:7b"
    "wizardlm-uncensored:13b"
    "dolphin-mixtral:8x7b"
)

MODELS_CREATIVE=(
    "davidau/llama-3.2-8x3b-moe-dark-champion"
    "dolphin-mixtral:8x7b"
    "huihui_ai/gemma3-abliterated:27b"
    "nous-hermes2:34b"
    "dolphin-mistral:7b"
    "wizardlm-uncensored:13b"
)

MODELS_DARKRP=(
    "davidau/llama-3.2-8x3b-moe-dark-champion"
    "theazazel/l3.2-moe-dark-champion-inst-18.4b-uncen-ablit"
    "huihui_ai/gemma3-abliterated:27b"
    "mythomax-l2:13b"
)

case "$TIER" in
    small)
        echo "Pulling small models (good for testing)..."
        for model in "${MODELS_SMALL[@]}"; do
            pull_model "$model"
        done
        ;;
    medium)
        echo "Pulling medium models (daily use)..."
        for model in "${MODELS_MEDIUM[@]}"; do
            pull_model "$model"
        done
        ;;
    large)
        echo "Pulling large models (high quality, needs 32GB+ RAM)..."
        for model in "${MODELS_LARGE[@]}"; do
            pull_model "$model"
        done
        ;;
    creative)
        echo "Pulling creative writing models (~80GB total)..."
        for model in "${MODELS_CREATIVE[@]}"; do
            pull_model "$model"
        done
        ;;
    darkrp)
        echo "Pulling dark roleplay models (~50GB total)..."
        for model in "${MODELS_DARKRP[@]}"; do
            pull_model "$model"
        done
        ;;
    all)
        echo "Pulling ALL models (~150GB total)..."
        # Combine all unique models
        declare -A seen
        for model in "${MODELS_LARGE[@]}" "${MODELS_CREATIVE[@]}" "${MODELS_DARKRP[@]}"; do
            if [[ -z "${seen[$model]}" ]]; then
                seen[$model]=1
                pull_model "$model"
            fi
        done
        ;;
    *)
        echo "Unknown tier: $TIER"
        echo ""
        echo "Usage: $0 [tier]"
        echo ""
        echo "Tiers:"
        echo "  small    - dolphin-phi only (1.6GB)"
        echo "  medium   - Daily drivers (10GB)"
        echo "  large    - High quality + MoE (50GB)"
        echo "  creative - Creative writing focused (80GB)"
        echo "  darkrp   - Dark roleplay focused (50GB)"
        echo "  all      - Everything (~150GB)"
        exit 1
        ;;
esac

echo "==============================="
echo "Installed models:"
ollama list
echo ""
echo "Done! Access Open WebUI at http://localhost:3030"
