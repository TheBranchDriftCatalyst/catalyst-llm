# Catalyst LLM — DEV (local k3d cluster + native Ollama)
#
# Run with:
#   tilt up
#
# Bootstraps the k3d cluster if absent, applies the k8s/local overlay,
# and runs Ollama natively on the Mac (Metal GPU). LiteLLM stays remote
# at http://litellm.talos00.
#
# Prod / ops view: `tilt up -f Tiltfile.prod` (see Tiltfile.prod).

load('ext://uibutton', 'cmd_button')
load('./tilt/common.tiltfile',
    'setup_ollama_buttons',
    'add_open_browser_button',
    'print_dev_banner',
    'print_dev_quickstart',
)

# Restrict apply to the k3d dev cluster.
allow_k8s_contexts('k3d-catalyst-llm')

print_dev_banner()

# ============================================
# k3d bootstrap — idempotent, runs before anything else.
# ============================================
local_resource(
    name='k3d-cluster',
    labels=['cluster'],
    cmd='./scripts/k3d-up.sh',
    auto_init=True,
    allow_parallel=False,
)

# ============================================
# Native Ollama (Metal GPU; stays out of the cluster on purpose).
# UIs in the cluster reach this via the ExternalName Service in
# k8s/local/ollama-externalname.yaml → host.k3d.internal:11434.
# ============================================
local_resource(
    name='ollama',
    labels=['llm'],
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
# Cluster manifests (k8s/local overlay).
# ============================================
k8s_yaml(kustomize('./k8s/local'))

k8s_resource(
    'open-webui',
    labels=['ui'],
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
    labels=['ui'],
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
    labels=['tools'],
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
    labels=['tools', 'sdk'],
    port_forwards=['7077:7077'],
    resource_deps=['k3d-cluster', 'searxng'],
    links=[
        link('http://localhost:7077/healthz', 'Health'),
        link('http://localhost:7077/v1/tools', 'Registered Tools'),
        link('http://localhost:7077/docs', 'OpenAPI Docs'),
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

# Single source of truth for the LiteLLM master key:
# k8s/local/litellm-secrets.env (gitignored, format `master-key=sk-...`).
# kustomize's secretGenerator turns this into the in-cluster
# `litellm-secrets` Secret AND the Tiltfile reads the same value to
# inject VITE_LITELLM_KEY into the playground's vite process — so
# users don't need direnv loaded for the playground to authenticate.
SECRETS_ENV = './k8s/local/litellm-secrets.env'
LITELLM_KEY = ''
if os.path.exists(SECRETS_ENV):
    for line in str(read_file(SECRETS_ENV)).splitlines():
        line = line.strip()
        if line.startswith('master-key='):
            LITELLM_KEY = line.split('=', 1)[1].strip()
            break
if not LITELLM_KEY:
    print('')
    print('!!  k8s/local/litellm-secrets.env missing or has no master-key.')
    print('!!  Playground will boot but /v1/models will 401.')
    print('!!  Fix: cp k8s/local/litellm-secrets.env.example')
    print('!!        k8s/local/litellm-secrets.env')
    print('!!     then fill in the key (see .envrc or 1Password).')
    print('')

local_resource(
    name='sdk-build',
    labels=['sdk'],
    cmd='yarn --cwd ' + SDK_DIR + ' build',
    serve_cmd='yarn --cwd ' + SDK_DIR + ' build:watch',
    deps=[SDK_DIR + '/src'],
    ignore=[SDK_DIR + '/dist'],
)

local_resource(
    name='playground',
    labels=['ui', 'sdk'],
    serve_cmd=(
        'VITE_LITELLM_URL=' + LITELLM_URL + ' ' +
        'VITE_LITELLM_KEY=' + LITELLM_KEY + ' ' +
        'yarn --cwd ' + PLAYGROUND_DIR + ' dev --port 5174 --host'
    ),
    deps=[PLAYGROUND_DIR + '/src'],
    resource_deps=['sdk-build', 'tool-host'],
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

print_dev_quickstart()
