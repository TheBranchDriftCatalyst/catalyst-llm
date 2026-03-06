# Claw Orchestrator — Multi-Agent Architecture

> A hierarchical AI agent system built on OpenClaw for autonomous software engineering, deployed on Kubernetes (Talos cluster) with LiteLLM model routing and Beads issue tracking.

## Overview

Claw Orchestrator implements a **23-agent hierarchy** organized into 7 teams that execute two major operational loops:

1. **Planning Loop** — Feature idea → Product design → Use cases → Requirements → Architecture → Implementation tickets
2. **Development Loop** — Ticket → Implementation → QA → Security scan → PR review → Merge → Reflection

The system uses **Reflexion-style memory** to learn from every task execution, storing episodic reflections and promoting recurring patterns to persistent memory.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DJ (Human Operator)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  L1: PersonalAssistant                                          │
│  Human-facing interface, conversation management                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  L2: AICoordinator + IntentModelAgent                           │
│  Strategic routing, intent analysis, Alpha/Bravo cluster mgmt   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  L3: RepoControlAI                                              │
│  Ticket lifecycle, PR workflow, task routing, gate enforcement   │
└───┬──────────┬──────────┬──────────┬──────────┬────────────┬────┘
    │          │          │          │          │            │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼────┐ ┌─────▼──┐
│Planning│ │  Dev  │ │  QA   │ │ Sec   │ │  Gov   │ │Learning│
│ Team   │ │ Team  │ │ Team  │ │ Team  │ │ Team   │ │ Team   │
│(4 agts)│ │(4 agts│ │(4 agts│ │(2 agts│ │(2 agts)│ │(3 agts)│
└────────┘ └───────┘ └───────┘ └───────┘ └────────┘ └────────┘
```

## Agent Teams

### Core (L1-L3) — Opus model tier
| Agent | Role | Heartbeat |
|-------|------|-----------|
| PersonalAssistant | Human interface, message routing | 15 min |
| AICoordinator | Goal decomposition, cluster routing | 30 min |
| IntentModelAgent | User intent modeling, constraint extraction | On-demand |
| RepoControlAI | Ticket lifecycle, PR management, gate enforcement | 30 min |

### Planning Team (L4) — Sonnet model tier
| Agent | Role | Input | Output |
|-------|------|-------|--------|
| ProductDesignerAgent | Product concepts, user stories | Feature goals | `docs/product/` |
| UseCaseModelingAgent | User journeys, flow diagrams | Product docs | `docs/product/use_cases/` |
| RequirementsArchitectAgent | Technical specs, acceptance criteria | Use case docs | `docs/specs/` |
| ArchitecturePlannerAgent | System design, ADRs, interface contracts | Spec docs | `docs/architecture/` |

### Development Team (L4) — Sonnet model tier
| Agent | Role | Artifacts |
|-------|------|-----------|
| DeveloperAgent | Primary code implementation | `src/*`, `tests/*` |
| FrontendDesignAgent | React/UI components, Storybook | `src/ui/*`, `stories/*` |
| BackendAgent | APIs, services, data access | `src/api/*`, `services/*` |
| InfrastructureAgent | K8s manifests, Tiltfiles, CI/CD | `infra/*`, `k8s/*` |

### QA Team (L4) — Haiku model tier (execution), Sonnet (planning)
| Agent | Role | Artifacts |
|-------|------|-----------|
| QAPlanningAgent | Test strategy, plan creation | `docs/qa/test_plans/` |
| QAUnitTestAgent | Unit test writing, coverage | `tests/unit/*` |
| QAIntegrationAgent | Integration tests, API contracts | `tests/integration/*` |
| PlaywrightTestAgent | E2E tests, visual regression | `tests/e2e/*` |

### Security Team (L4)
| Agent | Role | Artifacts |
|-------|------|-----------|
| SecurityAgent | OWASP scanning, CVE audits | `security/scans/` |
| PromptInjectionAgent | Input sanitization, injection detection | `security/injection_log/` |

### Governance Team (L4)
| Agent | Role | Artifacts |
|-------|------|-----------|
| PRReviewAgent | Code review, standards enforcement | `reviews/*` |
| DocumentationAgent | Doc maintenance, API docs | `docs/*` |

### Learning Team (L4)
| Agent | Role | Artifacts |
|-------|------|-----------|
| ReflectionAgent | Post-task self-critique, episodic memory | `memory/reflections/` |
| MemoryCuratorAgent | Memory compression, pattern promotion | `MEMORY.md` |
| ExperimentationAgent | Hypothesis testing, A/B experiments | `experiments/` |

## Two-Loop System

### Loop 1: Planning
```
DJ → PersonalAssistant → AICoordinator → IntentModelAgent
                                      → RepoControlAI
                                        → ProductDesigner
                                          → UseCaseModeling
                                            → RequirementsArchitect
                                              → ArchitecturePlanner
                                                → Implementation tickets created
```

### Loop 2: Development
```
RepoControlAI assigns ticket → DeveloperAgent implements
  → QA gate (unit + integration + e2e)
    → Security gate (OWASP + CVE scan)
      → Review gate (PR review)
        → Merge → ReflectionAgent analyzes
          → MemoryCuratorAgent promotes learnings
```

### Failure Recovery
Any gate failure loops back to the DeveloperAgent with specific feedback. The ReflectionAgent captures the failure mode for future prevention.

## Reflexion Memory System

The system implements [Reflexion](https://arxiv.org/abs/2303.11366) — verbal reinforcement learning for agents:

1. **Episodic**: Each task produces a reflection entry in `memory/reflections/`
2. **Curation**: MemoryCuratorAgent promotes recurring patterns (>2 occurrences) to `MEMORY.md`
3. **Retrieval**: Before each task attempt, agents read relevant reflections via memory search
4. **Compression**: Old reflections are summarized, never deleted

## Cluster Model

| Cluster | Purpose | Gate |
|---------|---------|------|
| **Alpha** (Stable) | Production features, bug fixes, infra | PR + QA + Security pass required |
| **Bravo** (Development) | Experiments, agent tuning, new capabilities | Fast iteration, lower gate requirements |

AICoordinator routes work to the appropriate cluster based on risk and type.

## Ticket Lifecycle

```
DISCOVERY → PLANNING → DEVELOPMENT → QA → SECURITY → REVIEW → MERGED → DEPLOYED
                          ↑           │       │          │
                          └───────────┴───────┴──────────┘
                              (failure loops back)
```

## Infrastructure

- **Orchestrator**: OpenClaw (`alpine/openclaw:latest`)
- **LLM Proxy**: LiteLLM (model routing, cost tracking)
- **Cluster**: Kubernetes on Talos
- **GitOps**: ArgoCD
- **Issue Tracking**: Beads (`bd` commands)
- **Namespace**: `catalyst-llm`

## Phased Rollout

| Phase | Goal | Status |
|-------|------|--------|
| **1: Scaffold** | Directory structure, SOUL.md stubs, beads issues | **Current** |
| 2: Core Loop | PA → Coordinator → RepoControl → Developer E2E | Planned |
| 3: Reflexion | ReflectionAgent + MemoryCuratorAgent wired up | Planned |
| 4: Full Teams | All L4 agents active, both loops wired | Planned |
| 5: Governance | Alpha/Bravo routing, PR review enforcement | Planned |
| 6: UI Sidecar | React + D3 visualization of beads DAG | Future |

## Key References

- [AgentMesh: Multi-Agent SWE Framework](https://arxiv.org/abs/2507.19902)
- [TOM-SWE: User Mental Modeling](https://arxiv.org/abs/2510.21903)
- [Agyn: Team-Based Autonomous SWE](https://arxiv.org/abs/2602.01465)
- [Reflexion: Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)

## Quick Start

```bash
# Check current state
tree openclaw-beta/agents/ -L 2

# View an agent's identity
cat openclaw-beta/agents/personal-assistant/SOUL.md

# View ticket workflow SOPs
ls openclaw-beta/sops/ticket-workflow/

# Check beads issues for scaffold work
bd list --status=open
```

## See Also

- `INDEX.md` — Complete file index with descriptions
- `SOUL.md` — Gateway identity
- `AGENTS.md` — Global operating instructions
- `USER.md` — Operator identity (DJ)
