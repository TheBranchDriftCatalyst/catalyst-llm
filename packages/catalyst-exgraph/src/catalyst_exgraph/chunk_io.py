"""Shape-robust helpers for reading TextChunk-like values.

The asset_factory multi_asset declares ``chunks: list`` with no element
type-hint, so Dagster's JSON IO managers return dicts on read rather than
``TextChunk`` pydantic objects. Code paths downstream that touch
``chunk.text`` / ``chunk.document_id`` etc. must tolerate either shape —
otherwise the first cross-process boundary (S3 round-trip, Parquet
serialization, bench harness fixture) breaks the pipeline with
``AttributeError: 'dict' object has no attribute 'text'``.

Same issue applies to ``Assertion`` and ``Mention`` records flowing
through append IO managers. ``field()`` here is intentionally generic so
the same helper covers all of them. Keep the dict-or-attr branch in ONE
place so future refactors of the IO layer don't need to chase down
N copies of the same fix.
"""

from __future__ import annotations

from typing import Any

__all__ = ["field"]


def field(obj: Any, name: str, default: Any = "") -> Any:
    """Read ``name`` from ``obj``, robust to dict or pydantic-object shape.

    Args:
        obj: Either a dict (from JSON deserialization) or a pydantic
            model (from in-memory construction).
        name: Attribute / key to look up.
        default: Returned when the attribute / key is missing.

    Returns:
        The field value, or ``default`` if the attribute / key is absent.
    """
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)
