"""Runtime configuration pulled from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    """All knobs the operator can tune via env. Constructed once at startup."""

    # FastAPI bind address. 0.0.0.0 because the LiteLLM pod in k8s has to
    # reach this from a different host (the mac node).
    host: str = field(default_factory=lambda: os.environ.get("SHIM_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.environ.get("SHIM_PORT", "8012")))

    # Optional bearer token. When set, every request must carry an
    # `Authorization: Bearer <token>` header that matches; LiteLLM forwards
    # whatever api_key the model entry lists. Leave empty to disable auth
    # (fine on a private LAN; not fine when exposed publicly).
    api_key: str | None = field(default_factory=lambda: os.environ.get("SHIM_API_KEY") or None)

    # mflux model alias. The mflux library ships several built-in aliases
    # ("dev", "schnell", "dev-krea") and also accepts custom aliases the
    # user has set via `mflux-set-alias`. We pick the alias at startup and
    # keep one model loaded for the shim's lifetime — loading FLUX is
    # expensive (~30s) so we do not want to do it per request.
    model_alias: str = field(default_factory=lambda: os.environ.get("MFLUX_MODEL", "dev-krea"))

    # Quantization level for mflux: 4 (~7GB), 6, or 8 (~24GB). 8 is the
    # quality default on a 128GB M5 Max. Drop to 4 if you need to coexist
    # with multiple LLMs in unified memory at the same time.
    quantize: int = field(default_factory=lambda: int(os.environ.get("MFLUX_QUANTIZE", "8")))

    # Where mflux caches model weights. Defaults to ~/.cache/mflux which
    # is what the mflux CLI uses; override only if you need a separate
    # disk location for the multi-GB weights.
    cache_dir: str | None = field(default_factory=lambda: os.environ.get("MFLUX_CACHE_DIR") or None)

    # Default inference steps when the request doesn't specify one. dev /
    # dev-krea need 20-28 for quality; schnell only needs 4. We default
    # to a middle value and let the request override.
    default_steps: int = field(default_factory=lambda: int(os.environ.get("MFLUX_DEFAULT_STEPS", "20")))

    # Default guidance scale when the request doesn't specify. 3.5 is the
    # mflux default for FLUX-dev family.
    default_guidance: float = field(default_factory=lambda: float(os.environ.get("MFLUX_DEFAULT_GUIDANCE", "3.5")))

    # Cap on simultaneous requests. mflux holds the GPU during generation
    # so we serialize — concurrency > 1 just thrashes Metal. The semaphore
    # lives in the FastAPI handler.
    max_concurrency: int = field(default_factory=lambda: int(os.environ.get("MFLUX_MAX_CONCURRENCY", "1")))


settings = Settings()
