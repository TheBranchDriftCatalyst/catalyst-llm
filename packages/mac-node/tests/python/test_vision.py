"""Vision tests — parametrized over (vision-tagged model, backend).

The fixture image (``packages/mac-node/tests/fixtures/test-vision.png``) is
synthetic: red square top-left, blue circle top-right, green triangle
bottom-left, "Catalyst" / "Vision Test" text on the right.

We do not require the model to enumerate every shape — just that it
demonstrably *saw* the image (matches at least one expected feature) and
returned a non-trivial response. Stricter scoring belongs in a later
benchmarking layer.
"""
from __future__ import annotations

from typing import Any

import pytest

from conftest import get_client, model_name_for, skip_if_unavailable


VISION_PROMPT = (
    "Describe this image: shapes, colors, positions, and any visible text. "
    "Be brief."
)
TIMEOUT = 180.0  # vision models cold-load slower

# Loose feature gate: the synthetic fixture has these distinctive markers.
EXPECTED = (
    "red", "blue", "green", "square", "circle", "triangle",
    "catalyst", "vision",
)


@pytest.mark.vision
@pytest.mark.slow
def test_vision(
    request: pytest.FixtureRequest,
    model_entry: dict[str, Any],
    backend: str,
    mac_models: set[str],
    litellm_models: set[str],
    fixture_image_b64: str,
) -> None:
    skip_if_unavailable(backend, model_entry, mac_models, litellm_models)
    client = get_client(request, backend)
    name = model_name_for(backend, model_entry)

    result = client.vision(name, VISION_PROMPT, fixture_image_b64, timeout=TIMEOUT)

    text = result.text.strip()
    assert text, f"empty response from {name} on {backend}"

    lowered = text.lower()
    hits = [w for w in EXPECTED if w in lowered]
    assert len(hits) >= 2, (
        f"{name}/{backend} response shows no awareness of the fixture image. "
        f"Found {hits!r} in: {text[:200]!r}"
    )
    print(
        f"\n  {name:<32} {backend:<8} "
        f"{result.eval_count:>4}tok  "
        f"{result.tok_per_s:>5.1f}tok/s  "
        f"{result.latency_s:>5.2f}s  "
        f"hits={len(hits)}/{len(EXPECTED)}  | {text[:80]!r}"
    )
