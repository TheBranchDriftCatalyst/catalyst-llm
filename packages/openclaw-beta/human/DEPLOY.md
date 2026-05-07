# Claw Orchestrator — Deployment Guide

> How to deploy and operate the OpenClaw multi-agent system on Kubernetes (Talos cluster).

## Prerequisites

| Component | Purpose | Required |
|-----------|---------|----------|
| Kubernetes (Talos) | Cluster runtime | Yes |
| ArgoCD | GitOps deployment from this repo | Yes |
| 1Password + ExternalSecrets Operator | Secret management (ClusterSecretStore `onepassword`) | Yes |
| Traefik | Ingress controller (routes `openclaw.talos00`) | Yes |
| NFS storage class | PersistentVolumeClaim backing for `openclaw-data` | Yes |
| LiteLLM | LLM proxy (deployed in same namespace) | Yes |
| Velero | PVC backup (annotated on deployment) | Recommended |

## Repository Layout

```
catalyst-llm/
├── k8s/
│   └── base/
│       ├── openclaw/              ← OpenClaw gateway deployment
│       │   ├── configmap.yaml     ← Gateway config (agents, plugins, skills, gateway settings)
│       │   ├── deployment.yaml    ← Pod spec (init containers, env vars, volumes)
│       │   ├── external-secret.yaml ← 1Password → K8s secret mapping
│       │   ├── service.yaml       ← ClusterIP service (port 18789)
│       │   ├── ingress.yaml       ← Traefik IngressRoute
│       │   ├── pvc.yaml           ← PersistentVolumeClaim (NFS)
│       │   └── kustomization.yaml
│       └── litellm/               ← LiteLLM proxy deployment
│           ├── configmap.yaml     ← Model routing config
│           ├── deployment.yaml
│           ├── external-secret.yaml
│           └── ...
├── openclaw-beta/                 ← Agent workspace (synced to PVC)
│   ├── SOUL.md, AGENTS.md, ...   ← Gateway-level files (read by OpenClaw)
│   ├── agents/                    ← 27 agent definitions
│   ├── human/                     ← Human-facing docs (README, INDEX, DEPLOY)
│   └── ...
└── config/                        ← Additional configuration
```

## Config Strategy

OpenClaw uses a **ConfigMap → init container deep-merge → PVC** pattern:

1. **ConfigMap** (`openclaw-config`) contains infrastructure-managed settings (model defaults, plugins, skills, gateway auth, proxy config)
2. **Init container** (`merge-config`) deep-merges ConfigMap values into the PVC's `openclaw.json`
3. **OpenClaw gateway** reads `openclaw.json` from PVC at startup
4. Infrastructure values override on every deploy; user-added values in PVC are preserved

This lets ArgoCD manage infra config while the running gateway can still write runtime config to the same file.

```
ConfigMap (infra-managed)          PVC openclaw.json (persistent)
┌──────────────────────┐           ┌──────────────────────┐
│ agents.defaults      │           │ agents.defaults      │ ← overwritten
│ plugins.*            │  merge →  │ plugins.*            │ ← overwritten
│ skills.*             │           │ skills.*             │ ← overwritten
│ gateway.*            │           │ gateway.*            │ ← overwritten
└──────────────────────┘           │ agents.list[...]     │ ← preserved (user)
                                   │ custom.*             │ ← preserved (user)
                                   └──────────────────────┘
```

## Secret Management

Secrets are fetched from 1Password via the ExternalSecrets Operator.

### 1Password Item: `openclaw`

| Property | K8s Secret Key | Env Var | Used By |
|----------|---------------|---------|---------|
| `gateway-token` | `gateway-token` | `OPENCLAW_GATEWAY_PASSWORD` | Gateway auth |
| `notion-api-key` | `notion-api-key` | `NOTION_API_KEY` | Notion skill |
| `composio-api-key` | `composio-api-key` | `COMPOSIO_API_KEY` | Composio plugin |

### 1Password Item: `litellm-secrets`

| Property | K8s Secret Key | Env Var | Used By |
|----------|---------------|---------|---------|
| `master-key` | `master-key` | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | LiteLLM auth (all LLM calls) |

### Adding a New Secret

1. Add the property to the 1Password item
2. Add `secretKey` + `remoteRef` to `external-secret.yaml`
3. Add the template data mapping in `spec.target.template.data`
4. Add the env var to `deployment.yaml`
5. Commit and let ArgoCD sync

## Plugin & Skill Installation

The deployment uses two init containers that run sequentially before the main gateway:

### Init Container 1: `merge-config`
Merges ConfigMap into PVC `openclaw.json` (deep merge, infra values win).

### Init Container 2: `install-plugins-skills`
Installs external plugins and skills on the PVC. Idempotent — skips if already installed.

| Item | Type | Install Method | Location on PVC |
|------|------|---------------|-----------------|
| memory-lancedb | Plugin | Bundled with OpenClaw (config-only activation) | N/A (built-in) |
| composio | Plugin | `npm install @composio/openclaw-plugin` | `plugins/composio/` |
| capability-evolver | Skill | `git clone --depth=1` from GitHub | `skills/capability-evolver/` |
| self-improving-agent | Skill | `git clone --depth=1` from GitHub | `skills/self-improving-agent/` |

The init container also creates workspace directories for the self-improving-agent:
```
workspace/.learnings/
├── LEARNINGS.md
├── ERRORS.md
└── FEATURE_REQUESTS.md
```

All files are `chown`ed to UID 1000 (node user) after installation.

## LiteLLM Model Routing

All LLM calls are routed through the LiteLLM proxy (`http://litellm:4000`) in the same namespace.

### 4-Tier Model Strategy

| Tier | Model | Used By |
|------|-------|---------|
| Opus | `anthropic/claude-opus-4-5` | Core agents (L1-L3): PersonalAssistant, AICoordinator, IntentModelAgent, RepoControlAI |
| Sonnet | `anthropic/claude-sonnet-4-20250514` | L4 team leads + planning/dev/security agents |
| Haiku | `anthropic/claude-haiku-4-5` | L4 execution agents (QA unit/integration, PromptInjection, MemoryCurator) |
| Fallback | `openai/gpt-4o` | Automatic fallback if Anthropic is unavailable |

### Embedding Model

| Model | Purpose | Routed Via |
|-------|---------|-----------|
| `text-embedding-3-small` | memory-lancedb vector embeddings | LiteLLM proxy |

See `docs/architecture/model-routing.md` for the full model configuration.

## Deploying the Workspace

The `openclaw-beta/` directory is the agent workspace. It maps to `/home/node/.openclaw/workspace/` inside the pod via the PVC.

### Syncing Workspace to PVC

The workspace files (SOUL.md, AGENTS.md, agent definitions, etc.) need to be synced to the PVC. Use the NFS mount script:

```bash
# Mount the PVC via NFS (assumes NFS is exposed from the storage node)
./scripts/mount-openclaw-nfs.sh

# Rsync workspace to the mounted PVC
rsync -av --delete \
  --exclude='.obsidian' \
  --exclude='human/' \
  openclaw-beta/ \
  /mnt/openclaw-data/workspace/

# Unmount when done
umount /mnt/openclaw-data
```

Alternatively, use `kubectl cp`:
```bash
kubectl -n catalyst-llm cp openclaw-beta/ openclaw-<pod-id>:/home/node/.openclaw/workspace/ \
  --exclude='.obsidian' --exclude='human/'
```

**Note**: `human/` and `.obsidian/` are NOT synced to the pod — they're for local human use only.

### What Gets Synced

| Directory | Synced | Why |
|-----------|--------|-----|
| `SOUL.md`, `AGENTS.md`, `USER.md`, etc. | Yes | Gateway reads these |
| `agents/` | Yes | Agent definitions |
| `beads/`, `contexts/`, `templates/`, `sops/` | Yes | Agent workspace |
| `docs/`, `memory/`, `security/`, `experiments/` | Yes | Agent artifact dirs |
| `human/` | No | Human docs only |
| `.obsidian/` | No | Local Obsidian vault config |

## Verification

After deployment, verify everything is working:

```bash
# 1. Check pods are running
kubectl -n catalyst-llm get pods

# 2. Verify config was merged correctly
kubectl -n catalyst-llm exec deploy/openclaw -- cat /home/node/.openclaw/openclaw.json | jq '.plugins, .skills'

# 3. Check secrets synced
kubectl -n catalyst-llm get externalsecret openclaw-secrets
kubectl -n catalyst-llm get secret openclaw-secrets -o jsonpath='{.data}' | jq 'keys'

# 4. Check init container logs (plugin/skill install)
kubectl -n catalyst-llm logs deploy/openclaw -c merge-config
kubectl -n catalyst-llm logs deploy/openclaw -c install-plugins-skills

# 5. Verify plugins installed on PVC
kubectl -n catalyst-llm exec deploy/openclaw -- ls -la /home/node/.openclaw/plugins/composio/node_modules/
kubectl -n catalyst-llm exec deploy/openclaw -- ls -la /home/node/.openclaw/skills/

# 6. Verify LanceDB directory exists
kubectl -n catalyst-llm exec deploy/openclaw -- ls -la /home/node/.openclaw/lancedb/

# 7. Check gateway is responding
kubectl -n catalyst-llm port-forward svc/openclaw 18789:18789 &
curl -s http://localhost:18789/health
```

## Troubleshooting

### Init container fails: `install-plugins-skills`

**Symptom**: Pod stuck in `Init:1/2` or `Init:CrashLoopBackOff`

```bash
kubectl -n catalyst-llm logs deploy/openclaw -c install-plugins-skills
```

Common causes:
- **npm install fails**: Network policy blocking egress. Check if the pod can reach `registry.npmjs.org`.
- **git clone fails**: GitHub rate limiting or network issue. The container uses `|| true` so git failures are non-fatal.
- **Permission denied**: The init container runs as root (UID 0) and `chown`s to 1000 at the end.

### Config not applied

**Symptom**: Gateway starts but plugins/skills not active

```bash
# Check if merge-config ran
kubectl -n catalyst-llm logs deploy/openclaw -c merge-config

# Check actual config on PVC
kubectl -n catalyst-llm exec deploy/openclaw -- cat /home/node/.openclaw/openclaw.json | jq .
```

The merge is additive — if the PVC config has conflicting keys, the ConfigMap values win on each deploy.

### ExternalSecret not syncing

```bash
kubectl -n catalyst-llm describe externalsecret openclaw-secrets
```

Check:
- ClusterSecretStore `onepassword` exists and is healthy
- The 1Password item `openclaw` has all required properties
- `composio-api-key` property exists in the `openclaw` item

### LiteLLM not routing embeddings

**Symptom**: memory-lancedb fails to create embeddings

Verify LiteLLM has `text-embedding-3-small` configured:
```bash
kubectl -n catalyst-llm exec deploy/litellm -- cat /app/config.yaml | grep -A5 embedding
```

The memory-lancedb plugin uses `embeddingApiBase: http://litellm:4000` — ensure LiteLLM service is reachable within the namespace.

### Gateway can't find skills

**Symptom**: Skills listed in config but not loaded

```bash
# Check skills directory
kubectl -n catalyst-llm exec deploy/openclaw -- ls -la /home/node/.openclaw/skills/

# Check gateway logs for skill loading
kubectl -n catalyst-llm logs deploy/openclaw -c openclaw | grep -i skill
```

Ensure `skills.load.extraDirs` includes `/home/node/.openclaw/skills` and `skills.load.watch` is `true`.

## Local Development

### Obsidian Vault

The `openclaw-beta/` directory is an Obsidian vault (`.obsidian/` at root). Open it in Obsidian for visual navigation of agent definitions and documentation.

**Important**: `.obsidian/` stays at `openclaw-beta/` root — don't move it or the vault breaks.

### NFS Mount for Live Editing

For live editing of the workspace on the PVC:

```bash
# Mount NFS share
./scripts/mount-openclaw-nfs.sh

# Edit files directly on the mounted PVC
# Changes are reflected in the pod immediately (NFS)
```

### Tilt (Local K8s Development)

If using Tilt for local development:

```bash
cd k8s/
tilt up
```

See `patterns/TILTFILE.md` for Tilt conventions.
