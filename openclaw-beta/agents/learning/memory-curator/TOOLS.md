# MemoryCuratorAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read beads for context on promoted patterns |
| `filesystem` | RW | Read reflections, write to MEMORY.md and topic files |
| `time` | R | Timestamps for memory updates |

## Curation Protocol
1. Scan `memory/reflections/` for patterns (>2 occurrences)
2. Verify pattern recurrence across different tasks/agents
3. Draft MEMORY.md entry with actionable lesson
4. Add to MEMORY.md (keep under 200 lines)
5. If MEMORY.md full, extract to topic file and link

## Authorized File Paths (Write)
- `MEMORY.md` — Promoted patterns and curated lessons
- `memory/**` — Topic files, pattern indexes
- `agents/learning/memory-curator/memory/` — Curation logs

## Restricted
- No application code access
- No infrastructure access
- No network access
- Cannot delete reflections (only compress via DocArchiverAgent)
- Cannot modify agent SOUL.md files
