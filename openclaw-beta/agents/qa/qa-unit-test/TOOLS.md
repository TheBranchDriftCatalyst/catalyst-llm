# QAUnitTestAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Claim unit test beads, update QA gate fields |
| `filesystem` | RW | Read source code, write tests to `tests/unit/` |
| `time` | R | Timestamps for bead History entries |
| `context7` | R | Query pytest, vitest, testing-library docs |

## context7 Usage Pattern
1. `resolve-library-id` — find test framework (e.g., "pytest", "vitest")
2. `query-docs` — search for assertion patterns, fixtures, mocking, parametrize

## Authorized File Paths (Write)
- `tests/unit/**` — Unit test files
- `tests/fixtures/**` — Shared test fixtures and factories
- `beads/**` — Update bead status and QA gate fields

## Restricted
- No application code modifications (test code only)
- No integration or E2E test modifications
- No infrastructure access
- No network access
