"""FastAPI shim — translates OpenAI-compatible image_generation requests
into ComfyUI workflow submissions and back.

Surface (subset of the OpenAI API):

  POST /v1/images/generations
       {model, prompt, n, size, response_format, [seed], [guidance]}
       -> {created, data: [{b64_json | url}]}

  GET  /v1/models
       -> {data: [{id, object: "model", owned_by: "mac-node-comfyui"}]}

  GET  /healthz
       -> {ok, comfyui_reachable, pipelines: [...]}

The shim is intentionally thin: every concern that isn't the OpenAI shape
contract lives in pipelines.py / comfyui_client.py.
"""
from __future__ import annotations

import asyncio
import base64
import time
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .comfyui_client import ComfyClient, ComfyError
from .config import CONFIG
from .pipelines import Pipeline, PipelineError, load_all


PIPELINES: dict[str, Pipeline] = {}


def _load_pipelines() -> None:
    global PIPELINES
    PIPELINES = load_all(CONFIG.pipelines_dir)


_load_pipelines()


app = FastAPI(
    title="comfyui-shim",
    version="0.1.0",
    description="OpenAI-compatible image_generation surface in front of ComfyUI",
)


# --- Request / response models -------------------------------------------


class ImageRequest(BaseModel):
    model: str = Field(..., description="Pipeline name, e.g. 'flux-dev-pro'")
    prompt: str = Field(..., min_length=1, max_length=4000)
    n: int = Field(1, ge=1, le=4)
    size: str = Field("1024x1024", pattern=r"^\d{3,4}x\d{3,4}$")
    response_format: Literal["b64_json", "url"] = "b64_json"
    seed: int | None = Field(None, ge=0, le=2**32 - 1)
    guidance: float | None = Field(None, ge=0.0, le=10.0)


class ImageData(BaseModel):
    b64_json: str | None = None
    url: str | None = None


class ImageResponse(BaseModel):
    created: int
    data: list[ImageData]


class ModelEntry(BaseModel):
    id: str
    object: Literal["model"] = "model"
    created: int
    owned_by: str = "mac-node-comfyui"
    description: str | None = None


class ModelList(BaseModel):
    object: Literal["list"] = "list"
    data: list[ModelEntry]


# --- Auth ---------------------------------------------------------------


def _require_key(authorization: Annotated[str | None, Header()] = None) -> None:
    if not CONFIG.api_key:
        return  # auth disabled
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    if authorization.removeprefix("Bearer ").strip() != CONFIG.api_key:
        raise HTTPException(status_code=401, detail="invalid api key")


# --- Routes -------------------------------------------------------------


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    client = ComfyClient(CONFIG.comfyui_base, timeout=5.0)
    return {
        "ok": True,
        "comfyui_reachable": await client.health(),
        "pipelines": sorted(PIPELINES.keys()),
    }


@app.get("/v1/models", response_model=ModelList)
async def list_models(_: None = Depends(_require_key)) -> ModelList:
    now = int(time.time())
    return ModelList(
        data=[
            ModelEntry(id=name, created=now, description=p.description)
            for name, p in sorted(PIPELINES.items())
        ]
    )


@app.post("/v1/images/generations", response_model=ImageResponse)
async def generate(
    req: ImageRequest, _: None = Depends(_require_key)
) -> ImageResponse:
    pipeline = PIPELINES.get(req.model)
    if pipeline is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown model {req.model!r}; available: {sorted(PIPELINES.keys())}",
        )

    try:
        width, height = (int(x) for x in req.size.split("x", 1))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid size {req.size!r}") from e
    if width % 16 or height % 16:
        raise HTTPException(status_code=400, detail="size must be a multiple of 16")

    client = ComfyClient(CONFIG.comfyui_base, timeout=CONFIG.request_timeout)
    if not await client.health():
        raise HTTPException(
            status_code=503,
            detail=f"ComfyUI unreachable at {CONFIG.comfyui_base}",
        )

    images: list[bytes] = []
    for i in range(req.n):
        try:
            workflow = pipeline.render(
                prompt=req.prompt,
                width=width,
                height=height,
                seed=(req.seed + i) if req.seed is not None else None,
                guidance=req.guidance,
            )
        except PipelineError as e:
            raise HTTPException(status_code=500, detail=f"pipeline error: {e}") from e

        try:
            batch = await client.run(workflow)
        except ComfyError as e:
            raise HTTPException(status_code=502, detail=f"ComfyUI: {e}") from e
        images.extend(batch)

    if req.response_format == "url":
        # We don't operate object storage; degrade by returning b64 with a
        # data: URL prefix so any reasonable client still gets pixels.
        data = [
            ImageData(url=f"data:image/png;base64,{base64.b64encode(b).decode()}")
            for b in images
        ]
    else:
        data = [ImageData(b64_json=base64.b64encode(b).decode()) for b in images]

    return ImageResponse(created=int(time.time()), data=data)


# --- Entry point --------------------------------------------------------


def main() -> None:
    import uvicorn

    uvicorn.run(
        "comfyui_shim.server:app",
        host=CONFIG.shim_host,
        port=CONFIG.shim_port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
