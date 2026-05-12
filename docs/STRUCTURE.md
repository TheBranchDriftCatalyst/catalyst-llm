# Module Layout

Snapshot of the catalyst-llm repo's intentional structure. Captures
decisions made during the DRY refactor epic (beads `llm-doh`) so future
contributors don't relitigate them.

## Top-level

```
packages/        Service code (Python + TypeScript)
  catalyst-langgraph/    LangGraph agent runtime (FastAPI; SSE event stream)
  catalyst-llm-sdk/      TS client SDK + React components + playground
  tool-host/             FastAPI sidecar — tool execution surface
  mac-node/              Local M-series Mac inference (Ollama + MLX + shims)
    services/comfyui-shim/  FastAPI shim for ComfyUI image gen
    services/mflux-shim/    FastAPI shim for MFlux (Flux.1-schnell)
  openclaw/        Obsidian-style knowledge vault (markdown — not buildable)
k8s/             Kubernetes manifests
  base/                  Host-agnostic baseline
    claw-runtime/  Deployed agent runtime (Composio-backed; opt-in per env)
  local/                 k3d dev overlay
  talos00/               Talos prod overlay
docker/          Build contexts for remote / GPU deploys (runpod, runpod-vllm)
tilt/            Shared Tilt helpers (common.tiltfile)
Tiltfile         Dev rail: k3d + native Ollama + chat UIs
tilt-ops/        Prod ops rail (read-only port-forwards + Argo CD buttons)
taskfiles/       Shared Taskfile fragments (test-contract.yml)
tests/snapshots/ Committed kustomize renders — regression gate
```

## Conventions

- **Test contract** — every buildable package's `Taskfile.yaml` includes
  `taskfiles/test-contract.yml` (with `flatten: true`) to inherit `default`
  + `test` alias. Each package keeps its own `test:lint`/`unit`/`smoke`/
  `full` because the actual toolchains diverge (uv, vitest, bash).
- **k8s regression gate** — `task test:snapshots` diffs current
  `kubectl kustomize` output against `tests/snapshots/k8s-{local,talos00}.yaml`.
  Refresh via `task snapshots:render` when manifests intentionally change.
- **Tilt rails** — root `Tiltfile` (dev) and `tilt-ops/Tiltfile` (prod ops)
  are intentionally separate. Do not unify them — they encode different
  control intents (auto-rebuild vs manual triggers).

## Naming distinctions worth knowing

- `packages/openclaw/` — the local **knowledge vault** (Obsidian agent
  contexts, prompt patterns, memory). Markdown only.
- `k8s/base/claw-runtime/` — the **deployed agent runtime** (Composio-
  backed container, k8s manifests). Was named `openclaw/` until
  `llm-doh.9`; renamed to disambiguate from the vault.

## Deferred decisions (epic llm-doh)

These were considered by the SDLC council and intentionally pushed out:

| Decision | Why deferred |
|---|---|
| Promote `mac-node/services/*` (comfyui-shim, mflux-shim) to first-class `packages/*` | Only 2 services today — Red Team correctly flagged it as taxonomy churn. Revisit when a 3rd mac-only service emerges. |
| Add SSE replay test for `/api/chat/stream` | Cheap to add but not blocking. File a follow-up bd issue if/when SSE wire shape drifts. |
| Further split `catalyst-langgraph/server/__init__.py` (still ~925 lines) | Most of the remaining size is `_produce_agent_events` + Pydantic response models — touching either risks the cancel signal bus / depth-aware routing / OpenAPI shape. Defer until a concrete need surfaces. |
| Shared `catalyst-core` Python package for FastAPI boilerplate | Rejected outright. 4 services × ~30 LOC of boilerplate each isn't enough duplication to justify the maintenance overhead. |

See `bd show llm-doh` for the full council deliberation transcript.
