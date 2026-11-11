"""
Diagnostic D1 §5-8: EOS/stop-token investigation, training label
termination check, prompt/completion boundary inspection, think-scaffold
parity across training vs HF-inference vs Ollama-serving. Read-only -
inspects the tokenizer and a few real training rows, does not touch GPU/
model weights, does not retrain.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/diagnose_termination.py
"""
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
    from transformers import AutoTokenizer  # type: ignore
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

    print("=" * 70)
    print("§5 EOS / stop-token identity")
    print("=" * 70)
    print(f"tokenizer.eos_token = {tokenizer.eos_token!r}")
    print(f"tokenizer.eos_token_id = {tokenizer.eos_token_id!r}")
    print(f"tokenizer.pad_token = {tokenizer.pad_token!r}")
    print(f"tokenizer.pad_token_id = {tokenizer.pad_token_id!r}")
    gen_cfg = None
    try:
        from transformers import GenerationConfig  # type: ignore
        gen_cfg = GenerationConfig.from_pretrained(BASE_MODEL)
        print(f"generation_config.eos_token_id = {gen_cfg.eos_token_id!r}")
        print(f"generation_config.pad_token_id = {gen_cfg.pad_token_id!r}")
    except Exception as exc:  # noqa: BLE001
        print(f"GenerationConfig.from_pretrained failed: {exc!r}")

    im_end_id = tokenizer.convert_tokens_to_ids("<|im_end|>")
    print(f"<|im_end|> token id = {im_end_id!r}")
    print(f"eos_token_id == <|im_end|> id? {tokenizer.eos_token_id == im_end_id}")

    print()
    print("=" * 70)
    print("§6/§7 Training label termination + prompt/completion boundary")
    print("=" * 70)
    train_path = ROOT / "datasets" / "processed" / "v1" / "train.jsonl"
    rows = [json.loads(ln) for ln in train_path.read_text(encoding="utf-8").splitlines() if ln.strip()][:3]
    for row in rows:
        completion_messages = [{"role": "assistant", "content": json.dumps(row["target"], ensure_ascii=False)}]
        built = build_input_ids_and_labels(tokenizer, row["messages"], completion_messages)
        labels = built["labels"]
        last10 = labels[-10:]
        decoded_last10 = [tokenizer.decode([t]) if t != -100 else "<MASKED>" for t in last10]
        last_real = next((t for t in reversed(labels) if t != -100), None)
        print(f"\ncaseId: {row['caseId']}")
        print(f"last 10 supervised label token ids: {last10}")
        print(f"decoded: {decoded_last10}")
        print(f"last REAL (non-masked) supervised token id: {last_real} -> {tokenizer.decode([last_real]) if last_real is not None else None!r}")
        print(f"does supervised completion include <|im_end|> ({im_end_id})? {im_end_id in [t for t in labels if t != -100]}")

    print()
    print("=" * 70)
    print("§8 Think-scaffold parity: training prompt vs HF-inference prompt vs Ollama template")
    print("=" * 70)
    sample_messages = [{"role": "system", "content": "SYSTEM_INSTRUCTION"}, {"role": "user", "content": "USER_TEXT"}]
    training_full = tokenizer.apply_chat_template(
        sample_messages + [{"role": "assistant", "content": '{"primaryIntent": "CONFIRM"}'}],
        tokenize=False, add_generation_prompt=False)
    hf_inference_prompt = tokenizer.apply_chat_template(sample_messages, tokenize=False, add_generation_prompt=True)
    print("TRAINING (prompt+completion, what build_input_ids_and_labels tokenizes, raw before strip):")
    print(training_full)
    print("\nHF INFERENCE PROMPT (what evaluate_semantics.py's call_hf actually sends to generate()):")
    print(hf_inference_prompt)
    scaffold = think_scaffold_ids(tokenizer)
    print(f"\nthink-scaffold token ids (stripped from TRAINING completion by masking_utils): {scaffold}")
    print(f"Is the think-scaffold present at the END of the HF_INFERENCE prompt (i.e. the model is being ASKED to continue right after it)? "
          f"{'<think>' in hf_inference_prompt.split('assistant')[-1]}")
    print("\n>>> KEY QUESTION: training's assistant completion had the scaffold STRIPPED (so the model is taught to go straight to '{' after the prompt).")
    print(">>> HF inference's prompt (add_generation_prompt=True) - does it ALSO end right before where the scaffold would be, or does generate() have to produce the scaffold itself first?")

    return 0


if __name__ == "__main__":
    sys.exit(main())
