# SOP: Ticket Workflow — Context

## Purpose
This SOP defines the standard workflow for how tickets flow through the Claw Orchestrator agent system, from discovery to deployment.

## Scope
Applies to all work items tracked in Beads within the catalyst-llm workspace.

## Roles
- **DJ (Human Operator)**: Initiates work, approves plans, unblocks decisions
- **PersonalAssistant (L1)**: Translates DJ's input into structured goals
- **AICoordinator (L2)**: Routes goals to appropriate teams
- **RepoControlAI (L3)**: Manages ticket lifecycle and enforcement
- **Task Agents (L4)**: Execute specific work items

## Ticket States
1. **DISCOVERY**: Initial idea or bug report captured
2. **PLANNING**: Product design, use cases, specs, architecture in progress
3. **DEVELOPMENT**: Implementation in progress
4. **QA**: Testing in progress (unit, integration, e2e)
5. **SECURITY**: Security scan in progress
6. **REVIEW**: PR review in progress
7. **MERGED**: PR merged, awaiting deployment
8. **DEPLOYED**: Live in target cluster

## Beads Mapping
- State tracking via `bd update --status`
- Dependencies via `bd dep add`
- Assignment via `bd update --assignee`
- Completion via `bd close --reason`
