# Lightweight tool-host image. Pass 2 will swap to a Playwright base
# image (mcr.microsoft.com/playwright:v1.50-jammy or similar) so we
# can ship Chromium for browse_page. For now (just web_search →
# SearXNG) plain python:3.12-slim is plenty.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TOOL_HOST_PORT=7077 \
    TOOL_HOST_HOST=0.0.0.0

WORKDIR /app

# Install the package + runtime deps. We use a wheel-built install
# rather than `pip install -e .` so the image is self-contained and
# doesn't need a writable /app at runtime.
COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

EXPOSE 7077

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD python -c "import urllib.request, sys; \
    sys.exit(0 if urllib.request.urlopen('http://localhost:7077/healthz', timeout=3).status == 200 else 1)"

CMD ["tool-host"]
