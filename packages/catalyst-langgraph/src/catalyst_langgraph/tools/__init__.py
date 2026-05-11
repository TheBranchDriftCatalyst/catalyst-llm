"""LangChain tool registry for the catalyst-langgraph agent.

Tools are either:
  - thin wrappers around tool-host endpoints (`web_search`, …) — live
    in `host.py`, do side-effects via httpx;
  - LangGraph sub-agents (`research`) that orchestrate other tools
    internally and expose a single coarse-grained tool to the parent
    agent — live in their own module (e.g. `research.py`).

This module is the single source of truth for what `/api/tools`
advertises and what `build_graph(tool_names=...)` can bind. To add a
new tool, drop a `@tool`-decorated function in the appropriate file
and register it in `ALL_TOOLS` below.
"""

from typing import Optional

from .host import web_search
from .research import research

ALL_TOOLS = {
    "web_search": web_search,
    "research": research,
}


def get_tools(names: Optional[list[str]] = None) -> list:
    """Return the LangChain Tool objects matching the requested names.

    If `names` is None, all registered tools are returned. Unknown names
    are silently dropped — the caller (the API layer) is the right place
    to validate the tool list against what the user is allowed to use.
    """
    if names is None:
        return list(ALL_TOOLS.values())
    return [ALL_TOOLS[n] for n in names if n in ALL_TOOLS]


__all__ = ["ALL_TOOLS", "get_tools", "web_search", "research"]
