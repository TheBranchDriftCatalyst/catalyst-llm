# Catalyst LiteLLM Client

Local Python SDK for unified LLM API access through LiteLLM proxy.

Provides OpenAI-compatible client access to all models:
- Local Ollama models (hermes3:8b, mistral, etc.)
- Cloud providers (OpenAI, Anthropic, etc.)
- RunPod serverless endpoints
- Cost tracking via litellm spend logs

## Installation

From catalyst-llm:

```bash
cd packages/catalyst-litellm-client
pip install -e .
```

Or reference in projects via `pyproject.toml`:

```toml
dependencies = [
    "catalyst-litellm-client @ file:///path/to/catalyst-llm/packages/catalyst-litellm-client"
]
```

## Usage

```python
from catalyst_litellm_client import CatalystLiteLLMClient, LiteLLMConfig

# Use default config (from env vars or localhost)
client = CatalystLiteLLMClient()

# Or provide explicit config
config = LiteLLMConfig(
    base_url="http://litellm.catalyst-llm.svc.cluster.local:8000",
    api_key="your-api-key"
)
client = CatalystLiteLLMClient(config)

# Verify connection
if client.verify_connection():
    print("✓ Connected to LiteLLM")

# List available models
models = client.get_models()
print(f"Available: {models}")

# Get a chat model instance (LangChain ChatOpenAI)
llm = client.get_chat_model(
    model="runpod-dolphin",
    temperature=0,
)

# Use with LangChain
from langchain_core.messages import HumanMessage, SystemMessage

response = llm.invoke([
    SystemMessage(content="You are a helpful assistant."),
    HumanMessage(content="Hello!"),
])

print(response.content)
```

## Configuration

Via environment variables:

```bash
export LITELLM_BASE_URL="http://localhost:8000"
export LITELLM_API_KEY="test-key"
```

Or programmatically:

```python
from catalyst_litellm_client import LiteLLMConfig, CatalystLiteLLMClient

config = LiteLLMConfig(
    base_url="http://localhost:8000",
    api_key="your-key"
)
client = CatalystLiteLLMClient(config)
```

## Supported Models

All models configured in LiteLLM:

- **Local**: `hermes3:8b`, `mistral`, `llama3.2`, etc.
- **Cloud**: `gpt-4o`, `gpt-4o-mini`, `claude-opus-4`, etc.
- **RunPod**: `runpod-dolphin` (Dolphin Mistral 24B Venice)

## License

MIT
