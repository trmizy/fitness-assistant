# Optional Coach Fine-Tuning Pipeline

This folder is optional. The running product still uses Ollama + Qdrant + RAG as
the primary knowledge and evidence architecture. Fine-tuning is research tooling
for coaching style, structured output reliability, and behavior consistency. It
must not be used as a storage layer for private user data.

## Data Safety Rules

- Do not train on real personal user data unless it is explicitly permitted and anonymized.
- Remove email, name, phone, addresses, IDs, and any direct identifiers.
- Do not include full medical history or sensitive notes in training examples.
- Prefer synthetic or aggregated examples.
- Keep RAG/evidence citations in Qdrant metadata. Do not teach the model to invent sources.

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

## Prepare Dataset

Dry run:

```bash
python training/scripts/prepare_coach_dataset.py --dry-run
```

Write processed splits:

```bash
python training/scripts/prepare_coach_dataset.py --force
```

Outputs:

- `training/data/processed/train.jsonl`
- `training/data/processed/eval.jsonl`

The script reads:

- `data/catalog/rag/gym_instruction_tuning_pairs.csv` if present
- `data/gym_instruction_tuning_pairs.csv` if present
- `training/data/sample_coach_context_plans.jsonl`
- `training/data/raw/*.jsonl`

## Train On A40

Prepare a cloud GPU host with CUDA and an A40-class GPU, then install ML deps in
a separate Python environment:

```bash
python -m venv .venv-train
source .venv-train/bin/activate
pip install torch transformers datasets peft trl bitsandbytes accelerate
```

Validate config and dataset:

```bash
python training/scripts/train_qlora.py \
  --config training/configs/qlora_coach_3b.yaml \
  --dataset training/data/processed/train.jsonl \
  --base-model meta-llama/Llama-3.2-3B-Instruct \
  --output-dir training/outputs/fitness-coach-qlora \
  --dry-run
```

Run training outside CI:

```bash
python training/scripts/train_qlora.py \
  --config training/configs/qlora_coach_3b.yaml \
  --dataset training/data/processed/train.jsonl \
  --base-model meta-llama/Llama-3.2-3B-Instruct \
  --output-dir training/outputs/fitness-coach-qlora \
  --num-epochs 2
```

## Evaluate

```bash
python training/scripts/evaluate_coach_model.py \
  --eval-file training/data/processed/eval.jsonl
```

Outputs:

- `training/reports/eval_report.json`
- `training/reports/eval_report.md`

Evaluation checks include structured JSON validity, available-day consistency,
calorie/macro sanity, beginner volume safety, injury safety, missing-data
follow-up behavior, citation non-hallucination smoke checks, and Vietnamese
output smoke checks.

## Export To Ollama

After a successful run:

1. Merge the adapter into the base model if your training stack produced a LoRA adapter.
2. Convert the merged model to GGUF with llama.cpp tooling.
3. Quantize, for example Q4_K_M for local development.
4. Create a `Modelfile`:

```text
FROM ./fitness-coach-ft.Q4_K_M.gguf
PARAMETER temperature 0.2
PARAMETER num_ctx 4096
SYSTEM You are a safe evidence-aware AI gym coach. Use backend CoachContext numbers and retrieved RAG evidence. Do not invent citations.
```

5. Register in Ollama:

```bash
ollama create fitness-coach-ft -f Modelfile
```

6. Set runtime env:

```bash
LLM_MODEL=fitness-coach-ft
```

Keep Qdrant/RAG enabled. The fine-tuned model improves behavior; it does not
replace evidence retrieval or backend calculation/validation.
