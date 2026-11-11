# AWS DEV — AI Final E2E Closure Attempt

Date: 2026-09-30. Continues directly from `AWS_DEV_AI_LIVE_FAILURE_DIAGNOSIS_2026-09-30.md` — no root cause re-investigated here.

## 1. Frontend deploy

Deployed the already-built `frontend/web/dist` (built in the prior session, confirmed to already contain both UX fixes) to `fitness-assistant-frontend-dev-191798898985` using the existing approved process (`docs/aws-deployment/AWS_DEPLOYMENT_RUNBOOK.md`):

```
aws s3 sync frontend/web/dist s3://fitness-assistant-frontend-dev-191798898985 --delete --cache-control max-age=31536000,public --exclude index.html
aws s3 cp frontend/web/dist/index.html s3://fitness-assistant-frontend-dev-191798898985/index.html --cache-control no-cache --content-type text/html
```

(The runbook's own example additionally overrides `VITE_API_URL` before building — not used here, since the `dist/` deployed was already built against the correct, current `.env.production` value, `https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`, confirmed identical to the API Gateway used throughout this whole engagement. No rebuild was performed, only deployment of the existing verified artifact.)

Sync replaced the full hashed `assets/` set (old hashes deleted, new ones uploaded — expected Vite content-hash behavior) and re-uploaded `index.html` with `no-cache`.

## 2. Verification — deployed bundle actually contains the fixes

Not inferred from the local build — fetched the **live** files directly from the S3 website endpoint after deploy:

- `GET /index.html` → references `assets/index-BVq0K1ir.js` (matches the locally-verified hash).
- Downloaded that live file and `assets/PlansPage-CtcZ4kk0.js` directly from `http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-1.amazonaws.com`:
  - `"Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."` — present in both `index-BVq0K1ir.js` and `PlansPage-CtcZ4kk0.js`.
  - `"Dịch vụ AI tạm thời không khả dụng. Vui lòng thử lại sau ít phút."` — present in `PlansPage-CtcZ4kk0.js`.

Both improved messages are confirmed live, not just locally built.

## 3. No AI job created yet

Per instruction, no plan-generation or chat request was submitted before checking Bedrock authorization.

## 4. Bedrock model availability — re-checked, unchanged

```
aws bedrock get-foundation-model-availability --model-id amazon.nova-pro-v1:0 --region ap-southeast-1
  authorizationStatus: NOT_AUTHORIZED   (agreementAvailability: AVAILABLE, entitlementAvailability: AVAILABLE, regionAvailability: AVAILABLE)

aws bedrock get-foundation-model-availability --model-id cohere.embed-multilingual-v3 --region ap-southeast-1
  authorizationStatus: NOT_AUTHORIZED   (agreementAvailability: NOT_AVAILABLE, entitlementAvailability: AVAILABLE, regionAvailability: AVAILABLE)
```

Both models used by this project (Nova Pro via the `apac.amazon.nova-pro-v1:0` inference profile for chat/plan generation, Cohere Embed Multilingual v3 for evidence retrieval) remain **`NOT_AUTHORIZED`** — unchanged since the previous diagnosis. This is the same account-level Bedrock Model Access entitlement gap identified before; no code or infrastructure change on this side can affect it.

## 5-7. Controlled end-to-end AI test

**Not performed.** Per explicit instruction (task 8), a real test requires provider access to be `AUTHORIZED`; it is not. No job was created, no SQS message sent, no worker invoked, no Bedrock call attempted.

## 8. Stop condition reached

```
BEDROCK_ACCESS_STILL_BLOCKED
```

## 9. DLQ message

Left untouched, as instructed. (Read-only state, unchanged from the prior report: 1 message in `fitness-assistant-dev-ai-tasks-dlq` from the earlier real job that failed for the same reason.)

## 10. Lambda concurrency quota

Not modified, as instructed. The account's `UnreservedConcurrentExecutions: 10` limit remains unchanged — still recommended (not actioned) in the prior report.

## What the owner needs to do before a real end-to-end AI test is possible

1. AWS Console → Amazon Bedrock → Model access → request/enable access for **Amazon Nova Pro** and **Cohere Embed Multilingual v3** in `ap-southeast-1` (and confirm the `apac.amazon.nova-pro-v1:0` inference profile's other routed regions if cross-region enablement turns out to be required — the profile currently reports `AVAILABLE` for region/entitlement, only `authorizationStatus` blocks it).
2. Once granted, re-run `aws bedrock get-foundation-model-availability` for both model IDs above and confirm `authorizationStatus: AUTHORIZED` before requesting another attempt at this closure task.

## Final verdict

```
AI_END_TO_END:
BEDROCK_ACCESS_STILL_BLOCKED
```
