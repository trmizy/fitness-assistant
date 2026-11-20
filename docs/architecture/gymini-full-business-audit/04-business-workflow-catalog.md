# 04 — End-to-End Business Workflow Catalog

Traces lifecycle/states/dependencies/validations/gaps for the major cross-domain workflows, per task §8. Each uses the 14-stage lifecycle checklist where relevant (entry → actor/auth → input → decision → validation → preview/intermediate → confirmation → execution → persistence → result → failure handling → retry/recovery → cancel/revise → subsequent state changes).

## WF-01 Onboarding → Goal → Workout/Nutrition → Roadmap

| Stage | Status |
|---|---|
| Entry | Client onboarding wizard (web+mobile), confirmed reachable |
| Actor/auth | `client` role, `RequireOnboarding` gate |
| Decision/preview | AI roadmap draft computed, not persisted |
| Confirmation | Explicit accept via fitness-service's own endpoint |
| Persistence | Roadmap activated in fitness-service; workout/nutrition created via separate `CREATE_PLAN_BUNDLE` steps |
| Failure handling | **Confirmed honest per-step reporting** (Case F, `07-conversational-state-and-revision-audit.md`) — no silent full-success claim on partial failure |
| Recovery | **Gap**: no automatic retry of only the failed step (BDG-19) — manual user action required |
| Subsequent changes | Post-onboarding profile edits propagating to downstream plans — `UNKNOWN_INSUFFICIENT_EVIDENCE` (not yet traced, CAP-02-03) |

This workflow is also the subject of the densest pre-existing doc chain in the repo (`GYMINI_CROSS_SYSTEM_*`, `GYMINI_CYCLE_TRANSITION_*`) — that chain's own final verdict was **PARTIALLY VERIFIED** with 3 P0 bugs found-and-fixed in-pass and 1 remaining item subsequently closed (2026-09-10). This audit's independent Case F/G findings (BDG-18, BDG-19) show the workflow still has live gaps as of current HEAD, specifically on the AI-chat-driven entry path rather than the guided-wizard path that chain's E2E testing primarily exercised — **the two findings are compatible, not contradictory**: different entry points into the same business workflow have different maturity levels.

## WF-02 InBody → Coach Analytics → Recommendation → Plan Revision

| Stage | Status |
|---|---|
| Entry | Manual or photo-scan InBody entry |
| Decision | `BodyMetrics` trend computed; AI explanation of trend generated on demand |
| Validation | **Gap**: `fetchInBodyHistory` swallows errors as `[]` (CAP-05-06) — a narration could treat "no data" and "zero change" identically without the user knowing which occurred |
| Downstream effect | PT/Coach can view history; CycleAssessment proposals may reference it |
| Historical integrity issue | A 2026-05-28 migration deleted real InBody rows to dedupe (GAP-G04, P0 in the external register) — the clearest violation anywhere in this audit of "measured body state must never be silently altered," notably caused by a migration, not by AI |

## WF-03 PT selection → Assignment → Client Management

| Stage | Status |
|---|---|
| Entry | PT discovery/search (client-initiated) |
| Decision | Recommendation scoring (`FitnessRecommendation`) |
| Confirmation | Contract request/accept between client and PT |
| Ongoing management | Full, confirmed-robust authorization boundary (`08-pt-client-management-ai-copilot-audit.md`) — PT can view/manage only clients with an ACTIVE contract, re-verified fresh per request |
| Gap | Declining a recommendation and getting an alternative without repeating profile — `UNKNOWN_INSUFFICIENT_EVIDENCE` (CAP-07-05), not yet traced |

## WF-04 PT adjusts client workout → Client reviews → Approval → Activation

| Stage | Status |
|---|---|
| Entry | PT-initiated, via `coachService.createAndAssignPlan` or `generatePlanDraft` |
| Validation | Equipment check runs for AI-generated plans only; manual/PT-assigned plans skip it (BDG-07, acknowledged product decision, not silently patched) |
| Persistence | Program created directly under the **client's** userId (ownership correct by construction) |
| Approval | `generatePlanDraft` never auto-assigns — requires the PT's own separate explicit assign call afterward |
| Client's own review/approval step | **Not independently confirmed in this audit** — whether the client gets an explicit accept/reject UI for a PT-assigned program, or whether assignment is immediate, is `UNKNOWN_INSUFFICIENT_EVIDENCE` and worth a follow-up trace if PT-assignment UX is a priority area |

## WF-05 AI creates roadmap and nutrition target, workout creation fails

Directly answered by Case F (`07-conversational-state-and-revision-audit.md`): **honest partial-success reporting confirmed** (not the feared silent-success failure mode); **no automatic rollback or step-level retry confirmed** (BDG-19, acknowledged architectural trade-off).

## WF-06 User revises an unconfirmed proposal several times

| Scenario | Finding |
|---|---|
| Revising workout-plan drafts | Exercise-name exclusions stated post-finalization are correctly preserved across later revisions (confirmed NOT buggy, Case D investigation) |
| Revising via slot-correction during initial creation | Confirmed buggy for constraints the workflow never captures in the first place (BDG-17) — this is a "never captured" bug, not a "lost on revision" bug, an important distinction for whoever fixes it |
| Revising nutrition constraints | Confirmed correctly accumulating (`accumulateNutritionWorkflowConstraints`) — the one domain where this workflow pattern is mature |
| Stale proposal confirmed after a newer revision exists | **`AgentWorkflowSession` has a partial unique index per (user, session) for active workflows** (DB-enforced), but `FitnessAgentAction` has no equivalent — `tryConfirmationBoundary` selects the most recent live action in code, not DB-enforced (external register GAP-G26, P2) |

## WF-07 User switches devices while a proposal is pending

Not independently traced by this audit (requires either live multi-device testing or a very targeted code read of session/device binding that wasn't in scope for the two deep-dive agents dispatched). `AgentWorkflowSession`/`FitnessAgentAction` are keyed by `userId`+`sessionId` in Postgres (not device-bound, not in-memory), which structurally supports cross-device continuity, but this is an **inference from the data model, not a confirmed runtime behavior** — marked `UNKNOWN_INSUFFICIENT_EVIDENCE`, a good candidate for a future live-test pass.

## WF-08 Gym-partner self-onboarding → approval → operational workspace

| Stage | Status |
|---|---|
| Entry | Public `/partner/apply` (web+mobile identical paths) |
| State machine | 5-state applicant lifecycle (`GYM_PARTNER_STATE_MACHINE.md`), confirmed implemented as in-page state rather than separate routes (design-vs-build gap, BDG-05, low impact) |
| Approval | Admin review queue (`admin/partners`), confirmed on both platforms |
| Operational handoff | OWNER/MANAGER permission split confirmed robust in 3 independent places (web/mobile/backend), no contradiction found anywhere in this audit |

This is the single most mature workflow found in the entire audit — independently confirmed robust from 3 discovery angles (frontend×2, backend) with zero contradictions, the only workflow in this catalog with that property.

## Cross-workflow pattern worth stating once, clearly

**Every workflow that routes through the deterministic agent-workflow/slot-filling machinery inherits that machinery's one real limitation**: a single edit primitive (full regeneration) plus two genuine exceptions (duration trim, nutrition constraint accumulation). WF-01, WF-04, and WF-06 all surface this same underlying constraint in different guises (Case B's MOVE-as-regen, BDG-17's uncaptured workout exclusions, BDG-20's missing REMOVE_CONSTRAINT) — **this is one architectural root cause expressed as several "different" workflow symptoms**, not several unrelated bugs. Fixing the workout-workflow's constraint-slot gap (BDG-17, which already has a proven nutrition-side template to copy) would materially improve WF-01, WF-04, and WF-06 simultaneously.
