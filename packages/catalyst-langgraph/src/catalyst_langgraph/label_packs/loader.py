"""LabelPack loader.

Reads a YAML file and exposes typed accessors for each encoder section.
The pack is intentionally permissive — missing sections degrade to an
empty config so a partial pack (e.g. gliner-only) still loads cleanly.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

GENERIC_PACK_NAME = "generic"
_BUNDLED_PACKS_DIR = Path(__file__).parent


@dataclass(frozen=True)
class GLiNERLabels:
    """GLiNER section of a label pack.

    ``labels`` is an ordered dict of ``label_text → canonical_type``.  GLiNER
    consumes the keys as its prediction labels; the canonical_type values are
    what the client emits as ``mention_type`` after prediction.
    """

    labels: dict[str, str] = field(default_factory=dict)
    threshold: float = 0.5
    flat_ner: bool = True
    window_tokens: int = 320
    window_overlap_tokens: int = 32
    model: str | None = None


@dataclass(frozen=True)
class NuExtractLabels:
    """NuExtract section of a label pack.

    ``template`` is the JSON template object NuExtract consumes.
    ``canonical_type_map`` projects each leaf key path (dot-joined, ``[]`` for
    list entries) back to a canonical type for the consensus voter.
    """

    template: dict[str, Any] = field(default_factory=dict)
    template_variants: dict[str, dict[str, Any]] = field(default_factory=dict)
    canonical_type_map: dict[str, str] = field(default_factory=dict)
    model: str | None = None


@dataclass(frozen=True)
class UniversalNERLabels:
    """UniversalNER section of a label pack.

    ``queries`` maps canonical_type → list of probe queries.  The client runs
    one conversation per query and unions the resulting spans under the
    canonical type.
    """

    queries: dict[str, list[str]] = field(default_factory=dict)
    assistant_prime: str = "I've read this text."
    max_chars_per_call: int = 6000
    model: str | None = None


@dataclass(frozen=True)
class RegexLabels:
    """Regex section of a label pack.

    ``patterns`` maps canonical_type → list of regex strings.
    ``authoritative_for`` lists canonical types where regex votes always win
    ties in the consensus voter.
    """

    patterns: dict[str, list[str]] = field(default_factory=dict)
    authoritative_for: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AmrFrames:
    """AMR PropBank frame → canonical predicate mapping.

    AMR parsers emit predicate nodes labelled with PropBank frames
    (introduce-01, refer-01, vote-01, …). The AMR-to-assertion
    projection node walks each frame and looks up the canonical
    predicate name from this map.

    ``unknown_frame_action`` controls what happens when a frame isn't
    in the table:
      - "passthrough" — emit the frame as-is (e.g. canonical_predicate = "introduce-01")
      - "novel"       — emit canonical_predicate = "NOVEL_{frame}", flag for review
      - "drop"        — skip the assertion entirely

    ``extended_predicates`` declares canonical predicate names emitted by
    this pack that intentionally extend beyond the SPO prompt's controlled
    vocabulary. The cross-validation QA test allows these as exceptions to
    the subset rule. Adding a predicate here is an explicit contract: the
    downstream validator must be taught to accept it.
    """

    frames: dict[str, str] = field(default_factory=dict)
    unknown_frame_action: str = "novel"
    # Argument-role overrides per frame — most frames use the default
    # (:ARG0 = subject, :ARG1 = object), but some legislative frames
    # have non-standard argument structures we want to flag.
    role_overrides: dict[str, dict[str, str]] = field(default_factory=dict)
    extended_predicates: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class LabelPack:
    """A fully-loaded label pack for one extraction domain.

    Every encoder section is always present (empty if the YAML omitted it),
    so client code can read ``pack.gliner.labels`` without None-guards.
    """

    name: str
    domain: str = ""
    description: str = ""
    canonical_types: list[str] = field(default_factory=list)
    gliner: GLiNERLabels = field(default_factory=GLiNERLabels)
    nuextract: NuExtractLabels = field(default_factory=NuExtractLabels)
    universalner: UniversalNERLabels = field(default_factory=UniversalNERLabels)
    regex: RegexLabels = field(default_factory=RegexLabels)
    amr_frames: AmrFrames = field(default_factory=AmrFrames)
    consensus: dict[str, Any] = field(default_factory=dict)

    def has_gliner_labels(self) -> bool:
        return bool(self.gliner.labels)

    def has_nuextract_template(self) -> bool:
        return bool(self.nuextract.template)

    def has_universalner_queries(self) -> bool:
        return bool(self.universalner.queries)

    def has_regex_patterns(self) -> bool:
        return bool(self.regex.patterns)

    def has_amr_frames(self) -> bool:
        return bool(self.amr_frames.frames)


def _parse_gliner(raw: dict[str, Any] | None) -> GLiNERLabels:
    raw = raw or {}
    return GLiNERLabels(
        labels=dict(raw.get("labels", {})),
        threshold=float(raw.get("threshold", 0.5)),
        flat_ner=bool(raw.get("flat_ner", True)),
        window_tokens=int(raw.get("window_tokens", 320)),
        window_overlap_tokens=int(raw.get("window_overlap_tokens", 32)),
        model=raw.get("model"),
    )


def _parse_nuextract(raw: dict[str, Any] | None) -> NuExtractLabels:
    raw = raw or {}
    return NuExtractLabels(
        template=dict(raw.get("template", {})),
        template_variants=dict(raw.get("template_variants", {})),
        canonical_type_map=dict(raw.get("canonical_type_map", {})),
        model=raw.get("model"),
    )


def _parse_universalner(raw: dict[str, Any] | None) -> UniversalNERLabels:
    raw = raw or {}
    queries = raw.get("queries", {})
    # Coerce single-string values to single-element lists so the client
    # doesn't have to defend against both shapes.
    normalized: dict[str, list[str]] = {}
    for k, v in queries.items():
        if isinstance(v, str):
            normalized[k] = [v]
        else:
            normalized[k] = list(v)
    return UniversalNERLabels(
        queries=normalized,
        assistant_prime=raw.get("assistant_prime", "I've read this text."),
        max_chars_per_call=int(raw.get("max_chars_per_call", 6000)),
        model=raw.get("model"),
    )


def _parse_regex(raw: dict[str, Any] | None) -> RegexLabels:
    raw = raw or {}
    patterns = raw.get("patterns", {})
    normalized: dict[str, list[str]] = {}
    for k, v in patterns.items():
        if isinstance(v, str):
            normalized[k] = [v]
        else:
            normalized[k] = list(v)
    return RegexLabels(
        patterns=normalized,
        authoritative_for=list(raw.get("authoritative_for", [])),
    )


_VALID_UNKNOWN_FRAME_ACTIONS = {"passthrough", "novel", "drop"}


def _parse_amr_frames(raw: dict[str, Any] | None) -> AmrFrames:
    raw = raw or {}
    # YAML treats ``frames:`` (with no children) as None; coerce defensively
    # so a sloppy pack edit degrades to an empty map instead of crashing.
    frames = dict(raw.get("frames") or {})
    action = str(raw.get("unknown_frame_action", "novel"))
    if action not in _VALID_UNKNOWN_FRAME_ACTIONS:
        # Don't silently coerce — surface the typo so packs can be corrected.
        raise ValueError(
            f"amr_frames.unknown_frame_action must be one of "
            f"{sorted(_VALID_UNKNOWN_FRAME_ACTIONS)}, got {action!r}"
        )
    # role_overrides is a nested dict (frame → role → semantic_slot); coerce
    # both layers defensively so YAML quirks don't bleed into the dataclass.
    overrides_raw = raw.get("role_overrides", {}) or {}
    role_overrides: dict[str, dict[str, str]] = {}
    for frame, mapping in overrides_raw.items():
        role_overrides[frame] = {str(k): str(v) for k, v in (mapping or {}).items()}
    extended_raw = raw.get("extended_predicates", []) or []
    extended = frozenset(str(p) for p in extended_raw)
    return AmrFrames(
        frames=frames,
        unknown_frame_action=action,
        role_overrides=role_overrides,
        extended_predicates=extended,
    )


def _load_from_path(path: Path, name: str) -> LabelPack:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return LabelPack(
        name=name,
        domain=raw.get("domain", ""),
        description=raw.get("description", ""),
        canonical_types=list(raw.get("canonical_types", [])),
        gliner=_parse_gliner(raw.get("gliner")),
        nuextract=_parse_nuextract(raw.get("nuextract")),
        universalner=_parse_universalner(raw.get("universalner")),
        regex=_parse_regex(raw.get("regex")),
        amr_frames=_parse_amr_frames(raw.get("amr_frames")),
        consensus=dict(raw.get("consensus", {})),
    )


def load_label_pack(prompt_dir: str | Path | None, pack_id: str) -> LabelPack:
    """Load a label pack by id.

    Resolution order:
      1. ``<prompt_dir>/<pack_id>.labels.yaml`` if prompt_dir is set
      2. Bundled pack at ``catalyst_langgraph/label_packs/<pack_id>.labels.yaml``
      3. Bundled generic pack as fallback (only when pack_id == "generic")

    Raises FileNotFoundError if no matching pack exists.
    """
    if prompt_dir:
        candidate = Path(prompt_dir) / f"{pack_id}.labels.yaml"
        if candidate.is_file():
            logger.info("label_packs: loading %s from %s", pack_id, candidate)
            return _load_from_path(candidate, pack_id)

    bundled = _BUNDLED_PACKS_DIR / f"{pack_id}.labels.yaml"
    if bundled.is_file():
        logger.info("label_packs: loading bundled %s", pack_id)
        return _load_from_path(bundled, pack_id)

    raise FileNotFoundError(
        f"label pack {pack_id!r} not found in prompt_dir={prompt_dir!r} "
        f"or bundled at {_BUNDLED_PACKS_DIR}"
    )


def load_generic_label_pack() -> LabelPack:
    """Load the bundled generic pack — replaces the previously hardcoded
    label maps in the GLiNER / NuExtract / UniversalNER clients."""
    return load_label_pack(prompt_dir=None, pack_id=GENERIC_PACK_NAME)
