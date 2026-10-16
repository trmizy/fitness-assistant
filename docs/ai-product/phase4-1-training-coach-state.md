# Phase 4.1 — Rolling-window training analytics + `CoachStateV0.training`

Nhãn bằng chứng: `TEST FIXTURE` (unit, dữ liệu dựng tay) · `BACKEND INTEGRATION` (Postgres `*_test` cô lập) · `REAL HTTP/API` (fitness-service chạy cục bộ trên DB test, ngoài Docker dev) · `CODE AUDIT`. Không có `REAL BROWSER`. Không có LLM call nào.

## 1. Starting gap
Phase 4 audit: analytics huấn luyện có sẵn nhưng gắn `TrainingCycle` và chat không đọc. Cần (a) cửa sổ cuốn chiếu không phụ thuộc cycle, (b) hợp đồng typed + chất lượng dữ liệu, (c) reader trong ai-service.

## 2. Existing analytics reused (không có engine mới)
| Dùng lại | Từ | Vai trò |
|---|---|---|
| `computeAdherence(userId, null, from, to)` | `training-cycle-metrics.service.ts` | scheduled/completed; `planId=null` ⇒ mọi plan |
| `computeWorkoutMetrics(userId, from, to, null)` | idem | sets, volume theo tuần/nhóm cơ, e1RM tuần, RPE/RIR trend |
| `computeExerciseProgression` | `cycle-metrics.engine.ts` | baseline/current e1RM, `changePct` |
| `computePerformanceConsistencyScore` | idem | độ đều volume tuần |
| `computeFatigueRecoveryMetrics` | idem | tổng hợp feedback buổi tập |
| `cycleThresholds` | `config/cycle-thresholds.config.ts` | mọi ngưỡng |

Tham số "cycleStart" của các hàm này vốn chỉ là mốc bắt đầu cửa sổ nên **không cần refactor**. Thay đổi duy nhất trong code cũ: `SetRow` thêm `exerciseId?` (optional) và select `exercise.id`, để trả `Exercise.id` canonical. Không đổi công thức.

## 3. Window semantics
- Mặc định 28 ngày; endpoint giới hạn 7–90, số nguyên (ngoài khoảng ⇒ HTTP 400).
- `from` = 00:00:00Z của ngày UTC cách `asOf` `days-1` ngày (bao gồm); `to` = thời điểm `asOf` (bao gồm). Vì `WorkoutSchedule.date` lưu date-only ở UTC midnight (xem `startOfUtcDay` trong `training-cycle.service.ts`), cùng quy ước `date >= from AND date <= asOf` của engine cycle.
- Lịch/workout **sau `asOf` bị loại** (không vào adherence). Workout tính theo `Workout.date`, lịch theo `WorkoutSchedule.date` (không dùng `completedAt`/`createdAt`).
- Không bịa timezone: không có múi giờ người dùng ở đường này; ngày theo UTC như phần còn lại của engine. Hệ quả: người ở UTC+7 tập 06:00 sáng thuộc ngày UTC hôm trước vẫn nằm trong cùng ngày lịch (vì lịch date-only) nhưng biên cửa sổ có thể lệch tối đa một ngày.
- Workout import (Hevy…) tính như workout thường (đã là `Workout`/`WorkoutSet`).

## 4. Endpoint / read architecture
```
ai-service  getCoachStateV0()
   └ assembleContext(["TRAINING_COACH_STATE","FITNESS_GOAL"])   ← demand-driven, không bao giờ fetch ngầm
        ├ trainingReader.getTrainingAnalytics → GET fitness-service /stats/training-window?days=
        └ profileReader.getCurrentFitnessGoal  (user-service profile goal)
fitness-service  statsController.getTrainingWindow (authMiddleware) → getTrainingAnalyticsWindow(req.user.id)
```
- Chọn route `/stats/training-window` (authMiddleware, danh tính từ token) thay vì `/internal/*`: reader forward `Authorization` của người dùng như mọi reader hiện có; **không có tham số userId nào** (query `userId` bị bỏ qua).
- Chỉ đọc, không schema/migration, không cache.

## 5. `TrainingAnalyticsWindow` contract
Định nghĩa: `fitness-service/src/services/training-analytics-window.service.ts`; bản sao chỉ-đọc trong `ai-service/src/services/enterprise-data/types.ts`.
`period` · `adherence{state,scheduledSessions,completedSessions,missedSessions,completionRate,dataQuality}` · `frequency{completedPerWeek,scheduledPerWeek,trainingDaysLogged,weeklyVolumeConsistency,dataQuality}` · `volume{totalVolumeLoadKg,byMuscleGroupKg,byWeek,volumeTrendPercent,completedSetCount,loadedSetCount,dataQuality}` · `progression{exercises[{exerciseId,exerciseName,baselineE1rmKg,currentE1rmKg,changePct,weeksObserved,dataQuality}],dataQuality}` · `plateau{status:"NOT_AVAILABLE",reason}` · `effort{rpe,rir,sessionFeedback}` · `signals[]` · `dataQuality`.

## 6. `CoachStateV0.training` contract
```ts
CoachStateV0 = { asOf: string; goal?: { type: string }; training: {
  period; adherence; frequency; volume; progression; plateau; effort; signals; dataQuality } }
```
Chỉ `goal` + `training` (không placeholder nutrition/body/recovery). `buildCoachStateV0` là phép chiếu thuần: không tính toán. `goal` bị bỏ qua (không bịa) khi profile không có goal.

## 7. Data-quality semantics
`SUFFICIENT | PARTIAL | INSUFFICIENT_HISTORY | NO_DATA | STALE`.
- `NO_DATA`: không có lịch/log trong cửa sổ và không có hoạt động trước đó.
- `STALE`: cửa sổ trống nhưng có workout *trước* cửa sổ.
- `INSUFFICIENT_HISTORY`: < 2 buổi quan sát được.
- `SUFFICIENT`: cửa sổ ≥ `minimumCycleDays` (28) **và** mẫu ≥ `minimumCompletedSessions` (8) — hai ngưỡng sẵn có của cổng quyết định cycle, tái dùng; cửa sổ ngắn hơn 28 ngày tối đa `PARTIAL`.
- `PARTIAL`: còn lại.
- Tiến triển từng bài: ≥ `plateauWindowWeeks` (3) tuần quan sát = `SUFFICIENT`, 2 = `PARTIAL`, 1 = `INSUFFICIENT_HISTORY`.
- Ngưỡng 28/8 là chuẩn cổng của cycle, không phải khẳng định khoa học; ghi rõ ở đây.

## 8. Adherence
`state = NO_SCHEDULE` khi không có `WorkoutSchedule` nào (≠ 0%; `completionRate`/`missedSessions` = null). Có lịch: `completed` = `status === "COMPLETED"`, `missed = scheduled − completed` — **cùng định nghĩa `missedSessionCount` của cycle report**, nên một buổi hôm nay chưa bắt đầu (`NOT_STARTED`, date ≤ now) tính là chưa hoàn thành; SKIPPED/CANCELLED cũng vậy. `completionRate` làm tròn theo phần trăm nguyên của engine.

## 9. Progression
Top-5 bài tập tập nhiều nhất (giới hạn sẵn có của `computeE1rmTrend`), e1RM tuần cao nhất; warm-up bị loại; `baseline` = tuần đầu **trong cửa sổ** (không phải đầu cycle). Không gán nhãn IMPROVING/PLATEAU/DECLINING vì engine không có phân loại đó theo bài.

## 10. Volume
Volume load = Σ weight×reps của set `completed` (kể cả warm-up — hành vi sẵn có; bodyweight không tải thì không vào volume nhưng vẫn vào `completedSetCount`). Mỗi nhóm cơ trong `muscleGroupsActivated` nhận **nguyên** tải của set ⇒ tổng theo nhóm có thể > tổng chung. **Không có "sets per muscle" hay "effective sets"** vì engine hiện không tính; `WorkoutSetSegment` (drop/rest-pause) không được engine tính (giữ nguyên).

## 11. Plateau
`NOT_AVAILABLE` + lý do. Logic plateau chỉ là điểm tổng hợp trong `cycle-decision.engine.ts` (cần phạm vi cycle, InBody, cổng adherence); không có bộ phân loại độc lập cho cửa sổ cuốn chiếu nên không giả lập.

## 12. Sparse data
RPE/RIR: set không nhập không bị coi là 0 (engine bỏ `null`); `observedSets/totalCompletedSets` + chất lượng: không set nào = `NO_DATA`; < 3 tuần = `INSUFFICIENT_HISTORY` và `trend=null` (nhãn "stable" của engine với < 3 tuần chỉ là mặc định); <50% set có giá trị = `PARTIAL`. Không suy readiness/recovery từ việc thiếu RPE. Không sleep/HRV.

Signals (ngưỡng từ `cycleThresholds.classification`, chỉ phát khi mẫu `SUFFICIENT`): `TRAINING_ADHERENCE_GOOD` (≥80%), `TRAINING_ADHERENCE_LOW` (≤60%), `INSUFFICIENT_TRAINING_HISTORY`. Không tạo EXERCISE_PROGRESSING/PLATEAU/MUSCLE_VOLUME_* vì không có ngưỡng thẩm quyền theo bài/nhóm cơ.

## 13. Cross-user isolation
Danh tính chỉ từ `req.user.id`; không có tham số user; mọi query lọc `userId` (feedback qua `workoutSchedule.userId`). Reader forward Authorization của chính caller.

## 14. Test evidence
| Test | Nhãn | Kết quả |
|---|---|---|
| `fitness-service/src/__tests__/training-analytics-window.test.ts` — 11 test: cửa sổ, empty, STALE, adherence 9/12, ngưỡng signal, ad-hoc không lịch, progression, warm-up, volume, RPE/RIR thưa, session feedback | TEST FIXTURE (hàm production thật) | 11/11 pass |
| `training-analytics-window.integration.test.ts` — biên cửa sổ (trước/đúng đầu/trong/sau asOf; lịch tương lai & trước cửa sổ), cross-user A/B, STALE | BACKEND INTEGRATION (`gymcoach_fitness_test` @55433) | 2/2 pass |
| `ai-service/src/__tests__/coach-state-training.test.ts` — 9 test: reader ok/error/404/malformed, assembler demand-driven, goal + pass-through, quality survive, upstream error ≠ NO_DATA, thiếu read ⇒ error, cross-user | TEST FIXTURE (axios stub) | 9/9 pass |

Yêu cầu §21–30 ánh xạ: 21 empty → test "empty"; 22 → "9/12"; 23 → "ad-hoc"; 24 → "progression"; 25 → "volume"; 26 → "sparse RPE/RIR"; 27 → integration "boundary"; 28 → integration + ai cross-user; 29 → "upstream failure"; 30 → "coach state".

Regression đã chạy (scoped, KHÔNG phải full repo): fitness-service `cycle-metrics.engine`, `training-cycle-metrics.service`, `cycle-decision.engine`, `compute-new-prs-warmup.integration`, `stats.service.integration`, `training-cycle-data-sufficiency.integration`, `nutrition-consistency-score.integration`, `month-cycle-simulation.integration`, `adaptive-cycle-evaluation.integration` ⇒ **85/88 pass**; 3 fail đều trong `adaptive-cycle-evaluation.integration` do `401` khi gọi user-service (stack test không có user-service/token) — lỗi môi trường, không liên quan thay đổi (phần đó gọi user-service để lấy InBody/profile). ai-service: `enterprise-data-layer` + `context-assembler` 21/21 pass. `tsc --noEmit` sạch cả hai service.

## 15. HTTP smoke
`REAL HTTP/API` (cục bộ, không Docker dev, không production): `tsx src/server.ts` trên cổng 3992 với DB `gymcoach_fitness_test`, danh tính qua đường gateway-trust (`x-gateway-secret`). User A seed 10 workout/10 lịch (8 COMPLETED, 2 SKIPPED; 1 SKIPPED nằm ngoài 28 ngày), user B rỗng.
- A: `adherence 9 scheduled / 8 completed / 1 missed, 0.89`, `completedSetCount 18`, `totalVolumeLoadKg 10440` (khớp tính tay Σ(62.5..82.5)×2×8), 1 bài progression `changePct 27%, weeksObserved 4, SUFFICIENT`, signal `TRAINING_ADHERENCE_GOOD`.
- B: `NO_DATA`, `NO_SCHEDULE`, volume 0, không progression, không signal.
- `days=3` ⇒ 400; không header ⇒ 401; `?userId=` bị bỏ qua (kết quả theo identity).
- Dev stack (Docker): container `gymcoach-fitness-dev` chạy mã cũ (404) → đã `docker restart` theo quy ước đã ghi; sau đó route trả 401 khi không auth. Đăng nhập fixture dev thất bại (user không còn/mật khẩu) nên **không** smoke được trên dev DB. Reader ai-service chỉ được test bằng stub axios (không có smoke ai-service→fitness thật): `HTTP_ENVIRONMENT_BLOCKED` cho nhánh đó.
- Dữ liệu seed smoke đã xoá khỏi DB test; container `postgres-test` (do tôi bật) đã dừng.

## 16. Performance
Mỗi request: `computeAdherence` (1 query), `computeWorkoutMetrics` (1 `workout.findMany` có include lồng — Prisma gom theo quan hệ, số truy vấn không tăng theo số workout/set), feedback (1 query), cộng 1 `workout.findFirst` chỉ khi cửa sổ trống. **Không N+1.** Đo thô trên DB test: 20 workout × 3 bài × 5 set = 300 set ⇒ ~65 ms. Không đếm được số truy vấn bằng log Prisma (client không bật query event) — con số trên là từ đọc code + thời gian.

## 17. Intentional changes
- Route mới `GET /stats/training-window` (read-only).
- `SetRow.exerciseId?` + select `exercise.id` (additive).
- ai-service: `TRAINING_COACH_STATE` trong context assembler; `training.reader.ts`; `coach-state/coach-state.ts`; type mirror trong `enterprise-data/types.ts`.
- Telemetry `coach_training_state_read` (outcome, windowDays, dataQuality, scheduledCount, completedCount, progressionExerciseCount, latencyMs); không userId/cân nặng/RPE/lịch sử bài tập.
- Hành vi hội thoại **không đổi**: CoachState chưa vào prompt.

## 18. Deferred
Nutrition/body/recovery trong CoachState; sets-per-muscle; plateau rolling-window; nhãn xu hướng theo bài; timezone người dùng; protein adherence; InBody confidence; trajectory; wiring vào prompt; cache.

## 19. Phase 4.2 entry point
Gợi ý: nối `getCoachStateV0` vào một intent huấn luyện duy nhất qua `assembleContext` (có cờ), để LLM chỉ **diễn đạt** `training.signals/adherence/progression` — hoặc, nếu ưu tiên dữ liệu, chuẩn hoá nutrition actual (§28 audit bước 4.3). Cần quyết định sản phẩm trước khi chọn.

## Lưu ý vận hành
- `ai-service/src/services/enterprise-data/types.ts` đã có sửa đổi chưa commit của luồng khác trước phiên này; phần thêm của Phase 4.1 chỉ là khối cuối file (additive).
