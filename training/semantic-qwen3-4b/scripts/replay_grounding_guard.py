"""
V2.3A offline replay (task §25-27): applies the deterministic reference-grounding
guard over ALREADY-STORED V2.1 predictions (no re-running Qwen where a stored run
exists) and rescales using the REAL evaluator's own pure scoring functions, imported
unmodified from evaluate_semantics.py (task §35 — no evaluator modification).

Writes, per set: guard_decisions_<set>.jsonl, predictions_after_guard.jsonl,
metrics_after_guard.json (same shape as evaluate_semantics.py's metrics.json, so it is
directly diffable against the stored "before" metrics.json).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from reference_grounding_guard import validate_reference_grounding  # noqa: E402

spec = importlib.util.spec_from_file_location("evalmod", str(ROOT / "evaluate_semantics.py"))
evalmod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evalmod)

ERROR_BUCKETS = evalmod.ERROR_BUCKETS


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def user_text(row: dict) -> str:
    for m in row["messages"]:
        if m["role"] == "user":
            return m["content"]
    return ""


def rescore_case(expected: dict, parsed: dict | None, raw_text: str | None) -> dict:
    """Mirrors evaluate_semantics.py's per-case scoring block exactly (same functions,
    same field names) so "after guard" rows are directly comparable to a normal eval run."""
    result: dict = {}
    result["jsonValid"] = parsed is not None
    result["schemaValid"] = bool(parsed) and not evalmod.schema_errors(parsed)
    result["schemaErrors"] = evalmod.schema_errors(parsed) if parsed else None
    result["invented_enum"] = evalmod.is_invented_enum(parsed) if parsed else False
    result["intentCorrect"] = bool(parsed) and parsed.get("primaryIntent") == expected.get("primaryIntent")
    result["unsafe"] = evalmod.unsafe_output(raw_text) if raw_text else False
    if parsed:
        p, r, f1 = evalmod.entity_prf(expected.get("entities") or [], parsed.get("entities") or [])
        result["entityPrecision"], result["entityRecall"], result["entityF1"] = round(p, 3), round(r, 3), round(f1, 3)
        result["correctionCorrect"] = evalmod.correction_correct(expected.get("corrections") or [], parsed.get("corrections") or [])
        result["referenceCorrect"] = evalmod.reference_correct(expected.get("references") or [], parsed.get("references") or [])
        result["ambiguityCorrect"] = evalmod.ambiguity_correct(expected, parsed)
        result["requestedActionCorrect"] = (parsed.get("requestedAction") == expected.get("requestedAction")) if expected.get("requestedAction") is not None else None
    else:
        result["entityPrecision"] = result["entityRecall"] = result["entityF1"] = 0.0
        result["correctionCorrect"] = result["referenceCorrect"] = result["ambiguityCorrect"] = result["requestedActionCorrect"] = None
    result["errorBuckets"] = evalmod.classify_errors(expected, parsed, raw_text, None)
    return result


def summarize(per_case: list[dict], backend: str, model: str) -> dict:
    n = len(per_case)

    def rate(key: str) -> float:
        return round(sum(1 for c in per_case if c.get(key)) / n, 4) if n else 0.0

    def rate_of_applicable(key: str) -> float | None:
        applicable = [c for c in per_case if c.get(key) is not None]
        if not applicable:
            return None
        return round(sum(1 for c in applicable if c[key]) / len(applicable), 4)

    error_bucket_counts = {b: sum(1 for c in per_case if b in c["errorBuckets"]) for b in ERROR_BUCKETS}
    return {
        "backend": backend, "model": model, "totalCases": n,
        "jsonValidityRate": rate("jsonValid"),
        "schemaValidityRate": rate("schemaValid"),
        "primaryIntentAccuracy": rate("intentCorrect"),
        "entityF1Mean": round(sum(c["entityF1"] for c in per_case) / n, 4) if n else 0.0,
        "correctionAccuracy": rate_of_applicable("correctionCorrect"),
        "referenceAccuracy": rate_of_applicable("referenceCorrect"),
        "ambiguityAccuracy": rate("ambiguityCorrect"),
        "requestedActionAccuracy": rate_of_applicable("requestedActionCorrect"),
        "unsafeOutputRate": rate("unsafe"),
        "inventedEnumRate": rate("invented_enum"),
        "inventedEnumCount": sum(1 for c in per_case if c["invented_enum"]),
        "errorBucketCounts": error_bucket_counts,
    }


def run_set(name: str, gold_path: Path, preds_path: Path, out_dir: Path) -> None:
    gold_rows = {r["caseId"]: r for r in load_jsonl(gold_path)}
    preds = load_jsonl(preds_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    decisions_out = []
    after_rows = []
    activations = 0
    beneficial = 0
    harmful = 0
    unchanged = 0

    for p in preds:
        cid = p["caseId"]
        gold = gold_rows[cid]
        expected = gold["target"]
        msg = user_text(gold)
        try:
            parsed_before = json.loads(p["rawText"]) if p.get("rawText") else None
        except Exception:
            parsed_before = None

        before_score = rescore_case(expected, parsed_before, p.get("rawText"))

        if parsed_before is None:
            unchanged += 1
            after_rows.append({"caseId": cid, **before_score})
            continue

        guard_res = validate_reference_grounding(parsed_before, msg)
        after_score = rescore_case(expected, guard_res.interpretation, p.get("rawText"))

        for d in guard_res.decisions:
            decisions_out.append({
                "caseId": cid, "kind": d.kind, "sourceText": d.source_text, "domain": d.domain,
                "candidateCount": d.candidate_count, "reason": d.reason, "invalidated": d.invalidated,
            })

        if guard_res.activated:
            activations += 1
            # beneficial iff at least one of {referenceCorrect, ambiguityCorrect} improved
            # AND none of them got worse (task §30 — a guard that "fixes" ambiguity by
            # corrupting valid references is not acceptable).
            ref_before, ref_after = before_score["referenceCorrect"], after_score["referenceCorrect"]
            amb_before, amb_after = before_score["ambiguityCorrect"], after_score["ambiguityCorrect"]

            def better(b, a):
                return (b is not True) and (a is True)

            def worse(b, a):
                return (b is True) and (a is not True)

            improved = better(ref_before, ref_after) or better(amb_before, amb_after)
            degraded = worse(ref_before, ref_after) or worse(amb_before, amb_after)
            if improved and not degraded:
                beneficial += 1
            else:
                harmful += 1
            after_rows.append({"caseId": cid, **after_score})
        else:
            unchanged += 1
            after_rows.append({"caseId": cid, **before_score})

    (out_dir / f"guard_decisions_{name}.jsonl").write_text(
        "\n".join(json.dumps(d, ensure_ascii=False) for d in decisions_out) + ("\n" if decisions_out else ""),
        encoding="utf-8")
    (out_dir / f"predictions_after_guard_{name}.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in after_rows) + "\n", encoding="utf-8")

    summary_after = summarize(after_rows, backend="hf+guard", model="qlora-baseline-v2.1+reference-grounding-guard")
    (out_dir / f"metrics_after_guard_{name}.json").write_text(json.dumps(summary_after, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps({
        "set": name, "totalCases": len(preds), "activations": activations,
        "beneficial": beneficial, "harmful": harmful, "unchanged": unchanged,
        "correctionPrecision": round(beneficial / activations, 4) if activations else None,
    }, indent=2))


if __name__ == "__main__":
    base = Path(__file__).resolve().parents[1]
    out_root = base / "outputs" / "v2.3a-reference-grounding-guard"

    run_set(
        "original71",
        base / "datasets/processed/v2/validation.jsonl",
        base / "outputs/train/qlora-baseline-v2.1/eval/predictions.jsonl",
        out_root,
    )
    run_set(
        "remediation12",
        base / "datasets/raw/v2.1/validation_remediation.jsonl",
        base / "outputs/train/qlora-baseline-v2.1/eval_remediation/predictions.jsonl",
        out_root,
    )
    run_set(
        "devchallenge12",
        base / "datasets/raw/v2.2/dev_challenge.jsonl",
        base / "outputs/train/qlora-baseline-v2.1/eval_devchallenge/predictions.jsonl",
        out_root,
    )
