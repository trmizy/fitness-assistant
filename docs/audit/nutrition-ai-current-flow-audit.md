# Audit — Flow AI dinh dưỡng hiện tại (12 câu hỏi)

**Ngày**: 2026-08-20
**Phương pháp**: Trả lời bằng `rg` + đọc code thật, không suy đoán. Mỗi câu trích rõ file/function làm bằng chứng.

---

## 1. User nhập tuổi/giới tính/chiều cao/cân nặng/tần suất tập/mức vận động ở đâu?

`user-service`'s `profile.models.ts` (`profileSchema`): `age`, `gender` (MALE/FEMALE/OTHER), `heightCm`, `goal` (WEIGHT_LOSS/MUSCLE_GAIN/MAINTENANCE/ATHLETIC_PERFORMANCE), `activityLevel` (5 mức SEDENTARY→EXTREMELY_ACTIVE), `experienceLevel` (BEGINNER/INTERMEDIATE/ADVANCED), `preferredTrainingDays`. Nhập qua Onboarding Wizard (`OnboardingWizardPage.tsx`) hoặc `ProfilePage.tsx` sau đó. Cân nặng hiện tại (`currentWeight`) cập nhật qua profile hoặc đồng bộ từ InBody (`inbody.service.ts`).

## 2. Nếu thiếu dữ liệu thì AI hỏi lại hay tự đoán?

**Hỏi lại, không âm thầm đoán như sự thật.** `intent_router.ts`'s `computeMissingFields()` liệt kê field thiếu; `recommendation_engine.ts`'s `buildFollowUps()` sinh câu hỏi follow-up theo đúng field thiếu và theo intent. Khi thiếu tuổi/chiều cao/cân nặng, `nutrition_calculator.ts` trả về `confidence: "low"` (không có số targetCalories/protein/carb/fat giả) và `recommendation_engine.ts`'s `assumptions` thêm dòng "Nutrition targets are low-confidence...". `prompt_builder.ts` yêu cầu LLM ghi rõ "**Giả định:**" khi thiếu dữ liệu — đã xác nhận qua E2E thật nhiều lần (Persona B/C profile không có tuổi/chiều cao, câu trả lời luôn có phần "Để cá nhân hóa thêm: Bạn có thể cho mình biết tuổi/chiều cao không?").

## 3. TDEE đang tính ở service nào?

`ai-service/src/llm/nutrition_calculator.ts` (`nutritionCalculator.calculate`). Dùng Mifflin-St Jeor (`estimateBmr`: `10*weight + 6.25*height - 5*age + genderTerm`) × activity factor (1.2-1.9). Nếu thiếu bmr/weight, trả `confidence: "low"`, không tính. Đây là service DUY NHẤT tính TDEE cho chat AI — không có bản sao/tính lại ở nơi khác trong `ai-service` (đã xác nhận qua `rg` — chỉ có 2 lệnh gọi `nutritionCalculator.calculate`, cùng dùng input `(profile, intent)` giống nhau, một ở top-level `recommend()`, một trong `buildMealPlanTemplate()`).

## 4. Macro target đang validate ở đâu?

3 lớp độc lập:
- `ai-service`'s `answer_validator.ts` — kiểm tra câu trả lời TỰ NHIÊN của LLM so với target xác định (Atwater consistency + so khớp số liệu LLM nêu, cả tiếng Việt sau bugfix mới).
- `ai-service`'s `orchestrator.service.ts`'s `claimedMacroCheck` — khi user TỰ nêu số liệu (vd "3000 kcal, 150g protein...") trong câu hỏi, so sánh với công thức Atwater và chèn cảnh báo xác định nếu lệch.
- `fitness-service`'s `nutrition-goal-macro-validator.ts` (`checkNutritionGoalMacroConsistency`) — validate khi user LƯU một `NutritionGoal` qua API (`nutrition.service.ts`'s `upsertGoal`), độc lập với ai-service.

## 5. Plan 1 ngày/7 ngày lưu ở đâu?

`fitness-service`'s `NutritionProgram` + `NutritionProgramMealItem` (Prisma model, `nutrition.service.ts`). Có `status: "ACTIVE"|"ARCHIVED"`, `sourceType: "AI_PLAN"|"MANUAL"`, `sourcePlanId` trỏ ngược về plan gốc bên `ai-service`. AI-service tự sinh plan (`nutrition.processor.ts`'s `buildNutritionPlanFromTemplate`) rồi user "import" qua `importAiPlan()` để lưu thật vào `NutritionProgram` — plan do LLM trả lời trực tiếp trong chat (không qua import) **không được lưu**, chỉ tồn tại trong lịch sử hội thoại.

## 6. Active goal và active plan có thể lẫn nhau không?

**Về mặt kỹ thuật thì không lẫn** — `NutritionGoal` (macro mục tiêu, versioned ACTIVE/SUPERSEDED, `nutrition.repository.ts`) và `NutritionProgram` (thực đơn cụ thể, versioned ACTIVE/ARCHIVED, `nutrition.service.ts`) là 2 model hoàn toàn tách biệt, mỗi cái tự đảm bảo đúng 1 dòng ACTIVE tại một thời điểm.

**Nhưng có khoảng trống thật đáng ghi nhận**: `upsertGoal()` (đổi `NutritionGoal`) và `importAiPlan()`/plan-archive (đổi `NutritionProgram`) là **2 luồng code hoàn toàn độc lập, không đồng bộ với nhau** (xác nhận qua `rg` — `nutrition.service.ts` không có bất kỳ tham chiếu nào tới `NutritionGoal` ngoài phần `upsertGoal` của chính nó). Nghĩa là: nếu user đổi `NutritionGoal` (vd tăng protein target) mà không tạo `NutritionProgram` mới, plan cũ vẫn "ACTIVE" với macro cũ — không có cảnh báo "plan của bạn không khớp goal mới nữa". Đây là rủi ro thật, chưa có test hay rule nào xử lý, nên ghi vào đây thay vì giả vờ đã ổn.

## 7. AI có dùng context chat hiện tại không, hay chỉ query DB theo ngày?

**Có dùng context chat thật** — không chỉ query DB theo ngày. Bằng chứng: `21-ai-nutrition-chat-routing.spec.ts`'s Q6 ("Như thực đơn bạn vừa đề xuất ở trên có phù hợp không?") PASS thật với LLM thật, xác nhận AI resolve "ở trên" từ 6 lượt hội thoại trước đó trong CÙNG session, không rơi vào canned lookup-by-date. `orchestrator.service.ts` truyền `chatHistory` (`conversationRepository.findMany`, 5 tin gần nhất) vào prompt. Riêng nhánh "xem thực đơn đã lưu" (`detectNutritionLookupIntent`, `nutrition_context.ts`) mới thật sự query DB theo ngày — và nhánh này chỉ kích hoạt khi câu hỏi rõ ràng là "xem lại/đã lưu", không phải mọi câu hỏi dinh dưỡng.

## 8. Recipe `STAGING` có bị user thường thấy không?

**Không** — xác nhận lại qua `rg` trong lượt trước (Gate 10 report): không có controller/route/frontend nào đọc bảng `recipes` ngoài các script import/verify nội bộ. Hiện tại **không có UI/API nào hiển thị Recipe cho bất kỳ ai**, kể cả admin — không phải vì có cơ chế ẩn `STAGING` cụ thể, mà vì tính năng hiển thị recipe chưa được xây (đúng phạm vi Gate 10 "nhập dữ liệu an toàn", chưa tới phần hiển thị).

## 9. Rule chống meal plan phi thực tế nằm ở đâu?

`fitness-service`'s `nutrition.processor.ts` — `realisticServingCapG` (category-based: parmesan/cheese ≤40-60g, nuts/seeds ≤35g, dried/jerky ≤40g, powder/isolate ≤40g, oil/butter ≤20g, default ≤250g), áp dụng khi `buildNutritionPlanFromTemplate` chọn món ăn cho plan. Đã E2E-verify với kịch bản đối nghịch thật (3200kcal/200g protein — đúng kịch bản 448g protein/ngày trong bug report cũ) — `23-ai-nutrition-plan-serving-realism.spec.ts`, PASS. Đây là cơ chế **tương đương** `MealRealismScorer` spec gốc đề xuất, nhưng khác tên/hình dạng (cap theo category thay vì 1 điểm số 0-100 với flag đặt tên riêng).

## 10. Intent routing hiện có bao nhiêu loại?

`ai-service`'s `RoutedIntentType` (types.ts) hiện có **12 giá trị**: `general_fitness_knowledge`, `workout_plan_request`, `specific_exercise_request`, `muscle_group_routine_request`, `meal_plan_request`, `combined_plan_request`, `body_recomposition_request`, `unsafe_weight_loss_request`, `profile_completion_request`, `frequency_change_request`, `schedule_specific_day_request`, và **`nutrient_timing_request` (mới thêm lượt này)**. Ngoài ra `SafetyResult` (`safety_guard.ts`) có riêng 13 loại an toàn (medical_emergency, off_topic, unsafe_ped_request, unsafe_extreme_calorie_request, **severe_energy_restriction_warning — mới thêm**, prompt_injection_attempt, medical_nutrition_condition, minor_age_nutrition_request, pregnancy_or_breastfeeding_nutrition_request, eating_disorder_disclosure, unsafe_weight_loss_behavior, severe_allergy_disclosure, prolonged_extreme_calorie_disclosure) — chạy TRƯỚC intent routing, độc lập.

## 11. Persona B/C hiện đã được cover bằng test nào?

`fitnessassistant-playwright-e2e/tests/24-ai-nutrition-persona-b-c.spec.ts` — 2 test (Persona B: lean bulk hỏi timing/meal-prep/weekly-adjustment; Persona C: athlete hỏi training-day carb/supplement/aggressive-cut), 6 test case (TC-AI-NUTRITION-08..13), **PASS 2/2** với LLM thật, xác nhận nhiều lần sau khi sửa 2 bug chính (xem `docs/nutrition-persona-testing-and-bugfixes-2026-08-20.md`). Persona A đã có từ trước qua `21-ai-nutrition-chat-routing.spec.ts` (6 test case) + `23-ai-nutrition-plan-serving-realism.spec.ts` (1 test case).

## 12. UI người mới còn thiếu gì?

Đã có (xác nhận qua code + doc cũ `nutrition-product-and-evidence-review.md`'s "Root-cause notes"): field `dailyCaloriesTarget` trong `CurrentNutritionProgram.tsx` bắt đầu RỖNG (không mặc định 2000 nữa), payload bỏ qua field trống để backend/AI tự tính.

**Còn thiếu thật** (đúng như liệt kê trong `docs/research/nutrition-ai-product-and-expert-review.md` mục 4):
- Không có "Beginner Mode" tách biệt (ẩn carb/fat/fiber vào phần "xem chi tiết", chỉ hiện calo/protein/ví dụ bữa ăn trước) — hiện tại UI hiển thị đầy đủ macro cùng lúc cho mọi user.
- Không có khối giải thích ngắn kiểu "Calo là ngân sách năng lượng / Protein giúp phục hồi..." trên UI — các giải thích này hiện chỉ có trong câu trả lời chat text, không phải một UI component cố định.
- Không có toggle "Recommended vs Custom goal" rõ ràng như MyFitnessPal.
- Không có cảnh báo hiển thị TRÊN UI khi `NutritionGoal` và `NutritionProgram` đang active bị lệch nhau (xem câu 6) — chỉ là rủi ro dữ liệu, chưa có tín hiệu nào cho user biết.

---

## Kết luận audit

Phần lõi (tính toán, validate, an toàn, context hội thoại) đã khá vững và có bằng chứng test thật. Khoảng trống thực sự nằm ở: (a) đồng bộ Goal↔Plan khi goal đổi (câu 6), (b) UI beginner mode chưa xây (câu 12), (c) vi chất dinh dưỡng chưa có (đã ghi trong research doc), (d) surplus/deficit chưa phân biệt theo experience level. Không có phần nào trong 12 câu bị bỏ trống hoặc trả lời mơ hồ — mỗi câu đều có bằng chứng file/function cụ thể.
