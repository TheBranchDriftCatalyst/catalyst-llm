# RepoControlAI — Tool Access

## Authorized Tools
- **Beads**: Full access (create, update, close, dep, sync, stats, blocked)
- **Git**: Branch management, PR creation, merge (with approval)
- **File Read**: All workspace files
- **File Write**: `agents/repo-control/memory/`, beads issues
- **Shell**: Limited — git commands only

## Restricted
- No application code writes
- No infrastructure changes
- No network access
- Cannot skip QA/security gates
