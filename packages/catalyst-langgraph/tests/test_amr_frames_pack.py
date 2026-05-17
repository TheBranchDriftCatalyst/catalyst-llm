"""Tests for the AmrFrames section of the LabelPack loader.

The amr_frames section maps PropBank frames (introduce-01, refer-01, …)
emitted by an AMR parser to canonical predicates from the controlled
vocab. The AMR-to-assertion projection node uses this table to walk
each predicate node in an AMR graph.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from catalyst_langgraph.label_packs import (
    AmrFrames,
    LabelPack,
    load_generic_label_pack,
    load_label_pack,
)


def test_generic_pack_has_empty_amr_frames():
    """The bundled generic pack ships an empty amr_frames section so callers
    can read ``pack.amr_frames.frames`` without None-guards even when no
    AMR mappings are configured."""
    pack = load_generic_label_pack()
    assert isinstance(pack.amr_frames, AmrFrames)
    assert pack.amr_frames.frames == {}
    assert pack.amr_frames.role_overrides == {}
    # Default policy: surface unknown frames for review rather than dropping.
    assert pack.amr_frames.unknown_frame_action == "novel"
    assert not pack.has_amr_frames()


def test_pii_pack_has_empty_amr_frames():
    """PII pack is span-only (no proposition extraction) but still loads cleanly."""
    pack = load_label_pack(None, "pii")
    assert pack.amr_frames.frames == {}
    assert not pack.has_amr_frames()


def test_custom_pack_loads_amr_frames(tmp_path: Path):
    """A pack with an amr_frames section parses each subkey correctly."""
    custom = {
        "domain": "test",
        "canonical_types": ["FOO"],
        "amr_frames": {
            "unknown_frame_action": "passthrough",
            "frames": {
                "introduce-01": "sponsored",
                "vote-01": "voted_on",
            },
            "role_overrides": {
                "have-org-role-91": {
                    "ARG0": "subject",
                    "ARG1": "object",
                    "ARG2": "role_value",
                },
            },
        },
    }
    (tmp_path / "custom.labels.yaml").write_text(yaml.safe_dump(custom))
    pack = load_label_pack(tmp_path, "custom")
    assert pack.has_amr_frames()
    assert pack.amr_frames.frames["introduce-01"] == "sponsored"
    assert pack.amr_frames.frames["vote-01"] == "voted_on"
    assert pack.amr_frames.unknown_frame_action == "passthrough"
    assert pack.amr_frames.role_overrides["have-org-role-91"]["ARG2"] == "role_value"


@pytest.mark.parametrize("action", ["passthrough", "novel", "drop"])
def test_unknown_frame_action_accepts_documented_values(tmp_path: Path, action: str):
    """All three documented unknown_frame_action policies round-trip cleanly."""
    custom = {
        "amr_frames": {
            "unknown_frame_action": action,
            "frames": {"introduce-01": "sponsored"},
        },
    }
    (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
    pack = load_label_pack(tmp_path, "p")
    assert pack.amr_frames.unknown_frame_action == action


def test_unknown_frame_action_rejects_unknown_value(tmp_path: Path):
    """A typo in unknown_frame_action should surface, not silently coerce —
    the projection node's behaviour depends on this enum."""
    custom = {
        "amr_frames": {
            "unknown_frame_action": "ignore",   # not a valid policy
            "frames": {},
        },
    }
    (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
    with pytest.raises(ValueError, match="unknown_frame_action"):
        load_label_pack(tmp_path, "p")


def test_amr_frames_default_unknown_frame_action_is_novel(tmp_path: Path):
    """If a pack omits unknown_frame_action, the loader defaults to "novel"
    (i.e. flag unmapped frames for review)."""
    custom = {
        "amr_frames": {
            "frames": {"introduce-01": "sponsored"},
        },
    }
    (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
    pack = load_label_pack(tmp_path, "p")
    assert pack.amr_frames.unknown_frame_action == "novel"


def test_role_overrides_round_trip_through_yaml(tmp_path: Path):
    """role_overrides is a nested dict (frame → role → semantic_slot); make
    sure the loader preserves both layers verbatim across a YAML round-trip."""
    overrides = {
        "have-org-role-91": {"ARG0": "subject", "ARG1": "object", "ARG2": "role_value"},
        "withdraw-01": {"ARG0": "subject", "ARG1": "object"},
    }
    custom = {
        "amr_frames": {
            "frames": {"withdraw-01": "withdrew_cosponsorship"},
            "role_overrides": overrides,
        },
    }
    (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
    pack = load_label_pack(tmp_path, "p")
    assert pack.amr_frames.role_overrides == overrides


def test_partial_pack_without_amr_frames_section_loads(tmp_path: Path):
    """A pack that omits amr_frames entirely still loads (empty section)."""
    custom = {
        "domain": "test",
        "gliner": {"labels": {"foo": "FOO"}},
    }
    (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
    pack = load_label_pack(tmp_path, "p")
    assert isinstance(pack.amr_frames, AmrFrames)
    assert pack.amr_frames.frames == {}
    assert not pack.has_amr_frames()


def test_label_pack_dataclass_default_amr_frames():
    """Constructing a LabelPack without amr_frames yields an empty AmrFrames."""
    pack = LabelPack(name="empty")
    assert isinstance(pack.amr_frames, AmrFrames)
    assert pack.amr_frames.frames == {}
    assert pack.amr_frames.unknown_frame_action == "novel"
