#!/usr/bin/env bash
# test-ollama.sh [HOST]
#
# Service-health probe for the local Ollama daemon: connectivity,
# /api/tags JSON, LAN binding, plus a one-model smoke generate + embed.
#
# Per-model coverage moved to pytest — for that use:
#   task test:py            # all models × all capabilities
#   task test:py:chat       # chat only
#   task test:py:vision     # vision only
#   task test:py:quick      # one model per capability (fast smoke)
#   task test:py DUMP=/tmp/foo  # capture per-model outputs
set -uo pipefail

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
if echo "$TAGS" | python3 -c "import sys,json; json.load(sys.stdin)" &>/dev/null; then
  pass "GET /api/tags returns valid JSON"
else
  fail "GET /api/tags failed or invalid JSON"
fi

MODEL_COUNT=$(echo "$TAGS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "0")
if [ "$MODEL_COUNT" -gt 0 ]; then
  pass "Models available: ${MODEL_COUNT}"
else
  fail "No models installed (run: task models:download)"
fi

# ─── LAN Binding ──────────────────────────────────────────────────
section "Network"
if curl -s "http://0.0.0.0:${PORT}" -o /dev/null --max-time 3 2>/dev/null; then
  pass "Bound to 0.0.0.0 (LAN accessible)"
else
  fail "Not bound to 0.0.0.0 — check OLLAMA_HOST env"
fi

# ─── Inference smoke (one model only — pytest does the matrix) ────
section "Inference (smoke)"
FIRST_MODEL=$(echo "$TAGS" | python3 -c "
import sys,json
for m in json.load(sys.stdin).get('models',[]):
    if 'embed' not in m['name'].lower():
        print(m['name']); break
" 2>/dev/null)

if [ -n "$FIRST_MODEL" ]; then
  RESPONSE=$(curl -s "${BASE}/api/generate" --max-time 120 \
    -d "{\"model\": \"${FIRST_MODEL}\", \"prompt\": \"Reply with exactly: hello test\", \"stream\": false}" 2>/dev/null)

  if echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); assert 'response' in r" &>/dev/null; then
    LINE=$(echo "$RESPONSE" | python3 -c "
import sys,json
r=json.load(sys.stdin)
ec=r.get('eval_count',0); ed=r.get('eval_duration',1)/1e9
print(f\"{ec} tokens in {ed:.2f}s ({ec/ed:.1f} tok/s)\" if ec and ed else 'unknown timing')
" 2>/dev/null)
    pass "Generate with ${FIRST_MODEL} — ${LINE}"
  else
    fail "Generate with ${FIRST_MODEL} failed"
  fi
else
  skip "No chat models available to smoke-test"
fi

# ─── Embeddings smoke ─────────────────────────────────────────────
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
  DIM=$(echo "$EMBED_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['embedding']))" 2>/dev/null)
  if [ -n "$DIM" ]; then
    pass "Embedding with ${EMBED_MODEL} — dim=${DIM}"
  else
    fail "Embedding with ${EMBED_MODEL} failed"
  fi
else
  skip "No embedding model installed"
fi

summary
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
