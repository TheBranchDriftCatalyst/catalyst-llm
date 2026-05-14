# catalyst-contracts-mcp

MCP server (Model Context Protocol) enforcing the extraction-domain
contracts that the knowledge graph relies on. Acts as a trust boundary
between non-deterministic LLM outputs and KG persistence.

## What this is

A standalone MCP service. It imports the actual validators from
`catalyst-exgraph` (`catalyst_exgraph.validators.*`) and exposes them
as 7 MCP tools that any LLM client (Claude Code, third-party LLMs,
exgraph pipelines themselves) can call over the MCP protocol.

Owns a JSONL append-only audit trail with deterministic hashing so
validation outcomes are auditable.

## What this is NOT

- Not the validators themselves — those live in `catalyst-exgraph`
  alongside the models they validate. This package is the *service
  wrapper*.
- Not required for in-process validation. exgraph pipelines call
  `from catalyst_exgraph.validators import ...` directly. This MCP
  server is for OUTSIDE consumers (Claude Code, third-party LLMs).

## Run

```bash
pip install -e packages/catalyst-contracts-mcp
python -m catalyst_contracts_mcp.server
```

Or via the console script:

```bash
catalyst-contracts-mcp
```

stdio mode — designed to be spawned by an MCP client (Claude Code's
`.mcp.json`, etc.).

## Tilt

Not in the dev Tilt rail by default (commit 12 in the consolidation
manifest adds it as opt-in). Most dev work uses exgraph's in-process
validation; the MCP server is for cross-process scenarios.
