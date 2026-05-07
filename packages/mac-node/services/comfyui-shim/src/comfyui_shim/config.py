"""Env-driven config for the ComfyUI shim."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    comfyui_base: str = os.getenv("COMFYUI_BASE", "http://127.0.0.1:8188")
    pipelines_dir: Path = Path(
        os.getenv("PIPELINES_DIR", str(Path(__file__).resolve().parents[2] / "pipelines"))
    )
    shim_port: int = int(os.getenv("SHIM_PORT", "8012"))
    shim_host: str = os.getenv("SHIM_HOST", "0.0.0.0")
    request_timeout: float = float(os.getenv("REQUEST_TIMEOUT", "300"))
    api_key: str = os.getenv("SHIM_API_KEY", "")  # empty => no auth check


CONFIG = Config()
