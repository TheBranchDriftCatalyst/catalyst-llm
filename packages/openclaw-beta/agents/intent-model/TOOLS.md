# IntentModelAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read beads for context on user goals |
| `filesystem` | R | Read conversation logs, existing intent model |
| `time` | R | Timestamps for intent model updates |

## Authorized File Paths (Write)
- `agents/intent-model/memory/` — User intent model, analysis logs
- `memory/user_intent.md` — Shared user intent model

## Restricted
- Read-only for all beads and workspace files
- No code execution
- No task routing (analysis only)
- No network access
