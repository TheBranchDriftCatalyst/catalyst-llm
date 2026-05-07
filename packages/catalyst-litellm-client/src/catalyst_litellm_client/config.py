"""Configuration for Catalyst LiteLLM Client."""

import os
from typing import Iterable, Optional

DEFAULT_BASE_URL = "http://localhost:4000"
DEFAULT_API_KEY = "test-key"

BASE_URL_ENV_ORDER = ("LITELLM_BASE_URL",)
# LITE_LLM_KEY is the new convention shared with @catalyst/llm-sdk;
# LITELLM_API_KEY remains supported for backward compat with 0.1.x.
API_KEY_ENV_ORDER = ("LITE_LLM_KEY", "LITELLM_API_KEY")


def _read_env(names: Iterable[str]) -> Optional[str]:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


class LiteLLMConfig:
    """LiteLLM proxy configuration with credentials."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        env_aliases: Optional[dict] = None,
    ):
        """
        Initialize LiteLLM configuration.

        Args:
            base_url: LiteLLM proxy endpoint (defaults to env var or localhost:4000)
            api_key: API key for authentication (defaults to env var or test-key)
            env_aliases: Optional dict with optional 'base_url' / 'api_key' lists
                of additional env var names to try before the defaults. Lets apps
                with their own naming (e.g. AI_BASE_URL) opt in without renaming
                their .env files.
        """
        aliases = env_aliases or {}
        base_url_aliases = tuple(aliases.get("base_url", ())) + BASE_URL_ENV_ORDER
        api_key_aliases = tuple(aliases.get("api_key", ())) + API_KEY_ENV_ORDER

        self.base_url = base_url or _read_env(base_url_aliases) or DEFAULT_BASE_URL
        self.api_key = api_key or _read_env(api_key_aliases) or DEFAULT_API_KEY

    @property
    def is_remote(self) -> bool:
        """Check if endpoint is remote (not localhost)."""
        return "localhost" not in self.base_url and "127.0.0.1" not in self.base_url

    def __repr__(self) -> str:
        """Represent configuration (hide API key)."""
        return f"LiteLLMConfig(base_url={self.base_url}, api_key=***)"
