# Gymini PT Permission Matrix

Date: 2026-09-10
Every row below is derived from reading the actual authorization check in
the code (cited), not inferred from UI behavior.

## Gate condition (applies to every row below unless noted)

`Contract.status === 'ACTIVE'` for the exact `(ptUserId, clientUserId)`
pair — `contract.repository.ts:64-68` (`findActivePtClientPair`),
re-checked fresh on every request via
`coachService.assertActivePtClientRelationship`
(`coach.service.ts:37-42`). PENDING_REVIEW/PENDING_SIGNATURE/
PENDING_PAYMENT/EXPIRED/CANCELLED/REJECTED/COMPLETED all fail this
check — there is no grandfathering.

## PT capability matrix

| Capability | Endpoint | Semantics | Gate |
|---|---|---|---|
| View client fitness/nutrition summary | `GET /coach/clients/:id/summary` | Read-only | ACTIVE (strict) |
| View client InBody/progress trend | `GET /coach/clients/:id/progress` | Read-only, capped to 8 recent entries | ACTIVE (strict) — **new this phase** |
| View client Roadmap (active + pending draft) | `GET /coach/clients/:id/roadmap` | Read-only | ACTIVE (strict) |
| **Create** a Roadmap DRAFT for the client | `POST /coach/clients/:id/roadmap/draft` | `createdByRole="PT"`, owned by client, **never auto-activated** | ACTIVE (strict) |
| Create + assign a manual workout program | `POST /coach/clients/:id/plans` | Delegates to the SAME `createManualProgram` the client's self-service flow uses — same canonical-Exercise.id validation, same client-equipment-context resolution | ACTIVE (strict) |
| Generate an AI workout draft (review only) | `POST /coach/clients/:id/plan-draft` | Never assigns/persists a program on its own | ACTIVE (strict) |
| Approve a client's pending AI nutrition recommendation | `POST /coach/clients/:id/cycles/:cycleId/nutrition-recommendation/approve` | Applies the AI's own proposed numbers verbatim | ACTIVE (strict) |
| Reject a client's pending AI nutrition recommendation | `.../nutrition-recommendation/reject` | Keeps current goal, records PT note | ACTIVE (strict) |
| Modify (override) a nutrition recommendation | `.../nutrition-recommendation/modify` | Creates a new `NutritionGoal` version with the PT's OWN numbers, `triggeredBy="PT"` — safety-floor + macro-consistency validated server-side | ACTIVE (strict) |
| Trigger a diet-break recommendation | `.../nutrition-recommendation/trigger-diet-break` | Still client-confirmable, never a unilateral overwrite | ACTIVE (strict) |

## What a PT can NEVER do (verified by absence — no route exists)

```text
Activate / advance / rebuild / archive a client's Roadmap
Set/override a CycleAssessment's decision (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD)
Create a NutritionGoal directly bypassing the AI-review/PT-modify flow
Read another PT's client data (relationship is PT+client pair-scoped, not role-wide)
Supply a client's equipment context — createAndAssignPlan resolves it
  from clientUserId server-side, never from the caller
```

## PT RECOMMENDS vs PT ASSIGNS vs CLIENT ACCEPTS

```text
PT RECOMMENDS  — createRoadmapDraftForClient (Roadmap DRAFT, client must
                 activate), generatePlanDraft (workout AI draft, PT must
                 still explicitly submit it), the AI nutrition proposal
                 itself (unchanged, computed by the client's own Decision
                 Engine — the PT only reviews it).
PT ASSIGNS     — createAndAssignPlan (a real WorkoutProgram + WorkoutSchedule,
                 immediately live for the client — no client confirmation
                 step exists for this one action, by current design).
                 modifyNutritionRecommendation (a real new NutritionGoal
                 version, immediately ACTIVE — same immediate-effect
                 semantics as approve/reject).
CLIENT ACCEPTS — activateRoadmap (the client's own call, the ONLY way a
                 PT-created DRAFT becomes ACTIVE).
```

**Note the asymmetry, confirmed by code, not assumed:** workout-plan
assignment and nutrition-recommendation review both take effect
immediately once the PT acts (no client confirmation step) — only the
long-term Roadmap requires the client's own explicit activation. This is
the CURRENT product contract; this phase does not change it (§20/§22 of
the master task — do not add a PT override where none currently exists,
do not silently expand PT powers).

## Contract-lifecycle-only capabilities (user-service, not fitness-service)

| Action | Who | Endpoint |
|---|---|---|
| Request a contract | Client | `POST /contracts/request` |
| Accept/reject a request | PT (`contract.ptUserId` match) | `PATCH /contracts/:id/accept` / `/reject` |
| Pay | Client (`contract.clientUserId` match) | `POST /contracts/:id/pay` |
| Cancel | Either party (ownership-checked) | `PATCH /contracts/:id/cancel` |
| Terminate an ACTIVE contract | Either party | `POST /contracts/:id/terminate` |

## One real, pre-existing inconsistency found (documented, not silently
## expanded or fixed outside its own domain)

`inbodyService.getClientHistory` (user-service,
`inbody.service.ts:55-64`) — a **different**, pre-existing PT-facing
InBody endpoint (`GET /inbody/client/:clientUserId`, unrelated to this
phase's new `GET /coach/clients/:id/progress`) — uses
`contractRepository.findActiveOrCompletedByPair`, a **broader** check
than the strict ACTIVE-only gate every other PT coaching surface uses.
This phase's own new `getClientProgress` deliberately uses the strict
ACTIVE-only gate instead (per this phase's own explicit "reuse the
active relationship gate" instruction), so the two InBody read paths
now have genuinely different authorization semantics. The pre-existing
endpoint was **not modified** — it may be an intentional, separate
design decision for a different call site (e.g. reviewing a just-
completed client's final results), and changing it risks breaking
whatever legitimately depends on that broader check without a full
audit of every caller, which is out of this phase's scope. Logged as a
P2 finding in `docs/GYMINI_PT_COACHING_INTEGRATION_GAPS.md` for a
deliberate future decision, not fixed here.
