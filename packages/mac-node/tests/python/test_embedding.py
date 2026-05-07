"""Embedding tests — parametrized over (embedding-tagged model, backend)."""
from __future__ import annotations

import math
from typing import Any

import pytest

from conftest import get_client, model_name_for, skip_if_unavailable


SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog."
TIMEOUT = 30.0


@pytest.mark.embedding
def test_embedding(
    request: pytest.FixtureRequest,
    model_entry: dict[str, Any],
    backend: str,
    mac_models: set[str],
    litellm_models: set[str],
) -> None:
    skip_if_unavailable(backend, model_entry, mac_models, litellm_models)
    client = get_client(request, backend)
    name = model_name_for(backend, model_entry)

    result = client.embed(name, SAMPLE_TEXT, timeout=TIMEOUT)
    emb = result.embedding

    assert emb, f"no embedding returned from {name} on {backend}"
    assert isinstance(emb, list), f"embedding is not a list: {type(emb).__name__}"
    assert len(emb) > 0, f"zero-dim embedding from {name}"
    assert all(isinstance(x, (int, float)) for x in emb[:8]), "non-numeric values in embedding"

    norm = math.sqrt(sum(float(x) * float(x) for x in emb))
    assert norm > 0, f"zero-norm embedding from {name}"

    print(
        f"\n  {name:<32} {backend:<8} "
        f"dim={len(emb):>4}  "
        f"norm={norm:>6.2f}  "
        f"{result.latency_s:>5.2f}s"
    )
