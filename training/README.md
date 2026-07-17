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
- `training/data/raw/*.jsonl` — including `production_export.jsonl` from
  `pnpm run ai:export:finetune` (see `src/scripts/exportFineTuneDataset.ts`),
  which pulls thumbs-up conversations and PT-approved plans

**Data readiness (checked 2026-07-17, this environment):** the templated CSV
is still ~99.8% of the processed dataset. The production export currently
resolves to only 8 distinct Q&A pairs (from seeded test-account fixtures,
not organic user traffic) and 0 PT-approved workout plans — training on this
today would mostly reinforce the templated CSV's phrasing, not real usage
patterns. Re-run the export once there's a meaningful volume of real
thumbs-up feedback and PT approvals before treating a training run as
representative of actual product usage.

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
  --config training/configs/qlora_coach_qwen3_30b_a3b.yaml \
  --dataset training/data/processed/train.jsonl \
  --base-model Qwen/Qwen3-30B-A3B-Instruct-2507 \
  --output-dir training/outputs/fitness-coach-qlora \
  --dry-run
```

Run training outside CI:

```bash
python training/scripts/train_qlora.py \
  --config training/configs/qlora_coach_qwen3_30b_a3b.yaml \
  --dataset training/data/processed/train.jsonl \
  --base-model Qwen/Qwen3-30B-A3B-Instruct-2507 \
  --output-dir training/outputs/fitness-coach-qlora \
  --num-epochs 2
```

`Qwen/Qwen3-30B-A3B-Instruct-2507` is the exact HF source of the production
Ollama model (`LLM_MODEL=qwen3:30b-a3b-instruct-2507-q4_K_M`) — training
against any other base model produces an adapter that can never be deployed
into the live chat. See `training/configs/qlora_coach_qwen3_30b_a3b.yaml`'s
header comment for VRAM estimates and MoE-specific caveats (not verified
end-to-end in this repo — no GPU host was available to run a real job).

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

`training/scripts/export_adapter_to_ollama.py` automates the merge step
directly (via `peft`/`transformers`) and drives llama.cpp's own conversion +
quantization tooling for the rest, then writes the `Modelfile`. It requires a
local llama.cpp checkout (`convert_hf_to_gguf.py` + a built `llama-quantize`
binary) — llama.cpp is intentionally not vendored into this repo.

Dry run first (prints the planned file layout, no ML deps required):

```bash
python training/scripts/export_adapter_to_ollama.py \
  --adapter-dir training/outputs/fitness-coach-qlora \
  --base-model Qwen/Qwen3-30B-A3B-Instruct-2507 \
  --llama-cpp-dir /path/to/llama.cpp \
  --quant-type Q4_K_M \
  --dry-run
```

Then for real (needs `torch`, `transformers`, `peft` in your training venv):

```bash
python training/scripts/export_adapter_to_ollama.py \
  --adapter-dir training/outputs/fitness-coach-qlora \
  --base-model Qwen/Qwen3-30B-A3B-Instruct-2507 \
  --llama-cpp-dir /path/to/llama.cpp \
  --quant-type Q4_K_M
```

This writes `training/outputs/gguf-export/{merged-hf/, fitness-coach-ft.f16.gguf,
fitness-coach-ft.Q4_K_M.gguf, Modelfile}`. Then register in Ollama and point
production at it:

```bash
cd training/outputs/gguf-export
ollama create fitness-coach-ft -f Modelfile
```

```bash
LLM_MODEL=fitness-coach-ft
```

Not verified end-to-end in this repo: no GPU host was available to actually
train an adapter and run this script against real merged weights — the
merge/convert/quantize commands match current (2026-07) llama.cpp
conventions, verified via llama.cpp's own docs, but sanity-check `--help`
output against your checked-out version before a real run.

Keep Qdrant/RAG enabled. The fine-tuned model improves behavior; it does not
replace evidence retrieval or backend calculation/validation.
