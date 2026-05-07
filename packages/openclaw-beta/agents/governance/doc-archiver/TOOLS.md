# DocArchiverAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read completed beads for archival |
| `filesystem` | RW | Read memory/docs, write archives and summaries |
| `time` | R | Timestamps, age calculations for archival decisions |
| `vector-memory` | **RW** | **Index archived content into vector embeddings** (Phase 3+) |

## Progressive Summarization Workflow
1. Scan `memory/reflections/` for entries older than 7 days
2. Summarize entries into compressed format
3. Move originals to `memory/archive/<quarter>/`
4. Update archive index
5. If MEMORY.md > 200 lines, extract to topic files
6. Index all summaries into vector-memory MCP (when available)

## Archive Schedule
```
Day 1-7:   Full episodic detail (untouched)
Day 8-30:  Summarized to key lessons + tags
Day 31-90: Compressed to 1-2 line entries in topic files
Day 90+:   Archived with index reference only
```

## vector-memory MCP Usage (Phase 3+)
```
vector-memory.index   — Index new/updated archive files
vector-memory.search  — Verify no duplicate content before archiving
vector-memory.stats   — Monitor index coverage and freshness
```

## Authorized File Paths (Write)
- `memory/archive/**` — Archived reflections and memory snapshots
- `memory/reflections/**` — Compress/summarize aging entries
- `beads/archive/**` — Archive completed feature beads
- `agents/governance/doc-archiver/memory/` — Agent memory

## Restricted
- No application code access
- No active bead modifications (only completed/archived beads)
- Cannot delete files — only compress, summarize, and move
- Cannot modify MEMORY.md directly (MemoryCuratorAgent owns that)
