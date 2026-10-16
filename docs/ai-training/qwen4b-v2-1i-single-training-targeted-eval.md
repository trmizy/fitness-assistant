# Gymini Semantic Fine-Tune — V2.1I Single Training Run + Targeted Evaluation

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file, dataset, or
V2/V2.1 historical artifact was modified. Heldout
(`datasets/processed/v2/heldout.jsonl`) was never opened. `OPTUNA_NOT_RUN`,
`NO_GGUF_EXPORT`, no production runtime change.

## 0. A genuinely concurrent session trained this candidate

This task's training run was found already in progress on start, launched
by a separate concurrent session (`training/diagnostics/v2.1i/launcher.py`,
started 2026-10-12 14:33, using the exact frozen V2.1 config and the
correctly-verified `HF_DEACTIVATE_ASYNC_LOAD=1`/`UNSLOTH_CE_LOSS_TARGET_GB=0.05`
env controls established in V2.1G/H/H-R2). Per this project's own
parallel-agent-safety convention, no competing training was started — the
user confirmed waiting for it and then evaluating its result. The
concurrent session's own two evaluation attempts crashed immediately
after its ~2.2-hour training run (native access violation reading tensor
data, `torch/storage.py __getitem__`) — this task picked up the
evaluation phase once host conditions recovered (see §1).

## 1. Environment note: a severe RAM squeeze, resolved with explicit user consent

Between the training run finishing and this task's own evaluation
attempts, free RAM was observed as low as ~0.2-0.5 GB (far below any
prior reading in this entire project, including every V2.1E-H session) —
a system-wide squeeze from several startup applications bursting after
an intervening reboot (VS Code, ChatGPT desktop, Discord, Docker
Desktop, WSL). With the user's **explicit, direct authorization**
("hãy tắt những process nào không dùng tới cho việc train"), WSL, Docker
Desktop, and ArmouryCrate were closed — all three confirmed not required
for this native-Windows training/evaluation pipeline. Free RAM recovered
from ~0.89 GB to ~6.8 GB immediately. Browser/VS Code/other active-work
processes were deliberately left untouched. No pagefile, driver, or
other system setting was changed.

## 2. Training result (already complete on task start)

| | |
|---|---|
| Steps | 98 (389 rows ÷ effective batch 8 × 2 epochs) |
| Wall-clock duration | 7856s = **2h10m56s** |
| Final train_loss | 0.4307 |
| Final eval_loss | 0.1776 (stable, no divergence) |
| Adapter path | `training/semantic-qwen3-4b/outputs/train/qlora-baseline-v2.1` |
| Artifact integrity | `adapter_config.json`, `adapter_model.safetensors` (132,187,888 bytes), tokenizer files all present and non-zero; later successfully reloaded for evaluation (proof of validity) |

No NaN/Inf, no partial/corrupt save. **`V2_1_TRAINING_SUCCESS`.**

## 3. Dataset integrity (re-verified, not reconstructed)

Combined train rows: **389** (327 V2 + 62 V2.1 remediation additions, per
`datasets/processed/v2.1/manifest.json`, hash-verified in prior sessions).
Original V2 validation: **71** rows, unchanged. Remediation validation:
**12** rows (6 REFERENCE, 4 INTENT, 2 AMBIGUITY_UNKNOWN — confirmed from
data, matching the task's expected composition). Heldout: 66 rows,
metadata-only, never opened.

## 4. Original V2 validation (71 cases) — V2 vs V2.1

| Metric | V2 | V2.1 | Delta |
|---|---|---|---|
| jsonValidityRate | 1.000 | 1.000 | 0.0 |
| schemaValidityRate | 0.7887 | 0.8028 | +0.0141 |
| primaryIntentAccuracy | 0.662 | 0.6761 | +0.0141 |
| entityF1Mean | 0.7817 | **0.8944** | **+0.1127** |
| correctionAccuracy | 0.8333 | 0.8333 | 0.0 |
| referenceAccuracy | 0.000 | **0.2667** | **+0.2667** |
| ambiguityAccuracy | 0.8169 | 0.831 | +0.0141 |
| requestedActionAccuracy | 0.4483 | 0.5172 | +0.0689 |
| inventedEnumCount | 4 | **0** | **-4** |
| ceilingHits160 | 0/71 | 0/71 | 0.0 |
| **OVERCONFIDENT_AMBIGUITY** | **7** | **8** | **+1 (regression)** |

### Reference accuracy — verified genuine, not an artifact

Unlike D1's enum-count confound (where JSON-breakage inflated apparent
fixes), there is no floor effect here: `jsonValidityRate=1.0` for both V2
and V2.1, so every reference-applicable case is schema-checkable on both
sides. The applicable denominator itself grew (V2: 11 applicable, 0
correct → V2.1: 15 applicable, 4 correct) because V2.1 now attempts a
structured reference in more cases where gold expects one. All 4 correct
cases were inspected directly:

| Case | Category | V2 | V2.1 |
|---|---|---|---|
| `ambiguity-pt-switch-no-proposal-1` | AMBIGUITY_UNKNOWN | wrong (no reference) | **correct** — `THIS_ITEM` |
| `reference-this-item-exercise-1` | REFERENCE | wrong (no reference) | **correct** — `THIS_ITEM`, "bài đó" |
| `revision-swap-exercise-explicit-1` | REVISION | wrong | **correct** |
| `revision-swap-exercise-explicit-2` | REVISION | wrong | **correct** |

Two of these are exactly the families targeted by the V2.1 remediation
design (`ref-this-item-pt-switch-corrected`, `ref-this-item-exercise-revise`
— see `qwen4b-v2-1-reference-ambiguity-remediation.md`). This is a real,
directly-targeted, confirmed fix — the primary motivating question behind
building V2.1 at all. (Its sibling case,
`ambiguity-pt-switch-no-proposal-2`, remains wrong — the fix generalized
partially, not completely, within even the same family.)

### The one regression: OVERCONFIDENT_AMBIGUITY, 7→8

Category breakdown's largest decline is `AMBIGUITY_UNKNOWN` (-0.40 avg
score, n=5) — directly consistent with this metric. This is a real,
reproducible finding (also confirmed independently on the
remediation-validation set, §5) — not a one-off.

## 5. Category-level breakdown (original-71)

| Category | n | Avg-score Δ | schemaValid V2→V2.1 |
|---|---|---|---|
| CORRECTION | 10 | +0.30 | 1.00 → 1.00 |
| ENTITY | 11 | +0.27 | 0.55 → 0.64 |
| FOLLOWUP_SLOT | 5 | +0.40 | 1.00 → 1.00 |
| INTENT | 16 | +0.25 | 0.56 → 0.62 |
| REFERENCE | 7 | +0.29 | 0.86 → 1.00 |
| FITNESS_SHORTHAND | 4 | 0.00 | 0.50 → 0.50 |
| REVISION | 5 | 0.00 | 1.00 → 1.00 |
| SAFETY_NON_AUTHORITY | 4 | -0.25 | 1.00 → 1.00 |
| MULTI_INTENT | 4 | -0.25 | 1.00 → 0.75 |
| **AMBIGUITY_UNKNOWN** | 5 | **-0.40** | 1.00 → 0.80 |

**No broad collapse** — 5 categories improved, 2 unchanged, 3 declined
only mildly, two of the three declines on n=4 samples (one flipped case
swings the average noticeably at that size — noted, not overstated).

## 6. Remediation validation (12 cases) — three-way comparison

| Metric | HF_BASE | V2 | V2.1 |
|---|---|---|---|
| jsonValidityRate | 0.583 | 1.000 | 1.000 |
| schemaValidityRate | 0.0 | 0.75 | **0.833** |
| primaryIntentAccuracy | 0.0 | 0.417 | **0.583** |
| entityF1Mean | 0.583 | 1.000 | 1.000 |
| referenceAccuracy | 0.0 | 0.0 | **0.4286** |
| ambiguityAccuracy | 0.5 | 0.9167 | 0.9167 |
| inventedEnumCount | 7 | 2 | **0** |
| ceilingHits160 | 2/12 | 0/12 | 0/12 |
| OVERCONFIDENT_AMBIGUITY | 1 | **0** | **1** |

This independently **triangulates both findings** from §4 on a second,
purpose-built validation set: referenceAccuracy breaks through for the
first time at V2.1 (0.0→0.0→**0.4286**, where V2 showed zero improvement
over base on this specific set), and `OVERCONFIDENT_AMBIGUITY` reverts
from V2's clean 0 back to 1 — the same regression pattern, not a
coincidence confined to one sample.

## 7. Degeneration/repetition check

None found. `jsonValidityRate=1.0` on both validation sets for V2.1 (no
invalid-JSON cases to classify at all), `ceilingHits160=0` on both.
D1's original degeneration failure mode (non-JSON prose, repetition
loops, token-ceiling hugging) remains fully absent in V2.1, as it was in
V2.

## 8. Frozen hard-gate result (applied exactly, not reinterpreted)

`compare_base_vs_qlora.py --base .../qlora-baseline-v2/eval/metrics.json --qlora .../qlora-baseline-v2.1/eval/metrics.json --gates acceptance_gates_v2.json`:

```
QLORA_SIGNAL: "QLORA_REGRESSED"
```

driven by 2 of 10 gates failing:

| Gate | Result | Note |
|---|---|---|
| `schemaValidityRate` must materially improve (≥+0.15) | **FAIL** (+0.014) | `FROZEN_GATE_RESULT=FAIL`. `REVIEW_CANDIDATE=YES`: this threshold was predeclared for the HF_BASE→HF_QLORA_V2 comparison (task V2's own methodology) and was never intended as a V2→V2.1 refinement criterion — V2.1 isn't supposed to re-prove the base-to-qlora jump, it's supposed to fix a narrow weakness without regressing. Reported as a formal FAIL per the task's explicit "apply gates exactly, do not reinterpret" instruction. |
| `ambiguityAccuracy` must not become dangerously overconfident | **FAIL** (7→8, and independently 0→1 on remediation-validation) | `FROZEN_GATE_RESULT=FAIL`. **No review-candidate caveat here** — this is a real, reproducible, twice-confirmed regression, not a methodological artifact. |

All 8 other gates pass, including `maxTokenHitRate` (format stability)
and `inventedEnumRate` (materially improved, 4→0).

## 9. Genuine-fix vs artifact summary

| Apparent improvement | Genuine? |
|---|---|
| Reference accuracy (0→0.267 / 0→0.429) | **Genuine** — verified case-by-case, no JSON-floor confound, 2 directly-targeted families confirmed fixed |
| Invented enum (4→0 / 7→0) | **Genuine** — `jsonValidityRate` held at 1.0 throughout V2.1, so this isn't a parsing-floor artifact either |
| Entity F1 (+0.11 / already 1.0) | **Genuine** — real, substantial |

## 10. Next action

Not Optuna (forbidden this task regardless). The smallest next
targeted-remediation action: add a handful of new training examples
specifically for the `ambiguity-pt-switch-no-proposal`-adjacent and
deictic-weight-unlabeled patterns the V2.1 remediation dataset already
identified as hard cases, aimed narrowly at closing the
`OVERCONFIDENT_AMBIGUITY` gate without disturbing the now-working
reference/enum fixes — a V2.2-style micro-remediation, not a redesign.
