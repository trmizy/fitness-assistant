# Gymini Roadmap Projection & Strategy Report Hardening — Design

Date: 2026-09-10
Scope: `backend/services/fitness-service`, `frontend/web`. Corrective +
depth phase on top of the VERIFIED Gymini Guided Roadmap Creation phase.
No wizard redesign, no lifecycle redesign, no new top-level pages.
Written after auditing real source (not guessed) — see §1–§4.

## 1. Current K-Group Algorithm (audited)

`GuidedRoadmapWizard.tsx`'s `phaseBucket()` classifies each phase
**independently** into `CUT` (`FAT_LOSS`/`MINI_CUT`), `BUILD`
(`LEAN_GAIN`/`RECOMPOSITION`/`PERFORMANCE`), or `STABILIZE`
(everything else — `MAINTENANCE`/`DIET_BREAK`/`RECOVERY`), then
`groupPhasesIntoK()` merges only **immediately adjacent** phases sharing
the same bucket. It has no concept of "look past this bridge phase to
see what comes next" — confirmed by reading the function: it is a single
forward pass with no lookahead. This is exactly the bug the master task
names: `FAT_LOSS → DIET_BREAK → FAT_LOSS` renders as three groups
(K1 CUT, K2 STABILIZE, K3 CUT) instead of one continuous "Giảm mỡ"
campaign with an internal diet-break period.

## 2. Current Energy-Breakdown Semantics (audited)

`fitness-diagnosis.engine.ts`'s `computeEnergyBreakdown()` allocates the
real `(TDEE - BMR)` gap across four labeled rows — steps, resistance
training, TEF (fixed 15% weight), and "other" (the pure remainder) —
proportioned by rough weights so they always sum back to the real TDEE.
When `trainingDaysPerWeek`/`dailyGoalSteps` are both zero (a very common
wizard state — the account used for phase 5's own E2E happy path
produced exactly this), the entire `(TDEE - BMR)` gap lands on the TEF
row alone (confirmed live in the prior phase's verification: `TEF=986`
kcal, `steps=0`, `training=0`, `other=0`) — a textbook "residual bucket
mislabeled as a specific physiological quantity," exactly what the
master task's Issue C names.

## 3. Draft-Reopen Gap (audited)

`GuidedRoadmapWizard.tsx`'s `buildAcceptPayload()` already writes
`configuration.diagnosisSnapshot = diagnosisQuery.data` into the saved
`FitnessRoadmap.configuration` JSON. Confirmed by a repo-wide grep
(`diagnosisSnapshot`) that **nothing ever reads this field back** —
`DraftRoadmapDetail` (`RoadmapJourneyPage.tsx`) only renders
`configuration.aiDraft`'s `summary`/`reasoningSummary`/`warnings`/
`assumptions` plus a bare numbered phase list. Reopening a saved DRAFT
today shows strictly less than what the user saw and approved at Step 4
— confirmed code fact, not a hypothesis.

## 4. Available Inputs for Projection (audited)

`fitnessRoadmapService.getDiagnosis` already resolves and returns, per
request: `current.{weightKg, heightCm, age, gender, activityLevel,
experienceLevel, bodyFatPct, bodyFatMethod, ffmi}`,
`energyBreakdown.{bmr, bmrFormula, tdee}`, `safety`, `targetRealism`.
`computeInitialNutritionPrescription` (unchanged, the one authoritative
calorie/macro engine) accepts `weightKg/heightCm/age/gender/
activityLevel/experienceLevel/measuredBmr/goal/useMaintenanceOnly` and
returns `bmr/bmrFormula/maintenanceCalories/targetCalories/
deficitOrSurplusKcal/proteinGrams/carbGrams/fatGrams/waterMl`. No
per-phase or future-state calculation exists anywhere in the codebase
today (confirmed via repo-wide grep for "projected weight", "projected
body fat", "phase projection" — zero matches before this phase).
`RoadmapAiDraft.phases[]` (ai-service draft, pre-persistence) and
persisted `RoadmapPhaseWithCycles[]` both carry `phaseType` +
`plannedStartAt`/`plannedEndAt` — the minimum shape a phase-sequence
projector needs, present in both the pre-Save and post-Save/reopen
cases.

## 5. What Can Be Projected Responsibly

```text
Body weight            YES — chained from the real computed deficit/
                        surplus calorie amount (§9), clamped to the same
                        safety ceiling assessTargetRealism already uses.
Body-fat % / lean mass  YES, but ONLY when a starting bodyFatPct is
                        known (real InBody or a user estimate) — if
                        unknown, every phase's body-fat/FFMI projection
                        is null, never fabricated, and this propagates
                        forward (§9).
FFMI                    Derived from the above via the existing
                        computeFfmi() — reused as-is, no new formula.
BMR/TDEE                YES per phase (start AND end-of-phase, since
                        weight — the only input that changes across the
                        roadmap — moves within a phase too), always via
                        computeInitialNutritionPrescription, never a
                        second formula.
Calories/macros         YES per phase, via computeInitialNutritionPrescription
                        called with that phase's own start weight and a
                        phaseType→goal mapping (§8) — diagnosis-time
                        estimate only, never written to NutritionGoal.
Independent TEF line    NO — no defensible independent calculation
                        exists in this codebase (§2); replaced with a
                        single honestly-labeled "Hoạt động & tiêu hao
                        khác" bucket by default (§13).
```

## 6. Current-vs-Target Ownership (unchanged invariant, restated)

```text
FitnessRoadmap / RoadmapPhase   = strategy (phaseType sequence + dates)
TrainingCycle                   = actual execution/evaluation block
NutritionGoal                   = actual calories/macros a user is on
WorkoutProgram                  = actual workout prescription
InBody / body measurements      = actual body state
CycleAssessment                 = actual evaluation
Roadmap phase forecast (NEW)    = a diagnosis-time, non-binding SCENARIO
                                   — never read by, never written into,
                                   any of the rows above.
```

Every new field this phase introduces is named `projected*`/`estimated*`
(`projectedWeightKg`, `projectedCalories`, `estimatedBmr`,
`estimatedTdee`, ...) — never the bare `weight`/`calories`/`tdee` names
those authoritative tables already use, so a reader can never confuse a
forecast field for a real one by name alone.

## 7. Energy-Breakdown Semantics — Fix

`computeEnergyBreakdown()` is modified so it **only** produces an
independent, separately-labeled component when the underlying input
that would justify it is actually present and non-zero
(`trainingDaysPerWeek > 0` for the resistance-training row,
`dailyGoalSteps > 0` for the steps row). TEF is removed as a fabricated
"15%-of-gap" residual line entirely. The remainder — TEF, unaccounted
NEAT, everything not attributable to steps/training — is folded into
one honestly-named `"Hoạt động & tiêu hao khác"` row. When both
`trainingDaysPerWeek` and `dailyGoalSteps` are zero (or absent), the
entire `(TDEE - BMR)` gap renders as that single "Hoạt động & tiêu hao
khác" row — never split into fake sub-components. The top-line
BMR/TDEE numbers are **unchanged** — still 100% `computeInitialNutritionPrescription`'s
real output, still reconciled exactly (`bmr + Σcomponents === tdee`,
same invariant, still unit-tested).

## 8. phaseType → Nutrition-Goal Mapping (for per-phase nutrition calls)

```text
FAT_LOSS, MINI_CUT        -> "WEIGHT_LOSS"   (same deficit fraction —
                              no MINI_CUT-specific more-aggressive
                              constant exists anywhere in this codebase;
                              inventing one would violate §13's "do not
                              invent aggressive rates")
LEAN_GAIN                  -> "MUSCLE_GAIN"
DIET_BREAK, RECOVERY       -> "MAINTENANCE"
MAINTENANCE                -> "MAINTENANCE"
RECOMPOSITION              -> "MAINTENANCE" (see §9 — no reliable
                              simultaneous-recomp model exists; the
                              conservative, non-fabricating choice)
PERFORMANCE                -> "ATHLETIC_PERFORMANCE" (computeInitialNutritionPrescription's
                              own `else` branch already treats this
                              identically to MAINTENANCE — unchanged
                              existing behavior, just now reached from a
                              phase context too)
```

## 9. Body-Composition Projection Formula

Reuses `computeInitialNutritionPrescription`'s own `deficitOrSurplusKcal`
output for that phase's start state — never a second deficit
calculation.

```text
rawWeeklyDeltaKg = (deficitOrSurplusKcal * 7) / KCAL_PER_KG_TISSUE
  KCAL_PER_KG_TISSUE = 7700 — a commonly-cited approximate energy
  density of adipose tissue (a simplification of Hall et al.'s dynamic
  energy-balance model, which the deficit fraction itself already cites
  as evidenceId "hall-2011-dynamic-energy-balance" — the same source,
  used here for its own well-known first-order approximation, not a new
  unrelated constant).

clampedWeeklyDeltaKg = clamp(rawWeeklyDeltaKg,
  ±(startWeightKg * MAX_SAFE_WEEKLY_RATE_PCT[direction]))
  MAX_SAFE_WEEKLY_RATE_PCT is the EXACT SAME constant
  assessTargetRealism() already uses (0.01/week for loss, 0.0025/week
  for gain) — refactored into a shared exported constant in
  fitness-diagnosis.engine.ts so the projection can never drift from the
  diagnosis engine's own safety ceiling.

totalDeltaKg = clampedWeeklyDeltaKg * durationWeeks
endWeightKg  = round1(startWeightKg + totalDeltaKg)
```

Fat/lean partition of `totalDeltaKg` (only meaningful for FAT_LOSS/
MINI_CUT/LEAN_GAIN — every other phaseType uses `totalDeltaKg = 0`,
i.e. a stable-weight projection, the conservative default §13 asks for
DIET_BREAK/MAINTENANCE/RECOVERY/RECOMPOSITION to have):

```text
FAT_LOSS / MINI_CUT:  80% of totalDeltaKg assumed fat mass, 20% lean —
  "most of a fat-loss-phase deficit's weight change is fat, not all of
  it" (master task §13's own instruction), sourced to the same
  garthe-2011 (weight-loss rate + lean-mass retention in athletes) and
  issn-protein-2017 (adequate-protein-preserves-lean-mass) evidence ids
  computeInitialNutritionPrescription already cites for this exact
  scenario — not a new, unrelated number.
LEAN_GAIN:             50% of totalDeltaKg assumed lean mass, 50% fat —
  "do not imply all gained weight is muscle" (master task §13), sourced
  to the same slater-2019 (surplus-feeding hypertrophy) evidence id
  already cited for the surplus fraction itself.
```

`endFatMassKg = startFatMassKg + (totalDeltaKg * fatPartition)`;
`endBodyFatPct = round1((endFatMassKg / endWeightKg) * 100)`. If
`startBodyFatPct` is unknown, every downstream body-fat/FFMI field for
every phase is `null` — the chain cannot reconstitute a baseline that
was never provided (§5).

## 10. BMR/TDEE Evolution Across Phases

Every phase computes **both** a start-of-phase and end-of-phase
BMR/TDEE via `computeInitialNutritionPrescription`, called at that
phase's own start/end weight respectively:

```text
Phase 1 start weight = the diagnosis's own current.weightKg (InBody-
  measured BMR used here ONLY, when available — a real measurement of
  today's actual body).
Phase 1 end weight   = phase 1's own projected endWeightKg (§9) — BMR
  recomputed via Mifflin-St Jeor ALWAYS (a future body state was never
  measured, so it can never be labeled "inbody_measured" no matter what
  today's InBody said).
Phase 2 start weight = Phase 1's end weight (continuous chaining, master
  task §12 — never re-derived from the original starting state).
Phase 2 end weight   = Phase 2's own projected endWeightKg, and so on.
```

The phase's **actionable nutrition target** (calories/protein/carb/fat
shown as the headline number on its report card) is computed from its
**start-of-phase** state — the number that is actually relevant the
moment that phase begins, not a number that assumes the phase's own
not-yet-happened outcome. Both start and end TDEE are still shown
together on the phase card as a compact trend (`"TDEE: 2,222 → 2,211
kcal"`) so the user sees the metabolic-adaptation story without the
nutrition target itself being ambiguous about which state it was
computed from.

## 11. Context-Aware K-Grouping Rules

Phase types split into two classes:

```text
PRIMARY (defines a campaign bucket on its own):
  FAT_LOSS, MINI_CUT           -> bucket CUT
  LEAN_GAIN, RECOMPOSITION,
    PERFORMANCE                -> bucket BUILD
BRIDGE (contextual — meaning depends on neighbors):
  DIET_BREAK, MAINTENANCE, RECOVERY
```

Algorithm (single forward pass, deterministic, no AI):

```text
1. Walk the phase list left to right.
2. A PRIMARY phase joins the current open group if that group's bucket
   matches; otherwise it starts a new group.
3. A run of one or more consecutive BRIDGE phases is resolved as ONE
   unit by comparing:
     prevBucket = the bucket of the group immediately before the run
                  (null if the run is the very first thing in the list)
     nextBucket = the bucket of the next PRIMARY phase after the run
                  (null if the run is the very last thing in the list)
   - prevBucket == nextBucket (both known)  -> the whole bridge run
     joins the CURRENT group (the campaign continues through it) —
     this is the FAT_LOSS→DIET_BREAK→FAT_LOSS and
     LEAN_GAIN→RECOVERY→LEAN_GAIN cases from the master task.
   - prevBucket != nextBucket (both known)  -> the whole bridge run
     becomes its OWN standalone group, bucket=STABILIZE, labeled
     "Chuyển tiếp / Duy trì" — the genuine-transition case
     (FAT_LOSS→MAINTENANCE→LEAN_GAIN -> 3 groups).
   - prevBucket known, nextBucket null (trailing bridge, nothing after
     it) -> joins the CURRENT (previous) group, closing it out — e.g.
     MINI_CUT→MAINTENANCE stays one CUT campaign.
   - prevBucket null, nextBucket known (leading bridge, nothing before
     it) -> starts the NEXT group early (the upcoming primary phase
     then joins that same group) — e.g. DIET_BREAK→FAT_LOSS becomes one
     CUT campaign starting with the diet break.
   - both null (the entire roadmap is just this one bridge run) ->
     standalone STABILIZE group — the "DIET_BREAK alone"/"RECOVERY
     alone" cases.
```

No `RoadmapBlock`/`RoadmapCampaign` table — `deriveStrategyGroups()` is
a pure function over an already-in-hand `phases[]` array (either the
AI draft's pre-Save phases, or a persisted `RoadmapPhase[]` on reopen/
ACTIVE view), computed fresh every render/request, matching the prior
phase's own "pure presentation grouping" decision (still true, just
smarter now).

## 12. Persistence Decision

**Still no schema change.** `configuration.diagnosisSnapshot` is
extended with a sibling key, `configuration.roadmapProjectionSnapshot`
— the full `{ strategyGroups, phaseForecasts }` response the user
actually saw at Step 4, written once at Save/Start time exactly like
`aiDraft`/`diagnosisSnapshot` already are. `DraftRoadmapDetail` is
fixed to read this back (§3's gap) so a reopened DRAFT shows the same
rich report, not a bare phase list. This snapshot is explicitly
**display/audit-only** — never re-validated as a live computation,
never read by any backend service, never presented once a roadmap is
ACTIVE as anything other than "what we told you when you created this."

## 13. API Design

New route: `POST /fitness-roadmaps/projection` (read-only, zero DB
write, zero AI call — matches `/diagnosis`'s own contract exactly).
Kept **separate** from `/diagnosis` per the master task's own
suggested split ("diagnosis = current/target analysis; projection =
future phase-by-phase scenario") — `/diagnosis` already has a stable,
tested, unit-covered contract from the prior phase, and folding a
phase-array-dependent computation into it would force every existing
diagnosis caller (Step 2's energy-breakdown card, which has no phases
yet) to also pay for/receive projection data it doesn't use.

```text
Input:  the same current-state override fields /diagnosis accepts
        (weightKg/heightCm/age/gender/activityLevel/bodyFatPct/...),
        PLUS phases: Array<{ phaseType, plannedStartAt, plannedEndAt }>
        (accepts both the AI draft's pre-Save phase shape and a
        persisted RoadmapPhase[]'s shape — .passthrough() so extra
        fields on either don't fail validation).
Output: { strategyGroups: [...], phaseForecasts: [...],
          dataCompleteness: { bodyComposition: boolean } }
```

Internally, `fitnessRoadmapService` gains `getPhaseForecast(userId,
input)` (deliberately NOT named `getRoadmapProjection` — that name is
already taken by the existing, unrelated "reload the roadmap's current
DB state after a mutation" helper reused across activate/advance/
rebuild; reusing "projection" as a code identifier there would be
genuinely confusing, even though the word is fine in the route path,
UI copy, and this document). The new engine's pure functions live in a
new file, `fitness-roadmap-forecast.engine.ts`, to keep the same
separation `fitness-diagnosis.engine.ts` already established (pure
calculation, no I/O, importable and unit-testable standalone).

## 14. AI's Role — Unchanged, Reaffirmed

```text
Wizard inputs
  -> Diagnosis Engine        (current state, unchanged from prior phase)
  -> AI Roadmap Draft        (ai-service: phase TYPES + DURATIONS + reasons only)
  -> Phase Forecast Engine   (NEW, this phase: deterministic NUMBERS)
  -> Final Roadmap Report    (frontend composition of the above three)
```

AI never computes a number. If ai-service is unreachable, the existing
goal-aware deterministic fallback (`mapGoalTypeToFallbackPhaseType`,
unchanged) still produces a phase list, and the Forecast Engine — being
pure/local/no-AI-dependency, same discipline as the Diagnosis Engine —
still produces a full report from that fallback phase list. The report
never fails outright because of one missing optional metric; each
field is independently nullable.

## 15. UX Decisions (frontend, no new pages)

```text
Step 4 becomes: Fitness Diagnosis (unchanged) -> Roadmap Report summary
  (duration/end date/current->target, unchanged) -> collapsible
  strategy timeline (NEW): each K-group is a <details>-style collapsible
  section, first/current group open by default, later groups collapsed,
  header shows phase count + total weeks + a representative kcal/day
  range so a collapsed group is still informative. Each phase inside an
  expanded group renders a compact forecast card (dates, duration,
  deficit/surplus %, projected intake, weight/body-fat/FFMI start->end,
  start->end TDEE, protein/carb/fat, an explicit "Ước tính khi tạo lộ
  trình — sẽ điều chỉnh theo dữ liệu thực tế" label, and any
  phase-specific assumption text e.g. the recomposition/lean-gain
  partition notes from §9).
DraftRoadmapDetail (reopen): reads configuration.roadmapProjectionSnapshot
  and renders the same collapsible strategy timeline (read-only, no
  re-fetch) — fixes §3's gap.
ActivePhaseDetail (ACTIVE journey): unchanged real-data fields stay
  primary; if a roadmapProjectionSnapshot exists on the roadmap, adds
  one small note under the current phase's real NutritionGoal calories
  — "Dự kiến ban đầu: ~X kcal/ngày · Điều chỉnh từ dự kiến ban đầu dựa
  trên dữ liệu thực tế" — never visually equal-weighted with the real
  number.
Adaptive message: unchanged from the prior phase's own fix — rendered
  exactly once (the dedicated permanent paragraph), never duplicated
  inside reasoning text (already fixed and verified; this phase must
  not regress it — see docs/GYMINI_GUIDED_ROADMAP_E2E_REPORT.md §2).
```

## 16. Test Plan

```text
Unit (fitness-roadmap-forecast.engine.test.ts, new):
  deriveStrategyGroups — all 6 scenarios from the master task's §33 list
    (FAT_LOSS/DIET_BREAK/FAT_LOSS -> 1 group; LEAN_GAIN/RECOVERY/
    LEAN_GAIN -> 1 group; FAT_LOSS/MAINTENANCE/LEAN_GAIN -> 3 groups;
    MINI_CUT/MAINTENANCE -> 1 group; DIET_BREAK alone -> 1 group;
    RECOVERY alone -> 1 group), plus a leading-bridge case
    (DIET_BREAK/FAT_LOSS -> 1 group).
  forecastPhaseSequence — continuity (phase N start == phase N-1 end),
    conservative FAT_LOSS/LEAN_GAIN partitioning (never 100%), stable
    MAINTENANCE/DIET_BREAK/RECOVERY/RECOMPOSITION projection, missing
    body-fat -> every phase's body-fat/FFMI is null, BMR/TDEE evolves
    phase-to-phase, protein floor/calorie clamp respected (values
    literally equal computeInitialNutritionPrescription's own output —
    reused, not reimplemented).
  computeEnergyBreakdown (existing file, extended tests) — zero
    steps/training -> single "Hoạt động & tiêu hao khác" row, never a
    fabricated TEF line; nonzero steps/training -> real, separately
    labeled rows that still reconcile exactly to TDEE.
Integration (fitness-roadmap.service.integration.test.ts, extended):
  POST-equivalent getPhaseForecast — zero DB writes, zero TrainingCycle
    created; Save afterward still DRAFT/0 cycles; Start afterward still
    ACTIVE/1 phase/1 cycle (unchanged semantics, re-verified not just
    assumed).
Frontend build only (no unit-test runner in this repo, unchanged from
  the prior phase's own documented convention).
E2E (tests/31-fitness-roadmap.spec.ts, extended): real browser assertion
  that a FAT_LOSS/DIET_BREAK/FAT_LOSS draft renders as one K-group with
  3 phase cards, each visible phase card shows real forecast numbers,
  no duplicated adaptive message, Save -> reopen still shows a
  meaningful (non-bare) report, Start -> ACTIVE journey still works
  exactly as already verified.
```
