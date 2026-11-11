# AWS DEV — Fitness Roadmap API Gateway Routing Fix (Phase 2)

Date: 2026-09-30
AWS account: `191798898985`, region `ap-southeast-1`
API Gateway: `id1iz7upbl`

## Source verification (2A) — confirmed unchanged since the prior E2E audit

`backend/services/fitness-service/src/app.ts:50`: `app.use("/fitness-roadmaps", fitnessRoadmapRoutes)`. `fitness-roadmap.routes.ts` defines 15 routes (create/diagnosis/projection/ai-draft/current/draft-current/current-forecast/phases/activate/advance/rebuild/archive/getById), all behind `authMiddleware`. Fully implemented, zero missing controller code.

## Existing integration (2B)

`wv4c1bs` = `AWS_PROXY` → `arn:...:function:fitness-assistant-dev-fitness`, confirmed via `get-integrations`. This is the same integration already serving `/exercises`, `/workouts`, `/training-cycles`, etc.

## Planned routes (2C, not yet applied — see blocker below)

```
ANY /fitness-roadmaps          -> integrations/wv4c1bs
ANY /fitness-roadmaps/{proxy+} -> integrations/wv4c1bs
```
Plus matching `lambda:InvokeFunction` resource-based permissions on `fitness-assistant-dev-fitness` for source ARNs `.../fitness-roadmaps` and `.../fitness-roadmaps/{proxy+}` (this Lambda's policy is per-route-scoped, same pattern confirmed for gym-service in Phase 1).

## BLOCKED — not executed

The `create-route`/`add-permission` command for this exact change was **denied by this session's own auto-mode safety classifier** ("Modify Shared Resources"), before any AWS API call was made. Per this environment's own safety rules, that denial must not be worked around through another tool, a different quoting/encoding, or a later retry — it was not attempted again.

This is a **tooling-side block, not an AWS-side failure or a discovered technical obstacle**. The change itself is low-risk and mechanically identical to the 9 gym-service route pairs that Phase 1 applied successfully moments earlier (same account, same API, same "add a more-specific route so it stops falling into the wrong catch-all" pattern) — Phase 1 simply happened not to trigger the classifier.

## Verdict

```
FITNESS_ROADMAP_ROUTING:
BLOCKED (not attempted after denial — awaiting explicit owner action)
```

No AWS route or permission was created or modified for this phase. `GET /fitness-roadmaps/current` still returns API-Gateway-level 404 (`{"message":"Not Found"}`) exactly as before — confirmed unchanged via a live re-test after Phase 1's other changes (see the regression matrix in the master report).

## What the owner needs to do

Either:
1. Run the two `create-route` + two `add-permission` commands below directly (identical shape to the ones already applied for gym-service in Phase 1, just against `wv4c1bs` instead of `045z1ul`), or
2. Grant/adjust the permission mode that caused the classifier denial and ask for this phase to be retried.

```
aws apigatewayv2 create-route --api-id id1iz7upbl --region ap-southeast-1 \
  --route-key "ANY /fitness-roadmaps" --target "integrations/wv4c1bs"
aws apigatewayv2 create-route --api-id id1iz7upbl --region ap-southeast-1 \
  --route-key "ANY /fitness-roadmaps/{proxy+}" --target "integrations/wv4c1bs"
aws lambda add-permission --function-name fitness-assistant-dev-fitness --region ap-southeast-1 \
  --statement-id "fitness-roadmaps-exact" --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:ap-southeast-1:191798898985:id1iz7upbl/*/*/fitness-roadmaps"
aws lambda add-permission --function-name fitness-assistant-dev-fitness --region ap-southeast-1 \
  --statement-id "fitness-roadmaps-proxy" --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:ap-southeast-1:191798898985:id1iz7upbl/*/*/fitness-roadmaps/{proxy+}"
```

Verification after applying (CUSTOMER token): `GET /fitness-roadmaps/current` should return either 200 or an application-level empty-state (e.g. `{"error":"..."}` from fitness-service), never the generic API-Gateway `{"message":"Not Found"}`. Confirm via CloudWatch that the request reaches `/aws/lambda/fitness-assistant-dev-fitness`.
