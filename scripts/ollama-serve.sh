#!/bin/bash
# Ollama server management script for Tilt
# Handles installation and startup with proper signal handling

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[ollama]${NC} $1"; }
warn() { echo -e "${YELLOW}[ollama]${NC} $1"; }
error() { echo -e "${RED}[ollama]${NC} $1"; }

# Check if ollama is installed
if ! command -v ollama &> /dev/null; then
    warn "Ollama not found. Installing via Homebrew..."
    if command -v brew &> /dev/null; then
        brew install ollama
        log "Ollama installed successfully!"
    else
        error "Homebrew not found. Please install ollama manually:"
        error "  brew install ollama"
        error "  OR visit: https://ollama.ai/download"
        exit 1
    fi
fi

# Check ollama version
OLLAMA_VERSION=$(ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
log "Ollama version: $OLLAMA_VERSION"

# Check if another ollama is already running
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    warn "Ollama is already running on port 11434"
    warn "Using existing instance..."
    # Keep the script running to satisfy Tilt's serve_cmd
    while curl -s http://localhost:11434/api/tags > /dev/null 2>&1; do
        sleep 10
    done
    error "Existing ollama instance stopped"
    exit 1
fi

# Cleanup function for graceful shutdown
cleanup() {
    log "Shutting down ollama server..."
    # Kill the ollama process if we started it
    if [ -n "$OLLAMA_PID" ]; then
        kill $OLLAMA_PID 2>/dev/null || true
        wait $OLLAMA_PID 2>/dev/null || true
    fi
    log "Ollama server stopped"
    exit 0
}

# Trap signals for cleanup
trap cleanup SIGTERM SIGINT SIGQUIT

# Start ollama server
log "Starting ollama server (Metal GPU enabled)..."
log "GPU: Apple M1 Max (32 cores)"

# Set environment for optimal performance
export OLLAMA_HOST=0.0.0.0:11434
export OLLAMA_KEEP_ALIVE=10m
export OLLAMA_NUM_PARALLEL=4
export OLLAMA_MAX_LOADED_MODELS=2

# Start ollama serve in background so we can handle signals
ollama serve &
OLLAMA_PID=$!

log "Ollama server started (PID: $OLLAMA_PID)"

# Wait for server to be ready
for i in {1..30}; do
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        log "Ollama server is ready!"
        break
    fi
    sleep 1
done

# Keep running and wait for the ollama process
wait $OLLAMA_PID
