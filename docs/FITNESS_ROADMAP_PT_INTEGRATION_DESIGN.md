# FitnessRoadmap PT-Assisted Integration Design

Date: 2026-09-09
Scope: `backend/services/fitness-service` (backend only — see §5 for the
frontend gap, reported honestly rather than fabricated)
Status: Design + implementation (Phase E, STEP 12) — backend done and
verified against real PostgreSQL; frontend PT entry point NOT built this
pass (documented gap, §5).

## 1. What Already Exists (audited before writing this)

- `coach.service.ts`/`coach.routes.ts` (mounted at `/coach`) already
  implement the exact PT-client authorization model this feature needs:
  `assertActivePtClientRelationship` re-checks a real, ACTIVE
  `Contract` (user-service) fresh on every call via
  `isActivePtClientRelationship` — never cached, never trusted from a prior
  request. This pass adds no new PT infrastructure; it reuses this
  verbatim, the same way `generatePlanDraft`/`createAndAssignPlan` already
  do for workout plans.
- `coachDeps` is the established test-stub seam (`coachDeps.
  isActivePtClientRelationship = async () => true/false`) already used by
  every other test in `coach.service.integration.test.ts` — reused as-is.
- `RoadmapCreatorRole` already has a `"PT"` value (unused until this pass).

## 2. What This Pass Adds

```text
services/coach.service.ts:
  getClientRoadmap(ptUserId, clientUserId)
  createRoadmapDraftForClient(ptUserId, clientUserId, input)
controllers/coach.controller.ts:
  getClientRoadmap, createRoadmapDraft
routes/coach.routes.ts:
  GET  /coach/clients/:clientId/roadmap
  POST /coach/clients/:clientId/roadmap/draft
```

Zero schema/migration change. Zero new PT authorization logic — both new
methods call `this.assertActivePtClientRelationship(ptUserId, clientUserId)`
first, exactly like every other method in this file.

## 3. Scope Boundary (deliberately narrow)

A PT may, for an ACTIVE contract client only:

```text
view the client's current (ACTIVE) roadmap        — getClientRoadmap
create a new DRAFT roadmap for the client          — createRoadmapDraftForClient
```

A PT may **never**, through this feature:

```text
activate a roadmap or phase
advance a roadmap
apply/preview a rebuild
archive a roadmap
```

Those four lifecycle transitions remain reachable only through
`fitness-roadmap.controller.ts`'s own routes, which — unchanged by this
pass — use `req.user!.id` exclusively as both the identity **and** the
roadmap owner. There is no route, PT or otherwise, that lets a caller
activate/advance/rebuild/archive a roadmap belonging to a different
`userId`. This mirrors exactly how a PT-generated *workout* plan draft
(`generatePlanDraft`) still requires the client's own explicit
`POST /coach/clients/:clientId/plans` assignment before anything real
happens — here, the client's own `activateRoadmap` call is the equivalent
required explicit step. `createRoadmapDraftForClient` stamps
`createdByRole = "PT"` (server-side, never caller-supplied) so the
resulting `FitnessRoadmap.userId`/`createdByUserId` are still the
**client's**, never the PT's — verified directly by a test.

## 4. IDOR / Authorization

```text
No active PT-client relationship -> both new methods reject 403          (tested)
createRoadmapDraftForClient never creates a roadmap owned by the PT       (tested)
A freshly-created PT draft is not yet ACTIVE -> getClientRoadmap returns
  null (a normal "no active roadmap yet" state), not an error            (tested)
Only the client's own activateRoadmap call makes it ACTIVE; getClientRoadmap
  then reflects that                                                     (tested)
```

## 5. Known Gap — Frontend PT Entry Point (reported honestly, not built)

Audited before deciding this: `AssignPlanModal.tsx` (frontend) already
wires the equivalent existing workout-plan-draft flow
(`coachService.generatePlanDraft`/`createAndAssignPlan`) into a PT-facing
UI; `PTClientDetail.tsx` does not yet surface it either — this whole
PT-facing "AI draft for a client" UI surface was already thin before this
pass, not something this pass regressed.

Given the master task's own explicit "Definition of Done" lists are
client-experience-focused (discover/create/review/activate a roadmap) and
frame PT collaboration as "if architecture allows it cleanly" rather than a
hard requirement, this pass delivers the backend capability + real
authorization + real tests (§2–4) and does **not** add a new PT-facing
modal/page for it, to avoid shipping a rushed, unreviewed UI surface
under this same time-boxed pass. This is an honest scope decision, not a
silent omission — recorded here and in the final verification report as
`NOT IMPLEMENTED (frontend)`, with the backend capability fully `VERIFIED`.

**Recommended next step**: mirror `AssignPlanModal.tsx`'s existing pattern
— add a small "Tạo lộ trình cho khách hàng" entry point in
`PTClientDetail.tsx` calling `POST /coach/clients/:clientId/roadmap/draft`,
then let the client review/activate it from their own
`RoadmapJourneyPage.tsx` (already built, Phase C) exactly as they would an
AI draft.

## 6. Test Coverage (real PostgreSQL, existing `coachDeps` stub convention)

```text
getClientRoadmap / createRoadmapDraftForClient reject 403 with no active
  PT-client relationship                                          — PASS
createRoadmapDraftForClient creates a real DRAFT roadmap, createdByRole=PT,
  owned by the client (never the PT)                               — PASS
getClientRoadmap returns null before activation, the roadmap after the
  client's own activateRoadmap call                                — PASS
2/2 new tests PASS (part of coach.service.integration.test.ts's 7/7 total,
  0 fail, 0 skipped — up from the pre-existing 5/5)
```
