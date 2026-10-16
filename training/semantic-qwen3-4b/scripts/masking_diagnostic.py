"""
Task §18/§20 - proves assistant-only loss masking is correct BEFORE any real
training. Uses the pre-tokenized input_ids/labels approach in
masking_utils.py (the same code path the real trainer uses - see
train_qlora_semantic.py) against one real dataset row, and prints the
resulting label mask token by token around the prompt/completion boundary.

Also doubles as the automated regression test (task §20): exits non-zero if
all labels are -100, or if the completion is fully masked, or if any
system/user token position ends up unmasked.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/masking_diagnostic.py
"""
import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from masking_utils import build_input_ids_and_labels, think_scaffold_ids  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
BASE_MODEL = "unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="v1", help="D1/dataset-V2 note: do not assume an earlier version's masking result transfers - rerun per version")
    args = parser.parse_args()

    from transformers import AutoTokenizer  # type: ignore
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

    train_path = ROOT / "datasets" / "processed" / args.version / "train.jsonl"
    all_rows = [json.loads(ln) for ln in train_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    # D1 task §22: do not assume one row (or an earlier dataset version's
    # result) generalizes - sample across the file, not just row 0.
    step = max(1, len(all_rows) // 10)
    rows = all_rows[::step][:10] or all_rows[:1]

    im_end_id = tokenizer.convert_tokens_to_ids("<|im_end|>")
    any_failure = False
    for idx, row in enumerate(rows):
        prompt_messages = row["messages"]
        completion_messages = [{"role": "assistant", "content": json.dumps(row["target"], ensure_ascii=False)}]

        prompt_ids_only = tokenizer.apply_chat_template(prompt_messages, tokenize=True, add_generation_prompt=True)["input_ids"]
        result = build_input_ids_and_labels(tokenizer, prompt_messages, completion_messages)
        input_ids, labels = result["input_ids"], result["labels"]
        boundary = len(prompt_ids_only)

        n_masked = sum(1 for lab in labels if lab == -100)
        n_real = len(labels) - n_masked
        non_masked = [t for t in labels if t != -100]

        print(f"\n--- row {idx}: caseId={row['caseId']} ---")
        print(f"prompt token count: {boundary}, full token count: {len(input_ids)}")
        print(f"labels: {n_masked} masked (-100) + {n_real} real token ids = {len(labels)} total")
        print(f"<|im_end|> ({im_end_id}) supervised in completion? {im_end_id in non_masked}")

        if idx == 0:
            print(f"think-scaffold ({len(think_scaffold_ids(tokenizer))} tokens) is stripped by construction")
            window = range(max(0, boundary - 5), min(len(labels), boundary + 10))
            print("token group                 token_id   label")
            for i in window:
                token_str = tokenizer.decode([input_ids[i]])
                group = "prompt (system/user)" if i < boundary else "completion (assistant)"
                print(f"{group:28s} {input_ids[i]:>8d}   {labels[i]}   {token_str!r}")

        failures = []
        if all(lab == -100 for lab in labels):
            failures.append("ALL labels are -100 - masking has swallowed everything")
        if n_masked != boundary:
            failures.append(f"expected exactly {boundary} masked tokens (the prompt), got {n_masked}")
        if n_real == 0:
            failures.append("the assistant completion is fully masked - loss would never see the target JSON")
        if any(labels[i] == -100 for i in range(boundary, len(labels))):
            failures.append("at least one completion-range token is masked (-100) - partial completion masking")
        if any(labels[i] != -100 for i in range(0, boundary)):
            failures.append("at least one prompt-range (system/user) token is UNMASKED")
        if im_end_id not in non_masked:
            failures.append("<|im_end|> is NOT among the supervised (non-masked) completion tokens")

        if failures:
            any_failure = True
            print("FAIL:")
            for f in failures:
                print(f"  - {f}")
        else:
            print("PASS")

    if any_failure:
        print(f"\nOVERALL FAIL across {len(rows)} sampled rows ({args.version})")
        return 1

    print(f"\nOVERALL PASS across {len(rows)} sampled rows ({args.version}) - prompt tokens fully masked, "
          "completion tokens fully real token ids including <|im_end|>, no leakage either direction, "
          "think-scaffold stripped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
