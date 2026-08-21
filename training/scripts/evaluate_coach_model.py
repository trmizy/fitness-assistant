#!/usr/bin/env python3
"""Evaluate optional coach fine-tuning outputs and dataset behavior."""
from __future__ import annotations

import argparse
import json
import re
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


def infer_contract(row: dict[str, Any], parsed: Any | None) -> tuple[str, str]:
    explicit_contract = str(row.get("response_contract", "")).strip()
    explicit_task = str(row.get("task_type", "")).strip()
    if explicit_contract:
        return explicit_task or "unknown", explicit_contract
    tags = " ".join(str(item) for item in row.get("tags", []))
    instruction = str(row.get("instruction", ""))
    folded = f"{instruction} {tags}".lower()
    if isinstance(parsed, dict) and (
        "weeklySchedule" in parsed or "weekly_schedule" in parsed
    ):
        return "workout_plan", "structured_json"
    if any(token in folded for token in ["rag", "citation", "evidence", "source_url"]):
        return "rag_answer", "answer_with_evidence"
    if isinstance(parsed, (dict, list)):
        return "structured_fitness", "structured_json"
    return "fitness_qa", "free_text"


def has_vietnamese_signal(text: str) -> bool:
    folded = text.lower()
    return any(
        token in folded
        for token in [
            "bạn", "tập", "buổi", "ngày", "nên", "không", "mục tiêu",
            "protein", "calo", "đau", "chấn thương",
        ]
    )


def score_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    json_valid = 0
    structured_total = 0
    has_safety = 0
    has_followup_when_missing = 0
    vietnamese_smoke = 0
    citation_safe = 0
    by_contract: dict[str, dict[str, int]] = {}

    for row in rows:
      output = str(row.get("output", ""))
      parsed = None
      try:
          parsed = json.loads(output)
      except Exception:
          parsed = None

      _task_type, contract = infer_contract(row, parsed)
      bucket = by_contract.setdefault(
          contract,
          {"total": 0, "json_valid": 0, "vietnamese": 0, "safety": 0, "citation_safe": 0},
      )
      bucket["total"] += 1
      if contract == "structured_json":
          structured_total += 1
      if contract == "structured_json" and parsed is not None:
          json_valid += 1
          bucket["json_valid"] += 1

      text = output.lower()
      if any(token in text for token in ["safety", "pain", "injury", "stop", "đau", "dừng", "khó thở", "chóng mặt"]):
          has_safety += 1
      if "missing_data_questions" in text or "please provide" in text:
          has_followup_when_missing += 1
      if has_vietnamese_signal(output):
          vietnamese_smoke += 1
          bucket["vietnamese"] += 1
      if any(token in text for token in ["safety", "pain", "injury", "stop", "đau", "dừng", "khó thở", "chóng mặt"]):
          bucket["safety"] += 1
      if contract == "answer_with_evidence" and isinstance(parsed, dict):
          evidence = parsed.get("evidence", []) if isinstance(parsed, dict) else []
          safe = isinstance(evidence, list) and all(
              isinstance(item, dict)
              and str(item.get("url", item.get("source_url", ""))).startswith(("http://", "https://"))
              for item in evidence
          )
      elif contract == "answer_with_evidence":
          urls = re.findall(r"https?://[^\s)\]]+", output)
          safe = all(url.startswith(("http://", "https://")) for url in urls)
      else:
          safe = "doi" not in text and "pubmed" not in text and "source_url" not in text
      if safe:
          citation_safe += 1
          bucket["citation_safe"] += 1

    def ratio(value: int) -> float:
        return round(value / total, 4) if total else 0.0

    contract_scores = {
        contract: {
            "total": values["total"],
            "json_validity": (
                round(values["json_valid"] / values["total"], 4)
                if contract == "structured_json"
                else None
            ),
            "vietnamese_smoke": round(values["vietnamese"] / values["total"], 4),
            "safety_note_presence": round(values["safety"] / values["total"], 4),
            "citation_non_hallucination_smoke": round(values["citation_safe"] / values["total"], 4),
        }
        for contract, values in by_contract.items()
    }

    return {
        "total": total,
        "structured_json_total": structured_total,
        "structured_json_validity": (
            round(json_valid / structured_total, 4) if structured_total else None
        ),
        "safety_note_presence": ratio(has_safety),
        "missing_data_followup_behavior": ratio(has_followup_when_missing),
        "vietnamese_output_smoke": ratio(vietnamese_smoke),
        "citation_non_hallucination_smoke": ratio(citation_safe),
        "by_response_contract": contract_scores,
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
        "",
        "## Metrics by response contract",
        "",
        "```json",
        json.dumps(scores["by_response_contract"], indent=2, ensure_ascii=False),
        "```",
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
