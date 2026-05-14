# catalyst-langgraph — LangGraph agent service.
#
# Built locally by Tilt's docker_build('catalyst-llm/catalyst-langgraph', …)
# with context=./packages so this Dockerfile can pull in sibling
# path-source deps (catalyst-exgraph, catalyst-contracts-core).
# Injected into the k3d dev cluster.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=7078

WORKDIR /app

# Layout under /app mirrors packages/ — the catalyst-langgraph
# pyproject.toml declares catalyst-exgraph + catalyst-contracts-core
# as path-source deps (../catalyst-exgraph, ../catalyst-contracts-core),
# so we install everything together with --find-links pointing at
# each sibling package's pyproject root.
COPY catalyst-contracts-core/ /app/catalyst-contracts-core/
COPY catalyst-exgraph/ /app/catalyst-exgraph/
COPY catalyst-langgraph/ /app/catalyst-langgraph/

# Install dependencies in dependency order: leaf -> extraction -> server.
# `--no-deps` on the path installs avoids re-resolving the transitive
# tree; the catalyst-langgraph install at the end picks up everything
# remaining from PyPI.
RUN pip install --no-cache-dir /app/catalyst-contracts-core /app/catalyst-exgraph \
 && pip install --no-cache-dir /app/catalyst-langgraph

WORKDIR /app/catalyst-langgraph

EXPOSE 7078

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD python -c "import urllib.request, sys; \
    sys.exit(0 if urllib.request.urlopen('http://localhost:7078/healthz', timeout=3).status == 200 else 1)"

CMD ["python", "-m", "catalyst_langgraph.server"]
