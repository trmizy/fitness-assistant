# Kiểm soát thể trạng & chu kỳ tập luyện (v2)

> Historical design predecessor. See `adaptive-training-cycle-evaluation.md`
> for the later implemented flow.

Chức năng gồm 2 chế độ vận hành: giám sát liên tục trong chu kỳ, và quyết
định AI-đề-xuất khi kết thúc chu kỳ. Nguyên tắc xuyên suốt: **code tính số
liệu, LLM chỉ diễn giải** — mọi delta/trend/phân loại đều deterministic
trước khi đưa vào prompt.

## Chế độ 1 — Giám sát liên tục (ACTIVE)

```
InBody mới / cuối tuần
        │
        ▼
computeAdherence + computeWorkoutMetrics (volume/e1RM/RPE/PR)
        │
        ▼
evaluateAlerts (cycle-thresholds.config.ts)
        │
        ▼
GET /training-cycles/active → { cycle, summary }  (tính realtime, không cache)
```

## Chế độ 2 — Đóng chu kỳ & quyết định

```
POST /training-cycles/:id/complete
        │
        ├─ buildRollingSummary (final) + classifyProgress → progressSignals
        ├─ status = COMPLETED, trả về NGAY (không chờ AI)
        │
        └─ (fire-and-forget) POST ai-service /ai/analyze-cycle
                │
                ├─ RAG: retriever.retrieveEvidence() theo overallTrend +
                │        laggingMuscleGroups + goal (collection fitness_evidence)
                ├─ LLM (Ollama, JSON mode), 2 lần thử + Zod validate
                └─ Fallback nếu LLM lỗi/không hợp lệ:
                       PROGRESSING → KEEP
                       PLATEAU     → ADJUST
                       DECLINING   → NEW_PLAN
                │
                ▼
        status = ANALYZED, decision + aiAnalysis lưu vào TrainingCycle
```

Frontend poll `GET /training-cycles/:id` mỗi 4s trong lúc `status=COMPLETED`
để hiện "AI đang phân tích...", dừng khi chuyển `ANALYZED`.

## Bảng ngưỡng (tất cả override được qua biến môi trường)

Định nghĩa tại `backend/services/fitness-service/src/config/cycle-thresholds.config.ts`.

| Ngưỡng | Biến môi trường | Mặc định |
|---|---|---|
| ΔSMM đạt (bulk) | `CYCLE_SMM_PROGRESSING_MIN_KG` | +0.3 kg |
| ΔSMM sụt (bulk) | `CYCLE_SMM_DECLINING_MAX_KG` | -0.2 kg |
| ΔPBF đạt (cut) | `CYCLE_PBF_PROGRESSING_MAX_PCT` | -0.8% |
| ΔPBF sụt (cut) | `CYCLE_PBF_DECLINING_MIN_PCT` | +0.3% |
| Volume đạt | `CYCLE_VOLUME_PROGRESSING_MIN_PCT` | +5% |
| Volume sụt | `CYCLE_VOLUME_DECLINING_MAX_PCT` | -5% |
| Adherence đạt | `CYCLE_ADHERENCE_PROGRESSING_MIN_PCT` | 80% |
| Adherence sụt | `CYCLE_ADHERENCE_DECLINING_MAX_PCT` | 60% |
| Cảnh báo: bulk giảm cân N lần đo liên tiếp | `CYCLE_ALERT_BULK_WEIGHT_LOSS_STREAK` | 2 |
| Cảnh báo: cut PBF không giảm N tuần | `CYCLE_ALERT_CUT_STALLED_WEEKS` | 3 |
| Cảnh báo: RPE tăng N tuần liên tiếp | `CYCLE_ALERT_FATIGUE_RPE_WEEKS` | 3 |
| Cảnh báo: adherence thấp ở tuần 2 | `CYCLE_ALERT_LOW_ADHERENCE_PCT` | 60% |

## overallTrend — công thức gộp tín hiệu

`classifyProgress()` (training-cycle-classification.service.ts) tính điểm
có trọng số từ 4 tín hiệu (`up`=phù hợp mục tiêu, `down`=ngược mục tiêu,
`flat`=trung tính):

```
score = bodyComposition×2 + adherence×1 + volume×1 + prs(có PR mới=+1)
score >= 2  → PROGRESSING
score <= -2 → DECLINING
còn lại     → PLATEAU
```

Verify: 3 bộ dữ liệu mô phỏng (bulk đạt tốt / bulk chững / bulk sụt) đều
cho đúng PROGRESSING/PLATEAU/DECLINING tương ứng.

## API chính

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/training-cycles` | Bắt đầu chu kỳ, `cycleIndex` tự tăng |
| GET | `/training-cycles/active` | Rolling metrics realtime |
| POST | `/training-cycles/:id/complete` | Đóng chu kỳ, trigger AI async |
| POST | `/training-cycles/:id/approve` | User duyệt quyết định, ghi `nextPlanId` |
| GET | `/training-cycles` / `/:id` | Lịch sử / chi tiết |
| POST | `/ai/analyze-cycle` | Nội bộ (fitness-service→ai-service), không qua gateway |

## Data model

`TrainingCycle` không còn lưu snapshot InBody riêng lẻ (weight/bodyFat/
muscleMass tại start/end) như bản v1 — chỉ lưu `startInbodyId`/`endInbodyId`
tham chiếu sang `user-service`, còn số liệu tính toán cache trong
`summary` (Json). `InBodyEntry` (user-service) có thêm `bmr` + `visceralFat`
phục vụ tính TDEE trong `mealPlanDraft`.
