"""Smoke tests for catalyst-langgraph.

L2 unit tests (no network, no services). They guard the package against
becoming unimportable. Real graph-behavior tests belong in sibling
test_*.py files as they get written.
"""
from __future__ import annotations

import pytest


@pytest.mark.unit
def test_package_imports() -> None:
    """Top-level package + public symbols are importable."""
    import catalyst_langgraph as pkg

    assert pkg is not None
    from catalyst_langgraph import client, config  # noqa: F401


@pytest.mark.unit
def test_version_is_string() -> None:
    """Package exposes a non-empty __version__ or pyproject-stamped version."""
    try:
        from importlib.metadata import version

        v = version("catalyst-langgraph")
    except Exception:
        pytest.skip("package not installed via importlib.metadata")
    assert isinstance(v, str) and v
