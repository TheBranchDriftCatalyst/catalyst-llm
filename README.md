# Catalyst LLM

> **Status:** Local Development Only
> **Runtime:** Docker Compose on local machine (NOT on cluster)

Self-hosted uncensored LLM stack running locally with web search, MCP tools, and multiple chat UIs. The Talos cluster nodes are too small for LLM workloads - this runs on your development machine instead.

---

## KUBERNETES DEPLOYMENT - NOT YET COMPLETE

> **The `k8s/` directory contains preliminary Kubernetes manifests that are NOT ready for deployment.**
>
> **Blockers:**
> - Awaiting AWS EC2 GPU instance access
> - Hybrid cluster architecture not yet finalized
> - Ollama needs a GPU node (current Talos single-node has no GPU)
>
> **What's in `k8s/`:**
> - Base manifests for Open WebUI, LobeChat, SillyTavern, SearXNG
> - Traefik IngressRoutes for `*.talos00` hostnames
> - ArgoCD Application manifest (copy to talos-homelab when ready)
> - ConfigMaps for service configuration
>
> **TODO before deploying:**
> 1. Set up AWS EC2 GPU instance with Ollama
> 2. Configure hybrid cluster networking (Talos + EC2)
> 3. Update `OLLAMA_BASE_URL` in ConfigMap to point to EC2 Ollama
> 4. Copy `k8s/argocd-application.yaml` to `talos-homelab/infrastructure/base/argocd/applications/`
> 5. Test and validate manifests
>
> **For now, use Docker Compose locally (see below).**

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      LOCAL MACHINE (Your Mac)                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│   │  Open WebUI │  │  LobeChat   │  │ SillyTavern │  │  SearXNG   │ │
│   │  :3030      │  │  :3210      │  │  :8000      │  │  :8888     │ │
│   │  Chat+RAG   │  │  Plugins    │  │  Roleplay   │  │  Search    │ │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘ │
│          │                │                │                │        │
│          └────────────────┼────────────────┘                │        │
│                           │                                 │        │
│                           ▼                                 │        │
│   ┌───────────────────────────────────────┐                │        │
│   │         LiteLLM (Proxy)               │◄───────────────┘        │
│   │         localhost:4000                │                          │
│   │   Unified API for all LLM providers   │                          │
│   └───────────────┬───────────────────────┘                          │
│                   │                                                  │
│         ┌─────────┼─────────┬─────────────────┐                      │
│         ▼         ▼         ▼                 ▼                      │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│   │ Ollama   │ │ OpenAI   │ │Anthropic │ │  Other   │               │
│   │ :11434   │ │ (cloud)  │ │ (cloud)  │ │ Providers│               │
│   │ (native) │ │          │ │          │ │          │               │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘               │
│                                                                       │
│   Models: dolphin-mistral, llama3.2, gpt-4o, claude-sonnet-4, etc.   │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
cd workspace/catalyst-llm

# Start the stack
docker compose up -d

# Or use Tilt for better UX
tilt up

# Pull a model (first time)
ollama pull dolphin-mistral:7b

# Access the UIs
open http://localhost:3030   # Open WebUI (chat + web search)
open http://localhost:3210   # LobeChat (modern UI + plugins)
open http://localhost:8000   # SillyTavern (roleplay)
open http://localhost:8888   # SearXNG (search engine)
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| Open WebUI | 3030 | General chat, RAG, web search |
| LobeChat | 3210 | Modern UI with plugin ecosystem |
| SillyTavern | 8000 | Roleplay with character cards |
| SearXNG | 8888 | Privacy-focused metasearch |
| LiteLLM | 4000 | OpenAI-compatible proxy (Ollama + cloud) |
| Ollama | 11434 | LLM inference (native, Metal GPU) |

## Commands

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f

# Pull new model
ollama pull <model-name>

# List models
ollama list

# Chat via CLI
ollama run dolphin-mistral:7b

# Remove everything (including data)
docker compose down -v
```

## Recommended Models

### For Your Mac (Apple Silicon)

| Model | Size | RAM Needed | Quality | Speed |
|-------|------|-----------|---------|-------|
| `dolphin-phi` | 1.6GB | 4GB | Basic | ⚡ Fast |
| `llama2-uncensored:7b` | 3.8GB | 8GB | Good | Fast |
| `mistral:7b` | 4.1GB | 8GB | Great | Fast |
| `dolphin-mistral:7b` | 4.1GB | 8GB | Great + Uncensored | Fast |
| `wizardlm-uncensored:13b` | 7.4GB | 16GB | Better | Medium |
| `dolphin-mixtral:8x7b` | 26GB | 32GB | Excellent | Slower |

**Apple Silicon Note:** Ollama uses Metal acceleration automatically. Models run surprisingly fast on M1/M2/M3.

### Pull Commands

```bash
# Quick test (small)
docker exec -it ollama ollama pull dolphin-phi

# Daily driver (recommended)
docker exec -it ollama ollama pull dolphin-mistral:7b

# High quality (if you have 32GB+ RAM)
docker exec -it ollama ollama pull dolphin-mixtral:8x7b
```

## Directory Structure

```
catalyst-llm/
├── README.md              # This file
├── Tiltfile               # Local dev with Tilt (Docker Compose mode)
├── docker-compose.yaml    # Local stack definition
├── .env                   # Environment config
├── data/                  # Persistent data (gitignored)
│   ├── ollama/           # Model weights (local only)
│   └── open-webui/       # Chat history, users
├── config/               # Service configurations
│   ├── searxng/          # SearXNG search engine config
│   ├── litellm/          # LiteLLM proxy config
│   └── sillytavern-config.yaml
├── scripts/
│   ├── pull-models.sh    # Batch download models
│   ├── ollama-serve.sh   # Start native ollama
│   └── backup.sh         # Backup chat history
├── k8s/                  # [WIP] Kubernetes manifests for cluster deployment
│   ├── kustomization.yaml
│   ├── argocd-application.yaml  # Copy to talos-homelab when ready
│   └── base/
│       ├── namespace.yaml
│       ├── configmap.yaml
│       ├── ingressroute.yaml
│       ├── open-webui-deployment.yaml
│       ├── lobe-chat-deployment.yaml
│       ├── sillytavern-deployment.yaml
│       └── searxng-deployment.yaml
└── docs/
    └── MODELS.md         # Detailed model comparison
```

## Configuration

Edit `.env` to customize:

```bash
# Ports
OLLAMA_PORT=11434
WEBUI_PORT=3030

# Resource limits (optional)
OLLAMA_MAX_MEMORY=16g
```

## Web Search

Open WebUI integrates with SearXNG for web search capabilities:

1. **Enable in Open WebUI**: Toggle "Web Search" in the chat interface
2. **Direct access**: Visit http://localhost:8888 for the SearXNG UI
3. **How it works**: When enabled, the LLM can search the web and include results in responses

The search aggregates results from Google, Bing, DuckDuckGo, Brave, GitHub, StackOverflow, and more.

## LiteLLM - Unified LLM Proxy

LiteLLM provides a unified OpenAI-compatible API for all LLM providers:

| Provider | Models | Configuration |
|----------|--------|---------------|
| Ollama (local) | dolphin-mistral, llama3.2, mistral | Auto-configured |
| OpenAI | gpt-4o, gpt-4o-mini | Set `OPENAI_API_KEY` |
| Anthropic | claude-sonnet-4, claude-opus-4 | Set `ANTHROPIC_API_KEY` |

**Usage**: All UIs connect through LiteLLM at `localhost:4000`. Cloud models require API keys in `.env`.

**Configuration**: Edit `config/litellm/config.yaml` to add/remove models.

**UI**: Access the LiteLLM admin UI at http://localhost:4000/ui

## LobeChat Features

LobeChat provides a modern alternative to Open WebUI with:
- Plugin marketplace (web browsing, code interpreter, etc.)
- File/image upload and analysis
- Multi-modal support
- Knowledge base management
- Modern UI/UX

Access at http://localhost:3210

## Tilt Integration (Recommended)

Use Tilt for the best development experience:

```bash
tilt up
```

This gives you:
- Web UI at localhost:10350
- Log streaming for all services
- One-click model management
- Service health monitoring
- Quick action buttons

## Future: Hybrid Cluster Deployment

The planned architecture uses a **hybrid cluster** setup:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HYBRID CLUSTER                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────────────┐      ┌─────────────────────────────┐  │
│   │    TALOS HOMELAB        │      │      AWS EC2 (GPU)          │  │
│   │    (192.168.1.54)       │      │                             │  │
│   │                         │      │   ┌─────────────────────┐   │  │
│   │  - Open WebUI           │ ───► │   │  Ollama + GPU       │   │  │
│   │  - LobeChat             │      │   │  (CUDA/ROCm)        │   │  │
│   │  - SillyTavern          │      │   │                     │   │  │
│   │  - SearXNG              │      │   │  Models:            │   │  │
│   │  - Traefik (ingress)    │      │   │  - dark-champion    │   │  │
│   │  - ArgoCD               │      │   │  - dolphin-mixtral  │   │  │
│   │                         │      │   │  - gemma3-abliterated│  │  │
│   └─────────────────────────┘      │   └─────────────────────┘   │  │
│                                     │                             │  │
│                                     └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**When ready to deploy:**

1. Set up AWS EC2 GPU instance with Ollama
2. Configure networking (VPN/Tailscale) between Talos and EC2
3. Update `k8s/base/configmap.yaml` with EC2 Ollama URL
4. Copy `k8s/argocd-application.yaml` to `talos-homelab/infrastructure/base/argocd/applications/catalyst-llm.yaml`
5. Add to kustomization and deploy via ArgoCD

**Access URLs (after deployment):**
- `http://openwebui.talos00` - Open WebUI
- `http://lobechat.talos00` - LobeChat
- `http://sillytavern.talos00` - SillyTavern
- `http://searxng.talos00` - SearXNG

## Security Notes

⚠️ **These models are UNCENSORED**

- Local only - not exposed to network
- Don't port-forward to 0.0.0.0
- You are responsible for outputs
- Keep `data/` backed up (contains chat history)

## Troubleshooting

### Ollama container keeps restarting
Check memory - model may be too large:
```bash
docker logs ollama
# Look for OOM errors
```

### Open WebUI shows "Ollama not reachable"
Ollama might still be starting:
```bash
docker exec -it ollama ollama list
# If this works, restart Open WebUI
docker compose restart open-webui
```

### Models downloading slowly
Ollama downloads from ollama.ai - speeds vary. Large models (8x7b) take 10-30 min.

### SearXNG returns 403 errors
Make sure JSON format is enabled in `config/searxng/settings.yml`:
```yaml
search:
  formats:
    - html
    - json
```

### LobeChat can't connect to Ollama
Verify LiteLLM is running and Ollama is accessible:
```bash
curl http://localhost:4000/health
curl http://localhost:11434/api/tags
```

### LiteLLM not working
Check the logs and verify config:
```bash
docker logs litellm
curl http://localhost:4000/v1/models
```

### Cloud models not available
Ensure API keys are set in `.env`:
```bash
grep -E "OPENAI_API_KEY|ANTHROPIC_API_KEY" .env
# Should show non-empty values for cloud provider access
```
