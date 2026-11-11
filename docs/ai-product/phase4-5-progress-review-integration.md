# Phase 4.5 — Longitudinal progress review (body + goal + training + nutrition)

Nhãn bằng chứng: `TEST FIXTURE` · `BACKEND INTEGRATION` (orchestrator thật + Postgres `*_test` cô lập, axios/profile stub) · `REAL HTTP/API` (auth + user-service + fitness-service thật chạy cục bộ trên DB test → `fitnessAgent.tryTurn` của ai-service). Không có `REAL BROWSER`. Không dùng model thật (`MODEL_SMOKE_DEFERRED_DUE_TO_GPU_CONTENTION`: `nvidia-smi` thấy 3667/4096 MiB đang bị một tiến trình python của phiên training chiếm; không đụng vào).

## 1. Starting CoachState architecture
`CoachStateV0 = {asOf, goal?, training?, nutrition?, body?}`; mỗi slice do fitness-service sở hữu và được đọc qua Enterprise Data (`/stats/training-window`, `/nutrition/analytics/window`, `/stats/body-goal-state`). Phase 4.2 đã nối `TRAINING_PROGRESS` vào hội thoại (`READ_STATE`); 4.3/4.4 mới là nền tảng. `getCoachStateV0` hiện fail cả read nếu một slice được yêu cầu bị lỗi.

## 2. Supported progress-review questions
| Lớp | Ví dụ | Slice cần |
|---|---|---|
| HOLISTIC | "Dạo này tình hình của tôi thế nào?", "Tôi có tiến triển không?", "Cân nặng, tập luyện và ăn uống gần đây có ổn không?" | body+goal, training, nutrition (mỗi slice 1 lần) |
| DIRECTION | "Tôi có đang đi đúng hướng giảm cân không?", "…tiến gần mục tiêu không?" | body+goal |
| SCHEDULE | "Tôi có đúng tiến độ không?" | body+goal |
| GAP | "Tôi còn cách mục tiêu bao nhiêu kg?", "Tôi giảm được bao nhiêu rồi?" | body+goal |
| LATEST_WEIGHT | "Cân gần nhất của tôi là bao nhiêu?" | body+goal |
| NUTRITION_READBACK | "Protein trung bình của tôi gần đây là bao nhiêu?" | nutrition |
Câu thuần training ("28 ngày qua tôi tập đều không?", "Bench của tôi…") vẫn thuộc Phase 4.2.

## 3. Routing
Dùng lại `READ_STATE` của global router; thêm đúng một giá trị TypeScript `ReadTopic = "PROGRESS_REVIEW"`. Quy tắc (xác định, trong `classifyClause`): khi `ctx.trainingCoach` (= `GYMINI_UNIFIED_AI_COACH=on`, và `runGlobalTurn` chỉ chạy khi `CONVERSATIONAL_INTELLIGENCE_V2=on`) và `classifyProgressReviewQuestion(text)` trả lớp ≠ null thì route `READ_STATE/PROGRESS_REVIEW`. Kiểm tra đặt **trước** nhánh training: bộ phân loại trả `null` cho câu chỉ chạm một miền training. Không đụng `SemanticInterpretationSchema`, `llm-route.ts` (enum/prompt), training ontology; `training/` và `docs/ai-training/` không bị sửa. Không có `SEMANTIC_ONTOLOGY_COMPATIBILITY_BLOCKER`.
Không chiếm: câu hỏi kiến thức ("Giảm 0.5 kg một tuần có ổn không?", "InBody chính xác không?", "…là gì?"), khuyến nghị ("nên giảm bao nhiêu calo?"), hành động ("…chỉnh lịch cho tôi"), đọc target hiện có ("Macro hiện tại của tôi?", "Cân nặng mục tiêu của tôi?").

## 4. `ProgressReviewV0` contract
```ts
{ asOf; domains: { BODY|GOAL|TRAINING|NUTRITION: { state: OK|NO_DATA|STALE|ERROR|ABSENT|NOT_REQUESTED, quality } };
  goal: { type, onTrack: { status: "NOT_EVALUABLE", reasons } | null };
  evidence: EvidenceItem[]; limitations: Limitation[];
  overallCoverage: COMPLETE_ENOUGH_FOR_SUMMARY | PARTIAL | INSUFFICIENT }
EvidenceItem = { domain, kind, value{primitives}, quality, provenance?, window, claimBoundary: "DESCRIPTIVE_ONLY" }
```
Không có điểm tổng ("progress score") — mỗi miền giữ chất lượng/thiếu dữ liệu riêng.

## 5. Deterministic evidence layer
`buildProgressReviewV0` (thuần, 0 LLM): chỉ gom các trường đã có sẵn trong slice. Không tính lại bất kỳ chỉ số nào. Tập `kind`: BODY (`LATEST_MEASURED_WEIGHT`, `OBSERVED_WEIGHT_TRAJECTORY`, `BODY_FAT_TREND`), GOAL (`TARGET_WEIGHT`, `GAP_TO_TARGET`), TRAINING (`SCHEDULED_ADHERENCE`/`LOGGED_TRAINING_DAYS`, `EXERCISE_E1RM_CHANGE`), NUTRITION (`LOGGED_DAYS`, `AVERAGE_LOGGED_CALORIES`, `AVERAGE_LOGGED_PROTEIN`).

## 6–8. Body / training / nutrition evidence
- **Body:** chỉ dữ kiện Phase 4.4 (cân gần nhất, chênh lệch, thay đổi/tốc độ quan sát, `directionRelativeToGap`, số lần đo). Provenance giữ nguyên (`MEASURED_INBODY` ≠ `PROFILE_REPORTED`; fallback hồ sơ được nói rõ "không phải số đo InBody"). **`muscleMass` không bao giờ được nhắc** (semantics UNRESOLVED); mỡ cơ thể chỉ khi có xu hướng body-fat riêng; không suy mỡ từ cân.
- **Training:** dùng state 4.1/4.2 (8/9 buổi, % hoàn thành; hoặc "ngày tập ghi nhận, không có lịch" khi `NO_SCHEDULE`; thay đổi e1RM ≤ 2 bài khi đủ tuần). Không biến volume thành "kích thích tăng cơ".
- **Nutrition:** chỉ state 4.3. Trung bình luôn gắn phạm vi: "Trong các ngày có dữ liệu (24/28 ngày)…, tính trên N ngày có đủ dữ liệu"; protein/calo thiếu ⇒ nói chưa đủ; không bao giờ coi thiếu log là 0; kế hoạch bữa ăn không phải intake.

## 9. Goal gap
`currentKg, targetKg, absoluteKg` + chiều ("đang cao hơn / thấp hơn mục tiêu"); không tốt/xấu/dễ/khó. Giá trị hồ sơ khác số đo ⇒ câu riêng nêu cả hai.

## 10. Direction vs on-track
`DIRECTION` trả lời mô tả: "đang di chuyển theo hướng mục tiêu: 82 → 78 kg (−4 kg) qua 48 ngày, 4 lần đo" + câu "đây chỉ là hướng thay đổi đo được, chưa phải đánh giá tiến độ theo hạn chót". `SCHEDULE` ("đúng tiến độ?") luôn mở đầu bằng "Mình chưa xác định được bạn có đúng tiến độ theo hạn chót hay không, vì hiện chưa có hạn chót hay tốc độ mục tiêu nào được ghi nhận…". `TOWARD_TARGET` không bao giờ thành `ON_TRACK`; `onTrack` giữ `NOT_EVALUABLE` (không tìm thấy nguồn hạn chót thẩm quyền mới — `plannedEndAt` của roadmap vẫn là mốc kế hoạch, không phải hạn của target).

## 11. Data-quality composition
Mỗi miền giữ `state/quality`; `overallCoverage` chỉ là nhãn UX: `COMPLETE_ENOUGH_FOR_SUMMARY` (≥2 miền được yêu cầu và tất cả dùng được), `PARTIAL`, `INSUFFICIENT` (không miền nào dùng được ⇒ câu trả lời "chưa đủ dữ liệu", không đánh giá).

## 12. Partial-success behavior
`getCoachStateV0` **không đổi** (một slice lỗi ⇒ cả read lỗi). Thêm `readCoachStateSlices` trả `ok/absent/error` **riêng từng slice** (chỉ slice được yêu cầu). Smoke thật (dừng user-service): review vẫn trả training + nutrition, phần cân nặng ghi "hiện mình chưa đọc được dữ liệu này" — không bao giờ "chưa có dữ liệu". NO_DATA (ok nhưng trống) và ERROR được phân biệt trong câu chữ.

## 13. Deterministic answers (0 LLM)
GAP, LATEST_WEIGHT, DIRECTION, SCHEDULE, NUTRITION_READBACK, và HOLISTIC khi không đủ dữ liệu: `renderProgressReview`.

## 14. Narration
Chỉ HOLISTIC, khi `overallCoverage ≠ INSUFFICIENT` và `GYMINI_UNIFIED_AI_COACH=on`: tối đa **1** `callLlmJson` (`purpose RECOMMENDATION_NARRATION`, ngân sách `NARRATION_BUDGET`, 1 attempt). Đầu vào là `evidenceSnapshot` (giá trị + chất lượng + mã giới hạn); không set thô, không log ăn, không lịch sử InBody, không Json roadmap. Phần giới hạn/miền thiếu/đổi target/hạn chót luôn được **code** nối vào sau câu của model.

## 15–17. Claim boundaries, rejection, causal policy
`validateReviewNarration` (nhỏ, cục bộ, không framework) từ chối khi có: số không có trong bằng chứng (kể cả ngày/tháng dự đoán), khẳng định plateau, giấc ngủ/HRV/stress, khối lượng cơ/"cơ xương"/SMM, từ nhân quả (`vì/bởi vì/nhờ/khiến/dẫn đến/làm cho/là kết quả/nguyên nhân/do việc…` — kiểm trên chữ **có dấu** để không nhầm "đo" với "do"), lời khuyên (`nên/hãy… giảm/tăng/ăn/tập…`, "giảm thêm", điều chỉnh calo), đánh giá tối ưu/lý tưởng, khẳng định đúng tiến độ (cho phép câu phủ định), "giảm mỡ" khi chưa có xu hướng mỡ giảm. Bị từ chối ⇒ bản xác định (số liệu nguyên vẹn). Prompt cũng cấm các nhóm này, nhưng cơ chế an toàn thật là validator + fallback.

## 18. Recommendation / mutation boundary
Không ghi gì vào chương trình, lịch, NutritionGoal, roadmap, PT, profile. Câu có yêu cầu hành động ("…chỉnh lịch cho tôi") **không bị chiếm**: rơi về routing/đề xuất-xác nhận hiện có. Chưa ghép "review + đề xuất" trong một lượt (hoãn); không có engine khuyến nghị mới.

## 19. LLM call budget
Dựng slice 0; evidence 0; router 0; direct readback 0; HOLISTIC ≤ 1. Telemetry `progress_review_answer`: `answerClass, domainsAvailable/Missing/Errored, body/training/nutritionQuality, overallCoverage, usedNarration, llmCalls, fallbackUsed, latencyMs` — không cân nặng/giá trị ăn/prompt/userId.

## 20. Cross-domain workflow continuity
Workflow "Tìm PT" đang chờ ngân sách ⇒ hỏi "Dạo này tình hình của tôi thế nào?" ⇒ nhận review + "Bạn vẫn đang tìm PT dở…"; hàng workflow giữ `id/status/expectedSlot`; không ghi profile; "2 triệu." sau đó chạy workflow đúng một lần (`BACKEND INTEGRATION`).

## 21. User isolation
Identity chỉ từ Authorization của người hỏi; không dùng userId do model/semantic trích. Test: B không thấy 8/9, 78/75 kg, 2.000 kcal, bài tập hay target của A; trả lời "chưa đủ dữ liệu".

## 22. HTTP/tryTurn smoke — REAL HTTP/API
Stack cục bộ trên `gymcoach_*_test` (auth 3991, user 3994, fitness 3992), JWT thật; ai-service `fitnessAgent.tryTurn` với `CONVERSATIONAL_INTELLIGENCE_V2=on`, `GYMINI_UNIFIED_AI_COACH=on`, `LLM_PROVIDER=mock` (narration mock ⇒ fallback xác định).
- **A** (4 InBody + target 75 + 9 lịch/8 hoàn thành + 24 ngày nhật ký): review đủ 3 miền; "còn cách mục tiêu" → 78 vs 75 (3 kg); "đúng tiến độ?" → không xác định được.
- **B** (3 InBody + target, không training/nutrition): "đi đúng hướng?" → 84→82,5 kg theo hướng mục tiêu; holistic → cân nặng + "Tập luyện/Ăn uống: chưa có dữ liệu".
- **C** (chỉ target): holistic → "chưa đủ dữ liệu"; "còn cách bao nhiêu" → chưa có cân nặng hiện tại.
- **D** (user-service dừng): cân nặng "chưa đọc được", training + nutrition vẫn có.
- **E** cross-user: xem §21.
Dữ liệu seed, tiến trình, container đã dọn. Chưa qua gateway/web (không `REAL BROWSER`).

## 23. Real model smoke
`MODEL_SMOKE_DEFERRED_DUE_TO_GPU_CONTENTION` — GPU RTX 3050 Ti đang bận bởi phiên training. Các cổng stub/xác định đã qua; không chặn hoàn thành.

## 24. Tests
`ai-service/src/__tests__/progress-review.test.ts` 22/22: nhận diện + không chiếm kiến thức/khuyến nghị/hành động/training đơn miền/đọc target; routing flag ON/OFF (+ interrupt workflow); body-only; full multi-domain; target-không-hạn-chót; moving-away; single measurement; profile fallback; gap; muscleMass/body-fat; nutrition partial; target changed; một slice lỗi; không dữ liệu; validator (cơ, nhân quả, khuyến nghị, số bịa, đúng tiến độ, plateau, giấc ngủ, giảm mỡ); call budget; fallback khi narration hỏng/bịa; demand-driven; lỗi slice qua reader thật; cross-user; `tryTurn` continuity + OFF-mode không fetch.

## 25. Regression (scoped, không phải full repo)
ai-service 260/260: progress-review, coach-state 4.1/4.3/4.4, training-coach 4.2, enterprise-data, context-assembler, CI-V2 global + remediation, unified-ai-coach e2e, bounded-turn, revision-route-parity, phase3-r1-routing-llm, readers-network-failure, turn-understanding, codex-*. `tsc --noEmit` sạch. Không có thay đổi fitness-service/user-service trong phase này.

## 26. Intentional user-visible changes
Chỉ khi cả `CONVERSATIONAL_INTELLIGENCE_V2=on` và `GYMINI_UNIFIED_AI_COACH=on`: các câu §2 được trả lời từ CoachState. Flag tắt: `classifyGlobal` không có `trainingCoach` ⇒ route y hệt trước; không fetch slice nào (có test). Không thêm flag, không đổi mặc định.

## 27. Remaining gaps
- Không có hạn chót/tốc độ typed ⇒ "đúng tiến độ" chưa trả lời được (đây là điểm chặn dữ liệu, không phải logic).
- Ghép "review + đề xuất chỉnh" trong một lượt chưa có.
- `muscleMass` chưa phân giải; chưa có giải thích nhân quả (cố ý).
- Nhận diện bài tập theo alias nhãn; UTC; chưa có timezone người dùng.
- Smoke với model thật (GPU), qua gateway/web.
- `getCoachStateV0` vẫn fail-whole khi slice lỗi (đường review dùng `readCoachStateSlices`).
- Phrase-level validator là heuristic regex, không phải kiểm chứng ngữ nghĩa đầy đủ.

## 28. Recommended Phase 4.6
Hai lựa chọn, theo phụ thuộc dữ liệu: (a) thêm một trường hạn chót/tốc độ target **typed** (hoặc xác nhận luật tốc độ có thẩm quyền) để mở khoá `on-track`; (b) ghép review với luồng đề xuất/xác nhận hiện có cho yêu cầu "đang không tiến triển, chỉnh giúp" (một lượt: review → đề xuất → xác nhận). Khuyến nghị (a) trước vì mọi khẳng định về tiến độ đều đang bị chặn bởi nó.
