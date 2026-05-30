# Testing

Single-command unified test report across every package, plus how the
per-package test contract fits together.

## TL;DR

```bash
task test:report     # run all unit suites + render docs/reports/index.html
open docs/reports/index.html
```

Or from Tilt: click the **`test:run`** resource (label group `test`) →
click **`test:serve`** → open the linked URL.

## The test contract

Every buildable package exposes the same four verbs. Root aggregators
fan out via `deps:`, so adding a verb everywhere = one new dep entry.

| Verb | Scope | Speed | Services needed |
|---|---|---|---|
| `test:lint` | typecheck + ruff/tsc | fast | none |
| `test:unit` | pure unit tests, no network | fast | none |
| `test:smoke` | unit + local-service health probes | medium | local services up |
| `test:full` | everything (model sweeps, integration) | slow (~20min) | full stack |

Run from any package dir (e.g. `cd packages/catalyst-langgraph && task test:unit`),
or fan out from repo root (`task test:unit` runs all packages in parallel).

### Per-package runners

| Package | Runner | How it's invoked |
|---|---|---|
| `packages/catalyst-langgraph` | pytest | `uv run --with 'pytest>=7.0' ... pytest tests/ -m unit` |
| `packages/tool-host`          | pytest | `uv run --with 'pytest>=8.0' ... pytest tests/ -m unit` |
| `packages/catalyst-llm-sdk`   | vitest | `yarn test` (or `yarn test:junit` for XML output) |
| `packages/mac-node`           | pytest collect-only | `uv run --project tests/python pytest --collect-only -q` |

## Unified report (`task test:report`)

```
docs/reports/
├── junit/
│   ├── catalyst-langgraph.xml   # pytest --junitxml (full suite)
│   ├── tool-host.xml            # pytest --junitxml (full suite)
│   └── catalyst-llm-sdk.xml     # vitest --reporter=junit
└── index.html                   # xunit-viewer merge of junit/*.xml
```

Each package writes its raw junit XML to its own `.reports/junit.xml`
(gitignored). The root `test:report` target copies those into
`docs/reports/junit/` and runs `npx xunit-viewer` to merge them into a single
filterable HTML page (~2 MB, fully self-contained — no external assets).

### Env-aware integration tier

`test:report` does NOT use the `-m unit` filter. The full suite is
collected; integration tests with `@pytest.mark.skipif(not LITELLM_OK)`
either run (when env is wired) or self-skip (when it isn't). Skipped
tests show as orange rows in xunit-viewer — visible, not hidden.

**Env loading:**

```
.env                 (dotenv format, gitignored)  ─┐
                                                   │  via direnv +
                                                   │  .envrc
                                                   ▼
.envrc               (direnv hook, committed)    ──┐
  dotenv_if_exists .env                            │ exports to shell
  LITELLM_BASE_URL = http://litellm.talos00        │
  TOOL_HOST_URL    = http://localhost:7077         ▼
                                              shell env
                                                   │ inherited
                                                   ▼
                                              task test:report
                                              pytest, curl, SDK smoke
```

To set up:

1. `cp .env.example .env`
2. Fill in `LITELLM_API_KEY` (same value as `master-key=` in
   `k8s/local/litellm-secrets.env` — they're the same secret, different
   files for k8s vs shell consumption)
3. `direnv allow` (one-time) OR `source .envrc` each new shell

The Taskfile inherits whatever's in your shell. Run output banner:

```text
✓ LITELLM_API_KEY set — integration tier will run against http://litellm.talos00
# or
ℹ LITELLM_API_KEY not set — integration tests will skip (source .envrc or direnv allow)
```

### What the HTML report shows

- Pass / fail / skip / xfail counts per package
- Expandable per-test traceback on failures
- Filter by suite, status, name
- Test duration timing

### Adding a new package to the unified report

1. Add a `test:junit` target (pytest packages) that runs the full suite
   without the `-m unit` filter, emitting junit XML:
   ```yaml
   test:junit:
     desc: "All tests with junit XML; integration tier auto-runs when env vars are set"
     cmds:
       - mkdir -p .reports
       - uv run ... pytest tests/ --junitxml=.reports/junit.xml -o junit_suite_name=<pkg-name>
   ```
   For vitest packages, `test:unit` already runs everything; the
   `test:junit` script in `package.json` adds `--reporter=junit
   --outputFile=.reports/junit.xml`.

2. Add the package's `test:junit` to root `Taskfile.yaml` → `test:report`:
   ```yaml
   - task: <pkg>:test:junit
   - cp packages/<pkg>/.reports/junit.xml docs/reports/junit/<pkg>.xml || true
   ```

3. Keep `test:unit` (with `-m unit`) so the fast tier contract still
   holds for `task test:unit` (no report, no integration).

## Tilt integration

Three resources under the `test` label group (manual trigger — they
do NOT run on file save):

| Resource | What it does |
|---|---|
| `test:run` | Runs `task test:report` end-to-end (test + collect + render). |
| `test:render` | Re-renders `docs/reports/index.html` from existing junit XMLs without re-running tests. Watches `docs/reports/junit/`. |
| `test:serve` | `python3 -m http.server 5180 --directory docs/reports`. Link in Tilt UI opens `http://localhost:5180/index.html`. |

Typical flow:
1. Click `test:run` once. Watch the log pane for failures.
2. Click `test:serve` once. Click the link.
3. On rerun: click `test:run` again. `test:serve` keeps the page live.

## What's NOT here yet

These are deliberate Stage-2 deferrals:

- **Coverage HTML** — `pytest-cov` is already a dep; just needs
  `--cov-report=html:.reports/coverage --cov-report=xml:.reports/coverage.xml`
  on the pytest invocations and a coverage tile on the index page.
- **mac-node real tests** — currently only a `pytest --collect-only`
  import gate. Will join the matrix when actual unit tests land.
- **Playwright e2e** — see Stage 2 below.
- **GitHub Actions integration** — junit XMLs already work; can be
  uploaded via `actions/upload-artifact` and rendered as a check via
  `dorny/test-reporter` whenever CI gets wired.

## Stage 2 — Playwright e2e (planned)

Playwright supports junit XML natively, so it slots into
`docs/reports/junit/playwright.xml` with no special handling. It also has
a first-class HTML reporter with trace viewer + video + screenshots
that renders to `docs/reports/playwright-html/` for click-through deep dives.

Planned wiring:

- `packages/catalyst-llm-sdk/playwright.config.ts`
- `tests/e2e/*.spec.ts` covering:
  1. Chat golden path — send message → streamed response
  2. Tools toggle — enable `research`, send query, assert tool-call card
  3. Engine tab — assert agent topology renders (`main` + `research`)
  4. Error handling — bad LiteLLM creds → inline error event in bubble
- New Tilt resource `test:e2e` with `resource_deps=['playground']` so it
  blocks until the UI is reachable, manual trigger only

Tradeoff: chromium binary is a one-time ~150MB download per machine,
and e2e specs run ~3-10s each. Keep manual-trigger only — don't run on
every file save.

## File locations

| Path | What |
|---|---|
| `Taskfile.yaml` (root) | `test:report` target |
| `Tiltfile` | The three `test:*` `local_resource` blocks |
| `packages/*/Taskfile.yaml` | Per-package `test:unit` with junit XML emission |
| `packages/catalyst-llm-sdk/package.json` | `test:junit` script (vitest with junit reporter) |
| `.gitignore` | `docs/reports/` + `.reports/` excluded |
