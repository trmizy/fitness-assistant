# FitnessRoadmap Next-Phase Implementation Report

Date: 2026-09-09
Scope: `backend/services/fitness-service`, `backend/services/ai-service`,
`backend/gateway`, `frontend/web`
Builds on: the already-`VERIFIED` FitnessRoadmap + RoadmapPhase foundation
(`docs/FITNESS_ROADMAP_VERIFICATION_REPORT.md`).

## 1. Initial Architecture Audit

Before any code, the following were read/inspected (not just the prior
reports):

```text
docs/fitness-roadmap-phase-integration-plan.md
docs/FITNESS_ROADMAP_IMPLEMENTATION_REPORT.md / _VERIFICATION_REPORT.md
backend/services/fitness-service/src/services/fitness-roadmap.service.ts
backend/services/fitness-service/src/models/fitness-roadmap.models.ts
backend/services/fitness-service/src/controllers/fitness-roadmap.controller.ts
backend/services/fitness-service/src/routes/fitness-roadmap.routes.ts
backend/services/fitness-service/src/services/coach.service.ts (+ routes/controller)
backend/services/fitness-service/src/clients/user.client.ts, ai.client.ts
backend/services/ai-service/src/services/{client-plan-draft,cycle-analysis,
  cycle-assessment,fitness-goal-vision,marketplace,personalized-service}.service.ts
backend/services/ai-service/src/llm/json_llm_call.util.ts
backend/services/ai-service/src/routes/ai.routes.ts, fitness-agent.routes.ts
backend/gateway/src/routes/proxy.routes.ts
frontend/web/src/app/pages/client/TrainingCyclePage.tsx, TrainingPage.tsx
frontend/web/src/app/services/api.ts, fitnessAgent.ts
frontend/web/src/styles/theme.css
frontend/web/package.json, vite.config.ts
docker/test/README.md
```

Key findings that shaped every later decision:

```text
- CycleAssessment.decision is produced by a deterministic Decision Engine —
  never by AI. ai-service's /assess-cycle only explains an already-decided
  result. Unchanged by this pass.
- client-plan-draft.service.ts already establishes the exact "AI proposes a
  structured DRAFT only, grounded, deterministic-fallback-on-failure, never
  persisted by the AI layer" pattern this task's Phase B needs — reused
  directly, not reinvented.
- fitness-goal-vision.service.ts (POST /ai/agent/goal-image) ALREADY exists
  and already implements Phase D's exact safety posture. Not rebuilt.
- coach.service.ts/coach.routes.ts ALREADY implements the exact PT-client
  authorization model (assertActivePtClientRelationship, re-checked fresh
  per call against a real Contract) Phase E needs. Not rebuilt.
- user.client.ts already exposes fetchUserProfile/fetchLatestInBodyOnOrBefore
  AND isActivePtClientRelationship — real cross-service data for both
  Phase B's context-gathering and Phase E's authorization.
- The gateway had NO proxy rule for /fitness-roadmaps at all — a real gap,
  fixed (§4).
- The frontend has no tsconfig at all (vite build is the real compile
  check) and is dark-mode-zinc-first with light mode via CSS-variable
  override, not `dark:` variants — shaped how the Journey page was written.
```

## 2. Design Decisions

See the three dedicated design docs for full reasoning:

```text
docs/FITNESS_ROADMAP_REBUILD_DESIGN.md        (Phase A)
docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md       (Phase B)
docs/FITNESS_ROADMAP_PT_INTEGRATION_DESIGN.md (Phase E)
docs/FITNESS_ROADMAP_FRONTEND_DESIGN.md       (Phase C)
```

One-line summary of each:

```text
REBUILD:      zero schema change — reuses the already-legal PLANNED->SKIPPED
              phase transition + ACTIVE->COMPLETED, a new
              ROADMAP_REBUILD_APPLIED audit decision, and the existing
              activatePhaseInTransaction helper verbatim.
AI DRAFT:     zero schema change — new ai-service endpoint mirrors
              client-plan-draft.service.ts's pattern exactly; fitness-service
              independently re-validates/clamps everything before ever
              offering it to a user, and never persists until explicit accept.
PT:           zero schema change, zero new authorization logic — two new
              coach.service.ts methods reuse assertActivePtClientRelationship
              verbatim; a PT can only view + create a DRAFT, never
              activate/advance/rebuild/archive.
FRONTEND:     new "Lộ trình" tab inside the existing TrainingPage, built with
              the app's existing Tailwind/react-query/axios conventions —
              no new design system, no new nav entry.
```

## 3. Schema Changes

**None.** Confirmed by `prisma migrate status` reporting "Database schema
is up to date!" (53/53 migrations, unchanged) after every corrective code
change in this pass — see the verification report.

## 4. API Changes

```text
NEW (fitness-service, mounted at /fitness-roadmaps):
  POST /fitness-roadmaps/ai-draft            — generate an AI draft (read-only)
  POST /fitness-roadmaps/ai-draft/accept     — accept an AI/manual draft (createdByRole stamped server-side)
  POST /fitness-roadmaps/:roadmapId/rebuild/preview
  POST /fitness-roadmaps/:roadmapId/rebuild/apply

NEW (fitness-service, mounted at /coach — PT-assisted):
  GET  /coach/clients/:clientId/roadmap
  POST /coach/clients/:clientId/roadmap/draft

NEW (ai-service, mounted at /ai):
  POST /ai/generate-roadmap-draft            — called by fitness-service only

NEW (gateway):
  /fitness-roadmaps/* proxy rule (was completely missing before this pass —
  the frontend could not have reached any /fitness-roadmaps route through
  the real deployed path without it)
```

Existing routes (`POST /fitness-roadmaps`, `.../activate`, `.../advance`,
`.../archive`, `.../phases`, `.../phases/:phaseId/activate`, `GET .../current`,
`GET .../:roadmapId`) are unchanged.

## 5. REBUILD Semantics

See `docs/FITNESS_ROADMAP_REBUILD_DESIGN.md` §3 in full. Summary: preview
computes a deterministic default proposal (one `RECOVERY` phase + the
remaining originally-planned phases re-chained onto the new timeline);
apply completes the current phase, skips the remaining `PLANNED` phases,
creates + activates the proposal (default or caller-supplied), and records
one `ROADMAP_REBUILD_APPLIED` audit row. Idempotent by `assessmentId`,
serialized by the existing per-user advisory lock, verified concurrent-safe
against itself, `advanceRoadmap`, and `archiveRoadmap`.

## 6. AI Architecture

See `docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md` in full. Summary: ai-service
proposes `{summary, reasoningSummary, confidence, phases[], warnings[],
assumptions[]}` (phase **types + durations + reasons only** — never
calories/macros/exercises); fitness-service gathers real context (user
profile, real InBody, own cycle/assessment/nutrition history),
independently re-validates every `phaseType`, clamps per-phase and total
duration, converts durations into concrete chained dates itself, and never
writes anything until a separate explicit accept call.

## 7. Frontend Architecture

See `docs/FITNESS_ROADMAP_FRONTEND_DESIGN.md` in full. Summary: one new
page (`RoadmapJourneyPage.tsx`) as a third tab inside the existing
`TrainingPage`, covering every roadmap status + AI-draft-review +
manual-quick-create + pending-rebuild states, built entirely from the
app's existing component/styling conventions.

## 8. Goal Image Integration

No new vision code. The frontend's `AiDraftPanel` adds an optional file
input that calls the pre-existing `fitnessAgentService.image()` (→
`POST /ai/agent/goal-image`) and, only if `usable === true`, passes the
resulting attributes through to `generateAiDraft` as extra, clearly-labeled
"style hint only" context. See design doc §7 (rebuild doc's sibling, the AI
draft doc) §3/§7 and frontend design doc §5.

## 9. PT Integration

Two new `coach.service.ts` methods, gated by the exact same
`assertActivePtClientRelationship` every other PT action already uses. A
PT may view a client's current roadmap and create a new `DRAFT` for the
client (attributed `createdByRole = "PT"`, owned by the client) — never
activate/advance/rebuild/archive directly. See
`docs/FITNESS_ROADMAP_PT_INTEGRATION_DESIGN.md`, including the honestly-
reported frontend gap (§5 there): no PT-facing UI entry point was built
this pass.

## 10. Security Rules

```text
- Every roadmap-mutating route still uses req.user!.id exclusively; no
  route (client or PT) accepts userId/clientId/ptId from a request body for
  identity — confirmed by controller code review + tests.
- activatePhase's containment-check-before-business-state-check ordering
  (fixed during the prior verification pass) is preserved — not reverted or
  weakened by any change in this pass.
- applyRoadmapRebuild checks assessmentId containment (belongs to the
  roadmap's own currently-pending rebuild) before any mutation — verified
  by a dedicated IDOR test with cross-user assessment ids.
- generateAiRoadmapDraft/acceptAiRoadmapDraft never accept a caller-supplied
  createdByRole; acceptAiRoadmapDraft always stamps "AI" server-side.
- createRoadmapDraftForClient (PT) never accepts a caller-supplied
  createdByRole either; always stamps "PT" server-side, and the resulting
  roadmap's userId/createdByUserId are the CLIENT's, verified by a
  dedicated test asserting they are never the PT's.
- ai-service's roadmap-draft output is independently re-validated by
  fitness-service (its own RoadmapPhaseTypeSchema, not imported
  cross-service) — verified by a test simulating a compromised/misbehaving
  ai-service response bypassing its own schema.
```

## 11. Migration Notes

None needed or added. `checkDuplicateActiveCycles.ts` (added during the
prior verification pass, unchanged by this one) remains the read-only
preflight script for the pre-existing `20260730020000` migration's
auto-remediation risk — not touched by this pass's work.

## 12. Tests Added

```text
backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts
  +14 tests this pass (containment-fix regression + DB-constraint coverage
  + full E2E + E2E concurrency were added in the prior verification pass;
  this pass adds: prepareRoadmapRebuild default proposal, applyRoadmapRebuild
  full lifecycle + idempotency + IDOR + guard + concurrency + rebuild/advance
  race + rebuild/archive race + caller-supplied-phases, generateAiRoadmapDraft
  happy-path/fallback/invalid-enum-drop/duration-clamp, acceptAiRoadmapDraft)
  -> file total now 31 tests, 0 fail, 0 skipped

backend/services/fitness-service/src/__tests__/coach.service.integration.test.ts
  +2 tests (getClientRoadmap/createRoadmapDraftForClient 403 gate; PT draft
  creation + ownership/attribution + activation-gates-visibility)
  -> file total now 7 tests, 0 fail, 0 skipped

backend/services/ai-service/src/__tests__/roadmap-draft.test.ts (new)
  12 tests: Zod contract accept/reject, happy path, invalid-JSON fallback,
  out-of-schema-phaseType fallback, missing/present InBody assumption
  disclosure, forced safety-screening warning
  -> 12/12 PASS
```

## 13. Regression Results

```text
fitness-service build (tsc --noEmit):              PASS, 0 errors
ai-service build (tsc --noEmit):                    PASS, 0 errors
gateway build (tsc --noEmit):                       PASS, 0 errors
frontend build (vite build):                        PASS, 0 errors

fitness-service full category-1 suite (97 files):   713 tests / 709 pass / 0 fail / 4 skipped
  (4 skips are the same pre-existing, unrelated conditional skips already
  present before this pass — not introduced by it)
fitness-service pure baseline (5 engine/util files): 128/128 PASS (unchanged)
ai-service full suite:                              349 tests / 345 pass / 0 fail / 4 skipped (pre-existing)
gateway full suite:                                 21/21 PASS
```

No new failures anywhere. See
`docs/FITNESS_ROADMAP_NEXT_PHASE_VERIFICATION_REPORT.md` for full command
transcripts.

## 14. Known Gaps (reported honestly, not hidden)

```text
NOT IMPLEMENTED (frontend): a PT-facing UI entry point for
  createRoadmapDraftForClient. Backend capability is built and tested;
  see docs/FITNESS_ROADMAP_PT_INTEGRATION_DESIGN.md §5 for the reasoning
  and the recommended next step (mirror AssignPlanModal.tsx's existing
  pattern in PTClientDetail.tsx).
NOT DONE: live browser-driven E2E of the new Journey page (create -> AI
  draft -> accept -> activate -> view -> rebuild -> complete). The
  production build passes; runtime behavior in an actual browser session
  was not walked through this pass (needs a gateway/web dev-container
  restart + a logged-in test user). See
  docs/FITNESS_ROADMAP_FRONTEND_DESIGN.md §6.
OUT OF SCOPE (unchanged from the master task's own instructions): AI-
  generated roadmap draft still requires an explicit human accept before
  anything is written — by design, not a limitation.
```

## 15. Exact Files Changed

```text
backend/gateway/src/routes/proxy.routes.ts                                   (+/fitness-roadmaps proxy rule)

backend/services/ai-service/src/schemas/roadmap-draft.schemas.ts             (new)
backend/services/ai-service/src/services/roadmap-draft.service.ts           (new)
backend/services/ai-service/src/controllers/roadmap-draft.controller.ts     (new)
backend/services/ai-service/src/__tests__/roadmap-draft.test.ts             (new)
backend/services/ai-service/src/routes/ai.routes.ts                          (+1 route)

backend/services/fitness-service/src/services/fitness-roadmap.service.ts     (+REBUILD, +AI draft methods, +pendingRebuild projection field)
backend/services/fitness-service/src/models/fitness-roadmap.models.ts       (+rebuild/AI-draft schemas)
backend/services/fitness-service/src/controllers/fitness-roadmap.controller.ts (+4 handlers)
backend/services/fitness-service/src/routes/fitness-roadmap.routes.ts       (+4 routes)
backend/services/fitness-service/src/clients/ai.client.ts                    (+generateRoadmapDraft/Safe)
backend/services/fitness-service/src/services/coach.service.ts              (+2 PT methods)
backend/services/fitness-service/src/controllers/coach.controller.ts        (+2 handlers)
backend/services/fitness-service/src/routes/coach.routes.ts                 (+2 routes)
backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts (+14 tests)
backend/services/fitness-service/src/__tests__/coach.service.integration.test.ts (+2 tests)

frontend/web/src/app/pages/client/RoadmapJourneyPage.tsx                     (new)
frontend/web/src/app/pages/client/TrainingPage.tsx                          (+1 tab)
frontend/web/src/app/services/api.ts                                        (+fitnessRoadmapService, +types)

docs/FITNESS_ROADMAP_REBUILD_DESIGN.md                                       (new)
docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md                                      (new)
docs/FITNESS_ROADMAP_PT_INTEGRATION_DESIGN.md                                (new)
docs/FITNESS_ROADMAP_FRONTEND_DESIGN.md                                      (new)
docs/FITNESS_ROADMAP_NEXT_PHASE_IMPLEMENTATION_REPORT.md                     (this file)
docs/FITNESS_ROADMAP_NEXT_PHASE_VERIFICATION_REPORT.md                       (companion)
```

No other files were touched. No migration was added. No commit was made.

## 16. Final Status

```text
Phase A (REBUILD):        VERIFIED — real PostgreSQL, 9 dedicated tests, 0 fail
Phase B (AI Draft):        VERIFIED — real PostgreSQL + real local ai-service
                            stand-in, 5 fitness-service tests + 12 ai-service
                            unit tests, 0 fail
Phase C (Frontend):        IMPLEMENTED, build-VERIFIED — NOT live-browser-tested
Phase D (Goal Image):      INTEGRATED — reuses pre-existing real vision
                            endpoint end-to-end, build-VERIFIED, NOT live-
                            browser-tested
Phase E (PT):               Backend VERIFIED — real PostgreSQL, 2 dedicated
                            tests, 0 fail. Frontend entry point NOT IMPLEMENTED
                            (documented gap, §14)
Regression:                 0 new failures across 4 services (§13)
Migration:                   None added; schema clean (53/53)
```
