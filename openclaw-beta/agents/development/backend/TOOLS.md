# BackendAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Claim backend beads, update status and artifacts |
| `filesystem` | RW | Read specs, write services to `src/api/`, `services/` |
| `time` | R | Timestamps for bead History entries |
| `context7` | R | Query FastAPI, Django, SQLAlchemy, Pydantic, Node.js docs |
| `github` | RW | Create PRs for backend changes, link to beads |
| `fetch` | R | Reference external API docs, OpenAPI specs (sandboxed) |

## context7 Usage Pattern
Before implementing any endpoint or service:
1. `resolve-library-id` — find the framework (e.g., "fastapi", "sqlalchemy", "pydantic")
2. `query-docs` — search for patterns, middleware, validation, error handling

## Authorized File Paths (Write)
- `src/api/**` — API endpoints and route handlers
- `services/**` — Business logic and service layer
- `tests/unit/**` — Unit tests for backend code
- `tests/integration/**` — Integration tests for API endpoints
- `beads/**` — Update bead status and artifacts
- `agents/development/backend/memory/` — Agent memory

## Restricted
- No frontend code modifications (`src/ui/`, `stories/`)
- No infrastructure modifications (`k8s/`, `infra/`)
- No direct production database access
- No secret/credential handling (use environment variables)
- `fetch` MCP is sandboxed — content scanned by PromptInjectionAgent
