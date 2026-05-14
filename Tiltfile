# Catalyst LLM — DEV (shared k3d cluster + native Ollama)
#
# Run with:
#   tilt up
#
# Uses the shared catalyst-dev k3d cluster (brought up by
# infra/k3d/cluster.Tiltfile), applies the k8s/local overlay into the
# `catalyst-llm` namespace, and runs Ollama natively on the Mac
# (Metal GPU). LiteLLM stays remote at http://litellm.talos00.
#
# Prod / ops view lives in a parallel rail:
#   cd ~/catalyst-devspace/tilt-ops && tilt up      # fleet hub
#   cd ./tilt-ops && tilt up                        # this project only

load('ext://uibutton', 'cmd_button')
load('./tilt/common.tiltfile',
    'setup_ollama_buttons',
    'add_open_browser_button',
    'print_dev_banner',
    'print_dev_quickstart',
)

# ============================================
# Project-aware labels.
#
# When this Tiltfile is the entry point (`tilt up` from this dir), labels
# are kept short (e.g. 'ui'). When it's include()d from the workspace
# aggregator at ../, every label gets prefixed with the project name so
# the Tilt UI groups read like 'catalyst-llm.ui', 'catalyst-llm.tools',
# etc. — making the resource's project of origin obvious at a glance.
# ============================================
PROJECT_NAME = 'catalyst-llm'
_running_standalone = config.main_dir.rstrip('/').endswith('/' + PROJECT_NAME)

def _labels(*base):
    if _running_standalone:
        return list(base)
    # Tilt validates labels with regex
    # `(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?` — slashes are rejected,
    # so we use dots to namespace into the project (e.g. 'catalyst-llm.ui').
    return [PROJECT_NAME + '.' + b for b in base]

# ============================================
# Shared dev cluster (catalyst-dev) — defines `k3d-cluster` resource
# and calls allow_k8s_contexts('k3d-catalyst-dev').
# ============================================
include('../../infra/k3d/cluster.Tiltfile')

print_dev_banner()

# ============================================
# Native Ollama (Metal GPU; stays out of the cluster on purpose).
# UIs in the cluster reach this via the ExternalName Service in
# k8s/local/ollama-externalname.yaml → host.k3d.internal:11434.
# ============================================
local_resource(
    name='ollama',
    labels=_labels('services'),
    serve_cmd='./scripts/ollama-serve.sh',
    readiness_probe=probe(
        http_get=http_get_action(port=11434, path='/api/tags'),
        initial_delay_secs=3,
        period_secs=5,
    ),
    links=[link('http://localhost:11434', 'Ollama API')],
)

setup_ollama_buttons()

# ============================================
# tool-host — built locally + injected into k3d.
# ============================================
docker_build(
    'catalyst-llm/tool-host',
    context='./packages/tool-host',
    dockerfile='./packages/tool-host/Dockerfile',
)

# ============================================
# catalyst-langgraph — Python LangGraph agent service.
# Owns the agent/tool loop the playground UI consumes via SSE.
#
# Build context covers the whole packages/ tree because the Dockerfile
# COPYs three sibling path-source deps before installing:
#   catalyst-contracts-core/  — leaf types (MentionType, Provenance)
#   catalyst-exgraph/         — extraction pipeline + config schemas
#   catalyst-langgraph/       — FastAPI server + chat runtime
# The `only=[...]` filter keeps the transferred context tight so we
# don't ship every package's node_modules / .venv / dist into the
# daemon. The Dockerfile assumes /app/<package>/ for each.
# ============================================
docker_build(
    'catalyst-llm/catalyst-langgraph',
    context='./packages',
    dockerfile='./packages/catalyst-langgraph/Dockerfile',
    only=[
        'catalyst-contracts-core',
        'catalyst-exgraph',
        'catalyst-langgraph',
    ],
    ignore=[
        '**/__pycache__/',
        '**/.pytest_cache/',
        '**/.venv/',
        '**/*.egg-info/',
    ],
)

# ============================================
# Per-package pytest rail — manual triggers so the operator can verify
# each Python package independently without rebuilding the Docker image.
# Mirrors the existing `test:run` umbrella; these run in-place against
# the dev workspace's editable installs.
# ============================================
def _py_test_resource(name, package_dir, extra_args=''):
    local_resource(
        name='test:py:' + name,
        labels=_labels('test'),
        cmd='cd ' + package_dir + ' && python -m pytest tests/ ' + extra_args,
        deps=[package_dir + '/src', package_dir + '/tests'],
        auto_init=False,
        trigger_mode=TRIGGER_MODE_MANUAL,
    )

_py_test_resource('contracts-core', './packages/catalyst-contracts-core')
_py_test_resource('exgraph', './packages/catalyst-exgraph',
                  '--ignore=tests/test_pack_window_size.py')
_py_test_resource('contracts-mcp', './packages/catalyst-contracts-mcp')
_py_test_resource('langgraph', './packages/catalyst-langgraph',
                  '-k "not test_discovery"')

# ============================================
# Cluster manifests (k8s/local overlay).
# ============================================
k8s_yaml(kustomize('./k8s/local'))

k8s_resource(
    'open-webui',
    labels=_labels('services'),
    port_forwards=['3030:8080'],
    resource_deps=['k3d-cluster', 'ollama'],
    links=[
        link('http://localhost:3030', 'Open WebUI (port-forward)'),
        link('http://openwebui.local.lan', 'Open WebUI (ingress)'),
    ],
)
add_open_browser_button('open-webui', 'http://localhost:3030')

k8s_resource(
    'lobe-chat',
    labels=_labels('services'),
    port_forwards=['3210:3210'],
    resource_deps=['k3d-cluster', 'ollama'],
    links=[
        link('http://localhost:3210', 'LobeChat (port-forward)'),
        link('http://lobechat.local.lan', 'LobeChat (ingress)'),
    ],
)
add_open_browser_button('lobe-chat', 'http://localhost:3210')

k8s_resource(
    'searxng',
    labels=_labels('services'),
    port_forwards=['8888:8080'],
    resource_deps=['k3d-cluster'],
    links=[
        link('http://localhost:8888', 'SearXNG (port-forward)'),
        link('http://searxng.local.lan', 'SearXNG (ingress)'),
    ],
)
add_open_browser_button('searxng', 'http://localhost:8888')

k8s_resource(
    'tool-host',
    labels=_labels('backend'),
    port_forwards=['7077:7077'],
    resource_deps=['k3d-cluster', 'searxng'],
    links=[
        link('http://localhost:7077/healthz', 'Health'),
        link('http://localhost:7077/v1/tools', 'Registered Tools'),
        link('http://localhost:7077/docs', 'OpenAPI Docs'),
    ],
)

k8s_resource(
    'catalyst-langgraph',
    labels=_labels('backend'),
    port_forwards=['7078:7078'],
    resource_deps=['k3d-cluster', 'tool-host'],
    links=[
        link('http://localhost:7078/healthz', 'Health'),
        link('http://localhost:7078/api/models', 'Models'),
        link('http://localhost:7078/api/tools', 'Tools'),
        link('http://localhost:7078/docs', 'OpenAPI Docs'),
    ],
)

# LiteLLM lives only in k8s/talos00 — dev UIs talk to the deployed
# proxy at http://litellm.talos00, set via k8s/local/configmap-patch.yaml.

# ============================================
# SDK build-watch + playground (local Vite, no cluster involvement).
# ============================================
SDK_DIR = './packages/catalyst-llm-sdk'
PLAYGROUND_DIR = SDK_DIR + '/examples/playground'
LITELLM_URL = 'http://litellm.talos00'

# Source the LiteLLM key from k8s/local/litellm-secrets.env (gitignored,
# format `master-key=sk-...`). That file already feeds kustomize's
# secretGenerator for the in-cluster `litellm-secrets` Secret; reading
# it here means the playground authenticates without requiring direnv
# loaded in the user's shell. Same value as $LITELLM_API_KEY when .env
# is wired correctly.
SECRETS_ENV = './k8s/local/litellm-secrets.env'
LITELLM_API_KEY_VALUE = ''
if os.path.exists(SECRETS_ENV):
    for line in str(read_file(SECRETS_ENV)).splitlines():
        line = line.strip()
        if line.startswith('master-key='):
            LITELLM_API_KEY_VALUE = line.split('=', 1)[1].strip()
            break
if not LITELLM_API_KEY_VALUE:
    print('')
    print('!!  k8s/local/litellm-secrets.env missing or has no master-key.')
    print('!!  Playground will boot but /v1/models will 401.')
    print('!!  Fix: cp k8s/local/litellm-secrets.env.example')
    print('!!        k8s/local/litellm-secrets.env')
    print('!!     then fill in the key (see .envrc or 1Password).')
    print('')

local_resource(
    name='sdk-build',
    labels=_labels('build'),
    cmd='yarn --cwd ' + SDK_DIR + ' build',
    serve_cmd='yarn --cwd ' + SDK_DIR + ' build:watch',
    deps=[SDK_DIR + '/src'],
    ignore=[SDK_DIR + '/dist'],
)

local_resource(
    name='playground',
    labels=_labels('frontend'),
    serve_cmd=(
        'VITE_LITELLM_URL=' + LITELLM_URL + ' ' +
        'VITE_LITELLM_KEY=' + LITELLM_API_KEY_VALUE + ' ' +
        'VITE_AGENT_URL=http://localhost:7078 ' +
        'yarn --cwd ' + PLAYGROUND_DIR + ' dev --port 5174 --host'
    ),
    deps=[PLAYGROUND_DIR + '/src'],
    resource_deps=['sdk-build', 'tool-host', 'catalyst-langgraph'],
    readiness_probe=probe(
        http_get=http_get_action(port=5174, path='/'),
        initial_delay_secs=3,
        period_secs=5,
    ),
    links=[
        link('http://localhost:5174', 'Playground'),
        link('http://localhost:5174/stats', 'Stats (DuckDB)'),
        link('http://localhost:5174/prompts', 'Prompt Registry'),
        link('http://localhost:5174/compare', 'Compare'),
    ],
)
add_open_browser_button('playground', 'http://localhost:5174')

# ============================================
# Unified test report rail.
#
#   test:run    — manual trigger, runs every package's test:unit and
#                 collects junit XML into docs/reports/junit/.
#   test:render — re-renders docs/reports/index.html via xunit-viewer when
#                 any junit XML changes.
#   test:serve  — serves docs/reports/ over http://localhost:5180. Click
#                 the link in the Tilt UI to open the unified report.
#
# Manual triggers keep tests from running on every file save.
# ============================================
local_resource(
    name='test:run',
    labels=_labels('test'),
    cmd='task test:report',
    trigger_mode=TRIGGER_MODE_MANUAL,
    auto_init=False,
)

local_resource(
    name='test:render',
    labels=_labels('test'),
    cmd='npx --yes xunit-viewer -r docs/reports/junit -o docs/reports/index.html -t "Catalyst LLM — Test Report"',
    deps=['docs/reports/junit'],
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
)

local_resource(
    name='test:serve',
    labels=_labels('test'),
    serve_cmd='python3 -m http.server 5180 --directory docs/reports',
    readiness_probe=probe(
        http_get=http_get_action(port=5180, path='/'),
        initial_delay_secs=1,
        period_secs=5,
    ),
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    links=[link('http://localhost:5180/index.html', 'Unified test report')],
)

print_dev_quickstart()
