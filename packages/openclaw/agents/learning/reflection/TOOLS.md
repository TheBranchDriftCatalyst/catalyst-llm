# ReflectionAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read completed/failed beads for analysis |
| `filesystem` | RW | Read bead history, write reflections |
| `time` | R | Timestamps for reflection entries |

## Authorized File Paths (Write)
- `memory/reflections/**` — Episodic reflection entries
- `beads/**` — Fill Reflexion Hook section in completed beads
- `agents/learning/reflection/memory/` — Pattern tracking, tag index

## Restricted
- No application code access
- No infrastructure access
- No network access
- Cannot modify bead Status (only Reflexion Hook section)
