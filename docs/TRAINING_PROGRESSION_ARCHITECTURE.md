# Training Progression Architecture — Target Design

> Design record for the P0 gaps in `docs/OPENGYM_VS_FITNESS_ASSISTANT_GAP_ANALYSIS.md`.
> Written from Fitness Assistant's own existing conventions
> (`cycle-decision.engine.ts`'s `DecisionEngineResult`/`reasonCodes` shape,
> `fitness.models.ts`'s `SET_TYPES`/advanced-set-fields pattern, the project's
> "code tính số liệu, LLM chỉ diễn giải" principle already applied one layer
> up) — independently, not derived from openGym code (never read, AGPL-3.0).

## 1. Where this sits in the existing architecture

```
                 USER
                   │
                   ▼
            ACTIVE WORKOUT  (WorkoutLogPage.tsx — existing)
                   │
          sets / reps / load / RPE / RIR / pain  (existing WorkoutSet fields)
                   │
                   ▼
       EXERCISE PERFORMANCE LAYER            ◄── NEW this pass
                   │
                   ├── PR (existing computeNewPRs, extended: rep-PR, e1RM-PR)
                   ├── e1RM (existing estimate1RM(), reused not duplicated)
                   ├── previous-performance read (NEW)
                   └── exercise-progression.engine.ts (NEW)
                   │
                   ▼
       SESSION EVALUATION LAYER               (existing, unchanged)
                   │
                   ▼
       TRAINING CYCLE ENGINE                  (existing, unchanged —
          cycle-decision.engine.ts               cycle-metrics.engine.ts)
          KEEP / PROGRESS / ADJUST / DELOAD / REBUILD / INSUFFICIENT_DATA
                   │
                   ▼
              AI COACH                        (existing ai-service —
              explanation only                  NOT wired this pass, see §5)
```

The cycle engine already exists, is mature, and is **not touched** by this
work. What's missing is the layer directly above it: nothing today turns "the
user just did 3×8 @ 80kg on Bench Press" into "what should they target next
time on Bench Press specifically" — that decision is currently made nowhere
in the codebase (confirmed absent, gap analysis row 2).

## 2. Precedence rule (cycle decision caps exercise decision)

This is the one true architectural rule this design adds. Stated exactly:

> The training-cycle engine's current `CycleDecision` bounds what the
> exercise-progression engine is **allowed to propose**. The exercise engine
> never overrides it.

Concretely, `exercise-progression.engine.ts` takes the current cycle's
`CycleDecision` (already computed by the existing engine, read-only input —
no new coupling in the other direction) as a required input and applies it as
an envelope *before* computing its own local, per-exercise signal:

| Cycle decision | Envelope applied to exercise engine |
|---|---|
| `DELOAD` | Exercise engine's own local status is **overridden to `DELOAD`** regardless of how good this one exercise's recent history looks. A single exercise's local hot streak does not override systemic fatigue/pain the cycle engine already detected. |
| `REBUILD` | Exercise engine returns `REVIEW` (not an automatic increase) — the cycle-level signal is "goals/context changed," a local load bump would be presumptuous. |
| `INSUFFICIENT_DATA` | Exercise engine still runs (it has its own, per-exercise data-quality gate — a cycle can lack enough *sessions* while one specific exercise still has enough *sets* logged before this cycle even started), but is clearly labeled `cycleContext: "INSUFFICIENT_DATA"` in its output for the UI/AI layer to caveat appropriately. |
| `KEEP` / `PROGRESS` / `ADJUST` | No override — exercise engine's local decision stands as computed. |

No cycle exists yet (user hasn't started one, or fitness-service has no
active `TrainingCycle` for this user) → treated the same as `KEEP` (no
envelope restriction) — matches how workout logging today already works
independent of any cycle.

## 3. `exercise-progression.engine.ts` — API

```ts
export type ExerciseProgressionStatus =
  | "KEEP"
  | "INCREASE_LOAD"
  | "INCREASE_REPS"
  | "INCREASE_SETS"
  | "DELOAD"
  | "REVIEW"
  | "INSUFFICIENT_DATA";

export interface ExerciseProgressionResult {
  status: ExerciseProgressionStatus;
  currentPerformance: { weightKg: number | null; reps: number | null; setCount: number } | null;
  nextTarget: { weightKg: number | null; reps: number | null } | null;
  loadChangeKg: number | null;
  repChange: number | null;
  reasonCodes: string[];        // machine-readable, matches DecisionEngineResult's existing convention
  cycleContext: CycleDecision | "NONE";
  dataQuality: "SUFFICIENT" | "LOW_SAMPLE" | "NONE";
}

export function evaluateExerciseProgression(input: {
  exerciseId: string;
  loggingMode: "REPS_LOAD" | "BODYWEIGHT_REPS" | "TIME" | "TIME_LOAD" | "DISTANCE_TIME";
  recentSets: PerformanceSetRow[];   // most-recent-first, already filtered completed=true, setType!=='WARMUP'
  cycleDecision: CycleDecision | null;   // null = no active cycle
  policy: ProgressionPolicy;             // see §4
}): ExerciseProgressionResult
```

`reasonCodes` are machine strings (e.g. `"COMPLETED_ALL_PRESCRIBED_REPS_WITHIN_TARGET_RIR"`,
`"MISSED_TARGET_REPS_TWO_SESSIONS_IN_A_ROW"`, `"CYCLE_DELOAD_OVERRIDES_LOCAL_SIGNAL"`) —
natural language is generated by the UI/AI layer from these codes, never
returned as the source of truth from this function, matching the project's
existing rule for `DecisionEngineResult` one layer up.

Pure function, no I/O, no Prisma calls, no LLM calls — fully unit-testable
with table-driven inputs (per task §25/§13 precedent already used in
`cycle-decision.engine.test.ts`).

## 4. Progression policy selection (not copied from openGym — independently justified)

openGym's 5 named policies were **read only as a feature-list description**,
never as code. The policy actually chosen here is selected from this app's
own available inputs (goal, experienceLevel, exercise loggingMode) per the
task's own instruction (§13: "Xác định policy dựa trên... không thêm
Greyskull chỉ vì openGym có"):

| Policy | Applies when | Rule |
|---|---|---|
| **Linear** | `loggingMode: REPS_LOAD`, `experienceLevel: BEGINNER`, goal includes strength/muscle gain | Completed all prescribed sets at/under target RIR → `INCREASE_LOAD` next session, fixed increment (5% of current e1RM, rounded to nearest plate-loadable step — see §6.1 for why this is a heuristic, not a formula). Missed reps on any set → `KEEP` (repeat), 2 consecutive misses on the same exercise → `DELOAD` (reduce load ~10%, matching the pattern already used by `training-cycle-classification.service.ts`'s own thresholds for consistency). |
| **Double progression** | `loggingMode: REPS_LOAD`, `experienceLevel: INTERMEDIATE`/`ADVANCED`, hypertrophy-leaning goal | Prescribed rep *range* (e.g. 8-12): hit the top of the range for all sets → `INCREASE_LOAD` + reset to bottom of range next session; below the top → `INCREASE_REPS` next session at the same load. |
| **Autoregulated (RIR-anchored)** | `loggingMode: REPS_LOAD`, `experienceLevel: ADVANCED`, sufficient RIR data logged | Compares actual RIR to prescribed target RIR rather than a fixed rep target — closer to how an advanced lifter actually autoregulates (per `gym-fitness-research.md` §3: RIR/RPE self-report is *more* reliable for this group). `REVIEW` (not an automatic change) when RIR data is sparse for this exercise. |
| **Bodyweight rep-climbing** | `loggingMode: BODYWEIGHT_REPS` | Analogous to linear, but the axis of progress is reps, not load: hit the top of the target rep count on all sets → `INCREASE_REPS`; once a ceiling is reached (product-configured, e.g. 20 reps) → flag `REVIEW` (add external load — a data-model/UX decision outside this engine's scope, deferred). |
| **Timed progression** | `loggingMode: TIME` / `TIME_LOAD` | Same shape as bodyweight rep-climbing, axis is duration instead of reps. |

Every threshold above (5% load step, 2-miss deload trigger, 20-rep ceiling)
is a **product heuristic**, explicitly labeled as such in the engine's own
code comments — not presented as scientific fact, per task §37. The
*direction* of each rule (progressive overload when performance allows, back
off on repeated failure/fatigue) is evidence-supported (`gym-fitness-research.md`
§2), the *exact numbers* are not independently derived from a study.

## 5. AI integration (designed, NOT wired this pass)

Per the checkpoint's documented decision, `ai-service`'s files are currently
mid-flight with unrelated uncommitted changes from other sessions
(`coach_context_builder.ts`, `orchestrator.service.ts`, etc.). The contract
below is the intended shape for whenever that's picked up — no ai-service
file is edited by this pass.

```json
{
  "exercise": "Bench Press",
  "loggingMode": "REPS_LOAD",
  "previousPerformance": { "weightKg": 80, "reps": 8, "setCount": 3 },
  "progressionDecision": "INCREASE_LOAD",
  "reasonCodes": ["COMPLETED_ALL_PRESCRIBED_REPS_WITHIN_TARGET_RIR"],
  "cycleDecision": "PROGRESS",
  "safety": { "painScoreRecent": null, "injuryFlags": [] },
  "dataQuality": "SUFFICIENT"
}
```

AI may explain/contextualize this; it may never overwrite `progressionDecision`
— identical rule to how `cycle-decision.engine.ts`'s output already can't be
overridden by the LLM today (`docs/TRAINING_CYCLE_DECISION_ENGINE.md` §5).
If AI is unavailable, the UI still renders a deterministic template string
built directly from `reasonCodes` (see §7) — AI is never a dependency for the
workout to function, matching task §18.

## 6. Data model changes (fitness-service only, additive, backward-compatible)

### 6.1 New nullable columns on `WorkoutSet`

```prisma
model WorkoutSet {
  // ...existing fields unchanged...
  bodyWeightAtSetKg Float? @map("body_weight_at_set_kg") // captured body weight at time of this set, for BODYWEIGHT_REPS exercises — NOT a reinterpretation of `weight` (external load stays in `weight`, exactly as today)
  durationSeconds   Int?   @map("duration_seconds")       // per-set duration — plank/carry/timed hold
  distanceMeters    Float? @map("distance_meters")        // per-set distance — running/rowing/cycling
}
```

Why additive, not a redefinition of `weight`: per task §6/§16 — existing rows
must keep meaning exactly what they meant before. A pull-up set today has
`weight: null` (no added load) or `weight: 0`/some positive value if the app
already lets a user log added load on a pull-up (it does, generically, via
the same field every exercise uses) — nothing in this migration changes how
any existing row is read. `bodyWeightAtSetKg` is purely new information,
`null` for every pre-migration row (matches the InBody-derived body weight at
session time when available; left `null`, not guessed, when it isn't —
"explicit unknown, not silently guessed," this repo's own established
pattern per `workout-log-audit.md`'s `exerciseNameSnapshot` precedent).

### 6.2 `Exercise.loggingMode` (new, derivable, not hand-entered per row)

```prisma
model Exercise {
  // ...existing fields unchanged...
  loggingMode String @default("REPS_LOAD") @map("logging_mode")
  // REPS_LOAD | BODYWEIGHT_REPS | TIME | TIME_LOAD | DISTANCE_TIME
}
```

Backfill strategy for the 883+ existing rows: derive from already-existing
`typeOfEquipment`/`typeOfActivity` in the migration's own `UPDATE`, not left
`null` for the whole catalog (matches this repo's own established pattern —
`Food.foodForm`/`isSupplement` were "backfilled for all rows via the
migration's own UPDATE using existing classification," not left empty, per
`schema.prisma`'s own comment on that model):

- `typeOfEquipment = 'BODYWEIGHT'` AND `typeOfActivity` includes `CARDIO` → `DISTANCE_TIME`
- `typeOfEquipment = 'BODYWEIGHT'` otherwise → `BODYWEIGHT_REPS`
- `typeOfActivity = 'CARDIO'` (non-bodyweight, e.g. rowing machine) → `DISTANCE_TIME`
- `type = 'HOLD'` (existing `MovementType` enum value, e.g. plank) → `TIME`
- everything else → `REPS_LOAD` (the default, and correct for the overwhelming
  majority of the existing weighted-exercise catalog)

This is a heuristic backfill, not guaranteed 100% correct for every one of
883 rows — flagged honestly, not silently assumed perfect. A follow-up
catalog-review pass (already has precedent: `ExerciseReviewDecision` exists
in this schema for exactly this kind of "flag for human review" workflow)
can correct individual misclassifications without another migration.

### 6.3 PR types (code-level, no schema change needed)

`computeNewPRs` extended in place to also compute rep-PR (max reps at any
weight ≥ a exercise's own historical median weight, avoiding a trivial "did 1
rep at a token 2.5kg weight = new rep PR" false positive) and e1RM-PR (max
`estimate1RM()` value vs prior all-time max) — reuses the exact same
prior-vs-cycle max pattern already in the function, extended to two more
axes rather than three separate new functions.

## 7. Next-target explanation (UI contract)

```
LAST TIME
100 kg × 8 × 3 sets

TODAY'S TARGET
102.5 kg × 8

WHY
Hoàn thành đủ số rep quy định trong ngưỡng nỗ lực mục tiêu.
```

The "WHY" line is a deterministic template keyed by `reasonCodes[0]`
(fallback to a generic "Dựa trên hiệu suất buổi trước" if no template exists
for a given code) — never an LLM call on the critical path. AI, when
available, may replace this with a richer explanation using the same
structured payload (§5), but the template must render correctly with AI
fully absent, per task §18.

## 8. What is explicitly NOT part of this design

- Superset semantic grouping (P1, gap analysis).
- Reschedule / `WorkoutSchedule.status` expansion, e.g. `SKIPPED`,
  `PARTIALLY_COMPLETED` (P1, already flagged as needing dedicated review in
  `workout-log-audit.md` before this task started — not reopened here).
- Any change to `ai-service`, `user-service`, or `payment-service` (deferred,
  see checkpoint's documented reason).
- Multi-formula e1RM support (evaluated, rejected — see gap analysis
  "DIFFERENT_BY_DESIGN" row).

## 9. Heuristic review (post-implementation audit, P1-completion pass)

Every numeric threshold in `exercise-progression.engine.ts`, re-examined
against the research in `docs/OPENGYM_RESEARCH_SOURCES.md` (including the
ACSM 2026 update added this pass) and classified honestly — a threshold this
project invented is never relabeled as "evidence" just because a real paper
exists on the general topic:

| Rule (constant in code) | Current value | Evidence found | Classification | Decision |
|---|---|---|---|---|
| `LINEAR_LOAD_STEP_FRACTION` | +5% load per successful session | No study prescribes a specific %-increment step size for autoregulated linear progression; ACSM 2026 gives target *ranges* (≥80% 1RM for strength), not step sizes between sessions | `PRODUCT_HEURISTIC` | Keep — a small, conservative, plate-roundable default; not claimed as evidence-derived anywhere in code comments |
| `CONSECUTIVE_MISSES_BEFORE_DELOAD` | 2 sessions | Bell et al. (2025, `gym-fitness-research.md` §2) supports deload as a real, evidence-backed *concept* (planned 4-8wk or reactive-on-fatigue), but does not specify "2 consecutive session misses" as the reactive trigger | `INDUSTRY_CONVENTION` (concept evidence-supported; exact trigger count is convention) | Keep — matches this project's own existing `training-cycle-classification.service.ts` deload-trigger pattern (consistency with current architecture, priority 5) |
| `DELOAD_LOAD_REDUCTION_FRACTION` | -10% | No study prescribes an exact %-reduction; Bell et al. describes deload as *"reduce intensity, volume, duration, or frequency"* qualitatively, not a specific percentage | `PRODUCT_HEURISTIC` | Keep — explicitly matches (deliberately, per the code comment) the existing cycle-classification service's own deload-scale convention, for consistency across the codebase rather than inventing a second number |
| `HIGH_RIR_HEADROOM_THRESHOLD` (avg RIR ≥2 signals room to add load) | 2 | ACSM 2026 mentions near-failure training around 2-3 RIR as sufficient effort, but also says exact RIR/perceived-exertion targets cannot be quantified from the available evidence | `PRODUCT_HEURISTIC` for this app's automated progression trigger; the broader RIR/proximity-to-failure concept is only `EVIDENCE_INFORMED` | Keep — the value sits inside the ACSM-mentioned range, but the "RIR ≥2 means increase next session" mechanism is this product's own conservative rule |
| `BODYWEIGHT_REP_STEP` | +2 reps once top of range is hit | No peer-reviewed source found for a specific step size; practitioner sources (BULLBAR, this pass's new research) converge on "roughly 8-20 reps" before external load becomes necessary, not a per-session step count | `PRODUCT_HEURISTIC` | Keep |
| 20-rep bodyweight ceiling (mentioned in code comment, not yet enforced) | 20 | Practitioner convention range is 8-20 reps depending on exercise (this pass's new research) — 20 sits at the upper edge of that range | `INDUSTRY_CONVENTION` (upper bound of a real practitioner range, not invented from nothing) | Keep as documented, still not enforced (unchanged from P0) |
| `AUTOREGULATED_RIR` gated to `experienceLevel === "ADVANCED"` only | ADVANCED + real RIR data required | `gym-fitness-research.md` §3: RIR/RPE self-report reliability is measurably lower in beginners, improves with deliberate practice/calibration | `EVIDENCE_SUPPORTED` | **Reviewed this pass, confirmed already correct — no change.** This was the one item this pass's instructions specifically asked to re-audit (concern: could a beginner with a stray RIR value reach autoregulated progression?) — verified directly in code (`exercise-progression.engine.ts:135`) that the gate is `experienceLevel === "ADVANCED" && hasRirData`, with an existing test (`"ADVANCED without any RIR data falls back to DOUBLE_PROGRESSION, not AUTOREGULATED_RIR"`) proving the data-quality half of the gate. A BEGINNER can never reach this policy regardless of how much RIR data exists. |
| e1RM formula (Epley) | — | `gym-fitness-research.md` §7, unchanged this pass — still correct for this app's typical 2-10 rep range; Marzagao (2026) preprint remains non-peer-reviewed, not adopted | `EVIDENCE_SUPPORTED` (for the 2-10 rep range) | Keep, unchanged |

No threshold in this table was reclassified upward (e.g. from
`PRODUCT_HEURISTIC` to `EVIDENCE_SUPPORTED`) just because a real paper on
the general topic exists — each row's evidence column states exactly what
was and wasn't found, per this project's own standing rule against inventing
certainty.

## 9.1 FINAL P0 CLOSURE PASS re-audit — RIR/ACSM primary-source correction

The §9 pass above read the ACSM 2026 numbers **from secondary
science-journalism summaries** (2 Minute Medicine, Medical News Today), not
the primary position stand itself, and said so explicitly at the time
(`docs/OPENGYM_RESEARCH_SOURCES.md` line 71, "honest limitation of this
research pass"). This pass fetched the primary source directly —
[PMC12965823](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/), the free
full text of Phillips ST et al., *Medicine & Science in Sports & Exercise*
58(4):851-872, April 2026, DOI
[10.1249/MSS.0000000000003897](https://doi.org/10.1249/MSS.0000000000003897)
— and searched it specifically for RIR/RPE progression language. Direct
quotes found:

> "Sufficient effort (assessed using various scales) can be accomplished by
> completing sets with various RTx and completion of 'near-failure' or a
> target of 2–3 repetitions in reserve (RIR)."

> "While training to failure is not obligatory for optimizing results,
> there is insufficient evidence to quantify exact RIR and perceived
> exertion targets."

**Correction**: the primary source mentions "2-3 RIR" only as a description
of what counts as *sufficient set-level effort* — it never discusses using a
post-session average RIR as an automated *progression trigger* (i.e. "if
RIR ≥2, increase next session's load"), and it explicitly disclaims having
enough evidence to quantify exact RIR targets at all. §9's `EVIDENCE_SUPPORTED`
label for the 1-3 RIR range therefore overclaimed precision the source
itself declines to claim. This pass introduces a third tier,
**`EVIDENCE_INFORMED`**, for exactly this shape of finding — a primary
source that genuinely discusses the general concept, but hedges on the
specific number(s) a product still has to pick:

| Rule (constant in code) | Value | Corrected classification | Why |
|---|---|---|---|
| RIR / proximity-to-failure as a legitimate way to gauge intensity, "2-3 RIR" cited as a sufficient-effort zone | — (concept, not a code constant) | `EVIDENCE_SUPPORTED` → **`EVIDENCE_INFORMED`** | Directly stated in the ACSM 2026 primary source, but the source itself says there is "insufficient evidence to quantify exact RIR ... targets" — it supports the concept, not a precise number |
| `HIGH_RIR_HEADROOM_THRESHOLD` (avg RIR ≥2 after a session automatically signals room to add load next session) | 2 | `EVIDENCE_SUPPORTED` (for the range) → **`PRODUCT_HEURISTIC`** | The primary source never discusses using RIR this way — as a post-hoc, automated, per-exercise progression trigger. That mechanism (not just the number 2) is entirely this project's own design; picking 2 keeps it inside the range ACSM happens to mention, but that overlap doesn't make the *mechanism* evidence-derived |

No code change: `HIGH_RIR_HEADROOM_THRESHOLD = 2` in
`exercise-progression.engine.ts` is unchanged — it was already labeled a
heuristic-flavored choice in the code comment before this pass, and 2 sits
inside a range ACSM does mention, so there's no reason to pick a different
number. Only the *evidence-tier label and its justification* changes here.

### AUTOREGULATED_RIR gating (`experienceLevel === "ADVANCED"` only) — re-validated against direct peer-reviewed literature

§9 sourced "RIR reliability is lower in beginners" from a single
review-synthesis site (`muscleresearch.net`). This pass searched
peer-reviewed literature directly comparing RIR-prediction accuracy across
training status:

- Remmert JF, Laurson KR, Zourdos MC (2023), "Accuracy of Predicted
  Intraset Repetitions in Reserve (RIR) in Single- and Multi-Joint
  Resistance Exercises Among Trained and Untrained Men and Women",
  *Perceptual and Motor Skills*, DOI
  [10.1177/00315125231169868](https://doi.org/10.1177/00315125231169868),
  PubMed [37036795](https://pubmed.ncbi.nlm.nih.gov/37036795/) — found
  training status did **not** significantly influence RIR prediction
  accuracy on machine-based single/multi-joint exercises; accuracy was
  instead driven mainly by proximity to failure (more accurate closer to
  failure).
- A separate experienced-vs-novice back-squat study similarly found
  training experience did not significantly affect objective RIR-estimation
  accuracy for that free-weight compound lift.

**This directly complicates, rather than confirms, the "beginners are less
reliable at RIR" claim** as a blanket statement — the real peer-reviewed
picture is mixed: training status doesn't clearly move RIR-counting accuracy
on the specific lifts studied, while proximity-to-failure consistently does
(both trained and untrained are worse further from failure).

**Correction**: reclassify from `EVIDENCE_SUPPORTED` to
**`EVIDENCE_INFORMED`** — there is real, relevant, directly-on-topic
peer-reviewed research, but it does not unambiguously support "gate
autoregulation to ADVANCED only" as the one correct design; it's a
defensible, conservative default (advanced lifters are more likely to have
consistent RIR *data logged in the first place*, which the code's
`hasRirData` half of the gate already requires independently of the
accuracy question) rather than a claim this project can point to a study
and say "beginners are measurably worse at this, so we gated it."

**No code change** — per this pass's explicit instruction ("if the engine
already does this correctly, document proof, don't change code"), and
because the gate remains reasonable on data-availability and
conservative-default grounds even under the corrected evidence tier. The
gate itself (`exercise-progression.engine.ts`, `selectProgressionPolicy()`)
is unchanged: `experienceLevel === "ADVANCED" && hasRirData`, still proven
by the existing test `"ADVANCED without any RIR data falls back to
DOUBLE_PROGRESSION, not AUTOREGULATED_RIR"`.

### e1RM (Epley) — quick re-verification, no redesign

Re-checked `backend/services/fitness-service/src/utils/estimated-1rm.util.ts`
directly against this pass's requirements:

- Formula: `weight × (1 + reps / 30)`, degrades gracefully at high rep
  counts (linear growth, no denominator that can hit zero/go negative,
  unlike Brzycki's `weight / (1.0278 − 0.0278 × reps)` which blows up at 37
  reps) — confirmed correct for this app's typical 2-10 rep logging range
  and safe (no crash/NaN/negative output) well beyond it.
- Invalid input: `reps <= 0` returns the raw weight unchanged rather than
  `NaN`/`Infinity`/a negative number — already covered by 3 existing unit
  tests (`estimate1RM: 1 rep returns the weight itself`, `0 reps returns
  the weight unchanged`, `negative reps returns the weight unchanged`),
  all passing this pass's regression run.
- No redesign performed — correct as-is, matches this pass's "don't
  redesign if correct" instruction.

### Summary of this section's corrections

- 2 evidence-tier reclassifications (both downgraded from `EVIDENCE_SUPPORTED`
  to the new `EVIDENCE_INFORMED` tier), 0 code changes.
- Primary source fetched and quoted directly (previously only had secondary
  science-journalism summaries).
- Additional direct peer-reviewed literature search performed for the
  beginner-vs-trained RIR-accuracy question, surfacing a more nuanced
  picture than the single review-site source previously cited.
- `docs/OPENGYM_RESEARCH_SOURCES.md` updated with the new primary-source
  quotes and the Remmert et al. 2023 citation.
