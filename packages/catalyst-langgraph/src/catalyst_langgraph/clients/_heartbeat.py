"""Heartbeat context managers for long-blocking operations.

Long async waits (300s httpx reads on Ollama, 240s pytest chat-timeout,
ComfyUI workflow waits) emit no progress logs while blocked. From outside
they look identical to a hung process. ``heartbeat`` wraps the wait and
emits a periodic "still running" log so operators can tell live-but-slow
from wedged.

Usage (async)::

    from catalyst_langgraph.clients._heartbeat import heartbeat

    async with heartbeat("nuextract.call", interval=30.0):
        return await client.post(url, json=payload)

Usage (sync)::

    from catalyst_langgraph.clients._heartbeat import heartbeat_sync

    with heartbeat_sync("ollama.prewarm qwen3:70b", interval=30.0):
        httpx.post(url, json=payload, timeout=480)

Log shape (single label per scope so greps stay tidy)::

    → nuextract.call: started
    ⋯ nuextract.call: still running (30s elapsed)
    ⋯ nuextract.call: still running (60s elapsed)
    ✓ nuextract.call: finished after 73.2s
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
from collections.abc import AsyncIterator, Iterator

logger = logging.getLogger(__name__)


@contextlib.asynccontextmanager
async def heartbeat(
    label: str,
    *,
    interval: float = 30.0,
    log: logging.Logger | None = None,
) -> AsyncIterator[None]:
    """Async heartbeat: log start/tick/end around a blocking await.

    Args:
        label: Stable short identifier (e.g. ``"nuextract.call"``).
        interval: Seconds between "still running" ticks. Default 30s.
        log: Optional logger override. Defaults to this module's logger.
    """
    lg = log or logger
    start = time.monotonic()
    stop = asyncio.Event()

    async def _beat() -> None:
        while True:
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
                return
            except asyncio.TimeoutError:
                lg.info("⋯ %s: still running (%.0fs elapsed)", label, time.monotonic() - start)

    lg.info("→ %s: started", label)
    task = asyncio.create_task(_beat())
    try:
        yield
    except BaseException as exc:
        lg.warning("✗ %s: failed after %.1fs: %s", label, time.monotonic() - start, exc)
        raise
    else:
        lg.info("✓ %s: finished after %.1fs", label, time.monotonic() - start)
    finally:
        stop.set()
        with contextlib.suppress(Exception):
            await task


@contextlib.contextmanager
def heartbeat_sync(
    label: str,
    *,
    interval: float = 30.0,
    log: logging.Logger | None = None,
) -> Iterator[None]:
    """Sync analog of :func:`heartbeat` for blocking I/O in threads.

    Spawns a daemon thread that wakes every ``interval`` seconds to emit a
    tick log. Thread is joined on context exit; daemon=True keeps the
    interpreter from blocking shutdown if the wrapped call holds the GIL.
    """
    lg = log or logger
    start = time.monotonic()
    stop = threading.Event()

    def _beat() -> None:
        while not stop.wait(interval):
            lg.info("⋯ %s: still running (%.0fs elapsed)", label, time.monotonic() - start)

    lg.info("→ %s: started", label)
    t = threading.Thread(target=_beat, name=f"heartbeat[{label}]", daemon=True)
    t.start()
    try:
        yield
    except BaseException as exc:
        lg.warning("✗ %s: failed after %.1fs: %s", label, time.monotonic() - start, exc)
        raise
    else:
        lg.info("✓ %s: finished after %.1fs", label, time.monotonic() - start)
    finally:
        stop.set()
        t.join(timeout=1.0)
