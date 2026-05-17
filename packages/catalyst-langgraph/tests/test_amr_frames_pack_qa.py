"""QA suite for the AmrFrames pack extension and congress AMR-frame mappings.

This is the **adversarial** companion to ``test_amr_frames_pack.py``. The
dev tests assert "the pack contains what I put in it" — these tests check
the **contract**:

- Pack canonical predicates are a subset of the SPO prompt's controlled
  vocabulary (plus a declared extension set), so the AMR-projection node
  can't emit assertions the validator rejects.
- ``role_overrides`` keys actually refer to mapped frames.
- ``role_overrides`` slot vocabulary is a small closed set (no typos).
- Loader is strict about ``unknown_frame_action`` (no fuzzy casing).
- Round-tripping the pack through YAML preserves it exactly.
- Property-based: random AmrFrames survive YAML round-trip.
- Differential: pack predicates ⊆ prompt predicates ∪ extension list.

Bugs found by this pyramid live in ``loader.py`` or ``congress.labels.yaml``,
NOT here. Tests only assert; they don't fix.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from catalyst_langgraph.label_packs import load_label_pack
from catalyst_langgraph.label_packs.loader import _parse_amr_frames


# ─────────────────────────────────────────────────────────────────────────────
# Shared fixtures: the real congress pack + the prompt's canonical predicates.
# Both files live in catalyst-data; tests skip cleanly when absent.
# ─────────────────────────────────────────────────────────────────────────────
CONGRESS_PACK_PATH = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
    "k8s/congress-data/prompts/congress.labels.yaml"
)
PROPOSITION_PROMPT_PATH = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
    "k8s/congress-data/prompts/proposition_extraction.prompt"
)


def _prompt_canonical_predicates() -> set[str]:
    """Extract the canonical-predicate list from proposition_extraction.prompt.

    The prompt declares it under a ``## Canonical Predicates`` section,
    immediately after the line ``Use ONLY these predicates (or close
    normalized forms):``. Predicates are comma-separated snake_case verbs
    on one or more wrapped lines until a blank line.
    """
    text = PROPOSITION_PROMPT_PATH.read_text()
    m = re.search(
        r"## Canonical Predicates.*?Use ONLY these predicates.*?:\s*(.+?)(?:\n\n|##)",
        text,
        flags=re.DOTALL,
    )
    if not m:
        raise RuntimeError(
            "Could not locate canonical predicate list in "
            f"{PROPOSITION_PROMPT_PATH}; QA cross-validation can't run."
        )
    block = m.group(1)
    return {
        p.strip()
        for p in re.split(r"[,\s\n]+", block)
        if re.fullmatch(r"[a-z_]+", p.strip() or "")
    }


@pytest.fixture(scope="module")
def congress_pack():
    if not CONGRESS_PACK_PATH.is_file():
        pytest.skip("congress pack not present in this env")
    return load_label_pack(CONGRESS_PACK_PATH.parent, "congress")


@pytest.fixture(scope="module")
def prompt_predicates():
    if not PROPOSITION_PROMPT_PATH.is_file():
        pytest.skip("proposition_extraction.prompt not present in this env")
    return _prompt_canonical_predicates()


# ─────────────────────────────────────────────────────────────────────────────
# Tier 1 — Adversarial unit (target ~60% of new tests)
# ─────────────────────────────────────────────────────────────────────────────
class TestT1FrameCollisions:
    """T1: surface (frame, predicate) collisions deliberately."""

    def test_frame_collision_audit_bounded(self, congress_pack):
        """Multiple PropBank frames can legitimately collapse to one canonical
        predicate (e.g. ``sponsor-01`` + ``introduce-01`` both → ``sponsors``).
        But if a predicate is reachable from >4 frames it's almost certainly a
        copy-paste mistake. Surface the distribution and bound it."""
        inv: dict[str, list[str]] = {}
        for frame, pred in congress_pack.amr_frames.frames.items():
            inv.setdefault(pred, []).append(frame)
        collisions = {p: fs for p, fs in inv.items() if len(fs) > 1}
        # Print so failures show the actual map
        for pred, fs in sorted(collisions.items()):
            print(f"  collision: {pred:<30} <- {sorted(fs)}")
        for pred, fs in collisions.items():
            assert len(fs) <= 4, (
                f"predicate {pred!r} has {len(fs)} source frames "
                f"({sorted(fs)}); likely a typo or over-broad mapping"
            )


class TestT1RoleOverrideSanity:
    """T1: role_overrides invariants the dev didn't explicitly assert."""

    def test_every_role_override_frame_is_mapped(self, congress_pack):
        """A role_override on a frame that isn't in `frames` is dead code —
        the projection node never reaches the override path. Surface it."""
        mapped_frames = set(congress_pack.amr_frames.frames)
        override_frames = set(congress_pack.amr_frames.role_overrides)
        orphan_overrides = override_frames - mapped_frames
        assert not orphan_overrides, (
            f"role_overrides defined for frames not in frames map: "
            f"{sorted(orphan_overrides)}"
        )

    def test_role_override_slot_vocabulary_is_closed_set(self, congress_pack):
        """Slot values must be one of {subject, object, role_value}. A typo
        like ``"subjectt"`` would silently break the projection node."""
        allowed_slots = {"subject", "object", "role_value"}
        used_slots: set[str] = set()
        for mapping in congress_pack.amr_frames.role_overrides.values():
            used_slots.update(mapping.values())
        unknown = used_slots - allowed_slots
        assert not unknown, (
            f"role_overrides uses slot values outside the closed set "
            f"{sorted(allowed_slots)}: {sorted(unknown)}"
        )

    def test_role_override_keys_are_arg_labels(self, congress_pack):
        """Override keys must look like ``ARG\\d`` — anything else is a
        sloppy YAML edit that the projection node won't know how to read."""
        arg_re = re.compile(r"^ARG\d$")
        for frame, mapping in congress_pack.amr_frames.role_overrides.items():
            for k in mapping:
                assert arg_re.match(k), (
                    f"role_overrides[{frame!r}] has non-ARG key {k!r}"
                )


class TestT1LoaderEdgeCases:
    """T1: loader behavior on inputs the dev tests don't exercise."""

    def test_default_unknown_frame_action_when_section_omitted(self, tmp_path):
        """A pack with no amr_frames section at all defaults to 'novel'.
        (The dev test covers omitted unknown_frame_action *within* an
        existing amr_frames section; this is the stricter case.)"""
        (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump({"domain": "x"}))
        pack = load_label_pack(tmp_path, "p")
        assert pack.amr_frames.unknown_frame_action == "novel"
        assert pack.amr_frames.frames == {}

    def test_unknown_frame_action_is_case_sensitive(self, tmp_path):
        """``"Novel"`` (capitalized) must be rejected — this is an enum, not
        a fuzzy match. Silent normalization would let typos hide."""
        custom = {
            "amr_frames": {
                "unknown_frame_action": "Novel",
                "frames": {"introduce-01": "introduces"},
            },
        }
        (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
        with pytest.raises(ValueError, match="unknown_frame_action"):
            load_label_pack(tmp_path, "p")

    def test_unknown_frame_action_whitespace_not_stripped(self, tmp_path):
        """A trailing space in the YAML value should fail loudly, not be
        silently stripped — the contract is an exact-match enum."""
        custom = {
            "amr_frames": {
                "unknown_frame_action": "novel ",
                "frames": {},
            },
        }
        (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
        with pytest.raises(ValueError, match="unknown_frame_action"):
            load_label_pack(tmp_path, "p")

    def test_frames_value_none_yields_empty_dict(self, tmp_path):
        """A sloppy edit that leaves ``frames:`` with no children (YAML
        parses it as None) must not crash — it should degrade to empty."""
        (tmp_path / "p.labels.yaml").write_text(
            "amr_frames:\n  frames:\n  unknown_frame_action: passthrough\n"
        )
        pack = load_label_pack(tmp_path, "p")
        assert pack.amr_frames.frames == {}
        assert pack.amr_frames.unknown_frame_action == "passthrough"

    def test_role_overrides_value_none_yields_empty(self, tmp_path):
        """Same defence for role_overrides — None must not blow up the loader."""
        (tmp_path / "p.labels.yaml").write_text(
            "amr_frames:\n  frames:\n    foo-01: bar\n  role_overrides:\n"
        )
        pack = load_label_pack(tmp_path, "p")
        assert pack.amr_frames.role_overrides == {}

    def test_empty_frames_with_nonempty_role_overrides_loads_silently(
        self, tmp_path
    ):
        """Document current behavior: an empty frames map with role_overrides
        loads without error (role_overrides are dead code, surfaced by the
        T1 test above, not by the loader). If the team decides this should
        raise, this test will fail and flag the contract change."""
        custom = {
            "amr_frames": {
                "frames": {},
                "role_overrides": {"have-org-role-91": {"ARG0": "subject"}},
            },
        }
        (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
        pack = load_label_pack(tmp_path, "p")
        assert pack.amr_frames.frames == {}
        assert pack.amr_frames.role_overrides == {
            "have-org-role-91": {"ARG0": "subject"}
        }

    def test_extended_predicates_omitted_yields_empty_frozenset(self, tmp_path):
        """A pack without an `extended_predicates` declaration parses to an
        empty frozenset (default), so older packs still load cleanly."""
        custom = {
            "amr_frames": {
                "frames": {"introduce-01": "introduces"},
            },
        }
        (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
        pack = load_label_pack(tmp_path, "p")
        assert pack.amr_frames.extended_predicates == frozenset()

    def test_extended_predicates_parses_list(self, tmp_path):
        """`extended_predicates: [a, b]` becomes a frozenset of strings."""
        custom = {
            "amr_frames": {
                "frames": {"foo-01": "voted_on"},
                "extended_predicates": ["voted_on", "agreed_to"],
            },
        }
        (tmp_path / "p.labels.yaml").write_text(yaml.safe_dump(custom))
        pack = load_label_pack(tmp_path, "p")
        assert pack.amr_frames.extended_predicates == frozenset(
            {"voted_on", "agreed_to"}
        )


class TestT1CongressPackHygiene:
    """T1: structural invariants on the real congress pack."""

    def test_no_empty_string_frame_keys_or_values(self, congress_pack):
        for frame, pred in congress_pack.amr_frames.frames.items():
            assert frame, "empty frame key"
            assert pred, f"empty canonical predicate for frame {frame!r}"

    def test_canonical_predicates_are_snake_case(self, congress_pack):
        """Canonical predicates should be lowercase snake_case identifiers,
        consistent with the SPO prompt's vocabulary style."""
        snake_re = re.compile(r"^[a-z][a-z0-9_]*$")
        for frame, pred in congress_pack.amr_frames.frames.items():
            assert snake_re.match(pred), (
                f"frame {frame!r} → predicate {pred!r} is not snake_case"
            )

    def test_frame_keys_look_like_propbank(self, congress_pack):
        """PropBank frames look like ``<word>-NN`` (hyphenated lemma + 2-digit
        roleset id). The loader is permissive; this test pins the *content*
        of the congress pack so a typo like ``introduce_01`` would surface."""
        propbank_re = re.compile(r"^[a-z][a-z-]*-\d{2}$")
        for frame in congress_pack.amr_frames.frames:
            assert propbank_re.match(frame), (
                f"frame key {frame!r} doesn't match PropBank pattern <lemma>-NN"
            )


class TestT1YamlRoundTrip:
    """T1: serialize → parse → equals."""

    def test_amr_frames_yaml_round_trip(self, congress_pack):
        """Dump the loaded amr_frames back to YAML, re-parse, assert equality.
        Catches dict-ordering and string-escape regressions in the loader."""
        original = congress_pack.amr_frames
        dumped = yaml.safe_dump(
            {
                "amr_frames": {
                    "unknown_frame_action": original.unknown_frame_action,
                    "frames": dict(original.frames),
                    "role_overrides": {
                        k: dict(v) for k, v in original.role_overrides.items()
                    },
                    "extended_predicates": sorted(original.extended_predicates),
                }
            }
        )
        reparsed = yaml.safe_load(dumped)
        rebuilt = _parse_amr_frames(reparsed["amr_frames"])
        assert rebuilt.frames == original.frames
        assert rebuilt.role_overrides == original.role_overrides
        assert rebuilt.unknown_frame_action == original.unknown_frame_action
        assert rebuilt.extended_predicates == original.extended_predicates


# ─────────────────────────────────────────────────────────────────────────────
# Tier 2 — Property-based (target ~25% of new tests)
# ─────────────────────────────────────────────────────────────────────────────
# Strategies. Frame names: anything string-y; values: anything string-y.
# The loader is intentionally permissive on frame name format — the
# projection node validates downstream. So we fuzz with both legal and
# adversarial inputs.

_frame_text = st.text(
    alphabet=st.characters(
        whitelist_categories=("Ll", "Nd"),
        whitelist_characters="-_",
    ),
    min_size=1,
    max_size=32,
)
_pred_text = st.text(
    alphabet=st.characters(
        whitelist_categories=("Ll",),
        whitelist_characters="_",
    ),
    min_size=1,
    max_size=24,
)


@st.composite
def amr_frames_strategy(draw):
    """Build a random AmrFrames-shaped dict. role_overrides keys are a
    subset of frames keys so the partial-pack contract holds."""
    frames = draw(
        st.dictionaries(_frame_text, _pred_text, min_size=1, max_size=8)
    )
    action = draw(st.sampled_from(["passthrough", "novel", "drop"]))
    n_overrides = draw(st.integers(min_value=0, max_value=min(3, len(frames))))
    override_keys = draw(
        st.lists(
            st.sampled_from(list(frames.keys())),
            min_size=n_overrides,
            max_size=n_overrides,
            unique=True,
        )
    )
    overrides = {}
    slot_values = st.sampled_from(["subject", "object", "role_value"])
    for k in override_keys:
        n_args = draw(st.integers(min_value=1, max_value=3))
        mapping = {
            f"ARG{i}": draw(slot_values) for i in range(n_args)
        }
        overrides[k] = mapping
    return {
        "frames": frames,
        "unknown_frame_action": action,
        "role_overrides": overrides,
    }


class TestT2PropertyBased:
    @given(amr_frames_strategy())
    @settings(max_examples=50, deadline=None)
    def test_yaml_round_trip_preserves_structure(self, body):
        """Any well-formed AmrFrames dict round-trips through YAML →
        loader → equals the original (modulo dict ordering)."""
        dumped = yaml.safe_dump({"amr_frames": body})
        reparsed = yaml.safe_load(dumped)
        parsed = _parse_amr_frames(reparsed["amr_frames"])
        assert parsed.frames == body["frames"]
        assert parsed.unknown_frame_action == body["unknown_frame_action"]
        assert parsed.role_overrides == body["role_overrides"]

    @given(st.dictionaries(_frame_text, _pred_text, min_size=0, max_size=5))
    @settings(max_examples=30, deadline=None)
    def test_unknown_frame_action_defaults_to_novel(self, frames):
        """When the YAML omits unknown_frame_action, the loader fills in
        'novel' regardless of the rest of the body."""
        parsed = _parse_amr_frames({"frames": frames})
        assert parsed.unknown_frame_action == "novel"

    @given(
        st.dictionaries(
            st.text(min_size=1, max_size=16),  # adversarial: any text
            st.text(min_size=1, max_size=16),
            min_size=1,
            max_size=5,
        )
    )
    @settings(max_examples=30, deadline=None)
    def test_loader_permissive_on_garbage_frame_names(self, frames):
        """The loader does NOT enforce PropBank-style frame names — the
        projection node does that downstream. So any string-keyed dict
        must parse without raising. (Regression: an over-eager validation
        in the loader would break partial packs.)"""
        parsed = _parse_amr_frames({"frames": frames})
        assert parsed.frames == frames


# ─────────────────────────────────────────────────────────────────────────────
# Tier 3 — Differential / cross-validation
# (the most important QA test — surface pack-vs-prompt drift)
# ─────────────────────────────────────────────────────────────────────────────
class TestT3PromptCrossValidation:
    def test_pack_predicates_subset_of_prompt_or_extensions(
        self, congress_pack, prompt_predicates
    ):
        """Every canonical predicate the AMR pack emits must either be in
        the SPO prompt's controlled vocabulary or explicitly declared as
        an extension in `extended_predicates`. Anything outside that union
        is a contract bug — the validator would reject the assertion."""
        pack_preds = set(congress_pack.amr_frames.frames.values())
        extensions = congress_pack.amr_frames.extended_predicates
        allowed = prompt_predicates | extensions
        violators = pack_preds - allowed
        # Print the diff so the failure message is actionable
        if violators:
            print("Pack predicates NOT in prompt vocab and NOT declared as extensions:")
            for v in sorted(violators):
                sources = sorted(
                    f for f, p in congress_pack.amr_frames.frames.items()
                    if p == v
                )
                print(f"  {v}  <- {sources}")
        assert not violators, (
            f"pack emits {sorted(violators)} which are neither in the "
            f"SPO prompt vocab nor declared in extended_predicates"
        )

    def test_orphan_prompt_predicates_surfaced(
        self, congress_pack, prompt_predicates
    ):
        """Prompt predicates with NO AMR frame mapping are orphans — those
        triples can only come from the LLM SPO path, not from AMR. This is
        not necessarily a bug, but it must be visible. Pin the current
        orphan set so additions/removals require a deliberate edit."""
        pack_preds = set(congress_pack.amr_frames.frames.values())
        orphans = prompt_predicates - pack_preds
        # The deliberate-orphan set: predicates the LLM emits but AMR
        # doesn't have a clean frame for, OR that the pack intentionally
        # doesn't route through AMR (polarity-aware predicates).
        expected_orphans = {
            # polarity-aware → AMR uses vote-01 with :polarity, not separate frames
            "votes_for",
            "votes_against",
            # opinion verbs — AMR has frames but they're noisy in legislative
            # text; the LLM SPO path handles them better
            "supports",
            "opposes",
            # money flow — handled by the LLM SPO path; AMR has frames
            # (regulate-01, appropriate-01, fund-01) but they're not in the
            # current pack
            "regulates",
            "appropriates",
            "funds",
        }
        # The actual orphan set must be a subset of the expected one. New
        # orphans = new prompt predicates we forgot to add to the pack.
        unexpected = orphans - expected_orphans
        if unexpected:
            print("Unexpected orphan predicates (in prompt, no AMR mapping):")
            for o in sorted(unexpected):
                print(f"  {o}")
        assert not unexpected, (
            f"prompt declares {sorted(unexpected)} but no AMR frame routes "
            f"to it; either add a frame mapping or extend `expected_orphans`"
        )

    def test_extensions_actually_extend(
        self, congress_pack, prompt_predicates
    ):
        """Every entry in `extended_predicates` should genuinely be missing
        from the prompt vocab. If a predicate is in BOTH, the declaration
        is misleading — the prompt already accepts it, so it's not an
        extension."""
        extensions = congress_pack.amr_frames.extended_predicates
        false_extensions = extensions & prompt_predicates
        assert not false_extensions, (
            f"extended_predicates declares {sorted(false_extensions)} but "
            f"those are already in the SPO prompt vocab; remove from the list"
        )

    def test_extensions_actually_used(self, congress_pack):
        """Every declared extension must be referenced by ≥1 frame mapping.
        A declaration with no use is dead code that misleads readers."""
        extensions = congress_pack.amr_frames.extended_predicates
        used = set(congress_pack.amr_frames.frames.values())
        unused = extensions - used
        assert not unused, (
            f"extended_predicates declares {sorted(unused)} but no frame "
            f"emits them; drop the declaration"
        )

    def test_predicate_coverage_distribution_reported(
        self, congress_pack, prompt_predicates
    ):
        """Diagnostic: how many AMR frames map onto each prompt predicate?
        Predicates with high frame-count are heavily-overloaded buckets
        (potential paraphrase collapse); predicates with zero are orphans.
        This test always passes — it just prints the distribution so
        reviewers can eyeball it."""
        from collections import Counter
        pack = congress_pack.amr_frames
        counts: Counter[str] = Counter(pack.frames.values())
        print("AMR-frame coverage per canonical predicate:")
        all_preds = prompt_predicates | set(counts) | pack.extended_predicates
        for pred in sorted(all_preds):
            tag = (
                "(prompt)" if pred in prompt_predicates
                else "(extension)" if pred in pack.extended_predicates
                else "(undeclared!)"
            )
            print(f"  {pred:<30} {counts.get(pred, 0):2d}  {tag}")
        # Diagnostic only — always passes.


# ─────────────────────────────────────────────────────────────────────────────
# Tier 4 — Scenario (target ~5% of new tests)
# ─────────────────────────────────────────────────────────────────────────────
class TestT4Scenario:
    def test_smith_introduced_and_referred_scenario(self, congress_pack):
        """Real legislative sentence:

            "Rep. Smith (D-NY) introduced H.R. 1234, which was referred
             to the Committee on Energy and Commerce."

        An AMR parser emits two predicate nodes: ``introduce-01`` (ARG0=Smith,
        ARG1=H.R. 1234) and ``refer-01`` (ARG1=H.R. 1234, ARG2=Committee).
        Walking each frame through the pack must yield the prompt-vocab
        predicates ``introduces`` and ``refers_to``.
        """
        amr_frames = ["introduce-01", "refer-01"]
        emitted = [congress_pack.amr_frames.frames[f] for f in amr_frames]
        assert emitted == ["introduces", "refers_to"]

    def test_signed_into_law_scenario(self, congress_pack):
        """Real sentence:

            "The President signed H.R. 1234 into law on January 5, 2025;
             P.L. 119-1 thereby became law and was enacted."

        AMR emits ``sign-01``, ``become-01``, ``enact-01``. The first must
        map to the prompt's ``signed_by``; the latter two semantically
        collapse to ``enacted`` (single canonical concept)."""
        frames = congress_pack.amr_frames.frames
        assert frames["sign-01"] == "signed_by"
        assert frames["become-01"] == "enacted"
        assert frames["enact-01"] == "enacted"
