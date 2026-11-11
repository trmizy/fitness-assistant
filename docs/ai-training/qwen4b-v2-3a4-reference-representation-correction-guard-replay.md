# Gymini Semantic Fine-Tune — V2.3A.4 Reference Representation Correction + Frozen Guard Replay

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. `HELDOUT_UNOPENED`. `OPTUNA_NOT_RUN`.
`NO_GGUF_EXPORT`. `TRAINING_NOT_RUN`. `PRODUCTION_CHANGED=NO`. Historical
gold, V2.3A.2's canonical-policy-v1 files, the guard, and the evaluator
are all confirmed byte-unchanged (`git diff --stat` empty on every one).

## 1. The Option B decision and why only 2 rows were eligible

V2.3A.3 determined, from producer wording, consumer-safety analysis,
information-redundancy analysis, and evaluator/guard structural fit —
**not** from historical row counts — that `REFERENCE_REPRESENTATION_V1_OPTION_B`
is canonical: `references` holds only grounded targets; an unresolved
reference clears `references` to `[]`, with the attempt recorded via
`ambiguities`+`clarificationRequired` alone. Exactly 2 distinct case IDs
violate this (`ambiguity-pt-switch-no-proposal-1/2`), both already
semantically unresolved (`clarificationRequired=true`) — the defect was
purely representational, not a resolution-policy question (that was
V2.3A.1/A.2's separate, already-closed question).

## 2. Scope verification (task §9, before touching anything)

Searched the 3 V2.3A.2 canonical-policy-v1 views for every physical
occurrence of the 2 approved IDs:

```
Physical occurrences found: 2
  original71_corrected.jsonl / ambiguity-pt-switch-no-proposal-1
  original71_corrected.jsonl / ambiguity-pt-switch-no-proposal-2
Unique IDs found: {ambiguity-pt-switch-no-proposal-1, ambiguity-pt-switch-no-proposal-2}
Matches expected 2 unique IDs: True
```

Both rows exist only in the original-71 view (0 in remediation-12, 0 in
dev-challenge-12 — they were never part of those files to begin with).
No scope expansion — `REPRESENTATION_CORRECTION_SCOPE_EXPANDED` was not
triggered.

### Eligibility re-verified per row (task §10), not assumed

For each: `clarificationRequired` was already `true`; `references` was
non-empty; the frozen guard's own candidate extraction independently
re-confirmed 0 compatible visible antecedents (`REFERENCE_NO_VISIBLE_TARGET`,
`candidateCount=0`) for both. All 5 eligibility conditions held for both
rows — the build script hard-`STOP`s if any condition fails (none did).

## 3. The one-field correction (task §11)

Built starting from V2.3A.2's `pt-deictic-v1/` canonical views (not raw
historical gold, per task §8), into a new sibling view:
`training/semantic-qwen3-4b/datasets/canonical-policy/pt-deictic-v1-reference-representation-v1/`.
The build script explicitly asserts every other field is byte-identical
before writing a row — `changedFields: ["references"]` for both, nothing
else. Reason: `UNRESOLVED_REFERENCE_MUST_NOT_RETAIN_GROUNDED_REFERENCE`.

```
original71_corrected.jsonl -> original71_canonical_representation.jsonl: 71 rows, corrected: 2
v2_1_remediation12_corrected.jsonl -> remediation12_canonical_representation.jsonl: 12 rows, corrected: 0
v2_2_dev12_corrected.jsonl -> dev12_canonical_representation.jsonl: 12 rows, corrected: 0
```

## 4. Schema validation and hash integrity

- **95/95 (100%)** rows pass the real `SemanticInterpretationSchema.safeParse()`.
- Source hashes (`original71_corrected.jsonl`, `v2_1_remediation12_corrected.jsonl`,
  `v2_2_dev12_corrected.jsonl`) match V2.3A.2's own recorded hashes
  exactly — confirmed byte-unchanged.
- `remediation12_canonical_representation.jsonl` and
  `dev12_canonical_representation.jsonl` hash **identically** to their
  V2.3A.2 source — direct proof 0 rows were touched in either.
- `original71_canonical_representation.jsonl`'s hash differs from its
  source (as expected — exactly 2 rows changed).
- Guard (`reference_grounding_guard.py`) and evaluator
  (`evaluate_semantics.py`) hashes match every prior recorded value —
  confirmed unmodified.

## 5. Targeted case replay (task §23 — measured, not assumed)

| | `ambiguity-pt-switch-no-proposal-1` | `ambiguity-pt-switch-no-proposal-2` |
|---|---|---|
| Canonical gold before A.4 | `references=[{THIS_ITEM,"PT đó"}]` | same |
| Canonical gold after A.4 | `references=[]` | same |
| Raw V2.1 prediction | `UNKNOWN`, `references=[{THIS_ITEM,"PT đó"}]`, `clarificationRequired=false` | `UNKNOWN`, `references=[{ALTERNATIVE_ITEM,...}]` (invented kind, already schema-invalid) |
| Guarded V2.1 prediction | `references=[]`, `clarificationRequired=true` | **unchanged** — guard does not act on `ALTERNATIVE_ITEM` (not a guarded kind) |
| `reference_correct` raw → guarded | `False` → `None` (both empty now, not-applicable) | `False` → `False` (unaffected) |
| `ambiguity_correct` raw → guarded | `False` → **`True`** | `True` → `True` (unaffected) |
| Guard classification | `REFERENCE_NO_VISIBLE_TARGET` (invalidated) | `REFERENCE_NOT_APPLICABLE` (not activated) |
| **Final classification** | **`BENEFICIAL`** (measured, not assumed) | Not a guard activation at all, before or after — its prediction's invented-kind defect is a separate, pre-existing issue |

Case 1 reclassifies exactly as hypothesized. Case 2 was never actually a
guard activation (the model's own output used an invalid reference kind)
— the representation correction changes its gold but has zero
measurable effect on its scoring, since nothing about this row's
scoring path involves the guard either way.

## 6. Set A — original-71

| Metric | Raw V2.1 | Guarded V2.1 |
|---|---|---|
| referenceAccuracy | 0.2308 | 0.1818 |
| ambiguityAccuracy | 0.831 | 0.8169 |
| OVERCONFIDENT_AMBIGUITY | 9 | **8** |
| entityF1Mean | 0.8944 | 0.8944 |
| schemaValidityRate | 0.8028 | 0.8028 |
| primaryIntentAccuracy | 0.6761 | 0.6761 |

Guard activations: **3**. Beneficial: **1**. Harmful: **2**. Neutral:
**0**. Correction precision: **33.33%** (up from V2.3A.2's 0%, but still
**WEAK** band, <0.75).

### Historical Set A harmful=3, reclassified (task §24, measured)

| Case | Reclassification |
|---|---|
| `ambiguity-pt-switch-no-proposal-1` | **HARMFUL → BENEFICIAL** |
| `multi-dismiss-and-new-request-2` | **remains HARMFUL** (DISMISS idiom — out of this task's scope, task §25) |
| `reference-this-item-exercise-1` | **remains HARMFUL** (exercise-domain resolution-policy conflict — out of scope, task §25) |

**1 of 3 reclassifies. 2 of 3 remain harmful for their own, separate,
already-diagnosed reasons — exactly as task §24/§25 anticipated and
required to be measured rather than assumed.**

## 7. Set B — V2.1 remediation-12

| Metric | Raw | Guarded |
|---|---|---|
| referenceAccuracy | 0.1429 | 0.2 |
| ambiguityAccuracy | 0.75 | 0.9167 |
| OVERCONFIDENT_AMBIGUITY | 3 | **1** |

Guard activations: **2**. Beneficial: **2**. Harmful: **0**. Correction
precision: **100%** (unchanged from V2.3A.2 — this set's 2 PT rows were
already fully resolved there; this task's correction touches 0 rows in
this set).

## 8. Set C — V2.2 dev-challenge-12

Byte-identical gold to V2.3A.2 (0 rows corrected here) — numbers
unchanged by construction:

| Side | Raw correct | Guarded correct |
|---|---|---|
| Unresolved (8) | 0/8 | 3/8 |
| Resolvable (4) | unaffected | unaffected (fully preserved) |

Aggregate: `ambiguityAccuracy` 0.3333→0.5833, `OVERCONFIDENT_AMBIGUITY`
8→**5**. Guard activations: **3**. Beneficial: **3**. Harmful: **0**.
Correction precision: **100%**.

## 9. Reference preservation and over-conservative check (task §28)

| Check | Result |
|---|---|
| Explicit PT names preserved | Yes — unaffected (0 explicit-name rows touched by this correction) |
| Unique visible references preserved | Yes |
| Exercise explicit reference wins (`revision-swap-exercise-explicit-1/2`) preserved | Yes — guard never activates on them (`REFERENCE_EXPLICIT_TARGET`), byte-identical decision before/after |
| New over-conservative regressions | **0** |
| The 2 corrected unresolved cases counted as "valid reference wins" | **No** — explicitly not (task §28); see §11 |

## 10. Cross-dataset representation consistency after correction (task §30)

Within the audited scope (the 2 approved IDs, across the 3 canonical
evaluation views): **zero remaining `UNRESOLVED_REFERENCE_RETAINED`
rows.** (A broader re-scan of every dataset for this property was
V2.3A.3's job, already done there; this task did not re-scan beyond its
approved 2-row scope, per task §2's explicit restriction.)

## 11. Four historical V2.1 reference wins, final reclassification (task §29)

| Case | Classification |
|---|---|
| `revision-swap-exercise-explicit-1` | **`UNAMBIGUOUS_GENUINE_REFERENCE_WIN`** |
| `revision-swap-exercise-explicit-2` | **`UNAMBIGUOUS_GENUINE_REFERENCE_WIN`** |
| `ambiguity-pt-switch-no-proposal-1` | **`HISTORICAL_GOLD_ARTIFACT`** — the original "win" matched a representation convention now identified as inconsistent with the other 53/55 rows in this project's history; the message has zero textual antecedent, so it was never genuine evidence of grounding, only of matching an idiosyncratic gold shape that has since been corrected |
| `reference-this-item-exercise-1` | **`OUT_OF_SCOPE_REFERENCE_WIN`** — rests on a resolution-policy question (not a representation question) in the exercise domain, structurally identical to the PT zero-antecedent conflict but never audited or corrected, since V2.3A.1 was PT-scoped and this task's scope was the 2 named PT rows only |

Historical reports are not rewritten — this is purely an additional,
dated classification layer.

## 12. Remaining blockers (not fixed here, task §37 classification)

- `multi-dismiss-and-new-request-2` → **`DISMISS_IDIOM_HANDLING`**
- `reference-this-item-exercise-1` → **`NON_PT_REFERENCE_POLICY`**
- Original-71's `OVERCONFIDENT_AMBIGUITY` target (≤6) → **FAIL** (8,
  guarded) — mechanically unreachable by this correction alone, since
  most of the 9 raw violations have model predictions with already-empty
  `references` (nothing for the guard to act on) or are one of the two
  blockers above.

Full detail: `outputs/v2.3a4-reference-representation-correction/remaining_blockers.json`.

## 13. Correction precision, reported separately (task §27/§31 — no cherry-picking)

| Set | Beneficial / Activations | Precision | Band |
|---|---|---|---|
| A (original-71) | 1/3 | 33.33% | **WEAK** |
| B (remediation-12) | 2/2 | 100% | STRONG |
| C (dev-challenge-12) | 3/3 | 100% | STRONG |
| **Overall (8 activations)** | **6/8** | **75%** | **PARTIAL** (exactly at the PARTIAL/WEAK boundary — Set A's WEAK result is reported here explicitly, not hidden by the combined number) |

## 14. Production contract blocker (task §35, preserved verbatim, not fixed)

V2.3A.3's finding stands, factually recorded, unchanged by this task:
`interpreter.ts`'s live `buildPrompt()` (inside `interpretWithLlm()`)
requests only `primaryIntent`, `entities`, `goalSignals`,
`asksRecommendation`, `isCorrection` from Qwen — `references` in every
live request today is always `interpretDeterministic()`'s
`detectReferences()` output, never LLM-produced. The fine-tune's full
13-field contract has no live integration point. **Not fixed here.**

## 15. Verdicts

**`REFERENCE_REPRESENTATION_CORRECTION_SUCCESS`** (narrow scope, as
defined in task §32 — about the representation correction itself, not
production readiness): both approved inconsistencies corrected cleanly
(2 rows, 1 field each, verified), zero unintended row changes (asserted
in code, confirmed), the targeted case measurably reclassified as
predicted, zero new regressions introduced, and the canonical
representation is now consistent within the audited scope.

**`REFERENCE_GUARD_QUALITY_READY_FOR_RUNTIME_ALIGNMENT_AUDIT`** — the
offline guard's behavior is now fully understood and bounded: every
remaining harmful/weak result traces to one of exactly 2 already-named,
already-diagnosed, narrowly-scoped causes (a DISMISS idiom, an
exercise-domain policy conflict), neither of which implicates the
guard's core grounding logic. This is coherent enough to justify
auditing the much larger, separate question (§14) of whether any of
this offline work corresponds to real production behavior at all.

**`SEALED_HELDOUT_BLOCKED_PENDING_RUNTIME_CONTRACT_AUDIT`** —
`HELDOUT_UNOPENED`. Per task §34's explicit instruction, this task does
**not** return `SYSTEM_CANDIDATE_READY_FOR_SEALED_HELDOUT` regardless of
the offline result above — the production-contract blocker from §14
means offline evaluation does not yet establish anything about real
production behavior.

## 16. Next task (not started automatically)

**V2.3A.5 — Production Semantic Contract Alignment Audit.** Must answer:
what is Qwen actually trained to output vs. what does
`interpretWithLlm()` actually request; which fields are deterministic vs.
model-produced vs. post-processed; is the fine-tuned adapter used by any
live code path at all; would offline evaluation numbers reflect
production behavior; what is the minimal integration design required.
Not started in this task.

## 17. Explicitly not done in this task

No historical gold or V2.3A.2 canonical file edited (both confirmed via
hash), no guard edited, no evaluator edited, no training run, no new
dataset, no heldout access, no Optuna, no GGUF export, no production
file touched (`interpreter.ts`/`signals.ts`/`policy.ts`/`router.ts` all
confirmed untouched), no automatic start of V2.3A.5.
