"""
V2.3A.2 — builds a VERSIONED canonical-policy evaluation view
(PT_DEICTIC_CANONICAL_POLICY_V1) over the 3 evaluation sets, WITHOUT ever
modifying the historical source dataset files. Historical gold files are
read-only inputs here; every output goes under
training/semantic-qwen3-4b/datasets/canonical-policy/pt-deictic-v1/.

Eligibility (task §8): a row is corrected iff ALL of:
  1. a PT/HLV deictic reference is actually present
  2. compatible visible PT antecedent count == 0
  3. gold currently expects confident resolution (clarificationRequired==False)
  4. resolution requires hidden/non-visible state (true for all zero-antecedent cases)
  5. V2.3A.1 classified it GOLD_CONFLICT

Re-derived directly from the V2.3A.1 audit artifact (not assumed) -- see
the printed counts, which must match the expected 12.

Minimal field mutation (task §11): only `references`, `clarificationRequired`,
`ambiguities`, `confidence` change. `primaryIntent`, `entities`, `corrections`,
`requestedAction`, `workflowIntent`, `goalSignals`, `negations` are left
untouched -- deliberately narrower than the historical "already-unresolved"
camp's own convention (which also collapsed primaryIntent to UNKNOWN), to
align exactly with the ALREADY-FROZEN guard's own bounded-correction
boundary (reference_grounding_guard.py's documented field list), so the
guard's output shape and the corrected gold's shape are directly comparable
without a second, unrelated source of mismatch.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent

AUDIT_PATH = BASE / "outputs/v2.3a1-pt-deictic-gold-audit/pt_deictic_case_audit.jsonl"

SOURCE_FILES = {
    "A_v2_validation": BASE / "datasets/processed/v2/validation.jsonl",
    "C_v21_validation_remediation": BASE / "datasets/raw/v2.1/validation_remediation.jsonl",
    "E_v22_dev_challenge": BASE / "datasets/raw/v2.2/dev_challenge.jsonl",
}

OUT_DIR = BASE / "datasets/canonical-policy/pt-deictic-v1"

REASON_TEXT = "chưa có PT/huấn luyện viên nào được nêu tên trong tin nhắn để tham chiếu tới"
CANONICAL_CONFIDENCE_FLOOR = 0.3


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    audit = load_jsonl(AUDIT_PATH)
    gold_conflict = [r for r in audit if r["auditClassification"] == "GOLD_CONFLICT"]
    eligible = [r for r in gold_conflict
                if r["visibleAntecedentCount"] == 0 and r["goldClarificationRequired"] is False]
    not_eligible = [r for r in gold_conflict if r not in eligible]

    print(f"GOLD_CONFLICT total (re-derived): {len(gold_conflict)}")
    print(f"Eligible for correction (re-derived): {len(eligible)}")
    print(f"Already policy-consistent (re-derived, 'unresolved' camp): {len(not_eligible)}")
    if len(eligible) != 12:
        raise SystemExit(f"STOP: expected 12 eligible rows, found {len(eligible)} -- "
                          f"re-check audit before applying corrections.")

    eligible_by_dataset: dict[str, set[str]] = {}
    for r in eligible:
        eligible_by_dataset.setdefault(r["dataset"], set()).add(r["caseId"])

    corrections_out = []
    hashes = {}
    for dataset_key, src_path in SOURCE_FILES.items():
        hashes[dataset_key + "_source_sha256"] = sha256_file(src_path)
        rows = load_jsonl(src_path)
        to_correct = eligible_by_dataset.get(dataset_key, set())
        corrected_rows = []
        for row in rows:
            if row["caseId"] not in to_correct:
                corrected_rows.append(row)
                continue
            original_target = row["target"]
            changed_fields = {}
            new_target = dict(original_target)

            if original_target.get("references"):
                changed_fields["references"] = {"from": original_target.get("references"), "to": []}
                new_target["references"] = []

            if original_target.get("clarificationRequired") is not True:
                changed_fields["clarificationRequired"] = {"from": original_target.get("clarificationRequired"), "to": True}
                new_target["clarificationRequired"] = True

            existing_ambiguities = original_target.get("ambiguities") or []
            if not any(a.get("field") == "reference" for a in existing_ambiguities):
                new_ambiguities = existing_ambiguities + [{"field": "reference", "reason": REASON_TEXT}]
                changed_fields["ambiguities"] = {"from": existing_ambiguities, "to": new_ambiguities}
                new_target["ambiguities"] = new_ambiguities

            old_conf = original_target.get("confidence")
            new_conf = min(old_conf, CANONICAL_CONFIDENCE_FLOOR) if isinstance(old_conf, (int, float)) else CANONICAL_CONFIDENCE_FLOOR
            if new_conf != old_conf:
                changed_fields["confidence"] = {"from": old_conf, "to": new_conf}
                new_target["confidence"] = new_conf

            corrected_row = dict(row)
            corrected_row["target"] = new_target
            corrected_rows.append(corrected_row)

            corrections_out.append({
                "dataset": dataset_key,
                "caseId": row["caseId"],
                "familyId": row.get("templateFamily"),
                "originalTarget": original_target,
                "correctedTarget": new_target,
                "changedFields": list(changed_fields.keys()),
                "changedFieldDetail": changed_fields,
                "visibleAntecedentCount": 0,
                "reason": "PT_DEICTIC_ZERO_VISIBLE_ANTECEDENT",
                "policyRule": "PT_DEICTIC_CANONICAL_POLICY_V1 rule 3",
                "auditClassification": "GOLD_CONFLICT",
            })

        out_name = {
            "A_v2_validation": "original71_corrected.jsonl",
            "C_v21_validation_remediation": "v2_1_remediation12_corrected.jsonl",
            "E_v22_dev_challenge": "v2_2_dev12_corrected.jsonl",
        }[dataset_key]
        out_path = OUT_DIR / out_name
        out_path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in corrected_rows) + "\n", encoding="utf-8")
        hashes[out_name + "_sha256"] = sha256_file(out_path)
        print(f"{dataset_key}: {len(rows)} rows total, {len(to_correct)} corrected -> {out_path}")

    (OUT_DIR / "corrections.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in corrections_out) + "\n", encoding="utf-8")
    hashes["corrections.jsonl_sha256"] = sha256_file(OUT_DIR / "corrections.jsonl")

    policy = {
        "name": "PT_DEICTIC_CANONICAL_POLICY_V1",
        "decided": "product decision, locked before this task's re-score (see task §1/§0)",
        "scope": "THIS_ITEM / PREVIOUS_STATE references whose domain is PT/HLV/coach",
        "rules": {
            "1_explicit_name": "unique explicit PT name -> RESOLVED",
            "2_one_antecedent": "exactly one compatible visible PT antecedent -> RESOLVED",
            "3_zero_antecedent": "zero compatible visible PT antecedents -> UNRESOLVED",
            "4_multiple_antecedent": "multiple compatible visible PT antecedents, no disambiguator -> UNRESOLVED",
            "5_hidden_state": "resolution requiring ci.proposal / candidate list / DB state / omitted history / current-PT state not in persisted -> UNRESOLVED at the semantic-parser layer",
        },
        "basis": [
            "parser visible-context contract (interpreter.ts buildPrompt(): single message + optional expectedSlot, no history, no ci.proposal visible to this step)",
            "InterpretContext.persisted has no PT/coach field",
            "V2.3A.1 cross-dataset consistency audit (docs/ai-training/qwen4b-v2-3a1-pt-deictic-gold-consistency-audit.md)",
        ],
    }
    policy_path = OUT_DIR / "policy.json"
    policy_path.write_text(json.dumps(policy, indent=2, ensure_ascii=False), encoding="utf-8")
    hashes["policy.json_sha256"] = sha256_file(policy_path)

    manifest = {
        "expectedConflictRowCount": 20,
        "actualConflictRowCount": len(gold_conflict),
        "expectedEligibleCount": 12,
        "actualEligibleCount": len(eligible),
        "correctedCaseIds": sorted(r["caseId"] for r in eligible),
        "alreadyConsistentCaseIds": sorted(r["caseId"] for r in not_eligible),
        "hashes": hashes,
        "historicalFilesModified": False,
    }
    manifest_path = OUT_DIR / "correction_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    hashes["correction_manifest.json_sha256"] = sha256_file(manifest_path)
    manifest["hashes"] = hashes
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nCorrected case IDs ({len(eligible)}):")
    for cid in sorted(r["caseId"] for r in eligible):
        print(f"  {cid}")


if __name__ == "__main__":
    main()
