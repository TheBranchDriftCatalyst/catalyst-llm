# Pattern: Tiltfile

## Purpose
Standard pattern for local development orchestration using Tilt.

## Structure
```python
# Standard Tiltfile pattern for catalyst-devspace projects

# Load extensions
load('ext://restart_process', 'docker_build_with_restart')

# Configuration
config.define_string('namespace', args=True)
config.define_bool('hot-reload', args=True)

# Build
docker_build(
    'app-image',
    context='.',
    dockerfile='Dockerfile',
    live_update=[
        sync('.', '/app'),
        run('npm install', trigger='package.json'),
    ]
)

# Deploy
k8s_yaml(kustomize('k8s/overlays/dev'))

# Resources
k8s_resource('app', port_forwards=['3000:3000'])
```

## Key Decisions
- Use live_update for fast iteration (avoid full rebuilds)
- Kustomize overlays for environment-specific config
- Port forwards for local access
- Resource grouping by service

## Status
Stub — to be fleshed out in Phase 4.
