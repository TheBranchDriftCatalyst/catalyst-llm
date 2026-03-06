# Hello World — First Agent Loop Test

## Meta
- **ID**: HELLO_WORLD
- **Created**: 2026-03-06
- **Created-By**: DJ
- **Priority**: P1
- **Cluster**: bravo

## Goal
Prove the bead-driven agent loop works end-to-end: planning agent creates beads, developer agent reads bead and produces code, QA agent tests it, reflection agent captures learnings.

## Status
ACTIVE

## Subtasks
| Bead | Owner | Status | Depends-On |
|------|-------|--------|------------|
| BEAD-001-code | DeveloperAgent | OPEN | — |
| BEAD-002-tests | QAUnitTestAgent | OPEN | BEAD-001 |
| BEAD-003-reflection | ReflectionAgent | OPEN | BEAD-001, BEAD-002 |

## DAG
```
BEAD-001-code
    ↓
BEAD-002-tests
    ↓
BEAD-003-reflection
```

## Planning Artifacts
- Product doc: N/A (trivial feature)
- Spec: Inline — write a hello world program that prints "Hello from Claw Orchestrator"
- Architecture: N/A

## Notes
This is the **proof-of-life** bead. If this loop completes (developer writes code → QA tests it → reflection captures the experience), the agent operating system is alive.
