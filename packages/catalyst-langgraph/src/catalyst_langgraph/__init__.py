"""
catalyst-langgraph — LangGraph agent service for the Catalyst stack.

Bundles:
  - CatalystLiteLLMClient / LiteLLMConfig — the LiteLLM HTTP client this
    service is built on (kept stable; consumed inside LangGraph nodes).
  - graph (forthcoming) — StateGraph wiring model + tool nodes.
  - server (forthcoming) — FastAPI app exposing /api/chat/stream and friends.
"""

from .client import CatalystLiteLLMClient
from .config import LiteLLMConfig

__version__ = "0.3.0"
__all__ = ["CatalystLiteLLMClient", "LiteLLMConfig"]
