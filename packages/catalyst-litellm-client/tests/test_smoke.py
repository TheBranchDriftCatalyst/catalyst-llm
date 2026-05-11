"""Smoke tests for catalyst-litellm-client.

These are L2 unit tests (no network, no services). They exist to honor
the pytest dev-dep declared in pyproject.toml and to fail loudly if the
package becomes unimportable. Real client-behavior tests belong in
sibling test_*.py files as they get written.
"""
from __future__ import annotations

import pytest


@pytest.mark.unit
def test_package_imports() -> None:
    """Top-level package + public symbols are importable."""
    import catalyst_litellm_client as pkg

    assert pkg is not None
    # Sanity-check the two main modules we ship
    from catalyst_litellm_client import client, config  # noqa: F401


@pytest.mark.unit
def test_version_is_string() -> None:
    """Package exposes a non-empty __version__ or pyproject-stamped version."""
    try:
        from importlib.metadata import version

        v = version("catalyst-litellm-client")
    except Exception:
        pytest.skip("package not installed via importlib.metadata")
    assert isinstance(v, str) and v
