# RequirementsArchitectAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read feature beads for requirements context |
| `filesystem` | RW | Read use cases, write specs to `docs/specs/` |
| `time` | R | Timestamps |
| `context7` | R | Query framework docs for feasibility checks |

## Authorized File Paths (Write)
- `docs/specs/**` — Technical specifications
- `beads/**` — Update bead status
- `agents/planning/requirements-architect/memory/` — Agent memory

## Restricted
- No code execution
- No architecture decisions (ArchitecturePlannerAgent)
- No infrastructure access
- No network access beyond context7
