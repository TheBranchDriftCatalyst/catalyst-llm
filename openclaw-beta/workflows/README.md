# Workflows — Lobster Pipeline Definitions

> This directory will contain Lobster workflow YAML files that define deterministic
> multi-agent pipelines for the Claw Orchestrator.

## What Goes Here

Lobster is OpenClaw's native workflow engine. It provides deterministic sequential
execution with JSON data flow between steps, approval gates, resume tokens, and
loop support for actor-critic patterns.

### Planned Workflows

| Workflow | Purpose | Status |
|----------|---------|--------|
| `planning-loop.lobster` | Feature idea → Product design → Use cases → Spec → Architecture → Beads | Phase 2 |
| `dev-loop.lobster` | Bead → Implement → QA → Security → Review → Merge | Phase 2 |
| `code-review.lobster` | Developer → Reviewer loop with max 3 iterations | Phase 2 |
| `reflexion.lobster` | Post-task → Reflection → Memory curation | Phase 3 |
| `full-pipeline.lobster` | End-to-end: planning → dev → QA → merge → reflect | Phase 4 |

### How Lobster Works

```yaml
name: example-pipeline
steps:
  - id: implement
    command: openclaw.invoke --tool sessions_send --args-json '{...}'
  - id: review
    command: openclaw.invoke --tool sessions_send --args-json '{...}'
    condition: $implement.completed
  - id: check-approval
    command: openclaw.invoke --tool llm-task --action json --args-json '{...}'
    # Extracts {approved: bool, feedback: string}
```

Loop support for actor-critic:
```yaml
steps:
  - id: code-review-loop
    workflow: code-review.lobster
    loop:
      max: 3
      until: $approval.approved
```

### Relationship to Bead Files

Lobster workflows orchestrate the **execution order** of agents. Bead files are the
**task protocol** — the data contract between steps. A typical flow:

1. Lobster step triggers an agent via `sessions_send`
2. Agent reads its assigned bead file from `beads/`
3. Agent executes, updates bead status and artifacts
4. Lobster reads the updated bead to determine next step
5. Next agent is triggered with context from the bead

### Prerequisites for Phase 2

Before workflows can run:
- [ ] OpenClaw gateway `config.json5` with agent definitions
- [ ] Lobster installed and configured
- [ ] `sessions_send` / `sessions_spawn` enabled with agent-to-agent allowlists
- [ ] Session key scheme defined (e.g., `orchestrator:<team>:<agent>`)
- [ ] At least 3 agents registered (PersonalAssistant, RepoControlAI, DeveloperAgent)
