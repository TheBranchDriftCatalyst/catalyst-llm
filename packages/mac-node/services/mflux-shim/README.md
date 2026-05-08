# mflux-shim

OpenAI-compatible `/v1/images/generations` surface in front of
[mflux](https://github.com/filipstrand/mflux) — an MLX-native FLUX
runner for Apple Silicon. Replaces the older `comfyui-shim` for
personal-stack image generation.

## Why this over comfyui-shim

ComfyUI is overkill for a personal stack. We don't run LoRA stacks,
custom nodes, or workflow chains — we want one prompt → one image.
mflux drops most of those moving parts:

| | comfyui-shim | mflux-shim |
|---|---|---|
| Engine | ComfyUI (Python) + workflow JSON | mflux (MLX-native) |
| Per-request boot | Queue → WebSocket → fetch | In-process call |
| Model load on M5 Max | ~60s + GUI overhead | ~30s into shared MLX state |
| Files on disk | ComfyUI install + models + workflows | mflux pip + cached weights |
| LoRA / control nets | Yes | Not yet |
| Speed (Flux dev, 1024²) | ~35s | ~12-18s |

For full Comfy power-user features (LoRAs, custom workflows,
controlnets), keep the comfyui-shim around — it lives next to this
service and is the same OpenAI contract. Use mflux-shim as the daily
driver and switch to comfyui-shim when you need workflow flexibility.

## Architecture

```
client (LiteLLM, playground, curl)
    │ POST /v1/images/generations  {model, prompt, n, size, ...}
    ▼
mflux-shim   (FastAPI :8012)
    │ Flux1.generate_image()  (MLX kernel, blocks the GPU)
    ▼
mflux         (Python)
    └─> ~/.cache/mflux/<alias>/<weights>
```

The shim is intentionally thin — it owns:
- request validation (OpenAI `images.generations` schema, Pydantic),
- a single in-memory `Flux1` instance kept alive across requests,
- request serialization (one MLX dispatch at a time),
- optional bearer auth via `SHIM_API_KEY`.

It does NOT own:
- pipeline workflow templates (we run a single alias per shim — start
  another shim on a different port if you want a second model loaded),
- model weights (mflux fetches and caches them on first generate).

## Operator install (one-time)

```bash
cd packages/mac-node/services/mflux-shim
uv sync                                  # installs mflux + fastapi etc.
.venv/bin/mflux-shim                     # foreground sanity check
```

The first request triggers a ~30s weight download for `dev-krea`
(the May 2026 SOTA pick — FLUX.1 Krea Dev). Subsequent restarts load
from `~/.cache/mflux/` in ~25-30s.

## Run via launchd (autostart)

A plist template ships at
`packages/mac-node/launchd/com.mflux-shim.plist.tmpl`. Render it with
your absolute paths and install:

```bash
# from repo root
sed "s|@WORKSPACE@|$(pwd)|g" \
  packages/mac-node/launchd/com.mflux-shim.plist.tmpl \
  > ~/Library/LaunchAgents/com.mflux-shim.plist
launchctl unload ~/Library/LaunchAgents/com.mflux-shim.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.mflux-shim.plist
launchctl list | grep mflux-shim
```

The shim's stdout/stderr are written to
`~/Library/Logs/mflux-shim.{out,err}.log`.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `SHIM_HOST` | `0.0.0.0` | bind address |
| `SHIM_PORT` | `8012` | bind port (matches comfyui-shim's old port) |
| `SHIM_API_KEY` | unset | optional bearer-token auth |
| `MFLUX_MODEL` | `dev-krea` | mflux alias (`dev`, `schnell`, `dev-krea`, custom) |
| `MFLUX_QUANTIZE` | `8` | int 4 / 6 / 8 — quantization for the loaded weights |
| `MFLUX_CACHE_DIR` | `~/.cache/mflux` | weight cache dir |
| `MFLUX_DEFAULT_STEPS` | `20` | inference steps when request omits |
| `MFLUX_DEFAULT_GUIDANCE` | `3.5` | guidance scale when request omits |
| `MFLUX_MAX_CONCURRENCY` | `1` | semaphore size; >1 just thrashes Metal |

## Test it

```bash
# liveness
curl -s http://127.0.0.1:8012/healthz

# list (single entry)
curl -s http://127.0.0.1:8012/v1/models | jq

# generate
curl -s http://127.0.0.1:8012/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
        "model": "dev-krea",
        "prompt": "a synthwave skyline at dusk, neon palms, 1980s aesthetic",
        "size": "1024x1024",
        "n": 1,
        "steps": 20
      }' | jq -r '.data[0].b64_json' | base64 -d > /tmp/out.png
open /tmp/out.png
```

## Wire into LiteLLM

`packages/mac-node/models.yaml` now exposes an `image_gen.engine: mflux`
block. Run `python3 packages/mac-node/scripts/gen-litellm.py` to splice
the shim into `k8s/base/litellm/config.yaml` as `mac/flux-krea` (or
whichever alias you set).

LiteLLM clients then call `/v1/images/generations` with `model:
mac/flux-krea` and the proxy forwards it to this shim.

## Rolling back to comfyui-shim

The two shims are interchangeable on the wire. Stop one, start the
other on the same port (`8012`), and update the `image_gen.engine`
field in `models.yaml`. Pipelines defined for ComfyUI workflows live
in `packages/mac-node/services/comfyui-shim/pipelines/*.json`.
