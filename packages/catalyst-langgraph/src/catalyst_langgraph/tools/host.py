"""LangChain tools that delegate to the catalyst tool-host service.

The tool-host (packages/tool-host) owns side-effecting work — SearXNG
queries, headless browser fetches — so this package only owns the
agent loop. Each tool here is a thin httpx wrapper around a tool-host
endpoint, exposed via @tool so LangGraph's ToolNode can dispatch it.

Tools return strings the model can read. We deliberately keep results
short (top-N, snippet only) so weak tool-callers don't drown in context.
"""
from __future__ import annotations

import json
import os
from typing import Optional

import httpx
from langchain_core.tools import tool

TOOL_HOST_URL = os.environ.get("TOOL_HOST_URL", "http://tool-host:7077")
TOOL_HOST_API_KEY = os.environ.get("TOOL_HOST_API_KEY") or None
TOOL_HOST_TIMEOUT = float(os.environ.get("TOOL_HOST_TIMEOUT", "20"))


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if TOOL_HOST_API_KEY:
        h["Authorization"] = f"Bearer {TOOL_HOST_API_KEY}"
    return h


@tool
def web_search(query: str, n: int = 5, time_range: Optional[str] = None) -> str:
    """Search the web via SearXNG and return the top results.

    Args:
        query: Search query (5-10 words ideal).
        n: How many results to return (1-20). Default 5.
        time_range: One of "day", "week", "month", "year" — recency filter.

    Returns:
        Markdown-formatted list of {title, url, snippet} entries.
    """
    body: dict[str, object] = {"query": query, "n": n}
    if time_range:
        body["time_range"] = time_range
    try:
        with httpx.Client(timeout=TOOL_HOST_TIMEOUT) as client:
            resp = client.post(
                f"{TOOL_HOST_URL}/v1/tools/web_search",
                headers=_headers(),
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        return f"web_search failed: {exc}"

    results = data.get("results", [])
    if not results:
        return f"No results for {query!r}."

    lines = [f"Top {len(results)} results for {query!r}:"]
    for i, r in enumerate(results, 1):
        title = r.get("title") or "(untitled)"
        url = r.get("url") or ""
        snippet = (r.get("snippet") or "").replace("\n", " ").strip()
        lines.append(f"{i}. [{title}]({url})\n   {snippet}")
    return "\n".join(lines)


# Local registry kept for legacy importers / partial-rollout safety.
# The canonical, merged registry (host tools + sub-agent tools) lives
# in `tools/__init__.py`; new code should import from there.
ALL_TOOLS = {
    "web_search": web_search,
}


def get_tools(names: Optional[list[str]] = None) -> list:
    """Deprecated: prefer `from catalyst_langgraph.tools import get_tools`.

    Returns only the host-level tools so this remains safe to call from
    older code paths. The package-level `get_tools` covers sub-agent
    tools too.
    """
    if names is None:
        return list(ALL_TOOLS.values())
    return [ALL_TOOLS[n] for n in names if n in ALL_TOOLS]
