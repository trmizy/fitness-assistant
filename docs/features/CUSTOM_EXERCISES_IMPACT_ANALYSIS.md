# Custom Exercises — Impact Analysis

Date: 2026-08-25. Roadmap: P1.5 "Custom exercises".

## Why

Required for uncommon exercises, PT-specific movements, import from
external apps, catalog gaps, and user-specific variations.

## Audit findings (this pass reuses a LOT of existing infrastructure)

- **The exact "normalize name → exact/alias match → fuzzy candidate list"
  pipeline the roadmap asks for already exists**:
  `exercise-duplicate-detector.ts`'s `detectDuplicate(a, b)` — a pure,
  deterministic, already-unit-tested classifier (no LLM), built for the
  catalog's own bulk-import review pipeline
  (`ExerciseReviewDecision`/`exercise-review.service.ts`). It correctly
  refuses to auto-merge related-but-distinct variants ("Bench Press" vs
  "Dumbbell Bench Press") — exactly the roadmap's own worked example.
  Custom-exercise creation reuses this UNCHANGED, just with a different
  caller and a different UI presenting the candidates (the requesting
  USER confirms, instead of an admin reviewer) — no new dedup logic
  invented.
- **`Exercise.status` (STAGING/REVIEW_REQUIRED/APPROVED/PUBLISHED/...)
  already exists and already gates exactly one place**:
  `exercise.service.ts`'s general browse/search (`status: "PUBLISHED"`
  filter) — everywhere else (by-id resolution for history/logging) is
  deliberately NOT status-gated, "an exercise already in someone's
  history must keep resolving regardless of catalog status." A custom
  exercise can safely be `status: "PUBLISHED"` from creation (so its
  owner can use/log it immediately, no admin approval step for their own
  private exercise) without needing a NEW status value.
- **The general `GET /exercises` search endpoint is PUBLIC (no
  `authMiddleware`)** — it doesn't know who's asking. Retrofitting it
  with optional-auth + ownership-aware filtering would touch a public,
  unauthenticated surface with no existing "soft auth" middleware pattern
  in this codebase to build on. Deliberately avoided — see Scope below.
- **`WorkoutExercise`/`WorkoutProgramExercise` already just FK to
  `Exercise.id` with no assumption about its source** — logging,
  progression, PR calculation, everything already works unchanged for
  ANY exercise row regardless of how it was created. This is the reason
  "user creates it, logs it normally, history/progression works" is
  already true by construction — no changes needed there at all.

## Scope decision

- **`source: SYSTEM | USER_CUSTOM` only this pass — `PT_CUSTOM` deferred.**
  The roadmap explicitly says to clarify PT visibility (private to PT /
  available to clients / gym-wide / global-after-review) BEFORE
  implementing it — no PT role/client-relationship model exists yet in
  fitness-service to build that on safely. `USER_CUSTOM` is unambiguous:
  private to its creator, full stop.
- **Custom exercises never touch the public `GET /exercises` endpoint.**
  Discoverability is a NEW authenticated `GET /exercises/custom` (the
  owner's own list only), which the frontend's existing "Add Exercise"
  picker merges in client-side. Zero risk to the public, unauthenticated
  catalog search — satisfies "no catalog contamination" by construction,
  not by a filter that could be forgotten somewhere.
- **Deduplication check runs against the FULL live catalog** (same
  `loadLiveExercises()`-style load the bulk importer already uses) —
  acceptable here because it's a one-off action-triggered check (create
  button), not live-as-you-type search; ~1000 pure in-memory comparisons
  is fast enough without needing a smarter pre-filter.
- **A high-confidence match (`EXACT_SAME_SOURCE`/`EXACT_CROSS_SOURCE`)
  blocks creation and returns the candidate(s)** for the user to
  either pick the existing one instead, or explicitly confirm "create
  anyway" (bypasses the block, matching "no automatic low-confidence
  mapping" — the block is the safe default, bypass is an explicit user
  choice, never silent).
- **Archive, never delete** — `archivedAt` on the same row; the exercise
  keeps resolving for any existing history/program that already
  references it (same "never let a catalog change corrupt history" rule
  applied everywhere else), just stops appearing in `GET /exercises/custom`.

## Affected models

`fitness-service` `Exercise`: 3 new nullable/defaulted columns —
`source` (default `"SYSTEM"`), `ownerId` (nullable), `archivedAt`
(nullable). Additive; every pre-existing row is `SYSTEM`/no owner/not
archived.

## Affected services

`fitness-service`: new `createCustomExercise`, `listMyCustomExercises`,
`archiveCustomExercise` in `exercise.service.ts`, reusing
`detectDuplicate`/`normalizeExerciseName` unchanged. New routes under
`/exercises/custom`, `authMiddleware`-gated (the public `/exercises`
route is untouched).

## Affected frontend

`WorkoutLogPage.tsx`'s existing "Add Exercise" picker (`showAddExercise`)
gains a "Tạo bài tập tùy chỉnh" action and merges the user's own custom
exercises into its results; a duplicate-candidate confirmation step when
the backend blocks creation; an archive action scoped to the owner's own
custom exercises.

## Domain invariants

- A custom exercise still needs valid `loggingMode`/`typeOfEquipment`/
  `bodyPart`/`type` — the SAME Prisma enums and `loggingMode` value list
  every other exercise already validates against; nothing custom-exercise-
  specific bypasses this.
- `ownerId` is set once, at creation, from the authenticated caller —
  never client-suppliable, never changeable afterward.
- Archiving never deletes the row or breaks a foreign key.

## Migration risk

Low — 3 new nullable/defaulted columns, no existing data affected.

## Test plan

Backend integration: create a custom exercise (owner-scoped, `PUBLISHED`,
never appears in the public `/exercises` search); duplicate detection
blocks creation against an exact catalog match and returns the
candidate; "create anyway" bypass works; archive hides it from
`GET /exercises/custom` without deleting the row or breaking a workout
that already logged it; ownership enforced (another user cannot archive
someone else's custom exercise).

Browser E2E: create a custom exercise via the picker, see it merged into
the picker's own results, add it to a program day, log it in an active
session exactly like a catalog exercise (progression/previous-performance
work normally); archive it and confirm it disappears from the picker but
history stays intact.

## Real bug found and fixed during implementation

The general browse/search branch of `exerciseService.listExercises` (the
public `GET /exercises` catalog search) only ever gated on
`status: "PUBLISHED"`. A `USER_CUSTOM` exercise is deliberately created
`PUBLISHED` too (see Scope decision above), so `status` alone could never
have kept it out of the PUBLIC, unauthenticated, ownership-blind search —
without a fix, every user's private custom exercises would have leaked
into everyone else's catalog search results. Caught by the integration
test itself: the first version of `custom-exercise.integration.test.ts`'s
"no catalog contamination" test asserted `status: "PUBLISHED"` alone
excludes a custom exercise, and that assertion correctly FAILED. Fixed by
adding `and.push({ source: "SYSTEM" })` right next to the existing
`status` filter in `exercise.service.ts`'s general-search branch (purely
additive — every pre-existing row already defaults to `source: "SYSTEM"`).
The test was then rewritten to keep a "sanity check" proving `status`
alone WOULD match (so the test can never silently become a tautology)
before asserting the fixed `status + source` combination correctly
excludes it.

## Verified results

**Backend integration** (`custom-exercise.integration.test.ts`, against
`gymcoach_fitness_test`) — 5/5 passing:

```
✔ createCustomExercise creates a PUBLISHED, owner-scoped USER_CUSTOM exercise that a real duplicate check never blocks (genuinely unique name)
✔ createCustomExercise rejects an invalid loggingMode/enum — never bypasses catalog validation
✔ createCustomExercise blocks on a real catalog duplicate and returns candidates; confirmCreateAnyway bypasses it
✔ a custom exercise never appears in the public listExercises search — no catalog contamination
✔ archiveCustomExercise soft-deletes (never removes the row), is owner-scoped, and hides it from listMyCustomExercises
ℹ tests 5, pass 5, fail 0
```

`npx tsc --noEmit` clean on both `fitness-service` and the frontend
(`npm run build` clean).

**Browser E2E** (`tests/40-custom-exercises.spec.ts`, real dev stack) —
1/1 passing (38.2s): creates a custom exercise through the real
`CreateCustomExerciseModal` form (defaults only — `typeOfActivity`,
`typeOfEquipment`, `bodyPart`, `type`, `loggingMode` all pre-filled with
valid enum values, matching the picker's own actual UX), confirms the DB
row (`source=USER_CUSTOM`, owner-scoped, `PUBLISHED`, not archived) and
that it appears live under "Của tôi" in the still-open Add Exercise
modal; adds it to a real program (`POST /workouts/programs/manual`),
opens the active-session UI for it, sets weight, completes it, and
confirms a real completed `WorkoutSet` row — proving the logging pipeline
needed zero changes for a custom exercise; archives it via the real
"Của tôi" archive button, confirms the toast, confirms the whole "Của
tôi" section disappears (list now empty), confirms via DB that
`archivedAt` is set but the row and its already-logged `WorkoutSet`
survive untouched, and confirms `GET /exercises/custom` no longer lists
it.

**Regression** (specs touching the same "Add Exercise" picker /
`WorkoutLogPage.tsx`): `25-exercise-muscle-map` (2/2),
`37-reschedule-workout` (2/2), `38-superset-exercise-grouping` (2/2),
`39-active-workout-offline-resilience` (1/1) — all still passing, no
interaction with the new "Của tôi" section or create-custom-exercise
trigger.

**Pre-existing, unrelated finding**: `16-swap-exercise.spec.ts` failed —
its own local `openActiveExerciseForDay1` helper waits on
`getByTestId('workout-tab-plan')`, a testid that no longer exists
anywhere in the frontend source. This predates this pass entirely (not
present in this session's or this feature's changes at all — grepping the
whole frontend finds zero `workout-tab-*` testids, meaning the tabbed
navigation that spec was written against was already replaced by the
current day-card flow before this milestone started, most likely by the
prior `355735f` production-hardening commit). Left unfixed as genuinely
out of scope for this milestone — noted here rather than silently
ignored, per this project's "always investigate and disclose, never
paper over" convention.
