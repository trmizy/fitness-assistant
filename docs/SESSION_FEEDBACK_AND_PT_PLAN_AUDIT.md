# Session Feedback, PT/Coach Mode & Plan Marketplace — Audit + Design

> Phase 1 deliverable. Every fact below is verified against the actual code on branch `feature/session-feedback-pt-mode` (based on `aws-deploy`), not assumed. Phases 2-12 (implementation) follow this document.

## 1. Current state (answers to the 12 audit questions)

**1. Workout session storage**: `WorkoutSchedule` (fitness-service, `workout_schedules` table). One row per calendar day per user (`@@unique([userId, date])`). Holds `status`, `progressPercent`, `totalExercises`/`completedExercises`, `totalSets`/`completedSets`, `durationSeconds`, `sourcePlanId`, `trainingCycleId` (nullable — a session can exist outside any cycle).

**2. Workout log statuses**: `WorkoutSchedule.status` is a plain string (app-validated, not a DB enum): `NOT_STARTED | IN_PROGRESS | PARTIALLY_COMPLETED | COMPLETED | SKIPPED | CANCELLED`. No separate `MISSED` value — "missed" is a *derived* concept computed at query time (`missedSessions = schedules.filter(s => s.status !== "COMPLETED" && s.date < now)` in `training-cycle.service.ts`), covering SKIPPED/CANCELLED/NOT_STARTED/IN_PROGRESS/PARTIALLY_COMPLETED sessions whose date has passed.

**3. Training cycle end flow**: Unified (Phase 7, earlier this session). Both `POST /training-cycles/:id/complete` (legacy) and `POST /training-cycles/:id/evaluate` (adaptive) funnel through `trainingCycleService.runVersionedAssessment()`: `computeCycleMetrics()` → `runDecisionEngine()` (6-way: KEEP/PROGRESS/ADJUST/DELOAD/REBUILD/INSUFFICIENT_DATA) → `assessCycleSafe()` (LLM explanation, never decides) → persists a versioned `CycleAssessment` + a `RecommendationAudit` row.

**4. Decision Engine input** (`DecisionEngineInput`, `cycle-decision.engine.ts`): `cycleDurationDays`, `completedSessions`, `metrics: CycleMetricsResult` (adherence, volume trend/slope, exercise progression, e1RM trend, strength/performance-consistency scores, RPE/pain/fatigue/recovery, body-composition trends, `goalProgressScore`, `dataQualityScore`, `nutritionConsistencyScore`, `missedSessionCount`), `priorCycleDecisions`, `goalOrContextChangedSincePriorCycle`, `experienceLevel`, `competesInSport`. **Already reads session-level subjective feedback** via `CycleMetricsResult.averageSessionRpe/averagePainScore/fatigueScore/recoveryScore`, sourced from `CycleSessionFeedback` rows.

**5. AI recommendation/explanation payload** (`AssessCycleRequestSchema`, ai-service): `userId`, `cycle` (goal/duration/experienceLevel/competesInSport), `dataQuality`, `computedMetrics` (full `CycleMetricsResult`, passed through), `decision` (value/confidence/actionScope — **already decided**, LLM only explains), `reasonCodes`, `safetyFlags`, `currentPlanSummary`, `allowedChanges` (constrains what the LLM may propose). Output: `AssessCycleOutputSchema` — headline/summary/positive+warning signals/proposedChanges/missingData/safetyNotice, with `decision` echoed back but **overwritten server-side** with the real engine value regardless of what the model returns.

**6-7. PT/Coach mode**: Partially exists, workout-blind. Roles (auth-service): `CUSTOMER | PT | ADMIN | GYM_OWNER | GYM_STAFF` — no separate COACH/TRAINER value, `PT` is the coach role. A full "become a PT" application→admin-approval pipeline exists (`PTApplication`, `UserProfile.isPT`). **`Contract`** (user-service, `contracts` table: `ptUserId`, `clientUserId`, `status: PENDING_REVIEW|PENDING_SIGNATURE|PENDING_PAYMENT|ACTIVE|COMPLETED|EXPIRED|CANCELLED|REJECTED`) already *is* the PT-client relationship — `contract.repository.ts` already has `findByPT(ptUserId, status?)`, trivially giving "all active clients for a PT." PT frontend pages (`PTClientList`, `PTClientDetail`, `PTDashboard`, `PTSchedulePage`, `PTContractsPage`, `PTWalletPage`, `PTProfilePage`, `PlanReviewPage`) exist but are **100% contract/scheduling/payment-focused — `PTClientDetail.tsx` never calls fitness-service**, shows zero workout/training-cycle/InBody data. Fitness-service has **zero PT-awareness**: every `training-cycle.routes.ts` endpoint acts only on `req.user!.id`; no endpoint anywhere lets one user create/view/assign a plan or cycle for a different `userId`. The closest existing cross-user mechanic is ai-service's `WorkoutPlan.ptReviewStatus` (client generates their own plan citing an active contract, PT can only approve/reject via `PlanReviewPage.tsx` — never authors or assigns).

**8-9. Plan marketplace**: Exists, mid-featured. `WorkoutPlan` (ai-service, own `version` field for a client's own "regenerate adjusted plan" flow, unrelated to marketplace) → `PublishedPlan` (title/description/goal *snapshotted* at publish time, `moderationStatus: DRAFT/SUBMITTED/APPROVED/REJECTED`, `avgRating`/`ratingCount`) → `PlanReview` (`rating 1-5` + optional `comment`, **single dimension only** — no difficulty/goal-fit/equipment-fit axes, one review per user per listing, DB-unique-enforced). Publishing: any authenticated user (no PT-only gate) can publish their own `COMPLETED` plan; needs admin moderation. Reviewing is gated server-side by `hasCompletedCycleForPlan` (calls fitness-service). **No `PublishedPlan` versioning** (no `version`/`previousVersionId`/changelog — a listing can only be withdrawn, which hard-deletes and cascades reviews/packages). **No quality-score concept beyond raw avgRating/ratingCount.** **No AI improvement-suggestion mechanism.** **No "adopt this plan" user action** in the marketplace UI at all today.

**10. RecommendationAudit**: Exists (`recommendation_audits` table) — `userId`, `cycleId`, `assessmentId`, `engineVersion`, `decision`, `reasonCodes`, `metricsSnapshot` (full replayable `CycleMetricsResult`), `aiSummary`, `presentedAt`, `userAction`. Written by `runVersionedAssessment()` on every evaluate/complete call.

**11. Qdrant/RAG evidence path**: `retriever.retrieveEvidence()` → `evidenceUsedFromDocs()` (title+source_url citation gate) — already used by `cycle-assessment.service.ts` for cycle explanations, reusable as-is for feedback-analysis explanations without any change.

**12. Relevant UI screens**: `WorkoutLogPage.tsx` (session logging), `TrainingCyclePage.tsx` (`ActiveCycleCard`, `DecisionCard`, `CycleHistoryRow`), `ProfilePage.tsx`/`OnboardingWizardPage.tsx`, `PlanMarketplacePage.tsx` (4 tabs: Browse/Mine/Buy/Sell packages), `AIPlansPage.tsx`, and the PT pages listed in §6-7 above.

## 2. Critical existing asset: `CycleSessionFeedback` already exists

This is the single most important finding for Phase 2. `CycleSessionFeedback` (fitness-service, `cycle_session_feedback` table) **already implements a slice of what's being requested**:

```
readinessScore Int?    // 1-10, pre-session
sessionRpe     Float?  // 1-10, post-session overall RPE
painScore      Int?    // 0-10
notes          String?
```

1:1 with `WorkoutSchedule` (`@unique workoutScheduleId`), tied to `cycleId` (currently **required, not nullable** — a real gap vs. "feedback for any session, cycle or not"). Written via `POST /training-cycles/:id/sessions/:scheduleId/feedback`, gated by `assertScheduleDateEditable` (same-calendar-day-only edits — a real, already-documented UX constraint: fatigue/pain data is only capturable in a narrow same-day window, nothing this project can silently change without revisiting that gate). **Already consumed** by `computeFatigueRecoveryMetrics()` in `cycle-metrics.engine.ts`, feeding `averageSessionRpe`/`averagePainScore`/`fatigueScore`/`recoveryScore` into `CycleMetricsResult`, which the Decision Engine already reads.

**Design decision**: Phase 2 extends this table additively rather than building a parallel `SessionFeedback` system. This directly satisfies "không phá training-cycle flow hiện có / backward compatible" and means Phase 5's Decision Engine integration is "add more signals to an aggregation pipeline that already exists" rather than a new data path end to end.

## 3. Proposed architecture

### 3.1 Schema changes (fitness-service, additive only)

**`CycleSessionFeedback`** (Prisma model renamed to `SessionFeedback` for clarity going forward — `@@map("cycle_session_feedback")` keeps the same physical table, zero migration needed for the rename itself):
- `cycleId` becomes **nullable** (a session outside any cycle can still get feedback).
- New nullable columns: `sessionRating Int?` (1-5, distinct from the existing 1-10 `sessionRpe` which is an RPE scale, not a satisfaction scale), `difficulty String?` (`too_easy|just_right|too_hard`), `enjoyment String?` (`low|medium|high`), `fatigueAfterSession Int?` (1-10, distinct from `readinessScore` which is *pre*-session), `painLocation String?`, `wouldRepeatSession String?` (`yes|no|unsure`), `perceivedProgress String?` (`better_than_last_time|same|worse|unsure`), `feedbackMissing Boolean @default(false)` (explicit "user was prompted and dismissed" sentinel, distinct from "row doesn't exist yet" = never prompted). Reuse existing `notes` for `sessionComment` — no duplicate free-text column.
- New skip/cancel-specific nullable columns (only populated when the linked `WorkoutSchedule.status` is `SKIPPED`/`CANCELLED`): `skipReason String?` (`fatigue|pain|schedule_conflict|motivation|illness|equipment_unavailable|too_hard_previous_session|other`), `shouldAdjustPlan Boolean?`, `userAvailableMakeupDay DateTime?`.

**New `ExerciseSessionFeedback`** (one-to-many from `SessionFeedback`, since a session has multiple exercises): `id`, `sessionFeedbackId`, `exerciseId`, `rating Int?`, `issueType String?` (`too_heavy|too_light|too_many_sets|too_few_sets|uncomfortable|pain|boring|liked|confusing|equipment_unavailable`), `note String?`.

**No changes to `WorkoutSchedule`, `TrainingCycle`, `CycleAssessment`, `CycleMetricsEngine`'s existing return shape** (new fields are additive to `CycleMetricsResult`, not replacements).

### 3.2 Cycle feedback summary (Phase 3) — deterministic, code-only

New `cycle-feedback-aggregator.ts` in fitness-service, same layer as `cycle-metrics.engine.ts` (not ai-service — matches "code tính, AI chỉ diễn giải"). Pure function over `SessionFeedback[]` + `WorkoutSchedule[]` for a cycle. Rule-based sentiment classification exactly as specified by the user (rating≤2 or pain≥7 or wouldRepeat=no → negative; rating≥4 and difficulty=just_right and pain≤3 → positive; etc.), `dataQualityScore` from `feedbackCompletionRate`, safety/equipment/adherence/motivation flag arrays. Output persisted as a new `CycleFeedbackSummary` row (one per cycle, like `CycleAssessment`) so it's queryable/auditable, not just computed on the fly.

### 3.3 AI feedback analysis (Phase 4) — new ai-service endpoint, same pattern as `/ai/assess-cycle`

New `POST /ai/assess-feedback`, `assessFeedbackSafe()` client wrapper (mirrors `assessCycleSafe` in `ai.client.ts`), `FeedbackAnalysisRequestSchema`/`FeedbackAnalysisOutputSchema` (mirrors `AssessCycleRequestSchema`/`AssessCycleOutputSchema`). Input: `cycleFeedbackSummary` + the *same* `computedMetrics`/`decision`/`experienceLevel`/`competesInSport` already sent to `/ai/assess-cycle` (feedback validity can only be judged against objective data). Output structured exactly per the user's spec (`sentiment`, `complaintValidity`, `complaintCategories`, `recommendedDecisionInfluence`, etc.) — Zod-validated, deterministic-template fallback on failure (existing pattern). Persisted to new `CycleFeedbackAnalysisAudit` table. **Never sets `decision` — only ever an influence hint the engine may or may not act on**, same guardrail already enforced for `AssessCycleOutput.decision` being overwritten server-side.

### 3.4 Decision Engine integration (Phase 5) — additive input, no override of safety

`DecisionEngineInput` gains optional `feedbackSignal?: { sentiment, complaintValidity, recommendedInfluence, dataQuality }`. New branch logic sits *alongside* existing metric-based rules, never replacing the safety-flag/data-quality gates that already exist — feedback can nudge ADJUST/DELOAD when it's *corroborated* by real RPE/pain/adherence data (already-computed metrics), and is explicitly ignored (or only mentioned, never acted on) when `complaintValidity` is `not_supported`/`insufficient_data`. `RecommendationAudit` gains `feedbackSignalsUsed`/`feedbackSummarySnapshot`/`aiFeedbackAnalysisId`/`complaintValidity` fields (additive JSON columns).

### 3.5 PT/Coach mode (Phase 6-7)

Reuse `Contract` (not a new `TrainerClient` table) as the PT-client relationship source of truth — `status: ACTIVE` = an authorized relationship. New fitness-service internal endpoint (matches the existing `internal.routes.ts` cross-service pattern already used for `/internal/exercises/for-ai-plans` etc.) for user-service/gateway to fetch a client's workout/cycle summary, gated by an internal-secret header plus a **fresh** contract-ACTIVE check server-side (never trust a client-supplied "I'm authorized" claim). New fitness-service endpoints: `POST /training-cycles/coach-assign` style, taking an explicit `clientUserId` distinct from `req.user!.id`, re-validating the ACTIVE contract on every call (not just at UI-select time). AI-assisted draft generation (Phase 7) reuses the existing plan-generation LLM pipeline with a `PENDING_PT_REVIEW`-style gate before any assignment — PT must explicitly confirm before a plan touches the client's calendar, matching the existing `ptReviewStatus` precedent already in the codebase.

### 3.6 Plan marketplace review flow (Phase 8)

Add `PublishedPlan.version Int @default(1)` + `previousVersionId String?` (self-relation) — publishing a "new version" creates a new `PublishedPlan` row linked via `previousVersionId` rather than mutating the existing one, so existing `PlanReview`/`TrainingPackage`/adopted-plan references to the old version are untouched (addresses the audited gap: withdraw is currently destructive). New `PlanImprovementSuggestion` table (AI-generated, `status: PENDING|ACKNOWLEDGED|APPLIED|DISMISSED`, never auto-applied — owner must explicitly act, matching "AI không được tự sửa/publish plan public ngay"). `PlanQualityScore` computed deterministically (not by AI) from `avgRating` + completion-rate-of-adopters (requires closing the audited "no adopt action" gap minimally — see risks below) + safety-flag frequency from linked cycles' `CycleFeedbackSummary` rows where `sourcePlanId` matches.

## 4. Risks / open items flagged honestly

- **The marketplace has no "adopt plan" action today at all.** `hasCompletedCycleForPlan` gating implies *some* path from "published plan" to "a training cycle running that plan," but the audit found no adopt/clone UI action. Phase 8's `PlanPerformanceStats`/quality score is only as good as this gap being closed — will implement a minimal adopt endpoint (copy `sourcePlan.plan` JSON into a new `WorkoutPlan` for the adopting user) as part of Phase 8, flagged as new scope beyond pure "review" but required for the review flow to be meaningful.
- **`assertScheduleDateEditable`'s same-day-only gate is not being loosened.** Skipped/cancelled feedback for a session logged same-day still works; retroactive feedback on older sessions will surface `feedbackMissing=true` permanently, by design — already-documented, accepted constraint from Phase 13 QA.
- **PT client-data access is new cross-service surface area** — every new endpoint re-validates the `Contract.status === ACTIVE` server-side per-request, not cached/trusted from a prior check, to avoid a stale-authorization bug class.
- **No mobile app changes** — `apps/mobile` is out of scope unless explicitly requested; this plan targets `frontend/web` only, matching how prior phases in this session scoped work.

## 5. Test plan

See Phase 11 in the implementation phases. Every phase below ships its own tests before being marked complete; Phase 11 is the final consolidation/gap-fill pass, not the first time tests are written.

## 6. Implementation roadmap

Phases 2-12 as specified in the original request, executed in order, each with its own commit-worthy unit of work: session feedback schema+API+UI → cycle feedback aggregator → AI feedback analysis → Decision Engine integration → PT client data access → AI-assisted PT plan drafting → marketplace versioning/quality/improvement → event-flow docs → UI polish → test matrix → final verification report.
