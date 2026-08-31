# FitNotes Import — Impact Analysis

Date: 2026-08-25. Roadmap: P2.3 "FitNotes import" (§17).

## Why

Completes the 3-provider trio the canonical import framework (P2/§14)
was built to support without becoming "four unrelated importers." §17
itself flags what to watch for going in: "exercise naming differences;
unit preferences; set-type conventions; historical timestamps" — this
pass audits FitNotes' actual export shape rather than assuming it
mirrors Hevy/Strong's.

## Audit findings

- **FitNotes' export has NO workout-session concept at all** — unlike
  Hevy (`title`/`start_time`) and Strong (`Workout Name`/`Date` with a
  time-of-day), FitNotes logs one row per SET against a plain calendar
  `Date` (no time-of-day). There is no session title, no start/end time,
  nothing to group by except the date itself. **Real, disclosed
  limitation**: if a user trained twice on the same calendar day (e.g.
  morning cardio + evening weights), FitNotes' own export cannot
  distinguish them — this importer necessarily merges everything logged
  on one date into a single `ImportedWorkout` for that date, because
  that boundary genuinely doesn't exist in the source data. This is not
  a parsing bug to fix; it's the real shape of what FitNotes exports.
- **No per-row set-order column either** — Hevy has `set_index`, Strong
  has `Set Order`; FitNotes has neither. Set order is recovered
  positionally (row order within the file, per exercise per date) —
  same fallback both other parsers already use when their own
  order-column is absent/unparseable.
- **Targets FitNotes' publicly/community-documented CSV columns**:
  `Date, Exercise, Category, Weight, Weight Unit, Reps, Distance,
  Distance Unit, Time, Comment`. This is the LEAST verified of the three
  provider formats this session has built against — no live FitNotes
  export was available to check, and FitNotes' own public documentation
  of its exact export schema is thinner than Hevy's or Strong's. Same
  discipline as before: header-driven, defensive, a format drift
  surfaces as row-level errors in the preview response, never silent
  corruption — but this one may need real-world adjustment sooner than
  the other two.
- **`Weight Unit`/`Distance Unit` are per-row, like Strong** (kg/lb,
  km/mi/m) — the SAME conversion functions written for Strong import
  (§16) are reused unchanged, not reimplemented a third time.
- **`Time` format is uncertain** — could plausibly be plain seconds or an
  `HH:MM:SS`/`MM:SS` formatted string depending on FitNotes version.
  Handled defensively: try a plain number first, then `HH:MM:SS`/`MM:SS`
  via regex; genuinely unparseable values are left `null` (never
  guessed) rather than blocking the whole row.
- **No per-workout notes concept** — `Comment` is per-SET in FitNotes'
  export (like Hevy's `exercise_notes` and Strong's per-set `Notes`,
  neither of which is mapped anywhere in this pipeline either — `ImportedSet`
  has no notes field). `ImportedWorkout.notes` is left `null` for
  FitNotes imports, consistent with "don't invent a field the canonical
  shape doesn't have."
- **`Category` is not mapped to anything** — no body-part/muscle field
  exists on `ImportedExercise`, and guessing one from FitNotes' own
  free-text category would be exactly the "automatic low-confidence
  mapping" the roadmap repeatedly forbids. The user still explicitly
  classifies any exercise they choose to create as custom, same as every
  other provider.

## Scope decisions

- **Same page, third provider option — not a third page or a second
  framework.** `/client/import-workouts`'s Hevy/Strong selector gains
  "FitNotes"; `previewFitNotesImport` is another thin wrapper around the
  same `previewFromParsed`/`commitImportBatch` pipeline.
- **Workout title defaults to a generic "Buổi tập" (workout session)**
  label, since FitNotes' export has no session-name field to use — the
  real distinguishing information (the date) is already shown separately
  in the preview/history UI, so this isn't a loss of real data, just an
  honest reflection of what the source format does and doesn't contain.
- **No attempt to split same-day rows into multiple sessions by any
  heuristic** (e.g. large time gaps) — FitNotes' export has no
  time-of-day data to do that with at all; a heuristic here would be
  actual guessing, not defensive parsing.

## Affected models

None — reuses `WorkoutImportBatch` unchanged (`source: "FITNOTES"`).

## Affected services

`import.service.ts`: `previewFitNotesImport` added (thin wrapper, same
pattern as `previewStrongImport`). New `fitnotes-csv-parser.util.ts`,
built on the same shared `csv-parser.util.ts`/`import-date-parser.util.ts`/
`import-source-hash.util.ts`/`import-canonical.types.ts` modules P2.2
already extracted — confirms those extractions were the right call, this
is the second consecutive provider added without touching the shared
pipeline itself.

## Affected frontend

`ImportWorkoutsPage.tsx`'s provider selector gains a third option.
`importService.previewFitNotes` added to `api.ts`.

## Domain invariants

Unchanged from Hevy/Strong — idempotency, exercise matching, and the
"never auto-map without an explicit choice" rule are identical
regardless of provider, enforced by construction (every parser produces
the same canonical shape).

## Migration risk

None — no schema change.

## Test plan

Unit: FitNotes CSV grouping by Date ALONE (no session title/time);
positional set-numbering when no order column exists; lb->kg and
km/mi/m->meters conversion (reusing the same logic, not reimplementing
it); `Time` parsed as plain seconds AND as `HH:MM:SS`/`MM:SS`; missing-
field/unparseable-date row errors; sourceHash determinism; two same-day,
different-exercise rows correctly merge into ONE workout (the real,
disclosed session-boundary limitation, proven rather than just claimed).

Integration: a real preview→commit round trip through
`previewFitNotesImport`, proving the merged-by-date grouping and unit
conversion survive into real committed `Workout`/`WorkoutSet` rows,
tagged `source: "FITNOTES"`.

Browser E2E: select "FitNotes" on the real `/client/import-workouts`
page, upload a real FitNotes-format CSV, preview, resolve, commit,
verify via direct DB query.

## Verified results

**Unit** (`fitnotes-csv-parser.util.test.ts`) — 9/9 passing, including
the specific test proving two same-date, different-exercise rows
correctly merge into ONE `ImportedWorkout` (the real, disclosed
limitation, not just asserted in prose). `Time` parsing covers plain
seconds, `MM:SS`, `HH:MM:SS`, and a genuinely unparseable value (left
`null`, never guessed, never blocks the row). Existing Hevy/Strong/
matcher unit suites re-run after extracting the shared unit-conversion
functions — 26/26 still passing, zero behavior change.

**Backend integration** (`import-fitnotes.service.integration.test.ts`,
against `gymcoach_fitness_test`) — 1/1 passing, focused (the shared
commit path is unchanged and already covered by Hevy's own suite):
proves the merged-by-date grouping survives into a real committed
`Workout` with both real `WorkoutSet` rows intact, tagged
`source: "FITNOTES"`, notes correctly say "Nhập từ FitNotes". Full
combined import test bundle (Hevy + Strong + FitNotes, unit +
integration): 45/45 passing. `npx tsc --noEmit` clean.

**Browser E2E** (`tests/44-import-fitnotes-workouts.spec.ts`) — 1/1
passing (40.6s): selects "FitNotes" via the real provider selector,
uploads a real FitNotes-format CSV with two rows on the same date,
previews (workout count = 1, proving the merge through the real UI, not
just the service layer), resolves an exact match, commits, verifies via
direct DB query that both sets landed on the one merged workout.

**Regression**: `tests/42-import-hevy-workouts.spec.ts` +
`tests/43-import-strong-workouts.spec.ts` (both providers most at risk
from the shared unit-conversion extraction) — 2/2 still passing.
