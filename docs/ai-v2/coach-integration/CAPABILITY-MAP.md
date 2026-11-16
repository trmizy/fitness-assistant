# CAPABILITY-MAP — chức năng AI hiện có → Agent V2

Audit chọn lọc ngày 2026-11-16 trên `a6b517cd`. Chỉ ghi điều **đã đọc trong code**; ô nào chưa đọc ghi `NOT VERIFIED`. Không suy chức năng từ tên thư mục. Đường dẫn gốc: `frontend/web/src/app` (FE), `backend/services/ai-service/src` (AI), `backend/gateway/src` (GW).

Trạng thái: `IMPLEMENTED` (có code) · `WIRED` (nối vào đường chạy thật) · `TESTED` (có test đã chạy; nêu fixture/thật) · `MOCKED` (chỉ chạy với mock) · `NOT VERIFIED`.

## A. Chức năng AI của người dùng (V1)

| # | Chức năng | Frontend | Backend | Dữ liệu / API | Agent V2 | Trạng thái tích hợp | Bằng chứng |
|---|---|---|---|---|---|---|---|
| 1 | Chat AI Coach (RAG + tool-calling) | `pages/client/AICoachPage.tsx`, `stores/pendingAiTasks.ts:544`, `services/api.ts:3727` `coachService.chat` | AI `routes/ai.routes.ts` `POST /ask` → `controllers/ai.controller.ts` → `services/rag.service.ts` → `llm/orchestrator.service.ts` | `/profile/me`, `/inbody`, `/workouts`, `/nutrition*`, `/workouts/programs/current`, `/nutrition/plans/current`, `/nutrition/goals` (`llm/profile_extractor.ts:~350`); Qdrant (`llm/retriever.ts`) | Cả 4 (một phần: chỉ READ) | V1: IMPLEMENTED, WIRED. V2: **chưa nối vào UI** | CODE AUDIT |
| 2 | Streaming SSE (`status`/`token`/`done`) | `api.ts:3772` `chatStream`, `config/serverUrl.ts:138` | GW `proxy.routes.ts:~1227`; AI `POST /ask/stream` → `aiController.askStream` | payload `done`: `structuredBlocks`, `evidenceUsed`, `safetyNotes`, `sessionId` | **Không có** (V2 chỉ JSON) | V1 only | CODE AUDIT |
| 3 | Lịch sử phiên và tin nhắn | `AICoachPage.tsx:162,170`; `api.ts:3751-3768` | AI `routes/session.routes.ts` (`GET /`, `GET /:id/messages`, `PATCH`, `DELETE`) | Prisma `ChatSession`, `Conversation` | **V2 không ghi lịch sử** | V1 only; **khoảng trống tích hợp** | CODE AUDIT (không có `conversationRepository` trong `agent-v2*`) |
| 4 | Thử lại an toàn (`clientRequestId`) | `api.ts:3731`, `pendingAiTasks.ts:549-589` | AI `services/request-identity.ts` | `clientRequestId` | V2 body chặt **không nhận** | V1 only; khoảng trống | CODE AUDIT |
| 5 | Bộ nhớ dài hạn | **chưa thấy gọi từ FE** (grep `/ai/memories` không có kết quả) | AI `routes/memory.routes.ts`, `llm/memory_policy.ts`, `memory_extraction.ts` | `UserMemory` | Không | V1 backend IMPLEMENTED; UI NOT VERIFIED | CODE AUDIT |
| 6 | Workflow ghi có xác nhận (đề xuất, chọn, xác nhận hành động) | `services/fitnessAgent.ts:72-76`, `components/agent/FitnessAgentBlocks` | AI `routes/fitness-agent.routes.ts` → `services/fitness-agent.service.ts` (3673 dòng) | `FitnessRecommendation`, `FitnessAgentAction`, `AgentWorkflowSession` | **Không** (V2 READ-only, `allowDraft:false`) | V1 only — **giữ nguyên** | CODE AUDIT |
| 7 | Chat ảnh / ảnh mục tiêu (vision) | `AICoachPage.tsx:273,799`; `fitnessAgent.ts:83,91` | AI `POST /ai/agent/goal-image`, `/image-chat`; `services/gemini-vision.client.ts` (API Gemini bên ngoài) | ảnh base64 | Không | V1 only — giữ nguyên | CODE AUDIT |
| 8 | Giải thích InBody | `api.ts:630` `POST /ai/inbody/interpret` | AI `controllers` `inbodyExplanationController` | `entryId` → LLM | Progress đọc số đo (`progress.get_body_measurements`) **không** gọi diễn giải | Trùng một phần; **không tái dùng** | CODE AUDIT |
| 9 | Ước lượng macro bữa ăn | `components/nutrition/DayMacroEstimate.tsx:30` | AI `POST /ai/nutrition/day-estimate` | văn bản tự do → ước lượng | Nutrition **không** có tool tương đương | V1 only | CODE AUDIT |
| 10 | Sinh giáo án (`/generate-workout`) | **không thấy** gọi từ FE (grep) | AI `POST /ai/generate-workout` → `aiController.generateWorkout` | — | Training có `training.validate_plan_equipment` (READ); `training.propose_exercise_swap` là DRAFT nhưng bị chính sách chặn | NOT VERIFIED nơi dùng | CODE AUDIT |
| 11 | Phản hồi người dùng (`/feedback`) | **không thấy** gọi từ FE (grep) | AI `POST /feedback` | — | Không | NOT VERIFIED nơi dùng | CODE AUDIT |

## B. AI dịch vụ-với-dịch vụ và quản trị (ngoài phạm vi UI AI Coach)
| # | Chức năng | Nơi | Ghi chú |
|---|---|---|---|
| 12 | Phân tích/đánh giá chu kỳ, phản hồi, nháp kế hoạch, nháp roadmap, giải thích tiến triển | AI `routes/ai.routes.ts:97-136` (`requireTrustedService`) | Chỉ service gọi; V2 Progress **đọc** trạng thái chu kỳ qua `fitnessAgentTools`, không gọi các tạo-nháp này |
| 13 | Kế hoạch dinh dưỡng, marketplace, personalized service | AI `plan.routes`, `marketplace.routes`, `personalized-service.routes` | Khu vực sản phẩm khác; V2 không liên quan |
| 14 | Pipeline tri thức/RAG và quản trị | Prisma `Knowledge*`; `routes/admin.routes.ts` (`/admin/ai`) | V2 Training đọc bằng chứng qua `fitnessAgentTools.getScientificEvidence` (`services/fitness-agent-tools.ts:607`) |

## C. Thành phần V2 và an toàn dùng chung
| # | Thành phần | File | Dùng lại của V1? | Trạng thái |
|---|---|---|---|---|
| 15 | Safety Guard | `llm/safety_guard.ts`, `llm/induced_vomiting_events.ts`; V2 `agent-v2/answer-guards.ts#checkInputSafety` | **Có** (V2 gọi `safetyGuard` của V1) | IMPLEMENTED, TESTED (suite `llm`, `agent-v2-*`); **P1 mở** (CURRENT-STATE) |
| 16 | Minor safety | V1 `llm/minor_safety_policy.ts`; V2 `agent-v2/minor-gate.ts`, `minor-restriction.ts` | Một phần | TESTED (fixture, in-memory); store bền vững **chưa có** |
| 17 | Supervisor, Router, 4 Agent | `agent-v2/supervisor.ts`, `routing-planner.ts`, `hybrid-router.ts`, `agent-catalog.ts` | Tool READ = client V1 | IMPLEMENTED, TESTED (fixture); demo `a6b517cd` 45/45 |
| 18 | Đọc hồ sơ và dữ liệu miền | `agent-v2/profile-reader.ts`; `agent-v2-integration/domain-read-transport.ts`; `services/fitness-agent-tools.ts` | **Có** | **MOCKED/NOT VERIFIED** với dịch vụ thật (chưa chạy với user/fitness-service thật) |
| 19 | Mô hình | `agent-v2/bedrock-converse-adapter.ts` (`BEDROCK_CHAT_MODEL`, mặc định `apac.amazon.nova-pro-v1:0`) | Khác V1 (`llm.service.ts:48` mặc định `ollama`) | **MOCKED**; gọi Bedrock thật chưa được phép (D-006) |
| 20 | Phiên V2 | `agent-v2/session-context.ts`, `agent-v2-integration/{redis,dynamodb}-session-store.ts` | Không | TESTED fixture; hạ tầng thật NOT VERIFIED |
| 21 | Web demo | nhánh `agent/m8d-web-demo` `dd07a5f6` | Không (chỉ DEV) | REAL BROWSER (desktop); **không** có ở nhánh khác |

## D. Khoảng trống kết nối AI Coach (tóm tắt)
1. Chưa có đường UI → `/ai/v2/ask` (FE không gọi `/ai/v2/*`).
2. V2 không ghi lịch sử → phiên V2 không hiện trong `/ai/sessions`.
3. V2 không có SSE → trải nghiệm streaming khác V1.
4. V2 không nhận `clientRequestId` → retry không idempotent.
5. V2 chưa trả `structuredBlocks`/`evidenceUsed`/`safetyNotes` như payload `done` của V1.
6. Chưa kiểm chứng đọc dữ liệu thật qua user-service/fitness-service.
7. Store hạn chế vị thành niên chưa bền vững; production V2 bị từ chối 503.
8. Gateway: limiter chi phí `/ai/ask` không phủ `/ai/v2/ask`; phơi bày AWS NOT VERIFIED.

## E. Cập nhật M9.4-T2 (2026-11-16, `e6532e95`) — trạng thái bridge theo capability
Chỉ phần **thay đổi** sau M9.4-T2; các bảng A–D ở trên giữ nguyên (chúng là audit `a6b517cd`; một số khoảng trống ở mục D đã được M9.2/M9.3 xử lý ở nơi khác).
| Capability | Trước M9.4-T2 | Sau M9.4-T2 | Bằng chứng |
|---|---|---|---|
| Nhật ký bữa ăn / lượng ăn đã ghi ("Hôm qua tôi ăn gì?") — `MEAL_HISTORY` | bridge cho đi V2 (V2 Nutrition không có tool nhật ký) | **V1** trước khi V2 chạy (`V2_CAPABILITY_UNSUPPORTED`). V2 vẫn **không** có tool này | TEST FIXTURE (`coach-capability-preflight.test.ts`, eval N04) |
| Lịch sử tập theo kỳ ("Tuần này tôi tập mấy buổi?") — `WORKOUT_HISTORY_PERIOD` | bridge cho đi V2 (router→Training không có tool lịch sử) | **V1** trước khi V2 chạy. V2 vẫn **không** có tool này | TEST FIXTURE (eval T06) |
| Số cân nặng cá nhân trong câu trả lời do model sinh | không có guard (S06: "99 kg" lọt ở cả V1 và V2) | guard dùng chung: chỉ giữ số có nguồn của đúng người dùng; chỉ phủ **cân nặng**; đường V1 tất định không qua guard | TEST FIXTURE (unit + S06, S09–S13) |
