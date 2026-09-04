# JSON / CSV Export — Impact Analysis

Date: 2026-08-25. Roadmap: P2.5 "Export / data portability" (§19).

## Why

§19: "Fitness Assistant should allow users to take their data out.
Potential: JSON export, CSV workout-history export. Export should
include stable identifiers and normalized units. Do not expose internal
secrets/operational metadata."

## Audit findings

- **§19's own wording distinguishes the two formats' scope**: "JSON
  export" (no qualifier — everything) vs. "CSV workout-history export"
  (explicitly scoped to workout history only). This pass follows that
  distinction literally rather than inventing a broader CSV shape: JSON
  exports the user's full exportable data (workout history + body
  metrics), CSV exports workout history only, one row per set — the same
  row-per-set shape this session's own Hevy/Strong import parsers
  already read, so a user's export is at least structurally similar to
  what they could bring back in (not a promised guarantee, since
  `commitImportBatch`'s exercise-name matcher still needs real matching
  against each catalog).
- **Auditing `Workout`/`WorkoutExercise`/`WorkoutSet`/`BodyMetrics` for
  "internal secrets/operational metadata" to strip**: none of these
  tables contain anything resembling a secret (no tokens, no payment
  data — this service's schema doesn't mix those concerns). The
  meaningful judgment call is `userId` — every row already implicitly
  belongs to the requesting user (enforced by the query's own `WHERE
  userId = req.user.id`), so re-including it in each exported record
  would be redundant operational plumbing, not useful data — left out.
  `exerciseNameSnapshot` (Gate-4's internal history-protection field) is
  also left out — the export uses the LIVE joined exercise name instead,
  which is what a human reading their own export actually wants to see.
  Real database row ids (`Workout.id`, `Exercise.id`) ARE included —
  §19's own text asks for "stable identifiers," and an id is exactly
  that, not a secret.
- **Nutrition logs are out of scope for this pass.** §14–§20's own
  section is framed entirely around WORKOUT data portability (import
  targets, `ImportedWorkout`/`ImportedExercise`/`ImportedSet`/
  `ImportedBodyMeasurement` in §14's own conceptual list); nutrition
  export isn't mentioned anywhere in this section. Scoped out, matching
  the same "additive, can extend later" discipline as every other
  deliberate scope narrowing this session.
- **No existing export endpoint or download UX anywhere in this
  codebase** — genuinely greenfield, mirroring the same audit result
  Import (P2/P2.1) found for its own upload UX.

## Scope decisions

- **JSON = workout history + body metrics. CSV = workout history only**
  (one row per set), matching §19's own wording exactly (see above).
- **New `/exports` route family** (`export.service.ts`/
  `export.controller.ts`/`export.routes.ts`), mirroring `/imports`'
  naming and file structure exactly — the two features are the same
  "data portability" concern in opposite directions.
- **Units are always normalized to this app's own internal convention**
  (kg, meters) — the export never needs a per-row unit column the way an
  import from an external provider does, since there's only ever one
  source (this app) and it already stores everything normalized.
- **No pagination/date-range filtering this pass** — a full export of
  everything the user has, in one request. A user's total workout/
  body-metric history is bounded (real people log a few hundred to a
  few thousand sets over years, not millions), and this mirrors how the
  import side also handles a whole file in one request rather than
  paging it in.
- **Read-only** — this feature can never mutate anything; the entire
  service is two SELECT-shaped functions and a serializer.

## Affected models

None — pure read of existing `Workout`/`WorkoutExercise`/`WorkoutSet`/
`BodyMetrics` tables.

## Affected services

New `export.service.ts` (`buildExportData`, `toCsv`), `export.controller.ts`,
`export.routes.ts`.

## Affected frontend

New "Xuất dữ liệu" (Export data) entry point on `ProfilePage.tsx`
(mirroring the "Nhập lịch sử tập luyện" entry point P2.1 added), a small
`/client/export-data` page offering JSON/CSV download buttons, real
browser file downloads (no capability beyond what a normal `<a
download>` blob URL already provides — this is the real product app, not
a sandboxed artifact).

## Domain invariants

- Export is strictly read-only — never creates, updates, or deletes
  anything.
- Every exported weight is kg, every exported distance is meters — no
  ambiguity, no per-row unit column needed (unlike an import from an
  external, unit-ambiguous source).
- `userId` is never included in the exported payload — it's already
  implicit (100% of the rows in any one export belong to the requesting
  user, enforced by the query itself), and printing it back out would
  just be a copy of the same one value repeated on every row.

## Migration risk

None — no schema change.

## Test plan

Unit: CSV serialization (correct headers, correct escaping of a workout
name containing a comma/quote, correct kg/meters values, one row per
set including a multi-set exercise as multiple rows).

Integration: JSON export returns real workouts+body metrics scoped to
the requesting user only (another user's data never leaks in);
`userId`/`exerciseNameSnapshot` are never present in the payload;
`Workout.id`/`Exercise.id` ARE present; CSV export is real, parseable
CSV text with the correct row count for a multi-set fixture.

Browser E2E: open the real export page, download the real JSON file
(read its content directly via the download event, not just check a
button exists), download the real CSV file, verify both contain the
real workout data the test itself set up.

## Verified results

**Unit** (`export-csv.util.test.ts`) — 5/5 passing: header row, one row
per set including a multi-set exercise, correct comma/quote escaping,
empty-list edge case, multiple workouts flattening correctly.

**Backend integration** (`export.service.integration.test.ts`, against
`gymcoach_fitness_test`, real seeded catalog) — 2/2 passing:
`buildExportData` returns real workouts + body metrics scoped strictly
to the requesting user (a second user's own seeded workout never
appears), uses the LIVE exercise name rather than the internal
`exerciseNameSnapshot`, and the exported JSON never contains a `userId`
field or another user's id anywhere in the payload; `workoutsToCsv` on
real exported data produces correctly-shaped, parseable CSV text.
`npx tsc --noEmit` clean (fitness-service + gateway).

**Browser E2E** (`tests/45-export-data.spec.ts`) — 1/1 passing (43.0s):
seeds a real workout + body metric directly in the DB, downloads both
the JSON and CSV files through the real UI, reads each downloaded
file's actual content (not just checking a button exists), and confirms
the real seeded data is present with correct values in both formats,
with no `userId` field leaked in the JSON.

**Regression**: `tests/42-import-hevy-workouts.spec.ts` (shares the
`ProfilePage.tsx` entry-point pattern this pass also touched) +
`tests/13-training-cycle-fixes.spec.ts` (exercises `ProfilePage`
directly) — 3/3 still passing.
