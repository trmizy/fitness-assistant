# Gymini PT / Coach Client Coaching Workspace — Audit

Date: 2026-09-10
Scope: PT/coach-facing product area. Client journey architecture
(Roadmap/TrainingCycle/AI Workout/Nutrition) is CLOSED and unchanged —
this audit only maps how a PT reaches and reads/writes into that
existing client-owned system. Code is authoritative; every claim below
is cited by file:line, not assumed. Written BEFORE any implementation.

## Headline finding

Far more PT/coach infrastructure already exists than the master task's
framing implies. This is NOT a "collection of unrelated pages that needs
to become a hub" from scratch — `PTClientDetail.tsx` already embeds a
fitness summary card, a roadmap card, and a plan-assignment modal, all
backed by real, authorization-gated backend endpoints. The dominant
remaining work is: (1) solve the contract/payment E2E-testability
problem (the one genuine, long-standing blocker), (2) close a handful of
real, specific display gaps (InBody/progress, NutritionProgram detail,
CycleAssessment reasoning, a derived "needs attention" section), (3)
prove everything end-to-end in a real browser with a real authorized
relationship, and (4) the full security/IDOR/mobile/regression pass.

Also notable: the entire FitnessRoadmap PT-integration feature
(`coach.service.ts`'s `getClientRoadmap`/`createRoadmapDraftForClient`,
`fitness-roadmap.routes.ts`, `ClientRoadmapCard.tsx`,
`PtRoadmapDraftModal.tsx`, and the whole FitnessRoadmap engine itself) is
**uncommitted** — it exists only in this working tree (from earlier
phases of this same session), not in any git commit. This audit treats
it as real, current code (it's live in the running dev stack), but
`git status` must be re-checked before assuming CI/another clone has it.

---

## 1. PT account/profile model — IMPLEMENTED

`UserProfile` (user-service) carries PT-specific fields (`isPT`,
`ptSuspended`, `isAcceptingClients`, application/verification status via
`PTApplication`). PT identity is just `role: "PT"` on the shared `User`
row — no separate PT table. `PTApplication`
(`pt_application.routes.ts`) is the onboarding/verification flow, out of
scope for this phase (already built, unrelated to coaching).

## 2. Client account/profile model — IMPLEMENTED, unchanged

Standard `UserProfile` (user-service) + the full client-owned fitness
graph (FitnessRoadmap/TrainingCycle/WorkoutProgram/NutritionGoal/
InBody) already closed and verified in the prior Cross-System phase.
Not reopened here.

## 3. Contract model — IMPLEMENTED

`Contract` (user-service, `prisma/schema.prisma:521-641`), table
`contracts`. Full field list, `ContractStatus` enum (8 values:
PENDING_REVIEW/PENDING_SIGNATURE/PENDING_PAYMENT/ACTIVE/COMPLETED/
EXPIRED/CANCELLED/REJECTED), `ContractSource` enum
(INDEPENDENT/GYM/MARKETPLACE) — see the dedicated audit-agent report
folded into this document's history for exhaustive field list. Money
fields are `Decimal(14,2)`, never float. Lives in **user-service**, not
payment-service (payment-service only has `PaymentTransaction` + wallet
ledger models).

## 4. Contract statuses — IMPLEMENTED

8-state enum (§3). The PT-authorization gate keys on exactly one
condition: `status === ACTIVE` for the specific `(ptUserId,
clientUserId)` pair — confirmed at
`contract.repository.ts:64-68`'s `findActivePtClientPair`. EXPIRED/
CANCELLED/REJECTED/COMPLETED/PENDING_* all correctly fail this check
(no separate "was once active" grandfathering).

## 5. PT-client relationship authorization helper — IMPLEMENTED

Two-layer, cross-service, never cached, fails closed:

```text
coachService.assertActivePtClientRelationship(ptUserId, clientUserId)
  fitness-service, coach.service.ts:37-42
  -> coachDeps.isActivePtClientRelationship (mutable test-stub seam)
  -> user.client.ts:310-327, isActivePtClientRelationship()
     -> GET /internal/contracts/active-relationship (cross-service HTTP)
     -> user-service contract.controller.ts:253-266
     -> contract.service.ts:1117-1120, checkActivePtClientRelationship
     -> contract.repository.ts:64-68, findActivePtClientPair
        WHERE ptUserId=X AND clientUserId=Y AND status=ACTIVE
```

Any network/timeout error on the cross-service call returns `false`
(fail closed), never throws through to "assume authorized." Called by
every `coachService` method (`getClientSummary`,
`approveNutritionRecommendation`, `rejectNutritionRecommendation`,
`modifyNutritionRecommendation`, `triggerDietBreakRecommendation`,
`createAndAssignPlan`, `generatePlanDraft`, `getClientRoadmap`,
`createRoadmapDraftForClient`) — no PT-facing method skips it.

Note: gym-service's own `pt.routes.ts` (PT↔gym affiliation, a
*different* relationship entirely) uses a plain role check
(`requireRoles('PT')`), not this helper — correctly, since that surface
has nothing to do with client coaching authorization. Not touched this
phase.

## 6. Payment → Contract activation path — IMPLEMENTED (real gateway only)

Two real paths, both driven by a **payment webhook**, never a
synchronous client-facing call:

**Path A (negotiated hire):** `requestContract` (PENDING_REVIEW) →
`acceptContract` (PENDING_SIGNATURE or PENDING_PAYMENT) → [e-sign
webhook if required] → `pay()` (`contract.service.ts:1208-1256`, calls
`paymentClient.checkout` with `relatedEntityType: "PT_CONTRACT"`,
returns a real gateway redirect) → gateway webhook lands →
`webhook.service.ts`'s `settlePurchase()` → escrow/party split →
`reconciliation.service.ts`'s `callActivateEndpoint` routes by
`relatedEntityType` → `POST /internal/contracts/:id/activate-after-payment`
→ `activateAfterPayment` re-verifies the transaction, then
`contractRepository.activateIfPending` flips PENDING_PAYMENT→ACTIVE
(idempotent). A periodic reconciliation sweep retries this call if the
webhook-triggered one failed.

**Path B (Marketplace):** a Personalized-PT-Service purchase settles via
the *same* payment-service checkout/webhook mechanism, then client
intake+consent submission (ai-service) calls
`POST /internal/contracts/marketplace` →
`createMarketplaceContract` creates the `Contract` **directly ACTIVE**
(no negotiation stages) — but payment for the underlying purchase still
went through the real gateway first.

**Critical fact for §4/§5 of the master task:** `payment.service.ts:7-21`
— the `MOCK` provider was **deliberately removed** as a security fix:
> "The MOCK provider is gone. It auto-marked any intent PAID after 500ms
> with no money moving... which made it a wallet-minting primitive one
> env var away from production." `DEFAULT_PROVIDER` is now `'VNPAY'`;
> passing `provider=MOCK` now throws 400. The E2E harness's own
> `TC-PG-004: MOCK top-up auto-completes` test (in the separate
> `fitnessassistant-playwright-e2e` repo) is now **stale** against this
> removal — not something to fix here (owned by a different repo/scope),
> just important not to rely on.

**What DOES still exist, and is the real fixture mechanism (§5 of the
master task):** `fixtures/paymentSecrets.ts` (E2E harness) forges a
correctly-*signed* VNPay return-query / ZaloPay callback body using the
app's own real sandbox `VNPAY_HASH_SECRET`/`ZALOPAY_KEY2` (read from the
untracked `.env` the running dev stack itself uses). This is already an
established, precedent pattern — `tests/13-payment-gateways.spec.ts`
uses it for wallet top-ups today. The receiving endpoint,
`GET /payments/vnpay/return` (payment-service,
`vnpay-return.routes.ts:63-106`), is **completely purpose-agnostic**: it
verifies the signature, then calls the same `handleEvent()` any real
IPN/webhook uses, which looks up the underlying `PaymentTransaction` by
`providerTransactionId` and settles it according to whatever
`relatedEntityType` that transaction actually has. So the SAME forge
technique that credits a wallet top-up will, applied to a real
`PT_CONTRACT`-purpose transaction (created via the real
`POST /contracts/:id/pay?provider=VNPAY`), drive the exact same real
settlement → reconciliation → activation chain — with **zero new
backend code, zero disabled authorization, zero direct DB writes to
`Contract`**. See the Implementation Report for the exact fixture
script. Classified per §35 as **REAL SERVICE FIXTURE** (a signed
callback forgery hitting the real webhook-handling code), explicitly
**not** "REAL SANDBOX PAYMENT" (no actual gateway checkout page is
driven) — labeled precisely everywhere this is used.

## 7. PT client-list API — IMPLEMENTED, already a single call

`GET /contracts/pt` (user-service, `contract.routes.ts`) →
`contractController.getByPT` → returns every contract for the PT with
`clientProfile` embedded per row (name/email/goal/weight) in **one**
response — the frontend (`PTClientList.tsx`) makes exactly one query
(`contractService.getByPT()`), filters/searches client-side. No N+1 at
the list level already (§31 mostly satisfied here — verify the
embedding itself isn't internally N+1 in the implementation report).

## 8. PT client-detail API — IMPLEMENTED (fitness data), MISSING (InBody)

`GET /coach/clients/:clientId/summary` (fitness-service) → returns
`activeCycle`, `cycleSummary.adherence`, `feedbackSummary` (sentiment,
safety flags, equipment-mismatch flags), `priorDecisions` (bare decision
codes), `nutrition.activeGoal`, `nutrition.latestNutritionDecision`
(with `canPtAct`). **No InBody/measurement data anywhere in this
response or any other coach.service.ts method** — confirmed by reading
the full file. This is a real gap, §23.

## 9. PT Roadmap APIs — IMPLEMENTED

`GET /coach/clients/:clientId/roadmap` → `{activeRoadmap, pendingDraft}`
(both via the client's own `getRoadmapProjection`, so the PT view
automatically inherits `trainingReadiness`/`nutritionReadiness` — added
in the prior Cycle Transition Continuity phase — **not yet rendered in
`ClientRoadmapCard.tsx`**, a real but small display gap, §10).
`POST /coach/clients/:clientId/roadmap/draft` → creates a DRAFT,
`createdByRole="PT"`, owned by the client. No activate/advance/rebuild/
archive reachable by a PT anywhere.

## 10. PT workout/program APIs — IMPLEMENTED

`POST /coach/clients/:clientId/plans` (`createAndAssignPlan`, delegates
to the SAME `workoutService.createManualProgram` the client's own
self-service flow uses — inherits identical canonical-Exercise.id
validation and identical client-equipment-context resolution, since
both are keyed off `clientUserId`, never a PT-supplied context).
`POST /coach/clients/:clientId/plan-draft` (`generatePlanDraft`, AI
draft only, never assigns — exercises sourced from a real, shuffled
DB sample of the real catalog, ids only, names resolved for display).
Frontend (`AssignPlanModal.tsx`) only ever offers exercises from a real
catalog search (`workoutService.getExercises`) — no free-text/arbitrary
exercise entry point exists in the PT UI at all.

## 11. PT nutrition review APIs — IMPLEMENTED

`approveNutritionRecommendation`/`rejectNutritionRecommendation`/
`modifyNutritionRecommendation`/`triggerDietBreakRecommendation` — all
real, all gated, all delegate to
`trainingCycleService.ptReviewNutritionRecommendation` (never a
parallel nutrition-decision path). MODIFY creates a real new
`NutritionGoal` version (`triggeredBy: "PT"`), never a raw overwrite.
Fully covered by `coach-nutrition-review.integration.test.ts` (see §18
below) — this maps real capabilities, not inference. **Gap:** no
endpoint or UI surfaces the current `NutritionProgram` (the actual meal
plan, distinct from the goal) or its consistency status
(`nutrition-goal-plan-consistency.service.ts`, already built for the
client-facing side) to the PT — §19.

## 12. PT access to InBody/progress — MISSING

No `coach.service.ts` method, no route, no frontend component. A real,
scoped gap (§23) — needs one small new read method reusing the client's
own InBody read path, gated by the same `assertActivePtClientRelationship`.

## 13. PT access to TrainingCycle/CycleAssessment — PARTIAL

`activeCycle`/`cycleSummary`/`priorDecisions` (bare decision codes) are
returned by `getClientSummary`, but no reason-code/explanation summary
for the TRAINING side of the latest assessment is surfaced (only the
NUTRITION half has `headline`/`explanation`). §21 gap.

## 14. Session/scheduling APIs relevant to coaching — IMPLEMENTED

`sessionService.getContractSessions(contractId)` already renders inside
`PTClientDetail.tsx`. Out of scope to expand (§28 of the master task) —
already sufficient for coaching context as a read-only list.

## 15. Frontend PT routes/pages — IMPLEMENTED, single-page (not tabbed) hub

`/pt/dashboard`, `/pt/clients`, `/pt/clients/:id`, `/pt/contracts`,
`/pt/plans`, `/pt/schedule`, `/pt/profile`, `/pt/wallet`,
`/pt/service-orders/:id` — all real, registered routes
(`routes.tsx:69-77,238-248`). `PTClientDetail.tsx` (381 lines) is
currently one long scrollable page (header + sessions list + fitness
summary card + roadmap card + contract info + contract history), not
tab-based. §7 asks to reorganize into
Overview/Training/Nutrition/Progress/History tabs — a restructuring of
existing sections plus the small new gaps above, not a rebuild.

## 16. Current permission matrix — see `docs/GYMINI_PT_PERMISSION_MATRIX.md`

## 17. Current browser coverage — PARTIAL/BLOCKED

`docs/FITNESS_ROADMAP_PT_POSITIVE_E2E_REPORT.md` (2026-09-09): the
authorization *boundary* (no relationship → 403) was verified live; the
full positive multi-role handoff was `BLOCKED` purely on needing a real
human to click through a real payment gateway. This phase's §6 solves
that with the REAL SERVICE FIXTURE from §6 above.

## 18. Known positive-path blocker — SOLVED (see §6)

## 19. Information architecture — see §29 of the master task; addressed in
the implementation report as a tab restructuring of existing sections.

## 20. Performance/query risks — AUDITED

- Client list: single call, embedded profile (§7). Verify the
  embedding query itself isn't N+1 inside `getByPT` (implementation
  report).
- Client detail: currently 3-4 parallel queries on mount
  (`pt-contracts`, `contract-sessions`, `pt-client-fitness-summary`,
  `pt-client-roadmap`) — all already scoped to ONE client, not N clients.
  No evidence of per-client fan-out anywhere in the current PT surface.
  The one risk to actively avoid: a PT-Dashboard-wide "clients needing
  attention" aggregate (master task §30) would require per-client
  Roadmap/Nutrition projections unless a bounded batch query is used —
  documented as a P2/P3 (not built this pass, to avoid introducing a
  real N+1) rather than half-built under time pressure.
