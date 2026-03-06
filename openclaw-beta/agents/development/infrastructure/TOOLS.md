# InfrastructureAgent — Tool Access

## Authorized Tools
- **Beads**: Full read, update own tasks
- **File Read**: All workspace files
- **File Write**: `infra/*`, `k8s/*`, `tilt/*`, Tiltfile, `agents/development/infrastructure/memory/`
- **Shell**: Full access — kubectl, tilt, helm, kustomize, argocd CLI
- **Git**: Branch management, commit, push (to feature branches only)

## Shell Commands (Authorized)
- `kubectl` — Kubernetes management
- `tilt` — Local development orchestration
- `kustomize` — Manifest generation
- `argocd` — GitOps deployment management
- `helm` — Chart management

## Restricted
- No application code modifications
- No direct production deployments (must go through PR)
- No secret value access (use sealed secrets / external secrets operator)
