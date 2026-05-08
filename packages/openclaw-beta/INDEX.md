# Claw Orchestrator — File Index

> Complete index of all files in the openclaw-beta workspace with descriptions.

## Gateway-Level Files

| File | Purpose |
|------|---------|
| `README.md` | Human-readable architecture overview, team descriptions, phased rollout |
| `INDEX.md` | This file — comprehensive file index |
| `SOUL.md` | Gateway identity — system purpose, architecture overview, operating principles |
| `AGENTS.md` | Global operating instructions for all agents (beads workflow, session protocol) |
| `USER.md` | DJ's operator profile — identity, preferences, decision authority |
| `IDENTITY.md` | System-level identity — deployment details, model routing tiers, version info |
| `TOOLS.md` | Global tool configuration — available tools, access tiers, restrictions |
| `HEARTBEAT.md` | Heartbeat schedule — check intervals per agent tier, health indicators |
| `MEMORY.md` | Curated system memory — promoted patterns and learnings (created at runtime) |

---

## Agent Files

### Core Agents (L1-L3)

#### PersonalAssistant (L1)
| File | Purpose |
|------|---------|
| `agents/personal-assistant/SOUL.md` | Identity, persona (concise aide), responsibilities, model config (Opus) |
| `agents/personal-assistant/AGENTS.md` | Downstream routing (AICoordinator), communication protocol, escalation rules |
| `agents/personal-assistant/HEARTBEAT.md` | 15-min heartbeat — messages, system state, agent health |
| `agents/personal-assistant/TOOLS.md` | Tool access — read-only beads, file read, memory write only |
| `agents/personal-assistant/memory/` | Agent-specific memory directory |

#### AICoordinator (L2)
| File | Purpose |
|------|---------|
| `agents/ai-coordinator/SOUL.md` | Identity, persona (analytical coordinator), Alpha/Bravo routing, model config (Opus) |
| `agents/ai-coordinator/AGENTS.md` | Alpha/Bravo routing decision tree, task decomposition protocol, memory protocol |
| `agents/ai-coordinator/HEARTBEAT.md` | 30-min heartbeat — beads stats, blocked issues, cluster state, memory curation |
| `agents/ai-coordinator/memory/` | Agent-specific memory directory |

#### IntentModelAgent (L2)
| File | Purpose |
|------|---------|
| `agents/intent-model/SOUL.md` | Identity, persona (precise analyst), intent extraction, model config (Opus) |
| `agents/intent-model/AGENTS.md` | Intent model format, analysis protocol, structured output with confidence scores |
| `agents/intent-model/memory/` | Contains `user_intent.md` at runtime |

#### RepoControlAI (L3)
| File | Purpose |
|------|---------|
| `agents/repo-control/SOUL.md` | Identity, persona (project manager), ticket lifecycle, model config (Opus) |
| `agents/repo-control/AGENTS.md` | Ticket state machine, transition rules, failure loops, beads protocol |
| `agents/repo-control/HEARTBEAT.md` | 30-min heartbeat — PRs, state transitions, artifacts, docs parity, bd sync |
| `agents/repo-control/TOOLS.md` | Full beads access, git commands, no code writes |
| `agents/repo-control/memory/` | Agent-specific memory directory |

---

### Planning Team (L4)

#### ProductDesignerAgent
| File | Purpose |
|------|---------|
| `agents/planning/product-designer/SOUL.md` | Creative-pragmatic persona, user stories, success metrics, model config (Sonnet) |

#### UseCaseModelingAgent
| File | Purpose |
|------|---------|
| `agents/planning/use-case-modeling/SOUL.md` | Systematic flow mapper, happy/alternate/exception paths, model config (Sonnet) |

#### RequirementsArchitectAgent
| File | Purpose |
|------|---------|
| `agents/planning/requirements-architect/SOUL.md` | Rigorous spec writer, Given/When/Then acceptance criteria, model config (Sonnet) |

#### ArchitecturePlannerAgent
| File | Purpose |
|------|---------|
| `agents/planning/architecture-planner/SOUL.md` | Systems architect, component diagrams, ADRs, implementation tickets, model config (Sonnet) |
| `agents/planning/architecture-planner/memory/` | Agent-specific memory directory |

---

### Development Team (L4)

#### DeveloperAgent
| File | Purpose |
|------|---------|
| `agents/development/developer/SOUL.md` | Primary implementer, pragmatic persona, spec-driven coding, model config (Sonnet) |
| `agents/development/developer/memory/` | Agent-specific memory directory |

#### FrontendDesignAgent
| File | Purpose |
|------|---------|
| `agents/development/frontend-design/SOUL.md` | UI/UX specialist, React/Storybook, accessibility, model config (Sonnet) |

#### BackendAgent
| File | Purpose |
|------|---------|
| `agents/development/backend/SOUL.md` | API/services specialist, security-minded, model config (Sonnet) |

#### InfrastructureAgent
| File | Purpose |
|------|---------|
| `agents/development/infrastructure/SOUL.md` | K8s/Tilt/CI/CD manager, cautious persona, model config (Sonnet) |
| `agents/development/infrastructure/TOOLS.md` | Full shell access — kubectl, tilt, helm, kustomize, argocd |

---

### QA Team (L4)

#### QAPlanningAgent
| File | Purpose |
|------|---------|
| `agents/qa/qa-planning/SOUL.md` | Test strategy lead, test pyramid thinking, quality metrics, model config (Sonnet) |

#### QAUnitTestAgent
| File | Purpose |
|------|---------|
| `agents/qa/qa-unit-test/SOUL.md` | Unit test specialist, branch coverage, edge cases, model config (Haiku) |

#### QAIntegrationAgent
| File | Purpose |
|------|---------|
| `agents/qa/qa-integration/SOUL.md` | Integration test specialist, API contracts, data flow, model config (Haiku) |

#### PlaywrightTestAgent
| File | Purpose |
|------|---------|
| `agents/qa/playwright-test/SOUL.md` | E2E test specialist, Playwright, visual regression, model config (Haiku) |

---

### Security Team (L4)

#### SecurityAgent
| File | Purpose |
|------|---------|
| `agents/security/security/SOUL.md` | Vulnerability scanner, OWASP/CVE audits, severity ratings, model config (Sonnet) |

#### PromptInjectionAgent
| File | Purpose |
|------|---------|
| `agents/security/prompt-injection/SOUL.md` | Injection scanner, external content sanitization, model config (Haiku) |

---

### Governance Team (L4)

#### PRReviewAgent
| File | Purpose |
|------|---------|
| `agents/governance/pr-review/SOUL.md` | Code reviewer, standards enforcement, constructive feedback, model config (Sonnet) |

#### DocumentationAgent
| File | Purpose |
|------|---------|
| `agents/governance/documentation/SOUL.md` | Doc maintainer, API docs, doc-code parity, model config (Sonnet) |

---

### Learning Team (L4)

#### ReflectionAgent
| File | Purpose |
|------|---------|
| `agents/learning/reflection/SOUL.md` | Post-task self-critique, episodic memory, Reflexion loop, model config (Sonnet) |
| `agents/learning/reflection/memory/reflections/` | Episodic reflection entries directory |

#### MemoryCuratorAgent
| File | Purpose |
|------|---------|
| `agents/learning/memory-curator/SOUL.md` | Memory librarian, compression, pattern promotion, model config (Haiku) |

#### ExperimentationAgent
| File | Purpose |
|------|---------|
| `agents/learning/experimentation/SOUL.md` | Experiment designer, hypothesis testing, evidence-based changes, model config (Sonnet) |
| `agents/learning/experimentation/memory/experiments/` | Experiment protocol and results directory |

---

## Patterns

| File | Purpose |
|------|---------|
| `patterns/DASHBOARD.md` | Standard pattern for monitoring dashboards (D3, React Query, Radix UI) |
| `patterns/TILTFILE.md` | Standard pattern for Tilt local development orchestration |
| `patterns/DOCUMENTATION.md` | Documentation structure conventions (ADRs, specs, API docs) |

---

## SOPs (Standard Operating Procedures)

| File | Purpose |
|------|---------|
| `sops/ticket-workflow/context.md` | Ticket workflow overview — states, roles, beads mapping |
| `sops/ticket-workflow/discovery_phase.md` | Discovery phase — intent analysis, goal structuring, ticket creation |
| `sops/ticket-workflow/development_phase.md` | Development phase — implementation, QA/Security/Review gates, merge |
| `sops/ticket-workflow/qa_phase.md` | QA phase — test planning, unit/integration/e2e execution, quality report |

---

## Templates

| File | Purpose |
|------|---------|
| `templates/ticket.md` | Beads ticket template — title, type, priority, acceptance criteria |
| `templates/pr.md` | Pull request template — summary, changes, test/security checklists |
| `templates/commit.md` | Conventional commit message format — type, scope, subject, body, footer |
| `templates/changelog.md` | Keep a Changelog format — Added, Changed, Fixed, Removed, Security |

---

## Bead Protocol (Task Capsules)

| File | Purpose |
|------|---------|
| `templates/bead-schema.md` | **THE CONTRACT** — Definitive schema for all bead files (status machine, gates, reflexion hooks) |
| `templates/bead-index.md` | Template for feature-level bead index files |
| `templates/bead-task.md` | Template for individual task bead files |
| `templates/repo-context.md` | Template for per-repo development context |
| `sops/bead-protocol.md` | SOP — How agents scan, claim, execute, and update beads |

### Contexts (Shared Agent Knowledge)

| File | Purpose |
|------|---------|
| `contexts/shared-dev.md` | Common context for ALL dev agents — workflow, standards, tech stack |
| `contexts/<repo-name>.md` | Per-repo context (architecture, patterns, conventions) — created per project |

### Example Bead: HELLO_WORLD (Proof-of-Life)

| File | Purpose |
|------|---------|
| `beads/HELLO_WORLD/index.md` | Feature index — goal, subtask DAG, status |
| `beads/HELLO_WORLD/BEAD-001-code.md` | Task: write hello world program (assigned: DeveloperAgent) |
| `beads/HELLO_WORLD/BEAD-002-tests.md` | Task: write tests (assigned: QAUnitTestAgent, depends on BEAD-001) |
| `beads/HELLO_WORLD/BEAD-003-reflection.md` | Task: reflect on loop execution (assigned: ReflectionAgent) |

### Workflows (Lobster Pipelines)

| File | Purpose |
|------|---------|
| `workflows/README.md` | Planned Lobster workflow files for deterministic agent pipelines |

---

## Shared Directories

| Directory | Purpose |
|-----------|---------|
| `beads/` | **Task protocol layer** — bead files that bridge planning and execution |
| `contexts/` | Shared agent knowledge — dev context, repo contexts |
| `workflows/` | Lobster workflow YAML files (Phase 2+) |
| `memory/` | Shared system memory — daily logs, user intent |
| `memory/reflections/` | Episodic reflection entries from ReflectionAgent |
| `docs/product/` | Product design documents |
| `docs/product/use_cases/` | Use case flow documents |
| `docs/specs/` | Technical specifications |
| `docs/architecture/` | Architecture documents, code maps |
| `docs/qa/test_plans/` | QA test plan documents |
| `security/scans/` | Security scan results |
| `security/injection_log/` | Prompt injection detection logs |
| `experiments/` | Experiment protocols and results |

---

## File Counts

| Category | Count |
|----------|-------|
| Agent SOUL.md files | 23 |
| Agent AGENTS.md files | 4 (core agents) |
| Agent HEARTBEAT.md files | 3 (L1-L3) |
| Agent TOOLS.md files | 3 |
| Gateway-level files | 7 |
| Bead templates + schema | 3 |
| Example beads (HELLO_WORLD) | 4 |
| Context files | 1 (+ per-repo) |
| Patterns | 3 |
| SOPs | 5 |
| Templates | 8 |
| **Total files** | **~65** |
| Memory/artifact directories | 12+ |
