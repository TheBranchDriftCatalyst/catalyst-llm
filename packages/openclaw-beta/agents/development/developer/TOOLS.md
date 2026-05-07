# DeveloperAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Scan/claim/update bead files, create downstream tasks |
| `filesystem` | RW | Read specs, write code and tests to `src/`, `tests/` |
| `time` | R | Timestamps for bead History entries |
| `context7` | R | **Documentation search** — query React, Python, framework docs before coding |
| `github` | RW | Create PRs, link issues, push to feature branches |
| `fetch` | R | Fetch API docs, external references (sandboxed) |

## context7 Usage Pattern
Before implementing any feature:
1. `resolve-library-id` — find the library (e.g., "react-hook-form", "fastapi")
2. `query-docs` — search for the specific pattern needed
3. Reference the docs in your implementation

## Authorized File Paths (Write)
- `src/**` — Application code
- `tests/**` — Test files
- `beads/**` — Update bead status and artifacts
- `agents/development/developer/memory/` — Agent memory

## Authorized Shell Commands
- `git` — branch, commit, push (feature branches only)
- Package manager commands (yarn, poetry) for dependency management
- Test runners (pytest, vitest) for validation

## Restricted
- No infrastructure modifications (`k8s/`, `infra/`, `tilt/`)
- No direct production deployments
- No modifications to other agents' files
- No force push or branch deletion
- `fetch` MCP is sandboxed — content scanned by PromptInjectionAgent
