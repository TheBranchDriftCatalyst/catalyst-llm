"""Image generation tests — parametrized over (image_gen pipeline, backend).

Each pipeline in models.yaml's ``image_gen.pipelines`` produces a test case
per selected backend. The mac backend hits the comfyui-shim directly at
:8012/v1; the litellm backend hits the proxy at $LITELLM_BASE.

We assert: a successful 200, at least one image bytes blob returned, the
blob starts with the PNG magic header. We do NOT assert content quality —
that's a benchmarking concern, not smoke.
"""
from __future__ import annotations

import base64
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml

from conftest import MAC_NODE_DIR


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
TIMEOUT = 600.0  # PRO pipeline can take ~35s, fast pipeline ~6s; pad generously


def _load_pipelines() -> list[dict[str, Any]]:
    cfg = yaml.safe_load((MAC_NODE_DIR / "models.yaml").read_text())
    return (cfg.get("image_gen") or {}).get("pipelines") or []


def _shim_base(pytestconfig: pytest.Config) -> str:
    from conftest import _resolve_mac_host
    cfg = yaml.safe_load((MAC_NODE_DIR / "models.yaml").read_text())
    port = (cfg.get("image_gen") or {}).get("shim_port", 8012)
    # Probe localhost first, fall back to the configured LAN IP — same
    # idiom as the Ollama client. The shim and Ollama always co-locate.
    host = _resolve_mac_host(pytestconfig.getoption("--mac-host"), port)
    return f"http://{host}:{port}"


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:  # noqa: D401
    """Parametrize ``test_image_gen`` over all configured pipelines × backends."""
    if metafunc.function.__name__ != "test_image_gen":
        return
    if "pipeline" not in metafunc.fixturenames or "backend" not in metafunc.fixturenames:
        return
    pipelines = _load_pipelines()
    backends = (
        ["mac", "litellm"]
        if metafunc.config.getoption("--backend") == "both"
        else [metafunc.config.getoption("--backend")]
    )
    quick = metafunc.config.getoption("--quick")
    if quick and pipelines:
        pipelines = [pipelines[0]]
    pairs = [(p, b) for p in pipelines for b in backends]
    if not pairs:
        pytest.skip("no image_gen pipelines in models.yaml")
        return
    metafunc.parametrize(
        ("pipeline", "backend"),
        pairs,
        ids=[f"{p['alias']}-{b}" for p, b in pairs],
    )


def _model_name(backend: str, pipeline: dict[str, Any]) -> str:
    # mac shim addresses pipelines by their full name (flux-dev-pro);
    # litellm addresses them by the alias (mac/flux-pro).
    if backend == "mac":
        return pipeline["name"]
    return f"mac/{pipeline['alias']}"


def _endpoint(backend: str, pytestconfig: pytest.Config) -> tuple[str, dict[str, str]]:
    if backend == "mac":
        return _shim_base(pytestconfig) + "/v1/images/generations", {}
    base = pytestconfig.getoption("--litellm-base").rstrip("/")
    headers: dict[str, str] = {"Content-Type": "application/json"}
    key = pytestconfig.getoption("--litellm-key")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return f"{base}/v1/images/generations", headers


def _backend_reachable(backend: str, pytestconfig: pytest.Config) -> bool:
    if backend == "mac":
        url = _shim_base(pytestconfig) + "/healthz"
    else:
        base = pytestconfig.getoption("--litellm-base").rstrip("/")
        url = f"{base}/health/readiness"
    try:
        r = httpx.get(url, timeout=5)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


@pytest.mark.slow
def test_image_gen(
    pytestconfig: pytest.Config,
    pipeline: dict[str, Any],
    backend: str,
) -> None:
    if not _backend_reachable(backend, pytestconfig):
        pytest.skip(f"{backend} backend unreachable")

    url, headers = _endpoint(backend, pytestconfig)
    body = {
        "model": _model_name(backend, pipeline),
        "prompt": "a single red apple sitting on a white marble surface, soft daylight",
        "size": "512x512",  # smaller than the pipeline default to keep CI sane
        "n": 1,
        "response_format": "b64_json",
    }

    t0 = time.time()
    r = httpx.post(url, headers=headers, json=body, timeout=TIMEOUT)
    elapsed = time.time() - t0

    assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:300]}"
    payload = r.json()
    data = payload.get("data") or []
    assert data, f"no image data in response: {payload}"
    b64 = data[0].get("b64_json") or ""
    if not b64 and (data[0].get("url") or "").startswith("data:image/"):
        b64 = data[0]["url"].split(",", 1)[1]
    assert b64, f"no b64_json or data URL in response: {data[0]}"

    img_bytes = base64.b64decode(b64)
    assert img_bytes.startswith(PNG_MAGIC), "response is not a PNG"
    assert len(img_bytes) > 1024, f"image suspiciously small: {len(img_bytes)} bytes"

    print(
        f"\n  {pipeline['alias']:<14} {backend:<8} "
        f"{len(img_bytes)/1024:>6.1f}KB  {elapsed:>5.1f}s"
    )
