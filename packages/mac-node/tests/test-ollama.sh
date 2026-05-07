#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_theme.sh"

HOST="${1:-localhost}"
PORT="${OLLAMA_PORT:-11434}"
BASE="http://${HOST}:${PORT}"
PASS=0
FAIL=0

service_header "Ollama" "${BASE}"

# ─── Connectivity ─────────────────────────────────────────────────
section "Connectivity"
if curl -s "${BASE}" -o /dev/null --max-time 5; then
  pass "Server is reachable"
else
  fail "Server is not reachable"
  abort "Ollama not running" "Start with: task start:ollama"
  exit 1
fi

# ─── API Health ───────────────────────────────────────────────────
section "API"
TAGS=$(curl -s "${BASE}/api/tags" --max-time 10)
if [ $? -eq 0 ] && echo "$TAGS" | python3 -c "import sys,json; json.load(sys.stdin)" &>/dev/null; then
  pass "GET /api/tags returns valid JSON"
else
  fail "GET /api/tags failed or invalid JSON"
fi

MODEL_COUNT=$(echo "$TAGS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "0")
if [ "$MODEL_COUNT" -gt 0 ]; then
  pass "Models available: ${MODEL_COUNT}"
  echo "$TAGS" | python3 -c "
import sys,json
for m in json.load(sys.stdin)['models']:
    size_gb = m.get('size',0) / 1e9
    print(f'{m[\"name\"]} ({size_gb:.1f} GB)')
" 2>/dev/null | while IFS= read -r line; do
    detail "- $line"
  done
else
  fail "No models installed (run: task setup:models)"
fi

# ─── LAN Binding ──────────────────────────────────────────────────
section "Network"
if curl -s "http://0.0.0.0:${PORT}" -o /dev/null --max-time 3 2>/dev/null; then
  pass "Bound to 0.0.0.0 (LAN accessible)"
else
  fail "Not bound to 0.0.0.0 — check OLLAMA_HOST env"
fi

# ─── Inference ────────────────────────────────────────────────────
section "Inference"
FIRST_MODEL=$(echo "$TAGS" | python3 -c "
import sys,json
ms=json.load(sys.stdin).get('models',[])
# Skip embedding models
for m in ms:
    if 'embed' not in m['name'].lower():
        print(m['name']); break
" 2>/dev/null)

if [ -n "$FIRST_MODEL" ]; then
  START=$(python3 -c "import time; print(time.time())")
  RESPONSE=$(curl -s "${BASE}/api/generate" --max-time 120 \
    -d "{\"model\": \"${FIRST_MODEL}\", \"prompt\": \"Reply with exactly: hello test\", \"stream\": false}" 2>/dev/null)

  if [ $? -eq 0 ] && echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); assert 'response' in r" &>/dev/null; then
    ELAPSED=$(python3 -c "import time; print(f'{time.time() - ${START}:.1f}')")
    TOKENS=$(echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('eval_count','?'))" 2>/dev/null)
    SPEED=$(echo "$RESPONSE" | python3 -c "
import sys,json
r=json.load(sys.stdin)
if r.get('eval_duration') and r.get('eval_count'):
    print(f\"{r['eval_count'] / (r['eval_duration']/1e9):.1f} tok/s\")
else:
    print('unknown')
" 2>/dev/null)
    pass "Generate with ${FIRST_MODEL} — ${TOKENS} tokens in ${ELAPSED}s (${SPEED})"
  else
    fail "Generate with ${FIRST_MODEL} failed"
  fi
else
  skip "No chat models available to test"
fi

# ─── Embeddings ───────────────────────────────────────────────────
section "Embeddings"
EMBED_MODEL=$(echo "$TAGS" | python3 -c "
import sys,json
for m in json.load(sys.stdin).get('models',[]):
    if 'embed' in m['name'].lower():
        print(m['name']); break
" 2>/dev/null)

if [ -n "$EMBED_MODEL" ]; then
  EMBED_RESP=$(curl -s "${BASE}/api/embeddings" --max-time 30 \
    -d "{\"model\": \"${EMBED_MODEL}\", \"prompt\": \"test embedding vector\"}" 2>/dev/null)

  if [ $? -eq 0 ]; then
    DIM=$(echo "$EMBED_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['embedding']))" 2>/dev/null)
    pass "Embedding with ${EMBED_MODEL} — dim=${DIM}"
  else
    fail "Embedding with ${EMBED_MODEL} failed"
  fi
else
  skip "No embedding model installed (run: ollama pull nomic-embed-text)"
fi

# ─── Summary ──────────────────────────────────────────────────────
summary
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
