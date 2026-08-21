# Nutrition AI — Product & Expert Review

**Ngày**: 2026-08-20
**Mục đích**: Tổng hợp nguồn khoa học + app tham khảo trước khi tiếp tục sửa AI dinh dưỡng, theo đúng yêu cầu Phần 5 của spec. Tài liệu này KHÔNG lặp lại `docs/research/nutrition-product-and-evidence-review.md` (viết ngày 2026-08-18) — đối chiếu và mở rộng thêm 3 nguồn spec yêu cầu mà tài liệu cũ chưa có (bodybuilding cutting-phase review, USDA FoodData Central, Vietnamese Food Composition Table), đồng thời liệt kê rõ rule nào đã implement thật (có bằng chứng code + test) so với rule nào chưa.

---

## 1. Nguồn khoa học/chuyên gia

| # | Source | Loại nguồn | Kết luận dùng cho app | Rule đã implement | Rule chưa implement |
|---|---|---|---|---|---|
| 1 | [ISSN Position Stand: Protein and Exercise](https://link.springer.com/article/10.1186/s12970-017-0177-8) | Position stand (peer-reviewed) | Người tập thường cần 1.4–2.0g protein/kg/ngày; người tập sức mạnh/tăng cơ nên ở khoảng 1.6–2.2g/kg/ngày; 20-40g/bữa là khung thực tế. | `nutrition_calculator.ts`: protein 2.0g/kg (fat_loss), 1.8g/kg (muscle_gain), 1.9g/kg (recomposition), 1.6g/kg (maintenance) — nằm trong khung khuyến nghị. Serving-cap (`nutrition.processor.ts`) giới hạn powder/isolate ≤40g mỗi lần, tránh dồn hết đạm vào 1 nguồn. | Chưa có UI hiển thị rõ "vì sao 1.8g/kg" cho người dùng cuối (chỉ có trong prompt/response text, không có trang giải thích riêng). |
| 2 | [Morton et al. 2018 — protein meta-analysis](https://pubmed.ncbi.nlm.nih.gov/28698222/) | Systematic review/meta-analysis | Đạm hỗ trợ hypertrophy khi tập kháng lực, lợi ích có xu hướng chững lại quanh ~1.6g/kg với nhiều người (dù khoảng tin cậy cho phép cao hơn). | `MealRealismScorer`-tương đương (`nutrition.processor.ts`'s serving caps) gián tiếp ngăn AI đề xuất đạm vượt xa nhu cầu hợp lý bằng cách chặn khẩu phần powder/isolate lớn. `answer_validator.ts` cảnh báo khi số đạm LLM nêu lệch >20% so với target xác định. | Chưa có rule "chặn cứng tổng đạm/ngày vượt trần tuyệt đối" (vd: >3g/kg) ở tầng validator — mới chỉ chặn qua serving-cap từng món. |
| 3 | [ISSN Position Stand: Nutrient Timing](https://link.springer.com/article/10.1186/s12970-017-0189-4) | Position stand | Tổng đạm/ngày quan trọng hơn timing; nên chia đều đạm các bữa (20-40g/bữa); carb quanh buổi tập có ích hơn với người tập volume cao. | **Mới xây trong lượt trước** (`nutrient_timing_request` intent — `intent_router.ts`/`prompt_builder.ts`/`response_formatter.ts`): trả lời trực tiếp câu hỏi trước/sau tập, nói rõ "không cần thần thánh hoá cửa sổ 30 phút", đúng tinh thần nguồn này. | Chưa có rule tự động kiểm tra "đạm đã được chia đều giữa các bữa chưa" khi sinh thực đơn đầy đủ (chỉ có ở câu trả lời timing riêng, chưa áp dụng cho `meal_plan_request`). |
| 4 | [ACSM/AND/DC — Nutrition and Athletic Performance](https://pubmed.ncbi.nlm.nih.gov/26891166/) | Consensus statement | Dinh dưỡng thể thao phải cá nhân hóa theo loại hình tập, tải tập, lịch tập — không dùng 1 con số chung cho mọi người. | `nutrition_calculator.ts` cá nhân hóa theo goal (fat_loss/muscle_gain/recomposition/maintenance) + activityLevel (5 mức, hệ số 1.2-1.9). `nutrition-decision.engine.ts` đánh giá theo dữ liệu thực tế (weight trend) chứ không áp đặt tĩnh. | Chưa phân biệt macro theo **ngày tập nặng vs ngày nghỉ** ở tầng deterministic calculator (AI có thể trả lời qua RAG/LLM khi được hỏi trực tiếp — đã test qua Persona C — nhưng không phải một field/rule tính toán riêng). |
| 5 | [Iraki/Helms/Fitschen et al. — Bodybuilding off-season nutrition](https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/) | Narrative review | Lean bulk nên surplus nhẹ (~10-20% cho novice/intermediate, ~5-10% cho advanced); protein 1.6-2.2g/kg; fat 0.5-1.5g/kg hoặc 20-35% kcal. | `nutrition_calculator.ts`: muscle_gain surplus = **+10%** maintenance (đúng khung novice/intermediate); fat 0.9g/kg (trong khung 0.5-1.5g/kg). | Chưa phân biệt surplus theo **experience level** (advanced nên thấp hơn ~5-10%, hiện tại code dùng chung +10% cho mọi trình độ) — đây là khoảng trống thật, ghi vào mục "còn thiếu" bên dưới. |
| 6 | [IOC RED-S Consensus 2023](https://bjsm.bmj.com/content/57/17/1073) | Consensus statement | Thiếu năng lượng kéo dài (low energy availability) gây rủi ro hiệu suất/nội tiết/xương, kể cả khi không có rối loạn ăn uống rõ ràng. | **Mới xây trong lượt trước**: `safety_guard.ts`'s `severe_energy_restriction_warning` (800-1199 kcal/ngày, hoặc ngôn ngữ cắt mạnh + tần suất tập cao) — trích dẫn trực tiếp RED-S trong comment code. Cộng với `unsafe_extreme_calorie_request` (<800kcal) đã có từ trước. | Chưa có screening có cấu trúc (vd: hỏi về chu kỳ kinh nguyệt, mật độ xương, BMI floor) — mới dừng ở cảnh báo văn bản khi phát hiện qua từ khóa/số liệu trong câu hỏi. |
| 7 | [MacroFactor — Check-ins & Coaching Modules](https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules) | Tài liệu sản phẩm chính thức | Điều chỉnh theo tuần dựa trên xu hướng cân + đủ dữ liệu log (khuyến nghị ≥4 ngày log ăn/tuần, cân ≥1 lần/tuần tốt hơn 3 lần). Đề xuất là **proposal**, user có thể từ chối. | `nutrition-decision.engine.ts` có state `REQUEST_MORE_DATA` khi thiếu mẫu; `weight-trend.util.ts` có `MIN_WEIGHT_SAMPLES`/`TREND_WINDOW_DAYS` (cấu hình ở `cycle-thresholds.config.ts`). `nutrition-adaptive-apply.integration.test.ts` xác nhận accept/decline flow thật (không tự áp đặt). | Chưa strict theo đúng số "4 ngày log/tuần" của MacroFactor — ngưỡng hiện tại dùng khái niệm mẫu cân nặng (weight samples), không tính riêng số ngày log bữa ăn. |
| 8 | [Cronometer — Nutrient Targets](https://support.cronometer.com/hc/en-us/articles/360060170532-Nutrient-Targets) | Tài liệu sản phẩm | Theo dõi không chỉ macro mà cả vi chất (fiber/sodium/vitamin...); có target/threshold riêng biệt cho từng vi chất. | USDA import (`usda.mapper.ts`) có ingest dữ liệu vi chất vào **research dataset**, không phải catalog Food đang dùng để lên thực đơn thật. | **Chưa implement** — `Food` model (fitness-service, bảng dùng cho meal plan thật) không có cột fiber/sodium/vitamin nào; hoàn toàn chưa có tính năng theo dõi vi chất cho user. |
| 9 | [MyFitnessPal — Goal customization](https://support.myfitnesspal.com/hc/en-us/articles/360032274432-Customize-your-nutritional-goals) | Tài liệu sản phẩm | User có thể dùng recommended goals hoặc tự custom; app cảnh báo khi calo quá thấp. | `nutrition-goal-macro-validator.ts` + `answer_validator.ts`'s Atwater-consistency check (protein×4+carb×4+fat×9 so với tổng kcal nêu) — đúng tinh thần "cảnh báo khi số liệu tự nhập không khớp". `NutritionGoal` versioning (ACTIVE/SUPERSEDED) cho phép custom rồi lưu lịch sử, không mất version cũ. | Chưa có UI riêng "recommended vs custom goal toggle" — hiện tại chỉ có 1 luồng tạo goal, chưa phân 2 chế độ rõ ràng như MFP. |
| 10 | [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/) | Cơ sở dữ liệu công (public domain/CC0) | Nguồn ingredient nền an toàn về license, có thể dùng trực tiếp. | **Đã là nguồn chính của catalog `Food` hiện tại** (13,159 dòng, xác nhận nhiều lần trong session này qua audit DB thật). Toàn bộ Gate 10 (15 món Việt) đều map nguyên liệu từ catalog gốc từ USDA. | — (đã dùng đúng, không có khoảng trống). |
| 11 | [FAO Vietnamese Food Composition Table 2007](https://www.fao.org/food-composition/tables-and-databases/detail/%28viet-nam--2007%29-vietnamese-food-composition-table/en) | Bảng thành phần dinh dưỡng quốc gia | Nguồn tham khảo tên món/logic dinh dưỡng Việt Nam — **license chưa xác minh rõ cho việc import số liệu hàng loạt**. | Chưa import bất kỳ số liệu nào từ nguồn này — đúng nguyên tắc "không dùng dữ liệu/license không rõ" đã áp dụng xuyên suốt Gate 10 (vd. rau muống/mắm ruốc bị loại khỏi batch vì không có trong USDA, không tự bịa số liệu từ nguồn khác chưa rõ license). | Nếu muốn thêm món Việt đặc thù (rau muống, mắm ruốc...) cần: (a) xác minh license nguồn này trước, hoặc (b) tìm nguồn thay thế đã rõ quyền sử dụng — chưa làm trong bất kỳ lượt nào. |

## 2. App tham khảo (không lấy dữ liệu proprietary, chỉ tham khảo hành vi sản phẩm)

Đã research chi tiết trong `docs/research/nutrition-product-and-evidence-review.md` (2026-08-18) — tóm tắt lại kết luận chính, không lặp lại toàn bộ bảng:

| App | Hành vi tham khảo | Đã áp dụng vào app này chưa |
|---|---|---|
| **MacroFactor** | Check-in tuần dựa trên trend + đủ dữ liệu; đề xuất chứ không tự áp đặt. | Có — `nutrition-decision.engine.ts` + accept/decline flow (`nutrition-adaptive-apply.integration.test.ts`). |
| **Cronometer** | Tách bạch target/kế hoạch/thực tế; theo dõi vi chất. | Một phần — tách target/thực tế đã có qua `NutritionGoal`/mealPlan; vi chất **chưa có**. |
| **MyFitnessPal** | Recommended vs custom goal; cảnh báo calo quá thấp; meal planner theo dị ứng/sở thích. | Một phần — cảnh báo calo thấp đã có (2 tầng: extreme + severe_energy_restriction mới); recommended/custom toggle UI **chưa có**. |
| **RP Diet Coach** | Ưu tiên calo+protein trước, carb/fat linh hoạt sau; guardrail cứng (BMI floor, min fat/carb, thời lượng diet tối đa). | Một phần — có validator macro/calo nhưng chưa có guardrail cứng kiểu "BMI floor" hay "giới hạn thời lượng cắt calo liên tục". |

## 3. Tổng hợp: rule đã implement (có bằng chứng test thật, không phải giả định)

1. Mifflin-St Jeor BMR/TDEE, `confidence: "low"` khi thiếu tuổi/chiều cao/cân nặng (không bịa số).
2. Protein/fat/carb theo goal, trong khung ISSN + bodybuilding literature (xem bảng #1, #5).
3. Atwater consistency check — macro không khớp kcal bị validator bắt (kể cả câu trả lời tiếng Việt, sau bugfix mới nhất).
4. Serving-cap chống khẩu phần phi thực tế (soy isolate/egg-white powder/parmesan...) — tương đương MealRealismScorer, đã E2E-verify (`23-ai-nutrition-plan-serving-realism.spec.ts`).
5. Weekly/trend-based adjustment (KEEP_PLAN/PROPOSE_ADJUSTMENT/REQUEST_MORE_DATA/EARLY_REVIEW/ESCALATE) — không phản ứng theo 1 ngày lẻ.
6. NutritionGoal versioning — không mất lịch sử khi đổi mục tiêu.
7. Safety triage nhiều tầng: y tế cấp cứu, bệnh lý nền, vị thành niên, mang thai, rối loạn ăn uống, dị ứng nặng, calo cực thấp (<800), **và calo rủi ro (800-1199, mới thêm)**.
8. Nutrient-timing câu hỏi riêng (trước/sau tập) — không ép ra cả thực đơn khi chỉ hỏi 1 câu ngắn.

## 4. Rule chưa implement (nói thẳng, không giấu)

1. Vi chất dinh dưỡng (fiber/sodium/vitamin) — hoàn toàn chưa có ở tầng catalog/UI dùng thật.
2. Surplus/deficit chưa phân biệt theo **experience level** (advanced nên thấp hơn) — hiện dùng chung 1 hệ số theo goal.
3. Training-day vs rest-day macro như một **field/rule tính toán riêng** (AI trả lời được qua RAG/LLM khi hỏi trực tiếp, nhưng không phải deterministic calculator).
4. Guardrail cứng kiểu RP Diet Coach (BMI floor, giới hạn thời lượng cắt calo liên tục).
5. Recommended vs custom goal — UI toggle rõ ràng như MyFitnessPal.
6. Screening RED-S có cấu trúc (không chỉ dựa từ khóa/số liệu trong câu hỏi).
7. Import dữ liệu từ Vietnamese Food Composition Table — chưa làm vì chưa rõ license, đúng nguyên tắc đã áp dụng.

## 5. Không claim y khoa quá mức

Tài liệu và code trong app **không** tự nhận là lời khuyên y khoa cá nhân hóa hoàn chỉnh — mọi cảnh báo (RED-S, bệnh lý nền, rối loạn ăn uống...) đều dẫn tới khuyến nghị gặp bác sĩ/chuyên gia dinh dưỡng thể thao, không tự đưa phác đồ điều trị. Các con số (1.6-2.2g/kg protein, surplus 10%, deficit 15%...) là **khung tham khảo từ review/position stand đã có nguồn trích dẫn**, không phải số tự nghĩ ra.
