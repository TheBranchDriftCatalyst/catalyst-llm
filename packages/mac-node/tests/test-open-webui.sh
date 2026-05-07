#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_theme.sh"

HOST="${1:-localhost}"
PORT="${WEBUI_PORT:-3000}"
BASE="http://${HOST}:${PORT}"
PASS=0
FAIL=0

service_header "Open WebUI" "${BASE}"

# ─── Connectivity ─────────────────────────────────────────────────
section "Connectivity"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}" --max-time 10 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "000" ]; then
  pass "Server is reachable (HTTP ${HTTP_CODE})"
else
  fail "Server is not reachable"
  abort "Open WebUI not running" "Start with: task start:webui"
  exit 1
fi

# ─── Health Endpoint ──────────────────────────────────────────────
section "Health"
HEALTH=$(curl -s "${BASE}/health" --max-time 5 2>/dev/null || echo "")
if [ -n "$HEALTH" ]; then
  pass "GET /health responds"
else
  info "/health not available (non-critical)"
fi

# ─── Frontend Loading ────────────────────────────────────────────
section "Frontend"
PAGE=$(curl -s "${BASE}" --max-time 10 2>/dev/null || echo "")
if echo "$PAGE" | grep -qi "open webui\|openwebui\|<title>" &>/dev/null; then
  pass "Frontend HTML loads"
else
  fail "Frontend HTML didn't load or unexpected content"
fi

# ─── API Endpoints ────────────────────────────────────────────────
section "API"

# Check Ollama backend connectivity
OLLAMA_CHECK=$(curl -s "${BASE}/ollama/api/tags" --max-time 10 2>/dev/null || echo "")
if [ -n "$OLLAMA_CHECK" ] && echo "$OLLAMA_CHECK" | python3 -c "import sys,json; json.load(sys.stdin)" &>/dev/null; then
  MODEL_COUNT=$(echo "$OLLAMA_CHECK" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "?")
  pass "Ollama backend connected (${MODEL_COUNT} models)"
else
  # Try the v1 models endpoint instead
  V1_CHECK=$(curl -s "${BASE}/api/models" --max-time 10 2>/dev/null || echo "")
  if [ -n "$V1_CHECK" ]; then
    pass "API /api/models responds"
  else
    fail "Cannot reach Ollama backend through WebUI"
  fi
fi

# ─── LAN Binding ──────────────────────────────────────────────────
section "Network"
if curl -s "http://0.0.0.0:${PORT}" -o /dev/null --max-time 5 2>/dev/null; then
  pass "Bound to 0.0.0.0 (LAN accessible)"
else
  fail "Not bound to 0.0.0.0 — check HOST env in plist"
fi

# ─── Data Directory ──────────────────────────────────────────────
section "Storage"
DATA_DIR="/Users/Shared/open-webui"
if [ -d "$DATA_DIR" ]; then
  SIZE=$(du -sh "$DATA_DIR" 2>/dev/null | awk '{print $1}')
  pass "Data dir exists: ${DATA_DIR} (${SIZE})"
else
  fail "Data dir missing: ${DATA_DIR}"
fi

# ─── Summary ──────────────────────────────────────────────────────
summary
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
