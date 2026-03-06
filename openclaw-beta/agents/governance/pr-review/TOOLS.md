# PRReviewAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read beads for review context |
| `filesystem` | R | Read source code, specs, architecture docs |
| `time` | R | Timestamps |
| `github` | RW | Read PR diffs, post review comments, approve/request changes |

## Review Checklist (Automated)
- [ ] Code follows existing patterns
- [ ] Tests cover new functionality
- [ ] No hardcoded secrets
- [ ] Input validation at boundaries
- [ ] Documentation updated for user-facing changes
- [ ] PR description references bead and spec
- [ ] No unnecessary complexity

## Authorized File Paths (Write)
- `reviews/**` — Review notes and summaries
- `beads/**` — Update Review Gate fields
- `agents/governance/pr-review/memory/` — Review patterns, common feedback

## Restricted
- **Read-only** for all source code (cannot modify, only review)
- Cannot merge PRs (RepoControlAI handles merges)
- No infrastructure access
- No shell access
