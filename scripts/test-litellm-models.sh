#!/usr/bin/env bash
# Test every model registered with the LiteLLM proxy.
#
# - Lists models via /v1/models
# - Classifies each as embedding vs chat (by name)
# - Calls the appropriate endpoint with a tiny payload
# - Reports pass/fail/timeout per model + summary
#
# Usage:
#   LITELLM_MASTER_KEY=sk-... ./test-litellm-models.sh
#   LITELLM_URL=http://litellm.talos00 LITELLM_MASTER_KEY=sk-... ./test-litellm-models.sh
#   ./test-litellm-models.sh --only claude-opus-4-20250514,gpt-4o
#   ./test-litellm-models.sh --skip runpod-dolphin
#   ./test-litellm-models.sh --json results.json
#
# Exit code: 0 if all passed, 1 if any failed.

set -uo pipefail

LITELLM_URL="${LITELLM_URL:-http://litellm.talos00}"
# Default 120s matches litellm general request_timeout; long enough for slow
# local models without making bad endpoints take forever.
TIMEOUT="${TIMEOUT:-120}"
# Bigger max_tokens so reasoning models (o3-mini etc.) don't burn the budget on
# internal reasoning and return empty content.
MAX_TOKENS="${MAX_TOKENS:-128}"
PROMPT="${PROMPT:-Reply with a single word: pong}"
ONLY=""
SKIP=""
JSON_OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only)  ONLY="$2"; shift 2 ;;
    --skip)  SKIP="$2"; shift 2 ;;
    --json)  JSON_OUT="$2"; shift 2 ;;
    --url)   LITELLM_URL="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Accept either LITELLM_MASTER_KEY (admin key) or LLM_API_KEY (virtual key
# issued by litellm — populated by direnv from ../catalyst-data/.envrc.cluster).
LITELLM_KEY="${LITELLM_MASTER_KEY:-${LLM_API_KEY:-}}"
if [[ -z "$LITELLM_KEY" ]]; then
  echo "ERROR: need LITELLM_MASTER_KEY or LLM_API_KEY in env" >&2
  echo "  Try: cd ../catalyst-data && direnv allow   (then re-run from there)" >&2
  echo "  Or:  export LITELLM_MASTER_KEY=\$(kubectl -n catalyst-llm get secret litellm-secrets -o jsonpath='{.data.LITELLM_MASTER_KEY}' | base64 -d)" >&2
  exit 2
fi

for bin in curl jq; do
  command -v "$bin" >/dev/null || { echo "ERROR: $bin not found in PATH" >&2; exit 2; }
done

# --- Synthwave palette (catalyst-ui brand: hot pink → purple → cyan) ---
PINK='\033[38;2;255;105;180m'
PURPLE='\033[38;2;189;147;249m'
CYAN='\033[38;2;0;252;214m'
GREEN='\033[38;2;80;250;123m'
YELLOW='\033[38;2;255;184;108m'
RED='\033[38;2;255;85;85m'
GREY='\033[38;2;120;120;140m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()   { echo -e "${CYAN}❯${NC} $*"; }
pass()   { echo -e "${GREEN}✓${NC} $*"; }
fail_l() { echo -e "${RED}✗${NC} $*"; }
warn()   { echo -e "${YELLOW}!${NC} $*"; }

# Detect terminal width for nice rules.
TW=$(tput cols 2>/dev/null || echo 80)
[[ "$TW" -gt 100 ]] && TW=100
RULE=$(printf '─%.0s' $(seq 1 "$TW"))

banner() {
  echo
  echo -e "${PINK}${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${PINK}${BOLD}║${NC}  ${PURPLE}█▀▀ ${PINK}▄▀█ ${CYAN}▀█▀ ${PURPLE}▄▀█ ${PINK}█░░ ${CYAN}█▄█ ${PURPLE}█▀ ${PINK}▀█▀${NC}    ${DIM}${CYAN}LiteLLM Health Check${NC}     ${PINK}${BOLD}║${NC}"
  echo -e "${PINK}${BOLD}║${NC}  ${PURPLE}█▄▄ ${PINK}█▀█ ${CYAN}░█░ ${PURPLE}█▀█ ${PINK}█▄▄ ${CYAN}░█░ ${PURPLE}▄█ ${PINK}░█░${NC}    ${DIM}catalyst-llm proxy${NC}        ${PINK}${BOLD}║${NC}"
  echo -e "${PINK}${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"
  printf "  ${DIM}URL    ${NC} ${CYAN}%s${NC}\n" "$LITELLM_URL"
  printf "  ${DIM}timeout${NC} ${CYAN}%ss${NC}\n" "$TIMEOUT"
  printf "  ${DIM}prompt ${NC} ${GREY}\"%s\"${NC}\n" "$PROMPT"
  echo -e "${GREY}${RULE}${NC}"
}

banner

# --- Sanity: liveness ---
if ! curl -q -sf --max-time 5 "${LITELLM_URL}/health/liveliness" >/dev/null; then
  fail_l "Cannot reach ${LITELLM_URL}/health/liveliness"
  exit 1
fi
info "Proxy is alive"

# --- Fetch model list ---
MODELS_JSON=$(curl -q -s --max-time 10 "${LITELLM_URL}/v1/models" \
  -H "Authorization: Bearer ${LITELLM_KEY}")
if ! echo "$MODELS_JSON" | jq -e '.data' >/dev/null 2>&1; then
  fail_l "Could not parse /v1/models response:"
  echo "$MODELS_JSON" | head -c 500
  exit 1
fi

ALL_MODELS=$(echo "$MODELS_JSON" | jq -r '.data[].id' | sort -f)
TOTAL=$(echo "$ALL_MODELS" | wc -l | tr -d ' ')
info "Found ${TOTAL} models registered with the proxy"

# --- Apply --only / --skip filters ---
filter_models() {
  local list="$1"
  if [[ -n "$ONLY" ]]; then
    local out=""
    IFS=',' read -ra wanted <<<"$ONLY"
    for m in "${wanted[@]}"; do
      if echo "$list" | grep -Fxq "$m"; then out+="${m}"$'\n'; else warn "--only model not found in proxy: $m"; fi
    done
    printf '%s' "$out"
    return
  fi
  if [[ -n "$SKIP" ]]; then
    local pattern
    pattern=$(echo "$SKIP" | tr ',' '|')
    echo "$list" | grep -vE "^(${pattern})$" || true
    return
  fi
  echo "$list"
}

MODELS=$(filter_models "$ALL_MODELS")
COUNT=$(echo "$MODELS" | grep -c . || true)
info "Testing ${COUNT} models"
echo ""

# --- Classify model: embedding vs chat ---
is_embedding() {
  local m="$1"
  case "$m" in
    *embed*|*embedding*) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Tracking arrays ---
declare -a R_NAME R_KIND R_STATUS R_DURATION R_DETAIL

run_chat() {
  local model="$1"
  local body
  body=$(jq -nc --arg m "$model" --arg p "$PROMPT" --argjson mt "$MAX_TOKENS" \
    '{model:$m, max_tokens:$mt, messages:[{role:"user",content:$p}]}')

  local start end http body_resp
  start=$(date +%s)
  # write body to tmp, capture status code separately
  local tmp; tmp=$(mktemp)
  http=$(curl -q -s -o "$tmp" -w "%{http_code}" \
    --max-time "$TIMEOUT" \
    -H "Authorization: Bearer ${LITELLM_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${LITELLM_URL}/v1/chat/completions")
  end=$(date +%s)
  body_resp=$(cat "$tmp"); rm -f "$tmp"
  local duration=$((end - start))

  if [[ "$http" == "200" ]]; then
    local content
    content=$(echo "$body_resp" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
    if [[ -n "$content" ]]; then
      echo "OK|${duration}|${content:0:60}"
    else
      echo "EMPTY|${duration}|response had no content: $(echo "$body_resp" | head -c 200)"
    fi
  else
    local err
    err=$(echo "$body_resp" | jq -r '(.error.message // .detail // .) | tostring' 2>/dev/null | head -c 240)
    [[ -z "$err" ]] && err=$(echo "$body_resp" | head -c 240)
    echo "FAIL|${duration}|HTTP ${http}: ${err}"
  fi
}

run_embedding() {
  local model="$1"
  local body
  body=$(jq -nc --arg m "$model" '{model:$m, input:"ping"}')

  local start end http body_resp
  start=$(date +%s)
  local tmp; tmp=$(mktemp)
  http=$(curl -q -s -o "$tmp" -w "%{http_code}" \
    --max-time "$TIMEOUT" \
    -H "Authorization: Bearer ${LITELLM_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${LITELLM_URL}/v1/embeddings")
  end=$(date +%s)
  body_resp=$(cat "$tmp"); rm -f "$tmp"
  local duration=$((end - start))

  if [[ "$http" == "200" ]]; then
    local dim
    dim=$(echo "$body_resp" | jq -r '.data[0].embedding | length // 0' 2>/dev/null)
    if [[ "${dim:-0}" -gt 0 ]]; then
      echo "OK|${duration}|dim=${dim}"
    else
      echo "EMPTY|${duration}|no embedding vector returned"
    fi
  else
    local err
    err=$(echo "$body_resp" | jq -r '(.error.message // .detail // .) | tostring' 2>/dev/null | head -c 240)
    [[ -z "$err" ]] && err=$(echo "$body_resp" | head -c 240)
    echo "FAIL|${duration}|HTTP ${http}: ${err}"
  fi
}

PASSED=0; FAILED=0; EMPTY=0
i=0
while IFS= read -r MODEL; do
  [[ -z "$MODEL" ]] && continue
  i=$((i + 1))
  if is_embedding "$MODEL"; then
    KIND="embed"
    RESULT=$(run_embedding "$MODEL")
  else
    KIND="chat"
    RESULT=$(run_chat "$MODEL")
  fi
  STATUS="${RESULT%%|*}"
  REST="${RESULT#*|}"
  DUR="${REST%%|*}"
  DETAIL="${REST#*|}"

  R_NAME+=("$MODEL"); R_KIND+=("$KIND"); R_STATUS+=("$STATUS"); R_DURATION+=("$DUR"); R_DETAIL+=("$DETAIL")

  # Status glyph + color
  case "$STATUS" in
    OK)    GLYPH="${GREEN}✓${NC}"; LBL="${GREEN}PASS ${NC}"; PASSED=$((PASSED+1)) ;;
    EMPTY) GLYPH="${YELLOW}⚠${NC}"; LBL="${YELLOW}EMPTY${NC}"; EMPTY=$((EMPTY+1)) ;;
    FAIL)  GLYPH="${RED}✗${NC}";    LBL="${RED}FAIL ${NC}"; FAILED=$((FAILED+1)) ;;
  esac

  # Kind tag (chat = pink, embed = purple)
  if [[ "$KIND" == "embed" ]]; then KTAG="${PURPLE}embed${NC}"; else KTAG="${PINK}chat ${NC}"; fi

  printf "  ${GREY}%2d/%-2d${NC} %b %b ${BOLD}%-38s${NC} %b ${DIM}%3ss${NC}  ${GREY}%s${NC}\n" \
    "$i" "$COUNT" "$GLYPH" "$KTAG" "$MODEL" "$LBL" "$DUR" "${DETAIL:0:60}"
done <<< "$MODELS"

echo -e "${GREY}${RULE}${NC}"
echo
echo -e "  ${BOLD}${PURPLE}◆ Summary${NC}"
echo
printf "    ${GREEN}✓ passed${NC}  %3d  " "$PASSED"
printf "${YELLOW}⚠ empty${NC}   %3d  " "$EMPTY"
printf "${RED}✗ failed${NC}  %3d  " "$FAILED"
printf "${DIM}total${NC}    %3d\n" "$COUNT"
echo

if [[ $FAILED -gt 0 || $EMPTY -gt 0 ]]; then
  echo -e "  ${BOLD}${PINK}◆ Needs attention${NC}"
  echo
  for idx in "${!R_NAME[@]}"; do
    s="${R_STATUS[$idx]}"
    [[ "$s" == "OK" ]] && continue
    case "$s" in
      EMPTY) c="$YELLOW"; g="⚠";;
      FAIL)  c="$RED";    g="✗";;
    esac
    printf "    ${c}%s${NC} ${BOLD}%-38s${NC} ${DIM}%s${NC} ${GREY}%s${NC}\n" \
      "$g" "${R_NAME[$idx]}" "$s" "${R_DETAIL[$idx]:0:80}"
  done
  echo
fi

# Closing flourish
echo -e "${PINK}━${PURPLE}━${CYAN}━${NC}${PINK}━${PURPLE}━${CYAN}━${NC}${PINK}━${PURPLE}━${CYAN}━${NC} ${DIM}catalyst-llm${NC} ${PINK}━${PURPLE}━${CYAN}━${NC}${PINK}━${PURPLE}━${CYAN}━${NC}${PINK}━${PURPLE}━${CYAN}━${NC}"
echo

# --- JSON output ---
if [[ -n "$JSON_OUT" ]]; then
  {
    echo "["
    for idx in "${!R_NAME[@]}"; do
      jq -nc \
        --arg name "${R_NAME[$idx]}" \
        --arg kind "${R_KIND[$idx]}" \
        --arg status "${R_STATUS[$idx]}" \
        --arg detail "${R_DETAIL[$idx]}" \
        --argjson duration "${R_DURATION[$idx]:-0}" \
        '{name:$name,kind:$kind,status:$status,duration_s:$duration,detail:$detail}'
      if [[ $idx -lt $((${#R_NAME[@]} - 1)) ]]; then echo ","; fi
    done
    echo "]"
  } > "$JSON_OUT"
  info "Wrote JSON report to $JSON_OUT"
fi

[[ $FAILED -eq 0 && $EMPTY -eq 0 ]] && exit 0 || exit 1
