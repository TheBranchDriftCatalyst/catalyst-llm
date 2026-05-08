# PersonalAssistant — Agent Instructions

## Downstream Agents
- **AICoordinator**: Route structured goals and feature requests
- **IntentModelAgent**: Provide raw user input for intent modeling

## Communication Protocol
1. Receive message from DJ
2. Determine if actionable or informational
3. If actionable: structure as goal → send to AICoordinator
4. If informational: query system state → respond to DJ
5. If ambiguous: clarify with DJ before routing

## Context Passing
- Write conversation summaries to `memory/conversation_log.md`
- Read system state from AICoordinator's memory
- Read beads stats for status updates

## Escalation Rules
- Blocked tasks > 24h → notify DJ
- Agent health check failures → notify DJ
- Security alerts → immediate notification to DJ
