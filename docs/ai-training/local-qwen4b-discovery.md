# Local Qwen3 4B Semantic-Understanding Fine-Tuning — Discovery

Date: 2026-10-09. Phase A of the local-only QLoRA pipeline task. No training,
no download, no production config change happened in this phase — this is
inspection only.

`START_HEAD=f21a54e37da97cc5260bc70b941daa2770ee3fee` (branch `aws-deploy`).
Re-checked before every later phase per the task's own git-safety rule.

## A. Exact current runtime model

Confirmed via `ollama show qwen3:4b-instruct-2507-q4_K_M` (local inspection,
not assumed):

| Field | Value |
|---|---|
| architecture | `qwen3` |
| parameters | `4.0B` |
| context length | `262144` |
| embedding length | `2560` |
| quantization | `Q4_K_M` (GGUF) |
| chat template | ChatML (`<|im_start|>`/`<|im_end|>`), Qwen3's own tool-call XML block |
| license | Apache License 2.0, Copyright 2024 Alibaba Cloud |

`ai-service`'s own `DEFAULT_LLM_MODEL_BY_PROVIDER.ollama` (`llm.service.ts`)
is exactly this tag — reconfirmed from this session's own R1/R2 work, not
re-derived here.

## B. Trainable base model candidate/source

**Not locally cached.** No HF cache entry for any Qwen3 model exists on this
machine (checked `~/.cache/huggingface/hub` — only `unsloth/Qwen2.5-1.5B-
Instruct[-bnb-4bit]` is cached, from an older, unrelated experiment, §F).

A web search (not a guess — see Sources) found `unsloth/Qwen3-4B-Instruct-
2507-unsloth-bnb-4bit` on Hugging Face: base model `Qwen/Qwen3-4B-Instruct-
2507`, 4.0B params (3.6B non-embedding), 36 layers, 32 Q heads + 8 KV heads
(GQA), **native context length 262,144** — this matches the Ollama manifest's
`parameters: 4.0B` and `context length: 262144` exactly, and the license
(Apache-2.0) matches too. This is strong, cross-validated, but not yet a
byte-level `config.json` diff (that requires actually fetching the repo).

**Decision:** treat `unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit` (4-bit
pre-quantized, same naming pattern as the already-used
`unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit`) as the working candidate, but gate
the actual download on an automated identity check inside the training
script itself (compare the downloaded config's `architectures`,
`num_hidden_layers`, `num_attention_heads`, `num_key_value_heads`,
`max_position_embeddings` against the Ollama-reported values above) before
any training step runs — not a one-time manual check, a repeatable assertion
every run makes. **This has not been downloaded in this phase** — per the
task's own instruction, discovery stops at identification, not acquisition.

Sources:
- [unsloth/Qwen3-4B-Instruct-2507 — featherless.ai mirror of the model card](https://featherless.ai/models/unsloth/Qwen3-4B-Instruct-2507/readme)
- [promptlayer.com model page](https://www.promptlayer.com/models/qwen3-4b-instruct-2507-unsloth-bnb-4bit)

## C. Existing semantic schema (to reuse, not reinvent)

`backend/services/ai-service/src/conversational-intelligence/schema.ts` —
the real, already-shipped, Zod-validated contract:

- `SemanticInterpretationSchema`: `primaryIntent` (9-value enum),
  `workflowIntent` (6-value enum, optional), `entities[]`, `corrections[]`,
  `references[]`, `goalSignals[]`, `negations[]`, `ambiguities[]`,
  `requestedAction` (7-value enum, optional), `asksWhy`,
  `clarificationRequired`, `confidence`, `source`.
- The actual LLM-facing projection is narrower —
  `interpreter.ts`'s `LlmOutputSchema`: `primaryIntent`, `entities[{type,
  value, sourceText, negated}]`, `goalSignals[]`, `asksRecommendation`,
  `isCorrection`. **This narrower shape, not the full schema, is this
  fine-tune's real training target** — it is exactly what the model is
  asked to produce today, and what `validateLlmEntities` + the deterministic
  layers downstream already know how to safety-check.
- The current production prompt (`interpreter.ts`'s `buildPrompt`) is a
  short Vietnamese instruction + one example + the message — this is the
  "system" message template training examples should match, so the
  fine-tuned model is a drop-in replacement for the exact same call site,
  not a new contract to integrate.
- `llm-route.ts` (Phase 3 R1/R1.1) has a second, separate typed schema for
  the *routing* fallback (`GlobalRouteResult`-shaped) — a related but
  distinct call site/schema, out of this fine-tune's first-pass scope
  (§J below) unless explicitly requested later.

## D. Existing datasets/corpora

- `training/data/coach_instruction_schema.json` +
  `training/data/processed/{train,eval,eval_small}.jsonl` — **wrong task**
  for this fine-tune (full CoachContext → StructuredCoachPlan generation,
  exactly the "general Gymini brain" training this task explicitly forbids).
  Not reusable as training rows; the *infrastructure* that produced them is
  reusable (§F).
- No existing JSONL dataset anywhere in the repo targets intent/entity/
  correction/reference/ambiguity classification specifically.
- A large amount of **already-labeled, product-reviewed Vietnamese example
  phrases with their expected classification** exists as literal test
  assertions in `backend/services/ai-service/src/__tests__/
  conversational-intelligence-v2.test.ts`,
  `conversational-intelligence-global.test.ts`,
  `conversational-intelligence-remediation.test.ts`,
  `turn-understanding-adapters.test.ts`,
  `turn-understanding-route-parity.test.ts`, and the revision/reference test
  files (`revision-*.test.ts`, `roadmap-multislot-extraction.test.ts`,
  `slot-values-parsers.test.ts`). These are the best available seed source —
  real product phrasing, already reviewed, with ground truth encoded in the
  assertions — but they assert against `interpretDeterministic`'s *output*,
  not hand-written JSONL rows; harvesting them means re-deriving the
  `LlmOutputSchema`-shaped target from each assertion, not a mechanical
  copy. Not done in this phase (§G below — only a small, clearly-marked
  hand-written starter set was built so far).

## E. Existing evaluation material

- `training/scripts/evaluate_coach_model.py` — evaluates the (wrong-task)
  coach model: structured-JSON validity, schedule/calorie sanity, safety,
  citation non-hallucination, Vietnamese output. The *pattern* (load a
  JSONL eval set, run each case through a configurable backend, score
  per-category, write a JSON report under `training/reports/`) is directly
  reusable; the metrics themselves are not (wrong task).
- `validateLlmEntities` (`interpreter.ts`) is itself a real, already-shipped
  evaluator of a kind — it already knows how to reject a hallucinated
  entity. Good reference for what "safety"/"hallucination" must mean for
  this task's own evaluator.
- `backend/services/ai-service/src/scripts/unified-coach-qwen-smoke.ts` and
  `narration-qwen-smoke.ts` (this session, Phase 3 R1/R1.1) — real-model
  smoke scripts, Node/TS, not training-related, but confirm the exact
  runtime tag and latency characteristics already measured for THIS model:
  ~8 s warm / ~60–82 s cold on this machine's CPU-only Ollama inference path
  (no GPU is used for the Ollama *serving* path today — Ollama here runs the
  GGUF on CPU; the GPU is free for training).

## F. Existing model-related scripts (the big find — see also §I)

`training/` (repo root, gitignored — **not** the `tools/ai-training/qwen4b/`
path this task's own template suggests; see §I for why this discovery keeps
it under `training/` instead of creating a second, parallel location) already
contains a **working, previously-executed** local QLoRA pipeline for a
*different* model:

- `training/.venv/` — a real, working Python 3.11.15 venv (built by `uv`;
  `pip` itself isn't installed inside it, which is normal for a uv-managed
  venv — use `uv pip` or the venv's own installed console scripts). Installed:
  `torch 2.10.0+cu126`, `transformers 5.5.0`, `peft 0.19.1`, `trl 0.24.0`,
  `bitsandbytes 0.49.2`, `accelerate 1.14.0`, `datasets 4.3.0`,
  `unsloth 2026.7.3`, `unsloth_zoo 2026.7.3`, `torchao 0.17.0`. **No
  `optuna`** — needs adding for the later auto-tune phase.
- `training/scripts/{prepare_coach_dataset,train_qlora_unsloth,
  evaluate_coach_model,merge_lora_unsloth,export_adapter_to_ollama}.py` —
  all real, non-trivial (69-236 lines each), already proven to run on this
  exact machine (produced `training/outputs/fitness-coach-qlora-1.5b`, a
  real completed adapter, and `training/outputs/gguf-export/`).
  `train_qlora_unsloth.py` already supports `--dry-run` (validates paths/
  config without touching CUDA) and `--max-steps N` (a real tiny run) —
  exactly the Phase D mechanism this task asks for; it can be forked rather
  than rewritten.
- `training/llama.cpp/` — a real llama.cpp checkout with
  `convert_lora_to_gguf.py` and `tools/export-lora`, i.e. the GGUF export
  path (§40-41 of the task) already exists and was already used once.
- `training/configs/qlora_coach_qwen2.5_1.5b.yaml` — **direct, measured
  hardware evidence for this exact machine**, not a guess: on this RTX 3050
  (Ti) 4GB, a 1.5B model QLoRA (`lora_r=16, alpha=32, dropout=0.05`, all 7
  linear projections as `target_modules`, `max_seq_length=1024`,
  `per_device_train_batch_size=1`, `gradient_accumulation_steps=8`,
  `load_in_4bit`, `bf16`) measured **~19.5 s/step**, and a full epoch over a
  15,944-row dataset (≈1993 steps) was estimated at **~10.8 h** — the config's
  own comments state 3 epochs (~32 h) was rejected as impractical even for
  a 1.5B model. See §H for what this implies for a 4B model.
- `training/configs/qlora_coach_qwen3_30b_a3b.yaml` +
  `training/RUNPOD_RUNBOOK.md` — an explicitly-marked "experimental
  reference... not validated end to end" config for a 30B-parameter MoE
  model, run on a *rented* RunPod A40 GPU (~48GB VRAM), not local. Not
  relevant to this task beyond confirming nothing in this repo has ever
  attempted local QLoRA training above 1.5B parameters.
- `training/README.md` already documents a data-safety policy (no real PII,
  anonymized/synthetic only) that this task's own §8 independently requires
  — the two are consistent, not conflicting.

## G. Local hardware (GPU/VRAM/RAM)

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 3050 (laptop/Ti variant), driver 617.14, CUDA UMD 13.4 |
| VRAM | **4096 MiB (4 GB)** total, 0 MiB in use (idle) |
| System RAM | ~16 GiB total (16,558,178,304 bytes) |
| Disk (C:) | 476 GB total, **68 GB free** |
| `nvcc` | not found (no CUDA toolkit installed standalone) — not required: the venv's `torch`/`bitsandbytes` wheels bundle their own CUDA 12.6 runtime |
| System `python` | **not installed** — `python`/`python3` on `PATH` are the non-functional Windows Store app-execution-alias stubs. A real, working Python 3.11.15 only exists inside `training/.venv/` (§F). All commands in this pipeline must invoke `training/.venv/Scripts/python.exe` explicitly, not bare `python` |
| `uv` | present (`C:\Users\ASUS\.local\bin\uv.exe`) — the likely original venv-creation tool |

## H. Expected feasibility of QLoRA for the 4B model (the real risk)

Qwen3-4B has roughly **2.7× the parameters of Qwen2.5-1.5B**, the model this
exact GPU already measured (§F). 4-bit weights for 4B params alone are
~2.1-2.3 GB (vs. ~0.9 GB for 1.5B), inside a hard 4096 MiB VRAM ceiling that
also must hold LoRA adapter weights (small), optimizer state (small — only
adapter params are optimized), gradients (small, adapter-only), and —
the part that scales with sequence length and *is* the real risk — forward
activations for a 36-layer, 2560-hidden-dim (per Ollama's `embedding
length`) transformer at whatever `max_seq_length` is chosen.

**Assessment: marginal, not "no," but requires the shortest practical
sequence length and the most conservative settings, and will almost
certainly be considerably slower per-step than the 1.5B measurement** (fewer
practical epochs in the same wall-clock budget). Concretely, before any real
run:

- Start `max_seq_length` well below the 1.5B config's 1024 (e.g. 512 or
  even 256) for the Phase D dry-run, and only raise it if the OOM margin
  allows.
- Keep `per_device_train_batch_size=1` with `gradient_checkpointing=True`
  (the 1.5B config's `bf16: true` did not need to say this explicitly
  because Unsloth already defaults to it for its `FastLanguageModel` path —
  confirmed by reading `train_qlora_unsloth.py`, not assumed).
- Treat the Phase D tiny dry-run (a handful of real steps, not just a
  config-validation `--dry-run`) as the actual go/no-go signal for VRAM fit
  — not this document's estimate. If it OOMs even at a short sequence
  length and batch size 1, that is `LOCAL_TRAINING_...HARDWARE_BLOCKED`,
  reported exactly, not worked around by silently downgrading the target
  model.
- Given the current runtime is already quantized to Q4_K_M for *inference*
  via Ollama on CPU (not GPU) — the GPU's only consumer today is this
  training pipeline; there is no production contention for it.

## I. Conflicts/duplication to avoid

- **Path:** this task's own template suggests `tools/ai-training/qwen4b/`.
  The repo's real, working convention is `training/` at the repo root
  (gitignored, with its own venv/configs/scripts/outputs). Creating a
  second parallel location would duplicate the venv, llama.cpp checkout,
  and script patterns for no benefit and real confusion risk (`gymini-
  scope-control`'s "duplication to avoid" + the project's own CLAUDE.md:
  never create a second competing source of truth). **Decision: build this
  fine-tune's new dataset/config/scripts inside `training/`, in a new
  `training/semantic-qwen3-4b/` subtree**, reusing the existing `.venv`,
  `llama.cpp/`, and the proven scripts (`train_qlora_unsloth.py`,
  `merge_lora_unsloth.py`, `export_adapter_to_ollama.py`) as a base to fork
  from rather than reinvent, and the existing `README.md`'s data-safety
  section as the one data-safety policy, not a second one.
- **Task identity:** the existing `training/` pipeline's dataset/evaluator
  target a *different task* (full coaching-plan generation) on a *different
  model* (Qwen2.5-1.5B). This is not a regression or something to fix — it
  is explicitly marked experimental/optional in its own README and is
  simply orthogonal to this task. Nothing in it will be modified by this
  work; it will only be read for its reusable patterns.
- **Routing/semantic schema:** `llm-route.ts`'s typed routing schema (Phase
  3 R1/R1.1, this session) is a second, separate structured-LLM call site.
  This fine-tune's first dataset targets `interpreter.ts`'s
  `LlmOutputSchema` only (§C) — expanding to the routing schema later is a
  natural, separate follow-up, not silently folded in here.
- **No change to `LLM_MODEL`, any `.env`, or any compose file** was made in
  this phase, and none will be made by this pipeline automatically — §42/§43
  of the task require a separate local Ollama tag and an explicit, manual
  decision before any runtime config changes.
