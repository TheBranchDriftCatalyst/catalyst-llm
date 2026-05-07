# mac-node + LiteLLM pytest suite

Parametrized model coverage for the catalyst-llm inference stack. Tests are
generated from `packages/mac-node/models.yaml` — every mac-targeted model with
a relevant capability tag (`chat`, `vision`, `embedding`) gets a test case per
selected backend.

## Backends

| Backend | API | Model addressing |
|---|---|---|
| `mac` | Ollama-native `/api/{generate,embeddings}` at `192.168.1.33:11434` | raw tag (e.g. `gemma4:26b`) |
| `litellm` | OpenAI-compatible `/v1/{chat/completions,embeddings}` proxy | `mac/<alias>` (e.g. `mac/gemma4-vision`) |

## Run

From the repo root:

```bash
# Default — direct mac node
uv run --with pytest --with httpx --with pyyaml --with pillow \
  pytest packages/mac-node/tests/python/

# Through LiteLLM proxy (start a port-forward first)
kubectl port-forward -n catalyst-llm svc/litellm 4000:4000 &
LITELLM_API_KEY=$(...) \
uv run --with pytest --with httpx --with pyyaml --with pillow \
  pytest packages/mac-node/tests/python/ --backend=litellm

# Compare both
... --backend=both

# Single capability
... -k vision

# Quick smoke (one model per backend)
... --quick
```

## CLI flags

| Flag | Default | Source of default |
|---|---|---|
| `--backend` | `mac` | `$BACKEND`, choices: `mac`, `litellm`, `both` |
| `--mac-host` | `192.168.1.33` | `$MAC_HOST` |
| `--mac-port` | `11434` | `$MAC_PORT` |
| `--litellm-base` | `http://localhost:4000` | `$LITELLM_BASE` |
| `--litellm-key` | (empty) | `$LITELLM_API_KEY` |
| `--quick` | off | — |

## Test selection

| Marker | Matches |
|---|---|
| `chat` | `tests/python/test_chat.py` |
| `vision` | `tests/python/test_vision.py` |
| `embedding` | `tests/python/test_embedding.py` |
| `slow` | tests with cold-load > a few seconds (vision) |

`pytest -m chat` etc.

## Skip behavior

* Models not pulled on the mac node (`/api/tags` miss) → skipped on `mac`.
* Models not registered in the LiteLLM `/v1/models` listing → skipped on `litellm`.
* Backend unreachable → all its tests skipped with reason `<backend> unreachable`.

## Future

This suite is intentionally minimal: it asserts *availability + correctness
at a low bar*. The next layer is a benchmarking plugin that records
tokens/sec, p95 latency, and accuracy against curated fixtures. The
`CallResult` dataclass already carries the timing fields needed.
