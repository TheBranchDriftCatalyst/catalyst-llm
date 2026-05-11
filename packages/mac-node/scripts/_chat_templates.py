"""Canonical Ollama Modelfile chat templates + helpers.

A model entry in models.yaml can declare its chat format three ways
(checked in this order — earlier wins when multiple are set):

  1. `modelfile: |` — raw Modelfile body (TEMPLATE/PARAMETER/SYSTEM
     lines). Escape hatch for one-off custom templates.

  2. `pull.template_from: <name>` + (optional) top-level `parameters:`
     dict. Pulls a canonical TEMPLATE + matching stop tokens from
     CHAT_TEMPLATES below, then appends `PARAMETER` lines from
     the per-model `parameters:` map. The 90% case.

  3. Neither — `ollama create` gets a bare `FROM …` Modelfile,
     which is fine only if the underlying GGUF already ships with
     baked-in template metadata (most upstream-blessed tags do; the
     merge-gguf flow strips it, which is why this module exists).
"""
from __future__ import annotations

# Each entry: TEMPLATE body + stop tokens. PARAMETER stops are
# concatenated with any per-model `parameters.stop` (which can be a
# string or list) so callers can extend without clobbering.
CHAT_TEMPLATES: dict[str, dict] = {
    # ── ChatML (Qwen, Magnum/Qwen2.5 finetunes, most modern OSS) ─────
    "chatml": {
        "template": (
            '{{- if .System }}<|im_start|>system\n'
            '{{ .System }}<|im_end|>\n'
            '{{ end }}{{- range .Messages }}<|im_start|>{{ .Role }}\n'
            '{{ .Content }}<|im_end|>\n'
            '{{ end }}<|im_start|>assistant\n'
        ),
        "stop": ["<|im_end|>", "<|endoftext|>"],
    },

    # ── Mistral v7 Tekken (Mistral Large 2411, Mistral Small 3.x) ────
    # Explicit [SYSTEM_PROMPT]/[/SYSTEM_PROMPT] tokens around the
    # system message; [INST]/[/INST] around user turns; </s> caps
    # each assistant turn. Trailing space after [/INST] is intentional.
    "mistral-v7": {
        "template": (
            '{{- if .System }}[SYSTEM_PROMPT] {{ .System }}[/SYSTEM_PROMPT]'
            '{{ end }}{{- range .Messages }}'
            '{{- if eq .Role "user" }}[INST] {{ .Content }}[/INST]'
            '{{ else if eq .Role "assistant" }} {{ .Content }}</s>'
            '{{ end }}{{- end }}'
        ),
        "stop": ["</s>", "[INST]"],
    },

    # ── Mistral v3 (older Mistral 7B/Mixtral and most community
    # finetunes that predate the SYSTEM_PROMPT tag). Inlines system
    # into the first user turn.
    "mistral-v3": {
        "template": (
            '{{- range $i, $_ := .Messages }}'
            '{{- if eq .Role "user" }}'
            '{{- if and (eq $i 0) $.System }}[INST] {{ $.System }}\n\n{{ .Content }} [/INST]'
            '{{ else }}[INST] {{ .Content }} [/INST]{{ end }}'
            '{{- else if eq .Role "assistant" }} {{ .Content }}</s>'
            '{{- end }}{{- end }}'
        ),
        "stop": ["</s>", "[INST]"],
    },

    # ── Metharme / Pygmalion-style (older RP finetunes) ─────────────
    "metharme": {
        "template": (
            '{{- if .System }}<|system|>{{ .System }}<|end|>'
            '{{ end }}{{- range .Messages }}'
            '{{- if eq .Role "user" }}<|user|>{{ .Content }}<|end|>'
            '{{ else if eq .Role "assistant" }}<|model|>{{ .Content }}<|end|>'
            '{{ end }}{{- end }}<|model|>'
        ),
        "stop": ["<|end|>", "<|user|>"],
    },

    # ── Llama 3 (Hermes-4, llama3.x finetunes that don't ship their
    # own template). Listed for completeness; current registry doesn't
    # use it via merge-gguf (Hermes-4 is pulled as hf.co/... tag with
    # baked template intact).
    "llama3": {
        "template": (
            '{{- if .System }}<|start_header_id|>system<|end_header_id|>\n\n'
            '{{ .System }}<|eot_id|>'
            '{{ end }}{{- range .Messages }}<|start_header_id|>{{ .Role }}<|end_header_id|>\n\n'
            '{{ .Content }}<|eot_id|>'
            '{{ end }}<|start_header_id|>assistant<|end_header_id|>\n\n'
        ),
        "stop": ["<|eot_id|>", "<|end_of_text|>"],
    },
}


def _quote_param_value(v) -> str:
    """Render a value for a PARAMETER line. Strings get double-quoted
    (so tokens like '<|im_end|>' or '</s>' don't get parsed); numbers
    pass through bare."""
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    return '"' + s.replace('"', '\\"') + '"'


def render_modelfile_body(
    template_from: str | None = None,
    parameters: dict | None = None,
    raw_modelfile: str = "",
) -> str:
    """Produce the body of a Modelfile (everything AFTER the FROM
    directive). Empty result is valid — caller falls back to a bare
    FROM line.

    Precedence:
      1. raw_modelfile wins outright (escape hatch)
      2. else build from template_from + parameters
      3. else empty
    """
    if raw_modelfile and raw_modelfile.strip():
        return raw_modelfile.rstrip() + "\n"

    lines: list[str] = []
    canonical_stops: list[str] = []

    if template_from:
        tmpl = CHAT_TEMPLATES.get(template_from)
        if tmpl is None:
            raise ValueError(
                f"unknown template_from='{template_from}'. "
                f"Known: {sorted(CHAT_TEMPLATES.keys())}"
            )
        # Ollama wants the TEMPLATE body wrapped in triple double-quotes.
        lines.append('TEMPLATE """' + tmpl["template"] + '"""')
        canonical_stops = list(tmpl["stop"])

    # PARAMETER lines from the per-model parameters dict. Stop tokens
    # are special: the dict can carry an extra string or list of stops
    # and we *extend* (don't replace) the canonical ones.
    params = dict(parameters or {})
    extra_stops = params.pop("stop", None)
    all_stops: list[str] = list(canonical_stops)
    if isinstance(extra_stops, str):
        all_stops.append(extra_stops)
    elif isinstance(extra_stops, list):
        all_stops.extend(extra_stops)
    # de-dupe but preserve order
    seen = set()
    deduped: list[str] = []
    for s in all_stops:
        if s not in seen:
            deduped.append(s)
            seen.add(s)
    for s in deduped:
        lines.append('PARAMETER stop ' + _quote_param_value(s))

    for key, value in params.items():
        lines.append(f'PARAMETER {key} {_quote_param_value(value)}')

    body = "\n".join(lines)
    return (body + "\n") if body else ""
