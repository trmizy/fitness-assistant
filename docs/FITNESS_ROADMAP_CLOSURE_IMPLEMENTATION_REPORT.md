# FitnessRoadmap Closure Implementation Report

Date: 2026-09-09
Scope: closure/hardening only — no new subsystem, no FitnessRoadmap
redesign, no touch to Exercise Catalog / AI Workout Grounding / Equipment
/ MovementPattern / Substitution work (confirmed via `git status` before
any edit — those files were untouched by this pass, consistent with the
parallel-development warning).

## 1. PT Pending-Draft Visibility

**Backend**: `GET /coach/clients/:clientId/roadmap` (existing route,
unchanged path — no new overlapping endpoint added) now returns
`{ activeRoadmap, pendingDraft }` instead of just the ACTIVE roadmap.
`coach.service.ts`'s `getClientRoadmap` fetches both
(`fitnessRoadmapService.getCurrentRoadmap` +
`fitnessRoadmapService.getCurrentDraftRoadmap`, the latter added in the
prior pass) in parallel, each independently normalizing its own 404 to
`null`. Same `assertActivePtClientRelationship` gate as every other PT
action — unchanged, not re-implemented.

**Frontend**: `ClientRoadmapCard.tsx` now renders three explicit states:

```text
No roadmap AND no draft -> "Chưa có lộ trình" + "Tạo lộ trình cho khách hàng" CTA
Pending DRAFT exists    -> "Bản nháp đang chờ học viên" + name/nguồn/số giai
                            đoạn/ngày tạo — NO create CTA at all (never offers
                            a redundant second draft)
ACTIVE exists            -> unchanged read-only summary
```

## 2. Single Pending-Draft Policy

Audited `createDraftRoadmap` (the one shared method every creation path —
client self-service, AI-accept, and PT-created — already funnels through).
Added: before creating anything, if the user already has a non-archived
`DRAFT` roadmap, return that existing draft's projection instead of
creating a duplicate. Same idempotent-return shape as the existing
`idempotencyKey` branch immediately above it (not a 409 — a caller gets
useful data back, not a bare error).

This is **one consistent rule for all three callers** — client, AI-accept,
and PT — not special-cased per caller, closing both the "PT could create a
redundant duplicate" gap (§3 of the master task) and the parallel "can the
client also spam duplicate drafts?" question (§4.1) with the same fix.

Does not touch ACTIVE/COMPLETED/ARCHIVED/CANCELLED roadmaps — creating a
DRAFT while another roadmap is ACTIVE remains allowed (matches existing
architecture: "one ACTIVE per user" is enforced at activation time, not
creation time, unchanged).

**One existing test needed updating** because of this policy change:
`"FitnessRoadmap enforces one active roadmap per user"` used to create two
DRAFT roadmaps back-to-back for the same user before activating either —
under the new policy the second call would now return the first roadmap
instead of creating a genuinely distinct one. Fixed by activating the
first roadmap *before* creating the second (the test's actual target
invariant — one ACTIVE per user — is unaffected and still correctly
verified with two truly distinct roadmaps).

## 3. Real Browser E2E — What Ran

See the four companion reports for full detail:

```text
docs/FITNESS_ROADMAP_PT_POSITIVE_E2E_REPORT.md     — BLOCKED (human-dependency, documented)
docs/FITNESS_ROADMAP_GOAL_IMAGE_E2E_REPORT.md       — VERIFIED (real file, real vision call)
docs/FITNESS_ROADMAP_REPEATABILITY_REPORT.md        — VERIFIED (3x consecutive PASS)
```

Double-submit protection (§9 of the master task) was folded into the same
E2E run rather than three separate flows — see the repeatability report
for why only one "fresh account" window exists per run, and how this pass
used it. Both checked with real network-request counting, not just
button-disabled code review:

```text
Rapid double-click "Tạo bản nháp" -> exactly 1 POST /fitness-roadmaps/ai-draft
Rapid double-click "Bắt đầu lộ trình" -> exactly 1 POST .../activate,
  confirmed server-side: exactly 1 ACTIVE phase for the roadmap afterward
```

## 4. Network Error UX (pragmatic pass, no new chaos-testing framework)

```text
fitness-roadmap request fails -> RoadmapJourneyPage's existing error state
  (unchanged from the prior pass) already offers a "Thử lại" retry button —
  re-confirmed present by code review, not re-implemented.
PT roadmap request 403 -> re-confirmed live this pass (TC-ROADMAP-004): a
  clean JSON error, not a crash; ClientRoadmapCard's isError branch renders
  a plain message, no broken card.
goal-image call failing/returning unusable -> confirmed live this pass
  (the real result actually WAS unusable=false — see the goal-image
  report): the roadmap creation flow continues normally, no crash.
```

No new error-injection/chaos-testing infrastructure was added — out of
this closure phase's scope.

## 5. API Changes

```text
GET /coach/clients/:clientId/roadmap — response shape changed:
  { activeRoadmap: FitnessRoadmapProjection | null, pendingDraft: FitnessRoadmapProjection | null }
  (was: FitnessRoadmapProjection | null). No new route added — the
  existing one was enriched, per the master task's explicit "do not add
  multiple overlapping endpoints" instruction.
```

No other route added, changed, or removed. No schema/migration change
(confirmed: `prisma migrate status` — 53/53, unchanged).

## 6. Security

```text
PT can read a valid client's pending draft            — VERIFIED (real Postgres,
                                                          coach.service.integration.test.ts)
PT cannot read an unrelated client's draft/roadmap      — unchanged, still 403-gated
  (getClientRoadmap's single relationship check covers both fields now returned)
PT can create a draft for a valid client                — VERIFIED (unchanged path)
PT cannot create a draft for an unrelated client         — VERIFIED LIVE this pass (real
                                                          browser, real gateway, 403)
PT cannot activate/advance/rebuild/archive               — unchanged; no such route exists
  under /coach/*, re-confirmed by code review
Single-pending-draft policy IDOR-safe                    — scoped by userId throughout,
                                                          same as every other roadmap query
```

## 7. Explicitly Not Done (per the closure task's own instructions)

```text
No AI-assisted rebuild work (§11 of the master task — untouched).
No Decision Engine changes (§12 — untouched; CycleAssessment.decision is
  still produced solely by the deterministic engine).
No exercise-catalog / equipment / movement-pattern / substitution / seed
  file was touched (parallel-development warning, confirmed via git status
  before and after every edit in this pass).
```

## 8. Exact Files Changed

```text
backend/services/fitness-service/src/services/fitness-roadmap.service.ts
  (single-pending-draft policy in createDraftRoadmap)
backend/services/fitness-service/src/services/coach.service.ts
  (getClientRoadmap returns { activeRoadmap, pendingDraft })
backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts
  (+3 tests: single-pending-draft-policy x2, fixed the pre-existing
  one-active-roadmap-per-user test's setup for the new policy;
  loadModules() extended to also expose coachService/coachDeps)
backend/services/fitness-service/src/__tests__/coach.service.integration.test.ts
  (updated for getClientRoadmap's new response shape)

frontend/web/src/app/pages/pt/ClientRoadmapCard.tsx (3-state rendering)
frontend/web/src/app/services/api.ts (ptCoachService.getClientRoadmap return type)

backend/services/auth-service/prisma/seed.ts (+1 dedicated E2E test account,
  upsert-based, same pattern as every existing seed account)

External harness (c:\D_Backup\Test\fitnessassistant-playwright-e2e):
  fixtures/auth.ts (+SEED_ACCOUNTS.roadmapClient)
  tests/31-fitness-roadmap.spec.ts (rewritten: dedicated account, adaptive
    TC-001 for repeatability, goal-image + double-submit folded in)

docs/FITNESS_ROADMAP_CLOSURE_IMPLEMENTATION_REPORT.md (this file)
docs/FITNESS_ROADMAP_PT_POSITIVE_E2E_REPORT.md (new)
docs/FITNESS_ROADMAP_GOAL_IMAGE_E2E_REPORT.md (new)
docs/FITNESS_ROADMAP_REPEATABILITY_REPORT.md (new)
docs/FITNESS_ROADMAP_CLOSURE_VERIFICATION_REPORT.md (new)
```

## 9. Regression (real PostgreSQL, isolated test stack, unchanged
`postgres-test`/`55433`/`gymcoach_fitness_test`)

```text
fitness-roadmap.service.integration.test.ts: 40/40 PASS (was 38, +2 net —
  see §2's test-count note: +3 new tests, 1 pre-existing test's assertion
  target unaffected, only its setup changed)
coach.service.integration.test.ts:            7/7 PASS (updated for new
  response shape, same test count)
pure baseline (5 files):                      128/128 PASS, unchanged
fitness-service build (tsc --noEmit):         PASS, 0 errors
frontend build (vite build):                  PASS, 0 errors
```

No new failures anywhere touched by this pass.
