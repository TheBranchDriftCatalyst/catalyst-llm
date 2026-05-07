# SOP: Ticket Workflow — Discovery Phase

## Entry Criteria
- DJ has communicated a goal, feature idea, or bug report
- PersonalAssistant has structured the input

## Steps

### 1. Intent Analysis
- IntentModelAgent analyzes the request
- Extracts explicit goals, implicit constraints, ambiguities
- Updates `memory/user_intent.md`

### 2. Goal Structuring
- AICoordinator receives structured intent analysis
- Determines scope: feature, bug fix, infrastructure, documentation
- Routes to Alpha or Bravo cluster based on risk/type

### 3. Ticket Creation
- RepoControlAI creates initial beads issue
- Sets type, priority, and initial assignee (ProductDesignerAgent for features)
- Creates dependency chain for planning workflow

### 4. Confirmation
- PersonalAssistant confirms plan with DJ
- DJ approves, modifies, or rejects

## Exit Criteria
- Beads issue created with type and priority
- Assigned to appropriate planning agent
- DJ has approved the approach

## Artifacts Produced
- Beads issue (open, assigned)
- Intent analysis in `memory/user_intent.md`
