"""Shared pytest config for mac-node + LiteLLM model tests.

Backends
--------
* ``mac``: direct Ollama at the mac node (``192.168.1.33:11434``), Ollama-native
  ``/api/{generate,embeddings}``. Models referenced by their raw Ollama tag
  (e.g. ``gemma4:26b``).
* ``litellm``: the LiteLLM proxy (default ``http://localhost:4000``), exposing
  every model under an OpenAI-compatible ``/v1/{chat/completions,embeddings}``
  surface. Mac-node models are addressed as ``mac/<alias>``.

Tests are parametrized over (model × backend × capability). The capability
list is derived from each model's ``tags`` in ``packages/mac-node/models.yaml``.
"""
from __future__ import annotations

import base64
import contextlib
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator

import httpx
import pytest
import yaml


_hb_log = logging.getLogger("mac_node.tests.heartbeat")


@contextlib.contextmanager
def heartbeat(label: str, *, interval: float = 30.0) -> Iterator[None]:
    """Sync heartbeat: emit "still running (Ns elapsed)" every interval.

    Wraps long blocking httpx calls (chat-timeout default 240s, prewarm up
    to 480s) so the pytest log shows the call is alive, not wedged. Output
    goes through the standard logging tree so ``pytest -o log_cli=true``
    surfaces it live.
    """
    start = time.monotonic()
    stop = threading.Event()

    def _beat() -> None:
        while not stop.wait(interval):
            _hb_log.info("⋯ %s: still running (%.0fs elapsed)", label, time.monotonic() - start)

    _hb_log.info("→ %s: started", label)
    t = threading.Thread(target=_beat, name=f"heartbeat[{label}]", daemon=True)
    t.start()
    try:
        yield
    except BaseException as exc:
        _hb_log.warning("✗ %s: failed after %.1fs: %s", label, time.monotonic() - start, exc)
        raise
    else:
        _hb_log.info("✓ %s: finished after %.1fs", label, time.monotonic() - start)
    finally:
        stop.set()
        t.join(timeout=1.0)


# tests/python/conftest.py -> tests/ -> mac-node/
MAC_NODE_DIR = Path(__file__).resolve().parent.parent.parent
MODELS_YAML = MAC_NODE_DIR / "models.yaml"
FIXTURE_IMAGE = MAC_NODE_DIR / "tests" / "fixtures" / "test-vision.png"


# --- CLI options --------------------------------------------------------


def pytest_addoption(parser: pytest.Parser) -> None:
    g = parser.getgroup("backends")
    g.addoption(
        "--backend",
        default=os.getenv("BACKEND", "mac"),
        choices=("mac", "litellm", "both"),
        help="Which backend(s) to target. Default: mac.",
    )
    # Default to None and let the mac_client fixture probe localhost first
    # (we're often *on* the mac node, where the LAN IP isn't bindable);
    # fall back to the documented LAN IP if localhost is unreachable.
    g.addoption(
        "--mac-host",
        default=os.getenv("MAC_HOST"),
        help="Mac-node host. Default: probe localhost, fall back to 192.168.1.33.",
    )
    g.addoption(
        "--mac-port",
        type=int,
        default=int(os.getenv("MAC_PORT", "11434")),
        help="Mac-node Ollama port. Default: 11434",
    )
    g.addoption(
        "--litellm-base",
        default=os.getenv("LITELLM_BASE", "http://localhost:4000"),
        help="LiteLLM proxy base URL. Default: http://localhost:4000",
    )
    g.addoption(
        "--litellm-key",
        default=os.getenv("LITELLM_API_KEY", ""),
        help="LiteLLM master/virtual key. Default: $LITELLM_API_KEY",
    )
    g.addoption(
        "--quick",
        action="store_true",
        help="Pick one model per (backend, capability) for fast smoke runs.",
    )
    g.addoption(
        "--dump-dir",
        default=os.getenv("DUMP_DIR"),
        help="Write per-test response.txt + meta.json under this directory. "
             "Layout: <dump>/<capability>/<alias>-<backend>/{response.txt,meta.json}.",
    )
    g.addoption(
        "--chat-timeout",
        type=float,
        default=float(os.getenv("CHAT_TIMEOUT", "240")),
        help="Per-chat-request timeout in seconds. Default: 240 (big models need "
             "load + inference budget — behemoth-x cold-loads in ~60s).",
    )
    # Off by default: isolation prewarms each model before the timed test
    # and unloads it after, which adds 60–90s per heavy model. Worth it
    # for reliable back-to-back runs (see beads llm-9ao) but slows down
    # smoke runs where you just want to ping models. Opt in with
    # --isolate-ollama or ISOLATE=1.
    g.addoption(
        "--isolate-ollama",
        action="store_true",
        default=os.getenv("ISOLATE") == "1",
        help="Unload+prewarm around each mac-backend test to keep cold-load "
             "out of the per-request timeout. Default: off.",
    )


# --- Backend abstractions -----------------------------------------------


@dataclass
class CallResult:
    text: str = ""
    embedding: list[float] | None = None
    eval_count: int = 0
    eval_duration_s: float = 0.0
    latency_s: float = 0.0
    raw: dict[str, Any] | None = None

    @property
    def tok_per_s(self) -> float:
        return self.eval_count / self.eval_duration_s if self.eval_duration_s else 0.0


class _BaseClient:
    name: str = "base"

    def list_models(self) -> set[str]:
        raise NotImplementedError

    def chat(self, model: str, prompt: str, *, timeout: float) -> CallResult:
        raise NotImplementedError

    def vision(self, model: str, prompt: str, image_b64: str, *, timeout: float) -> CallResult:
        raise NotImplementedError

    def embed(self, model: str, text: str, *, timeout: float) -> CallResult:
        raise NotImplementedError


class MacClient(_BaseClient):
    """Direct Ollama at the mac node — uses /api/{generate,embeddings}."""

    name = "mac"

    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def list_models(self) -> set[str]:
        try:
            r = httpx.get(f"{self.base}/api/tags", timeout=5)
            r.raise_for_status()
            return {m["name"] for m in r.json().get("models", [])}
        except httpx.HTTPError:
            return set()

    def chat(self, model: str, prompt: str, *, timeout: float) -> CallResult:
        return self._generate(model, prompt, images=None, timeout=timeout)

    def vision(self, model: str, prompt: str, image_b64: str, *, timeout: float) -> CallResult:
        return self._generate(model, prompt, images=[image_b64], timeout=timeout)

    def embed(self, model: str, text: str, *, timeout: float) -> CallResult:
        t0 = time.time()
        with heartbeat(f"mac.embed {model}"):
            r = httpx.post(
                f"{self.base}/api/embeddings",
                json={"model": model, "prompt": text},
                timeout=timeout,
            )
        r.raise_for_status()
        d = r.json()
        return CallResult(
            embedding=d.get("embedding"),
            latency_s=time.time() - t0,
            raw=d,
        )

    def _generate(self, model: str, prompt: str, *, images: list[str] | None, timeout: float) -> CallResult:
        payload: dict[str, Any] = {"model": model, "prompt": prompt, "stream": False}
        if images:
            payload["images"] = images
        t0 = time.time()
        kind = "vision" if images else "chat"
        with heartbeat(f"mac.{kind} {model}"):
            r = httpx.post(f"{self.base}/api/generate", json=payload, timeout=timeout)
        r.raise_for_status()
        d = r.json()
        return CallResult(
            text=d.get("response", ""),
            eval_count=d.get("eval_count", 0) or 0,
            eval_duration_s=(d.get("eval_duration", 0) or 0) / 1e9,
            latency_s=time.time() - t0,
            raw=d,
        )


class LiteLLMClient(_BaseClient):
    """LiteLLM proxy — OpenAI-compatible /v1/{chat/completions,embeddings}."""

    name = "litellm"

    def __init__(self, base: str, api_key: str = "") -> None:
        self.base = base.rstrip("/")
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["Authorization"] = f"Bearer {api_key}"

    def list_models(self) -> set[str]:
        try:
            r = httpx.get(f"{self.base}/v1/models", headers=self.headers, timeout=5)
            r.raise_for_status()
            return {m["id"] for m in r.json().get("data", [])}
        except httpx.HTTPError:
            return set()

    def chat(self, model: str, prompt: str, *, timeout: float) -> CallResult:
        return self._chat_completion(model, [{"role": "user", "content": prompt}], timeout=timeout)

    def vision(self, model: str, prompt: str, image_b64: str, *, timeout: float) -> CallResult:
        msg = [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
            ],
        }]
        return self._chat_completion(model, msg, timeout=timeout)

    def embed(self, model: str, text: str, *, timeout: float) -> CallResult:
        t0 = time.time()
        with heartbeat(f"litellm.embed {model}"):
            r = httpx.post(
                f"{self.base}/v1/embeddings",
                headers=self.headers,
                json={"model": model, "input": text},
                timeout=timeout,
            )
        r.raise_for_status()
        d = r.json()
        emb = (d.get("data") or [{}])[0].get("embedding")
        return CallResult(embedding=emb, latency_s=time.time() - t0, raw=d)

    def _chat_completion(self, model: str, messages: list[dict[str, Any]], *, timeout: float) -> CallResult:
        t0 = time.time()
        with heartbeat(f"litellm.chat {model}"):
            r = httpx.post(
                f"{self.base}/v1/chat/completions",
                headers=self.headers,
                json={"model": model, "messages": messages, "stream": False},
                timeout=timeout,
            )
        r.raise_for_status()
        d = r.json()
        text = (d.get("choices") or [{}])[0].get("message", {}).get("content", "")
        usage = d.get("usage") or {}
        return CallResult(
            text=text or "",
            eval_count=usage.get("completion_tokens", 0) or 0,
            latency_s=time.time() - t0,
            raw=d,
        )


# --- Fixtures -----------------------------------------------------------


@pytest.fixture(scope="session")
def models_registry() -> dict[str, Any]:
    return yaml.safe_load(MODELS_YAML.read_text())


def _resolve_mac_host(explicit: str | None, _port: int = 11434) -> str:
    """Pick a reachable mac-node host (any service on it shares this hostname).

    Explicit --mac-host / MAC_HOST wins unconditionally. Otherwise probe
    Ollama's /api/tags (always on :11434 — every mac-node service co-locates
    with it, so reachability there is a proxy for the rest). Try localhost
    first (we're frequently running tests *on* the mac node, where the LAN
    IP often isn't bindable), then fall back to 192.168.1.33.
    """
    if explicit:
        return explicit
    for candidate in ("localhost", "192.168.1.33"):
        try:
            r = httpx.get(f"http://{candidate}:11434/api/tags", timeout=2)
            if r.status_code == 200:
                return candidate
        except httpx.HTTPError:
            continue
    return "192.168.1.33"  # last-resort default for clearer error in tests


@pytest.fixture(scope="session")
def mac_client(pytestconfig: pytest.Config) -> MacClient:
    port = pytestconfig.getoption("--mac-port")
    host = _resolve_mac_host(pytestconfig.getoption("--mac-host"), port)
    return MacClient(f"http://{host}:{port}")


@pytest.fixture(scope="session")
def litellm_client(pytestconfig: pytest.Config) -> LiteLLMClient:
    return LiteLLMClient(
        pytestconfig.getoption("--litellm-base"),
        pytestconfig.getoption("--litellm-key"),
    )


@pytest.fixture(scope="session")
def mac_models(mac_client: MacClient) -> set[str]:
    return mac_client.list_models()


@pytest.fixture(scope="session")
def litellm_models(litellm_client: LiteLLMClient) -> set[str]:
    return litellm_client.list_models()


@pytest.fixture(scope="session")
def fixture_image_b64() -> str:
    return base64.b64encode(FIXTURE_IMAGE.read_bytes()).decode()


# --- Model lifecycle isolation -----------------------------------------
#
# When pytest runs models back-to-back, ollama's default keep_alive=5m +
# MAX_LOADED_MODELS=1 bundles "evict previous + load this" into the same
# httpx.post() that's measuring the inference. Heavy back-to-back swaps
# (e.g. behemoth-x 73GB → qwen3-moe-uncensored 25GB) exceed the per-request
# chat-timeout and surface as ReadTimeout failures that look like model
# bugs but are really test-infra bugs (see beads llm-9ao).
#
# This autouse fixture wraps each mac-backend test with:
#   pre  — `keep_alive: 0` on every model currently in /api/ps, then a
#          warmup call to load the target model (empty prompt /api/generate
#          or a 1-char /api/embeddings depending on capability)
#   post — `keep_alive: 0` on the target so the next test starts with
#          empty VRAM
#
# Per Ollama docs (verified 2026-05-10): an empty-prompt /api/generate
# with keep_alive:0 returns `done_reason: "unload"`; empty prompt without
# keep_alive preloads. Same pattern works on /api/chat and /api/embeddings.


def _ollama_currently_loaded(base: str) -> list[str]:
    """Tags Ollama reports as resident in /api/ps. Empty on any error."""
    try:
        r = httpx.get(f"{base}/api/ps", timeout=5)
        return [m["name"] for m in (r.json() or {}).get("models", [])]
    except (httpx.HTTPError, ValueError, KeyError):
        return []


def _ollama_unload(base: str, tag: str, timeout: float = 15.0) -> None:
    """Force-evict `tag` from VRAM. Best-effort: silent on failure."""
    try:
        with heartbeat(f"ollama.unload {tag}", interval=10.0):
            httpx.post(
                f"{base}/api/generate",
                json={"model": tag, "keep_alive": 0},
                timeout=timeout,
            )
    except httpx.HTTPError:
        pass


def _ollama_prewarm(base: str, tag: str, *, embedding: bool, timeout: float) -> None:
    """Load `tag` into VRAM without consuming the test's inference budget.

    For chat/vision models we use `/api/generate` with an empty prompt —
    ollama documents this as the canonical preload call. For embedding
    models `/api/generate` rejects the request, so we hit `/api/embeddings`
    with a minimal payload instead."""
    try:
        with heartbeat(f"ollama.prewarm {tag}"):
            if embedding:
                httpx.post(
                    f"{base}/api/embeddings",
                    json={"model": tag, "prompt": "."},
                    timeout=timeout,
                )
            else:
                httpx.post(
                    f"{base}/api/generate",
                    json={"model": tag, "prompt": "", "keep_alive": "5m"},
                    timeout=timeout,
                )
    except httpx.HTTPError:
        # Don't fail the test from prewarm — let the real test surface
        # whatever's actually wrong.
        pass


@pytest.fixture(autouse=True)
def _isolate_ollama_model(request: pytest.FixtureRequest, pytestconfig: pytest.Config):
    """Per-test: unload VRAM, preload the target, then unload again on teardown.

    Opt-in via `--isolate-ollama` / `ISOLATE=1` (default off). Even when
    enabled, only engages for mac-backend tests parametrized over
    `model_entry` (test_chat / test_vision / test_embedding). No-op for
    litellm tests (proxy manages its own pool), image_gen
    (pipeline-not-model), and any test without these fixtures.
    """
    if not pytestconfig.getoption("--isolate-ollama"):
        yield
        return
    fixturenames = set(request.fixturenames)
    if "backend" not in fixturenames or "model_entry" not in fixturenames:
        yield
        return
    backend = request.getfixturevalue("backend")
    if backend != "mac":
        yield
        return
    entry = request.getfixturevalue("model_entry")
    tag = entry["name"]
    is_embedding = "embedding" in (entry.get("tags") or [])

    port = pytestconfig.getoption("--mac-port")
    host = _resolve_mac_host(pytestconfig.getoption("--mac-host"), port)
    base = f"http://{host}:{port}"

    # Generous prewarm budget — 70B+ from cold disk can take 60-90s. The
    # actual test's timeout (--chat-timeout default 240s) then only needs
    # to cover prompt eval + token generation.
    prewarm_timeout = float(pytestconfig.getoption("--chat-timeout")) * 2

    # 1) Drop anything in VRAM so we start clean.
    for resident in _ollama_currently_loaded(base):
        if resident != tag:
            _ollama_unload(base, resident)

    # 2) Preload the target so the timed test doesn't pay for it.
    _ollama_prewarm(base, tag, embedding=is_embedding, timeout=prewarm_timeout)

    yield

    # 3) Clean up so the next test's prewarm has full memory to play with.
    _ollama_unload(base, tag)


@pytest.fixture(scope="session")
def dump_dir(pytestconfig: pytest.Config) -> Path | None:
    """Resolve --dump-dir to an absolute Path (creating it), or None."""
    raw = pytestconfig.getoption("--dump-dir")
    if not raw:
        return None
    d = Path(raw).expanduser().resolve()
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_dump(
    dump_dir: Path | None,
    *,
    capability: str,
    alias: str,
    backend: str,
    backend_name: str,
    prompt: str,
    result: "CallResult",
    extra: dict[str, Any] | None = None,
) -> None:
    """Write one test's response + metadata under <dump_dir>/<capability>/<alias>-<backend>/.

    No-op when dump_dir is None. Used by test_chat / test_vision / test_embedding
    to capture per-model outputs for regression-baselining a quant bump.
    """
    if dump_dir is None:
        return
    import json
    out = dump_dir / capability / f"{alias}-{backend}"
    out.mkdir(parents=True, exist_ok=True)
    if result.text:
        (out / "response.txt").write_text(result.text)
    elif result.embedding is not None:
        # Embeddings: stash the first 16 dims + norm; full vectors are noisy.
        import math
        preview = result.embedding[:16]
        norm = math.sqrt(sum(float(x) * float(x) for x in result.embedding))
        (out / "response.txt").write_text(
            f"dim={len(result.embedding)} norm={norm:.4f} preview={preview!r}\n"
        )
    meta = {
        "alias": alias,
        "backend": backend,
        "backend_model_name": backend_name,
        "capability": capability,
        "prompt": prompt,
        "eval_count": result.eval_count,
        "eval_duration_s": result.eval_duration_s,
        "latency_s": result.latency_s,
        "tok_per_s": result.tok_per_s,
    }
    if result.embedding is not None:
        meta["embedding_dim"] = len(result.embedding)
    if extra:
        meta.update(extra)
    (out / "meta.json").write_text(json.dumps(meta, indent=2, default=str))


def get_client(request: pytest.FixtureRequest, backend: str) -> _BaseClient:
    return request.getfixturevalue("mac_client" if backend == "mac" else "litellm_client")


def model_name_for(backend: str, entry: dict[str, Any]) -> str:
    """Backend-specific name for a models.yaml entry."""
    return entry["name"] if backend == "mac" else f"mac/{entry['alias']}"


def is_pulled(backend: str, entry: dict[str, Any], mac_models: set[str], litellm_models: set[str]) -> bool:
    name = model_name_for(backend, entry)
    if backend == "mac":
        if name in mac_models:
            return True
        # Bare 'foo' matches 'foo:latest'
        if ":" not in name and f"{name}:latest" in mac_models:
            return True
        return False
    return name in litellm_models


def selected_backends(config: pytest.Config) -> list[str]:
    choice = config.getoption("--backend")
    return ["mac", "litellm"] if choice == "both" else [choice]


def models_with_tag(registry: dict[str, Any], tag: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in registry.get("ollama", {}).get("models", []):
        target = m.get("target", ["mac", "runpod"])
        if "mac" not in target:
            continue
        if tag in (m.get("tags") or []):
            out.append(m)
    return out


# --- Parametrize generation --------------------------------------------


def _params_for(metafunc: pytest.Metafunc, tag: str) -> None:
    """Parametrize a test function over (model, backend) for the given tag."""
    if "model_entry" not in metafunc.fixturenames or "backend" not in metafunc.fixturenames:
        return
    registry = yaml.safe_load(MODELS_YAML.read_text())
    models = models_with_tag(registry, tag)
    backends = selected_backends(metafunc.config)
    quick = metafunc.config.getoption("--quick")
    if quick:
        # First model per backend.
        models = models[:1]
    pairs: list[tuple[dict[str, Any], str]] = [(m, b) for m in models for b in backends]
    if not pairs:
        pytest.skip(f"no mac-targeted models tagged {tag!r}")
        return
    ids = [f"{m['alias']}-{b}" for m, b in pairs]
    metafunc.parametrize(("model_entry", "backend"), pairs, ids=ids)


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    fn = metafunc.function.__name__
    if fn == "test_chat":
        _params_for(metafunc, "chat")
    elif fn == "test_vision":
        _params_for(metafunc, "vision")
    elif fn == "test_embedding":
        _params_for(metafunc, "embedding")


def skip_if_unavailable(
    backend: str,
    entry: dict[str, Any],
    mac_models: set[str],
    litellm_models: set[str],
) -> None:
    if backend == "mac" and not mac_models:
        pytest.skip("mac backend unreachable")
    if backend == "litellm" and not litellm_models:
        pytest.skip("litellm backend unreachable")
    if not is_pulled(backend, entry, mac_models, litellm_models):
        pytest.skip(f"{model_name_for(backend, entry)} not registered on {backend}")


__all__: Iterable[str] = (
    "MacClient",
    "LiteLLMClient",
    "CallResult",
    "get_client",
    "model_name_for",
    "skip_if_unavailable",
    "write_dump",
)
