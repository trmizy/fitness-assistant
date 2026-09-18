# Gymini PT Coaching Workspace — Implementation Report

Date: 2026-09-10
Design doc: `docs/GYMINI_PT_COACHING_WORKSPACE_AUDIT.md`
Permission matrix: `docs/GYMINI_PT_PERMISSION_MATRIX.md`
Gaps: `docs/GYMINI_PT_COACHING_INTEGRATION_GAPS.md`

## Summary

Closes the long-standing PT positive-contract-path E2E blocker with a
real, non-payment-weakening service fixture; restructures
`PTClientDetail.tsx` into one tabbed coaching workspace; closes three
small, real display gaps (InBody/progress, NutritionProgram +
consistency, training-side CycleAssessment reasoning); and fixes two
real production bugs found live while building the E2E suite.

## §4/§5/§6/§33 — The contract/payment testability fix

**Root cause of the prior blocker:** contract payment (`contract.service.ts`'s
`pay()`) starts a real gateway checkout (`paymentClient.checkout`) and
only activates on a real payment webhook — by design, this cannot be
completed unattended without either a human clicking through a real
VNPay/ZaloPay checkout page, or exercising the real webhook-verification
code with a real signature.

**The MOCK provider is gone** — deliberately removed
(`payment.service.ts:7-21`) as a security fix ("a wallet-minting
primitive one env var away from production"). Not resurrected, not
touched.

**Chosen fixture — REAL SERVICE FIXTURE (per §35's labeling, explicitly
not "REAL SANDBOX PAYMENT"):**

```text
1. POST /contracts/request              (real, client-authenticated)
2. PATCH /contracts/:id/accept          (real, PT-authenticated)
3. POST /contracts/:id/pay              (real; starts a real VNPay
                                          checkout intent, real
                                          PaymentTransaction row, real
                                          vnp_TxnRef)
4. GET /payments/vnpay/return?<signed>  (a forged-but-correctly-SIGNED
                                          VNPay return query, using the
                                          app's own real VNPAY_HASH_SECRET
                                          — the exact same technique
                                          tests/13-payment-gateways.spec.ts
                                          already uses for wallet top-ups.
                                          Hits the REAL signature
                                          verification + REAL webhook
                                          settlement + REAL
                                          reconciliation-driven
                                          activation chain.)
```

Zero direct DB writes to `Contract`/`PaymentTransaction`. Zero disabled
authorization. Zero new backend endpoints. Implemented in
`fitnessassistant-playwright-e2e/fixtures/ptContractFixture.ts`
(`establishActivePtClientContract`/`establishOrReuseActivePtClientContract`).

**One real, pre-existing app config flag used, and reverted after this
phase's E2E work**: `REQUIRE_CONTRACT_ESIGN=false` (temporarily set in
`.env`, then removed and the container restarted). This is a real,
pre-existing branch in `contractService.acceptContract` (skip e-sign
entirely) — not something built for this phase. E-sign itself (even in
`DROPBOX_SIGN_TEST_MODE`) still requires a human to click a real email
link, so it remains a genuine, honestly-documented external dependency
for the NEGOTIATED-with-e-sign path specifically — the fixture instead
exercises the (also real, also production) e-sign-skipped path.

## §11-§12 — PT Roadmap draft creation / client handoff

Both already fully implemented (backend uncommitted-but-live from an
earlier phase of this session, frontend built in that same phase) — this
pass re-tested them as a full real positive path (TC-PT-003/004/005),
found them correct, and made no code changes to this flow itself.

## §7-§9 — PTClientDetail restructured into one coaching workspace

`PTClientDetail.tsx` rewritten from one long scrollable page into 5 tabs
(Tổng quan/Tập luyện/Dinh dưỡng/Tiến độ/Lịch sử) — every existing section
(sessions list, `ClientFitnessSummaryCard`, `ClientRoadmapCard`, contract
info/history, `AssignPlanModal`) moved into the tab it belongs to, none
rebuilt. `ClientFitnessSummaryCard.tsx` gained a `section?: "training" |
"nutrition" | "both"` prop (default `"both"`, preserving old behavior)
so the SAME query/mutations render only the half relevant to the active
tab — no duplicate query, no new component split needed.

New `AttentionSection` (Overview tab, §9) — a small, purely-derived
"Cần chú ý" list from data already fetched for that tab
(`trainingReadiness`, pending draft, nutrition consistency status,
`canPtAct`, adherence) — no new scoring engine, exactly per the master
task's own instruction.

## §10/§19/§21/§23 — Small, real display gaps closed

- **§10** `ClientRoadmapCard.tsx` now renders `trainingReadiness`/
  `nutritionReadiness` badges — the data was already returned by
  `getClientRoadmap` (it wraps the client's own `getRoadmapProjection`,
  extended in the prior Cycle Transition Continuity phase); only the
  UI was missing.
- **§19** `coach.service.ts`'s `getClientSummary` now also returns
  `nutrition.activeProgram` (the real NutritionProgram) and
  `nutrition.consistency` (reusing
  `nutrition-goal-plan-consistency.service.ts` verbatim — zero new
  consistency logic). Rendered in `ClientFitnessSummaryCard.tsx`.
- **§21** `getClientSummary` now also returns `latestAssessment`
  (`decision`, `aiSummary`, `reasonCodes`, `confidenceScore` from the
  real, most recent COMPLETED `CycleAssessment`) — the same
  LLM-explanation field the client's own UI already trusts, never raw
  chain-of-thought.
- **§23/§32** New `coach.service.ts` method `getClientProgress` +
  route `GET /coach/clients/:id/progress` + new `ClientProgressCard.tsx`
  (Progress tab, lazy-loaded on tab activation — never bundled into the
  always-loaded Overview summary). Reuses the existing
  `fetchInBodyHistory` cross-service read (already used by
  `training-cycle.service.ts` for baseline computation) — no new InBody
  read path. Deliberately re-checks the **strict ACTIVE-only**
  relationship gate (`assertActivePtClientRelationship`), not the
  looser `findActiveOrCompletedByPair` the pre-existing, unrelated
  `GET /inbody/client/:clientUserId` endpoint uses — see the permission
  matrix's own note on that discrepancy (documented, not silently
  "fixed" outside its own domain).

## Two real bugs found and fixed (found live, not by inspection alone)

1. **P1 — `AssignPlanModal.tsx`'s workout assignment was completely
   broken.** `exercises.map((e, order) => ({..., order, ...}))` used the
   raw 0-based array index; `manualProgramExerciseSchema` requires
   `order >= 1`. Every day's first exercise (`order: 0`) failed zod
   validation, so `POST /coach/clients/:id/plans` always 400'd — the
   real PT "Giao kế hoạch" action has likely never worked. Confirmed by
   reading the client's own manual-program builder
   (`WorkoutLogPage.tsx:2485,2578`, `order: index + 1`), which uses the
   correct 1-based convention. **Fixed**: `order: index + 1`.
2. **P1/infra — `GET/POST /me/service-packages` was never wired into
   the gateway's proxy at all.** `pt_service_package.routes.ts` is
   mounted in user-service, but `proxy.routes.ts` had no `/me/service-
   packages` entry among its explicit `/me/*` list — meaning this
   endpoint was unreachable through the real gateway every real browser
   session uses. `PTProfilePage.tsx`'s package-management UI has likely
   been silently broken in the real running stack. **Fixed**: added the
   matching `router.use("/me/service-packages", authMiddleware,
   createProxyMiddleware({ target: USER_SERVICE_URL, ... }))` block,
   mirroring the existing `/contracts` entry exactly.

Both confirmed fixed live (TC-PT-006 passing end to end after the fix;
`curl` confirming the gateway route directly).

## API changes

- `GET /coach/clients/:clientId/progress` (new, fitness-service) —
  InBody/progress read, gated by the same strict relationship check.
- `GET /coach/clients/:clientId/summary`'s response gains
  `nutrition.activeProgram`, `nutrition.consistency`, `latestAssessment`
  — additive, no existing field changed shape.
- Gateway: `/me/service-packages` proxy entry added (fixes reachability
  of an existing, unrelated user-service endpoint).

## Schema / migration

None. Confirmed by design-doc audit: every new field is derived from
existing tables/services (InBody history, NutritionProgram,
nutrition-goal-plan-consistency service, CycleAssessment).

## Files changed

Backend:
- `backend/services/fitness-service/src/services/coach.service.ts`
- `backend/services/fitness-service/src/controllers/coach.controller.ts`
- `backend/services/fitness-service/src/routes/coach.routes.ts`
- `backend/gateway/src/routes/proxy.routes.ts`

Frontend:
- `frontend/web/src/app/pages/pt/PTClientDetail.tsx` (rewritten, tabbed)
- `frontend/web/src/app/pages/pt/ClientFitnessSummaryCard.tsx` (section prop, NutritionProgram/consistency, latestAssessment)
- `frontend/web/src/app/pages/pt/ClientRoadmapCard.tsx` (readiness badges)
- `frontend/web/src/app/pages/pt/ClientProgressCard.tsx` (new)
- `frontend/web/src/app/pages/pt/AssignPlanModal.tsx` (order bug fix)
- `frontend/web/src/app/services/api.ts` (`CoachClientProgress` type, `getClientProgress`, extended `CoachClientSummary`)

Auth seed:
- `backend/services/auth-service/prisma/seed.ts` (3 dedicated PT-coaching accounts)

External E2E harness (`fitnessassistant-playwright-e2e`):
- `fixtures/ptContractFixture.ts` (new)
- `fixtures/auth.ts` (3 new seed accounts)
- `tests/33-pt-coaching-workspace.spec.ts` (new, TC-PT-001..010)

Temporary (created and deleted within this phase):
- `backend/services/user-service/src/scripts/_tmp_preparePtCoachingFixture.ts` — one-off prerequisite-row prep (PT approval flags, one PTServicePackage), deleted after use.
