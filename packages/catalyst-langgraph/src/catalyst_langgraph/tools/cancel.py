"""Cooperative cancellation signal for sub-agents.

When the UI presses STOP, the SSE generator catches `CancelledError` and
the parent's `astream_events()` task is cancelled. That cascades into
the running tool's `asyncio.gather()` of council members, which then
cancels each member's `compiled.ainvoke()` at its next await — IMPLICIT
cancellation.

That's fine for the common path, but it has two failure modes:

  1. Slow / non-cooperative awaits between tool calls (an LLM streaming
     a long token chunk into list-of-parts decoding) won't notice the
     cancel until the await returns — meaning we burn the rest of that
     LLM call's tokens.
  2. The implicit-cascade has no place to put "I noticed and stopped
     gracefully" semantics — sub-agents have no way to return a
     `[cancelled]` placeholder that the parent can render.

This module fills that gap with an EXPLICIT signal: a per-request
`asyncio.Event` exposed through a ContextVar. Anyone awaiting a slow
operation can race it against `cancel_event.get().wait()` and short-
circuit with a partial result. Anyone doing a tight loop (the council
fan-out, the member's pre-call branch) can poll `is_cancelled()`
between awaits and return early.

The event is set when:
  - the SSE generator catches `CancelledError` (UI pressed STOP), OR
  - the request's outer task is cancelled for any other reason.

The ContextVar is reset in the server's `finally` block so it can't
leak across requests on the same worker.
"""
from __future__ import annotations

import asyncio
from contextvars import ContextVar
from typing import Awaitable, Optional, TypeVar


# Per-request cancel signal. Default is an Event that is never set, so
# code paths that read it outside a request (tests, REPL) see "not
# cancelled". The server replaces this with a fresh Event per chat
# dispatch and `.set()`s it on cancel.
cancel_event: ContextVar[asyncio.Event] = ContextVar("cancel_event")


def get_cancel_event() -> Optional[asyncio.Event]:
    """Return the current request's cancel Event, or None outside a request.

    Helpers that want to *react* to cancel (race against / await on it)
    should use this. Plain "should I stop?" checks should prefer
    `is_cancelled()` since it handles the no-request case cleanly.
    """
    try:
        return cancel_event.get()
    except LookupError:
        return None


def is_cancelled() -> bool:
    """True when the current request has been cancelled.

    Safe to call outside a request — returns False if no cancel_event
    is bound. Use this between awaits in council fan-out, member loops,
    and any "should I continue?" branch.
    """
    ev = get_cancel_event()
    return ev is not None and ev.is_set()


T = TypeVar("T")


async def race_with_cancel(coro: Awaitable[T], placeholder: T) -> T:
    """Race a coroutine against the current request's cancel signal.

    Returns the coroutine's result if it finishes first. Returns
    `placeholder` if cancel fires first — and cancels the wrapped task
    so it doesn't keep running in the background. When no cancel_event
    is bound (no request context), just awaits the coroutine.

    Example:
        result = await race_with_cancel(
            compiled.ainvoke(...),
            placeholder=f"[member #{n} cancelled]",
        )
    """
    ev = get_cancel_event()
    if ev is None:
        return await coro  # type: ignore[no-any-return]

    coro_task = asyncio.ensure_future(coro)
    wait_task = asyncio.ensure_future(ev.wait())
    try:
        done, pending = await asyncio.wait(
            {coro_task, wait_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
    except asyncio.CancelledError:
        # Our own task was cancelled — propagate after cleaning up the
        # children so they don't outlive us.
        coro_task.cancel()
        wait_task.cancel()
        raise

    # Whichever didn't finish, cancel it. Always cancel `wait_task` if
    # the coro finished, because we don't need the event anymore.
    for p in pending:
        p.cancel()
    # Drain the cancelled task so asyncio doesn't log "exception was
    # never retrieved" warnings.
    for p in pending:
        try:
            await p
        except (asyncio.CancelledError, Exception):
            pass

    if coro_task in done:
        return coro_task.result()
    # Cancel fired first.
    return placeholder


def install_cancel_event() -> tuple[asyncio.Event, object]:
    """Install a fresh cancel Event for this request.

    Returns the Event itself plus the ContextVar reset token the caller
    must pass to `cancel_event.reset()` in its `finally` block.

    Usage:
        ev, token = install_cancel_event()
        try:
            ...
        finally:
            ev.set()  # be defensive — any straggler races resolve to placeholder
            cancel_event.reset(token)
    """
    ev = asyncio.Event()
    token = cancel_event.set(ev)
    return ev, token
