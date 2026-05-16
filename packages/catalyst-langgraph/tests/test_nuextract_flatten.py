"""Tests for the nested-template flattening in nuextract.py.

This is the trickiest behavior change: nested NuExtract output (sponsor →
{Name, State, Party}) must flatten to per-canonical-type mentions, and
typed leaves (integers, dates) must NOT be emitted as spans.
"""

from __future__ import annotations

from catalyst_langgraph.clients.nuextract import (
    _flatten_nuextract_output,
    _walk_template_paths,
)


def test_walk_template_paths_flat():
    template = {"Person": ["verbatim-string"], "Money": ["verbatim-string"]}
    paths = _walk_template_paths(template)
    assert paths == {"Person": "Person", "Money": "Money"}


def test_walk_template_paths_nested():
    template = {
        "Bill": {
            "BillNumber": "verbatim-string",
            "Sponsor": {"Name": "verbatim-string", "State": "verbatim-string"},
            "Cosponsors": [{"Name": "verbatim-string", "State": "verbatim-string"}],
        },
    }
    paths = _walk_template_paths(template)
    assert "Bill.BillNumber" in paths
    assert "Bill.Sponsor.Name" in paths
    assert "Bill.Sponsor.State" in paths
    assert "Bill.Cosponsors[].Name" in paths
    assert "Bill.Cosponsors[].State" in paths


def test_flatten_nested_sponsor_output():
    parsed = {
        "Bill": {
            "BillNumber": "H.R. 1234",
            "Sponsor": {"Name": "Rep. Smith", "State": "NY"},
            "Cosponsors": [{"Name": "Rep. Jones", "State": "TX"}],
        }
    }
    canonical_map = {
        "Bill.BillNumber": "BILL",
        "Bill.Sponsor.Name": "PERSON",
        "Bill.Sponsor.State": "GPE",
        "Bill.Cosponsors[].Name": "PERSON",
        "Bill.Cosponsors[].State": "GPE",
    }
    text = "Rep. Smith from NY introduced H.R. 1234 with Rep. Jones from TX."
    mentions = _flatten_nuextract_output(parsed, canonical_map, text)
    by_text = {m["text"]: m for m in mentions.values()}

    assert by_text["H.R. 1234"]["mention_type"] == "BILL"
    assert by_text["Rep. Smith"]["mention_type"] == "PERSON"
    assert by_text["Rep. Jones"]["mention_type"] == "PERSON"
    # Both NY and TX → GPE
    states = [m for m in mentions.values() if m["mention_type"] == "GPE"]
    assert {s["text"] for s in states} == {"NY", "TX"}


def test_flatten_drops_typed_leaves():
    """Integer/null leaves (YeaCount, NayCount) shouldn't become spans."""
    parsed = {
        "RollCallVotes": [
            {"RollCallNumber": "412", "YeaCount": 218, "NayCount": 212, "Result": "Passed"}
        ]
    }
    canonical_map = {
        "RollCallVotes[].RollCallNumber": "ROLL_CALL_VOTE",
        "RollCallVotes[].YeaCount": "VOTE_RESULT",
        "RollCallVotes[].NayCount": "VOTE_RESULT",
        "RollCallVotes[].Result": "VOTE_RESULT",
    }
    text = "Roll No. 412: 218-212, Passed."
    mentions = _flatten_nuextract_output(parsed, canonical_map, text)
    # Strings flow through, integers don't
    assert any(m["text"] == "412" for m in mentions.values())
    assert any(m["text"] == "Passed" for m in mentions.values())
    # 218 and 212 are integers in parsed dict — should NOT be emitted
    integer_emissions = [m for m in mentions.values() if m["text"] in ("218", "212")]
    assert integer_emissions == []


def test_flatten_handles_list_of_strings():
    parsed = {"Bill": {"ReferredToCommittees": ["Committee on Energy", "Committee on Finance"]}}
    canonical_map = {"Bill.ReferredToCommittees[]": "COMMITTEE_REF"}
    text = "Referred to Committee on Energy, then Committee on Finance."
    mentions = _flatten_nuextract_output(parsed, canonical_map, text)
    assert {m["text"] for m in mentions.values()} == {
        "Committee on Energy",
        "Committee on Finance",
    }
    assert all(m["mention_type"] == "COMMITTEE_REF" for m in mentions.values())


def test_flatten_unknown_path_defaults_to_other():
    parsed = {"Mystery": "unknown thing"}
    mentions = _flatten_nuextract_output(parsed, canonical_type_map={}, raw_text="unknown thing")
    assert any(m["mention_type"] == "OTHER" for m in mentions.values())
