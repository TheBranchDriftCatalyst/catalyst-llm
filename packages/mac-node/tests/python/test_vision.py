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

from pathlib import Path
from typing import Any

import pytest

from conftest import get_client, model_name_for, skip_if_unavailable, write_dump


VISION_PROMPT = (
    "Describe this image: shapes, colors, positions, and any visible text. "
    "Be brief."
)
TIMEOUT = 240.0  # vision models cold-load slower, esp. 30B-A3B thinking

# Loose feature gate: the synthetic fixture has these distinctive markers.
EXPECTED = (
    "red", "blue", "green", "square", "circle", "triangle",
    "catalyst", "vision",
)

# nuextract2 is tagged [extraction, vision] because it's based on
# Qwen2.5-VL, but it's a schema-fill extraction model, not a free-form
# describer — feeding it the loose VISION_PROMPT yields refusals or
# template-shaped output that doesn't match EXPECTED. The capability
# test it actually deserves is "extract JSON from this image" which we
# don't have a fixture for yet.
SKIP_FOR_VISION_FREE_FORM = {"nuextract2", "nuextract1.5", "universalner"}


@pytest.mark.vision
@pytest.mark.slow
def test_vision(
    request: pytest.FixtureRequest,
    model_entry: dict[str, Any],
    backend: str,
    mac_models: set[str],
    litellm_models: set[str],
    fixture_image_b64: str,
    dump_dir: Path | None,
) -> None:
    if model_entry["alias"] in SKIP_FOR_VISION_FREE_FORM:
        pytest.skip(
            f"{model_entry['alias']} is an extraction specialist; needs a "
            f"schema-fill prompt, not the free-form vision prompt"
        )
    skip_if_unavailable(backend, model_entry, mac_models, litellm_models)
    client = get_client(request, backend)
    name = model_name_for(backend, model_entry)

    result = client.vision(name, VISION_PROMPT, fixture_image_b64, timeout=TIMEOUT)

    text = result.text.strip()
    lowered = text.lower()
    hits = [w for w in EXPECTED if w in lowered]

    write_dump(
        dump_dir,
        capability="vision",
        alias=model_entry["alias"],
        backend=backend,
        backend_name=name,
        prompt=VISION_PROMPT,
        result=result,
        extra={"expected_hits": hits, "expected_total": len(EXPECTED)},
    )

    assert text, f"empty response from {name} on {backend}"
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
