# User-Level Personalization Plan — 4 nhóm người dùng

> Design record. Use current schemas, routes, and tests to determine which
> proposed items are implemented.

> Thiết kế logic riêng cho 4 nhóm người dùng: A. Người mới, B. Người đã biết tập, C. Người tập lâu năm, D. Vận động viên chuyên nghiệp. Đối chiếu với hiện trạng code thật (`experienceLevel` đã tồn tại BEGINNER/INTERMEDIATE/ADVANCED/UNKNOWN — xem `docs/gym-fitness-research.md` mục 10 cho cơ sở khoa học ACSM đứng sau thiết kế này).
>
> **Không implement trong tài liệu này** — đây là bản thiết kế chờ approval.

---

## 0. Ánh xạ 4 nhóm người dùng ↔ `experienceLevel` hiện có

Hệ thống hiện chỉ có **4 giá trị**: `BEGINNER | INTERMEDIATE | ADVANCED | UNKNOWN`. Yêu cầu của người dùng có **4 nhóm** nhưng nhóm D ("vận động viên chuyên nghiệp") không có enum riêng — cần quyết định:

**Đề xuất**: KHÔNG thêm enum thứ 5 (`PROFESSIONAL`) vào `experienceLevel` — thay vào đó, "chuyên nghiệp" là **tổ hợp của `ADVANCED` + một cờ bổ sung** (`competesInSport: boolean` hoặc `trainingGoal === "COMPETITION_PREP"`), vì về mặt sinh lý học tập luyện, một VĐV chuyên nghiệp và một lifter nâng cao lâu năm dùng **cùng nguyên tắc autoregulation/periodization** (ACSM không phân biệt "advanced" với "professional" — chỉ có 3 mức). Sự khác biệt thực sự nằm ở: mục tiêu (thi đấu vs. giải trí), mức độ giám sát cần thiết, và độ chi tiết dashboard — không phải ở công thức tính toán khác nhau.

| Nhóm yêu cầu | `experienceLevel` | Cờ bổ sung đề xuất | Lý do tách |
|---|---|---|---|
| A. Người mới | `BEGINNER` hoặc `UNKNOWN` | — | ACSM: tần suất 2-3 ngày/tuần, 8-12RM |
| B. Người đã biết tập | `INTERMEDIATE` | — | ACSM: dải tải rộng hơn, periodized |
| C. Người tập lâu năm | `ADVANCED` | — | ACSM: 4-5 ngày/tuần, nhấn tải nặng |
| D. VĐV chuyên nghiệp | `ADVANCED` | `competesInSport: boolean` (mới, chưa có trong schema) | Cần thêm giám sát/cảnh báo, không phải công thức tập khác |

---

## A. Người mới (BEGINNER / UNKNOWN)

**Nguyên tắc khoa học nền tảng**: ACSM khuyến nghị 2-3 ngày/tuần, 8-12RM; cảnh báo rõ "too much too soon" (Kraemer & Ratamess). RIR/RPE tự báo cáo của nhóm này có độ tin cậy thấp hơn đáng kể (xem `gym-fitness-research.md` mục 3) — **không nên dùng RPE/RIR làm tín hiệu chính để ra quyết định tự động cho nhóm này**.

### Logic đề xuất
- **Chọn template**: Full Body (3 ngày/tuần) hoặc Upper/Lower (4 ngày/tuần) — ưu tiên Full Body cho 2-3 buổi/tuần vì tần suất kích thích mỗi nhóm cơ cao hơn với volume thấp/buổi.
- **Volume mặc định**: dưới ngưỡng "tối thiểu hiệu quả" một chút để ưu tiên học kỹ thuật (ví dụ 3-5 set/nhóm cơ chính/tuần thay vì 10+) — chưa cần tối ưu hoá volume ngay.
- **Không cho phép** AI đề xuất: kỹ thuật nâng cao (drop-set, FST-7 finisher, mechanical drop-set...), deload chủ động phức tạp (chưa đủ chu kỳ để cần), REBUILD (chưa có "chu kỳ trước" để so sánh).
- **Data-sufficiency gate nới lỏng hơn cho việc HIỂN THỊ tiến độ cơ bản** (buổi/tuần, streak) nhưng **giữ nguyên ngưỡng nghiêm ngặt cho Decision Engine** (không hạ `minimumCompletedSessions` chỉ vì là người mới — dữ liệu ít vẫn là dữ liệu ít, bất kể trình độ).
- **UI**: đơn giản hoá dashboard — ẩn các stat nâng cao (training monotony/strain, e1RM trend đa bài) mặc định, có thể "xem thêm".
- **Onboarding bắt buộc**: hỏi rõ "bạn đã tập gym được bao lâu" thay vì để trống → giảm số user rơi vào `UNKNOWN` không cần thiết (xem mục Onboarding trong `FITNESS_APP_DATA_AND_FEATURE_AUDIT.md`).

### Cảnh báo cụ thể (chưa có trong code — đề xuất)
- Nếu buổi tập > 4 ngày/tuần được yêu cầu bởi user BEGINNER → cảnh báo "khuyến nghị 2-3 ngày/tuần cho người mới, có muốn tiếp tục?" (không chặn cứng, chỉ cảnh báo — tôn trọng quyền tự quyết).

---

## B. Người đã biết tập (INTERMEDIATE)

**Nguyên tắc khoa học nền tảng**: ACSM dải tải 1-12RM có chu kỳ; ISSN/Schoenfeld dose-response 5-9 set/nhóm cơ/tuần là "phạm vi hiệu quả vững chắc".

### Logic đề xuất
- **Template**: Push/Pull/Legs (3-6 ngày/tuần) hoặc Upper/Lower — cấu trúc phổ biến nhất cho nhóm này, cả trong catalog CSV hiện có (`data/catalog/plans/gym_workout_plans.csv`) lẫn thực hành cộng đồng (Nippard, RP).
- **Progressive overload tường minh**: theo dõi tuần-qua-tuần (đã có `computeVolumeByWeek`/`computeE1rmTrend`), AI được phép đề xuất tăng tải/rep dựa trên các số liệu này (Decision Engine quyết định, LLM giải thích).
- **RPE/RIR bắt đầu được tin cậy hơn** nhưng vẫn nên hiển thị disclaimer nhẹ ("độ chính xác RPE cải thiện theo kinh nghiệm").
- **Cho phép** `ADJUST`/`PROGRESS`/`DELOAD` đầy đủ; **REBUILD** vẫn hiếm (cần ≥2 chu kỳ liên tiếp không đạt).
- **Chưa mở khoá**: kỹ thuật nâng cao dạng FST-7/Mountain Dog phase-3-4 (pump/intensity techniques) — theo nguyên tắc "avoid for beginners" nhưng **intermediate cũng nên thận trọng**, chỉ mở cho ADVANCED trở lên (xem code hiện tại: `cycle-analysis.service.ts` đã chặn đúng — chỉ cho phép khi `INTERMEDIATE` hoặc `ADVANCED`, khớp với thiết kế này).

---

## C. Người tập lâu năm (ADVANCED)

**Nguyên tắc khoa học nền tảng**: ACSM 4-5 ngày/tuần, nhấn tải nặng (1-6RM theo chu kỳ); nghiên cứu dose-response gợi ý ≥10 set/nhóm cơ/tuần cho kết quả tốt nhất; Bell et al. (2025) về deload có kế hoạch (4-8 tuần) hoặc phản ứng.

### Logic đề xuất
- **Template**: PPL nâng cao (6 ngày/tuần), Bro Split (1 nhóm cơ/ngày, tần suất thấp hơn nhưng volume/buổi cao), hoặc Specialization Block (ưu tiên 1-2 nhóm cơ yếu, giảm volume nhóm khác xuống mức duy trì).
- **Phá plateau — nhóm cơ yếu (lagging muscle group)**: đã có `findLaggingMuscleGroups()` trong `training-cycle-classification.service.ts` — dùng kết quả này để đề xuất Specialization Block cho đúng nhóm cơ đó.
- **Mở khoá kỹ thuật nâng cao có điều kiện**: FST-7-inspired finisher, mechanical drop-set — CHỈ khi (a) `experienceLevel = ADVANCED`, (b) `painScore` thấp, (c) `recoveryScore` không thấp bất thường. Đây chính là ví dụ `constraints` trong knowledge-base record mẫu ở `TRAINING_KNOWLEDGE_BASE_PLAN.md`.
- **Volume cycling + deload bắt buộc theo chu kỳ**: dùng `HIGH_TRAINING_MONOTONY` flag (Foster 1998, đã có) làm tín hiệu kích hoạt đề xuất DELOAD sớm hơn nếu monotony ≥2.0 kéo dài.
- **Fatigue management chặt hơn**: `fatigueScore`/`recoveryScore` (đã có) nên có trọng số cao hơn trong composite score cho nhóm ADVANCED so với BEGINNER (người mới hiếm khi thực sự overreach vì volume còn thấp).

---

## D. Vận động viên chuyên nghiệp

**Nguyên tắc khoa học nền tảng**: Periodization block đầy đủ (macro/meso/microcycle), peaking cho thi đấu, quản lý fatigue-performance model (Fitness-Fatigue Model — MASS review).

### Logic đề xuất
- **Không dùng logic đơn giản** (đúng yêu cầu người dùng) — nghĩa là: **không cho phép fallback deterministic đơn giản (KEEP/ADJUST/NEW_PLAN 3 nhánh cũ) áp dụng cho nhóm này**. Bắt buộc đi qua Adaptive Decision Engine đầy đủ (6 trạng thái).
- **Peaking Block**: cấu trúc pha (giai đoạn tích luỹ → chuyển hoá → peak → taper) — hiện **hoàn toàn chưa có khái niệm "block" nhiều pha nối tiếp nhau** trong schema (`TrainingCycle` là 1 chu kỳ độc lập, không có "chuỗi block" với vai trò khác nhau). Đây là gap thật cần thiết kế thêm (xem roadmap Phase 4).
- **Cảnh báo bắt buộc khi thiếu dữ liệu** (đúng yêu cầu người dùng): với nhóm D, `INSUFFICIENT_DATA` không chỉ là một trạng thái — nên **chặn hoàn toàn việc hiển thị bất kỳ đề xuất định lượng nào** (kể cả nhẹ) và yêu cầu rõ ràng dữ liệu gì cần bổ sung, vì sai số ở mức chuyên nghiệp có chi phí cao hơn (ảnh hưởng phong độ thi đấu).
- **Recovery/performance tách biệt khỏi body composition**: với VĐV sức mạnh (không phải bodybuilding), "tiến triển" có thể là hiệu suất (e1RM, tốc độ, sức bền) chứ không phải thay đổi thành phần cơ thể — `computeGoalProgressScore()` hiện chỉ xử lý `MUSCLE_GAIN`/`WEIGHT_LOSS` qua thành phần cơ thể; **thiếu nhánh cho mục tiêu hiệu suất thuần tuý** (`ATHLETIC_PERFORMANCE` goal đã tồn tại trong enum `Goal` nhưng `computeGoalProgressScore()` trả `null` cho goal này — chưa có công thức riêng).

### Task cụ thể còn thiếu cho nhóm D
1. [ ] Thêm nhánh tính `goalProgressScore` cho `ATHLETIC_PERFORMANCE` dựa trên `strengthProgressScore`/e1RM thay vì body composition.
2. [ ] Thiết kế khái niệm "Training Block Sequence" (nhiều `TrainingCycle` nối tiếp có vai trò macrocycle khác nhau: accumulation/transmutation/realization) — có thể là một bảng `TrainingBlockPlan` cha, mỗi `TrainingCycle` tham chiếu `blockRole`.
3. [ ] Thêm cờ `competesInSport`/`peakingDate` vào profile để kích hoạt logic peaking.

---

## Bảng tổng hợp khác biệt

| | A. Mới | B. Đã biết tập | C. Lâu năm | D. Chuyên nghiệp |
|---|---|---|---|---|
| Tần suất/tuần | 2-3 | 3-5 | 4-6 | Theo chu kỳ block |
| Template chính | Full Body / Upper-Lower | PPL / Upper-Lower | PPL nâng cao / Bro Split / Specialization | Periodized block + peaking |
| RPE/RIR tin cậy | Thấp — chỉ tham khảo | Trung bình | Cao | Cao, cần chính xác |
| Kỹ thuật nâng cao (FST-7/Mountain Dog style) | Không | Không | Có, có điều kiện | Có, giám sát chặt |
| Deload | Hiếm cần, không chủ động | Theo chu kỳ 4-8 tuần | Bắt buộc theo monotony/strain | Theo peaking calendar |
| REBUILD | Không áp dụng (chưa đủ lịch sử) | Hiếm | Có thể | Có thể, chi phí cao hơn |
| Ngưỡng INSUFFICIENT_DATA | Giữ nguyên nghiêm ngặt | Giữ nguyên | Giữ nguyên | Nghiêm ngặt hơn + chặn hiển thị đề xuất |
| Dashboard | Đơn giản, ẩn số liệu nâng cao | Đầy đủ số liệu progressive overload | Đầy đủ + lagging muscle group + monotony/strain | Đầy đủ + block sequence + peaking countdown |

---

## Ghi chú pháp lý xuyên suốt (áp dụng cho cả 4 nhóm)

Khi đề xuất kỹ thuật nâng cao lấy cảm hứng từ coach nổi tiếng (FST-7, Mountain Dog, PHAT...), **không được gọi tên thương hiệu coach như một khẳng định sở hữu/endorsement**. Dùng đúng theo yêu cầu người dùng:
- ✅ "Pump-set finisher lấy cảm hứng từ nguyên tắc FST-7 công khai (fascia stretch training)"
- ❌ "Lịch tập FST-7 của Hany Rambod" / "Chương trình PHAT chính thức của Layne Norton"

Chi tiết đầy đủ về rủi ro bản quyền: xem `TRAINING_KNOWLEDGE_BASE_PLAN.md` mục "Rủi ro pháp lý".
