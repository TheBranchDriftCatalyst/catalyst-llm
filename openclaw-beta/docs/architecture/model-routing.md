# Model Routing Strategy — Cost Optimization via LiteLLM

## Overview

Every agent's LLM calls route through LiteLLM proxy. LiteLLM supports **model aliasing**
and **router-level fallbacks**, so we can assign different models per agent tier without
changing agent code. OpenClaw's `model` field per agent maps to a LiteLLM model name.

## The Cost Problem

Running 27 agents on Opus would be expensive. Most L4 task agents don't need Opus-level
reasoning — they follow specs, write code, run checks. The strategy:

```
Tier 1 (Heavy):   Opus    — Complex reasoning, coordination, ambiguity resolution
Tier 2 (Medium):  Sonnet  — Implementation, review, planning with clear specs
Tier 3 (Light):   Haiku   — Mechanical tasks, scanning, test execution, curation
Tier 4 (Local):   Ollama  — Simple pattern matching, repetitive operations
```

## Agent → Model Mapping

### Tier 1: Heavy (Opus) — $15/M input, $75/M output
Strategic agents that handle ambiguity, make decisions, and coordinate.

| Agent | Why Opus |
|-------|----------|
| PersonalAssistant | Interprets vague human input, needs nuance |
| AICoordinator | Makes routing decisions, resolves ambiguity |
| IntentModelAgent | Extracts implicit constraints, models user intent |
| RepoControlAI | Manages complex ticket state machine, enforces gates |

**Cost control**: These agents run on heartbeat (15-30 min intervals), not continuously.
Estimated: ~200 calls/day × ~2K tokens avg = ~400K tokens/day = ~$6-10/day.

### Tier 2: Medium (Sonnet) — $3/M input, $15/M output
Agents that follow specs and produce concrete artifacts. Clear inputs, clear outputs.

| Agent | Why Sonnet |
|-------|-----------|
| ProductDesignerAgent | Creative but structured output |
| UseCaseModelingAgent | Systematic flow generation |
| RequirementsArchitectAgent | Technical spec writing |
| ArchitecturePlannerAgent | Design decisions from specs |
| DeveloperAgent | Code implementation (bead-to-prompt) |
| IndianDev | Prompt construction for CLI delegation |
| FrontendDesignAgent | UI component implementation |
| BackendAgent | API/service implementation |
| InfrastructureAgent | K8s manifest writing |
| QAPlanningAgent | Test strategy from specs |
| SecurityAgent | Vulnerability analysis |
| PRReviewAgent | Code review |
| DocumentationAgent | Doc generation |
| DocConsistencyAgent | Parity checking |
| ReflectionAgent | Self-critique analysis |
| ExperimentationAgent | Experiment design |
| CongressionalSpyAgent | Report generation |

**Cost control**: These fire on-demand (bead assignment), not continuously.
Estimated: ~50-100 calls/day × ~4K tokens avg = ~200K-400K tokens/day = ~$1-4/day.

### Tier 3: Light (Haiku) — $0.25/M input, $1.25/M output
Mechanical tasks with clear patterns. Speed matters more than depth.

| Agent | Why Haiku |
|-------|----------|
| QAUnitTestAgent | Pattern-matching test generation |
| QAIntegrationAgent | API contract testing |
| PlaywrightTestAgent | Step-by-step UI automation |
| PromptInjectionAgent | Pattern scanning (fast response needed) |
| MemoryCuratorAgent | Compression and tagging |
| DocArchiverAgent | Summarization and archival |

**Cost control**: High volume but tiny tokens. Estimated: ~$0.10-0.50/day.

### Tier 4: Local (Ollama) — $0
For tasks that don't need cloud models at all.

| Agent | Candidate Local Model | When |
|-------|----------------------|------|
| PromptInjectionAgent | `qwen2.5-coder:7b` | Simple pattern matching |
| DocArchiverAgent | `llama3.2` | Basic summarization |
| MemoryCuratorAgent | `llama3.2` | Tag extraction, dedup |

**Note**: Local models are fallback options. Start with Haiku, drop to local if
quality is acceptable for the task.

## Estimated Daily Cost

| Tier | Agents | Est. Calls/Day | Est. Cost/Day |
|------|--------|---------------|---------------|
| Opus | 4 | ~200 | $6-10 |
| Sonnet | 17 | ~100 | $1-4 |
| Haiku | 6 | ~200 | $0.10-0.50 |
| Local | 0-3 | ~100 | $0 |
| **Total** | **27** | **~600** | **$7-15/day** |

vs. all-Opus: ~600 calls × $75/M output ≈ $50-100/day.

**Savings: 70-85% cost reduction** with tiered routing.

## LiteLLM Router Configuration

LiteLLM supports **model groups** with fallback chains. Define agent-tier aliases:

```yaml
# In litellm config.yaml — add these router entries
router_settings:
  routing_strategy: "simple-shuffle"  # or "least-busy"
  num_retries: 2
  timeout: 120

model_list:
  # --- Agent Tier Aliases ---

  # Tier 1: Heavy (Opus with Sonnet fallback)
  - model_name: "agent/heavy"
    litellm_params:
      model: "anthropic/claude-opus-4-20250514"
  - model_name: "agent/heavy"
    litellm_params:
      model: "anthropic/claude-sonnet-4-20250514"
      # Fallback — used when Opus rate-limited or down

  # Tier 2: Medium (Sonnet with Haiku fallback)
  - model_name: "agent/medium"
    litellm_params:
      model: "anthropic/claude-sonnet-4-20250514"
  - model_name: "agent/medium"
    litellm_params:
      model: "anthropic/claude-haiku-4-5-20251001"

  # Tier 3: Light (Haiku with local fallback)
  - model_name: "agent/light"
    litellm_params:
      model: "anthropic/claude-haiku-4-5-20251001"
  - model_name: "agent/light"
    litellm_params:
      model: "ollama/qwen2.5-coder:7b"
      api_base: "http://host.docker.internal:11434"

  # Tier 4: Local only
  - model_name: "agent/local"
    litellm_params:
      model: "ollama/llama3.2"
      api_base: "http://host.docker.internal:11434"
```

## OpenClaw Agent Config Mapping

In the OpenClaw gateway `config.json5`, each agent references a LiteLLM model alias:

```json5
{
  agents: {
    list: [
      { id: "personal-assistant", model: "agent/heavy", /* ... */ },
      { id: "ai-coordinator",     model: "agent/heavy", /* ... */ },
      { id: "intent-model",       model: "agent/heavy", /* ... */ },
      { id: "repo-control",       model: "agent/heavy", /* ... */ },

      { id: "developer",          model: "agent/medium", /* ... */ },
      { id: "indian-dev",         model: "agent/medium", /* ... */ },
      { id: "frontend-design",    model: "agent/medium", /* ... */ },
      { id: "backend",            model: "agent/medium", /* ... */ },
      { id: "infrastructure",     model: "agent/medium", /* ... */ },
      { id: "product-designer",   model: "agent/medium", /* ... */ },
      // ... all other Sonnet agents

      { id: "qa-unit-test",       model: "agent/light", /* ... */ },
      { id: "qa-integration",     model: "agent/light", /* ... */ },
      { id: "playwright-test",    model: "agent/light", /* ... */ },
      { id: "prompt-injection",   model: "agent/light", /* ... */ },
      { id: "memory-curator",     model: "agent/light", /* ... */ },
      { id: "doc-archiver",       model: "agent/light", /* ... */ },
    ]
  }
}
```

## Cost Monitoring

LiteLLM provides built-in spend tracking:
- Per-model cost reporting
- Per-key budget limits
- Daily/monthly spend alerts

### Budget Limits (Recommended)
```yaml
litellm_settings:
  max_budget: 50.00          # Monthly budget cap ($)
  budget_duration: "monthly"
```

### Per-Agent Budget (Advanced)
LiteLLM supports per-API-key budgets. Create a key per agent tier:
- `agent-heavy-key`: $15/day limit
- `agent-medium-key`: $5/day limit
- `agent-light-key`: $1/day limit

## Progressive Cost Optimization

### Phase 1 (Now): Start Conservative
- L1-L3 on Opus, all L4 on Sonnet
- Measure actual usage and quality

### Phase 2: Tier Down Where Quality Holds
- Move mechanical L4 agents to Haiku
- Test quality with automated eval (ReflectionAgent scores)
- Use ExperimentationAgent to A/B test model tiers

### Phase 3: Local Models Where Possible
- PromptInjectionAgent → local (pattern matching)
- DocArchiverAgent → local (basic summarization)
- Tag extraction and dedup → local

### Phase 4: Dynamic Routing
- LiteLLM can route based on prompt complexity
- Simple tasks → cheaper model automatically
- Complex tasks → upgrade to heavier model
- Use `router_settings.routing_strategy: "cost-based"` (when available)
