# RunPod Launch Runbook — QLoRA Fine-Tune

> Legacy experimental path for Qwen3-30B-A3B on an A40. The current default is
> the local low-VRAM Qwen2.5 workflow in `training/README.md`. Pricing and image
> availability are time-sensitive; verify them before creating a paid pod.

Step-by-step process to actually run `train_qlora.py` and
`export_adapter_to_ollama.py` on a real GPU. This repo has no GPU access and
no RunPod credentials — every command below must be run by a human, not by
an agent. Nothing in this file has been executed end to end; commands are
cross-checked against the actual scripts' real CLI flags (`--dry-run`,
`--max-steps`, etc.), not assumed.

## 0. Before you spend any money — data readiness gate

As of 2026-07-17, `pnpm run ai:export:finetune` resolves to only **8
distinct Q&A pairs** (seeded test-account fixtures, not organic usage) and
**0 PT-approved workout plans** (see `training/README.md`'s "Data
readiness" note). Training on the current dataset mostly reinforces the
templated CSV, not real product usage. Re-check this before a *full* run:

```bash
docker compose -f infra/compose/docker-compose.dev.yml exec -T ai-service \
  pnpm run ai:export:finetune
grep -c '"tags"' training/data/raw/production_export.jsonl
```

The smoke test in step 4 is cheap enough (a few cents) to run regardless —
it validates the pipeline, not the data.

## 1. Cost reference (RunPod A40, 48GB VRAM — checked 2026-07-17)

| Tier | Price |
|---|---|
| Community Cloud | $0.35/hr |
| Secure Cloud | $0.44/hr |

Source: https://www.runpod.io/pricing — re-check before launching, prices
change. There is **no verified throughput benchmark** for QLoRA training of
Qwen3-30B-A3B on an A40 in this repo or found via research — step 4 below
measures your own real number instead of trusting an estimate.

## 2. Create the pod

1. RunPod console → Deploy → GPU Pod → **A40** (48GB VRAM).
2. Template: any recent PyTorch + CUDA template (e.g. "RunPod PyTorch 2.x").
3. Disk: the base model alone is ~61GB (bf16) — set container/volume disk to
   **at least 150GB** to hold the base model download, the 4-bit-quantized
   copy in VRAM, checkpoints, and later the merged export.
4. Start the pod, open a terminal (web terminal or SSH).

## 3. Sync the repo and set up the environment

```bash
git clone <your-fork-or-repo-url> fitness-assistant
cd fitness-assistant
bash training/scripts/runpod_setup.sh
source .venv-train/bin/activate
```

`runpod_setup.sh` creates `.venv-train/`, installs
`training/requirements.txt`, and verifies `torch.cuda.is_available()` before
declaring success — if that check fails, stop here and investigate rather
than proceeding to a paid training run.

## 4. Smoke test — validate the pipeline AND measure real throughput

```bash
python training/scripts/train_qlora.py \
  --config training/configs/qlora_coach_qwen3_30b_a3b.yaml \
  --max-steps 20
```

This downloads the base model (first run only, ~15-20 min depending on
RunPod's network), then runs 20 real training steps. Watch the printed
`logging_steps` output (config has `logging_steps: 10`, so you'll see ~2
log lines) — each line includes a `train_runtime`/step timing. Use that to
compute:

```
seconds_per_step = (time for 20 steps) / 20
total_steps      ≈ (15944 real rows today, check yours) / (per_device_train_batch_size × gradient_accumulation_steps) × num_train_epochs
                  = rows / (1 × 16) × 2   [current config defaults]
estimated_hours   = total_steps × seconds_per_step / 3600
estimated_cost    = estimated_hours × 0.35   (Community) or × 0.44 (Secure)
```

If the smoke test OOMs, reduce `per_device_train_batch_size` further (already
1) or lower `max_seq_length` in the config, not batch size below 1.

## 5. Full training run

Only proceed once step 0's data-readiness gate is actually satisfied and
step 4's cost estimate is acceptable to you.

```bash
python training/scripts/train_qlora.py \
  --config training/configs/qlora_coach_qwen3_30b_a3b.yaml
```

Runs to completion per the config (`num_train_epochs: 2`, no `max_steps`
cap). Checkpoints save every `save_steps: 100` to
`training/outputs/fitness-coach-qlora/` — if the pod is interrupted, you can
resume by pointing `--output-dir` at the same path (HF `Trainer` resumes
from the latest checkpoint automatically when the directory already has
one).

**Set a RunPod idle/max-runtime auto-stop or watch it manually** — an
unattended runaway job is the single easiest way to turn a $2 experiment
into a $200 bill.

## 6. Export to Ollama

```bash
git clone https://github.com/ggml-org/llama.cpp /workspace/llama.cpp
cd /workspace/llama.cpp && cmake -B build && cmake --build build --target llama-quantize -j
cd /workspace/fitness-assistant

python training/scripts/export_adapter_to_ollama.py \
  --adapter-dir training/outputs/fitness-coach-qlora \
  --base-model Qwen/Qwen3-30B-A3B-Instruct-2507 \
  --llama-cpp-dir /workspace/llama.cpp \
  --quant-type Q4_K_M \
  --dry-run   # confirm the planned paths first, then re-run without --dry-run
```

Produces `training/outputs/gguf-export/{fitness-coach-ft.Q4_K_M.gguf, Modelfile}`.

## 7. Evaluate before swapping production traffic

`training/scripts/evaluate_coach_model.py` does **not** call the trained
model — it only sanity-checks the structure of `eval.jsonl`'s reference
rows (JSON validity, calorie/macro ranges, etc.). It does not tell you
whether the fine-tuned model's actual generations are good. Real evaluation
requires manually registering the exported model in Ollama and comparing
its answers against the same prompts used by `test:evaluation`/`test:policy`
(`backend/services/ai-service/src/evaluation/`) — there is no automated
harness in this repo that drives a live model's output through those
checks yet.

```bash
# On the pod (or copy the GGUF+Modelfile to wherever Ollama runs):
cd training/outputs/gguf-export
ollama create fitness-coach-ft -f Modelfile
ollama run fitness-coach-ft "Cho toi lich tap 4 buoi/tuan de tang co"
```

Only after manually confirming answer quality/safety should you consider
pointing `ai-service`'s `LLM_MODEL` at `fitness-coach-ft` — and even then,
do it on a non-production environment first (this changes the model for
every request; there's no A/B or canary mechanism in ai-service today).

## 8. Tear down

**Stop or terminate the pod as soon as you're done.** RunPod bills by the
second while a pod is running, whether or not you're actively using it.

```bash
# From the RunPod console, or via their CLI/API if you have it configured —
# no such tooling exists in this repo.
```
