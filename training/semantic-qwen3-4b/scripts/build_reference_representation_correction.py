"""
V2.3A.4 -- applies REFERENCE_REPRESENTATION_V1_OPTION_B to exactly the 2
approved case IDs (ambiguity-pt-switch-no-proposal-1/2), starting from
V2.3A.2's canonical-policy-v1 views (not raw historical gold), writing a
NEW versioned view. V2.3A.2's files are read-only inputs here and are
never overwritten.

Eligibility (task §10), checked per row before correcting:
  1. caseId in the 2 approved IDs
  2. clarificationRequired is already True
  3. 0 visible compatible PT antecedent (re-verified via the frozen guard's
     own candidate extraction, not re-asserted)
  4. references is currently non-empty
  5. clearing references to [] is sufficient (no other field needs to change)

One-field correction only (task §11): only `references` changes.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from reference_grounding_guard import validate_reference_grounding  # noqa: E402

BASE = ROOT.parent
SRC_DIR = BASE / "datasets/canonical-policy/pt-deictic-v1"
OUT_DIR = BASE / "datasets/canonical-policy/pt-deictic-v1-reference-representation-v1"

APPROVED_IDS = {"ambiguity-pt-switch-no-proposal-1", "ambiguity-pt-switch-no-proposal-2"}

SOURCE_FILES = {
    "original71_corrected.jsonl": OUT_DIR.parent.name,  # placeholder, replaced below
}
SOURCE_FILES = {
    "original71_corrected.jsonl": "original71_canonical_representation.jsonl",
    "v2_1_remediation12_corrected.jsonl": "remediation12_canonical_representation.jsonl",
    "v2_2_dev12_corrected.jsonl": "dev12_canonical_representation.jsonl",
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def user_text(row: dict) -> str:
    for m in row["messages"]:
        if m["role"] == "user":
            return m["content"]
    return ""


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    hashes = {}
    corrections_out = []
    physical_rows_corrected = 0
    found_ids: set[str] = set()

    for src_name, out_name in SOURCE_FILES.items():
        src_path = SRC_DIR / src_name
        hashes[f"source_{src_name}_sha256"] = sha256_file(src_path)
        rows = load_jsonl(src_path)
        out_rows = []
        for row in rows:
            if row["caseId"] not in APPROVED_IDS:
                out_rows.append(row)
                continue

            found_ids.add(row["caseId"])
            original_target = row["target"]

            # Eligibility re-verification (task §10), not assumed:
            if original_target.get("clarificationRequired") is not True:
                raise SystemExit(f"STOP eligibility failed (not unresolved): {row['caseId']}")
            if not original_target.get("references"):
                raise SystemExit(f"STOP eligibility failed (references already empty, no-op expected but found non-empty check failed): {row['caseId']}")
            msg = user_text(row)
            guard_check = validate_reference_grounding(original_target, msg)
            # independent re-confirmation that 0 compatible visible antecedent exists
            # (the frozen guard's own extraction, used read-only here for verification,
            # not modified): must find a candidate_count==0 decision for this row.
            zero_antecedent_confirmed = any(
                d.reason in ("REFERENCE_NO_VISIBLE_TARGET",) and d.candidate_count == 0
                for d in guard_check.decisions
            )
            if not zero_antecedent_confirmed:
                raise SystemExit(f"STOP eligibility failed (antecedent re-check mismatch): {row['caseId']}")

            new_target = dict(original_target)
            new_target["references"] = []
            changed_fields = ["references"]

            # Explicit guard: every OTHER field must be byte-identical.
            for key in original_target:
                if key == "references":
                    continue
                if original_target[key] != new_target[key]:
                    raise SystemExit(f"STOP unexpected field change on {row['caseId']}: {key}")

            corrected_row = dict(row)
            corrected_row["target"] = new_target
            out_rows.append(corrected_row)
            physical_rows_corrected += 1

            corrections_out.append({
                "caseId": row["caseId"],
                "dataset": src_name,
                "familyId": row.get("templateFamily"),
                "oldReferences": original_target.get("references"),
                "newReferences": [],
                "changedFields": changed_fields,
                "representationPolicy": "REFERENCE_REPRESENTATION_V1_OPTION_B",
                "ptPolicy": "PT_DEICTIC_CANONICAL_POLICY_V1 (unchanged -- already unresolved)",
                "reason": "UNRESOLVED_REFERENCE_MUST_NOT_RETAIN_GROUNDED_REFERENCE",
            })

        out_path = OUT_DIR / out_name
        out_path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in out_rows) + "\n", encoding="utf-8")
        hashes[f"{out_name}_sha256"] = sha256_file(out_path)
        print(f"{src_name} -> {out_name}: {len(rows)} rows, corrected in this file: "
              f"{sum(1 for r in rows if r['caseId'] in APPROVED_IDS)}")

    if found_ids != APPROVED_IDS:
        raise SystemExit(f"STOP: REPRESENTATION_CORRECTION_SCOPE_EXPANDED or missing -- found {found_ids}, expected {APPROVED_IDS}")

    (OUT_DIR / "representation_corrections.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in corrections_out) + "\n", encoding="utf-8")
    hashes["representation_corrections.jsonl_sha256"] = sha256_file(OUT_DIR / "representation_corrections.jsonl")

    policy = {
        "name": "REFERENCE_REPRESENTATION_V1_OPTION_B",
        "statement": "references contains ONLY successfully grounded references. If a reference expression exists but no target can be grounded, references=[]. The attempt is represented via clarificationRequired + ambiguities only.",
        "decidedIn": "docs/ai-training/qwen4b-v2-3a3-unresolved-reference-representation-audit.md",
        "ptPolicyUnchanged": "PT_DEICTIC_CANONICAL_POLICY_V1",
    }
    policy_path = OUT_DIR / "representation_policy_v1.json"
    policy_path.write_text(json.dumps(policy, indent=2, ensure_ascii=False), encoding="utf-8")
    hashes["representation_policy_v1.json_sha256"] = sha256_file(policy_path)

    manifest = {
        "expectedApprovedIds": sorted(APPROVED_IDS),
        "foundIds": sorted(found_ids),
        "physicalRowsCorrected": physical_rows_corrected,
        "physicalRowLocations": [c["dataset"] + "/" + c["caseId"] for c in corrections_out],
        "hashes": hashes,
        "historicalFilesModified": False,
        "v2_3a2_canonical_files_modified": False,
    }
    manifest_path = OUT_DIR / "correction_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    hashes["correction_manifest.json_sha256"] = sha256_file(manifest_path)
    manifest["hashes"] = hashes
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nPhysical rows corrected: {physical_rows_corrected}")
    print(f"Found IDs: {sorted(found_ids)}")


if __name__ == "__main__":
    main()
