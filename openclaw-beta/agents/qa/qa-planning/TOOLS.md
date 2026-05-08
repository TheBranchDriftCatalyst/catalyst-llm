# QAPlanningAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Create test task beads, update QA gate fields |
| `filesystem` | RW | Read specs, write test plans to `docs/qa/test_plans/` |
| `time` | R | Timestamps |
| `context7` | R | Query testing framework docs (pytest, vitest, playwright) |
| `github` | R | Read PRs for review context |

## Authorized File Paths (Write)
- `docs/qa/test_plans/**` — Test plan documents
- `beads/**` — Create/update test beads
- `agents/qa/qa-planning/memory/` — Agent memory

## Restricted
- No application code modifications
- No infrastructure access
- No direct test execution (delegates to sub-agents)
