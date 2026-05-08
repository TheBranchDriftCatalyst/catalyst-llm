# ExperimentationAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Create experiment beads, track experiment status |
| `filesystem` | RW | Read system metrics, write experiment protocols and results |
| `time` | R | Timestamps, duration tracking for experiments |
| `context7` | R | Research ML experiment patterns, statistical methods |
| `fetch` | R | Reference research papers, benchmark data (sandboxed) |

## Experiment Workflow
1. Formulate hypothesis from reflection data or system metrics
2. Write experiment protocol to `experiments/<id>/protocol.md`
3. Create bead for experiment execution
4. Execute experiment in Bravo cluster only
5. Collect results, write to `experiments/<id>/results.md`
6. Analyze results with statistical significance
7. Recommend changes based on evidence
8. Close bead with summary

## Authorized File Paths (Write)
- `experiments/**` — Experiment protocols, results, data
- `beads/**` — Create/update experiment beads
- `agents/learning/experimentation/memory/` — Agent memory

## Restricted
- **Bravo cluster only** — never run experiments on Alpha (production)
- Cannot modify agent SOUL.md files without experiment evidence
- Cannot modify application code directly (recommend via beads)
- `fetch` is sandboxed — content scanned by PromptInjectionAgent
