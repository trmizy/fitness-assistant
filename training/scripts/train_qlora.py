#!/usr/bin/env python3
"""Optional QLoRA trainer for coach behavior/style.

This is intentionally outside CI. It should run on a cloud GPU host, for example
an A40 box with CUDA, PyTorch, Transformers, PEFT, bitsandbytes, and TRL.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]


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
    for module in ["torch", "transformers", "datasets", "peft", "trl", "bitsandbytes"]:
        try:
            __import__(module)
        except Exception:
            missing.append(module)
    if missing:
        raise SystemExit(f"Missing training dependencies: {', '.join(missing)}")

    import torch  # type: ignore
    if not torch.cuda.is_available():
        raise SystemExit("CUDA GPU is required for QLoRA training. Use a cloud GPU host such as A40.")


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
    parser = argparse.ArgumentParser(description="Train optional Coach QLoRA adapter")
    parser.add_argument("--config", type=Path, default=REPO_ROOT / "training" / "configs" / "qlora_coach_3b.yaml")
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--base-model")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--num-epochs", type=float)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = parse_simple_yaml(args.config)
    dataset = args.dataset or REPO_ROOT / str(config.get("train_file", "training/data/processed/train.jsonl"))
    output_dir = args.output_dir or REPO_ROOT / str(config.get("output_dir", "training/outputs/fitness-coach-qlora"))
    base_model = args.base_model or str(config.get("base_model", "llama3.2:3b"))
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

    raise SystemExit(
        "Training scaffold validated. Wire this script to SFTTrainer on the GPU host, "
        "or use the generated Axolotl-compatible config with your internal training runner."
    )


if __name__ == "__main__":
    raise SystemExit(main())
