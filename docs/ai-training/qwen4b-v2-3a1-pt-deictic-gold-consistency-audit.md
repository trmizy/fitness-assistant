# Gymini Semantic Fine-Tune — V2.3A.1 PT/HLV Deictic Gold Consistency Audit

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. `HELDOUT_UNOPENED`. `OPTUNA_NOT_RUN`.
`NO_GGUF_EXPORT`. `PRODUCTION_UNCHANGED`. `TRAINING_NOT_RUN`. No gold file,
evaluator, or guard was modified (verified via `git diff --stat` on all
three — empty). This task is audit-only: facts + one canonical proposal,
no fix applied.

## 1. Motivation

V2.3A (`qwen4b-v2-3a-deterministic-reference-grounding-guard.md`) found
that 100% of its harmful guard corrections on the original-71 and
remediation-12 sets traced to one suspected cause: a gold-label conflict
around "PT này/đó/kia" with no PT named. This task audits that suspicion
directly against every PT/HLV-deictic row in the 5 permitted datasets,
rather than just the specific case IDs V2.3A already flagged.

## 2. Parser visible-context contract (re-verified, task §6)

Read directly from `interpreter.ts`, `policy.ts`, `schema.ts` (all three
confirmed untouched by any concurrent work this session):

- The real production prompt (`buildPrompt()`) sends only a fixed system
  instruction + optional `expectedSlot` + the current user message. **No
  conversation history is included.**
- `ci.proposal` (a persisted business object) exists in
  `InterpretContext`, but is consumed only by `policy.ts`'s separate
  grounding check for `ACCEPT_PROPOSAL`/`LOWER_OPTION`/`HIGHER_OPTION`/
  `MIDDLE_OPTION` — **not visible to the semantic-interpretation step
  itself**, and not relevant to `THIS_ITEM`/`PREVIOUS_STATE`.
- `InterpretContext.persisted` exists but only carries
  `goal/heightCm/currentWeightKg/targetWeightKg/age/gender` — **no
  PT/coach identity field of any kind.**
- No candidate PT list, no DB context, is passed to the parser.

**Conclusion**: for `THIS_ITEM`/`PREVIOUS_STATE` PT references, the ONLY
legitimate visible context is the current message's own text. Any gold
label implying otherwise (a "current PT" from persisted state, a
previously-proposed PT) is relying on something the parser's real input
does not contain.

## 3. Audit scope and method

Two independent sweeps across all 5 permitted datasets (A: V2 original
validation, B: V2.1 train additions, C: V2.1 validation remediation, D:
V2.2 train remediation, E: V2.2 dev challenge), not limited to case IDs
already named in prior reports (task §5):

1. Messages containing both a PT/HLV/coach/người word AND a deictic word
   (này/đó/kia/đây).
2. Messages containing a PT/HLV/coach/người word at all (to also catch
   explicit-naming cases with no deixis, and to verify non-deictic PT
   mentions are correctly excluded).

Heldout was never opened. **41 relevant rows found and classified**
(full table: `training/semantic-qwen3-4b/outputs/v2.3a1-pt-deictic-gold-audit/pt_deictic_case_audit.jsonl`,
built by `training/semantic-qwen3-4b/scripts/build_pt_deictic_audit.py`,
which only reads existing files).

## 4. Counts

| Classification | Count |
|---|---|
| `GOLD_CONFLICT` | 20 |
| `GOLD_CONSISTENT` | 3 |
| `NOT_APPLICABLE` | 18 |
| `EVALUATOR_REVIEW_CANDIDATE` (as primary) | 0 — see §9 |
| `SCHEMA_REPRESENTATION_AMBIGUOUS` (as primary) | 0 — see §10 |
| **Total audited** | **41** |

By dataset:

| Dataset | GOLD_CONFLICT | GOLD_CONSISTENT | NOT_APPLICABLE |
|---|---|---|---|
| A (V2 validation) | 4 | 0 | 10 |
| B (V2.1 train additions) | 8 | 0 | 6 |
| C (V2.1 validation remediation) | 2 | 0 | 2 |
| D (V2.2 train remediation) | 4 | 3 | 0 |
| E (V2.2 dev challenge) | 2 | 0 | 0 |

No EVALUATOR_REVIEW_CANDIDATE or SCHEMA_REPRESENTATION_AMBIGUOUS case
required that as its PRIMARY tag — every conflicted case is more
specifically a straightforward gold-content disagreement. Both
dimensions still surfaced as real secondary findings (§9, §10).

## 5. Findings by condition (task §21's proposed invariant, tested against evidence)

**Explicit named PT (`v22-explicit-named-target-2`, "Chọn PT Lan cho
tôi."):** `GOLD_CONSISTENT`. `references=[]` — resolved via direct
naming, no deictic tag needed at all. No conflicting row found anywhere.

**Exactly one visible antecedent, same-message backreference
(`v22-backreference-same-message-2`, "PT Minh tư vấn tốt lắm, chốt người
đó cho tôi."):** `GOLD_CONSISTENT`. One named PT, backreference resolves
to it, `clarificationRequired=false`. No conflicting row found. (Data
quality note, not a policy issue: this row's `references[0].sourceText`
is literally `"bài đó"` — a copy-paste artifact from a different
family's template; `reference_correct()` only checks `(kind, ordinal)`,
so this does not affect any score, but is worth a one-line fix whenever
this file is next touched for an unrelated reason.)

**Zero visible antecedent:** `GOLD_CONFLICT` — **split straight down the
middle, 8 vs 12 rows**, and the split is not generational (see §6).

**Multiple visible antecedents, no disambiguator
(`v22-multiple-visible-targets-2`, "PT Lan và PT Minh đều ổn, chọn người
đó cho tôi."):** `GOLD_CONSISTENT`. Two named candidates, singular
deictic doesn't disambiguate, `clarificationRequired=true`. No
conflicting row found.

**Hidden candidate/proposal state:** No row in any of the 5 datasets
explicitly encodes this (no PT row references `ci.proposal`-style
state) — unlike the ACCEPT_PROPOSAL family, no PT-deictic case was built
around a prior proposal. The only HIDDEN_CONTEXT_DEPENDENCY risk found is
the "này as current-PT" question in §10, which is implicit, not an
explicit case design.

## 6. The three-way conflict, re-examined: it is actually two camps, not three generations

Task §9 asked to verify the suspected conflict against actual rows
rather than assume it from prior reports. Doing so **changes the
characterization**:

| Camp | Members | 
|---|---|
| **UNRESOLVED** (zero antecedent → `UNKNOWN`/clarify) | `ambiguity-pt-switch-no-proposal-1/2` (**A**, original V2), `v22-deictic-no-target-2`, `v22-pt-switch-no-antecedent-1/2/3` (**D**), `v22dev-pt-switch-no-antecedent-1/2` (**E**) |
| **RESOLVED** (zero antecedent → confident) | `reference-this-item-pt-price-1/2` (**A**, original V2), `ref-this-item-pt-revise-1/2/3`, `ref-this-item-person-ask-price-1/2`, `ref-this-item-pt-switch-corrected-1/2/3` (**B**), `ref-this-item-pt-switch-val-1/2` (**C**) |

**Both camps include rows from the ORIGINAL V2 validation file.** The
conflict did not start with V2.1 — it already existed between
`ambiguity-pt-switch-no-proposal` and `reference-this-item-pt-price`
within V2's own first design. V2.1 did not introduce a new position; it
**expanded the RESOLVED camp** (adding `ref-this-item-pt-revise-*`,
`ref-this-item-pt-switch-corrected-*`, `ref-this-item-person-ask-price-*`,
deliberately, to match `detectReferences()`'s real unconditional-match
behavior — see `qwen4b-v2-1-reference-ambiguity-remediation.md`). V2.2A
did not invent a third position either; it **expanded the UNRESOLVED
camp**, independently, apparently without cross-checking against V2.1's
remediation convention for the identical surface pattern.

### Explanations tested and ruled out (task §13 — not majority vote, not assumption)

- **Deictic word (này vs đó/kia)**: *partially informative, not
  sufficient.* Every RESOLVED-camp row using "này" has no UNRESOLVED-camp
  counterexample — but "đó"/"kia" appear on **both** camps (e.g.
  `ref-this-item-pt-switch-corrected-2/3` use "kia"/"đó" and resolve;
  `ambiguity-pt-switch-no-proposal-2`, `v22dev-pt-switch-no-antecedent-1`
  also use "kia" and don't). Rejected as a clean explanatory variable.
- **Intent class (ANSWER_QUESTION exempt from grounding, action intents
  not)**: *refuted directly.* `ref-this-item-person-ask-price-1` ("Người
  kia giá bao nhiêu?") and `v22-deictic-no-target-2` ("Người đó tính phí
  sao?") are the same question-type (price of "that person"), with
  opposite gold. An intent-class rule cannot be the hidden explanation.

**No linguistic or semantic variable in the data reliably separates the
two camps.** This supports treating it as a genuine, unresolved
authorial inconsistency — two independently-built example sets that were
never reconciled — rather than an undocumented-but-real product rule
that a smarter audit could recover.

## 7. V2.1 remediation audit (task §16, in full)

For each of the 8 "RESOLVED despite zero antecedent" rows added/validated
in V2.1 (`ref-this-item-pt-revise-1/2/3`, `ref-this-item-pt-switch-corrected-1/2/3`,
`ref-this-item-person-ask-price-1/2`, plus `ref-this-item-pt-switch-val-1/2`
in validation):

- PT antecedent visible in parser input? **No**, in every one.
- Target unique? **N/A** — there is no target to be unique among; the
  model is expected to invent a resolution with nothing to resolve
  against.
- Target explicitly named? **No.**
- Gold require hidden state? **Arguably yes for the "này" subset**
  (plausibly intending "my current PT," which needs a `persisted`-style
  fact the schema doesn't carry — see §10) but **no for the "đó/kia"
  subset** (there is no plausible "hidden state" interpretation for
  distal/anaphoric deixis with literally nothing mentioned before it —
  these rows are simply asking the model to resolve a reference that, by
  definition, points at nothing).
- Did this row accidentally teach reference hallucination? **Yes, by the
  task's own literal visible-context invariant** — these rows reward the
  model for producing a confident `THIS_ITEM` resolution with zero
  textual grounding, which is structurally the same behavior
  `qwen4b-v2-2a-ambiguity-micro-remediation.md` and V2.3A both identify
  as the `OVERCONFIDENT_AMBIGUITY` failure mode elsewhere in the project.

## 8. V2.2A dev audit (task §17)

V2.2A's dev-challenge family (`v22dev-pt-switch-no-antecedent-1/2`) is
internally consistent with its own train counterpart (D's
`v22-pt-switch-no-antecedent-1/2/3` and `v22-deictic-no-target-2`): zero
antecedent → unresolved, applied uniformly, no exceptions found. It also
agrees with original V2's own `ambiguity-pt-switch-no-proposal-*` family.
It does **not** independently invent a new rule — it is simply on the
same side of the pre-existing V2-era split as `ambiguity-pt-switch-no-proposal`.

## 9. Evaluator audit (task §14)

`reference_correct()` and `ambiguity_correct()` themselves are mechanically
consistent (pure set/boolean comparison, no PT-specific branching found
anywhere in `evaluate_semantics.py`). The inconsistency is entirely in
the gold content, not the scoring logic. **One real
`EVALUATOR_REVIEW_CANDIDATE`-class observation, noted but not assigned as
any single case's primary tag** (it's a cross-cutting representation
issue, not a per-case defect): `ambiguity-pt-switch-no-proposal-1/2`
*keep* a non-empty `references[]` entry while flagging unresolved, while
every V2.2A UNRESOLVED-camp row *clears* `references` to `[]`. Both are
scored fine in isolation, but it means a model that correctly refuses to
fabricate a reference (`references=[]`) scores `referenceCorrect=None`
(excluded, neutral) against the V2.2A convention but
`referenceCorrect=False` (counted as wrong) against the
`ambiguity-pt-switch-no-proposal` convention for the **same underlying
correct behavior**. Any gold correction (task §13 follow-up, out of
scope here) should standardize on one representation, not just one
resolution policy.

## 10. Schema audit (task §15)

Can the current schema represent:

| Case | Representable? |
|---|---|
| A. unique visible PT resolution | **Yes** — `references=[{kind:THIS_ITEM}]`, `clarificationRequired=false` |
| B. no visible antecedent | **Yes** — `references=[]`, `ambiguities=[{field:"reference",...}]`, `clarificationRequired=true` |
| C. multiple plausible antecedents | **Yes** — same shape as B |
| D. explicit PT name | **Yes** — no reference entry needed, name carried by context/intent |

All four of the task's own representational requirements are already
representable. **One genuine gap found, not required by any current
gold row but relevant to §7's "này" subset**: the schema cannot
distinguish "this" meaning "a backreference to something named earlier
in this message" from "this" meaning "my currently-assigned PT" (a real
persisted-state fact). `THIS_ITEM`'s own schema comment
(`schema.ts:59`, `"PT này"/"plan này"`) does not separate these two
senses, and `InterpretContext.persisted` has no field to ground the
second sense against even if the schema wanted to. This is flagged
`SCHEMA_REPRESENTATION_AMBIGUOUS` as a **standing observation**, not as
any audited row's primary classification, since no current gold row's
scoring actually depends on resolving this distinction (the "này" rows
in the RESOLVED camp are scored purely on `(kind, ordinal)`, which is
identical for both senses either way).

## 11. Cross-dataset consistency matrix (task §30)

See `training/semantic-qwen3-4b/outputs/v2.3a1-pt-deictic-gold-audit/cross_dataset_consistency.json`
for the full machine-readable version. Summary:

| Condition | V2 original | V2.1 remediation | V2.2A | Canonical proposal | Conflict? |
|---|---|---|---|---|---|
| Explicit PT name | n/a (no case) | n/a (no case) | RESOLVED | RESOLVED | No |
| One visible antecedent (same-message) | n/a (no case) | n/a (no case) | RESOLVED | RESOLVED | No |
| Zero visible antecedent | **SPLIT** (both positions present) | RESOLVED | UNRESOLVED | UNRESOLVED | **Yes** |
| Multiple visible antecedents | n/a (no case) | n/a (no case) | UNRESOLVED | UNRESOLVED | No |

## 12. Impact on V2.3A's guard result (task §32 — hypothetical boundaries only, no rescoring)

- **Harmful corrections**: V2.3A reported 3 harmful activations on
  original-71 and 2 on remediation-12 (5 total). **All 3** of the
  zero-antecedent-triggered ones
  (`ambiguity-pt-switch-no-proposal-1`, `ref-this-item-pt-switch-val-1`,
  `ref-this-item-pt-switch-val-2`) fall inside `GOLD_CONFLICT` rows per
  this audit. The 4th harmful activation on original-71
  (`reference-this-item-exercise-1`) and the `multi-dismiss-and-new-request-2`
  case are **exercise-domain / DISMISS-idiom cases, outside this audit's
  declared PT-only scope** — not re-examined here.
  **Within PT-deictic scope specifically: 3/3 harmful corrections (100%)
  involve `GOLD_CONFLICT`.**
- **Beneficial corrections**: both of V2.3A's dev-challenge-12 PT-related
  beneficial corrections (`v22dev-pt-switch-no-antecedent-1/2`) ALSO sit
  on a `GOLD_CONFLICT` row by this audit's classification — they only
  register as "beneficial" because the guard happens to agree with the
  side of the conflict that dev-challenge's own gold took. **2/3 of
  V2.3A's dev-challenge beneficial corrections are PT-related and
  conflict-adjacent**; the third (`v22dev-deictic-no-target-1`, a
  non-PT, bare "cái kia" case) is not PT-domain and has no identified
  conflict.

No metrics are recomputed here — this is a boundary report only, per
task §32's explicit instruction.

## 13. Impact on the 4 known V2.1 reference wins (task §33)

| Case | Domain | Classification |
|---|---|---|
| `ambiguity-pt-switch-no-proposal-1` | PT | **`REFERENCE_WIN_UNDER_CONFLICTED_GOLD`** — in-scope for this audit, sits directly in the zero-antecedent conflict |
| `reference-this-item-exercise-1` | Exercise | Out of this audit's declared scope (PT/HLV only) — structurally the same zero-antecedent pattern, in a different domain; not reclassified here |
| `revision-swap-exercise-explicit-1` | Exercise | `UNAMBIGUOUS_REFERENCE_WIN` — explicit named target, no conflict found anywhere for this pattern |
| `revision-swap-exercise-explicit-2` | Exercise | `UNAMBIGUOUS_REFERENCE_WIN` — same |

History is not rewritten: all 4 remain V2.1's reported wins exactly as
documented. This audit only adds the qualifier that one of the four
rests on contested ground.

## 14. Canonical policy proposal (task §21, NOT implemented)

**`PT_DEICTIC_POLICY_V1_PROPOSAL`**

1. **Explicit named PT** → RESOLVED, no `references[]` entry needed.
2. **Exactly one visible PT antecedent** (named elsewhere in the same
   message) → RESOLVED, `references=[{kind:THIS_ITEM}]`,
   `clarificationRequired=false`.
3. **Zero visible PT antecedents** → UNRESOLVED, `references=[]`,
   `ambiguities=[{field:"reference",...}]`, `clarificationRequired=true`.
   Chosen over the RESOLVED camp because it is the only option
   consistent with the task's own visible-context-only invariant and the
   "parser must not invent hidden PT state" architecture constraint —
   **not** because it has more existing rows (it has fewer: 8 vs 12).
4. **Multiple visible PT antecedents, no disambiguator** → UNRESOLVED,
   same representation as rule 3.
5. **Hidden candidate/proposal/persisted-state dependency** (e.g. "này"
   meaning "my current PT") → explicitly out of scope for the current
   schema; flagged `SCHEMA_REPRESENTATION_AMBIGUOUS`, not folded into
   rules 2 or 3 by assumption.

Full machine-readable version:
`training/semantic-qwen3-4b/outputs/v2.3a1-pt-deictic-gold-audit/canonical_policy_proposal.json`,
including the exact 12 rows that would need relabeling if this proposal
is adopted (the entire RESOLVED camp) and the 11 rows already consistent
with it.

Matches task §34's quality bar: deterministic, visible-context-only,
model-independent, doesn't invent antecedents, preserves the 3
already-consistent explicit/unique/multiple cases untouched, and is
compatible with the current schema for rules 1-4 (rule 5 explicitly
flags where it is not).

## 15. Verdicts

**`PT_DEICTIC_POLICY_REQUIRES_PRODUCT_DECISION`** — a canonical rule
(§14) is well-supported by the visible-context architecture and covers
every audited condition, but it directly contradicts 12 existing,
deliberately-authored gold rows (not a fringe minority — nearly 60% of
the 20 conflicted rows). Adopting it is a real product/data decision
(whose rows get relabeled), not something this audit can declare
"already settled."

**`NOT_READY_FOR_GOLD_CORRECTION`** — the canonical policy is clear and
the affected cases are fully enumerated, but no correction should be
applied until a human decision confirms rule 3 over the RESOLVED camp's
convention (the alternative — keeping confident PT-switch resolution —
is a legitimate product choice too, just one this audit does not
recommend for the reason given in rule 3's justification).

## 16. Next minimal action

Make one explicit decision: adopt `PT_DEICTIC_POLICY_V1_PROPOSAL` rule 3
(zero antecedent → unresolved) as canonical, or explicitly keep the
RESOLVED-camp convention and instead relabel the 8 UNRESOLVED-camp rows.
Either choice is a one-paragraph decision + a relabeling pass over at
most 12 rows — not a new architecture, training round, or guard change.
Once decided, re-run V2.3A's replay (`replay_grounding_guard.py`) against
the corrected gold to see the guard's TRUE correction precision on sets A
and B, which this audit's §12 boundary analysis suggests should land much
closer to the 100% already measured on set C.

## 17. Explicitly not done in this task

No gold file edited, no evaluator edited, no guard edited (all three
confirmed via empty `git diff --stat`), no training run, no new V2.3
dataset, no heldout access, no Optuna, no GGUF export, no production
change, no metrics recomputed with hypothetical corrected gold.
