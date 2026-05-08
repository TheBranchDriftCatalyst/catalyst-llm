#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="${REPO_DIR}/.venv"
MODELS_DIR="${REPO_DIR}/models"
MODELS_YAML="${REPO_DIR}/models.yaml"

echo "=== Mac LLM Node Setup ==="

# ─── Brew ─────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
brew bundle --file="${REPO_DIR}/Brewfile"

# ─── Python venv ──────────────────────────────────────────────────
echo "Creating venv..."
cd "$REPO_DIR"
uv venv "$VENV_DIR"
uv pip install --python "${VENV_DIR}/bin/python" -e ".[vllm]"

# ─── Whisper model ────────────────────────────────────────────────
mkdir -p "$MODELS_DIR"
if [ ! -f "${MODELS_DIR}/ggml-large-v3-turbo.bin" ]; then
  echo "Downloading whisper large-v3-turbo model..."
  curl -L -o "${MODELS_DIR}/ggml-large-v3-turbo.bin" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
fi

# ─── Read models.yaml for dynamic stamping ────────────────────────
# We use the venv python here so pyyaml from pyproject.toml is on the
# path; falling back to system python3 only as a last resort.
PYTHON="${VENV_DIR}/bin/python"
[ -x "$PYTHON" ] || PYTHON=python3

echo "Reading models.yaml..."
eval "$(${PYTHON} -c "
import yaml
with open('${MODELS_YAML}') as f:
    cfg = yaml.safe_load(f)

ollama_port = cfg['ollama']['port']
print(f'OLLAMA_PORT={ollama_port}')

# vLLM URLs for Open WebUI — instances list may be empty when MLX
# serving is disabled (current default; vllm-mlx upstream thread bug).
instances = (cfg.get('vllm') or {}).get('instances') or []
urls = ';'.join(f'http://127.0.0.1:{i[\"port\"]}/v1' for i in instances)
keys = ';'.join('not-needed' for _ in instances)
print(f'VLLM_URLS=\"{urls}\"')
print(f'VLLM_KEYS=\"{keys}\"')
")"

# ─── Stamp and install launchd plists ─────────────────────────────
mkdir -p /Users/Shared/open-webui
for plist in "${REPO_DIR}"/launchd/*.plist; do
  name="$(basename "$plist")"
  dest="${HOME}/Library/LaunchAgents/${name}"
  launchctl unload "$dest" 2>/dev/null || true
  sed -e "s|__VENV__|${VENV_DIR}|g" \
      -e "s|__MODELS__|${MODELS_DIR}|g" \
      -e "s|__REPO__|${REPO_DIR}|g" \
      -e "s|__OLLAMA_PORT__|${OLLAMA_PORT}|g" \
      -e "s|__VLLM_URLS__|${VLLM_URLS}|g" \
      -e "s|__VLLM_KEYS__|${VLLM_KEYS}|g" \
      "$plist" >| "$dest"
  launchctl load "$dest"
  echo "Installed: ${name}"
done

# ─── Ollama models (from models.yaml) ────────────────────────────
# Delegate to scripts/download-models.py so we get parallel pulls and
# the merge-gguf strategy for sharded GGUF entries (Behemoth-X etc.)
# in one command. We use the venv python so huggingface_hub from
# pyproject.toml is on the path for any merge-gguf entries.
echo "Pulling Ollama models (parallel, see scripts/download-models.py)..."
"${PYTHON}" "${REPO_DIR}/scripts/download-models.py" \
  --concurrency "${OLLAMA_PULL_CONCURRENCY:-2}"

# ─── Generate litellm config ──────────────────────────────────────
echo "Generating litellm config..."
python3 "${REPO_DIR}/scripts/gen-litellm.py"

echo ""
echo "=== Done ==="
echo "  task health    # check services"
echo "  task test      # run test suite"
echo "  task models    # list all models"
