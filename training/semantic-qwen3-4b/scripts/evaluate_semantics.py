"""
Phase E - complete evaluator for the semantic-understanding fine-tune.
Built/extended BEFORE the real QLoRA baseline run per the task's own
mandatory ordering, and used UNMODIFIED for every later comparison (base vs
QLoRA vs best-tuned) so numbers are comparable.

Backends: `ollama` (real HTTP to the production runtime) and `hf` (local
HF/Unsloth checkpoint, base or base+adapter, via transformers.generate()).

Metrics are kept STRUCTURALLY separate (task §16) rather than collapsed:
a response can be transport-success=yes, json-valid=yes, schema-valid=yes,
semantic-correct=no, all independently true/false.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/evaluate_semantics.py \
    --backend ollama --model qwen3:4b-instruct-2507-q4_K_M \
    --eval-file training/semantic-qwen3-4b/datasets/processed/v1/validation.jsonl \
    --output-dir training/semantic-qwen3-4b/outputs/baseline-v1-ollama
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from semantic_schema_enums import (  # noqa: E402
    ENTITY_TYPES, PRIMARY_INTENTS, WORKFLOW_INTENTS, REQUESTED_ACTIONS, REFERENCE_KINDS, CORRECTION_FIELDS,
)

# Dataset V2 task §25 manual sanity check found a false positive: "UPDATE "
# matched the ordinary English word "update" (e.g. "check status or update
# of a bench"). Dropped as too generic for a naive substring match; the
# remaining markers are SQL/shell-specific enough not to appear in normal
# fitness-coaching text, and the SAFETY_NON_AUTHORITY SQL-injection test
# cases still contain "DROP TABLE"/"'; --" which these still catch.
UNSAFE_MARKERS = ("DROP TABLE", "DELETE FROM", "INSERT INTO", "'; --", "rm -rf", "sudo ")

# Task §17 error taxonomy.
ERROR_BUCKETS = [
    "INVALID_JSON", "SCHEMA_INVALID", "INVENTED_ENUM", "WRONG_INTENT", "WRONG_DOMAIN",
    "ENTITY_MISSING", "ENTITY_EXTRA", "CORRECTION_WRONG", "REFERENCE_WRONG",
    "OVERCONFIDENT_AMBIGUITY", "UNSAFE_OUTPUT", "TIMEOUT",
]


# ──────────────────────────────── backends ────────────────────────────────

def call_ollama(model: str, messages: list[dict[str, str]], base_url: str, timeout_s: float) -> tuple[str | None, float, str | None, int | None]:
    import urllib.request
    payload = json.dumps({"model": model, "messages": messages, "stream": False, "format": "json",
                           "options": {"temperature": 0.2}}).encode("utf-8")
    req = urllib.request.Request(f"{base_url}/api/chat", data=payload, headers={"Content-Type": "application/json"})
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        # eval_count = Ollama's own reported output token count (D1 task §10) -
        # no re-tokenization needed, the server already reports it.
        return body.get("message", {}).get("content"), time.time() - started, None, body.get("eval_count")
    except Exception as exc:  # noqa: BLE001 - must record failure, not crash the eval run
        is_timeout = "timed out" in str(exc).lower() or "timeout" in type(exc).__name__.lower()
        return None, time.time() - started, ("TIMEOUT: " + repr(exc)) if is_timeout else repr(exc), None


_HF_CACHE: dict[str, Any] = {}


def call_hf(model_path: str, messages: list[dict[str, str]], timeout_s: float, base_model: str | None = None) -> tuple[str | None, float, str | None, int | None]:
    import torch  # type: ignore
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore

    cache_key = f"{base_model}+{model_path}" if base_model else model_path
    if cache_key not in _HF_CACHE:
        is_adapter = (Path(model_path) / "adapter_config.json").exists()
        device_map = {"": 0} if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        if is_adapter:
            # Task §20C/§29 - base + LoRA adapter for evaluation, never merged
            # (merging is export-stage only, task §36, not done here).
            from peft import PeftModel  # type: ignore
            real_base = base_model or json.loads((Path(model_path) / "adapter_config.json").read_text())["base_model_name_or_path"]
            tokenizer = AutoTokenizer.from_pretrained(model_path)
            base = AutoModelForCausalLM.from_pretrained(real_base, device_map=device_map, torch_dtype=dtype)
            model = PeftModel.from_pretrained(base, model_path)
        else:
            tokenizer = AutoTokenizer.from_pretrained(model_path)
            model = AutoModelForCausalLM.from_pretrained(model_path, device_map=device_map, torch_dtype=dtype)
        _HF_CACHE[cache_key] = (model, tokenizer)
    model, tokenizer = _HF_CACHE[cache_key]

    started = time.time()
    try:
        # apply_chat_template(..., return_tensors="pt") returns a BatchEncoding
        # here (not a raw tensor) - pull "input_ids" out explicitly (same
        # BatchEncoding-vs-plain-return inconsistency hit in masking_utils.py).
        encoded = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")
        input_ids = (encoded["input_ids"] if hasattr(encoded, "keys") else encoded).to(model.device)
        with torch.no_grad():
            out = model.generate(input_ids, max_new_tokens=160, do_sample=False, pad_token_id=tokenizer.eos_token_id)
        output_token_count = out.shape[1] - input_ids.shape[1]  # D1 task §10 - ceiling-hit distribution
        text = tokenizer.decode(out[0][input_ids.shape[1]:], skip_special_tokens=True)
        return text, time.time() - started, None, int(output_token_count)
    except Exception as exc:  # noqa: BLE001
        return None, time.time() - started, repr(exc), None


# ──────────────────────────────── parsing/validation ────────────────────────────────

def extract_first_json_object(text: str) -> dict[str, Any] | None:
    start = text.find("{")
    if start == -1:
        return None
    depth, in_string, escaped = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def schema_errors(obj: dict[str, Any]) -> list[str]:
    reasons = []
    if not isinstance(obj, dict):
        return ["not a JSON object"]
    if obj.get("primaryIntent") not in PRIMARY_INTENTS:
        reasons.append(f"invalid primaryIntent {obj.get('primaryIntent')!r}")
    if obj.get("workflowIntent") not in (None, *WORKFLOW_INTENTS):
        reasons.append(f"invalid workflowIntent {obj.get('workflowIntent')!r}")
    if obj.get("requestedAction") not in (None, *REQUESTED_ACTIONS):
        reasons.append(f"invalid requestedAction {obj.get('requestedAction')!r}")
    for key in ("entities", "corrections", "references", "goalSignals", "negations", "ambiguities"):
        if key in obj and not isinstance(obj[key], list):
            reasons.append(f"{key} is not an array")
    for i, e in enumerate(obj.get("entities") or []):
        if not isinstance(e, dict) or e.get("type") not in ENTITY_TYPES:
            reasons.append(f"entities[{i}] invalid type {e.get('type') if isinstance(e, dict) else e!r}")
    for i, c in enumerate(obj.get("corrections") or []):
        if not isinstance(c, dict) or c.get("field") not in CORRECTION_FIELDS:
            reasons.append(f"corrections[{i}] invalid field {c.get('field') if isinstance(c, dict) else c!r}")
    for i, r in enumerate(obj.get("references") or []):
        if not isinstance(r, dict) or r.get("kind") not in REFERENCE_KINDS:
            reasons.append(f"references[{i}] invalid kind {r.get('kind') if isinstance(r, dict) else r!r}")
    return reasons


def is_invented_enum(obj: dict[str, Any]) -> bool:
    """Heuristic for the core product hypothesis (task §30): the model
    produced a primaryIntent-shaped string that isn't one of Gymini's real
    enum values at all (e.g. 'create_a_workout_schedule') rather than a
    schema-structure error (wrong array shape, missing field, etc)."""
    val = obj.get("primaryIntent")
    return isinstance(val, str) and val not in PRIMARY_INTENTS


def unsafe_output(raw_text: str) -> bool:
    upper = raw_text.upper()
    return any(marker.upper() in upper for marker in UNSAFE_MARKERS)


def _prf(expected: set, actual: set) -> tuple[float, float, float]:
    tp = len(expected & actual)
    precision = tp / len(actual) if actual else (1.0 if not expected else 0.0)
    recall = tp / len(expected) if expected else (1.0 if not actual else 0.0)
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return precision, recall, f1


def entity_prf(expected: list[dict], actual: list[dict]) -> tuple[float, float, float]:
    exp = {(e.get("type"), str(e.get("value"))) for e in expected}
    act = {(e.get("type"), str(e.get("value"))) for e in actual if isinstance(e, dict)}
    return _prf(exp, act)


def correction_correct(expected: list[dict], actual: list[dict]) -> bool | None:
    """None when the case has no corrections in either side (not applicable
    to this case - excluded from the accuracy denominator, not counted as
    a failure)."""
    if not expected and not actual:
        return None
    exp = {(c.get("field"), str(c.get("previousValue")), str(c.get("newValue"))) for c in expected}
    act = {(c.get("field"), str(c.get("previousValue")), str(c.get("newValue"))) for c in actual if isinstance(c, dict)}
    return exp == act


def reference_correct(expected: list[dict], actual: list[dict]) -> bool | None:
    if not expected and not actual:
        return None
    exp = {(r.get("kind"), r.get("ordinal")) for r in expected}
    act = {(r.get("kind"), r.get("ordinal")) for r in actual if isinstance(r, dict)}
    return exp == act


def ambiguity_correct(expected: dict, actual: dict) -> bool | None:
    """Task §9/§24 - did the model correctly recognize an UNKNOWN/ambiguous
    case as such (not force a confident wrong label), and conversely NOT
    claim ambiguity on a case that was actually clear? Applicable to every
    case (unlike correction/reference), since every case has a clear
    expected clarificationRequired value."""
    exp_flag = bool(expected.get("clarificationRequired"))
    act_flag = bool(actual.get("clarificationRequired")) if isinstance(actual, dict) else False
    return exp_flag == act_flag


def classify_errors(expected: dict, actual: dict | None, raw_text: str | None, transport_error: str | None) -> list[str]:
    buckets = []
    if transport_error and "TIMEOUT" in transport_error:
        buckets.append("TIMEOUT")
        return buckets
    if transport_error:
        return buckets  # a non-timeout transport error isn't one of these semantic buckets
    if raw_text is not None and unsafe_output(raw_text):
        buckets.append("UNSAFE_OUTPUT")
    if actual is None:
        buckets.append("INVALID_JSON")
        return buckets
    errs = schema_errors(actual)
    if errs:
        buckets.append("SCHEMA_INVALID")
    if is_invented_enum(actual):
        buckets.append("INVENTED_ENUM")
    if actual.get("primaryIntent") != expected.get("primaryIntent") and not is_invented_enum(actual):
        buckets.append("WRONG_INTENT")
    if actual.get("workflowIntent") != expected.get("workflowIntent"):
        buckets.append("WRONG_DOMAIN")
    exp_ent = {(e.get("type"), str(e.get("value"))) for e in expected.get("entities") or []}
    act_ent = {(e.get("type"), str(e.get("value"))) for e in (actual.get("entities") or []) if isinstance(e, dict)}
    if exp_ent - act_ent:
        buckets.append("ENTITY_MISSING")
    if act_ent - exp_ent:
        buckets.append("ENTITY_EXTRA")
    if correction_correct(expected.get("corrections") or [], actual.get("corrections") or []) is False:
        buckets.append("CORRECTION_WRONG")
    if reference_correct(expected.get("references") or [], actual.get("references") or []) is False:
        buckets.append("REFERENCE_WRONG")
    if expected.get("clarificationRequired") and not actual.get("clarificationRequired"):
        buckets.append("OVERCONFIDENT_AMBIGUITY")
    return buckets


# ──────────────────────────────── evaluation loop ────────────────────────────────

def evaluate(rows: list[dict[str, Any]], backend: str, model: str, base_url: str, timeout_s: float,
             hf_base_model: str | None = None, progress_path: Path | None = None) -> dict[str, Any]:
    per_case = []
    # D1 diagnostic: append+flush each case immediately so a hang/timeout on a
    # later case still leaves earlier cases' real output on disk, instead of
    # losing an entire 20-30 minute GPU run to one stuck case.
    progress_handle = open(progress_path, "a", encoding="utf-8") if progress_path else None  # noqa: SIM115
    for row in rows:
        expected = row["target"]
        if backend == "ollama":
            raw, latency, error, output_token_count = call_ollama(model, row["messages"], base_url, timeout_s)
        elif backend == "hf":
            raw, latency, error, output_token_count = call_hf(model, row["messages"], timeout_s, base_model=hf_base_model)
        else:
            raise SystemExit(f"Unsupported backend: {backend}")

        result: dict[str, Any] = {
            "caseId": row["caseId"], "category": row["category"], "latencySeconds": round(latency, 3),
            "transportError": error, "outputTokenCount": output_token_count, "rawText": raw,
        }
        transport_success = error is None
        result["transportSuccess"] = transport_success

        parsed = extract_first_json_object(raw) if raw else None
        result["jsonValid"] = parsed is not None
        result["schemaValid"] = bool(parsed) and not schema_errors(parsed)
        result["schemaErrors"] = schema_errors(parsed) if parsed else None
        result["invented_enum"] = is_invented_enum(parsed) if parsed else False
        result["intentCorrect"] = bool(parsed) and parsed.get("primaryIntent") == expected.get("primaryIntent")
        result["unsafe"] = unsafe_output(raw) if raw else False

        if parsed:
            p, r, f1 = entity_prf(expected.get("entities") or [], parsed.get("entities") or [])
            result["entityPrecision"], result["entityRecall"], result["entityF1"] = round(p, 3), round(r, 3), round(f1, 3)
            result["correctionCorrect"] = correction_correct(expected.get("corrections") or [], parsed.get("corrections") or [])
            result["referenceCorrect"] = reference_correct(expected.get("references") or [], parsed.get("references") or [])
            result["ambiguityCorrect"] = ambiguity_correct(expected, parsed)
            result["requestedActionCorrect"] = (parsed.get("requestedAction") == expected.get("requestedAction")) if expected.get("requestedAction") is not None else None
        else:
            result["entityPrecision"] = result["entityRecall"] = result["entityF1"] = 0.0
            result["correctionCorrect"] = result["referenceCorrect"] = result["ambiguityCorrect"] = result["requestedActionCorrect"] = None

        result["errorBuckets"] = classify_errors(expected, parsed, raw, error)
        per_case.append(result)
        if progress_handle:
            progress_handle.write(json.dumps(result, ensure_ascii=False) + "\n")
            progress_handle.flush()
            os.fsync(progress_handle.fileno())
            print(f"[progress] {len(per_case)}/{len(rows)} {result['caseId']} jsonValid={result['jsonValid']} latency={result['latencySeconds']}", flush=True)

    if progress_handle:
        progress_handle.close()

    n = len(per_case)

    def rate(key: str) -> float:
        return round(sum(1 for c in per_case if c.get(key)) / n, 4) if n else 0.0

    def rate_of_applicable(key: str) -> float | None:
        applicable = [c for c in per_case if c.get(key) is not None]
        if not applicable:
            return None
        return round(sum(1 for c in applicable if c[key]) / len(applicable), 4)

    error_bucket_counts = {b: sum(1 for c in per_case if b in c["errorBuckets"]) for b in ERROR_BUCKETS}

    # D1 task §10 - output-token-count distribution (max_new_tokens=160 is a
    # safety ceiling, not a stop strategy; frequent ceiling-hits is itself a
    # defect signal, not just a latency curiosity).
    token_counts = sorted(c["outputTokenCount"] for c in per_case if c.get("outputTokenCount") is not None)

    def _pct(p: float) -> float | None:
        if not token_counts:
            return None
        idx = min(len(token_counts) - 1, int(round(p * (len(token_counts) - 1))))
        return token_counts[idx]

    token_stats = {
        "n": len(token_counts),
        "p50": _pct(0.50), "p90": _pct(0.90), "max": token_counts[-1] if token_counts else None,
        "ceilingHits160": sum(1 for t in token_counts if t >= 160),
    }

    summary = {
        "backend": backend, "model": model, "totalCases": n,
        "transportSuccessRate": rate("transportSuccess"),
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
        "errorRate": round(1 - rate("transportSuccess"), 4),
        "timeoutRate": round(sum(1 for c in per_case if c.get("transportError") and "TIMEOUT" in c["transportError"]) / n, 4) if n else 0.0,
        "meanLatencySeconds": round(sum(c["latencySeconds"] for c in per_case) / n, 3) if n else 0.0,
        "errorBucketCounts": error_bucket_counts,
        "outputTokenCountStats": token_stats,
    }
    return {"summary": summary, "perCase": per_case}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["ollama", "hf"], default="ollama")
    parser.add_argument("--model", required=True)
    parser.add_argument("--eval-file", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-url", default="http://localhost:11434")
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--max-cases", type=int, default=None, help="dry-run mode: evaluate only the first N cases")
    parser.add_argument("--hf-base-model", default=None, help="when --model is a LoRA adapter dir, the base model to load it onto")
    parser.add_argument("--progress-file", type=Path, default=None, help="D1 diagnostic: append+flush each case here as it completes, to survive a hang/timeout")
    args = parser.parse_args()

    rows = [json.loads(ln) for ln in args.eval_file.read_text(encoding="utf-8").splitlines() if ln.strip()]
    if args.max_cases:
        rows = rows[:args.max_cases]

    if args.progress_file:
        args.progress_file.parent.mkdir(parents=True, exist_ok=True)
        args.progress_file.write_text("", encoding="utf-8")  # start clean for this run

    result = evaluate(rows, args.backend, args.model, args.base_url, args.timeout,
                       hf_base_model=args.hf_base_model, progress_path=args.progress_file)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "predictions.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in result["perCase"]) + "\n", encoding="utf-8")
    (args.output_dir / "metrics.json").write_text(json.dumps(result["summary"], indent=2, ensure_ascii=False), encoding="utf-8")
    (args.output_dir / "environment.json").write_text(json.dumps({
        "backend": args.backend, "model": args.model, "baseUrl": args.base_url, "evalFile": str(args.eval_file),
        "caseCount": len(rows), "dryRun": bool(args.max_cases),
    }, indent=2), encoding="utf-8")
    (args.output_dir / "config.json").write_text(json.dumps(vars(args), default=str, indent=2), encoding="utf-8")

    print(json.dumps(result["summary"], indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
