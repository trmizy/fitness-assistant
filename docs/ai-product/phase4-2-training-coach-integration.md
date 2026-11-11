# Phase 4.2 — Personalized training coach: CoachStateV0.training → user-facing answers

Nhãn bằng chứng: `TEST FIXTURE` · `BACKEND INTEGRATION` (orchestrator thật + Postgres `*_test` cô lập, axios/profile stub) · `REAL HTTP/API` (ai-service reader → fitness-service thật → auth-service thật, cục bộ, DB test) · `CODE AUDIT`. Không có `REAL BROWSER`. Không dùng model thật (`MODEL_SMOKE_DEFERRED_DUE_TO_GPU_CONTENTION`: không chạy Qwen/HF khi phiên khác có thể đang train).

## 1. Starting architecture
Phase 4.1: `GET /stats/training-window` → `trainingReader` → need `TRAINING_COACH_STATE` → `getCoachStateV0` (chưa vào hội thoại). Luồng hội thoại: `fitnessAgent.tryTurn` → (nếu `CONVERSATIONAL_INTELLIGENCE_V2=on`) `runGlobalTurn` → `classifyGlobal` (router regex xác định) → `READ_STATE` + `ReadTopic` → `readState()` (Enterprise Data) → trả lời, giữ workflow đang chờ, nối "Bạn vẫn đang … dở".

## 2. Existing route reused
**`READ_STATE`** của global router, qua `readState()`; không có router/intent mới. Đúng một giá trị mới trong union TypeScript `ReadTopic`: `"TRAINING_PROGRESS"`.
- **Không** đổi `SemanticInterpretationSchema` (`conversational-intelligence/schema.ts`: `PRIMARY_INTENTS`, `REQUESTED_ACTIONS`, `REFERENCE_KINDS`, entity/goal enum) và **không** đổi prompt/enum của `llm-route.ts` (`READ_TOPICS` giữ nguyên) — mô hình route/semantic không biết topic mới; chỉ router xác định mới phát ra nó.
- Không có script dataset/training nào tham chiếu `ReadTopic` (đã grep `training/`, `validate-semantic-dataset-targets.ts`).
- Không có `SEMANTIC_ONTOLOGY_COMPATIBILITY_BLOCKER`.
- Không sửa `training/`, `docs/ai-training/`.

## 3. Supported question classes (chỉ từ chỉ số Phase 4.1)
| Lớp | Ví dụ | Nguồn |
|---|---|---|
| ADHERENCE | "28 ngày qua tôi tập đều không?", "Tôi bỏ bao nhiêu buổi?", "…hoàn thành bao nhiêu buổi?" | `adherence`, `signals` |
| FREQUENCY | "Tháng này tôi tập được bao nhiêu buổi?" | `frequency` |
| VOLUME | "Volume chân của tôi tháng này thế nào?" | `volume.byMuscleGroupKg`, `totalVolumeLoadKg` |
| PROGRESSION | "Bench của tôi dạo này có tiến bộ không?" | `progression.exercises` |
| EFFORT | "Dạo này cường độ tập của tôi ra sao?" | `effort` |
| PLATEAU | "Tôi đang plateau không?" | `plateau` (NOT_AVAILABLE) |
| SUMMARY | "Tôi tập gần đây ổn không?" | toàn bộ `training` |

## 4. Unsupported / not claimed
- Kiến thức chung ("Training volume là gì?", "RIR là gì?") → vẫn KNOWLEDGE_QA/RAG, **không** fetch analytics cá nhân.
- Khuyến nghị ("tôi nên tập bao nhiêu buổi?") → RECOMMEND hiện có.
- Câu chứa yêu cầu sửa ("tôi tập không đều, chỉnh lịch giúp tôi") → **không bị chiếm**; rơi về routing hiện có (đề xuất/xác nhận như cũ). Chưa ghép "analytics + đề xuất" trong một lượt (hoãn).
- Dinh dưỡng, PT, lịch hiện tại ("Lịch hiện tại của tôi là gì?") → readers hiện có.
- "hôm nay", "tuần này" theo lịch: không hứa độ chính xác theo lịch địa phương; mặc định cửa sổ 28 ngày UTC và nêu rõ "28 ngày gần đây".
- Đánh giá giá trị ("volume có quá cao không?" theo chuẩn khoa học): chỉ mô tả số liệu, nói rõ chưa đánh giá cao/thấp. Chưa kết hợp KB/RAG.

## 5. CoachState context mapping
`answerTrainingProgress` → `getCoachStateV0(identity, { days, includeGoal })` → `assembleContext(["TRAINING_COACH_STATE", (+ "FITNESS_GOAL" chỉ cho SUMMARY)])`. Danh tính từ `AgentIdentity` đã xác thực (header Authorization); không dùng user id do model/ngữ nghĩa trích. `days` chỉ lấy từ "N ngày" trong câu hỏi nếu trong 7–90, còn lại để mặc định server (28). Cửa sổ chỉ được fetch khi router đã gán `TRAINING_PROGRESS` (một lần/lượt).

## 6. Deterministic answer paths (0 LLM)
Tất cả lớp trừ SUMMARY, và SUMMARY khi `NO_DATA`/`STALE`/`INSUFFICIENT_HISTORY`: `renderTrainingAnswer(state, class, question)` — chuỗi dựng từ trường của `CoachStateV0.training`; không tính lại gì trong ai-service. Nhận diện bài tập bằng bảng alias nhãn (bench/squat/deadlift/…) khớp tên bài trong `progression.exercises`; nhiều khớp ⇒ hỏi lại; không khớp ⇒ nói chưa có trong dữ liệu (chỉ top-5 bài).

## 7. Narration path (≤ 1 call)
Chỉ SUMMARY với `dataQuality ∈ {SUFFICIENT, PARTIAL}` và `GYMINI_UNIFIED_AI_COACH=on`. Đầu vào là `narrationSnapshot()` (mục tiêu, số ngày, chất lượng, 9/8/1, buổi/tuần, tổng volume, ≤3 bài với %, RPE coverage, mã signal) — không có set/lịch sử thô. Một lời gọi `callLlmJson` (`purpose: RECOMMENDATION_NARRATION` — "wording an already-chosen deterministic result"; không thêm giá trị enum telemetry; ngân sách `NARRATION_BUDGET` 20 s, 1 attempt). Lỗi/timeout/không hợp lệ ⇒ bản tóm tắt xác định. Ghi chú chất lượng dữ liệu luôn được nối bằng code, không phụ thuộc model.

**Cơ chế chống bịa (§35):** `validateNarration` từ chối khi (a) có số không nằm trong snapshot, (b) nhắc plateau/kiệt sức/quá tải, (c) nói về giấc ngủ/HRV/phục hồi/dinh dưỡng. Không phải framework chung; ba kiểm tra cục bộ + fallback xác định. Cơ chế an toàn thật là: đầu vào bị giới hạn, đầu ra bị kiểm số, và chất lượng/plateau không bao giờ do model quyết.

## 8. DataQuality UX
- `NO_DATA`: "Chưa có dữ liệu tập trong 28 ngày gần đây … để đánh giá." (không phải "tập chưa đều").
- `STALE`: "Không có buổi tập hay lịch tập nào trong 28 ngày gần đây, dù trước đó bạn đã có dữ liệu…" (không phải "chưa từng tập").
- `NO_SCHEDULE` + log: "N ngày tập được ghi nhận, nhưng không có lịch … chưa tính được tỷ lệ hoàn thành theo lịch." (không có %).
- `INSUFFICIENT_HISTORY`/`PARTIAL`: câu chú thích cố định được nối vào.
- Lỗi đọc: "Mình chưa đọc được dữ liệu tập luyện … thử lại" — **không** bao giờ thành NO_DATA/0%.

## 9. Progression
`baseline → current` e1RM, `changePct`, `weeksObserved` từ state; `INSUFFICIENT_HISTORY` ⇒ không có xu hướng; không nhãn IMPROVING/PLATEAU. Ví dụ smoke: "Barbell Bench Press: ước tính 1RM tăng từ 79,2 kg lên 101,3 kg (+27,9%) qua 4 tuần có dữ liệu."

## 10. Plateau
Luôn: "chưa có phân loại plateau đủ tin cậy… không kết luận bạn có đang plateau hay không" + số liệu tiến triển có sẵn. Không có heuristic plateau mới ở ai-service hay prompt; narration có chứa plateau bị loại.

## 11. Volume terminology
"Khối lượng tạ (Σ tạ × số lần, các set đã hoàn thành)"; nhóm cơ lấy trọn khối lượng của set nên cộng nhóm có thể > tổng (nói rõ); không "effective sets/volume"; không đánh giá cao/thấp. Hỏi theo vùng ("chân") khớp tên nhóm cơ trong dữ liệu (quadriceps, hamstrings, glutes, …), mỗi nhóm hiển thị riêng, không cộng.

## 12. RPE/RIR sparse
`RPE được nhập ở 4/18 set`, "RIR: bạn chưa nhập ở set nào…", "chỉ được nhập ở một phần số set nên chỉ phản ánh phần đó"; trend chỉ hiện khi state có trend (≥3 tuần). Không suy readiness/recovery; không sleep/HRV.

## 13. LLM call budget
| Đường | Model calls |
|---|---|
| Dựng CoachState | 0 |
| Router (TRAINING_PROGRESS) | 0 — router xác định; không mở rộng `llmRoute` |
| ADHERENCE/FREQUENCY/VOLUME/PROGRESSION/EFFORT/PLATEAU | 0 |
| SUMMARY (đủ dữ liệu, flag on) | ≤ 1 narration |
| SUMMARY (NO_DATA/STALE/INSUFFICIENT) | 0 |
Telemetry: `training_coach_answer` {answerClass, windowDays, dataQuality, usedNarration, llmCalls, analyticsReadOutcome, latencyMs}; không log tải/RPE/ghi chú/prompt/userId.

## 14. Cross-domain continuity
Câu hỏi training khi workflow đang chờ ⇒ route `READ_STATE` với `interrupts`; trả lời + "Bạn vẫn đang tìm PT dở…"; hàng workflow giữ nguyên `id/status/expectedSlot`; "2 triệu." sau đó tiếp tục workflow (kiểm tra bằng DB thật). Không tạo workflow mới; không ghi hồ sơ.

## 15. User isolation
Header Authorization của chính người hỏi → fitness-service suy `userId` từ token. Test: B hỏi ⇒ chỉ thấy NO_DATA của B; payload của A (kể cả exerciseId) không xuất hiện; chỉ một fetch với credential của B.

## 16. Failure behavior
Đọc analytics lỗi (kể cả HTTP 4xx/5xx/shape sai) ⇒ `AuthoritativeRead.error` ⇒ câu "chưa đọc được dữ liệu". Narration lỗi ⇒ bản xác định, giữ nguyên số liệu. 401/403 từ `readState` vẫn được ném lại như hành vi cũ.

## 17. AI→fitness real smoke — **REAL HTTP/API (cục bộ, không Docker dev)**
Stack: auth-service (3991, DB `gymcoach_auth_test`) + fitness-service (3992, DB `gymcoach_fitness_test`), `AUTH_SERVICE_URL` trỏ auth cục bộ; hai user đăng ký + xác thực OTP thật, JWT thật. A được seed 9 workout / 9 lịch (8 COMPLETED, 1 SKIPPED). Reader + `getCoachStateV0` + `answerTrainingProgress` của ai-service chạy với `FITNESS_SERVICE_URL=http://localhost:3992`:
- A: `SUFFICIENT`, 9/8/1 (0.89), 18 set, volume 10080 kg, bench `+27,9%` qua 4 tuần, plateau `NOT_AVAILABLE`, RPE `4/18`; ba câu hỏi trả lời đúng, `llmCalls = 0`.
- B: `NO_DATA`, `NO_SCHEDULE`; cả ba câu trả lời "Chưa có dữ liệu…"; không thấy dữ liệu của A.
- Token sai ⇒ `error` (không phải absent/NO_DATA).
Dọn: dữ liệu seed/user đã xoá; tiến trình dừng; container `postgres-test` dừng. Chưa chạy stack đầy đủ qua gateway/web (không có `REAL BROWSER`).

## 18. Tests
| File | Nhãn | Kết quả |
|---|---|---|
| `ai-service/src/__tests__/training-coach-integration.test.ts` (23 test: nhận diện/định tuyến + flag-off parity, render NO_DATA/STALE/NO_SCHEDULE/adherence 9-8-1/progression/plateau/volume/RPE, narration timeout/hallucination/budget, upstream failure, `tryTurn` cross-user, workflow tiếp diễn, demand-driven + OFF parity) | TEST FIXTURE + BACKEND INTEGRATION (DB test) | 23/23 |
| `coach-state-training.test.ts` (Phase 4.1) | TEST FIXTURE | 9/9 |
| Hồi quy (scoped, không phải toàn repo): `conversational-intelligence-global`, `-remediation`, `unified-ai-coach-e2e`, `bounded-turn-*`, `revision-route-parity`, `turn-understanding-*`, `phase3-r1-routing-llm`, `readers-network-failure`, `codex-*`, `agent-workflow-create-workout-plan`, `enterprise-data-layer`, `context-assembler` | BACKEND INTEGRATION | 223/224 |
Một fail: `agent-workflow-create-workout-plan` "weekday exercise-count revision" — assertion regex `/8 b[aÃ ]i/` không khớp "8 bài/buổi" (lỗi mã hoá trong chính test; luồng flag-off, không đi qua mã Phase 4.2; file này nằm trong working tree đang sửa của phiên khác). Không sửa. `tsc --noEmit` sạch.

## 19. Intentional user-visible changes
Chỉ khi `CONVERSATIONAL_INTELLIGENCE_V2=on` **và** `GYMINI_UNIFIED_AI_COACH=on`: các câu hỏi §3 được trả lời từ CoachState thay vì rơi vào RAG/legacy. Flag tái dùng, không tạo flag mới, không đổi mặc định. Off: `classifyGlobal` không nhận `trainingCoach` ⇒ route y hệt trước (có test so sánh `deepEqual`), không fetch analytics.

## 20. Remaining Phase-4 gaps
Nutrition/body/recovery CoachState; plateau rolling-window; sets-per-muscle; timezone người dùng; ghép "analytics + đề xuất chỉnh lịch" trong một lượt; kết hợp KB cho phán đoán định lượng; nhận diện bài tập theo `Exercise.id`/alias catalog thay vì bảng alias nhãn; tên nhóm cơ hiển thị chưa Việt hoá; smoke với model thật (bị hoãn do GPU) và qua gateway/web.

## 21. Recommended Phase 4.3
Chọn một: (a) Nutrition CoachState (chuẩn hoá intake thực tế — audit §28 bước 3) để mở rộng cùng cơ chế `READ_STATE`; hoặc (b) kết hợp CoachState với một luật khuyến nghị xác định đã có (vd. đề xuất điều chỉnh lịch qua luồng xác nhận hiện có) khi phiên semantic/training ổn định. Khuyến nghị (a) trước vì không phụ thuộc ontology đang được fine-tune.
