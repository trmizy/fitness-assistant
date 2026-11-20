# 05 — Frontend / Backend / Database Coverage

Three-way reconciliation per task §6: **Top-down** (UI → API → Service → DB), **Bottom-up** (DB/Services → API → UI), **Cross-cutting** (Events/Jobs/AI → Business Domain). Source: Phase 1 structural discovery (web-route agent, mobile-route agent, backend-services agent) plus the PT-copilot agent's direct code traces.

## 1. UI without a working backend (or with a weaker backend than the UI implies)

| Finding | Evidence |
|---|---|
| None found at the "route points nowhere" level | Both the web-route agent and mobile-route agent explicitly checked for dead/orphaned nav links and found none beyond the two intentional dev-only routes (web) — every reachable UI route resolves to a real component backed by a real API. |
| Admin "active PT list" | UI gap, not "UI without backend" — the screen itself doesn't exist on either platform, explicitly because the backing API doesn't exist (confirmed by the mobile agent, matches the repo's own parity-audit doc). See gap BDG-06. |
| PT contract PDF download/e-sign resend | Web itself **removed** this button (commit `a97a6ec0`) — a capability that used to have both UI and backend now has neither actively exposed on web; mobile never had it either. Not a disconnect, a deliberate scope narrowing. |

## 2. Backend capability without an exposed workflow (UI-only or absent)

| Finding | Evidence |
|---|---|
| Training-side CycleAssessment recommendation approve/reject (`coach.service.ts:556-594`) | Exists and is callable; confirmed reachable via the mobile PT student-detail screen (general CycleAssessment review UI), but the dedicated permission-matrix documentation never named these two specific routes — a documentation gap (BDG-13), not a missing UI, since the general review UI already covers it functionally. |
| `UserPreference` model (user-service) | Agent flagged this as "legacy/unmapped" during structural discovery — i.e., the model exists but no confidently-identified active route/UI was found pointing at it during Phase 1. **Not yet independently confirmed dead** (see gap BDG-09) — could simply mean the Phase 1 agent didn't trace it deeply enough, not that it's truly orphaned. |
| `PaymentProviderType.STRIPE` | Database/schema-level capability (an enum value) with **zero** backend provider implementation and consequently no UI anywhere — the cleanest example in the repo of a model-level capability that was never built past the schema. See gap BDG-02. |
| Admin global cross-partner audit-log view, Membership Oversight screen, Notifications admin screen | `PartnerAuditLog` (gym-service) and underlying notification data exist; no admin UI surfaces them. **Self-acknowledged** by the team's own `adminNav` code comment — the team already knows this, it is not a fresh discovery. See gap BDG-04. |

## 3. Database model without active usage

No fully-dead model was conclusively found — every model traced back to at least one live route during Phase 1, with the single caveated exception of `UserPreference` above (unconfirmed, not conclusively dead).

## 4. Scheduled/integration workflows without UI visibility (by design, not a gap)

These are legitimate background automation, not UI gaps — listed for completeness per task §6's "cross-cutting" discovery direction:

| Job | Service | Purpose |
|---|---|---|
| `contract-expiry-sweep`, `reschedule-expiry`, `session-settlement-sweep`, `session-autoconfirm`, `room-close-resolution` | user-service | Session/contract lifecycle automation |
| `cycle-evaluation-sweep`, `workout-reminder` | fitness-service | Training-cycle + reminder automation |
| `membershipPayout.sweep`, `referral-settlement-sweep`, `partner-upload-sweep` | gym-service | Gym-partner money/upload automation |
| `reconciliation.service` | payment-service | Wallet/ledger reconciliation |
| BullMQ plan-generation queue, `knowledge-pipeline` cron (RSS/PubMed/web crawl) | ai-service | AI plan generation + RAG ingestion |
| `pt-deactivation-relay-sweep` | auth-service | Retries a cross-service PT-deactivation call that initially failed |

None of these have a dedicated admin UI showing their run history/health beyond the generic `/admin/system` monitoring page and unauthenticated `/metrics` endpoints — consistent with the production-readiness audit's finding (G-14) that no real monitoring/alerting is wired into the production deployment.

## 5. Documented feature without implementation (design-vs-build gaps, all independently re-verified against current code, not just cited from docs)

| Doc claim | Reality | Verification method |
|---|---|---|
| `GYM_PARTNER_WEB_ROUTE_MAP.md`: 6 planned partner-onboarding sub-routes | Never built as real routes — consolidated into state-driven UI in 3 components | Web-route agent independently checked `routes.tsx`, not just the doc |
| A "5-slot mobile bottom nav" referenced in a web `Sidebar.tsx` code comment | No such component exists in current web code; both desktop and mobile web share the same `Sidebar`/drawer | Web-route agent found the comment but confirmed no `BottomNav.tsx` exists |
| `MOBILE_WEB_PARITY_AUDIT_2026-10-03.md`'s ~26 web-only gaps | Nearly all already closed by a later "Phase 14B" commit series the doc predates | Mobile-route agent cross-checked against current source AND git log, not just re-stating the doc |
| `GYMINI_PT_PERMISSION_MATRIX.md`'s capability table | Accurate except missing 2 routes added after it was written | PT-copilot agent spot-checked specific line citations against current code |

**Pattern worth stating plainly in the executive summary**: every design-vs-build or doc-vs-code gap this audit found was caught by *independently re-deriving the fact from current code*, not by trusting the existing documentation corpus — and in every single case, the independent check either confirmed the doc was right, found it slightly stale (usually in the direction of "the team already fixed/built more than the doc says"), or found a harmless omission. **No case was found where a doc claimed something was built/safe and current code proved it genuinely was not** — i.e., this corpus's documentation, while large and sometimes stale, has not been found to systematically overclaim completeness in the areas this audit has checked so far. (The one exception requiring real caution is the opposite direction — see §6.)

## 6. The one place this audit found real overclaiming risk: the AI-coach "VERIFIED" chain vs. the later production-readiness verdict

Multiple docs in the Sept 9-22 corpus claim `VERIFIED` for AI-coach/conversational-intelligence capabilities (e.g. `AI_WORKOUT_RUNTIME_CLOSURE_FINAL_REPORT.md`, `GYMINI_GUIDED_ROADMAP_VERIFICATION_REPORT.md`, various `codex-*-final-signoff.md` files). The independent `docs/production-readiness/` audit (pinned to a later HEAD) reaches **NO-GO** for the whole product, and specifically flags that the Conversational Intelligence flag doesn't even govern all LLM calls (G-17) — these are not necessarily contradictory (a feature can be "VERIFIED" in its own scoped dev/test sense while the deployed production topology around it is separately NO-GO for unrelated reasons like no TLS, logged tokens, etc.), but a reader skimming only the feature-level "VERIFIED" files without also reading the production-readiness package would form a materially wrong impression of overall system readiness. This is exactly the discovered pattern the docs-corpus agent flagged (`ai-coach-demo-readiness-final.md` concluding BLOCKED even though earlier files in the same chain claimed VERIFIED) — a real, in-corpus example of claim drift across a chain, not an accusation against any single file.

## 7. Orphaned feature flags

| Flag | State | Note |
|---|---|---|
| `ENABLE_TOOL_CALLING` | off, code+compose | Not orphaned — deliberately gated, 2 real tools ready behind it |
| `CONVERSATIONAL_INTELLIGENCE_V2`/`_LLM` | off, code+compose | Not orphaned — extensively built and remediated, deliberately not shipped on yet |
| `GYMINI_UNIFIED_AI_COACH` | off/shadow | Not orphaned — most recent work explicitly targets shadow-only |
| `ENABLE_RESEARCH_AUTOMATION` | gates the deprecated `knowledge/` CLI pipeline | Arguably should be removed alongside that pipeline's eventual retirement, not urgent |
| `ENABLE_AGENTIC_DEMO` | demo guard in 2 services | Flagged `LEGACY_DEAD_CODE` pending a deployment decision by the independent production-readiness audit (G-36) |

No flag was found wired up but silently never read anywhere (a true "orphan" in the strictest sense) — every flag discovered gates a real, named code path.
