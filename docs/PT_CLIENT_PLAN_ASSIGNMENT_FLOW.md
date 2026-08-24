# Flow B — PT/Coach Client Plan Assignment

> Verified against the actual implementation on branch `feature/session-feedback-pt-mode` (Phases 6–7 of `docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md`). This flow deliberately REUSES the existing `Contract` model (user-service) as the PT-client authorization source of truth — see the audit doc's "Existing PT infrastructure to REUSE" finding — rather than introducing a new relation table.

## Actors
- **PT** — a user with an ACTIVE `Contract` to a client (`Contract.ptUserId`/`Contract.clientUserId`/`Contract.status`, user-service).
- **Client** — the contract's `clientUserId`.
- **user-service** — owns `Contract`, exposes the internal authorization check.
- **fitness-service** — owns `CoachClientActionAudit`, `PlanGenerationAudit`, and reuses `workoutService.createManualProgram` unchanged.
- **ai-service** — owns the draft-generation LLM call (advisory only).

## Authorization — the one rule everything else depends on

Every `/coach/*` request in fitness-service is gated by a **fresh, per-request** cross-service call, never cached:

```
fitness-service (coach.service.ts: assertActivePtClientRelationship)
  --GET /internal/contracts/active-relationship?ptUserId=&clientUserId=-->
  user-service (contract.controller.ts: checkActivePtClientRelationship)
  --{active: boolean}-->
```

`contractRepository.findActivePtClientPair` (user-service) checks `ptUserId + clientUserId + status === ACTIVE` — strictly, direction-specific, unlike the pre-existing `findActiveByPair`/`findRelationshipByPair` (which also match PENDING_SIGNATURE/COMPLETED and are direction-agnostic — fine for chat eligibility, not fine for "can this PT write training data for this client"). If the relationship check fails or times out, `coach.service.ts` fails **closed** (denies), never open.

## End-to-end sequence

```mermaid
sequenceDiagram
    participant PT as PT (browser)
    participant FE as Frontend (PTClientDetail / AssignPlanModal)
    participant FS as fitness-service
    participant US as user-service
    participant AI as ai-service

    PT->>FE: Opens a client's detail page
    FE->>FS: GET /coach/clients/:clientId/summary
    FS->>US: verify ACTIVE relationship (internal, fresh)
    US-->>FS: {active:true}
    FS->>FS: trainingCycleService.getActiveCycle(clientId) + cycleFeedbackAggregator + getPriorCycleDecisions
    FS->>FS: audit VIEW_CLIENT_SUMMARY (CoachClientActionAudit)
    FS-->>FE: {activeCycle, cycleSummary, feedbackSummary, priorDecisions}
    FE->>PT: ClientFitnessSummaryCard — same inputs the Decision Engine itself uses

    PT->>FE: Clicks "Giao kế hoạch" -> AssignPlanModal
    opt PT clicks "Gợi ý bằng AI"
        FE->>FS: POST /coach/clients/:clientId/plan-draft {ptNotes, daysPerWeek, durationWeeks}
        FS->>US: verify ACTIVE relationship (fresh, again)
        FS->>FS: fetchUserProfile(clientId) — experienceLevel, injuries
        FS->>FS: prisma.exercise.findMany (shuffled catalog sample)
        FS->>AI: POST /ai/generate-client-plan-draft
        AI->>AI: filter exercises touching reported injury areas BEFORE the model sees them
        AI->>AI: LLM draft -> Zod validate -> drop any exerciseId outside the allowed catalog
        AI-->>FS: {days[], dataGaps[], warnings[], summaryForPt}
        FS->>FS: persist PlanGenerationAudit (draft only, nothing assigned yet)
        FS-->>FE: draft with resolved exercise names
        FE->>PT: Pre-fills the SAME editable day/exercise form — PT can add/remove/edit before submitting
    end

    PT->>FE: Reviews/edits, clicks "Tạo & giao kế hoạch"
    FE->>FS: POST /coach/clients/:clientId/plans (createManualProgramSchema payload)
    FS->>US: verify ACTIVE relationship (fresh, again)
    FS->>FS: workoutService.createManualProgram(clientId, input) — UNCHANGED from client self-service
    Note over FS: Same call creates the WorkoutProgram AND generates WorkoutSchedule rows —<br/>this single call already covers "assign with start date/cycle length/days/notes."
    FS->>FS: audit CREATE_AND_ASSIGN_PLAN (CoachClientActionAudit)
    FS-->>FE: {program, createdScheduleCount, ...}

    Note over FE: Client sees the assigned plan via their EXISTING GET /workouts/programs/current —<br/>no new client-facing endpoint needed; a PT-created program is indistinguishable in shape from a self-created one.
```

## Why the AI draft can never become an assignment by itself

1. `POST /coach/clients/:clientId/plan-draft` writes only to `PlanGenerationAudit` — it never touches `WorkoutProgram`/`WorkoutSchedule`.
2. The draft response feeds the **same editable form state** (`AssignPlanModal.tsx`'s `days`) the PT would fill in by hand — there is no "one-click accept" path that skips the form.
3. Assignment only happens via the separate, explicit `POST /coach/clients/:clientId/plans` call, which the PT triggers themselves after (optionally) editing.
4. Injury safety is enforced **before** the LLM ever sees the exercise catalog (`client-plan-draft.service.ts:filterExercisesForInjuries`), not just requested via prompt — verified by `client-plan-draft.test.ts`'s "excludes LOWER_BODY (and FULL_BODY) exercises when client reports a knee injury" test, which uses a mocked LLM that *tries* to propose the excluded exercise anyway and confirms it never survives.

## Audit trail

| Table | Records | Written by |
|---|---|---|
| `CoachClientActionAudit` | Every view or write a PT makes against a client (`VIEW_CLIENT_SUMMARY`, `CREATE_AND_ASSIGN_PLAN`) | `coach.service.ts` |
| `PlanGenerationAudit` | Every AI draft request, including the full request snapshot and returned draft, regardless of whether the PT used it | `coach.service.ts:generatePlanDraft` |

Neither table is ever consulted to *authorize* a request — authorization is always the live `user-service` check above; these tables are a record of what happened, not a cache of what's allowed.

## Verified by test

- `coach.service.integration.test.ts` (5 tests) — sees-own-client data, cannot-see-unrelated (403), inactive-relation-rejected (403), plan created for the CLIENT not the PT, audit row created on both view and assign.
- `coach-plan-draft.integration.test.ts` (2 tests) — 403 without an active relationship (and no audit row written), and for an authorized PT the draft is always well-shaped (LLM success or fallback) with a persisted audit row and **nothing assigned**.
- `client-plan-draft.test.ts` (ai-service, 9 tests) — injury exclusion, invented-exerciseId dropping, data-gap transparency forced even when the LLM omits it, deterministic fallback, and a structural check that the output schema has no field for naming a commercial program.
