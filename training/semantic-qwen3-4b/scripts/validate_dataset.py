"""
Phase 3 (local Qwen3 4B semantic fine-tune) - dataset validator, run BEFORE
any training or Optuna step. Fails loudly (non-zero exit, printed reasons);
never silently drops or repairs a bad row.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/validate_dataset.py <file.jsonl> [more files...]
"""
import json
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, __file__.rsplit("/", 1)[0].rsplit("\\", 1)[0])
from semantic_schema_enums import (  # noqa: E402
    ENTITY_TYPES, GOALS, PRIMARY_INTENTS, WORKFLOW_INTENTS, REQUESTED_ACTIONS,
    REFERENCE_KINDS, CORRECTION_FIELDS, NEGATION_TARGETS, CATEGORIES, V1_CATEGORIES,
)

REQUIRED_TARGET_FIELDS = {
    "primaryIntent", "entities", "corrections", "references", "goalSignals",
    "negations", "ambiguities", "clarificationRequired", "confidence", "source",
}

REQUIRE_FULL_COVERAGE = "--require-full-coverage" in sys.argv


def fail(errors: list[str]) -> None:
    for e in errors:
        print(f"FAIL  {e}")
    print(f"\n{len(errors)} error(s). Dataset is NOT valid.")
    sys.exit(1)


def validate_target(case_id: str, target: dict, errors: list[str]) -> None:
    missing = REQUIRED_TARGET_FIELDS - target.keys()
    if missing:
        errors.append(f"{case_id}: target missing required field(s) {sorted(missing)}")
        return
    if target["primaryIntent"] not in PRIMARY_INTENTS:
        errors.append(f"{case_id}: invalid primaryIntent {target['primaryIntent']!r}")
    if "workflowIntent" in target and target["workflowIntent"] not in WORKFLOW_INTENTS:
        errors.append(f"{case_id}: invalid workflowIntent {target['workflowIntent']!r}")
    if "requestedAction" in target and target["requestedAction"] not in REQUESTED_ACTIONS:
        errors.append(f"{case_id}: invalid requestedAction {target['requestedAction']!r}")
    if target["source"] != "LLM":
        errors.append(f"{case_id}: target.source must be \"LLM\" (training target), got {target['source']!r}")
    conf = target["confidence"]
    if not isinstance(conf, (int, float)) or not (0 <= conf <= 1):
        errors.append(f"{case_id}: confidence must be a number in [0,1], got {conf!r}")
    for i, e in enumerate(target["entities"]):
        if e.get("type") not in ENTITY_TYPES:
            errors.append(f"{case_id}: entities[{i}].type invalid: {e.get('type')!r}")
        if "value" not in e or "sourceText" not in e:
            errors.append(f"{case_id}: entities[{i}] missing value/sourceText")
    for i, c in enumerate(target["corrections"]):
        if c.get("field") not in CORRECTION_FIELDS:
            errors.append(f"{case_id}: corrections[{i}].field invalid: {c.get('field')!r}")
    for i, r in enumerate(target["references"]):
        if r.get("kind") not in REFERENCE_KINDS:
            errors.append(f"{case_id}: references[{i}].kind invalid: {r.get('kind')!r}")
        if r.get("kind") == "ORDINAL_ITEM" and not r.get("ordinal"):
            errors.append(f"{case_id}: references[{i}] is ORDINAL_ITEM but missing a positive 'ordinal'")
    for i, g in enumerate(target["goalSignals"]):
        if g.get("goal") not in GOALS:
            errors.append(f"{case_id}: goalSignals[{i}].goal invalid: {g.get('goal')!r}")
        if g.get("strength") not in {"EXPLICIT", "IMPLICIT"}:
            errors.append(f"{case_id}: goalSignals[{i}].strength invalid: {g.get('strength')!r}")
    for i, n in enumerate(target["negations"]):
        if n.get("target") not in NEGATION_TARGETS:
            errors.append(f"{case_id}: negations[{i}].target invalid: {n.get('target')!r}")
    for i, a in enumerate(target["ambiguities"]):
        if not a.get("field") or not a.get("reason"):
            errors.append(f"{case_id}: ambiguities[{i}] missing field/reason")
    # Business-authority gate (task's own safety requirement): no stray keys.
    extra = target.keys() - REQUIRED_TARGET_FIELDS - {"workflowIntent", "requestedAction", "asksWhy"}
    if extra:
        errors.append(f"{case_id}: target has unsupported extra field(s) {sorted(extra)} - never widen the schema silently")


def main() -> int:
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not files:
        print("Usage: validate_dataset.py <file.jsonl> [more files...]")
        return 2

    errors: list[str] = []
    all_case_ids: Counter = Counter()
    all_inputs: Counter = Counter()
    category_counts: Counter = Counter()
    seen_template_families: dict[str, set[str]] = {}

    for path in files:
        with open(path, "r", encoding="utf-8") as f:
            lines = [ln for ln in f.read().split("\n") if ln.strip()]
        for lineno, raw in enumerate(lines, start=1):
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as e:
                errors.append(f"{path}:{lineno}: invalid JSON ({e})")
                continue
            case_id = row.get("caseId", f"<missing @ {path}:{lineno}>")
            all_case_ids[case_id] += 1

            for field in ("caseId", "category", "templateFamily", "messages", "target"):
                if field not in row:
                    errors.append(f"{case_id}: missing required field {field!r}")
            if "category" in row and row["category"] not in CATEGORIES:
                errors.append(f"{case_id}: invalid category {row['category']!r}")
            else:
                category_counts[row.get("category")] += 1

            messages = row.get("messages") or []
            if len(messages) < 2:
                errors.append(f"{case_id}: messages must have at least a system and a user turn")
            user_contents = [m.get("content", "") for m in messages if m.get("role") == "user"]
            for m in messages:
                if not m.get("content", "").strip():
                    errors.append(f"{case_id}: an empty message content is not allowed")
            if user_contents:
                last_user = user_contents[-1].strip()
                all_inputs[last_user] += 1

            try:
                json.dumps(row.get("target"))
            except (TypeError, ValueError):
                errors.append(f"{case_id}: target is not JSON-serializable")

            if isinstance(row.get("target"), dict):
                validate_target(case_id, row["target"], errors)

            family = row.get("templateFamily")
            if family:
                seen_template_families.setdefault(family, set()).add(path)

    for case_id, count in all_case_ids.items():
        if count > 1:
            errors.append(f"caseId {case_id!r} is used {count} times - case IDs must be unique")
    for text, count in all_inputs.items():
        if count > 1:
            errors.append(f"duplicate exact user input appears {count} times: {text!r}")
    for family, paths in seen_template_families.items():
        if len(paths) > 1:
            errors.append(f"SPLIT LEAKAGE: templateFamily {family!r} appears in more than one file: {sorted(paths)}")

    # Full-coverage-of-every-category is a property of a specific dataset
    # VERSION (e.g. v1's §5 target), not a universal rule for any file this
    # generic validator might be pointed at (v0's seed_v1.jsonl legitimately
    # only covers its own 10 starter categories) - callers that need full
    # coverage pass --require-full-coverage explicitly.
    if REQUIRE_FULL_COVERAGE:
        missing_categories = V1_CATEGORIES - category_counts.keys()
        if missing_categories:
            errors.append(f"no examples at all for category/categories: {sorted(missing_categories)}")

    if errors:
        fail(errors)

    print("PASS. Category coverage:")
    for cat in sorted(CATEGORIES):
        print(f"  {cat}: {category_counts.get(cat, 0)}")
    print(f"Total rows: {sum(all_case_ids.values())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
