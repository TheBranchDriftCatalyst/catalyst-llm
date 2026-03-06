# SOP: Bead Protocol — How Agents Use Bead Files

> The filesystem IS the message bus. Bead files are the task protocol.

## Overview

```
Planning Agents (create beads)
        ↓
    beads/ directory (the bridge)
        ↓
Execution Agents (read beads, produce artifacts, update status)
        ↓
    memory/reflections/ (captured learnings)
```

## The Three Layers

### 1. Human Intent Layer
DJ communicates a goal → PersonalAssistant structures it → AICoordinator routes it.

### 2. Planning Layer (Creates Beads)
Planning agents produce:
- `beads/<FEATURE>/index.md` — Feature-level bead with subtask DAG
- `beads/<FEATURE>/BEAD-NNN-<slug>.md` — Individual task beads
- Planning artifacts in `docs/`

### 3. Execution Layer (Reads Beads)
Execution agents:
- Scan `beads/` for assigned, unblocked tasks
- Read context files (spec, architecture, repo context)
- Produce artifacts (code, tests, scans)
- Update bead status in-place
- ReflectionAgent captures learnings

## Agent Execution Loop

### For Any Execution Agent

```
LOOP:
  1. scan beads/ for files where Assigned-To = MY_NAME
  2. filter by Status = OPEN
  3. for each candidate bead:
     a. check Depends-On — ALL must be COMPLETE
     b. if blocked, skip
     c. if eligible, claim it
  4. CLAIM:
     a. update Status → IN_PROGRESS
     b. add History entry
  5. EXECUTE:
     a. read Context files (spec, arch, repo context)
     b. perform the work
     c. write artifacts to designated paths
     d. update Artifacts section in bead
  6. SUBMIT:
     a. update Status → REVIEW
     b. fill QA Gate fields
     c. add History entry
  7. WAIT for gate results
```

### For RepoControlAI (Gate Enforcer)

```
LOOP:
  1. scan beads/ for Status = REVIEW
  2. for each:
     a. check QA Gate — all required tests PASS?
     b. check Security Gate — no Critical/High findings?
     c. check Review Gate — APPROVED?
  3. if ALL gates pass:
     a. merge PR
     b. update Status → COMPLETE
     c. trigger ReflectionAgent (update BEAD-reflection if exists)
  4. if ANY gate fails:
     a. update Status → IN_PROGRESS
     b. add feedback to bead Notes
     c. add History entry with failure details
```

### For Planning Agents (Bead Creation)

```
PIPELINE:
  1. ProductDesignerAgent creates product doc
  2. UseCaseModelingAgent creates use case flows
  3. RequirementsArchitectAgent creates spec with acceptance criteria
  4. ArchitecturePlannerAgent creates architecture doc
  5. ArchitecturePlannerAgent creates:
     a. beads/<FEATURE>/index.md (feature bead)
     b. beads/<FEATURE>/BEAD-NNN-*.md (task beads)
     c. sets Dependencies between beads
     d. assigns each bead to an agent
  6. Feature bead Status → ACTIVE
```

## Context Chain

When an agent picks up a bead, it reads context in this order:

```
1. The bead file itself (requirements, dependencies)
      ↓
2. Parent feature index (goal, DAG, planning artifacts)
      ↓
3. Linked spec (docs/specs/<feature>.md)
      ↓
4. Linked architecture doc (docs/architecture/<feature>.md)
      ↓
5. Repo context (contexts/<repo-name>.md)
      ↓
6. Shared dev context (contexts/shared-dev.md)
      ↓
7. Agent's own memory (agents/<name>/memory/)
      ↓
8. Relevant reflections (memory/reflections/ — search by tags)
```

## Actor-Critic Pattern

The Development Loop implements actor-critic via bead status:

```
Actor (DeveloperAgent):
  - reads bead
  - produces code artifacts
  - submits for review

Critic (QA + Security + PRReview):
  - evaluates artifacts against acceptance criteria
  - updates gate fields in bead
  - if FAIL: sends bead back to IN_PROGRESS with feedback

Loop continues until all gates PASS or max iterations reached.
```

The **feedback** lives in the bead file itself:
- QA Gate fields show test results
- Security Gate fields show scan findings
- Review Gate shows reviewer comments
- History section shows the full iteration log

## Reflexion Pattern

After every bead completes (pass OR fail), ReflectionAgent:

```
1. reads the bead's full History
2. reads the QA/Security/Review gate results
3. writes episodic reflection to memory/reflections/<bead-id>_reflection.md
4. fills the bead's Reflexion Hook section
5. if pattern detected (>2 similar failures): promotes to MEMORY.md
```

## Concurrency Rules

- Multiple beads from different features can execute in parallel
- Within a feature, the DAG determines ordering
- An agent can only have ONE bead IN_PROGRESS at a time
- RepoControlAI monitors all beads and enforces ordering

## Filesystem as Protocol

Why this works:
- Agents interact with the filesystem as their primary context surface
- No external task system, message queue, or database needed
- Bead files are human-readable and git-tracked
- Status changes are atomic (single file write)
- The DAG is implicit in Depends-On/Blocks fields
- History provides a full audit trail
- Future: Beads UI sidecar can visualize the DAG from these files
