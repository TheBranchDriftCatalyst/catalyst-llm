"""Catalyst LiteLLM Client — OpenAI-compatible LLM access."""

import json
from typing import AsyncIterator, Iterator, List, Optional, Union

import httpx
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

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.config.api_key}"} if self.config.api_key else {}

    def verify_connection(self) -> bool:
        """
        Verify LiteLLM proxy is accessible and list available models.

        Returns:
            True if connection successful, False otherwise
        """
        try:
            resp = httpx.get(
                f"{self.config.base_url}/v1/models",
                headers=self._headers,
                timeout=5,
            )
            if resp.status_code == 200:
                self._verified = True
                return True
            return False
        except Exception:
            return False

    def get_models(self) -> List[str]:
        """
        Get list of available models from LiteLLM.

        Returns:
            List of model IDs available
        """
        try:
            resp = httpx.get(
                f"{self.config.base_url}/v1/models",
                headers=self._headers,
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                return [m.get("id") for m in data if "id" in m]
            return []
        except Exception:
            return []

    def get_model_info(self, model: Optional[str] = None) -> Union[List[dict], dict, None]:
        """
        Get model metadata from LiteLLM /model/info.

        Wraps the proxy's /model/info endpoint so consumers stop calling it
        directly for context-window / pricing introspection.

        Args:
            model: If provided, return only the entry matching this model_name.
                   Otherwise returns the full list.

        Returns:
            Full list of model info dicts, a single dict if `model` is provided
            and found, or None if the endpoint is unavailable / model not found.
        """
        try:
            resp = httpx.get(
                f"{self.config.base_url}/model/info",
                headers=self._headers,
                timeout=5,
            )
            if resp.status_code != 200:
                return None
            data = resp.json().get("data", [])
            if model is None:
                return data
            for entry in data:
                if entry.get("model_name") == model:
                    return entry
            return None
        except Exception:
            return None

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

    def stream_chat(
        self,
        model: str,
        messages: List[dict],
        **params,
    ) -> Iterator[dict]:
        """
        Stream chat completions from LiteLLM as an iterator of SSE chunks.

        Yields parsed JSON dicts from the OpenAI-compatible streaming
        response. The final yield is `{"done": True, "meta": {...}}` after
        the [DONE] marker. This replaces hand-rolled httpx.stream loops in
        consumers like langgraph-dev.

        Args:
            model: Model name
            messages: List of message dicts ({"role": ..., "content": ...})
            **params: Additional sampling params passed through (temperature,
                max_tokens, top_p, presence_penalty, frequency_penalty, stop)

        Yields:
            dict — each parsed SSE event. Final event: {"done": True, "meta": meta}.
        """
        body = {
            "model": model,
            "messages": messages,
            "stream": True,
            **params,
        }
        meta: dict = {}

        with httpx.stream(
            "POST",
            f"{self.config.base_url}/v1/chat/completions",
            headers={**self._headers, "Content-Type": "application/json"},
            json=body,
            timeout=None,
        ) as resp:
            resp.raise_for_status()
            for raw in resp.iter_lines():
                line = raw.strip() if isinstance(raw, str) else raw.decode("utf-8").strip()
                if not line or not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    yield {"done": True, "meta": meta}
                    return
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if "id" in obj:
                    meta["id"] = obj["id"]
                if "model" in obj:
                    meta["model"] = obj["model"]
                if "usage" in obj:
                    meta["usage"] = obj["usage"]
                choice = (obj.get("choices") or [{}])[0]
                if choice.get("finish_reason"):
                    meta["finish_reason"] = choice["finish_reason"]
                yield obj

    async def astream_chat(
        self,
        model: str,
        messages: List[dict],
        **params,
    ) -> AsyncIterator[dict]:
        """Async variant of stream_chat. Same yield contract."""
        body = {
            "model": model,
            "messages": messages,
            "stream": True,
            **params,
        }
        meta: dict = {}

        async with httpx.AsyncClient(timeout=None) as ac:
            async with ac.stream(
                "POST",
                f"{self.config.base_url}/v1/chat/completions",
                headers={**self._headers, "Content-Type": "application/json"},
                json=body,
            ) as resp:
                resp.raise_for_status()
                async for raw in resp.aiter_lines():
                    line = raw.strip() if isinstance(raw, str) else raw.decode("utf-8").strip()
                    if not line or not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    if payload == "[DONE]":
                        yield {"done": True, "meta": meta}
                        return
                    try:
                        obj = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if "id" in obj:
                        meta["id"] = obj["id"]
                    if "model" in obj:
                        meta["model"] = obj["model"]
                    if "usage" in obj:
                        meta["usage"] = obj["usage"]
                    choice = (obj.get("choices") or [{}])[0]
                    if choice.get("finish_reason"):
                        meta["finish_reason"] = choice["finish_reason"]
                    yield obj

    def embed(
        self,
        model: str,
        input: Union[str, List[str]],
    ) -> dict:
        """
        Generate embeddings via LiteLLM /v1/embeddings.

        Args:
            model: Embedding model name (e.g. "text-embedding-3-small",
                "mxbai-embed-large", "nomic-embed-text")
            input: Single string or list of strings to embed.

        Returns:
            Full OpenAI-compatible embeddings response dict with
            `data: [{embedding: [...], index, object}], model, usage`.
        """
        body = {"model": model, "input": input}
        resp = httpx.post(
            f"{self.config.base_url}/v1/embeddings",
            headers={**self._headers, "Content-Type": "application/json"},
            json=body,
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()

    def __repr__(self) -> str:
        """Represent client."""
        return f"CatalystLiteLLMClient({self.config})"
