# ArchitecturePlannerAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read feature beads, create implementation sub-beads |
| `filesystem` | RW | Read specs, write architecture docs, create bead files |
| `time` | R | Timestamps |
| `context7` | R | Query framework/platform docs for architecture decisions |
| `fetch` | R | Research technology options, read API docs (sandboxed) |

## Authorized File Paths (Write)
- `docs/architecture/**` — Architecture documents, code maps, ADRs
- `beads/**` — Create implementation bead files
- `agents/planning/architecture-planner/memory/` — Agent memory

## Restricted
- No code implementation
- No infrastructure modifications
- `fetch` sandboxed — scanned by PromptInjectionAgent
