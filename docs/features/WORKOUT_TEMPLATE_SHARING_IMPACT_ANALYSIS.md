# Workout Template Sharing/Import — Impact Analysis

Date: 2026-08-25. Roadmap: P2.6 "Workout template sharing/import" (§20).
Chosen instead of the next item in sequence (§18 Apple Health/Health
Connect, confirmed BLOCKED in this environment — no native iOS/Android
tooling available to build or verify it; see roadmap §43) after an
explicit user decision.

## Why

§20: useful for PT → client; user → user; community; migration. Needs a
clear `Template`/`Plan`/`Schedule`/`Completed Workout` distinction, and
sharing must never leak health information/private notes/body
measurements/account identifiers.

## Audit findings

- **This app already has almost everything this feature needs to reuse,
  found by reading `coach.service.ts` before designing anything new**:
  - `createAndAssignPlan(ptUserId, clientUserId, input)` already lets a
    PT hand-type a program directly onto a client, reusing
    `workoutService.createManualProgram` unchanged for the actual
    creation (program + generated schedules in one call). This is
    "assign a NEW plan," not "reuse an EXISTING one as a template" —
    the real gap this pass fills.
  - `assertActivePtClientRelationship`/`coachDeps.isActivePtClientRelationship`
    already re-validates the real PT↔client `Contract.status === ACTIVE`
    relationship fresh per call (never cached/trusted from a prior
    request) — the exact authorization primitive template sharing needs,
    reused unchanged.
  - `manualProgramDaySchema`/`manualProgramExerciseSchema` (Zod, from
    `fitness.models.ts`) already validate the EXACT day/exercise/sets/
    reps/rest shape a template needs to hold — reused unchanged rather
    than inventing a second, parallel validation shape.
  - So the concrete, standalone gap is: (1) a way to snapshot an
    existing `WorkoutProgram`'s STRUCTURE (never its schedules/history)
    into a reusable, detached template row; (2) a share/accept flow atop
    the existing PT↔client relationship; (3) accepting a shared template
    creates a real new program for the recipient via the SAME
    `createManualProgram` commit path `createAndAssignPlan` already
    proves works.
- **The `Template`/`Plan`/`Schedule`/`Completed Workout` distinction §20
  asks to resolve, mapped onto this app's real existing models**:
  `WorkoutProgramTemplate` (new, this pass) = detached, reusable
  structure, no owner-specific calendar/history attached = "Template".
  `WorkoutProgram` (existing) = one user's own active/archived plan =
  "Plan". `WorkoutSchedule` (existing) = a plan's days placed onto real
  calendar dates = "Schedule". `Workout`/`WorkoutExercise`/`WorkoutSet`
  (existing) = what actually happened = "Completed Workout". A template
  is intentionally the ONE new concept — everything downstream of
  "accept a template" already exists and is reused unchanged.
- **Privacy audit of what a template snapshot must NEVER carry**:
  `WorkoutProgramExercise.notes` is left OUT of the template snapshot
  entirely — it's free-text, PT-authored, attached to one specific
  client's program, and could plausibly reference something personal
  (an injury, a body-composition observation). §20 explicitly calls out
  "private notes" as something sharing must never leak, so this is
  excluded by construction, not by hoping nobody puts anything sensitive
  there. Everything else a template snapshot holds (day titles, exercise
  IDs, sets/reps/rest seconds, exercise order/grouping) is structural
  program design, not personal data about any one person.
- **No existing "user → user" or "community" sharing/follow relationship
  exists anywhere in this codebase** — the only real, already-authorized,
  two-party relationship available to build on is PT↔client (`Contract`).
  Scoping to that (reusing its existing authorization check in BOTH
  directions — a PT can share to their client, and a client can share
  one of their own existing programs back to their PT) is the only
  option with a real, already-proven trust boundary to build on this
  pass.

## Scope decisions

- **PT↔client sharing only, this pass.** Reuses the existing `Contract`-
  based relationship check unchanged, in whichever direction the caller
  is on it. Arbitrary user→user sharing and a public/community template
  marketplace are real, larger follow-ups (need their own
  relationship/discovery/moderation model) — explicitly deferred, not
  silently dropped, matching this session's own "additive, can extend
  later" discipline applied to every prior scope narrowing.
- **A template snapshot never includes `notes`, never includes any
  schedule/history data, and is fully DETACHED from its source
  program** — editing or deleting the source `WorkoutProgram` after a
  template was created from it never affects the template (or anyone
  who already imported it).
- **Importing a shared template creates a brand-new `WorkoutProgram` for
  the recipient via the existing `createManualProgram` path** —
  identical semantics to how a PT-assigned or AI-generated program is
  created today (same `replaceExisting`/schedule-generation behavior),
  not a new, parallel creation code path.

## Affected models

New, additive-only:

```
WorkoutProgramTemplate {
  id, createdByUserId, name, description?, goal?,
  durationWeeks, daysPerWeek,
  daysJson Json   // structural snapshot only — day titles + exercises
                  // (exerciseId, order, sets, reps, restSeconds) +
                  // exercise groups (P1.3 superset structure); no notes,
                  // no schedule/history
  sharedWithUserIds String[]  // explicit recipient allowlist
  createdAt
}
```

No changes to `WorkoutProgram`/`WorkoutSchedule`/`Workout`/`WorkoutExercise`/`WorkoutSet`.

## Affected services

New `template.service.ts` (`createTemplateFromProgram`, `createTemplateFromDays`,
`shareTemplate`, `listMyTemplates`, `listTemplatesSharedWithMe`,
`importTemplate`), reusing `workoutService.createManualProgram` and
`coachDeps.isActivePtClientRelationship` unchanged. New `template.controller.ts`,
`template.routes.ts` mounted at `/templates`.

## Affected frontend

New "Chia sẻ chương trình" (Share program) action reachable from an
existing program's day-edit view, a new `/client/templates` page (Của
tôi / Được chia sẻ tabs), reusing the existing manual-program-import
commit flow's UX conventions (startDate/selectedWeekdays picker, same
as the manual builder).

## Domain invariants

- A template is never mutated by anything that happens to its source
  program after creation, or by anyone importing it.
- `notes` never appears in a template snapshot.
- Sharing requires a real, freshly-re-checked ACTIVE PT-client
  relationship — never cached, never trusted from a prior request (same
  rule `coach.service.ts` already enforces everywhere else).
- Importing a template never silently overwrites the recipient's
  existing program without the same explicit `replaceExisting` semantics
  `createManualProgram` already requires.

## Migration risk

Low — one new, additive, feature-scoped table. No existing model touched.

## Test plan

Backend integration: creating a template from an existing program
snapshots the real structure and explicitly excludes `notes`; sharing
requires a real active PT-client relationship (rejected without one);
`listTemplatesSharedWithMe` only shows templates actually shared with
that specific user; importing creates a real new `WorkoutProgram` (+
schedules) for the recipient via the unchanged `createManualProgram`
path; editing/archiving the source program after template creation never
affects the template or anyone who imported it; a non-PT/non-recipient
cannot share or import.

Browser E2E: a PT creates a template from a real program, shares it with
a real client (a real, contract-backed relationship), the client sees it
under "Được chia sẻ", imports it, and a real new program+schedule shows
up in the client's own workout log — verified via direct DB query, not
just UI presence.

## Verified results

**Backend integration** (`template.service.integration.test.ts`, against
`gymcoach_fitness_test`, real seeded catalog, `templateServiceDeps`
stubbed for the cross-service relationship check — same convention
`coach.service.ts`'s own tests already use) — 4/4 passing:
`createTemplateFromProgram` snapshots the real structure, explicitly
proves a private coaching note never appears anywhere in the snapshot,
and proves editing the source program afterward never changes the
already-created template (a real detached-snapshot check, not just
asserted); ownership is enforced (another user gets 404); `shareTemplate`
requires a real active relationship in either direction and is
idempotent on re-share; `listTemplatesSharedWithMe` is scoped exactly to
the real recipient (a stranger sees nothing); `importTemplate` creates a
real new `WorkoutProgram` + `WorkoutSchedule` rows via the unchanged
`createManualProgram` path, with an unauthorized recipient rejected.
`npx tsc --noEmit` clean (fitness-service + gateway).

**Browser E2E** (`tests/46-template-sharing.spec.ts`) — 1/1 passing
(43.2s), the most structurally complex test this session (two real,
isolated accounts connected by a real `ACTIVE` Contract row): a "PT"
creates a real program via the real manual-program API, snapshots it as
a template through the real UI, shares it with the real "client" — whose
name in the recipient dropdown is asserted directly, proving the list
came from the real, contract-backed relationship rather than a
hardcoded/open list — the client sees it under "Được chia sẻ", imports
it, and a real new `WorkoutProgram` + `WorkoutProgramDay` +
`WorkoutProgramExercise` + `WorkoutSchedule` rows are verified directly
in the database on the CLIENT's own account, with the correct structure
(day title, sets, reps, rest seconds) and the PT's original program
confirmed untouched.

**Regression**: `tests/45-export-data.spec.ts` +
`tests/13-training-cycle-fixes.spec.ts` (both exercise `ProfilePage.tsx`,
which this pass also touched with a third entry-point card) — 3/3 still
passing.
