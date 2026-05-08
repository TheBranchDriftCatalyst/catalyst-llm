# Global Tool Configuration

## MCP Servers (Model Context Protocol)

MCPs are the primary way agents access external tools and services. Each agent tier
gets a different MCP allowlist. OpenClaw configures this in `config.json5` via
`agents.list[].tools.mcpServers`.

### Core MCPs (All Agents)

| MCP Server | Purpose | Config |
|------------|---------|--------|
| `beads` | Issue tracking — scan beads/, create/update/close tasks | Built-in plugin |
| `filesystem` | Read/write workspace files within allowed paths | `mcp-server-filesystem` |
| `time` | Current time for timestamps in bead History entries | `mcp-server-time` |

### Development MCPs (Dev Team Agents)

| MCP Server | Purpose | Agents |
|------------|---------|--------|
| `context7` | Documentation search — query library docs (React, Python, K8s, etc.) | Developer, Frontend, Backend, Infrastructure |
| `github` | PR management, code search, issue linking | Developer, Frontend, Backend, PRReview, RepoControlAI |
| `fetch` | Fetch web content (API docs, references) — sandboxed | Developer, Frontend, Backend |

### QA MCPs

| MCP Server | Purpose | Agents |
|------------|---------|--------|
| `playwright` | Browser automation for E2E tests | PlaywrightTestAgent |
| `context7` | Test framework docs (pytest, vitest, playwright) | QAPlanning, QAUnit, QAIntegration, PlaywrightTest |

### Infrastructure MCPs

| MCP Server | Purpose | Agents |
|------------|---------|--------|
| `context7` | K8s, Helm, ArgoCD, Tilt documentation | InfrastructureAgent |

### Planning MCPs

| MCP Server | Purpose | Agents |
|------------|---------|--------|
| `context7` | Technology docs for architecture decisions | ArchitecturePlanner, RequirementsArchitect |
| `fetch` | Research external APIs, service docs | ProductDesigner, ArchitecturePlanner |

### Security MCPs

| MCP Server | Purpose | Agents |
|------------|---------|--------|
| `fetch` | CVE databases, security advisories (sandboxed) | SecurityAgent |

### Learning MCPs

| MCP Server | Purpose | Agents |
|------------|---------|--------|
| `fetch` | Research papers, technique references | ExperimentationAgent |

---

## MCP Access Matrix

| Agent | beads | filesystem | time | context7 | github | fetch | playwright |
|-------|-------|-----------|------|----------|--------|-------|------------|
| PersonalAssistant | R | R | Y | - | - | - | - |
| AICoordinator | R | R | Y | - | - | - | - |
| IntentModelAgent | R | R | Y | - | - | - | - |
| RepoControlAI | RW | R | Y | - | RW | - | - |
| ProductDesigner | R | RW | Y | - | - | R | - |
| UseCaseModeling | R | RW | Y | - | - | - | - |
| RequirementsArch | R | RW | Y | R | - | - | - |
| ArchitecturePlanner | R | RW | Y | R | - | R | - |
| DeveloperAgent | RW | RW | Y | R | RW | R | - |
| FrontendDesign | RW | RW | Y | R | RW | R | - |
| BackendAgent | RW | RW | Y | R | RW | R | - |
| InfrastructureAgent | RW | RW | Y | R | RW | - | - |
| QAPlanningAgent | RW | RW | Y | R | R | - | - |
| QAUnitTestAgent | RW | RW | Y | R | - | - | - |
| QAIntegrationAgent | RW | RW | Y | R | - | - | - |
| PlaywrightTestAgent | RW | RW | Y | R | - | - | RW |
| SecurityAgent | R | R | Y | - | R | R | - |
| PromptInjectionAgent | R | R | Y | - | - | - | - |
| PRReviewAgent | R | R | Y | - | RW | - | - |
| DocumentationAgent | R | RW | Y | R | R | - | - |
| DocConsistencyAgent | R | R | Y | - | R | - | - |
| DocArchiverAgent | R | RW | Y | - | - | - | - |
| ReflectionAgent | R | RW | Y | - | - | - | - |
| MemoryCuratorAgent | R | RW | Y | - | - | - | - |
| ExperimentationAgent | RW | RW | Y | R | - | R | - |

Legend: R = read, RW = read/write, Y = yes, - = not available

---

## OpenClaw MCP Configuration Format

Each agent's MCP access is defined in the gateway `config.json5`:

```json5
{
  agents: {
    list: [
      {
        id: "developer",
        // ...
        tools: {
          mcpServers: {
            beads: { enabled: true, permissions: "rw" },
            filesystem: { enabled: true, permissions: "rw", allowPaths: ["src/", "tests/"] },
            time: { enabled: true },
            context7: { enabled: true },
            github: { enabled: true, permissions: "rw" },
            fetch: { enabled: true, sandboxed: true },
          }
        }
      }
    ]
  }
}
```

---

## Tool Access Tiers

| Tier | Access Level | Agents | MCPs |
|------|-------------|--------|------|
| 1 | Read-only | All agents (default) | beads(R), filesystem(R), time |
| 2 | Write workspace | Dev, QA, Infra, Frontend, Backend, Docs | + filesystem(RW), beads(RW), context7, github |
| 3 | Shell access | Infrastructure, QA Integration | + shell commands (kubectl, tilt, etc.) |
| 4 | Network access | Research-only, sandboxed | + fetch (with prompt injection scanning) |

---

## Beads Integration (Built-in)

All agents interact with bead files via the filesystem MCP, not the `bd` CLI:

### Reading Beads
- Scan `beads/` directory for bead files
- Parse markdown frontmatter-style fields
- Check `Assigned-To` and `Status` fields

### Writing Beads
- Update `Status` field in-place
- Append to `History` table
- Fill in `Artifacts`, `QA Gate`, `Security Gate`, `Review Gate` sections

### Bead Files vs `bd` CLI
- `bd` CLI manages the `.beads/` database (project-level issue tracking)
- Bead files in `beads/` are the **task protocol** (agent-level execution)
- Both can coexist — `bd` for high-level tracking, bead files for agent execution

---

## context7 (Documentation Search MCP)

The `context7` MCP server provides real-time documentation search for any library.
This is critical for dev agents to look up API docs, framework patterns, and best practices.

### Usage by Agents
```
1. resolve-library-id: Find the library (e.g., "react", "pytest", "kubernetes")
2. query-docs: Search for specific topic (e.g., "useEffect cleanup", "k8s deployment spec")
```

### Why This Matters
- Agents write better code when they can reference current docs
- Reduces hallucination about API signatures and patterns
- Architecture decisions can reference actual framework capabilities
- Test agents can look up testing framework features

---

## vector-memory MCP (Future — Phase 3+)

A custom MCP server that provides semantic search across the entire documentation
and memory corpus. This replaces keyword-based `memory_search` with vector similarity.

### Architecture
```
DocArchiverAgent → progressive summarization → embeddings
                                                    ↓
Agent queries vector-memory MCP → ranked doc chunks with file refs
                                                    ↓
Agent reads full files for detailed context
```

### Planned Features
- Index all `docs/`, `memory/`, `beads/archive/`, `contexts/` into vector embeddings
- Semantic search: "how did we handle tenant filtering?" → returns relevant reflections + specs
- Auto-reindex on file changes (filesystem watcher)
- Embedding model: local (e.g., nomic-embed) or via LiteLLM
- Storage: SQLite + HNSW index (lightweight, file-based, git-friendly)

### MCP Interface
```
vector-memory.index:    Trigger reindexing of a file or directory
vector-memory.search:   Semantic search with query string, returns ranked chunks
vector-memory.similar:  Find files similar to a given file
vector-memory.stats:    Index statistics (doc count, last indexed, coverage)
```

### Agent Access
All agents get read access to `vector-memory`. Only DocArchiverAgent and
MemoryCuratorAgent get write access (indexing).

---

## Restrictions
- Agents may only write to their designated artifact directories
- Shell access requires Tier 3 authorization
- Network access (fetch MCP) requires Tier 4 + prompt injection scanning
- No agent may modify another agent's SOUL.md
- `context7` is read-only by nature (documentation queries only)
- `github` write access limited to PRs and issues (no force push, no branch deletion)
- `vector-memory` write access (indexing) limited to DocArchiverAgent and MemoryCuratorAgent
