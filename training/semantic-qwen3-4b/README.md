# Semantic-Understanding QLoRA Fine-Tune (Qwen3 4B) — Local Pipeline

Sibling to `../README.md` (the Qwen2.5-1.5B coach pipeline) — shares its
`.venv`, `llama.cpp/`, data-safety policy, and merge/export scripts. Do not
duplicate those; this directory only adds what's genuinely new for this
model/task (see `docs/ai-training/local-qwen4b-discovery.md` §I).

Target: Gymini's conversational semantic-understanding layer (intent,
entities, correction, reference, ambiguity) — NOT a general coaching model.
See `docs/ai-training/local-qwen4b-training-pipeline.md` for the full
record, including every real failure/fix hit while getting a tiny GPU run
working on this exact 4GB card.

**Status at last run: execution stopped after the base-model baseline eval
per a `REPOSITORY_BASELINE_CHANGED` condition — no real QLoRA baseline/
Optuna run has happened yet.** The steps below are all real and runnable;
pick up from wherever the pipeline doc's §22 left off.

## Step 1 — environment

Already set up (`training/.venv`, Python 3.11.15, `uv`-managed, no `pip`
module — use the venv's `python.exe` directly). Verify:

```powershell
training\.venv\Scripts\python.exe --version
```

## Step 2 — validate the dataset

```powershell
training\.venv\Scripts\python.exe training\semantic-qwen3-4b\scripts\build_dataset.py --seed 42
```

Splits `datasets/raw/*.jsonl` into `datasets/processed/{train,validation,heldout}.jsonl`
by `templateFamily` (no leakage), writes `datasets/manifest.json`, and
re-validates the result.

## Step 3 — run the baseline (current production model)

```powershell
training\.venv\Scripts\python.exe training\semantic-qwen3-4b\scripts\evaluate_semantics.py `
  --backend ollama --model qwen3:4b-instruct-2507-q4_K_M `
  --eval-file training\semantic-qwen3-4b\datasets\processed\validation.jsonl `
  --output-dir training\semantic-qwen3-4b\outputs\baseline
```

Requires a running local Ollama with the exact model tag (`ollama list`).
**Known issue (not yet fixed):** the last real run returned a 0% JSON-
validity rate that looks like an evaluator bug, not real model behavior —
inspect `outputs/baseline/predictions.jsonl` and Ollama's raw response shape
before trusting these numbers.

## Step 4 — train a QLoRA candidate

Dry-run first (config/dataset/chat-template check, no GPU):

```powershell
training\.venv\Scripts\python.exe training\semantic-qwen3-4b\scripts\train_qlora_semantic.py --dry-run
```

Real tiny run (the exact command proven to work on this machine):

```powershell
$env:UNSLOTH_CE_LOSS_TARGET_GB = "0.05"
training\.venv\Scripts\python.exe training\semantic-qwen3-4b\scripts\train_qlora_semantic.py --max-steps 3 --num-epochs 1
```

`UNSLOTH_CE_LOSS_TARGET_GB` is required on this 4GB card — without it,
training reaches the first real step and then fails with "No or negligible
GPU memory available for fused cross entropy" (see the pipeline doc §13).
Once stable, drop `--max-steps`/`--num-epochs` to use the full config.

## Step 5 — compare candidate

```powershell
training\.venv\Scripts\python.exe training\semantic-qwen3-4b\scripts\evaluate_semantics.py `
  --backend hf --model training\semantic-qwen3-4b\outputs\train\<run-id> `
  --eval-file training\semantic-qwen3-4b\datasets\processed\validation.jsonl `
  --output-dir training\semantic-qwen3-4b\outputs\train\<run-id>\eval
```

(`--backend hf` is declared in `evaluate_semantics.py`'s CLI but not yet
implemented — needs a `transformers.generate()` path added before this
works.)

## Step 6 — optionally run Optuna

Not implemented yet. Requires `optuna` (not in the venv) and a real
baseline result to gate on first (task's own go/no-go rule).

## Step 7 — evaluate final heldout

Run `evaluate_semantics.py` once, pointed at `datasets/processed/heldout.jsonl`,
only after a best candidate is chosen from validation alone. Do not retune
after seeing it.

## Step 8 — export to Ollama

Reuse the existing, already-proven path, pointed at this adapter instead of
the coach one:

```powershell
training\.venv\Scripts\python.exe training\scripts\merge_lora_unsloth.py `
  --adapter-dir training\semantic-qwen3-4b\outputs\train\<run-id> `
  --output-dir training\semantic-qwen3-4b\outputs\gguf-export\merged-hf `
  --max-seq-length 256
```

Then convert/quantize via `training/llama.cpp/` and `ollama create` under a
**new** local tag (e.g. `gymini-qwen3-4b-semantic-v1`) — never overwrite the
production `qwen3:4b-instruct-2507-q4_K_M` tag, and never change `.env`'s
`LLM_MODEL` without a separate, explicit decision.
