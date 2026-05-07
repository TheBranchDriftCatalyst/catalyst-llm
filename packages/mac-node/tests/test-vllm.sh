#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_theme.sh"

HOST="${1:-localhost}"
PORT="${VLLM_PORT:-8000}"
BASE="http://${HOST}:${PORT}"
PASS=0
FAIL=0

service_header "vLLM-MLX" "${BASE}"

# ─── Connectivity ─────────────────────────────────────────────────
section "Connectivity"
if curl -s "${BASE}/v1/models" -o /dev/null --max-time 10; then
  pass "Server is reachable"
else
  fail "Server is not reachable"
  abort "vLLM-MLX not running" "Start with: task start:vllm"
  exit 1
fi

# ─── Models ───────────────────────────────────────────────────────
section "Models"
MODELS=$(curl -s "${BASE}/v1/models" --max-time 10)
if [ $? -eq 0 ]; then
  MODEL_ID=$(echo "$MODELS" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['id'] if d else '')" 2>/dev/null)
  if [ -n "$MODEL_ID" ]; then
    pass "Model loaded: ${MODEL_ID}"
  else
    fail "No models loaded"
  fi
else
  fail "GET /v1/models failed"
  MODEL_ID=""
fi

# ─── Chat Completion ─────────────────────────────────────────────
section "Chat Completion"
if [ -n "$MODEL_ID" ]; then
  START=$(python3 -c "import time; print(time.time())")
  CHAT=$(curl -s "${BASE}/v1/chat/completions" --max-time 120 \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"${MODEL_ID}\",
      \"messages\": [{\"role\": \"user\", \"content\": \"Say hello in one word.\"}],
      \"max_tokens\": 20,
      \"temperature\": 0.0
    }" 2>/dev/null)

  if [ $? -eq 0 ] && echo "$CHAT" | python3 -c "import sys,json; r=json.load(sys.stdin); assert 'choices' in r" &>/dev/null; then
    ELAPSED=$(python3 -c "import time; print(f'{time.time() - ${START}:.1f}')")
    TEXT=$(echo "$CHAT" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'][:60])" 2>/dev/null)
    TOKENS=$(echo "$CHAT" | python3 -c "import sys,json; u=json.load(sys.stdin).get('usage',{}); print(u.get('completion_tokens','?'))" 2>/dev/null)
    pass "Chat completion — ${TOKENS} tokens in ${ELAPSED}s: \"${TEXT}\""
  else
    fail "Chat completion failed"
  fi

  # ─── Streaming ──────────────────────────────────────────────────
  section "Streaming"
  STREAM=$(curl -s "${BASE}/v1/chat/completions" --max-time 120 \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"${MODEL_ID}\",
      \"messages\": [{\"role\": \"user\", \"content\": \"Say hi.\"}],
      \"max_tokens\": 10,
      \"stream\": true
    }" 2>/dev/null)

  if [ $? -eq 0 ] && echo "$STREAM" | grep -q "data:" &>/dev/null; then
    CHUNK_COUNT=$(echo "$STREAM" | grep -c "data:" 2>/dev/null || echo "0")
    pass "Streaming works — ${CHUNK_COUNT} chunks received"
  else
    fail "Streaming failed"
  fi

  # ─── Completion (non-chat) ──────────────────────────────────────
  section "Completion"
  COMP=$(curl -s "${BASE}/v1/completions" --max-time 120 \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"${MODEL_ID}\",
      \"prompt\": \"The capital of France is\",
      \"max_tokens\": 10,
      \"temperature\": 0.0
    }" 2>/dev/null)

  if [ $? -eq 0 ] && echo "$COMP" | python3 -c "import sys,json; r=json.load(sys.stdin); assert 'choices' in r" &>/dev/null; then
    COMP_TEXT=$(echo "$COMP" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['text'][:40])" 2>/dev/null)
    pass "Text completion: \"${COMP_TEXT}\""
  else
    fail "Text completion failed"
  fi
else
  skip "No model loaded — skipping inference tests"
fi

# ─── LAN Binding ──────────────────────────────────────────────────
section "Network"
if curl -s "http://0.0.0.0:${PORT}/v1/models" -o /dev/null --max-time 5 2>/dev/null; then
  pass "Bound to 0.0.0.0 (LAN accessible)"
else
  fail "Not bound to 0.0.0.0"
fi

# ─── Summary ──────────────────────────────────────────────────────
summary
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
