# Gymini Semantic Fine-Tune — Baseline Experiment V2

`SOURCE_HEAD=TRAINING_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, re-checked
stable at every checkpoint throughout this task. Branch `aws-deploy`. No
tracked production file was touched; everything below lives under
`training/semantic-qwen3-4b/` and `docs/ai-training/`.

No dedicated git worktree was created: `training/semantic-qwen3-4b/` is
entirely untracked (confirmed via `git status`), so a literal new worktree
would not carry over the existing `.venv`, the HF model cache, or any prior
V1/D1 output — it would strand the whole pipeline for no isolation benefit,
since this directory is already disjoint from the concurrently-active
product-development session's scope (`ai-service/`, `fitness-service/`,
`docs/ai-product/`), none of which this task touched.

## 1. Infrastructure reliability note (read before the results)

Both the training script (Unsloth's `FastLanguageModel.from_pretrained`)
and, less often, the eval script's plain `transformers` loading path
segfaulted intermittently on this 4GB RTX 3050 Ti throughout this task —
HF_BASE_V2 needed 5 launch attempts, the real training run needed 9
(isolated specifically to Unsloth's loading path: a direct A/B test showed
plain `transformers.AutoModelForCausalLM.from_pretrained` succeeding
reliably at the same moments Unsloth's `FastLanguageModel.from_pretrained`
segfaulted). Contributing factor identified, not fully solved: system RAM
was under real pressure during this task (as low as ~2.26 GB free of 16 GB,
from the user's own concurrent Docker Desktop/WSL/VS Code usage — their
legitimate work, not touched). The fix that reliably worked was a short
cooldown (several minutes of no retry) before the next attempt rather than
immediate rapid-fire retries, which appeared to compound rather than
resolve the instability. No training run was left accidentally unattended
overnight; every attempt was supervised and either completed or was
retried within the session.

## 2. Dataset V2 recap

See `docs/ai-training/qwen4b-semantic-dataset-v2.md` for full detail.
464 rows, 179 template families, 100% gold-schema validity, zero
template-family leakage, `max_seq_length=384` unchanged (max observed
token length 374). Train/validation/heldout = 327/71/66.

## 3. HF_BASE_V2 (causal baseline, full 71-case validation, no adapter)

```
transportSuccessRate: 1.0       jsonValidityRate: 0.5775
schemaValidityRate:   0.0       primaryIntentAccuracy: 0.0
entityF1Mean:         0.2676    correctionAccuracy: 0.0
referenceAccuracy:    0.0       ambiguityAccuracy: 0.4789
unsafeOutputRate:     0.0*      inventedEnumRate: 0.5775 (41/71)
meanLatencySeconds:   60.553
outputTokenCountStats: p50=131  p90=160  max=160  ceilingHits160=15/71 (21%)
errorBucketCounts: {INVALID_JSON:30, SCHEMA_INVALID:41, INVENTED_ENUM:41,
  WRONG_DOMAIN:10, ENTITY_MISSING:22, ENTITY_EXTRA:1, CORRECTION_WRONG:6,
  REFERENCE_WRONG:3, OVERCONFIDENT_AMBIGUITY:6, UNSAFE_OUTPUT:0}
```

\* **A real evaluator bug was found and fixed during the task §25 manual
sanity check**: `unsafe_output()`'s `UNSAFE_MARKERS` included the generic
string `"UPDATE "`, which matched the ordinary English word "update" in
one case's raw output ("check status or **update** of a bench"), flagging
it unsafe. This is a false positive, not a real safety issue — fixed by
dropping that one overly generic marker (the remaining SQL/shell-specific
markers like `"DROP TABLE"`/`"'; --"`/`"rm -rf"` still catch the
`SAFETY_NON_AUTHORITY` SQL-injection test cases correctly). Recomputed
`unsafeOutputRate` from the already-captured `rawText` with the fixed
marker list — no GPU re-run needed. `unsafeOutputRate` above reflects the
corrected value (0.0).

**Invalid-JSON taxonomy (30 cases, same method as D1 §7)**:
`TRUNCATED_AT_TOKEN_LIMIT: 16, MALFORMED_JSON_SYNTAX: 14`. Every invalid
case at least attempted `{` — consistent with D1's finding that the base
model's failures are either running out of the 160-token budget mid-
structure, or writing unquoted natural-language text inside an array
(a real, repeatable base-model habit, not random noise).

**§25 manual sanity check**: inspected 10+ cases spanning all 10
categories, plus confirmed `schemaValid=True` count is 0 (consistent with
D1's HF_BASE finding). The evaluator's metrics faithfully reflect raw
model behavior in every inspected case (the base model consistently
invents natural-language `primaryIntent`/`workflowIntent`/`requestedAction`
strings instead of using Gymini's enum tokens) — no evaluator malfunction
found; proceeded to training.

## 4. Acceptance gates (predeclared, `config/acceptance_gates_v2.json`)

Declared `2026-10-11T00:20:00+07:00`, before training started and before
any HF_QLORA_V2 metric existed — only HF_BASE_V2 was known.
`compare_base_vs_qlora.py` was extended with a `--gates` CLI flag (it had
hardcoded `acceptance_gates_v1.json` — a real bug: the first comparison
run silently used V1's gates instead of V2's; fixed and re-run against the
correct file before this verdict was finalized).

## 5. QLoRA training (task §27, the one permitted run)

Config unchanged from V1 (`r=16, alpha=32, dropout=0.05, lr=5e-5, epochs=2,
batch=1, grad_accum=8, max_seq_length=384, UNSLOTH_CE_LOSS_TARGET_GB=0.05`)
— only dataset paths/output dir differ (`config/qlora_semantic_qwen3_4b_v2.yaml`).
Training-time estimate (task §28): an 8-step dry run measured a steady-
state ~20s/step (faster than V1's ~80s/step — Unsloth's padding-free
batching auto-enabled this time), projecting ~38-40 min total for 82 steps
(327 train rows ÷ effective batch 8 × 2 epochs) — well within reasonable
bounds, no `FULL_TRAINING_TIME_BLOCKED` condition.

**Actual run**: 82 steps, **58m06s wall-clock** (`train_runtime=3486s`,
longer than the dry-run projection — later steps slowed to 30-100s/step,
plausibly from system load variability during the session, not a data
issue). `train_loss=0.4694` (average across the run) — far lower than
V1's `train_loss=1.315` on the same architecture/hyperparameters, with
eval_loss stable at ~0.20-0.21 across both epoch checkpoints (no
divergence). Peak VRAM was not instrumented with a dedicated logger, but
the run completed without OOM on this 4GB card under the same
`UNSLOTH_CE_LOSS_TARGET_GB=0.05` workaround documented since Phase D;
system RAM was observed as low as ~2.26 GB free during the session from
concurrent user applications, not uniquely attributable to this job.
Adapter saved to `training/semantic-qwen3-4b/outputs/train/qlora-baseline-v2`
(LoRA adapter only, never merged — task §36).

## 6. HF_QLORA_V2 (same evaluator, same settings, no merge)

```
transportSuccessRate: 1.0       jsonValidityRate: 1.0
schemaValidityRate:   0.7887    primaryIntentAccuracy: 0.662
entityF1Mean:         0.7817    correctionAccuracy: 0.8333
referenceAccuracy:    0.0       ambiguityAccuracy: 0.8169
unsafeOutputRate:     0.0       inventedEnumRate: 0.0563 (4/71)
meanLatencySeconds:   66.652
outputTokenCountStats: p50=82   p90=137  max=141  ceilingHits160=0/71 (0%)
errorBucketCounts: {INVALID_JSON:0, SCHEMA_INVALID:15, INVENTED_ENUM:4,
  WRONG_INTENT:20, WRONG_DOMAIN:8, ENTITY_MISSING:18, ENTITY_EXTRA:6,
  CORRECTION_WRONG:2, REFERENCE_WRONG:11, OVERCONFIDENT_AMBIGUITY:7, UNSAFE_OUTPUT:0}
```

**Invalid-JSON taxonomy: zero cases — nothing to classify.** Every single
one of the 71 QLoRA_V2 outputs is valid JSON. D1's central failure mode
(format abandonment, repetition loops, 71% token-ceiling hits) is
**completely eliminated**: `ceilingHits160` dropped from 15/71 (21%) on
HF_BASE_V2 to **0/71 (0%)** on HF_QLORA_V2, under byte-identical generation
settings.

## 7. Core causal table (HF_BASE_V2 → HF_QLORA_V2)

| Metric | HF_BASE_V2 | HF_QLORA_V2 | Delta |
|---|---|---|---|
| transportSuccessRate | 1.0 | 1.0 | 0.0 |
| jsonValidityRate | 0.5775 | 1.0 | **+0.4225** |
| schemaValidityRate | 0.0 | 0.7887 | **+0.7887** |
| primaryIntentAccuracy | 0.0 | 0.662 | **+0.662** |
| entityF1Mean | 0.2676 | 0.7817 | **+0.5141** |
| correctionAccuracy | 0.0 | 0.8333 | **+0.8333** |
| referenceAccuracy | 0.0 | 0.0 | 0.0 (unresolved floor) |
| ambiguityAccuracy | 0.4789 | 0.8169 | **+0.338** |
| requestedActionAccuracy | 0.0 | 0.4483 | **+0.4483** |
| unsafeOutputRate | 0.0 | 0.0 | 0.0 |
| inventedEnumCount/Rate | 41 / 0.5775 | 4 / 0.0563 | **-37 / -0.5212** |
| meanLatencySeconds | 60.553 | 66.652 | +6.099 |
| ceilingHits160 (count/rate) | 15 / 21% | 0 / 0% | **-15 / -21pp** |

**Gate results** (`compare_base_vs_qlora.py --gates config/acceptance_gates_v2.json`):

| Gate | Rule | Result |
|---|---|---|
| unsafeOutputRate must not worsen | hard | **PASS** |
| jsonValidityRate must not materially regress | hard | **PASS** (improved) |
| schemaValidityRate must materially improve (≥+0.15) | hard | **PASS** (+0.789) |
| primaryIntentAccuracy should materially improve (soft) | soft | **PASS** (+0.662) |
| entityF1Mean must not materially regress | hard | **PASS** (improved) |
| correctionAccuracy must not materially regress | hard | **PASS** (improved) |
| referenceAccuracy must not materially regress | hard | **PASS** (unchanged at floor) |
| ambiguityAccuracy must not become dangerously overconfident | hard | **FAIL** (OVERCONFIDENT_AMBIGUITY 6→7) |
| inventedEnumRate should materially improve (soft) | soft | **PASS** (-37) |
| maxTokenHitRate must not materially increase | hard | **PASS** (21%→0%) |

9/10 gates pass cleanly, including the one hard-coded specifically to
catch D1's degeneration failure (`maxTokenHitRate`), which now shows a
**complete reversal** (0% ceiling hits). One hard gate fails.

## 8. The one failing gate, investigated (not waved away)

`OVERCONFIDENT_AMBIGUITY` moved from 6 (base) to 7 (qlora) cases — a swing
of exactly +1 on a 71-case set. Direct per-case inspection:

- **4 cases unchanged** (overconfident in both): `followup-bare-number-no-context-1`,
  `ambiguity-single-word-ok-1`, `ambiguity-single-word-ok-2`,
  `safety-request-coach-impersonation-1` — pre-existing weaknesses, not a
  new regression.
- **2 cases fixed** (base overconfident, qlora correctly flags ambiguity):
  `entity-weight-unlabeled-confusable-1`, `ambiguity-single-word-ok-3`.
- **3 NEW overconfident cases** introduced by QLoRA:
  `ambiguity-pt-switch-no-proposal-1/2` ("đổi sang PT đó đi" / "chuyển PT
  kia luôn" — switching to an unspecified "that PT" with no visible
  proposal) and `entity-weight-unlabeled-confusable-2` ("70kg thì sao?" —
  ambiguous current-vs-target weight). All three require context the
  model structurally cannot see from the message alone (no pending
  proposal is ever injected into this prompt, confirmed in V1's own
  discovery work) — a genuinely hard sub-category, not a broad collapse.

Net: 2 fixed, 3 newly broken = +1. Meanwhile `ambiguityAccuracy` **improved
by +0.338 overall** — the model got substantially better at ambiguity
discipline in general; this hard gate caught a narrow, specific, well-
understood weakness concentrated in reference-without-visible-context
cases, not the systemic "forces everything into a confident intent"
pattern the gate exists to catch (task §26's own stated concern). This is
exactly the kind of case task §33 warns about checking for ("a higher
aggregate score must not hide category collapse") — checked, and no
category collapse was found; one narrow two-family weakness was.

## 9. Enum-fix intersection analysis (task §32 — the critical question)

Of HF_BASE_V2's 41 invented-enum cases, classified by HF_QLORA_V2 outcome:

| Classification | Count | % |
|---|---|---|
| `ENUM_FIXED_SEMANTICS_PRESERVED` (valid schema + correct intent) | **23** | 56% |
| `ENUM_FIXED_BUT_SEMANTICS_WORSE` (schema valid, intent still wrong) | 9 | 22% |
| `ENUM_FIXED_OTHER_SCHEMA_INVALID` (enum fixed, broke on something else) | 7 | 17% |
| `STILL_INVENTED_ENUM` | 2 | 5% |
| `ENUM_FIXED_BUT_JSON_BROKEN` | **0** | **0%** |

**This is the direct reversal of D1's central finding.** In D1, 8 of 9
apparent "fixes" (89%) were artifacts of the output becoming unparseable
(`ENUM_FIXED_BUT_JSON_BROKEN`) — the model never got far enough to invent
a wrong enum. Here, that category is **empty** — `jsonValidityRate=1.0`
means there is no floor for invented-enum detection to hide behind. 56%
of base's invented-enum cases are now genuine, complete, correct fixes.
**The adapter demonstrably learned Gymini's actual ontology this time**,
not merely a format that happens to suppress the invented-enum counter.
2 new invented-enum cases appeared (`intent-recommend-pt-confusable-1/3`)
— a small, real cost, not zero, but far outweighed by the 23 genuine gains.

## 10. Per-category deltas (task §33 — checking for hidden collapse)

| Category | n | avg score Δ | schemaValid base→qlora |
|---|---|---|---|
| AMBIGUITY_UNKNOWN | 5 | +3.00 | 0.00 → 1.00 |
| CORRECTION | 10 | +3.70 | 0.00 → 1.00 |
| ENTITY | 11 | +2.82 | 0.00 → 0.55 |
| FITNESS_SHORTHAND | 4 | +2.75 | 0.00 → 0.50 |
| FOLLOWUP_SLOT | 5 | +3.20 | 0.00 → 1.00 |
| INTENT | 16 | +2.44 | 0.00 → 0.56 |
| MULTI_INTENT | 4 | +2.00 | 0.00 → 1.00 |
| REFERENCE | 7 | +3.14 | 0.00 → 0.86 |
| REVISION | 5 | +3.20 | 0.00 → 1.00 |
| SAFETY_NON_AUTHORITY | 4 | +3.50 | 0.00 → 1.00 |

**Every single category improved. None regressed or collapsed.** `ENTITY`
and `INTENT` and `FITNESS_SHORTHAND` show the smallest (though still
positive and large) deltas — consistent with D1's own finding that these
are the categories needing the most reinforcement, and the categories V2's
dataset design specifically targeted with new entity+intent co-occurrence
families (`qwen4b-semantic-dataset-v2.md §3`). `referenceAccuracy`
specifically (a stricter sub-metric than `schemaValid`, requiring the
reference *kind* to match) remains at 0.0 despite `REFERENCE`'s category
`schemaValid` rate reaching 0.86 — the model now reliably produces a
syntactically valid `references[]` entry, but still frequently picks the
wrong `kind` enum value. This is V2's clearest remaining, unresolved
weakness.

## 11. Root-cause reconciliation with D1

D1 classified the old adapter's failure as `GENERATION_DEGENERATION_AFTER_QLORA`
driven by `TRAINING_DATA_TOO_SMALL` (99 rows/26 steps), and declared
`DATASET_EXPANSION_GO`. This experiment is the direct test of that
diagnosis: 464 rows/82 steps (4.7x more rows, 3.2x more steps) **completely
eliminated** the degeneration (0% ceiling hits, 0 invalid JSON, 0 NON_JSON_FORMAT/
REPEATED_JSON_OR_CONTENT cases) and produced large, broad, non-artifactual
improvement on every other metric. D1's diagnosis is **confirmed** by this
result, not merely asserted.
