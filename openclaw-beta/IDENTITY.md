# System Identity — Claw Orchestrator

## System Name
Claw Orchestrator (codename: catalyst-llm)

## Deployment
- **Platform**: Kubernetes (Talos cluster)
- **Namespace**: catalyst-llm
- **Gateway**: OpenClaw (alpine/openclaw:latest)
- **LLM Proxy**: LiteLLM
- **GitOps**: ArgoCD
- **Issue Tracking**: Beads

## Model Routing
All LLM requests route through LiteLLM proxy. Model assignment per agent tier:
- **Heavy (Opus)**: L1-L3 core agents — complex reasoning, coordination
- **Medium (Sonnet)**: L4 task agents — implementation, review, planning
- **Light (Haiku/local)**: L4 utility agents — unit tests, scanning, curation

## Version
- Schema: 0.1.0
- Phase: 1 (Scaffold)
- Status: Alpha

## Network Topology
```
DJ (Human) → PersonalAssistant (L1) → AICoordinator (L2) → RepoControlAI (L3) → Task Agents (L4)
```
