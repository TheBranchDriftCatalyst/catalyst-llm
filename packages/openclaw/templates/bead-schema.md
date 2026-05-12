# Bead File Schema — The Task Contract

> This schema is the **interface contract** between planning agents and execution agents.
> Every bead file MUST conform to this schema. Agents parse these fields programmatically.

## Why This Exists

Bead files are the **task protocol** of the Claw Orchestrator. They sit between:
- **Planning agents** (who create beads)
- **Execution agents** (who read beads, produce artifacts, update status)

The filesystem IS the message bus. Agents don't need an external task system — they scan `beads/`, read task files, execute, and update status in-place.

---

## Bead Types

### 1. Feature Index (`index.md`)
Top-level bead that represents a feature, epic, or project. Contains subtask references and the DAG.

### 2. Task Bead (`BEAD-NNN-<slug>.md`)
Atomic execution unit. One agent owns it, produces artifacts, updates status.

---

## Feature Index Schema

```markdown
# <Feature Name>

## Meta
- **ID**: <FEATURE_SLUG> (matches directory name)
- **Created**: YYYY-MM-DD
- **Created-By**: <planning-agent-name>
- **Priority**: P0 | P1 | P2 | P3 | P4
- **Cluster**: alpha | bravo

## Goal
<1-3 sentences describing the desired outcome>

## Status
PLANNING | ACTIVE | BLOCKED | REVIEW | COMPLETE | ABANDONED

## Subtasks
| Bead | Owner | Status | Depends-On |
|------|-------|--------|------------|
| BEAD-001-<slug> | <agent> | OPEN | — |
| BEAD-002-<slug> | <agent> | OPEN | BEAD-001 |
| BEAD-003-<slug> | <agent> | OPEN | BEAD-001, BEAD-002 |

## DAG
<Mermaid or text representation of dependency graph>

## Planning Artifacts
- Product doc: `docs/product/<feature>.md`
- Use cases: `docs/product/use_cases/<feature>_flows.md`
- Spec: `docs/specs/<feature>.md`
- Architecture: `docs/architecture/<feature>.md`

## Notes
<Additional context, DJ decisions, constraints>
```

---

## Task Bead Schema

```markdown
# BEAD-NNN: <Task Title>

## Meta
- **ID**: BEAD-NNN-<slug>
- **Parent**: <FEATURE_SLUG>
- **Type**: code | test | infra | docs | security | design | review
- **Created**: YYYY-MM-DD
- **Created-By**: <agent-name>

## Ownership
- **Assigned-To**: <agent-name>
- **Team**: Planning | Development | QA | Security | Governance | Learning

## Status
OPEN | IN_PROGRESS | REVIEW | BLOCKED | COMPLETE | FAILED

## Dependencies
- **Depends-On**: [BEAD-NNN, BEAD-NNN]  (must be COMPLETE before this starts)
- **Blocks**: [BEAD-NNN, BEAD-NNN]  (these wait on this bead)

## Requirements
<What needs to be done — acceptance criteria>

- [ ] <Criterion 1>
- [ ] <Criterion 2>
- [ ] <Criterion 3>

## Context
- **Spec**: `docs/specs/<feature>.md`
- **Architecture**: `docs/architecture/<feature>.md`
- **Repo Context**: `contexts/<repo-name>.md`
- **Related Beads**: [BEAD-NNN]

## Artifacts
<Filled in by the executing agent>

- `<path/to/artifact1>`
- `<path/to/artifact2>`

## QA Gate
- **Test Plan**: `docs/qa/test_plans/<feature>.md`
- **Unit Tests**: PASS | FAIL | PENDING
- **Integration Tests**: PASS | FAIL | PENDING | N/A
- **E2E Tests**: PASS | FAIL | PENDING | N/A
- **Coverage**: <percentage>%

## Security Gate
- **Scan Result**: CLEAN | FINDINGS | PENDING
- **Findings**: `security/scans/<feature>_scan.md`
- **Critical/High**: 0

## Review Gate
- **PR**: <link or ref>
- **Review**: APPROVED | CHANGES_REQUESTED | PENDING
- **Reviewer**: <agent-name>

## Reflexion Hook
- **Outcome**: pass | fail | partial
- **Reflection**: `memory/reflections/<bead-id>_reflection.md`
- **Failure Mode**: <if failed — what went wrong>
- **Lesson**: <actionable insight for future attempts>

## History
| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| YYYY-MM-DD HH:MM | <agent> | created | Initial creation |
| YYYY-MM-DD HH:MM | <agent> | status → IN_PROGRESS | Claimed task |
| YYYY-MM-DD HH:MM | <agent> | status → REVIEW | PR created |
```

---

## Status State Machine

```
OPEN → IN_PROGRESS → REVIEW → COMPLETE
  │        │            │
  │        ↓            ↓
  │     BLOCKED    CHANGES_REQUESTED → IN_PROGRESS
  │        │
  ↓        ↓
ABANDONED  FAILED → (new bead created with retry context)
```

### Transition Rules

| From | To | Who | Condition |
|------|----|-----|-----------|
| OPEN | IN_PROGRESS | Assigned agent | All Depends-On beads are COMPLETE |
| IN_PROGRESS | REVIEW | Assigned agent | Artifacts produced, PR created |
| IN_PROGRESS | BLOCKED | Any agent | Dependency not met or external blocker |
| IN_PROGRESS | FAILED | Assigned agent | Cannot complete, needs human input |
| REVIEW | COMPLETE | RepoControlAI | All gates pass (QA + Security + Review) |
| REVIEW | IN_PROGRESS | PRReviewAgent | Changes requested |
| BLOCKED | OPEN | System | Blocker resolved |
| * | ABANDONED | DJ/Coordinator | Feature cancelled |

---

## Agent Scanning Protocol

Agents follow this loop:

```
1. Scan beads/ for files where Assigned-To = <my-name>
2. Filter by Status = OPEN
3. Check Dependencies — all Depends-On must be COMPLETE
4. If eligible: update Status → IN_PROGRESS
5. Read Context files (spec, architecture, repo context)
6. Execute task, produce artifacts
7. Update Artifacts section
8. Update Status → REVIEW
9. Create/update QA Gate, Security Gate sections
10. If all gates pass: RepoControlAI sets Status → COMPLETE
11. ReflectionAgent fills Reflexion Hook section
```

---

## File Naming Convention

```
beads/
  <FEATURE_SLUG>/
    index.md                          # Feature-level bead
    BEAD-001-<descriptive-slug>.md    # Task bead
    BEAD-002-<descriptive-slug>.md
    BEAD-003-<descriptive-slug>.md
```

- Feature slug: `SCREAMING_SNAKE_CASE` (e.g., `DASHBOARD_FEATURE`, `AUTH_REFACTOR`)
- Bead IDs: Sequential within feature (`BEAD-001`, `BEAD-002`, ...)
- Slugs: `kebab-case` descriptors (e.g., `backend-api`, `frontend-components`, `unit-tests`)

---

## Validation Rules

A bead file is **valid** if:
1. All required Meta fields are present
2. Status is one of the defined values
3. Dependencies reference existing bead IDs
4. Assigned-To matches a known agent name
5. No circular dependencies in the DAG
6. Artifacts paths exist on disk (when Status = REVIEW or COMPLETE)

A feature index is **ready for execution** if:
1. All planning artifacts are referenced and exist
2. At least one subtask bead exists
3. DAG has no cycles
4. Feature Status is ACTIVE
