# Global Heartbeat Schedule

## Overview
Heartbeat checks are periodic self-assessments that agents perform to maintain system health and progress.

## Schedule

### L1 — PersonalAssistant (every 15 minutes)
- Check for new messages from DJ
- Summarize system state
- Report blocked tasks
- Verify agent health

### L2 — AICoordinator (every 30 minutes)
- Review beads stats (`bd stats`)
- Check blocked issues (`bd blocked`)
- Route new tasks to appropriate coordinators
- Review Alpha/Bravo cluster state
- Trigger memory curation if backlog > threshold

### L3 — RepoControlAI (every 30 minutes)
- Check open PRs
- Review ticket state transitions
- Verify artifact generation for completed tasks
- Run documentation parity check
- Sync beads (`bd sync`)

### L4 — Task Agents (on-demand)
Task-level agents are triggered by beads task assignment, not scheduled. No heartbeat required.

## Health Indicators
- **Green**: All agents responsive, no blocked tasks > 24h
- **Yellow**: Some agents unresponsive OR blocked tasks > 24h
- **Red**: Core agents (L1-L3) unresponsive OR critical tasks blocked
