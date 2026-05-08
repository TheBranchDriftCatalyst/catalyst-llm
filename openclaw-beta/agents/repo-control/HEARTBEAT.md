# RepoControlAI — Heartbeat (every 30 minutes)

## Checklist
- [ ] Check open PRs — any stale > 24h?
- [ ] Review ticket state transitions — any stuck in wrong state?
- [ ] Verify artifact generation for recently closed tasks
- [ ] Check documentation parity — do merged PRs have docs?
- [ ] Run `bd sync` to push state to remote
- [ ] Review `bd blocked` for dependency issues
- [ ] Log heartbeat to `memory/heartbeat_log.md`
