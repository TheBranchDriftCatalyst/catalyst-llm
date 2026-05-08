# Changelog

All notable changes to the RunPod inference pod.

## [0.0.3] — 2026-04-30

### Bug Fixes

- Taskfile yaml quoting and GHCR-only push

### Features

- Add community/bleeding-edge models — qwen3.6, gemma4, abliterated, unsloth quants
- Move runpod tasks to sub-taskfile, add changelog generation, add community models to mac-node
- Add finance models (Plutus, FinGPT) and 200B+ quantized MoE tier
- Push to both GHCR and Docker Hub — RunPod pulls Docker Hub faster

### Refactoring

- Derive all pull scripts from models.yaml single source of truth

## [0.0.2] — 2026-04-29

### Features

- Add SUICIDE_TTL auto-shutdown watchdog and service enable/disable toggles

### Miscellaneous

- Default ENABLE_COMFYUI to false

## [0.0.1] — 2026-04-29

### Bug Fixes

- Runpod build uses buildx with linux/amd64 platform
- Add zstd dep required by ollama installer
- Drop registry cache-to on push to avoid scope issues

### Miscellaneous

- Initial commit: mac-node bare-metal LLM inference node

M5 Max-based inference node with Ollama, vLLM-MLX, Open WebUI,
Whisper, and RunPod GPU pod configuration for NVIDIA hardware.

Includes launchd services, k8s external service manifests,
model registry, dashboard, and full test suite.

### Performance

- Dockerfile layer caching + buildx registry cache

