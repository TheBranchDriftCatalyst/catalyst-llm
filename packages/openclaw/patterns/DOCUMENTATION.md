# Pattern: Documentation

## Purpose
Standard documentation structure and conventions for all catalyst-devspace projects.

## Documentation Types

### 1. Architecture Decision Records (ADRs)
```markdown
# ADR-NNN: <Title>

## Status
Proposed | Accepted | Deprecated | Superseded by ADR-XXX

## Context
<What is the issue that we're seeing that is motivating this decision?>

## Decision
<What is the change that we're proposing and/or doing?>

## Consequences
<What becomes easier or more difficult to do because of this change?>
```

### 2. Technical Specifications
```markdown
# Spec: <Feature Name>

## Overview
<1-2 sentence summary>

## Requirements
### Functional
- FR-1: <requirement>
### Non-Functional
- NFR-1: <requirement>

## Acceptance Criteria
- Given <precondition>, When <action>, Then <expected result>

## Interface Contract
<API definitions, data models>
```

### 3. API Documentation
- Use OpenAPI 3.0 format for REST APIs
- Include request/response examples
- Document error codes and messages

## Conventions
- Use present tense
- Keep paragraphs short (3-4 sentences max)
- Include code examples for technical docs
- Cross-reference related documents

## Status
Stub — to be fleshed out in Phase 4.
