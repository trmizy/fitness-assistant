# AWS DEV — Gym Admin API Gateway Routing Fix (Phase 1)

Date: 2026-09-30
AWS account: `191798898985`, region `ap-southeast-1`
API Gateway: `id1iz7upbl`

## Root cause (source discovery, 1A)

`backend/services/gym-service/src/routes/admin.routes.ts` (170 lines, `router.use(extractUser, requireAuth, requireRoles('ADMIN'))` at top) defines 9 namespaces: `gyms`, `brands`, `gym-memberships`, `partners`, `partner-accounts`, `commission-rate`, `complaints`, `complaint-photos`, `branch-documents`. `backend/services/gym-service/src/app.ts:48` mounts this at `app.use('/admin', adminRoutes)`.

API Gateway's only route for `/admin/*` before this fix was the catch-all `ANY /admin/{proxy+}` (and `ANY /admin`), both targeting integration `tqe5r7h` = Lambda `fitness-assistant-dev-user` — not the gym Lambda. Every gym admin URL landed on user-service's Express app instead, which has no matching route, producing `Cannot GET /admin/...`.

## Existing integration (1B)

Confirmed via `get-integrations`: `045z1ul` = `AWS_PROXY` → `arn:...:function:fitness-assistant-dev-gym`, `PayloadFormatVersion: 2.0`. No duplicate integration created — all new routes target this existing one.

## Route design (1C)

For each of the 9 namespaces, created exactly `ANY /admin/<namespace>` and `ANY /admin/<namespace>/{proxy+}` → `integrations/045z1ul`. These are strictly more specific than the existing `/admin/{proxy+}` catch-all, so HTTP API's route resolution prefers them for these paths while leaving every other `/admin/*` path (e.g. `/admin/sessions/disputed`) on user-service, unchanged.

## Rollback prepared (1D)

Snapshots saved before any change: `docs/deployment/evidence/2026-09-30/{api,routes,integrations,stages}-snapshot-before-phase1.json`, `gym-lambda-policy-before-phase1.json`. Exact rollback commands (one `delete-route` per created route, one `remove-permission` per added Lambda permission) saved at `docs/deployment/evidence/2026-09-30/phase1-rollback-commands.sh` — not executed, kept for reference only. Stage `$default` has `AutoDeploy: true`, so no manual deployment step was needed or performed.

## Applied (1E)

18 routes created (9 namespaces × 2), 18 matching `lambda:InvokeFunction` resource-based permissions added on `fitness-assistant-dev-gym` (this Lambda's existing policy is scoped per-route, not wildcard — confirmed via `get-policy` before touching anything — so every new route needed its own permission statement, following the exact same pattern as the pre-existing `gyms`/`owner`/`collaborations` statements).

## Live read-only test (1F) — VERIFIED_HTTP

| Endpoint | ADMIN | CUSTOMER |
|---|---|---|
| GET /admin/gyms | 200, real data | 403 `Insufficient permissions` |
| GET /admin/brands | 200, real data | — |
| GET /admin/gym-memberships/pending-issues | 200, `{data:[]}` | — |
| GET /admin/partners | **404 `Cannot GET`** | — |
| GET /admin/partners/queue | **404 `Cannot GET`** | — |
| GET /admin/partners/applications | **404 `Cannot GET`** | — |
| GET /admin/commission-rate | **404 `Cannot GET`** | — |
| GET /admin/complaints | **404 `Cannot GET`** | — |

## CloudWatch confirmation (1G)

Checked `/aws/lambda/fitness-assistant-dev-gym` immediately after the 9 test calls: all 9 requests **did** reach the gym Lambda (9 matching `START`/`END`/`REPORT` triples, no errors) — routing itself is 100% correct for all 9 namespaces. The 3 still-failing namespaces (`partners`, `commission-rate`, `complaints`) fail **inside gym-service's own Express app**, not because of misrouting.

## New finding, out of Phase 1's original scope (NOT auto-fixed)

`aws lambda get-function-configuration --function-name fitness-assistant-dev-gym` → `LastModified: 2026-09-20T16:12:19Z`. `git log` on `admin.routes.ts` → last commit `057840fa`, `2026-09-20 23:30:53 +07` (= `16:30:53 UTC`), i.e. **~18 minutes after** the currently-deployed Lambda was built. The deployed gym-service Lambda is missing the `/partners`, `/commission-rate`, `/complaints` admin routes (added in that commit, part of "feat(partner): chủ phòng gym tự đăng ký, admin duyệt hồ sơ") — this is a **stale Lambda deployment**, not a routing bug, and not something Phase 1 was scoped to fix (it would require building and redeploying the gym-service Lambda, a mutation outside this phase's authorization). Documented here for the owner's decision.

## Verdict

```
GYM_ADMIN_ROUTING:
PARTIAL PASS
```

Routing itself: **PASS** for all 9/9 namespaces (confirmed by CloudWatch — every request reaches the correct Lambda). Application-level result: **6/9 namespaces fully working** (`gyms`, `brands`, `gym-memberships`), **3/9 blocked by a separate, pre-existing stale-deployment issue** (`partners`, `commission-rate`, `complaints`) that requires a gym-service Lambda redeploy — not attempted in this phase, no rollback needed since nothing was deployed.

No rollback was necessary — no regression was introduced; the 3 failing namespaces were equally unreachable (via a different symptom, `Cannot GET` from the wrong service instead of from the right one) before this fix.
