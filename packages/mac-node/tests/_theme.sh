#!/usr/bin/env bash
# tests/_theme.sh — mac-node test suite theme
#
# Source this at the top of each test script:
#   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#   source "${SCRIPT_DIR}/_theme.sh"

# ── Signal Handling ───────────────────────────────────────
_cleanup_and_exit() {
  echo ""
  echo -e "  \033[38;5;220m⚠ Interrupted — cleaning up\033[0m"
  # Kill any background curl/python children
  kill 0 2>/dev/null || true
  exit 130
}
trap _cleanup_and_exit INT TERM

# ── Color Palette ─────────────────────────────────────────
if [[ -z "${NO_COLOR:-}" ]]; then
  RST=$'\033[0m'
  BLD=$'\033[1m'
  DIM=$'\033[2m'
  GRN=$'\033[38;5;48m'       # neon green
  RED=$'\033[38;5;197m'       # hot pink-red
  CYN=$'\033[38;5;45m'        # electric cyan
  MAG=$'\033[38;5;141m'       # soft purple
  YLW=$'\033[38;5;220m'       # warm amber
  GRY=$'\033[38;5;242m'       # dim gray
  WHT=$'\033[38;5;255m'       # bright white
  BG_GRN=$'\033[48;5;22m'     # dark green bg
  BG_RED=$'\033[48;5;52m'     # dark red bg
else
  RST='' BLD='' DIM=''
  GRN='' RED='' CYN='' MAG='' YLW='' GRY='' WHT=''
  BG_GRN='' BG_RED=''
fi

# ── Line Art ──────────────────────────────────────────────
_HEAVY="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
_LIGHT="──────────────────────────────────────────────────────────────"

# ── Output Helpers ────────────────────────────────────────

pass() {
  echo -e "    ${BLD}${GRN}✔${RST} ${WHT}$1${RST}"
  PASS=$((PASS + 1))
}

fail() {
  echo -e "    ${BLD}${RED}✘${RST} ${RED}$1${RST}"
  FAIL=$((FAIL + 1))
}

skip() {
  echo -e "    ${DIM}○ $1${RST}"
}

section() {
  echo -e "  ${CYN}▸${RST} ${BLD}${CYN}$1${RST}"
}

detail() {
  echo -e "      ${GRY}$1${RST}"
}

info() {
  echo -e "    ${DIM}$1${RST}"
}

warn() {
  echo -e "    ${YLW}⚠ $1${RST}"
}

abort() {
  echo ""
  echo -e "    ${BLD}${RED}▌ ABORT${RST}  ${RED}$1${RST}"
  echo -e "    ${GRY}$2${RST}"
}

# Service header — individual test scripts
service_header() {
  local name="$1" url="${2:-}"
  echo ""
  echo -e "  ${MAG}${_HEAVY}${RST}"
  echo -e "  ${BLD}${CYN}⚡ ${name}${RST}  ${GRY}${url}${RST}"
  echo ""
}

# Per-service summary badge
summary() {
  local p=${1:-$PASS} f=${2:-$FAIL}
  echo ""
  if [[ "$f" -eq 0 ]]; then
    echo -e "  ${BG_GRN}${BLD}${WHT} PASS ${RST} ${GRN}${p} checks passed${RST}"
  else
    echo -e "  ${BG_RED}${BLD}${WHT} FAIL ${RST} ${GRN}${p} passed${RST} ${GRY}/${RST} ${RED}${f} failed${RST}"
  fi
}

# Master banner — test-all.sh
master_banner() {
  local target="$1"
  echo ""
  echo -e "  ${MAG}${_HEAVY}${RST}"
  echo -e "  ${BLD}${CYN}  ⚡  M A C ${MAG}·${CYN} N O D E${RST}"
  echo -e "  ${GRY}     Service Test Suite  ${MAG}//${RST}  ${GRY}target ${MAG}»${RST} ${WHT}${target}${RST}"
  echo -e "  ${MAG}${_HEAVY}${RST}"
  echo ""
}

# Master summary — test-all.sh
master_summary() {
  local sp=$1 sf=$2 elapsed="${3:-}"
  local time_str=""
  [[ -n "$elapsed" ]] && time_str=" in ${elapsed}s"
  echo ""
  echo -e "  ${GRY}${_LIGHT}${RST}"
  echo ""
  if [[ "$sf" -eq 0 ]]; then
    echo -e "  ${BLD}${GRN}▓▓▓${RST} ${BLD}${WHT}All services healthy${RST}  ${GRY}(${sp} services passed${time_str})${RST}"
  else
    echo -e "  ${BLD}${RED}▓▓▓${RST} ${BLD}${WHT}${sf} service(s) degraded${RST}  ${GRY}(${sp} passed, ${sf} failed${time_str})${RST}"
    echo ""
    echo -e "  ${YLW}Quick fixes:${RST}"
    echo -e "    ${WHT}task start${RST}        ${GRY}# Start all services${RST}"
    echo -e "    ${WHT}task status${RST}       ${GRY}# Check which are running${RST}"
    echo -e "    ${WHT}task health${RST}       ${GRY}# Quick health check${RST}"
  fi
  echo ""
}
