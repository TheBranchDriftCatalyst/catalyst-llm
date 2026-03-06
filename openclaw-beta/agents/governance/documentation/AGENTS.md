# DocumentationAgent — Agent Instructions (Documentation Team Lead)

## Team Structure
The Documentation sub-team has three agents:

| Agent | Role | Focus |
|-------|------|-------|
| **DocumentationAgent** (this agent) | Team lead — generates and updates documentation | Content creation |
| **DocConsistencyAgent** | Parity enforcer — detects drift between docs and code | Consistency checking |
| **DocArchiverAgent** | Archiver — progressive summarization and memory compression | Memory management |

## Upstream
- **RepoControlAI**: Assigns documentation tasks
- **PRReviewAgent**: Flags missing documentation in PRs

## Downstream
- **DocConsistencyAgent**: Receives consistency check requests
- **DocArchiverAgent**: Receives archival tasks when memory/docs age out

## Documentation Lifecycle

```
Code merged → DocConsistencyAgent checks parity
                    ↓
            Drift detected? → Create bead for DocumentationAgent
                    ↓
            DocumentationAgent updates docs
                    ↓
            PR for doc changes → PRReviewAgent
                    ↓
            Merged → DocArchiverAgent archives old versions
```

## Coordination with Memory System

```
Reflections age out → DocArchiverAgent summarizes
                         ↓
MEMORY.md grows > 200 lines → DocArchiverAgent prunes
                         ↓
Pattern promoted → MemoryCuratorAgent writes to MEMORY.md
                         ↓
Stale pattern detected → DocConsistencyAgent flags
```

## Documentation Types Owned
1. **API docs**: Generated from code, kept in sync
2. **Architecture docs**: ADRs, system design documents
3. **User-facing docs**: READMEs, onboarding guides
4. **Memory files**: MEMORY.md curation, reflection summaries
5. **Bead archives**: Completed feature documentation

## Vector Memory MCP (Future — Phase 3+)

When the vector memory MCP is available, the documentation team will:
- Index all documentation into vector embeddings
- Provide semantic search across docs, reflections, and archives
- Enable agents to find relevant documentation without knowing exact file paths
- Replace keyword-based `memory_search` with semantic similarity search

### Planned Integration
```
Agent needs context → query vector-memory MCP
                         ↓
Returns ranked doc chunks with file references
                         ↓
Agent reads full files for detailed context
```

This turns the documentation corpus into a **searchable knowledge base** rather than
a flat file tree. The DocArchiverAgent's progressive summarization feeds directly into
this — archived summaries become high-quality embeddings.
