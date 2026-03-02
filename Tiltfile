# Catalyst LLM - Tilt Development Environment
#
# GPU-accelerated local LLM setup with mode switching between:
#   - dev:  Local Docker Compose + native ollama (default)
#   - live: Kubernetes cluster deployment
#
# Usage:
#   tilt up                    # Dev mode (default)
#   tilt up -- --mode=dev      # Explicit dev mode
#   tilt up -- --mode=live     # Live/cluster mode
#

load('ext://uibutton', 'cmd_button', 'location', 'text_input', 'choice_input')

# ============================================
# Mode Configuration
# ============================================

config.define_string('mode', args=True, usage='Deployment mode: dev (default) or live')
cfg = config.parse()
mode = cfg.get('mode', 'dev')

# Validate mode
if mode not in ['dev', 'live']:
    fail('Invalid mode: %s. Use "dev" or "live".' % mode)

# ============================================
# Load Common Configuration
# ============================================

load('./tilt/common.tiltfile',
    'setup_ollama_buttons',
    'print_mode_banner',
    'print_quick_start',
    'MODELS_CREATIVE',
    'MODELS_DARKRP',
)

# Print banner
print_mode_banner(mode)

# ============================================
# Mode-Specific Setup
# ============================================

if mode == 'live':
    load('./tilt/live.tiltfile', 'setup_live')
    setup_live()
else:
    # Dev mode (default)
    load('./tilt/dev.tiltfile', 'setup_dev')
    setup_dev()

    # Add ollama buttons only in dev mode (ollama runs locally)
    setup_ollama_buttons()

    # Print quick start guide
    print_quick_start()
