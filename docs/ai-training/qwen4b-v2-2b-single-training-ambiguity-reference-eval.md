# Gymini Semantic Fine-Tune — V2.2B Single Training + Ambiguity/Reference Regression Evaluation

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file, dataset, or
V2/V2.1/V2.2A artifact was modified. Heldout
(`datasets/processed/v2/heldout.jsonl`) never opened. `OPTUNA_NOT_RUN`,
`NO_GGUF_EXPORT`, no production runtime change, exactly one training
candidate run.

## 0. Host state and dataset integrity (pre-training)

Preflight RAM: ~2.83-2.91 GB free, sampled 6x over ~2 min, stable/slightly
increasing (below the "preferred ≥3GB" guidance but outside the task's
own narrower "~1-2GB and declining" stop condition — judged acceptable).
Both V2.2A frozen files' SHA-256 re-verified to **MATCH**
`datasets/raw/v2.2/manifest.json` exactly (29 train rows / 12 dev rows, 0
family overlap, re-confirmed). Combined training file built as
`datasets/processed/v2.2/train.jsonl` = V2.1's 389 + V2.2's 29 = **418
rows exactly**; re-verified on the combined file (not assumed from
pieces): 0/418 masking failures, max token length 367 (< 384, 0 rows
truncated).

## 1. Training result

| | |
|---|---|
| Rows / Epochs / Steps | 418 / 2 / 106 |
| Wall-clock duration | 6357s = **1h45m57s** |
| Final train_loss | 0.4364 |
| eval_loss trajectory | 0.4266 → 0.2244 → 0.174 → 0.1615 → **0.1605** (stable, no divergence) |
| Adapter path | `training/semantic-qwen3-4b/outputs/train/qlora-baseline-v2.2` |
| Artifact integrity | `adapter_model.safetensors` 132,187,888 bytes (identical size to V2/V2.1 — same LoRA rank/target-modules), tokenizer files, checkpoints 50/100/106 all present; successfully reloaded for all 3 evaluations (proof of validity) |

No NaN/Inf, no partial/corrupt save. HEAD re-verified unchanged after
training. **`V2_2_TRAINING_SUCCESS`.**

## 2. Evaluation Set A — original V2 validation (71 cases)

| Metric | V2.1 | V2.2 | Delta |
|---|---|---|---|
| jsonValidityRate | 1.000 | 1.000 | 0.0 |
| schemaValidityRate | 0.8028 | 0.831 | +0.0282 |
| primaryIntentAccuracy | 0.6761 | 0.6901 | +0.014 |
| entityF1Mean | **0.8944** | **0.7746** | **-0.1198 (regression)** |
| correctionAccuracy | 0.8333 | 0.75 | -0.0833 |
| referenceAccuracy | **0.2667** | **0.0** | **-0.2667 (regression — V2.1's gain fully erased)** |
| ambiguityAccuracy | 0.831 | 0.7887 | -0.0423 |
| requestedActionAccuracy | 0.5172 | 0.5517 | +0.0345 |
| inventedEnumCount | 0 | 0 | 0 |
| ceilingHits160 | 0/71 | 0/71 | 0.0 |
| **OVERCONFIDENT_AMBIGUITY** | **8** | **7** | **-1 (target was ≤6 — not met)** |

### Reference accuracy — the collapse is a direct, verified reversal of V2.1's fix

`jsonValidityRate=1.0` for both, so this is not a floor-effect artifact.
All 4 of V2.1's previously-correct reference cases flipped to wrong in
V2.2:

| Case | V2.1 | V2.2 |
|---|---|---|
| `ambiguity-pt-switch-no-proposal-1` | correct (`THIS_ITEM`) | **wrong** |
| `reference-this-item-exercise-1` | correct | **wrong** |
| `revision-swap-exercise-explicit-1` | correct | **wrong** |
| `revision-swap-exercise-explicit-2` | correct | **wrong** |

Applicable-reference denominator also shrank (15 → 10) — V2.2 stopped
proposing a reference at all in 5 cases where V2.1 did. This is not a
clean "more conservative everywhere" shift (see §5) — it is a net loss on
the exact cases V2.1 was built to fix.

## 3. Evaluation Set B — V2.1 remediation validation (12 cases)

| Metric | V2.1 | V2.2 | Delta |
|---|---|---|---|
| jsonValidityRate | 1.0 | 1.0 | 0.0 |
| schemaValidityRate | 0.8333 | 1.0 | +0.1667 |
| primaryIntentAccuracy | 0.5833 | 0.6667 | +0.0834 |
| entityF1Mean | 1.0 | 1.0 | 0.0 |
| referenceAccuracy | 0.4286 | 0.3333 | -0.0953 (mild regression) |
| ambiguityAccuracy | 0.9167 | 0.9167 | 0.0 |
| inventedEnumCount | 0 | 0 | 0 |
| **OVERCONFIDENT_AMBIGUITY** | 1 | **0** | **-1 (genuine improvement)** |

A real improvement on the ambiguity axis here, but a real (smaller)
cost on reference accuracy — the same push-pull pattern as Set A, at
smaller magnitude.

## 4. Evaluation Set C — V2.2 dev challenge (12 cases, frozen before training)

This is the decisive generalization test: every case is a **fresh-wording
twin** of a V2.2 train family — same boundary concept, never the same
sentence. If V2.2 learned the underlying rule, this set should perform
similarly to the trained families; if it only memorized exact phrasings,
this set exposes that.

| Metric | Value |
|---|---|
| jsonValidityRate | 1.0 |
| schemaValidityRate | 0.8333 |
| primaryIntentAccuracy | 0.25 |
| referenceAccuracy | 0.1667 |
| ambiguityAccuracy | 0.4167 |
| **OVERCONFIDENT_AMBIGUITY** | **7 / 12** |

### Per-row breakdown (not just aggregate, per task requirement)

**Unresolved/negative side (8 cases, gold expects `UNKNOWN`+ambiguity flag):**

| Case | Correct? | Predicted behavior |
|---|---|---|
| `v22dev-deictic-no-target-1` | **wrong** | confidently resolved `THIS_ITEM` |
| `v22dev-deictic-no-target-2` | **wrong** | `ANSWER_QUESTION`, no ambiguity flagged |
| `v22dev-pt-switch-no-antecedent-1` | **correct** | `UNKNOWN`, clarification required |
| `v22dev-pt-switch-no-antecedent-2` | **wrong** | confidently resolved `REVISE_WORKFLOW` |
| `v22dev-multiple-visible-targets-1` | **wrong** | confidently picked one of two named candidates |
| `v22dev-multiple-visible-targets-2` | **wrong** | confidently resolved `REVISE_WORKFLOW` |
| `v22dev-numeric-ref-no-antecedent-1` | **wrong** | confidently resolved `THIS_ITEM` |
| `v22dev-numeric-ref-no-antecedent-2` | **wrong** | confidently resolved `THIS_ITEM` |

**Unresolved-side accuracy: 1/8 = 0.125** — the exact failure mode V2.2
was built to fix, reproduced almost unchanged on new wording.

**Resolvable/positive side (4 cases, gold expects confident resolution):**

| Case | Intent correct? | Reference correct? |
|---|---|---|
| `v22dev-backreference-same-message-1` | correct | wrong kind (`PREVIOUS_ITEM` vs `THIS_ITEM`, schema-invalid) |
| `v22dev-backreference-same-message-2` | **wrong** (`CONFIRM` vs `REVISE_WORKFLOW`) | correct |
| `v22dev-explicit-named-target-1` | **wrong** (invalid `workflowIntent`, wrong domain) | n/a (no reference expected) |
| `v22dev-explicit-named-target-2` | correct | n/a |

**Resolvable-side: intent correct 2/4; reference correct 1/2 applicable.**

### Classification: generalization failure, not partial success

`OVERCONFIDENT_AMBIGUITY=7/12` on dev-challenge is proportionally *worse*
than Set A's 7/71 — on fresh phrasings of the identical boundary the
29-row addition did not transfer. See
`training/semantic-qwen3-4b/outputs/train/qlora-baseline-v2.2/failure_taxonomy.json`
for the full classification record.

## 5. Anti-"always-UNKNOWN" check (required by task §29-32)

Compared predicted vs. gold `primaryIntent=UNKNOWN` on Set A:

| | Count |
|---|---|
| Gold UNKNOWN | 12 |
| V2.1 predicted UNKNOWN | 7 |
| V2.2 predicted UNKNOWN | 12 |
| V2.2 true-positive overlap | 5 |
| V2.2 false positives (predicted UNKNOWN, gold wasn't) | 7 |
| V2.2 false negatives (gold UNKNOWN, predicted something else) | 7 |

**`OVER_CONSERVATIVE_REFERENCE_REGRESSION`: not confirmed as a clean
pattern.** V2.2's aggregate UNKNOWN rate matching gold (12=12) is
coincidental — 7 false positives and 7 false negatives of near-equal
size mean this is a noisy recalibration, not a simple "say UNKNOWN more
often" shift. Notably, two of the false negatives
(`ambiguity-pt-switch-no-proposal-1/2`) are exactly the family V2.1 had
targeted, and one false negative (`safety-request-coach-impersonation-1`)
is a SAFETY-category miss worth flagging even though it's a single case.

## 6. Degeneration/repetition check

None found on any set. `jsonValidityRate=1.0` across Sets A/B/C,
`ceilingHits160=0` across all three. No non-JSON prose, no repetition
loops.

## 7. Category-level delta (original-71, V2.1 → V2.2)

| Category | n | Avg-score Δ | schemaValid V2.1→V2.2 |
|---|---|---|---|
| SAFETY_NON_AUTHORITY | 4 | +0.125 | 1.00 → 1.00 |
| MULTI_INTENT | 4 | +0.033 | 0.75 → 1.00 |
| FITNESS_SHORTHAND | 4 | +0.031 | 0.50 → 0.75 |
| REFERENCE | 7 | +0.024 | 1.00 → 1.00 |
| INTENT | 16 | +0.001 | 0.625 → 0.688 |
| AMBIGUITY_UNKNOWN | 5 | -0.040 | 0.80 → 0.80 |
| ENTITY | 11 | -0.045 | 0.636 → 0.636 |
| REVISION | 5 | -0.067 | 1.00 → 1.00 |
| FOLLOWUP_SLOT | 5 | -0.100 | 1.00 → 1.00 |
| CORRECTION | 10 | -0.140 | 1.00 → 0.90 |

No category collapsed outright, but the net is mixed-to-negative (4 up,
6 down), and the two metrics with hard-gate consequences
(`referenceAccuracy`, `entityF1Mean`) both regressed materially at the
aggregate level even though the `REFERENCE` category's composite score
ticked up slightly (that composite blends entity/ambiguity/intent
checks, diluting the pure reference-field collapse shown in §2).

## 8. Frozen hard-gate result (V2.1 as base, V2.2 as qlora — applied exactly, not reinterpreted)

```
QLORA_SIGNAL: "QLORA_REGRESSED"
```

| Gate | Result |
|---|---|
| `schemaValidityRate` must materially improve (≥+0.15) | FAIL (+0.028) — same `GATE_REVIEW_CANDIDATE` miscalibration noted in V2.1I (predeclared for base-vs-qlora, not refinement-vs-refinement); not the driver of REGRESSED here |
| `entityF1Mean` must not materially regress | **FAIL** (-0.12) — real, hard-gate-relevant |
| `referenceAccuracy` must not materially regress | **FAIL** (-0.267) — real, hard-gate-relevant, directly confirmed case-by-case in §2 |
| `ambiguityAccuracy` must not become dangerously overconfident | PASS (8→7, moved the right direction, just not far enough) |
| All other gates (unsafe, jsonValidity, correction, inventedEnum, maxTokenHitRate) | PASS |

Two genuine (non-review-candidate) hard-gate failures drive
`QLORA_REGRESSED`. This is a materially different, worse outcome than
V2.1I's single review-candidate-flagged failure.

## 9. Genuine-fix vs. artifact summary

| Observation | Genuine? |
|---|---|
| Set B OVERCONFIDENT_AMBIGUITY 1→0 | Genuine (no floor effect, jsonValid=1.0) |
| Set A OVERCONFIDENT_AMBIGUITY 8→7 | Genuine but insufficient — misses the ≤6 target |
| Set A referenceAccuracy 0.267→0.0 | Genuine regression — verified case-by-case, not a parsing artifact |
| Set A entityF1 0.894→0.775 | Genuine regression |
| Set C generalization failure (7/8 wrong on fresh unresolved wording) | Genuine — this is the clearest, most direct evidence that the 29-row addition did not teach the intended boundary rule |

## 10. Practical signal (separate from the formal gate, per task §38)

Beyond the formal `QLORA_REGRESSED` gate result: the core design
hypothesis behind V2.2 — that a small, targeted 29-row addition could
close the `OVERCONFIDENT_AMBIGUITY` gap without disturbing V2.1's
reference gains — **did not hold**. The dev-challenge set (built
specifically to test generalization) shows the model did not acquire a
transferable "is there a visible antecedent in this message" rule; it
most likely absorbed the new examples as additional near-memorized
patterns that interfered with, rather than reinforced, the V2.1
reference-resolution behavior. A larger dataset, different family
design (e.g., contrastive pairs within the same template), or a
different mitigation axis (post-hoc deterministic guard rather than more
training data) would be needed — not a straightforward "add more rows
to V2.2."

## 11. Final verdicts

**`V2_2_TRAINING_SUCCESS`** — training completed cleanly, valid adapter,
no NaN/corruption, single candidate, no forbidden action taken.

**`V2_2_REGRESSED`** — original-71 lost ground on two hard-gate metrics
(`referenceAccuracy`, `entityF1Mean`), the ambiguity hard target (≤6)
was not met (7, started at 8), and the dedicated generalization test
(Set C) shows the underlying fix does not transfer to new phrasings of
the same boundary. The one real gain (Set B's ambiguity 1→0) does not
offset these losses.

**`V2_2_NOT_READY_FOR_HELDOUT`** — a regression against V2.1 on frozen
hard gates, confirmed by an independent generalization test, is not a
state that should be promoted to the sealed heldout set.

## 12. Explicitly not done in this task

No second training candidate, no Optuna, no GGUF export, no production
runtime change, no evaluator/gold-label/acceptance-gate/generation-config
edit after seeing results, no heldout access of any kind.
