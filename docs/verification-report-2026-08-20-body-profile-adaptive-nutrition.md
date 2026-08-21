# Báo cáo xác minh — "Real-time Body Profile + Evidence-Based Adaptive Nutrition — Phase 1"

**Ngày xác minh**: 2026-08-20
**Phạm vi**: Xác minh lại bằng test thật kế hoạch đã duyệt tại `C:\Users\ASUS\.claude\plans\partitioned-stirring-ritchie.md` (tách BASELINE ≠ CURRENT ≠ GOAL ≠ MEASUREMENT ≠ PRESCRIPTION cho cân nặng/dinh dưỡng).
**Loại lượt làm việc này**: **Chỉ xác minh, không sửa code.** Toàn bộ phần thân của plan đã được implement từ trước (dấu vết file cho thấy phần lớn được tạo ngày 2026-08-18, tức là trước cả các Gate 7-10 trong `docs/session-progress-2026-08-20.md`). Hai lần "fail" xuất hiện trong lúc chạy test ban đầu là do tôi tự trỏ sai `DATABASE_URL` (dùng `localhost:5433` — chỉ đúng khi chạy từ host — trong khi lệnh chạy bên trong container Docker, cần `postgres:5432`), **không phải bug thật**. Sau khi sửa biến môi trường đúng quy ước, chạy lại thì pass toàn bộ. Không có dòng code nào bị thay đổi trong lượt này.

---

## 1. Mô hình dữ liệu — đã có thật, đã kiểm chứng

```
UserProfile (user-service)
  + startingWeight        Float?   — set MỘT LẦN, không đổi sau đó
  + startingWeightSource  String?  — "ONBOARDING" | "INBODY" | "LEGACY_BACKFILL"
  currentWeight, targetWeight — giữ nguyên hành vi cũ

InBodyEntry (user-service) — không đổi, vẫn là lịch sử đo append-only

TrainingCycle (fitness-service)
  baselineMetrics Json?  — nay được ĐIỀN THẬT lúc startCycle (weight/bodyFat/muscleMass/bmr/measuredAt/inbodyId/source)
  targetMetrics   Json?  — nay được ĐIỀN THẬT lúc startCycle (targetWeight/source)

NutritionGoal (fitness-service) — có version, giống PersonalizedServicePlanVersion
  + status "ACTIVE" | "SUPERSEDED", validFrom, supersededAt, reason, triggeredBy
```

## 2. Bằng chứng test thật — lệnh chính xác + kết quả

### 2.1. user-service

```
docker exec gymcoach-user-dev sh -c "cd /app/backend/services/user-service && npx tsx --test src/__tests__/profile-starting-weight.util.test.ts src/__tests__/profile.models.onboarding.test.ts"
→ tests 14, pass 14, fail 0

docker exec gymcoach-user-dev sh -c "cd /app/backend/services/user-service && npx tsx --test src/__tests__/inbody.validation.test.ts"
→ tests 10, pass 10, fail 0
```

**DB thật (`gymcoach_user`, không phải test DB)**:
```sql
SELECT count(*) FILTER (WHERE "startingWeight" IS NOT NULL) AS with_starting_weight,
       count(*) FILTER (WHERE "startingWeightSource" = 'LEGACY_BACKFILL') AS legacy_backfilled,
       count(*) AS total
FROM user_profiles;
```
→ `with_starting_weight = 107`, `legacy_backfilled = 107`, `total = 136`.
**29 hồ sơ còn lại vẫn NULL** — đây là đúng thiết kế: những user này không có `currentWeight` lẫn `InBodyEntry` nào để migration suy ra, nên đúng luật "không bịa dữ liệu" là để trống chứ không đoán số.

### 2.2. fitness-service — logic thuần (không cần DB)

```
docker exec gymcoach-fitness-dev sh -c "cd /app/backend/services/fitness-service && npx tsx --test src/__tests__/weight-trend.util.test.ts src/__tests__/nutrition-goal-macro-validator.test.ts src/__tests__/nutrition-decision.engine.test.ts"
→ tests 32, pass 32, fail 0

docker exec gymcoach-fitness-dev sh -c "cd /app/backend/services/fitness-service && npx tsx --test src/__tests__/cycle-decision.engine.test.ts src/__tests__/cycle-decision-feedback.engine.test.ts src/__tests__/cycle-metrics.engine.test.ts src/__tests__/training-cycle-metrics.service.test.ts"
→ tests 75, pass 75, fail 0
```

### 2.3. fitness-service — integration (DB test thật `gymcoach_fitness_test`)

```
docker exec gymcoach-fitness-dev sh -c "cd /app/backend/services/fitness-service && \
  FITNESS_DATABASE_URL='postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test' \
  USER_DATABASE_URL='postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_user' \
  npx tsx --test --test-concurrency=1 \
    src/__tests__/training-cycle-baseline-snapshot.integration.test.ts \
    src/__tests__/nutrition-goal-versioning.integration.test.ts \
    src/__tests__/nutrition-adaptive-apply.integration.test.ts"
→ tổng 13 test, pass 13, fail 0
  (lần chạy đầu tiên dùng USER_DATABASE_URL mặc định "localhost:5433" bị ECONNREFUSED
   vì đang chạy TRONG container — đã sửa thành host "postgres" theo đúng
   docker-compose.dev.yml và chạy lại pass toàn bộ, không phải lỗi code)

docker exec gymcoach-fitness-dev sh -c "cd /app/backend/services/fitness-service && \
  FITNESS_DATABASE_URL='postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test' \
  USER_DATABASE_URL='postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_user' \
  npx tsx --test --test-concurrency=1 \
    src/__tests__/training-cycle-unification.integration.test.ts \
    src/__tests__/adaptive-cycle-evaluation.integration.test.ts \
    src/__tests__/training-cycle-data-sufficiency.integration.test.ts \
    src/__tests__/training-cycle-lifecycle-fixes.integration.test.ts"
→ tests 18, pass 18, fail 0
```

**DB thật (`gymcoach_fitness`, không phải test DB)**:
```sql
SELECT status, count(*) FROM nutrition_goals GROUP BY status;
→ ACTIVE: 1   (đúng — chưa user thật nào đổi goal lần 2)

SELECT count(*) FILTER (WHERE baseline_metrics IS NOT NULL) AS with_baseline, count(*) AS total
FROM training_cycles;
→ with_baseline = 0, total = 26
```
**0/26 cycle cũ có `baselineMetrics`** — đúng thiết kế: cột này chỉ điền cho cycle **tạo mới** từ giờ trở đi (`startCycle`), migration không hồi tố cycle cũ vì không đủ dữ liệu InBody-tại-thời-điểm-đó để tái tạo trung thực — đúng luật "không bịa dữ liệu lịch sử không rõ nguồn gốc".

### 2.4. ai-service

```
docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsx --test src/__tests__/coach_context.test.ts"
→ tests 3, pass 3, fail 0
```
`compactProfile()` đã bỏ khối cân nặng trùng lặp; `CoachContext.journey` (starting_weight_kg / lost_since_start_kg / remaining_to_goal_kg) đã có thật trong `coach_context_builder.ts`.

### 2.5. E2E thật (Playwright, trình duyệt thật, không mock)

```
cd fitnessassistant-playwright-e2e
npx playwright test tests/19-body-state-adaptive-planning.spec.ts tests/20-adaptive-nutrition-decision.spec.ts --reporter=list
→ 2 passed (28.4s)
```
- **19**: TC-BODY-001..003 — set baseline lúc onboarding, InBody sau đó cập nhật `current` không cần reload trang, lịch sử đo có đủ cả 2 lần đo.
- **20**: đề xuất điều chỉnh dinh dưỡng thật hiện trên `TrainingCyclePage`, bấm "chấp nhận" qua DOM thật → tạo `NutritionGoal` version `ACTIVE` mới thật, version cũ chuyển `SUPERSEDED`.

## 3. Phát hiện thêm: phần plan xếp là "Phase 2 — hoãn lại" thực ra cũng đã được làm

Kế hoạch gốc chủ động hoãn 2 việc sang Phase 2:
1. **Decision engine 5 trạng thái** (`KEEP_PLAN/PROPOSE_ADJUSTMENT/REQUEST_MORE_DATA/EARLY_REVIEW/ESCALATE`) nối vào vòng đánh giá cycle.
2. **Ingest 7 evidence thật vào Qdrant** (`fitness_evidence` collection).

Kiểm tra thực tế cho thấy **cả hai đã được làm**, vượt cam kết ban đầu của Phase 1:
- `nutrition-decision.engine.ts` có đủ 5 trạng thái, đã nối thật vào `completeCycle()`/`evaluateCycle()` (xác nhận qua `nutrition-adaptive-apply.integration.test.ts` ở mục 2.3 và E2E spec 20 ở mục 2.5).
- Collection `fitness_evidence` trên Qdrant (đang chạy thật, `gymcoach-qdrant`) có **152 điểm dữ liệu**. Đã scroll toàn bộ payload và xác nhận có mặt cả 7 nguồn plan yêu cầu (Hall 2011 dynamic energy balance, Brewer 2021 InBody validation, Tinsley 2022 bodycomp standardization, Shcherbina 2017 wearable accuracy, Garthe 2011 weight-loss rate athletes, Nunes adaptive thermogenesis, Mifflin 1990 original equation) **cộng thêm nhiều nguồn khác** (Helms 2023, Morton 2018 protein meta-analysis, ISSN creatine/caffeine/nutrient-timing, IOC RED-S consensus, IOC dietary supplements, IOM AMDR, Slater 2019, Dietary Guidelines Americans, ACSM nutrition, RMR equation accuracy review, NATA fluid replacement).
- File `evidence-registry.ts` tĩnh (như plan Phase 1 đề xuất làm tạm) **không tồn tại** — nhưng bị thay bằng giải pháp tốt hơn: file `.jsonl` thật theo đúng format pipeline hiện có (`data/processed/evidence/*.jsonl` + `_index.json`) và đã ingest thật vào Qdrant, nên không tính là thiếu.

## 4. Việc thật sự chưa làm (nói thẳng, không giấu)

- **Wearable / active-calories**: xác nhận lại — **chưa có** bất kỳ implementation nào (`rg` không tìm thấy gì ngoài 1 dòng trong file test mô tả đây là ngoài phạm vi). Đúng như plan đã ghi rõ đây là việc hoàn toàn mới (greenfield), không phải fix, chưa động vào.
- **29/136 `user_profiles`** chưa có `startingWeight` — đúng thiết kế (không có dữ liệu nguồn để suy ra), không phải lỗi cần sửa.
- **26/26 `training_cycles`** cũ chưa có `baselineMetrics` — đúng thiết kế (chỉ áp dụng từ cycle mới trở đi).
- Redesign toàn bộ Profile/Progress UI (biểu đồ xu hướng thân hình đầy đủ hơn) — plan chỉ thêm khối "Cân nặng bắt đầu/Hiện tại/Mục tiêu/Còn lại", không phải redesign toàn trang — đúng phạm vi đã cam kết, chưa mở rộng thêm.
- Không có commit nào được tạo trong lượt xác minh này — toàn bộ thay đổi trong working tree vẫn giữ nguyên như trước, chưa commit/push.

## 5. Kết luận

Phase 1 của plan **đã hoàn thành và có bằng chứng test thật** (14+10+32+75+13+18+3 test backend/integration = **165/165 PASS**, cộng **2/2 E2E PASS** bằng trình duyệt thật), và một phần đáng kể của Phase 2 (decision engine + Qdrant ingestion) **cũng đã hoàn thành**, dù ban đầu bị xếp là "hoãn lại". Không phát hiện bug thật nào cần sửa trong lượt xác minh này — chỉ có 2 lỗi cấu hình môi trường test do chính tôi gây ra khi chạy lệnh (đã tự phát hiện và tự sửa, có ghi lại ở mục 2.3 để minh bạch). Phần còn thiếu thật sự (wearable/active-calories, 29 hồ sơ thiếu dữ liệu gốc, 26 cycle cũ thiếu baseline) đều **đúng như thiết kế đã cam kết trong plan**, không phải lỗi.
