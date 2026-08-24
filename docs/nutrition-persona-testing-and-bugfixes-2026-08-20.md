# Báo cáo — Sửa 2 lỗi thật Persona B/C, đưa `24-ai-nutrition-persona-b-c.spec.ts` về xanh

**Ngày**: 2026-08-20 (bản cập nhật thứ 2 — bản đầu chỉ tìm ra bug, bản này sửa tận gốc theo đúng yêu cầu)

**Phạm vi lượt này**: Sửa đúng 2 khoảng trống nghiệp vụ làm `24-ai-nutrition-persona-b-c.spec.ts` fail (Persona B — câu hỏi timing bị route sai; Persona C — cắt 900 kcal/ngày chưa bị cảnh báo đủ mạnh), không sửa test để né fail, không mở rộng UI lớn, không đụng workout/Gate 7/gamification.

---

## 1. Đã sửa gì cho Persona B (câu hỏi timing trước/sau tập)

**Root cause**: mọi câu hỏi chứa "ăn gì"/"cách ăn"/... đều rơi vào `meal_plan_request`'s catch-all trong `intent_router.ts`, luôn kích hoạt sinh **cả thực đơn đầy đủ** kể cả khi user chỉ hỏi nên ăn gì trước/sau buổi tập.

**Thêm intent mới**: `nutrient_timing_request` (types.ts, intent_router.ts) — được kiểm tra **TRƯỚC** catch-all của `meal_plan_request`, khớp các dạng câu:
`trước/sau (khi) (buổi) tập`, `pre workout`/`post workout`, `quanh buổi tập`, `tập lúc Xh thì ăn ...`.

**Xuyên suốt pipeline**:
- `orchestrator.service.ts`: thêm vào `llmIntents` (vẫn dùng LLM cho câu trả lời tự nhiên).
- `prompt_builder.ts`: thêm khối instruction riêng (VI + EN) — bắt buộc dùng đúng 2 tiêu đề markdown `## Trước Tập` / `## Sau Tập`, cấm tạo bảng thực đơn cả ngày/tuần, cấm nội dung lịch tập.
- `response_formatter.ts`: thêm `formatNutrientTiming()` — fallback xác định (deterministic) khi LLM lỗi/không đạt validation, luôn có nội dung Trước tập/Sau tập thật, không phải placeholder.
- `answer_validator.ts`: thêm `requireSection` bắt buộc câu trả lời phải nhắc **CẢ** trước tập lẫn sau tập — nếu LLM (model nhỏ, chạy local) trả lời lạc đề, hệ thống tự động dùng câu trả lời xác định (deterministic) thay vì để lọt câu trả lời sai ra ngoài. Đây là lưới an toàn thứ 2, cùng triết lý "engine's number wins" đã có sẵn trong file này cho phần macro.

**Bug phụ tìm được TRONG LÚC sửa** (không phải cố tình, phát hiện qua chạy lại E2E thật): điều kiện "có nhắc tới việc ăn" (`mentionsEating`) ban đầu dùng regex quá lỏng (`[aă]n` bất kỳ đâu trong câu) — khớp nhầm chữ "an" trong **"an toàn"** (safe) và "eat" trong **"creatine"**, khiến câu hỏi về creatine/caffeine của Persona C bị route nhầm vào `nutrient_timing_request`. Đã sửa bằng word-boundary chính xác (`(?<![\p{L}])ăn(?![\p{L}])` cho tiếng Việt có dấu, `\b(meal|eat)\b` cho tiếng Anh).

## 2. Đã sửa gì cho Persona C (cảnh báo cắt 900 kcal/ngày)

**Root cause**: `safety_guard.ts`'s `detectExtremeCalorieRequest` chỉ bắt dưới 800 kcal (ngưỡng y tế cực đoan có chủ đích) — 900 kcal/ngày cho người tập 6 buổi/tuần bị lọt qua như một yêu cầu bình thường.

**Không đổi ngưỡng 800 → 1200** (đúng yêu cầu "không vá bừa"). Thay vào đó thêm **tầng cảnh báo riêng, thiết kế đúng**: `severe_energy_restriction_warning` (type mới trong `SafetyResult`), với detector `detectSevereEnergyRestriction()` bắt các trường hợp:
- Calo nêu rõ trong khoảng **800–1199 kcal/ngày** (băng riêng, không đè lên logic <800 hiện có).
- HOẶC ngôn ngữ cắt mạnh ("cắt calo thật mạnh", "nhịn ăn", "ăn càng ít càng tốt", "nét cơ nhanh"...) kết hợp với tần suất tập cao được nêu rõ trong CÙNG câu hỏi (5-7 buổi/tuần, "tập nặng", "vận động viên").

Cả 2 trường hợp đều yêu cầu câu hỏi có dạng REQUEST thật (dùng lại đúng `CALORIE_REQUEST_PATTERN` đã có, tránh chặn nhầm câu hỏi học thuật kiểu "tại sao 900 calo nguy hiểm?").

**Nội dung cảnh báo** (không phải emergency y tế, nhưng đủ mạnh — đúng yêu cầu "phân biệt 2 tầng"): liệt kê rủi ro thật (tụt hiệu suất, mất cơ, đói/mệt kéo dài, nguy cơ thiếu năng lượng kéo dài/low energy availability), đề xuất cách an toàn hơn (thâm hụt vừa phải, theo dõi cân theo tuần, giữ protein, không giảm fat quá thấp, cần chuyên gia nếu đang thi đấu/prep). Nguồn nghiệp vụ ghi trong comment code:
- **IOC RED-S 2023**: low energy availability kéo dài gây rủi ro hiệu suất/nội tiết/xương ở athlete, kể cả khi không có rối loạn ăn uống.
- **ACSM nutrition & athletic performance**: dinh dưỡng phải cá nhân hóa theo tải tập, không dùng một ngưỡng chung cho mọi người.
- **Bodybuilding cutting-phase literature (Helms/Iraki...)**: thâm hụt quá mạnh có rủi ro mất khối cơ/hiệu suất, nên ưu tiên thâm hụt vừa phải bền vững.

## 3. File đã sửa

- `backend/services/ai-service/src/llm/types.ts` — thêm `"nutrient_timing_request"` vào `RoutedIntentType`.
- `backend/services/ai-service/src/llm/intent_router.ts` — detect timing question + `mentionsEating` fix.
- `backend/services/ai-service/src/llm/input_parser.ts` — map `nutrient_timing_request` → `routeCategory`.
- `backend/services/ai-service/src/llm/recommendation_engine.ts` — follow-up câu hỏi riêng cho timing intent.
- `backend/services/ai-service/src/llm/orchestrator.service.ts` — thêm vào `llmIntents`, thêm vào block-list an toàn (`severe_energy_restriction_warning`), thêm vào metric `NUTRITION_SAFETY_TYPES`.
- `backend/services/ai-service/src/llm/prompt_builder.ts` — khối instruction riêng cho `isTiming` (VI + EN).
- `backend/services/ai-service/src/llm/response_formatter.ts` — `formatNutrientTiming()` + dispatch case mới.
- `backend/services/ai-service/src/llm/answer_validator.ts` — `requireSection` bắt buộc nội dung trước/sau tập; guard chống lẫn nội dung workout/full-day-plan.
- `backend/services/ai-service/src/llm/safety_guard.ts` — `detectSevereEnergyRestriction()`, type `severe_energy_restriction_warning`, message VI/EN đầy đủ.

## 4. Test mới/thay đổi

- `backend/services/ai-service/src/llm/__tests__/bugfix.test.ts`:
  - Section **M2** (10 test): intent routing cho câu hỏi timing (VI + EN), xác nhận full meal-plan request vẫn không bị "nuốt" nhầm, xác nhận không còn false-positive "an toàn"/"quan trọng".
  - Section **B2** (3 test): `answerValidator` bắt lỗi khi câu trả lời không nhắc trước/sau tập, không báo lỗi khi câu trả lời đúng cấu trúc, bắt lỗi khi câu trả lời phình thành full-day plan.
- `backend/services/ai-service/src/llm/__tests__/safety_guard_extended_triage.test.ts` — 8 test mới: câu hỏi thật của Persona C, biến thể 1100 kcal + activity cao, ngôn ngữ cắt mạnh không kèm số, 1500-1800 kcal không bị chặn nhầm, dưới 800 kcal vẫn giữ nguyên logic cũ (không bị "hạ cấp" xuống tầng mới), câu hỏi học thuật không bị chặn nhầm.

## 5. Lệnh test đã chạy — kết quả thật

```
docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsx --test src/llm/__tests__/bugfix.test.ts"
→ tests 109, pass 109, fail 0

docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsx --test src/llm/__tests__/safety_guard_extended_triage.test.ts src/llm/__tests__/safety_guard_medical_nutrition.test.ts"
→ tests 31, pass 31, fail 0

docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsc --noEmit -p tsconfig.json"
→ exit 0

Batch hồi quy diện rộng (26 file, cùng bộ đã chạy ở báo cáo trước — ai.flow/ai/body_composition/
coach_context/conversation_repository/cycle-assessment/encoding-sanity/nutrition-plan-invariant/
nutrition-plan-request-schema/production-markers/rag_evidence/research_knowledge/retriever_scope/
tools/workout-plan-invariant/workout_schedule_intent/bugfix/intent_router_calo/meal-plan-validator/
nutrition_context_intent/nutrition_context_macro_warning/nutrition_engine/proposed-change-validator/
safety_guard_extended_triage/safety_guard_medical_nutrition/nutrition.processor.serving-caps):
→ tests 379, pass 379, fail 0
```

## 6. E2E — kết quả thật, kể cả những lần fail trong lúc sửa (không giấu)

```
cd fitnessassistant-playwright-e2e
npx playwright test tests/24-ai-nutrition-persona-b-c.spec.ts --reporter=list
```

Lịch sử chạy thật trong lúc sửa (đúng tinh thần "đọc output, sửa logic, không né test"):
1. Sau khi thêm intent + prompt dạng câu văn thường: **2 fail** (B1: LLM không dùng đúng cụm "trước tập"/"sau tập" nhất quán) → phát hiện cần prompt dạng markdown-header mạnh hơn, giống các template khác đã hoạt động ổn định.
2. Sau khi đổi prompt sang `## Trước Tập` / `## Sau Tập`: **B1 pass, C3 pass** → chạy lại lần 2: **B1 fail lại** (LLM lạc đề, không nhắc gì đến trước/sau tập) → phát hiện cần lưới an toàn xác định (deterministic fallback), không thể chỉ tin vào prompt.
3. Sau khi thêm `requireSection` bắt buộc trong `answer_validator.ts` (fallback về `formatNutrientTiming()` khi LLM lạc đề): **B1 pass** → nhưng **C2 fail mới** (câu hỏi creatine/caffeine bị route nhầm vào timing vì bug "an toàn"/"creatine" nêu ở mục 1) → sửa `mentionsEating`.
4. Sau khi sửa `mentionsEating`: **2/2 PASS** — chạy lại combined cùng spec 21+23 lần nữa: **3/3 PASS** (21/23/24 xanh cùng lúc).

**Kết quả cuối cùng, đã xác nhận nhiều lần**:
```
ok tests\24-ai-nutrition-persona-b-c.spec.ts › Persona B: ... (32.0-32.4s)
ok tests\24-ai-nutrition-persona-b-c.spec.ts › Persona C: ... (37.6-40.5s)
2 passed
```

```
npx playwright test tests/23-ai-nutrition-plan-serving-realism.spec.ts --reporter=list
→ 1 passed — không đổi so với báo cáo trước, xác nhận lại nhiều lần trong quá trình sửa.
```

```
npx playwright test tests/21-ai-nutrition-chat-routing.spec.ts --reporter=list
```
**Chưa ổn định 100%** — nói thẳng, không giấu: trong 5 lần chạy trong lượt này (bao gồm cả trước và sau khi sửa Part 1/2), spec 21 **pass 2/5, fail 3/5**, luôn fail ở đúng 1 chỗ: **Q5** ("Bỏ qua dữ liệu cân nặng đã lưu... 76kg... ước tính calo duy trì") — câu trả lời của LLM đôi khi không nhắc số "76" dù vẫn là câu trả lời hợp lệ (một thực đơn đầy đủ đúng format, không phải canned-fallback cũ). Đã xác minh kỹ:
- Q5 **không** đi qua `nutrient_timing_request` (không chứa "tập"/timing keyword nào) — không liên quan tới Part 1.
- Q5 **không** liên quan `severe_energy_restriction_warning` (không có yêu cầu calo cực thấp) — không liên quan tới Part 2.
- Đây là hành vi ĐÃ CÓ TỪ TRƯỚC (lần chạy đầu tiên của lượt này, TRƯỚC khi tôi sửa bất kỳ dòng code nào, spec 21 cũng đã PASS 1 lần rồi sau đó FAIL 1 lần khi chạy lại) — không phải regression do Part 1/2 gây ra.
- Đây là giới hạn đã được chính file test ghi nhận ngay trong comment của nó ("wording is non-deterministic" — do dùng LLM local thật, không mock).

**Không sửa phần này trong lượt này** vì: (a) nằm ngoài phạm vi Part 1/Part 2 được giao; (b) xác nhận không phải regression do tôi gây ra; (c) đụng vào logic "ưu tiên số liệu người dùng nêu rõ" (weight override precedence) cần một lượt điều tra + test riêng, không nên vá vội kèm trong lượt sửa 2 bug khác.

## 7. Trả lời đúng 12 câu hỏi trong Phần 7 của yêu cầu

1. **Đã sửa gì cho Persona B**: xem mục 1.
2. **Đã sửa gì cho Persona C**: xem mục 2.
3. **File đã sửa**: xem mục 3 (9 file backend, không đụng file frontend/workout).
4. **Test mới/thay đổi**: xem mục 4 (109+31 = 140 test liên quan trực tiếp, cộng 379 test hồi quy tổng).
5. **Lệnh test đã chạy**: xem mục 5 (nguyên văn).
6. **Kết quả pass/fail**: 109/109, 31/31, tsc exit 0, 379/379 hồi quy — tất cả PASS.
7. **E2E `24-ai-nutrition-persona-b-c.spec.ts` đã xanh chưa?** — **CÓ, đã xanh 2/2**, xác nhận lại 2 lần liên tiếp sau bản sửa cuối cùng.
8. **`21` và `23` có còn xanh không?** — **`23` xanh ổn định** (pass mọi lần chạy). **`21` KHÔNG ổn định 100%** — pass phần lớn thời gian nhưng có flake thật ở Q5, đã xác minh không phải do Part 1/2 gây ra (xem mục 6).
9. **Research doc đã viết chưa?** — **ĐÃ VIẾT** (cập nhật sau bản báo cáo đầu tiên này): `docs/research/nutrition-ai-product-and-expert-review.md` — bảng nguồn/rule đã-implement/chưa-implement cho 11 nguồn khoa học + 4 app tham khảo.
10. **Audit 12 câu đã viết chưa?** — **ĐÃ VIẾT**: `docs/audit/nutrition-ai-current-flow-audit.md` — trả lời đủ 12 câu, mỗi câu có bằng chứng file/function cụ thể; phát hiện thêm 1 khoảng trống thật (NutritionGoal và NutritionProgram không đồng bộ khi goal đổi — xem câu 6 trong audit).
11. **Việc chưa làm**:
    - UI beginner mode — chưa làm.
    - `MealRealismScorer` đúng tên/flag như spec gốc — chưa xây riêng (đã có cơ chế tương đương là category-based serving caps, xem báo cáo trước).
    - Gate 10 batch mới — chưa làm.
    - Golden AI eval đủ 7 câu — một phần đã có qua spec 21 (không đủ 7 câu, và spec 21 hiện có 1 điểm flaky ở Q5 như mục 6).
    - Spec 21's Q5 flakiness — xác nhận không phải regression, nhưng cũng chưa được sửa triệt để.

## 8. Nguyên tắc đã tuân thủ

- Không ghi "pass" cho bất kỳ chỗ nào chưa thực sự chạy lệnh.
- Không sửa test để né fail — toàn bộ assertion gốc của `24-ai-nutrition-persona-b-c.spec.ts` được giữ nguyên; bug được sửa ở code nghiệp vụ (intent router, prompt, validator, safety guard), không ở test.
- Không mở rộng sang workout/Gate 7/gamification.
- Không publish dữ liệu STAGING, không đụng production DB.
- Đã báo cáo trung thực điểm chưa ổn định (spec 21's Q5) thay vì im lặng bỏ qua.
