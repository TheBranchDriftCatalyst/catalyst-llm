"""FastAPI service that executes catalyst-llm-sdk tool calls server-side.

The browser-side SDK loop in `client.streamChat` dispatches tool calls
to whichever ToolDefinition handler the host registered. The handlers
in `@catalyst/llm-sdk/client/tools/builtins` POST here so the actual
side effects (SearXNG queries, headless browser fetches, future MCP
adapters) run in a place that can hold credentials, run Playwright,
and bypass browser CORS without ceremony.

Routes:

  GET  /healthz                      — liveness, returns {"status":"ok"}
  GET  /v1/tools                     — list registered tools (informational)
  POST /v1/tools/web_search          — SearXNG-backed search, JSON in/out
  POST /v1/tools/browse_page         — headless browser fetch (Pass 2: Playwright)

Run:
  uv run tool-host
or:
  uvicorn tool_host.server:app --host 0.0.0.0 --port 7077
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

log = logging.getLogger("tool-host")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
)


# ───────────────────────────────────────────────────────────────────────
# Settings — environment overrides for the docker-compose case where
# the service is reachable as "searxng" on the internal network, vs
# the laptop-dev case where it's localhost.
# ───────────────────────────────────────────────────────────────────────

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://searxng:8080")
SHIM_API_KEY = os.environ.get("TOOL_HOST_API_KEY") or None
SHIM_HOST = os.environ.get("TOOL_HOST_HOST", "0.0.0.0")
SHIM_PORT = int(os.environ.get("TOOL_HOST_PORT", "7077"))
# Default search engines mirror Open WebUI's defaults — broad enough
# to be useful, narrow enough to avoid rate limits we'd hit if we let
# SearXNG fan out to all 70+.
SEARXNG_DEFAULT_ENGINES = os.environ.get(
    "SEARXNG_ENGINES",
    "google,bing,duckduckgo,brave,wikipedia,github",
)
HTTP_TIMEOUT = float(os.environ.get("TOOL_HOST_HTTP_TIMEOUT", "20"))


# ───────────────────────────────────────────────────────────────────────
# Schemas (pydantic models == OpenAPI auto-generation, == validation)
# ───────────────────────────────────────────────────────────────────────


class WebSearchRequest(BaseModel):
    query: str = Field(..., description="Search query, 5-10 words ideal.")
    n: int | None = Field(8, ge=1, le=20)
    time_range: str | None = Field(
        None,
        pattern="^(day|week|month|year)$",
        description="Optional recency filter.",
    )


class WebSearchResult(BaseModel):
    title: str
    url: str
    snippet: str
    engine: str | None = None


class WebSearchResponse(BaseModel):
    query: str
    results: list[WebSearchResult]


class BrowsePageRequest(BaseModel):
    url: str
    raw: bool = False
    max_chars: int = Field(8000, ge=500, le=32000)


class BrowsePageResponse(BaseModel):
    url: str
    title: str
    content: str
    links: list[dict[str, str]] | None = None


# ───────────────────────────────────────────────────────────────────────
# Lifespan: shared httpx client so we keep keepalive sockets to
# searxng (and later other backends) instead of paying TLS handshake
# per call.
# ───────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("tool-host starting on %s:%d (searxng=%s)", SHIM_HOST, SHIM_PORT, SEARXNG_URL)
    app.state.http = httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": "catalyst-tool-host/0.1"},
    )
    try:
        yield
    finally:
        await app.state.http.aclose()
        log.info("tool-host shutting down")


app = FastAPI(
    title="catalyst-tool-host",
    version="0.1.0",
    lifespan=lifespan,
)

# Open CORS for the playground at any localhost port. Tighten when you
# expose this to the open internet — auth via TOOL_HOST_API_KEY below
# is the second line of defense.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ───────────────────────────────────────────────────────────────────────
# Auth — bearer token check, opt-in via env. No-op when SHIM_API_KEY
# is unset (fine on a private LAN; required when exposed publicly).
# ───────────────────────────────────────────────────────────────────────


def _check_auth(request: Request) -> None:
    if not SHIM_API_KEY:
        return
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = header[len("Bearer ") :].strip()
    if token != SHIM_API_KEY:
        raise HTTPException(401, "invalid token")


# ───────────────────────────────────────────────────────────────────────
# Routes
# ───────────────────────────────────────────────────────────────────────


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/tools")
async def list_tools(request: Request) -> dict[str, object]:
    """Informational — what tools this host implements right now.
    The SDK doesn't read this (tool definitions live client-side); it's
    here so an operator can curl the host and see what's wired."""
    _check_auth(request)
    return {
        "tools": [
            {
                "name": "web_search",
                "description": "SearXNG-aggregated web search.",
                "implemented": True,
            },
            {
                "name": "browse_page",
                "description": "Headless-browser page fetch + text extraction.",
                "implemented": False,
                "note": "Pass 2 — Playwright lands in the next commit.",
            },
        ],
        "searxng_url": SEARXNG_URL,
    }


@app.post("/v1/tools/web_search", response_model=WebSearchResponse)
async def web_search(req: WebSearchRequest, request: Request) -> WebSearchResponse:
    _check_auth(request)
    started = time.monotonic()
    params: dict[str, object] = {
        "q": req.query,
        "format": "json",
        "language": "en",
        "engines": SEARXNG_DEFAULT_ENGINES,
        # SearXNG returns ~10 by default; we'll trim to req.n client-side.
    }
    if req.time_range:
        params["time_range"] = req.time_range

    http: httpx.AsyncClient = request.app.state.http
    try:
        resp = await http.get(f"{SEARXNG_URL}/search", params=params)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        log.warning("searxng %s failed: %s", req.query, exc)
        raise HTTPException(502, f"searxng request failed: {exc}") from exc

    raw = data.get("results", []) or []
    n = req.n or 8
    results = [
        WebSearchResult(
            title=r.get("title", "") or "",
            url=r.get("url", "") or "",
            snippet=(r.get("content") or "").strip(),
            engine=r.get("engine"),
        )
        for r in raw[:n]
    ]
    log.info(
        "web_search query=%r returned=%d in %.0fms",
        req.query,
        len(results),
        (time.monotonic() - started) * 1000,
    )
    return WebSearchResponse(query=req.query, results=results)


@app.post("/v1/tools/browse_page", response_model=BrowsePageResponse)
async def browse_page(_req: BrowsePageRequest, request: Request) -> BrowsePageResponse:
    _check_auth(request)
    # Pass 2 lands the Playwright impl. Returning a clean 501 lets the
    # client surface an actionable error in the chat instead of a
    # mysterious silence.
    raise HTTPException(
        status_code=501,
        detail=(
            "browse_page is not implemented yet — coming in the next "
            "tool-host release. Until then the SDK should drop this "
            "tool from its registry, or guide the model around it."
        ),
    )


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error during %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": {"type": "internal_error", "message": str(exc)}},
    )


def main() -> None:
    """Entrypoint for `uv run tool-host` / pyproject script."""
    import uvicorn

    uvicorn.run(
        "tool_host.server:app",
        host=SHIM_HOST,
        port=SHIM_PORT,
        log_level="info",
    )


if __name__ == "__main__":
    main()
