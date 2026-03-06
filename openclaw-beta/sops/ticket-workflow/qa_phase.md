# SOP: Ticket Workflow — QA Phase

## Entry Criteria
- Implementation complete
- PR created with passing CI
- Dev-level unit tests included

## Steps

### 1. Test Plan Creation
- QAPlanningAgent reads spec and architecture doc
- Creates test plan in `docs/qa/test_plans/<feature>.md`
- Identifies test types needed (unit, integration, e2e)
- Assigns test tasks to QA sub-agents

### 2. Unit Test Execution
- QAUnitTestAgent reviews existing tests
- Writes additional unit tests per test plan
- Ensures branch coverage meets threshold (target: 80%)
- Reports coverage metrics

### 3. Integration Test Execution
- QAIntegrationAgent writes integration tests
- Tests API contracts and service interactions
- Verifies data flow between components
- Reports integration test results

### 4. E2E Test Execution (if UI changes)
- PlaywrightTestAgent writes e2e tests
- Tests critical user workflows
- Captures screenshots on failure
- Reports visual regression results

### 5. Quality Report
- QAPlanningAgent aggregates all test results
- Produces quality report with:
  - Coverage metrics
  - Test pass/fail summary
  - Identified risks
  - Recommendation (pass/fail/conditional pass)

## Exit Criteria
- All test types executed per test plan
- Coverage meets thresholds
- No critical test failures
- Quality report produced and logged

## Quality Thresholds
- Unit test coverage: >= 80%
- Integration tests: All API contracts verified
- E2E tests: All critical user flows pass
- No flaky tests (must pass 3 consecutive runs)
