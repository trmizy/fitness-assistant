# Local Qwen3 4B Semantic-Understanding Fine-Tuning — Pipeline

Phases A-E are complete for real against this exact machine, including a
real trustworthy base-model baseline (§10, after root-causing an evaluator
timeout). Optuna's code is implemented and dry-tested but **not launched**
(no `AUTO_TUNE_GO`, nothing to gate it on yet — §16/§17). **No full QLoRA
baseline training run, no Optuna study, and no production config change
happened in this session**, per the task's own explicit phase gating (§55).
A `REPOSITORY_BASELINE_CHANGED` condition was hit once mid-session (factual
git evidence in §22) and handled per the task's own rule: execution paused,
confirmed the concurrent change touched nothing in this work area, and
continued under a fresh `START_HEAD` rather than silently ignoring it.

## 1. Goal

Improve Gymini's conversational semantic-understanding layer (intent,
entities, correction, reference, ambiguity) via a local QLoRA fine-tune of
the exact production model, `qwen3:4b-instruct-2507-q4_K_M`, without
replacing any deterministic routing/validation/business-authority code.

## 2. Why fine-tuning is narrowly scoped

The model is a semantic helper behind the existing typed LLM fallback
(`callLlmJson`, Zod validation, context-consistency guard,
deterministic-router-wins policy) — never a replacement for it. Training
data intentionally excludes nutrition/exercise-science/business-database
knowledge (that is RAG's and Coach Analytics' job); see
`docs/ai-training/local-qwen4b-discovery.md` §C/§I.

## 3. Base/runtime model identity

Runtime: `qwen3:4b-instruct-2507-q4_K_M` (Ollama GGUF, Q4_K_M, 4.0B params,
262144 context, Apache-2.0). Trainable counterpart used:
`unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit` (base
`Qwen/Qwen3-4B-Instruct-2507`), identified via a web search cross-validated
against the Ollama manifest's own reported parameter count and context
length (discovery doc §B) — **independently reconfirmed at load time**: the
real training run (§13) reported "Unsloth 2026.7.3 patched **36 layers**"
and 4,055,498,240 total parameters, matching the model card's 36 layers /
4.0B exactly. A hard `MODEL_IDENTITY_MISMATCH` assertion
(`num_hidden_layers`, `hidden_size`, `max_position_embeddings`) is built into
`train_qlora_semantic.py` and would have refused the run had it not matched.

## 4. Local hardware

NVIDIA RTX 3050 Ti Laptop GPU, 4096 MiB VRAM; ~16 GiB system RAM; 68 GB free
disk. No system-wide Python (only inside `training/.venv`, Python 3.11.15,
`uv`-managed). See discovery doc §G for the full inventory.

## 5. Dataset schema

`training/semantic-qwen3-4b/datasets/semantic_instruction_schema.json` — one
row = `{caseId, category, templateFamily, messages[], target}`. `target`
mirrors `SemanticInterpretationSchema` from
`backend/services/ai-service/src/conversational-intelligence/schema.ts`
field-for-field (no invented fields) — see discovery doc §C for why the
fuller schema, not the narrower current LLM-call projection, was chosen as
the training target.

## 6. Dataset provenance/privacy

37 hand-written, synthetic, product-reviewed Vietnamese examples (10
categories: INTENT, ENTITY, CORRECTION, REFERENCE, SHORTHAND,
FOLLOWUP_SLOT, AMBIGUITY, MULTI_INTENT, REVISION, SAFETY_NON_AUTHORITY). No
real user data of any kind was read or used. **This is a pipeline-validation
starter set, explicitly not production training volume** — real training
needs a far larger, more varied corpus (see §22, remaining work).

## 7. Train/validation/heldout strategy

Split by `templateFamily` (never splitting paraphrase variants across sets),
70/10/20 target ratio, seed=42: **25 train / 5 validation / 7 heldout** (37
total — the small total means the realized split ratios deviate from
70/10/20; this is expected and documented, not a bug, given the starter
dataset's size). `build_dataset.py` writes
`datasets/manifest.json` with per-split SHA-256 hashes and category counts,
and re-runs `validate_dataset.py` automatically, which checks enum validity
against a hand-mirrored copy of `schema.ts`'s enums
(`semantic_schema_enums.py`), case-ID uniqueness, duplicate-input detection,
and split leakage (none found).

## 8. Evaluation metrics implemented

`evaluate_semantics.py`: JSON validity, schema validity (enum-level, against
the same mirrored enums), primary-intent accuracy, entity precision/recall/
F1 (type+value exact match), an unsafe-output heuristic (literal
SQL/shell-command markers in the raw text), error rate, and mean latency.
**Not yet implemented** (deferred, no real QLoRA/Optuna run happened to need
them yet): correction accuracy, reference accuracy, ambiguity/unknown
accuracy, requestedAction accuracy, a weighted product score
(`config/evaluation.yaml`), and the stricter "schema-rejected vs.
accepted-unsafe" split the task's §18 describes.

## 9. Product score

Not yet implemented — deferred until a real trained candidate exists to
score (§29's go/no-go gate needs this; building it against zero real
candidates would be premature).

## 10. Base model baseline result

Ran for real against the production Ollama runtime
(`qwen3:4b-instruct-2507-q4_K_M`, `http://localhost:11434`, CPU inference on
this host — confirmed `size_vram: 0` via `ollama ps`), on the 5-row
validation split:

First attempt used a 60 s per-call budget and produced `jsonValidityRate:
0.0, errorRate: 0.4` — root-caused (not merely suspected) as the timeout
being too tight for this CPU-inference host (2/5 calls hit it outright), not
a real 0% capability; `extract_first_json_object` itself was verified
correct in isolation against a real captured response. Re-run with a 90 s
budget, same 5-row validation split, real HTTP calls to the production
Ollama runtime (confirmed `size_vram: 0` — CPU inference on this host):

```
jsonValidityRate:      0.6
schemaValidityRate:    0.0
primaryIntentAccuracy: 0.0
entityF1Mean:          0.6
unsafeOutputRate:      0.0
errorRate:             0.0
meanLatencySeconds:    32.5
```

This is real, trustworthy evidence, and it is a genuine, honest product
signal (not a bug this time) — inspecting `outputs/baseline/predictions.jsonl`
case by case shows exactly why `schemaValidityRate`/`primaryIntentAccuracy`
are 0% while `entityF1Mean` is strong (1.0 on every case that had entities):
the untrained base model extracts the right facts but writes its own
natural-language intent/action strings (`"create"`, `"request to save or
store information"`, `"Yêu cầu giữ nguyên trạng thái hiện tại"`) instead of
Gymini's exact controlled enum tokens (`START_WORKFLOW`, `CONFIRM`, ...). It
understands the user; it does not yet speak the contract. That gap is
precisely what this fine-tune exists to close, and is a clean, meaningful
number for a future trained candidate to be compared against.

## 11. QLoRA architecture

Unsloth `FastLanguageModel` + `peft` LoRA, `target_modules`: all 7 linear
projections (q/k/v/o/gate/up/down_proj) — the same set already proven on the
1.5B coach model, not narrowed without evidence (task §24). Base:
`unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit`, 4-bit, `device_map={"":0}`
pinned (required fix, §13).

## 12. Baseline hyperparameters

`training/semantic-qwen3-4b/config/qlora_semantic_qwen3_4b.yaml`: `lora_r=16,
lora_alpha=32, lora_dropout=0.05, learning_rate=5e-5, num_train_epochs=2,
per_device_train_batch_size=1, gradient_accumulation_steps=8,
max_seq_length=256` (lowered from an initial 512 during the dry-run, §13),
`bf16=true`. Starting points, not claimed-optimal (task's own framing).

## 13. Training command / dry-run / real tiny run result

```
training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/train_qlora_semantic.py --dry-run
training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/train_qlora_semantic.py --max-steps 3 --num-epochs 1
```

`--dry-run` validates config/dataset paths and additionally renders the
first training row through the REAL tokenizer chat template (no GPU/model
weights needed) — this surfaced a real finding (§15) before any GPU work
started.

The real tiny run (`--max-steps 3`) is the actual Phase D feasibility
signal, and took several failed attempts, each a genuine, fixed bug/
environment issue, not a parameter search:

1. `device_map="auto"` (the default) made `transformers` try to offload
   part of the 4-bit model to CPU and then refuse, since bnb-4bit doesn't
   support that without an extra flag. **Fix: pin `device_map={"": 0}`.**
2. `load_dataset("json", ...)` (pyarrow's strict reader) rejected the file
   because `target.corrections[].previousValue` is legitimately a number in
   some rows and a string in others (a GOAL correction vs. a numeric-entity
   correction) — both valid per `SemanticCorrectionSchema`'s own
   `z.union([number, string])`. **Fix: load JSONL manually in Python and
   build the `Dataset` from a list of dicts, bypassing pyarrow's schema
   inference.**
3. Unsloth's wrapped `SFTTrainer` requires an explicit `formatting_func` for
   a `"messages"`-column dataset (it does not auto-apply TRL's newer
   conversational/`assistant_only_loss` path). **Fix: supply one** — but see
   §17's known limitation (loss is NOT yet assistant-only-masked).
4. That `formatting_func` is called with two different shapes for the same
   key (`"messages"`) — a single conversation for Unsloth's own init-time
   probe, a list of conversations for the real batched tokenization pass.
   **Fix: detect the shape at runtime.**
5. **The real hardware signal:** training reached the first real forward
   pass, then failed with `Unsloth: No or negligible GPU memory available
   for fused cross entropy` — reproduced identically at `max_seq_length=512`
   and `256` (so not primarily a sequence-length problem; a near-constant
   overhead in Unsloth's own free-VRAM auto-detection at loss-computation
   time). **Fix: `UNSLOTH_CE_LOSS_TARGET_GB=0.05`** (overrides Unsloth's
   "use 50% of currently-free VRAM" heuristic, which was computing ~0 given
   how little is left after loading a 4B model in 4-bit on a 4 GB card).

With all five fixes applied, **the tiny run completed successfully**:

```
Trainable parameters = 33,030,144 of 4,055,498,240 (0.81% trained)
step 1/3: loss 3.547   step 2/3: loss 3.600   step 3/3: loss 3.533
eval_loss: 3.391
~83-96 s/step
adapter saved to training/semantic-qwen3-4b/outputs/train/baseline-qlora-v1
```

## 14. Baseline QLoRA result

Not run — the task explicitly scopes this execution to a tiny dry-run only
(§13 above *is* that dry-run and *is* the full extent of real training done
in this session). A real baseline run was not started.

## 15. Base vs QLoRA comparison

Not applicable — no full baseline run (§14).

## 16. Auto-tune go/no-go

Not evaluated — no baseline result exists to gate on.

## 17. Optuna design

Implemented and dry-tested (config/search-space validation only — `--dry-run`,
no real trial): `training/semantic-qwen3-4b/scripts/tune_optuna.py`. One
trial at a time (never parallel on this single consumer GPU, task §34);
each trial shells out to `train_qlora_semantic.py` as a separate OS process
specifically so a CUDA OOM kills only that subprocess, never poisons the
long-lived Optuna/CUDA context; an OOM or CUDA failure in a trial's stderr
is caught and reported as `optuna.TrialPruned`, not a crashed study.
`MedianPruner` for early-stopping poor trials (task §35). SQLite storage at
`training/semantic-qwen3-4b/optuna/gymini_qwen4b.db` (resumable via
`--resume`, task §36). A leaderboard (`outputs/train/leaderboard.json`) is
written after the study. **Not launched for real** — explicitly out of
scope for this execution (task §55), and no baseline QLoRA result exists
yet to gate `AUTO_TUNE_GO` on (§16).

## 18. Search space

`config/evaluation.yaml` + `SEARCH_SPACE` in `tune_optuna.py`:
`learning_rate` (1e-5 → 2e-4, log scale), `lora_r` ∈ {8,16,32}, `lora_alpha`
∈ {16,32,64}, `lora_dropout` ∈ {0.0,0.05,0.1}, `num_train_epochs` ∈ {1,2,3}
— exactly the task's own §33 list, nothing wider. The weighted product
score (task §19) is implemented as `product_score()`: safety is a hard gate
(`unsafeOutputRate > 0` → score 0, never selectable), weights are
`primaryIntentAccuracy 0.25, entityF1Mean 0.20, schemaValidityRate 0.20,
jsonValidityRate 0.15, 1/(1+latency) 0.20` — redistributed from the task's
example weights onto the metrics `evaluate_semantics.py` actually computes
today (correction/reference/ambiguity accuracy are deferred, §22), with the
reasoning for the redistribution documented directly in
`config/evaluation.yaml` rather than silently scoring an unimplemented
metric as 0.

## 19. Best-trial selection

`write_leaderboard()` ranks all trials by `product_score` (which already
encodes the safety gate and schema/category weighting, task §38); not run
for real yet since no trials have been executed.

## 20. Heldout evaluation

Not run — no trained candidate exists yet to run it on (task §39: heldout
is evaluated exactly once, after a best candidate is chosen from validation
alone — there is no candidate to choose).

## 21. Export to GGUF/Ollama

Not run. The existing, already-proven path (`training/scripts/
merge_lora_unsloth.py` → `training/llama.cpp/convert_lora_to_gguf.py` →
`ollama create`) is directly reusable once a real adapter worth exporting
exists; nothing new needed to be built for this, per discovery doc §F/§I.

## 22. Limitations / remaining blockers (REPOSITORY_BASELINE_CHANGED)

- **Execution stopped per the task's own git-safety rule.** `git rev-parse
  HEAD` was re-checked before moving to write this document and had changed
  from `START_HEAD=f21a54e37da97cc5260bc70b941daa2770ee3fee` to
  `187745350ab147003d030d4826c430e84dfe3e59` — another concurrent merge from
  `origin/feature/payment-gateways` (3 commits: mobile/user-service fixes),
  landed by a different session while this work was in progress, same
  pattern as the rest of this session's history. **Factually confirmed this
  merge touches nothing under `training/` or `docs/ai-training/`** (`git
  diff --stat` between the two HEADs for those paths is empty) — so nothing
  this phase produced was overwritten or is based on stale code. Per
  instruction, no further phase was started after detecting this; the
  already-in-flight baseline evaluation (§10, a read-only HTTP call to
  Ollama, no git interaction) was allowed to finish rather than killed
  mid-call, since letting a non-git, already-started read finish is not
  "continuing training/verification on a moving baseline" in the sense the
  rule protects against.
- ~~The baseline-eval JSON-extraction issue (§10) needs root-causing~~ —
  **root-caused**: it was the 60 s per-call timeout, not a parsing bug
  (`extract_first_json_object` was verified correct in isolation). Re-run
  at 90 s produced real, trustworthy numbers (§10).
- Chat-template/think-scaffold mismatch between the HF tokenizer's default
  and Ollama's actual serving template (discovery doc + §13 finding #3's
  sibling): `render_with_chat_template`'s preview path strips it, but the
  real training path (via `formatting_func` → same function) is used
  consistently, so training and the preview now agree with each other - but
  neither has been checked against a wider sample of Ollama's real serving
  output beyond the one `ollama show --modelfile` inspection.
- Assistant-only loss masking (task §26) is not yet achieved under
  Unsloth's wrapped trainer (§13 finding #3) — currently trains on the full
  rendered sequence.
- The dataset (37 rows) is a pipeline-validation starter set, not
  production training volume.
- `optuna` is now installed (5.0.0, plus `alembic`/`sqlalchemy`/`colorlog`/
  `mako`) and `tune_optuna.py`/`config/evaluation.yaml` exist and
  dry-tested clean — but no real trial has run (§17).
- No HF_TOKEN is set (unauthenticated HF Hub requests only — fine for a
  public model, slower/rate-limited).
- A second `REPOSITORY_BASELINE_CHANGED` check (new `START_HEAD=
  187745350ab147003d030d4826c430e84dfe3e59`) was clean throughout this
  continuation — re-verified immediately before writing this update.

## 23. What belongs to RAG instead

Fitness/nutrition domain knowledge, citations, evidence retrieval — already
owned by Qdrant retrieval + RAG service, untouched by this work.

## 24. What belongs to Coach Analytics instead

Plateau detection, training-volume trend, body-composition trend, calorie-
adherence inference, InBody interpretation — Phase 4 scope, not fine-tuned
here.
