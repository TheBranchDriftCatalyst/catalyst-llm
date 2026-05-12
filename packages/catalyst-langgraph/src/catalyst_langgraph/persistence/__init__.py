"""DuckDB-backed persistence for catalyst-langgraph.

Today: an event store that mirrors every SSE event yielded by
`_stream_agent_events` into a queryable DuckDB file. Tomorrow: run
metadata, replay state, prompt-override history — whatever needs to
survive past a single chat dispatch lands here.

Modelled after ``../langgraph-dev/api/app/persistence/event_store.py``
(self-contained — no langgraph-dev import). When langgraph-dev moves
into this monorepo as a workspace package we can revisit de-dup.
"""

from .event_store import EventStore, get_event_store, set_event_store

__all__ = ["EventStore", "get_event_store", "set_event_store"]
