"""Load pipeline JSON templates and substitute runtime parameters.

Each pipeline file is a ComfyUI API-format workflow with an extra ``_meta``
block describing how runtime params (prompt, dimensions, seed) map onto node
inputs. We swap those values in before submission and strip ``_meta`` so the
ComfyUI server sees a clean workflow.
"""
from __future__ import annotations

import copy
import json
import secrets
from pathlib import Path
from typing import Any


class PipelineError(Exception):
    """Raised for unknown pipeline names or invalid templates."""


_REPLACEMENT_TOKEN = "REPLACED_AT_RUNTIME"


class Pipeline:
    """Compiled, parameter-aware view of a single workflow JSON."""

    def __init__(self, name: str, raw: dict[str, Any]):
        self.name = name
        self.raw = raw
        meta = raw.get("_meta", {})
        if not meta:
            raise PipelineError(f"pipeline {name!r} is missing _meta block")
        self.meta = meta
        self.description = meta.get("description", "")
        self.default_size: str = meta.get("default_size", "1024x1024")
        self.approx_seconds: float = float(meta.get("approx_seconds_m5_max", 0))
        # parameters: { "prompt": "$nodes.6.inputs.text" }
        # or         { "prompt": ["$nodes.6.inputs.clip_l", "$nodes.6.inputs.t5xxl"] }
        self._param_paths: dict[str, str | list[str]] = meta.get("parameters", {})

    def render(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        seed: int | None = None,
        guidance: float | None = None,
    ) -> dict[str, Any]:
        """Return a workflow ready to POST to ``/prompt``."""
        wf = copy.deepcopy(self.raw)
        wf.pop("_meta", None)

        if seed is None:
            seed = secrets.randbits(32)

        values: dict[str, Any] = {
            "prompt": prompt,
            "width": int(width),
            "height": int(height),
            "seed": int(seed),
        }
        if guidance is not None:
            values["guidance"] = float(guidance)

        for param, paths in self._param_paths.items():
            if param not in values:
                continue
            if isinstance(paths, str):
                paths = [paths]
            for path in paths:
                self._set_path(wf, path, values[param])

        # Defensive: any node still containing the placeholder is misconfigured.
        for node_id, node in wf.items():
            for key, val in (node.get("inputs") or {}).items():
                if val == _REPLACEMENT_TOKEN:
                    raise PipelineError(
                        f"unbound parameter slot at node {node_id} input {key!r} "
                        f"for pipeline {self.name!r}"
                    )
        return wf

    @staticmethod
    def _set_path(wf: dict[str, Any], path: str, value: Any) -> None:
        # path like "$nodes.6.inputs.text" -> wf["6"]["inputs"]["text"] = value
        if not path.startswith("$nodes."):
            raise PipelineError(f"unsupported parameter path: {path!r}")
        parts = path[len("$nodes."):].split(".")
        if len(parts) < 2:
            raise PipelineError(f"parameter path too short: {path!r}")
        node_id, *rest = parts
        node = wf.get(node_id)
        if node is None:
            raise PipelineError(f"path {path!r} references missing node {node_id!r}")
        cursor: Any = node
        for key in rest[:-1]:
            cursor = cursor[key]
        cursor[rest[-1]] = value


def load_all(pipelines_dir: Path) -> dict[str, Pipeline]:
    out: dict[str, Pipeline] = {}
    for path in sorted(pipelines_dir.glob("*.json")):
        raw = json.loads(path.read_text())
        meta = raw.get("_meta", {})
        name = meta.get("name") or path.stem
        out[name] = Pipeline(name, raw)
    return out
