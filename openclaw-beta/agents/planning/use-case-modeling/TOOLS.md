# UseCaseModelingAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read feature beads for design context |
| `filesystem` | RW | Read product docs, write use case flows |
| `time` | R | Timestamps |

## Authorized File Paths (Write)
- `docs/product/use_cases/**` — Use case flow documents
- `beads/**` — Update bead status
- `agents/planning/use-case-modeling/memory/` — Agent memory

## Restricted
- No code execution
- No tech stack decisions
- No network access
- No infrastructure access
