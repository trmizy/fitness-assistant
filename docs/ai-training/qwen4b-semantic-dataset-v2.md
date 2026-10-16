# Gymini Semantic Fine-Tune — Dataset V2

`SOURCE_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, branch `aws-deploy`.
Written/generated under `training/semantic-qwen3-4b/` and `docs/ai-training/`
only — no production code touched. V1 (`datasets/raw/v1/`,
`datasets/processed/v1/`), the D1 diagnostic, the existing adapter, and all
historical predictions/metrics are left unmodified; V2 lives entirely under
new `v2`-suffixed paths.

## 1. Why V2, and what D1 actually said to fix

D1 (`docs/ai-training/qwen4b-training-diagnostic-d1.md`) ruled out a
training-label bug and a generation-config bug, and found the real QLoRA
failure mode was **generation degeneration under a small-data adapter**
(format abandonment, repetition loops, 71% token-ceiling hits) — not a
tooling defect. D1's own `DATASET_EXPANSION_GO` decision is the premise
this task starts from. V2 is therefore not "more of the same" — per the
task's own instruction, it specifically targets the categories D1 showed
regressed hardest (entity extraction, correction, reference, ambiguity
discipline) and the behavior that broke worst (strict JSON-only output).

## 2. Ontology/schema snapshot (task §3)

No new intents, enums, or schema changes were made or assumed. Re-exported
the live TypeScript enums at the start of this task
(`export-semantic-schema-enums.ts`, timestamp `2026-10-10T16:18:03.352Z`)
and confirmed `git diff --stat` on
`backend/services/ai-service/src/conversational-intelligence/schema.ts` is
empty (no uncommitted changes) and its last commit (`2bbee3d1...`) predates
`SOURCE_HEAD` — **zero ontology drift from the V1 snapshot**. Schema hash
recorded in the manifest: `sha256(schema.ts) =
e2d76742ff3b01d45ac2c8b8649947f2e2f773d02bd25c373bdd1c93de7cd598`.

## 3. Generation approach

`generate_dataset_v2.py` — same hand-written-family + real-TypeScript-enum
pattern as V1 (`family()`/`base_target()` helpers), extended with:
- **Parameter sweeps for numeric entity/correction facts** (different real
  heights/weights/sessions/budgets/ages/ordinals per family) — each sweep
  point is genuinely new supervision (a different number to extract/
  compare), not mechanical paraphrase of one fact, consistent with the
  task's explicit "do not generate 5 variants of the same sentence" rule.
- **Entity+intent co-occurrence families** (task §10): several families
  now combine a non-trivial `primaryIntent`/`workflowIntent` WITH a real
  entity extraction in the same message (`entity-with-create-workout-intent`,
  `entity-with-find-pt-intent`, etc.) — directly targeting D1's finding
  that intent-only training risks forgetting entity extraction.
- **Expanded contrastive/near-neighbor families** (task §8): PT
  current-state-read vs recommend vs switch-without-proposal vs
  hire/confirm; calories hypothetical-question vs actual-change-request;
  bare numeric/pronoun ambiguity vs the same text with a valid
  `expectedSlot` context.
- **A real bug found and fixed during generation**: an initial
  `base_target()` version deleted empty-array keys (`entities: []` etc.)
  to "stay sparse" per the task's own §15 — this is **wrong** for this
  schema. Checked `schema.ts` directly:
  `entities: z.array(SemanticEntitySchema)` with no `.optional()`/
  `.default()` — these six array fields are **required keys** (an empty
  array is fine, omitting the key is not). All 465 initial targets failed
  `safeParse()` until this was fixed (keep the key, keep `[]`). Sparsity
  in this schema means "empty array when nothing applies," not "omit the
  key."
- **A `reference-last-item` family was redesigned, not forced to fit**:
  "cái cuối cùng" (the last one) doesn't have a dedicated reference kind,
  and `ORDINAL_ITEM` requires a positive `ordinal` the model has no way to
  know without a list length. Rather than fabricate a kind/ordinal that
  doesn't honestly apply, this case was reclassified as
  `AMBIGUITY_UNKNOWN` with `clarificationRequired=true` — matching the
  task's own "do not fabricate... only label what's resolvable" rule
  (§12).
- **11 exact-text duplicates across families were found and fixed** (e.g.
  "PT hiện tại của tôi là ai?" appeared verbatim in both an INTENT family
  and a REFERENCE family) — `validate_dataset.py`'s duplicate-input check
  caught these; each was resolved by rewording one side to a genuinely
  different phrasing rather than deleting the semantic point.

## 4. Totals and category distribution

```
totalRows: 464    templateFamilies: 179
AMBIGUITY_UNKNOWN: 34   CORRECTION: 60   ENTITY: 74   FITNESS_SHORTHAND: 27
FOLLOWUP_SLOT: 32       INTENT: 103      MULTI_INTENT: 20   REFERENCE: 60
REVISION: 34            SAFETY_NON_AUTHORITY: 20
```

Within the task's 400-700 total / 120-180 family targets. Honest note:
several per-category ranges from the task's own §6 guidance (e.g.
FITNESS_SHORTHAND 35-55, MULTI_INTENT 35-55, SAFETY_NON_AUTHORITY 30-45,
FOLLOWUP_SLOT 45-65, REVISION 55-75, REFERENCE 75-95, CORRECTION 65-85)
are not fully hit — stopped once further additions would have meant either
reducing phrasing diversity per family below what felt natural, or padding
with near-duplicate sentences, both of which the task explicitly warns
against ("not a quota contest," "do not distort to hit exact counts").
INTENT (103) and ENTITY (74) are within range; the others are a genuine,
documented shortfall rather than a silently-accepted one.

## 5. Split (task §18/§19)

`build_dataset.py --version v2 --seed 42`, 70/15/15 target. **A real split
bug was found and fixed**: the original `split_by_family` shuffled all 179
families in one global pool — for this run that put **zero**
`FITNESS_SHORTHAND` families in validation (all 7 of its families landed
in train/heldout), exactly the failure mode task §19 warns against ("do
not accidentally put almost all hard cases in heldout"). Fixed by
stratifying the split **per category** (each category's families are
independently split ~70/15/15), guaranteeing every category appears in
both validation and heldout:

```
train=327  validation=71  heldout=66
validation category coverage: AMBIGUITY_UNKNOWN 5, CORRECTION 10, ENTITY 11,
  FITNESS_SHORTHAND 4, FOLLOWUP_SLOT 5, INTENT 16, MULTI_INTENT 4,
  REFERENCE 7, REVISION 5, SAFETY_NON_AUTHORITY 4  (all 10 categories present)
heldout category coverage: all 10 categories present (4-15 each)
```

Zero template-family leakage confirmed directly (`tf_train & tf_val`,
`tf_train & tf_heldout`, `tf_val & tf_heldout` all empty sets). Heldout was
not inspected beyond this leakage/coverage check (task §34 — no heldout
predictions opened).

## 6. Gold-schema validation (task §16)

```
464/464 targets pass SemanticInterpretationSchema.safeParse()
```
via the real TypeScript runtime schema (`validate-semantic-dataset-targets.ts`),
not a Python re-implementation. 100% validity, as required.

## 7. Token length analysis (task §21)

```
fullSequence: p50=278  p90=328  p95=337  p99=363  max=374
truncatedAt: {256: 411/464 (89%), 384: 0, 512: 0}
```

`max_seq_length=384` remains sufficient (max observed = 374, zero
truncation) — no GPU dry test for 512 was needed since 384 already covers
100% of the real V2 distribution. Kept at 384, unchanged from V1.

## 8. Masking regression test (task §22)

Re-ran independently against V2 — **not assumed to transfer from D1/V1**.
`masking_diagnostic.py --version v2` now samples 10 rows across the file
(not just row 0) and additionally asserts `<|im_end|>` is among each row's
supervised (non-masked) completion tokens:

```
OVERALL PASS across 10 sampled rows (v2) - prompt tokens fully masked,
completion tokens fully real token ids including <|im_end|>, no leakage
either direction, think-scaffold stripped.
```

## 9. Privacy (task §17)

100% synthetic, hand/rule-authored. No real user chats, InBody
measurements, names, emails, tokens, or payment data. No external model/
API call was used to generate any row — every example came from the local
Python template generator.

## 10. What's next

`HF_BASE_V2` (full 71-row validation, no adapter) is the causal baseline
for the one QLoRA training run this task permits — see
`docs/ai-training/qwen4b-baseline-experiment-v2.md` for that run's results
and the final decision.
