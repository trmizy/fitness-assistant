"""
V2.3A.2 — replays stored V2.1 predictions against the CANONICAL-POLICY
corrected gold views (datasets/canonical-policy/pt-deictic-v1/), both raw
(no guard) and guarded (frozen reference_grounding_guard.py, unmodified).
Scoring reuses evaluate_semantics.py's own pure functions, unmodified.
No Qwen re-run (all 3 sets already have stored V2.1 predictions from
V2.3A/V2.3A.1). No historical file is written to.
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

BASE = ROOT.parent
CANON_DIR = BASE / "datasets/canonical-policy/pt-deictic-v1"
OUT_DIR = BASE / "outputs/v2.3a2-canonical-pt-deictic"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def user_text(row: dict) -> str:
    for m in row["messages"]:
        if m["role"] == "user":
            return m["content"]
    return ""


def rescore_case(expected: dict, parsed: dict | None, raw_text: str | None) -> dict:
    result: dict = {}
    result["jsonValid"] = parsed is not None
    result["schemaValid"] = bool(parsed) and not evalmod.schema_errors(parsed)
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


def summarize(per_case: list[dict]) -> dict:
    n = len(per_case)

    def rate(key):
        return round(sum(1 for c in per_case if c.get(key)) / n, 4) if n else 0.0

    def rate_of_applicable(key):
        applicable = [c for c in per_case if c.get(key) is not None]
        return round(sum(1 for c in applicable if c[key]) / len(applicable), 4) if applicable else None

    return {
        "totalCases": n,
        "jsonValidityRate": rate("jsonValid"),
        "schemaValidityRate": rate("schemaValid"),
        "primaryIntentAccuracy": rate("intentCorrect"),
        "entityF1Mean": round(sum(c["entityF1"] for c in per_case) / n, 4) if n else 0.0,
        "referenceAccuracy": rate_of_applicable("referenceCorrect"),
        "ambiguityAccuracy": rate("ambiguityCorrect"),
        "inventedEnumCount": sum(1 for c in per_case if c["invented_enum"]),
        "errorBucketCounts": {b: sum(1 for c in per_case if b in c["errorBuckets"]) for b in ERROR_BUCKETS},
    }


def run_set(name: str, gold_path: Path, preds_path: Path) -> dict:
    gold_rows = {r["caseId"]: r for r in load_jsonl(gold_path)}
    preds = load_jsonl(preds_path)

    raw_rows, guarded_rows, decisions = [], [], []
    activations = beneficial = harmful = 0

    for p in preds:
        cid = p["caseId"]
        gold = gold_rows.get(cid)
        if gold is None:
            continue
        expected = gold["target"]
        msg = user_text(gold)
        try:
            parsed = json.loads(p["rawText"]) if p.get("rawText") else None
        except Exception:
            parsed = None

        raw_score = rescore_case(expected, parsed, p.get("rawText"))
        raw_rows.append({"caseId": cid, **raw_score})

        if parsed is None:
            guarded_rows.append({"caseId": cid, **raw_score})
            continue

        res = validate_reference_grounding(parsed, msg)
        guarded_score = rescore_case(expected, res.interpretation, p.get("rawText"))
        for d in res.decisions:
            decisions.append({"caseId": cid, "kind": d.kind, "sourceText": d.source_text,
                               "domain": d.domain, "candidateCount": d.candidate_count,
                               "reason": d.reason, "invalidated": d.invalidated})

        if res.activated:
            activations += 1
            ref_b, ref_a = raw_score["referenceCorrect"], guarded_score["referenceCorrect"]
            amb_b, amb_a = raw_score["ambiguityCorrect"], guarded_score["ambiguityCorrect"]

            def better(b, a):
                return (b is not True) and (a is True)

            def worse(b, a):
                return (b is True) and (a is not True)

            improved = better(ref_b, ref_a) or better(amb_b, amb_a)
            degraded = worse(ref_b, ref_a) or worse(amb_b, amb_a)
            if improved and not degraded:
                beneficial += 1
            else:
                harmful += 1
            guarded_rows.append({"caseId": cid, **guarded_score})
        else:
            guarded_rows.append({"caseId": cid, **raw_score})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"guard_decisions_{name}.jsonl").write_text(
        "\n".join(json.dumps(d, ensure_ascii=False) for d in decisions) + ("\n" if decisions else ""), encoding="utf-8")

    summary = {
        "set": name, "raw": summarize(raw_rows), "guarded": summarize(guarded_rows),
        "guardActivations": activations, "beneficialCorrections": beneficial, "harmfulCorrections": harmful,
        "correctionPrecision": round(beneficial / activations, 4) if activations else None,
    }
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    results = {}
    results["original71"] = run_set(
        "original71",
        CANON_DIR / "original71_corrected.jsonl",
        BASE / "outputs/train/qlora-baseline-v2.1/eval/predictions.jsonl",
    )
    results["remediation12"] = run_set(
        "remediation12",
        CANON_DIR / "v2_1_remediation12_corrected.jsonl",
        BASE / "outputs/train/qlora-baseline-v2.1/eval_remediation/predictions.jsonl",
    )
    results["dev12"] = run_set(
        "dev12",
        CANON_DIR / "v2_2_dev12_corrected.jsonl",
        BASE / "outputs/train/qlora-baseline-v2.1/eval_devchallenge/predictions.jsonl",
    )
    (OUT_DIR / "metrics_historical_vs_canonical.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
