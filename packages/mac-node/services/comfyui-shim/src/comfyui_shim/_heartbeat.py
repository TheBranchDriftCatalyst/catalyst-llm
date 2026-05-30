"""Async heartbeat for long-blocking ComfyUI awaits.

ComfyUI workflows can run for 300+ seconds (Flux Schnell at 50 steps on
a 4090 ≈ 90s; behemoth models ≈ 300s+). The WS recv inside
``ComfyClient._await_completion`` is silent for the whole interval, which
looks identical to a wedged daemon from outside. This emits a periodic
"still running" line so operators can distinguish the two.

Kept as a local module (rather than imported from catalyst-langgraph) so
mac-node stays free of langgraph deps. Mirror of
``catalyst_langgraph.clients._heartbeat``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)


@contextlib.asynccontextmanager
async def heartbeat(
    label: str,
    *,
    interval: float = 30.0,
    log: logging.Logger | None = None,
) -> AsyncIterator[None]:
    """Emit start/tick/end logs around a long-blocking await."""
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
