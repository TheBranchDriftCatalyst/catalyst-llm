# Shared Development Context

> Common context for ALL development agents. Read this before any implementation task.
> Individual repo contexts in `contexts/<repo-name>.md` supplement this.

## Workspace
- **Monorepo**: catalyst-devspace
- **Orchestrator**: OpenClaw (Claw Orchestrator)
- **Issue Tracking**: Beads (filesystem-based bead files in `beads/`)
- **CI/CD**: ArgoCD (GitOps)
- **Cluster**: Kubernetes on Talos

## Development Workflow

### Before Starting Any Bead
1. Read the bead file (`beads/<FEATURE>/<BEAD-NNN>.md`)
2. Read linked spec (`docs/specs/<feature>.md`)
3. Read linked architecture doc (`docs/architecture/<feature>.md`)
4. Read this file (shared context)
5. Read repo-specific context (`contexts/<repo>.md`) if it exists
6. Check all `Depends-On` beads are COMPLETE

### During Implementation
1. Update bead Status → IN_PROGRESS
2. Follow conventions from repo context
3. Write tests alongside implementation
4. Commit to feature branch (never main)
5. Update bead Artifacts section with file paths

### After Implementation
1. Create PR (use `templates/pr.md` format)
2. Update bead Status → REVIEW
3. Fill in QA Gate section with test results
4. Wait for QA, Security, and Review gates

## Code Quality Standards
- No hardcoded secrets or credentials
- Input validation at all system boundaries
- Error handling with meaningful messages
- Tests for all new functionality (target 80% coverage)
- Follow existing patterns — don't invent new abstractions unnecessarily
- Keep PRs focused — one bead = one PR

## Git Conventions
- **Branch naming**: `feat/<bead-id>-<short-description>` or `fix/<bead-id>-<short-description>`
- **Commit format**: See `templates/commit.md` (conventional commits)
- **PR format**: See `templates/pr.md`
- **Merge strategy**: Squash merge to main

## Tech Stack Reference

### Frontend
- React 18+ with TypeScript
- Radix UI primitives
- Tailwind CSS
- Storybook for component development
- React Hook Form + Zod for forms
- D3.js for visualizations

### Backend
- Python 3.12+ or Node.js 20+
- Poetry (Python) or Yarn (Node.js)
- RESTful APIs (OpenAPI 3.0 documented)
- Pydantic for data validation (Python)
- Zod for data validation (TypeScript)

### Infrastructure
- Kubernetes (Talos cluster)
- Kustomize for manifest management
- Tilt for local development
- ArgoCD for GitOps deployment
- Docker for containerization

### Testing
- pytest (Python) / Vitest (TypeScript) for unit tests
- httpx/supertest for API integration tests
- Playwright for E2E tests
- Coverage tools: pytest-cov / c8

## Model Routing
All LLM calls go through LiteLLM proxy. Model assignment is per-agent, not per-task:
- Heavy reasoning (Opus): Core agents (L1-L3)
- Implementation (Sonnet): Dev, Planning, Governance, Security agents
- Fast/simple (Haiku): QA execution, scanning, curation

## Artifact Paths
Agents write artifacts to consistent paths:
- Code: `src/` (within the target repo)
- Tests: `tests/` (within the target repo)
- Docs: `docs/` (within openclaw-beta workspace)
- Security scans: `security/scans/`
- Reflections: `memory/reflections/`
- Experiments: `experiments/`

## Anti-Patterns (Do Not Do)
- Don't modify another agent's SOUL.md or AGENTS.md
- Don't skip gates (QA, Security, Review)
- Don't merge your own PR
- Don't write to directories outside your designated artifacts
- Don't create new abstractions for one-time operations
- Don't add features beyond what the bead specifies
