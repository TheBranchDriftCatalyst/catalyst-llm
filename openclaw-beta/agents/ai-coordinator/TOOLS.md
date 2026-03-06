# AICoordinator — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read beads stats, blocked issues, system state |
| `filesystem` | R | Read all workspace files, agent health, memory |
| `time` | R | Timestamps, heartbeat scheduling |

## Authorized File Paths (Write)
- `agents/ai-coordinator/memory/` — Routing logs, goals, heartbeat logs

## Restricted
- Read-only for all beads (RepoControlAI owns write operations)
- No code execution
- No infrastructure access
- No network access
