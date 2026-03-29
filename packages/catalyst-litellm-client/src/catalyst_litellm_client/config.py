"""Configuration for Catalyst LiteLLM Client."""

import os
from typing import Optional


class LiteLLMConfig:
    """LiteLLM proxy configuration with credentials."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        """
        Initialize LiteLLM configuration.

        Args:
            base_url: LiteLLM proxy endpoint (defaults to env var or localhost:8000)
            api_key: API key for authentication (defaults to env var or test-key)
        """
        self.base_url = base_url or os.getenv(
            "LITELLM_BASE_URL", "http://localhost:8000"
        )
        self.api_key = api_key or os.getenv("LITELLM_API_KEY", "test-key")

    @property
    def is_remote(self) -> bool:
        """Check if endpoint is remote (not localhost)."""
        return "localhost" not in self.base_url and "127.0.0.1" not in self.base_url

    def __repr__(self) -> str:
        """Represent configuration (hide API key)."""
        return f"LiteLLMConfig(base_url={self.base_url}, api_key=***)"
