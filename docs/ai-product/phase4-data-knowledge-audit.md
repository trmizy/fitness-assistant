# Phase 4 — Audit dữ liệu cá nhân, Coach Analytics và Knowledge/RAG

> Loại tài liệu: audit READ-ONLY. Không có code/schema/migration/training nào bị thay đổi.
> Nhãn bằng chứng: **toàn bộ kết luận ở đây là `CODE AUDIT`** (đọc schema, service, dữ liệu catalog trong repo).
> Không có `REAL BROWSER` / `REAL HTTP/API` / `BACKEND INTEGRATION` nào được chạy cho báo cáo này.
> Những điều chưa kiểm chứng được (ví dụ nội dung thực tế trong Qdrant đang chạy) được ghi là `UNKNOWN`.

## 1. Executive summary

1. **Gymini đã có khá nhiều analytics deterministic — nhưng chúng nằm trong fitness-service, gắn với `TrainingCycle`, và chat/AI-coach không đọc chúng.** `cycle-metrics.engine.ts`, `cycle-decision.engine.ts`, `nutrition-decision.engine.ts`, `weight-trend.util.ts`, `inbody-quality.evaluator.ts`, `fitness-roadmap-forecast.engine.ts` đã tính adherence, volume/tuần/nhóm cơ, e1RM trend, RPE/RIR trend, pain/fatigue/recovery score, body-weight/SMM/body-fat trend, goal progress, data-quality. Đường chat (`profile_extractor.ts`) chỉ lấy hồ sơ, toàn bộ InBody, 20 workout gần nhất, nhật ký dinh dưỡng, `daily-history?days=7`, program/plan hiện tại và goal.
2. **Phase 4 vì vậy chủ yếu là "mở và chuẩn hoá" chứ không phải "xây engine mới".** Phần còn thiếu thật sự là: (a) cửa sổ cuốn chiếu không phụ thuộc cycle, (b) một lớp `CoachState` typed có trạng thái chất lượng dữ liệu, (c) reader trong ai-service.
3. **Thiếu dữ liệu thật ở 3 mảng:** recovery/lifestyle (không có sleep/steps/HR/HRV; chỉ có readiness/RPE/pain theo buổi tập và check-in PT), intake thực tế đầy đủ (chỉ có `consumedCalories/Protein/...` khi tick bữa trong plan + nhật ký tự do `NutritionLog` không được dùng để tính adherence), và weigh-in độc lập (cân nặng lịch sử chỉ sống trong `InBodyEntry`, tối đa 1/ngày; `BodyMetrics` không có đường ghi).
4. **Knowledge base: rộng nhưng "mỏng" ở phần có thẩm quyền.** Có 31 nguồn evidence curated với 83 chunk (ISSN, ACSM, ESPEN, IOC, WHO, HHS…) — chất lượng tốt nhưng ít. Khối lượng lớn (7.072 doc "master" + 5.946 FAQ) là **dữ liệu synthetic** (`source_group = synthetic_knowledge`) sinh từ catalog nội bộ, không có provenance khoa học. Đừng đồng nhất số chunk với độ phủ.
5. **Retrieval:** 4 collection chạy song song, không rerank, không hybrid/lexical, không filter theo domain, top-k 5 sau dedupe, ngưỡng 0.35; prompt cắt còn 3 doc thường + 3 evidence. Citation chỉ có cho `fitness_evidence`. Không có chính sách xử lý mâu thuẫn nguồn.
6. **Verdict: `PHASE4_FOUNDATION_PARTIAL`.**

## 2. Repository baseline

| Mục | Giá trị |
|---|---|
| START_HEAD | `187745350ab147003d030d4826c430e84dfe3e59` |
| END_HEAD | `187745350ab147003d030d4826c430e84dfe3e59` (không đổi — không có `REPOSITORY_BASELINE_CHANGED`) |
| Branch | `aws-deploy` |
| Working tree | bẩn từ trước (121 mục `git status --short`, chủ yếu `ai-service`, `chat-service`…). Audit không đụng vào. |
| Ghi chú | Chỉ file mới được tạo: tài liệu này. Experiment Qwen3 4B không bị can thiệp. |

## 3. Kiến trúc dữ liệu cá nhân

```
auth-service  : User (identity)
user-service  : UserProfile (demographics, goal, currentWeight/targetWeight, injuries, equipment, goalIntent)
                InBodyEntry (đo lường; 1/ngày/user)
                ClientJourney, Contract, Session (PT)
fitness-service: Workout → WorkoutExercise → WorkoutSet → WorkoutSetSegment   (log THỰC TẾ)
                WorkoutProgram → Day → Exercise → SetPrescription            (KẾ HOẠCH)
                WorkoutSchedule (status, completedAt, trainingCycleId)       (lịch + hoàn thành)
                CycleSessionFeedback / ExerciseSessionFeedback               (readiness, sRPE, pain, skipReason)
                NutritionGoal (versioned) / NutritionProgram / NutritionMealCompletion / NutritionLog
                FitnessRoadmap → RoadmapPhase → TrainingCycle → CycleAssessment
                CycleInBodyLink, RecommendationAudit, CoachClientActionAudit
ai-service    : PersonalizedServiceCheckIn (weight, energy, sleepQuality, stress, adherence tự báo)
                WorkoutPlan/NutritionPlan (plan AI), Knowledge* (pipeline bookkeeping)
```

Cách ai-service đọc dữ liệu cá nhân hiện nay (CODE AUDIT, `llm/profile_extractor.ts:368-403`, `services/enterprise-data/*`):

| Reader | Endpoint | Ghi chú |
|---|---|---|
| profile | user-service `/profile/me` | |
| InBody | user-service `/inbody` | toàn bộ lịch sử, desc |
| workouts | fitness `/workouts?limit=20` | 20 buổi gần nhất, không phải cửa sổ thời gian |
| nutrition logs | fitness `/nutrition` | nhật ký tự do |
| daily consumption | fitness `/nutrition/daily-history?days=7` | 7 ngày |
| program/plan | `/workouts/programs/current`, `/nutrition/plans/current` | |
| goal | `/nutrition/goals`, `/nutrition/goals/history` | |
| schedules | `/workouts/schedules` (typed reader) | |
| **cycle metrics / assessment / roadmap / forecast** | — | **chat không đọc**. Chỉ `cycle-assessment.service` (ai-service) dùng qua `/internal/training-cycles/completed`. |

Reader typed (`AuthoritativeRead<T>` = `ok | absent | error`) đã có sẵn và là mẫu đúng cho Coach State: nó phân biệt "không có" với "lỗi".

## 4. Data inventory matrix

`Hist` = có giá trị lịch sử; `TS` = có timestamp; `AI` = ai-service truy cập được; `Used` = chat/AI đang dùng.

| Domain | Field / Metric | Storage | Hist | TS | Source of truth | Granularity | AI | Used | Quality concerns | Coach State usage |
|---|---|---|---|---|---|---|---|---|---|---|
| Body | body weight | `UserProfile.currentWeight` (hiện tại), `InBodyEntry.weight` (lịch sử) | CÓ (chỉ qua InBody) | CÓ | InBody (đo), profile (khai báo) | ≤1/ngày | CÓ | CÓ (latest) | Không có weigh-in độc lập; `currentWeight` không có lịch sử; `BodyMetrics.weight` không có đường ghi | trend, gap-to-target |
| Body | target weight | `UserProfile.targetWeight` | KHÔNG (chỉ giá trị hiện tại) | updatedAt thôi | UserProfile | — | CÓ | CÓ | Đổi target không để lại vết | goal gap |
| Body | starting weight | `UserProfile.startingWeight` + `startingWeightSource` | 1 điểm | — | UserProfile | — | CÓ | ? | | baseline |
| Body | body fat % / mass | `InBodyEntry.bodyFatPct/bodyFat` | CÓ | CÓ | InBody | theo lần đo | CÓ | CÓ | Máy/điều kiện đo khác nhau; evaluator có outlier rule | trend |
| Body | skeletal muscle mass | `InBodyEntry.muscleMass` | CÓ | CÓ | InBody | theo lần đo | CÓ | CÓ | Tên cột `muscleMass` — cần xác nhận là SMM chứ không phải lean mass (không suy luận từ tên) | trend |
| Body | visceral fat, BMR, segmental lean/fat | `InBodyEntry` | CÓ | CÓ | InBody | theo lần đo | CÓ | một phần | nullable | imbalance (dữ liệu có, logic cần viết) |
| Body | ECW/TBW, body water | `InBodyEntry` — **NOT PRESENT**; `BodyMetrics.bodyWater` tồn tại nhưng không ghi | — | — | — | — | — | — | | — |
| Workout | attendance / completion | `WorkoutSchedule.status`, `completedAt`, `completedSets/Exercises` | CÓ | CÓ | WorkoutSchedule | theo buổi | CÓ (schedules reader) | CÓ | `@@unique([userId,date])` ⇒ 1 lịch/ngày | adherence |
| Workout | sets/reps/load | `WorkoutSet.reps/weight/completed` | CÓ | `createdAt` | Workout log | theo set | CÓ (20 buổi) | CÓ | Bodyweight: `bodyWeightAtSetKg` nullable | volume, e1RM |
| Workout | RPE / RIR | `WorkoutSet.rpe/rir`, `CycleSessionFeedback.sessionRpe` | CÓ | CÓ | log | theo set/buổi | cycle-only | không (chat) | optional → sparse | fatigue |
| Workout | set type / drop-set / rest-pause | `WorkoutSet.setType`, `WorkoutSetSegment` | CÓ | CÓ | log | theo set | | | segments tách khỏi set count (đúng thiết kế) | volume chính xác |
| Workout | rest time | plan: `SetPrescription.restSeconds`; actual: chỉ `restBeforeSeconds` ở segment | KHÔNG (actual) | | | | | | **không có rest thực tế cho set thường** | NOT_RELIABLE |
| Workout | duration | `Workout.duration` (phút), `WorkoutSchedule.durationSeconds` | CÓ | CÓ | schedule | theo buổi | | | hai nguồn song song | duration trend |
| Workout | muscle/group metadata | `Muscle`, `ExerciseMuscle`, `Exercise.bodyPart` | catalog | | Exercise.id | | CÓ | | | sets/muscle/week |
| Workout | substitution | `WorkoutExercise.programExerciseId` vs `exerciseId` | suy luận | | | | | | không có cờ "substituted" tường minh | substitution rate (cần derive) |
| Workout | planned vs actual | `WorkoutProgram*` ↔ `Workout*` qua `WorkoutSchedule.programDayId/workoutId` | CÓ | | | | | | `TrainingCycle.planId` không được ghi (đúng CLAUDE.md: dùng schedule) | planned-vs-actual |
| Workout | imported workouts | `WorkoutImportBatch` (Hevy…) | CÓ | | | | | | trộn nguồn | provenance |
| Nutrition | calorie/macro target | `NutritionGoal` (versioned, ACTIVE/SUPERSEDED) | **CÓ** | CÓ | NutritionGoal | | CÓ | CÓ | | target history |
| Nutrition | actual intake (plan) | `NutritionMealCompletion.consumed*` | CÓ | `logDate` | | theo bữa | CÓ qua daily-history | 7 ngày | chỉ khi user tick bữa trong plan | adherence |
| Nutrition | actual intake (diary) | `NutritionLog` (calories, protein?, carbs?, fats?) | CÓ | CÓ | | theo món | CÓ | CÓ | macros nullable; **không vào adherence engine** | adherence |
| Nutrition | protein adherence | — | — | — | — | — | — | — | `nutritionAdherence` chỉ là calories; engine tự ghi chú "no protein-specific adherence data source exists" | **NOT PRESENT** (dù `consumedProtein` có cột) |
| Nutrition | dietary pref/allergy | `UserProfile.dietaryPreference`; allergy/restriction có cấu trúc: **NOT PRESENT** (chưa xác nhận field riêng) | | | | | | | | |
| Recovery | sleep | `PersonalizedServiceCheckIn.sleepQuality` (1–5, theo tuần, chỉ khách PT); `RecoveryContext.sleep_hours_avg` luôn `null` (`coach_context_builder.ts:349`) | thưa | CÓ | | | | | | **NOT PRESENT** cho user thường |
| Recovery | steps/activity | `fitness-diagnosis.engine` nhận `dailyGoalSteps` (đầu vào/ước lượng), không có log | — | — | | | | | | **NOT PRESENT** |
| Recovery | HR / HRV / wearable | không có field/integration nào trong schema (grep sleep/HR/HRV/HealthKit/Health Connect trên `*.prisma` & mobile/web) | — | — | | | | | | **NOT PRESENT** |
| Recovery | readiness / soreness / pain | `CycleSessionFeedback.readinessScore/fatigueAfterSession/painScore/painLocation`; `WorkoutSet.painScore` | CÓ | CÓ | | theo buổi/set | cycle-only | không (chat) | chỉ khi user điền | recovery proxy |
| Goal | goal type/timeline | `UserProfile.goal`, `goalIntent`(Json), `FitnessRoadmap.plannedStart/EndAt`, `targetMetrics`(Json), `TrainingCycle.baselineMetrics/targetMetrics` | CÓ (roadmap version/previousRoadmapId) | CÓ | Roadmap | | cycle/roadmap-only | không | Json tự do ⇒ schema không đảm bảo | goal gap |
| Safety | injuries/limitation | `UserProfile.injuries: String[]`, `safetyScreeningStatus/Flags` | KHÔNG | | UserProfile | tự do | CÓ | CÓ | chuỗi tự do | constraints |
| Equipment | availableEquipment | `UserProfile.availableEquipment`, `UserEquipment` | KHÔNG | | | | CÓ | CÓ | | constraints |

## 5. Time-series readiness

| Metric | Loại | Chi tiết |
|---|---|---|
| Cân nặng | **B** (snapshot, thưa) + **E** | Chỉ `InBodyEntry` (≤1/ngày, người dùng phải nhập). `currentWeight` chỉ giá trị hiện tại. `PersonalizedServiceCheckIn.weight` là nguồn thứ hai chỉ cho khách PT. Không có weigh-in hằng ngày. |
| Target weight | **A** | chỉ giá trị hiện tại |
| InBody | **B** | nhiều bản ghi được lưu, đủ cho trend (cần ≥2, evaluator cảnh báo khoảng cách <3 ngày) |
| Workout thực tế | **C**, nhưng **D** với chat | Có thể dựng lại 8–12 tuần từ `Workout/WorkoutSet` + `WorkoutSchedule`; chat chỉ đọc 20 buổi gần nhất |
| Cycle metrics | **C/D** | Tính khi chạy engine, lưu vào `CycleAssessment.computedMetrics`; chat không đọc |
| NutritionGoal | **B** | versioned có `validFrom/supersededAt` |
| Intake thực tế | **C**, **E** | có log theo ngày nhưng hai nguồn (meal completion vs diary) và adherence chỉ dùng nguồn đầu |
| Sleep/steps/HR | không có | — |
| Roadmap/phase | **B** | version chain `previousRoadmapId`, phase actual/planned dates |

Ngữ nghĩa xoá/sửa: `WorkoutExercise.exerciseNameSnapshot` là snapshot chống đổi tên; `WorkoutMutationEvent` là idempotency key chứ không phải audit trail đầy đủ — **không có lịch sử chỉnh sửa log** (xoá/sửa set không để lại vết) ⇒ ghi là ambiguity ở §11.

## 6. Coach Analytics feasibility

Quy ước: `READY_NOW` = đã tính được trong code hiện có; `SMALL_READER` = cần reader/endpoint nhỏ; `NEW_LOGIC` = cần logic derive mới; `NEW_DATA` = cần capture mới; `NOT_RELIABLE`.
Cột cuối: `RULE` deterministic, `STAT` thống kê, `ML?` ứng viên ML về sau.

| Tín hiệu | Trạng thái | Căn cứ | Loại |
|---|---|---|---|
| Weekly training frequency | READY_NOW (`workoutsPerWeek`) — nhưng gắn cycle | cycle-metrics.engine | RULE |
| Scheduled vs completed adherence | READY_NOW (`computeAdherence`; `hasScheduledSessions` phân biệt no-data/0%) | training-cycle-metrics.service | RULE |
| Exercise completion rate | SMALL_READER (`completedExercises/totalExercises` đã lưu) | WorkoutSchedule | RULE |
| Sets per muscle/week | READY_NOW (`weeklyVolumeByMuscleGroup`) | cycle-metrics | RULE |
| Volume load | READY_NOW | | RULE |
| Exercise progression / e1RM trend | READY_NOW (`exerciseProgression`, `estimated1RmTrend`) | | STAT |
| Plateau | READY_WITH cycle: `plateauWindowWeeks` trong decision engine; ngoài cycle = NEW_LOGIC | cycle-decision.engine | STAT |
| Session duration trend | SMALL_READER | `durationSeconds` | STAT |
| Skipped trend / skip reason | SMALL_READER (`skipReason` có) | CycleSessionFeedback | RULE |
| Substitution frequency | NEW_LOGIC (so `programExerciseId` vs `exerciseId`) | | RULE |
| Muscle balance / lagging | READY_NOW (`laggingMuscleGroupCount`) | classification | RULE |
| Deload need | READY_NOW trong cycle (decision `DELOAD`) | | RULE |
| Recovery signal | PARTIAL: `recoveryScore` từ readiness (chỉ khi user điền) | | STAT |
| Weight trend / change per week | READY_NOW (`computeWeightTrend`, `bodyWeightTrend`) trên InBody | | STAT |
| BMI trend | NEW_LOGIC nhẹ (`bmi` nullable) | | RULE |
| Body-fat / SMM trend | READY_NOW (`bodyFatTrend`, `skeletalMuscleTrend`) | | STAT |
| InBody confidence / outlier | READY_NOW (`inbody-quality.evaluator`) | | RULE |
| Segmental imbalance | NEW_LOGIC (có dữ liệu) | | RULE |
| Calorie adherence | READY_NOW nhưng **hẹp** (chỉ meal-completion) | `computeNutritionConsistencyScore` | STAT |
| Protein/macro adherence | **NEW_LOGIC** (`consumedProtein/Carbs/Fat` có; diary macros nullable) | | RULE |
| Weekly intake average | SMALL_READER (`daily-history`) | | STAT |
| Weight-response vs energy balance | NOT_RELIABLE hôm nay (intake thưa + cân thưa; `hall-2011`, `nunes` cảnh báo adaptive thermogenesis) | | STAT |
| Meal adherence | READY_NOW (`status` COMPLETED/PARTIAL/SKIPPED) | | RULE |
| Goal gap (current vs target) | SMALL_READER (profile target + InBody latest) | | RULE |
| Expected trajectory | READY_NOW (forecast engine — "non-binding scenario") | | STAT |
| Actual trajectory | READY_NOW (từ trend) | | STAT |
| Ahead/on-track/behind | NEW_LOGIC | | RULE |
| Time-to-target | READY_WITH_CAVEAT (forecast; confidence tier có) | | STAT |
| Dropout/churn prediction | NEW_DATA + LATER | | ML? |

## 7. Raw vs derived

- **RAW (không đưa nguyên cho LLM):** từng `WorkoutSet`, từng `InBodyEntry`, từng `NutritionLog`.
- **DERIVED deterministic (nên đưa cho LLM):** `adherence = completed/scheduled` kèm `scheduledCount`; `weeklySetsByMuscle`; `e1rmChangePct` theo bài; `weightTrendKgPerWeek` + `confidence`; `calorieAdherence` + `daysLogged`.
- Mọi tín hiệu ở §6 loại RULE/STAT đều deterministic; **không có tín hiệu nào cần ML để ra giá trị đầu tiên**.

## 8–9. CoachStateV0 (chỉ thiết kế) + mô hình chất lượng dữ liệu

Mỗi field kèm `quality: DataQuality` (không bao giờ ngầm định). Trạng thái:

```ts
type DataQuality =
  | "NO_DATA"              // chưa có bản ghi nào
  | "INSUFFICIENT_HISTORY" // có nhưng chưa đủ để kết luận xu hướng
  | "STALE"                // bản ghi mới nhất quá cũ so với asOf
  | "CURRENT"
  | "ESTIMATED"            // suy ra, không đo
  | "AUTHORITATIVE"        // lấy trực tiếp từ model sở hữu
  | "PARTIAL";             // một phần field/kỳ thiếu

type Signal<T> = { value: T | null; quality: DataQuality; basis: { n: number; windowDays: number; latestAt?: string }; source: string };
```

```ts
type CoachStateV0 = {
  asOf: string;                       // do reader gán, không do LLM
  window: { days: 28 };               // cửa sổ cuốn chiếu, không phụ thuộc TrainingCycle

  goal: {
    type:        Signal<"WEIGHT_LOSS"|"MUSCLE_GAIN"|"MAINTENANCE"|"ATHLETIC_PERFORMANCE">; // UserProfile.goal
    targetWeight:Signal<number>;      // UserProfile.targetWeight (không lịch sử)
    gapKg:       Signal<number>;      // target - InBody.latest.weight ; ESTIMATED nếu InBody cũ
  };

  body: {
    weightTrendKgPerWeek: Signal<number>;  // weight-trend.util + bodyWeightTrend; INSUFFICIENT_HISTORY nếu < minWeightSamples
    bodyFatPctTrend:      Signal<"up"|"flat"|"down">;
    smmTrend:             Signal<"up"|"flat"|"down">;
    measurementQuality:   Signal<"LOW"|"MEDIUM"|"HIGH">; // inbody-quality.evaluator
  };

  training: {
    scheduledSessions:  Signal<number>;
    completedSessions:  Signal<number>;
    adherence:          Signal<number>;     // NO_DATA nếu scheduled = 0 — KHÔNG phải 0%
    weeklySetsByMuscle: Signal<Record<string, number>[]>;
    e1rmProgression:    Signal<{ exerciseId: string; changePct: number | null }[]>;
    sessionRpeAvg:      Signal<number>;     // NO_DATA nếu không ai nhập RPE
    skipReasons:        Signal<Record<string, number>>;
  };

  nutrition: {
    activeTarget:      Signal<{kcal:number;proteinG:number;carbsG:number;fatG:number}>; // NutritionGoal ACTIVE — AUTHORITATIVE
    daysLogged:        Signal<number>;
    calorieAdherence:  Signal<number>;   // chỉ khi daysLogged >= ngưỡng; "target có, intake không" ⇒ NO_DATA
    proteinAvgG:       Signal<number>;   // PARTIAL nếu macros nullable
  };

  recovery: {
    readinessAvg:  Signal<number>;       // CycleSessionFeedback; NO_DATA nếu không điền
    painAvg:       Signal<number>;
    // sleep / steps / HRV: KHÔNG đưa vào V0 — không có dữ liệu
  };

  roadmap: {
    phase:          Signal<{ type: string; weekInPhase: number }>;   // RoadmapPhase
    latestDecision: Signal<"KEEP"|"PROGRESS"|"ADJUST"|"DELOAD"|"REBUILD"|"INSUFFICIENT_DATA">; // CycleAssessment
  };

  signals: { code: string; severity: "INFO"|"WARN"; basis: string[] }[];  // chỉ phát sinh từ rule deterministic
  dataQuality: { overall: DataQuality; missing: string[] };
}
```

Quy tắc bắt buộc: `NO_DATA ≠ poor adherence`; `1 InBody ⇒ INSUFFICIENT_HISTORY`; `2 lần cân cách 3 tháng ⇒ weak (LOW)`; `target có + intake không ⇒ calorieAdherence = NO_DATA`. Bảng nguồn/khả thi/fallback từng field đã nằm trong §4 và §6; field nào không có nguồn thì **bị loại** khỏi V0 (sleep, steps, HRV, protein adherence chặt, hydration).

## 10. InBody / body composition

- **Model** (`user-service` `InBodyEntry`): weight, height, bmi, bodyFat(kg), bodyFatPct, muscleMass, visceralFat, bmr, segmental lean (5) và fat (5), `status` (`manual|extracted|pending`), notes, `date` + `dateOnly` (unique per user/day).
- **Không có:** đơn vị/thiết bị/nguồn thiết bị chi tiết, raw report gốc, ECW/TBW, confidence của OCR/extract (chỉ có chuỗi `status`).
- **Trend tính được:** CÓ (`bodyFatTrend`, `skeletalMuscleTrend`, `bodyWeightTrend` trong cycle engine; quality evaluator gắn cờ outlier và khoảng đo quá gần).
- **Đối xử "một lần đo là chân lý?":** profile_extractor đưa toàn bộ InBody vào context cá nhân; engine cycle thì có `minimumComparableInBodyRecords = 2` và `lowConfidence`. Ở đường **chat** chưa thấy lớp "đánh giá độ tin cậy" trước khi giá trị tới LLM — rủi ro LLM diễn giải một con số như tuyệt đối. (`CODE AUDIT`; chưa chạy thật.)
- **Evidence liên quan trong KB:** `brewer-2021-inbody-validation`, `espen-bia-1/2`, `tinsley-2022-bodycomp-standardization`.

## 11. Workout analytics

Có thể dựng lại theo ngày: `WorkoutSchedule(date,status,programDayId,workoutId)` → `Workout` → `WorkoutExercise(programExerciseId, exerciseId)` → `WorkoutSet(reps, weight, rpe, rir, completed, setType)` → `WorkoutSetSegment`; plan: `WorkoutProgramExerciseSetPrescription`.

| Câu hỏi | Trả lời |
|---|---|
| True training volume? | **Gần như có**: engine đã tính; cần xác nhận quy tắc với warm-up (`setType=WARMUP`), set chưa `completed`, bodyweight (weight null), và segment drop/rest-pause (không tách thành set). |
| Sets per muscle? | Có (`weeklyVolumeByMuscleGroup`) — chất lượng phụ thuộc `ExerciseMuscle` primary/secondary weighting (chưa kiểm). |
| Progression 4–8 tuần? | Có, e1RM tuần-top theo bài. |
| Plateau robust? | Mới trong cycle; ngoài cycle cần logic. |
| Điểm mơ hồ | template vs session; planned vs completed exercise; substitution (không có cờ); log sửa/xoá không vết; workout import trộn nguồn; hai trường duration; `@@unique([userId,date])` trên schedule làm hai buổi một ngày không biểu diễn được. |

## 12. Nutrition analytics

- **TARGET:** `NutritionGoal` (có version), `NutritionProgram` (derived từ goal qua `sourceGoalId`).
- **ACTUAL:** `NutritionMealCompletion.consumed*` (khi user tick bữa) và `NutritionLog` (nhật ký).
- Adherence hiện chỉ tính từ meal completion và chỉ calories; `NutritionLog` bị bỏ qua. Không suy ra intake từ meal plan (đúng yêu cầu).
- Kết luận: **calorie adherence đo được một phần; protein/macro adherence chưa đo được ở tầng engine; weight-response chưa đáng tin.** Nếu user chỉ có target mà không có log: `NO_DATA`.

## 13. Recovery

`NOT PRESENT`: sleep, steps, HR, resting HR, HRV, wearable, Apple Health/Google Fit/Health Connect (không có field/integration trong schema). Có: readiness/fatigue/pain/RPE theo buổi; `sleepQuality`/`stress`/`energy` theo tuần chỉ trong check-in PT. `RecoveryContext` ở coach context type hiện tồn tại nhưng điền `null`.
**Không thể** xây recovery state ngoài "readiness tự khai".

## 14. Goal / Roadmap

Có: `FitnessRoadmap` (planned/actual start-end, `targetMetrics`, `version`, `previousRoadmapId`), `RoadmapPhase` (type, planned/actual, `objective`, `transitionRules`), `TrainingCycle` (baseline/target metrics, `CycleAssessment` KEEP/PROGRESS/ADJUST/DELOAD/REBUILD), forecast engine, `NutritionGoal` version chain.
Thiếu: goal "initial state" tường minh ngoài `baselineMetrics` Json; checkpoint trung gian có cấu trúc; lịch sử thay đổi `UserProfile.targetWeight`.
**Phân loại: `ROADMAP_PARTIAL`** — mô hình miền đã tồn tại và đủ cho current/target/phase/review; thiếu lịch sử target và checkpoint typed, và lớp đọc cho chat. Không cần domain model mới để bắt đầu; cần quyết định tin `Json` nào.

## 15. Knowledge-source inventory

### 15.1 Collection được retrieval chat dùng (`llm/retriever.ts`)

| Collection | Nguồn | Số bản ghi | Bản chất | Ingest |
|---|---|---|---|---|
| `fitness_evidence` | `data/processed/evidence/*.jsonl` (+ pipeline PubMed/RSS/web/local) | **83 chunk / 31 nguồn** (file) | curated summary có `source_url`, `evidence_level`, `tags` | `datasets/seed/ingestEvidence.ts`, `knowledge-pipeline/*` |
| `fitness_knowledge` | `data/catalog/rag/gym_rag_master_dataset.csv` | 7.072 hàng | tiếng Việt, sinh từ catalog nội bộ | `src/ingest.ts` (1 hàng = 1 point) |
| `fitness_faq` | `data/catalog/qa/gym_faq_qa.csv` | 5.946 hàng, `source_group = synthetic_knowledge` | Q/A tiếng Việt synthetic | `src/ingest.ts` |
| `exercises` | `data/processed/rag/exercises.csv` | 207 dòng | catalog bài tập (equipment filter) | `src/ingest.ts` |
| (training methods) | `data/catalog/knowledge/training_methods.json` | 4 | phương pháp coach (FST-7…), có `evidence_strength`, `copyright_safe` | `ingestTrainingMethods.ts` → evidence collection |

Ngoài retrieval chat: `gym_health_guidance.csv` (400 hàng; được nạp vào master dataset dạng `health_guidance`), `catalog/rag/gym_instruction_tuning_pairs.csv` & `gym_queries.csv` (≈25 nghìn dòng — **dữ liệu training/eval, không phải KB**), NHANES (analytics/demo).

### 15.2 Nguồn evidence (31 file; theo `_index.json`)

Nhóm theo `category`: nutrition 11, bia_validation 4, energy_balance 4, training 3, supplements 3, physical_activity 2, wearable_validation 1, fat_loss_rate 1, hydration 1, safety 1.
Tổ chức/nguồn xuất hiện trong tên file/tiêu đề: ISSN (protein 2017, creatine 2017, caffeine 2021, diets 2017, nutrient timing 2017, performance 2017, timing 2014), ACSM nutrition 2016, ESPEN BIA I/II 2019, IOC dietary supplements 2018, IOC RED-S 2023, WHO PA 2020, HHS PA 2018, DGA 2020–2025, IOM AMDR, NATA fluid 2017, Mifflin 1990, Hall 2011, Garthe 2011, Morton 2018, Slater 2019, Helms 2023, Nunes, Brewer 2021, Tinsley 2022, Shcherbina 2017, unilateral/asymmetry 2021–2025, `cycle_training_knowledge_2026`.
Metadata từng chunk: `title, source_type, category, evidence_level, source_url, tags, chunk_index/total_chunks`. **Không có** `publisher`/`year` dưới dạng field riêng — năm chỉ nằm trong tên/tiêu đề ⇒ `MISSING_METADATA` cho publisher/year/authority tier ở tầng file. Chunk count thực tế trong Qdrant đang chạy: `UNKNOWN`.

### 15.3 Pipeline

- `knowledge-pipeline/` là đường chính (BullMQ + endpoint nội bộ): PubMed, RSS, web whitelist, local JSONL; có `trustTier` (1–3), trust/quality score, ngưỡng accept 0.6 / review 0.4, safety judge (regex + LLM tùy chọn), semantic-duplicate 0.95, bookkeeping Postgres (`KnowledgeDocument/Chunk`).
- `knowledge/` bị đánh dấu deprecated cho chunk/index; còn connectors Crossref/OpenAlex chạy CLI.
- Nguồn đăng ký mặc định: local evidence, NHANES local, PubMed, WHO nutrition, ACSM topics, NSCA feed, ScienceDaily (tier 3).

## 16–17. Phủ tri thức theo taxonomy

Xếp hạng dựa trên **số nguồn độc lập, độ rộng, thẩm quyền, độ mới, quần thể** — không dựa số chunk (ví dụ 2.250 FAQ "concepts" cùng một nguồn synthetic KHÔNG làm "concepts" thành STRONG).

| Domain | Rating | Lý do (bằng chứng) |
|---|---|---|
| Exercise science — programming/volume/frequency/progression | **PARTIAL** | 3 file evidence `training` + `cycle_training_knowledge_2026` (9 chunk, nội bộ) + 205 hàng programming synthetic. Không có NSCA/ACSM resistance-training position stand trong file. |
| Hypertrophy / strength nền tảng | **PARTIAL→WEAK** | chỉ gián tiếp (Slater, Helms, Morton); không có Schoenfeld/ACSM RT guideline dưới dạng nguồn. |
| Exercise technique | **PARTIAL (chất lượng chưa xác minh)** | 205 bài × (form/mistakes/sets_reps/substitution) — **synthetic, không nguồn**; hữu ích cho UX, không có thẩm quyền. |
| Nutrition — protein | **STRONG** | ISSN 2017, Morton 2018, IOM AMDR, ACSM — nhiều nguồn độc lập, có số g/kg. |
| Nutrition — energy balance/cut/bulk | **PARTIAL→STRONG** | Hall 2011, Garthe 2011, Slater 2019, Helms 2023, Nunes, Mifflin, RMR review. |
| Nutrition — carb/fat | **PARTIAL** | IOM AMDR, ISSN diets, ACSM. |
| Hydration | **WEAK** | 1 nguồn (NATA 2017). |
| Meal planning / thực phẩm VN | **PARTIAL (số liệu catalog)** | 149 food + 120 meal plan nội bộ; macro chuẩn là USDA (theo DATASETS.md) nhưng KB chat dùng bản synthetic. |
| Recovery — sleep/stress/fatigue/deload | **WEAK** | evidence: RED-S, IOC; FAQ synthetic cho sleep/stress/steps (90 hàng/chủ đề). Không có nguồn về sleep/ HRV riêng. |
| Body composition (BIA/InBody) | **STRONG (hẹp)** | ESPEN ×2, Brewer 2021, Tinsley 2022, Shcherbina (wearable) — ít nhưng sát chủ đề. |
| Supplements | **PARTIAL** | creatine, caffeine, IOC consensus; thiếu các chất khác. |
| Safety / red flags / referral | **WEAK→PARTIAL** | RED-S + 400 `health_guidance` synthetic (có disclaimer); chưa có nguồn lâm sàng về red-flag. |
| Special populations | **WEAK** | có `population_code` trong health_guidance (dân văn phòng…) nhưng nguồn synthetic; không có nguồn cho người cao tuổi/thai phụ/bệnh nền. |
| Gym terminology (RPE, RIR, tempo, 1RM…) | **PARTIAL** | 90 hàng/chủ đề (RPE, RIR, tempo, failure…) synthetic nhất quán nội bộ; không có nguồn trích. |

## 18. Chunking

- Pipeline chính (`knowledge-pipeline/chunking.ts`): **ký tự, không phải token** — 1.200 ký tự, overlap 160, cắt tại `. `/`; `/`: ` nếu > 55% cửa sổ, snap-forward về ranh giới từ; bỏ chunk ≤ 80 ký tự; `tokenCount` ước lượng `từ × 1.25`.
- **Không** nhận biết heading/section/bảng/danh sách; không parent-child; không số trang. Metadata giữ: title, source_url, chunk_index/total_chunks, tags, trust/quality.
- Embedding text ghép `title + chunk + tags` — title được nhắc lại trong từng chunk (giảm mất ngữ cảnh).
- CSV catalog: **không chunk** — 1 hàng = 1 point (median 285 ký tự, p90 533, max 1.058) — ngắn, khép kín; ít rủi ro cắt giữa khái niệm.
- Evidence JSONL là bản tóm tắt thủ công (≈1–3 chunk/nguồn): "chunk" thực chất là đoạn tóm tắt; mất chi tiết điều kiện/quần thể là rủi ro thực.
- Ghi chú: ước lượng token theo từ `×1.25` sai lệch với tiếng Việt (tokenizer Qwen) — chưa đo.

## 19. Embedding / vector store

| Mục | Giá trị |
|---|---|
| Provider embedding | `EMBEDDING_PROVIDER`: `bedrock` (Cohere multilingual v3, 1024-d), `ollama` (nomic-embed-text, 768-d), `mock` |
| Vector DB | `VECTOR_STORE_PROVIDER`: `qdrant` (mặc định) hoặc `opensearch` |
| Kích thước | từ `EMBEDDING_VECTOR_SIZE`; có `VectorDimensionMismatchError`/guard khi lệch dimension |
| Index | `fitness_evidence`, `fitness_knowledge`, `fitness_faq`, `exercises` |
| Metric | không đọc được từ code mức audit này (Qdrant collection settings) — `UNKNOWN` |
| Filter | chỉ `exercises` có `must_not typeOfEquipment` khi phát hiện "tập ở nhà" |
| Scope user | **Không** có user-scoping: toàn bộ 4 collection là tri thức toàn cục. Dữ liệu cá nhân đi đường riêng (profile_extractor/enterprise-data) — **tách đúng**. |
| Cập nhật | `stableUuid(contentHash:index)` + xoá chunk cũ theo document; `ingest.ts` bỏ qua nếu collection đã có dữ liệu |

Điểm cần lưu ý: collection local (nomic 768-d) và AWS (Cohere 1024-d) khác dimension — hệ thống đã có guard và trả rỗng + log lỗi thay vì lỗi im lặng.

## 20. Retrieval pipeline (thực tế trong code)

```
question
 → intent sớm: nutrition-lookup / workout-schedule ⇒ BỎ QUA RAG (orchestrator.service.ts ~l.466)
 → expandQueries(): thêm biến thể bằng regex (fat loss, muscle gain, injury, equipment, body-fat, protein, beginner, nhóm cơ)
 → embed từng biến thể (search_query, timeout 8000ms)
 → search song song 4 collection, mỗi collection limit = TOP_K (5)
 → loại điểm < MIN_SCORE (0.35)
 → dedupeAndSort theo id, sort theo score, cắt TOP_K = 5 (toàn bộ)
 → compactRetrieval(): tối đa 3 doc thường + tối đa 3 evidence (E1..E3, kèm [nguồn: url])
 → prompt
```

| Tham số | Giá trị | Env |
|---|---|---|
| top-k | 5 | `RAG_TOP_K` |
| min score | 0.35 | `RAG_MIN_SCORE` |
| rerank | **KHÔNG CÓ** | — |
| lexical/hybrid | **KHÔNG CÓ** | — |
| filter domain/topic/language | **KHÔNG CÓ** (chỉ equipment trên `exercises`) | — |
| timeout RAG | `RAG_TIMEOUT_MS` | |

Lưu ý: `search` mỗi collection lấy 5 rồi gộp qua mọi biến thể; sort chỉ theo cosine — **điểm giữa các collection/provider không chuẩn hoá** nên collection nào phân bố điểm cao hơn sẽ lấn át (đặc biệt synthetic FAQ vì Q/A ngắn, khớp câu hỏi mạnh).

## 21. Phù hợp với Qwen3 4B

Quan sát từ code (không có số token đo được trong audit này — `UNKNOWN` cho kích thước prompt thực tế):

- **Tích cực:** trần context kiểm soát (≤3 + ≤3 doc, chunk catalog < 1.100 ký tự; instruction của exercise cắt 120 ký tự; comment trong code ghi rõ lý do "more context doesn't improve small-model accuracy").
- **Rủi ro:** (1) doc synthetic có thể chiếm slot của evidence thật vì không có ưu tiên theo nguồn; (2) không rerank nên top-3 phụ thuộc hoàn toàn vào cosine một-vector; (3) chunk evidence 1.200 ký tự gồm nhiều ý (g/kg + timing + loại protein) — LLM nhỏ dễ lấy nhầm số; (4) chunk catalog không có nhãn nguồn; (5) tiếng Anh (evidence) trộn tiếng Việt (catalog) trong cùng prompt; (6) cùng một fact xuất hiện ở `fitness_knowledge` và `fitness_faq` (trùng lặp ngữ nghĩa — số bản sao chưa đo); (7) query expansion thêm cụm tiếng Anh cố định kiểu "calorie deficit high protein" có thể kéo cùng cụm doc cho nhiều câu hỏi.
- Khẳng định kích thước-mô-hình: **không** đưa ra khi chưa có số token thực.

## 22. Loại câu hỏi RAG & ranh giới định tuyến

| Loại | Ví dụ | Cần | Định tuyến hiện tại |
|---|---|---|---|
| A. Knowledge QA | "Progressive overload là gì?" | RAG | Có — chạy `retrieveForChat` |
| B. Personalized knowledge | "Với lịch hiện tại, progressive overload thế nào?" | context cá nhân + (Coach State) + RAG | Context + RAG chạy song song; **không có Coach State** nên LLM chỉ thấy 20 buổi thô |
| C. Business state | "Macro hiện tại của tôi?" | enterprise data, không RAG | `detectNutritionLookupIntent` và `detectWorkoutScheduleIntent` bỏ qua RAG ⇒ **đúng ranh giới cho 2 intent này**; các câu hỏi business-state khác (InBody, goal, adherence) vẫn chạy RAG song song |

## 23. Grounding / citation

- `fitness_evidence`: giữ `source_url`, `title`, `evidence_level`, `chunk_id`, `document_id`, `source_name`, `trust_score` đến `RetrievalDocument.metadata`; prompt chèn `[nguồn: url]` và nhãn `E1..E3`.
- `fitness_knowledge`/`fitness_faq`/`exercises`: chỉ `source_file` + `chunk_id`; **không có** document name/section/page; FAQ nhãn `synthetic_knowledge` không đi vào prompt.
- Trả lời "thông tin này dựa trên nguồn nào?": **chỉ được cho nội dung evidence**; với catalog chỉ có thể nói "dữ liệu nội bộ". Đây là **document gap**. Chưa xác minh LLM thực sự giữ URL trong câu trả lời cuối (không chạy REAL HTTP).

## 24. Xung đột tri thức

`NO_CONFLICT_RESOLUTION_POLICY`: có `trustTier`, `evidence_level`, `trust_score` ở metadata nhưng `dedupeAndSort` chỉ sort theo similarity; không có luật cũ/mới, quần thể, mục tiêu, hay "evidence thắng catalog".

## 25. Bộ câu hỏi kiến thức đại diện (thiết kế, không chạy)

Nhãn: **S** SUPPORTED_BY_CURRENT_SOURCE · **P** PARTIALLY_SUPPORTED · **N** NOT_SUPPORTED · **U** UNKNOWN_UNTIL_RETRIEVAL_TEST.

| # | Nhóm | Câu hỏi | Nhãn |
|---|---|---|---|
| 1 | Programming | Progressive overload là gì? | U (catalog synthetic) |
| 2 | Programming | Bao nhiêu set/tuần/nhóm cơ để tăng cơ? | P |
| 3 | Programming | Tập mỗi nhóm cơ mấy lần/tuần? | P |
| 4 | Programming | Full body hay split cho người mới? | P |
| 5 | Programming | Khi nào cần deload? | P |
| 6 | Programming | Tập đến failure có cần không? | P |
| 7 | Programming | Nghỉ giữa set bao lâu? | P (rest_times) |
| 8 | Programming | Rep range nào tốt cho hypertrophy? | P |
| 9 | Programming | Cardio có làm mất cơ không? | N |
| 10 | Programming | Periodization là gì? | N |
| 11 | Nutrition | Cần bao nhiêu protein mỗi ngày? | S (ISSN, Morton) |
| 12 | Nutrition | Protein khi cắt mỡ? | S |
| 13 | Nutrition | Chia protein thế nào trong ngày? | S |
| 14 | Nutrition | Deficit bao nhiêu là hợp lý? | S/P (Garthe) |
| 15 | Nutrition | Tốc độ giảm cân an toàn? | S/P |
| 16 | Nutrition | Surplus bao nhiêu để tăng cơ? | S (Slater, Helms) |
| 17 | Nutrition | BMR/TDEE tính thế nào? | S (Mifflin, RMR) |
| 18 | Nutrition | Carb quanh buổi tập? | S/P (ISSN timing) |
| 19 | Nutrition | Cần bao nhiêu chất béo? | P (IOM) |
| 20 | Nutrition | Uống bao nhiêu nước? | P (NATA) |
| 21 | Nutrition | Ăn 1 bữa/ngày có ổn không? | N |
| 22 | Nutrition | Keto có tốt cho giảm mỡ? | P (ISSN diets) |
| 23 | Nutrition | Món Việt nào giàu protein? | P (food catalog) |
| 24 | Recovery | Ngủ bao nhiêu để phục hồi? | N |
| 25 | Recovery | Đau cơ DOMS là gì? | P (health_guidance synthetic) |
| 26 | Recovery | Dấu hiệu overtraining? | P (RED-S) |
| 27 | Recovery | Stress ảnh hưởng tập luyện? | P (synthetic) |
| 28 | Recovery | RED-S là gì? | S |
| 29 | Body comp | InBody đo thế nào? | S (ESPEN) |
| 30 | Body comp | BIA có chính xác? | S (Brewer, ESPEN) |
| 31 | Body comp | Cân nặng giảm nhưng body fat tăng nghĩa là gì? | P |
| 32 | Body comp | Đo InBody lúc nào để so sánh? | S (Tinsley) |
| 33 | Body comp | Visceral fat bao nhiêu là cao? | N/U |
| 34 | Body comp | Lệch cơ trái–phải bao nhiêu thì đáng lo? | P (asymmetry 2021/2025) |
| 35 | Body comp | Đồng hồ thông minh đo calo có đúng? | S (Shcherbina) |
| 36 | Supplements | Creatine dùng thế nào? | S |
| 37 | Supplements | Caffeine liều bao nhiêu? | S |
| 38 | Supplements | Whey có cần thiết? | P |
| 39 | Supplements | BCAA có tác dụng? | N |
| 40 | Supplements | Pre-workout an toàn không? | P |
| 41 | Technique | Cách squat đúng? | U (synthetic) |
| 42 | Technique | Lỗi thường gặp khi bench press? | U |
| 43 | Technique | Thay bài khi không có tạ đòn? | U (substitution) |
| 44 | Technique | Hít thở khi đẩy tạ? | U |
| 45 | Technique | Tập tại nhà không dụng cụ? | U |
| 46 | Terminology | RPE là gì? | U (synthetic) |
| 47 | Terminology | RIR là gì? | U |
| 48 | Terminology | 1RM ước lượng thế nào? | P |
| 49 | Terminology | Superset/dropset là gì? | P |
| 50 | Terminology | Tempo 3-1-1-0 nghĩa là gì? | U |
| 51 | Safety | Đau thắt lưng có nên squat? | P (health_guidance) |
| 52 | Safety | Tập khi chấn thương gối? | P |
| 53 | Safety | Khi nào nên đi khám? | P |
| 54 | Safety | Người tăng huyết áp tập tạ? | N |
| 55 | Special pop. | Phụ nữ mang thai tập gì? | N |
| 56 | Special pop. | Người trên 50 tuổi tăng cơ? | N |
| 57 | Special pop. | Dân văn phòng ngồi nhiều? | P (synthetic) |
| 58 | Physical activity | Khuyến nghị vận động tối thiểu/tuần? | S (WHO, HHS) |
| 59 | Physical activity | Bao nhiêu bước/ngày? | P (steps synthetic) |
| 60 | Programming | Unilateral vs bilateral? | S (2022) |

Tổng quan: S ≈ 18, P ≈ 25, N ≈ 8, U ≈ 9. **Số liệu này là kỳ vọng thiết kế, chưa chạy retrieval.**

## 26. Bộ câu hỏi huấn luyện viên cá nhân hoá

Cột đầu vào: **ED** Enterprise Data · **CA** Coach Analytics · **RAG** · **LLM**. ✓ = đã có; ◐ = có một phần; ✗ = chưa có.

| # | Câu hỏi | ED | CA | RAG | Ghi chú |
|---|---|---|---|---|---|
| 1 | 2 tuần nay cân không xuống nhưng tôi vẫn tập đủ, nên chỉnh gì? | ◐ InBody thưa | ◐ weight trend (cycle), adherence ✓ | ✓ energy balance | cần intake thực tế ✗ |
| 2 | Volume chân tuần này của tôi có quá cao không? | ✓ | ◐ sets/muscle (cycle-only) | ◐ | không có ngưỡng volume có nguồn |
| 3 | InBody lần này body fat tăng nhưng cân giảm, hiểu thế nào? | ✓ | ✓ quality + trend | ✓ Tinsley/Brewer | ready tốt nhất |
| 4 | Protein hiện tại có đủ cho mục tiêu giảm mỡ? | ◐ | ✗ protein adherence | ✓ | `consumedProtein` có nhưng chưa tổng hợp |
| 5 | Tháng này tôi tập đều chưa? | ✓ | ✓ adherence | — | cần cửa sổ rolling |
| 6 | Bench của tôi có đang tiến bộ? | ✓ | ✓ e1RM | ◐ | cycle-only |
| 7 | Tôi có đang bị plateau? | ✓ | ◐ | ◐ | |
| 8 | Có nên deload tuần này? | ◐ | ✓ trong cycle | ◐ | |
| 9 | Với mục tiêu hiện tại tôi còn bao lâu nữa? | ◐ | ◐ forecast | ◐ | non-binding |
| 10 | Mức calories hiện tại có hợp lý? | ✓ | ✓ nutrition decision | ✓ | |
| 11 | Tôi ăn đủ calo mục tiêu chưa? | ◐ | ◐ | — | chỉ khi log |
| 12 | Tại sao tôi mệt dạo này? | ◐ | ◐ readiness | ◐ | sleep ✗ |
| 13 | Tôi ngủ đủ không? | ✗ | ✗ | ◐ | không có dữ liệu |
| 14 | Nhóm cơ nào đang yếu? | ✓ | ✓ lagging | — | |
| 15 | Tôi có bỏ buổi nhiều vì lý do gì? | ✓ | ◐ skipReason | — | |
| 16 | Đau vai có nên bỏ bài overhead? | ◐ injuries | ◐ pain | ◐ | |
| 17 | Chuẩn bị bulk nên bắt đầu thế nào? | ✓ | ◐ | ✓ | |
| 18 | Chênh lệch tay trái/phải của tôi? | ✓ segmental | ✗ logic | ◐ | |
| 19 | So với 3 tháng trước tôi thay đổi gì? | ✓ | ◐ | — | |
| 20 | Phase hiện tại của roadmap là gì, sắp chuyển phase? | ✓ | ◐ | — | chat không đọc roadmap |
| 21 | Nên đổi bài vì tôi không có tạ đòn? | ✓ | — | ✓ | substitution engine có |
| 22 | Tuần này tôi ăn nhiều hơn hay ít hơn tuần trước? | ◐ | ✗ | — | |
| 23 | Cardio của tôi đủ chưa? | ✗ steps/cardio log | ✗ | ✓ WHO/HHS | |
| 24 | Có nên diet break? | ◐ | ✓ rule có | ✓ | |

## 27. Gap matrix

| Capability | Dữ liệu cần | Có data? | Analytics cần | Có analytics? | KB | Qwen nhận structured context? | Status |
|---|---|---|---|---|---|---|---|
| Workout progress analysis | sets/loads | CÓ | e1RM, volume | CÓ (cycle) | partial | KHÔNG | **BLOCKED_BY_ANALYTICS** (exposure) |
| Plateau analysis | 3–4 tuần log | CÓ | plateau rule | trong cycle | partial | KHÔNG | PARTIAL |
| Goal adherence | schedule | CÓ | adherence | CÓ | — | KHÔNG | **PARTIAL** (cần window + exposure) |
| Body composition trend | InBody ≥2 | CÓ (thưa) | trend+quality | CÓ | strong | KHÔNG (raw) | PARTIAL |
| Fat-loss progress | weight, BF | CÓ | trend/rate | CÓ | strong | KHÔNG | PARTIAL |
| Muscle-gain progress | SMM, load | CÓ | trend | CÓ | partial | KHÔNG | PARTIAL |
| Nutrition adherence | intake | MỘT PHẦN | cal ✓, macro ✗ | một phần | strong | KHÔNG | **BLOCKED_BY_DATA** (đầy đủ) |
| Calorie adjustment reasoning | trend+intake | MỘT PHẦN | engine ✓ | CÓ | strong | KHÔNG | PARTIAL |
| Workout plan adaptation | cycle metrics | CÓ | decision engine | CÓ | partial | cycle-only | PARTIAL |
| Nutrition plan adaptation | cycle metrics | CÓ | nutrition engine | CÓ | strong | cycle-only | PARTIAL |
| Exercise substitution reasoning | catalog, equipment | CÓ | substitution engine | CÓ | partial | CÓ | **READY** |
| Knowledge QA | — | — | — | — | partial | CÓ | **READY** (với giới hạn §21–24) |
| Personalized knowledge QA | all | PARTIAL | Coach State | KHÔNG | partial | KHÔNG | **BLOCKED_BY_ANALYTICS** |
| Longitudinal roadmap | roadmap, cycles | CÓ | trajectory | forecast | partial | KHÔNG | PARTIAL |
| Recovery-aware coaching | sleep/HRV | KHÔNG | — | — | weak | — | **BLOCKED_BY_MULTIPLE** |

## 28. Trình tự Phase 4 đề xuất (dựa bằng chứng)

Khác với thứ tự mẫu, phần "deterministic analytics" **đã tồn tại**, nên không phải 4.2 xây mới:

1. **4.1 Window hoá + expose analytics sẵn có** (không viết engine mới): endpoint nội bộ fitness-service tính cùng metrics trên cửa sổ N ngày không cần `TrainingCycle`; ai-service thêm reader `AuthoritativeRead`.
2. **4.2 CoachStateV0 typed** + `DataQuality` — ghép các tín hiệu ở (1).
3. **4.3 Chuẩn hoá nutrition actual**: hợp nhất meal-completion + diary vào một định nghĩa "intake/ngày", thêm protein adherence. *(đây là phần cần data/logic thật)*
4. **4.4 Goal gap/trajectory** (profile target + InBody + forecast).
5. **4.5 Personalized Coach integration** — Coach State vào prompt, RAG chỉ cho phần giải thích.
6. **4.6 KB cleanup**: gắn nhãn `synthetic_knowledge` vào metadata, ưu tiên evidence, bổ sung nguồn cho programming/recovery/safety, thêm publisher/year.
7. **4.7 Retrieval tuning**: filter theo domain/topic, rerank, chuẩn hoá điểm, đo token thực.
8. **4.8 Capture dữ liệu mới** (sleep/steps) — chỉ khi có quyết định sản phẩm.

Phụ thuộc: 4.2 ← 4.1; 4.5 ← 4.2; 4.4 ← 4.2; 4.7 độc lập, làm song song được.

## 29. First vertical slice

**Chọn A: Training adherence + progression (`CoachStateV0.training` + `goal.type`), cửa sổ 28 ngày.**

Lý do theo audit:
- Dữ liệu đã có và có timestamp (`WorkoutSchedule`, `WorkoutSet`).
- Engine đã có (`computeAdherence`, `computeWorkoutMetrics`, `computeE1rmTrend`) và đã phân biệt `hasScheduledSessions`.
- Không cần dữ liệu mới, không cần ML, không cần thay đổi schema.
- Giá trị nhìn thấy được: trả lời "tôi tập đều chưa / bench có tiến bộ không" bằng số thật thay vì 20 buổi thô.
- B (weight trend) thưa vì chỉ có InBody; C (nutrition) bị chặn bởi dữ liệu; D (goal trajectory) phụ thuộc B.

Ràng buộc theo CLAUDE.md: fitness-service sở hữu dữ liệu; ai-service chỉ đọc; không tạo nguồn sự thật thứ hai; người dùng/clientId lấy từ identity xác thực, không từ body; không cache theo user nhầm.

## 30. Rule vs ML

| Phân tích | Loại |
|---|---|
| adherence, completion, skip count, sets/muscle, volume, deload trigger | DETERMINISTIC_RULE |
| weight/body-fat/SMM trend, e1RM trend, plateau, trajectory | STATISTICAL_CALCULATION |
| calorie adjustment | RULE (đã có engine) |
| dropout/churn, personalised response | LATER_ML_CANDIDATE — cần dữ liệu và nhãn mà hiện chưa đủ |

Không có tín hiệu Phase 4 nào cần XGBoost/ML để ra bản đầu.

## 31. Không nên đưa vào trọng số Qwen

| Dữ liệu | Nằm ở | Lý do |
|---|---|---|
| Hồ sơ, goal, injury | Enterprise Data | thay đổi, riêng tư, phải authoritative |
| Workout log, InBody, nutrition history | Enterprise Data → Coach Analytics | time-series, cần cập nhật tức thời |
| Adherence/trend/decision | Coach Analytics (deterministic) | cần kiểm chứng được và audit |
| Kiến thức khoa học | RAG (có provenance) | cần trích nguồn, cập nhật |
| Quy tắc nghiệp vụ, ngưỡng, safety | code/config | không để mô hình "nhớ" |
| Ngôn ngữ, diễn đạt, hiểu ý định, hỏi lại | **LLM weights** | phần duy nhất nên học |

## 32. Top gaps (ưu tiên)

1. Chat không đọc bất kỳ analytics nào của fitness-service (cycle metrics/assessment/roadmap/forecast).
2. Analytics gắn với `TrainingCycle`, không có cửa sổ cuốn chiếu.
3. Nutrition adherence bỏ qua `NutritionLog`, chỉ calories, không protein.
4. Không có weigh-in độc lập; `BodyMetrics` là bảng mồ côi (chỉ export đọc).
5. Không có dữ liệu sleep/steps/HR/HRV; `RecoveryContext` luôn null.
6. KB khối lượng lớn là synthetic không provenance; evidence thật chỉ 83 chunk.
7. Không rerank/hybrid/filter domain; điểm giữa collection không chuẩn hoá.
8. Citation chỉ cho evidence; không có chính sách xung đột nguồn.
9. `UserProfile.targetWeight` và `injuries` không có lịch sử; roadmap/targets là `Json` tự do.
10. Log workout sửa/xoá không có audit; không có cờ substitution tường minh; `unique(userId,date)` trên schedule.

## 33. Verdict

**`PHASE4_FOUNDATION_PARTIAL`**

Nền dữ liệu workout/InBody/nutrition target và các engine deterministic đã có; thiếu lớp mở (window + Coach State + reader), thiếu intake thực tế đầy đủ, và KB cần phân tách rõ synthetic với evidence trước khi dùng cho personalized coaching.

## Phụ lục — những điều chưa kiểm chứng

- Nội dung và số điểm thật trong Qdrant/OpenSearch đang chạy (chỉ đọc file nguồn và code).
- Số token thực tế của prompt RAG với Qwen3 4B.
- Metric/khoảng cách của collection (cấu hình lúc tạo).
- Ý nghĩa chính xác của `InBodyEntry.muscleMass` (SMM hay lean mass) — suy từ tên là không được phép; cần đọc nơi nhập.
- Frontend có UI ghi cân nặng độc lập hay không (không audit ở đây; chỉ xác nhận backend không có model weigh-in).

## Addendum — Phase 4.1 (2026-10-10)

Hai điều đã nêu ở §3/§32 nay đã thay đổi một phần (chi tiết: `phase4-1-training-coach-state.md`):
- Analytics huấn luyện có cửa sổ cuốn chiếu không cần `TrainingCycle`: `GET /stats/training-window` (fitness-service), tái dùng engine sẵn có.
- ai-service có đường đọc typed `trainingReader.getTrainingAnalytics` + need `TRAINING_COACH_STATE` + `getCoachStateV0` (chỉ `goal` + `training`). **Chưa** được nối vào prompt chat; các mục nutrition/body/recovery của audit không đổi.

## Addendum — Phase 4.3 (2026-10-10)

Cập nhật một sự thật đã nêu ở §12/§32: fitness-service nay có chuẩn hoá actual intake (`GET /nutrition/analytics/window`) hợp nhất `NutritionMealCompletion` + `NutritionLog` với luật ưu tiên/dedupe xác định, calories **và** protein/carbs/fat (macro thiếu giữ nguyên là thiếu), cùng `CoachStateV0.nutrition` (chỉ mô tả; chưa nối vào hội thoại). `computeNutritionConsistencyScore` và `daily-history` chưa đổi. Chi tiết: `phase4-3-nutrition-coach-state.md`.

## Addendum — Phase 4.4 (2026-10-11)

Cập nhật các điểm chưa kết luận ở §10/§32: nghĩa của `InBodyEntry.muscleMass` được truy vết và vẫn **UNRESOLVED** (OCR = skeletal_muscle_mass; nhập tay = nhãn chung "Cơ bắp"; cùng một cột). fitness-service có đường đọc body/goal (`GET /stats/body-goal-state`) tái dùng engine cycle với lookback 90 ngày, provenance tách `currentWeight` khỏi InBody, và `CoachStateV0.body` / `goal` mở rộng (chỉ mô tả; on-track `NOT_EVALUABLE`). Chi tiết: `phase4-4-body-goal-trajectory.md`.

## Addendum — Phase 4.5 (2026-10-11)

Dòng chảy hội thoại nay có review tiến triển cá nhân (`READ_STATE/PROGRESS_REVIEW`) ghép các slice CoachState (body+goal, training, nutrition) với cơ chế per-slice `ok/absent/error` (`readCoachStateSlices`) — chỉ mô tả, không nhân quả, không kê đơn; `onTrack` vẫn `NOT_EVALUABLE`. Không có thay đổi nào ở fitness-service/user-service. Chi tiết: `phase4-5-progress-review-integration.md`.

## Addendum — Phase 4.6 (2026-10-11, live Qdrant)

Cập nhật các sự thật §15/§21/§33: `fitness_evidence` live = **184** điểm (không phải 83): 43 curated JSONL + 137 pipeline PubMed/web + 4 phương pháp coach; **40/83 chunk curated của repo chưa có trong Qdrant**; 25 nhóm nội dung trùng; `fitness_knowledge` 7.072 / `fitness_faq` 5.946 / `exercises` 207, cả bốn là 768-d Cosine (`nomic-embed-text`) nhưng điểm xuyên collection **không so sánh được** (trung vị liên quan 0,797 synthetic vs 0,715 evidence). Baseline: synthetic ở top-1 ~87%, evidence curated@3 ~20%, ngoài phạm vi vẫn trả doc 100%. Retrieval V2 (flag `RAG_RETRIEVAL_V2`, mặc định OFF) và số liệu: `phase4-6-rag-grounding-hardening.md`.

## Addendum — Phase 4.7 (2026-10-11)

Bộ held-out độc lập (56 câu, ngưỡng khai báo trước, V2 đóng băng) cho **`RAG_V2_GENERALIZATION_FAIL`**: topicHit@3 0,58 (cần ≥0,60), falseSource 0,33 (cần ≤0,20), HYPERTROPHY 0/5, SAFETY 0,25; V2 vẫn hơn baseline (relevantCuratedEvidence@3 0,56 vs 0,06). Tích hợp diễn giải cá nhân hoá (`PERSONAL_INTERPRETATION`) đã có nhưng chỉ kích hoạt khi cả ba flag on; `RAG_RETRIEVAL_V2` không được bật cho đến khi gate qua. Chi tiết: `phase4-7-evidence-grounded-coach.md`.

## Addendum — Phase 4.7R (2026-10-11)

Held-out V1 (56 câu) đã bị quan sát ⇒ nay là **Diagnostic V1**, không còn dùng cho verdict. Sau remediation (V2.1: chuẩn hoá theo khái niệm, topic guard, cổng ngoài phạm vi, conflict theo phạm vi, provenance) **held-out V2 mới (72 câu, chạy một lần)**: topicHit@3 0,787 · relevantCuratedEvidence@3 0,824 (+0,736 so với baseline) · syntheticTop1 0 · duplicate 0 · empty 0,106 · HYPERTROPHY 0,833 · safe-abstention 0,889 — **nhưng falseSource 0,313 > 0,20 ⇒ `RAG_V2_GENERALIZATION_FAIL`**. Blocker retrieval của Phase 4.7 **chưa đóng**; `RAG_RETRIEVAL_V2` vẫn OFF. Chi tiết, đính chính ("40 chunk chưa ingest" thực ra là 3), và họ lỗi còn lại: `phase4-7r-rag-generalization-remediation.md`.

## Addendum — Phase 4.7R2 (2026-10-11)

Sau V2.2 (phân giải khái niệm có chính sách dấu, thuật ngữ nhập nhằng cần ngữ cảnh, cổng OOD/veto đặt *trước* embedding, nhận diện họ an toàn + fail-closed) và held-out V2 → Diagnostic V2, **held-out V3 mới (87 câu, một lần)**: topicHit@3 0,804 · relevantCuratedEvidence@3 0,795 · syntheticTop1 0,026 · duplicate 0 · falseSource **0,083** · empty 0,137 · HYPERTROPHY 0,833 · safe-abstention 0,75 — **nhưng `unsafeGenericSafetyFallthrough` = 3 (cổng cứng = 0) và PROGRAMMING topicHit@3 = 0,50 (< 0,55) ⇒ `RAG_V2_GENERALIZATION_FAIL`**. Blocker retrieval của Phase 4.7 **chưa đóng**; `RAG_RETRIEVAL_V2` vẫn OFF; Qdrant không đổi. Chi tiết: `phase4-7r2-ood-safety-generalization.md`.

## Addendum — Phase 4.7R3 (2026-10-11)

Thêm lớp **SafetySignalResolution** (triệu chứng/sự kiện/trạng thái: hậu phẫu, sau sinh, đau lan, tê, tiếng bục/rắc, chấn thương cấp, tức ngực, ngất…) chạy *trước* phân giải khái niệm, bất biến cấu trúc "chỉ bằng chứng curated có tiêu đề đúng tình trạng", an toàn thắng diễn giải cá nhân hoá; alias Programming mức khái niệm. Diagnostic V3 → V2.3: unsafe 3 → 0, PROGRAMMING 0,50 → 0,90 (dữ liệu dev). **Held-out V4 mới (95 câu, một lần): topicHit@3 0,784 · relevantCuratedEvidence@3 0,833 · falseSource 0,038 · empty 0,118 · PROGRAMMING 0,667 · HYPERTROPHY 0,667 · safe-abstention 0,889 — nhưng `unsafeGenericSafetyFallthrough` = 2 (cổng cứng = 0) ⇒ `RAG_V2_GENERALIZATION_FAIL`**; recall tín hiệu an toàn 0,667 (HIGH-RISK 0,417). Blocker retrieval của Phase 4.7 **chưa đóng**; `RAG_RETRIEVAL_V2` vẫn OFF; Qdrant không đổi. Chi tiết: `phase4-7r3-symptom-safety-programming-closure.md`.

## Addendum — Phase 4.7R4 (2026-10-11)

Thêm **SafetyNarrativeResolution** (câu kể cá nhân: thủ thuật gần đây không nêu "phẫu thuật", sau sinh gián tiếp qua tuổi em bé, tim đập bất thường kể bằng từ lóng, tiền ngất/thị giác, tê/yếu, đau lan, chấn thương cấp, mất chức năng, mặc định thận trọng cho triệu chứng cá nhân không đọc được là lành tính); an toàn thắng diễn giải cá nhân hoá; ranh giới từ phải cho mọi mẫu narrative. Dev V5 (182 câu, dữ liệu tuning): unsafe 0/77, personal fallthrough 0/73, recall 1,0, FP 0. **Held-out V5 mới (127 câu, một lần): topicHit@3 0,729 · relevantCuratedEvidence@3 0,837 · falseSource 0,032 · empty 0,200 · HYPERTROPHY 0,857 · safe-abstention 0,846 — nhưng `unsafeGenericSafetyFallthrough` = 3, `PERSONAL_HIGH_RISK_GENERIC_FALLTHROUGH` = 3 (cổng cứng = 0) và PROGRAMMING 0,308 (< 0,55) ⇒ `RAG_V2_GENERALIZATION_FAIL`**; recall tín hiệu an toàn 0,808 (HIGH-risk 0,632). Blocker retrieval của Phase 4.7 **chưa đóng**; `RAG_RETRIEVAL_V2` vẫn OFF; Qdrant không đổi. Chi tiết: `phase4-7r4-personal-safety-closure.md`.

## Addendum — Phase 4.7R5 (2026-10-11)

Không có thay đổi nào với dữ liệu tri thức: Qdrant `fitness_evidence` 187 / `fitness_knowledge` 7072 / `fitness_faq` 5946 / `exercises` 207, id-set và content-set hash trùng manifest trước R5. Tập dữ liệu mới `data/eval/query-classifiers/` chỉ là dữ liệu đánh giá/huấn luyện router tổng hợp, không phải tri thức được truy xuất.

## Addendum — Phase 4.7R6 (2026-10-11)

Không thay đổi dữ liệu tri thức (Qdrant 187 / 7072 / 5946 / 207). `data/eval/query-routing-independent/` chỉ chứa giao thức/mẫu, chưa có dòng có nhãn. Quy tắc nguồn/khử định danh/consent: `query-routing-data-governance.md`.
