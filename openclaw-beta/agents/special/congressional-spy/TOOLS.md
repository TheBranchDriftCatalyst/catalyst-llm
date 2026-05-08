# CongressionalSpyAgent — Tool Access

## Status
**STUB** — Full tool configuration will be defined when this agent is activated.

## Planned MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Track report generation tasks |
| `filesystem` | RW | Write reports to `reports/congressional/` |
| `time` | R | Timestamps, scheduling |
| `fetch` | R | Query Congress.gov API for legislative data |
| `congress-api` | R | **Custom MCP** — Wrapper for Congress.gov API v3 (planned) |
| `vector-memory` | R | Search legislative archive (Phase 3+) |

## Planned File Paths (Write)
- `reports/congressional/**` — Generated reports
- `agents/special/congressional-spy/memory/` — Legislative data cache, topic filters

## Restricted
- No code execution
- No infrastructure access
- Factual reporting only — no editorial content
- API key stored as environment variable, never in files
