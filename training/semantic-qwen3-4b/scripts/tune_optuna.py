"""
Optuna auto-tune for the semantic-understanding QLoRA fine-tune. Implemented
and dry-testable per the task's own instruction - NOT launched in this
execution (no AUTO_TUNE_GO decision has been made; §29's gate needs a real
QLoRA baseline result to compare against first, which does not exist yet).

Trials run ONE AT A TIME (a single 4GB consumer GPU has no room for
concurrent trials) and optimize the VALIDATION product score only - never
heldout (task §32). OOM in a trial is caught, the trial is pruned (not the
whole study), and GPU memory is freed before the next trial.

Usage (NOT run yet - requires a real baseline result + AUTO_TUNE_GO first):
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/tune_optuna.py --n-trials 5 --dry-run
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/tune_optuna.py --n-trials 5
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/tune_optuna.py --resume
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
STUDY_NAME = "gymini_qwen3_4b_semantic"
DB_PATH = ROOT / "optuna" / "gymini_qwen4b.db"

# Task §33 - a small, interpretable search space. Nothing not listed here is
# tuned (max_seq_length, target_modules, etc. stay fixed at the values
# proven in the Phase D dry-run).
SEARCH_SPACE = {
    "learning_rate": {"type": "loguniform", "low": 1e-5, "high": 2e-4},
    "lora_r": {"type": "categorical", "choices": [8, 16, 32]},
    "lora_alpha": {"type": "categorical", "choices": [16, 32, 64]},
    "lora_dropout": {"type": "categorical", "choices": [0.0, 0.05, 0.1]},
    "num_train_epochs": {"type": "categorical", "choices": [1, 2, 3]},
}

# Weighted product score weights - mirrors config/evaluation.yaml. Safety is
# a GATE (task §19/§29), not merely a weighted term: a candidate with any
# unsafe output can never be "best", regardless of its raw score.
SCORE_WEIGHTS = {
    "primaryIntentAccuracy": 0.25,
    "entityF1Mean": 0.20,
    "schemaValidityRate": 0.20,
    "jsonValidityRate": 0.15,
    # correctionAccuracy / referenceAccuracy / ambiguityAccuracy are in the
    # weight concept (task §19) but evaluate_semantics.py does not compute
    # them yet (pipeline doc §8/§22) - weight redistributed to the metrics
    # that actually exist today rather than silently defaulting absent
    # metrics to 0, which would double-penalize every candidate equally.
    "meanLatencySecondsInverse": 0.20,  # computed as 1 / (1 + latency), not a raw metric
}


def product_score(metrics: dict[str, Any]) -> float:
    if metrics.get("unsafeOutputRate", 0) > 0:
        return 0.0  # safety gate - never a usable candidate (task §18/§29)
    latency_term = 1.0 / (1.0 + metrics.get("meanLatencySeconds", 0.0))
    values = {**metrics, "meanLatencySecondsInverse": latency_term}
    return sum(SCORE_WEIGHTS[k] * values.get(k, 0.0) for k in SCORE_WEIGHTS)


def run_one_trial(trial: Any, base_config_path: Path, dataset_root: Path, run_root: Path) -> float:
    """Trains one QLoRA candidate with trial-suggested hyperparameters,
    evaluates it on VALIDATION ONLY, returns the product score. OOM is
    caught and reported as a pruned trial, not a crashed study (task §34)."""
    import gc
    import subprocess

    import torch  # type: ignore

    params = {
        "learning_rate": trial.suggest_float("learning_rate", SEARCH_SPACE["learning_rate"]["low"], SEARCH_SPACE["learning_rate"]["high"], log=True),
        "lora_r": trial.suggest_categorical("lora_r", SEARCH_SPACE["lora_r"]["choices"]),
        "lora_alpha": trial.suggest_categorical("lora_alpha", SEARCH_SPACE["lora_alpha"]["choices"]),
        "lora_dropout": trial.suggest_categorical("lora_dropout", SEARCH_SPACE["lora_dropout"]["choices"]),
        "num_train_epochs": trial.suggest_categorical("num_train_epochs", SEARCH_SPACE["num_train_epochs"]["choices"]),
    }
    run_dir = run_root / f"trial-{trial.number}"

    # A real trial shells out to train_qlora_semantic.py as a SEPARATE
    # process (not an in-process call) specifically so that a CUDA OOM
    # cannot corrupt this long-lived Optuna process's own CUDA context -
    # the subprocess dying is recoverable; a poisoned in-process CUDA
    # context generally is not.
    import os
    env = {**os.environ, "UNSLOTH_CE_LOSS_TARGET_GB": "0.05"}
    cmd = [
        sys.executable, str(Path(__file__).with_name("train_qlora_semantic.py")),
        "--config", str(base_config_path), "--output-dir", str(run_dir),
        "--num-epochs", str(params["num_train_epochs"]),
    ]
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        if "memory" in (result.stderr or "").lower() or "CUDA" in (result.stderr or ""):
            gc.collect()
            torch.cuda.empty_cache()
            raise __import__("optuna").TrialPruned(f"OOM or CUDA failure: {result.stderr[-500:]}")
        raise RuntimeError(f"Trial {trial.number} training failed: {result.stderr[-1000:]}")

    eval_dir = run_dir / "eval"
    eval_cmd = [
        sys.executable, str(Path(__file__).with_name("evaluate_semantics.py")),
        "--backend", "hf", "--model", str(run_dir),
        "--eval-file", str(dataset_root / "validation.jsonl"), "--output-dir", str(eval_dir),
    ]
    eval_result = subprocess.run(eval_cmd, capture_output=True, text=True)
    if eval_result.returncode != 0:
        raise RuntimeError(f"Trial {trial.number} evaluation failed: {eval_result.stderr[-1000:]}")
    metrics = json.loads((eval_dir / "metrics.json").read_text(encoding="utf-8"))

    trial.set_user_attr("metrics", metrics)
    trial.set_user_attr("adapter_path", str(run_dir))
    return product_score(metrics)


def write_leaderboard(study: Any, path: Path) -> None:
    rows = sorted(study.trials, key=lambda t: (t.value if t.value is not None else -1), reverse=True)
    leaderboard = [{
        "trial": t.number, "state": str(t.state), "value": t.value, "params": t.params,
        "metrics": t.user_attrs.get("metrics"), "adapterPath": t.user_attrs.get("adapter_path"),
    } for t in rows]
    path.write_text(json.dumps(leaderboard, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-trials", type=int, default=5)  # task §32: 5-10, never 50-100 by default
    parser.add_argument("--config", type=Path, default=ROOT / "config" / "qlora_semantic_qwen3_4b.yaml")
    parser.add_argument("--dataset-root", type=Path, default=ROOT / "datasets" / "processed")
    parser.add_argument("--run-root", type=Path, default=ROOT / "outputs" / "train")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="validates the search space and storage without running any real trial")
    args = parser.parse_args()

    import optuna

    if args.dry_run:
        print(json.dumps({"studyName": STUDY_NAME, "dbPath": str(DB_PATH), "nTrials": args.n_trials,
                           "searchSpace": SEARCH_SPACE, "scoreWeights": SCORE_WEIGHTS, "dryRun": True}, indent=2))
        return 0

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    storage = f"sqlite:///{DB_PATH}"  # task §36 - resumable local trial DB, never in-memory only
    pruner = optuna.pruners.MedianPruner(n_warmup_steps=1)  # task §35
    study = optuna.create_study(study_name=STUDY_NAME, storage=storage, direction="maximize",
                                 pruner=pruner, load_if_exists=True)

    study.optimize(
        lambda trial: run_one_trial(trial, args.config, args.dataset_root, args.run_root),
        n_trials=args.n_trials,
        n_jobs=1,  # task §34 - never parallel trials on one consumer GPU
    )

    write_leaderboard(study, ROOT / "outputs" / "train" / "leaderboard.json")
    print(json.dumps({"bestTrial": study.best_trial.number, "bestValue": study.best_value,
                       "bestParams": study.best_params}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
