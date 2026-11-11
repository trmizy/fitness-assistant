"""
Task §21 - tokenizes every model INPUT (system+user rendered through the
real chat template, NOT counting the assistant completion) across a dataset
version and reports the length distribution, so max_seq_length is chosen
from real data, not copied from the 1.5B smoke config.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/analyze_token_lengths.py --version v1
"""
import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]


def percentile(sorted_vals: list[int], p: float) -> int:
    if not sorted_vals:
        return 0
    k = (len(sorted_vals) - 1) * p
    f, c = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    return round(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="v1")
    parser.add_argument("--base-model", default="unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit")
    args = parser.parse_args()

    from transformers import AutoTokenizer  # type: ignore
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)

    rows = []
    for split in ("train", "validation", "heldout"):
        path = ROOT / "datasets" / "processed" / args.version / f"{split}.jsonl"
        if path.exists():
            rows += [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]

    input_lengths = []
    full_lengths = []  # input + the assistant completion (what's actually trained on)
    for row in rows:
        input_text = tokenizer.apply_chat_template(row["messages"], tokenize=False, add_generation_prompt=True)
        input_lengths.append(len(tokenizer(input_text)["input_ids"]))
        full_messages = row["messages"] + [{"role": "assistant", "content": json.dumps(row["target"], ensure_ascii=False)}]
        full_text = tokenizer.apply_chat_template(full_messages, tokenize=False, add_generation_prompt=False)
        full_lengths.append(len(tokenizer(full_text)["input_ids"]))

    full_lengths.sort()
    input_lengths.sort()

    def summarize(name: str, vals: list[int]) -> dict:
        candidates = [256, 384, 512]
        return {
            "p50": percentile(vals, 0.50), "p90": percentile(vals, 0.90),
            "p95": percentile(vals, 0.95), "p99": percentile(vals, 0.99),
            "max": vals[-1] if vals else 0,
            "truncatedAt": {c: sum(1 for v in vals if v > c) for c in candidates},
            "n": len(vals),
        }

    result = {"inputOnly": summarize("inputOnly", input_lengths), "fullSequence": summarize("fullSequence", full_lengths)}
    print(json.dumps(result, indent=2))
    out_path = ROOT / "outputs" / f"token-length-analysis-{args.version}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
