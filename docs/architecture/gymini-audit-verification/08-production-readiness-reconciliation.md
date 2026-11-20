# 08 — Production risk theo HEAD hiện tại

Ngày 2026-10-19 (Asia/Saigon). START_HEAD: 003545c6da8d524e8c4f6fbe4575444102f1fc50. Nhánh aws-deploy.

Bằng chứng: **CODE AUDIT / STATIC_CODE_VERIFIED** trong phạm vi từng trích đoạn; không có test chạy, REAL BROWSER, REAL HTTP/API, live runtime hay deployment verification. Định nghĩa test được đọc không tương đương UNIT_TEST_VERIFIED hoặc INTEGRATION_TEST_VERIFIED.

G-01..36 là lịch sử ở 81d9f432. Mỗi ID dưới đây giữ severity gốc và có status hiện tại hoặc blocker. **DEPLOYMENT_STATE_NOT_VERIFIED cho mọi ID**; không liên hệ hạ tầng, thử credentials hoặc dùng log khách hàng. Không suy từ source fix ra deployed fix.

| ID / mức lịch sử | Status | Bằng chứng và kết luận |
| --- | --- | --- |
| G-01 / P0 | PARTIALLY_RESOLVED | Source has guards in both server and Lambda when NODE_ENV=production. Literal fallback remains in auth.service.ts. Production runtime/config and negative boot regression not executed; do not report current confirmed exploitable P0. E27: `backend/services/auth-service/src/server.ts:8`; E28: `backend/services/auth-service/src/lambda.ts:9`; E29: `backend/services/auth-service/src/config/lambda-runtime.ts:124` |
| G-02 / P0 | CONFIRMED_OPEN | pino-http still uses an unredacted shared logger. Token-bearing request reaches it; historical live log evidence is not a new live verification. P0 source risk retained. E31: `backend/services/auth-service/src/app.ts:1`; E32: `backend/shared/src/index.ts:1` |
| G-03 / P0 | PARTIALLY_RESOLVED | Current repository has CloudFront HTTPS redirect/default certificate; historical absence-of-TLS-in-all-IaC claim is stale. Served domains, origins and direct access unknown. E34: `infra/cloudformation/frontend-cdn.yaml:35` |
| G-04 / P0 | CONFIRMED_OPEN | Destructive historical migration remains. Potential P0 migration risk, not proof of current loss or that this migration is pending. Snapshot/restore/deployed migration state requires separate evidence. E33: `backend/services/user-service/prisma/migrations/20260528_inbody_unique_per_day/migration.sql:1` |
| G-05 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-06 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-07 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-08 / P1 | PARTIALLY_RESOLVED | Role mutation is guarded by verified ADMIN inside auth-service. Tests cover direct requests, not executed here. listUsers and enable/name handlers also have service checks; deployment/regression closure outstanding. E30: `backend/services/auth-service/src/controllers/auth.controller.ts:336`; E52: `backend/services/auth-service/src/__tests__/role-change-authorization.test.ts:53` |
| G-09 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-10 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-11 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-12 / P1 | PARTIALLY_RESOLVED | AWS Lambda entry and CloudFront deployment configuration exist; deployment target no longer absent in source. Do not infer live infrastructure or production selection. E28: `backend/services/auth-service/src/lambda.ts:9`; E34: `infra/cloudformation/frontend-cdn.yaml:35` |
| G-13 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-14 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-15 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-16 / P1 | PARTIALLY_RESOLVED | Fitness middleware has readGatewayVerifiedUser fast path (auth.middleware.ts:37), plus auth-service client with Lambda support. Original every-service HTTP-roundtrip assertion overbroad; gateway still calls verify. E49: `backend/services/fitness-service/src/clients/user.client.ts:307` |
| G-17 / P1 | PRODUCT_DECISION_REQUIRED | Local parser flags do not govern all model calls by documented scope. Define global model governance contract, deduplicate BDG-01. E07: `backend/services/ai-service/src/llm/orchestrator.service.ts:881`; E36: `backend/services/ai-service/src/conversational-intelligence/index.ts:17` |
| G-18 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-19 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-20 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-21 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-22 / P1 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-23 / P1 | PARTIALLY_RESOLVED | PayOS and ZaloPay signature checks fail closed; webhook service has provider-scoped lookup and idempotent settlement machinery. Full money-flow concurrency/refund reconciliation still unverified. E37: `backend/services/payment-service/src/providers/payos.provider.ts:91`; E38: `backend/services/payment-service/src/providers/zalopay.provider.ts:101`; E47: `backend/services/payment-service/src/services/webhook.service.ts:27` |
| G-24 / P1 | INSUFFICIENT_EVIDENCE | Positive coach samples do not establish all-route isolation. Full backend/frontend ownership matrix and negative revoked/cross-client tests outstanding. E19: `backend/services/fitness-service/src/services/coach.service.ts:38`; E20: `backend/services/fitness-service/src/services/coach.service.ts:314`; E21: `backend/services/fitness-service/src/services/coach.service.ts:464`; E49: `backend/services/fitness-service/src/clients/user.client.ts:307`; E50: `backend/services/user-service/src/repositories/contract.repository.ts:60` |
| G-25 / P2 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-26 / P2 | CONFIRMED_OPEN | Latest pending-draft selection and action claim exist, but no reviewed-content version on confirm. Multiple-draft policy remains a decision; see NEW-GAP-001 for a separate same-row revision race. E09: `backend/services/ai-service/src/services/fitness-agent.service.ts:1066`; E42: `backend/services/ai-service/src/services/revision/target-resolution.ts:23` |
| G-27 / P2 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-28 / P2 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-29 / P2 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-30 / P2 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-31 / P2 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-32 / P2 | CONFIRMED_OPEN | Shared logger still lacks redact policy; same logging root cause as G-02, not a second independent blocker. E32: `backend/shared/src/index.ts:1` |
| G-33 / P2 | PARTIALLY_RESOLVED | Per-user ai-expensive bucket exists on image routes and ai-service has configurable fail-closed provider. Historic no-per-user-quota claim stale in source; deployed provider and budgets unverified. E35: `backend/services/ai-service/src/middleware/rate-limit.middleware.ts:47`; E10: `backend/services/ai-service/src/routes/fitness-agent.routes.ts:69` |
| G-34 / P2 | CONFIRMED_OPEN | AI /health still includes llmUrl and full LLM status; current public deployment exposure is not verified. E66: `backend/services/ai-service/src/app.ts:36` |
| G-35 / P3 | INSUFFICIENT_EVIDENCE | Historical claim retained without closure; current path and deployment applicability not fully verified.  |
| G-36 / P3 | PARTIALLY_RESOLVED | Lambda entrypoints have real AWS infrastructure counterparts, so blanket legacy/dead-code label rejected. Demo flag exposure still unverified. E28: `backend/services/auth-service/src/lambda.ts:9`; E34: `infra/cloudformation/frontend-cdn.yaml:35` |

P0 có cơ chế còn trong source: G-02 (logger) và G-04 (destructive historical migration / release safety cần chứng minh). G-04 không có bằng chứng migration còn pending hay đã gây mất dữ liệu; không được chạy lại chỉ để audit. G-01 đã có guard server+Lambda; G-03 có CloudFront HTTPS source, nên không giữ nguyên mô tả absence cũ. Chưa có P0 nào được xác nhận bằng LIVE_RUNTIME_VERIFIED tại deployment hiện tại.

Định nghĩa test đã thấy: auth role-change authorization và agent finalization race; không chạy chúng trong audit, không đóng gap chỉ vì có test. CI/dependency/outage/migration-replay/backup-restore/payment-concurrency chưa kiểm chứng. Không tuyên bố go-live.


**Bổ sung G-34:** CONFIRMED_OPEN ở source: /health vẫn trả llmUrl và full status (E66), exposure hiện tại chưa xác minh. **G-33:** per-user limiter có thật nhưng chưa bao phủ service-like AI routes; NEW-GAP-003 chỉ rõ endpoint bypass của policy ứng dụng, không phải claim không có limiter nào. E64: `backend/services/ai-service/src/routes/ai.routes.ts:24`; E65: `backend/services/ai-service/src/controllers/client-plan-draft.controller.ts:1`; E66: `backend/services/ai-service/src/app.ts:36`.
