# Crowd-Duplicate Custom Exercise → Catalog Enrichment — Impact Analysis

Date: 2026-09-15. **Status: PROPOSAL — not implemented.** Nothing in this
document has been built. Written at the user's request, before any code,
per this repo's "plan first, evaluate, then decide" convention.

Origin: user request during a session that (a) bulk-created 23
`USER_CUSTOM` exercises for one account importing an external Excel
workout plan, and (b) asked whether a marketplace listing built on those
custom exercises would leak them to other users. Investigating (b)
surfaced the real motivating gap this proposal closes (see "Why").

## Why

Confirmed by reading `marketplace.service.ts` and
`exercise-reference-resolver.service.ts` this session (not speculation):

- `USER_CUSTOM` exercises are correctly, strictly owner-scoped — no
  cross-user leak exists today. Three independent layers enforce this:
  `browse()`'s mappability filter (`exerciseReferenceResolver.resolve`
  with `scope: "public"`, which only ever matches `SYSTEM`+`PUBLISHED`),
  `adoptPlan()`'s repeat of the same check, and
  `workoutService.createManualProgram`'s `validateExerciseIds` (scoped to
  `SYSTEM` + the caller's own `USER_CUSTOM`) as the final backstop at
  actual import time.
- The side effect of that correct isolation: **a published marketplace
  plan built on any `USER_CUSTOM` exercise silently never appears in
  `browse()` for buyers**, with no warning to the publisher at submit
  time — `publishPlan()`/`republishVersion()` only check "every day has
  at least one exercise" (`isWeeklyScheduleAdoptable`), never catalog
  mappability. A listing can pass moderation and sit `APPROVED` while
  being permanently invisible to every buyer. This is a real, silent P2
  — not fixed by this proposal directly, but the mechanism below is the
  legitimate way to make a genuinely popular custom exercise sellable:
  promote it into the real `SYSTEM` catalog instead of special-casing
  marketplace visibility for custom exercises (which would break the
  "never let a foreign user's `USER_CUSTOM` exercise be referenced by
  someone else" invariant).
- Independently, `USER_CUSTOM` rows created via the picker
  (`CUSTOM_EXERCISES_IMPACT_ANALYSIS.md`) have no description/media/
  attribute quality bar — a user fills in a minimal form. If three
  unrelated users independently create "the same" exercise, that is a
  real signal the catalog has a genuine gap worth curating properly
  (real instructions, media, muscle/equipment taxonomy), not a
  coincidence to ignore.

## Feature as requested

Admin-facing: when the **same exercise** has been independently created
as `USER_CUSTOM` by **more than N (user said 3) distinct owners**,
automatically research and fill in description, attributes (equipment/
body part/movement pattern/muscle groups), status, and download
image/video for that exercise from the internet.

## Audit findings — what already exists to build on

- **Duplicate detection is already solved and reusable, twice over**:
  `exercise-duplicate-detector.ts`'s `detectDuplicate(a, b)` — pure,
  deterministic, unit-tested, already used by both
  `createCustomExercise`'s own creation-time check and the Gate 7 bulk
  review pipeline. `exercise-name-matcher.util.ts`'s `matchExerciseName`
  (token-Jaccard) is the lighter-weight sibling already used by the
  workout-history import flow. Neither currently runs **cross-owner,
  after the fact** — both run once, at a single creation/import moment.
  This proposal's detection job is a new caller of the SAME
  `detectDuplicate` logic, not a new matching algorithm.
- **The STAGING → REVIEW_REQUIRED → APPROVED → PUBLISHED status ladder
  already exists on `Exercise.status`** and already means exactly what
  this feature needs: "a freshly-imported exercise never reaches a real
  user until deliberately promoted." Auto-research output must land here
  (`STAGING` or `REVIEW_REQUIRED`), never write directly to a `PUBLISHED`
  row or auto-flip status.
- **`ExerciseReviewDecision` is the right SHAPE but the wrong SCOPE to
  reuse directly** — it's hard-wired to one-time CSV-import review
  (`externalRef` = the catalog CSV's own row id, `source` defaults to
  `"curated_vi_exercise_catalog"`). This proposal needs a decision record
  keyed by a **live `Exercise.id`** (the promoted/enriched row), not an
  external catalog reference — a new, small model (see below), same
  decision-audit spirit, not a repurposed CSV-import table.
- **`ExerciseSource.mediaLicense`/`dataLicense` already exist** precisely
  because past imports needed honest license tracking (some
  free-exercise-db images are UNDOCUMENTED even though the text data is
  Unlicense). Anything this feature downloads from the internet MUST
  populate these fields — never silently assume free-to-use.
- **No live admin review UI exists for this today.** `exercise-review
  .service.ts`'s "pending queue" is a batch/offline tool tied to one
  historical CSV import ("Gate 7"), not a standing admin page. The
  marketplace's own admin moderation surface
  (`admin-marketplace.routes.ts`, `listForModeration`/`reviewAction`) is
  the closest live precedent for "admin queue + approve/reject action" —
  this proposal's review queue should follow that same shape, not invent
  a third pattern.
- **Current real data**: as of this session, the `gymcoach_fitness` dev
  DB has 24 `USER_CUSTOM` rows, all owned by one account (this session's
  import) — **zero real cross-owner duplicates exist yet**. The "≥3
  distinct owners" trigger has no live case to validate against today;
  first real test data will come from actual usage.

## What this explicitly is NOT

- **Not** a path that lets AI/automation write directly to a `PUBLISHED`
  `Exercise` row, or flip `status` to `PUBLISHED` unattended — violates
  this repo's core "AI is a draft producer only, Exercise.id identity is
  never AI-authored" invariant (`gymini-ai-workout-grounding`).
- **Not** a merge/dedup of the underlying `USER_CUSTOM` rows themselves.
  Each owner's row stays exactly as-is (their programs/history keep
  resolving against their own row, untouched) — this feature only
  creates or enriches a **separate, new-or-existing `SYSTEM` candidate**
  informed by the pattern. Linking owners' history to the new SYSTEM row
  is a distinct, separate decision (parallel to `LINK_AS_ALIAS_OF_
  EXISTING` in Gate 7) — out of scope for this pass.
- **Not** unrestricted web scraping. A specific, license-aware source (or
  short allowlist of sources) must be chosen deliberately — see Open
  Questions.

## Proposed design

1. **Detection job** (scheduled, e.g. nightly cron in fitness-service —
   mirrors the existing cron patterns already in this repo rather than
   inventing a new job runner): group all non-archived `USER_CUSTOM`
   rows by normalized name (`normalizeExerciseName`, already used for
   this exact purpose elsewhere), then run `detectDuplicate` pairwise
   within each name-group to also catch near-variants, not just exact
   string matches. A group qualifies when it has **≥3 distinct
   `ownerId`s** (user-specified threshold — see Open Questions on
   whether this should be tunable).
2. **Candidate record** — new model (name TBD,
   e.g. `CrowdDuplicateCandidate`): `groupKey` (normalized name),
   `memberExerciseIds` (the `USER_CUSTOM` rows that triggered it),
   `distinctOwnerCount`, `status` (`PENDING` | `RESEARCHING` |
   `REVIEW_REQUIRED` | `PROMOTED` | `DISMISSED`), timestamps. Detection
   job is idempotent — re-running updates `distinctOwnerCount`/members on
   an existing `PENDING` candidate rather than creating duplicates.
3. **Research step** (triggered per-candidate, admin-initiated or
   automatic on reaching the threshold — see Open Questions): looks up
   the exercise name against the chosen source(s), drafts
   `exerciseName`/`instructions`/`typeOfActivity`/`typeOfEquipment`/
   `bodyPart`/`type`/`muscleGroupsActivated`/`videoUrl` plus a candidate
   image, and stores the DRAFT on the candidate record (not on a live
   `Exercise` row) alongside `ExerciseSource`-shaped provenance
   (`sourceName`, `sourceUrl`, `dataLicense`, `mediaLicense`). Sets
   candidate `status: REVIEW_REQUIRED`.
4. **Admin review queue** (new admin page, same shape as the marketplace
   moderation queue): lists `REVIEW_REQUIRED` candidates with the
   research draft, the triggering `USER_CUSTOM` rows (name + owner
   count, never other owners' private data beyond that), and an
   Approve/Edit/Reject action. Approve creates a real `Exercise` row at
   `status: STAGING` (or `PUBLISHED` if the admin explicitly promotes —
   same two-step already used elsewhere in the catalog) with the
   `ExerciseSource` provenance attached; Reject sets `status: DISMISSED`
   with a required note (mirrors `reviewAction`'s reject-requires-note
   rule in marketplace moderation).
5. **No automatic linking of existing `USER_CUSTOM` rows to the new
   catalog row** in this pass (see "What this is NOT") — each owner
   keeps using their own row. A follow-up (separate, smaller) proposal
   could let an owner opt in to "switch my custom exercise to the new
   catalog entry" once one exists.

## Open questions (need a product decision before implementation)

1. **Research source**: a specific licensed dataset/API (e.g. extending
   the existing free-exercise-db-style import this catalog was already
   seeded from) vs. general web search + LLM summarization vs. a curated
   allowlist of a few fitness sites. This determines license handling
   and how reliable the auto-drafted content is. No default assumed here
   — needs your call.
2. **Trigger timing**: does research run automatically the moment a
   group crosses 3 distinct owners, or only when an admin manually
   clicks "research" on a `PENDING` candidate? Auto-run is faster but
   spends external API/scraping cost on groups an admin might reject
   outright; manual-trigger is safer but adds a queue-babysitting step.
3. **Threshold**: fixed at 3, or a configurable env/setting? (Low cost to
   make configurable now if you want it.)
4. **Retroactive scope**: does the nightly job also scan the 24
   already-existing `USER_CUSTOM` rows from this session, or only rows
   created after this feature ships? (They're all one owner today, so
   moot right now, but will matter once real usage accumulates.)
5. **Who can see the review queue**: is there already an "admin" role
   distinct from `CUSTOMER`/PT in `auth-service`'s `users.role` this
   should gate on, or does this need a new permission check? (Not
   audited yet — first thing to check before building the admin page.)

## Affected models (proposed)

`fitness-service` `prisma/schema.prisma`: new `CrowdDuplicateCandidate`
model (see "Proposed design" #2) — additive only, no changes to
`Exercise` itself beyond what `CUSTOM_EXERCISES_IMPACT_ANALYSIS.md`
already added.

## Affected services (proposed)

`fitness-service`: new `crowd-duplicate-detection.service.ts` (the
nightly job), new `exercise-research.service.ts` (the research step —
likely needs an `ai-service` or external-API call, not pure
fitness-service logic), extends `exercise-review.service.ts`'s pattern
for the admin approve/reject actions. New admin-only routes, following
`admin-marketplace.routes.ts`'s auth pattern.

## Coordination note

Exercise Catalog / AI Workout Grounding is flagged in this repo's own
`gymini-parallel-agent-safety` skill as an actively-owned concurrent
workstream (Codex). This proposal should be reviewed against whatever
Codex is currently doing in that domain before implementation starts —
do not begin building from this document alone without re-checking
`git log`/`git status` for overlap at that time.

## Not done in this pass

No code, no schema migration, no test plan — this is the planning
document the user asked for before any implementation decision.
