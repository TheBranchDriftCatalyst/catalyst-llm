#!/usr/bin/env bash
# test-ollama.sh [HOST] [--all|--vision] [--dump DIR] [--timeout SEC]
#
# Default        single-model smoke test (chat + embedding)
# --all          iterate every mac-targeted model in models.yaml
# --vision       iterate only vision-tagged models from models.yaml
# --dump DIR     write per-model output (response.txt + meta.json) into DIR
# --timeout SEC  per-request timeout in seconds (default 120)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/_theme.sh"

HOST="localhost"
MODE="smoke"
DUMP_DIR=""
TIMEOUT="120"
FIXTURE="${SCRIPT_DIR}/fixtures/test-vision.png"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)     MODE="all"; shift ;;
    --vision)  MODE="vision"; shift ;;
    --dump)    DUMP_DIR="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    -*)        echo "unknown flag: $1" >&2; exit 2 ;;
    *)         HOST="$1"; shift ;;
  esac
done

PORT="${OLLAMA_PORT:-11434}"
BASE="http://${HOST}:${PORT}"
PASS=0
FAIL=0

[[ -n "$DUMP_DIR" ]] && mkdir -p "$DUMP_DIR"

service_header "Ollama" "${BASE}"

# ─── Connectivity ─────────────────────────────────────────────────
section "Connectivity"
if curl -s "${BASE}" -o /dev/null --max-time 5; then
  pass "Server is reachable"
else
  fail "Server is not reachable"
  abort "Ollama not running" "Start with: task start:ollama"
  exit 1
fi

# ─── API Health ───────────────────────────────────────────────────
section "API"
TAGS=$(curl -s "${BASE}/api/tags" --max-time 10)
if echo "$TAGS" | python3 -c "import sys,json; json.load(sys.stdin)" &>/dev/null; then
  pass "GET /api/tags returns valid JSON"
else
  fail "GET /api/tags failed or invalid JSON"
fi

MODEL_COUNT=$(echo "$TAGS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "0")
if [ "$MODEL_COUNT" -gt 0 ]; then
  pass "Models available: ${MODEL_COUNT}"
else
  fail "No models installed (run: task setup:models)"
fi

# ─── LAN Binding ──────────────────────────────────────────────────
section "Network"
if curl -s "http://0.0.0.0:${PORT}" -o /dev/null --max-time 3 2>/dev/null; then
  pass "Bound to 0.0.0.0 (LAN accessible)"
else
  fail "Not bound to 0.0.0.0 — check OLLAMA_HOST env"
fi

# ─── Inference ────────────────────────────────────────────────────
if [[ "$MODE" == "smoke" ]]; then
  section "Inference (smoke)"
  FIRST_MODEL=$(echo "$TAGS" | python3 -c "
import sys,json
for m in json.load(sys.stdin).get('models',[]):
    if 'embed' not in m['name'].lower():
        print(m['name']); break
" 2>/dev/null)

  if [ -n "$FIRST_MODEL" ]; then
    RESPONSE=$(curl -s "${BASE}/api/generate" --max-time "$TIMEOUT" \
      -d "{\"model\": \"${FIRST_MODEL}\", \"prompt\": \"Reply with exactly: hello test\", \"stream\": false}" 2>/dev/null)

    if echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); assert 'response' in r" &>/dev/null; then
      LINE=$(echo "$RESPONSE" | python3 -c "
import sys,json
r=json.load(sys.stdin)
ec=r.get('eval_count',0); ed=r.get('eval_duration',1)/1e9
print(f\"{ec} tokens in {ed:.2f}s ({ec/ed:.1f} tok/s)\" if ec and ed else 'unknown timing')
" 2>/dev/null)
      pass "Generate with ${FIRST_MODEL} — ${LINE}"
    else
      fail "Generate with ${FIRST_MODEL} failed"
    fi
  else
    skip "No chat models available to test"
  fi

  # ─── Embeddings (smoke) ─────────────────────────────────────────
  section "Embeddings"
  EMBED_MODEL=$(echo "$TAGS" | python3 -c "
import sys,json
for m in json.load(sys.stdin).get('models',[]):
    if 'embed' in m['name'].lower():
        print(m['name']); break
" 2>/dev/null)

  if [ -n "$EMBED_MODEL" ]; then
    EMBED_RESP=$(curl -s "${BASE}/api/embeddings" --max-time 30 \
      -d "{\"model\": \"${EMBED_MODEL}\", \"prompt\": \"test embedding vector\"}" 2>/dev/null)
    DIM=$(echo "$EMBED_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['embedding']))" 2>/dev/null)
    if [ -n "$DIM" ]; then
      pass "Embedding with ${EMBED_MODEL} — dim=${DIM}"
    else
      fail "Embedding with ${EMBED_MODEL} failed"
    fi
  else
    skip "No embedding model installed"
  fi
fi

# ─── models.yaml-driven runs (--all / --vision) ───────────────────
if [[ "$MODE" == "all" || "$MODE" == "vision" ]]; then
  section "Registry test (${MODE})"

  if [[ "$MODE" == "vision" && ! -f "$FIXTURE" ]]; then
    fail "Vision fixture missing: $FIXTURE"
    summary
    exit 1
  fi

  REPORT=$(BASE="$BASE" MODE="$MODE" DUMP_DIR="$DUMP_DIR" TIMEOUT="$TIMEOUT" \
           FIXTURE="$FIXTURE" MODELS_FILE="${REPO_DIR}/models.yaml" \
           python3 - <<'PYEOF'
import os, sys, json, yaml, base64, time, urllib.request

base       = os.environ['BASE']
mode       = os.environ['MODE']
dump_dir   = os.environ.get('DUMP_DIR') or ''
timeout    = float(os.environ.get('TIMEOUT', 120))
fixture    = os.environ['FIXTURE']
models_yml = os.environ['MODELS_FILE']

with open(models_yml) as f:
    cfg = yaml.safe_load(f)

# Mac-targeted models = no target field, or target list contains 'mac'
def on_mac(m):
    t = m.get('target')
    if t is None: return True
    return 'mac' in (t if isinstance(t, list) else [t])

models = [m for m in cfg['ollama']['models'] if on_mac(m)]

# Currently pulled models (so we skip "missing" without spamming pulls)
try:
    with urllib.request.urlopen(f'{base}/api/tags', timeout=5) as r:
        live = {m['name'] for m in json.loads(r.read())['models']}
except Exception:
    live = set()

def is_pulled(name):
    if name in live: return True
    # Bare 'foo' (no tag) matches 'foo:latest'
    if ':' not in name and f'{name}:latest' in live: return True
    return False

# Fixture image (only loaded if needed)
img_b64 = None
def load_image():
    global img_b64
    if img_b64 is None:
        with open(fixture, 'rb') as f:
            img_b64 = base64.b64encode(f.read()).decode()
    return img_b64

def post(path, payload, t):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(f'{base}{path}', data=data, headers={'Content-Type':'application/json'})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=t) as r:
        body = r.read().decode('utf-8', errors='replace')
    return body, time.time() - t0

results = []
for m in models:
    name  = m['name']
    alias = m.get('alias', name.replace(':','-').replace('/','-'))
    tags  = set(m.get('tags', []))
    is_vision = 'vision' in tags
    is_embed  = 'embedding' in tags or 'reranker' in tags

    # --vision filter
    if mode == 'vision' and not is_vision:
        continue

    if not is_pulled(name):
        results.append({'alias': alias, 'name': name, 'status': 'missing'})
        continue

    try:
        if is_embed and 'reranker' not in tags:
            body, dur = post('/api/embeddings',
                {'model': name, 'prompt': 'mac node embedding test'}, timeout)
            d = json.loads(body, strict=False)
            dim = len(d.get('embedding', []))
            results.append({'alias': alias, 'name': name, 'status': 'ok',
                           'kind': 'embedding', 'dim': dim, 'dur': dur})
            if dump_dir:
                outdir = os.path.join(dump_dir, alias); os.makedirs(outdir, exist_ok=True)
                with open(os.path.join(outdir, 'meta.json'), 'w') as f:
                    json.dump({'model': name, 'tags': sorted(tags), 'kind':'embedding',
                              'dim': dim, 'dur_sec': dur}, f, indent=2)
        else:
            payload = {
                'model': name,
                'prompt': ('Describe this image: shapes, colors, positions, and any text. Be brief.'
                           if is_vision else 'Reply with exactly: hello test'),
                'stream': False,
            }
            if is_vision:
                payload['images'] = [load_image()]
            body, dur = post('/api/generate', payload, timeout)
            d = json.loads(body, strict=False)
            ec = d.get('eval_count', 0)
            ed = d.get('eval_duration', 1) / 1e9
            tps = (ec / ed) if ec and ed else 0
            resp = d.get('response', '')
            results.append({'alias': alias, 'name': name, 'status': 'ok',
                           'kind': 'vision' if is_vision else 'chat',
                           'eval_count': ec, 'eval_duration_sec': ed,
                           'tok_per_sec': tps, 'dur': dur,
                           'preview': resp[:120]})
            if dump_dir:
                outdir = os.path.join(dump_dir, alias); os.makedirs(outdir, exist_ok=True)
                with open(os.path.join(outdir, 'response.txt'), 'w') as f:
                    f.write(resp)
                with open(os.path.join(outdir, 'meta.json'), 'w') as f:
                    json.dump({'model': name, 'tags': sorted(tags),
                              'kind': 'vision' if is_vision else 'chat',
                              'prompt': payload['prompt'],
                              'eval_count': ec, 'eval_duration_sec': ed,
                              'tok_per_sec': tps, 'dur_sec': dur}, f, indent=2)
    except Exception as e:
        results.append({'alias': alias, 'name': name, 'status': 'error', 'err': str(e)[:200]})

# Print human-readable + machine-readable trailer
for r in results:
    if r['status'] == 'missing':
        print(f"  SKIP   {r['alias']:<24} {r['name']:<48}  not pulled")
    elif r['status'] == 'error':
        print(f"  FAIL   {r['alias']:<24} {r['name']:<48}  {r['err']}")
    elif r.get('kind') == 'embedding':
        print(f"  OK     {r['alias']:<24} {r['name']:<48}  dim={r['dim']}  ({r['dur']:.2f}s)")
    else:
        print(f"  OK     {r['alias']:<24} {r['name']:<48}  {r['eval_count']:>4}tok  {r['tok_per_sec']:>6.1f}tok/s  | {r['preview'][:80]}")

# Trailer for shell to parse
ok    = sum(1 for r in results if r['status']=='ok')
fails = sum(1 for r in results if r['status']=='error')
skips = sum(1 for r in results if r['status']=='missing')
print(f"__SUMMARY__ ok={ok} fail={fails} skip={skips}")
PYEOF
)
  echo "$REPORT" | grep -v '^__SUMMARY__'
  TRAILER=$(echo "$REPORT" | grep '^__SUMMARY__' || echo "ok=0 fail=0 skip=0")
  OK_N=$(echo "$TRAILER"   | sed -n 's/.*ok=\([0-9]*\).*/\1/p')
  FAIL_N=$(echo "$TRAILER" | sed -n 's/.*fail=\([0-9]*\).*/\1/p')
  SKIP_N=$(echo "$TRAILER" | sed -n 's/.*skip=\([0-9]*\).*/\1/p')
  PASS=$((PASS + ${OK_N:-0}))
  FAIL=$((FAIL + ${FAIL_N:-0}))
  [[ "${SKIP_N:-0}" -gt 0 ]] && info "${SKIP_N} models skipped (not pulled)"
  [[ -n "$DUMP_DIR" ]] && detail "outputs written to: $DUMP_DIR"
fi

# ─── Summary ──────────────────────────────────────────────────────
summary
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
