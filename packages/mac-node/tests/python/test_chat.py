"""Chat completion tests — parametrized over (chat-tagged model, backend)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from conftest import get_client, model_name_for, skip_if_unavailable, write_dump


CHAT_PROMPT = 'Reply with exactly the two words: "hello test". No punctuation.'


@pytest.mark.chat
def test_chat(
    request: pytest.FixtureRequest,
    pytestconfig: pytest.Config,
    model_entry: dict[str, Any],
    backend: str,
    mac_models: set[str],
    litellm_models: set[str],
    dump_dir: Path | None,
) -> None:
    skip_if_unavailable(backend, model_entry, mac_models, litellm_models)
    client = get_client(request, backend)
    name = model_name_for(backend, model_entry)
    timeout = pytestconfig.getoption("--chat-timeout")

    result = client.chat(name, CHAT_PROMPT, timeout=timeout)

    write_dump(
        dump_dir,
        capability="chat",
        alias=model_entry["alias"],
        backend=backend,
        backend_name=name,
        prompt=CHAT_PROMPT,
        result=result,
    )

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
