# Advanced Set-Logging (Professional-Athlete Persona)

## What this is

Optional, per-set fields for advanced/professional users who track more than
weight/reps/RPE/RIR: set classification, tempo, range of motion, unilateral
side, pain/discomfort, and free-text technique notes.

## Data model

Migration: `20260730000000_workout_set_advanced_logging` — six new nullable
columns on `workout_sets`, purely additive (existing rows read as `null`,
nothing backfilled or guessed):

| Column | Type | Allowed values | Meaning |
|---|---|---|---|
| `set_type` | text, nullable | `WARMUP`, `WORKING`, `TOP`, `BACKOFF`, `FAILURE` | What kind of set this was |
| `tempo` | text, nullable | free text, e.g. `3-1-1-0` | Eccentric-pause-concentric-pause notation |
| `range_of_motion` | text, nullable | free text (e.g. `FULL`, `PARTIAL`) | Qualitative ROM note |
| `side` | text, nullable | `LEFT`, `RIGHT`, `BOTH` | Which side, for unilateral exercises |
| `pain_score` | integer, nullable | `0`-`10` | Subjective pain/discomfort during this set |
| `technique_notes` | text, nullable | free text | Anything worth remembering about form |

Validated in `fitness.models.ts` (`SET_TYPES`, `SET_SIDES` constants + the
shared `advancedSetFields` Zod fragment, reused by both `createWorkoutSchema`
and `updateWorkoutSetSchema`) and, for the manually-validated `addSet` path,
in `workout.service.ts` directly against the same `SET_TYPES`/`SET_SIDES`
constants — one source of truth for the allowed-value list, not duplicated.

## Evidence vs. inference (per this project's research standard)

- **"Top set" / "back-off set" terminology is NOT a peer-reviewed
  classification.** It comes from powerlifting-coaching practice (e.g.
  Andy Baker / PowerliftingTechnique.com) — a practitioner convention useful
  for real-world programming vocabulary, not a scientifically validated
  taxonomy. It is offered here as an optional label a user can apply to
  their own data, not as something the app concludes or infers on the
  user's behalf.
- **RPE/RIR** (already in the schema before this pass) have real peer-reviewed
  support as self-report measures of intensity, with known limitations
  (session-to-session variability, novice-lifter unreliability) documented
  elsewhere in this project's research from earlier phases.
- **Tempo notation, ROM, and unilateral side** are objective descriptive
  fields, not derived conclusions — there is no "evidence" claim attached to
  storing what actually happened.
- **`pain_score`** is stored as raw self-report only. Per this project's
  existing AI-safety rule (see `docs/adaptive-training-cycle-evaluation.md`),
  no automatic conclusion about injury risk or program safety may be drawn
  from this field alone — it is available to a human (the user or, if this
  product ever adds one, a coach) as decision-support input, never as a
  trigger for an automatic recommendation.

## What is done vs. what is an explicit, intentional gap

**Done (data + API foundation, real, tested):**
- Schema migration applied and verified against both the dev database
  (`gymcoach_fitness`) and the test database (`gymcoach_fitness_test`).
- Validation (Zod for `updateSet`/`createWorkout`, manual checks matching
  the existing style for `addSet`).
- `addSet`/`updateSet` persist and return all six fields correctly, including
  rejecting invalid `setType`/`side`/`painScore` values instead of silently
  storing them.
- 5 integration tests against a real database:
  `advanced-set-logging.integration.test.ts`.

**Explicit gap — not built in this pass:**
- **The active-exercise "GHI CHÉP" logging screen in `WorkoutLogPage.tsx`
  has no UI for these fields yet.** Today that screen logs one
  weight/RPE/RIR value per *exercise*, applied uniformly when the exercise
  is completed — it does not yet expose a per-set editing surface at all
  (see the code comment on `createWorkoutSchema` / the "GHI CHÉP" card).
  Adding real UI for six new per-set fields on top of that would require
  redesigning the logging screen's core interaction model (per-set rows,
  not one shared value per exercise) — a materially larger, riskier change
  than adding optional columns and validated endpoints. Per this project's
  explicit instruction not to ship "fake buttons or fake data," this gap is
  documented here rather than bolted on as a cosmetic form that doesn't
  actually reach a real per-set granularity in the existing UI.
- A professional user can reach this data today only via direct API calls
  to `addSet`/`updateSet` (already fully functional and tested), not through
  the logging screen's own controls.
- **Next step, if/when this UI is built:** the logging screen would need a
  per-set list (not a single shared value) for the active exercise, with
  these six fields as an optional/collapsible "advanced" section — matching
  the persona-based progressive-disclosure principle already used for the
  RPE/RIR beginner hint (`isBeginnerProfile` in `WorkoutLogPage.tsx`), just
  inverted (collapsed by default for beginner/intermediate, expandable for
  advanced/professional).
