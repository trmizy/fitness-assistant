#!/usr/bin/env python3
"""Merge a QLoRA adapter (trained via train_qlora_unsloth.py) into a clean
fp16 HF checkpoint, using Unsloth's own merge path.

Why Unsloth's merge instead of plain peft.PeftModel.merge_and_unload():
the adapter was trained against `unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit`
(a 4-bit BNB-quantized base). Unsloth's `save_pretrained_merged(...,
save_method="merged_16bit")` correctly dequantizes the 4-bit base and
merges the LoRA delta in one validated path; loading the same adapter
against a plain (non-Unsloth) fp16 base via raw transformers/peft risks
a precision mismatch since the base weights the adapter was actually
trained on were 4-bit quantized, not full-precision. Uses the SAME venv
as training (has unsloth+torch-cuda already) — run this with:
    training/.venv/Scripts/python.exe training/scripts/merge_lora_unsloth.py

Usage:
    python training/scripts/merge_lora_unsloth.py \\
        --adapter-dir training/outputs/fitness-coach-qlora-1.5b \\
        --output-dir training/outputs/gguf-export/merged-hf \\
        --max-seq-length 1024
"""
from __future__ import annotations

import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge a QLoRA adapter into a clean fp16 HF checkpoint")
    parser.add_argument(
        "--adapter-dir",
        type=Path,
        default=REPO_ROOT / "training" / "outputs" / "fitness-coach-qlora-1.5b",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "training" / "outputs" / "gguf-export" / "merged-hf",
    )
    parser.add_argument("--max-seq-length", type=int, default=1024)
    args = parser.parse_args()

    if not args.adapter_dir.exists():
        raise SystemExit(f"Adapter dir not found: {args.adapter_dir}")

    from unsloth import FastLanguageModel  # type: ignore

    print(f"Loading adapter + base model from {args.adapter_dir} ...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(args.adapter_dir),
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Merging + dequantizing to fp16, saving to {args.output_dir} ...")
    model.save_pretrained_merged(
        str(args.output_dir),
        tokenizer,
        save_method="merged_16bit",
    )
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
