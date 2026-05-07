#!/bin/bash
# Auto-shutdown watchdog for RunPod pods.
# Monitors real inference activity across all services.
# Shuts down the pod after SUICIDE_TTL of inactivity.
#
# Activity signals (NOT health checks):
#   - Ollama: models loaded in VRAM (ollama ps)
#   - ComfyUI: items in generation queue
#   - Whisper: /tmp/.whisper-activity touched on transcription requests
#
# Environment:
#   SUICIDE_TTL  — idle timeout before shutdown (default: disabled)
#                  Formats: "60m", "2h", "1h30m", "3600" (bare number = seconds)
#   WATCHDOG_INTERVAL — check interval in seconds (default: 60)

set -e

SUICIDE_TTL="${SUICIDE_TTL:-}"
WATCHDOG_INTERVAL="${WATCHDOG_INTERVAL:-60}"
ACTIVITY_FILE="/tmp/.last-activity"

# ── Parse TTL string to seconds ──────────────────────────────────
parse_ttl() {
    local input="$1"
    local total=0

    # Bare number = seconds
    if [[ "$input" =~ ^[0-9]+$ ]]; then
        echo "$input"
        return
    fi

    # Extract hours
    if [[ "$input" =~ ([0-9]+)h ]]; then
        total=$((total + ${BASH_REMATCH[1]} * 3600))
    fi

    # Extract minutes
    if [[ "$input" =~ ([0-9]+)m ]]; then
        total=$((total + ${BASH_REMATCH[1]} * 60))
    fi

    # Extract seconds
    if [[ "$input" =~ ([0-9]+)s ]]; then
        total=$((total + ${BASH_REMATCH[1]}))
    fi

    if [ "$total" -eq 0 ]; then
        echo "ERROR: cannot parse TTL '$input'" >&2
        return 1
    fi

    echo "$total"
}

# ── Check if any service is doing real work ──────────────────────
check_activity() {
    # 1. Ollama: any models loaded in VRAM = recently used
    local loaded
    loaded=$(ollama ps 2>/dev/null | tail -n +2 | grep -c . || true)
    if [ "$loaded" -gt 0 ]; then
        return 0  # active
    fi

    # 2. ComfyUI: items in queue
    local queue_size
    queue_size=$(curl -sf http://127.0.0.1:8188/queue 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('queue_running',[])) + len(d.get('queue_pending',[])))" 2>/dev/null \
        || echo "0")
    if [ "$queue_size" -gt 0 ]; then
        return 0  # active
    fi

    # 3. Whisper: activity file touched recently (within TTL)
    if [ -f "$ACTIVITY_FILE" ]; then
        local last now diff
        last=$(stat -c %Y "$ACTIVITY_FILE" 2>/dev/null || stat -f %m "$ACTIVITY_FILE" 2>/dev/null || echo 0)
        now=$(date +%s)
        diff=$((now - last))
        if [ "$diff" -lt "$TTL_SECONDS" ]; then
            return 0  # active
        fi
    fi

    return 1  # idle
}

# ── Shutdown the pod ─────────────────────────────────────────────
shutdown_pod() {
    echo "WATCHDOG: No activity for ${SUICIDE_TTL}. Shutting down."

    # Try RunPod's API first (graceful)
    if [ -n "$RUNPOD_POD_ID" ] && command -v runpodctl &>/dev/null; then
        echo "WATCHDOG: Stopping via runpodctl..."
        runpodctl stop pod "$RUNPOD_POD_ID" 2>/dev/null && return
    fi

    # Try RunPod API via curl
    if [ -n "$RUNPOD_POD_ID" ] && [ -n "$RUNPOD_API_KEY" ]; then
        echo "WATCHDOG: Stopping via RunPod API..."
        curl -sf -X POST "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"query\": \"mutation { podStop(input: { podId: \\\"${RUNPOD_POD_ID}\\\" }) { id } }\"}" \
            2>/dev/null && return
    fi

    # Fallback: hard shutdown
    echo "WATCHDOG: Falling back to system shutdown..."
    shutdown -h now
}

# ── Main ─────────────────────────────────────────────────────────

# Disabled if no TTL set
if [ -z "$SUICIDE_TTL" ]; then
    echo "WATCHDOG: SUICIDE_TTL not set, idle shutdown disabled."
    exec sleep infinity
fi

TTL_SECONDS=$(parse_ttl "$SUICIDE_TTL") || exit 1
echo "WATCHDOG: Idle shutdown enabled — TTL=${SUICIDE_TTL} (${TTL_SECONDS}s), checking every ${WATCHDOG_INTERVAL}s"

# Initialize activity timestamp
touch "$ACTIVITY_FILE"

idle_since=""

while true; do
    sleep "$WATCHDOG_INTERVAL"

    if check_activity; then
        # Active — reset idle timer
        if [ -n "$idle_since" ]; then
            echo "WATCHDOG: Activity detected, resetting idle timer."
        fi
        idle_since=""
        touch "$ACTIVITY_FILE"
    else
        # Idle — start or continue counting
        now=$(date +%s)
        if [ -z "$idle_since" ]; then
            idle_since="$now"
            echo "WATCHDOG: No activity detected, starting idle timer."
        fi

        idle_duration=$((now - idle_since))
        remaining=$((TTL_SECONDS - idle_duration))

        if [ "$idle_duration" -ge "$TTL_SECONDS" ]; then
            shutdown_pod
            exit 0
        else
            echo "WATCHDOG: Idle for ${idle_duration}s / ${TTL_SECONDS}s (${remaining}s remaining)"
        fi
    fi
done
