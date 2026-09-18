# FitnessRoadmap Hardening Implementation Report

Date: 2026-09-09
Scope: `backend/services/fitness-service`, `backend/services/ai-service`,
`frontend/web`, and the external Playwright E2E harness
(`c:\D_Backup\Test\fitnessassistant-playwright-e2e`)

Builds on the already-VERIFIED backend + build-verified frontend from the
prior "next-phase" pass. This pass closes the remaining product/runtime
gaps: goal-aware AI fallback, explicit Accept-vs-Activate UX, a real PT
frontend entry point, rebuild before/after UX, and real browser E2E.

## 1. Audit Findings

Read first: all six prior design/report docs, then the real current code
(`fitness-roadmap.service.ts`, `coach.service.ts`, `roadmap-draft.service.ts`,
`RoadmapJourneyPage.tsx`, `TrainingPage.tsx`, `api.ts`,
`proxy.routes.ts`, `PTClientDetail.tsx`, `AssignPlanModal.tsx`, the real
Playwright E2E harness). Confirmed against code, not just the reports:

```text
- AI fallback (both ai-service and fitness-service) hardcoded FAT_LOSS
  regardless of the caller's stated goal — a real bug (§2).
- The AI-draft "Accept" button silently activated the roadmap in the same
  click — ambiguous per the master task's own explicit concern (§3).
- GET /fitness-roadmaps/current is ACTIVE-only by design; there was no
  client-facing way to discover a DRAFT roadmap (including a PT-created
  one) — a real product gap (§3).
- PTClientDetail.tsx had no roadmap entry point at all; ptCoachService had
  no roadmap methods (§4).
- The gateway had no /fitness-roadmaps proxy rule until the prior pass —
  confirmed still correct and live this pass.
- The E2E harness lives outside this repo, at
  c:\D_Backup\Test\fitnessassistant-playwright-e2e (not
  fitnessassistant-playwright-e2e/ inside the app repo, which does not
  exist in this checkout) — found by search, not assumed.
```

## 2. Goal-Aware Fallback Fix

**Before**: both `roadmap-draft.service.ts` (ai-service) and
`fitness-roadmap.service.ts`'s two internal fallback paths
(unreachable-ai-service, and zero-valid-phases-after-filtering) hardcoded
`phaseType: "FAT_LOSS"` regardless of the caller's `goalType`.

**After**: a `mapGoalTypeToFallbackPhaseType(goalType)` function (declared
independently in both services, same decoupling reasoning as the existing
independently-declared `RoadmapPhaseTypeSchema`) maps:

```text
WEIGHT_LOSS         -> FAT_LOSS
MUSCLE_GAIN         -> LEAN_GAIN
MAINTENANCE         -> MAINTENANCE
ATHLETIC_PERFORMANCE -> PERFORMANCE
(unrecognized/future) -> MAINTENANCE   (safe/neutral, never FAT_LOSS)
```

Safety-screening (`FOLLOW_UP_SUGGESTED` -> `RECOVERY`) still overrides the
goal mapping in all three fallback sites — safety outranks goal, unchanged.

Files: `backend/services/ai-service/src/services/roadmap-draft.service.ts`,
`backend/services/fitness-service/src/services/fitness-roadmap.service.ts`.

Tests added: 7 in ai-service (`roadmap-draft.test.ts`: 4 goal mappings + 1
unrecognized-goal + 1 safety-overrides-goal + 1 invalid-phases-with-goal),
5 in fitness-service (`fitness-roadmap.service.integration.test.ts`: 4 goal
mappings against a real unreachable-ai-service path + 1
zero-valid-phases-with-goal against a real fake-ai-service stand-in).

## 3. Draft vs Activate UX Decision

**Decision**: implemented the master task's preferred two-step flow.
`AiDraftPanel`/`ManualCreatePanel`'s "accept"/"create" action now calls
`acceptAiDraft`/`create` only — creating a real `DRAFT`-status roadmap,
never auto-activating. A new `DraftRoadmapDetail` component (rendered
whenever `GET /fitness-roadmaps/draft/current` finds one) shows the full
review: name, goal, phases, AI summary/warnings/assumptions (see §3.1),
provenance badge, and two real, backend-supported actions — "Bắt đầu lộ
trình" (`activateRoadmap`) and "Bỏ bản nháp" (`archiveRoadmap`, valid on a
DRAFT since it has no ACTIVE phase). No "Chỉnh sửa" or "Tạo lại bằng AI"
button was added — the backend has no edit endpoint and no clean way to
regenerate in place, and the master task explicitly forbids faking
unsupported actions.

### 3.1 New self-service endpoint: `GET /fitness-roadmaps/draft/current`

`GET /fitness-roadmaps/current` stays ACTIVE-only (unchanged, intentional).
A new sibling, `getCurrentDraftRoadmap` /
`GET /fitness-roadmaps/draft/current`, is the smallest correct fix for the
"client can't see their own not-yet-activated draft" gap — same
`userId`-scoped `findFirst` pattern as the existing method, zero schema
change. IDOR-tested: scoped per user, a 404 when none, unaffected by
another user's draft (test:
`"FitnessRoadmap getCurrentDraftRoadmap surfaces the caller's own pending
DRAFT, scoped per user (IDOR-safe)"`).

### 3.2 AI metadata persistence

`draft.summary/reasoningSummary/confidence/warnings/assumptions` are not
their own columns — they're transient output of `generateAiRoadmapDraft`.
So they survive a refresh, `acceptAiDraft`'s payload now includes
`configuration: { aiDraft: {...} }`, using the roadmap's existing, already
generic `configuration` JSON field (the same additive-metadata convention
`TrainingCycle.configuration` already uses) — zero schema change.

## 4. Client Journey Changes

```text
RoadmapJourneyPage.tsx: root query restructured — tries GET /current first;
  on a real 404, tries GET /draft/current; renders DraftRoadmapDetail,
  NoRoadmapState, or the ACTIVE/COMPLETED/ARCHIVED/CANCELLED views
  accordingly. Provenance badge now covers all 4 creator roles ("Bạn tạo" /
  "Được PT đề xuất" / "AI đề xuất" / "Hệ thống tạo"), not just AI.
PendingRebuildBanner: now renders a real before/after split (current phase
  being completed + skipped-remaining vs. the proposed new phases), built
  from the real preview response, not a mock example (§5 below).
```

## 5. PT Frontend Implementation

```text
frontend/web/src/app/pages/pt/ClientRoadmapCard.tsx  (new)
frontend/web/src/app/pages/pt/PtRoadmapDraftModal.tsx (new)
frontend/web/src/app/pages/pt/PTClientDetail.tsx      (+1 card)
frontend/web/src/app/services/api.ts                  (+ptCoachService.getClientRoadmap/createRoadmapDraft)
```

Mirrors `ClientFitnessSummaryCard.tsx`/`AssignPlanModal.tsx`'s exact
card/modal/query/mutation conventions — no new component pattern
introduced. Only long-term planning metadata is collected (name, goal,
one starting phase type + duration) — never calories/macros/sets/reps.
The create button only appears when the client has **no** ACTIVE roadmap
(§5.3 of the master task — "do not offer to create conflicting ACTIVE
state"); when one exists, a read-only summary (name, active phase,
pending-rebuild notice) is shown instead. The modal explicitly tells the
PT "Học viên sẽ tự quyết định kích hoạt — bạn không thể kích hoạt thay học
viên" before creating, and the PT-side API wrapper offers no
activate/advance/rebuild/archive call at all (those routes don't exist
under `/coach/*` — the authorization boundary from the prior pass is
unchanged).

**Known gap, reported honestly**: if a client already has a *pending
DRAFT* (not yet ACTIVE) — e.g. from a previous PT visit — the PT card only
checks the ACTIVE endpoint and could offer to create a second DRAFT. No
PT-facing "get client's current draft" endpoint exists; adding one was
judged out of this pass's scope (documented here rather than silently
left out).

## 6. Rebuild UX Changes

`PendingRebuildBanner` now takes `currentPhaseId` + `phases` and renders a
two-column "Hiện tại" / "Đề xuất mới" split: the left column lists the
current phase (marked "Sẽ đánh dấu hoàn thành") and every already-PLANNED
phase after it (marked "Sẽ bị bỏ qua"), the right column lists the real
`previewRebuild` response's proposed phases with their real dates. The
banner's copy explicitly states history (training/nutrition/assessments)
is preserved — matching the backend's actual guarantee (unchanged from the
prior pass; see `FITNESS_ROADMAP_REBUILD_DESIGN.md`). No backend
rebuild/transaction/concurrency logic was touched.

## 7. AI-Assisted Rebuild Status

**Deferred, not attempted this pass.** The backend's `applyRoadmapRebuild`
already accepts a caller-supplied `phases` array (built in the prior
pass specifically to support this later without further backend change —
see `FITNESS_ROADMAP_REBUILD_DESIGN.md` §5). Adding an "Đề xuất phương án
khác bằng AI" button that calls a *new* AI-proposal-for-rebuild endpoint
would require a new ai-service contract (distinct from the initial-draft
one, since a rebuild proposal needs the current phase's history as
context) — a real, non-trivial scope addition. Given the master task's
own explicit permission to defer this specific phase, it is not
implemented this pass. The deterministic rebuild proposal (RECOVERY +
re-chained remaining phases) remains the only path, unchanged.

## 8. API Changes

```text
NEW: GET /fitness-roadmaps/draft/current
NEW: GET  /coach/clients/:clientId/roadmap        (already existed backend-side
NEW: POST /coach/clients/:clientId/roadmap/draft   from the prior pass — now
                                                    has a real frontend caller)
```

No other route added or removed. No schema/migration change this pass
either (confirmed: `prisma migrate status` — 53/53, unchanged).

## 9. Security Changes

```text
getCurrentDraftRoadmap is userId-scoped identically to every other roadmap
  read — IDOR-tested (own draft found; another user's draft never leaks;
  a 404 when none exists, not a crash).
No new route accepts a caller-supplied identity field. ptCoachService's new
  methods reuse the identical assertActivePtClientRelationship gate as
  every other PT action (unchanged, not re-implemented).
archiveRoadmap's active-cycle guard is now correctly SCOPED to the target
  roadmap's own phases (§ Finding 2 in the browser E2E report) — the
  unscoped version was a real, exploitable-by-accident false-positive
  (blocked a legitimate action based on unrelated data), now fixed and
  regression-tested.
```

## 10. Tests Added

```text
ai-service (roadmap-draft.test.ts): +7 (goal-aware fallback mapping)         19 total, 0 fail
fitness-service (fitness-roadmap.service.integration.test.ts):
  +5 (goal-aware fallback, real ai-service-unreachable + fake-stand-in paths)
  +1 (getCurrentDraftRoadmap IDOR/lifecycle test)
  +1 (archiveRoadmap-on-DRAFT-with-unrelated-legacy-cycle regression, Finding 2)
                                                                                38 total, 0 fail
fitness-service (coach.service.integration.test.ts): unchanged this pass      7 total, 0 fail (carried from prior pass)
E2E (tests/31-fitness-roadmap.spec.ts, new, external harness): 4 tests, all independently
  verified PASS with real evidence — see FITNESS_ROADMAP_BROWSER_E2E_REPORT.md
```

## 11. Exact Files Changed

```text
backend/services/ai-service/src/services/roadmap-draft.service.ts        (goal-aware fallback)
backend/services/ai-service/src/__tests__/roadmap-draft.test.ts          (+7 tests)

backend/services/fitness-service/src/services/fitness-roadmap.service.ts (goal-aware fallback,
  getCurrentDraftRoadmap, archiveRoadmap scoping fix)
backend/services/fitness-service/src/controllers/fitness-roadmap.controller.ts (+currentDraft handler)
backend/services/fitness-service/src/routes/fitness-roadmap.routes.ts    (+GET /draft/current)
backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts (+13 tests)

frontend/web/src/app/pages/client/RoadmapJourneyPage.tsx  (Accept!=Activate rework, DraftRoadmapDetail,
  rebuild before/after split, provenance labels for all 4 roles, goal-image upload — carried +
  extended from the prior pass)
frontend/web/src/app/pages/pt/ClientRoadmapCard.tsx        (new)
frontend/web/src/app/pages/pt/PtRoadmapDraftModal.tsx      (new)
frontend/web/src/app/pages/pt/PTClientDetail.tsx           (+1 card)
frontend/web/src/app/services/api.ts                       (+getCurrentDraft, +configuration on
  acceptAiDraft, +120s timeout on generateAiDraft [Finding 1], +ptCoachService roadmap methods)

External harness (c:\D_Backup\Test\fitnessassistant-playwright-e2e):
  tests/31-fitness-roadmap.spec.ts (new)

docs/FITNESS_ROADMAP_HARDENING_IMPLEMENTATION_REPORT.md   (this file)
docs/FITNESS_ROADMAP_BROWSER_E2E_REPORT.md                 (new)
docs/FITNESS_ROADMAP_FINAL_VERIFICATION_REPORT.md          (new)
```

No exercise-catalog / equipment / movement-pattern / substitution / seed
file was touched, per the parallel-development warning.

## 12. Remaining Gaps (honest)

```text
NOT IMPLEMENTED: AI-assisted rebuild proposal (§7, explicitly deferred).
NOT IMPLEMENTED: PT-facing visibility into a client's already-pending DRAFT
  (only their ACTIVE roadmap is checked before offering to create a new one).
NOT RUN LIVE: PT positive-path browser flow (payment-gated contract
  prerequisite — see FITNESS_ROADMAP_BROWSER_E2E_REPORT.md).
NOT RUN LIVE: Goal-image upload through the browser with a real file (code-
  reviewed + visible in the UI, not independently exercised with a file).
NOT RUN LIVE: double-click debouncing, simulated network delay, keyboard-
  only navigation.
```
