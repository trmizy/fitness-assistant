"""
Task §31 - generates an error-analysis.md from a predictions.jsonl file
(the per-case output of evaluate_semantics.py), grouping failures into the
error taxonomy with concrete examples. Read-only / reporting only - never
feeds heldout failures back into training data.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/error_analysis.py \
    training/semantic-qwen3-4b/outputs/baseline-v1-ollama/predictions.jsonl
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: error_analysis.py <predictions.jsonl> [output.md]")
        return 2
    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else in_path.parent / "error-analysis.md"

    cases = [json.loads(ln) for ln in in_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    by_bucket: dict[str, list[dict]] = defaultdict(list)
    for c in cases:
        for bucket in c.get("errorBuckets") or []:
            by_bucket[bucket].append(c)

    lines = [f"# Error analysis — {in_path}", "", f"Total cases: {len(cases)}", ""]
    for bucket in sorted(by_bucket.keys(), key=lambda b: -len(by_bucket[b])):
        examples = by_bucket[bucket]
        lines.append(f"## {bucket} ({len(examples)} case{'s' if len(examples) != 1 else ''})")
        for c in examples[:8]:
            lines.append(f"- `{c['caseId']}` ({c['category']}) — schemaErrors={c.get('schemaErrors')}")
        if len(examples) > 8:
            lines.append(f"- ... and {len(examples) - 8} more")
        lines.append("")

    clean = len(cases) - len({c["caseId"] for b in by_bucket.values() for c in b})
    lines.append(f"## No error bucket at all: {clean}/{len(cases)} cases")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out_path}")
    print(f"bucket counts: { {b: len(v) for b, v in by_bucket.items()} }")
    return 0


if __name__ == "__main__":
    sys.exit(main())
