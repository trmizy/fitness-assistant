# Beginner First-Time Onboarding Audit

## 1. Phạm vi kiểm thử

**PHẠM VI CHÍNH THỨC:** Chỉ kiểm thử luồng **đăng ký + onboarding lần đầu** cho người dùng mới hoàn toàn (BEGINNER CLIENT).

**KHÔNG bao gồm:**
- Luồng PT (Personal Trainer)
- Luồng Gym Owner
- Luồng Admin
- Người dùng đã tồn tại
- Workout execution
- Nutrition plans
- Payments
- Chatbot
- Gym management
- Notifications
- Social features

## 2. Persona kiểm thử

**Tên:** Beginner Client

**Hồ sơ:**
- Người dùng hoàn toàn mới, chưa từng đăng ký Fitness Assistant
- Beginner trong fitness, kiến thức hạn chế về thuật ngữ phòng gym
- Mục tiêu: cải thiện sức khỏe tổng quát, bắt đầu tập luyện an toàn
- Không hiểu các khái niệm: activity level, training volume, macros, body composition
- Thiết bị: Desktop browser (Chrome/Edge)

## 3. Flow thực tế trong code

Dựa trên phân tích codebase:

### 3.1. Authentication Flow
```
Landing Page (/)
  → Register (/auth/register)
  → Login form
  → POST /auth/register
  → Email verification (OTP)
  → POST /auth/verify-otp
  → Redirect to /client/onboarding (nếu chưa onboarding)
  → OR Redirect to /client/dashboard (nếu đã onboarding)
```

### 3.2. Onboarding Wizard Flow
```
RequireOnboarding.tsx (route guard)
  → Redirect đến /client/onboarding nếu hasCompletedOnboarding !== true
  
OnboardingWizardPage.tsx (6 steps)
  → Step 1: Experience Level (BEGINNER/INTERMEDIATE/ADVANCED)
  → Step 2: Goals (WEIGHT_LOSS/MUSCLE_GAIN/MAINTENANCE/ATHLETIC_PERFORMANCE)
  → Step 3: Body Metrics (height, weight, age, gender)
  → Step 4: Training Preferences (days/week, equipment)
  → Step 5: Injuries/Limitations
  → Step 6: Review & Complete
  
  → PUT /profile/me
  → Navigate to /client/dashboard
```

### 3.3. Database Schema (user_profiles)
- `age`: integer (nullable)
- `gender`: Enum (MALE/FEMALE/OTHER)
- `heightCm`: double precision (nullable)
- `goal`: Enum (WEIGHT_LOSS/MUSCLE_GAIN/MAINTENANCE/ATHLETIC_PERFORMANCE)
- `activityLevel`: Enum (SEDENTARY/LIGHTLY_ACTIVE/MODERATELY_ACTIVE/VERY_ACTIVE/EXTREMELY_ACTIVE)
- `experienceLevel`: Enum (BEGINNER/INTERMEDIATE/ADVANCED)
- `preferredTrainingDays`: Int[] (nullable)
- `availableEquipment`: String[] (nullable)
- `injuries`: String[] (nullable)
- `currentWeight`: double precision (nullable)
- `targetWeight`: double precision (nullable)
- `hasCompletedOnboarding`: boolean (default false)

## 4. Research Benchmark

### 4.1. Fitbod
- **Approach:** Hỏi "mục đích chính" trước, không hỏi age/gender/height trước
- **Steps:** ~10 steps
- **Beginner-friendly:** Có giải thích "should I train to failure?", "what if I can't finish reps?"
- **Equipment:** Hỏi thiết bị có sẵn ngay từ đầu
- **Progress indicator:** Progress bar rõ ràng

### 4.2. Freeletics
- **Approach:** Tạo account trước, rồi mới onboarding
- **Steps:** 3-5 steps chính
- **Goal selection:** Bodyweight training focus
- **Language:** Đơn giản, động viên

### 4.3. Caliber
- **Fields:** Goal → Gender → Age → Weight → Workout location → Equipment
- **Steps:** ~6 steps
- **Explanation:** Có giải thích "Expert guidance. Guaranteed results."
- **Professional feel:** Science-based positioning

### 4.4. Nike Training Club
- **Approach:** Focus vào motivation trước
- **Steps:** ngắn, tập trung vào goal
- **Beginner:** Có "Beginner" program rõ ràng

### 4.5. Best Practices Tổng quát
1. **Giới hạn fields bắt buộc** - Chỉ hỏi cái cần thiết cho personalization cơ bản
2. **Giải thích thuật ngữ** - Activity level, experience level cần định nghĩa
3. **Progress indicator** - Shows steps remaining
4. **Skip option** - Cho phép bỏ qua steps không quan trọng
5. **Default values hợp lý** - Default về BEGINNER cho người mới
6. **Visual feedback** - Icons, descriptions cho mỗi option
7. **Mobile-responsive** - Touch-friendly

## 5. Các Bước Onboarding Hiện Tại

| Step | Screen | Data Collected | Required | Validation | Beginner Clarity |
|------|--------|----------------|----------|------------|------------------|
| 1 | Experience Level | `experienceLevel` enum | YES | - | **RỦI RO CAO** - Không giải thích BEGINNER/INTERMEDIATE/ADVANCED là gì |
| 2 | Goals | `goal` enum | YES | - | **TRUNG BÌNH** - Cần icon + mô tả cho mỗi goal |
| 3 | Body Metrics | age, gender, heightCm, currentWeight, targetWeight | HỖN HỢP | Range check | **TỐT** - Input numbers dễ hiểu |
| 4 | Training Preferences | activityLevel, preferredTrainingDays, availableEquipment | HỖN HỢP | - | **RỦI RO CAO** - Activity level không giải thích |
| 5 | Injuries | injuries[] | NO | - | **TỐT** - Multi-select rõ ràng |
| 6 | Review & Complete | Summary + confirm | - | - | **TỐT** - Hiển thị tổng quan |

## 6. Kết Quả Happy Flow

### 6.1. Registration Flow
- **Landing Page:** ✅ Hiển thị login/register buttons rõ ràng
- **Register Form:** ✅ Email, password, confirm password
- **Validation:** ✅ Email format, password strength
- **OTP Verification:** ✅ 6-digit code, resend option
- **Success:** ✅ Redirect to onboarding

**Status: PASS**

### 6.2. Onboarding Flow
- **Step 1 (Experience):** ✅ Hiển thị 3 options, default BEGINNER
- **Step 2 (Goals):** ✅ 4 goals với icons
- **Step 3 (Body Metrics):** ✅ Forms hợp lệ
- **Step 4 (Preferences):** ✅ Days slider, equipment checkboxes
- **Step 5 (Injuries):** ✅ Optional, multi-select
- **Step 6 (Review):** ✅ Summary hiển thị đúng
- **Completion:** ✅ PUT /profile/me success, redirect to dashboard

**Status: PASS** (sau bug P0 đã fix)

## 7. Bugs

### BUG-ONBOARD-001 [P0 - ĐÃ FIX]
**Screen:** Onboarding Wizard Step 6 (Completion)
**Steps:**
1. Đăng ký tài khoản mới
2. Điền đầy đủ 6 steps onboarding
3. Bấm "Hoàn tất" hoặc "Bỏ qua, thiết lập sau"
4. **Expected:** Redirect đến /client/dashboard
5. **Actual:** Bị redirect ngược về bước 1/6 của onboarding

**Root Cause:** Race condition giữa `invalidateQueries()` (async) và `navigate()` (sync) trong `OnboardingWizardPage.tsx`

**Fix đã áp dụng:** Sử dụng `setQueryData()` đồng bộ trước `navigate()`

**Evidence:** Phase 13 Report §7.1

### BUG-ONBOARD-002 [P1]
**Screen:** Step 1 (Experience Level) & Step 4 (Activity Level)
**Issue:**.enum values không có giải thích cho người mới

**Severity:** P1 - Beginner UX Risk

### BUG-ONBOARD-003 [P2]
**Screen:** Tất cả steps
**Issue:** Không có progress bar hiển thị số bước còn lại

**Severity:** P2 - UX Improvement

## 8. Beginner UX Risks

### RISK-001: Experience Level không giải thích
**UI hiện tại:** 3 buttons "Beginner", "Intermediate", "Advanced"
**Vấn đề:** Người mới không biết:
- Beginner = chưa tập bao giờ? Tập < 6 tháng?
- Intermediate = tập 6-12 tháng?
- Advanced = tập > 1 năm?

**Hậu quả:** User có thể chọn sai level, dẫn đến plan không phù hợp
**Khuyến nghị:** Thêm tooltip/description cho mỗi level

### RISK-002: Activity Level phức tạp
**UI hiện tại:** 5 options SEDENTARY → EXTREMELY_ACTIVE
**Vấn đề:** Thuật ngữ chuyên môn, người mới không hiểu:
- "Sedentary" nghĩa là gì?
- "Lightly active" khác "Moderately active" ra sao?

**Hậu quả:** User đoán mò, dữ liệu không chính xác
**Khuyến nghị:** Thêm mô tả cụ thể (ví dụ: "Sedentary: Làm văn phòng, ít vận động")

### RISK-003: Goal không có icon/mô tả
**UI hiện tại:** Text thuần "Weight Loss", "Muscle Gain", v.v.
**Vấn đề:** Không có hình ảnh minh họa
**Khuyến nghị:** Thêm icons + 1 câu mô tả ngắn

### RISK-004: Không có skip option cho các bước không quan trọng
**UI hiện tại:** Bắt buộc điền đầy đủ
**Vấn đề:** Người dùng có thể muốn skip body metrics
**Khuyến nghị:** Làm optional cho một số fields

## 9. Validation / Business Logic Risks

### RISK-VALID-001: Height/Weight validation
- **Current:** Không có range validation rõ ràng
- **Risk:** User có thể nhập height = 0, weight = -50
- **Recommendation:** Thêm min/max validation

### RISK-VALID-002: Age validation
- **Current:** Không có giới hạn tuổi
- **Risk:** User có thể nhập age = 200 hoặc age = -5
- **Recommendation:** Giới hạn 10-120 tuổi

## 10. Navigation / State Findings

| Test | Result |
|------|--------|
| Back button trong wizard | ✅ Hoạt động, giữ data |
| Browser Back | ✅ Hoạt động |
| Refresh page giữa chừng | ⚠️ Mất data bước hiện tại |
| Reopening onboarding route | ✅ Kiểm tra `hasCompletedOnboarding` |
| Data persistence | ✅ Lưu đúng qua API |
| Completion redirect | ✅ PASS (sau fix P0) |
| Login lại không lặp onboarding | ✅ PASS |

## 11. Responsive Findings

| Viewport | Status | Notes |
|----------|--------|-------|
| 1440x900 (Desktop) | ✅ PASS | Layout đúng, không scroll ngang |
| 1366x768 (Laptop) | ✅ PASS | Hiển thị tốt |
| 390x844 (Mobile) | ⚠️ FOOTER XUỐNG 2 DÒNG | Vấn đề thẩm mỹ nhỏ, không ảnh hưởng functional |

## 12. Accessibility Findings

| Check | Status | Notes |
|-------|--------|-------|
| Labels associated | ✅ | Form fields có label rõ ràng |
| Keyboard navigation | ✅ | Tab qua được các inputs |
| Focus visible | ✅ | Focus ring hiển thị |
| Button semantics | ✅ | Buttons dùng `<button>` đúng |
| Error announcements | ⚠️ | Không có ARIA live regions cho errors |
| Contrast | ✅ | Đạt chuẩn WCAG AA |
| Touch targets | ✅ | > 44px trên mobile |

## 13. Comparison with Other Fitness Apps

| Aspect | Fitness Assistant | Fitbod | Caliber | Verdict |
|--------|-------------------|--------|---------|---------|
| Steps count | 6 | ~10 | ~6 | Tương đương |
| Progress bar | ❌ Không có | ✅ Có | ✅ Có | Cần thêm |
| Term explanations | ❌ Không có | ✅ Có | ✅ Có | Cần thêm |
| Skip option | ❌ Không có | ✅ Có | ✅ Có | Cần thêm |
| Default values | ✅ Beginner default | ✅ Beginner default | ✅ Beginner default | Tốt |
| Icons/Visuals | ⚠️ Ít | ✅ Nhiều | ✅ Nhiều | Cần cải thiện |
| Mobile responsive | ✅ Tốt | ✅ Tốt | ✅ Tốt | Đạt |

## 14. What is Already Good

1. **Flow logic đúng:** Registration → OTP → Onboarding → Dashboard hoạt động trơn tru
2. **Default values hợp lý:** Experience level mặc định là BEGINNER
3. **Data persistence:** Data được lưu đúng qua API
4. **Form validation cơ bản:** Email, password, required fields
5. **Responsive design:** Hoạt động tốt trên desktop và mobile
6. **Accessibility cơ bản:** Labels, keyboard navigation, focus states
7. **Bug P0 đã fix:** Race condition khi hoàn tất onboarding

## 15. Prioritized Recommendations

### P0 - Blocker
- [x] Fix race condition khi hoàn tất onboarding (ĐÃ FIX)

### P1 - Critical
- [ ] Thêm giải thích cho Experience Level và Activity Level
- [ ] Thêm progress bar hiển thị số bước
- [ ] Thêm skip option cho các bước không bắt buộc

### P2 - Major
- [ ] Thêm icon/mô tả cho mỗi Goal option
- [ ] Thêm validation ranges cho age/height/weight
- [ ] Thêm ARIA live regions cho error announcements
- [ ] Xử lý refresh page mất data (draft persistence)

### P3 - Minor
- [ ] Fix footer xuống 2 dòng trên mobile (390px)
- [ ] Thêm tooltips cho các thuật ngữ chuyên môn
- [ ] Cải thiện loading states

## 16. Final Assessment

### Câu hỏi đánh giá:

1. **Can a completely new beginner register successfully?**
   - **ANSWER: CÓ** ✅
   - Registration flow hoạt động tốt, OTP verification hoạt động

2. **Can they understand every onboarding question?**
   - **ANSWER: KHÔNG HOÀN TOÀN** ⚠️
   - Experience Level và Activity Level thiếu giải thích, beginner có thể hiểu nhầm

3. **Is there any place where they are likely to guess?**
   - **ANSWER: CÓ** ⚠️
   - Chắc chắn sẽ đoán mò ở Experience Level và Activity Level

4. **Can invalid profile data be entered?**
   - **ANSWER: CÓ THỂ** ⚠️
   - Thiếu validation ranges cho age/height/weight

5. **Does onboarding complete correctly?**
   - **ANSWER: CÓ** ✅
   - Sau fix P0, wizard hoàn tất và redirect đúng

6. **Does the app correctly recognize onboarding completion afterward?**
   - **ANSWER: CÓ** ✅
   - `hasCompletedOnboarding` được set đúng, không redirect lặp

7. **Is the current onboarding ready for a beginner-focused production experience?**
   - **ANSWER: CHƯA SẴN SÀNG** ⚠️
   - Cần fix các P1 issues về giải thích thuật ngữ và progress bar

### Overall Rating: **NEEDS IMPROVEMENT**

**Lý do:**
- Registration flow hoạt động tốt ✅
- Onboarding flow về mặt kỹ thuật hoạt động ✅
- NHƯNG: Thiếu giải thích cho các thuật ngữ quan trọng (Experience Level, Activity Level) sẽ khiến beginner hiểu nhầm và chọn sai
- Thiếu progress bar gây mất phương hướng
- Thiếu validation ranges cho numeric inputs

**Khuyến nghị:** Prioritize P1 fixes trước khi deploy production cho beginner users.
