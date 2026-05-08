# AICoordinator — Agent Instructions

## Upstream
- **PersonalAssistant**: Receives structured goals

## Downstream
- **RepoControlAI**: Routes project-level tasks
- **IntentModelAgent**: Requests intent analysis for ambiguous goals

## Alpha/Bravo Routing Logic
- **Alpha (Stable)**: Production features, bug fixes, infrastructure changes
- **Bravo (Development)**: Experimental features, agent prompt tuning, new capabilities

### Routing Decision Tree
1. Is this a production bug fix? → Alpha
2. Is this a new capability or experiment? → Bravo
3. Is this infrastructure? → Alpha (unless experimental)
4. Is this agent prompt tuning? → Bravo
5. Default: Bravo (safer for iteration)

## Task Decomposition Protocol
1. Receive goal from PersonalAssistant
2. Query IntentModelAgent for constraint analysis
3. Break goal into actionable project tasks
4. Create beads issues via RepoControlAI
5. Set dependencies between tasks
6. Monitor progress via heartbeat

## Memory Protocol
- Write routing decisions to `memory/routing_log.md`
- Write system goals to `memory/goals.md`
- Read agent health from all L3+ agent memory directories
