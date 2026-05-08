"""Wraps the mflux Flux1 model with a tiny generate() helper."""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Optional

from .config import settings

log = logging.getLogger("mflux-shim.generator")

# We import mflux lazily so the shim can boot far enough to serve
# /healthz / /v1/models even while MLX is still loading the model into
# memory (~25-30 seconds on first start). Worker code that touches the
# model awaits `ensure_loaded()` before running.
_lock = asyncio.Lock()
_flux = None  # type: ignore[assignment]


@dataclass
class GenerateRequest:
    prompt: str
    width: int = 1024
    height: int = 1024
    steps: int = 20
    guidance: float = 3.5
    seed: Optional[int] = None
    negative_prompt: Optional[str] = None


@dataclass
class GenerateResult:
    """Returned to the FastAPI handler. Bytes are PNG-encoded."""

    png_bytes: bytes
    seed: int
    duration_s: float


async def ensure_loaded() -> None:
    """Idempotently load the mflux model into MLX memory.

    Called from both the FastAPI startup hook and the first generate()
    call as a safety net — startup runs the load asynchronously, so a
    request that lands before load completes still has to wait on the
    same lock, which is what we want.
    """
    global _flux
    if _flux is not None:
        return
    async with _lock:
        if _flux is not None:
            return
        log.info(
            "loading mflux model alias=%r quantize=%d (this takes ~30s on cold start)",
            settings.model_alias,
            settings.quantize,
        )
        # Heavy import deferred so the rest of the app can boot first.
        from mflux import Flux1, ModelConfig  # type: ignore[import-untyped]

        cfg_kwargs = {"model_name": settings.model_alias}
        if settings.cache_dir:
            cfg_kwargs["base_model_path"] = settings.cache_dir
        config = ModelConfig.from_alias(settings.model_alias)

        # Run the heavy load on a worker thread so we don't pin the
        # asyncio loop while MLX shoves weights into unified memory.
        loop = asyncio.get_running_loop()
        _flux = await loop.run_in_executor(
            None,
            lambda: Flux1(model_config=config, quantize=settings.quantize),
        )
        log.info("mflux loaded")


async def generate(req: GenerateRequest) -> GenerateResult:
    """Run a single image generation. Serializes via the shared lock so
    we don't dispatch concurrent MLX work — Flux holds the GPU while
    diffusing and there's nothing to gain from N parallel runs."""
    await ensure_loaded()

    # Resolve seed up front so we can return it deterministically. mflux
    # itself accepts None and picks one, but we want the value back.
    import random

    seed = req.seed if req.seed is not None else random.randint(1, 2**31 - 1)

    # Heavy MLX work — keep the asyncio loop free.
    loop = asyncio.get_running_loop()
    start = time.monotonic()
    image = await loop.run_in_executor(
        None,
        lambda: _flux.generate_image(  # type: ignore[union-attr]
            seed=seed,
            prompt=req.prompt,
            config=_make_inference_config(req),
        ),
    )
    duration = time.monotonic() - start

    # mflux returns a wrapper with a PIL Image at .image — encode to PNG
    # so the OpenAI b64_json contract is honored.
    import io

    buf = io.BytesIO()
    image.image.save(buf, format="PNG")
    return GenerateResult(png_bytes=buf.getvalue(), seed=seed, duration_s=duration)


def _make_inference_config(req: GenerateRequest):
    """Bridge our GenerateRequest into mflux's Config. Kept in its own
    function so the import surface for mflux is small."""
    from mflux import Config  # type: ignore[import-untyped]

    return Config(
        num_inference_steps=req.steps,
        height=req.height,
        width=req.width,
        guidance=req.guidance,
    )
