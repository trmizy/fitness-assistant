"""
Splits datasets/raw/<version>/*.jsonl into train/validation/heldout by
templateFamily (never splitting one family across sets), writes
datasets/processed/<version>/{train,validation,heldout}.jsonl, validates the
result, and writes datasets/processed/<version>/manifest.json (counts,
SHA-256 hashes, schema version) for reproducibility.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/build_dataset.py --version v0
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/build_dataset.py --version v1 --seed 7
"""
import argparse
import hashlib
import json
import random
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PROVENANCE = {
    "v0": "Hand-written starter/smoke seed (gymini-semantic-smoke-v0), synthetic/"
          "product-reviewed phrasing only, no real user data. A pipeline-validation "
          "set, not production training volume - kept unmodified, used for evaluator/"
          "training smoke tests.",
    "v1": "gymini-semantic-v1 - generated via a template-family generator "
          "(generate_dataset_v1.py) from hand-written base templates with real "
          "phrasing variants (canonical/casual/terse/no-accent/mixed) per the task's "
          "own category targets. Synthetic, de-identified, no real user data. "
          "Gold targets validated against the real TypeScript SemanticInterpretationSchema "
          "via validate_targets_against_schema.ts before being accepted into this set.",
    "v2": "gymini-semantic-v2 - Dataset V2 task (post-D1): expanded template-family "
          "generator (generate_dataset_v2.py), same ontology/schema as v1 (no new "
          "intents/enums - SOURCE_HEAD's SemanticInterpretationSchema, schema.ts "
          "sha256 e2d76742ff3b01d45ac2c8b8649947f2e2f773d02bd25c373bdd1c93de7cd598, "
          "no drift from v1's snapshot), broader contrastive/entity-co-occurrence/"
          "correction/reference/ambiguity coverage per D1's findings. Synthetic, "
          "de-identified, no real user data, no external model/API generation - "
          "local rule/template generation only. Gold targets validated against the "
          "real TypeScript SemanticInterpretationSchema via "
          "validate-semantic-dataset-targets.ts before being accepted into this set.",
}

# Task §11/§18: for v1/v2 (~500+ examples) use ~70/15/15. The v0 starter set
# (37 rows) keeps the original smaller-heldout heuristic since 15% of 37
# families would leave too few train families to be a meaningful smoke set.
SPLIT_RATIOS = {
    "v0": {"val": 0.10, "heldout": 0.20},
    "v1": {"val": 0.15, "heldout": 0.15},
    "v2": {"val": 0.15, "heldout": 0.15},
}


def load_rows(raw_dir: Path) -> list[dict]:
    rows = []
    for path in sorted(raw_dir.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def split_by_family(rows: list[dict], seed: int, val_ratio: float, heldout_ratio: float) -> tuple[list[dict], list[dict], list[dict]]:
    """Splits families by category independently (stratified), not by one
    global shuffle - a pure global shuffle can (and for v2, did: a seed=42
    global split put 0 FITNESS_SHORTHAND families in validation while
    heldout got 7) starve a small category out of validation entirely,
    which task §19 explicitly warns against ("do not accidentally put
    almost all hard cases in heldout"). Stratifying guarantees every
    category with enough families gets representation in both splits."""
    by_family: dict[str, list[dict]] = defaultdict(list)
    family_category: dict[str, str] = {}
    for r in rows:
        by_family[r["templateFamily"]].append(r)
        family_category[r["templateFamily"]] = r["category"]

    families_by_category: dict[str, list[str]] = defaultdict(list)
    for fam, cat in family_category.items():
        families_by_category[cat].append(fam)

    rng = random.Random(seed)
    train_families: set[str] = set()
    val_families: set[str] = set()
    heldout_families: set[str] = set()

    for cat in sorted(families_by_category):
        fams = sorted(families_by_category[cat])
        rng.shuffle(fams)
        n = len(fams)
        n_heldout = max(1, round(n * heldout_ratio)) if n >= 3 else 0
        n_val = max(1, round(n * val_ratio)) if n >= 3 else 0
        n_val = min(n_val, max(0, n - n_heldout - 1))
        heldout_families |= set(fams[:n_heldout])
        val_families |= set(fams[n_heldout:n_heldout + n_val])
        train_families |= set(fams[n_heldout + n_val:])

    train = [r for f in train_families for r in by_family[f]]
    val = [r for f in val_families for r in by_family[f]]
    heldout = [r for f in heldout_families for r in by_family[f]]
    return train, val, heldout


def write_jsonl(path: Path, rows: list[dict]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + ("\n" if rows else "")
    path.write_text(text, encoding="utf-8")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=["v0", "v1", "v2"], required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    raw_dir = ROOT / "datasets" / "raw" / args.version
    out_dir = ROOT / "datasets" / "processed" / args.version
    rows = load_rows(raw_dir)
    if not rows:
        print(f"No rows found under {raw_dir}")
        return 1

    ratios = SPLIT_RATIOS[args.version]
    train, val, heldout = split_by_family(rows, args.seed, ratios["val"], ratios["heldout"])
    hashes = {
        "train.jsonl": write_jsonl(out_dir / "train.jsonl", train),
        "validation.jsonl": write_jsonl(out_dir / "validation.jsonl", val),
        "heldout.jsonl": write_jsonl(out_dir / "heldout.jsonl", heldout),
    }

    category_counts: dict[str, int] = defaultdict(int)
    for r in rows:
        category_counts[r["category"]] += 1

    manifest = {
        "datasetVersion": args.version,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "totalCases": len(rows),
        "splitCounts": {"train": len(train), "validation": len(val), "heldout": len(heldout)},
        "categoryCounts": dict(sorted(category_counts.items())),
        "sha256": hashes,
        "schemaFile": "datasets/semantic_instruction_schema.json",
        "schemaEnumsExportedAt": json.loads((ROOT / "datasets" / "semantic_schema_enums.json").read_text(encoding="utf-8"))["exportedAt"],
        "provenance": PROVENANCE[args.version],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"[{args.version}] train={len(train)} validation={len(val)} heldout={len(heldout)}")
    print(f"manifest written to {out_dir / 'manifest.json'}")

    validator = Path(__file__).with_name("validate_dataset.py")
    py = sys.executable
    full_coverage = ["--require-full-coverage"] if args.version in ("v1", "v2") else []
    result = subprocess.run([py, str(validator), str(out_dir / "train.jsonl"), str(out_dir / "validation.jsonl"), str(out_dir / "heldout.jsonl"), *full_coverage])
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
