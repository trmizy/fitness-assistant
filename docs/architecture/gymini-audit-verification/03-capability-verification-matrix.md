# 03 — Ma trận capability

Ngày 2026-10-19 (Asia/Saigon). START_HEAD: 003545c6da8d524e8c4f6fbe4575444102f1fc50. Nhánh aws-deploy.

Bằng chứng: **CODE AUDIT / STATIC_CODE_VERIFIED** trong phạm vi từng trích đoạn; không có test chạy, REAL BROWSER, REAL HTTP/API, live runtime hay deployment verification. Định nghĩa test được đọc không tương đương UNIT_TEST_VERIFIED hoặc INTEGRATION_TEST_VERIFIED.

101/101 record đã được kiểm tra ID/domain/status; 38/101 có truy vết nguồn có giới hạn. **Không có 101/101 xác minh đầy đủ**. Các trường frontend/model/auth/test còn null hoặc NOT_VERIFIED trong JSON là công việc chưa hoàn thành, không được suy ra từ tên route.

| ID | Claimed status | Kết luận độc lập | Nguồn / giới hạn |
| --- | --- | --- | --- |
| CAP-01-01 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-01-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-01-03 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E25: `frontend/web/src/app/context/AppContext.tsx:185`; E26: `frontend/mobile/src/context/AppContext.tsx:130` |
| CAP-01-04 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-01-05 | IMPLEMENTED_AND_VERIFIED | INCORRECT_CLASSIFICATION | E30: `backend/services/auth-service/src/controllers/auth.controller.ts:336`; E52: `backend/services/auth-service/src/__tests__/role-change-authorization.test.ts:53` |
| CAP-01-06 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-01-07 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | INCORRECT_CLASSIFICATION | E30: `backend/services/auth-service/src/controllers/auth.controller.ts:336`; E52: `backend/services/auth-service/src/__tests__/role-change-authorization.test.ts:53` |
| CAP-01-08 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-01-09 | UNKNOWN_INSUFFICIENT_EVIDENCE | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-01-10 | PARTIALLY_IMPLEMENTED | INCORRECT_CLASSIFICATION | E24: `frontend/web/src/app/context/AppContext.tsx:82`; E25: `frontend/web/src/app/context/AppContext.tsx:185`; E26: `frontend/mobile/src/context/AppContext.tsx:130` |
| CAP-02-01 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-02-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-02-03 | UNKNOWN_INSUFFICIENT_EVIDENCE | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-02-04 | PARTIALLY_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-01 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-02 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-03 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-04 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E43: `backend/services/fitness-service/src/services/workout.service.ts:1663` |
| CAP-03-05 | PARTIALLY_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E01: `backend/services/ai-service/src/agent-workflow/workflows/create-workout-plan.workflow.ts:39`; E02: `backend/services/ai-service/src/services/fitness-agent.service.ts:299`; E03: `backend/services/ai-service/src/services/fitness-agent.service.ts:1748`; E07: `backend/services/ai-service/src/llm/orchestrator.service.ts:881`; E57: `backend/services/ai-service/src/services/client-plan-draft.service.ts:10`; E58: `backend/services/ai-service/src/services/client-plan-draft.service.ts:114`; E78: `backend/services/ai-service/src/workers/ai.worker.ts:439` |
| CAP-03-06 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-07 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-08 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-09 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-10 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-11 | BROKEN_OR_INCONSISTENT | CONFIRMED_WITH_QUALIFICATIONS | E05: `backend/services/ai-service/src/services/fitness-agent.service.ts:1870`; E06: `backend/services/ai-service/src/services/fitness-agent.service.ts:1976`; E48: `backend/services/ai-service/src/services/revision/workout-guards.ts:30` |
| CAP-03-12 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-03-13 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E55: `backend/services/ai-service/src/schemas/cycle-assessment.schemas.ts:90`; E56: `backend/services/ai-service/src/services/cycle-assessment.service.ts:153`; E73: `backend/services/ai-service/src/services/cycle-analysis.service.ts:215` |
| CAP-04-01 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-04-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-04-03 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-04-04 | PARTIALLY_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-04-05 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E39: `backend/services/fitness-service/src/services/nutrition-agent.service.ts:10`; E40: `backend/services/fitness-service/src/services/nutrition.service.ts:382` |
| CAP-04-06 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-04-07 | PARTIALLY_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E17: `backend/services/ai-service/src/services/fitness-agent.service.ts:2370` |
| CAP-04-08 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E17: `backend/services/ai-service/src/services/fitness-agent.service.ts:2370`; E18: `backend/services/ai-service/src/services/revision/nutrition-revision.ts:32` |
| CAP-05-01 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-05-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-05-03 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-05-04 | BROKEN_OR_INCONSISTENT | CONFIRMED_WITH_QUALIFICATIONS | E33: `backend/services/user-service/prisma/migrations/20260528_inbody_unique_per_day/migration.sql:1` |
| CAP-05-05 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E21: `backend/services/fitness-service/src/services/coach.service.ts:464` |
| CAP-05-06 | PARTIALLY_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-06-01 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E15: `backend/services/fitness-service/src/services/fitness-roadmap.service.ts:412`; E16: `backend/services/fitness-service/src/services/fitness-roadmap.service.ts:500` |
| CAP-06-02 | PARTIALLY_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E12: `backend/services/ai-service/src/services/fitness-agent.service.ts:1565`; E13: `backend/services/ai-service/src/services/fitness-agent.service.ts:1635`; E14: `backend/services/ai-service/src/services/roadmap-draft.service.ts:88`; E16: `backend/services/fitness-service/src/services/fitness-roadmap.service.ts:500` |
| CAP-06-03 | PARTIALLY_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-06-04 | PARTIALLY_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-06-05 | PARTIALLY_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E21: `backend/services/fitness-service/src/services/coach.service.ts:464` |
| CAP-07-01 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-07-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-07-03 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-07-04 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-07-05 | UNKNOWN_INSUFFICIENT_EVIDENCE | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-07-06 | MOCK_OR_SEED_ONLY | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-08-01 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E19: `backend/services/fitness-service/src/services/coach.service.ts:38`; E22: `backend/services/user-service/src/services/contract.service.ts:797`; E23: `backend/services/fitness-service/src/routes/coach.routes.ts:1` |
| CAP-08-02 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E20: `backend/services/fitness-service/src/services/coach.service.ts:314`; E43: `backend/services/fitness-service/src/services/workout.service.ts:1663` |
| CAP-08-03 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E21: `backend/services/fitness-service/src/services/coach.service.ts:464`; E23: `backend/services/fitness-service/src/routes/coach.routes.ts:1` |
| CAP-08-04 | PLANNED_NOT_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E19: `backend/services/fitness-service/src/services/coach.service.ts:38`; E22: `backend/services/user-service/src/services/contract.service.ts:797`; E23: `backend/services/fitness-service/src/routes/coach.routes.ts:1` |
| CAP-08-05 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E62: `backend/services/chat-service/src/services/chat.policy.ts:1`; E63: `backend/services/chat-service/src/services/chat.service.ts:38` |
| CAP-08-06 | PARTIALLY_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-08-07 | PARTIALLY_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E20: `backend/services/fitness-service/src/services/coach.service.ts:314`; E23: `backend/services/fitness-service/src/routes/coach.routes.ts:1` |
| CAP-09-01 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E07: `backend/services/ai-service/src/llm/orchestrator.service.ts:881`; E08: `backend/services/ai-service/src/llm/orchestrator.service.ts:1054` |
| CAP-09-02 | PARTIALLY_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E01: `backend/services/ai-service/src/agent-workflow/workflows/create-workout-plan.workflow.ts:39`; E17: `backend/services/ai-service/src/services/fitness-agent.service.ts:2370`; E41: `backend/services/ai-service/src/agent-workflow/workflow-state.repository.ts:1` |
| CAP-09-03 | FEATURE_FLAGGED_OFF | CONFIRMED_WITH_QUALIFICATIONS | E07: `backend/services/ai-service/src/llm/orchestrator.service.ts:881`; E36: `backend/services/ai-service/src/conversational-intelligence/index.ts:17`; E59: `backend/services/ai-service/src/llm/tools.ts:177`; E60: `backend/services/ai-service/src/llm/tools.ts:251` |
| CAP-09-04 | FEATURE_FLAGGED_OFF | CONFIRMED_WITH_QUALIFICATIONS | E36: `backend/services/ai-service/src/conversational-intelligence/index.ts:17` |
| CAP-09-05 | FEATURE_FLAGGED_OFF | CONFIRMED_WITH_QUALIFICATIONS | E36: `backend/services/ai-service/src/conversational-intelligence/index.ts:17` |
| CAP-09-06 | PARTIALLY_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E75: `backend/services/ai-service/src/llm/retriever.ts:7`; E76: `backend/services/ai-service/src/llm/retriever.ts:387` |
| CAP-09-07 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E10: `backend/services/ai-service/src/routes/fitness-agent.routes.ts:69`; E79: `backend/services/ai-service/src/routes/fitness-agent.routes.ts:84`; E81: `backend/services/ai-service/src/services/fitness-goal-vision.service.ts:1` |
| CAP-09-08 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E70: `backend/services/ai-service/src/services/plan-moderation-analysis.service.ts:48`; E71: `backend/services/ai-service/src/services/plan-improvement.service.ts:39` |
| CAP-09-09 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-10-01 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-10-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-10-03 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-10-04 | PLANNED_NOT_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-10-05 | PLANNED_NOT_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-11-01 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-11-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-11-03 | PARTIALLY_IMPLEMENTED | INCORRECT_CLASSIFICATION | E37: `backend/services/payment-service/src/providers/payos.provider.ts:91`; E38: `backend/services/payment-service/src/providers/zalopay.provider.ts:101`; E47: `backend/services/payment-service/src/services/webhook.service.ts:27` |
| CAP-11-04 | PLANNED_NOT_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E46: `backend/services/payment-service/src/services/payment.service.ts:20` |
| CAP-11-05 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-11-06 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-11-07 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-11-08 | IMPLEMENTED_NOT_RUNTIME_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-12-01 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-12-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-12-03 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-12-04 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-12-05 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-12-06 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-12-07 | PLANNED_NOT_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-13-01 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-13-02 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-13-03 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-13-04 | FEATURE_FLAGGED_OFF | CONFIRMED_WITH_QUALIFICATIONS | E68: `backend/services/ai-service/src/llm/query-classifiers/classifier-runtime.ts:1`; E69: `backend/services/ai-service/src/llm/query-classifiers/classifier-runtime.ts:81` |
| CAP-13-05 | BROKEN_OR_INCONSISTENT | CONFIRMED_WITH_QUALIFICATIONS | E01: `backend/services/ai-service/src/agent-workflow/workflows/create-workout-plan.workflow.ts:39`; E02: `backend/services/ai-service/src/services/fitness-agent.service.ts:299`; E04: `backend/services/ai-service/src/services/fitness-agent.service.ts:1823`; E17: `backend/services/ai-service/src/services/fitness-agent.service.ts:2370` |
| CAP-14-01 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E30: `backend/services/auth-service/src/controllers/auth.controller.ts:336`; E52: `backend/services/auth-service/src/__tests__/role-change-authorization.test.ts:53` |
| CAP-14-02 | IMPLEMENTED_AND_VERIFIED | CONFIRMED_WITH_QUALIFICATIONS | E80: `backend/services/user-service/src/routes/pt_application.routes.ts:106` |
| CAP-14-03 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-14-04 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-14-05 | PLANNED_NOT_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E45: `frontend/web/src/app/components/layout/Sidebar.tsx:132` |
| CAP-14-06 | PLANNED_NOT_IMPLEMENTED | CONFIRMED_WITH_QUALIFICATIONS | E45: `frontend/web/src/app/components/layout/Sidebar.tsx:132` |
| CAP-14-07 | IMPLEMENTED_AND_VERIFIED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |
| CAP-14-08 | PARTIALLY_IMPLEMENTED | NOT_VERIFIED | Inventory-only; NOT_VERIFIED |

Các sửa phân loại quan trọng: CAP-01-10 đã có cache clearing cả web/mobile; CAP-01-05/07 không còn đúng caveat gateway-only; CAP-11-03 có verifier PayOS/ZaloPay thật, không thể coi chưa implementation chỉ vì chưa runtime-test. CAP-05-04 là migration risk, không phải chức năng InBody “hỏng” hiện tại. CAP-03-11 chỉ chứng minh nhánh chat MOVE hỏng, không phải mọi UI reschedule. CAP-13-05 không nên gộp sự trưởng thành nutrition và workout.

Danh sách đầy đủ record chưa source-traced nằm tại verified-capabilities.json.unverified_ids. Giữ nguyên claimed status và tách evidence quality; chưa đưa ra phân bổ implementation-status mới cho toàn repo.


**Coverage cập nhật thay số trước:** 38/101 có scoped trace. Các ID bổ sung: CAP-03-05, CAP-03-13, CAP-08-05, CAP-09-03, CAP-09-06, CAP-09-07, CAP-09-08, CAP-13-04, CAP-14-02. JSON là snapshot cuối cùng; bảng trước là phase đầu. Các trace mới không xác nhận toàn chức năng.

- CAP-03-05: E57: `backend/services/ai-service/src/services/client-plan-draft.service.ts:10`; E58: `backend/services/ai-service/src/services/client-plan-draft.service.ts:114`; E78: `backend/services/ai-service/src/workers/ai.worker.ts:439`
- CAP-03-13: E55: `backend/services/ai-service/src/schemas/cycle-assessment.schemas.ts:90`; E56: `backend/services/ai-service/src/services/cycle-assessment.service.ts:153`; E73: `backend/services/ai-service/src/services/cycle-analysis.service.ts:215`
- CAP-08-05: E62: `backend/services/chat-service/src/services/chat.policy.ts:1`; E63: `backend/services/chat-service/src/services/chat.service.ts:38`
- CAP-09-03: E59: `backend/services/ai-service/src/llm/tools.ts:177`; E60: `backend/services/ai-service/src/llm/tools.ts:251`
- CAP-09-06: E75: `backend/services/ai-service/src/llm/retriever.ts:7`; E76: `backend/services/ai-service/src/llm/retriever.ts:387`
- CAP-09-07: E79: `backend/services/ai-service/src/routes/fitness-agent.routes.ts:84`; E81: `backend/services/ai-service/src/services/fitness-goal-vision.service.ts:1`
- CAP-09-08: E70: `backend/services/ai-service/src/services/plan-moderation-analysis.service.ts:48`; E71: `backend/services/ai-service/src/services/plan-improvement.service.ts:39`
- CAP-13-04: E68: `backend/services/ai-service/src/llm/query-classifiers/classifier-runtime.ts:1`; E69: `backend/services/ai-service/src/llm/query-classifiers/classifier-runtime.ts:81`
- CAP-14-02: E80: `backend/services/user-service/src/routes/pt_application.routes.ts:106`

AI-capability records AICAP-01..16 có riêng trong verified-capabilities.json.ai_capabilities; tất cả vẫn source-only.
