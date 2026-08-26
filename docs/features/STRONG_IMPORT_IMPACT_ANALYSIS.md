# Strong Import — Impact Analysis

Date: 2026-08-25. Roadmap: P2.2 "Strong import" (§16).

## Why

§16 is explicit: "Same canonical pipeline. Do not create Strong-specific
domain fields unless they are raw import metadata." The whole point of
building the canonical import framework first (P2/P2.1) was so this pass
is genuinely small — a parser, not a second pipeline.

## Audit findings

- **The framework built for Hevy (P2.1) was already fully generic** where
  it mattered — `commitImportBatch` operates only on the canonical
  `ImportedWorkout[]` shape and never references "Hevy" anywhere. Only
  `previewHevyImport` was Hevy-specific (it called `parseHevyCsv`
  directly). Extracted the shared preview logic into
  `previewFromParsed(userId, source, fileName, parsed)`, with
  `previewHevyImport`/`previewStrongImport` now both thin wrappers —
  confirms the framework's own design goal held up on first reuse.
- **Three small pieces of Hevy's parser were genuinely reusable, not
  Hevy-specific, and were duplicated by the first version of this pass**:
  the RFC4180 CSV tokenizer, the timezone-safe flexible date parser, and
  the source-hash function. Extracted each into its own shared file
  (`csv-parser.util.ts`, `import-date-parser.util.ts`,
  `import-source-hash.util.ts`) plus a shared `import-canonical.types.ts`
  for the `ImportedWorkout`/`ImportedExercise`/`ImportedSet` shapes —
  `hevy-csv-parser.util.ts` now imports these too (with a backward-compat
  re-export so its existing test suite needed zero changes). This is the
  concrete shape of "a thin parser on top of the canonical framework"
  §16 asks for.
- **Strong's export format has one genuinely different wrinkle Hevy's
  doesn't**: Hevy always exports weight in kg (`weight_kg` column name
  says so); Strong lets the user's account be set to kg OR lb and
  exports the unit PER ROW (`Weight Unit` column). Same for `Distance`/
  `Distance Unit` (km/mi/m). This is the one real piece of provider-
  specific logic this pass adds — unit conversion to this app's own kg/
  meters convention, so downstream code never has to care which unit a
  given row came from.
- **Strong's CSV has no per-set warmup/failure classification column**
  (unlike Hevy's `set_type`) — `setType` is left `null` for every Strong-
  imported set, the same "don't force a classification the source data
  doesn't carry" rule Hevy's parser already follows for its own unmapped
  `set_type` values (e.g. "dropset").
- **Small consistency fix to Hevy's own parser while touching this
  shared code**: Hevy's targeted column list already includes
  `description` (workout-level notes), but the original P2.1 parser
  never actually mapped it to `ImportedWorkout.notes` — always `null`.
  Since Strong's `Workout Notes` column needed exactly this same field
  populated, and the canonical `notes` field already existed, this was
  fixed for Hevy too (2-line change) so both providers behave
  consistently rather than one silently dropping data the schema already
  has room for.

## Scope decisions

- **Same page, provider selector — not a second page.** `/client/import-
  workouts` gained a Hevy/Strong toggle; the rest of the UI (preview,
  per-exercise resolution, commit, results) is unchanged and provider-
  blind, since it already only deals with the canonical shape.
- **Strong's CSV column format is targeted from public/community
  documentation, not verified against a live Strong export** (no account
  available to this session) — same disclosed limitation as Hevy's own
  parser. Header-driven and defensive: a format drift surfaces as
  row-level errors, never silent corruption.
- **Per-workout `Duration` is not parsed into `Workout.duration`** —
  Hevy's importer doesn't populate it either (despite having
  `start_time`/`end_time` it could derive it from); left as a disclosed,
  deliberately-deferred simplification for both providers rather than
  giving Strong an inconsistent extra field Hevy lacks.

## Affected models

None — reuses `WorkoutImportBatch` unchanged (`source: "STRONG"` instead
of `"HEVY"`).

## Affected services

`import.service.ts`: `previewFromParsed` extracted (shared),
`previewStrongImport` added. New `strong-csv-parser.util.ts`. New shared
`csv-parser.util.ts`, `import-date-parser.util.ts`,
`import-source-hash.util.ts`, `import-canonical.types.ts` (all extracted
from what was previously Hevy-only code).

## Affected frontend

`ImportWorkoutsPage.tsx` gains a provider selector;
`importService.previewStrong` added to `api.ts`.

## Domain invariants

- Every weight is normalized to kg and every distance to meters before
  it ever reaches `commitImportBatch` — the commit path never needs to
  know or care which unit a row originally came in as.
- Idempotency, exercise matching, and the "never auto-map without an
  explicit choice" rule are identical regardless of provider — enforced
  by construction (both parsers produce the same canonical shape,
  consumed by the same commit code).

## Migration risk

None — no schema change.

## Test plan

Unit: Strong CSV grouping by (Workout Name, Date); lb→kg and mi/km/m→
meters conversion (including "unspecified defaults to Strong's own
default unit" for both); missing-field/unparseable-date row errors;
sourceHash determinism.

Integration: a real preview→commit round trip through
`previewStrongImport`, proving the lb→kg conversion survives all the way
into a real committed `WorkoutSet`, the batch is tagged
`source: "STRONG"`, and the workout's notes say "Nhập từ Strong" (not a
hardcoded "Hevy" string from before this pass's refactor).

Browser E2E: select "Strong" on the real `/client/import-workouts` page,
upload a real Strong-format CSV with an lb-unit weight, preview, resolve
against a real seeded exact match, commit, verify via direct DB query
that the weight was correctly converted to kg.

## Verified results

**Unit** (`strong-csv-parser.util.test.ts`) — 8/8 passing. Existing
Hevy/matcher unit suites re-run after the shared-module extraction —
18/18 still passing, zero behavior change.

**Backend integration** (`import-strong.service.integration.test.ts`,
against `gymcoach_fitness_test`) — 1/1 passing (a focused test — the
provider-agnostic commit path itself is already covered 8/8 by Hevy's
own integration suite and wasn't re-tested end to end per resolution
type here, since nothing about it changed). Full combined run across all
import-related test files (Hevy unit + integration, matcher, Strong unit
+ integration): 35/35 passing. `npx tsc --noEmit` clean.

**Browser E2E** (`tests/43-import-strong-workouts.spec.ts`) — 1/1 passing
(43.0s): selects "Strong" via the real provider selector, uploads a real
Strong-format CSV, previews, resolves an exact match, commits, verifies
the real lb→kg conversion in the committed `WorkoutSet` and the batch's
`source: "STRONG"` tag.

**Regression**: `tests/42-import-hevy-workouts.spec.ts` (Hevy's own E2E,
most at risk from the shared-pipeline refactor) — 1/1 still passing.
