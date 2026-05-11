# catalyst-langgraph

LangGraph-based agent service for the Catalyst stack. Owns the agent loop
and tool dispatch that previously lived in the browser-side TypeScript
SDK; UIs (the playground and friends) talk to it over a typed event
stream.

Bundles the LiteLLM HTTP client (`CatalystLiteLLMClient`) so LangGraph
nodes can build `ChatOpenAI` instances without an extra package hop.
External tool calls are forwarded to the FastAPI `tool-host` sidecar
over HTTP.

## Layout

```
src/catalyst_langgraph/
├── client.py     CatalystLiteLLMClient (LiteLLM HTTP wrapper, unchanged)
├── config.py     LiteLLMConfig (env + base URL)
├── graph.py      [forthcoming] StateGraph: model node ↔ tool node
├── tools/host.py [forthcoming] httpx wrappers calling tool-host
├── events.py     [forthcoming] Pydantic models for the SSE event union
└── server.py     [forthcoming] FastAPI app
```

## Installation (dev)

```bash
cd packages/catalyst-langgraph
pip install -e .
```

## Usage (today — pre-graph scaffolding)

```python
from catalyst_langgraph import CatalystLiteLLMClient, LiteLLMConfig

client = CatalystLiteLLMClient()
if client.verify_connection():
    print("Available:", client.get_models())

llm = client.get_chat_model(model="mac/qwen3-coder", temperature=0)
print(llm.invoke("Hello").content)
```

## Configuration

Environment variables:

```bash
export LITELLM_BASE_URL="http://litellm.talos00"   # or local proxy
export LITELLM_API_KEY="sk-..."                    # LITE_LLM_KEY also accepted
```

## Naming history

This package was previously `catalyst-litellm-client` (Python module
`catalyst_litellm_client`). It was renamed when we moved the agent loop
into Python via LangGraph; the LiteLLM client classes kept their names
since they accurately describe what they do.

## License

MIT
