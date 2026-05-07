# comfyui-shim

OpenAI-compatible `/v1/images/generations` surface in front of a local
ComfyUI instance. Translates an OpenAI request into a ComfyUI workflow,
queues it, watches the WebSocket for completion, and returns the image
bytes as `b64_json` (or a `data:` URL).

## Architecture

```
client (LiteLLM, image-sorter, curl, etc.)
    │ POST /v1/images/generations  {model, prompt, n, size, ...}
    ▼
comfyui-shim  (FastAPI :8012)
    │ workflow JSON (ComfyUI API format)
    ▼
ComfyUI       (:8188)
    └─> Flux Dev / Schnell + 4x ESRGAN upscale
```

The shim is intentionally thin — it owns:
* request shape (OpenAI `images/generations` schema, validated by Pydantic),
* pipeline templates (workflow JSON files, parameter substitution),
* ComfyUI client (queue → WS-watch → fetch),
* optional bearer-token auth (`SHIM_API_KEY`).

It does NOT own:
* model files (operator manages `ComfyUI/models/...`),
* GPU scheduling (ComfyUI handles it),
* persistence beyond ComfyUI's own outputs dir.

## Pipelines

| Name | Alias | Steps | Output | Approx |
|---|---|---|---|---|
| `flux-dev-pro` | `flux-pro` | 28 euler, 4x upscale → 2048px | high quality | ~35s |
| `flux-schnell-fast` | `flux-fast` | 4 euler, 1024×1024 | quick draft | ~6s |

Pipeline files live in `pipelines/*.json` — each is a ComfyUI API-format
workflow with an extra `_meta` block that maps OpenAI request fields onto
node inputs (e.g. `"prompt": "$nodes.6.inputs.text"`).

Add a new preset:
1. Drop `pipelines/<name>.json` (clone an existing one).
2. Set `_meta.name` and the parameter paths.
3. Add to `packages/mac-node/models.yaml` under `image_gen.pipelines`.
4. `cd packages/mac-node && python3 scripts/gen-litellm.py` — splices it into
   the LiteLLM config under `mac/<alias>`.

## Operator install (one-time)

### 1. Install ComfyUI

```bash
cd ~/local
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Pull weights

| File | Path under `ComfyUI/models/` | Size |
|---|---|---|
| `flux1-dev-fp8.safetensors` | `diffusion_models/` | ~12GB |
| `flux1-schnell-fp8.safetensors` | `diffusion_models/` | ~12GB |
| `t5xxl_fp8_e4m3fn.safetensors` | `clip/` | ~5GB |
| `clip_l.safetensors` | `clip/` | ~250MB |
| `ae.safetensors` (Flux VAE) | `vae/` | ~330MB |
| `4x-UltraSharp.pth` | `upscale_models/` | ~67MB |

Sources: [black-forest-labs/FLUX.1-dev](https://huggingface.co/black-forest-labs/FLUX.1-dev),
[black-forest-labs/FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell),
[comfyanonymous/flux_text_encoders](https://huggingface.co/comfyanonymous/flux_text_encoders),
[Kim2091/UltraSharp](https://huggingface.co/Kim2091/UltraSharp).

### 3. Install the shim

```bash
cd packages/mac-node/services/comfyui-shim
uv sync
# Test in foreground first:
COMFYUI_BASE=http://127.0.0.1:8188 uv run comfyui-shim
```

### 4. Wire launchd

Both plists in `packages/mac-node/launchd/` use placeholder tokens — substitute
them with `sed` (or your Ansible bootstrap):

```bash
sed -i '' \
  -e "s|__COMFYUI_HOME__|$HOME/local/ComfyUI|g" \
  -e "s|__COMFYUI_VENV__|$HOME/local/ComfyUI/.venv|g" \
  -e "s|__VENV__|$HOME/local/comfyui-shim/.venv|g" \
  -e "s|__SHIM_HOME__|$HOME/local/comfyui-shim|g" \
  packages/mac-node/launchd/com.comfyui.server.plist \
  packages/mac-node/launchd/com.comfyui-shim.plist

cp packages/mac-node/launchd/com.comfyui.server.plist ~/Library/LaunchAgents/
cp packages/mac-node/launchd/com.comfyui-shim.plist   ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.comfyui.server.plist
launchctl load ~/Library/LaunchAgents/com.comfyui-shim.plist
```

### 5. Verify

```bash
curl -s http://localhost:8012/healthz | jq
# {"ok": true, "comfyui_reachable": true, "pipelines": ["flux-dev-pro", "flux-schnell-fast"]}

curl -s http://localhost:8012/v1/images/generations \
  -H 'Content-Type: application/json' \
  -d '{"model":"flux-schnell-fast","prompt":"a green apple","size":"1024x1024","response_format":"b64_json"}' \
  | jq -r '.data[0].b64_json' | base64 -d > out.png
open out.png
```

Then through LiteLLM:

```bash
curl -s http://localhost:4000/v1/images/generations \
  -H "Authorization: Bearer $LITELLM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"mac/flux-pro","prompt":"a synthwave city at dusk","size":"1024x1024"}'
```

## API surface

| Endpoint | Notes |
|---|---|
| `POST /v1/images/generations` | OpenAI-compatible. Required: `model`, `prompt`. Optional: `n` (1-4), `size` (must be ×16 multiples), `response_format` (`b64_json` default; `url` returns a `data:` URL), `seed`, `guidance` |
| `GET  /v1/models` | Lists available pipelines |
| `GET  /healthz` | `{ok, comfyui_reachable, pipelines}` |

## Env

| Var | Default |
|---|---|
| `COMFYUI_BASE` | `http://127.0.0.1:8188` |
| `SHIM_HOST` | `0.0.0.0` |
| `SHIM_PORT` | `8012` |
| `PIPELINES_DIR` | `<repo>/services/comfyui-shim/pipelines` |
| `REQUEST_TIMEOUT` | `300` (sec) |
| `SHIM_API_KEY` | (empty — auth disabled) |
