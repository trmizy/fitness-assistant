# Gymini PT Coaching Workspace — Integration Gaps

Date: 2026-09-10. Severity per master task §47.

## P0 — none found

No unauthorized cross-relationship access, no ownership corruption found
in the existing PT surface (confirmed by code audit + live IDOR tests,
see E2E/Verification reports).

## P1 — none found

No major PT-client business flow was found unusable. The one long-
standing blocker (payment-gated E2E testability) is solved this phase
(see Implementation Report §6/design doc §6).

## P2 — fixed this phase (small, directly related)

1. **PT had no access to client InBody/progress data at all.** Fixed:
   `coachService.getClientProgress` + `GET /coach/clients/:id/progress`
   + `ClientProgressCard.tsx` (Progress tab). Reuses the existing
   `fetchInBodyHistory` cross-service read, gated by the strict
   ACTIVE-only relationship check.
2. **PT could see a client's NutritionGoal but not their actual
   NutritionProgram (the meal plan) or its consistency status.** Fixed:
   `getClientSummary` now also returns `nutrition.activeProgram` and
   `nutrition.consistency` (reusing
   `nutrition-goal-plan-consistency.service.ts` verbatim), rendered in
   `ClientFitnessSummaryCard.tsx`'s nutrition section.
3. **No training-side CycleAssessment reasoning was surfaced to the
   PT** (only the nutrition half had a headline/explanation). Fixed:
   `getClientSummary.latestAssessment` (decision + `aiSummary`, the
   same LLM-explanation field the client's own UI already trusts).
4. **`ClientRoadmapCard.tsx` didn't render `trainingReadiness`/
   `nutritionReadiness`**, even though `getClientRoadmap`'s underlying
   `getRoadmapProjection` already computed them (added in the prior
   Cycle Transition Continuity phase). Fixed: two small status badges,
   zero new backend computation.
5. **`PTClientDetail.tsx` had no derived "needs attention" view** — a PT
   had to mentally cross-reference several cards to notice a stale
   nutrition plan, a pending draft, or a schedule-less new cycle. Fixed:
   `AttentionSection` — a small, purely-derived list from data already
   fetched for the Overview tab, no new scoring engine.
6. **`PTClientDetail.tsx` was one long scrollable page**, not a
   navigable hub as the master task's §7/§29 asks for. Fixed: 5 tabs
   (Tổng quan/Tập luyện/Dinh dưỡng/Tiến độ/Lịch sử), reusing every
   existing section — no new pages, no new routes.

## P2 — documented, not built (feature-level, avoiding scope expansion)

7. **PT Dashboard-wide "clients needing attention" aggregate** (master
   task §30: "clients with no next-cycle workout," "nutrition
   mismatch," "assessments due" as PT-dashboard-level KPIs, across ALL
   of a PT's clients). Computing this correctly for N clients requires
   either N per-client Roadmap/Nutrition-consistency calls (a real N+1
   the master task's §31 explicitly warns against) or a genuinely new
   bounded aggregate server projection (batch query across all of a
   PT's ACTIVE contracts at once). Building that projection correctly
   — and testing it under a realistic multi-client load — is a
   real, separate unit of work, not a small tweak to an existing call.
   Deliberately NOT built this pass to avoid shipping a half-audited
   N+1 or a rushed batch-query implementation under this phase's time
   box. The per-client "Cần chú ý" section (fix #5 above) delivers the
   same value at the single-client level, which is where the master
   task's own "central acceptance question" is actually focused.
8. **Notifications for the new PT-Roadmap-draft/handoff flow.** Audited:
   `createPersistentNotification` is already called for nutrition
   actions and plan assignment (`coach.service.ts`), but
   `createRoadmapDraftForClient`/the client's own `activateRoadmap`
   call do NOT currently fire a persistent notification in either
   direction (PT→client "a roadmap was proposed for you," or
   client→PT "your client just started the roadmap you proposed").
   Existing notification infrastructure clearly supports this (same
   `createPersistentNotification` call, same pattern as the four
   nutrition actions) — this is a small, well-understood addition, but
   adding it means touching `fitness-roadmap.service.ts`'s
   `createDraftRoadmap`/`activateRoadmap` (client-owned lifecycle code
   this phase's own scope boundary says not to reopen). Documented as
   P2 rather than risking a change to shared lifecycle code under this
   phase's already-large diff.
9. **The pre-existing `inbodyService.getClientHistory` /
   `findActiveOrCompletedByPair` inconsistency** — see
   `docs/GYMINI_PT_PERMISSION_MATRIX.md`'s own closing section. Not
   fixed (would require auditing every other caller of
   `findActiveOrCompletedByPair` first); documented for a deliberate
   future decision.
10. **§17 equipment-mismatch audit — manual plan assignment (PT and
    client self-service alike) has no equipment gate at all.** Live-
    tested (TC-PT-012, `tests/33-pt-coaching-workspace.spec.ts`): a real
    exercise requiring "Kettlebell" (which Client A has no equipment
    configured for at all) was assigned via
    `POST /coach/clients/:id/plans` and returned `201`, not a rejection.
    Code reading confirms why: `workoutService.createManualProgram`
    calls only `validateExerciseIds` (existence/ownership canonical-
    grounding check); the equipment-aware
    `validateAiPlanExerciseEquipment` gate exists exclusively on the
    AI-generation path (`workout.service.ts:2395,2648`), never on the
    manual-creation path any manual creator — client or PT — goes
    through. **Not PT-specific**: the client's own self-service manual
    builder (`WorkoutLogPage.tsx`) calls the identical
    `createManualProgram` and would behave identically for the exact
    same reason. Not fixed this pass — adding an equipment gate to
    `createManualProgram` would change behavior the client's own
    self-service flow already relies on (a real product-design
    question: should a human's deliberate manual pick ever be equipment-
    gated the way an unsupervised AI generation is?), which is a
    decision beyond this phase's "no new workout architecture" scope
    (§48). Documented as the honest, current, live-tested contract.

## P3 — minor, documented only

10. PT Dashboard's existing KPI cards (wallet/earnings/sessions) are
    business-metric-focused, not coaching-attention-focused — consistent
    with what it was built for (Phase 6, `docs/SESSION_FEEDBACK_AND_
    PT_PLAN_AUDIT.md`), not a defect. See gap #7 above for the
    coaching-attention version.
11. `PTServiceOrderPage.tsx` (Marketplace Personalized-PT-Service order
    fulfillment) is a separate, parallel PT-facing surface with its own
    AI-plan-draft flow — not unified with `PTClientDetail.tsx`'s
    coaching workspace. Out of scope (§48 explicitly excludes
    marketplace redesign); noted only so a future pass doesn't
    "rediscover" this as a surprise.
