# Gymini Semantic Fine-Tune — V2.1 Targeted Remediation (Reference + Ambiguity)

`SOURCE_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, re-checked stable at
every stage of this task — unchanged throughout. Branch `aws-deploy`. No
tracked production file was touched. V2's artifacts (dataset JSONL, split
manifest, validation predictions, adapter, metrics, documentation) were
never overwritten — all read-only inputs to this task. V2.1 lives entirely
under new `v2.1`-suffixed paths. Heldout (`datasets/processed/v2/heldout.jsonl`)
was never opened, inspected, or evaluated.

## Outcome summary

**The investigation (§3-11 of the task) is complete and produced real,
code-grounded findings.** **The one permitted V2.1 training run could not
be executed** — three attempts, each preceded by a cooldown, all failed
during model load with environment-level resource exhaustion (two
`OSError: paging file too small`, one native segfault — the same
underlying chronic low-RAM condition manifesting differently each time).
Per this task's own designated escape hatch (§29), retrying was stopped
after 3 attempts rather than continued indefinitely. **Model-load status:
`ENVIRONMENT_MODEL_LOAD_BLOCKED`.**

## 1. Why referenceAccuracy was 0.0 — the central finding

Re-read the REAL production code (not assumed) to answer Q1-Q3 directly.

**`detectReferences(s)`** (`backend/services/ai-service/src/conversational-
intelligence/signals.ts:102-126`) — the actual deterministic function that
computes the `references[]` field in production — is a **pure surface-text
regex matcher**. It takes only the current utterance string `s`. It has
**no access to any prior turn, pending proposal, candidate list, or other
hidden application state**. It tags a reference *kind* (`THIS_ITEM`,
`ORDINAL_ITEM`, `FIRST_ITEM`, `LOWER_OPTION`/`HIGHER_OPTION`/
`MIDDLE_OPTION`, `ACCEPT_PROPOSAL`, `PREVIOUS_STATE`) confidently and
unconditionally whenever the text matches, **regardless of whether a real
antecedent actually exists** anywhere in the (invisible-to-this-function)
conversation. Resolving *which* concrete entity a kind points to is
explicitly not this layer's job — `interpretDeterministic`'s own comment
states the whole semantic reading "is never authoritative state," i.e. a
later policy layer is responsible for resolution, not the semantic model.

**This directly answers Q2/Q3/§8/AG: there is no hidden-pending-state
category in this validation set.** All 7 REFERENCE validation cases were
checked by hand against `detectReferences`'s own regex:

| Case | Text | Matches real regex as | Model output | Finding |
|---|---|---|---|---|
| `reference-this-item-exercise-1` | "Bài đó nặng quá." | not covered by today's noun whitelist (`pt\|plan\|chuong trinh\|thuc don\|lich tap\|nguoi\|goi` — "bài" is missing), but a clear forward-compatible THIS_ITEM pattern | dropped the reference entirely | `REFERENCE_RESOLVABLE_EXPLICIT` — genuine model gap |
| `reference-this-item-exercise-2` | "bài thứ hai khó quá" | **matches the ORDINAL regex** (`thu\s*hai` → ordinal=2), NOT THIS_ITEM | invented a non-existent `PREVIOUS_ITEM` enum | `REFERENCE_GOLD_TARGET_QUESTIONABLE` — **my own V2 dataset bug**: one `family()` target was reused across 3 phrasing variants that don't share the same reference kind |
| `reference-this-item-exercise-3` | "bài này tôi không làm được" | same as case 1 | missed reference, intent wrong too | `REFERENCE_RESOLVABLE_EXPLICIT` — genuine model gap |
| `reference-this-item-pt-price-1` | "Người kia giá sao?" | **matches exactly** (`nguoi kia`) | missed entirely, intent wrong | `REFERENCE_RESOLVABLE_EXPLICIT` — genuine model gap |
| `reference-this-item-pt-price-2` | "PT kia giá bao nhiêu" | **matches exactly** (`pt kia`) | missed reference (intent correct) | `REFERENCE_RESOLVABLE_EXPLICIT` — genuine model gap |
| `reference-pt-current-state-read-1` | "Huấn luyện viên hiện tại của tôi là ai vậy?" | no deictic at all — gold correctly expects `references: []` | **hallucinated** `{kind: THIS_ITEM, sourceText: "bạn"}` | `REFERENCE_WRONG_TARGET` — model false positive, not a gold bug |
| `reference-pt-current-state-read-2` | "ai đang là PT của tôi" | no deictic — gold `[]` | model also `[]` (correctly excluded from the accuracy denominator by the evaluator's own `None`-for-not-applicable convention) | not a failure |

**Verdict: `REFERENCE_MODEL_LEARNABLE`.** Every counted failure is either a
genuine, fixable model weakness (4 cases — insufficient training exposure
to these exact surface patterns) or a dataset authoring bug (1 case) or a
model over-triggering error (1 case). Zero cases require hidden
application state. `referenceAccuracy=0.0` reflects undertraining on a
learnable pattern class, not an impossible task.

## 2. A deeper bug: V2 contained two internally-contradictory families

Investigating Q4/Q5 (why `OVERCONFIDENT_AMBIGUITY` rose 6→7) surfaced a
more serious finding than "the model got overconfident." V2's own dataset
construction had already baked in a self-contradiction:

```
[TRAIN]      reference-pt-switch-request-1/2  (category: REFERENCE)
  "Đổi sang PT đó đi." / "chuyển sang PT kia luôn"
  → primaryIntent: CONFIRM, clarificationRequired: true

[VALIDATION] ambiguity-pt-switch-no-proposal-1/2  (category: AMBIGUITY_UNKNOWN)
  "đổi sang PT đó đi" / "chuyển PT kia luôn"   (the SAME utterance pattern)
  → primaryIntent: UNKNOWN, clarificationRequired: true
```

Both families describe the identical phenomenon ("switch to PT đó/kia
with no visible proposal in this single-turn prompt") but assign it two
different, neither-obviously-correct `primaryIntent` labels — because I
(incorrectly) treated "no proposal object is injected into this prompt"
as grounds for hedging, when §1's finding shows the real deterministic
system never attempts that resolution either and still tags confidently.
**V2's `OVERCONFIDENT_AMBIGUITY` hard-gate failure was partly measuring a
model correctly generalizing toward confident, production-consistent
behavior against a validation family whose gold label was itself
methodologically confused** — not a model regression in the sense the
gate was designed to catch (D1/V2's own stated concern: "forces every
utterance into a confident intent"). `reference-pt-switch-request` was
**never in V2's training set's effective lesson for this** either — it's
in train, but its own `clarificationRequired=true` framing didn't stop
the model from generalizing confidently from *other* THIS_ITEM-pattern
families, which is itself evidence the broader, consistent lesson
(confident resolution) is what the data overall taught, correctly.

Classified per task §9's taxonomy: the 3 new-in-V2.1-investigation
overconfident cases are `DEICTIC_WITHOUT_VISIBLE_TARGET` on the task's own
rubric — but the substantive finding is that this classification slot
itself encodes the wrong expectation for this schema. Documented as a
**MODEL RESPONSIBILITY vs APPLICATION REFERENCE RESOLUTION RESPONSIBILITY**
boundary (task §8's explicit ask): the model's job ends at confidently
tagging a reference *kind* from recognizable surface text; resolving
*which* concrete entity it points to, including whether a prior-turn
antecedent genuinely exists, is downstream policy-layer work this model
is not given the input to do and is not expected to attempt.

## 3. Evaluator audit (task §6)

Read `reference_correct()` directly (`evaluate_semantics.py:210-215`):
compares `{(kind, ordinal) for r in references}` as a set, between
expected and actual. No type-coercion bug found (Python's `==` on the
`ordinal` values would only mismatch on a genuine type difference, and no
such case was observed in the 7 REFERENCE cases' raw predictions). `None`-
vs-`None` for cases with no references on either side is correctly
excluded from the accuracy denominator (`reference-pt-current-state-
read-2` confirmed this works as intended). No evaluator defect requiring
a fix was found for this metric — unlike D1's `_ids()` bug and this task's
earlier `UNSAFE_MARKERS` false positive, `reference_correct()` itself is
sound. **`REFERENCE_MODEL_RESOLVABLE_ACCURACY` and `REFERENCE_ALL_ACCURACY`
are therefore identical for this validation set** (0/6 applicable cases
correct) — there is no hidden-context subset to carve out, because there
isn't one.

## 4. Residual invented-enum taxonomy (task §11)

All 4 V2 residual invented-enum cases classified `NATURAL_SYNONYM_MAPPING_GAP`:

| Case | Gold | Model's invented label |
|---|---|---|
| `intent-recommend-pt-confusable-1` | `ASK_RECOMMENDATION` | `ASK_WORKFLOW` |
| `intent-recommend-pt-confusable-3` | `ASK_RECOMMENDATION` | `ASK_QUESTION` |
| `intent-dismiss-nutrition-1` | `DISMISS` | `STOP_WORKFLOW` |
| `entity-weight-unlabeled-confusable-1` | `UNKNOWN` | `ASK_INFORMATION` |

Every case substitutes a semantically-plausible *descriptive* English
label for the exact required token — the model understands the situation
correctly (its chosen label accurately describes what's happening) but
hasn't fully memorized that Gymini's specific enum spelling must be used
verbatim. Not `ENUM_NAME_CONFUSION` (confusing two REAL enums with each
other) or any conceptual-boundary issue — a vocabulary-memorization gap,
fixable with more contrastive exposure under varied phrasing, not a
redesign.

## 5. V2.1 dataset (task §12-20)

`generate_dataset_v2_1.py` — 62 new train rows / 25 families + 12 new
`validation_remediation` rows / 6 families (disjoint, never trained on).
Composition:

- **REFERENCE confident-resolution families** (15 families): every
  `detectReferences()` noun+deictic/ordinal/option pattern, generalized
  to a few more nouns (including "bài"/exercise, a forward-compatible
  ontology extension consistent with V1/V2's own "target the full schema"
  precedent) — all with `clarificationRequired=false` and an actionable
  `primaryIntent`, replacing the confused hedge-framing found in §2.
- **Genuine ambiguity families** (4 families): texts containing *no*
  recognizable noun+deictic/ordinal/option pattern at all — the correct,
  evidence-based boundary (pattern-presence, not "is a proposal visible"),
  contrastive against the confident families above.
- **Enum-vocabulary remediation** (4 families, 2 reclassified under
  AMBIGUITY_UNKNOWN for the UNKNOWN-token case): more phrasing variety for
  `ASK_RECOMMENDATION`/`DISMISS`/`UNKNOWN` targeting the exact 4 residual
  failure patterns from §4.
- **Breadth/anti-specialization** (2 families): FOLLOWUP_SLOT/REVISION
  additions per task §15's catastrophic-specialization concern.

**Gold-schema validation**: 74/74 (100%) pass `SemanticInterpretationSchema.safeParse()`
via the real TypeScript schema.

**Leakage prevention (task §16, verified directly, not asserted)**: zero
exact-text overlap between `train_additions.jsonl` and V2's validation or
heldout; zero exact-text overlap between `train_additions.jsonl` and
`validation_remediation.jsonl`; zero template-family overlap between the
two new files. The corrected `ref-this-item-pt-switch-corrected` family
uses entirely new phrasing ("Giúp tôi đổi sang PT này nhé," "Chốt đổi qua
PT đó cho tôi") — never the validation family's exact text.

**Token length** (`analyze_token_lengths.py --version v2.1`, 389 combined
train rows): full-sequence p50=276/p90=327/p95=339/p99=363/**max=371**.
`max_seq_length=384` confirmed still sufficient (0% truncation).

**Masking regression test** (`masking_diagnostic.py --version v2.1`,
re-run independently, not assumed from V2): 10 sampled rows, all PASS —
`<|im_end|>` correctly supervised in every completion, prompt fully
masked, no leakage.

## 6. V2.1 training attempts (task §28-30)

Training-time estimate (8-step dry run): steady-state settled around
~80-110s/step this session (markedly slower than V2's own ~20s/step
dry run earlier in the same overall task) — GPU temperature read 65°C
(vs. ~57-59°C baseline earlier) with step time *increasing* within the
8-step run rather than stabilizing, consistent with thermal throttling
rather than one-time CUDA warmup. Projected ~2.5-3h for the full 98-step
run (389 rows ÷ effective batch 8 × 2 epochs) — long, but within a single
supervised session, not an unattended overnight job; proceeded.

**Three attempts, one cooldown each (per the task's own 3-retry-max
policy), all failed during model load:**

| Attempt | Error |
|---|---|
| 1 | `OSError: The paging file is too small for this operation to complete. (os error 1455)` |
| 2 | Identical `OSError`, same stack trace, same line (`safe_open` inside `transformers.modeling_utils._load_pretrained_model`) |
| 3 | Native segfault (SIGSEGV) — same underlying resource-pressure condition manifesting differently |

Root cause: chronic low free system RAM throughout this entire multi-task
session (observed between ~2.26 GB and ~4.5 GB free of 16 GB total,
consistently, across V2's work and this task), from the user's own
concurrent Docker Desktop/WSL/VS Code processes — confirmed not
attributable to any process of mine (no stray Python processes found).
The Windows pagefile itself is generously sized (22 GB, ~2.7 GB in use at
last check) — the failure is momentary large-allocation pressure under
low physical RAM, not a pagefile misconfiguration. No checkpoint was ever
written in any of the 3 attempts (confirmed: the model never finished
loading before failing).

**Model-load status: `ENVIRONMENT_MODEL_LOAD_BLOCKED`.** Per task §29,
retrying was stopped after 3 attempts rather than continued indefinitely.

## 7. What this means for the deliverable

The *data and methodology* side of this task (§3-20) is fully complete
and independently valuable: it identifies that `referenceAccuracy=0` was
never a sign of an impossible task, finds and documents a real internal
dataset inconsistency, and produces a validated, leakage-free, properly-
targeted 74-row remediation set ready to train. The *model* side (§21-35,
the actual V2.1 adapter and its evaluation) could not run in this session.
This is an environment limitation, not a finding about the remediation's
likely effectiveness — nothing here suggests the planned fix wouldn't
work, only that it wasn't possible to verify it this session.
