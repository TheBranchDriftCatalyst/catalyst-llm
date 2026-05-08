"""FastAPI app exposing the OpenAI /v1/images/generations contract.

Routes:
  GET  /healthz              — liveness probe (always 200 once app is up)
  GET  /v1/models            — list configured pipelines (single entry)
  POST /v1/images/generations — generate one or more images

Run:
  uv run mflux-shim
or:
  uvicorn mflux_shim.server:app --host 0.0.0.0 --port 8012
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from .config import settings
from .generator import GenerateRequest, ensure_loaded, generate

log = logging.getLogger("mflux-shim.server")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
)


# ───────────────────────────────────────────────────────────────────────
# Request / response schemas (OpenAI-compatible subset)
# ───────────────────────────────────────────────────────────────────────


SIZE_RE = re.compile(r"^(\d{2,4})x(\d{2,4})$")


class ImageRequest(BaseModel):
    """Subset of OpenAI's images.generations request that we honor.

    Anything we don't support (style, response_format=url, user, etc.)
    is silently ignored — clients pass them and we let it slide rather
    than 422-ing on a field we just don't care about.
    """

    model: str = Field(..., description="Pipeline alias to invoke")
    prompt: str
    n: int = Field(1, ge=1, le=4)
    size: str = "1024x1024"
    # FLUX-specific knobs we expose via the OpenAI-compat extension fields:
    seed: int | None = None
    steps: int | None = None
    guidance: float | None = None
    response_format: Literal["b64_json", "url"] = "b64_json"

    @field_validator("size")
    @classmethod
    def _validate_size(cls, v: str) -> str:
        if not SIZE_RE.fullmatch(v):
            raise ValueError(f"invalid size {v!r}; expected WIDTHxHEIGHT")
        return v

    def dimensions(self) -> tuple[int, int]:
        m = SIZE_RE.fullmatch(self.size)
        assert m
        return int(m.group(1)), int(m.group(2))


class ImageObject(BaseModel):
    b64_json: str
    revised_prompt: str | None = None


class ImageResponse(BaseModel):
    created: int
    data: list[ImageObject]


class ModelEntry(BaseModel):
    id: str
    object: Literal["model"] = "model"
    created: int
    owned_by: str = "mflux-shim"


class ModelsResponse(BaseModel):
    object: Literal["list"] = "list"
    data: list[ModelEntry]


# ───────────────────────────────────────────────────────────────────────
# Lifespan: schedule the model load in the background so the HTTP server
# answers /healthz immediately while MLX is still initializing.
# ───────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("mflux-shim starting on %s:%d", settings.host, settings.port)
    asyncio.create_task(ensure_loaded())
    yield
    log.info("mflux-shim shutting down")


app = FastAPI(
    title="mflux-shim",
    version="0.1.0",
    lifespan=lifespan,
)

_concurrency_sem = asyncio.Semaphore(settings.max_concurrency)


# ───────────────────────────────────────────────────────────────────────
# Routes
# ───────────────────────────────────────────────────────────────────────


def _check_auth(request: Request) -> None:
    """Bearer auth when SHIM_API_KEY is set; no-op otherwise."""
    if not settings.api_key:
        return
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = header[len("Bearer ") :].strip()
    if token != settings.api_key:
        raise HTTPException(401, "invalid token")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/models", response_model=ModelsResponse)
async def list_models(request: Request) -> ModelsResponse:
    _check_auth(request)
    return ModelsResponse(
        data=[
            ModelEntry(
                id=settings.model_alias,
                created=int(time.time()),
            )
        ]
    )


@app.post("/v1/images/generations", response_model=ImageResponse)
async def generate_image(req: ImageRequest, request: Request) -> ImageResponse:
    _check_auth(request)

    # We only serve the configured alias; reject others early so the
    # caller gets a clear error instead of a model-load failure deep in
    # mflux. LiteLLM should be sending a model id that matches the
    # configured alias because it forwards what it routed.
    if req.model != settings.model_alias and req.model != "mflux":
        raise HTTPException(
            404,
            f"model {req.model!r} not configured on this shim "
            f"(serving only {settings.model_alias!r}; set MFLUX_MODEL to change)",
        )

    if req.response_format != "b64_json":
        # url-mode would require us to host a static file or signed URL —
        # not in scope for a personal stack. Push back on the client.
        raise HTTPException(400, "only response_format=b64_json is supported")

    width, height = req.dimensions()
    steps = req.steps or settings.default_steps
    guidance = req.guidance if req.guidance is not None else settings.default_guidance

    images: list[ImageObject] = []
    async with _concurrency_sem:
        for i in range(req.n):
            # Each n increments the seed so a single "n=4" call returns
            # a varied set rather than 4 copies of the same image.
            seed = req.seed + i if req.seed is not None else None
            result = await generate(
                GenerateRequest(
                    prompt=req.prompt,
                    width=width,
                    height=height,
                    steps=steps,
                    guidance=guidance,
                    seed=seed,
                )
            )
            log.info(
                "generated 1/%d size=%dx%d steps=%d seed=%d in %.1fs",
                req.n,
                width,
                height,
                steps,
                result.seed,
                result.duration_s,
            )
            images.append(
                ImageObject(b64_json=base64.b64encode(result.png_bytes).decode("ascii"))
            )

    return ImageResponse(created=int(time.time()), data=images)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    """Surface unexpected failures as JSON instead of HTML so LiteLLM
    can parse and forward them as proper API errors."""
    log.exception("unhandled error during %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": {"type": "internal_error", "message": str(exc)}},
    )


def main() -> None:
    """Console entrypoint registered via pyproject [project.scripts]."""
    import uvicorn

    uvicorn.run(
        "mflux_shim.server:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
