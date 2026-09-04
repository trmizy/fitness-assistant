# Training Cycle Decision Engine — Đề xuất nâng cấp

> Historical proposal. The implemented flow is documented in
> `adaptive-training-cycle-evaluation.md` and verified by current tests.

> Bổ sung cho `docs/training-cycle-v2.md` (flow cũ, 3 quyết định) và `docs/adaptive-training-cycle-evaluation.md` (flow mới, 6 quyết định — đã triển khai). Tài liệu này đánh giá engine **hiện có** và đề xuất phần **còn thiếu** để trở thành một decision engine hoàn chỉnh theo đúng nguyên tắc "code tính số liệu, LLM chỉ giải thích, RAG chỉ dẫn chứng".
>
> **Không implement code trong tài liệu này** — đây là bản thiết kế chờ approval.

---

## 1. Hiện trạng đã có (xác nhận qua đọc code trực tiếp, không giả định)

Hệ thống hiện tại có **hai luồng song song**:

| | Legacy `/complete` | Adaptive `/evaluate` |
|---|---|---|
| File chính | `training-cycle.service.ts` (`completeCycle`, `runAnalysis`) | `cycle-metrics.engine.ts` + `cycle-decision.engine.ts` |
| Số trạng thái quyết định | 3 (KEEP/ADJUST/NEW_PLAN) + `INSUFFICIENT_DATA` (thêm ở phase trước) | 6 (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD/INSUFFICIENT_DATA) |
| Gate dữ liệu tối thiểu | Có (thêm ở phase trước: `minimumCycleDays`, `minimumCompletedSessions`, `NO_SCHEDULED_SESSIONS`) | Có đầy đủ — 5 cổng độc lập (xem `evaluateInsufficientDataGates`) |
| Safety flags (đau/mệt mỏi) | Không có | Có (`HIGH_PAIN_SCORE`, `RISING_PAIN_TREND`, `SHARP_PERFORMANCE_DROP_WITH_HIGH_FATIGUE`) |
| Versioning/audit | Không (ghi đè `decision`/`aiAnalysis` một lần) | Có (`CycleAssessment` bảng riêng, `assessmentVersion` tăng dần, không sửa lịch sử) |
| Idempotency | Có (unique constraint DB cho ACTIVE cycle) | Có (`@@unique([cycleId, assessmentVersion])`, bắt P2002) |
| AI validate ngữ nghĩa | Có (macro↔calo qua `meal-plan-validator.ts`, experienceLevel gating) | Chưa có validator riêng cho `proposedChanges`/`aiSummary` |

**Kết luận quan trọng**: `/evaluate` (Adaptive) đã là một decision engine khá trưởng thành, đúng tinh thần yêu cầu của người dùng trong prompt này. Phần lớn công việc còn lại là: (a) **hợp nhất** hai luồng thay vì để chúng song song mãi mãi, (b) **bổ sung các metric còn thiếu** theo danh sách người dùng yêu cầu, (c) **thêm audit trail tường minh** hơn cho từng quyết định.

---

## 2. Metric đã tính bằng code (xác nhận) vs. còn thiếu

### 2.1 Đã có, tính đúng bằng code (không để LLM đoán)

| Metric | Hàm | Vị trí |
|---|---|---|
| adherence rate (nullable khi 0/0) | `computeAdherence()` | `training-cycle-metrics.service.ts` |
| completed / missed / upcoming sessions | `getCycleReport()` | `training-cycle.service.ts` |
| weekly volume by muscle group | `computeVolumeByWeek()` | `training-cycle-metrics.service.ts` |
| volume change % (tuần đầu vs tuần cuối) | `computeVolumeChangePct()` | cùng file |
| e1RM trend theo tuần | `computeE1rmTrend()` | cùng file |
| PR count (so với trước chu kỳ) | `computeNewPRs()` | cùng file |
| average RPE + xu hướng | `computeRpeTrend()` | cùng file |
| RIR trend | `computeRirTrend()` | cùng file |
| pain score trend | `computeFatigueRecoveryMetrics()` | `cycle-metrics.engine.ts` |
| readiness/recovery score | cùng hàm trên (`recoveryScore`) | `cycle-metrics.engine.ts` |
| body weight / SMM / body-fat trend | `computeBodyCompositionTrends()` | `cycle-metrics.engine.ts` |
| data completeness score | `computeDataCompletenessScore()` | `cycle-metrics.engine.ts` |
| data quality score (gộp InBody confidence) | `computeCycleMetrics()` | `cycle-metrics.engine.ts` |
| InBody outlier/interval/device-consistency | `evaluateInBodyQuality()` | `inbody-quality.evaluator.ts` |
| training monotony/strain (Foster 1998) | `getCycleReport()` | `training-cycle.service.ts` |
| protein vs. evidence range (1.6–2.2g/kg) | `getCycleReport()` | cùng file |

### 2.2 Người dùng yêu cầu nhưng **hiện chưa có** (gap thật)

| Metric yêu cầu | Hiện trạng | Đề xuất |
|---|---|---|
| **nutrition consistency** (số ngày log nutrition / tổng số ngày, độ lệch so với target) | Có tính `daysLogged/totalDaysInWindow` trong `getCycleReport()` nhưng **chưa đưa vào `CycleMetricsResult`** dùng cho Decision Engine — engine ra quyết định KHÔNG xét yếu tố dinh dưỡng | Thêm `nutritionConsistencyScore: number \| null` vào `CycleMetricsResult`, tính từ `daysLogged/totalDaysInWindow` × (1 − |calo thực tế − target|/target, giới hạn 0-1) |
| **sleep/recovery** (nếu có dữ liệu) | `readinessScore` đã có (1-10, tự báo cáo pre-session) nhưng **không có trường sleep riêng** — schema `CycleSessionFeedback` không có `sleepHours`/`sleepQuality` | Chưa có nguồn dữ liệu giấc ngủ trong hệ thống (không có tích hợp wearable). Đề xuất: (a) thêm field tự báo cáo tuỳ chọn `sleepHoursAvgLast7d` vào `CycleSessionFeedback` hoặc một bảng riêng, HOẶC (b) để trống có chủ đích và ghi rõ trong `dataCompletenessScore` là "không thu thập" chứ không suy đoán |
| **volume progression percentage** (không nhầm với volume change đã có) | `volumeChangePct` hiện là **tuần đầu vs tuần cuối** (2 điểm) | Cần thêm `volumeProgressionSlope`: hồi quy tuyến tính qua TẤT CẢ các tuần (giống `linearTrend()` đã dùng cho body composition) — phản ánh xu hướng tăng dần thật, không chỉ 2 điểm đầu/cuối dễ bị nhiễu |
| **missed sessions (số tuyệt đối, không chỉ %)** | Có trong `getCycleReport()` (`workouts.missed`) nhưng **không có trong `CycleMetricsResult`** mà Decision Engine dùng | Thêm `missedSessionCount: number` vào `CycleMetricsResult` — engine hiện chỉ thấy `adherenceRate`, không phân biệt được "80% của 10 buổi" với "80% của 100 buổi" |

---

## 3. State machine đề xuất (hợp nhất 2 luồng thành 1)

```
                        ┌─────────┐
                        │  DRAFT  │ (chưa kích hoạt, có thể sửa/huỷ)
                        └────┬────┘
                             │ start (kích hoạt)
                             ▼
                        ┌─────────┐
              ┌─────────┤ ACTIVE  ├─────────┐
              │         └────┬────┘         │
     cancelCycle()           │ complete()   │ evaluate() (không đổi status)
   (chủ động huỷ,            │ (đóng chu kỳ)│ (có thể gọi nhiều lần
    không đánh giá)          ▼              │  trong lúc vẫn ACTIVE)
              │         ┌─────────┐         │
              │         │ ANALYZED│◄────────┘ (khi user "Kết thúc chu kỳ",
              │         └────┬────┘            snapshot đánh giá cuối cùng)
              │              │
              ▼              ▼
        ┌───────────┐   decision ∈ {KEEP, PROGRESS, ADJUST, DELOAD,
        │ CANCELLED │             REBUILD, INSUFFICIENT_DATA}
        └───────────┘
```

**Quyết định cuối cùng (6 trạng thái, đã có ở Adaptive engine — giữ nguyên, đề xuất áp dụng cho CẢ HAI luồng)**:

| Quyết định | Điều kiện (đã code) | Hành động cho phép |
|---|---|---|
| `INSUFFICIENT_DATA` | Bất kỳ 1 trong 5 cổng: cycle quá ngắn, quá ít buổi hoàn thành, adherence quá thấp để đánh giá, thiếu dữ liệu so sánh, quá nhiều outlier | Không đề xuất gì về calo/kỹ thuật/lịch tập — chỉ giải thích thiếu gì |
| `DELOAD` | Mệt mỏi cao HOẶC recovery kém HOẶC safety flag nghiêm trọng, VÀ hiệu suất giảm, VÀ adherence đủ tốt (loại trừ "giảm vì bỏ tập") | Đề xuất giảm tải, không tăng volume/cường độ |
| `REBUILD` | 2 chu kỳ liên tiếp không đạt mục tiêu MẶC DÙ dữ liệu tốt, HOẶC mục tiêu/bối cảnh thay đổi | Đề xuất thiết kế lại chương trình — nhưng **không tự tạo chương trình mới**, chỉ đề xuất |
| `PROGRESS` | Điểm tổng hợp mạnh VÀ còn dư địa (RPE chưa tăng kịch trần) VÀ adherence tốt | Đề xuất tăng tải nhẹ |
| `KEEP` | Tiến triển ổn định, không có tín hiệu cần đổi | Không đề xuất thay đổi |
| `ADJUST` | Chững lại (plateau) với dữ liệu tốt, hoặc tín hiệu mâu thuẫn | Đề xuất điều chỉnh nhỏ (kỹ thuật pump-set NẾU experienceLevel phù hợp, hoặc đổi bài tập) |

---

## 4. Đề xuất bổ sung: Recommendation Audit

Người dùng yêu cầu bảng `recommendation_audit` — **hiện chưa có bảng riêng cho việc này**, dù `CycleAssessment` đã lưu `reasonCodes`/`conflictingSignals`/`safetyFlags`/`proposedChanges` (một dạng audit trail tại chỗ). Đề xuất bảng riêng để tách bạch "kết quả đánh giá" (CycleAssessment) khỏi "nhật ký mọi tương tác quyết định" (ai đã thấy gì, chấp nhận/từ chối lúc nào, phiên bản engine nào tạo ra nó):

```prisma
model RecommendationAudit {
  id                String   @id @default(uuid())
  userId            String
  cycleId           String
  assessmentId      String?  // null nếu từ legacy /complete path
  engineVersion     String   // "legacy-v2" | "adaptive-v1" | tương lai "adaptive-v2"
  decision          String
  reasonCodes       Json
  inputSnapshot     Json     // toàn bộ CycleMetricsResult tại thời điểm quyết định — để debug/replay
  llmSummary        String?  // câu giải thích LLM đã tạo (nếu có) — KHÔNG phải nguồn quyết định
  presentedAt       DateTime @default(now())
  userAction        String?  // "accepted" | "rejected" | "ignored" | null (chưa phản hồi)
  userActionAt      DateTime?
  createdAt         DateTime @default(now())

  @@index([userId, cycleId])
  @@index([cycleId, presentedAt])
}
```

**Lý do cần bảng riêng thay vì chỉ dùng `CycleAssessment`**: `CycleAssessment` là *kết quả tính toán* (1 hàng = 1 lần chạy `/evaluate`), còn `RecommendationAudit` là *lịch sử tương tác người dùng với kết quả đó* — một assessment có thể được xem nhiều lần, tại nhiều thời điểm, trước khi user quyết định accept/reject. Tách riêng giúp trả lời được câu hỏi vận hành thật: "bao nhiêu % đề xuất DELOAD bị user từ chối?" — dữ liệu quý cho việc hiệu chỉnh ngưỡng sau này.

---

## 5. Nguyên tắc LLM/RAG (đã áp dụng đúng — giữ nguyên, mở rộng)

Đã xác nhận qua code (`cycle-analysis.service.ts`, `cycle-assessment.service.ts`):
- `decision`/`requiresConfirmation` từ LLM **luôn bị ghi đè** bằng giá trị thật của Decision Engine, bất kể LLM trả về gì.
- `proposedChanges` ngoài `allowedChanges` (suy ra từ `recommendedActionScope`) **bị lọc bỏ**, không tin tưởng.
- Macro/calo từ LLM được **đối chiếu và tự sửa** bằng `meal-plan-validator.ts` (không tin số LLM tự tính).

**Đề xuất mở rộng (chưa có)**:
1. Validator ngữ nghĩa cho `proposedChanges` của Adaptive flow tương tự macro-validator: kiểm tra `target` có nằm trong taxonomy hợp lệ (nhóm cơ, loại thay đổi VOLUME/LOAD/REPS/EXERCISE/FREQUENCY/DELOAD), `currentValue`/`proposedValue` có hợp lý về đơn vị/khoảng giá trị hay không.
2. RAG evidence: hiện `cycle-analysis.service.ts` lấy evidence qua `retriever.retrieveEvidence()` nhưng **cắt chuỗi 500 ký tự đầu** (`pageContent.slice(0,500)`) và **bỏ qua metadata trích dẫn thật** (title/source_url/evidence_level) trong response cuối — đã ghi chú trong plan cũ là "known limitation", vẫn chưa sửa ở luồng legacy. Adaptive flow (`cycle-assessment.service.ts`) đã sửa việc này (theo doc `adaptive-training-cycle-evaluation.md`).

---

## 6. Task cụ thể để implement (ưu tiên, chưa làm)

1. [ ] Thêm `nutritionConsistencyScore`, `missedSessionCount`, `volumeProgressionSlope` vào `CycleMetricsResult` (đọc §2.2).
2. [ ] Thêm bảng `RecommendationAudit` + migration + ghi record mỗi lần `/evaluate` hoặc `/complete` trả kết quả, cập nhật `userAction` khi user accept/reject.
3. [ ] Hợp nhất legacy `/complete` để dùng chung `cycle-metrics.engine.ts`/`cycle-decision.engine.ts` thay vì `classifyProgress()` cũ (loại bỏ trùng lặp logic, một nguồn sự thật duy nhất cho quyết định).
4. [ ] Thêm validator ngữ nghĩa cho `proposedChanges` của Adaptive flow (tương tự `meal-plan-validator.ts`).
5. [ ] Thiết kế nguồn dữ liệu giấc ngủ (tự báo cáo, tối thiểu) — hoặc tài liệu hoá rõ ràng "không thu thập, không suy đoán" nếu quyết định không làm ở giai đoạn này.
6. [ ] Viết test cho từng nhánh quyết định VỚI dữ liệu edge-case theo đúng 4 nhóm người dùng (xem `USER_LEVEL_PERSONALIZATION_PLAN.md`).
