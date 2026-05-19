"""QA suite for the media-ingest LabelPack.

This is the **adversarial** companion to ``test_media_labels_pack.py``.
The dev tests assert "the pack contains what I put in it"; this suite
hammers the contract from angles the dev didn't cover:

- Tier 1 (adversarial unit) — regex edge cases, structural invariants,
  YAML round-trip, role-override coverage on speech-act frames.
- Tier 2 (property-based) — predicate coverage and PropBank frame-name
  formats restated as ``hypothesis`` properties.
- Tier 3 (differential / cross-domain) — media regex must not fire on
  congress text and vice versa; AMR frames shared between packs that
  encode PropBank-invariant semantics must agree.
- Tier 4 (scenario) — a real transcript snippet from the media
  ``mention_extraction.prompt`` Example 1 / Example 2 paragraphs is
  exercised end-to-end through the regex layer.

Bugs surfaced by these tests are fixed in ``media.labels.yaml``, not in
the test (the rule is: the contract is the test).
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from catalyst_langgraph.label_packs import load_label_pack

# ─────────────────────────────────────────────────────────────────────────────
# Path resolution
# ─────────────────────────────────────────────────────────────────────────────
_MEDIA_PROMPT_DIR = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
    "k8s/base/media-ingest/prompts"
)
_MEDIA_PACK_PATH = _MEDIA_PROMPT_DIR / "media.labels.yaml"

_CONGRESS_PROMPT_DIR = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
    "k8s/base/congress-data/prompts"
)
_CONGRESS_PACK_PATH = _CONGRESS_PROMPT_DIR / "congress.labels.yaml"


def _require_media_pack():
    if not _MEDIA_PACK_PATH.is_file():
        pytest.skip("media-ingest pack not present in this env")


def _require_congress_pack():
    if not _CONGRESS_PACK_PATH.is_file():
        pytest.skip("congress-data pack not present in this env")


def _load_media_pack():
    _require_media_pack()
    return load_label_pack(_MEDIA_PROMPT_DIR, "media")


def _load_congress_pack():
    _require_congress_pack()
    return load_label_pack(_CONGRESS_PROMPT_DIR, "congress")


def _compile(patterns: list[str]) -> list[re.Pattern]:
    return [re.compile(p) for p in patterns]


def _fires(compiled: list[re.Pattern], text: str) -> bool:
    return any(rx.search(text) for rx in compiled)


# Speech-act predicates as declared in proposition_extraction.prompt.
_SPEECH_ACT_PREDICATES = frozenset({
    "states", "claims", "denies", "confirms", "acknowledges", "questions",
    "responds_to", "references", "discusses", "criticizes", "supports",
    "opposes",
})


# Closed vocabulary of role-override slot names. Any value outside this set is
# a typo (or an unintended new slot — which would be a contract change the
# projection node has to be taught about).
_ROLE_OVERRIDE_VOCAB = frozenset({
    "subject", "object", "source_attribution", "role_value", "recipient",
})


# PropBank frame-name regex. The format is `<lemma>-<sense>` where lemma is
# a lowercase alphanumeric token (hyphens allowed mid-lemma, e.g.
# `have-org-role`) and sense is a 1-3 digit number.
_PROPBANK_FRAME_RE = re.compile(r"^[a-z][a-z0-9-]*-\d{1,3}$")


# ─────────────────────────────────────────────────────────────────────────────
# Tier 1 — Adversarial unit tests (no overlap with dev's 12)
# ─────────────────────────────────────────────────────────────────────────────
class TestTier1AdversarialUnit:
    """Edge cases, structural invariants, and YAML round-trip."""

    def test_speaker_regex_adversarial_sweep(self):
        """SPEAKER pattern must fire on the diarizer's canonical forms and
        NOT on the literal English word in prose or the role honorific."""
        pack = _load_media_pack()
        compiled = _compile(pack.regex.patterns["SPEAKER"])

        # Positive — diarizer-shaped labels.
        assert _fires(compiled, "SPEAKER_00 began")
        assert _fires(compiled, "SPEAKER_99 closed the panel")
        assert _fires(compiled, "Speaker 1 said hello")
        assert _fires(compiled, "Speaker_42 followed up")

        # Negative — non-diarization usages that previously confused regex
        # implementations on transcripts with mixed speaker/role mentions.
        assert not _fires(compiled, "the speaker 1 said")  # lowercase prose
        assert not _fires(compiled, "SPEAKERS gathered")  # plural
        assert not _fires(compiled, "Mr. Speaker yielded the floor")  # honorific

    def test_speaker_regex_three_digit_decision_is_intentional(self):
        """``\\d{1,2}`` deliberately caps speaker indices at 99. A 3-digit
        SPEAKER_100 must NOT match — diarizer output beyond 99 is vanishingly
        rare and the bound prevents accidental matches on numeric IDs that
        happen to follow the literal word 'speaker'. If diarizer output ever
        exceeds 99, the pattern is the place to widen.
        """
        pack = _load_media_pack()
        compiled = _compile(pack.regex.patterns["SPEAKER"])
        # SPEAKER_100 must NOT match end-to-end. The current pattern's word
        # boundary after \d{1,2} prevents a partial match of SPEAKER_10.
        assert not _fires(compiled, "SPEAKER_100 is unusual")

    def test_money_regex_negative_cases(self):
        """``$``-prefix is the discriminator. Bare Senate-bill numbers,
        percentages, and bare years must not fire — these are the most
        common false-positive triggers on transcripts that mix politics
        and markets."""
        pack = _load_media_pack()
        compiled = _compile(pack.regex.patterns["MONEY"])

        assert not _fires(compiled, "S. 1234 was introduced today")
        assert not _fires(compiled, "rates rose 200%")
        assert not _fires(compiled, "the year 2025 will be pivotal")
        # Year inside a date phrase still must not fire as MONEY.
        assert not _fires(compiled, "from 1990 to 2020 the trend held")

    def test_money_regex_positive_cases_including_commas(self):
        """Common transcript money phrasings the regex must catch — including
        the comma-grouped form that the original pattern was unverified on."""
        pack = _load_media_pack()
        compiled = _compile(pack.regex.patterns["MONEY"])

        assert _fires(compiled, "costs $1 today")
        assert _fires(compiled, "the deal was worth $1.5 trillion")
        assert _fires(compiled, "$200 million pledged")
        assert _fires(compiled, "$200M valuation")
        assert _fires(compiled, "$3,500,000 spent on settlements")
        assert _fires(compiled, "around $50,000 in damages")

    def test_law_regex_court_case_form(self):
        """Court-case ``X v. Y`` must catch landmark cases including those
        where one party is an all-caps abbreviation (FEC, NLRB, EPA …)."""
        pack = _load_media_pack()
        compiled = _compile(pack.regex.patterns["LAW"])

        assert _fires(compiled, "Roe v. Wade was decided in 1973")
        assert _fires(compiled, "Brown v. Board of Education")
        # All-caps abbreviation on the right side — the historic failure mode.
        assert _fires(compiled, "Citizens United v. FEC")
        assert _fires(compiled, "NLRB v. Jones & Laughlin Steel")

        # Negative — lowercase tokens are NOT a case citation.
        assert not _fires(compiled, "me v. you in a hypothetical")
        assert not _fires(compiled, "team a v. team b")

    def test_gliner_label_text_uniqueness(self):
        """Two GLiNER label_text keys that collide on text would silently
        overwrite each other on YAML load, eroding the bi-encoder's
        prediction matrix. Verify by re-parsing the YAML in raw mode and
        counting raw key occurrences."""
        _require_media_pack()
        # Parse YAML keeping all keys — yaml.safe_load deduplicates dict keys
        # silently, so we use a regex scan over the labels block instead.
        raw = _MEDIA_PACK_PATH.read_text(encoding="utf-8")
        # Carve out the gliner.labels block: everything between
        # "  labels:" and the next blank-line + non-indented section.
        m = re.search(
            r"\n  labels:\n((?:    .+\n)+)", raw, flags=re.MULTILINE
        )
        assert m, "could not locate gliner.labels block in YAML"
        block = m.group(1)
        # Each key is the bare quoted string at the start of the line, before
        # the colon-and-spaces and the canonical-type value.
        keys = re.findall(r'^\s+"([^"]+)"\s*:', block, flags=re.MULTILINE)
        assert keys, "regex failed to scrape GLiNER label keys"
        duplicates = [k for k in set(keys) if keys.count(k) > 1]
        assert not duplicates, (
            f"GLiNER label_text duplicates would cause silent overwrite "
            f"on YAML load: {duplicates}"
        )

    def test_gliner_canonical_types_subset_of_universe(self):
        """Every canonical_type referenced by a GLiNER label must be in the
        declared canonical_types universe (defense-in-depth — dev test
        ``test_media_pack_gliner_has_at_least_20_labels`` checks the same
        thing for a sample, but this one enumerates EVERY label)."""
        pack = _load_media_pack()
        universe = set(pack.canonical_types)
        bad = {
            label: ct
            for label, ct in pack.gliner.labels.items()
            if ct not in universe
        }
        assert not bad, f"GLiNER labels reference non-canonical types: {bad}"

    def test_nuextract_canonical_type_map_paths_valid(self):
        """Every key in ``nuextract.canonical_type_map`` must correspond to
        a leaf path in ``nuextract.template`` — a dangling path means the
        consensus voter will never see emissions at that path land in the
        intended canonical bucket."""
        pack = _load_media_pack()
        template_paths = _collect_template_paths(pack.nuextract.template)
        dangling = [
            p for p in pack.nuextract.canonical_type_map
            if p not in template_paths
        ]
        assert not dangling, (
            f"canonical_type_map keys point to non-existent template paths: "
            f"{dangling}\nAvailable paths: {sorted(template_paths)}"
        )

    def test_nuextract_template_string_leaves_all_in_canonical_map(self):
        """Every leaf in the template whose type is ``verbatim-string``,
        ``string``, ``date-time``, or ``date`` should appear in
        ``canonical_type_map`` — otherwise emissions there silently land in
        the OTHER bucket. Boolean/integer/enum leaves are exempt (those are
        metadata flags, not entities to project)."""
        pack = _load_media_pack()
        string_paths = _collect_string_leaf_paths(pack.nuextract.template)
        uncovered = [
            p for p in string_paths
            if p not in pack.nuextract.canonical_type_map
        ]
        assert not uncovered, (
            f"NuExtract string/verbatim leaves are not mapped to canonical "
            f"types — they will land in OTHER:\n  {uncovered}"
        )

    def test_role_override_keys_reference_real_frames(self):
        """You can't override a frame that isn't mapped — the projection
        node looks up the frame in ``frames`` first, then applies
        ``role_overrides``. A dangling override is dead config."""
        pack = _load_media_pack()
        bad = [
            f for f in pack.amr_frames.role_overrides
            if f not in pack.amr_frames.frames
        ]
        assert not bad, (
            f"role_overrides reference frames not present in "
            f"amr_frames.frames: {bad}"
        )

    def test_role_override_slot_vocabulary_is_closed(self):
        """The projection node has a closed set of semantic slot names. A
        typo (``subjectt``, ``objet``, ``recipien``) would silently break
        projection because the unknown slot falls through to the default
        handler."""
        pack = _load_media_pack()
        seen_slots: set[str] = set()
        for mapping in pack.amr_frames.role_overrides.values():
            seen_slots.update(mapping.values())
        unknown = seen_slots - _ROLE_OVERRIDE_VOCAB
        assert not unknown, (
            f"role_overrides use unrecognized slot names: {sorted(unknown)}. "
            f"Expected one of: {sorted(_ROLE_OVERRIDE_VOCAB)}"
        )

    def test_speech_act_frames_have_role_overrides(self):
        """For every frame that maps to a speech-act canonical predicate,
        there must be a role_overrides entry — otherwise ARG2 ("according
        to X") fails to land as source_attribution and the projection node
        emits a stray triple instead of the qualifier the SPO schema
        expects."""
        pack = _load_media_pack()
        missing: dict[str, str] = {}
        for frame, predicate in pack.amr_frames.frames.items():
            if predicate in _SPEECH_ACT_PREDICATES and frame not in pack.amr_frames.role_overrides:
                missing[frame] = predicate
        assert not missing, (
            f"speech-act frames missing role_overrides "
            f"(ARG2 will be lost as source_attribution): {missing}"
        )

    def test_unknown_frame_action_is_novel(self):
        """For a domain pack, ``novel`` is the safety default — surface
        unmapped frames in review rather than silently dropping them
        (``drop``) or polluting the canonical vocab with raw PropBank
        labels (``passthrough``)."""
        pack = _load_media_pack()
        assert pack.amr_frames.unknown_frame_action == "novel"

    def test_canonical_types_no_duplicates(self):
        """Duplicate canonical types in the universe would inflate
        ``len(canonical_types)`` and confuse downstream code that iterates
        the list expecting distinct slots."""
        pack = _load_media_pack()
        assert len(pack.canonical_types) == len(set(pack.canonical_types)), (
            f"canonical_types has duplicates: "
            f"{[t for t in pack.canonical_types if pack.canonical_types.count(t) > 1]}"
        )

    def test_yaml_round_trip_preserves_pack(self):
        """Load → dump → load → assert equality on the structured pieces.
        Catches YAML quirks like unintended type coercion (a ``date`` leaf
        in the template silently becoming a datetime object on dump, etc.)."""
        pack = _load_media_pack()
        # Re-dump the raw YAML and reload via the pack loader.
        raw = yaml.safe_load(_MEDIA_PACK_PATH.read_text(encoding="utf-8"))
        buf = io.StringIO()
        yaml.safe_dump(raw, buf, sort_keys=False, allow_unicode=True)
        buf.seek(0)
        round_tripped = yaml.safe_load(buf.read())
        # Spot-check the load-bearing sections.
        assert round_tripped["canonical_types"] == raw["canonical_types"]
        assert round_tripped["gliner"]["labels"] == raw["gliner"]["labels"]
        assert round_tripped["amr_frames"]["frames"] == raw["amr_frames"]["frames"]
        assert (
            round_tripped["amr_frames"]["role_overrides"]
            == raw["amr_frames"]["role_overrides"]
        )
        assert round_tripped["regex"]["patterns"] == raw["regex"]["patterns"]
        # Reload via the pack loader and confirm the structured pack
        # fields match the originally-loaded pack. The loader resolves
        # ``<prompt_dir>/<pack_id>.labels.yaml`` — write the round-tripped
        # YAML to a sibling file named ``media-rt.labels.yaml`` so the
        # loader's path convention is satisfied.
        tmp = _MEDIA_PROMPT_DIR / "media-rt.labels.yaml"
        try:
            tmp.write_text(yaml.safe_dump(raw, sort_keys=False, allow_unicode=True))
            reloaded = load_label_pack(_MEDIA_PROMPT_DIR, "media-rt")
            assert reloaded.canonical_types == pack.canonical_types
            assert reloaded.amr_frames.frames == pack.amr_frames.frames
            assert reloaded.amr_frames.role_overrides == pack.amr_frames.role_overrides
            assert reloaded.regex.patterns == pack.regex.patterns
        finally:
            if tmp.exists():
                tmp.unlink()


# ─────────────────────────────────────────────────────────────────────────────
# Tier 2 — Property-based tests
# ─────────────────────────────────────────────────────────────────────────────
class TestTier2PropertyBased:
    """Restate invariants as property tests so they survive future edits."""

    def test_property_every_speech_act_predicate_has_at_least_one_frame(self):
        """Property: for every speech-act canonical predicate, the AMR
        frame table contains at least one frame mapping to it. Restating
        the orphan check as a property catches silent removals."""
        pack = _load_media_pack()
        mapped_predicates = set(pack.amr_frames.frames.values())

        @given(predicate=st.sampled_from(sorted(_SPEECH_ACT_PREDICATES)))
        @settings(max_examples=len(_SPEECH_ACT_PREDICATES), deadline=None)
        def _check(predicate: str):
            assert predicate in mapped_predicates, (
                f"speech-act predicate {predicate!r} has no AMR frame "
                f"mapping in media pack"
            )

        _check()

    def test_property_every_frame_name_is_valid_propbank(self):
        """PropBank frame format is ``<lemma>-<sense>`` — lowercase letters
        / digits / mid-lemma hyphens followed by ``-<digit{1,3}>``. Catches
        typos like ``state01`` (missing hyphen) or ``State-01`` (uppercase)."""
        pack = _load_media_pack()
        frames = sorted(pack.amr_frames.frames.keys())

        @given(frame=st.sampled_from(frames))
        @settings(max_examples=len(frames), deadline=None)
        def _check(frame: str):
            assert _PROPBANK_FRAME_RE.match(frame), (
                f"frame name {frame!r} does not match PropBank "
                f"<lemma>-<sense> format"
            )

        _check()

    def test_property_every_regex_pattern_compiles(self):
        """Don't trust the loader to surface bad regex — verify each
        compiles via ``re.compile`` at test time. Catches accidental
        unescaped metacharacters or unbalanced groups."""
        pack = _load_media_pack()
        all_patterns: list[tuple[str, str]] = []
        for canonical_type, patterns in pack.regex.patterns.items():
            for p in patterns:
                all_patterns.append((canonical_type, p))

        @given(item=st.sampled_from(all_patterns))
        @settings(max_examples=len(all_patterns), deadline=None)
        def _check(item: tuple[str, str]):
            canonical_type, pattern = item
            try:
                re.compile(pattern)
            except re.error as e:
                raise AssertionError(
                    f"regex for {canonical_type!r} failed to compile: "
                    f"{pattern!r} ({e})"
                ) from e

        _check()


# ─────────────────────────────────────────────────────────────────────────────
# Tier 3 — Differential / cross-domain
# ─────────────────────────────────────────────────────────────────────────────
# Sample text drawn from each domain's prompt examples. Reused across the
# collision tests so the regex layer is exercised on realistic-ish strings.
_CONGRESS_TEXT_SAMPLE = (
    "Rep. Nancy Pelosi (D-CA) introduced H.R. 1234, the Clean Energy "
    "Innovation Act, on March 15, 2025. The House Committee on "
    "Appropriations later approved P.L. 119-1 with 218-212 yeas-nays."
)
_MEDIA_TEXT_SAMPLE = (
    "[SPEAKER_00] So President Biden met with Xi Jinping in San Francisco "
    "last November to discuss Taiwan. [SPEAKER_01] The Federal Reserve "
    "raised interest rates by 25 basis points; the S&P 500 dropped 2%."
)


class TestTier3Differential:
    """The load-bearing test of this tier: regex patterns must not fire
    spuriously on the other domain's text."""

    def test_media_speaker_regex_silent_on_congress_text(self):
        """Media's SPEAKER pattern must not fire on congressional procedural
        text — diarizer labels (SPEAKER_NN) don't appear in bill text."""
        media = _load_media_pack()
        compiled = _compile(media.regex.patterns["SPEAKER"])
        assert not _fires(compiled, _CONGRESS_TEXT_SAMPLE), (
            "media SPEAKER regex spuriously fired on congress text"
        )

    def test_congress_bill_regex_silent_on_media_text(self):
        """Congress's BILL pattern (H.R. 1234, S.J.Res. 12, …) must not fire
        on a media transcript."""
        congress = _load_congress_pack()
        compiled = _compile(congress.regex.patterns["BILL"])
        assert not _fires(compiled, _MEDIA_TEXT_SAMPLE), (
            "congress BILL regex spuriously fired on media transcript"
        )

    def test_congress_public_law_regex_silent_on_media_text(self):
        """Congress's PUBLIC_LAW pattern must not fire on a media
        transcript — these citations appear in legislative text only."""
        congress = _load_congress_pack()
        compiled = _compile(congress.regex.patterns["PUBLIC_LAW"])
        assert not _fires(compiled, _MEDIA_TEXT_SAMPLE), (
            "congress PUBLIC_LAW regex spuriously fired on media transcript"
        )

    def test_gliner_label_overlap_between_packs_is_visible(self):
        """Print + assert the exact-text overlap of GLiNER labels across
        media and congress packs. Pure overlap (same label_text in both
        packs) means the bi-encoder gets the same NER prompt regardless of
        domain — the domain tuning is illusory for those labels.

        A few overlaps are tolerable (truly universal entity descriptions)
        but should be a small, intentional set. Print the overlap so the
        humans can see what's shared.
        """
        media = _load_media_pack()
        congress = _load_congress_pack()
        media_labels = set(media.gliner.labels.keys())
        congress_labels = set(congress.gliner.labels.keys())
        overlap = media_labels & congress_labels

        # The packs were built domain-tuned; literal text overlap is the
        # surprise case. Print the overlap so a human reviewer sees it
        # regardless of pass/fail.
        if overlap:
            print(
                "\nGLiNER label_text overlap between media and congress packs:"
            )
            for label in sorted(overlap):
                print(f"  {label!r}")
        # Soft assertion: a deliberate small overlap is fine; an avalanche
        # of shared labels means the domain tuning has eroded. Empirically
        # the two packs share well under a third of their descriptive
        # labels — we tolerate up to 5 deliberate overlaps.
        assert len(overlap) <= 5, (
            f"GLiNER label_text overlap between media and congress is too "
            f"large ({len(overlap)}) — domain tuning may be eroded:\n"
            f"  {sorted(overlap)}"
        )

    def test_shared_amr_frames_propbank_invariant_agree(self):
        """For AMR frames that appear in BOTH media and congress packs,
        assert that the PropBank-invariant frames map to the same canonical
        predicate. Domain-shaped frames (where the conventional sense
        differs between political speech and legislative procedure) are
        printed as informational divergences, not failed.

        ``have-org-role-91`` is the canonical PropBank-invariant frame —
        its AMR semantics (person ↔ org ↔ role) are universal. Disagreement
        there is a real contract bug.
        """
        media = _load_media_pack()
        congress = _load_congress_pack()
        media_frames = media.amr_frames.frames
        congress_frames = congress.amr_frames.frames
        shared = set(media_frames) & set(congress_frames)
        assert shared, "expected at least one shared frame across packs"

        # Frames where the AMR semantics are universal across domains. If
        # these disagree, the projection node will emit inconsistent
        # canonical predicates for the same AMR graph.
        propbank_invariant = {"have-org-role-91"}

        invariant_conflicts: dict[str, tuple[str, str]] = {}
        domain_divergences: dict[str, tuple[str, str]] = {}
        for frame in sorted(shared):
            m_pred = media_frames[frame]
            c_pred = congress_frames[frame]
            if m_pred == c_pred:
                continue
            if frame in propbank_invariant:
                invariant_conflicts[frame] = (m_pred, c_pred)
            else:
                domain_divergences[frame] = (m_pred, c_pred)

        # Informational: print domain-shaped divergences so reviewers see
        # what frames have different conventional senses across packs.
        if domain_divergences:
            print(
                "\nAMR frames with domain-shaped predicate divergence "
                "(media → media-pred, congress → congress-pred):"
            )
            for frame, (m, c) in domain_divergences.items():
                print(f"  {frame}: media={m!r}, congress={c!r}")

        # Hard assertion: PropBank-invariant frames must agree across packs.
        assert not invariant_conflicts, (
            f"PropBank-invariant AMR frames disagree on canonical predicate "
            f"across media and congress packs: {invariant_conflicts}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Tier 4 — Scenario tests
# ─────────────────────────────────────────────────────────────────────────────
class TestTier4Scenario:
    """End-to-end regex-layer exercises against real transcript snippets
    from the media ``mention_extraction.prompt`` examples."""

    def test_scenario_example1_geopolitical_meeting(self):
        """Example 1 paragraph: SPEAKER label + persons + GPEs + a date.
        Assert exactly one SPEAKER match (SPEAKER_00) and ZERO bill / PL
        matches. Confirm canonical_types covers all the entity types the
        prompt example labels."""
        pack = _load_media_pack()
        text = (
            "[SPEAKER_00] So President Biden met with Xi Jinping in San "
            "Francisco last November to discuss Taiwan."
        )
        # SPEAKER regex — exactly one hit, exactly on SPEAKER_00.
        speaker_rx = _compile(pack.regex.patterns["SPEAKER"])
        hits = [m.group() for rx in speaker_rx for m in rx.finditer(text)]
        assert hits == ["SPEAKER_00"], (
            f"expected exactly one SPEAKER_00 match, got {hits}"
        )

        # Congress patterns must be silent on this sentence.
        congress = _load_congress_pack()
        bill_rx = _compile(congress.regex.patterns["BILL"])
        pl_rx = _compile(congress.regex.patterns["PUBLIC_LAW"])
        assert not _fires(bill_rx, text)
        assert not _fires(pl_rx, text)

        # Canonical-type coverage check: the prompt example labels
        # PERSON, GPE, DATE entities — assert all three are in the pack's
        # canonical_types universe so the consensus voter has a route for
        # each.
        for required in ("PERSON", "GPE", "DATE", "SPEAKER"):
            assert required in pack.canonical_types

    def test_scenario_example2_markets_no_spurious_money(self):
        """Example 2 paragraph references ``25 basis points`` and ``2%`` but
        has no $-prefixed amount. MONEY regex must NOT spuriously fire, and
        FINANCIAL_INSTRUMENT must be a canonical type so S&P 500 routes
        correctly."""
        pack = _load_media_pack()
        text = (
            "[SPEAKER_01] The Federal Reserve raised interest rates by 25 "
            "basis points. Wall Street reacted negatively, with the S&P 500 "
            "dropping 2%."
        )
        money_rx = _compile(pack.regex.patterns["MONEY"])
        assert not _fires(money_rx, text), (
            "MONEY regex spuriously matched a non-$-prefixed amount"
        )
        # Sanity: SPEAKER regex still fires on the diarizer label.
        speaker_rx = _compile(pack.regex.patterns["SPEAKER"])
        assert _fires(speaker_rx, text)
        # FINANCIAL_INSTRUMENT is a first-class canonical type for routing
        # the S&P 500 mention.
        assert "FINANCIAL_INSTRUMENT" in pack.canonical_types


# ─────────────────────────────────────────────────────────────────────────────
# Helpers for NuExtract template path walking
# ─────────────────────────────────────────────────────────────────────────────
_STRING_LEAF_TYPES = {"verbatim-string", "string", "date-time", "date"}


def _collect_template_paths(template: dict) -> set[str]:
    """Walk the NuExtract template and return the dotted leaf paths.

    Encoding:
      - Dict keys join with ``.``
      - List-of-objects entries: ``key[].subkey``
      - List-of-scalars entries: ``key[]`` itself is the leaf path
    """
    out: set[str] = set()

    def walk(node, prefix: str):
        if isinstance(node, dict):
            for k, v in node.items():
                sub = f"{prefix}.{k}" if prefix else k
                walk(v, sub)
        elif isinstance(node, list):
            if not node:
                # Empty list — treat as a scalar-list leaf for completeness.
                out.add(f"{prefix}[]")
                return
            first = node[0]
            if isinstance(first, dict):
                # List of objects: each subkey is a "<prefix>[].<subkey>" leaf.
                for k, v in first.items():
                    sub = f"{prefix}[].{k}"
                    walk(v, sub)
            else:
                # List of scalars: prefix[] is itself the leaf.
                out.add(f"{prefix}[]")
        else:
            # Scalar leaf — record the path itself.
            out.add(prefix)

    walk(template, "")
    return out


def _collect_string_leaf_paths(template: dict) -> set[str]:
    """Walk the template and return leaf paths whose declared type is one of
    ``verbatim-string`` / ``string`` / ``date-time`` / ``date`` — i.e. the
    leaves that emit entity-like text and therefore need a canonical-type
    mapping."""
    out: set[str] = set()

    def walk(node, prefix: str):
        if isinstance(node, dict):
            for k, v in node.items():
                sub = f"{prefix}.{k}" if prefix else k
                walk(v, sub)
        elif isinstance(node, list):
            if not node:
                return
            first = node[0]
            if isinstance(first, dict):
                for k, v in first.items():
                    sub = f"{prefix}[].{k}"
                    walk(v, sub)
            else:
                # List of scalars: the leaf type is the scalar's value (e.g.
                # "verbatim-string"). Path is "<prefix>[]".
                if isinstance(first, str) and first in _STRING_LEAF_TYPES:
                    out.add(f"{prefix}[]")
        else:
            if isinstance(node, str) and node in _STRING_LEAF_TYPES:
                out.add(prefix)

    walk(template, "")
    return out
