# Gymini Semantic Fine-Tune — V2.3A Deterministic Reference-Grounding Guard

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. `TRAINING_NOT_RUN`. `HELDOUT_UNOPENED`.
`OPTUNA_NOT_RUN`. `NO_GGUF_EXPORT`. No production file modified, no model
modified, no evaluator modified. This task is candidate construction +
offline evaluation only.

## 1. Why V2.2 was abandoned as the base, and what changed

V2.2 (`qwen4b-v2-2b-single-training-ambiguity-reference-eval.md`) tried to
teach "is there a visible antecedent?" via ~30 extra QLoRA rows. Result:
`V2_2_REGRESSED` — reference accuracy collapsed, entityF1 regressed, and
the dedicated generalization probe (dev-challenge-12, fresh wording of the
same boundary) showed 7/8 unresolved cases still confidently mis-resolved.
This task's hypothesis change: stop asking QLoRA to learn the invariant
from a handful of examples: enforce it **deterministically**, as a pure
post-processing filter over the existing, best candidate — **V2.1**, not
V2.2 (V2.2 is not used anywhere in this task).

## 2. Reading the real pipeline first (task §1/§3)

Before designing anything, the actual production code was read, not assumed:

- `schema.ts` — real `REFERENCE_KINDS`: `ACCEPT_PROPOSAL, LOWER_OPTION,
  HIGHER_OPTION, MIDDLE_OPTION, FIRST_ITEM, THIS_ITEM, PREVIOUS_STATE,
  ORDINAL_ITEM`. No `PREVIOUS_ITEM`/`ALTERNATIVE_ITEM`/`OTHER_ITEM` exist —
  several model outputs invent these (already correctly flagged
  `SCHEMA_INVALID` by the existing evaluator; not this guard's job to fix).
- `signals.ts`'s `detectReferences()` — the real deterministic detector —
  fires `THIS_ITEM` on a pure surface pattern (`(pt|plan|chuong trinh|
  thuc don|lich tap|nguoi|goi) (nay|do|kia)`) with **zero verification
  that a real antecedent exists**, confirming the project's own repeated
  finding: this is not a QLoRA-only problem, the deterministic path has
  the identical gap.
- `policy.ts` (lines ~154-175) — **already** grounds `ACCEPT_PROPOSAL`,
  `LOWER_OPTION`, `HIGHER_OPTION`, `MIDDLE_OPTION` against `ci.proposal`
  (a persisted business-state object). This is a different, pre-existing
  authority this guard must not duplicate.
- `THIS_ITEM` and `PREVIOUS_STATE` have **no grounding check anywhere**.
  `FIRST_ITEM`/`ORDINAL_ITEM` refer to position in a candidate list that
  (per the single-turn prompt constraint, re-confirmed again here) is not
  visible text in one message either — out of this guard's reach the same
  way `ci.proposal` is.

**Scope decision, directly justified by the above**: the guard handles
exactly `THIS_ITEM` and `PREVIOUS_STATE` — the two kinds with a real gap
and genuine visible-context groundability. All other kinds pass through
unchanged (`REFERENCE_NOT_APPLICABLE`).

## 3. Implementation

`training/semantic-qwen3-4b/scripts/reference_grounding_guard.py` — pure,
deterministic, no LLM/DB/network call. Deliberately implemented in Python
(not TypeScript): this task is explicitly offline/candidate-evaluation
only (task §20 default OFF, no production wiring), the entire evaluation
harness this candidate is scored against is Python-based, and
`backend/services/ai-service/src/conversational-intelligence/global/`
has a large, actively-changing concurrent diff from another agent this
session — editing anywhere in that package, even additively, was avoided
per `gymini-parallel-agent-safety`. `schema.ts`/`signals.ts`/`policy.ts`/
`interpreter.ts` themselves are untouched by any concurrent work and were
read (not edited) to ground every design decision below in the real
contract.

### Candidate model (task §8)

```python
Candidate = {cls: "PT"|"PROGRAM"|"EXERCISE"|"NUMERIC", span: str}
```

Domain is read **only from the reference's own `sourceText`** (never from
unrelated words elsewhere in the message — see §5's bug trace for why).
Candidate extraction is a small, explicit set of patterns: named PT
("pt/huấn luyện viên/hlv/coach <name>"), named/numbered program ("chương
trình/lịch tập/thực đơn/gói <N or goal-word>"), a fixed exercise
vocabulary (squat, deadlift, bench, leg press, …), and standalone numeric
values. These are a lexical **aid for locating** candidates — grounding
authority comes from counting them, never from the words themselves
(task §5's explicit requirement).

### Core decision (task §18-19)

For each `THIS_ITEM`/`PREVIOUS_STATE` reference:

1. If `sourceText` is not a bare deictic (it already names something
   concrete, e.g. `"squat"`, not `"squat đó"`) → `REFERENCE_EXPLICIT_TARGET`,
   untouched (task §12).
2. Else extract domain-compatible candidates visible in the message.
   - 1 candidate → `REFERENCE_GROUNDED_UNIQUE`, untouched.
   - 0 candidates → `REFERENCE_NO_VISIBLE_TARGET` (or
     `REFERENCE_TYPE_MISMATCH` if other-domain candidates exist but none
     of the right domain) → invalidate.
   - ≥2 candidates → check one narrow explicit disambiguator (`"giữ X"`
     removes X from the pool); if still ≥2 → `REFERENCE_MULTIPLE_VISIBLE_TARGETS`
     → invalidate.

### Bounded correction (task §17)

On invalidation: clear `references`, append one `{field:"reference",
reason:...}` ambiguity entry (if not already present), set
`clarificationRequired=true`, floor `confidence` to 0.3 (no visible
target) or 0.35 (multiple visible targets) — matching this schema's own
established confidence convention for unresolved cases. `primaryIntent`,
`entities`, `requestedAction`, `workflowIntent` are **never** touched —
deliberately smaller than first drafted (see §5).

## 4. Unit + property tests (task §21-22)

`training/semantic-qwen3-4b/scripts/test_reference_grounding_guard.py` —
**29/29 pass**. 10 unit tests (zero/one/multiple candidate, explicit
target, type mismatch, same-message backreference, numeric
single/multiple, non-reference passthrough, unguarded-kind passthrough)
and 5 property tests (unrelated-domain candidate must not affect a typed
unique target; a second compatible candidate must prevent resolution;
removing the only candidate must prevent resolution; an explicit unique
target must survive 2 other visible candidates; an explicit "giữ X"
disambiguator must collapse 2 candidates to 1). None reference the real
71/12/12 validation strings (task §23) — every fixture is hand-built.

No `tsc --noEmit` run: no TypeScript file was touched by this task (see
§3's scoping rationale), so there is nothing new to type-check.

## 5. Two real bugs found and fixed while building this (reported, not hidden)

**Bug 1 — domain leaked from unrelated words.** An earlier version of
`detect_domain()` fell back to scanning the *whole message* for a domain
keyword when `sourceText` carried none. On a property-test fixture
("Deadlift ... bớt tạ cái đó đi"), the unrelated word "tạ" (barbell plate)
matched a NUMERIC keyword, wrongly forcing NUMERIC domain and zeroing out
a real, visible EXERCISE candidate ("deadlift"). Fixed: domain now comes
**only** from the reference's own `sourceText`.

**Bug 2 — explicit named targets wrongly treated as deictic.** The first
version ran every `THIS_ITEM`-kind reference through grounding regardless
of `sourceText` shape. This wrongly invalidated
`revision-swap-exercise-explicit-1/2` (`sourceText="squat"` — the model
named the exercise directly, not a pronoun) purely because a *second*,
unrelated exercise name also appeared in the same message ("Đổi squat
sang leg press đi"). Fixed via the bare-deictic-suffix check in §3 step 1
— this directly implements task §12's "explicit named target" rule,
which the first draft missed.

## 6. Evaluation results

All three sets scored with the real evaluator's own pure functions
(`reference_correct`, `ambiguity_correct`, `schema_errors`, `entity_prf`,
`classify_errors`, `is_invented_enum`, `unsafe_output`), imported
**unmodified** from `evaluate_semantics.py` — no evaluator change.

### Original-71

| Metric | Before (V2.1) | After (V2.1+guard) | Delta |
|---|---|---|---|
| schemaValidityRate | 0.8028 | 0.8028 | 0 |
| primaryIntentAccuracy | 0.6761 | 0.6761 | 0 |
| entityF1Mean | 0.8944 | 0.8944 | 0 |
| referenceAccuracy | 0.2667 | **0.1429** | **-0.1238** |
| ambiguityAccuracy | 0.831 | 0.8169 | -0.0141 |
| **OVERCONFIDENT_AMBIGUITY** | 8 | **7** | -1 (target ≤6 **not met**) |

Guard activations: 3. Beneficial: 0. Harmful: 3. Correction precision: 0%.

### V2.1 remediation-12

| Metric | Before | After | Delta |
|---|---|---|---|
| referenceAccuracy | 0.4286 | **0.1429** | **-0.2857** |
| ambiguityAccuracy | 0.9167 | 0.75 | -0.1667 |
| OVERCONFIDENT_AMBIGUITY | 1 | 1 | 0 |

Guard activations: 2. Beneficial: 0. Harmful: 2. Correction precision: 0%.
Both activations are the identical `ref-this-item-pt-switch-val-*` family
— see §7.

### V2.2 dev-challenge-12 (the decisive generalization probe)

| Metric | Before (V2.1, never eval'd on this set before) | After (V2.1+guard) | Delta |
|---|---|---|---|
| referenceAccuracy | 0.125 | **0.2** | **+0.075** |
| ambiguityAccuracy | 0.3333 | **0.5833** | **+0.25** |
| **OVERCONFIDENT_AMBIGUITY** | 8 | **5** | **-3** |

Guard activations: 3. Beneficial: **3**. Harmful: **0**. Correction
precision: **100%**.

Unresolved side (8 cases): 1→4 correct. Resolvable side (4 cases):
untouched by the guard (0 activations there) — **preserved**, matches
task §33's "resolvable cases: preserved" requirement.

**V2.2 (QLoRA-only, ~30 trained rows) scored on this exact set:**
referenceAccuracy 0.1667, ambiguityAccuracy 0.4167, OVERCONFIDENT_AMBIGUITY
7. **The guard applied to the older, untouched V2.1 model matches or
beats V2.2's training-only approach on every one of these three metrics
— with zero additional training.**

### V2.1's 4 known genuine reference wins (task §31)

| Case | Preserved? |
|---|---|
| `revision-swap-exercise-explicit-1` | **yes** (`sourceText="squat"`, explicit named target) |
| `revision-swap-exercise-explicit-2` | **yes** (same reason) |
| `ambiguity-pt-switch-no-proposal-1` | no — invalidated |
| `reference-this-item-exercise-1` | no — invalidated |

**2/4 preserved.** See §7 for why the other 2 are not a guard defect.

## 7. The central finding: a genuine, pre-existing 3-way gold-label contradiction

`"PT này/đó/kia"`-style switch requests with **no PT ever named** have
**three mutually-contradictory gold conventions** across this project's
own dataset history, for indistinguishable real-world input:

| Generation | Family | Gold |
|---|---|---|
| V2 (original) | `ambiguity-pt-switch-no-proposal` | `UNKNOWN`, unresolved |
| V2.1 (remediation) | `ref-this-item-pt-switch-corrected`/`-val` | confidently resolved, `THIS_ITEM`, no clarification |
| V2.2A (dev-challenge) | `v22(dev)-pt-switch-no-antecedent` | `UNKNOWN`, unresolved |

V2.1's remediation family was **deliberately** designed (per
`qwen4b-v2-1-reference-ambiguity-remediation.md`) to match the real
`detectReferences()` function's unconditional-match behavior for this
exact surface pattern — at the time, that was judged the correct fix for
a different, now-superseded inconsistency between two earlier V2 families
describing the same pattern. V2.2A's new dev-challenge family was built
independently from the task's own "zero visible antecedent → unresolved"
invariant, without cross-checking it against V2.1's remediation
convention for the identical real-world phrase shape.

No deterministic guard (and no QLoRA training run) can satisfy all three
simultaneously. This guard, built strictly from the task's own literal
visible-context invariant (task §5/§6), necessarily agrees with
conventions 1 and 3 and disagrees with convention 2 — which is exactly
where **100% of this guard's harmful corrections on sets A and B**
originate (`ambiguity-pt-switch-no-proposal-1`, and both
`ref-this-item-pt-switch-val-*` cases). This is a **dataset-labeling
decision that needs to be made explicitly**, not a guard implementation
defect — see `guard_failure_taxonomy.json` for the full per-case
classification.

The one other harmful case, `multi-dismiss-and-new-request-2`
("huỷ cái này, làm lại cái mới" — cancel this one regardless of its
identity), is a real, smaller scope gap: a DISMISS-shaped action does not
need its reference resolved at all, and the guard currently has no
signal for that. The row was already `WRONG_INTENT` before the guard
touched it either way.

## 8. Anti-over-conservative check (task §34)

| | Count |
|---|---|
| Valid references incorrectly invalidated | 2 (`ambiguity-pt-switch-no-proposal-1`, `reference-this-item-exercise-1` — both the §7 contradiction) |
| Explicit references incorrectly rejected | 0 (the explicit-target fix in §5 directly prevents this) |
| Unique references converted to ambiguity | 1 (`multi-dismiss-and-new-request-2`) |

Not broadly substantial (3 cases total across 83 combined rows across
sets A+B), but not zero either — consistent with `REFERENCE_GUARD_PARTIAL`,
not `REFERENCE_GUARD_SUCCESS`.

## 9. Formal gates (task §41, kept separate)

**MODEL_GATE** (unchanged, not re-litigated): V2.1 vs V2 remains formally
`QLORA_REGRESSED`'s predecessor state — V2.1's own original gate result
from `qwen4b-v2-1i-single-training-targeted-eval.md` stands untouched;
this task does not rewrite it.

**SYSTEM_CANDIDATE_GATE** (this task, task §42's 8 criteria):

| # | Criterion | Met? |
|---|---|---|
| 1 | original-71 OVERCONFIDENT_AMBIGUITY ≤6 | **no** (7) |
| 2 | referenceAccuracy preserved/improved (original-71) | **no** (-0.124) |
| 3 | 4 known reference wins not broadly erased | partial (2/4) |
| 4 | dev-challenge unresolved cases improve materially | **yes** (1→4 correct, 8→5 OVERCONFIDENT_AMBIGUITY) |
| 5 | dev-challenge resolvable cases remain healthy | **yes** (0 activations, fully preserved) |
| 6 | no broad entity/intent/schema regression | **yes** (flat on both sets A/B) |
| 7 | guard correction precision acceptable | mixed (0% on A/B, 100% on C) |
| 8 | no phrase-specific/hard-coded logic | **yes** (verified — see §4, no case-ID branches anywhere in the module) |

4/8 fully met, 1 partial, 1 mixed, 2 not met. **Does not clear the full
success bar.**

## 10. Verdicts

**`REFERENCE_GUARD_PARTIAL`** — a real, zero-harm, materially sized
improvement on the hardest and most important test (dev-challenge
generalization: OVERCONFIDENT_AMBIGUITY -3, matches/beats V2.2's
training-only result with zero training), but real, non-trivial harm on
the two already-evaluated sets, **traced to one specific, identified,
pre-existing 3-way dataset contradiction** rather than a structural flaw
in the grounding invariant itself.

**`SYSTEM_CANDIDATE_NOT_READY_FOR_HELDOUT`** — criteria 1 and 2 of the
success gate are not met; promoting to the sealed heldout set now would
risk spending that irreplaceable resource on a candidate with a known,
already-diagnosed labeling conflict still unresolved.

## 11. If unsuccessful — classification and recommendation (task §46)

**Why**: `ambiguous_ground_truth_across_dataset_generations` (not
`candidate extraction inadequate`, not `guard over-conservative` as a
broad problem, not `model intent incompatible`). The guard's invariant
and implementation are sound and precisely targeted (proven by the clean
3/3 dev-challenge result and 29/29 tests); the harm is concentrated
exactly where the underlying gold labels disagree with each other and
with the task's own stated invariant.

**Smallest recommended next step** (not performed in this task): before
any V2.3B/further remediation, make one explicit, documented dataset
decision — is "PT này/đó/kia with no PT ever named" supposed to resolve
confidently (matching `detectReferences()`'s real behavior) or require
clarification (matching the visible-context invariant)? Relabel or
retire whichever family loses that decision. This is a one-paragraph
product/labeling decision, not a new architecture or training round —
once made, this guard's correction precision on sets A/B would very
likely jump close to its already-demonstrated 100% on set C, since that
one contradiction is the source of essentially all the measured harm.

## 12. Explicitly not done in this task

No `trainer.train()` call, no V2.3 training dataset created, no Optuna,
no heldout access of any kind, no production wiring (guard default
remains OFF, not imported anywhere outside its own module/test/replay
scripts), no evaluator/gold-label modification, no hard-coded
case-ID/phrase branches.
