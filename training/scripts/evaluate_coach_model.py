#!/usr/bin/env python3
"""Evaluate optional coach fine-tuning outputs and dataset behavior."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EVAL = REPO_ROOT / "training" / "data" / "processed" / "eval.jsonl"
DEFAULT_REPORT_DIR = REPO_ROOT / "training" / "reports"


def load_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"Eval file not found: {path}")
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise SystemExit(f"Invalid row at {path}:{line_number}")
            rows.append(value)
    return rows


def score_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    json_valid = 0
    has_safety = 0
    has_followup_when_missing = 0
    vietnamese_smoke = 0
    citation_safe = 0

    for row in rows:
      output = str(row.get("output", ""))
      parsed = None
      try:
          parsed = json.loads(output)
          json_valid += 1
      except Exception:
          parsed = None

      text = output.lower()
      if "safety" in text or "pain" in text or "injury" in text or "stop" in text:
          has_safety += 1
      if "missing_data_questions" in text or "please provide" in text:
          has_followup_when_missing += 1
      if any(token in text for token in ["ngay", "buoi", "tap", "protein", "calo", "vietnamese"]):
          vietnamese_smoke += 1
      if parsed is not None and "doi" not in text and "pubmed" not in text:
          citation_safe += 1

    def ratio(value: int) -> float:
        return round(value / total, 4) if total else 0.0

    return {
        "total": total,
        "structured_json_validity": ratio(json_valid),
        "safety_note_presence": ratio(has_safety),
        "missing_data_followup_behavior": ratio(has_followup_when_missing),
        "vietnamese_output_smoke": ratio(vietnamese_smoke),
        "citation_non_hallucination_smoke": ratio(citation_safe),
    }


def write_reports(scores: dict[str, Any], report_dir: Path) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "eval_report.json").write_text(json.dumps(scores, indent=2), encoding="utf-8")
    md = [
        "# Coach Model Evaluation Report",
        "",
        f"- Total examples: {scores['total']}",
        f"- Structured JSON validity: {scores['structured_json_validity']}",
        f"- Safety note presence: {scores['safety_note_presence']}",
        f"- Missing data follow-up behavior: {scores['missing_data_followup_behavior']}",
        f"- Vietnamese output smoke: {scores['vietnamese_output_smoke']}",
        f"- Citation non-hallucination smoke: {scores['citation_non_hallucination_smoke']}",
    ]
    (report_dir / "eval_report.md").write_text("\n".join(md) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate coach dataset/model outputs")
    parser.add_argument("--eval-file", type=Path, default=DEFAULT_EVAL)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    rows = load_rows(args.eval_file)
    scores = score_rows(rows)
    print(json.dumps(scores, indent=2))
    if not args.dry_run:
        write_reports(scores, args.report_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
