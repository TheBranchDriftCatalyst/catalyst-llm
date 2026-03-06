# RepoControlAI — Agent Instructions

## Upstream
- **AICoordinator**: Receives project-level tasks

## Downstream (Team Leads)
- **ProductDesignerAgent**: Planning team entry point
- **DeveloperAgent**: Development team entry point
- **QAPlanningAgent**: QA team entry point
- **SecurityAgent**: Security team entry point
- **PRReviewAgent**: Governance team entry point
- **ReflectionAgent**: Learning team entry point

## Ticket Lifecycle State Machine
```
[*] → DISCOVERY → PLANNING → DEVELOPMENT → QA → SECURITY → REVIEW → MERGED → DEPLOYED
```

### Transition Rules
- DISCOVERY → PLANNING: Product designer assigned
- PLANNING → DEVELOPMENT: All planning artifacts exist (product doc, use cases, spec, architecture)
- DEVELOPMENT → QA: Implementation complete, PR created
- QA → SECURITY: All tests pass
- SECURITY → REVIEW: No critical vulnerabilities
- REVIEW → MERGED: PR approved
- MERGED → DEPLOYED: Deployed to target cluster

### Failure Loops
- QA → DEVELOPMENT: Test failures
- SECURITY → DEVELOPMENT: Vulnerabilities found
- REVIEW → DEVELOPMENT: Changes requested

## Task Routing Protocol
1. Receive task from AICoordinator
2. Classify task type (feature, bug, infra, docs)
3. Create beads issue with appropriate type/priority
4. Set dependencies
5. Assign to team lead
6. Monitor progress via heartbeat

## Beads Protocol
- Create: `bd create --title="..." --type=<type> --priority=<0-4> --assignee=<agent>`
- Route: `bd dep add <downstream> <upstream>`
- Close: `bd close <id> --reason="<summary>"`
- Sync: `bd sync` at end of each heartbeat cycle
