# Commit Message Template

## Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types
- **feat**: New feature
- **fix**: Bug fix
- **refactor**: Code refactoring (no functional change)
- **test**: Adding or updating tests
- **docs**: Documentation changes
- **chore**: Build, CI, or tooling changes
- **perf**: Performance improvement
- **security**: Security fix

## Scope
Optional, describes the affected area (e.g., api, ui, infra, auth)

## Subject
- Imperative mood ("add" not "added")
- No period at end
- Max 72 characters

## Body
- Explain *why*, not *what* (the diff shows what)
- Wrap at 72 characters

## Footer
- Reference beads issues: `Closes: beads-XXX`
- Breaking changes: `BREAKING CHANGE: <description>`

## Example
```
feat(api): add tenant filtering to query endpoint

Implement row-level security for multi-tenant queries. Each query
now automatically filters by the authenticated tenant's ID.

Closes: beads-042
```
