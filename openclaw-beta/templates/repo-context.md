# Repo Context: <repo-name>

> This file provides shared context for all agents working on this repository.
> Every dev agent reads this before starting work. Keep it accurate and current.

## Repository
- **Name**: <repo-name>
- **URL**: <git-url>
- **Branch Strategy**: main (stable) + feature branches
- **Language**: <primary language>
- **Framework**: <primary framework>

## Quick Start
```bash
# Clone and setup
<setup commands>

# Run dev server
<dev commands>

# Run tests
<test commands>
```

## Architecture Overview
<2-5 sentences describing the system architecture>

## Directory Structure
```
src/
├── <dir>/          # <description>
├── <dir>/          # <description>
└── <dir>/          # <description>
tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
└── e2e/            # End-to-end tests
```

## Key Patterns
- **State Management**: <pattern>
- **API Layer**: <pattern>
- **Error Handling**: <pattern>
- **Authentication**: <pattern>
- **Data Access**: <pattern>

## Conventions
- **Naming**: <file/variable/function naming conventions>
- **Imports**: <import ordering conventions>
- **Testing**: <test naming, fixture patterns>
- **Commits**: <commit message format reference>

## Dependencies (Critical)
| Package | Purpose | Version Constraint |
|---------|---------|-------------------|
| <pkg> | <why> | <constraint> |

## Environment
- **Node/Python version**: <version>
- **Package manager**: <yarn/pnpm/poetry>
- **Required env vars**: <list or reference to .env.example>

## API Contracts
<Links to OpenAPI specs, GraphQL schemas, or interface definitions>

## Known Issues / Tech Debt
- <Issue 1>
- <Issue 2>

## Contact Points
- **Architecture questions**: ArchitecturePlannerAgent
- **Backend questions**: BackendAgent
- **Frontend questions**: FrontendDesignAgent
- **Infra questions**: InfrastructureAgent
