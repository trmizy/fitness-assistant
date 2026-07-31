#!/usr/bin/env python3
"""QLoRA trainer for coach behavior/style, using Unsloth — for LOCAL training
on a low-VRAM consumer GPU (verified on a 4GB RTX 3050 Ti). This is the
low-VRAM counterpart to train_qlora.py (which uses raw transformers/peft/
bitsandbytes and targets a large cloud GPU host like RunPod's A40).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]

# Reuse the same tiny hand-rolled YAML parser and dataset format as
# train_qlora.py — both scripts must read the exact same config/dataset
# shape, so this is deliberately duplicated rather than imported (keeps
# each script runnable standalone with only its own dependency set).


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
        raise SystemExit("CUDA GPU is required for QLoRA training.")


def format_example(row: dict[str, Any]) -> str:
    """Same Alpaca-style template as train_qlora.py — must stay identical so
    both scripts produce adapters trained on the exact same prompt shape."""
    instruction = row["instruction"]
    input_text = row.get("input") or ""
    output_text = row["output"]
    if input_text and input_text != "{}":
        return (
            f"### Instruction:\n{instruction}\n\n### Context:\n{input_text}\n\n"
            f"### Response:\n{output_text}"
        )
    return f"### Instruction:\n{instruction}\n\n### Response:\n{output_text}"


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
    from datasets import load_dataset  # type: ignore
    from unsloth import FastLanguageModel  # type: ignore
    from trl import SFTTrainer, SFTConfig  # type: ignore

    max_seq_length = int(config.get("max_seq_length", 1024))

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=max_seq_length,
        dtype=None,  # auto-detect (bf16 on this GPU, confirmed via torch.cuda.is_bf16_supported())
        load_in_4bit=bool(config.get("load_in_4bit", True)),
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=int(config.get("lora_r", 16)),
        target_modules=list(config.get("target_modules") or []) or None,
        lora_alpha=int(config.get("lora_alpha", 32)),
        lora_dropout=float(config.get("lora_dropout", 0.05)),
        bias="none",
        use_gradient_checkpointing="unsloth",  # Unsloth's own checkpointing — lower VRAM than the HF default
        random_state=3407,
    )

    data_files: dict[str, str] = {"train": str(dataset_path)}
    if eval_path and eval_path.exists():
        data_files["validation"] = str(eval_path)
    dataset = load_dataset("json", data_files=data_files)
    dataset = dataset.map(lambda row: {"text": format_example(row) + tokenizer.eos_token})

    output_dir.mkdir(parents=True, exist_ok=True)

    sft_config = SFTConfig(
        output_dir=str(output_dir),
        per_device_train_batch_size=int(config.get("per_device_train_batch_size", 1)),
        gradient_accumulation_steps=int(config.get("gradient_accumulation_steps", 8)),
        learning_rate=float(config.get("learning_rate", 2e-4)),
        num_train_epochs=num_epochs if num_epochs is not None else float(config.get("num_train_epochs", 3)),
        max_steps=max_steps if max_steps is not None else int(config.get("max_steps") or -1),
        bf16=bool(config.get("bf16", True)) and torch.cuda.is_bf16_supported(),
        fp16=not (bool(config.get("bf16", True)) and torch.cuda.is_bf16_supported()),
        logging_steps=int(config.get("logging_steps", 5)),
        save_steps=int(config.get("save_steps", 50)),
        eval_strategy="steps" if "validation" in data_files else "no",
        eval_steps=int(config.get("eval_steps", 50)) if "validation" in data_files else None,
        max_seq_length=max_seq_length,
        dataset_text_field="text",
        report_to=[],
        optim="adamw_8bit",  # Unsloth-recommended low-memory optimizer
    )

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


def validate_dataset(path: Path) -> int:
    if not path.exists():
        raise SystemExit(f"Dataset not found: {path}")
    count = 0
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            for key in ["instruction", "input", "output", "tags"]:
                if key not in row:
                    raise SystemExit(f"Dataset row {line_number} missing {key}")
            count += 1
    if count == 0:
        raise SystemExit(f"Dataset is empty: {path}")
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Train Coach QLoRA adapter locally via Unsloth")
    parser.add_argument(
        "--config",
        type=Path,
        default=REPO_ROOT / "training" / "configs" / "qlora_coach_qwen2.5_1.5b.yaml",
    )
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--base-model")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--num-epochs", type=float)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = parse_simple_yaml(args.config)
    dataset = args.dataset or REPO_ROOT / str(config.get("train_file", "training/data/processed/train.jsonl"))
    output_dir = args.output_dir or REPO_ROOT / str(config.get("output_dir", "training/outputs/fitness-coach-qlora-1.5b"))
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
