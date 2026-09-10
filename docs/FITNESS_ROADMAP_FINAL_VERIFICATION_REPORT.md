# FitnessRoadmap Final Verification Report

Date: 2026-09-09
Status: `PARTIALLY VERIFIED` — see §9 for the exact, category-by-category
breakdown (per the master task's own instruction not to collapse this into
one blanket verdict).

## 1. Build

```text
fitness-service (tsc --noEmit): PASS, 0 errors
ai-service (tsc --noEmit):      PASS, 0 errors
gateway (tsc --noEmit):         PASS, 0 errors
frontend (vite build):          PASS, 0 errors
```

## 2. Migration

```text
prisma migrate status: 53/53 applied, "Database schema is up to date!" —
  unchanged by this pass (zero schema/migration work needed for any of
  goal-aware fallback, draft/current, PT frontend, or rebuild UX changes)
```

## 3. Backend Regression (real PostgreSQL, isolated test stack —
`postgres-test`/`55433`/`gymcoach_fitness_test`, unchanged from the prior
verification pass)

```text
fitness-roadmap.service.integration.test.ts: 38/38 PASS, 0 fail, 0 skipped
  (31 carried from the prior pass + 7 new: 5 goal-aware-fallback,
  1 getCurrentDraftRoadmap, 1 archiveRoadmap-scoping regression)
coach.service.integration.test.ts:            7/7 PASS, 0 fail, 0 skipped (unchanged)
roadmap-draft.test.ts (ai-service):           19/19 PASS, 0 fail, 0 skipped
  (12 carried + 7 new goal-aware-fallback)
pure baseline (5 engine/util files):          128/128 PASS, 0 fail — unchanged, no drop
gateway full suite:                           21/21 PASS (re-confirmed, unchanged)
```

No new failures anywhere touched by this pass. (Unrelated
exercise-catalog-seed-parity / nutrition-agent / muscle-heatmap test
failures observed during one broader sweep of the full fitness-service
suite were traced to a concurrent parallel agent's in-progress catalog/
seed-data changes on the *shared* isolated test database — confirmed via
`git status` showing `prisma/seed_all.ts`/`seed_equipment_gap_exercises.ts`
actively modified and new untracked catalog test files appearing mid-
session, and by the failure set literally shifting between two
back-to-back identical runs. None of those files were touched by this
pass; per the master task's explicit instruction, they were not modified,
fixed, or further investigated.)

## 4. Real Bugs Found And Fixed This Pass (with evidence)

```text
1. Goal-aware AI fallback (both services hardcoded FAT_LOSS regardless of
   goalType) — found by code audit before browser testing, fixed, 12 new
   tests across both services, all PASS.
2. AI-draft request used the shared 10s default axios timeout instead of a
   real-LLM-call override — found via real browser E2E (request stuck
   pending, confirmed via Playwright trace network log showing
   response.status=-1 while a direct curl to the same endpoint completed
   in 5.8s) — fixed (120s override, matching the pattern already used
   elsewhere in the codebase).
3. archiveRoadmap's active-cycle guard was unscoped to the target roadmap,
   falsely blocking archival of a never-activated DRAFT because of an
   unrelated legacy ACTIVE TrainingCycle on the shared E2E seed account —
   found via real browser E2E (a real, organically-dirty account, not a
   synthetic fixture), fixed, 1 new regression test, PASS.
```

Full detail: `docs/FITNESS_ROADMAP_HARDENING_IMPLEMENTATION_REPORT.md`,
`docs/FITNESS_ROADMAP_BROWSER_E2E_REPORT.md`.

## 5. Security Recheck

```text
User A cannot see User B roadmap                        — unchanged, still enforced (userId-scoped queries throughout)
User A cannot activate User B roadmap                    — unchanged, still enforced
PT cannot create roadmap for unrelated client             — VERIFIED LIVE this pass (real 403, TC-ROADMAP-004)
PT cannot activate/advance/rebuild/archive client roadmap — no such route exists under /coach/*, confirmed by code review (unchanged)
New draft/current endpoint IDOR coverage                  — VERIFIED (real Postgres test: own draft found, another user's never leaks, 404 when none)
clientId never trusted from body                          — confirmed unchanged (req.user!.id / req.params.clientId + assertActivePtClientRelationship gate every PT call)
```

## 6. Concurrency

Unchanged this pass — the prior pass's REBUILD concurrency tests
(rebuild-vs-itself, rebuild-vs-advance, rebuild-vs-archive) still pass
(carried in the 38/38 roadmap-suite total above; no concurrency logic was
touched this pass).

## 7. Browser E2E (see `docs/FITNESS_ROADMAP_BROWSER_E2E_REPORT.md` for full detail)

```text
CLIENT FLOW:            PASS (full: no-roadmap -> AI draft -> review -> save DRAFT
                          -> refresh persists -> activate -> ACTIVE -> refresh/nav persists)
MOBILE (360/375/390/412): PASS (no horizontal overflow, all four widths)
DARK/LIGHT THEME:         PASS (both render with a real painted background)
PT AUTHORIZATION BOUNDARY: PASS (real 403, both GET and POST)
PT POSITIVE-PATH FLOW:    NOT RUN (payment-gated contract prerequisite; see report §)
GOAL IMAGE (real file upload): NOT RUN (UI control confirmed present/wired by code review;
                          not exercised end-to-end with a real file this pass)
```

## 8. Product State Matrix (API + primary CTA, verified by code review +
partially by live browser)

```text
NO ROADMAP        — 404 from /current and /draft/current -> NoRoadmapState, CTA: "Tạo bằng AI" / "Tạo thủ công"    [browser-verified]
DRAFT              — 200 from /draft/current -> DraftRoadmapDetail, CTA: "Bắt đầu lộ trình" / "Bỏ bản nháp"          [browser-verified]
ACTIVE              — 200 from /current -> Journey timeline + active phase, CTA: "Kiểm tra tiến độ" (when no active cycle) [browser-verified]
COMPLETED           — roadmap.status=COMPLETED -> Trophy banner, CTA: "Bắt đầu lộ trình mới" / "Lưu trữ lộ trình này"  [code-reviewed]
ARCHIVED            — roadmap.status=ARCHIVED -> read-only banner, CTA: "Bắt đầu lộ trình mới"                        [code-reviewed]
CANCELLED           — same as COMPLETED's CTA set (roadmap-level; RoadmapPhase CANCELLED is a distinct, narrower state — see gap below) [code-reviewed]
REBUILD PENDING      — pendingRebuild != null -> PendingRebuildBanner, CTA: "Xem đề xuất" -> "Áp dụng đề xuất này"     [code-reviewed, backend-verified]
AI FALLBACK (confidence=0) — explicit amber notice inside AiDraftPanel/DraftRoadmapDetail, goal-aware phase type      [browser-verified this pass]
PT-CREATED DRAFT     — createdByRole=PT -> "Được PT đề xuất" badge on DraftRoadmapDetail                              [code-reviewed; not browser-verified — needs the PT positive-path prerequisite noted in §7]
```

No inconsistent state was found requiring a fix beyond §4's three items.

## 9. Final Status (category-by-category, per the master task's own rule)

```text
BACKEND:            VERIFIED (real PostgreSQL, 0 fail across 38+7+19+128 tests)
FRONTEND BUILD:      VERIFIED (vite build, 0 errors)
CLIENT BROWSER:      VERIFIED (full happy path + mobile + theme, real browser, real backend)
PT BROWSER:          PARTIALLY VERIFIED (authorization boundary VERIFIED live;
                       positive multi-role flow NOT run — payment-gated
                       prerequisite out of this pass's scope, not a code gap)
MOBILE:              VERIFIED (4/4 widths, real DOM measurement)
THEME:               VERIFIED (dark + light, real computed style)
GOAL IMAGE:          PARTIALLY VERIFIED (wired + rendered; not exercised
                       with a real uploaded file)
REBUILD UX:           VERIFIED by code review + the prior pass's backend
                       verification; not independently re-driven through
                       the browser this pass (no code in the rebuild
                       transaction/concurrency path was touched)
```

**Overall**: `PARTIALLY VERIFIED`. Every gap above is a scope/environment
boundary (a real payment prerequisite, a file-upload fixture not built),
not a known defect left unfixed — every defect actually found this pass
(3, see §4) was fixed and regression-tested. Nothing backend-verified in
the prior pass was downgraded by an unrelated browser-environment
limitation, per the master task's explicit instruction.

## 10. Recommended Next Step

```text
1. If the PT positive-path flow needs live E2E coverage, extend
   05-pt-contract-payment.spec.ts's existing real-contract-creation flow
   (or a lighter sandbox/mock variant of it) to hand off into
   31-fitness-roadmap.spec.ts rather than duplicating it there.
2. Add a small real-JPEG fixture (same technique 28-ai-features-
   structural.spec.ts already uses for its synthetic InBody report) to
   exercise the goal-image upload end-to-end.
3. Decide whether AI-assisted rebuild proposals (deferred, §7 of the
   hardening report) are wanted as a follow-up phase.
4. Give the PT card visibility into a client's pending DRAFT (not just
   ACTIVE), to avoid ever offering a second, redundant draft.
```
