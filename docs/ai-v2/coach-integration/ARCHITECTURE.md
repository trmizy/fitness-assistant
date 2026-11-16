# ARCHITECTURE — Tích hợp Multi-Agent V2 vào AI Coach của GYMINI

Nguồn chuẩn về kiến trúc. Viết 2026-11-16 từ audit chọn lọc trên commit **`a6b517cd`** (worktree `ai-v2-coach-integration-plan`, branch `planning/ai-coach-v2-integration`). Mọi đường dẫn tính từ gốc repo. Khi tài liệu mâu thuẫn với code, **code là nguồn có thẩm quyền**: dừng và ghi mâu thuẫn vào `CURRENT-STATE.md`.

Nhãn bằng chứng: `CODE AUDIT` (đã đọc code), `TEST EXECUTED`, `TEST FIXTURE`, `REAL BROWSER`, `NOT VERIFIED`. Tài liệu này chỉ chứa `CODE AUDIT` do tác giả đọc, trừ khi ghi khác.

## 1. Mục tiêu sản phẩm
Multi-Agent V2 **không phải chatbot độc lập**. Nó là kiến trúc điều phối nhằm **nâng cấp AI Coach hiện có**, tái dùng tối đa AI, dữ liệu, RAG và API đã có. V1 phải tiếp tục hoạt động; V2 là một capability tích hợp có kiểm soát, không tự động thay V1. (Nguồn: chỉ đạo của chủ dự án trong brief M9, 2026-11-16; xem DECISIONS D-003.)

## 2. Kiến trúc đang có (CODE AUDIT, `a6b517cd`)

### 2.1 AI Coach V1 — đường đang phục vụ người dùng
```
AICoachPage.tsx → pendingAiTasks.ts (sendQuestion) → coachService.chatStream (SSE) | coachService.chat (JSON)
  → gateway  POST /ai/ask/stream (route SSE riêng) | /ai (proxy chung, authMiddleware)
  → ai-service  routes/ai.routes.ts → aiController.ask|askStream → ragService.rag → llmOrchestrator
```
- Frontend: `frontend/web/src/app/pages/client/AICoachPage.tsx` (không tự gọi ask; gọi `sendQuestion` của `stores/pendingAiTasks.ts:544`). `coachService.chat` gửi `POST /ai/ask {question, clientRequestId, sessionId?}` timeout 30s (`services/api.ts:3727`); `coachService.chatStream` dùng `fetch` tới `aiStreamUrl()` và đọc sự kiện `status`/`token`/`done`/`error` (`api.ts:3772`, `config/serverUrl.ts:138`). Payload `done` mang `structuredBlocks`, `evidenceUsed`, `safetyNotes`, `sessionId`, `fallbackReason` (`api.ts:72`).
- Gateway: `backend/gateway/src/routes/proxy.routes.ts` — limiter chi phí `router.use("/ai/ask", aiAskRateLimiter)` (dòng ~1220), route SSE `POST /ai/ask/stream` (~1227), proxy chung `router.use("/ai", authMiddleware, …)` (~1308) chuyển `x-user-id`, `x-user-email`, `x-user-role`, `Authorization` và `x-internal-token`.
- ai-service V1: `backend/services/ai-service/src/llm/orchestrator.service.ts` (1646 dòng) ghép: speech-act/intent router, `safetyGuard`, `profileExtractor` (đọc `/profile/me`, `/inbody`, `/workouts`, `/nutrition`, `/nutrition/daily-history`, `/workouts/programs/current`, `/nutrition/plans/current`, `/nutrition/goals`; `llm/profile_extractor.ts:~350`), `retriever` (Qdrant), tool-calling (`llm/tools.ts`: `search_exercise_library`, `get_user_fitness_data`), bộ nhớ, `fitnessAgent` (workflow ghi dữ liệu có xác nhận), nhiều guard đầu ra.
- Lưu trữ V1 trong ai-service (`prisma/schema.prisma`): `Conversation`, `ChatSession`, `UserMemory`, `FitnessRecommendation`, `FitnessAgentAction`, `AgentWorkflowSession`, `Knowledge*`. `ragService.rag` ghi `chatSession`/`conversation` (`services/rag.service.ts:150,181`).

### 2.2 Multi-Agent V2 — đường mới, chưa nối vào UI
```
POST /ai/v2/ask → (cờ AI_AGENT_V2) → requireAuth → requireVerifiedEndUser → askRateLimiter → strict body
  → getMultiAgentRuntime().ask → runSupervisorTurn → Router → [Gate 1 minor] → ≤ 2 Agent tuần tự → composer → guards → JSON
```
- Route: `backend/services/ai-service/src/routes/ai-v2.routes.ts`, gắn trước `/ai` (`app.ts:72`). Body chặt `{question, sessionId?}`; response `{success, data:{status, answer, agents, turnId, traceId}}` — **JSON, không SSE**. `agents` là các agent **đã chạy**.
- Composition root: `agent-v2-integration/multi-agent-runtime.ts` (nạp bằng dynamic `import()` sau khi kiểm cờ). Header của chính file ghi: file này và `routes/ai-v2.routes.ts` là các file phía V1 được phép chạm `src/agent-v2` (ngoại lệ governance do chủ dự án duyệt 2026-11-13). `agent-v2-isolation.test.ts:26` ép bằng một allowlist cố định gồm route, composition root và hai adapter session store (Redis, DynamoDB); mọi file V1 khác chạm `agent-v2` làm test fail.
- Supervisor (`agent-v2/supervisor.ts`, 941 dòng): cờ → danh tính xác thực → input → `checkInputSafety` (dùng lại `safetyGuard` của V1) → Router → kiểm hợp lệ so với capability → **Gate 1 (vị thành niên)** trước mọi uỷ quyền → delegation tuần tự với ngân sách còn lại → typed facts (không chuyển văn bản agent khác) → đối soát bằng chứng → composer tất định có provenance → guard cuối → một `SupervisorTrace`. `maxAgentsPerTurn: 2` (`supervisor.ts:50`); phần dư ghi `…:max_agents` và được thông báo cho người dùng.
- Router: `agent-v2/routing-planner.ts` (tất định `intent-v1.3`, mặc định) và `agent-v2/hybrid-router.ts` (model-assisted, `selective`/`always`, chỉ bằng cấu hình server, production cần phê duyệt riêng; `flag.ts resolveRoutingConfig`).
- Bốn Agent (`agent-v2/agent-catalog.ts`): Training (11 tool READ được phép; `training.propose_exercise_swap` là contract DRAFT nhưng **bị chính sách chặn**), Nutrition (3), Recovery (2), Progress (4). Chính sách **READ-only** (`allowDraft: false`, `training-tools.ts:275-284`).
- Dữ liệu miền mặc định = **chính các client READ của V1**: `fitnessAgentTools` (`services/fitness-agent-tools.ts`) và `agent-v2-integration/domain-read-transport.ts` (`/workouts`, `/stats/training-window`, `/stats/body-goal-state` qua `requestService`); hồ sơ qua `agent-v2/profile-reader.ts` (`GET /profile/me`).
- Mô hình mặc định: `agent-v2/bedrock-converse-adapter.ts`, model `process.env.BEDROCK_CHAT_MODEL ?? "apac.amazon.nova-pro-v1:0"`. **Không có nhà cung cấp ollama** như V1 (`llm.service.ts:48`).
- Phiên và an toàn xuyên phiên: `session-context.ts` (+ Redis/DynamoDB store); hạn chế vị thành niên theo `userId` ở `minor-restriction.ts` (chỉ có bản in-memory; production bị từ chối 503).
- **V2 không ghi lịch sử chat**: không có tham chiếu `conversationRepository` trong `agent-v2*`. **V2 không có tool ghi** và không có SSE.

### 2.3 Hai nhánh đã kiểm chứng, **chưa tích hợp**
| Nhánh | Commit | Vai trò | Ghi chú |
|---|---|---|---|
| `feature/ai-v2-agent` | `af66b3a3` | baseline phát triển V2 | không có các sửa M8 |
| snapshot tích hợp M8-B | `a6b517cd` | demo offline đã kiểm chứng | nền của tài liệu này |
| snapshot tích hợp M8-C | `1eaa29a0` | sửa quarantine, Unicode (một phần), evaluator | Codex BLOCKED (P1 còn mở) |
| web demo | `dd07a5f6` (`agent/m8d-web-demo`) | trang `/internal/ai-v2-demo` + launcher mock | chỉ DEV, **không có** ở nhánh khác |
Không suy từ web demo rằng chức năng đã có ở repo chính.

## 3. Kiến trúc mục tiêu
```
Người dùng → AI Coach UI hiện có → API/Gateway hiện có → [Coach integration layer] → Supervisor V2 → Router
  → Training | Nutrition | Recovery | Progress → dịch vụ Gymini hiện có + dữ liệu được phép → Answer safety → AI Coach UI
```
**Coach integration layer** là phần *duy nhất* cần thiết kế mới. Nhiệm vụ (phương án B đã được chủ dự án chọn — DECISIONS D-008; các chi tiết còn lại vẫn PROPOSED):
1. Quyết định lượt nào đi V2 (cờ/tập người dùng), **mặc định V1**; V2 lỗi/404/503 thì **quay về V1** mà không đổi danh tính.
2. Chuyển kết quả V2 (JSON) thành hợp đồng mà UI đã hiểu (`answer`, `sessionId`, `safetyNotes`), và giữ UI hiện có: loading, retry, lịch sử, xác thực, phiên.
3. Ghi lượt trò chuyện vào lịch sử V1 (`ChatSession`/`Conversation`) để `/ai/sessions` thấy lượt V2.
4. Không nhân đôi logic: **không** sao chép orchestrator, safety hay agent vào lớp này.
5. Giữ nguyên các chức năng V1 mà V2 chưa có (xem CAPABILITY-MAP): workflow ghi có xác nhận, ảnh, ước lượng bữa ăn, InBody interpret, bộ nhớ, streaming.

### Phương án adapter (đánh giá, chưa chọn)
| | A. Chuyển ở frontend (`coachService` gọi `/ai/v2/ask`) | B. Cầu nối phía server trong ai-service | C. Gateway định tuyến |
|---|---|---|---|
| Thay đổi | frontend + store | 1 file mới phía V1 + route | gateway |
| Lịch sử V1 | **mất** (V2 không ghi) trừ khi thêm API | giữ được | khó |
| SSE | UI phải bỏ stream cho V2 | có thể phát một `token` + `done` | khó |
| Ràng buộc kiến trúc | không chạm V1 | **cần ngoại lệ** pin isolation/RI-2 (file V1 mới được chạm `agent-v2`) | trộn trách nhiệm |
| Rủi ro | lệch hành vi, mất history | cần phê duyệt chủ dự án | dùng cờ ở nhiều lớp |
**Đã chốt: B** (D-008, 2026-11-16). Lý do: giữ lịch sử, xác thực và idempotency ở một nơi, frontend chỉ cần khác biệt nhỏ.

**Đã cài ở M9.2-T1 (`services/coach-v2-bridge.ts`, commit `76ae18e1`):** lõi quyết định + điều phối thuần, tắt mặc định, *chưa gắn vào route nào*. (1) `decideCoachRoute` chọn capability trước khi chạm runtime: chỉ câu hỏi read-only thường qua JSON, từ người dùng cuối đã xác minh và nằm trong allowlist (mặc định từ chối tất cả), có `clientRequestId` hợp lệ (không có/hỏng → V1 xử lý kiểu cũ), hội thoại chưa thuộc V1. (2) `runCoachBridge` chạy V2 tối đa một lần qua `V2Executor` được tiêm; kết quả ánh xạ answered/partial/blocked/unavailable. (3) **SAFETY INVARIANT (D-009):** sau khi V2 đã xử lý, quyết định của V2 là cuối cùng — không về V1; chỉ về V1 khi V2 chứng minh chưa bắt đầu (`DISABLED`, `V2NotStartedError`). (4) Không bịa `structuredBlocks`/`evidenceUsed`/`safetyNotes`/lịch sử. **M9.2-T2 (`services/coach-v2-continuity.ts`, fixture only):** lớp liên tục bọc bridge, chỉ gồm *ports tiêm được* (`CoachIdempotencyStore`, `CoachHistoryPort`), không DB/Redis/mạng. Luồng một lượt: pre-decision không I/O (cờ tắt/không phải end user/capability V1-only/không có key hợp lệ → V1, không chạm store) → kiểm tra session thuộc user + affinity (chỉ đọc) → **claim nguyên tử** theo (userId, key) + fingerprint hành động → chạy V2 đúng một lần (key **không** vào input strict V2) → ghi kết quả → ghi lịch sử (chỉ câu trả lời hoàn tất) → trả. Trùng đồng thời/xung đột/in-doubt/store hỏng đều **không** chạy lại V2 và **không** về V1. Hợp đồng chi tiết I1–I5, H1–H6 ở đầu file đó và ở IMPLEMENTATION-PLAN "Kết quả T2". **M9.2-T3 (route wiring, offline):** `POST /ai/ask` → [requireAuth → askRateLimiter → validateBody → bindRequestIdentity] → `coachBridgeAsk` → (cờ tắt/không đủ điều kiện: `next()` → controller V1 như cũ) | (đủ điều kiện: `runCoachTurn` → claim → `createCoachV2Executor` → `getMultiAgentRuntime().ask` (Supervisor/Router/Agents thật) → history → response `engine:"multi-agent-v2"` + `data.v2`). Ports idempotency/history **không có triển khai production** nên production luôn về V1. `/ai/ask/stream` không đi qua bridge. **M9.3-T1 (frontend DEV-only):** `AICoachPage` → `pendingAiTasks` → `coachService.chat` (JSON) → … → `data.engine:"multi-agent-v2"` + `data.v2` → `parseCoachV2`/`describeCoachV2` (pure) → `CoachV2Badge`. HTTP 409 tách theo mã backend (`OPERATION_IN_PROGRESS` retry cùng id; `IDEMPOTENCY_KEY_CONFLICT` không retry). Công tắc DEV chỉ đổi *cách gửi* (JSON thay SSE) và khoá ô nhập; quyền V2 do server quyết. **M9.3-T2:** đường V1 thật (controller→rag→orchestrator) đã được chạy với dependency ngoài giả và so sánh giống hệt baseline `a6b517cd`; lịch sử khôi phục badge *rút gọn* (engine + trace) vì schema hiện chỉ lưu hai thứ đó. **M9.4-T1:** đánh giá V1 vs V2 offline (40 ca tổng hợp, mock) — kết quả chức năng ở `M9-QUALITY-EVALUATION.md`; chất lượng câu trả lời CHƯA đánh giá. Chưa có: production exposure, SSE V2, V1 trên hạ tầng thật, thiết bị mobile thật, store/history thật, metadata V2 đầy đủ trong lịch sử (D-P18).

**Đã cài ở M9.4-T2 (`e6532e95`, CODE AUDIT + TEST FIXTURE):** (1) *Preflight capability* trong `decideCoachRoute`: thứ tự cổng là cờ → người dùng cuối đã xác minh → allowlist → **preflight** (`MEAL_HISTORY`, `WORKOUT_HISTORY_PERIOD` → V1, lý do `V2_CAPABILITY_UNSUPPORTED`) → capability V1-only. Quyết định xảy ra trước khi V2 chạy nên không có "thử V2 rồi fallback"; executor, kho idempotency và lịch sử không bị chạm. Là danh sách chặn các capability đã biết là thiếu, không phải bằng chứng V2 hỗ trợ phần còn lại. (2) *Guard số cân nặng cá nhân* (`llm/personal_weight_guard.ts`, thuần) nối **một lần** trong orchestrator V1 và **một lần** tại điểm guard duy nhất của engine V2 (`bounded-agent.ts`); chỉ gỡ câu không có nguồn của đúng người dùng. Router/Supervisor không đổi; không thêm tool. Chi tiết và giới hạn: `M9-QUALITY-EVALUATION.md` §10.

### Hợp đồng grounding cân nặng cá nhân — M9.4-T3 (`c8c05185`, TEST FIXTURE + BACKEND INTEGRATION offline)
Một guard thuần (`llm/personal_weight_guard.ts`) dùng chung cho V1 (orchestrator, đường do model sinh) và V2 (`bounded-agent.ts`). Chỉ **gỡ câu** (và thêm thông báo cố định không có số); không viết lại, không điền giá trị mặc định.
| Nguồn của con số cân nặng trong câu trả lời | Quy tắc | Bằng chứng |
|---|---|---|
| 1. Hồ sơ/InBody của **chính người dùng** (đọc bằng token của họ) | Nguồn hợp lệ. Nêu như "hiện tại" chỉ khi khớp số đo mới nhất (hoặc cân nặng hồ sơ khi không có số đo). Số đo > 90 ngày **không vô giá trị**: nêu kèm ngày/đóng khung quá khứ thì giữ; nêu như "hiện tại" không mốc thì gỡ, với thông báo *đúng sự thật* ("đã cũ", không nói "chưa có số") | WC-1/3, EG-4 |
| 2. Do **người dùng tự nói** trong phiên | Chỉ nghĩa là "không do model bịa", **không phải đã xác minh**. Chỉ tính số nêu *như cân nặng* (đơn vị kg/ký hoặc ngay sau "nặng"); số không đơn vị (tuổi, kcal, số rep) **không còn** được tính (T2 tính mọi số — đã sửa). Guard không gắn nhãn "theo bạn cho biết" (D-P24) | WC-2, EG-5 |
| 3. Số đo lịch sử | Giữ khi đóng khung quá khứ; số lần đo trước nêu như hiện tại thì gỡ | WC-1/3, EG-3 |
| 4. Số của người khác | Không bao giờ là nguồn: bằng chứng tạo theo từng lượt từ dữ liệu của người dùng đã xác thực; không trạng thái dùng chung | WG-8, S13 |
| 5. Giả định / ví dụ / giáo dục chung / mục tiêu / dự báo | Không phải khẳng định về người dùng → không đụng tới | WC-1, EG-3, S11/S12 |
| 6. Model tự tạo | Gỡ; không giá trị mặc định; thông báo không chứa số | WG-1, S06 |
| 7. Mâu thuẫn giữa nguồn | **Không phân xử**: mỗi số đã ghi nhận được chấp nhận là "hiện tại"; số thứ ba bị gỡ (giới hạn đã biết) | WC-1 |

**Không làm hỏng nghĩa câu trả lời (V1 và V2, cùng dữ liệu tổng hợp — EG-1..EG-5, WC-4..WC-7):** cảnh báo y tế ở câu riêng giữ nguyên văn; cảnh báo chung câu với con số thì mệnh đề cảnh báo được giữ độc lập, hoặc (khi không tách được) thêm một dòng giới thiệu bác sĩ cố định, không số; câu phủ định bị gỡ chứ không đảo thành khẳng định; câu hệ quả "Vì vậy/Do đó…" treo trên tiền đề đã gỡ bị gỡ cùng (không để lại mảnh câu); ví dụ giáo dục và số InBody lịch sử không bị đụng; chạy guard hai lần không đổi kết quả. Bốn reproducer (WC-2/3/4/6) **fail trên guard T2** và pass ở T3 (đã chạy đối chiếu).

**Đường V1 không qua model (Task B, CODE AUDIT + BACKEND INTEGRATION):** giải thích cách tính calo, toán dinh dưỡng, lịch tập hôm nay, tra mục tiêu đã lưu, phản hồi sớm meta/third-party/ước lượng macro ngày (đã đọc code; **đường `fitness_agent` là dịch vụ riêng, T3 chưa truy vết**). Các đường đã truy vết được dựng bằng *mẫu* từ dữ liệu của chính người dùng (cùng token, QE-6), không có model → không thể bịa số. Mọi câu của 4 loại câu hỏi tất định × 3 thế giới (đủ/cũ/không có số đo) **không chứa khẳng định cân nặng cá nhân** (EG-6); số duy nhất là đầu vào công thức "Mifflin-St Jeor từ 72.4 kg" lấy từ bản ghi; khi **không có** số đo, câu hỏi cách tính **rơi về model** (có guard) thay vì bịa. **Quyết định: không thêm guard ở ranh giới phản hồi chung** — không có reproducer; guard sẽ là no-op trên mẫu tất định (đã chứng minh), nhưng nếu về sau mẫu tất định thêm câu "cân nặng hiện tại…" từ bản ghi cũ thì guard có thể gỡ nhầm câu đúng. EG-6 sẽ fail nếu một đường tất định bắt đầu phát khẳng định cân nặng (cảnh báo sớm). Hai lần kiểm không méo kết quả: guard idempotent (WC-7, EG-7).

**Đã chứng minh (offline, model là kịch bản):** các hàng 1–7 ở trên trên fixture tổng hợp, cả V1 và V2; không cross-user; đường tất định V1 không có khẳng định cân nặng; tsc sạch; agent-v2 1413/1418 (chỉ RI-2/HR-27 fail, như trước); `llm` 1715 (0 fail); focused V1/V2/bridge 115/115.
**Chỉ là giả định / chưa chứng minh:** hành vi với model thật (cách diễn đạt ngoài các mẫu của guard có thể lọt — danh sách mẫu là lưới an toàn, không phải chứng minh vắng mặt); dữ liệu thật/bẩn; đọc dữ liệu thật qua user/fitness-service; ngưỡng 90 ngày hợp lý với người dùng thật; V1 `ENABLE_TOOL_CALLING=true`; chất lượng câu trả lời.
**Hạn chế của guard:** chỉ phủ **cân nặng (kg)**, không phủ mỡ cơ thể/calo/số buổi; số kg người dùng nói về *tạ* hoặc việc khác vẫn được tính nếu có đơn vị kg (trùng ngẫu nhiên); `lần đo` được coi là mốc thời gian nên "Lần đo gần nhất của bạn là 72.4 kg" (đo cũ) được giữ dù không có ngày; không phân xử mâu thuẫn; không gắn nhãn user-reported; không bắt khẳng định dạng "bạn không nặng X kg" (không bị viết lại).
**P1 an toàn còn mở (không đổi, không thuộc phạm vi T3):** (1) ký tự vô hình là dấu phân cách duy nhất giữa hai từ làm lọt lời khai tự gây nôn (+ off-topic/injection họ hàng); (2) chưa có store hạn chế vị thành niên bền vững (production V2 bị từ chối 503); (3) sửa quarantine/ZWSP M8-C chỉ có ở snapshot `1eaa29a0`.
**Điều kiện trước khi đưa thay đổi V1 (guard + preflight + bridge) lên AWS:** D-001 — không deploy trước khi Multi-Agent hoàn tất và được duyệt, V1 fix giữ cho **một** lần phát hành đồng bộ; changeset V1 tách riêng và qua quy trình RC; đánh giá độc lập (Codex) không còn P0/P1 trên guard; chủ dự án duyệt D-P22/D-P23/D-P24 và quyết RI-2/HR-27 (D-011); kiểm chứng trên DEV bằng tài khoản test (REAL HTTP, DB test cô lập) — **chưa từng làm**; kế hoạch rollback + `dev-preflight.yml` read-only; đóng P1 ở trên; ANSWER QUALITY chưa đánh giá (cần model thật được duyệt, D-P21). Thay đổi này **chưa** đủ điều kiện triển khai.

## 4. Quyền truy cập và dòng dữ liệu
- Danh tính: chỉ từ `req.context` do `requireAuth` (`middleware/auth.middleware.ts`); `callerKind` = `user` hoặc `gateway_user` (V2 yêu cầu bearer). **Không** tin `userId` trong body.
- Agent chỉ đọc dữ liệu **của chính người dùng**, qua client READ của V1 mang `Authorization` của họ. Gate 1 đọc hồ sơ một lần dùng chung.
- Mỗi người dùng cô lập: key hạn chế theo `userId`; `sessionId` là gợi ý của client, **không** là biên tin cậy.
- Cache/state frontend phải gắn danh tính (`sessionGuard` trong `api.ts`) — giữ nguyên khi thêm đường V2.

## 5. Invariants kiến trúc (không được vi phạm)
1. AI Coach là giao diện thống nhất. 2. V1 luôn hoạt động; V2 chỉ thêm. 3. V2 không tự thay V1. 4. Tối đa **2** domain agent mỗi lượt; ý định bị hoãn phải được nói rõ. 5. Không bỏ qua Safety Guard, Minor Gate, Supervisor hay Answer Guard. 6. Agent V2 chỉ **đọc**, bằng quyền hợp lệ. 7. Không dùng fixture/mock để tuyên bố dữ liệu production đã được tích hợp. 8. Không đổi nguyên tắc bảo mật để UI chạy được. 9. Không giả định V2 có SSE. 10. Các P1 hiện hữu là release blocker (CURRENT-STATE §Known). 11. Không deploy khi chưa hoàn tất và được duyệt toàn bộ Multi-Agent (DECISIONS D-001). 12. Mỗi thay đổi phía V1 chạm `agent-v2` phải qua phê duyệt pin (isolation allowlist, RI-2, HR-27).

## 6. Kiến trúc bị từ chối
- **Chatbot V2 độc lập** làm mục tiêu production (chủ dự án, D-003).
- **Thay V1 hoàn toàn / chuyển tự động** (D-003).
- **M7R** `4b155c3e` ("tích hợp cục bộ M7R") — bị chủ dự án từ chối (D-002). Branch `agent/m7r-integration` tồn tại; **không** dùng làm nền.
- (Khuyến nghị của AI, chưa phải quyết định) Không để lớp tích hợp tự quyết định an toàn hay tự gọi tool; không chuyển luồng ghi dữ liệu sang V2 trước khi có phê duyệt riêng.

## 7. Giới hạn đã biết ảnh hưởng thiết kế
- V2 body chặt không nhận `clientRequestId`; V1 frontend gửi nó để thử lại an toàn (`api.ts:3731`). Retry V2 sẽ chạy lại lượt (chỉ đọc, nhưng khai tuổi vị thành niên ghi hạn chế).
- Gateway: limiter chi phí `/ai/ask` là khớp tiền tố nên **không phủ** `/ai/v2/ask`; V2 chỉ có `askRateLimiter` của chính route. (CODE AUDIT; chưa chạy.)
- Phơi bày trên AWS (API Gateway → Lambda): **NOT VERIFIED**; template trong `infra/cloudformation/` không chứa chuỗi `/ai/` để đối chiếu.
