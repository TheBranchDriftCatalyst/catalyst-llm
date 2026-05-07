#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_theme.sh"

HOST="${1:-localhost}"
PORT="${WHISPER_PORT:-8787}"
BASE="http://${HOST}:${PORT}"
PASS=0
FAIL=0
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

service_header "Whisper" "${BASE}"

# ─── Connectivity ─────────────────────────────────────────────────
section "Connectivity"
if curl -s "${BASE}" -o /dev/null --max-time 10 2>/dev/null; then
  pass "Server is reachable"
else
  fail "Server is not reachable"
  abort "whisper-server not running" "Start with: task start"
  exit 1
fi

# ─── Generate test audio via macOS say ────────────────────────────
section "Transcription"

SPEECH_FILE="${TMPDIR}/speech.wav"

if command -v say &>/dev/null; then
  AIFF="${TMPDIR}/speech.aiff"
  say -o "$AIFF" "The quick brown fox jumps over the lazy dog" 2>/dev/null
  afconvert -f WAVE -d LEI16@16000 "$AIFF" "$SPEECH_FILE" 2>/dev/null

  if [ -f "$SPEECH_FILE" ]; then
    START=$(python3 -c "import time; print(time.time())")
    RESULT=$(curl -s "${BASE}/inference" --max-time 120 \
      -F "file=@${SPEECH_FILE}" \
      -F "response_format=json" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
      ELAPSED=$(python3 -c "import time; print(f'{time.time() - ${START}:.1f}')")
      TEXT=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('text','')[:80])" 2>/dev/null || echo "$RESULT" | head -c 80)

      if echo "$TEXT" | grep -qi "fox\|brown\|lazy\|dog" &>/dev/null; then
        pass "Transcribed in ${ELAPSED}s: \"${TEXT}\""
      else
        fail "Transcription didn't match. Got: \"${TEXT}\""
      fi
    else
      fail "POST /inference failed"
    fi

    # verbose_json
    VERBOSE=$(curl -s "${BASE}/inference" --max-time 120 \
      -F "file=@${SPEECH_FILE}" \
      -F "response_format=verbose_json" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$VERBOSE" ]; then
      pass "verbose_json format works"
    else
      fail "verbose_json format failed"
    fi
  else
    skip "afconvert failed — cannot generate test audio"
  fi
else
  skip "macOS 'say' not available"
fi

# ─── LAN Binding ──────────────────────────────────────────────────
section "Network"
if curl -s "http://0.0.0.0:${PORT}" -o /dev/null --max-time 5 2>/dev/null; then
  pass "Bound to 0.0.0.0 (LAN accessible)"
else
  fail "Not bound to 0.0.0.0"
fi

# ─── Summary ──────────────────────────────────────────────────────
summary
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
