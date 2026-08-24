# Onboarding + PT Intake + Safety — Redesign (Design Record)

> Đối chiếu trực tiếp với code thật (`rg`/Read từng file, không suy đoán). Không tin tuyệt đối các doc cũ khi mâu thuẫn với code — `FITNESS_APP_DATA_AND_FEATURE_AUDIT.md` §7.5 nói "Không có onboarding wizard" — **SAI với code hiện tại**, wizard đã tồn tại (`OnboardingWizardPage.tsx`, 718 dòng, 6 bước, đã implement khá tốt). Ghi chú này để không ai đọc audit cũ rồi tưởng cần xây từ đầu.

---

## 1. Current flow thực tế (xác nhận qua code, không phải thiết kế lý tưởng)

```text
Register (RegisterPage.tsx, 5 bước: Tài khoản → OTP → Hồ sơ → Mục tiêu → Xong)
  step 2 "Hồ sơ": dateOfBirth, gender, heightCm, currentWeight, activityLevel(ẩn, mặc định LIGHTLY_ACTIVE)
  step 3 "Mục tiêu": goal (nhãn ATHLETIC_PERFORMANCE SAI: "Cải thiện sức khỏe")
  → PUT /profile/me (KHÔNG set hasCompletedOnboarding)
  → "Vào Dashboard"
       ↓
RequireOnboarding (route guard bọc mọi route /client/*)
  đọc lại GET /profile/me → hasCompletedOnboarding vẫn false (Register chưa bao giờ set)
  → Navigate redirect BẮT BUỘC sang /client/onboarding
       ↓
OnboardingWizardPage (6 bước: level → schedule → equipment → safety → body → review)
  pre-fill lại đúng age/gender/heightCm/currentWeight/goal Register vừa lưu (đỡ gõ lại,
  nhưng KHÔNG đỡ phải bấm qua 6 bước) + hỏi MỚI: experienceLevel, trainingDays, equipment,
  injuries, competesInSport, targetWeight
  → PUT /profile/me (set hasCompletedOnboarding=true)
       ↓
Dashboard
       ↓ (nếu mua Personalized PT Service)
IntakeForm (PersonalizedServiceOrderPage.tsx)
  hỏi LẠI TỪ ĐẦU, Ô TRỐNG: age, gender, heightCm, weight, targetWeight, goal(default
  MUSCLE_GAIN — SAI nếu goal thật khác), experienceLevel(default INTERMEDIATE — SAI nếu
  khác), injuries, + hỏi mới: daysPerWeek(riêng, không phải preferredTrainingDays),
  trainingLocation, notes, consent
  → submitIntake() → lưu intakeData JSON rời rạc trong PersonalizedServiceOrder,
    KHÔNG liên kết với UserProfile
```

**Kết luận**: người dùng mới trải qua **2 wizard nối tiếp nhau** (Register 5 bước + Onboarding 6 bước = tối đa 11 màn hình) trước khi vào Dashboard lần đầu, rồi **wizard thứ 3** (Intake, ~10 field) nếu mua PT service — với **0% pre-fill** ở wizard thứ 3. Đây không phải giả thuyết — đọc trực tiếp `RegisterPage.tsx`, `RequireOnboarding.tsx`, `OnboardingWizardPage.tsx`, `PersonalizedServiceOrderPage.tsx` xác nhận đúng luồng trên.

---

## 2. Bảng field — nơi hỏi, DB lưu ở đâu, ai đọc

| Field | Register | Onboarding | Profile (edit) | Intake | DB (`user_profiles` trừ khi ghi chú) | Consumer thật (đọc code) |
|---|---|---|---|---|---|---|
| `dateOfBirth`/`age` | ✅ | (pre-fill only) | ✅ | ✅ (age only, rời rạc) | `date_of_birth`,`age` | `profile_extractor.ts`, `nutrition_engine.ts` (BMR), `coach_context_builder.ts` |
| `gender` | ✅ | (pre-fill) | ✅ | ✅ rời rạc | `gender` | như trên, `mapGenderToBiologicalSex` |
| `heightCm` | ✅ | (pre-fill) | ✅ | ✅ rời rạc | `height_cm` | BMR calc |
| `currentWeight` | ✅ | (pre-fill) | ✅ | ✅ rời rạc | `current_weight` + trigger `starting_weight` set-once | body comp, TDEE |
| `activityLevel` | ✅ **ẩn, không có UI, hard-code `LIGHTLY_ACTIVE`** | ❌ **không hỏi** | ✅ có UI (`ProfilePage.tsx:542`) | ❌ không hỏi | `activity_level` | **nạp nặng**: `nutrition_calculator.ts`, `nutrition_engine.ts` (TDEE), `coach_context_builder.ts`, `orchestrator.service.ts`, `input_parser.ts`/`intent_router.ts` (check "missing" — **không bao giờ trigger vì luôn có giá trị giả**) |
| `goal` | ✅ (nhãn `ATHLETIC_PERFORMANCE` **SAI**: "Cải thiện sức khỏe") | ✅ (nhãn đúng: "Hiệu suất thể thao") | ✅ | ✅ default cứng `MUSCLE_GAIN`, rời rạc | `goal` | Decision Engine, nutrition target |
| `experienceLevel` | ❌ | ✅ | ✅ | ✅ default cứng `INTERMEDIATE`, rời rạc | `experience_level` | `cycle-analysis.service.ts`, gating kỹ thuật nâng cao |
| `competesInSport` | ❌ | ✅ | ✅ | ❌ | `competes_in_sport` | chưa dùng rộng (đúng như `USER_LEVEL_PERSONALIZATION_PLAN.md` đã ghi — vẫn là gap thật, không phải audit sai) |
| `injuries` | ❌ | ✅ (textarea tự do) | ✅ | ✅ rời rạc | `injuries` (String[]) | **xác nhận có thật, không phải field chết**: `profile_extractor.ts:132` → `coach_context_builder.ts:258-263` → vào AI context |
| `preferredTrainingDays` | ❌ | ✅ | ✅ | ❌ (Intake hỏi `daysPerWeek` — số lượng, KHÁC field, không trùng 100%) | `preferred_training_days` (Int[]) | lịch tập |
| `preferredSplit` | ❌ | ✅ (không giải thích thuật ngữ) | ✅ | ❌ | `preferred_split` | **UI-only, Decision Engine không đọc** (comment trong `profile.models.ts` xác nhận) |
| `availableEquipment` | ❌ | ✅ (qua `UserEquipment` bảng riêng ở fitness-service, sync ngược field legacy này) | ✅ | ✅ (chỉ 1 dropdown Gym/Nhà/Cả hai, thô hơn) | `available_equipment` (legacy) + `UserEquipment` (fitness-service, nguồn thật) | filter bài tập |
| `targetWeight` | ❌ | ✅ | ✅ | ✅ rời rạc | `target_weight` | goal progress |

**4 field bị hỏi TRÙNG ở ≥2 nơi mà không pre-fill lẫn nhau**: `age/gender/heightCm/currentWeight` (Register↔Intake), `goal/experienceLevel/injuries` (Onboarding↔Intake, với default SAI ở Intake khi profile đã có giá trị khác).

**1 field bị fake bằng default, không hỏi thật**: `activityLevel`.

**1 bug nhãn ngữ nghĩa xác nhận thật**: `goal=ATHLETIC_PERFORMANCE` hiển thị 2 nhãn tiếng Việt mâu thuẫn nhau tùy màn hình.

**1 field UI-only đã xác nhận qua comment code, không phải giả định**: `preferredSplit`.

---

## 3. Quyết định thiết kế

### 3.1 Bỏ mini-wizard trong RegisterPage, không phải sửa OnboardingWizardPage

RegisterPage's step "Hồ sơ"/"Mục tiêu" là bản sao **thiếu sót và có bug** của OnboardingWizardPage (thiếu experienceLevel, activityLevel giả, goal-label sai) — bị `RequireOnboarding` redirect ngay sau đó bất kể đã điền gì. Giữ cả hai là duy trì 1 nguồn dữ liệu kém hơn chạy song song 1 nguồn tốt hơn. **Quyết định**: rút gọn RegisterPage còn đúng 3 bước (Tài khoản → OTP → Xong), xoá hẳn 2 bước Hồ sơ/Mục tiêu — `OnboardingWizardPage` (đã tốt, đã có draft-resume, đã có mọi field này + activityLevel mới thêm) là **nguồn duy nhất** thu thập profile ban đầu. Route thẳng sang `/client/onboarding` sau khi tạo tài khoản thay vì `/client/dashboard`.

### 3.2 Thêm `activityLevel` vào Onboarding bước "Chỉ số cơ thể" — hỏi thật, không default

Enum đã tồn tại (`SEDENTARY|LIGHTLY_ACTIVE|MODERATELY_ACTIVE|VERY_ACTIVE|EXTREMELY_ACTIVE`), UI selector đã có sẵn ở `ProfilePage.tsx` (tái dùng options, không thiết kế mới). Đặt ngay sau cặp Tuổi/Giới tính trong bước "Chỉ số cơ thể" — cùng nhóm ngữ nghĩa (đặc điểm cá nhân), không tạo bước mới (đúng nguyên tắc "mỗi bước thêm giảm completion" đã ghi ở `ONBOARDING_INTAKE_QUESTIONNAIRE_REVIEW.md` mục 5). **Không có giá trị mặc định được chọn sẵn** — bắt buộc chọn ở bước cuối (review) trước khi Hoàn tất, giống cách `experienceLevel`/`goal` đã bắt buộc.

### 3.3 Sửa nhãn `ATHLETIC_PERFORMANCE`

`OnboardingWizardPage.tsx`'s "Hiệu suất thể thao" đúng ngữ nghĩa với enum — dùng làm chuẩn duy nhất (không còn RegisterPage sau §3.1 nên không còn nguồn mâu thuẫn).

### 3.4 PT Intake — prefill + snapshot bất biến, không phải reference động

```text
UserProfile (đọc GET /profile/me)
   ↓
IntakeForm hiển thị read-only các field đã có (mẫu ReviewRow đã có trong
OnboardingWizardPage.tsx, tái dùng) kèm nút "Sửa" → mở edit inline ngay tại Intake
(KHÔNG điều hướng sang /client/profile rồi quay lại — Intake đã ở đúng ngữ cảnh giao
dịch, chuyển trang làm mất context mua hàng đang dở)
   ↓ submit
IntakeSnapshot — lưu NGUYÊN VẸN các giá trị tại thời điểm submit vào
PersonalizedServiceOrder.intakeData (đã là JSON, giữ nguyên cơ chế cũ — KHÔNG cần bảng
mới) — PT thấy đúng "76kg, MUSCLE_GAIN, không chấn thương" ngay cả khi 3 tháng sau
Profile đổi thành "80kg, MAINTENANCE, đau đầu gối". Cơ chế snapshot-tại-thời-điểm-mua
đã tồn tại y hệt cho `titleSnapshot/priceAtPurchase/...` ở chính model này — tái dùng
đúng pattern đã có, không phát minh mới.
```

Field thật sự mới cho Intake (không hỏi lại): `daysPerWeek` (tần suất RIÊNG cho gói PT, có thể khác lịch chung), `trainingLocation`, `notes`, consent checkboxes.

### 3.5 Safety screening — KHÔNG copy PAR-Q/PAR-Q+ nguyên văn

Đã research (xem `ONBOARDING_INTAKE_QUESTIONNAIRE_REVIEW.md` mục 2) — PAR-Q/PAR-Q+ là tài liệu có chủ sở hữu (CSEP), bản 2024 official yêu cầu quy trình follow-up qua ePARmed-X+ khi dùng đúng chuẩn lâm sàng. Sản phẩm này **không phải công cụ lâm sàng**, không có bác sĩ/kinesiologist đứng sau để xử lý nhánh follow-up đúng chuẩn. **Quyết định**: viết bộ câu hỏi riêng — "Fitness Assistant Safety Screening" — **lấy cảm hứng từ 5 chủ đề rủi ro chính** mà PAR-Q đại diện (tim mạch, đau ngực, chóng mặt/ngất, xương khớp, thuốc/chỉ định bác sĩ) nhưng viết bằng từ ngữ của sản phẩm, không dùng tên "PAR-Q" và không tuyên bố đây là công cụ sàng lọc y tế chính thức — đúng tinh thần pháp lý đã áp dụng cho FST-7/Mountain Dog ở `USER_LEVEL_PERSONALIZATION_PLAN.md` mục "Ghi chú pháp lý" (không mạo danh, không endorsement giả).

**Cần review pháp lý/lâm sàng trước khi coi là production-ready cho việc CHẶN đề xuất** — tài liệu này chỉ implement kiến trúc (enum trạng thái + propagation), đánh dấu rõ blocker ở báo cáo cuối.

### 3.6 Trạng thái an toàn — enum + propagation, không phải warning text đơn thuần

```prisma
enum SafetyScreeningStatus {
  UNKNOWN              // chưa từng hỏi (user cũ trước khi tính năng này ra mắt)
  CLEARED               // đã hỏi, không có cờ đỏ nào
  FOLLOW_UP_SUGGESTED   // có ít nhất 1 câu trả lời "Có" — khuyến nghị hỏi ý kiến bác sĩ, KHÔNG chặn
}
```

Không dùng `RESTRICTED`/chặn cứng ở bản này — đúng nguyên tắc "không chặn cứng, chỉ cảnh báo, tôn trọng quyền tự quyết" đã áp dụng nhất quán cho mọi cảnh báo khác trong hệ thống (BEGINNER tần suất cao, `unsafe_weight_loss_request`, v.v. — xem `orchestrator.service.ts`). Lý do không thêm `RESTRICTED`: sản phẩm chưa có ai (bác sĩ/PT) đứng sau để "duyệt" chuyển trạng thái đó về `CLEARED`, nên một trạng thái chặn-cứng sẽ là ngõ cụt cho user, không phải một quy trình an toàn thật.

Propagate: `safetyScreeningStatus` + `safetyScreeningFlags: string[]` (các câu đã trả lời "Có", lưu key không lưu nguyên văn câu hỏi — đổi copy câu hỏi sau này không làm dữ liệu cũ sai nghĩa) vào `UserProfile`, đọc bởi `profile_extractor.ts` → `coach_context_builder.ts` (cùng đường injuries đã đi) → prompt AI luôn chèn "người dùng có {flag}, ưu tiên khuyến nghị thận trọng/hỏi bác sĩ trước khi tăng cường độ" khi `FOLLOW_UP_SUGGESTED`.

### 3.7 Beginner — không ẩn cứng "Kiểu chia lịch", cho chọn "Đề xuất cho tôi"

```text
Bạn muốn hệ thống chọn lịch phù hợp?
  ● Đề xuất cho tôi (mặc định cho BEGINNER)
  ○ Tôi tự chọn kiểu chia lịch
```

Chỉ khi chọn "Tôi tự chọn" mới hiện dropdown Push/Pull/Legs/... — tôn trọng đúng yêu cầu "không hard-code Beginner = luôn Full Body" (`preferredSplit` vẫn là field UI-only theo comment code hiện tại — "đề xuất cho tôi" chỉ đơn giản là để trống `preferredSplit`, không tạo logic chọn-hộ mới ở tầng frontend).

---

## 4. Không làm trong lượt này (P1/P2 — lý do rõ ràng)

| Việc | Vì sao hoãn |
|---|---|
| Mở rộng `goal` enum lên 6 giá trị (Phase 4 gợi ý) | Không phải bug — 4 giá trị hiện tại không mâu thuẫn dữ liệu, chỉ kém chi tiết hơn lý tưởng. Mở rộng enum đụng migration + tất cả consumer (Decision Engine, nutrition target, AI prompt) — rủi ro cao hơn lợi ích trong lượt tập trung vào duplicate/safety này. |
| Athlete branch đầy đủ (sport/discipline/PR theo môn) | Đúng như `USER_LEVEL_PERSONALIZATION_PLAN.md` §D đã tự nhận: cần schema `TrainingBlockPlan`/`peakingDate` mới, chưa tồn tại — việc lớn riêng, không nên làm vội trong lượt sửa duplicate. |
| PersonalizationContext normalize toàn hệ thống | `coach_context_builder.ts`/`profile_extractor.ts` đã là 2 điểm hội tụ tương đối tốt (không phải tình trạng "mỗi AI tự đọc profile 1 kiểu" như lo ngại) — refactor lớn không có bug cụ thể đang xảy ra để biện minh trong lượt này. |
| Plan snapshot/explainability (Phase 15) | Ngoài phạm vi trực tiếp của duplicate-intake/safety; PersonalizedService đã có snapshot pattern làm ví dụ tốt, nhưng áp cho WorkoutPlan/NutritionPlan là việc riêng. |
| Progressive profiling sau onboarding (Phase 13) | Cần chọn đúng thời điểm/trigger theo từng feature — thiết kế riêng, không đoán bừa trong lượt này. |

---

## 5. Việc sẽ làm (P0) — chi tiết ở báo cáo implementation

1. Migration: thêm `activityLevel` KHÔNG có default ở tầng application (giữ nullable ở DB, đã nullable sẵn — không cần migration schema, chỉ cần UI mới).
2. Migration: thêm `safetyScreeningStatus` (enum, default `UNKNOWN`) + `safetyScreeningFlags` (String[], default rỗng) vào `UserProfile`.
3. Sửa `RegisterPage.tsx`: xoá bước Hồ sơ/Mục tiêu, chuyển hướng sau đăng ký sang Onboarding.
4. Sửa `OnboardingWizardPage.tsx`: thêm activityLevel input, thêm bước Safety Screening (gộp vào bước "Sức khỏe & An toàn" đã có), thêm toggle "Đề xuất cho tôi" cho split.
5. Sửa `PersonalizedServiceOrderPage.tsx`'s `IntakeForm`: đọc profile, hiển thị read-only+Sửa cho field đã có, chỉ hỏi field mới thật.
6. Cập nhật `profile_extractor.ts`/`coach_context_builder.ts`: đọc + propagate `safetyScreeningStatus`/`safetyScreeningFlags`.
7. Test: unit (profile.models), integration (API), Playwright E2E (đăng ký mới → onboarding → mua PT service → intake pre-filled).
