# FrontendDesignAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Claim UI beads, update status and artifacts |
| `filesystem` | RW | Read specs, write components to `src/ui/`, `stories/` |
| `time` | R | Timestamps for bead History entries |
| `context7` | R | Query React, Radix UI, Tailwind CSS, Storybook docs |
| `github` | RW | Create PRs for UI changes, link to beads |
| `fetch` | R | Reference design systems, component libraries (sandboxed) |

## context7 Usage Pattern
Before implementing any component:
1. `resolve-library-id` — find the library (e.g., "radix-ui", "tailwindcss", "storybook")
2. `query-docs` — search for component patterns, props, accessibility guidelines

## Authorized File Paths (Write)
- `src/ui/**` — UI components
- `stories/**` — Storybook stories
- `tests/e2e/pages/**` — Page objects for E2E tests (shared with PlaywrightTestAgent)
- `beads/**` — Update bead status and artifacts
- `agents/development/frontend-design/memory/` — Agent memory

## Restricted
- No backend code modifications (`src/api/`, `services/`)
- No infrastructure access
- No direct database access
- `fetch` MCP is sandboxed — content scanned by PromptInjectionAgent
