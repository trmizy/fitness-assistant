#!/usr/bin/env python3
"""Prepare optional coach fine-tuning data.

This script never reads production databases. It only consumes repository data files
and optional anonymized/synthetic JSONL files under training/data/raw.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "training" / "data" / "processed"
DEFAULT_SPLIT_RATIO = 0.9
PRIVATE_PATTERNS = [
    re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I),
    re.compile(r"\b(?:\+?\d[\d\s().-]{7,}\d)\b"),
]


def repo_candidates() -> list[Path]:
    return [
        REPO_ROOT / "data" / "gym_instruction_tuning_pairs.csv",
        REPO_ROOT / "data" / "catalog" / "rag" / "gym_instruction_tuning_pairs.csv",
        REPO_ROOT / "training" / "data" / "sample_coach_context_plans.jsonl",
    ]


def has_private_text(value: str) -> bool:
    return any(pattern.search(value) for pattern in PRIVATE_PATTERNS)


def parse_json_string(value: str) -> Any | None:
    try:
        return json.loads(value)
    except Exception:
        return None


def normalize_example(raw: dict[str, Any], source: str) -> dict[str, Any] | None:
    # Field names vary by source: hand-written JSONL uses instruction/output,
    # while the curated gym_instruction_tuning_pairs.csv (25k+ rows) uses the
    # user_query_vi/expected_response_vi/system_hint column names instead.
    instruction = str(
        raw.get("instruction")
        or raw.get("prompt")
        or raw.get("question")
        or raw.get("user_query_vi")
        or ""
    ).strip()
    output = (
        raw.get("output")
        or raw.get("response")
        or raw.get("answer")
        or raw.get("expected_response_vi")
    )
    input_value = (
        raw.get("input")
        or raw.get("context")
        or raw.get("system_hint")
        or "{}"
    )
    tags = raw.get("tags") or []
    if isinstance(tags, str):
        # Split BEFORE any `list(tags) + [...]` below — list() on a raw string
        # decomposes it into individual characters, not tags.
        delimiter = "|" if "|" in tags else ","
        tags = [item.strip() for item in tags.split(delimiter) if item.strip()]

    if isinstance(input_value, dict):
        input_text = json.dumps(input_value, ensure_ascii=False, separators=(",", ":"))
    else:
        input_text = str(input_value).strip() or "{}"

    if isinstance(output, dict):
        output_text = json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    else:
        output_text = str(output or "").strip()

    if not instruction or not output_text:
        return None
    if has_private_text("\n".join([instruction, input_text, output_text])):
        return None

    output_json = parse_json_string(output_text)
    if output_json is None:
        # Keep legacy instruction examples only when they are clearly not plan JSON.
        # They remain useful for style/reasoning research but should be tagged.
        tags = list(tags) + ["unstructured_output"]

    tags = sorted(set([str(item) for item in tags] + ["fitness", "coach", f"source:{source}"]))

    return {
        "instruction": instruction,
        "input": input_text,
        "output": output_text,
        "tags": tags,
    }


def read_csv_examples(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            yield row


def read_jsonl_examples(path: Path) -> Iterable[dict[str, Any]]:
    # utf-8-sig transparently strips a leading BOM when present and behaves
    # exactly like utf-8 otherwise, so it is safe for both BOM and non-BOM files.
    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"Invalid JSONL at {path}:{line_number}: {exc}") from exc
            if not isinstance(value, dict):
                raise SystemExit(f"Invalid JSONL at {path}:{line_number}: expected object")
            yield value


def load_examples() -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    for path in repo_candidates():
        if not path.exists():
            continue
        source = path.name
        if path.suffix.lower() == ".csv":
            rows = read_csv_examples(path)
        else:
            rows = read_jsonl_examples(path)
        for row in rows:
            item = normalize_example(row, source)
            if item:
                examples.append(item)

    raw_dir = REPO_ROOT / "training" / "data" / "raw"
    for path in sorted(raw_dir.glob("*.jsonl")):
        for row in read_jsonl_examples(path):
            item = normalize_example(row, path.name)
            if item:
                examples.append(item)

    return dedupe(examples)


def dedupe(examples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in examples:
        key = f"{item['instruction']}\n{item['input']}\n{item['output']}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def write_jsonl(path: Path, examples: list[dict[str, Any]], force: bool) -> None:
    if path.exists() and not force:
        raise SystemExit(f"Refusing to overwrite {path}. Re-run with --force.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for item in examples:
            handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare optional coach instruction dataset")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--eval-ratio", type=float, default=1 - DEFAULT_SPLIT_RATIO)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not 0 < args.eval_ratio < 0.5:
        raise SystemExit("--eval-ratio must be between 0 and 0.5")

    examples = load_examples()
    if not examples:
        raise SystemExit("No dataset examples found. Add training/data/raw/*.jsonl or repo instruction examples.")

    random.Random(args.seed).shuffle(examples)
    eval_size = max(1, int(len(examples) * args.eval_ratio)) if len(examples) > 1 else 0
    eval_examples = examples[:eval_size]
    train_examples = examples[eval_size:]

    summary = {
        "total": len(examples),
        "train": len(train_examples),
        "eval": len(eval_examples),
        "output_dir": str(args.output_dir),
        "dry_run": args.dry_run,
    }
    print(json.dumps(summary, indent=2))

    if args.dry_run:
        return 0

    write_jsonl(args.output_dir / "train.jsonl", train_examples, args.force)
    write_jsonl(args.output_dir / "eval.jsonl", eval_examples, args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
