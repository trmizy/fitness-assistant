"""
V2.3A.1 — PT/HLV deictic gold-consistency audit. Reads only (no gold/evaluator/
guard edits). Builds the full case-level audit table + cross-dataset matrix +
conflict summary as machine-readable artifacts under
training/semantic-qwen3-4b/outputs/v2.3a1-pt-deictic-gold-audit/.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from reference_grounding_guard import validate_reference_grounding  # noqa: E402

BASE = ROOT.parent


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def user_text(row: dict) -> str:
    for m in row["messages"]:
        if m["role"] == "user":
            return m["content"]
    return ""


DATASETS = {
    "A_v2_validation": ("validation", BASE / "datasets/processed/v2/validation.jsonl"),
    "B_v21_train_additions": ("train", BASE / "datasets/raw/v2.1/train_additions.jsonl"),
    "C_v21_validation_remediation": ("validation", BASE / "datasets/raw/v2.1/validation_remediation.jsonl"),
    "D_v22_train_remediation": ("train", BASE / "datasets/raw/v2.2/train_remediation.jsonl"),
    "E_v22_dev_challenge": ("dev_challenge", BASE / "datasets/raw/v2.2/dev_challenge.jsonl"),
}

PREDICTIONS = {
    "A_v2_validation": BASE / "outputs/train/qlora-baseline-v2.1/eval/predictions.jsonl",
    "C_v21_validation_remediation": BASE / "outputs/train/qlora-baseline-v2.1/eval_remediation/predictions.jsonl",
    "E_v22_dev_challenge": BASE / "outputs/train/qlora-baseline-v2.1/eval_devchallenge/predictions.jsonl",
}

# Manually curated from the dataset scan in this task's own transcript (every row
# found by two independent sweeps: deictic+PT-word co-occurrence, and PT-word-only).
# "NA" rows are included explicitly so the completeness of the sweep is auditable.
CASES = [
    # dataset, caseId, explicitNamed, antecedentCount, antecedentDesc, classification, notes
    ("A_v2_validation", "ambiguity-pt-switch-no-proposal-1", False, 0, "none", "GOLD_CONFLICT",
     "Conflicts directly with reference-this-item-pt-price-1/2 (same dataset, same zero-antecedent condition, opposite clarificationRequired). Gold KEEPS a references[] entry while marking unresolved -- a different representation convention than D/E's references=[] style; see EVALUATOR_REVIEW_CANDIDATE note in report S9."),
    ("A_v2_validation", "ambiguity-pt-switch-no-proposal-2", False, 0, "none", "GOLD_CONFLICT",
     "Same family as -1. Model's actual V2.1 prediction here uses an invented kind ALTERNATIVE_ITEM (schema-invalid) -- a separate, pre-existing issue unrelated to this policy question."),
    ("A_v2_validation", "reference-this-item-pt-price-1", False, 0, "none", "GOLD_CONFLICT",
     "Zero antecedent ('Người kia giá sao?') but gold resolves confidently (ANSWER_QUESTION, clarif=false). Directly conflicts with ambiguity-pt-switch-no-proposal-1/2 in the SAME original V2 validation file -- this conflict predates V2.1 entirely."),
    ("A_v2_validation", "reference-this-item-pt-price-2", False, 0, "none", "GOLD_CONFLICT",
     "Same family as price-1 ('PT kia giá bao nhiêu'). V2.1's own prediction here already matches gold's confident style on the intent/clarification axis, missing only the reference entry itself."),
    ("A_v2_validation", "intent-recommend-pt-confusable-1", False, None, "n/a - recommendation request, no deixis", "NOT_APPLICABLE", "'PT nào hợp với tôi?' is an open recommendation question, not an anaphoric reference."),
    ("A_v2_validation", "intent-recommend-pt-confusable-2", False, None, "n/a", "NOT_APPLICABLE", "'đổi PT được không?' -- generic switch-possibility question, no deictic target at all."),
    ("A_v2_validation", "intent-recommend-pt-confusable-3", False, None, "n/a", "NOT_APPLICABLE", "'PT nào phù hợp hơn?' -- recommendation question."),
    ("A_v2_validation", "reference-pt-current-state-read-1", False, None, "n/a - direct state query", "NOT_APPLICABLE", "'Huấn luyện viên hiện tại của tôi là ai vậy?' asks the system to READ a business fact; refs=[] in gold -- not a deictic reference needing grounding at all."),
    ("A_v2_validation", "reference-pt-current-state-read-2", False, None, "n/a", "NOT_APPLICABLE", "Same as above."),
    ("A_v2_validation", "intent-find-pt-1", False, None, "n/a", "NOT_APPLICABLE", "Generic PT-discovery request, no deixis."),
    ("A_v2_validation", "intent-find-pt-2", False, None, "n/a", "NOT_APPLICABLE", "'Tìm PT cho tôi.' -- no deixis."),
    ("A_v2_validation", "intent-find-pt-3", False, None, "n/a", "NOT_APPLICABLE", "Same family."),
    ("A_v2_validation", "safety-request-coach-impersonation-1", False, None, "n/a", "NOT_APPLICABLE", "Impersonation/safety test, not a reference-grounding case."),
    ("A_v2_validation", "safety-request-coach-impersonation-2", False, None, "n/a", "NOT_APPLICABLE", "Same family."),

    ("B_v21_train_additions", "ref-this-item-pt-revise-1", False, 0, "none ('PT này' = proximal/'current')", "GOLD_CONFLICT",
     "Zero textual antecedent, gold resolves confidently. 'này' (proximal) may intend 'my CURRENTLY-assigned PT' -- a real persisted-state fact, but InterpretContext.persisted has no currentPT/assignedCoach field, so this is NOT actually visible-context-groundable either -- see HIDDEN_CONTEXT_DEPENDENCY in report S5/S15."),
    ("B_v21_train_additions", "ref-this-item-pt-revise-2", False, 0, "none ('PT này', 'người khác' also unnamed)", "GOLD_CONFLICT", "Same family; the switch TARGET ('người khác') is also unnamed."),
    ("B_v21_train_additions", "ref-this-item-pt-revise-3", False, 0, "none ('PT kia')", "GOLD_CONFLICT", "Same family, distal 'kia' this time -- rules out a clean này-only explanation for this family (see report S6)."),
    ("B_v21_train_additions", "ref-this-item-person-ask-price-1", False, 0, "none ('Người kia')", "GOLD_CONFLICT", "Price-question analog of A's price-family; conflicts with D's v22-deictic-no-target-2 (near-identical phrasing, opposite gold)."),
    ("B_v21_train_additions", "ref-this-item-person-ask-price-2", False, 0, "none ('Người này')", "GOLD_CONFLICT", "Same family, proximal 'này'."),
    ("B_v21_train_additions", "ref-this-item-pt-switch-corrected-1", False, 0, "none ('PT này')", "GOLD_CONFLICT", "Deliberately designed in V2.1 to match detectReferences()'s unconditional match -- see report S7."),
    ("B_v21_train_additions", "ref-this-item-pt-switch-corrected-2", False, 0, "none ('PT kia')", "GOLD_CONFLICT", "Same family, distal."),
    ("B_v21_train_additions", "ref-this-item-pt-switch-corrected-3", False, 0, "none ('PT đó')", "GOLD_CONFLICT", "Same family, distal."),
    ("B_v21_train_additions", "enum-ask-recommendation-pt-v2-1", False, None, "n/a", "NOT_APPLICABLE", "Recommendation request, no deixis."),
    ("B_v21_train_additions", "enum-ask-recommendation-pt-v2-2", False, None, "n/a", "NOT_APPLICABLE", "'đây' here is a discourse-final particle ('...PT nào đây?' = 'which PT, huh'), not a deictic anaphor -- confirmed a false positive from the initial keyword sweep."),
    ("B_v21_train_additions", "enum-ask-recommendation-pt-v2-3", False, None, "n/a", "NOT_APPLICABLE", "Recommendation request."),
    ("B_v21_train_additions", "enum-ask-recommendation-pt-v2-4", False, None, "n/a", "NOT_APPLICABLE", "Recommendation request."),
    ("B_v21_train_additions", "revision-change-pt-session-count-v2-1", False, None, "n/a - generic 'PT' noun, no deixis", "NOT_APPLICABLE", "'với PT' here is a plain generic noun phrase, not an anaphoric reference."),
    ("B_v21_train_additions", "revision-change-pt-session-count-v2-2", False, None, "n/a", "NOT_APPLICABLE", "Same family."),

    ("C_v21_validation_remediation", "ref-this-item-pt-switch-val-1", False, 0, "none ('PT kia')", "GOLD_CONFLICT", "Validation twin of B's switch-corrected family; one of V2.3A's 2 harmful guard corrections on this set."),
    ("C_v21_validation_remediation", "ref-this-item-pt-switch-val-2", False, 0, "none ('PT này')", "GOLD_CONFLICT", "Same family; the other of V2.3A's 2 harmful corrections."),
    ("C_v21_validation_remediation", "enum-ask-recommendation-val-1", False, None, "n/a", "NOT_APPLICABLE", "Recommendation request."),
    ("C_v21_validation_remediation", "enum-ask-recommendation-val-2", False, None, "n/a", "NOT_APPLICABLE", "Recommendation request."),

    ("D_v22_train_remediation", "v22-deictic-no-target-2", False, 0, "none ('Người đó')", "GOLD_CONFLICT",
     "Near-identical phrasing and intent-shape to B's ref-this-item-person-ask-price-1 ('Người kia giá bao nhiêu?' vs 'Người đó tính phí sao?') -- same question-type, opposite gold. Cleanest single conflict pair found in this audit; also refutes an intent-class-based (ANSWER_QUESTION-is-always-exempt) explanation."),
    ("D_v22_train_remediation", "v22-multiple-visible-targets-2", True, 2, "'PT Lan' and 'PT Minh' both named", "GOLD_CONSISTENT", "2 named candidates, singular deictic picks neither -- correctly unresolved, matches proposed CASE C."),
    ("D_v22_train_remediation", "v22-pt-switch-no-antecedent-1", False, 0, "none", "GOLD_CONFLICT", "Conflicts with B/C's switch-corrected/val family."),
    ("D_v22_train_remediation", "v22-pt-switch-no-antecedent-2", False, 0, "none", "GOLD_CONFLICT", "Same family."),
    ("D_v22_train_remediation", "v22-pt-switch-no-antecedent-3", False, 0, "none", "GOLD_CONFLICT", "Same family."),
    ("D_v22_train_remediation", "v22-backreference-same-message-2", True, 1, "'PT Minh' named earlier in the same message", "GOLD_CONSISTENT",
     "1 unique named antecedent, deictic backreference resolves to it -- matches proposed CASE A. DATA QUALITY note (not a policy issue): gold references[0].sourceText is literally 'bài đó' (copy-paste artifact from a different family's template) instead of 'người đó' -- reference_correct() only checks (kind,ordinal), so this does not affect scoring, but should be fixed whenever this file is next touched for any other reason."),
    ("D_v22_train_remediation", "v22-explicit-named-target-2", True, 1, "'PT Lan' named directly, no deixis", "GOLD_CONSISTENT", "Explicit naming, no reference entry needed at all -- matches proposed CASE D."),

    ("E_v22_dev_challenge", "v22dev-pt-switch-no-antecedent-1", False, 0, "none", "GOLD_CONFLICT",
     "Conflicts with B/C's switch-corrected/val family. One of V2.3A's 3 BENEFICIAL guard corrections on this set (guard sides with this row's convention)."),
    ("E_v22_dev_challenge", "v22dev-pt-switch-no-antecedent-2", False, 0, "none", "GOLD_CONFLICT", "Same family; also a V2.3A beneficial correction."),
]


def main() -> None:
    out_dir = BASE / "outputs/v2.3a1-pt-deictic-gold-audit"
    out_dir.mkdir(parents=True, exist_ok=True)

    gold_by_dataset = {name: {r["caseId"]: r for r in load_jsonl(path)} for name, (_, path) in DATASETS.items()}
    preds_by_dataset = {name: {p["caseId"]: p for p in load_jsonl(path)} for name, path in PREDICTIONS.items()}

    rows_out = []
    for dataset, case_id, explicit_named, antecedent_count, antecedent_desc, classification, notes in CASES:
        split, _ = DATASETS[dataset]
        gold_row = gold_by_dataset[dataset].get(case_id)
        if gold_row is None:
            raise SystemExit(f"case not found in dataset file: {dataset}/{case_id}")
        msg = user_text(gold_row)
        target = gold_row["target"]

        model_pred = None
        guard_decision = None
        evaluator_result = None
        preds = preds_by_dataset.get(dataset)
        if preds and case_id in preds:
            p = preds[case_id]
            model_pred = p.get("rawText")
            evaluator_result = {
                "referenceCorrect": p.get("referenceCorrect"),
                "ambiguityCorrect": p.get("ambiguityCorrect"),
                "errorBuckets": p.get("errorBuckets"),
            }
            try:
                parsed = json.loads(p["rawText"]) if p.get("rawText") else None
            except Exception:
                parsed = None
            if parsed is not None:
                res = validate_reference_grounding(parsed, msg)
                guard_decision = {
                    "activated": res.activated,
                    "reasons": [d.reason for d in res.decisions],
                }

        rows_out.append({
            "dataset": dataset,
            "split": split,
            "caseId": case_id,
            "familyId": gold_row.get("templateFamily"),
            "userText": msg,
            "explicitNamed": explicit_named,
            "visibleAntecedentCount": antecedent_count,
            "visibleAntecedentDescription": antecedent_desc,
            "goldReferences": target.get("references"),
            "goldClarificationRequired": target.get("clarificationRequired"),
            "goldPrimaryIntent": target.get("primaryIntent"),
            "goldAmbiguities": target.get("ambiguities"),
            "modelV21PredictionRaw": model_pred,
            "guardDecision": guard_decision,
            "evaluatorResult": evaluator_result,
            "auditClassification": classification,
            "notes": notes,
        })

    (out_dir / "pt_deictic_case_audit.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows_out) + "\n", encoding="utf-8")

    by_class: dict[str, int] = {}
    by_dataset_class: dict[str, dict[str, int]] = {}
    for r in rows_out:
        c = r["auditClassification"]
        by_class[c] = by_class.get(c, 0) + 1
        by_dataset_class.setdefault(r["dataset"], {}).setdefault(c, 0)
        by_dataset_class[r["dataset"]][c] += 1

    conflict_summary = {
        "totalCasesAudited": len(rows_out),
        "byClassification": by_class,
        "byDatasetAndClassification": by_dataset_class,
        "conflictPairsIdentified": [
            {
                "campUnresolved": ["ambiguity-pt-switch-no-proposal-1", "ambiguity-pt-switch-no-proposal-2",
                                    "v22-deictic-no-target-2", "v22-pt-switch-no-antecedent-1", "v22-pt-switch-no-antecedent-2",
                                    "v22-pt-switch-no-antecedent-3", "v22dev-pt-switch-no-antecedent-1", "v22dev-pt-switch-no-antecedent-2"],
                "campResolved": ["reference-this-item-pt-price-1", "reference-this-item-pt-price-2",
                                  "ref-this-item-pt-revise-1", "ref-this-item-pt-revise-2", "ref-this-item-pt-revise-3",
                                  "ref-this-item-person-ask-price-1", "ref-this-item-person-ask-price-2",
                                  "ref-this-item-pt-switch-corrected-1", "ref-this-item-pt-switch-corrected-2", "ref-this-item-pt-switch-corrected-3",
                                  "ref-this-item-pt-switch-val-1", "ref-this-item-pt-switch-val-2"],
                "finding": "Two camps, not three sequential generations. campUnresolved and campResolved BOTH include rows from the original V2 validation file (ambiguity-pt-switch-no-proposal vs reference-this-item-pt-price) -- this conflict predates V2.1. V2.1 EXPANDED campResolved (did not introduce it); V2.2A EXPANDED campUnresolved (did not invent a third position).",
                "ruledOutExplanations": [
                    "deictic word (này vs đó/kia): refuted -- đó/kia appear on BOTH camps; này appears only in campResolved but that alone doesn't explain the đó/kia overlap",
                    "intent class (ANSWER_QUESTION exempt from grounding): refuted by v22-deictic-no-target-2 vs ref-this-item-person-ask-price-1/2 -- same question-type ('price of that person'), opposite gold",
                ],
            }
        ],
    }
    (out_dir / "conflict_summary.json").write_text(json.dumps(conflict_summary, indent=2, ensure_ascii=False), encoding="utf-8")

    cross_matrix = [
        {"condition": "Explicit PT name stated", "v2_original": "n/a (no case found)", "v21_remediation": "n/a (no case found)",
         "v22a_dev_or_train": "RESOLVED, no references[] entry (v22-explicit-named-target-2)", "canonical_proposal": "RESOLVED", "conflict": False},
        {"condition": "Exactly one visible PT antecedent (named earlier in same message)", "v2_original": "n/a (no case found)",
         "v21_remediation": "n/a (no case found)", "v22a_dev_or_train": "RESOLVED (v22-backreference-same-message-2)",
         "canonical_proposal": "RESOLVED", "conflict": False},
        {"condition": "Zero visible PT antecedent", "v2_original": "SPLIT: ambiguity-pt-switch-no-proposal-*=UNRESOLVED vs reference-this-item-pt-price-*=RESOLVED",
         "v21_remediation": "RESOLVED (ref-this-item-pt-revise-*, ref-this-item-pt-switch-corrected-*, ref-this-item-person-ask-price-*, and validation twins)",
         "v22a_dev_or_train": "UNRESOLVED (v22-pt-switch-no-antecedent-*, v22-deictic-no-target-2, v22dev-pt-switch-no-antecedent-*)",
         "canonical_proposal": "UNRESOLVED", "conflict": True},
        {"condition": "Multiple visible PT antecedents, no disambiguator", "v2_original": "n/a (no case found)",
         "v21_remediation": "n/a (no case found)", "v22a_dev_or_train": "UNRESOLVED (v22-multiple-visible-targets-2)",
         "canonical_proposal": "UNRESOLVED", "conflict": False},
    ]
    (out_dir / "cross_dataset_consistency.json").write_text(json.dumps(cross_matrix, indent=2, ensure_ascii=False), encoding="utf-8")

    canonical_policy = {
        "name": "PT_DEICTIC_POLICY_V1_PROPOSAL",
        "scope": "THIS_ITEM / PREVIOUS_STATE references whose domain is PT/HLV/coach",
        "rules": [
            {"id": 1, "condition": "Explicit named PT stated in the message", "resolution": "RESOLVED",
             "representation": "no references[] entry needed (nothing deictic to tag); entities/intent carry the name directly"},
            {"id": 2, "condition": "Exactly one visible PT antecedent (named elsewhere in the SAME message, backreference points to it)", "resolution": "RESOLVED",
             "representation": "references=[{kind: THIS_ITEM}], clarificationRequired=false"},
            {"id": 3, "condition": "Zero visible PT antecedents anywhere in the message", "resolution": "UNRESOLVED",
             "representation": "references=[] (never kept-but-flagged -- task §6/§17 bounded-correction convention), ambiguities=[{field:'reference',...}], clarificationRequired=true",
             "justification": "Matches the task's own visible-context-only invariant and the architecture constraint that a semantic parser must not invent hidden PT state (step 19). Chosen independent of historical prevalence (step 13) -- campResolved has MORE total rows (12) than campUnresolved (8), but row count is explicitly not evidence of correctness per this task's own instruction."},
            {"id": 4, "condition": "Multiple visible PT antecedents, no deterministic disambiguator", "resolution": "UNRESOLVED",
             "representation": "references=[], ambiguities=[{field:'reference',...}], clarificationRequired=true"},
            {"id": 5, "condition": "Hidden candidate/proposal/persisted-state dependency (e.g. 'PT này' meaning 'my currently-assigned PT', not a textual antecedent)",
             "resolution": "OUT OF SCOPE for this guard/schema as currently defined",
             "justification": "InterpretContext.persisted has no currentPT/assignedCoach field; grounding this would need a new, explicit field (schema change), not a reinterpretation of existing THIS_ITEM semantics. Flagged SCHEMA_REPRESENTATION_AMBIGUOUS, not silently folded into rule 2 or 3."},
        ],
        "matches_actual_input_contract": "yes -- interpreter.ts's real buildPrompt() sends only a fixed system instruction + optional expectedSlot + the current user message; no conversation history, no ci.proposal, no PT candidate list is visible to the semantic-interpretation step. This policy assumes nothing beyond that single visible message, consistent with policy.ts's own separate (and un-duplicated) ci.proposal-based grounding for ACCEPT_PROPOSAL/LOWER_OPTION/HIGHER_OPTION/MIDDLE_OPTION.",
        "rows_requiring_relabel_if_adopted": [
            "reference-this-item-pt-price-1", "reference-this-item-pt-price-2",
            "ref-this-item-pt-revise-1", "ref-this-item-pt-revise-2", "ref-this-item-pt-revise-3",
            "ref-this-item-person-ask-price-1", "ref-this-item-person-ask-price-2",
            "ref-this-item-pt-switch-corrected-1", "ref-this-item-pt-switch-corrected-2", "ref-this-item-pt-switch-corrected-3",
            "ref-this-item-pt-switch-val-1", "ref-this-item-pt-switch-val-2",
        ],
        "rows_already_consistent": [
            "ambiguity-pt-switch-no-proposal-1", "ambiguity-pt-switch-no-proposal-2",
            "v22-deictic-no-target-2", "v22-multiple-visible-targets-2",
            "v22-pt-switch-no-antecedent-1", "v22-pt-switch-no-antecedent-2", "v22-pt-switch-no-antecedent-3",
            "v22-backreference-same-message-2", "v22-explicit-named-target-2",
            "v22dev-pt-switch-no-antecedent-1", "v22dev-pt-switch-no-antecedent-2",
        ],
        "not_implemented_in_this_task": True,
    }
    (out_dir / "canonical_policy_proposal.json").write_text(json.dumps(canonical_policy, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(by_class, indent=2))
    print(json.dumps(by_dataset_class, indent=2))


if __name__ == "__main__":
    main()
