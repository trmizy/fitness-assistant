# User Lambda `"Invalid day: Mon"` Controlled Live Verification

Date: 2026-09-30  
AWS account: `191798898985`  
Region: `ap-southeast-1`  
API Gateway: `https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`  
Lambda: `fitness-assistant-dev-user`

No deployment, AWS configuration change, API Gateway/IAM change, migration, SQL, PT submission, approval/rejection, payment, AI call, commit, or push was performed.

## Executive Summary

Fresh authentication and read-only prechecks succeeded. The selected DEV customer account has:

```text
profile.isPT = false
GET /pt-applications/me = HTTP 200 with no PT application object
```

Because no PT application exists, the authorized write test was **not executed**. Source inspection shows:

```text
POST /pt-applications/me/draft
```

would create a new `PTApplication` row via `ptApplicationRepository.upsertDraft()`. No safe application-level endpoint was found to delete/reset that newly created draft. The prompt's critical rollback rule therefore requires skipping the live write.

Final verdict:

```text
LIVE_WRITE_SKIPPED_NO_FULL_ROLLBACK
```

## Deployed Lambda Version

Reported current deployed Lambda:

```text
Function: fitness-assistant-dev-user
State: Active
LastUpdateStatus: Successful
CodeSize: 18,122,013 bytes
CodeSha256: /DLvgx8G8ZyXsI/CHBKKoUFXYOQLBmU//QjGoIRo0KE=
```

The source-level fix remains present:

```text
backend/services/user-service/src/services/availability.service.ts
DAY_NAME_NORMALIZE
"Mon" -> DayOfWeek.MONDAY
```

## Pre-Test State

Authentication:

```text
POST /auth/login
LOGIN_OK=true
```

No password, access token, or refresh token is recorded in this report.

Read-only profile precheck:

```text
GET /profile/me
HTTP 200
isPT=false
```

Read-only PT application precheck:

```text
GET /pt-applications/me
HTTP 200
application state: NO_APPLICATION
availabilityBlocks: none
```

The response indicates no existing `PTApplication` object for this user.

## Safety Gate

Source call path confirmed:

```text
API Gateway
-> User Lambda
-> Express app
-> app.use("/pt-applications", ptApplicationRoutes)
-> router.post("/me/draft", authMiddleware, ptApplicationController.saveDraft)
-> ptApplicationController.saveDraft(req.user!.id, req.body)
-> ptApplicationService.saveDraft(userId, data)
-> if data.availabilityBlocks:
     availabilityService.setAvailability(userId, data.availabilityBlocks)
-> DAY_NAME_NORMALIZE
-> validateAvailabilityBlocks(normalized)
-> availabilityRepository.replaceAll(ptUserId, typed)
-> ptApplicationRepository.upsertDraft(profile.id, data)
```

Source evidence:

- `backend/services/user-service/src/app.ts:105`
- `backend/services/user-service/src/routes/pt_application.routes.ts:63-68`
- `backend/services/user-service/src/controllers/pt_application.controller.ts:35-42`
- `backend/services/user-service/src/services/pt_application.service.ts:183-210`
- `backend/services/user-service/src/services/availability.service.ts:33-56`
- `backend/services/user-service/src/services/availability.service.ts:285-310`
- `backend/services/user-service/src/repositories/availability.repository.ts:13-29`
- `backend/services/user-service/src/repositories/pt_application.repository.ts:134-156`

Write behavior from source:

- Omitted draft fields are preserved on update because `pickFields()` only includes keys with `obj[key] !== undefined`, then update spreads only `baseData`.
- Explicit `null` values would be written for whitelisted fields if sent, so rollback payload must avoid unrelated fields.
- `availabilityBlocks` is handled before draft upsert, then deleted from `data`, so it is not stored in the `PTApplication.availabilityBlocks` JSON field on this flow.
- `availabilityService.setAvailability()` replaces all current `PTAvailability` rows for the user through `deleteMany + create`.
- `ptApplicationRepository.upsertDraft()` creates a new `PTApplication` when absent.
- A draft save does not submit the application, set `isPT`, approve/reject, intentionally notify, invoke payment, or invoke AI.

Safety gate result:

```text
FAILED
```

Blocking reason:

```text
No existing PTApplication; POST /pt-applications/me/draft would create a new PTApplication row, and no safe application-level delete/reset endpoint was proven.
```

Prompt rule applied:

```text
LIVE_WRITE_SKIPPED_NO_FULL_ROLLBACK
```

## Test Request

The controlled write request was prepared but **not executed**:

```http
POST /pt-applications/me/draft
Authorization: Bearer <TOKEN>
Content-Type: application/json
```

Prepared body:

```json
{
  "availabilityBlocks": [
    {
      "dayOfWeek": "Mon",
      "startTime": "09:00",
      "endTime": "10:00"
    }
  ]
}
```

Reason not executed: no full rollback path for newly created draft row.

## Test Response

Not applicable. The live write was skipped before execution.

```text
liveWriteExecuted=false
HTTP result=N/A
```

## Normalization Verification

Live verification was not performed because the safety gate failed.

Source-only verification remains positive:

```text
availability.service.ts:297-300
dayOfWeek: DAY_NAME_NORMALIZE[s.dayOfWeek] ?? s.dayOfWeek
```

With current source:

```text
"Mon" -> DayOfWeek.MONDAY
```

But live runtime classification cannot be upgraded to `FIX_VERIFIED` without an actual reversible write.

## CloudWatch Evidence

No write request was sent, so there is no controlled write timestamp/request ID to inspect.

CloudWatch status:

```text
NOT_RUN_NO_WRITE
```

No unrelated logs were dumped.

## Rollback

Rollback was not needed because no write was performed.

If a future test uses an account with an existing `DRAFT` or `NEEDS_MORE_INFO` application, rollback should use:

```text
POST /pt-applications/me/draft
```

with the exact pre-test `availabilityBlocks` restored. This is only sufficient when a pre-existing application already exists and only availability is modified.

## Post-Rollback State

Not applicable. No write was performed.

The pre-test state remains:

```text
No PT application existed before test.
No PT application was created by this verification.
```

## Side-Effect Check

Observed/executed side effects:

```text
POST /auth/login: issued token/refresh token as normal authentication behavior.
GET /profile/me: read-only.
GET /pt-applications/me: read-only.
POST /pt-applications/me/draft: not executed.
```

No evidence of:

- `isPT=true` change;
- PT application submission;
- approval/rejection;
- payment;
- AI invocation;
- intentional notification;
- draft row creation;
- availability mutation.

## Final Verdict

```text
LIVE_WRITE_SKIPPED_NO_FULL_ROLLBACK
```

Reason:

The authenticated precheck found no existing PT application. The authorized write would create a new `PTApplication` row, and no safe application-level endpoint was proven to delete/reset it exactly. The critical rollback rule therefore blocks the live write.

