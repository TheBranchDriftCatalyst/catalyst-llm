"""Async ComfyUI client: submit a workflow, watch the WS, fetch outputs.

ComfyUI's HTTP surface is split:
  POST /prompt              -> queue a workflow, returns prompt_id
  GET  /history/<prompt_id> -> per-execution outputs once it's done
  GET  /view?...            -> fetch a saved image by (filename, type, subfolder)
  WS   /ws?clientId=<uuid>  -> live progress events; "executed" event fires
                                per node, with output images in `data.output`

The most reliable pattern is: open the WS *before* POST /prompt, watch for
``executing`` with ``node=null`` (= done), then read /history. This avoids
race conditions where the prompt finishes before our HTTP poll loop starts.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import httpx
import websockets

from ._heartbeat import heartbeat


class ComfyError(RuntimeError):
    """Server-side or transport-level failure during a generation."""


class ComfyClient:
    def __init__(self, base: str, timeout: float = 300.0) -> None:
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.client_id = str(uuid.uuid4())
        # ws scheme matches base scheme
        self.ws_url = (
            self.base.replace("http://", "ws://").replace("https://", "wss://")
            + f"/ws?clientId={self.client_id}"
        )

    async def health(self) -> bool:
        async with httpx.AsyncClient(timeout=5) as c:
            try:
                r = await c.get(f"{self.base}/system_stats")
                return r.status_code == 200
            except httpx.HTTPError:
                return False

    async def run(self, workflow: dict[str, Any]) -> list[bytes]:
        """Submit ``workflow``, wait for completion, return image bytes per output."""
        async with heartbeat("comfyui.workflow"):
            # Open the WS first so we don't miss the executed events.
            async with websockets.connect(self.ws_url, max_size=None) as ws:
                prompt_id = await self._queue(workflow)
                await self._await_completion(ws, prompt_id)
            return await self._collect_images(prompt_id)

    async def _queue(self, workflow: dict[str, Any]) -> str:
        async with httpx.AsyncClient(timeout=self.timeout) as c:
            r = await c.post(
                f"{self.base}/prompt",
                json={"prompt": workflow, "client_id": self.client_id},
            )
            if r.status_code >= 400:
                raise ComfyError(f"queue failed: HTTP {r.status_code} — {r.text[:300]}")
            data = r.json()
            pid = data.get("prompt_id")
            if not pid:
                raise ComfyError(f"queue response missing prompt_id: {data}")
            return pid

    async def _await_completion(self, ws: Any, prompt_id: str) -> None:
        """Drain WS until we see executing with node=null for our prompt_id."""
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=self.timeout)
            except asyncio.TimeoutError as e:
                raise ComfyError(
                    f"timed out waiting on prompt {prompt_id} after {self.timeout}s"
                ) from e
            if isinstance(raw, (bytes, bytearray)):
                continue  # binary image previews — skip
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            mtype = msg.get("type")
            data = msg.get("data") or {}
            if data.get("prompt_id") and data["prompt_id"] != prompt_id:
                continue
            if mtype == "execution_error":
                raise ComfyError(f"execution_error: {data}")
            if mtype == "executing" and data.get("node") is None:
                return  # finished

    async def _collect_images(self, prompt_id: str) -> list[bytes]:
        async with httpx.AsyncClient(timeout=self.timeout) as c:
            hist = (await c.get(f"{self.base}/history/{prompt_id}")).json()
            entry = hist.get(prompt_id)
            if not entry:
                raise ComfyError(f"no history entry for prompt {prompt_id}")
            outputs = (entry.get("outputs") or {}).values()
            results: list[bytes] = []
            for node_out in outputs:
                for img in node_out.get("images", []) or []:
                    if img.get("type") == "temp":
                        continue  # skip preview thumbnails
                    params = {
                        "filename": img["filename"],
                        "subfolder": img.get("subfolder", ""),
                        "type": img.get("type", "output"),
                    }
                    r = await c.get(f"{self.base}/view", params=params)
                    if r.status_code == 200 and r.content:
                        results.append(r.content)
            if not results:
                raise ComfyError(
                    f"workflow finished but produced no images (prompt {prompt_id})"
                )
            return results
