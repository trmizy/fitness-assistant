# Muscle Heatmap — Impact Analysis

Date: 2026-08-25/26. Roadmap: P3.1 "Muscle heatmap" (§21), first item in
the P3 (Visualization and retention) tier — every P1 and P2 item (except
the environment-blocked Health Integration, §18) is now done.

## Why

Visualize real training exposure per muscle group over a time window —
not a claim of exact physiological stimulus, an explicit product
heuristic (§21's own framing).

## Scope confirmed with the user before implementation

§21 itself flags the primary/secondary weighting as "a product heuristic
unless validated otherwise" and lists 4 time-range options — both are
real product decisions, not pure engineering choices, so both were
confirmed explicitly rather than picked unilaterally:

- **Weighting: primary = 1.0, secondary = 0.5`** — the roadmap's own
  worked example, chosen as-is.
- **Time ranges: all 4 from §21 in this pass** — 7 days, 30 days,
  current training cycle, and a custom date range (not the smaller
  7d+30d-only MVP that was also offered).

## Audit findings

- **Muscle-mapping data already has near-total real coverage** — checked
  directly rather than assumed: 986 exercises have at least one
  `ExerciseMuscle` row (883 published + some staging), 1054 `primary`
  links, 1938 `secondary` links, across 29 canonical `Muscle` rows. This
  is a real, substantial foundation, not a sparse/mostly-empty table.
- **A real anatomical body-chart renderer already exists and is
  reusable, found by reading `ExerciseMuscleMap.tsx` before building
  anything new**: the `body-muscles` npm package (Apache-2.0, already
  license-vetted in this codebase — see
  `docs/research/fitness-data-source-and-license-review.md`) renders a
  real front/back SVG body via `BodyChart`/`BodyState` (`{ [regionId]:
  { intensity: 0-9, selected } }`), driven by the existing
  `MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS` lookup — the SAME lookup this
  heatmap reuses unchanged. `ExerciseMuscleMap.tsx` already proves this
  library end-to-end for the PER-EXERCISE case (hardcoded intensity 9 for
  primary, 4 for secondary); this pass computes a REAL per-muscle numeric
  score from aggregated history and normalizes it into that same 0-9
  intensity scale, rather than inventing a second body-diagram renderer.
- **`TrainingCycle { startDate, endDate, status }` already exists** —
  "current cycle" range is the user's `ACTIVE` cycle's
  `[startDate, min(endDate, today)]`, reusing the existing
  `trainingCycleService.getActiveCycle` 404-when-none-active behavior
  directly (surfaced to the UI as an explicit "no active cycle" state,
  never a silent empty chart with no explanation).
- **§21's own "Do not include" instruction — warm-ups must not count as
  equal hard volume** — `WorkoutSet.setType === "WARMUP"` sets are
  excluded from the score entirely. Sets with no `setType` (the vast
  majority — it's an optional advanced field) are treated as working
  sets, the same "unclassified = working set" convention this schema's
  own column comment already documents.
- **Scored per completed WORKING SET, not per exercise** — §21's own
  wording ("For each completed working set: primary muscle contribution
  / secondary muscle contribution") is explicit about the unit; an
  exercise done for 4 sets contributes 4x what the same exercise done
  for 1 set would, which is the whole point of a real training-exposure
  view rather than a flat "did you touch this muscle at all" checkbox.

## Scope decisions

- **New `/stats/muscle-heatmap` endpoint** on the existing `stats`
  route family (not a new route prefix) — this is exactly the kind of
  aggregate-stats concern `stats.service.ts` already owns.
- **Intensity is normalized against the MAX score within the returned
  result set** (not a fixed absolute scale) — there's no external
  reference to compare against, so "relative to your own week/cycle" is
  the only defensible normalization; a muscle with zero real exposure in
  the window is left out of the body-chart state entirely (unshaded),
  never shown with a fabricated nonzero intensity.
- **Unmapped exercises are silently excluded from the score** (not
  errored, not guessed) — the existing per-exercise `getMuscleMap`
  already treats "no `ExerciseMuscle` rows" as an explicit `mapped:
  false` state; the aggregate heatmap just skips those sets' contribution
  rather than surfacing a per-set warning, since at 986/883+ coverage
  this is a rare edge case, not the common path.

## Affected models

None — pure aggregate read of existing `WorkoutSet`/`WorkoutExercise`/
`Workout`/`ExerciseMuscle`/`Muscle`/`TrainingCycle` data.

## Affected services

`stats.service.ts`: new `getMuscleHeatmap(userId, rangeParams)`.
`stats.controller.ts`/`stats.routes.ts`: new `GET /stats/muscle-heatmap`
endpoint (`range=7d|30d|cycle|custom`, `from`/`to` for `custom`).

## Affected frontend

New `MuscleHeatmapChart.tsx` component (mirrors `ExerciseMuscleMap.tsx`'s
`BodyChart` integration, sourced from the new aggregate endpoint instead
of the per-exercise one), a range-selector (7d/30d/cycle/custom with a
real date-range picker), reachable from a new `/client/muscle-heatmap`
page with a `ProfilePage.tsx`/nav entry point (mirroring the
Import/Export/Templates entry-point pattern already established) — or,
given this is a genuinely visualization-first feature, from the
Dashboard, whichever the actual implementation finds fits best without
overcrowding.

## Domain invariants

- Never counts a `WARMUP`-tagged set as equal to a working set.
- Never fabricates a nonzero intensity for a muscle with zero real
  exposure in the selected window.
- `custom` range dates are parsed the same timezone-safe way every other
  date in this codebase already is (never `new Date(dateOnlyString)` —
  see this session's own real bug history on that exact class of parsing
  mistake in the Hevy import parser).

## Migration risk

None — no schema change.

## Test plan

Unit: score aggregation (primary=1.0/secondary=0.5, WARMUP excluded,
unclassified setType counts as working), intensity normalization against
the result set's own max, an exercise with no muscle mapping contributes
nothing (never crashes, never guessed).

Integration: `getMuscleHeatmap` for each of the 4 range modes returns
real, correctly-scoped scores from real seeded `WorkoutSet` history
(7d/30d date-boundary correctness; `cycle` mode reflects the user's real
`ACTIVE` `TrainingCycle` window and reports an explicit "no active
cycle" state when there isn't one; `custom` respects the given
`from`/`to`); a warm-up set contributes zero; only the requesting user's
own data is ever included.

Browser E2E: a real user with real completed history opens the heatmap,
switches between range options, sees the real body chart reflect the
real seeded muscle exposure (verified against the same score the API
returns, not just "a chart renders").

## Real bug found and fixed during implementation

While seeding real test fixtures (a deliberate choice throughout this
session — real seeded data, not synthetic mocks, for exactly this
reason), the very first real exercise tried (`Barbell Curl`, then
`Barbell Bench Press - Medium Grip`) returned ZERO muscles when joined
through `ExerciseMuscle` → `Muscle`, despite `exercise_muscles` clearly
having rows for them. Investigation found the `gymcoach_fitness_test`
database's ENTIRE `exercise_muscles` table (2992 rows, both
`free_exercise_db`- and `curated_vi_catalog`-sourced) referenced
`muscle_id` values that did not exist in that database's own `muscles`
table — a complete, 100% orphan rate, not a partial/edge-case gap.

**Root cause**: `Muscle.id` is a `@default(uuid())` value with no stable
natural key backing it (the real stable key is `Muscle.code`) — at some
point the test database's `muscles` table was independently re-seeded,
generating fresh UUIDs, while the already-populated `exercise_muscles`
rows still pointed at the OLD (dev-database-only) UUIDs. A real
`muscle_id` FK constraint with `ON DELETE CASCADE` does exist and
prevents this going forward (any row deleted from `muscles` now
correctly cascades), but it doesn't retroactively fix data that was
already wrong before/around whenever that constraint was last
established.

**Scope, confirmed directly rather than assumed**: `gymcoach_fitness`
(dev) was checked and found fully valid — 2992/2992 real, correctly-
joining rows. This is a **test-database-only** data-integrity issue, not
a live/production bug — the existing Gate 6 muscle-map UI
(`ExerciseMuscleMap.tsx`, `GET /exercises/:id/muscle-map`) was never
actually broken for real users. But it meant this milestone's own
integration tests (and, it turns out, this is the FIRST test in this
whole session's history to exercise the `ExerciseMuscle` join against
the test DB at all) would have found zero real data to score against.

**Fix**: re-ran the existing `exerciseMuscleMappingImporter.ts` (Gate
6's own importer, already idempotent-by-design — it re-resolves
`muscleId` fresh from the current `muscles` table by `code` every run)
against `gymcoach_fitness_test`, which correctly regenerated all 2992
mappings with valid, current `muscle_id` values (2992 inserted, 43
already-correct rows skipped as duplicates). Then deleted the 2992
leftover orphaned rows (garbage — could never join, no data lost by
removing them). Verified: 2992/2992 valid post-fix, matching dev exactly.

## Verified results

**Unit** (`muscle-heatmap.util.test.ts`) — 7/7 passing: primary=1.0/
secondary=0.5 weighting scored per completed working set, multi-exercise
accumulation onto the same muscle, an exercise with no muscle links
contributes nothing, intensity normalization against the result set's
own max (including the "even a small nonzero score gets a visible
minimum intensity of 1" and "a zero-score muscle is left out entirely"
cases).

**Backend integration** (`muscle-heatmap.service.integration.test.ts`,
against `gymcoach_fitness_test`, real seeded catalog exercises with real
`ExerciseMuscle` mappings — after the orphaned-data fix above) — 4/4
passing: `7d` scores correctly (WARMUP excluded, out-of-range workout
excluded, another user's data never leaks in); `30d` includes a workout
`7d` correctly excludes; `cycle` uses the real `ACTIVE` `TrainingCycle`
window and reports an explicit `noActiveCycle: true` state when there
isn't one; `custom` respects explicit `from`/`to` and rejects an invalid
range with a real 400. `npx tsc --noEmit` clean.

**Browser E2E** (`tests/47-muscle-heatmap.spec.ts`) — 1/1 passing
(23.8s): real seeded completed-set history (3 working sets of a real
`abs`-mapped exercise, 1 set of a real `side_delts`/`forearms`-mapped
exercise 20 days ago) aggregates into the real chart + legend, correctly
reflecting the real per-range scoring — the 30d range shows both real
scores, the 7d range correctly drops the 20-day-old contribution, a wide
custom range brings it back — all verified against the actual computed
score values shown in the UI, not just "a chart renders."

**Regression**: `tests/25-exercise-muscle-map.spec.ts` (Gate 6's own
per-exercise muscle-map spec, sharing the `body-muscles`
library/`muscleRegionMap` this pass reuses) + `tests/13-training-cycle-fixes.spec.ts`
(exercises `ProfilePage.tsx`, which this pass also touched) — 4/4 still
passing.
