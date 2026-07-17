#!/usr/bin/env python3
"""Merge a trained QLoRA adapter into its base model and export it for Ollama.

This is the bridge that was previously missing from this repo: `train_qlora.py`
produces a PEFT adapter (HF format), but ai-service serves chat through Ollama
as a quantized GGUF — two different artifact formats with no automated path
between them (training/README.md's "Export To Ollama" section used to be a
5-step manual checklist with zero corresponding code).

This script only does step 1 (merge) directly in Python via `peft`/`transformers`.
Steps 2-3 (HF -> GGUF conversion, quantization) call out to llama.cpp's own
tooling, which is intentionally NOT vendored into this repo (separate project,
its own build/license) — you need a local llama.cpp checkout with
`convert_hf_to_gguf.py` and a built `llama-quantize` binary. Step 4 (Modelfile)
is generated here.

NOT executed or verified end-to-end in this environment: no GPU host was
available in this repo/session to actually train an adapter and run this
script against real merged weights. The merge/quantize commands below match
current (2026-07) llama.cpp conventions, verified via llama.cpp's own docs,
but you should sanity-check `--help` output against your checked-out version
before a real run.

Usage:
    python training/scripts/export_adapter_to_ollama.py \\
        --adapter-dir training/outputs/fitness-coach-qlora \\
        --base-model Qwen/Qwen3-30B-A3B-Instruct-2507 \\
        --llama-cpp-dir /path/to/llama.cpp \\
        --quant-type Q4_K_M \\
        --dry-run
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODELFILE_SYSTEM = (
    "You are a safe evidence-aware AI gym coach. Use backend CoachContext "
    "numbers and retrieved RAG evidence. Do not invent citations."
)


def require_merge_dependencies() -> None:
    missing: list[str] = []
    for module in ["torch", "transformers", "peft"]:
        try:
            __import__(module)
        except Exception:
            missing.append(module)
    if missing:
        raise SystemExit(f"Missing dependencies for merge step: {', '.join(missing)}")


def merge_adapter(adapter_dir: Path, base_model: str, merged_dir: Path) -> None:
    """Loads the base model + LoRA adapter, merges weights, saves full HF checkpoint."""
    import torch  # type: ignore
    from peft import PeftModel  # type: ignore
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore

    print(f"Loading base model {base_model} ...")
    base = AutoModelForCausalLM.from_pretrained(
        base_model, torch_dtype=torch.bfloat16, device_map="auto"
    )
    tokenizer = AutoTokenizer.from_pretrained(base_model)

    print(f"Loading adapter from {adapter_dir} ...")
    merged = PeftModel.from_pretrained(base, str(adapter_dir))
    print("Merging adapter into base weights (merge_and_unload) ...")
    merged = merged.merge_and_unload()

    merged_dir.mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(str(merged_dir), safe_serialization=True)
    tokenizer.save_pretrained(str(merged_dir))
    print(f"Merged full-precision checkpoint saved to {merged_dir}")


def convert_to_gguf(
    llama_cpp_dir: Path, merged_dir: Path, gguf_f16_path: Path
) -> None:
    convert_script = llama_cpp_dir / "convert_hf_to_gguf.py"
    if not convert_script.exists():
        raise SystemExit(
            f"convert_hf_to_gguf.py not found at {convert_script}. "
            "Pass --llama-cpp-dir pointing at a checked-out llama.cpp repo."
        )
    gguf_f16_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        str(convert_script),
        str(merged_dir),
        "--outfile",
        str(gguf_f16_path),
        "--outtype",
        "f16",
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def quantize_gguf(
    llama_cpp_dir: Path, gguf_f16_path: Path, gguf_quant_path: Path, quant_type: str
) -> None:
    quantize_bin = llama_cpp_dir / "build" / "bin" / "llama-quantize"
    if not quantize_bin.exists():
        # Some builds place the binary directly under the repo root.
        quantize_bin = llama_cpp_dir / "llama-quantize"
    if not quantize_bin.exists():
        raise SystemExit(
            f"llama-quantize binary not found under {llama_cpp_dir}. "
            "Build llama.cpp first (cmake -B build && cmake --build build --target llama-quantize)."
        )
    gguf_quant_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(quantize_bin),
        str(gguf_f16_path),
        str(gguf_quant_path),
        quant_type,
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def write_modelfile(modelfile_path: Path, gguf_quant_path: Path, num_ctx: int) -> None:
    content = "\n".join(
        [
            f"FROM {gguf_quant_path.name}",
            "PARAMETER temperature 0.2",
            f"PARAMETER num_ctx {num_ctx}",
            f"SYSTEM {DEFAULT_MODELFILE_SYSTEM}",
            "",
        ]
    )
    modelfile_path.write_text(content, encoding="utf-8")
    print(f"Modelfile written to {modelfile_path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Merge a QLoRA adapter and export it to an Ollama-loadable GGUF + Modelfile"
    )
    parser.add_argument(
        "--adapter-dir",
        type=Path,
        default=REPO_ROOT / "training" / "outputs" / "fitness-coach-qlora",
        help="Directory produced by train_qlora.py (trainer.save_model output)",
    )
    parser.add_argument(
        "--base-model",
        default="Qwen/Qwen3-30B-A3B-Instruct-2507",
        help="Must match the base_model the adapter was trained against",
    )
    parser.add_argument(
        "--llama-cpp-dir",
        type=Path,
        required=True,
        help="Path to a local llama.cpp checkout with convert_hf_to_gguf.py and a built llama-quantize binary",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "training" / "outputs" / "gguf-export",
    )
    parser.add_argument("--quant-type", default="Q4_K_M")
    parser.add_argument("--num-ctx", type=int, default=8192)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the planned steps/paths without running merge/convert/quantize",
    )
    args = parser.parse_args()

    merged_dir = args.output_dir / "merged-hf"
    gguf_f16_path = args.output_dir / "fitness-coach-ft.f16.gguf"
    gguf_quant_path = args.output_dir / f"fitness-coach-ft.{args.quant_type}.gguf"
    modelfile_path = args.output_dir / "Modelfile"

    plan = {
        "adapter_dir": str(args.adapter_dir),
        "base_model": args.base_model,
        "merged_dir": str(merged_dir),
        "gguf_f16_path": str(gguf_f16_path),
        "gguf_quant_path": str(gguf_quant_path),
        "modelfile_path": str(modelfile_path),
        "next_steps_after_this_script": [
            f"ollama create fitness-coach-ft -f {modelfile_path}",
            "Set LLM_MODEL=fitness-coach-ft in ai-service env, restart ai-service",
        ],
    }
    print(plan)

    if args.dry_run:
        return 0

    if not args.adapter_dir.exists():
        raise SystemExit(
            f"Adapter dir not found: {args.adapter_dir}. Run train_qlora.py first."
        )

    require_merge_dependencies()
    merge_adapter(args.adapter_dir, args.base_model, merged_dir)
    convert_to_gguf(args.llama_cpp_dir, merged_dir, gguf_f16_path)
    quantize_gguf(args.llama_cpp_dir, gguf_f16_path, gguf_quant_path, args.quant_type)
    write_modelfile(modelfile_path, gguf_quant_path, args.num_ctx)

    if gguf_quant_path.exists():
        print(f"Done. Quantized GGUF at {gguf_quant_path}")
        print(
            "Intermediate files kept for inspection — delete "
            f"{merged_dir} and {gguf_f16_path} manually once satisfied."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
