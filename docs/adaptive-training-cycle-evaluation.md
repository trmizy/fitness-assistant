# Đánh giá chu kỳ tập luyện và điều chỉnh lịch tập thích ứng (Adaptive Training Cycle Evaluation)

Mở rộng [`training-cycle-v2.md`](./training-cycle-v2.md) — **không thay
thế**. Toàn bộ API/bảng của v2 (`POST /training-cycles`, `GET /active`,
`POST /:id/complete`, `POST /:id/approve`, `TrainingCycle.decision`
3-trạng-thái, `POST /ai/analyze-cycle`) vẫn hoạt động y nguyên. Chức năng
này thêm một luồng đánh giá phong phú hơn (6 trạng thái quyết định, lịch sử
đánh giá có version, an toàn cho chấn thương/đau) song song với luồng cũ.

Nguyên tắc xuyên suốt vẫn giữ nguyên từ v2: **code tính số liệu, LLM chỉ
diễn giải**. LLM không bao giờ tự tính volume/adherence/1RM hay tự quyết
định — nó chỉ nhận structured JSON đã tính sẵn và giải thích.

## Kiến trúc

```
Người dùng ghi workout / InBody trong chu kỳ ACTIVE
        │  (WorkoutSchedule.trainingCycleId, CycleInBodyLink)
        ▼
POST /training-cycles/:id/evaluate   (đồng bộ — khác /complete chạy nền)
        │
        ├─ 1. cycle-metrics.engine.ts (computeCycleMetrics)
        │     tái dùng computeAdherence/computeWorkoutMetrics/computeNewPRs
        │     từ v2, cộng thêm: exerciseProgression, strengthProgressScore,
        │     performanceConsistencyScore, fatigue/recovery/pain (từ
        │     CycleSessionFeedback), body-composition trend (linear
        │     regression qua inbody-quality.evaluator.ts), dataQualityScore
        │
        ├─ 2. cycle-decision.engine.ts (evaluateCycle)
        │     5 cổng INSUFFICIENT_DATA → composite progress score có
        │     trọng số → KEEP/PROGRESS/ADJUST/DELOAD/REBUILD, kèm
        │     reasonCodes/safetyFlags/conflictingSignals để audit
        │
        ├─ 3. ai-service POST /ai/assess-cycle (giải thích, KHÔNG quyết định)
        │     RAG (fitness_evidence, có citation thật) → LLM (1 lần gọi,
        │     JSON mode) → Zod validate → fallback mechanical từ
        │     reasonCodes nếu LLM lỗi. decision/requiresConfirmation luôn
        │     bị ghi đè về giá trị của Decision Engine bất kể LLM trả gì;
        │     proposedChanges ngoài allowedChanges bị lọc bỏ.
        │
        ▼
CycleAssessment (version tăng dần, PENDING→COMPLETED/FAILED)
        │
        ├─ notification real-time "assessment ready" (qua chat-service,
        │   không phải Notification row lưu trong DB)
        │
        ▼
Người dùng: Accept / Reject (POST /:id/recommendation/accept|reject)
   — CHỈ đánh dấu userDecision, KHÔNG tự tạo/kích hoạt plan mới
```

## Data model (bổ sung, additive lên `training-cycle-v2.md`)

- `TrainingCycle`: thêm `name`, `actualEndDate`, `baselineMetrics`,
  `targetMetrics`, `configuration` (JSON, chứa vd. `priorityExercises` cho
  strength-score weighting). `status` thêm `DRAFT`/`CANCELLED`.
  `goal`/`planId`/`startInbodyId` được **tái dùng nguyên**, không tạo cột
  trùng tên (`goalType`/`workoutPlanId`/`baselineInBodyRecordId` trong bản
  spec gốc ánh xạ vào các cột này).
- `CycleAssessment` (mới): lịch sử đánh giá có version,
  `@@unique([cycleId, assessmentVersion])` cho tính idempotent của
  `/evaluate`.
- `CycleSessionFeedback` (mới): readiness/RPE/pain theo từng buổi, 1:1 với
  `WorkoutSchedule` — không lặp lại `plannedDate`/`completionStatus` vốn đã
  có sẵn trên `WorkoutSchedule`.
- `CycleInBodyLink` (mới): nối `InBodyEntry` (user-service, cross-service)
  vào cycle khi người dùng xác nhận — nằm trong DB của fitness-service, để
  không cần một migration/write call sang user-service.
- `WorkoutSchedule.trainingCycleId` (mới, FK thật vì cùng service).

## API mới (additive)

| Method | Path | Ghi chú |
|---|---|---|
| PATCH | `/training-cycles/:id` | Sửa name/targetMetrics/configuration (DRAFT/ACTIVE) |
| POST | `/training-cycles/:id/start` | DRAFT → ACTIVE |
| GET | `/training-cycles/:id/progress` | Metrics engine đầy đủ, cache Redis 120s |
| POST | `/training-cycles/:id/evaluate` | Chạy Decision Engine + AI giải thích, đồng bộ, idempotent theo version |
| GET | `/training-cycles/:id/assessments` | Phân trang (`page`/`limit`) |
| GET | `/training-cycles/:id/assessments/latest` | — |
| POST | `/training-cycles/:id/recommendation/accept` \| `/reject` | Chỉ đánh dấu `userDecision`, 409 nếu đã review |
| POST | `/training-cycles/:id/inbody-links` | Nối 1 InBody entry vào cycle, idempotent (upsert) |
| POST | `/ai/assess-cycle` | Nội bộ (fitness-service→ai-service), song song với `/ai/analyze-cycle` cũ |

`POST /training-cycles` (tạo cycle, endpoint cũ) nhận thêm field tùy chọn
`status: "DRAFT" | "ACTIVE"` (mặc định `ACTIVE` — hành vi cũ không đổi) và
`name`/`targetMetrics`/`configuration`.

## Bảng ngưỡng Decision Engine (bổ sung vào `cycle-thresholds.config.ts`)

| Ngưỡng | Biến môi trường | Mặc định |
|---|---|---|
| Số ngày tối thiểu | `CYCLE_ASSESSMENT_MIN_CYCLE_DAYS` | 28 |
| Số buổi hoàn thành tối thiểu | `CYCLE_ASSESSMENT_MIN_COMPLETED_SESSIONS` | 8 |
| Adherence tối thiểu để đánh giá | `CYCLE_ASSESSMENT_MIN_ADHERENCE_RATE` | 0.70 |
| Số bản ghi InBody so sánh được tối thiểu | `CYCLE_ASSESSMENT_MIN_COMPARABLE_INBODY` | 2 |
| Cửa sổ phát hiện plateau (tuần) | `CYCLE_ASSESSMENT_PLATEAU_WINDOW_WEEKS` | 3 |
| Điểm đau cao (safety flag) | `CYCLE_ASSESSMENT_HIGH_PAIN_SCORE` | 7 |
| Ngưỡng confidence thấp | `CYCLE_ASSESSMENT_LOW_CONFIDENCE_THRESHOLD` | 0.60 |

Cùng `InBodyDataQualityEvaluator`'s ngưỡng outlier/interval trong
`cycleThresholds.inbodyQuality.*`. **Tất cả là product defaults**, không
phải chuẩn y khoa — chỉnh qua biến môi trường theo triết lý huấn luyện của
từng đội.

## Giới hạn đã biết (documented, không phải bug ẩn)

- `averageRir` luôn `null` — schema hiện tại không có cột RIR ở đâu cả.
- `weightWaterConflict` luôn `false` — `InBodyEntry` không có field tổng
  lượng nước cơ thể (TBW/ECW) để so sánh.
- Notification "assessment ready" chỉ real-time (qua socket.io), không lưu
  vào bảng `Notification` (bảng đó thuộc DB của user-service; repo hiện
  không có write call fitness-service → user-service).
- Cycle Progress UI không vẽ được biểu đồ xu hướng InBody dạng đường —
  `GET /:id/progress` chỉ trả tóm tắt (`inBodyQuality.qualityFlags` +
  record counts), không trả từng điểm đo — hiện hiển thị dạng badge xu
  hướng (↑/→/↓) thay vì line chart.
- REBUILD's "hai chu kỳ liên tiếp không đạt mục tiêu" chỉ tính các chu kỳ
  đã có `CycleAssessment` kiểu mới — chu kỳ cũ chỉ có `decision` 3-trạng-
  thái (v2) không được quy đổi ngược, nên tín hiệu REBUILD sẽ "nguội" cho
  đến khi có đủ lịch sử đánh giá kiểu mới tích lũy.
