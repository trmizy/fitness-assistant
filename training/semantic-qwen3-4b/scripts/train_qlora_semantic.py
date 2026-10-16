#!/usr/bin/env python3
"""QLoRA trainer for the semantic-understanding fine-tune (intent/entities/
correction/reference/ambiguity), base model unsloth/Qwen3-4B-Instruct-2507-
unsloth-bnb-4bit, Unsloth + TRL.

Forked from ../../scripts/train_qlora_unsloth.py (the proven 1.5B-coach
trainer, verified on this exact 4GB GPU) rather than rewritten from scratch.
Real differences from that script, all intentional (task requirements):
 1. Dataset rows are {messages:[...], target:{...}} (a conversation), not
    {instruction, input, output}.
 2. Assistant-only loss masking (task §18-20): Unsloth's compiled SFTTrainer
    (this installed version) does NOT support a "messages" column with
    assistant_only_loss / TRL's native conversational completion masking -
    it only recognizes "labels"/"input_ids" (pre-tokenized), "prompt"+
    "completion", or a flat "text" field (see masking_diagnostic.py's
    investigation). This script PRE-TOKENIZES every row itself via
    masking_utils.build_input_ids_and_labels (-100 for every system/user
    token, real token ids for the assistant completion only, with Qwen3's
    <think></think> non-thinking scaffold stripped so training matches
    Ollama's real serving template, which has no <think> handling at all)
    and hands the trainer a dataset with real "input_ids"/"labels" columns
    directly - bypassing Unsloth's internal tokenization entirely rather
    than fighting its formatting_func requirement. Verified correct by
    masking_diagnostic.py before being used here.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # Windows console defaults to cp1252; dataset text is Vietnamese UTF-8

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from masking_utils import build_input_ids_and_labels  # noqa: E402
TRAINING_ROOT = Path(__file__).resolve().parents[1]


def parse_simple_yaml(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current_key: str | None = None
    if not path.exists():
        raise SystemExit(f"Config not found: {path}")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line.startswith("  - ") and current_key:
            data.setdefault(current_key, []).append(line[4:].strip())
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()
            current_key = key
            if value == "":
                data[key] = []
            elif value.lower() == "null":
                data[key] = None
            elif value.lower() in {"true", "false"}:
                data[key] = value.lower() == "true"
            else:
                try:
                    data[key] = int(value)
                except ValueError:
                    try:
                        data[key] = float(value)
                    except ValueError:
                        data[key] = value
    return data


def require_training_dependencies() -> None:
    missing: list[str] = []
    for module in ["torch", "unsloth", "datasets", "trl"]:
        try:
            __import__(module)
        except Exception:
            missing.append(module)
    if missing:
        raise SystemExit(f"Missing training dependencies: {', '.join(missing)}")
    import torch  # type: ignore
    if not torch.cuda.is_available():
        raise SystemExit("CUDA GPU is required for QLoRA training (LOCAL_TRAINING_CPU_ONLY).")


def to_chat_messages(row: dict[str, Any]) -> list[dict[str, str]]:
    """The dataset's own messages[] (system, user) plus the target JSON as
    the assistant turn - this is the exact shape the fine-tuned call site
    must learn to produce (one compact JSON object, nothing else)."""
    msgs = list(row["messages"])
    msgs.append({"role": "assistant", "content": json.dumps(row["target"], ensure_ascii=False)})
    return msgs


#  Phase D finding: the HF tokenizer's apply_chat_template always inserts an
# empty "<think>\n\n</think>\n\n" scaffold before a non-thinking assistant
# turn, but the REAL serving template (checked via `ollama show
# qwen3:4b-instruct-2507-q4_K_M --modelfile`) has no <think> handling at all
# for the assistant role - it just emits the content directly. Training on
# the HF-default (with the think scaffold) would teach the model a token
# sequence it will never actually be prompted to continue at serving time.
# Stripped here so training matches what Ollama actually serves.
_THINK_SCAFFOLD = "<think>\n\n</think>\n\n"


def render_with_chat_template(tokenizer: Any, messages: list[dict[str, str]]) -> str:
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    return text.replace(_THINK_SCAFFOLD, "")


def validate_dataset(path: Path) -> int:
    if not path.exists():
        raise SystemExit(f"Dataset not found: {path}")
    count = 0
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            for key in ["caseId", "category", "templateFamily", "messages", "target"]:
                if key not in row:
                    raise SystemExit(f"Dataset row {line_number} missing {key}")
            count += 1
    if count == 0:
        raise SystemExit(f"Dataset is empty: {path}")
    return count


def preview_chat_template(base_model: str, dataset_path: Path) -> None:
    """Loads ONLY the tokenizer (no model weights, no CUDA) and renders the
    first row through the real chat template - proves template compatibility
    cheaply, before any GPU/weights download. Part of --dry-run."""
    from transformers import AutoTokenizer  # type: ignore
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    first_row = json.loads(next(ln for ln in dataset_path.read_text(encoding="utf-8").splitlines() if ln.strip()))
    rendered = render_with_chat_template(tokenizer, to_chat_messages(first_row))
    print("--- chat-template preview (first row) ---")
    print(rendered[:1500])
    print("--- end preview ---")


def run_training(
    config: dict[str, Any],
    dataset_path: Path,
    eval_path: Path | None,
    base_model: str,
    output_dir: Path,
    max_steps: int | None,
    num_epochs: float | None,
) -> None:
    import torch  # type: ignore
    from unsloth import FastLanguageModel  # type: ignore
    from trl import SFTTrainer, SFTConfig  # type: ignore

    max_seq_length = int(config.get("max_seq_length", 512))

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=max_seq_length,
        dtype=None,
        load_in_4bit=bool(config.get("load_in_4bit", True)),
        # Phase D finding: transformers' device_map="auto" (Unsloth/HF default)
        # decided to offload some modules to CPU on this 4GB card even though
        # the 4-bit model should fit, then refused to proceed (bnb 4-bit does
        # not support partial CPU/disk offload without an explicit fp32
        # offload flag). Pinning everything to GPU 0 is the standard fix.
        device_map={"": 0},
    )

    # Model-identity assertion (task §4/§24) - never silently train a "close
    # enough" model. Compares the loaded config against the Ollama-reported
    # runtime metadata recorded in docs/ai-training/local-qwen4b-discovery.md.
    cfg = model.config
    expected = {"num_hidden_layers": 36, "hidden_size": 2560, "max_position_embeddings": 262144}
    actual = {k: getattr(cfg, k, None) for k in expected}
    mismatches = {k: (v, actual[k]) for k, v in expected.items() if actual[k] != v}
    if mismatches:
        raise SystemExit(f"MODEL_IDENTITY_MISMATCH: {mismatches} - refusing to train against an unverified base model")

    model = FastLanguageModel.get_peft_model(
        model,
        r=int(config.get("lora_r", 16)),
        target_modules=list(config.get("target_modules") or []) or None,
        lora_alpha=int(config.get("lora_alpha", 32)),
        lora_dropout=float(config.get("lora_dropout", 0.05)),
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
    )

    # Phase D finding: load_dataset("json", ...) uses pyarrow's strict JSON
    # reader, which infers one fixed type per nested column across the whole
    # file - it cannot handle target.corrections[].previousValue/newValue
    # being a number for an entity correction but a string for a GOAL
    # correction (both legitimate per SemanticCorrectionSchema's own
    # z.union([number, string])). Loading plain JSONL in Python and building
    # the Dataset from a list of dicts avoids that inference step entirely.
    def load_jsonl_rows(path: Path) -> list[dict[str, Any]]:
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    # Task §18-20: pre-tokenize every row to input_ids/labels ourselves
    # (verified correct by masking_diagnostic.py) rather than rely on
    # Unsloth's internal tokenization, which does not support a "messages"
    # column's completion-only-loss path under this installed version.
    # Rows whose full sequence exceeds max_seq_length are truncated from the
    # COMPLETION end (never the prompt) and a warning is printed, since
    # analyze_token_lengths.py already picked max_seq_length to cover the
    # real v1 distribution - truncation here should be rare/zero, not silent.
    def to_input_ids_and_labels(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = []
        truncated = 0
        for r in rows:
            completion_messages = [{"role": "assistant", "content": json.dumps(r["target"], ensure_ascii=False)}]
            built = build_input_ids_and_labels(tokenizer, r["messages"], completion_messages)
            ids, labels = built["input_ids"], built["labels"]
            if len(ids) > max_seq_length:
                truncated += 1
                ids, labels = ids[:max_seq_length], labels[:max_seq_length]
            out.append({"input_ids": ids, "labels": labels, "attention_mask": [1] * len(ids)})
        if truncated:
            print(f"WARNING: {truncated}/{len(rows)} rows exceeded max_seq_length={max_seq_length} and were truncated from the completion end")
        return out

    from datasets import Dataset, DatasetDict  # type: ignore

    splits: dict[str, Any] = {"train": Dataset.from_list(to_input_ids_and_labels(load_jsonl_rows(dataset_path)))}
    if eval_path and eval_path.exists():
        splits["validation"] = Dataset.from_list(to_input_ids_and_labels(load_jsonl_rows(eval_path)))
    dataset = DatasetDict(splits)

    output_dir.mkdir(parents=True, exist_ok=True)

    sft_config = SFTConfig(
        output_dir=str(output_dir),
        per_device_train_batch_size=int(config.get("per_device_train_batch_size", 1)),
        gradient_accumulation_steps=int(config.get("gradient_accumulation_steps", 8)),
        learning_rate=float(config.get("learning_rate", 5e-5)),
        num_train_epochs=num_epochs if num_epochs is not None else float(config.get("num_train_epochs", 2)),
        max_steps=max_steps if max_steps is not None else int(config.get("max_steps") or -1),
        bf16=bool(config.get("bf16", True)) and torch.cuda.is_bf16_supported(),
        fp16=not (bool(config.get("bf16", True)) and torch.cuda.is_bf16_supported()),
        logging_steps=int(config.get("logging_steps", 1)),
        save_steps=int(config.get("save_steps", 200)),
        eval_strategy="steps" if "validation" in splits else "no",
        eval_steps=int(config.get("eval_steps", 50)) if "validation" in splits else None,
        max_seq_length=max_seq_length,
        report_to=[],
        optim="adamw_8bit",
        seed=int(config.get("seed", 3407)),
    )

    # dataset["train"] already has real "input_ids"/"labels"/"attention_mask"
    # columns - Unsloth's compiled _prepare_dataset's FIRST branch ("labels"
    # in column_names) applies: do_tokenize=False, uses DataCollatorForSeq2Seq.
    # No formatting_func, no internal re-tokenization, no risk of the
    # <think> scaffold or prompt/system tokens leaking into the loss.
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset["train"],
        eval_dataset=dataset.get("validation"),
        args=sft_config,
    )

    trainer.train()
    model.save_pretrained(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    print(json.dumps({"status": "OK", "adapter_saved_to": str(output_dir)}, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="Train semantic-understanding QLoRA adapter (Qwen3 4B) locally via Unsloth")
    parser.add_argument("--config", type=Path, default=TRAINING_ROOT / "config" / "qlora_semantic_qwen3_4b.yaml")
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--base-model")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--num-epochs", type=float)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = parse_simple_yaml(args.config)
    dataset = args.dataset or REPO_ROOT / str(config.get("train_file"))
    output_dir = args.output_dir or REPO_ROOT / str(config.get("output_dir"))
    base_model = args.base_model or str(config.get("base_model"))
    row_count = validate_dataset(dataset)

    summary = {
        "base_model": base_model,
        "dataset": str(dataset),
        "rows": row_count,
        "output_dir": str(output_dir),
        "max_steps": args.max_steps if args.max_steps is not None else config.get("max_steps"),
        "num_epochs": args.num_epochs if args.num_epochs is not None else config.get("num_train_epochs"),
        "dry_run": args.dry_run,
    }
    print(json.dumps(summary, indent=2))

    if args.dry_run:
        try:
            preview_chat_template(base_model, dataset)
        except Exception as exc:  # noqa: BLE001 - dry-run must report, never crash opaquely
            print(f"chat-template preview failed (non-fatal for --dry-run): {exc!r}")
        return 0

    require_training_dependencies()

    eval_file = config.get("eval_file")
    eval_path = REPO_ROOT / str(eval_file) if eval_file else None

    run_training(
        config=config,
        dataset_path=dataset,
        eval_path=eval_path,
        base_model=base_model,
        output_dir=output_dir,
        max_steps=args.max_steps,
        num_epochs=args.num_epochs,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
