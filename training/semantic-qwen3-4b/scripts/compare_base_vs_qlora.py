"""
Task §28-31 - compares two metrics.json files (base vs QLoRA, produced by
the SAME evaluate_semantics.py against the SAME validation split) and
applies the acceptance gates predeclared in config/acceptance_gates_v1.json
BEFORE this script is ever run against real QLoRA numbers. This script
contains no thresholds of its own - it only reads the predeclared file, so
there is no way to tune the gates after seeing the result.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/compare_base_vs_qlora.py \
    --base training/semantic-qwen3-4b/outputs/baseline-v1-ollama/metrics.json \
    --qlora training/semantic-qwen3-4b/outputs/train/qlora-baseline-v1/eval/metrics.json
"""
import argparse
import json
import sys
from pathlib import Path
from types import SimpleNamespace


def to_namespace(d: dict):
    """Recursively converts a dict (including nested dicts like
    errorBucketCounts) to SimpleNamespace so predeclared dot-notation
    comparisons (base.errorBucketCounts.OVERCONFIDENT_AMBIGUITY) work."""
    return SimpleNamespace(**{k: (to_namespace(v) if isinstance(v, dict) else v) for k, v in d.items()})

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GATES_PATH = ROOT / "config" / "acceptance_gates_v1.json"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--qlora", type=Path, required=True)
    parser.add_argument("--gates", type=Path, default=DEFAULT_GATES_PATH,
                         help="Dataset V2 task: pass config/acceptance_gates_v2.json explicitly - defaults to v1's for backward compatibility with the D1 invocation, but silently defaulting here would re-run the wrong predeclared gates.")
    args = parser.parse_args()
    GATES_PATH = args.gates

    base = json.loads(args.base.read_text(encoding="utf-8"))
    qlora = json.loads(args.qlora.read_text(encoding="utf-8"))
    gates_doc = json.loads(GATES_PATH.read_text(encoding="utf-8"))

    rows = []
    metrics = [
        "transportSuccessRate", "jsonValidityRate", "schemaValidityRate", "primaryIntentAccuracy",
        "entityF1Mean", "correctionAccuracy", "referenceAccuracy", "ambiguityAccuracy",
        "requestedActionAccuracy", "unsafeOutputRate", "inventedEnumRate", "inventedEnumCount",
        "meanLatencySeconds",
    ]
    for m in metrics:
        b, q = base.get(m), qlora.get(m)
        delta = (q - b) if isinstance(b, (int, float)) and isinstance(q, (int, float)) else None
        rows.append({"metric": m, "base": b, "qlora": q, "delta": round(delta, 4) if delta is not None else None})

    gate_results = {}
    # The predeclared comparison strings use dot notation (base.metricName) -
    # dicts don't support that, so wrap each in a SimpleNamespace that
    # exposes its keys as attributes.
    env = {"base": to_namespace(base), "qlora": to_namespace(qlora)}
    for name, gate in gates_doc["gates"].items():
        try:
            passed = eval(gate["comparison"], {"__builtins__": {}}, env)  # noqa: S307 - trusted local predeclared file only
        except Exception as exc:  # noqa: BLE001
            passed = None
            gate["evalError"] = repr(exc)
        gate_results[name] = {"rule": gate["rule"], "hardGate": gate.get("hardGate", True), "passed": passed}

    hard_gate_failed = any(g["hardGate"] and g["passed"] is False for g in gate_results.values())
    invented_enum_improved = qlora.get("inventedEnumCount", 0) < base.get("inventedEnumCount", 0)
    schema_gate_passed = gate_results.get("schemaValidityRate", {}).get("passed")
    any_regression_gate_failed = any(
        (not g["hardGate"]) is False and g["rule"].startswith("must_not") and g["passed"] is False
        for g in gate_results.values()
    )

    if hard_gate_failed or any_regression_gate_failed:
        signal = "QLORA_REGRESSED"
    elif invented_enum_improved and schema_gate_passed:
        signal = "QLORA_MEANINGFULLY_IMPROVED"
    elif qlora.get("schemaValidityRate", 0) >= base.get("schemaValidityRate", 0) and invented_enum_improved:
        signal = "QLORA_SMALL_IMPROVEMENT"
    else:
        signal = "QLORA_NO_IMPROVEMENT"

    result = {
        "comparisonTable": rows,
        "gates": gate_results,
        "inventedEnumBaseCount": base.get("inventedEnumCount"),
        "inventedEnumQloraCount": qlora.get("inventedEnumCount"),
        "inventedEnumDelta": (qlora.get("inventedEnumCount", 0) - base.get("inventedEnumCount", 0)),
        "QLORA_SIGNAL": signal,
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))
    out_path = args.qlora.parent / "base_vs_qlora_comparison.json"
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
