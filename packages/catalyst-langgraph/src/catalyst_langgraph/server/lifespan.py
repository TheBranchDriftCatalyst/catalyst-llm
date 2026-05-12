"""FastAPI lifespan — owns the EventStore's lifetime.

Extracted from server.py during the llm-doh refactor. Built on startup,
closed (flush + join writer thread) on shutdown. The store reads its
DuckDB path from `EVENTS_DB`; with no env it initialises in disabled
mode so local dev without DuckDB still works (insert becomes a no-op).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from ..persistence import EventStore, set_event_store

log = logging.getLogger("catalyst-langgraph")


@asynccontextmanager
async def app_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build the EventStore on startup, close it on shutdown."""
    store = EventStore()
    set_event_store(store)
    log.info("event store: enabled=%s path=%s", store._enabled, store._path)
    try:
        yield
    finally:
        set_event_store(None)
        store.close()
