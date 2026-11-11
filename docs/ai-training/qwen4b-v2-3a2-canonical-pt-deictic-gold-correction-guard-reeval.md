# Gymini Semantic Fine-Tune — V2.3A.2 Canonical PT-Deictic Gold Correction + Guard Re-Evaluation

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. `HELDOUT_UNOPENED`. `OPTUNA_NOT_RUN`.
`NO_GGUF_EXPORT`. `TRAINING_NOT_RUN`. `PRODUCTION_CHANGED=NO`. Historical
gold files, the guard, and the evaluator are all confirmed byte-unchanged
(`git diff --stat` empty on all of them throughout).

## 1. The product decision and why historical gold stays immutable

`PT_DEICTIC_CANONICAL_POLICY_V1` (task §0) is now a locked decision, made
*before* this task's re-score, on the basis of V2.3A.1's audit — not a
post-hoc "the metric looked bad so we changed the label" rationalization.
This matters methodologically: every historical number this project has
reported (V2.1's `referenceAccuracy=0.2667`, V2.3A's `0% correction
precision on original-71`, etc.) was **correct under the gold that
existed when it was measured**. Rewriting those files in place would
make every historical report silently wrong in retrospect. Instead, this
task adds a **new, versioned evaluation view** —
`training/semantic-qwen3-4b/datasets/canonical-policy/pt-deictic-v1/` —
and re-scores against it, while the original files remain byte-identical
(verified via SHA-256 and `git diff`).

## 2. Correction derivation (re-derived, not assumed — task §7/§33)

Re-read directly from V2.3A.1's own machine-readable audit
(`pt_deictic_case_audit.jsonl`), not assumed from its prose summary:

```
GOLD_CONFLICT total:        20  (matches expected)
Eligible for correction:    12  (matches expected — zero antecedent AND currently resolved)
Already policy-consistent:   8  (zero antecedent AND already unresolved)
```

No STOP was required — the re-derived counts matched the audit's own
expectation exactly.

### The 12 corrected case IDs

| Dataset | Case IDs |
|---|---|
| A (original-71) | `reference-this-item-pt-price-1`, `reference-this-item-pt-price-2` |
| B (V2.1 train additions — not an evaluation set, corrected for completeness/consistency but not re-scored) | `ref-this-item-pt-revise-1/2/3`, `ref-this-item-pt-switch-corrected-1/2/3`, `ref-this-item-person-ask-price-1/2` |
| C (V2.1 remediation validation) | `ref-this-item-pt-switch-val-1`, `ref-this-item-pt-switch-val-2` |

Note: 8 of the 12 corrected rows live in **B**, which is *training* data,
not one of the 3 evaluation sets (A/C/E) this task re-scores — they are
corrected in the versioned view for completeness and future-consistency
but have no evaluation-metric effect in this task (task never trains).
**0 rows were eligible in E** (dev-challenge) — its only PT-deictic
`GOLD_CONFLICT` rows were already in the "unresolved" camp.

### Minimal field mutation (task §11)

Only `references` (→ `[]`), `clarificationRequired` (→ `true`),
`ambiguities` (append one `{field:"reference", reason:...}` entry), and
`confidence` (floored to 0.3) change. `primaryIntent`, `entities`,
`requestedAction`, `workflowIntent` are left **untouched** — deliberately
narrower than the historical "already-unresolved" camp's own convention
(which also collapsed `primaryIntent` to `UNKNOWN`), chosen specifically
to match the ALREADY-FROZEN guard's own bounded-correction field list
(`reference_grounding_guard.py`'s documented `changed` list), so the
guard's output shape and the corrected gold's shape are directly
comparable without a second, unrelated source of mismatch. Every change
is recorded per-row in `corrections.jsonl` with before/after values.

## 3. Schema validation and hash integrity

- **95/95 (100%)** corrected rows pass the real
  `SemanticInterpretationSchema.safeParse()` (`validate-semantic-dataset-targets.ts`,
  not a reimplementation).
- Historical source files: **byte-identical**, confirmed via SHA-256 in
  `correction_manifest.json` and via empty `git diff --stat`.
- `v2_2_dev12_corrected.jsonl`'s hash is **identical** to the historical
  `dev_challenge.jsonl` source hash — direct proof 0 rows were touched
  there.
- Guard (`reference_grounding_guard.py`) and evaluator
  (`evaluate_semantics.py`) hashes match their V2.3A-recorded values
  exactly — confirmed unmodified.

## 4. Cross-dataset PT policy consistency, before vs after

| Condition | Before (V2.3A.1) | After this correction |
|---|---|---|
| Explicit PT name | consistent | consistent |
| One visible antecedent | consistent | consistent |
| **Zero visible antecedent** | **SPLIT 8 vs 12** | **unified: all UNRESOLVED** |
| Multiple visible antecedents | consistent | consistent |

No remaining contradiction for any audited PT-deictic condition
(`cross_dataset_consistency_after.json`).

## 5. Historical vs canonical metrics (both kept, neither overwritten)

### Set A — original-71

| Metric | Historical gold, raw | Historical gold, guarded | **Canonical gold, raw** | **Canonical gold, guarded** |
|---|---|---|---|---|
| referenceAccuracy | 0.2667 | 0.1429 | 0.3077 | 0.1667 |
| ambiguityAccuracy | 0.831 | 0.8169 | 0.831 | 0.8169 |
| OVERCONFIDENT_AMBIGUITY | 8 | 7 | **9** | **8** |
| entityF1Mean | 0.8944 | 0.8944 | 0.8944 | 0.8944 |
| schemaValidityRate | 0.8028 | 0.8028 | 0.8028 | 0.8028 |
| primaryIntentAccuracy | 0.6761 | 0.6761 | 0.6761 | 0.6761 |

Guard activations: **3** (same 3 as historical — this correction does
not create or remove any guard activation on this set, since activation
depends only on the model's own predicted `references`, not gold).
Beneficial: **0**. Harmful: **3**. Correction precision: **0%** — **no
change from historical.**

OVERCONFIDENT_AMBIGUITY's raw baseline actually **increased** (8→9)
under canonical gold: the 2 corrected rows
(`reference-this-item-pt-price-1/2`) now require clarification that the
model's actual (already-fixed, pre-existing) prediction doesn't give —
a mechanical, expected consequence of making gold stricter, not a new
problem. The guard still cannot fix these 2 specific rows because the
model's predictions for them contain **no reference at all**
(`references=[]`) — the guard only filters existing references, it does
not invent missing clarification. **Target `<=6`: still FAIL (8, even
worse than historical's 7).**

### Set B — V2.1 remediation-12 (the set with the cleanest conflict)

| Metric | Historical, raw | Historical, guarded | **Canonical, raw** | **Canonical, guarded** |
|---|---|---|---|---|
| referenceAccuracy | 0.4286 | 0.1429 | **0.1429** | **0.2** |
| ambiguityAccuracy | 0.9167 | 0.75 | 0.75 | **0.9167** |
| OVERCONFIDENT_AMBIGUITY | 1 | 1 | 3 | **1** |

Guard activations: **2** (same 2 rows: `ref-this-item-pt-switch-val-1/2`).
Beneficial: **2**. Harmful: **0**. Correction precision: **100%** — up
from historical's 0%, exactly as V2.3A.1's boundary analysis predicted.

### Set C — V2.2 dev-challenge-12

**Byte-identical gold to historical (0 rows corrected)** — numbers are
unchanged from V2.3A by construction:

| Side | Metric | Raw | Guarded |
|---|---|---|---|
| Unresolved (8) | correct count | 0/8 | 3/8 |
| Resolvable (4) | correct count | unaffected | unaffected (fully preserved) |
| Aggregate | ambiguityAccuracy | 0.3333 | 0.5833 |
| Aggregate | OVERCONFIDENT_AMBIGUITY | 8 | 5 |

Guard activations: **3**. Beneficial: **3**. Harmful: **0**. Correction
precision: **100%** — unchanged from V2.3A (this set had 0 eligible
corrections).

## 6. V2.3A's 3 historical harmful corrections, revisited (task §25 — measured, not assumed)

| Case | Domain | In scope for this correction? | Result under canonical policy |
|---|---|---|---|
| `multi-dismiss-and-new-request-2` | non-PT (generic deictic + DISMISS idiom) | **No** — not a PT case at all | **Remains HARMFUL**, unchanged |
| `ambiguity-pt-switch-no-proposal-1` | PT | **In scope, but was already in the "already-consistent" camp** (gold's `clarificationRequired` was already `true`) — not one of the 12 corrected rows | **Remains HARMFUL** on the referenceAccuracy axis specifically, because this row's gold *keeps* a non-empty `references[]` entry while flagging unresolved (the representation-convention quirk flagged in V2.3A.1 §9), so the guard's correct act of clearing the reference still scores `referenceCorrect=False` against this one row's particular gold shape |
| `reference-this-item-exercise-1` | non-PT (exercise) | **No** — outside this audit's PT-only scope by design (task §9: "do not alter... exercise reference cases") | **Remains HARMFUL**, unchanged |

**0 of 3 reclassify as beneficial. 3 of 3 remain harmful — for three
different, now precisely identified reasons**, none of which is "the
correction didn't work": two are simply outside this correction's
declared scope (non-PT), and the third is blocked by a *second*,
previously-flagged, distinct issue (the gold representation-convention
inconsistency, not the resolution-policy inconsistency this task fixed).

## 7. Remediation-12's 2 historical harmful corrections, revisited (task §26)

| Case | Result under canonical policy |
|---|---|
| `ref-this-item-pt-switch-val-1` | **BENEFICIAL** (reclassified) |
| `ref-this-item-pt-switch-val-2` | **BENEFICIAL** (reclassified) |

**2 of 2 reclassify from harmful to beneficial.** This is the clean,
fully-predicted result — these were the two cases whose gold was
*directly* corrected by the policy decision.

## 8. The 4 historical V2.1 reference wins, revisited (task §27 — history not rewritten)

| Case | Domain | Canonical status |
|---|---|---|
| `revision-swap-exercise-explicit-1` | exercise | **UNAMBIGUOUS_REFERENCE_WIN** — unaffected, explicit named target, guard never activates on it |
| `revision-swap-exercise-explicit-2` | exercise | **UNAMBIGUOUS_REFERENCE_WIN** — same |
| `reference-this-item-exercise-1` | exercise | Out of this task's PT-only scope — status unchanged from V2.3A.1 (not reclassified here) |
| `ambiguity-pt-switch-no-proposal-1` | PT | **REFERENCE_WIN_UNDER_CONFLICTED_HISTORICAL_GOLD** — gold was already canonical-policy-consistent on the *resolution* axis (not one of the 12 corrected rows), so this task's correction does not change its status; it remains a win whose underlying gold representation (kept reference + unresolved) is still the separate, unresolved `EVALUATOR_REVIEW_CANDIDATE` item from V2.3A.1 §9 |

None of V2.1's 4 reported wins are retracted. This task only sharpens
which of the four rests on since-corrected ground (none, as it turns
out — the one PT win was on the *already-consistent* side of the split,
not the corrected side) versus which rests on a still-open, separate
representation question (one).

## 9. Reference preservation and anti-over-conservative check (task §29/§31)

| Check | Result |
|---|---|
| Explicit PT names remain resolvable | **Yes** — no explicit-named PT case was ever touched by the correction or newly invalidated by the guard |
| Unique visible antecedents remain resolvable | **Yes** — `v22-backreference-same-message-2`, `v22-explicit-named-target-2` unaffected (not PT-deictic-eligible, never corrected) |
| Valid exercise references unaffected | **Yes** — `revision-swap-exercise-explicit-1/2` guard-inactive (`REFERENCE_EXPLICIT_TARGET`) in both historical and canonical runs, byte-for-byte same decision |
| Valid explicit/unique references invalidated | **0** |
| References incorrectly forced unresolved | **0 new ones** — the only cases where this still happens (`ambiguity-pt-switch-no-proposal-1`, `reference-this-item-exercise-1`, `multi-dismiss-and-new-request-2`) are the same 3 as historical, for the reasons in §6, not new corrections-induced harm |
| Unrelated non-reference semantics changed | **0** — `primaryIntent`/`entities`/`requestedAction` identical before/after on every corrected row (verified: `primaryIntentAccuracy` unchanged at 0.6761/0.5833 on both sets) |

## 10. Correction precision summary (task §30, not combined to hide failure)

| Set | Beneficial / Activations | Precision | Band (task §37) |
|---|---|---|---|
| A (original-71) | 0/3 | **0%** | WEAK |
| B (remediation-12) | 2/2 | **100%** | STRONG |
| C (dev-challenge-12) | 3/3 | **100%** | STRONG |
| **Overall (8 activations across all 3 sets)** | **5/8** | **62.5%** | **WEAK** (per task §37's exact bands: <0.75 = WEAK) |

Reported per-set as required — the strong 100% results on B and C are
not allowed to mask A's unchanged 0%.

## 11. Formal gates (task §38, kept separate)

**Historical MODEL_GATE** (unchanged, not rewritten): V2.1's own
model-only gate from `qwen4b-v2-1i-single-training-targeted-eval.md`
stands exactly as reported — this task does not touch it.

**Canonical SYSTEM_CANDIDATE_GATE** (task §36, re-evaluated under
canonical gold):

| # | Criterion | Result |
|---|---|---|
| 1 | corrected original-71 OVERCONFIDENT_AMBIGUITY ≤6 | **FAIL** (8, guarded) |
| 2 | reference accuracy preserved/improved | **FAIL** on A (-0.141 guard vs raw); **PASS** on B (+0.057) |
| 3 | explicit/unique references preserved | **PASS** |
| 4 | Set C unresolved materially improved | **PASS** (0/8→3/8, OVERCONFIDENT_AMBIGUITY 8→5) |
| 5 | Set C resolvable preserved | **PASS** |
| 6 | guard correction precision high | **FAIL** (62.5% overall, WEAK band; driven entirely by set A) |
| 7 | no broad entity/intent/schema regression | **PASS** |
| 8 | no evaluator/guard modification | **PASS** |

5/8 pass, 2 fail (criteria 1 and 6, both anchored on set A), 1 mixed
(criterion 2). **Does not clear the full success bar.**

## 12. Verdicts

**`REFERENCE_GUARD_CANONICAL_PARTIAL`** — the canonical policy correction
delivered exactly the predicted, measured benefit where it was
mechanically possible (remediation-12: 0%→100% correction precision,
precisely the 2 rows the correction targeted) and left dev-challenge-12
unchanged (it needed no correction). But original-71 — the set with the
hard `≤6` target — shows **zero net improvement**, not because the
policy correction was wrong, but because none of its 3 historical
harmful activations happen to land on a row this correction was eligible
to fix (2 are outside PT scope entirely; the 1 PT case was already on
the policy-consistent side and is blocked by a *separate*, already-named
representation-convention issue). This is a real, meaningful, precisely
bounded improvement — not the broad success the `≤6` target and `≥0.90`
precision band would require.

**`SYSTEM_CANDIDATE_NOT_READY_FOR_HELDOUT`** — criteria 1 and 6 of the
canonical success gate are not met on the primary 71-row set.

## 13. Remaining blocker classification (task §42)

Two distinct, now-precisely-identified blockers remain on original-71,
neither of which should trigger a new QLoRA round, a V2.3/V2.4 dataset,
or an immediate guard change:

- **`NON_PT_REFERENCE_FAILURE`** / **`IDIOM_OR_DISMISSAL_CASE`**:
  `reference-this-item-exercise-1` (exercise-domain analogue of the same
  zero-antecedent pattern, never audited for correction since this task
  was PT-scoped only) and `multi-dismiss-and-new-request-2` (a DISMISS
  idiom where the reference's identity is genuinely irrelevant to the
  action — flagged already in V2.3A §7 as a scope gap, not a policy
  conflict).
- **`EVALUATOR_LIMITATION`** (narrowly, matching V2.3A.1 §9's existing
  flag, not a new finding): `ambiguity-pt-switch-no-proposal-1`'s gold
  keeps a non-empty `references[]` entry while unresolved, so
  `reference_correct()`'s set-comparison scores the guard's *correct*
  clearing action as wrong. Fixing this is a representation-convention
  change (standardize on "clear references when unresolved," matching
  every V2.2A-era row), not a resolution-policy change — explicitly a
  different, smaller, already-scoped task from this one.

**Smallest recommended next action**: extend
`PT_DEICTIC_CANONICAL_POLICY_V1`'s representation convention (clear
`references` to `[]` when unresolved, never keep-but-flag) to the 2
remaining `ambiguity-pt-switch-no-proposal-*` rows specifically — a
1-field, 2-row follow-up correction, not a new audit or policy
decision. This alone would very likely flip `ambiguity-pt-switch-no-proposal-1`
from harmful to beneficial on the reference axis, which — combined
with the already-100%-precision sets B/C — would materially change the
overall correction-precision picture without touching the exercise-domain
or DISMISS-idiom cases at all.

## 14. Explicitly not done in this task

No historical gold file edited, no evaluator edited, no guard edited (all
three confirmed via hash comparison + empty `git diff`), no training run,
no V2.3/V2.4 dataset created, no heldout access, no Optuna, no GGUF
export, no production change, no policy change after seeing scores, no
automatic start of V2.3B.
