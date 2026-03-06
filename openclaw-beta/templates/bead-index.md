# <Feature Name>

## Meta
- **ID**: <FEATURE_SLUG>
- **Created**: YYYY-MM-DD
- **Created-By**: <planning-agent-name>
- **Priority**: P2
- **Cluster**: bravo

## Goal
<1-3 sentences describing the desired outcome>

## Status
PLANNING

## Subtasks
| Bead | Owner | Status | Depends-On |
|------|-------|--------|------------|
| BEAD-001-<slug> | <agent> | OPEN | — |
| BEAD-002-<slug> | <agent> | OPEN | BEAD-001 |

## DAG
```
BEAD-001 → BEAD-002
```

## Planning Artifacts
- Product doc: `docs/product/<feature>.md`
- Use cases: `docs/product/use_cases/<feature>_flows.md`
- Spec: `docs/specs/<feature>.md`
- Architecture: `docs/architecture/<feature>.md`

## Notes
<Additional context>
