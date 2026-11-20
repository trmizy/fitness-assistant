# 13 — Business-First AI Development Roadmap

Per task §31: phases ordered by dependency, business-first — not AI-development-first in every domain. Acceptance criteria included. This is a **recommendation only**; nothing in this phase has been implemented.

## Phase 0 — Foundational blockers (must precede any of the AI work below)

These are already fully specified with evidence in `docs/production-readiness/15-production-gap-register.md` (G-01..G-36) and this audit's own `10-business-gap-register.md` (BDG-01..BDG-20). Not re-listing all 56 items here; grouping by theme:

1. **Security P0s** (G-01 JWT literal fallback, G-02 logged bearer tokens, G-03 no TLS, G-04 destructive migrations with no snapshot gate) — must close before any public exposure, independent of AI scope.
2. **Authorization hardening** (G-08, G-09, G-24) — the PT-client boundary was found robust (a genuine strength to preserve), but the *general* pattern ("no complete owner-check matrix repo-wide") should be closed before building more AI surfaces that read/write business data, since each new AI tool is a new potential authorization surface.
3. **Data integrity** (G-04, G-20, G-27, G-28) — the InBody destructive-migration history is the most concrete instance of exactly the kind of measurement-integrity violation the AI-authority rules exist to prevent, except the violator here was a migration, not AI — a reminder that "AI is not authoritative" alone doesn't protect data if the surrounding engineering practice doesn't.

**Acceptance criteria**: go-live checklist items in the external register's `17-go-live-checklist.md` flip from `[ ]` to `[x]` with cited evidence, not just a claim.

## Phase 1 — Shared AI/conversation infrastructure fixes (small, high-leverage, proven patterns)

Ordered by leverage-to-effort ratio, using this audit's own confirmed findings:

1. **BDG-17 — port the nutrition workflow's constraint-accumulation fix to the workout workflow.** Smallest-risk fix in this entire roadmap: the pattern (`accumulateNutritionWorkflowConstraints`) is already proven in production for a sibling domain. **Acceptance**: a workout-plan slot-filling session that states an exclusion mid-flow, then corrects an unrelated slot (frequency), retains the exclusion in the final plan.
2. **BDG-16 — add a chat-writable injury/limitation field with explicit user confirmation, threaded into `proposeWorkoutPlan`'s exclusion seed; extend exclusion matching to Vietnamese body-part phrasing, not just English exercise-name tokens.** Depends on #1 (same slot-filling surface). **Acceptance**: a user who discloses a leg injury and later generates/revises any workout plan never receives a leg exercise, verified by both English- and Vietnamese-phrased disclosure.
3. **BDG-15 — add a genuine MOVE operation** (edit one day's weekday label in place) distinct from a day-count change. **Acceptance**: moving one session to a different day preserves every other day of the existing plan unchanged.
4. **BDG-14 — extend `answer_validator.ts` with a day-count check** for the LLM-routed branches (injury-mention, combined-plan, body-recomposition), closing the gap where the deterministic day-count guarantee is currently bypassed. **Acceptance**: a frequency request combined with an injury mention still produces exactly the requested session count.
5. **BDG-18 — replace the hardcoded `timeframeWeeks=16`** with a real slot extracted from the conversation, including an explicit "no deadline" value distinct from "not mentioned," and a schema sentinel for open-ended duration. **Acceptance**: an explicit "no deadline, I just want to lose weight" request does not receive a fixed 6-week roadmap; the system either asks a clarifying question or generates an appropriately open-ended plan.
6. **BDG-19 — mark `CREATE_PLAN_BUNDLE` actions `retryable: true`, re-attempt only failed steps on re-confirmation.** **Acceptance**: re-confirming a bundle where only the workout step failed re-attempts only that step, without re-running the already-successful roadmap/nutrition steps.

**Why this ordering**: items 1-2 share one root architectural gap (constraint persistence) and the biggest single safety-relevant finding of the audit; items 3-5 share the "single edit primitive" root cause documented in `04-business-workflow-catalog.md`'s cross-workflow pattern note; item 6 is independent and lower-risk to defer slightly.

## Phase 2 — Domain-specific enhancements (after Phase 1 lands)

1. **PT-dashboard cross-client aggregate (BDG-08)** — a genuinely new batch/derived projection (not an N+1 loop, consistent with this repo's own established preference for derived values). **This single build unlocks 3 of 5 priority PT-copilot use cases simultaneously** (falling-behind clients, missed workouts, nutrition-target misses) — the highest-leverage single new build identified anywhere in this audit.
2. **Equipment-compliance gate decision (BDG-07)** — a product decision (extend the AI-only gate to manual/PT-assigned programs, or formally accept the inconsistency), not a default "just fix it" — already correctly deferred as a decision, not a silent patch, by the prior audit; this roadmap does not reopen that call.
3. **Multi-client AI batch-proposal orchestration** — a thin wrapper around the already-real, already-audited `generatePlanDraft`, calling it N times for N clients. Low risk since the underlying generation mechanism needs no change.
4. **AI-drafted outbound check-in messages** — the one PT-copilot use case needing genuinely new infrastructure (an LLM-authored-text-to-notification path, which does not exist today at all) **plus** an explicit PT-approval-before-send step, consistent with CLAUDE.md's rule that AI must never autonomously message a client. Sequence after #1 (the aggregate is what identifies *which* clients need a check-in in the first place).

## Phase 3 — Product intelligence (longer-horizon)

1. Decide the fate of `CONVERSATIONAL_INTELLIGENCE_V2`/`GYMINI_UNIFIED_AI_COACH` — both are extensively built, extensively remediated, and still shadow/off by the team's own most recent assessment (`ai-product/phase3-*`, Oct 5-11). This is a release-timing decision for the owner (per `docs/production-readiness/00-executive-summary.md`'s own "Decisions required from the owner" list), not an engineering task this roadmap should prescribe.
2. Deploy the already-trained `query-classifiers/` ML safety model (currently built but inert, empty artifacts directory) — lower risk than building new ML, since training work is already done; needs only artifact deployment + a shadow-mode validation pass before trusting it over the regex path.
3. Port the deprecated `knowledge/` pipeline's unique Crossref/OpenAlex sources into the authoritative `knowledge-pipeline/` (BDG-10) — expands RAG evidence coverage without architectural risk.

## Special question answered (task §32): one AI platform, many agents, or bounded hybrid?

**Recommendation: C — bounded hybrid, which is what Gymini already has and should keep.** Grounded in this audit's own evidence, not architectural fashion:

- **Context continuity**: the demand-driven `enterprise-data/*.reader.ts` + `context-assembler.ts` pattern already lets different turns pull only the context they need, without duplicating a full context-fetch per "agent." A per-domain independent-agent model (option B) would either duplicate this machinery per domain or require its own shared layer — i.e., it would eventually re-invent option A's infrastructure anyway.
- **Business authority**: the single most consistently strong finding across this entire audit is that the proposed-vs-persisted boundary holds **because there is one shared confirmation/persistence contract** (`FitnessRecommendation`/`FitnessAgentAction`/`AgentWorkflowSession` + each owning service's own accept endpoint). Splitting into independent per-domain agents would multiply the number of places this contract needs to be independently re-implemented and re-verified — directly increasing the authorization-surface risk this roadmap's Phase 0 is trying to shrink, not reduce it.
- **Security/PT-client privacy**: the PT-client authorization boundary was found robust specifically because there is exactly one gate function multiple callers share (`assertActivePtClientRelationship`). A multi-agent architecture with independent PT-copilot and client-coach agents would need to either share this gate (making it the same hybrid architecture by another name) or re-implement equivalent checks per agent (new risk surface for no evidenced benefit).
- **Multi-domain requests**: the existing `fitness-agent.service.ts` dispatcher already handles cross-domain intents (`CREATE_PLAN_BUNDLE` spans roadmap+workout+nutrition in one flow) within the current architecture. Nothing in this audit's findings suggests the current single-orchestrator approach is hitting a real multi-domain ceiling — the actual confirmed gaps (BDG-14 through BDG-20) are about constraint propagation and operation coverage *within* the existing architecture, not about needing more agents.
- **Maintainability/testability**: the nutrition-workflow's constraint fix being directly portable to the workout workflow (BDG-17) is itself evidence of a maintainable shared pattern — a benefit of the hybrid approach that would be lost if domains were split into fully independent agents with no shared conversational mechanics.
- **Future extensibility**: the one capability genuinely missing new infrastructure (AI-drafted PT-to-client messaging) still fits cleanly into the existing confirmation-boundary pattern (draft → explicit approval → send) rather than requiring a new agent framework.

**What NOT to do, explicitly** (per task §27, and directly contradicted by nothing this audit found): do not introduce LangGraph/Mastra/BAML/a new vector database/a new agent framework. Every gap this audit confirmed is fixable within the existing architecture's own established patterns (the nutrition-workflow fix, the existing confirmation-boundary, the existing enterprise-data readers) — none of the 20 business-domain gaps or 36 external gaps required a new architectural primitive to explain or to propose a fix for.
