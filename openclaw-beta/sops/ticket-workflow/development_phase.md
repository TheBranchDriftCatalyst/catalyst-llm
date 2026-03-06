# SOP: Ticket Workflow — Development Phase

## Entry Criteria
- Planning artifacts complete (product doc, use cases, spec, architecture)
- Implementation tickets created in Beads
- Tickets assigned to development team agents

## Steps

### 1. Spec Review
- DeveloperAgent reads architecture doc and spec
- Identifies implementation approach
- Flags any spec ambiguities back to ArchitecturePlannerAgent

### 2. Implementation
- DeveloperAgent (or specialized sub-agent) writes code
- Follows existing patterns and conventions
- Writes unit tests alongside implementation
- Commits to feature branch

### 3. PR Creation
- DeveloperAgent creates PR with:
  - Clear title and description
  - Reference to spec and beads issue
  - Summary of changes
  - Test coverage report

### 4. QA Gate
- QAPlanningAgent creates test plan
- QAUnitTestAgent runs/writes unit tests
- QAIntegrationAgent runs/writes integration tests
- PlaywrightTestAgent runs/writes e2e tests (if UI changes)
- All tests must pass before proceeding

### 5. Security Gate
- SecurityAgent performs security scan
- Checks for OWASP Top 10, dependency CVEs, secret exposure
- All critical/high findings must be resolved

### 6. Review Gate
- PRReviewAgent reviews code quality
- Checks pattern consistency, test coverage, documentation
- Approves or requests changes

### 7. Merge
- RepoControlAI merges PR after all gates pass
- Closes beads issue with summary

## Exit Criteria
- PR merged to target branch
- All gates passed (QA, Security, Review)
- Beads issue closed
- Documentation updated (if applicable)

## Failure Loops
- QA failure → back to Implementation (step 2)
- Security finding → back to Implementation (step 2)
- Review changes requested → back to Implementation (step 2)
