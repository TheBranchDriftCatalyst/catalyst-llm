"""Chat completion tests — parametrized over (chat-tagged model, backend)."""
from __future__ import annotations

from typing import Any

import pytest

from conftest import get_client, model_name_for, skip_if_unavailable


CHAT_PROMPT = 'Reply with exactly the two words: "hello test". No punctuation.'
TIMEOUT = 60.0


@pytest.mark.chat
def test_chat(
    request: pytest.FixtureRequest,
    model_entry: dict[str, Any],
    backend: str,
    mac_models: set[str],
    litellm_models: set[str],
) -> None:
    skip_if_unavailable(backend, model_entry, mac_models, litellm_models)
    client = get_client(request, backend)
    name = model_name_for(backend, model_entry)

    result = client.chat(name, CHAT_PROMPT, timeout=TIMEOUT)

    assert result.text.strip(), f"empty response from {name} on {backend}"
    # eval_count may be 0 on the LiteLLM path if the proxy strips usage; treat
    # as soft signal only.
    if backend == "mac":
        assert result.eval_count > 0, f"no tokens reported for {name}"
    print(
        f"\n  {name:<32} {backend:<8} "
        f"{result.eval_count:>4}tok  "
        f"{result.tok_per_s:>5.1f}tok/s  "
        f"{result.latency_s:>5.2f}s  "
        f"| {result.text.strip()[:60]!r}"
    )
