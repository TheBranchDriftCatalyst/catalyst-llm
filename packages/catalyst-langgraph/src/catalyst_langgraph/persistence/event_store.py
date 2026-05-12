"""DuckDB-backed event trace.

Every typed SSE event yielded by `_stream_agent_events` is mirrored
into a DuckDB file via an async background writer. The writer runs in
its own thread + bounded queue so `insert()` is non-blocking — the SSE
hot path never waits on disk.

Schema (v1):

  events(run_id, seq, ts, kind, node, payload_json)
    - run_id: opaque, set per chat dispatch by server.py
    - seq: per-run monotonic, starts at 0
    - ts: epoch seconds (float)
    - kind: AgentEvent.type — "run_started" | "token" | "reasoning" |
            "tool_call_start" | "tool_call_end" | "iteration" |
            "message_done" | "error"
    - node: best-effort attribution. "tool_call_*" → tool name;
            "run_started" → "start"; "message_done" → "end";
            "error" → "error"; everything else → "agent". Lets the UI
            slice runs without parsing payload_json.
    - payload_json: full event body (Pydantic model_dump_json)

  run_configs(run_id, started_at, model, tools_json, agent_config_json,
              system_prompt)
    - one row per dispatched chat; captures what the parent agent was
      configured with so we can correlate cost / behaviour later.

Reference: ../langgraph-dev/api/app/persistence/event_store.py.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
from typing import Any, Optional

log = logging.getLogger(__name__)


_DDL = """
CREATE TABLE IF NOT EXISTS events (
    run_id        VARCHAR NOT NULL,
    seq           INTEGER NOT NULL,
    ts            DOUBLE  NOT NULL,
    kind          VARCHAR NOT NULL,
    node          VARCHAR,
    payload_json  VARCHAR
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
-- Supports /api/runs/by-node lookups: WHERE node = ? GROUP BY run_id.
CREATE INDEX IF NOT EXISTS idx_events_node ON events(node);

CREATE TABLE IF NOT EXISTS run_configs (
    run_id           VARCHAR PRIMARY KEY,
    started_at       DOUBLE NOT NULL,
    model            VARCHAR,
    tools_json       VARCHAR,
    agent_config_json VARCHAR,
    system_prompt    VARCHAR
);
"""

# Flush thresholds for the writer thread. Smaller = lower latency to
# durability, larger = higher throughput. langgraph-dev uses 50/1.0;
# we're in the same range.
_FLUSH_SIZE = 50
_FLUSH_INTERVAL = 1.0


def _node_for(kind: str, payload: dict[str, Any]) -> str:
    """Pick a stable, query-friendly node label per event kind.

    Lets the UI ("list every run where node='web_search'") work
    without JSON-extract acrobatics. Tweak only when adding new event
    kinds — existing rows stay readable.
    """
    if kind in ("tool_call_start", "tool_call_end"):
        return str(payload.get("name") or "tool")
    if kind == "run_started":
        return "start"
    if kind == "message_done":
        return "end"
    if kind == "error":
        return "error"
    return "agent"


class EventStore:
    """Thread-safe DuckDB writer with async-friendly insert.

    Initialise from env var ``EVENTS_DB`` (path) or pass ``db_path``
    explicitly. When the path is empty, the store stays disabled and
    ``insert()`` becomes a no-op — local dev without DuckDB just
    silently skips the trace.
    """

    def __init__(self, db_path: Optional[str] = None) -> None:
        self._enabled = False
        self._con = None
        self._path: Optional[str] = None
        self._q: Optional[queue.Queue] = None
        self._stop = threading.Event()
        self._write_lock = threading.Lock()
        self._worker: Optional[threading.Thread] = None

        path = db_path or os.environ.get("EVENTS_DB", "")
        if not path:
            log.info("EventStore: EVENTS_DB not set — event trace disabled")
            return

        try:
            import duckdb  # lazy import — missing dep shouldn't crash boot
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            self._path = path
            self._con = duckdb.connect(path)
            self._con.execute(_DDL)
            self._con.commit()
            self._enabled = True
            log.info("EventStore: DuckDB connected at %s", path)
        except Exception as exc:
            log.warning("EventStore: init failed (%s) — disabled", exc)
            self._con = None
            self._enabled = False
            return

        self._q = queue.Queue()
        self._worker = threading.Thread(
            target=self._run,
            daemon=True,
            name="event-store-writer",
        )
        self._worker.start()

    # ──────────────────────────────────────────────────────────────────
    # Public write API — both methods are non-blocking enqueues.
    # ──────────────────────────────────────────────────────────────────

    def insert(
        self,
        run_id: str,
        seq: int,
        kind: str,
        payload: dict[str, Any],
    ) -> None:
        """Enqueue one event row. Returns immediately."""
        if not self._enabled or self._q is None:
            return
        try:
            self._q.put_nowait(
                (
                    "event",
                    (
                        run_id,
                        int(seq),
                        time.time(),
                        kind,
                        _node_for(kind, payload),
                        json.dumps(payload, default=str),
                    ),
                )
            )
        except Exception as exc:  # full queue, etc.
            log.warning("EventStore: insert dropped (%s)", exc)

    def insert_run_config(
        self,
        run_id: str,
        model: str,
        tools: Optional[list[str]],
        agent_config: Optional[dict[str, Any]],
        system_prompt: Optional[str],
    ) -> None:
        """Capture the parent agent's config at run start.

        Lets later queries (cost-per-model, tool-usage-by-config)
        correlate event rows back to the request that produced them.
        Idempotent on run_id (DuckDB primary-key conflict is swallowed).
        """
        if not self._enabled or self._q is None:
            return
        try:
            self._q.put_nowait(
                (
                    "run_config",
                    (
                        run_id,
                        time.time(),
                        model,
                        json.dumps(tools or []),
                        json.dumps(agent_config or {}, default=str),
                        system_prompt or "",
                    ),
                )
            )
        except Exception as exc:
            log.warning("EventStore: run_config insert dropped (%s)", exc)

    # ──────────────────────────────────────────────────────────────────
    # Public read API — synchronous (only called from request handlers
    # off the SSE hot path).
    # ──────────────────────────────────────────────────────────────────

    def runs(self, limit: int = 100) -> list[dict]:
        """Summary rows — one per distinct run_id.

        Aggregates token / tool counts, first / last seen timestamps,
        and merges in the run_config row when present. Ordered newest
        first; capped at ``limit`` because dev DuckDB files can grow.
        """
        if not self._enabled or self._con is None:
            return []
        try:
            sql = """
            SELECT
                events.run_id                                AS run_id,
                MIN(events.ts)                               AS started_at,
                MAX(events.ts)                               AS finished_at,
                COUNT(*)                                     AS total_events,
                SUM(CASE WHEN events.kind = 'token' THEN 1 ELSE 0 END)
                                                             AS token_count,
                SUM(CASE WHEN events.kind = 'tool_call_start' THEN 1 ELSE 0 END)
                                                             AS tool_calls,
                SUM(CASE WHEN events.kind = 'error' THEN 1 ELSE 0 END)
                                                             AS error_count,
                (SELECT node FROM events e2
                 WHERE e2.run_id = events.run_id
                 ORDER BY seq DESC LIMIT 1)                  AS terminal_node,
                ANY_VALUE(run_configs.model)                 AS model,
                ANY_VALUE(run_configs.tools_json)            AS tools_json,
                ANY_VALUE(run_configs.agent_config_json)     AS agent_config_json
            FROM events
            LEFT JOIN run_configs ON run_configs.run_id = events.run_id
            GROUP BY events.run_id
            ORDER BY started_at DESC
            LIMIT ?
            """
            with self._write_lock:
                self._con.execute(sql, [int(limit)])
                rows = self._con.fetchall()
                cols = [d[0] for d in self._con.description]
            return [dict(zip(cols, row)) for row in rows]
        except Exception as exc:
            log.warning("EventStore.runs() failed: %s", exc)
            return []

    def runs_by_node(self, node: str, limit: int = 20) -> list[dict]:
        """Recent runs that produced an event attributed to ``node``.

        Used by the Engine page's right-side Sheet: when the operator
        clicks the runs icon on a node card, the UI calls this to list
        the last few runs that touched that node along with light
        terminal status (completed / had_error) and an event count.

        We filter on the ``node`` column (per-event attribution set by
        ``_node_for``) rather than ``agent_id`` because the events
        schema has no agent_id — every event in a run already belongs
        to exactly one parent agent. If per-agent scoping is wanted
        later, that's a follow-up that joins ``run_configs`` or adds an
        agent column to ``events``.
        """
        if not self._enabled or self._con is None:
            return []
        try:
            sql = """
            SELECT run_id,
                   MAX(ts)                                            AS last_ts,
                   COUNT(*)                                           AS event_count,
                   MAX(CASE WHEN kind = 'error' THEN 1 ELSE 0 END)    AS had_error,
                   MAX(CASE WHEN kind = 'message_done' THEN 1 ELSE 0 END)
                                                                      AS completed
            FROM events
            WHERE node = ?
            GROUP BY run_id
            ORDER BY last_ts DESC
            LIMIT ?
            """
            with self._write_lock:
                self._con.execute(sql, [node, int(limit)])
                rows = self._con.fetchall()
                cols = [d[0] for d in self._con.description]
            out: list[dict] = []
            for row in rows:
                d = dict(zip(cols, row))
                # DuckDB returns the MAX(CASE ...) aggregates as ints;
                # cast to bool here so callers don't have to.
                d["had_error"] = bool(d.get("had_error"))
                d["completed"] = bool(d.get("completed"))
                out.append(d)
            return out
        except Exception as exc:
            log.warning("EventStore.runs_by_node(%s) failed: %s", node, exc)
            return []

    def events_for(self, run_id: str) -> list[dict]:
        """Every event for a run, in sequence order."""
        if not self._enabled or self._con is None:
            return []
        try:
            with self._write_lock:
                self._con.execute(
                    "SELECT run_id, seq, ts, kind, node, payload_json "
                    "FROM events WHERE run_id = ? ORDER BY seq ASC",
                    [run_id],
                )
                rows = self._con.fetchall()
                cols = [d[0] for d in self._con.description]
            out = []
            for row in rows:
                d = dict(zip(cols, row))
                try:
                    d["payload"] = json.loads(d.pop("payload_json") or "{}")
                except Exception:
                    d["payload"] = {}
                out.append(d)
            return out
        except Exception as exc:
            log.warning("EventStore.events_for(%s) failed: %s", run_id, exc)
            return []

    def get_event(self, run_id: str, seq: int) -> Optional[dict]:
        """Single event by (run_id, seq). For replay / detail views."""
        if not self._enabled or self._con is None:
            return None
        try:
            with self._write_lock:
                self._con.execute(
                    "SELECT run_id, seq, ts, kind, node, payload_json "
                    "FROM events WHERE run_id = ? AND seq = ?",
                    [run_id, int(seq)],
                )
                row = self._con.fetchone()
                if row is None:
                    return None
                cols = [d[0] for d in self._con.description]
            d = dict(zip(cols, row))
            try:
                d["payload"] = json.loads(d.pop("payload_json") or "{}")
            except Exception:
                d["payload"] = {}
            return d
        except Exception as exc:
            log.warning(
                "EventStore.get_event(%s, %d) failed: %s", run_id, seq, exc
            )
            return None

    # ──────────────────────────────────────────────────────────────────
    # Lifecycle
    # ──────────────────────────────────────────────────────────────────

    def close(self) -> None:
        """Flush + shut down. Called from FastAPI's lifespan handler."""
        if not self._enabled:
            return
        self._stop.set()
        if self._worker is not None:
            self._worker.join(timeout=5.0)
        with self._write_lock:
            try:
                if self._con is not None:
                    self._con.close()
            except Exception:
                pass
        self._enabled = False

    # ──────────────────────────────────────────────────────────────────
    # Background worker
    # ──────────────────────────────────────────────────────────────────

    def _run(self) -> None:
        """Drain the queue in batches.

        Two flush triggers: batch hits _FLUSH_SIZE, or _FLUSH_INTERVAL
        elapsed since the last flush. Either way the writer always
        flushes before exiting so close() doesn't drop the tail.
        """
        events_batch: list[tuple] = []
        configs_batch: list[tuple] = []
        last_flush = time.monotonic()

        while not self._stop.is_set() or not self._q.empty():
            timeout = max(0.05, _FLUSH_INTERVAL - (time.monotonic() - last_flush))
            try:
                kind, row = self._q.get(timeout=timeout)
            except queue.Empty:
                kind, row = None, None

            if kind == "event":
                events_batch.append(row)
            elif kind == "run_config":
                configs_batch.append(row)

            should_flush = (
                len(events_batch) >= _FLUSH_SIZE
                or len(configs_batch) >= _FLUSH_SIZE
                or (time.monotonic() - last_flush) >= _FLUSH_INTERVAL
            )
            if should_flush and (events_batch or configs_batch):
                self._flush(events_batch, configs_batch)
                events_batch.clear()
                configs_batch.clear()
                last_flush = time.monotonic()

        # Final flush.
        if events_batch or configs_batch:
            self._flush(events_batch, configs_batch)

    def _flush(
        self,
        events_batch: list[tuple],
        configs_batch: list[tuple],
    ) -> None:
        try:
            with self._write_lock:
                if events_batch:
                    self._con.executemany(
                        "INSERT INTO events "
                        "(run_id, seq, ts, kind, node, payload_json) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        events_batch,
                    )
                if configs_batch:
                    # ON CONFLICT REPLACE on run_id primary key — rerunning
                    # a request (rare) overwrites the prior config row
                    # rather than duplicating.
                    self._con.executemany(
                        "INSERT OR REPLACE INTO run_configs "
                        "(run_id, started_at, model, tools_json, agent_config_json, system_prompt) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        configs_batch,
                    )
                self._con.commit()
        except Exception as exc:
            log.warning(
                "EventStore: flush failed (%d events, %d configs): %s",
                len(events_batch),
                len(configs_batch),
                exc,
            )


# ──────────────────────────────────────────────────────────────────────
# Module-level singleton — FastAPI's lifespan sets it on startup,
# request handlers and _stream_agent_events read it.
# Kept simple (no DI container) since there's exactly one of these.
# ──────────────────────────────────────────────────────────────────────

_store: Optional[EventStore] = None


def get_event_store() -> Optional[EventStore]:
    """Return the live EventStore, or None when disabled / pre-startup."""
    return _store


def set_event_store(store: Optional[EventStore]) -> None:
    """Install (or clear) the module-level EventStore.

    Called by server.py's lifespan handler at startup and shutdown.
    """
    global _store
    _store = store
