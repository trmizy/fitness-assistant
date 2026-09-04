# Optional Coach Fine-Tuning Pipeline

This directory contains an optional QLoRA research workflow. The application
does not need it to run: production features use the configured Ollama model,
Qdrant retrieval, deterministic fitness logic, and safety validation.

Current low-VRAM workflow:

- Base: `unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit`
- Config: `training/configs/qlora_coach_qwen2.5_1.5b.yaml`
- Trainer: `training/scripts/train_qlora_unsloth.py`
- Runtime model name: `fitness-coach-qwen2.5-1.5b:q4_K_M`
- Intended hardware: a local CUDA GPU with about 4 GB VRAM

The Qwen3 30B A3B config and RunPod A40 runbook are retained as an experimental
reference. They are not the current default and were not validated end to end.

## Data Safety

- Do not train on real personal data unless use is explicitly permitted and the
  records are anonymized.
- Remove names, emails, phone numbers, addresses, account IDs, and direct identifiers.
- Do not include full medical histories or sensitive private notes.
- Prefer synthetic, reviewed, or aggregated examples.
- Keep evidence citations in Qdrant metadata; do not train the model to invent sources.

## Dataset Format

Each JSONL row follows `training/data/coach_instruction_schema.json`:

```json
{
  "instruction": "Analyze the trainee context and create a safe personalized gym plan.",
  "input": "{ CoachContext JSON }",
  "output": "{ StructuredCoachPlan JSON }",
  "tags": ["fitness", "inbody", "nutrition", "workout", "vietnamese", "safety"]
}
```

The preparation script reads approved local sources, sample contexts, and
`training/data/raw/*.jsonl`. A production export can be generated with
`pnpm --filter @gym-coach/ai-service run ai:export:finetune`, but its rows still
require privacy and quality review.

## Prepare Data

```powershell
python training/scripts/prepare_coach_dataset.py --dry-run
python training/scripts/prepare_coach_dataset.py --force
```

Outputs:

- `training/data/processed/train.jsonl`
- `training/data/processed/eval.jsonl`
- `training/data/processed/eval_small.jsonl` when prepared for the local workflow

Do not start a paid or overnight training run until the dataset mix is checked.
A dataset dominated by templated examples measures template imitation, not
general coaching quality.

## Validate The Training Configuration

Use the same Python environment intended for the real training run:

```powershell
python training/scripts/train_qlora_unsloth.py --dry-run
```

The command validates paths and prints the resolved base model, dataset, output
directory, step limit, and epoch count without loading CUDA training libraries.

## Train Locally

Install a CUDA-compatible PyTorch and Unsloth environment separately from the
Node workspace. Then run a short smoke test:

```powershell
python training/scripts/train_qlora_unsloth.py --max-steps 20
```

Run the configured training job only after the smoke test is stable:

```powershell
python training/scripts/train_qlora_unsloth.py
```

The checked-in config targets one practical overnight-style epoch and a reduced
evaluation subset. Training duration and memory use depend on the local GPU and
installed CUDA stack; the numbers in config comments are measurements from one
machine, not a guarantee.

## Evaluate

```powershell
python training/scripts/evaluate_coach_model.py --eval-file training/data/processed/eval.jsonl
```

The evaluator checks structured JSON validity, schedule consistency,
calorie/macro sanity, beginner volume, injury safety, missing-data behavior,
citation non-hallucination, and Vietnamese output.

Outputs are written under `training/reports/` and must be reviewed before
changing the application's `LLM_MODEL`.

## Merge And Export

The active adapter was trained against an Unsloth 4-bit base. Merge it through
Unsloth's own path:

```powershell
python training/scripts/merge_lora_unsloth.py `
  --adapter-dir training/outputs/fitness-coach-qlora-1.5b `
  --output-dir training/outputs/gguf-export/merged-hf `
  --max-seq-length 1024
```

Convert the merged Hugging Face checkpoint with a compatible llama.cpp checkout,
quantize it to GGUF, and create an Ollama model. llama.cpp is intentionally not
vendored into this repository.

After creating the model, verify it before selecting it in `.env`:

```powershell
ollama list
ollama run fitness-coach-qwen2.5-1.5b:q4_K_M
```

```dotenv
LLM_MODEL=fitness-coach-qwen2.5-1.5b:q4_K_M
```

Restart `ai-service` after changing the model and run the AI policy, evaluation,
RAG, workout-plan, nutrition, and InBody chat checks.

## Legacy RunPod Experiment

[`RUNPOD_RUNBOOK.md`](RUNPOD_RUNBOOK.md) documents the older
Qwen3-30B-A3B/A40 experiment. Its cost figures are time-sensitive and its
commands intentionally use `qlora_coach_qwen3_30b_a3b.yaml`. Do not confuse that
reference workflow with the current local Qwen2.5 runtime.
