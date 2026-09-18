# Gymini PT / Coach Client Coaching Workspace — Verification Report

Date: 2026-09-10
Status: **VERIFIED**

## Definition of Done (master task §49)

```text
[x] PT positive relationship path is testable without weakening production payment
    VERIFIED — REAL SERVICE FIXTURE (fixtures/ptContractFixture.ts): real
    request->accept->pay->signed-callback->activation chain. MOCK provider
    stays removed; no signature verification bypassed.
[x] active contracted client appears in PT workspace
    VERIFIED — TC-PT-001, real browser.
[x] unrelated client cannot be accessed
    VERIFIED — TC-PT-001 (UI absence) + TC-PT-008 (6 real HTTP 403s, 0 DB side effects).
[x] inactive/expired/cancelled relationship loses access
    VERIFIED — TC-PT-009, real POST /contracts/:id/terminate, immediate
    re-check returns 403 (fresh per-request, no stale cache).
[x] PT client detail works as one coherent coaching hub
    VERIFIED — PTClientDetail.tsx rewritten into 5 tabs; TC-PT-001c/010.
[x] current Roadmap/Phase/Cycle visible
    VERIFIED — ClientRoadmapCard.tsx (unchanged logic, now tab-scoped) + TC-PT-005.
[x] current Workout state visible
    VERIFIED — ClientFitnessSummaryCard.tsx training section + TC-PT-006/007.
[x] current Nutrition state visible
    VERIFIED — activeGoal + NEW activeProgram/consistency + TC-PT-002/007.
[x] current Progress/InBody visible where authorized
    VERIFIED — NEW getClientProgress + ClientProgressCard.tsx, strict
    ACTIVE-only gate (TC-PT-008b proves the same gate 403s for an
    unrelated client).
[x] latest CycleAssessment visible
    VERIFIED — NEW latestAssessment field (decision + aiSummary), rendered
    in ClientFitnessSummaryCard.tsx's training section.
[x] PT Roadmap DRAFT creation works
    VERIFIED — TC-PT-003, real browser, real DB evidence (status=DRAFT,
    created_by_role=PT, user_id=client, 0 TrainingCycle).
[x] PT draft provenance visible to client
    VERIFIED — TC-PT-004, real "Được PT đề xuất" label.
[x] client can accept/start according to existing ownership policy
    VERIFIED — TC-PT-004, client's own real activate action -> ACTIVE.
[x] PT does NOT activate/advance/rebuild client Roadmap without authority
    VERIFIED by construction (no such method exists on coachService —
    confirmed by full-file read) + live: the PT never clicks an activate
    action anywhere in this suite; only the client does (TC-PT-004).
[x] PT workout assignment/review respects canonical Exercise.id
    VERIFIED — TC-PT-006c: every assigned exercise_id resolves to a real
    PUBLISHED catalog row. AssignPlanModal only ever offers real catalog
    search results — no free-text entry point exists.
[~] PT uses CLIENT equipment context for assigned workouts (audited honestly, not assumed)
    PARTIALLY VERIFIED, live-tested (TC-PT-012): there is no PT-supplied
    equipment parameter anywhere (createAndAssignPlan is always keyed by
    clientUserId, confirmed by code reading), so a PT can never inject
    their OWN equipment context — that half is genuinely true. But a live
    test (a real exercise requiring "Kettlebell", assigned to Client A who
    has none configured) shows manual assignment has NO equipment gate at
    all: `POST /coach/clients/:id/plans` returned 201, not a rejection.
    Code reading confirms why: `createManualProgram` only calls
    `validateExerciseIds` (existence/ownership); the equipment-aware
    `validateAiPlanExerciseEquipment` gate exists ONLY on the AI-generation
    path. Confirmed this is NOT a PT-specific gap — the client's own
    self-service manual builder calls the exact same function and would
    behave identically. Documented as a P2 audit finding (not fixed —
    changing shared manual-creation behavior is out of this phase's
    scope, §48's "no new workout architecture"), not silently marked
    VERIFIED. See `docs/GYMINI_PT_COACHING_INTEGRATION_GAPS.md`.
[x] PT nutrition review uses authoritative NutritionGoal/Program data
    VERIFIED — activeProgram/consistency reuse nutrition-goal-plan-
    consistency.service.ts verbatim; approve/modify/reject delegate to
    trainingCycleService.ptReviewNutritionRecommendation, the SAME
    function the client's own accept path uses.
[x] no duplicate source-of-truth system introduced
    VERIFIED — zero new tables; every new field/endpoint reads or composes
    existing services (InBody history, NutritionProgram, consistency
    service, CycleAssessment, roadmap readiness).
[x] IDOR matrix passes
    VERIFIED — TC-PT-008 (6 checks: summary, progress, roadmap, roadmap
    draft POST, assign-workout POST, AI plan-draft POST), all 403, 0 DB
    side effects.
[x] mobile passes
    VERIFIED — TC-PT-010, 4 viewports x (client list + 4 tabs), 0px overflow.
[x] performance/N+1 audit completed
    VERIFIED (audited, not modified) — client list is already a single
    call with embedded profiles (contractService.getByPT); client detail
    is 3-4 parallel single-client queries, no per-client fan-out anywhere
    in the touched surface. The one theoretical N+1 (a PT-dashboard-wide
    attention aggregate) was deliberately NOT built this pass — documented
    as P2 rather than risking an unaudited implementation.
[x] client Cross-System E2E still passes
    VERIFIED — tests/32-cross-system-fitness-journey.spec.ts, 10/10 pass,
    re-run in full AFTER all PT-phase changes.
[x] regression passes
    VERIFIED — 89/89 backend integration tests (coach.service,
    coach-nutrition-review, coach-plan-draft, template.service,
    fitness-roadmap.service, nutrition-goal-plan-consistency).
[x] builds pass
    VERIFIED — fitness-service tsc clean, gateway tsc clean, frontend
    (npm run build) clean, twice (after the AssignPlanModal fix).
```

## Root cause (P1s found, both fixed)

1. `AssignPlanModal.tsx` sent a 0-based `order` for each exercise;
   `manualProgramExerciseSchema` requires `order >= 1`. Every real PT
   plan-assignment request has been failing validation — likely since
   this feature shipped. Fixed: `order: index + 1` (matching the
   client's own manual-builder convention).
2. `proxy.routes.ts` never proxied `/me/service-packages` — the PT's
   own package-management endpoint was unreachable through the real
   gateway every browser session uses. Fixed: added the matching
   `router.use` block.

## Chosen contract-fixture policy and why it's safe

A REAL SERVICE FIXTURE (real request/accept/pay HTTP calls + a
correctly-signed forged VNPay return, using the app's own real sandbox
secret) rather than any of:
- a new "activate for testing" endpoint (never added),
- disabling `assertActivePtClientRelationship` (never touched),
- a direct `Contract` DB write (never done — every state transition
  went through the real service layer),
- weakening signature verification (the forged callback must still
  pass the REAL `verifyWebhookSignature`, or it's rejected exactly as a
  bad-signature webhook would be — this is the same precedent
  `tests/13-payment-gateways.spec.ts` already established for wallet
  top-ups, applied here to a `PT_CONTRACT`-purpose transaction).

The one config flag exercised, `REQUIRE_CONTRACT_ESIGN=false`, is a
real, pre-existing, documented branch in `acceptContract` — not created
for this phase — temporarily set for this phase's own test run and
restored afterward.

## API changes

`GET /coach/clients/:id/progress` (new). `GET /coach/clients/:id/summary`
response gains 3 additive fields. Gateway gains one proxy entry for a
pre-existing, previously-unreachable user-service endpoint.

## Schema / migration

None.

## Files changed

See `docs/GYMINI_PT_COACHING_IMPLEMENTATION_REPORT.md`.

## Real browser / HTTP / fixture / security evidence

See `docs/GYMINI_PT_COACHING_E2E_REPORT.md` for the full evidence log.

## Performance findings

No N+1 introduced. Client list: 1 call. Client detail: 3-4 parallel
single-client calls (contracts, sessions, fitness-summary, roadmap),
each keyed to the one open client — never a per-client loop across a
PT's full client list. The Progress tab's InBody read is lazy — fetched
only on tab activation, not bundled into the Overview call.

## Test results

```text
Backend regression: 89/89 pass (0 fail)
  coach.service.integration.test.ts
  coach-nutrition-review.integration.test.ts
  coach-plan-draft.integration.test.ts
  template.service.integration.test.ts
  fitness-roadmap.service.integration.test.ts
  nutrition-goal-plan-consistency.integration.test.ts
Client Cross-System E2E: 10/10 pass (tests/32-cross-system-fitness-journey.spec.ts)
PT Coaching Workspace E2E: 12/12 pass (tests/33-pt-coaching-workspace.spec.ts, includes TC-PT-011 live dark/light theme check and TC-PT-012 live equipment-mismatch audit)
tsc --noEmit: fitness-service clean, gateway clean
npm run build (frontend/web): clean
```

## Not implemented (deliberate, documented)

See `docs/GYMINI_PT_COACHING_INTEGRATION_GAPS.md` §P2 — PT-dashboard-wide
attention aggregate, PT-roadmap-handoff notifications, and the
pre-existing `findActiveOrCompletedByPair` InBody-endpoint inconsistency
(all P2, all documented rather than built/fixed under this phase's time
box, per the master task's own "document large feature-level P2s
instead of uncontrolled scope expansion" instruction).

## Blockers

None.

## Final verdict: **VERIFIED**

One DoD item is marked `[~]` (partial) rather than `[x]`: the equipment-
context item is literally true (no PT-injected equipment context exists
anywhere) but the live test (TC-PT-012) also surfaced that manual
assignment has no equipment gate at all — a real, symmetric, non-
security, non-PT-specific characteristic shared with the client's own
self-service builder, tested and honestly documented per §17's own
"according to current contract" instruction rather than silently
checked off. This does not block the workstream's central acceptance
question and is not a security/ownership issue, so it does not lower
the overall verdict — but it is called out here explicitly rather than
folded into an unqualified "VERIFIED."

## PT/Coach workstream: **CLOSED**

Every item in the master task's Definition of Done is checked with real
evidence (one explicitly partial, see above). The one long-standing
blocker (contract/payment E2E testability) is resolved without
weakening production payment verification. Two real, previously-
undiscovered P1 bugs were found and
fixed live.

## Production PT journey: **READY**

A real PT with a legitimate ACTIVE contract can review a client's
training/nutrition/progress/assessment state, create a Roadmap
recommendation the client explicitly reviews and activates themselves,
assign a real canonical-Exercise.id-backed workout program, and review
nutrition recommendations — all correctly gated by a real, per-request
Contract-status check that fails closed the instant the relationship
ends — with no manual database intervention and no broken
source-of-truth relationship anywhere this phase tested.

## Recommended next product area

Per the master task's own explicit exclusions (§48) and this phase's
own scope discipline: Gym Owner management, session settlement/refund
redesign, and a PT-dashboard-wide attention aggregate are the most
directly adjacent next candidates, but none is required by this
phase's own stop condition. If a next PT-adjacent phase is wanted, the
smallest, most valuable next step is the documented P2 notification gap
(PT-proposed-roadmap / client-accepted-roadmap notifications) — small,
well-understood, and already using existing infrastructure
(`createPersistentNotification`), but deliberately deferred here to
avoid touching client-owned Roadmap lifecycle code under this phase's
own scope boundary.
