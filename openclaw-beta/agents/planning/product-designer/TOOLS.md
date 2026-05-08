# ProductDesignerAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read feature beads for design context |
| `filesystem` | RW | Read specs, write product docs to `docs/product/` |
| `time` | R | Timestamps |
| `fetch` | R | Research competitor products, design references (sandboxed) |

## Authorized File Paths (Write)
- `docs/product/**` — Product design documents
- `beads/**` — Update bead status
- `agents/planning/product-designer/memory/` — Agent memory

## Restricted
- No code execution
- No technical spec writing (RequirementsArchitectAgent)
- No infrastructure access
- `fetch` sandboxed — scanned by PromptInjectionAgent
