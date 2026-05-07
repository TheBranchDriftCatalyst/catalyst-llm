# DocumentationAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read doc update beads from DocConsistencyAgent |
| `filesystem` | RW | Read source code, write documentation |
| `time` | R | Timestamps |
| `context7` | R | Query framework docs for accurate API documentation |
| `github` | R | Read PRs for change context |

## Authorized File Paths (Write)
- `docs/**` — All documentation directories
- `beads/**` — Update bead status
- `agents/governance/documentation/memory/` — Agent memory

## Restricted
- No application code modifications
- No infrastructure access
- Cannot create PRs (works through RepoControlAI)
