# DocConsistencyAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read beads to check artifact references |
| `filesystem` | R | Read all docs and source code for parity checks |
| `time` | R | Timestamps for drift reports |
| `github` | R | Read recent PRs to detect doc-impacting changes |

## Consistency Check Workflow
1. After each merge, scan changed files
2. For each changed file, check if related docs exist
3. Compare documented state against actual code state
4. Generate drift report listing inconsistencies
5. Create beads for DocumentationAgent to fix

## Checks Performed
- API endpoint docs match actual route definitions
- README directory structures match `tree` output
- Environment variable docs match `.env.example`
- Dependency docs match `package.json` / `pyproject.toml`
- Bead artifact references point to existing files
- MEMORY.md entries are still accurate
- Architecture docs reflect current system design

## Authorized File Paths (Write)
- `docs/consistency_reports/**` — Drift reports
- `agents/governance/doc-consistency/memory/` — Agent memory

## Restricted
- **Read-only** — cannot modify docs or code (only reports drift)
- No shell access
- No infrastructure access
- Cannot create PRs (creates beads for DocumentationAgent instead)
