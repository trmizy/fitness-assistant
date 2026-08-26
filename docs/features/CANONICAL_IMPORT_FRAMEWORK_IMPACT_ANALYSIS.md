# Canonical Import Framework + Hevy Import — Impact Analysis

Date: 2026-08-25. Roadmap: P2 "Canonical import framework" (§14) +
P2.1 "Hevy import" (§15). Scope confirmed with the user: build the full
pipeline AND wire up one real provider (Hevy) end-to-end in this pass,
rather than framework-only against a synthetic fixture.

## Problem

A user with existing training history in Hevy/Strong/FitNotes has no way
to bring it into Fitness Assistant — they'd have to re-enter months of
history by hand or abandon it. The roadmap explicitly forbids building
"four unrelated importers" — the canonical pipeline (parser → canonical
format → normalization → exercise matching → preview → commit) must be
built once, with Hevy as the first real provider on top of it.

## Audit findings

- **`ImportBatch`/`ImportRecord` already exist, but for a different job.**
  They track Gate 5's *catalog* import pipeline (curated exercise/food
  data, admin/CLI-driven, no `userId` at all — one batch = one global
  admin run). A user-facing workout-history import is a different shape:
  per-user, needs a genuine two-phase preview/commit UX (not a CLI dry-run
  flag), and its useful summary stats are different (matched/unmatched
  exercise count, workouts/sets imported, duplicates skipped) from the
  catalog importer's (inserted/updated/skipped/duplicate/review/error
  counts). Reusing `ImportBatch` unchanged would mean bolting a nullable
  `userId` and a second, unrelated status vocabulary onto a table an
  active admin pipeline already depends on. **Decision: a new, separate
  model (`WorkoutImportBatch`) scoped to this feature**, not a retrofit —
  same reasoning already applied to Custom Exercises' separate
  `/exercises/custom` routes rather than retrofitting the public catalog
  endpoint.
- **`createWorkout`/`workoutRepository.create` (the existing "log a
  workout" primitive) cannot be reused unchanged for imports, for two
  real reasons found by reading the actual write path:**
  1. `workoutRepository.create` builds each exercise's `WorkoutSet[]` by
     repeating ONE uniform `{weight, reps}` value across `ex.sets` count
     (`Array.from({length: ex.sets}, () => ({weight: ex.weight, reps:
     ex.reps, ...}))`) — it assumes a flat prescription (e.g. "3×100kg×8"
     for every set), not real per-set variation (Set 1: 100kg×8, Set 2:
     102.5kg×6, Set 3: 95kg×10). A real Hevy export is exactly this kind
     of genuinely-varying per-set data — that's the entire value of
     importing it instead of re-entering a rough summary.
  2. `createWorkout(data.date, no scheduleId)` calls
     `assertScheduleDateEditable(new Date(data.date))`, which throws
     `ScheduleLockedError("past")` for any date that isn't literally
     today (the same "today-only" lock this session's Reschedule work
     (P1.2) audited and worked around directly, never widened). An
     import is inherently historical — months or years old — so this
     path would reject virtually every real imported workout.

  **Decision: a new commit path writes `Workout`/`WorkoutExercise`/
  `WorkoutSet` directly via Prisma** (mirroring `workoutRepository.
  create`'s nested-write shape and its `exerciseNameSnapshot` Gate-4
  history-protection convention, but taking real per-set values and never
  calling `assertScheduleDateEditable`). This is safe: the lock exists to
  stop a user from quietly rewriting a *live schedule slot's* date
  through the normal edit UI — an explicit, one-time bulk import of
  already-happened history is a different, deliberate action with no
  schedule slot involved at all (no `WorkoutSchedule` row is ever created
  for imported workouts — they are pure historical fact, matching §25's
  planned-vs-actual distinction: imports are "actual" with no "planned"
  counterpart).
- **`detectDuplicate` (reused for Custom Exercises' catalog dedup) isn't
  the right tool for exercise-name matching here either.** It compares
  two *full* exercise records (equipment + muscles + movement pattern).
  A Hevy CSV row only ever has a plain name string (`exercise_title`) —
  no equipment/muscle/movement data at all. **Decision: a dedicated,
  name-only matcher** — exact case/accent-insensitive match first, then
  token-overlap (Jaccard) fuzzy candidates, reusing the same technique
  `exercise-review.service.ts`'s own `rawNameJaccard` already uses (not
  imported — that function isn't exported, and it's a ~6-line pure
  function; a fresh scoped copy here matches this codebase's existing
  tolerance for that kind of small duplication over introducing a shared
  utils module for one function).
- **No frontend import UI exists anywhere** (`routes.tsx` has zero
  "import" routes) — this is genuinely greenfield on the frontend.
- **No CSV parsing library exists anywhere in this monorepo.** A small,
  dependency-free, header-driven (not positional) CSV parser is written
  for this pass rather than adding a new npm dependency for a single,
  well-scoped need.
- **Hevy's CSV export format is used from public documentation/community
  reference, not verified against a live Hevy export** (no live account
  available to this session). Targeted columns: `title, start_time,
  end_time, exercise_title, set_index, set_type, weight_kg, reps,
  distance_km, duration_seconds, rpe`. **This is a disclosed limitation,
  not a silent assumption**: the parser is header-driven and defensive
  (a missing/renamed column degrades to "field not present," a row that
  can't be parsed is reported as a per-row error in the preview response,
  never silently dropped or guessed) — a real-world format drift would
  surface as "0 workouts parsed, N row errors" for a user to see, not
  silent corruption. If Hevy's actual current export differs, this may
  need a follow-up adjustment once tested against a real export file.
- **Hevy's body-measurement export format is not confidently known**
  (unlike the workout CSV, no consistently documented public reference
  was found for a body-metrics export). **Scoped out this pass** —
  `ImportedBodyMeasurement` (from §14's conceptual list) is deferred; this
  import handles workout history only. Revisit alongside P2.4 (Apple
  Health/Health Connect), which already needs a body-measurement
  provenance/precedence model.

## Scope decisions

- **Hevy only this pass** (not Strong/FitNotes) — per §14/§15/§16/§17,
  each other provider is meant to be "a thin provider parser on top of
  the canonical framework." Strong/FitNotes are separate, smaller
  follow-up passes once this pipeline exists and is proven.
- **Workout history only, no body measurements** (see above).
- **Exercise resolution requires an explicit user choice per distinct
  exercise name** — exact match auto-suggested but still shown for
  confirmation, fuzzy candidates require a pick, no match requires either
  "create as custom" (reusing P1.5's `createCustomExercise` unchanged,
  including its own duplicate-block/confirm flow) or "skip this
  exercise" (its sets are excluded from commit, explicitly reported in
  the summary — never silently dropped). No automatic low-confidence
  mapping, matching the same rule §10 (Custom Exercises) already states.
- **Idempotency without touching the `Workout` schema**: each parsed
  Hevy workout gets a deterministic `sourceHash` (hash of title +
  start_time + its set rows). `WorkoutImportBatch.committedSourceHashes`
  accumulates hashes actually committed. Before committing a NEW batch,
  any of its workouts whose hash already appears in ANY of this user's
  past committed batches is skipped (reported as "already imported," not
  re-inserted, not erroring) — re-uploading the same export file twice is
  safe by construction, with zero changes to `Workout`/`WorkoutExercise`.
- **No multipart upload/`multer`.** The CSV is small text — the frontend
  reads the `File` via `file.text()` and posts it as a JSON string field.
  Avoids adding a new dependency+middleware stack (multer exists
  elsewhere in this monorepo, but not in fitness-service) for a need a
  route-scoped larger `express.json()` body limit already solves.
- **Preview batch state (`parsedWorkoutsJson`) lives on `WorkoutImportBatch`
  itself, not a row-per-workout staging table.** A preview is a
  short-lived, single-user, single-flow concept — one JSON blob scoped to
  one batch is simpler than a full relational staging schema, and
  matches "keep it as small as the need, not as small as it could
  theoretically be trimmed to."

## Affected models (fitness-service)

New, additive-only:

```
WorkoutImportBatch {
  id, userId, source ("HEVY"), fileName,
  status (PREVIEW | COMMITTED | CANCELLED),
  parsedWorkoutsJson Json   // canonical ImportedWorkout[] staged for preview
  matchSummaryJson   Json   // per-exercise-name match candidates computed at preview time
  createdWorkoutIds  String[]  // real Workout ids created on commit — audit trail
  committedSourceHashes String[] // per-workout hashes actually committed, across the user's whole import history — idempotency
  createdAt, committedAt
}
```

No changes to `Exercise`, `Workout`, `WorkoutExercise`, `WorkoutSet`, or
any existing model.

## Affected services

New: `import.service.ts` (`previewHevyImport`, `commitImportBatch`,
`cancelImportBatch`, `listImportBatches`), `hevy-csv-parser.util.ts`
(pure), `exercise-name-matcher.util.ts` (pure). Reuses
`exerciseService.createCustomExercise` unchanged for "create as custom"
resolutions.

## Affected frontend

New `/client/import` page (file picker → preview → per-exercise
resolution, reusing the same enum/loggingMode select fields as P1.5's
`CreateCustomExerciseModal` for "create as custom" rows → commit → real
summary). New nav entry.

## Domain invariants

- Imported data never creates a `WorkoutSchedule` row (no "plan" side —
  pure historical fact, matching §25).
- Every `WorkoutSet` created by an import is `completed: true` (Hevy only
  exports completed sets).
- `exerciseNameSnapshot` is populated at commit time, same Gate-4
  convention every other write path already follows.
- Committing is per-distinct-exercise-name resolvable, but per-workout
  atomic: a workout is either fully committed (all its resolved
  exercises) or fully skipped (already-imported duplicate) — never
  partially written mid-transaction.
- Re-uploading the same file (or a re-export containing already-imported
  sessions) never creates duplicate `Workout` rows.

## Migration risk

Low — one new, additive, feature-scoped table. No existing model touched.

## Test plan

Unit: CSV parser (headers, quoted fields with commas, malformed rows
report per-row errors not silent drops); workout-grouping (same
title+start_time → one workout, multiple set rows); exercise-name
matcher (exact match, accent/case-insensitive, fuzzy candidates ranked,
no-match returns empty); source-hash determinism (same input → same
hash, different input → different hash).

Integration: preview creates a real `PREVIEW` batch with real parsed
data + match summary against the real seeded catalog; commit creates
real `Workout`/`WorkoutExercise`/`WorkoutSet` rows with correct per-set
values (not the old uniform-value bug); commit with a "create custom"
resolution creates a real custom exercise via the unchanged P1.5 path;
re-committing a batch containing an already-imported workout skips it
(no duplicate `Workout` row) and reports it; cancel marks `CANCELLED`
and commits nothing.

Browser E2E: upload a real (fixture) Hevy-format CSV through the actual
file input, see the real preview (workout count, exercise resolution
rows), resolve one exercise as "match existing" and one as "create
custom" via the real form, commit, verify the real created workout shows
up in workout history with correct per-set data, re-upload the same file
and verify the duplicate workout is reported as skipped rather than
re-imported.

## Real bugs found and fixed during implementation

1. **Vietnamese `đ`/`Đ` broke exact-match detection.** The exercise-name
   matcher's first version stripped accents by hand via NFD + combining-
   mark removal — which does NOT touch `đ`/`Đ` (a distinct base letter in
   Unicode, not a base+diacritic pair), so a name like "Đẩy Tạ Đòn Nằm
   Ngang" normalized to nonsense with the `đ` characters dropped entirely,
   silently downgrading what should have been an exact match to a weak
   fuzzy one (~0.43 confidence instead of 1.0) — a real problem for a
   catalog this Vietnamese-heavy. Caught by this file's own unit test.
   Fixed by reusing `normalizeVietnamese` (already correct, already used
   elsewhere in this codebase for exactly this) instead of a second, flawed
   copy of the same logic.
2. **A non-ISO date string ("8 Jan 2024, 09:15") parsed one calendar day
   early.** The first version of the date parser fell back to
   `new Date(dateOnlyString)` for non-ISO formats, which JS treats as
   LOCAL midnight (implementation-defined for non-ISO input) — then
   `.toISOString()` converts that through the running process's own
   timezone, silently shifting the date back a day on a host/container set
   to a positive UTC offset. The exact same class of bug this session's
   own "Smart set-by-set prefill" milestone already found and documented
   for Prisma + naive timestamps. Caught by this file's own unit test.
   Fixed by never delegating to timezone-dependent `Date` parsing at all —
   every supported format is matched via regex and built directly from
   the extracted digits/month-name.

## Verified results

**Unit** (pure, no DB) — 18/18 passing:
`hevy-csv-parser.util.test.ts` (CSV quoting/escaping, `\r\n` handling,
workout grouping by title+start_time, distance_km→meters conversion,
per-row error reporting for missing/unparseable fields, sourceHash
determinism) + `exercise-name-matcher.util.test.ts` (exact match incl.
Vietnamese accents, fuzzy ranking, no-match returns empty, limit
respected).

**Backend integration** (`import.service.integration.test.ts`, against
`gymcoach_fitness_test`, real seeded catalog) — 8/8 passing: preview
parses and matches real data; a future-dated workout is excluded and
reported; commit with `USE_EXISTING` writes real PER-SET VARYING values
(the exact claim this milestone exists to prove — not the old uniform-
value bug), `completed: true`, and never creates a `WorkoutSchedule` row;
commit with `CREATE_CUSTOM` creates a real custom exercise via the
unchanged P1.5 path and uses it; `SKIP` excludes only that exercise's
sets without failing the rest of the workout; re-importing the same
workout twice creates zero duplicate `Workout` rows (real idempotency);
cancel commits nothing; ownership is enforced (another user gets 404).
`tsc --noEmit` clean on fitness-service and the gateway.

**Browser E2E** (`tests/42-import-hevy-workouts.spec.ts`, real dev
stack) — 1/1 passing (45.2s): uploads a real Hevy-format CSV through the
actual file input at `/client/import-workouts`, previews it, resolves an
exact-matched exercise (pre-selected) and an unmatched one via the real
"create custom" inline form, commits, verifies via direct DB query that
the created `Workout`/`WorkoutSet` rows have correct per-set varying
weight/reps and no `WorkoutSchedule` row exists, then re-uploads the
identical file and verifies the UI reports the duplicate and commits
zero additional workouts.

**Regression**: 13 specs touching `ProfilePage` (where the new "Nhập
lịch sử tập luyện" entry point was added) — 13/13 still passing.

