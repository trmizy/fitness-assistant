# Gymini Semantic Fine-Tune — V2.3A.3 Unresolved Reference Representation Audit

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. `HELDOUT_UNOPENED`. `OPTUNA_NOT_RUN`.
`NO_GGUF_EXPORT`. `TRAINING_NOT_RUN`. `GOLD_MODIFIED=NO`. `GUARD_MODIFIED=NO`.
`EVALUATOR_MODIFIED=NO`. `PRODUCTION_CHANGED=NO` — all confirmed via `git
diff --stat` (empty on every dataset file, `reference_grounding_guard.py`,
`evaluate_semantics.py`, and `schema.ts`/`signals.ts`/`policy.ts`/
`interpreter.ts`). This task is a semantics/schema/evaluator consistency
audit only — no correction applied.

## 1. Problem statement

V2.3A.2 found that one of its 3 historical "harmful" guard corrections
(`ambiguity-pt-switch-no-proposal-1`) remains harmful under the corrected
canonical resolution-policy, for a *different* reason than the
resolution-policy conflict V2.3A.1/A.2 fixed: its gold **retains** a
non-empty `references[]` entry while marking the case unresolved, while
the frozen guard (and nearly every other row in this project's dataset
history) **clears** `references` to `[]` when unresolved. This task
determines, from first principles — schema, producer prompt, real
consumers, evaluator, architecture — what `references` is actually
supposed to mean, before anything is corrected.

## 2. A major, previously-unexamined finding: the live production prompt doesn't request `references` at all

Reading `interpreter.ts` directly (task §5/§6 — not assumed from any
prior report):

```ts
// buildPrompt(), the function interpretWithLlm() actually calls:
"primaryIntent ∈ ANSWER_QUESTION|START_WORKFLOW|...|UNKNOWN. ..."
"entities: mảng {type,value,sourceText,negated?}; ..."
"goalSignals: mảng {goal,strength,negatesGoal?,sourceText}; ..."
// LlmOutputSchema = { primaryIntent, entities, goalSignals, asksRecommendation, isCorrection }
```

The live prompt **never mentions `references`, `corrections`,
`negations`, `ambiguities`, `clarificationRequired`, `confidence`, or
`workflowIntent`**. And in `interpretWithLlm()`'s merge:

```ts
const merged: SemanticInterpretation = {
  ...det,                                    // references comes from HERE
  entities: [...det.entities, ...entities.filter(...)],
  goalSignals: det.goalSignals.length ? det.goalSignals : raw.goalSignals,
  primaryIntent: det.primaryIntent === "UNKNOWN" ? raw.primaryIntent : det.primaryIntent,
  ...
};
```

`references` is **never overwritten by the LLM's output** — it is
always exactly `interpretDeterministic()`'s `detectReferences(s)` result,
unconditionally, in every real request made today. **The training
dataset's own 13-field system prompt (matching the full
`SemanticInterpretationSchema`) has no live caller anywhere in the
codebase** — searched for its exact opening phrase
("bộ phân tích ngữ nghĩa cho một trợ lý thể hình tiếng Việt" + the
longer schema-listing continuation) and it appears only inside the
training dataset files themselves, never in any `.ts` prompt-builder.
This means: **there is currently no live "LLM produces `references`"
code path to inspect at all** — the entire fine-tune's `references`
target is, today, a forward-looking contract with no wired-in consumer
yet. (Flagging this prominently; it is a separate, larger finding from
this task's narrower representation question, not something this task
resolves — see §12.)

## 3. Schema / type definitions (task §4)

| Field | Type | Comment in `schema.ts` |
|---|---|---|
| `references` | `SemanticReferenceSchema[]` | none — no JSDoc defining "mention" vs "grounded" semantics at the type level |
| `SemanticReferenceSchema.kind` | enum `REFERENCE_KINDS` | per-kind inline comments only (e.g. `"PT này"/"plan này"` for `THIS_ITEM`) — describe surface *pattern*, not resolution semantics |
| `ambiguities` | `{field: string, reason: string}[]` | `SemanticAmbiguitySchema` — free-text `reason`, no enum |
| `clarificationRequired` | `boolean` | none |

**The type system itself is silent** on whether `references` requires a
grounded target. Neither option is type-enforced; both are
`safeParse()`-valid for any combination of `references` content and
`clarificationRequired`.

## 4. Producer semantics (task §5)

| Source | Finding |
|---|---|
| Live prompt (`interpreter.ts: buildPrompt()`) | Doesn't request `references` at all — moot for this question (§2). |
| Training dataset system prompt (not live-wired) | *"Không tự bịa số/tên; mọi giá trị phải xuất hiện trong tin nhắn hoặc **được tham chiếu rõ**. Nếu không chắc, trả clarificationRequired=true và liệt kê ambiguities."* — "được tham chiếu rõ" ("clearly referenced") frames a `references` entry as asserting a **clear** referent, not merely that a reference-shaped expression was uttered. This is the only concrete textual evidence of producer intent, and it leans toward **Option B** (grounded-only). |

Can a reference object exist without a concrete target per this wording?
Arguably not — the instruction's own phrasing ties "value present" to
either direct mention or clear reference, not to an attempted-but-failed
one. `UNKNOWN` is a valid `primaryIntent` value for this exact situation
(no claim about `references` needed); ambiguity is the dedicated,
separate channel the prompt itself names for "not sure."

## 5. Consumer semantics (task §6)

| Consumer | File:line | What it assumes |
|---|---|---|
| `policy.ts` | `:155-159` | Finds a reference by kind, **then separately checks `ctx.proposal`** before acting; returns `ASK_CLARIFICATION` with reason `"reference without a proposal"` if missing. Never assumes presence ⇒ grounded. Only consumes `ACCEPT_PROPOSAL`/`LOWER_OPTION`/`HIGHER_OPTION`/`MIDDLE_OPTION`. |
| `global/router.ts` | `:247` | `ctx.proposal && detectReferences(s).length > 0 && ...` → authoritative `REFERENCE` route, explicitly gated on grounding. |
| `global/router.ts` | `:248` | `interp.references.length > 0` is one OR'd boolean among several feeding a generic `SLOT_ANSWER` heuristic — a **mention-presence** signal, not an authority claim. |
| `evaluate.ts` (CI's own eval harness, not training's) | `:60` | `i.references.some((r) => r.kind === e.ref)` — kind-presence check only. |

**Critical caveat, found by reading `interpretDeterministic()` again
carefully**: `interp` in `router.ts:248` is `interpretDeterministic()`'s
output, and `detectReferences()` (`signals.ts`) is a **pure regex
pattern-match with zero grounding concept** — it cannot currently
distinguish "pattern matched but ungroundable" from "pattern didn't
match" at all. So `router.ts:248`'s mention-presence usage reflects how
an **already-ungrounded** signal is used today; it does not establish an
architectural preference for how a **newly grounding-aware** signal (the
fine-tuned model, or the guard) should represent an unresolved case.
Both `policy.ts` and `router.ts` would need updating regardless of which
option is adopted, once a grounding-aware signal is actually wired in —
their current code does not yet express an opinion on *this* question.
**THIS_ITEM and PREVIOUS_STATE — the guard's entire scope — have zero
consumers anywhere today.** There is no current downstream risk from
either representation choice for these two kinds, because nothing acts
on them yet.

## 6. Evaluator semantics (task §7)

`reference_correct()` compares `{(kind, ordinal)}` as a set — pure
mechanical equality, agnostic to Option A/B, rewards whatever gold
happens to say. `ambiguity_correct()` is a **separate**, independent
check of `clarificationRequired` only. The module's own docstring states
the design intent directly: *"Metrics are kept STRUCTURALLY separate...
a response can be transport-success=yes, ... semantic-correct=no, all
independently true/false."* This structural separation is exactly the
mechanism Option B needs (resolution status lives in
`clarificationRequired`/`ambiguities`, never in `references`) — **the
evaluator requires zero changes to support it**, and would have
supported Option A equally well. This is precisely why the historical
53-vs-4 representation split was never flagged as an "error" by any
prior evaluation run — the evaluator doesn't take a position either way.

## 7. Historical representation inventory (task §8-10, not limited to known cases)

Scanned every row across V2 train, V2 original validation, V2.1 train
additions, V2.1 validation remediation, V2.2 train remediation, V2.2 dev
challenge, and V2.3A.2's 3 canonical corrected views, for every case
where `clarificationRequired=true` **and** an `ambiguities` entry has
`field="reference"` (heldout excluded, never opened):

| Classification | Count |
|---|---|
| `UNRESOLVED_REFERENCES_EMPTY` | **53** |
| `UNRESOLVED_REFERENCE_RETAINED` | **4** (= 2 distinct case IDs, each counted once in its source file and once in its untouched V2.3A.2 copy) |
| **Total** | **57** |

By dataset:

| Dataset | EMPTY | RETAINED |
|---|---|---|
| V2 train | 6 | 0 |
| V2 original validation | 0 | **2** |
| V2.1 train additions | 4 | 0 |
| V2.1 validation remediation | 2 | 0 |
| V2.2 train remediation | 19 | 0 |
| V2.2 dev challenge | 8 | 0 |

**Only 2 distinct case IDs, from a single family in the single earliest
validation file, retain the reference.** Notably, even **V2's own train
split** (6 rows) uses `EMPTY` — the inconsistency isn't just
"generation vs generation," it existed *within V2's own original design*
between its train and validation files. Reported as corroborating
evidence only, per this project's standing "do not use majority vote to
determine policy" rule (task §16) — the decision below is not based on
this count.

## 8. The two known PT cases, in full (task §11)

| | `ambiguity-pt-switch-no-proposal-1` | `ambiguity-pt-switch-no-proposal-2` |
|---|---|---|
| Visible antecedent count | 0 | 0 |
| Intended unresolved status | Yes (`clarificationRequired=true`) | Yes |
| Current `references` | `[{"kind":"THIS_ITEM","sourceText":"PT đó"}]` | same |
| Current `ambiguities` | `[{"field":"reference","reason":"không có đề xuất PT nào đang hiển thị để tham chiếu 'PT đó'"}]` | same |
| Evaluator expectation | `reference_correct()` requires actual `references` to equal this exact non-empty set to score correct | same |
| Guard output | Clears `references` to `[]` (invalidates) | Same, but model's own prediction already used an invented kind (`ALTERNATIVE_ITEM`), so the guard doesn't even act on case 2 (`REFERENCE_NOT_APPLICABLE` — not a guarded kind) |
| Consistent with other unresolved cases? | **No** — the only 2 of 57 rows that retain the reference |

## 9. Non-PT harmful cases — different root causes entirely (task §12)

| Case | Root cause | Representation-contract issue? |
|---|---|---|
| `reference-this-item-exercise-1` | Gold has `clarificationRequired=false` (**confidently resolved**, not unresolved at all) despite zero visible antecedent — a **resolution-POLICY conflict**, structurally identical to the PT zero-antecedent split V2.3A.1 found, here in the exercise domain, never audited for correction since that audit was PT-scoped. | **No.** |
| `multi-dismiss-and-new-request-2` | Gold has `references=[]` already; the action (`DISMISS`-shaped) doesn't semantically depend on the reference's identity at all — an **idiom/scope gap** in the guard's invariant (flagged in V2.3A §7). | **No.** |

Neither is forced into this task's representation question, per task
§12's explicit instruction.

## 10. Schema capability (task §13)

**Can the current schema cleanly represent both "a deictic mention
exists" and "no target can be resolved"? YES** — via the EXISTING
combination `references=[{kind:...}]` + `clarificationRequired=true` +
`ambiguities=[...]` (exactly what the 2 retained-reference rows already
do, and it parses). No schema change is required for either option; the
question is purely about which combination is canonical, not about
representability.

## 11. Downstream safety analysis (task §15)

- **Risk of retaining**: a future, less-careful consumer that checks
  only `references.length > 0` (as `router.ts:248` already does for the
  *mention* use case) without also checking `clarificationRequired`
  could mistake an ungrounded `THIS_ITEM` for an actionable target.
  Currently zero live consumers do this for `THIS_ITEM`/`PREVIOUS_STATE`
  specifically (§5), but the schema itself doesn't prevent a future one
  from being written carelessly.
- **Information loss if cleared**: **none found.** Every
  `UNRESOLVED_REFERENCES_EMPTY` row's `ambiguities[].reason` already
  documents, in free text, that a reference expression was attempted but
  ungrounded. A consumer wanting "was a reference attempted" can check
  `ambiguities.some(a => a.field === "reference")` — more precise than a
  bare `references.length > 0` check would have been anyway.

## 12. Canonical representation proposal

**`REFERENCE_REPRESENTATION_V1_OPTION_B`** — only grounded references
belong in `references`; unresolved cases use `references=[]`, with the
attempt recorded entirely via `ambiguities` + `clarificationRequired`.

Full basis, counter-evidence considered, and encoding example:
`training/semantic-qwen3-4b/outputs/v2.3a3-reference-representation-audit/canonical_representation_proposal.json`.
`REFERENCE_SCHEMA_SEMANTICS_AMBIGUOUS` is **not** returned — the schema
is fully capable of representing the chosen option with zero changes.

## 13. Evaluator and guard consistency (task §21-22)

- **`EVALUATOR_REPRESENTATION_CONSISTENT`** — zero change needed (§6).
- **`GUARD_REPRESENTATION_CONSISTENT`** — the frozen guard already
  implements exactly this representation when it invalidates a
  reference.

## 14. Historical impact if adopted (task §23, not applied)

| Dataset | Rows affected |
|---|---|
| V2 train | 0 |
| V2 original validation | **2** (`ambiguity-pt-switch-no-proposal-1/2`) |
| V2.1 (train + validation) | 0 |
| V2.2 (train + dev) | 0 |
| V2.3A.2 canonical corrected views | **2** (the same 2 rows, carried through unchanged — V2.3A.2's narrower resolution-policy eligibility criteria didn't touch them) |

**2 distinct case IDs total**, appearing in 2 of the 9 scanned files.

## 15. V2.3A.2 guard-activation sensitivity (task §24 — no re-score)

Of V2.3A.2's 8 total guard activations across all 3 sets:

| Activation | Representation-sensitive? |
|---|---|
| `ambiguity-pt-switch-no-proposal-1` | **Yes — the only one.** |
| `multi-dismiss-and-new-request-2` | No (idiom/scope issue, §9) |
| `reference-this-item-exercise-1` | No (resolution-policy conflict, §9) |
| `ref-this-item-pt-switch-val-1`, `-2` | No (already corrected by V2.3A.2's resolution-policy fix; their gold now clears references regardless of this question) |
| 3 dev-challenge-12 activations | No (gold already uses the cleared convention) |

**1 of 8.** No metrics are recomputed — this is a boundary report only.

## 16. Verdicts

**`REFERENCE_REPRESENTATION_POLICY_CLEAR`** — the evidence converges
consistently (producer wording, information-redundancy analysis,
downstream-safety analysis, evaluator/guard structural fit) on Option B,
and the one apparent counter-signal (the `router.ts`/`policy.ts` mention
pattern) is explained by a confound (it reflects an already-ungrounded
signal, not a stance on this exact question) rather than genuinely
competing evidence. This is a narrower, more mechanical question than
V2.3A.1's resolution-policy conflict (which pitted two *deliberately-
authored* conventions against each other, 12 rows vs 8); here, 1 of 2
historical generations has a 2-row anomaly against an otherwise-uniform
57-row convention, with a clear textual and architectural rationale for
the uniform side.

**`READY_FOR_REFERENCE_REPRESENTATION_CORRECTION`** — if this proposal
is confirmed, the fix is a 2-row, 1-field correction (clear `references`
on the 2 `ambiguity-pt-switch-no-proposal-*` rows), using the exact same
versioned-correction methodology V2.3A.2 already established (new view,
historical files untouched, hash-verified, schema-validated). The guard
needs no change (`GUARD_REPRESENTATION_CONSISTENT`).

## 17. Next minimal action

A V2.3A.4-style task: extend
`training/semantic-qwen3-4b/datasets/canonical-policy/pt-deictic-v1/`
(or a new `reference-representation-v1/` sibling view) to clear
`references` on the 2 `ambiguity-pt-switch-no-proposal-1/2` rows,
re-score Set A under this additional correction, and report whether
`ambiguity-pt-switch-no-proposal-1`'s guard activation finally
reclassifies from harmful to beneficial (expected, but to be measured,
not assumed, per this project's own standing discipline). This alone
would not fix the 2 remaining non-PT harmful cases (§9) — those need
their own, separate, already-scoped follow-ups (an exercise-domain
resolution-policy audit mirroring V2.3A.1, and a narrow DISMISS-idiom
guard scope extension).

## 18. Explicitly not done in this task

No gold row edited (including the 2 named PT rows), no guard edited, no
evaluator edited, no metrics recomputed, no training run, no new
dataset, no heldout access, no Optuna, no GGUF export, no production
change, no choice made based on which option scores higher.
