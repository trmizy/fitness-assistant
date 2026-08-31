# Catalog Quality Matrix — Impact Analysis

Date: 2026-08-25. Roadmap: P1.8 "Logging-mode catalog discoverability".

## Why

P0 proved `TIME_LOAD` works technically as a logging mode, but the
catalog's own `TIME_LOAD` rows are still `STAGING` — not yet visible to
real users. The roadmap is explicit: before publishing, inspect why they
are staging, audit licensing/data provenance, verify classification,
verify instructions/media, run the exercise review workflow, and **do not
publish rows just to claim feature availability**. It also asks for a
reusable "catalog quality matrix": Exercise / loggingMode /
publicationStatus / equipment / muscles / media/license / reviewStatus.

## Audit — the real TIME_LOAD rows

Exactly 3 `TIME_LOAD` exercises exist in the catalog, all `STAGING`, all
`source: SYSTEM` (loaded carries — Farmer Carry, Suitcase Carry, Front
Rack Carry). Direct inspection found:

- **Content quality is genuinely good**: correct enum classification
  (`STRENGTH`/`DUMBBELLS`|`KETTLEBELL`/`CORE`/`HOLD`), sensible Vietnamese
  instructions and contraindications, correct equipment links, and
  reasonable primary/secondary muscle mapping (verified against
  `exercise_muscles`).
- **Zero media**: `video_url` is empty for all 3.
- **`media_license` is unset** (`NULL`, not even a placeholder) on their
  `ExerciseSource` row; `data_license: "original_curated"`.
- **Never been through Gate 7's review workflow**: `exercise_review_decisions`
  has **zero rows in the entire database** — not specific to these 3.

## Real finding: the catalog already has an implicit publish gate, and these rows fail it

This is the single most important finding, and it reframes the whole
milestone. Comparing the `original_curated` cohort (145 rows total, the
same pipeline that produced these 3 TIME_LOAD rows) by publish status:

| | has `video_url` | no `video_url` |
|---|---|---|
| `STAGING` (119 rows) | 0 | 119 |
| `PUBLISHED` (26 rows) | 25 | 1 (`Machine Hip Thrust`, a pre-existing anomaly) |

Within this cohort, **having a real video is a near-perfect (25/26)
predictor of already being published** — every currently-staging curated
row, TIME_LOAD or not, lacks one. The 26 already-published curated rows
that DO have video all point at the same public
`raw.githubusercontent.com/yuhonas/free-exercise-db` media the separate
879 `Unlicense`-licensed rows also use — meaning the earlier publishing
pass for curated rows implicitly required real, reusable media before
publishing, even though `data_license: "original_curated"` describes the
Vietnamese text/data curation, not the image. `media_license` itself is
blank for the entire 145-row curated cohort regardless of status, so it
was never the actual gate — `video_url` presence was.

Gate 7 (`exercise-review.service.ts`) was checked as a candidate tool for
"run the exercise review workflow" on these 3 rows, and does **not**
apply here by design: it operates on *unresolved* catalog rows (no
`ExerciseSource` link yet) to decide whether an incoming candidate is a
duplicate/alias/genuinely-new import. These 3 rows already have real
`ExerciseSource` links (`externalId: EX00113/EX00195/EX00196`), so
`submitReviewDecision` explicitly refuses any decision but
`MARK_AS_DUPLICATE_SKIP` for them (409 `ReviewConflictError`) — and they
are not duplicates, so that decision would be a lie. The "exercise review
workflow" the roadmap means for a STAGING→PUBLISHED call is a separate,
currently-nonexistent workflow — there is no admin action anywhere in
this codebase that flips `Exercise.status`; the 883 pre-existing rows
were published via a one-off backfill script, not a reusable admin
action (`exercise.service.ts`'s own comment confirms this).

## Decision: do not publish the 3 TIME_LOAD rows this pass

Given the above, publishing these 3 rows now — without media, without
`media_license`, without ever going through any review record — would be
exactly what the roadmap explicitly forbids: **publishing to claim
feature availability**, not because the content earned it. They are in
the identical position as 116 other non-TIME_LOAD curated rows also
sitting in `STAGING` for the same reason (no video). Fixing that for only
these 3 (e.g. by relaxing the bar, or by building a status-flip action
just to unblock them) would be inventing a shortcut around a bar every
other row in this cohort is still held to.

**What this milestone delivers instead** is the tool the roadmap actually
asked for — visibility, not a shortcut:

## What was built

- **`GET /exercises/admin/catalog-quality-matrix`** (`authMiddleware` +
  `ADMIN`-only, same pattern as Gate 7's `/exercises/admin/review`) —
  returns exactly the roadmap's requested schema per exercise
  (`loggingMode`, `publicationStatus`, `equipment`, `muscles`, `hasVideo`,
  `dataLicense`, `mediaLicense`, `reviewStatus`), filterable by
  `loggingMode`/`status`/`search`, paginated, with a catalog-wide summary
  (`byPublicationStatus`, `byLoggingMode`, `missingVideo`,
  `missingMediaLicense`, `noReviewRecord`) computed over the full
  filtered set, not just the current page. `reviewStatus` is derived by
  joining each exercise's `ExerciseSource` onto `ExerciseReviewDecision`
  by `(sourceName, externalId)` — the same key Gate 7 itself uses — so it
  reports the real, current review state (`NO_SOURCE_RECORD` /
  `NO_REVIEW_RECORD` / an actual `ReviewDecisionKind`), not a guess.
- **`/admin/catalog-quality`** (new admin page, `AdminCatalogQuality.tsx`,
  mirrors the existing Gate 7 admin page's layout/auth conventions) — a
  read-only, filterable table. It has no publish/status-change action
  anywhere on it, deliberately: see the Decision above.
- This is catalog-wide, reusable tooling — not a one-off script or a
  markdown table scoped to just 3 rows — so the same 116-row backlog
  across other logging modes can be triaged with it later, not just
  TIME_LOAD.

## Scope decision

- **No status-flip endpoint was built.** Adding one without also solving
  media would just be a faster way to do the thing the roadmap says not
  to do.
- **No attempt was made to source media for these 3 rows.** Sourcing
  licensed video/images is a content-acquisition task, not a code change,
  and explicitly out of scope for this pass.
- **The wider 116-row non-TIME_LOAD STAGING backlog is not otherwise
  triaged in this pass** — the matrix tool now exists to do that later;
  actually working through it is a separate, larger content-ops task.

## Domain invariants

- The matrix is strictly read-only — it can never mutate `Exercise`,
  `ExerciseSource`, or `ExerciseReviewDecision`.
- `reviewStatus` is always computed fresh from live data (same principle
  Gate 7's own queue already follows) — never a cached/stale snapshot.

## Migration risk

None — no schema change. Purely additive read endpoint + admin page.

## Test plan

Backend integration: `loggingMode=TIME_LOAD` returns exactly the real 3
seeded STAGING rows with real license/media/review data; `status`
filtering excludes them correctly; pagination limits the page but the
summary still reflects the full filtered set; search matches by name; a
real published exercise with real video reports `hasVideo: true` (proves
the matrix reflects genuinely different rows differently, not one
hardcoded shape).

Browser E2E: an ADMIN filters to `loggingMode=TIME_LOAD`, sees the real 3
rows rendered with the correct status/license/no-video badge, cross-
checked directly against the API; switching to `status=PUBLISHED` shows
the real empty state.

## Verified results

**Backend integration**
(`catalog-quality-matrix.integration.test.ts`, against
`gymcoach_fitness_test`) — 5/5 passing. `npx tsc --noEmit` clean.

**Browser E2E** (`tests/41-catalog-quality-matrix.spec.ts`, real dev
stack) — 1/1 passing (43.3s): real ADMIN session reaches
`/admin/catalog-quality`, filters to `loggingMode=TIME_LOAD`, the table
shows the exact 3 real rows (name, `STAGING`, `original_curated`, no-
video icon) matching the API response 1:1, summary cards show
`missingVideo=3`/`noReviewRecord=3`, and switching to `status=PUBLISHED`
correctly empties the table.

**Regression**: Gate 7's own admin review spec
(`28-gate7-exercise-review.spec.ts`) — 2/2 still passing (new sidebar
entry/route didn't disturb it). Backend regression bundle
(`exercise-review.service.integration.test.ts` +
`custom-exercise.integration.test.ts` +
`catalog-quality-matrix.integration.test.ts` together) — 16/16 passing.
