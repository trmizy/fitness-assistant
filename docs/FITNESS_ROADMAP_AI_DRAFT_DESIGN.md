# FitnessRoadmap AI Draft Design

Date: 2026-09-09
Scope: `backend/services/ai-service`, `backend/services/fitness-service`
Status: Design gate before/alongside code (Phase B, STEP 6) — written after
implementation, documenting the decisions actually made and verified.

## 1. What Already Exists (audited before writing this)

- `client-plan-draft.service.ts` (ai-service) already establishes the exact
  "draft-only, never persisted here, grounded against a caller-supplied
  allowlist, deterministic fallback on failure" pattern this feature needs —
  reused verbatim rather than inventing a new one.
- `callLlmJson(prompt, schema, opts)` (`llm/json_llm_call.util.ts`) is the
  one shared JSON-mode-LLM-call-with-retry-and-fallback helper already used
  by `cycle-analysis.service.ts`/`cycle-assessment.service.ts` — reused
  directly, not reimplemented.
- `fitness-goal-vision.service.ts` (`POST /ai/agent/goal-image`) already
  exists and already implements Phase D's exact safety posture (no body
  measurements, no identification, explicit "user must edit/confirm"). This
  pass does not touch it — it is consumed as an *optional input* to the
  roadmap draft (see §4), not re-implemented.
- `user.client.ts` (fitness-service) already exposes `fetchUserProfile` and
  `fetchLatestInBodyOnOrBefore` — real cross-service profile/InBody data,
  used as-is for context-gathering (§3). No new upstream data collection
  was built.
- fitness-service's own `CycleAssessment.decision` is still produced solely
  by the deterministic Decision Engine — this feature never touches that.

## 2. What This Pass Adds

```text
ai-service:
  schemas/roadmap-draft.schemas.ts   — request/output Zod contracts
  services/roadmap-draft.service.ts — prompt + callLlmJson + deterministic fallback
  controllers/roadmap-draft.controller.ts
  routes/ai.routes.ts:  POST /ai/generate-roadmap-draft (new line only)

fitness-service:
  clients/ai.client.ts: generateRoadmapDraft / generateRoadmapDraftSafe
  models/fitness-roadmap.models.ts: generateAiRoadmapDraftSchema, acceptAiRoadmapDraftSchema
  services/fitness-roadmap.service.ts: generateAiRoadmapDraft, acceptAiRoadmapDraft
  controllers/fitness-roadmap.controller.ts: generateAiDraft, acceptAiDraft
  routes/fitness-roadmap.routes.ts:
    POST /fitness-roadmaps/ai-draft         (generate, read-only)
    POST /fitness-roadmaps/ai-draft/accept  (accept, creates a real DRAFT roadmap)
```

Zero schema/migration change on either service.

## 3. Context Gathered (real data only, nothing fabricated)

`generateAiRoadmapDraft(userId, input)` gathers, in parallel, before calling
ai-service:

```text
fetchUserProfile(userId)              — age, gender, height, weights,
                                         experienceLevel, injuries,
                                         safetyScreeningStatus
fetchLatestInBodyOnOrBefore(userId, now) — real InBody body-fat%/lean mass,
                                         when one exists
prisma.trainingCycle.count(COMPLETED|ANALYZED) — completedCycleCount
prisma.cycleAssessment.findFirst(latest) — lastCycleDecision
prisma.nutritionGoal.count               — nutritionGoalVersionCount
```

Any of these that fail (cross-service call errors) resolve to `null`/`0`
rather than throwing — the draft is still generated, just with an explicit
`assumptions` entry noting the gap (enforced server-side in
`roadmap-draft.service.ts`, not left to the model's discretion).

`input.goalVisualAttributes`, if the caller supplies it, is passed through
as-is: an already-analyzed, already-validated result of the *existing*
`POST /ai/agent/goal-image` call the frontend makes separately. This
service never calls vision itself.

## 4. Structured Contract

```json
{
  "summary": "string",
  "reasoningSummary": "string",
  "confidence": 0.0,
  "phases": [
    { "phaseType": "FAT_LOSS", "name": "string", "plannedDurationWeeks": 6, "objectiveMaxCycles": 2, "reason": "string" }
  ],
  "warnings": ["string"],
  "assumptions": ["string"]
}
```

Matches the task brief's example shape exactly, with one deliberate
difference: phases carry `plannedDurationWeeks` (an integer, 1–26), never
literal calendar dates. fitness-service converts durations into concrete
chained `plannedStartAt`/`plannedEndAt` itself (deterministic date math,
starting from `input.plannedStartAt` or "now") — this removes an entire
class of date-math errors a model could otherwise introduce, and makes the
"total duration" clamp (§6) trivial to enforce.

No calories, macros, exercises, or meal content ever appear in this
contract — those stay owned by `NutritionGoal`/`WorkoutProgram`, unchanged
(hard architectural invariant from the master task, unchanged by this pass).

## 5. Two Independent Validation Layers

1. **ai-service** (`GenerateRoadmapDraftOutputSchema`, Zod): rejects any
   response with an unknown `phaseType`, a phase count outside 1–12, a
   duration outside 1–26 weeks, or a missing required field. `callLlmJson`
   retries (3 attempts) and returns `null` on repeated failure; the service
   then returns a **deterministic, non-fabricated** single-phase fallback
   (confidence `0`, an explicit warning) rather than ever throwing.
2. **fitness-service** (`generateAiRoadmapDraft`): re-validates every
   `phaseType` against its *own*, independently-declared
   `RoadmapPhaseTypeSchema` (not imported from ai-service — the two
   services stay decoupled) and drops anything outside it, exactly the
   "never trust the model's own claim" discipline
   `client-plan-draft.service.ts` already applies to `exerciseId`. Verified
   by a dedicated test simulating a compromised/misbehaving ai-service
   response bypassing its own schema.

Neither layer can be bypassed by the other — even if ai-service's own
validation were somehow defeated, fitness-service still independently
enforces the enum before anything reaches a proposal a user could accept.

## 6. Safety Clamps (deterministic, not modeled)

- `plannedDurationWeeks` clamped to `[1, 26]` per phase (defense in depth —
  ai-service's schema already bounds it, fitness-service clamps again).
- Total proposed duration clamped to 104 weeks (2 years); phases beyond the
  cap are dropped with an explicit warning appended, never silently
  truncated without saying so.
- `profile.safetyScreeningStatus === "FOLLOW_UP_SUGGESTED"` forces a
  warning onto the output server-side (ai-service), regardless of what the
  model said — verified by a dedicated test.
- If the model somehow returns zero valid phases after enum-filtering, a
  single default `FAT_LOSS` phase is substituted rather than returning an
  empty/broken draft.

This mirrors the master task's §5.3 instruction precisely: "reuse existing
… safeguards… If AI proposes unsafe values: reject, clamp using
authoritative rules, or require review" — here, clamp (duration/total) and
force-disclose (screening status), never silently pass through.

## 7. AI Failure Behavior (§5.4 of the master task)

| Failure | Behavior |
| --- | --- |
| ai-service unreachable (network/timeout) | `generateRoadmapDraftSafe` catches, logs, returns `null`; fitness-service's own fallback (single `FAT_LOSS` phase, confidence 0, explicit warning) is used instead |
| Invalid JSON from the model | `callLlmJson` retries 3x, then ai-service's own deterministic fallback is used |
| Unsupported `phaseType` | Rejected by ai-service's Zod schema (retried); if it still somehow reaches fitness-service, dropped independently there too |
| Missing fields | Rejected by Zod on both sides |
| Rate limit / duplicate request | No new idempotency primitive needed — `generateAiRoadmapDraft` never writes anything, so a duplicate call just re-generates a (possibly different) draft; nothing is ever half-created |

**Never creates half a roadmap**: `generateAiRoadmapDraft` performs zero
database writes under every one of the above paths — verified directly by
a test asserting `fitnessRoadmap` row count stays `0` after generation.
Only the separate, explicit `acceptAiRoadmapDraft` call ever creates a real
row, and that call is a thin, unconditional wrapper around the
already-fully-validated `createDraftRoadmap` (same date/overlap/idempotency
checks every other roadmap creation path already goes through) — there is
no "partial roadmap" state reachable from this feature.

## 8. Provenance

`acceptAiRoadmapDraft` always stamps `createdByRole = "AI"` server-side —
never taken from the request body. `createdByUserId` remains the real
acting user's id (who clicked "accept"), so provenance distinguishes *who
authored the strategy* (AI) from *who owns/accepted the roadmap* (the
user) — both already-existing, independent columns.

## 9. Test Coverage (verified against real PostgreSQL + a real local HTTP
ai-service stand-in, same convention as
`exercise-progression-ai-explanation.integration.test.ts`)

```text
ai-service (unit, mocked llmService.callLLM):
  request/output Zod contract accept/reject cases (5 tests)
  returns validated output on a well-formed LLM response
  falls back deterministically on invalid JSON
  falls back deterministically on an out-of-schema phaseType (never passes through)
  missing InBody -> assumptions discloses it
  FOLLOW_UP_SUGGESTED -> warning forced even if the model omitted one
  real InBody supplied -> the missing-InBody assumption is not force-added
  12/12 PASS

fitness-service (integration, real PostgreSQL + real local ai-service stand-in):
  happy path: validated, chained phases with correct dates/objective
  ai-service unreachable -> deterministic fallback, never throws
  out-of-enum phaseType from ai-service -> dropped independently
  total-duration clamp -> warning + never persists a FitnessRoadmap row
  acceptAiRoadmapDraft -> real DRAFT roadmap, createdByRole=AI
  5/5 PASS (part of the roadmap suite's 31/31 total, 0 fail, 0 skipped)
```
