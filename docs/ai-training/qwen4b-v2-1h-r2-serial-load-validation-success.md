# Gymini Semantic Fine-Tune — V2.1H-R2 Serial Load Validation — SUCCESS

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file, dataset,
V2/V2.1 artifact, or package was modified. `PACKAGE_CHANGES = NONE`.
`Agent-made SYSTEM_CHANGES = NONE`. No training (`trainer.train()` never
called), no model-quality evaluation, no Optuna, no heldout access, no
GGUF export.

## Outcome

**`V2_1_TRAINING_PATH_READY`.** After a host reboot (not performed by any
agent — observed as a fact: `LastBootUpTime` moved to 2026-10-12 13:36:28,
a new boot since the previous V2.1H-R session), free RAM recovered well
above the empirical gate. The exact real Unsloth training load path —
`FastLanguageModel.from_pretrained(...)` with
`HF_DEACTIVATE_ASYNC_LOAD=1` — succeeded **3/3** fresh-process loads, 3/3
tiny generations, and a full trainer-initialization smoke (model + LoRA +
389-row V2.1 dataset + `SFTConfig` + `SFTTrainer` construction) passed
cleanly, stopping immediately before `trainer.train()` as required.

## 1. User-controlled host change

`LastBootUpTime` = 2026-10-12 13:36:28 (vs. 2026-10-10 20:34:53 recorded
in every prior session back through V2.1H-R) — **the host was rebooted**
between V2.1H-R and this session. This was not performed by any agent in
this conversation; it is recorded here as an observed fact per the
task's own "record user-controlled host changes" instruction, consistent
with the standing recommendation (`qwen4b-v2-1-environment-recovery-training.md
§6`) that a clean reboot was the most likely way to relieve the chronic
low-RAM condition that blocked every attempt from V2.1F through V2.1H-R.

## 2. RAM stability window

10 samples, 20s apart, ~3.3 minutes (raw data:
`training/diagnostics/model-load/v2.1h-r2-preflight-ram.csv`):

```
06:56:29  4.17 GB      06:58:13  3.75 GB
06:56:50  3.95 GB      06:58:34  3.71 GB
06:57:11  4.08 GB      06:58:54  4.21 GB
06:57:31  3.84 GB      06:59:15  4.14 GB
06:57:52  3.77 GB      06:59:36  4.13 GB
```

n=10, min=3.706 GB, max=4.207 GB, mean=3.922 GB, median=3.86 GB,
latest=4.134 GB, **10/10 samples ≥ 3.0 GB**. No downward trend (if
anything, trending slightly up in the second half). **Gate: PASS**,
decisively, on every criterion from the predeclared procedure.

GPU preflight: 3962/4096 MiB free, 0% utilization, 54-59°C across every
check this session — clean throughout, never the constraint. No orphan
Python/training processes at any point.

## 3. Serial control verification

```
HF_DEACTIVATE_ASYNC_LOAD raw value: 1
is_env_variable_true result: True
```

`SERIAL_CONTROL_ACTIVE` confirmed before any load attempt, exactly as
required.

## 4. Three load attempts — 3/3 PASS

Using the real training loader
(`FastLanguageModel.from_pretrained(model_name="unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit",
max_seq_length=384, dtype=None, load_in_4bit=True, device_map={"":0})`,
followed by the real `FastLanguageModel.get_peft_model(...)` LoRA
preparation with the exact V2 hyperparameters), each in a fresh
subprocess with `HF_DEACTIVATE_ASYNC_LOAD=1` and
`UNSLOTH_CE_LOSS_TARGET_GB=0.05` set from process start:

| Attempt | Load | Tiny generation | Duration (load→generate) |
|---|---|---|---|
| 1 | PASS | PASS — `'Xin chào! 😊'` | ~17.6s → 26.3s total |
| 2 | PASS | PASS — `'Xin chào! 😊'` (identical) | ~24.4s total |
| 3 | PASS | PASS — `'Xin chào! 😊'` (identical) | ~23.2s total |

No SIGSEGV, no `os error 1455`, no CUDA OOM in any attempt. Full logs:
`training/diagnostics/model-load/v2.1h-r2-attempt{1,2,3}.log`. Cleanup
verified after every attempt: GPU returned to 3962 MiB free, zero orphan
processes, RAM recovered/held (4.51 → 4.61 → 4.95 GB across the three
post-attempt checks — trending up, not down, across the whole sequence).

**Aggregate: serial Unsloth load 3/3. Tiny execution 3/3.** Repeatability
hard gate met in full — no partial credit needed.

## 5. Trainer-initialization smoke — PASS

Replicated `train_qlora_semantic.py`'s `run_training()` logic exactly
through `SFTTrainer(...)` construction, stopping immediately before
`trainer.train()` (verified: that line was never reached, no backward
pass, no optimizer step, no scheduler step). Full log:
`training/diagnostics/model-load/v2.1h-r2-trainer-init.log`.

Verified against the frozen V2.1 spec, all exact matches:

| Checked | Value |
|---|---|
| Model identity | 36 layers, hidden_size 2560, max_position_embeddings 262144 — assertion passed |
| Combined train rows | **389** (327 V2 + 62 V2.1 additions) |
| Train-row truncation at max_seq_length=384 | **0** |
| Validation rows | **71** (frozen V2 validation, unchanged) |
| LoRA r / alpha / dropout | 16 / 32 / 0.05 |
| Learning rate | 5e-5 |
| Epochs | 2 |
| Per-device batch / grad accumulation | 1 / 8 |
| max_seq_length | 384 |
| Optimizer | `adamw_8bit` |
| Seed | 3407 |
| bf16 | True |
| Assistant-only masking (row 0 sampled) | 185 masked + 84 real tokens |
| `<|im_end|>` supervised | **True** |

`trainer.train_dataset` confirmed to hold exactly 389 rows;
`trainer.args.num_train_epochs` confirmed 2. Every value matches the
frozen V2.1 configuration — nothing was adjusted to make this pass.

## 6. Root-cause interpretation (careful, as instructed)

No async-vs-serial A/B was run under this same healthy memory state (by
design — the task explicitly forbids it, since it would spend a
memory-risk attempt with no operational value). The honest, most
defensible verdict remains **`SERIAL_PATH_STABLE_UNDER_RECOVERED_MEMORY`**:
the serial control is proven stable now, under materially better host
memory than every prior failure — but because the host state changed
(reboot) at the same time as the control was first successfully tested,
this result does not by itself isolate "parallel materialization caused
the crashes" from "the reboot alone would have fixed it regardless of
this env var." Both are live possibilities; only the operational
question (is there now a reliable path to train?) is answered with
confidence.

## 7. Operational policy for the next task

The next V2.1 training task **must** launch with:

```
HF_DEACTIVATE_ASYNC_LOAD=1
UNSLOTH_CE_LOSS_TARGET_GB=0.05
```

set from process start, per `qwen4b-v2-1g-unsloth-materialization-recovery.md`'s
pre-declared policy. No further async-loading test is needed —
this session's evidence is sufficient to proceed operationally.
