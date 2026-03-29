"""Catalyst LiteLLM Client — OpenAI-compatible LLM access."""

import httpx
from typing import Optional

from langchain_openai import ChatOpenAI

from .config import LiteLLMConfig


class CatalystLiteLLMClient:
    """
    OpenAI-compatible client for LiteLLM proxy.

    Provides unified access to all LLM models through LiteLLM:
    - Local Ollama models (hermes3:8b, mistral, etc.)
    - Cloud endpoints (OpenAI, Anthropic, etc.)
    - RunPod serverless (runpod-dolphin, etc.)
    - Cost tracking through litellm spend logs
    """

    def __init__(self, config: Optional[LiteLLMConfig] = None):
        """
        Initialize the client.

        Args:
            config: LiteLLMConfig instance (defaults to env vars + localhost)
        """
        self.config = config or LiteLLMConfig()
        self._verified = False

    def verify_connection(self) -> bool:
        """
        Verify LiteLLM proxy is accessible and list available models.

        Returns:
            True if connection successful, False otherwise
        """
        try:
            resp = httpx.get(f"{self.config.base_url}/models", timeout=5)
            if resp.status_code == 200:
                self._verified = True
                return True
            return False
        except Exception:
            return False

    def get_models(self) -> list[str]:
        """
        Get list of available models from LiteLLM.

        Returns:
            List of model IDs available
        """
        try:
            resp = httpx.get(f"{self.config.base_url}/models", timeout=5)
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                return [m.get("id") for m in data if "id" in m]
            return []
        except Exception:
            return []

    def get_chat_model(
        self,
        model: str,
        temperature: float = 0,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> ChatOpenAI:
        """
        Get a ChatOpenAI instance configured for LiteLLM.

        Args:
            model: Model name (e.g., "runpod-dolphin", "hermes3:8b")
            temperature: Sampling temperature (0-2)
            max_tokens: Max completion tokens (optional)
            **kwargs: Additional arguments passed to ChatOpenAI

        Returns:
            ChatOpenAI instance configured for LiteLLM proxy
        """
        return ChatOpenAI(
            model=model,
            base_url=self.config.base_url,
            api_key=self.config.api_key,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs,
        )

    def __repr__(self) -> str:
        """Represent client."""
        return f"CatalystLiteLLMClient({self.config})"
