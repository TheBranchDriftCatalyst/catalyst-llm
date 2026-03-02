#!/usr/bin/env bash
# Test inference across all models on ollama
# Usage: ./test-inference.sh [ollama-url]

set -euo pipefail

OLLAMA_URL="${1:-http://localhost:11434}"
PROMPT="What is 2+2? Answer with just the number."
TIMEOUT=60

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

echo "========================================"
echo "  Ollama Inference Test"
echo "  URL: ${OLLAMA_URL}"
echo "========================================"
echo ""

# Check connectivity (use -q to disable .curlrc)
info "Testing connection to ${OLLAMA_URL}..."
if ! curl -q -sf "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
    fail "Cannot connect to ${OLLAMA_URL}"
    exit 1
fi
success "Connected to ollama"
echo ""

# Get models
info "Fetching model list..."
MODELS=$(curl -q -sf "${OLLAMA_URL}/api/tags" 2>/dev/null | jq -r '.models[].name' | sort)
MODEL_COUNT=$(echo "$MODELS" | wc -l | tr -d ' ')
info "Found ${MODEL_COUNT} models"
echo ""

# Results tracking
PASSED=0
FAILED=0
RESULTS=""

# Test each model
for MODEL in $MODELS; do
    echo "----------------------------------------"
    info "Testing: ${MODEL}"

    START=$(date +%s.%N)

    # Run inference (disable .curlrc with -q)
    RESPONSE=$(curl -q -sf --max-time ${TIMEOUT} "${OLLAMA_URL}/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"${MODEL}\", \"prompt\": \"${PROMPT}\", \"stream\": false}" 2>&1) || {
        fail "${MODEL} - Request failed or timed out"
        FAILED=$((FAILED + 1))
        RESULTS="${RESULTS}\n${RED}FAIL${NC} ${MODEL} - timeout/error"
        continue
    }

    END=$(date +%s.%N)
    DURATION=$(echo "$END - $START" | bc)

    # Parse response (strip any ANSI codes first)
    CLEAN_RESPONSE=$(echo "$RESPONSE" | sed 's/\x1b\[[0-9;]*m//g')
    ANSWER=$(echo "$CLEAN_RESPONSE" | jq -r '.response // empty' 2>/dev/null | head -1 | tr -d '\n')
    EVAL_COUNT=$(echo "$CLEAN_RESPONSE" | jq -r '.eval_count // 0' 2>/dev/null)
    EVAL_DURATION=$(echo "$CLEAN_RESPONSE" | jq -r '.eval_duration // 0' 2>/dev/null)

    # Calculate tokens/sec
    if [[ "$EVAL_DURATION" -gt 0 ]]; then
        TPS=$(echo "scale=2; $EVAL_COUNT / ($EVAL_DURATION / 1000000000)" | bc)
    else
        TPS="N/A"
    fi

    if [[ -n "$ANSWER" ]]; then
        success "${MODEL}"
        echo "       Response: ${ANSWER:0:50}..."
        echo "       Tokens: ${EVAL_COUNT}, Speed: ${TPS} tok/s, Time: ${DURATION}s"
        PASSED=$((PASSED + 1))
        RESULTS="${RESULTS}\n${GREEN}PASS${NC} ${MODEL} (${TPS} tok/s)"
    else
        fail "${MODEL} - Empty response"
        FAILED=$((FAILED + 1))
        RESULTS="${RESULTS}\n${RED}FAIL${NC} ${MODEL} - empty response"
    fi
done

echo ""
echo "========================================"
echo "  Summary"
echo "========================================"
echo -e "$RESULTS"
echo ""
echo "----------------------------------------"
if [[ $FAILED -eq 0 ]]; then
    success "All ${PASSED}/${MODEL_COUNT} models passed"
else
    warn "${PASSED} passed, ${FAILED} failed out of ${MODEL_COUNT} models"
fi
echo "========================================"
