"""Logging configuration for the catalyst-langgraph service.

Kept narrow: a single idempotent `setup_logging()` that the package's
`__init__` calls on import. Extracted from server.py during the llm-doh
refactor; no behavioral change vs the previous inline basicConfig.
"""
from __future__ import annotations

import logging

_DEFAULT_FORMAT = "%(asctime)s %(levelname)-7s %(name)s %(message)s"


def setup_logging(level: int = logging.INFO, fmt: str = _DEFAULT_FORMAT) -> None:
    """Configure the root logger. Idempotent — safe to call repeatedly."""
    logging.basicConfig(level=level, format=fmt)
