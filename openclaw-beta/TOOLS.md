# Global Tool Configuration

## Available Tools (All Agents)

### Beads (Issue Tracking)
- `bd ready` — Find available work
- `bd show <id>` — View issue details
- `bd create` — Create new issue
- `bd update <id>` — Update issue status/fields
- `bd close <id>` — Complete issue
- `bd dep add` — Add dependency
- `bd sync` — Sync with git remote
- `bd stats` — Project statistics
- `bd blocked` — Show blocked issues

### File Operations
- Read files from workspace
- Write to designated artifact directories only
- Search workspace with glob/grep patterns

### Memory
- Read/write to agent-specific `memory/` directory
- Read shared `memory/` at workspace root
- Write episodic reflections to `memory/reflections/`

## Tool Access Tiers

| Tier | Access Level | Agents |
|------|-------------|--------|
| 1 | Read-only | All agents (default) |
| 2 | Write workspace | Developer, QA, Infra, Frontend, Backend |
| 3 | Shell access | Infrastructure, QA Integration |
| 4 | Network access | Research-only, sandboxed |

## Restrictions
- Agents may only write to their designated artifact directories
- Shell access requires Tier 3 authorization
- Network access requires Tier 4 + prompt injection scanning
- No agent may modify another agent's SOUL.md
