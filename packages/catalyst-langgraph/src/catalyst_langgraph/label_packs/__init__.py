"""Label packs — domain-tailored prompt artifacts for the NER ensemble.

A LabelPack is a single YAML file expressing the same canonical entity
taxonomy in each ensemble encoder's native prompting idiom:

  - GLiNER: a list of descriptive natural-language labels.
  - NuExtract: a typed JSON template (verbatim-string, enums, nested objects).
  - UniversalNER: a list of one-type-per-turn conversational probe queries.
  - Regex: deterministic patterns for format-validated identifiers.

Each section maps its native label namespace back to a canonical type universe
so the consensus voter can align spans across encoders.

Usage:

    from catalyst_langgraph.label_packs import load_label_pack

    pack = load_label_pack("k8s/congress-data/prompts", "congress")
    client = GLiNERClient(label_pack=pack)

When ``label_pack`` is omitted, encoder clients fall back to the bundled
``generic`` pack (the equivalent of the previous hardcoded label maps).
"""

from __future__ import annotations

from catalyst_langgraph.label_packs.loader import (
    GENERIC_PACK_NAME,
    LabelPack,
    load_generic_label_pack,
    load_label_pack,
)

__all__ = [
    "GENERIC_PACK_NAME",
    "LabelPack",
    "load_generic_label_pack",
    "load_label_pack",
]
