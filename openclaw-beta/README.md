# Claw Orchestrator — Multi-Agent Architecture

> A hierarchical AI agent system built on OpenClaw for autonomous software engineering, deployed on Kubernetes (Talos cluster) with LiteLLM model routing and Beads issue tracking.

## Overview

Claw Orchestrator implements a **27-agent hierarchy** organized into 8 teams that execute two major operational loops:

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
| DeveloperAgent | Primary code implementation, team lead | `src/*`, `tests/*` |
| IndianDev | Claude Code CLI headless delegate | Source code via CLI |
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
| DocumentationAgent | Doc maintenance, API docs, team lead | `docs/*` |
| DocConsistencyAgent | Doc-code parity checking | `docs/consistency_reports/` |
| DocArchiverAgent | Progressive summarization, memory archival | `memory/archive/` |

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

## OpenClaw Ecosystem — Plugins & Skills to Investigate

Battle-tested OpenClaw extensions worth evaluating for the Claw Orchestrator. These
survived months of real usage and would slot into specific agent capabilities.

### Plugins (Gateway-Level)

| Plugin | What It Does | Relevant Agents | Priority |
|--------|-------------|-----------------|----------|
| **memory-lancedb** | Vector memory with auto-recall and capture. Set `plugins.slots.memory = "memory-lancedb"` and agents stop forgetting. Better than default memory slot. | All agents — replaces our planned vector-memory MCP | **HIGH** |
| **composio** | Managed OAuth for 860+ apps. No API keys in env. Handles auth for Gmail, Slack, GitHub, Notion, and most services. | PersonalAssistant, CongressionalSpy, any agent needing external APIs | **HIGH** |
| **memOS cloud** | Recalls before runs, saves after. Async, cross-agent isolated, configurable limits. Good when lancedb alone isn't enough. | Learning team (Reflection, MemoryCurator) | MEDIUM |
| **openclaw-foundry** | Agent observes your workflows, finds patterns, writes new tools into itself. The self-modification loop actually works. | ExperimentationAgent — this IS the capability evolver | MEDIUM |
| **openclaw-better-gateway** | Stock gateway drops connections. This one holds. Auto-reconnect, embedded IDE, browser terminal, file API. | Gateway infrastructure | MEDIUM |
| **voice-call** | Outbound voice notifications, multi-turn through gateway. Twilio in prod, log fallback for testing. | PersonalAssistant — DJ notification channel | LOW |
| **microsoft-teams** | Plugin-only channel since Jan 2026. Thread awareness, mention support. | PersonalAssistant — if Teams is a communication channel | LOW |
| **nostr-channel** | Official channel plugin for Nostr network. Self-sovereign comms. | PersonalAssistant — niche but interesting | LOW |

### Skills (Agent-Level)

| Skill | Installs | What It Does | Relevant Agents | Priority |
|-------|----------|-------------|-----------------|----------|
| **capability-evolver** | 35K | Agent improves its own capabilities over time. #1 on ClawHub. | All agents — meta-improvement loop | **HIGH** |
| **self-improving-agent** | 15K | Learns from every interaction, optimizes responses. 132 stars, highest rated. Pairs with capability evolver. | All agents — pairs with Reflexion loop | **HIGH** |
| **gog** | 14K | Gmail, Calendar, Drive, Contacts, Sheets, Docs in one skill. | PersonalAssistant, DocumentationAgent | MEDIUM |
| **n8n-workflow** | — | Create, trigger, monitor n8n workflows from OpenClaw. Creds stay in n8n, never touch the agent. | InfrastructureAgent, RepoControlAI — CI/CD integration | MEDIUM |
| **agentzero-bridge** | — | Delegates complex tasks to Agent Zero framework, reports back. For heavy lifting OpenClaw can't handle inline. | IndianDev — alternative to Claude CLI delegation | MEDIUM |
| **wacli** | 16K | WhatsApp integration, message contacts, search history. | PersonalAssistant — DJ notification channel | LOW |
| **ouraclaw** | — | Oura Ring data (sleep, readiness, activity) in your agent. | PersonalAssistant — health automation | LOW |

### Evaluation Plan

**Phase 2 (Core Loop)**:
- [ ] Install `memory-lancedb` — replaces our planned vector-memory MCP with a proven solution
- [ ] Install `composio` — solves OAuth for all external API integrations
- [ ] Install `capability-evolver` + `self-improving-agent` — pairs with our Reflexion loop

**Phase 3 (Reflexion)**:
- [ ] Evaluate `memOS cloud` for cross-agent memory isolation
- [ ] Evaluate `openclaw-foundry` for ExperimentationAgent's self-modification loop

**Phase 4 (Full Teams)**:
- [ ] Install `gog` for Google Workspace integration
- [ ] Install `n8n-workflow` for CI/CD pipeline triggers
- [ ] Evaluate `better-gateway` if stock gateway has stability issues

### Key Insight: memory-lancedb vs Our vector-memory MCP

We planned to build a custom `vector-memory` MCP for semantic search. `memory-lancedb`
already does this as a drop-in plugin:
- Auto-captures memories from conversations
- Auto-recalls relevant memories before each run
- Vector similarity search (LanceDB)
- No custom MCP development needed

**Recommendation**: Use `memory-lancedb` as the memory backend, skip building custom
vector-memory MCP. DocArchiverAgent still handles progressive summarization — it just
feeds into LanceDB instead of a custom index.

---

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
