"""
Unit + property/invariant tests for the V2.3A deterministic reference-grounding guard
(task §21/§22). None of these depend on Qwen or on the 71/12/12 validation strings
(task §23) — every fixture here is a hand-built sentence exercising one invariant.

Run: training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/test_reference_grounding_guard.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference_grounding_guard import (  # noqa: E402
    validate_reference_grounding,
    REFERENCE_NOT_APPLICABLE, REFERENCE_GROUNDED_UNIQUE, REFERENCE_EXPLICIT_TARGET,
    REFERENCE_NO_VISIBLE_TARGET, REFERENCE_MULTIPLE_VISIBLE_TARGETS,
)

PASS = 0
FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"FAIL: {name} {detail}")


def interp(**overrides) -> dict:
    base = {
        "primaryIntent": "REVISE_WORKFLOW", "entities": [], "corrections": [],
        "references": [], "goalSignals": [], "negations": [], "ambiguities": [],
        "clarificationRequired": False, "confidence": 0.8, "source": "LLM",
        "requestedAction": "REVISE",
    }
    base.update(overrides)
    return base


# ──────────────────────────────── §21 unit tests ────────────────────────────────

def test_zero_candidate():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "cai do"}]),
        "Doi cai do giup toi.",
    )
    check("zero_candidate: activated", res.activated is True)
    check("zero_candidate: references cleared", res.interpretation["references"] == [])
    check("zero_candidate: clarificationRequired", res.interpretation["clarificationRequired"] is True)
    check("zero_candidate: reason", res.decisions[0].reason == REFERENCE_NO_VISIBLE_TARGET)


def test_one_candidate():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "bai do"}]),
        "Deadlift hom qua nang qua, bot ta bai do di.",
    )
    check("one_candidate: not activated", res.activated is False)
    check("one_candidate: reference kept", len(res.interpretation["references"]) == 1)
    check("one_candidate: reason", res.decisions[0].reason == REFERENCE_GROUNDED_UNIQUE)


def test_multiple_candidates_no_disambiguator():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "cai do"}]),
        "Bench va deadlift deu nang, bot cai do lai.",
    )
    check("multiple_no_disambig: activated", res.activated is True)
    check("multiple_no_disambig: reason", res.decisions[0].reason == REFERENCE_MULTIPLE_VISIBLE_TARGETS)


def test_explicit_named_target():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "deadlift"}]),
        "Doi sang bai deadlift giup toi.",
    )
    check("explicit_named: not activated", res.activated is False)
    check("explicit_named: reason", res.decisions[0].reason == REFERENCE_EXPLICIT_TARGET)


def test_type_mismatch():
    # a PT-domain deictic with zero PT candidates, even though an exercise candidate
    # is visible elsewhere in the message (task §14 — must not cross-resolve).
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "huan luyen vien kia"}]),
        "Squat hom qua on, doi huan luyen vien kia di.",
    )
    check("type_mismatch: activated", res.activated is True)
    check("type_mismatch: domain is PT", res.decisions[0].domain == "PT")


def test_same_message_unique_reference():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "cai do"}]),
        "Chuong trinh giam mo vua xem on do, lay cai do cho toi.",
    )
    check("same_message_unique: not activated", res.activated is False)
    check("same_message_unique: reason", res.decisions[0].reason == REFERENCE_GROUNDED_UNIQUE)


def test_numeric_single_candidate():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "muc do"}]),
        "Muc 70 nang qua, giam muc do xuong.",
    )
    check("numeric_single: not activated", res.activated is False)


def test_numeric_multiple_candidates():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "muc do"}]),
        "Muc 70 va muc 80 deu duoc, lay muc do.",
    )
    check("numeric_multiple: activated", res.activated is True)
    check("numeric_multiple: reason", res.decisions[0].reason == REFERENCE_MULTIPLE_VISIBLE_TARGETS)


def test_non_reference_query_untouched():
    res = validate_reference_grounding(interp(references=[], primaryIntent="PROVIDE_INFORMATION"), "Toi cao 170cm.")
    check("non_reference: not activated", res.activated is False)
    check("non_reference: no decisions", res.decisions == [])


def test_unguarded_kind_passthrough():
    # ACCEPT_PROPOSAL already has its own grounding authority in policy.ts (ci.proposal) —
    # this guard must not touch it (would duplicate/conflict with existing authority).
    res = validate_reference_grounding(
        interp(references=[{"kind": "ACCEPT_PROPOSAL", "sourceText": "muc do"}]),
        "Lay muc do cho toi.",
    )
    check("unguarded_kind: not activated", res.activated is False)
    check("unguarded_kind: reason", res.decisions[0].reason == REFERENCE_NOT_APPLICABLE)


# ──────────────────────────────── §22 property/invariant tests ────────────────────────────────

def test_property_unrelated_candidate_does_not_invalidate_unique_target():
    # sourceText carries its own domain (EXERCISE, via "bai") so this isolates task
    # §14 type-compatibility specifically: a same-message PT candidate of a DIFFERENT
    # domain must never count against an EXERCISE-domain reference's candidate pool.
    # (A GENERIC/no-domain deictic's pool legitimately grows with ANY new nameable
    # candidate — that is covered separately by test_type_mismatch / the GENERIC path,
    # not this property.)
    base_msg = "Deadlift hom qua nang qua, bot ta bai do di."
    res_before = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "bai do"}]), base_msg)
    msg_with_unrelated = base_msg + " Doi huan luyen vien Lan giup toi."
    res_after = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "bai do"}]), msg_with_unrelated)
    check("property_unrelated_candidate: still grounded", res_before.activated is False and res_after.activated is False,
          f"before={res_before.activated} after={res_after.activated}")


def test_property_second_compatible_candidate_prevents_resolution():
    res_one = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "cai do"}]), "Deadlift nang, bot cai do di.")
    res_two = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "cai do"}]), "Deadlift va bench deu nang, bot cai do di.")
    check("property_second_candidate: one->grounded", res_one.activated is False)
    check("property_second_candidate: two->invalidated", res_two.activated is True)


def test_property_removing_only_candidate_prevents_grounding():
    res_with = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "cai do"}]), "Deadlift nang, bot cai do di.")
    res_without = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "cai do"}]), "Bot cai do di.")
    check("property_removing_candidate: with->grounded", res_with.activated is False)
    check("property_removing_candidate: without->invalidated", res_without.activated is True)


def test_property_explicit_unique_target_always_resolvable():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "squat"}]),
        "Doi squat sang leg press di.",  # 2 candidates visible, but reference names itself explicitly
    )
    check("property_explicit_unique: not activated despite 2 visible candidates", res.activated is False)


def test_property_explicit_disambiguator_collapses_multiple_to_one():
    res = validate_reference_grounding(
        interp(references=[{"kind": "THIS_ITEM", "sourceText": "bai kia"}]),
        "Giua squat va leg press thi giu squat, doi bai kia.",
    )
    check("property_disambiguator: collapses to grounded", res.activated is False,
          f"decisions={res.decisions}")


ALL_TESTS = [
    test_zero_candidate, test_one_candidate, test_multiple_candidates_no_disambiguator,
    test_explicit_named_target, test_type_mismatch, test_same_message_unique_reference,
    test_numeric_single_candidate, test_numeric_multiple_candidates,
    test_non_reference_query_untouched, test_unguarded_kind_passthrough,
    test_property_unrelated_candidate_does_not_invalidate_unique_target,
    test_property_second_compatible_candidate_prevents_resolution,
    test_property_removing_only_candidate_prevents_grounding,
    test_property_explicit_unique_target_always_resolvable,
    test_property_explicit_disambiguator_collapses_multiple_to_one,
]

if __name__ == "__main__":
    for t in ALL_TESTS:
        t()
    print(f"\n{PASS} passed, {FAIL} failed, {len(ALL_TESTS)} test functions")
    sys.exit(1 if FAIL else 0)
