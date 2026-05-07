# IndianDev — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Read assigned beads, update status and artifacts |
| `filesystem` | RW | Read bead/spec/context files, write CLI session logs |
| `time` | R | Timestamps for bead History entries |
| `context7` | R | Query docs for prompt construction context |
| `github` | RW | Create PRs from CLI output, link to beads |

## Primary Tool: Claude Code CLI (Headless)

IndianDev's main tool is spawning Claude Code CLI sessions via shell:

### Invocation
```bash
# Basic headless execution
claude --headless --prompt "<constructed prompt>"

# With specific model
claude --headless --model claude-sonnet-4-6 --prompt "<prompt>"

# With workspace directory
claude --headless --cwd /path/to/repo --prompt "<prompt>"
```

### Session Management
- One CLI session per bead (no concurrent sessions per bead)
- Session timeout: 10 minutes (configurable)
- Output captured to `agents/development/indian-dev/memory/sessions/`
- Failed sessions logged with exit code and stderr

### What the CLI Session Can Do
The spawned Claude Code CLI has access to:
- Read/write any file in the target repository
- Run shell commands (build, test, lint, format)
- Git operations (branch, add, commit — not push)
- Any MCPs configured in the repo's `.claude/settings.json`
- Glob/grep for code exploration

## Authorized File Paths (Write)
- `beads/**` — Update bead status and artifacts
- `agents/development/indian-dev/memory/**` — Session logs and agent memory
- Target repo files — via CLI session (not directly)

## Shell Access (Tier 3)
- `claude` — Claude Code CLI invocation
- `git` — Branch management, status checks
- No direct application code writes (must go through CLI)

## Restricted
- No infrastructure modifications
- No direct production deployments
- Cannot bypass QA/Security gates
- CLI sessions are scoped to one repo at a time
- Cannot spawn multiple concurrent CLI sessions for same bead
