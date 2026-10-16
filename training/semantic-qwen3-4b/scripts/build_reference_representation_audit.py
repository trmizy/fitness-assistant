"""
V2.3A.3 — audits the REPRESENTATION contract of `references` when a case is
unresolved (NOT the resolution-policy question V2.3A.1/V2.3A.2 already
settled). Read-only: does not touch gold, guard, or evaluator.
"""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
OUT_DIR = BASE / "outputs/v2.3a3-reference-representation-audit"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def user_text(row: dict) -> str:
    for m in row["messages"]:
        if m["role"] == "user":
            return m["content"]
    return ""


DATASETS = {
    "V2_train": BASE / "datasets/processed/v2/train.jsonl",
    "V2_validation": BASE / "datasets/processed/v2/validation.jsonl",
    "V2.1_train_additions": BASE / "datasets/raw/v2.1/train_additions.jsonl",
    "V2.1_validation_remediation": BASE / "datasets/raw/v2.1/validation_remediation.jsonl",
    "V2.2_train_remediation": BASE / "datasets/raw/v2.2/train_remediation.jsonl",
    "V2.2_dev_challenge": BASE / "datasets/raw/v2.2/dev_challenge.jsonl",
    "V2.3A.2_original71_corrected": BASE / "datasets/canonical-policy/pt-deictic-v1/original71_corrected.jsonl",
    "V2.3A.2_remediation12_corrected": BASE / "datasets/canonical-policy/pt-deictic-v1/v2_1_remediation12_corrected.jsonl",
    "V2.3A.2_dev12_corrected": BASE / "datasets/canonical-policy/pt-deictic-v1/v2_2_dev12_corrected.jsonl",
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cases_out = []
    dist = {"UNRESOLVED_REFERENCES_EMPTY": 0, "UNRESOLVED_REFERENCE_RETAINED": 0}
    by_dataset: dict[str, dict[str, int]] = {}

    for name, path in DATASETS.items():
        rows = load_jsonl(path)
        for r in rows:
            target = r["target"]
            ambiguities = target.get("ambiguities") or []
            has_ref_ambiguity = any(a.get("field") == "reference" for a in ambiguities)
            clarif = target.get("clarificationRequired")
            refs = target.get("references") or []
            if not (clarif and has_ref_ambiguity):
                continue
            classification = "UNRESOLVED_REFERENCE_RETAINED" if refs else "UNRESOLVED_REFERENCES_EMPTY"
            dist[classification] += 1
            by_dataset.setdefault(name, {}).setdefault(classification, 0)
            by_dataset[name][classification] += 1
            cases_out.append({
                "dataset": name,
                "caseId": r["caseId"],
                "familyId": r.get("templateFamily"),
                "userText": user_text(r),
                "referenceField": refs,
                "ambiguityField": ambiguities,
                "clarificationRequired": clarif,
                "classification": classification,
            })

    (OUT_DIR / "reference_representation_cases.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in cases_out) + "\n", encoding="utf-8")

    distribution = {
        "totalUnresolvedReferenceCases": len(cases_out),
        "byClassification": dist,
        "byDataset": by_dataset,
        "retainedCaseIds": sorted({c["caseId"] for c in cases_out if c["classification"] == "UNRESOLVED_REFERENCE_RETAINED"}),
        "note": "Dataset-convention counts are reported as corroborating evidence only -- per this project's own standing rule (V2.3A.1 task's own instruction), historical prevalence alone does not define policy. See the report's producer/consumer analysis for the actual basis of the proposal.",
    }
    (OUT_DIR / "representation_distribution.json").write_text(
        json.dumps(distribution, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(dist, indent=2))
    print(json.dumps(by_dataset, indent=2))


if __name__ == "__main__":
    main()
