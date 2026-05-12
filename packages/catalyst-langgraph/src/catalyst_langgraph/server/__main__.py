"""Entrypoint for `python -m catalyst_langgraph.server` (Dockerfile CMD)."""
from __future__ import annotations

from . import main


if __name__ == "__main__":
    main()
