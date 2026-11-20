# 08 — PT Client Management & AI Copilot Audit (HIGH PRIORITY)

All findings `CODE_INSPECTION` against current HEAD `003545c6` unless noted. No code was modified to produce this audit.

## 1. Authorization — the real boundary

**Single gate for every fitness-service PT→client operation**: `coachService.assertActivePtClientRelationship(ptUserId, clientUserId)` (`backend/services/fitness-service/src/services/coach.service.ts:38-43`) → `isActivePtClientRelationship` (`.../clients/user.client.ts:310-327`) → internal HTTP call to user-service `GET /internal/contracts/active-relationship` (protected by `serviceSecretMiddleware`, not reachable from the public gateway) → `contractRepository.findActivePtClientPair` (`contract.repository.ts:64-68`, strict `status === ACTIVE` only). **Fails closed**: any transport error returns `false` (`user.client.ts:320-326`).

**Identity sourcing is correct everywhere checked**: the PT's own id always comes from `req.user!.id` (verified JWT/gateway header, never client-supplied); the target client id always comes from `req.params.clientId` (a URL path segment) — every one of the 10 `coach.controller.ts` handlers passes it straight through, **none reads a client id from the request body**. The relationship is re-verified fresh on every single call; there is no cache that could let a stale relationship persist after revocation.

**Verdict: no code path exists today where a PT can reach another PT's client's data by supplying a clientId.** This is the strongest possible outcome for the exact P0 risk CLAUDE.md's "Account/Session Isolation" rule is written to prevent, specific to the PT-client relationship, and it was found genuinely true by direct tracing, not inferred from a doc.

### Per-operation trace

| Operation | Function | Gate location |
|---|---|---|
| PT views client workout/nutrition/InBody | `getClientSummary`, `getClientProgress`, `getClientWorkoutSchedules` (`coach.service.ts:51, 502, 532`) | Line 52/503/537 respectively |
| PT assigns/modifies training program | `createAndAssignPlan` (`coach.service.ts:314-348`) → `workoutService.createManualProgram(clientUserId, ...)` | Gate at line 315; program is created **under `clientUserId`**, so ownership is correct by construction |
| PT generates an AI draft for a client | `generatePlanDraft` (`coach.service.ts:356-443`) | Gate at line 361; **confirmed never persists** — only writes `planGenerationAudit`, no `WorkoutProgram`/`WorkoutSchedule` write anywhere in the method |
| PT reviews client's nutrition CycleAssessment proposal | `approveNutritionRecommendation`/`rejectNutritionRecommendation`/`modifyNutritionRecommendation` (`coach.service.ts:206-275`) | Gates at 207/226/258 |
| PT reviews client's **training**-side CycleAssessment proposal | `approveTrainingRecommendation`/`rejectTrainingRecommendation` (`coach.service.ts:556-594`) → `trainingCycleService.acceptRecommendation`/`rejectRecommendation` (`training-cycle.service.ts:1815-1869`) | Gates at 557/577, **plus** an independent second check: `reviewRecommendation` re-derives cycle ownership using `clientUserId`, not trusting the PT-relationship check alone |

Both recommendation-review paths mutate `CycleAssessment.userDecision` (ACCEPTED/REJECTED) — **never** `CycleAssessment.decision` (the AI's own KEEP/PROGRESS/ADJUST/DELOAD/REBUILD verdict). This means the domain rule "a PT may approve a pending AI proposal but never override the AI's own adaptive decision" (consistent with CLAUDE.md's `CycleAssessment` ownership row) holds for both the documented nutrition path and this audit's newly-confirmed training path.

### One real documentation staleness found

`docs/GYMINI_PT_PERMISSION_MATRIX.md` (dated 2026-09-10, claims to be "sourced from actual authz-check code") is accurate on every claim spot-checked **except** it omits the training-side `approve`/`reject` routes above — `git log -S"approveTrainingRecommendation"` shows this code's only commit is `003545c6` (2026-10-16), after the doc was written. The matrix is stale by omission, not by error: the gate pattern it documents for the nutrition-side routes applies identically to the training-side ones it's missing. **Action for whoever owns that doc: add the two training-recommendation rows; no code change needed.**

## 2. PT Copilot use-case feasibility (task §14 target use cases)

No "PT Copilot" feature or name exists anywhere in the repo today (`grep PTCopilot|pt-copilot` → zero matches). This is a from-scratch feasibility assessment, not an audit of an existing feature.

| Use case | Verdict | Evidence |
|---|---|---|
| "Which of my clients are falling behind their plans?" | **NOT_IMPLEMENTED — needs a new aggregate** | The only PT-roster endpoint, `GET /contracts/pt` → `contractService.getByPT` (`contract.service.ts:797-818`), returns only Contract + counterparty profile + review rating — zero adherence fields. Per-client adherence building blocks exist (`cycle-adherence.util.ts`, `training-cycle-metrics.service.ts`) but are only ever invoked for one client at a time (inside `getClientSummary`). Building the aggregate means either N per-client calls (the N+1 cost this repo's own prior history explicitly avoided building) or a genuinely new batch projection — neither exists today. |
| "Which clients missed workouts this week?" | **NOT_IMPLEMENTED — same reasoning** | Per-client missed/partial/completed classification exists (`cycle-adherence.util.ts`) but is never exposed roster-wide. |
| "Prepare a check-in message for clients who haven't trained recently" | **NOT_IMPLEMENTED** | No code anywhere generates LLM-authored outbound text to a client. Every client-facing notification fired from `coach.service.ts` is a templated, deterministic string, triggered only as a side effect of an **explicit PT action already taken** (reject/modify/assign/approve) — never proactively triggered by elapsed time, never LLM-generated. ai-service has zero client-notification call sites. |
| "Prepare separate workout revision proposals for 3 different clients" | **PARTIAL** | The single-client building block (`generatePlanDraft`) is real, production-tested (per the pre-existing `GYMINI_PT_COACHING_VERIFICATION_REPORT.md`), audited, and draft-only. It takes exactly one `clientUserId` per call. No batch/multi-client orchestration layer exists; a copilot feature here would be a new thin layer calling this existing function N times, not a new generation mechanism. |
| "Which clients have consistently missed their nutrition targets?" | **NOT_IMPLEMENTED — needs a new aggregate** | `nutritionGoalPlanConsistencyService.compute(clientUserId)` is the only building block, single-client only. |

**Reusable conclusion for the roadmap phase**: every PT-copilot use case that needs cross-client visibility is blocked on the *same* missing piece — a roster-wide adherence/attention aggregate — not on five separate gaps. Building that one aggregate (as a genuinely new batch projection, consistent with this repo's own precedent of avoiding N+1 by building derived/projected values rather than looping per-client calls) would unlock use cases 1, 2, and 5 simultaneously. Use case 3 (AI-drafted messaging) is architecturally separate — it needs an LLM-authored-text-to-notification path that doesn't exist at all today, plus a PT-approval step before send (per CLAUDE.md's rule that AI must never autonomously message clients). Use case 4 (multi-client batch proposals) just needs an orchestration wrapper around the already-real, already-audited `generatePlanDraft`.

## 3. AI autonomy boundary — confirmed safe

**AI never autonomously messages a client or changes a client's plan without an explicit human action triggering that specific request.** Specifically:

- Every tool in `fitness-agent-tools.ts` (ai-service, 25+ tools) acts exclusively on the **chatting user's own account** — `identity.userId` is that same person, every write (`applyTrainingPlan`, `activateRoadmap`, `updateProfileFields`, etc.) is scoped to them. There is no tool anywhere that takes a target client id distinct from the caller — i.e. no mechanism exists for a PT's own AI chat session to write to a *client's* data at all.
- The only PT-facing AI-generation surface is `coachService.generatePlanDraft` in **fitness-service** (not ai-service), and it is confirmed draft-only by direct code reading (no create/update call on any persisted model, only an audit-log write).
- `findPTCandidates` is a client discovering a PT to hire — the opposite direction from a PT-copilot use case, not a PT searching clients.
- The personalized-service marketplace's `deliverDraft` takes the PT's own typed content as `req.body`; no LLM call exists anywhere in `personalized-service.service.ts`.

This is a genuinely strong finding and should be stated plainly in the executive summary: **the architectural AI-authority boundary described in CLAUDE.md ("AI is not authoritative," "confirmation before persistence") holds specifically and completely for the PT→client direction, with no exception found.**

## 4. Role model — resolved

**A single user account cannot hold `client` and `pt` roles simultaneously in the database.** `auth-service`'s `Role` enum (`CUSTOMER | PT | ADMIN | GYM_OWNER`) is a single scalar column on `User`, not a set. Becoming a PT (`profile.service.ts::becomePT`) literally overwrites the column via an internal auth-service PATCH call; reverting (`adminSetPTStatus`) overwrites it back. `UserProfile.isPT` (user-service) is a synchronized mirror of the same fact, not an independent second role.

**However, the product functionally behaves like dual-capability** because almost nothing in fitness-service or user-service's client self-service surface checks `role === 'CUSTOMER'` at all — ownership is checked via the JWT's `userId`, not role. A `role=PT` account can still train/log nutrition/book under its own userId, and can even become the `clientUserId` of a *different* PT's contract. This resolves the question left open in `03-role-capability-permission-matrix.md`: it is **not** a true multi-role DB model, and it is **not** merely a frontend `activeView` toggle either — it's real functional dual capability riding on top of a strictly single-valued role field, enabled by the fact that most business logic authorizes by identity, not by role. `03-role-capability-permission-matrix.md` has been updated to reflect this.

## 5. What this means for the gap register

- `BDG-08` (PT-dashboard cross-client aggregate) is now **CONFIRMED, not provisional**: it does not exist. Status updated from PENDING to OPEN in the gap register and `gaps.json`.
- New gap added: `BDG-13` — `GYMINI_PT_PERMISSION_MATRIX.md` omits the training-side recommendation approve/reject routes (documentation-only, low severity, easy fix).
- `CAP-08-03`, `CAP-08-04`, `CAP-08-07` in `02-business-domain-inventory.md` updated from placeholder/pending to confirmed status.
