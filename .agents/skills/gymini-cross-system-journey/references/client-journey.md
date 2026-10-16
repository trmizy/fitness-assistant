# Client journey — real routes per step

Verify against current code before relying on this. All routes below
are mounted through `backend/gateway/src/routes/proxy.routes.ts` unless
noted "internal-only" (service-secret gated, not client-reachable).

```
Onboarding          PUT /profile/me {hasCompletedOnboarding:true}   [user-service]
                    -> triggers real nutrition-onboarding-bootstrap (creates
                       the first real NutritionGoal) -- a FALSE->TRUE
                       transition only; re-submitting true is a no-op.

InBody              POST/GET /inbody, GET /inbody/latest             [user-service]
                    GET /inbody/client/:clientUserId  (PT, broader
                       "active or completed" gate -- see the permission
                       matrix's documented inconsistency)

Roadmap             POST /fitness-roadmaps (DRAFT), POST /fitness-roadmaps/:id/activate,
                    GET /fitness-roadmaps/current, GET /fitness-roadmaps/draft/current,
                    GET /fitness-roadmaps/:id                        [fitness-service]
                    POST /coach/clients/:clientId/roadmap/draft (PT, DRAFT only)
                    GET  /coach/clients/:clientId/roadmap (PT, read-only)

TrainingCycle       (no direct client route -- reached via roadmap projection)
                    GET /training-cycles/:id/report

Workout generation  POST /plans/workout/generate (202, {planId, jobId}, async)
                    GET /plans/job/:jobId | GET /plans/:planId (poll)
                    POST /plans/:planId/save-to-workout-log (attach an
                       existing validated plan into a new date range --
                       the real mechanism behind "reuse the prior program")
                    POST /coach/clients/:clientId/plans (PT manual create+assign)
                    POST /coach/clients/:clientId/plan-draft (PT AI draft only)

Execution           POST /workout-schedules/:id/start,
                    POST /workout-schedules/:id/complete-exercise, etc.

Nutrition           PUT/GET /nutrition/goals
                    POST /plans/nutrition/generate (async AI meal plan)
                    POST /plans/:planId/save-to-nutrition (creates the real
                       NutritionProgram, stamps sourceGoalId HERE, not at
                       generation time)
                    GET /nutrition/active-state (consistency status)

CycleAssessment     (system-computed on real completeCycle -> real async
                    worker; no direct client-triggered "run assessment now"
                    route -- completeCycle is the trigger)
                    POST /coach/clients/:clientId/cycles/:cycleId/
                       nutrition-recommendation/{approve,reject,modify}
                    POST .../nutrition-recommendation/trigger-diet-break

Roadmap advance     POST /fitness-roadmaps/:id/advance
                    POST /fitness-roadmaps/:id/rebuild (preview/apply)

PT progress read    GET /coach/clients/:clientId/summary  (overview: cycle,
                       adherence, nutrition goal+program+consistency,
                       latestAssessment)
                    GET /coach/clients/:clientId/progress (InBody, lazy)

Contract lifecycle  POST /contracts/request, PATCH /contracts/:id/accept,
                    POST /contracts/:id/pay, POST /contracts/:id/terminate,
                    GET /contracts/pt | /contracts/client
                    (activation itself: PATCH .../activate-after-payment is
                    internal-only, driven by a real payment webhook)
```
