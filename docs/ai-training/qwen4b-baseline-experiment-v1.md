# Gymini Semantic Fine-Tune — Baseline Experiment v1

`START_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, re-checked stable
throughout this experiment (`git rev-parse HEAD` unchanged at every check
point recorded below). Branch `aws-deploy`.

## Masking investigation (task §18-20)

Unsloth's compiled `SFTTrainer` (installed version 2026.7.3) does **not**
support a `"messages"`-column dataset with native completion-only-loss
masking the way stock TRL ≥0.14 does — its own `_prepare_dataset` only
recognizes `"labels"`/`"input_ids"` (pre-tokenized), `"prompt"`+`"completion"`,
or a flat `"text"` field, raising `RuntimeError("Unsloth: You must specify a
formatting_func")` for anything else (confirmed by reading
`unsloth_compiled_cache/UnslothSFTTrainer.py` directly, not guessed).

**Fix:** pre-tokenize every row ourselves
(`masking_utils.build_input_ids_and_labels`) into real `input_ids`/`labels`
columns — `-100` for every system/user token, the real token id for every
assistant-completion token — and hand that directly to the trainer, which
takes Unsloth's first, simplest branch (`"labels" in column_names` →
`do_tokenize=False`, `DataCollatorForSeq2Seq`). Verified correct by
`masking_diagnostic.py` against a real v1 row *before* this was used for
real training:

```
prompt token count: 182, full token count: 274
think-scaffold (4 tokens) is stripped (Ollama's real serving template has no <think> handling)
labels: 182 masked (-100) + 92 real token ids = 274 total
PASS - prompt tokens fully masked, completion tokens fully real, no leakage either direction
```

The think-scaffold finding is itself real and non-obvious: the HF
tokenizer's chat template always inserts an empty `<think>\n\n</think>\n\n`
before a non-thinking assistant turn, but Ollama's actual serving template
(`ollama show qwen3:4b-instruct-2507-q4_K_M --modelfile`) has no `<think>`
handling for the assistant role at all. Training on the HF default would
have taught 4 tokens the model will never actually be prompted to continue
at serving time. Stripped at the token-id level (not string-replace) in
both the diagnostic and the real trainer, sharing one implementation
(`masking_utils.py`) so they cannot drift apart.

## Token length analysis → sequence length (task §21)

See `qwen4b-semantic-dataset-v1.md` §6 for the full table. `max_seq_length`
chosen: **384** (real p99=362/max=363 over all 143 v1 rows at the full
rendered sequence) — not the Phase D smoke run's 256, which would have
truncated 126/143 (88%) of v1's real rows.

## HF base baseline + training estimate (task §21/§27)

A tiny real GPU run (15 steps, `max_seq_length=384`) measured a steady-state
**~80 s/step** on this RTX 3050 Ti 4GB (`UNSLOTH_CE_LOSS_TARGET_GB=0.05`
still required — see `docs/ai-training/local-qwen4b-discovery.md`/pipeline
doc for why). 99 train rows ÷ effective batch 8 ≈ 13 steps/epoch × 2 epochs
= 26 steps × ~80 s/step ≈ **~33 min estimated total** — judged reasonable,
no stop condition triggered. (An earlier attempt at this same estimate was
killed by an outer `timeout 900` wrapper that was too short for 15 steps —
a tooling mistake on this session's part, not a training failure; corrected
before the real run.)

## 1. Real base-model baseline (Ollama, full V1 validation, 21 rows)

```
transportSuccessRate: 0.9524    jsonValidityRate: 0.8095
schemaValidityRate:   0.0       primaryIntentAccuracy: 0.0
entityF1Mean:         0.619     correctionAccuracy: 0.3333
referenceAccuracy:    0.25      ambiguityAccuracy: 0.7619
unsafeOutputRate:     0.0       inventedEnumRate: 0.8095 (17/21)
meanLatencySeconds:   34.664
errorBucketCounts: {INVALID_JSON:3, SCHEMA_INVALID:17, INVENTED_ENUM:17,
  ENTITY_MISSING:4, CORRECTION_WRONG:2, REFERENCE_WRONG:6, TIMEOUT:1}
```

**Confirms the core hypothesis (task §24) decisively, not just
anecdotally:** the base model extracts entities reasonably well (F1=0.62)
and recognizes genuine ambiguity correctly most of the time (0.76), but
**invents its own intent/action vocabulary in 17 of 21 cases (81%)** instead
of using Gymini's real enum values — e.g. `"create_a_workout_schedule"`
instead of `START_WORKFLOW`+`CREATE_WORKOUT_PLAN`. `schemaValidityRate=0`
and `primaryIntentAccuracy=0` are a direct, measured consequence of that
one failure mode, not a broader comprehension failure.

## 2. Real QLoRA baseline training (task §26)

Config: `lora_r=16, alpha=32, dropout=0.05, lr=5e-5, epochs=2,
batch_size=1, grad_accum=8, max_seq_length=384`,
`UNSLOTH_CE_LOSS_TARGET_GB=0.05`. 99 train rows, 26 steps, **35m06s real
wall-clock** (`train_runtime=2107s`). Loss: started ~3.5 (first steps),
ended `train_loss=1.315` (run average), last-step losses ~0.65-0.73;
`eval_loss` 0.7278 → 0.7257 across the two epoch checkpoints (stable,
slightly improving, no divergence/instability). Adapter saved to
`training/semantic-qwen3-4b/outputs/train/qlora-baseline-v1`
(LoRA adapter only, never merged — task §36).

## 3. Real QLoRA validation (same 21 rows, HF backend = base + adapter via PEFT, no merge)

```
transportSuccessRate: 1.0       jsonValidityRate: 0.3333
schemaValidityRate:   0.0476    primaryIntentAccuracy: 0.0476
entityF1Mean:         0.3333    correctionAccuracy: 0.0
referenceAccuracy:    0.0       ambiguityAccuracy: 0.2857
unsafeOutputRate:     0.0       inventedEnumRate: 0.2381 (5/21)
meanLatencySeconds:   52.423
errorBucketCounts: {INVALID_JSON:14, SCHEMA_INVALID:6, INVENTED_ENUM:5,
  WRONG_INTENT:1, CORRECTION_WRONG:1, REFERENCE_WRONG:3, OVERCONFIDENT_AMBIGUITY:1}
```

A real, non-obvious engineering finding while producing this number: HF
`model.generate(max_new_tokens=400, ...)` on plain `transformers`+`peft`
(no Unsloth fast-inference kernel active here — that optimization path is
training-time only in this setup) took so long per case (~105s+) that a
first full-validation attempt was killed by its own 30-minute timeout
wrapper before finishing. Fixed by lowering `max_new_tokens` to 160
(the real completions are ~90-100 tokens per `masking_diagnostic.py`) and
widening the external timeout — not a model-quality issue, a generation-
settings one. Separately: post-training latency (~52s/case, consistently
close to the full 160-token budget) suggests the fine-tuned model is not
reliably emitting its stop token within budget — plausibly itself a sign
of undertraining, noted as a follow-up question, not root-caused further
here.

## 4. Base vs QLoRA — predeclared-gate comparison (task §25/§28-31)

Gates were written to `config/acceptance_gates_v1.json` and timestamped
**before** any QLoRA validation metric existed (only the base baseline and
a pure-timing 15-step estimate had been produced at that point) —
`compare_base_vs_qlora.py` contains no thresholds of its own, it only
evaluates that predeclared file, so the bar could not be moved after
seeing the result.

| Metric | Base | QLoRA | Delta |
|---|---|---|---|
| transportSuccessRate | 0.9524 | 1.0 | +0.0476 |
| jsonValidityRate | 0.8095 | 0.3333 | **-0.4762** |
| schemaValidityRate | 0.0 | 0.0476 | +0.0476 |
| primaryIntentAccuracy | 0.0 | 0.0476 | +0.0476 |
| entityF1Mean | 0.619 | 0.3333 | **-0.2857** |
| correctionAccuracy | 0.3333 | 0.0 | **-0.3333** |
| referenceAccuracy | 0.25 | 0.0 | **-0.25** |
| ambiguityAccuracy | 0.7619 | 0.2857 | **-0.4762** |
| requestedActionAccuracy | 0.0 | 0.1667 | +0.1667 |
| unsafeOutputRate | 0.0 | 0.0 | 0.0 |
| **inventedEnumCount** | **17** | **5** | **-12** |
| meanLatencySeconds | 34.664 | 52.423 | +17.759 |

Gate results (automated, `compare_base_vs_qlora.py`):

| Gate | Rule | Result |
|---|---|---|
| unsafeOutputRate must not worsen | hard | **PASS** |
| schemaValidityRate must materially improve (≥+0.15) | hard | **FAIL** (+0.0476) |
| primaryIntentAccuracy should materially improve (≥+0.15) | soft | FAIL (+0.0476) |
| inventedEnumRate/Count must materially improve | hard | **PASS** (17→5) |
| correctionAccuracy must not materially regress (≤-0.10) | hard | **FAIL** (-0.333) |
| referenceAccuracy must not materially regress (≤-0.10) | hard | **FAIL** (-0.25) |
| ambiguityAccuracy must not become more overconfident | hard | **FAIL** (0→1 overconfident case) |

## 5. The core product question (task §30) — answered directly

**Did LoRA teach the model to stop inventing Gymini intent/action labels?
Yes, substantially:** `inventedEnumCount` 17→5 (81%→24% of cases), a real,
large, unambiguous decrease — the training signal for "use these exact
enum tokens" clearly transferred.

**But that alone is not success (task §31).** Schema validity barely moved
(4.76%, nowhere near the +15-point bar), and the model got *meaningfully
worse* at entity extraction, correction, reference resolution, and
ambiguity recognition, and more often produces truncated/invalid JSON
outright. This is not the classic "parrots valid enums but understands
users worse" overfitting pattern the task warns about (schema validity
didn't even "go up strongly" here) — it looks like straightforward
**undertraining**: 99 real training rows and 26 optimizer steps is a very
small amount of signal for a 4B-parameter model to reorganize around a new
strict output contract without temporarily degrading other, previously-
competent behavior. The reduced invented-enum rate is genuine evidence the
approach works directionally; it is not evidence this specific run is
ready for anything beyond "try again with substantially more data."

## 6. Remaining work / honest gaps

- **Dataset size**: 143 rows (99 train) vs. the task's 400-700 target. The
  single most likely lever to fix the regressions above — scale
  `generate_dataset_v1.py` with more template families per category before
  re-running this experiment, not by changing hyperparameters on the same
  tiny set.
- **Generation stop-token behavior** post-training (§3 above) — worth a
  closer look if a future run repeats the INVALID_JSON pattern.
- Heldout (23 rows) remains completely unused/unseen in this experiment,
  exactly as required (task §12) — available for a real final comparison
  once a genuinely improved candidate exists.
- No GGUF export, no Ollama tag, no production config change — none were
  warranted given the result, and none were attempted (task §36).

## 7. Auto-Tune decision (task §33-34)

Optuna's scaffold (`tune_optuna.py`, `config/evaluation.yaml`) exists and
was dry-tested only (`--dry-run`, config/search-space validation, zero real
trials) — consistent with "Do NOT run Optuna" for this task. Given the
comparison above, there is no genuine validation improvement to tune
around; searching hyperparameters on top of an already-regressed,
data-starved baseline would waste GPU time for no real signal.

**AUTO_TUNE_RECOMMENDATION: `AUTO_TUNE_NO_GO`** — not because the direction
is wrong (the invented-enum result says it isn't), but because the
honest, predeclared gates say this specific candidate is not an
improvement, and the fix is more data, not a hyperparameter search.

## Addendum (Diagnostic D1, 2026-10-10) — methodology correction

**The §4 comparison table above (OLLAMA_BASE vs HF_QLORA) is not a valid
causal measurement of the LoRA adapter's effect**, because it changes two
variables at once: the adapter AND the serving backend/runtime/
quantization (Ollama GGUF Q4_K_M vs HF bitsandbytes 4-bit + PEFT). Do not
read any number in §4 as "what LoRA did" — a real, apples-to-apples
HF_BASE (no adapter, same backend as HF_QLORA) run quantifies a genuine
~24% case-level JSON-validity disagreement between the two backends on
the *same, unmodified* base weights alone (see
`docs/ai-training/qwen4b-training-diagnostic-d1.md §9`). None of the
numbers in this document are being changed or retracted — they are real
measurements of what they actually measured (OLLAMA_BASE vs HF_QLORA,
full stop) — but the §5 interpretation ("the training signal... clearly
transferred") is superseded by D1 §8: an apples-to-apples HF_BASE→HF_QLORA
comparison shows most of the apparent invented-enum improvement is a
side effect of QLoRA's outputs more often failing to parse as JSON at
all (an output that doesn't parse can't be flagged as an invented enum),
not primarily evidence of learned ontology. See
`docs/ai-training/qwen4b-training-diagnostic-d1.md` for the full,
corrected causal analysis and root-cause classification.
