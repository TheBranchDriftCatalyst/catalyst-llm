# QAIntegrationAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Claim integration test beads, update QA gate fields |
| `filesystem` | RW | Read source code and API contracts, write tests to `tests/integration/` |
| `time` | R | Timestamps for bead History entries |
| `context7` | R | Query httpx, supertest, API testing framework docs |

## context7 Usage Pattern
1. `resolve-library-id` — find test framework (e.g., "httpx", "supertest", "pytest")
2. `query-docs` — search for API testing patterns, fixtures, test client setup

## Authorized File Paths (Write)
- `tests/integration/**` — Integration test files
- `tests/fixtures/**` — Shared test fixtures (read/write)
- `beads/**` — Update bead status and QA gate fields

## Shell Access (Tier 3)
- Test runners: `pytest`, `vitest`, `npm test`
- Docker commands for test service containers
- Database setup/teardown scripts

## Restricted
- No application code modifications (test code only)
- No unit or E2E test modifications
- No production infrastructure access
- Shell access limited to test execution only
