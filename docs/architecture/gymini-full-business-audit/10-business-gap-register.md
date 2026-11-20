# 10 — Business Gap Register

Scope: business-domain and AI-capability gaps discovered by THIS audit, on top of the already-rigorous 36-item register in `docs/production-readiness/15-production-gap-register.md` (G-01..G-36, pinned to git HEAD `81d9f432`, verdict NO-GO). **This register does not duplicate G-01..G-36** — read that file for security/infra/auth gaps. This register uses IDs `BDG-01` upward and focuses on business-domain, AI-capability, and cross-domain gaps that audit either didn't cover or that this audit found independently.

Classification taxonomy (per audit brief §25): `MISSING_BUSINESS_CAPABILITY` · `INCOMPLETE_BUSINESS_WORKFLOW` · `FRONTEND_BACKEND_DISCONNECT` · `DATABASE_OR_DATA_COVERAGE_GAP` · `AI_INTENT_OR_CONTEXT_GAP` · `AI_REVISION_OR_STATE_GAP` · `DETERMINISTIC_VALIDATION_GAP` · `AUTHORIZATION_OR_PRIVACY_GAP` · `HEALTH_SAFETY_GAP` · `INTEGRATION_OR_AUTOMATION_GAP` · `UX_OR_PRESENTATION_GAP` · `TEST_COVERAGE_GAP` · `RUNTIME_CONFIGURATION_GAP` · `DOCUMENTATION_ONLY_GAP` · `UNKNOWN_NEEDS_VERIFICATION`.

Severity: P0 (security/privacy/dangerous-health/severe corruption) · P1 (broken core workflow/critical cross-domain defect) · P2 (important incomplete capability) · P3 (minor).

---

### BDG-01 — AI "LLM off" governance does not actually stop LLM calls (P1)
**Class:** AI_INTENT_OR_CONTEXT_GAP / RUNTIME_CONFIGURATION_GAP
**Finding:** This is `docs/production-readiness/15-production-gap-register.md` G-17, re-surfaced here because it is a **business-domain-AI-governance** gap, not just an infra gap: `CONVERSATIONAL_INTELLIGENCE_V2`/`_LLM` defaulting off does not prevent the orchestrator from still calling the local Qwen model for UNKNOWN/WRITE_ACTION/KNOWLEDGE turns (confirmed LIVE_LOCAL by the prior audit: 3 Qwen calls occurred with the flag off, ending in 170s timeouts). An operator or product owner reading only the flag name would reasonably but incorrectly believe "LLM off" means "no model calls."
**Impact:** Any decision to "ship CI-V2 off for the first release" does not actually get what the decision-maker thinks it gets. Directly relevant to this audit's §9/§10 AI capability mapping — "is X implemented" must be answered against the flag's *actual effect*, not its name.
**Evidence:** `CODE_INSPECTION` + `LIVE_LOCAL` (prior audit); independently corroborated by this audit's own ai-service structural agent finding the same call chain.
**Recommended fix:** One single kill-switch contract across every LLM entry point (already recommended in the prior audit as a release decision). Not re-implementing here — documenting as a business-facing consequence.

### BDG-02 — PaymentProviderType.STRIPE exists with zero implementation (P2)
**Class:** DATABASE_OR_DATA_COVERAGE_GAP
**Finding:** payment-service's Prisma schema enum lists `STRIPE` alongside MOCK/VNPAY/MOMO/ZALOPAY/PAYOS/MANUAL_BANK_TRANSFER, but no `stripe.provider.ts` or equivalent exists anywhere in `backend/services/payment-service/src/providers/`.
**Impact:** Low today (nothing routes a transaction to STRIPE), but any future code that iterates the enum assuming every value has a provider would fail silently or throw at the wrong layer. Also a documentation-vs-reality mismatch for anyone reading the schema as a feature list.
**Evidence:** `CODE_INSPECTION` — this audit's own Phase-1 backend-structural agent (independent finding, not sourced from any existing doc).
**Recommended fix:** Either implement Stripe or remove the enum value and document the decision.

### BDG-03 — `frontend/mobile` architecture was mis-documented in the repo's own design docs (P3, now corrected)
**Class:** DOCUMENTATION_ONLY_GAP
**Finding:** This audit initially assumed (based on repo docs and naming conventions) that `frontend/mobile` was the Capacitor-wrapped app. It is not — it's a fully independent Expo/React Native app; `frontend/web` is the Capacitor-wrapped one. Multiple existing repo docs (and this audit's own initial agent brief) carry this incorrect assumption.
**Impact:** Low directly, but it's a concrete, now-resolved example of exactly the failure mode CLAUDE.md warns about ("docs are evidence/history, not current truth — a report can describe a design that was later superseded"). Worth citing in the executive summary as a demonstrated instance of the audit's own methodology catching a real error.
**Evidence:** `CODE_INSPECTION` — `frontend/mobile/package.json` has no `@capacitor/*` dependency; `frontend/web/capacitor.config.ts` + `android/` directory confirm the reverse.
**Recommended fix:** None needed (informational); update any onboarding docs that repeat the Capacitor-mobile assumption.

### BDG-04 — Admin nav has 3 self-acknowledged missing screens (Membership Oversight, global cross-partner Audit Log, Notifications) (P2)
**Class:** FRONTEND_BACKEND_DISCONNECT / MISSING_BUSINESS_CAPABILITY
**Finding:** The web codebase's own `adminNav` comment states these were deliberately left off navigation because "their backing pages don't exist as standalone screens" — this is the development team's own admission, independently re-confirmed by this audit's web-route agent, not a newly-discovered defect.
**Impact:** Admin cannot currently get a cross-partner audit trail or a dedicated membership-oversight view from the UI, even though underlying audit-log data (`PartnerAuditLog`) exists in gym-service.
**Evidence:** `CODE_INSPECTION` (code comment in `Sidebar.tsx`).
**Recommended fix:** Build the 3 screens, or formally re-scope/defer with a dated decision record (per CLAUDE.md scope-control rules, this is a real P2 to document, not silently build).

### BDG-05 — Gym-partner self-onboarding: 6 originally-spec'd sub-routes were never built (P3)
**Class:** FRONTEND_BACKEND_DISCONNECT / DOCUMENTATION_ONLY_GAP
**Finding:** `GYM_PARTNER_WEB_ROUTE_MAP.md` describes 6 planned routes (`/partner/apply/check-email`, `/partner/apply/password`, `/partner/application/{status,changes,rejected,approved}`) that don't exist in the current router; the team consolidated them into state-driven UI inside 3 components instead. Independently re-confirmed by this audit's web-route agent (not just citing the doc).
**Impact:** A bookmark or external link built against the original spec's paths would 404. Low business impact since this is an internal consolidation, but worth noting as a real design-doc-vs-shipped-code gap that a new engineer reading only the spec doc would be misled by.
**Evidence:** `CODE_INSPECTION`.
**Recommended fix:** Update or retire the stale route-map doc; no code change needed.

### BDG-06 — Admin "active PT list" view blocked on a missing backend API (P2)
**Class:** FRONTEND_BACKEND_DISCONNECT
**Finding:** Confirmed by this audit's mobile-route agent, cross-checked against `MOBILE_WEB_PARITY_AUDIT_2026-10-03.md`'s own D3 item: no dedicated "active PT list" screen exists in admin on either platform, and the gap is attributed to a missing backend API, not a frontend omission.
**Evidence:** `CODE_INSPECTION`.
**Recommended fix:** Build the backend aggregate endpoint first; this is explicitly a backend gap, not a UI task.

### BDG-07 — Equipment-compliance gate is AI-generation-only; manual and coach-created programs bypass it (P2, already self-documented but worth carrying forward)
**Class:** DETERMINISTIC_VALIDATION_GAP
**Finding:** `validateAiPlanExerciseEquipment` only runs on the AI plan-generation path (confirmed by Phase-1 ai-service agent and independently by the prior production-readiness audit's `08-module-readiness.md`). Self-service manual programs and PT-assigned manual programs pass only existence/ownership checks, not equipment feasibility.
**Impact:** A user or PT could create a manual program prescribing equipment the user doesn't have, with no system warning — inconsistent with the AI path's guarantee.
**Evidence:** `CODE_INSPECTION`, confirmed by two independent audits.
**Recommended fix:** This is explicitly flagged by the prior audit as **a product decision required before launch**, not something to silently fix — carried forward here unchanged, not re-litigated (per CLAUDE.md scope-control: don't reopen a decision already correctly deferred).

### BDG-08 — PT-dashboard cross-client aggregate ("which clients are falling behind") does not exist (P2, CONFIRMED)
**Class:** MISSING_BUSINESS_CAPABILITY
**Finding:** **Confirmed by direct code trace.** The only PT-roster endpoint (`GET /contracts/pt` → `contractService.getByPT`, `contract.service.ts:797-818`) returns only Contract + counterparty profile + review rating — zero adherence/fitness/nutrition fields. Per-client adherence building blocks exist (`cycle-adherence.util.ts`, `training-cycle-metrics.service.ts`, `nutritionGoalPlanConsistencyService`) but are only ever invoked for one client at a time, inside `coachService.getClientSummary`. This matches the user's own project memory of a prior, deliberate decision not to build this due to N+1 query cost.
**Impact:** This single missing piece blocks 3 of the 5 priority PT-copilot use cases from task §14 simultaneously ("falling behind," "missed workouts this week," "consistently missed nutrition targets") — they all need the same roster-wide aggregate.
**Evidence:** `CODE_INSPECTION` — PT-copilot audit agent, full detail in `08-pt-client-management-ai-copilot-audit.md` §2.
**Recommended fix:** Build one genuinely new batch/derived projection (consistent with this repo's own precedent of preferring derived values over N+1 loops) rather than looping per-client calls from a future PT-copilot feature.

### BDG-13 — `GYMINI_PT_PERMISSION_MATRIX.md` omits the training-side CycleAssessment recommendation approve/reject routes (P3)
**Class:** DOCUMENTATION_ONLY_GAP
**Finding:** The permission-matrix doc (dated 2026-09-10, claims to be sourced from actual authz-check code) documents the nutrition-side recommendation approve/reject/modify routes but omits the structurally-identical training-side ones (`coach.service.ts:556-594`, `coach.routes.ts:22-31`). `git log -S"approveTrainingRecommendation"` shows this code's only commit is the current HEAD's large consolidation commit (`003545c6`, 2026-10-16) — i.e. it was added or formalized after the doc was written. The gate pattern the doc documents applies identically and correctly to the undocumented routes; this is an omission, not an error, and does not indicate any actual permission defect.
**Impact:** Low — purely a documentation-freshness issue. Anyone reading the matrix as a complete PT-capability list would miss that PTs can also approve/reject the training side of a CycleAssessment.
**Evidence:** `CODE_INSPECTION`, cross-checked against `git log`.
**Recommended fix:** Add the two missing rows to the doc; no code change needed.

### BDG-09 — `UserPreference` model flagged by Phase-1 backend agent as "legacy/unmapped adopted table" (P3)
**Class:** DATABASE_OR_DATA_COVERAGE_GAP / UNKNOWN_NEEDS_VERIFICATION
**Finding:** user-service's schema includes a `UserPreference` model the discovery agent characterized as legacy/unmapped — i.e., present in the schema but not confidently tied to an active route/capability during structural discovery.
**Impact:** Unknown until traced; flagging so it isn't silently forgotten.
**Evidence:** `CODE_INSPECTION` (Phase-1 backend agent).
**Recommended fix:** Verify whether any route reads/writes it; if genuinely dead, document and consider removal in a future migration (not now — no destructive action without a dedicated decision, per CLAUDE.md).

### BDG-10 — `src/knowledge/` is a self-documented deprecated-but-still-present duplicate RAG ingestion pipeline with real, non-duplicated source coverage not yet ported (P2)
**Class:** INTEGRATION_OR_AUTOMATION_GAP
**Finding:** ai-service has two knowledge-ingestion pipelines: `knowledge-pipeline/` (authoritative, live) and `knowledge/` (explicitly marked deprecated in its own README, CLI-only, bypasses the safety gate used by the authoritative pipeline). The deprecated one has real Crossref/OpenAlex source connectors not yet ported to the authoritative pipeline.
**Impact:** Those sources' content is currently unavailable to the live RAG system. Not a "silent dead code" situation — it's an acknowledged, documented gap — but still an open business-value gap (missing evidence sources for fitness-knowledge grounding).
**Evidence:** `CODE_INSPECTION` (ai-service's own README).
**Recommended fix:** Port Crossref/OpenAlex connectors into `knowledge-pipeline/`, or formally retire them if no longer wanted.

### BDG-11 — Account deletion capability not found in either frontend (P2, unconfirmed)
**Class:** MISSING_BUSINESS_CAPABILITY / UNKNOWN_NEEDS_VERIFICATION
**Finding:** Data export exists on both web and mobile (`ExportDataPage`/`export.tsx`), but no "delete my account" route/screen was found by either frontend discovery agent. This may exist as a backend-only capability (e.g. admin-initiated disable) without a self-service UI, or may genuinely not exist.
**Impact:** Relevant to §5.1 (consent/privacy controls) and potential compliance exposure if self-service deletion is expected but absent.
**Evidence:** `CODE_INSPECTION` (absence across two independent route inventories) — status UNKNOWN_INSUFFICIENT_EVIDENCE, not confirmed absent at the backend level.
**Recommended fix:** Verify directly (grep auth-service/user-service for a hard-delete or anonymization endpoint) before concluding this is missing.

### BDG-12 — Web-side query-cache clearing on logout/account-switch not traced by any audit (P1, unconfirmed)
**Class:** AUTHORIZATION_OR_PRIVACY_GAP / UNKNOWN_NEEDS_VERIFICATION
**Finding:** Mobile confirmed `queryClient.clear()` on logout. Web's equivalent behavior was explicitly NOT traced by the independent production-readiness audit (its own go-live checklist marks this `NOT VERIFIED`) and has not yet been traced by this audit either.
**Impact:** This is precisely the risk class this repo's own `gymini-account-session-isolation` skill exists to prevent — stale frontend cache from a previous user remaining visible after account switch on a shared device. Given a dedicated skill exists for this exact risk, its absence from either audit's verified set is notable.
**Evidence:** `NOT_VERIFIED` by two independent audits now.
**Recommended fix:** Direct code check of web's logout/switch-account handler for `queryClient.clear()` or equivalent, as a near-term follow-up.

### BDG-14 — Workout frequency constraint becomes prompt-only (no post-hoc validation) when an injury is mentioned or the request is combined-plan/body-recomposition (P1)
**Class:** AI_REVISION_OR_STATE_GAP / DETERMINISTIC_VALIDATION_GAP
**Finding:** Case A, confirmed live. The deterministic day-count guarantee that protects plain workout/frequency requests is explicitly bypassed (`orchestrator.service.ts:897-898`) whenever the message mentions an injury, or is a combined workout+nutrition / body-recomposition request — in those branches the day-count constraint is only a soft prompt instruction (`prompt_builder.ts:577-580`) and `answer_validator.ts` never counts days.
**Impact:** A user who mentions mild pain alongside a frequency request (a very plausible real phrasing) gets no enforcement guarantee at all.
**Evidence:** `CODE_INSPECTION` — conversational-state audit agent, full trace in `07-conversational-state-and-revision-audit.md`.
**Recommended fix:** Extend `answer_validator.ts` with a day-count check for the LLM-routed branches, or narrow the injury/combined-request LLM bypass to not also disable the deterministic day-count re-check.

### BDG-15 — Session MOVE requests execute as full plan regeneration, discarding unrelated days (P1)
**Class:** AI_REVISION_OR_STATE_GAP
**Finding:** Case B, confirmed live. "Move Friday to Saturday" is parsed as a day-SET re-specification with no from→to semantics; whenever the resulting set size differs from the current plan's day count (true for any real plan), `regenerate()` fires a full fresh regeneration at the new day count, discarding every other day. No reschedule/move tool exists for an already-saved active program either.
**Impact:** This is one of the task's own named known-failure cases, confirmed exactly as described, with precise file:line reproduction.
**Evidence:** `CODE_INSPECTION`, see `07-conversational-state-and-revision-audit.md` Case B.
**Recommended fix:** Add a genuine MOVE operation that edits one day's weekday label in place, distinct from a day-count change.

### BDG-16 — Disclosed physical limitations never become a persistent exercise-exclusion constraint (P1, health-relevant)
**Class:** HEALTH_SAFETY_GAP / AI_REVISION_OR_STATE_GAP
**Finding:** Case C, confirmed live, compounding 3-part cause: (1) safety-signal classification affects only the current turn's RAG gate, never a persisted exclusion; (2) no chat-writable `injuries` field exists at all (`agentUpdatableProfileFieldsSchema` is `.strict()` and omits it); (3) even a pre-existing known injury only produces a cosmetic warning string, by the function's own documented admission, never an automatic exercise removal. A 4th compounding factor: the one real exclusion mechanism only token-matches English catalog names, so a Vietnamese injury phrase couldn't work even if routed there.
**Impact:** A user who discloses leg pain and asks to avoid leg workouts will continue to see leg exercises proposed. This is the most safety-relevant confirmed defect in this audit.
**Evidence:** `CODE_INSPECTION`, see `07-conversational-state-and-revision-audit.md` Case C and `09-health-safety-and-constraint-audit.md`.
**Recommended fix:** Add a chat-writable injury/limitation field with explicit confirmation, thread it into `proposeWorkoutPlan`'s `exclusions` seed, and extend exclusion matching to handle Vietnamese body-part phrasing, not just English exercise-name tokens.

### BDG-17 — Workout-plan slot-filling has no constraint/exclusion slot at all; the fix pattern already exists for nutrition but was never ported (P1)
**Class:** AI_REVISION_OR_STATE_GAP
**Finding:** Case D, confirmed live. `CREATE_WORKOUT_PLAN`'s `SlotDefinition[]` defines only day-count and session-duration slots, with no `extractFromMessage` for any exclusion/constraint — so a stated exclusion is never captured during slot-filling in the first place (not lost on correction, never stored). The nutrition workflow has an explicit, dated, named fix for this exact bug class (`accumulateNutritionWorkflowConstraints`, comment citing "Final remediation M1") that was never applied to the workout workflow.
**Impact:** Same symptom and root cause as BDG-16 in the slot-filling context specifically; the two gaps should likely be fixed together.
**Evidence:** `CODE_INSPECTION`, see `07-conversational-state-and-revision-audit.md` Case D.
**Recommended fix:** Port the existing nutrition-side accumulating-constraint pattern to the workout workflow — this is unusually low-risk as fixes go, since the pattern is already proven in production for the sibling domain.

### BDG-18 — AI-drafted roadmap duration is hardcoded to 16 weeks on the chat path regardless of what the user said about timeline (P1)
**Class:** AI_INTENT_OR_CONTEXT_GAP
**Finding:** Case G, confirmed live, the cleanest finding in the audit. `timeframeWeeks` is a literal `16` at both chat call sites (`fitness-agent.service.ts:1577-1580`, `:1650`) — there is no slot, no free-text parse, nothing that reads the user's stated timeline preference into this field at all. The deterministic LLM-failure fallback then computes `min(16, 6) = 6` unconditionally, which is the exact mechanism producing the originally-reported "6-week starter roadmap for an unlimited-timeline request" symptom. Additionally, the Zod schemas for both input and output have no way to represent "no end date" even in principle (bounded numeric fields only).
**Impact:** Any chat-driven roadmap request currently ignores the user's stated timeline entirely on this surface.
**Evidence:** `CODE_INSPECTION`, see `07-conversational-state-and-revision-audit.md` Case G. Note: the non-chat `/ai/generate-roadmap-draft` passthrough route was NOT_VERIFIED (outside ai-service).
**Recommended fix:** Extract a timeframe slot from the conversation (including an explicit "no deadline" value distinct from "not mentioned"), and add a schema sentinel for open-ended duration.

### BDG-19 — No rollback/compensation for a partially-failed CREATE_PLAN_BUNDLE, and failed sub-steps aren't individually retryable (P2, architectural, by design)
**Class:** INCOMPLETE_BUSINESS_WORKFLOW
**Finding:** Case F. The 3-step roadmap+workout+nutrition bundle creation deliberately and correctly reports partial success honestly (✅/❌ per step) — this part is NOT a defect. But there's no shared transaction, and the `FitnessAgentAction`'s `retryable` flag is never `true` for this action kind, so re-confirming replays the cached result instead of retrying only the failed step; recovery is entirely manual (user notices the ❌ line and redoes that part themselves).
**Impact:** Lower than a typical P1 defect because the honest reporting prevents silent data inconsistency, but it's a real UX/recovery gap for a documented known scenario.
**Evidence:** `CODE_INSPECTION`, see `07-conversational-state-and-revision-audit.md` Case F.
**Recommended fix:** Mark `CREATE_PLAN_BUNDLE` actions `retryable: true` and have confirmation re-attempt only the steps that previously failed, rather than replaying the full cached result.

### BDG-20 — Several operation types have no real distinct implementation: MOVE, incremental ADD, REMOVE_CONSTRAINT, COMPARE (P2, architectural)
**Class:** AI_REVISION_OR_STATE_GAP
**Finding:** Confirmed by the operation-vocabulary pass in `07-conversational-state-and-revision-audit.md`: MOVE and CHANGE_FREQUENCY both collapse into full-regeneration CREATE/REPLACE; incremental ADD (e.g. "add a superset") is explicitly refused as unsupported; REMOVE_CONSTRAINT has no code path anywhere (constraints can only accumulate, never be individually removed — the only way out is cancelling the whole draft); COMPARE is not implemented at all (zero matches for "so sánh"/"compare" in the agent service).
**Impact:** Sets realistic expectations for what "natural conversational editing" currently means in this product: one real edit primitive (full regen) plus two genuine exceptions (duration trim, additive constraints). Relevant input for the roadmap phase's "shared AI/conversation infrastructure" priority.
**Evidence:** `CODE_INSPECTION`, see `07-conversational-state-and-revision-audit.md` operation-vocabulary table.
**Recommended fix:** Not urgent to fix all of these; document the current real capability set so product expectations match, and prioritize MOVE (shares root cause with BDG-15) and REMOVE_CONSTRAINT if conversational editing becomes a priority investment.

---

## Items deliberately NOT included here (already covered elsewhere, not duplicated)

- Security/infra/auth gaps G-01 through G-36 — see `docs/production-readiness/15-production-gap-register.md`.
- Case A–G conversational-state defects — **now resolved**, see `07-conversational-state-and-revision-audit.md` and BDG-14 through BDG-20 above. 5 of 7 cases confirmed live defects (A-exception-set, B, C, D, G), 1 appears fixed (E, minor cosmetic residual only), 1 is an acknowledged architectural trade-off rather than a bug (F).
- PT-copilot feasibility — **now resolved**, see `08-pt-client-management-ai-copilot-audit.md` (BDG-08 confirmed, BDG-13 added above). AI-drafted outbound messaging to clients is confirmed NOT_IMPLEMENTED (no gap filed separately — it's the same missing-aggregate root cause plus an entirely new LLM-to-notification path that doesn't exist at all today).
