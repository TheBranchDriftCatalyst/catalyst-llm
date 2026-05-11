# catalyst-langgraph — LangGraph agent service.
#
# Built locally by Tilt's docker_build('catalyst-llm/catalyst-langgraph', …)
# and injected into the k3d dev cluster. Promotion to talos00 is tracked
# as a follow-up beads issue (registry push required).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=7078

WORKDIR /app

# Self-contained install: copy only what setuptools needs to build the
# package, then install. Avoids needing a writable /app at runtime.
COPY pyproject.toml README.md ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

EXPOSE 7078

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD python -c "import urllib.request, sys; \
    sys.exit(0 if urllib.request.urlopen('http://localhost:7078/healthz', timeout=3).status == 200 else 1)"

CMD ["python", "-m", "catalyst_langgraph.server"]
