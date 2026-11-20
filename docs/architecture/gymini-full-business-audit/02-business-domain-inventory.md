# 02 — Business Domain Inventory

Evidence-based inventory of every business domain discovered in the Gymini repository. Status column is cross-checked against `docs/production-readiness/08-module-readiness.md` (an independent prior audit, HEAD `81d9f432`) where that audit covered the module, plus this audit's own Phase 1 structural discovery (see `AUDIT_PROGRESS.md`). Evidence type per row: `REPOSITORY_FACT` unless noted. Confidence HIGH unless noted.

Legend for Status: `IMPLEMENTED_AND_VERIFIED` / `IMPLEMENTED_NOT_RUNTIME_VERIFIED` / `PARTIALLY_IMPLEMENTED` / `UI_ONLY` / `BACKEND_ONLY` / `MOCK_OR_SEED_ONLY` / `FEATURE_FLAGGED_OFF` / `PLANNED_NOT_IMPLEMENTED` / `BROKEN_OR_INCONSISTENT` / `UNKNOWN_INSUFFICIENT_EVIDENCE`.

---

## DOM-01 Identity, Account & User Lifecycle

**Owning service:** auth-service (sole source of truth for `Role` and JWTs). **Models:** User, RefreshToken, EmailVerification, PasswordResetToken, PartnerApplicationToken, AuditLog, PtDeactivationCall.

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-01-01 | Registration + email OTP verification | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `auth.routes.ts` (register, register/verify). OTP hashing is unsalted SHA-256 with attempt-counter reset on resend — real weakness, see GAP-G05 in gap register. |
| CAP-01-02 | Login (rate-limited) | IMPLEMENTED_AND_VERIFIED | Gateway `authRateLimiter` 20/15min confirmed LIVE_LOCAL by prior audit; `loginRateLimit.middleware.ts`. |
| CAP-01-03 | Token refresh / logout | IMPLEMENTED_NOT_RUNTIME_VERIFIED | Refresh tokens stored **plaintext**, no reuse detection (GAP-G07). |
| CAP-01-04 | Password reset | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `password-reset` route + `PasswordResetToken` model. |
| CAP-01-05 | Role assignment (CUSTOMER/PT/ADMIN/GYM_OWNER) | IMPLEMENTED_AND_VERIFIED | Role enum confirmed in auth-service schema; `GYM_STAFF` already removed. Admin role-mutation routes have **no in-service role check**, enforced only at the gateway (GAP-G08). |
| CAP-01-06 | One account holding both `client` + `pt` capability | IMPLEMENTED_NOT_RUNTIME_VERIFIED | Frontend `activeView` toggle confirmed (web+mobile agents); whether this is backed by a real second DB flag vs. just a UI toggle over a single `PT` role needs the PT-copilot agent's confirmation (pending). |
| CAP-01-07 | Admin user management (disable/enable/role change/name) | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `auth.routes.ts` PATCH users/:id/role\|disable\|enable\|name; gateway-only enforcement (GAP-G08). |
| CAP-01-08 | Gym-partner self-onboarding account creation (separate from normal registration) | IMPLEMENTED_AND_VERIFIED | `partner-application.routes.ts` (start/verify/set-password); full route coverage confirmed by web+mobile agents; `GYM_PARTNER_IDENTITY_MODEL.md`. |
| CAP-01-09 | Consent / privacy controls, data export/deletion | PARTIALLY_IMPLEMENTED | `ExportDataPage`/`export.tsx` (data export) confirmed on both web and mobile. No explicit "delete my account" capability found in either frontend route inventory — **UNKNOWN_INSUFFICIENT_EVIDENCE** whether account deletion exists anywhere; flag for deeper check. |
| CAP-01-10 | Session cache isolation on logout/account-switch | PARTIALLY_IMPLEMENTED | Mobile confirmed `queryClient.clear()` on logout (`AppContext.tsx`, cited by production-readiness audit). **Web not traced by either audit** — explicit gap, matches this repo's own `gymini-account-session-isolation` skill existing specifically for this risk class. |

No dedicated domain doc exists for Identity/Account in the 195-file corpus — closest coverage is `production-readiness/03-authentication-security.md` + `04-authorization-user-isolation.md`.

---

## DOM-02 Onboarding & Personalization

**Owning service:** user-service (UserProfile) + fitness-service (initial goal/equipment data).

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-02-01 | Client onboarding wizard (web + mobile) | IMPLEMENTED_AND_VERIFIED | `/client/onboarding` (web, gated by `RequireOnboarding`), `app/client/onboarding.tsx` (mobile). `docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md` explicitly corrects an older external claim that no onboarding wizard exists. |
| CAP-02-02 | Equipment availability capture | IMPLEMENTED_AND_VERIFIED | `UserEquipment` model (fitness-service), `/client/training-equipment` (web), `app/client/profile/equipment.tsx` (mobile). |
| CAP-02-03 | Post-onboarding goal/profile edits propagating to downstream plans | UNKNOWN_INSUFFICIENT_EVIDENCE | Not yet traced whether editing a goal post-onboarding triggers roadmap/nutrition/workout re-derivation or only affects future AI turns. Candidate for deeper Phase-4 tracing. |
| CAP-02-04 | PT-specific intake/safety questionnaire | PARTIALLY_IMPLEMENTED | `docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md`, `docs/ONBOARDING_INTAKE_QUESTIONNAIRE_REVIEW.md` — latter is explicitly a design review, "proposal only." |

---

## DOM-03 Workout & Exercise Management

**Owning service:** fitness-service. **Models:** Exercise(+Alias/Source/Muscle/Equipment), Workout(+Exercise/Set/SetSegment), WorkoutProgram(+Day/ExerciseGroup/SetPrescription/Template), WorkoutSchedule, Import/WorkoutImportBatch, ExerciseReviewDecision, WorkoutMutationEvent.

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-03-01 | Exercise catalog browse/detail/search | IMPLEMENTED_AND_VERIFIED | `exercise.routes.ts` (~13 routes); `/client/exercises` + `ExerciseLibraryPage` (web); `app/client/library/exercises/*` (mobile). `EXERCISE_CATALOG_PROVENANCE_AUDIT.md` claims VERIFIED provenance (2026-09-10, pre-this-audit). |
| CAP-03-02 | Custom exercise creation (user-authored) | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `exercise.routes.ts` custom-exercise CRUD; `USER_CUSTOM` visibility enforced in `exercise-reference-resolver.service.ts` per production-readiness audit — but that same audit flags a **shared, unscoped cache** risk (GAP-G29): a caller that forgets to apply visibility could leak another user's custom exercise. |
| CAP-03-03 | Admin duplicate-exercise review queue | IMPLEMENTED_AND_VERIFIED | `/admin/exercise-review` route + `ExerciseReviewDecision` model; `EXERCISE_DUPLICATE_SEMANTIC_REVIEW.md` found 7 duplicate-name groups, explicitly "REVIEWED, NO AUTOMATIC MERGE" (a product decision, not a bug). |
| CAP-03-04 | Manual workout/program creation (non-AI) | IMPLEMENTED_AND_VERIFIED | `workout.routes.ts` (~30 routes, largest route file in the repo); `app/client/workout/programs/{index,new}.tsx` (mobile), confirmed closed on web per Phase-14B parity work. **Equipment validation does NOT run on this path** — only on AI-generated plans (`08-module-readiness.md`, confirmed product-decision gap, not silently fixed). |
| CAP-03-05 | AI-generated workout plan | PARTIALLY_IMPLEMENTED | Full chain exists (`plan.routes.ts`, Zod schema validation, equipment-feasibility gate `validatePlanEquipment`) but see DOM-09 (AI) for the governance caveat (G-17: LLM still in the loop even with CI-V2 off) and pending Case A/C/D/E findings from the in-flight conversational-state investigation. |
| CAP-03-06 | Workout logging / active session tracking | IMPLEMENTED_AND_VERIFIED | `app/client/workout/log.tsx`; `WorkoutSet`/`WorkoutSetSegment` models; "advanced set logging" design doc exists for pro-athlete extensions (not yet confirmed implemented). |
| CAP-03-07 | Exercise substitution | IMPLEMENTED_AND_VERIFIED | `getExerciseSubstitute` agent tool (ai-service) + catalog-level substitution in `exercise.routes.ts`. |
| CAP-03-08 | Supersets / drop-sets / training techniques | IMPLEMENTED_AND_VERIFIED | `WorkoutProgramExerciseGroup(Member)` models exist specifically for grouping; `docs/features/SUPERSET_GROUPING_IMPACT_ANALYSIS.md` has a later addendum superseding its own MVP scope — worth a direct read if superset UX is in scope for follow-up work. |
| CAP-03-09 | Import from other apps (Hevy/Strong/FitNotes) | IMPLEMENTED_AND_VERIFIED | `import.routes.ts` + `app/client/workout/import.tsx` (mobile, `expo-document-picker`); idempotent via `@@unique([userId, sourcePlanId])` per production-readiness audit. |
| CAP-03-10 | Workout templates (create/share) | IMPLEMENTED_AND_VERIFIED | `template.routes.ts`, `/client/templates`, `app/client/workout/templates.tsx` — share capability closed on mobile per Phase-14B (commit `9beb05aa`). |
| CAP-03-11 | Reschedule a session / recovery-day handling | PARTIALLY_IMPLEMENTED | `docs/features/RESCHEDULE_WORKOUT_IMPACT_ANALYSIS.md` exists; actual MOVE-vs-REPLACE semantics for AI-driven reschedule requests is exactly **Case B** under investigation (pending conversational-state agent). |
| CAP-03-12 | Progress analytics (exercise progress charts, muscle/activity heatmaps, PR stats) | IMPLEMENTED_AND_VERIFIED | `stats.routes.ts` (8 routes); `/client/exercise-progress/:id`, `/client/muscle-heatmap`, `/client/activity-heatmap` (web, all confirmed reachable); mobile equivalents confirmed. |
| CAP-03-13 | Training Cycle (adaptive execution/evaluation block) + CycleAssessment (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD) | IMPLEMENTED_AND_VERIFIED | `training-cycle.routes.ts` (~22 routes); single-active-cycle enforced by DB partial unique index (production-readiness audit, `VERIFIED_OK`); demoted from a top-level nav tab to a drill-down per `GYMINI_TRAINING_INFORMATION_ARCHITECTURE.md` (deliberate IA simplification, not a removal). |

---

## DOM-04 Nutrition & Meal Management

**Owning service:** fitness-service. **Models:** Food(+Alias/Source), NutritionLog, NutritionGoal, NutritionProgram(+Day/Meal/MealItem/Completion), Recipe(+Ingredient).

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-04-01 | Nutrition goal (calories/macros) — authoritative | IMPLEMENTED_AND_VERIFIED | `NutritionGoal` model; single-active-goal invariant enforced by a **partial unique index that exists only in a migration, not expressed in the Prisma schema comment** (GAP-G27, `VERIFIED_OK` in DB but a real drift risk if a future dev "fixes" the schema). |
| CAP-04-02 | Nutrition Program (meal-plan execution derived from a goal via `sourceGoalId`) | IMPLEMENTED_AND_VERIFIED | `NutritionProgram`+`NutritionProgramDay/Meal/MealItem`; `GYMINI_NUTRITION_PROGRAM_LIVE_E2E_REPORT.md` claims VERIFIED (2026-09-10) closing the goal↔program linkage. |
| CAP-04-03 | Food logging / meal completion tracking | IMPLEMENTED_AND_VERIFIED | `NutritionMealCompletion` model; `app/client/workout/nutrition/{index,add}.tsx` confirmed; "mark eaten / edit log / delete plan meal" closed on mobile per Phase-14B (commit `d201f103`, PG-A4). |
| CAP-04-04 | AI-generated nutrition plan | PARTIALLY_IMPLEMENTED | Full Zod-validated pipeline exists (`nutrition-plan.schemas.ts`); `nutrition-generation-invariant-remediation.md` (2026-09-21) fixed one real calorie/fat invariant violation — i.e. this class of bug has occurred in production code before, worth a regression check rather than assuming it's permanently closed. |
| CAP-04-05 | AI meal-item substitution | IMPLEMENTED_AND_VERIFIED | `nutrition-agent.routes.ts` + `substitute-meal-item` tool. |
| CAP-04-06 | Food catalog (USDA/OpenFoodFacts-sourced) | IMPLEMENTED_AND_VERIFIED | `FoodSource` model, `food.routes.ts`, `/client/foods`. |
| CAP-04-07 | Dietary restrictions / allergy handling | PARTIALLY_IMPLEMENTED | Safety gate detects "severe-allergy-disclosure" as a signal class (ai-service `safety-signals.ts`) but whether it durably constrains ALL subsequent meal generation (not just the current turn) is an open question shared with Case D (constraint-loss on correction) — pending conversational-state agent. |
| CAP-04-08 | Standalone chat-driven `CREATE_NUTRITION_PLAN` capability | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `docs/standalone-nutrition-workflow-{audit,design,evaluation}.md` (2026-09-18) — feeds into the larger, later-dated `ai-coach-demo-readiness-final.md` (2026-09-20) which concludes **BLOCKED — DEMO READY = NO** for the broader AI-coach surface this capability is part of. |

---

## DOM-05 Body Measurements & InBody

**Owning service:** user-service. **Model:** InBodyEntry.

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-05-01 | Manual InBody entry | IMPLEMENTED_AND_VERIFIED | `inbody.routes.ts`; `/client/inbody`, `app/client/inbody/{index,entry}.tsx`. |
| CAP-05-02 | Photo-scan InBody extraction | IMPLEMENTED_AND_VERIFIED, with a provider caveat | `docs/features/INBODY_LOCAL_VISION_MIGRATION.md` (2026-09-01): moved off Claude vision API to a local model — worth confirming the local-model path is still the live one given ai-service's current multi-provider (`ollama`/`anthropic`/`bedrock`) config discovered in Phase 1. |
| CAP-05-03 | Body composition history / trend visualization | IMPLEMENTED_AND_VERIFIED | `BodyMetrics` model; `/client/muscle-heatmap`, `/client/activity-heatmap`. |
| CAP-05-04 | **Destructive history on this exact table**: a historical migration (`20260528_inbody_unique_per_day`) ran `DELETE FROM inbody_entries` to dedupe, on data this audit's own domain rules (CLAUDE.md) classify as "measured body state," never to be silently altered | BROKEN_OR_INCONSISTENT (historical, not necessarily still live) | GAP-G04 in production-readiness gap register — P0, `NEEDS_RUNTIME_VERIFICATION` for current production data. This is the single clearest violation found anywhere in the corpus of "AI/forecast must never overwrite an actual measurement," except here the violator was a migration, not AI. |
| CAP-05-05 | PT/Coach analytics over client InBody-over-time | IMPLEMENTED_AND_VERIFIED | Mobile PT student-detail screen confirmed showing "InBody-over-time" (mobile-inventory agent finding). |
| CAP-05-06 | AI explanation of body-composition trend | PARTIALLY_IMPLEMENTED | `docs/ai-product/phase4-4-body-goal-trajectory.md` notes `fetchInBodyHistory` swallows errors as `[]` silently — a real, specific, cited risk of an AI narration silently treating "no data" the same as "zero/no change," flagged by the doc author as worth a closer look. |

---

## DOM-06 Long-Term Fitness Roadmap

**Owning service:** fitness-service. **Models:** FitnessRoadmap, RoadmapPhase, TrainingCycle (execution, see DOM-03), RecommendationAudit, CoachClientActionAudit, PlanGenerationAudit.

This is the single most heavily-documented domain in the repo (densest doc chain, 30+ files, all dated 2026-09-09/10, see `AUDIT_PROGRESS.md` Phase-1 docs-corpus finding for the full chronological chain). Current state per the **latest** files in that chain:

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-06-01 | Roadmap creation (guided wizard) | IMPLEMENTED_AND_VERIFIED (per corpus; not independently re-verified by this audit) | `GYMINI_GUIDED_ROADMAP_VERIFICATION_REPORT.md` claims VERIFIED, but carries forward a PT-positive-flow blocker from the prior chain link. |
| CAP-06-02 | AI roadmap draft + accept (diagnosis → ai-draft → activate) | IMPLEMENTED_AND_VERIFIED | `fitness-roadmap.routes.ts` (14 routes: diagnosis/projection/ai-draft/activate/advance/rebuild/archive); draft computed by ai-service, persisted only via fitness-service's own accept endpoint — proposed-vs-persisted boundary confirmed real in code (Phase-1 ai-service agent finding). |
| CAP-06-03 | Roadmap projection / adaptive weight-forecast | PARTIALLY_IMPLEMENTED | `GYMINI_ADAPTIVE_FORECAST_VERIFICATION_REPORT.md` claims VERIFIED; `GYMINI_ADAPTIVE_ROADMAP_PRODUCTION_CLOSURE_VERIFICATION_REPORT.md` (one phase later, built on top of it) claims only **PARTIALLY VERIFIED** with one named gap (Gap D, prior-cycle summary). Forecast is explicitly documented (CLAUDE.md) as "non-binding scenario only, never overwrites an actual measurement" — consistent with CAP-05-04's finding that the real violation was a migration, not the forecast engine. |
| CAP-06-04 | Cross-system journey (Onboarding→Roadmap→Workout→Nutrition→CycleAssessment→Advance) | PARTIALLY_IMPLEMENTED | `GYMINI_CROSS_SYSTEM_VERIFICATION_REPORT.md` — 3 real P0 bugs were found AND fixed in that pass, final status **PARTIALLY VERIFIED**, 1 item remained, closed by the subsequent `GYMINI_CYCLE_TRANSITION_VERIFICATION_REPORT.md` + `GYMINI_NUTRITION_PROGRAM_LIVE_E2E_REPORT.md` (both VERIFIED) — **this is the current latest state of the entire roadmap/cross-system chain** (2026-09-10). |
| CAP-06-05 | PT integration with client roadmap | PARTIALLY_IMPLEMENTED | `FITNESS_ROADMAP_PT_POSITIVE_E2E_REPORT.md` status is **BLOCKED** (human-dependency: multi-role/real-payment testing), honestly documented, not silently dropped. |
| CAP-06-06 | Freshness check vs. newer evidence | — | `docs/testing/AI_COACH_FRONTEND_AB_E2E_SCENARIO.md` (2026-10-08) is a Playwright scenario spanning the full journey incl. roadmap — **newer than the entire Sept-10 roadmap chain** and is only a scenario *definition*, not an executed-results report; a good next target if live-verification of current roadmap state is wanted. |

---

## DOM-07 PT Discovery & Recommendation

**Owning service:** user-service (PT profile/search) + ai-service (scoring/candidates).

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-07-01 | PT search/filter/listing | IMPLEMENTED_AND_VERIFIED | `profile.routes.ts` PT listing/search; `/client/services` → `PTDiscoveryPage`. |
| CAP-07-02 | PT recommendation scoring (hard filters → scoring → similarity → LLM narration) | IMPLEMENTED_AND_VERIFIED | `docs/pt-recommendation-methodology.md`; `findPTCandidates` agent tool calls both user-service and fitness-service candidate endpoints. |
| CAP-07-03 | PT booking / consultation | IMPLEMENTED_AND_VERIFIED | `app/client/services/booking.tsx`, `PTAvailability`+`PTScheduleException` models, `SessionRescheduleRequest` model (two-sided reschedule per `docs/pt-scheduling-and-discovery.md`). |
| CAP-07-04 | PT-client contract lifecycle (request/accept/reject/cancel/terminate/pay/feedback) | IMPLEMENTED_AND_VERIFIED | `contract.routes.ts` (~15 routes, several intentionally `gone()`/retired). |
| CAP-07-05 | Decline a PT recommendation and get an alternative without repeating profile | UNKNOWN_INSUFFICIENT_EVIDENCE | This is scenario 6 of the task's cross-domain conversation set — not yet traced; candidate for follow-up (does `FitnessRecommendation`'s reject path feed a "candidates already shown" exclusion into the next recommendation call, or does it require the user to restate preferences?). |
| CAP-07-06 | Demo/synthetic PT performance data | MOCK_OR_SEED_ONLY, explicitly labeled | `docs/synthetic-agentic-dataset-methodology.md` explicitly flags itself as NOT real performance data — good hygiene already present in the corpus. |

---

## DOM-08 PT Client Management (HIGH PRIORITY per audit brief)

**Owning services:** user-service (Contract/Session/SessionReview/ClientReview) + fitness-service (coach.routes.ts, RecommendationAudit, CoachClientActionAudit) + ai-service (personalized-service.routes.ts marketplace orders).

A dedicated investigative agent is in flight (see AUDIT_PROGRESS.md "Phase 3 in-flight") for authorization tracing and PT-copilot feasibility; this section will be extended once it returns. Interim evidence:

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-08-01 | PT client roster / detail | IMPLEMENTED_AND_VERIFIED | `app/pt/students/{index,[id]}.tsx`; `PTClientList`/`PTClientDetail` (web). |
| CAP-08-02 | PT assigns training program to a client | IMPLEMENTED_AND_VERIFIED | `app/pt/students/assign-plan.tsx` (closed on mobile per Phase-14B commit `f6bfa694`, PG-A6); `coach.routes.ts` (fitness-service, 9 routes). |
| CAP-08-03 | PT reviews/edits/rejects a client's CycleAssessment proposal | IMPLEMENTED_AND_VERIFIED | **Confirmed by direct code trace** (see `08-pt-client-management-ai-copilot-audit.md`): nutrition-side (`coach.service.ts:206-275`) AND training-side (`coach.service.ts:556-594`, undocumented in `GYMINI_PT_PERMISSION_MATRIX.md` — see gap BDG-13). Both mutate only `CycleAssessment.userDecision`, never the AI's own `decision` field. |
| CAP-08-04 | PT-dashboard cross-client aggregate ("which clients are falling behind") | **CONFIRMED NOT_IMPLEMENTED** | Direct trace confirms `GET /contracts/pt` returns only Contract+profile+rating, zero adherence fields; per-client adherence building blocks (`cycle-adherence.util.ts` etc.) are never invoked roster-wide. See gap BDG-08 (now OPEN, not pending) and `08-pt-client-management-ai-copilot-audit.md` §2. |
| CAP-08-05 | PT-client messaging | IMPLEMENTED_AND_VERIFIED | chat-service `Conversation`/`Message`, shared `ChatPage` component (web) / `app/*/messages/*` (mobile). |
| CAP-08-06 | PT contracts (business doc, e-signature) | PARTIALLY_IMPLEMENTED | `@dropbox/sign` integration confirmed in user-service; `GYM_PARTNER_WEB_KNOWN_ISSUES` doc family notes web itself removed the "download contract PDF" button at one point (commit `a97a6ec0`, "không còn ký hợp đồng điện tử") — i.e. this capability's scope narrowed over time, not a simple gap. |
| CAP-08-07 | Multi-client AI-assisted batch operations ("prepare 3 separate revision proposals") | PARTIALLY_IMPLEMENTED | **Confirmed by direct trace**: the single-client building block (`coachService.generatePlanDraft`) is real, production-tested, draft-only (never persists, audit-logged). No batch/multi-client orchestration layer exists; see `08-pt-client-management-ai-copilot-audit.md` §2. |

`docs/GYMINI_PT_PERMISSION_MATRIX.md` claims to be sourced from actual authorization-check code (2026-09-10) — **spot-checked against current code: accurate on every claim checked except one real omission** (training-side recommendation approve/reject routes added after the doc was written — see gap BDG-13). Full detail in `08-pt-client-management-ai-copilot-audit.md`.

---

## DOM-09 AI Conversational Coach / Agent (cross-cutting)

Covered in depth by this audit's dedicated AI-capability section (`06-ai-capability-and-integration-audit.md`, pending synthesis) and conversational-state section (`07-conversational-state-and-revision-audit.md`, pending in-flight agent). Domain-level summary:

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-09-01 | Core chat (`/ai/ask`) | IMPLEMENTED_AND_VERIFIED (mechanism); governance caveat | Full call chain traced (Phase-1 ai-service agent). **G-17 finding**: the production-facing "LLM off" flag does not actually stop LLM calls for UNKNOWN/WRITE_ACTION/KNOWLEDGE turns — a real AI-governance gap, not a documentation nuance. |
| CAP-09-02 | Multi-turn slot-filling workflows (5 registered: create-workout-plan, create-nutrition-plan, find-PT, roadmap, update-goal) | PARTIALLY_IMPLEMENTED | Mechanism exists and is Postgres-backed (not in-memory); exact constraint-preservation-under-correction behavior is Case D, pending. |
| CAP-09-03 | True LLM tool-calling | FEATURE_FLAGGED_OFF | `ENABLE_TOOL_CALLING` defaults false in both code and prod compose (confirmed by two independent sources: Phase-1 ai-service agent AND production-readiness audit's `01-system-inventory.md`). Only 2 tools would be offered if enabled; a 3rd (`remember_user_fact`) is deliberately withheld per a documented prompt-injection finding (ADV-003). |
| CAP-09-04 | Conversational Intelligence V2 (semantic turn understanding) | FEATURE_FLAGGED_OFF | `CONVERSATIONAL_INTELLIGENCE_V2` defaults off, not set in prod compose (confirmed by 2 independent sources). Extensive remediation history (Sept 22–Oct 3 chain) culminating in `conversational-intelligence-x4-t10-final-fix.md`, still shipped off. |
| CAP-09-05 | Unified AI Coach (bounded multi-intent executor) | FEATURE_FLAGGED_OFF | `GYMINI_UNIFIED_AI_COACH` off/shadow/on; most recent corpus work (`ai-product/phase3-*`, Oct 5-11) explicitly concludes `UNIFIED_AI_READY_FOR_SHADOW_ONLY` — i.e. even the people building it do not consider it production-ready yet. |
| CAP-09-06 | RAG / fitness-knowledge grounding | PARTIALLY_IMPLEMENTED | Authoritative pipeline (`knowledge-pipeline/`) vs. a **self-documented deprecated** duplicate (`knowledge/`) coexist; plan-generation retrieval is hard-restricted to the `fitness_evidence` collection only (a real deterministic-grounding guarantee). RAG V2 generalization work is marked blocked per user's own project memory (`rag-v2-generalization-status`). |
| CAP-09-07 | AI image analysis (goal photo, InBody photo scan, AI Coach chat image) | IMPLEMENTED_AND_VERIFIED | Confirmed via `expo-image-picker` usage across `ai-coach.tsx`, `inbody/entry.tsx`, `report-issue.tsx`, `profile/edit.tsx`, `roadmap/wizard.tsx` (mobile); `fitness-goal-vision.service.ts` + `GoalImageSchema` (ai-service). |
| CAP-09-08 | Marketplace plan moderation/review AI assist | IMPLEMENTED_AND_VERIFIED | `plan-moderation-analysis.schemas.ts`, `admin-marketplace.routes.ts`. |
| CAP-09-09 | Health/safety routing | IMPLEMENTED_AND_VERIFIED (deterministic only) | Full detail in DOM-13. No ML safety classifier is currently load-bearing (artifacts directory empty in this checkout) — all safety gating today is regex/rule-based. |

---

## DOM-10 Notifications & Communications

**Owning service:** user-service (Notification, NotificationPreference, PushDevice).

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-10-01 | In-app notification list/read/preferences | IMPLEMENTED_AND_VERIFIED | `notification.routes.ts` (8 routes); confirmed on both web and mobile. |
| CAP-10-02 | Push notifications (mobile) | IMPLEMENTED_AND_VERIFIED | `expo-notifications`, `PushManager`/`pushDevice`/`pushRouting` (mobile agent finding). |
| CAP-10-03 | Historical defect: 7 notification types never reached users due to a missing enum value | FIXED (historical) | Per repo's own commit history (git log entry `34682ea7`, visible in this session's git-status context) — fixed via migration; cited here as a real, resolved past incident, not a current gap. |
| CAP-10-04 | PT-copilot-drafted outbound check-in messages | **Pending in-flight agent** | Target use case from task §14; no evidence yet of an AI-drafted-message capability distinct from normal PT-initiated chat. |
| CAP-10-05 | Platform admin notification oversight screen | PLANNED_NOT_IMPLEMENTED | Admin's own `adminNav` code comment (confirmed by web-route agent) explicitly says a Notifications admin screen was deliberately left off nav because "the backing page doesn't exist yet" — self-acknowledged by the team, not a fresh audit finding. |

---

## DOM-11 Payments, Plans & Commercial

**Owning service:** payment-service (Wallet, WalletLedgerEntry, WithdrawalRequest, PaymentTransaction, PlatformCommission, PartnerReceivable).

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-11-01 | Wallet (balance, transactions, withdrawals) | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `08-module-readiness.md` lists Wallet as **NOT_VERIFIED** (not traced by the prior audit either) despite the model/routes existing — genuine open item, not resolved by this audit yet. |
| CAP-11-02 | MoMo / VNPay payment + webhook | IMPLEMENTED_AND_VERIFIED | Signature verification + fail-closed-on-empty-key confirmed by production-readiness audit (`momo.provider.ts`, `vnpay.provider.ts`). |
| CAP-11-03 | PayOS / ZaloPay payment + webhook | PARTIALLY_IMPLEMENTED | Provider code exists but webhook verification was **not traced** by the prior audit (GAP-G23) — genuinely unverified, carried forward here. |
| CAP-11-04 | Stripe | PLANNED_NOT_IMPLEMENTED | `PaymentProviderType.STRIPE` exists only as an enum value in payment-service's schema — **no provider implementation found** (this audit's own Phase-1 backend-agent finding, independent of the prior audit). |
| CAP-11-05 | PT sellable session packages / 1:1 personalized-service marketplace | IMPLEMENTED_AND_VERIFIED | `pt_service_package.routes.ts` + ai-service's `personalized-service.routes.ts` (~28 routes, full intake→draft→revision→accept→checkin→review→dispute/refund lifecycle). |
| CAP-11-06 | Gym membership plans/contracts | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `08-module-readiness.md`: Membership = **NOT_VERIFIED** (model/routes exist in gym-service, flows not traced). |
| CAP-11-07 | Platform commission / partner receivables | IMPLEMENTED_AND_VERIFIED | `PlatformCommissionRate` (gym-service) + `PlatformCommission`/`PartnerReceivable` (payment-service); `admin/commission-rate` route. |
| CAP-11-08 | Refunds / withdrawal approval | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `admin.routes.ts` (payment-service) withdrawals approve/reject/mark-paid + generic refund route exists; "refund idempotency, double-credit protection... not audited" (GAP-G23). |

`docs/money-flow.md` is explicitly flagged in-corpus as "read this before touching wallet/contract/refund/commission code" — the closest thing to a canonical domain doc for this area.

---

## DOM-12 Gym Management / Partner Portal (discovered domain — not in the task's candidate list)

**Owning service:** gym-service. **Models:** GymPartner(+Account), PartnerInvitation, GymBrand, Gym(+Photo/OperatingHours/BranchDocument), GymMembershipPlan/Contract, GymTrainerAffiliation, GymCheckIn, GymReview, GymPtCollaboration, GymMembershipReferral, GymComplaint.

This is a full, independently-built business domain with its own ~390-line permission model, not mentioned anywhere in the task's candidate-domain list — a genuine "discovered additional domain" per the audit brief's §1 instruction.

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-12-01 | Gym-partner self-service onboarding (application → review → approval) | IMPLEMENTED_AND_VERIFIED | Full `GYM_PARTNER_SELF_ONBOARDING_*` + `GYM_PARTNER_WEB_*` doc chain, latest files (`GYM_PARTNER_WEB_KNOWN_ISSUES.md`, `GYM_PARTNER_WEB_TEST_REPORT.md`) dated 2026-09-20; full build history in `docs/quan-ly-doi-tac.md` (157 automated tests + 73 live-HTTP assertions claimed). **Known design-vs-build gap**: 6 originally-spec'd sub-routes were never built as real routes, consolidated into state-driven UI instead — confirmed independently by this audit's own web-route agent (not just citing the doc). |
| CAP-12-02 | OWNER vs MANAGER permission split within one partner account | IMPLEMENTED_AND_VERIFIED | Confirmed independently in THREE places: web frontend (`ownerOnly` nav flag), mobile frontend (`isManagerAccount`/`isBrandOwner` checks, explicitly commented "UX-only, not a security boundary"), and backend (`partner-context.middleware.ts`: `requirePartnerOwner`="money and people = OWNER only", `requireGymScope`). The backend check is what actually enforces this — frontend checks are UX convenience only, exactly as the mobile agent's own code comment states. |
| CAP-12-03 | Branch management (info/hours/facilities/photos/docs/operational status) | IMPLEMENTED_AND_VERIFIED | Closed on mobile per Phase-14B (commit `16f620b8`, PG-A7); `GymManagePage`(web)/`app/gym-owner/branch.tsx`(mobile). |
| CAP-12-04 | Gym↔PT collaboration | IMPLEMENTED_AND_VERIFIED | `GymPtCollaboration` model; both PT-side and gym-owner-side screens confirmed on web+mobile. |
| CAP-12-05 | Front-desk QR check-in | IMPLEMENTED_AND_VERIFIED | `GymCheckIn` model; `app/gym-owner/checkin-qr.tsx` (camera+file-system+sharing for print), `app/client/services/checkin.tsx` (scan side). |
| CAP-12-06 | Admin partner oversight (suspend/unlock/terminate, docs, audit log, internal notes, complaints) | IMPLEMENTED_AND_VERIFIED | `app/admin/partners/{index,[id]}.tsx` (8-tab detail, closed per Phase-14B commit `0f073ac3`); `PartnerAuditLog`/`PartnerInternalNote` models. |
| CAP-12-07 | Admin "active PT list" view | PLANNED_NOT_IMPLEMENTED | Confirmed by mobile agent as still blocked — **on a missing backend API**, explicitly not a frontend omission (mobile parity audit's own D3 item, independently re-verified). |

---

## DOM-13 Health & Safety (cross-cutting, anchored in ai-service)

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-13-01 | Deterministic safety gate (12 unsafe categories: medical emergency, PED dosing, extreme-calorie, prompt-injection, eating-disorder-disclosure, pregnancy-nutrition, etc.) | IMPLEMENTED_AND_VERIFIED | `src/llm/safety_guard.ts`, runs first in the orchestrator, short-circuits before any LLM/RAG call. |
| CAP-13-02 | Symptom-aware fine-grained safety signal classification (radiating pain, neurological symptom, chest/cardio red flag, post-surgical/pregnancy state) | IMPLEMENTED_AND_VERIFIED | `src/llm/safety-signals.ts` — fails closed on RAG retrieval (curated evidence only or abstain). |
| CAP-13-03 | BMI-aware unsafe target-weight rejection | IMPLEMENTED_AND_VERIFIED, narrow scope | `src/agent-workflow/target-weight-safety.ts` — explicitly documented as the ONLY height-aware safety check anywhere in the codebase; not a general pattern yet. |
| CAP-13-04 | ML-based safety/routing classifier | FEATURE_FLAGGED_OFF (effectively) | `query-classifiers/` is genuinely trained offline but its model-weight artifacts directory is **empty in this checkout** — falls back to the regex path on every call. Built but not currently deployed. |
| CAP-13-05 | Constraint persistence across conversation turns (e.g. "avoid leg exercises" surviving a later unrelated correction) | **Pending in-flight agent — this is Case C/D directly.** |

---

## DOM-14 Admin & Platform Operations

**Owning services:** cross-cutting (gateway + every service's admin.routes.ts).

| ID | Capability | Status | Evidence |
|---|---|---|---|
| CAP-14-01 | User management | IMPLEMENTED_AND_VERIFIED | `/admin/users`, `auth.routes.ts` admin routes. |
| CAP-14-02 | PT application review | IMPLEMENTED_AND_VERIFIED | `/admin/pts`, `pt_application.routes.ts` (11 routes). |
| CAP-14-03 | Marketplace moderation | IMPLEMENTED_AND_VERIFIED | `admin-marketplace.routes.ts`, `/admin/marketplace`. |
| CAP-14-04 | Finance overview + reconciliation | IMPLEMENTED_AND_VERIFIED | Closed on mobile per Phase-14B (commit `0f073ac3`, PG-D2); `admin.routes.ts` (payment-service). |
| CAP-14-05 | Global cross-partner audit-log view | PLANNED_NOT_IMPLEMENTED | Self-acknowledged gap in `adminNav` code comment (web-route agent finding) — backing page doesn't exist. |
| CAP-14-06 | Membership oversight screen | PLANNED_NOT_IMPLEMENTED | Same self-acknowledged gap, same comment. |
| CAP-14-07 | AI observability | IMPLEMENTED_AND_VERIFIED | `/admin/ai-observability`, `admin.routes.ts` (ai-service, 11 routes incl. knowledge-pipeline jobs/schedule). |
| CAP-14-08 | System monitoring | PARTIALLY_IMPLEMENTED | `/admin/system` route exists, but production-readiness audit found **no Prometheus/Grafana/Alertmanager wired into prod compose** despite `/metrics` endpoints existing unauthenticated on every service (GAP-G14, GAP-G34) — the admin UI capability and the actual production observability stack are two different things; don't conflate them. |

---

## Cross-cutting notes

- **Chat/Calls** (chat-service: Conversation/Message/CallSession, Socket.IO, WebRTC on mobile) functions as shared infrastructure for DOM-08 (PT-client), DOM-07 (PT discovery), and general support — not modeled as its own numbered domain here since it has no independent business capability beyond transport, but it is a real deployable service or module readiness (`08-module-readiness.md` lists it as a module, PARTIAL).
- **Knowledge/RAG** is modeled under DOM-09 (AI) rather than standalone since it has no capability independent of the AI chat surface.
- Every monetary cross-service reference in the repo is "FK-by-value" (plain string id, no real foreign key) — a deliberate, repeatedly-documented convention (GAP-G28 in gap register), relevant to DOM-08, DOM-11, DOM-12 alike.
