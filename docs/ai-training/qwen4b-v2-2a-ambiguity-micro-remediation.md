# Gymini Semantic Fine-Tune — V2.2A Ambiguity Micro-Remediation Dataset

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file, dataset, or
V2/V2.1 historical artifact was modified — V2.2 lives entirely under new
`v2.2`-suffixed paths. Heldout (`datasets/processed/v2/heldout.jsonl`) was
never opened, read, parsed, or derived from. **No training occurred in
this task** (`TRAINING_NOT_RUN`) — dataset design and freeze only.

## 1. Why V2.2 is narrow (not a redesign)

V2.1I (`qwen4b-v2-1i-single-training-targeted-eval.md`) found V2.1 to be
a genuine, mostly-positive result: referenceAccuracy 0→0.267/0.429
(verified non-artifact), invented enums 4→0, entityF1 +0.11, no
degeneration, no broad category collapse. **Exactly one regression**
blocks the frozen gate: `OVERCONFIDENT_AMBIGUITY` 7→8 (original
validation) and independently 0→1 (remediation validation) — the model
sometimes resolves a deictic reference when the visible text gives it
nothing to resolve against. V2.2 targets only this one boundary.

## 2. The target boundary, precisely

V2.1's own remediation (correctly) taught the model that `PT này/đó/kia`-
style patterns should usually resolve confidently to `THIS_ITEM` —
matching how the real deterministic `detectReferences()` function
behaves (pure surface-pattern matching, confirmed in V2.1G). The
regression is the predictable overshoot of that lesson: the model
sometimes applies the "resolve confidently" instinct even to messages
that contain **no antecedent anywhere in the visible text at all**. V2.2
must teach the narrower distinction V2.1 skipped: *does this specific
message give the model anything to point the reference at?*

**Critical architecture constraint** (confirmed throughout this whole
project by reading `interpreter.ts`'s real `buildPrompt()`): the
production prompt is single-turn — system instruction + optional
`expectedSlot` + the current user message only. There is no conversation
history, no hidden proposal object. So "a visible unique target" can
only be represented two ways within one message: the user names the item
directly, or the user names an antecedent **earlier in the same
message** and refers back to it. Both are fully visible to the model;
neither requires external state. Every "resolvable" family below uses
one of these two patterns — never "assume a proposal exists," which was
V2.1's own diagnosed design error and is not repeated here.

## 3. Semantic families (task §7's A-H taxonomy, realized)

| Family | Boundary | Polarity | Split | n |
|---|---|---|---|---|
| `v22-deictic-no-target` | bare deictic, zero antecedent anywhere in the message | negative | train | 4 |
| `v22-multiple-visible-targets` | two real candidates named in the same message, singular deictic picks neither | negative | train | 3 |
| `v22-pt-switch-no-antecedent` | PT-switch request, zero PT ever named | negative | train | 3 |
| `v22-exercise-ref-no-antecedent` | exercise-swap request, zero exercise ever named | negative | train | 3 |
| `v22-numeric-ref-no-antecedent` | numeric adjustment referring to an unlabeled level/number | negative | train | 3 |
| `v22-correction-ambiguous-target` | correction-shaped text, no identifiable field/entity target | negative | train | 3 |
| `v22-backreference-same-message` | antecedent named earlier in the SAME message, deictic refers back to it | **positive** | train | 5 |
| `v22-explicit-named-target` | item named directly, no deixis at all | **positive** | train | 5 |
| `v22dev-deictic-no-target` | dev twin of family 1, fresh wording | negative | dev | 2 |
| `v22dev-pt-switch-no-antecedent` | dev twin of family 3, fresh wording | negative | dev | 2 |
| `v22dev-multiple-visible-targets` | dev twin of family 2, fresh wording | negative | dev | 2 |
| `v22dev-backreference-same-message` | dev twin of family 7, fresh wording | positive | dev | 2 |
| `v22dev-explicit-named-target` | dev twin of family 8, fresh wording | positive | dev | 2 |
| `v22dev-numeric-ref-no-antecedent` | dev twin of family 5, fresh wording | negative | dev | 2 |

Families 7-8 (positive) exist specifically to prevent the obvious failure
mode of over-correcting: training only on "say UNKNOWN when unsure"
would re-break the reference gains V2.1 just earned. Every dev family is
a **fresh-wording twin** of a train family (same boundary concept,
never the same sentences) — this tests whether the boundary generalizes,
not whether the model memorized specific phrasings.

## 4. Dataset composition

```
TRAIN ADDITIONS: 29 rows, 8 families
  AMBIGUITY_UNKNOWN: 19 (negative/unresolved)
  REFERENCE: 10 (positive/resolvable)

DEV CHALLENGE: 12 rows, 6 families
  AMBIGUITY_UNKNOWN: 8 (negative/unresolved)
  REFERENCE: 4 (positive/resolvable)
```

Positive/negative split: 34% / 66% train, 33% / 67% dev — close to, if a
touch more negative-weighted than, the task's suggested 40-50%/50-60%
band. Judged acceptable given the explicit instruction to prefer family
diversity over hitting an exact ratio, and because the positive families
(7-8) are specifically designed as a strong, clean counter-signal rather
than needing raw volume to make their point.

## 5. Leakage audit (verified directly, not asserted)

Checked train additions and dev challenge against `v2/train.jsonl`,
`v2/validation.jsonl`, `v2.1/train_additions.jsonl`,
`v2.1/validation_remediation.jsonl` (heldout intentionally excluded —
never inspected) using exact-text normalization plus word-level Jaccard
similarity:

```
Exact duplicates: 0
Near-duplicates (Jaccard >= 0.8): 0
Train/dev family overlap: 0 (zero shared template-family IDs)
Train/dev text near-duplicates: 0
Internal exact duplicates (within train, within dev): 0
```

Every family was built from the high-level failure taxonomy (§3's
boundary descriptions), never from a specific failing validation row's
exact wording — the validation-paraphrase audit required by task §18 is
satisfied by this same leakage check returning zero matches.

## 6. Gold-schema validation

**41/41 (100%) pass** `SemanticInterpretationSchema.safeParse()` via the
real TypeScript schema (`validate-semantic-dataset-targets.ts`), not a
Python re-implementation. No new enum values invented; no schema
weakened.

## 7. Token length

```
train: p50=281 p90=286 p95=287 p99=287 max=287
dev:   p50=281 p90=288 p95=288 p99=288 max=288
```

`max_seq_length=384` (unchanged) is comfortably sufficient — **0 rows
over 384**, no sequence length change needed or made.

## 8. Masking/EOM compatibility

All 41 rows verified via the real `build_input_ids_and_labels` (no
training run — rendering/tokenization check only): prompt tokens fully
masked (`-100`), assistant completion tokens fully real, `<|im_end|>`
present and supervised in every single completion. 0 failures.

## 9. Hidden-context audit

Every "resolvable" family's gold was checked by hand against the
question "is there exactly one visible target, resolvable from text the
model actually receives?" before being added. No example relies on a
pending proposal, database state, or candidate list outside the sample
text — see §2's architecture constraint. No example rejected for this
reason was silently reworked into a false positive; the two genuinely
resolvable patterns (explicit naming, same-message backreference) are
the only two used throughout.

## 10. Freeze

`training/semantic-qwen3-4b/datasets/raw/v2.2/manifest.json` records:
SHA-256 for both files, full composition/category counts, token stats,
masking verification, leakage audit results, and the complete
family-design table. Frozen at this point — not to be edited during a
future V2.2B training/evaluation task, which must consume it read-only.

## 11. Final verdicts

**`V2_2_DATASET_READY`** — schema-valid (100%), zero leakage, clean
family split (zero train/dev overlap), dev challenge frozen with hashes,
token limit clean (0 truncation), no hidden-context issue found.

**`V2_2_READY_FOR_SINGLE_TRAIN`** — all stated readiness criteria met.

## 12. Explicitly not done in this task

No model loaded, no `trainer.train()`, no Optuna, no GGUF export, no
evaluator/acceptance-gate modification (the `schemaValidityRate` gate
miscalibration noted in V2.1I remains an open `GATE_REVIEW_CANDIDATE`,
not touched here), no heldout access of any kind.
