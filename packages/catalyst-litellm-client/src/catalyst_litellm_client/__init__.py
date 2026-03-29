"""
Catalyst LiteLLM Client — Unified LLM API access for all projects.

Provides OpenAI-compatible access to all models through LiteLLM:
- Local Ollama models
- Cloud providers (OpenAI, Anthropic, etc.)
- RunPod serverless endpoints
- Cost tracking via litellm spend logs
"""

from .client import CatalystLiteLLMClient
from .config import LiteLLMConfig

__version__ = "0.1.0"
__all__ = ["CatalystLiteLLMClient", "LiteLLMConfig"]
