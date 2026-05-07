#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_theme.sh"

HOST="${1:-localhost}"
SERVICES_PASS=0
SERVICES_FAIL=0
_CHILD_PID=0

_cleanup_all() {
  echo ""
  echo -e "  ${YLW}⚠ Suite interrupted — stopping tests${RST}"
  [[ $_CHILD_PID -gt 0 ]] && kill "$_CHILD_PID" 2>/dev/null || true
  exit 130
}
trap _cleanup_all INT TERM

START_TIME=$(python3 -c "import time; print(time.time())")

master_banner "${HOST}"

run_test() {
  local script="$1"
  bash "$script" "$HOST" &
  _CHILD_PID=$!
  wait $_CHILD_PID
  local rc=$?
  _CHILD_PID=0
  if [ $rc -eq 0 ]; then
    SERVICES_PASS=$((SERVICES_PASS + 1))
  elif [ $rc -eq 130 ]; then
    # Child was interrupted, propagate
    exit 130
  else
    SERVICES_FAIL=$((SERVICES_FAIL + 1))
  fi
}

run_test "${SCRIPT_DIR}/test-ollama.sh"
run_test "${SCRIPT_DIR}/test-open-webui.sh"
run_test "${SCRIPT_DIR}/test-whisper.sh"
run_test "${SCRIPT_DIR}/test-vllm.sh"

ELAPSED=$(python3 -c "import time; print(f'{time.time() - ${START_TIME}:.1f}')")
master_summary "$SERVICES_PASS" "$SERVICES_FAIL" "$ELAPSED"

[ "$SERVICES_FAIL" -eq 0 ] && exit 0 || exit 1
