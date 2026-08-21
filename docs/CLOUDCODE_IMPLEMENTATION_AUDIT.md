# CLOUDCODE_IMPLEMENTATION_AUDIT.md

> Point-in-time implementation audit. Preserve it as engineering evidence, but
> verify current behavior against code and tests.

> Vai trò: Senior Full-stack Engineer + AI Fitness Product Architect.
> Tài liệu này **kế thừa trực tiếp** 4 tài liệu đã có (không lặp lại nội dung, chỉ dẫn chiếu + bổ sung phát hiện mới):
> `FITNESS_APP_DATA_AND_FEATURE_AUDIT.md`, `TRAINING_CYCLE_DECISION_ENGINE.md`, `TRAINING_KNOWLEDGE_BASE_PLAN.md`, `USER_LEVEL_PERSONALIZATION_PLAN.md`, cộng thêm đọc mới: `workout-log-audit.md`, `production-hardening-checkpoint.md`, `training-cycle-usecases-and-testcases.md`.
>
> Sau báo cáo này là **triển khai thực tế theo 6 phase** (không chỉ lập kế hoạch) — xem nhật ký triển khai ở cuối file, cập nhật sau mỗi phase.

---

## 1. Current State (đối chiếu lại, có phát hiện mới quan trọng)

**Cập nhật quan trọng so với báo cáo trước**: `PROJECT_ROADMAP.md` (2026-05-10) liệt kê 2 bug ở AI recommendation engine — đã kiểm tra lại trực tiếp trong code và xác nhận **CẢ HAI ĐÃ ĐƯỢC SỬA** ở một phiên nào đó sau ngày viết roadmap đó:
- §2.1 "thiếu routine cho legs/shoulders/core" → **đã có** `buildLegsRoutine()`, `buildShouldersRoutine()`, `buildCoreRoutine()`, đã wire vào `buildSpecificRoutineByIntent()`.
- §2.2 "không filter theo equipment" → **đã có** `filterExercisesByEquipment()`, dùng ở cả routine theo intent lẫn plan tổng.

→ **Bài học**: `PROJECT_ROADMAP.md` đã lỗi thời, không nên dùng làm nguồn "gap hiện tại" nữa mà không xác minh lại từng dòng. Đã xác minh qua `grep` trực tiếp trong code thật, không suy đoán.

**Xác nhận qua `docs/workout-log-audit.md` (Known Gaps, tự ghi nhận trung thực bởi phiên trước)** — đây là nguồn đáng tin cậy nhất cho mục 6 của yêu cầu:
- `SKIPPED` **tồn tại trong schema, KHÔNG có code path nào ghi giá trị này**.
- **Không có** `PARTIALLY_COMPLETED` — 1/4 bài xong vẫn là `IN_PROGRESS`, giống hệt "vừa bắt đầu".
- **Không có** `CANCELLED`, không có coach/admin override + audit log (chưa có role coach/admin cho workout schedule).
- `painScore` (0-10), `setType`, `rangeOfMotion`, `side`, `tempo`, `techniqueNotes` **đã có** ở cấp độ set (`workout_sets`, migration `20260730000000_workout_set_advanced_logging`) — chỉ chưa có UI, và chưa có ở cấp độ session/ngày tổng hợp riêng cho mục đích coaching (session-level RPE/pain đã có qua `CycleSessionFeedback`, chỉ áp dụng khi có Training Cycle đang ACTIVE, không áp dụng cho workout log độc lập không gắn cycle).
- **Exercise substitution trong lúc log** (đổi bài giữa chừng buổi tập) — **không tìm thấy** tính năng này; `substitutions` hiện chỉ tồn tại ở luồng dinh dưỡng (meal substitution) và ở bước TẠO plan (equipment-based swap khi sinh plan), không phải khi đang log một buổi tập cụ thể.

**Trạng thái 4 nhóm user**: `experienceLevel` (BEGINNER/INTERMEDIATE/ADVANCED/UNKNOWN) đã tồn tại và đã được dùng để gate kỹ thuật nâng cao trong `cycle-analysis.service.ts` (từ phiên trước). Không có nhóm thứ 5 riêng cho "professional" — xem quyết định thiết kế ở `USER_LEVEL_PERSONALIZATION_PLAN.md` §0 (dùng cờ `competesInSport` thay vì enum mới).

---

## 2. Detected Gaps (tổng hợp, đã ưu tiên hoá)

| # | Gap | Mức độ | Nguồn xác nhận |
|---|---|---|---|
| G1 | `SKIPPED` không có code path ghi giá trị | Cao — cản trở toàn bộ khái niệm "missed session" nhất quán | `workout-log-audit.md` |
| G2 | Không có `PARTIALLY_COMPLETED` | Trung bình | như trên |
| G3 | Không có `CANCELLED` + audit log override | Trung bình (chưa có role coach/admin nên chưa cấp thiết) | như trên |
| G4 | `CycleMetricsResult` thiếu `nutritionConsistencyScore`, `missedSessionCount`, `volumeProgressionSlope` | Cao — Decision Engine ra quyết định thiếu 3 tín hiệu quan trọng | `TRAINING_CYCLE_DECISION_ENGINE.md` |
| G5 | Không có bảng `RecommendationAudit` | Trung bình | như trên |
| G6 | `computeGoalProgressScore()` trả `null` cho `ATHLETIC_PERFORMANCE` | Cao cho nhóm D | như trên |
| G7 | Không có `proposedChanges` semantic validator (Adaptive flow) | Cao — rủi ro AI hallucination | `FITNESS_APP_DATA_AND_FEATURE_AUDIT.md` §14 |
| G8 | Không có onboarding wizard (level/goal/equipment/injury/schedule) | Cao — nguyên nhân gốc của nhiều `UNKNOWN` | `USER_LEVEL_PERSONALIZATION_PLAN.md` |
| G9 | Legacy `/complete` và Adaptive `/evaluate` chưa hợp nhất | Trung bình (rủi ro trôi lệch logic dài hạn) | `TRAINING_CYCLE_DECISION_ENGINE.md` |
| G10 | Exercise model production nghèo hơn catalog CSV | Trung bình | `TRAINING_KNOWLEDGE_BASE_PLAN.md` |
| G11 | Không có `TrainingBlockPlan` (periodization nhiều pha) cho nhóm D | Trung bình (tính năng lớn, có thể hoãn) | `USER_LEVEL_PERSONALIZATION_PLAN.md` |
| G12 | Không có exercise substitution giữa chừng session | Thấp-trung bình | Mục 1 ở trên |
| G13 | Knowledge base coach principles (FST-7...) chưa được ingest có cấu trúc | Trung bình | `TRAINING_KNOWLEDGE_BASE_PLAN.md` |

---

## 3. Recommended Architecture

Không đổi kiến trúc tổng thể (microservices + RAG, không fine-tune) — chỉ **bồi đắp thêm** đúng các điểm ở Mục 2, theo nguyên tắc đã thiết lập xuyên suốt dự án: *code/rule engine tính toán, LLM chỉ giải thích, RAG chỉ dẫn chứng*. Chi tiết state machine + payload chuẩn cho AI explanation: xem `TRAINING_CYCLE_DECISION_ENGINE.md` §3 (đã có, giữ nguyên) — bổ sung ở tài liệu này: **payload chuẩn hoá đầy đủ** cho mỗi decision (yêu cầu mục 3 của prompt):

```ts
interface DecisionEngineOutput {
  decision: "INSUFFICIENT_DATA" | "KEEP" | "PROGRESS" | "ADJUST" | "DELOAD" | "REBUILD";
  confidence: number; // 0-1, từ dataQualityScore — KHÔNG phải LLM tự chấm
  reasonCodes: string[];
  metricsSnapshot: CycleMetricsResult; // toàn bộ số liệu đã tính, để AI/UI/audit dùng chung 1 nguồn
  dataQuality: { score: number; flags: string[] };
  safetyFlags: SafetyFlag[];
  recommendedActions: { scope: ActionScope; allowedChangeTypes: string[] };
  aiExplanationPayload: {
    // Đây là TOÀN BỘ những gì LLM được phép nhìn thấy để viết giải thích —
    // không có quyền truy cập gì khác, không tự tính lại bất kỳ số nào.
    decision: string; reasonCodes: string[]; keyMetrics: Record<string, number | null>;
    ragEvidence?: Array<{ title: string; sourceUrl: string; evidenceLevel: string }>;
  };
}
```

Đây **về cơ bản đã là những gì `DecisionEngineResult` (cycle-decision.engine.ts) đang trả về** — khác biệt duy nhất: chưa có field `metricsSnapshot` tường minh riêng cho audit (hiện `supportingMetrics` là bản rút gọn, không phải full `CycleMetricsResult`). Task: mở rộng `supportingMetrics` → đổi tên/bổ sung thành `metricsSnapshot` đầy đủ khi ghi vào `RecommendationAudit` (không nhất thiết đổi trong response API để tránh phá vỡ hợp đồng hiện có).

---

## 4. Data Model Changes (triển khai ở Phase 1-3)

1. `CycleMetricsResult`: + `nutritionConsistencyScore: number | null`, `missedSessionCount: number`, `volumeProgressionSlope: number | null`.
2. `UserProfile`: + `competesInSport: Boolean @default(false)`.
3. Bảng mới `RecommendationAudit` (fitness-service) — xem schema đầy đủ ở `TRAINING_CYCLE_DECISION_ENGINE.md` §4.
4. `WorkoutSchedule.status`: thêm giá trị hợp lệ mới `PARTIALLY_COMPLETED`, `CANCELLED` (string field, không phải Postgres enum — không cần migration schema cho giá trị mới, chỉ cần code path ghi + đọc đúng).
5. `Exercise`: cân nhắc thêm cột tối thiểu có giá trị cao nhất trước (không làm toàn bộ 30 cột catalog CSV cùng lúc): `movementPattern`, `mechanics` (compound/isolation), `contraindications: String[]` — hoãn regressions/progressions/rep-range chi tiết sang phase sau (rủi ro thấp khi hoãn, giá trị cao khi có nhưng không khẩn).

---

## 5. API Changes

- `POST /workouts/schedules/:id/skip` (mới) — ghi `status = SKIPPED` tường minh, chỉ cho phép trên ngày hôm nay trở về sau chưa khoá (không cho "skip" một ngày đã qua chưa từng động tới — ngày đã qua tự động coi là missed qua truy vấn, không cần hành động ghi).
- `POST /workouts/schedules/:id/cancel` (mới) — đặt `status = CANCELLED`, ghi kèm `notes` lý do bắt buộc.
- `GET /training-cycles/:id/audit` (mới) — trả danh sách `RecommendationAudit` cho một chu kỳ.
- Không đổi hợp đồng API hiện có (`/evaluate`, `/complete`, `/progress`) — chỉ mở rộng field trả về (additive, không breaking).

---

## 6. Frontend Changes

Xem chi tiết đầy đủ ở `FITNESS_APP_DATA_AND_FEATURE_AUDIT.md` §10. Bổ sung ở đây: nút "Bỏ qua buổi này" (skip) cho ngày hôm nay/tương lai gần trong `WorkoutLogPage`, hiện trạng thái `PARTIALLY_COMPLETED` bằng progress bar thay vì chỉ nhãn "Đang tập".

---

## 7. AI/RAG Changes

Xem `TRAINING_KNOWLEDGE_BASE_PLAN.md`. Bổ sung Phase 5: ingest tối thiểu 3-5 record `training_methods` (FST-7-inspired, Mountain Dog phase concept, PHAT-inspired split) đã qua review thủ công `copyright_safe: true`, dùng làm seed ban đầu, không ingest hàng loạt tự động.

---

## 8. Implementation Roadmap & Task List (theo priority)

### Phase 1 — Data foundation (P0)
1. [ ] Schema: `nutritionConsistencyScore`/`missedSessionCount`/`volumeProgressionSlope` vào `CycleMetricsResult`.
2. [ ] Schema: `competesInSport` vào `UserProfile`.
3. [ ] Schema: `contraindications`/`movementPattern`/`mechanics` vào `Exercise`.

### Phase 2 — Training cycle decision engine (P0)
4. [ ] Bảng `RecommendationAudit` + ghi record ở `/evaluate`.
5. [ ] Nhánh `computeGoalProgressScore()` cho `ATHLETIC_PERFORMANCE`.
6. [ ] Semantic validator cho `proposedChanges`.

### Phase 3 — Workout log completion (P1)
7. [ ] `POST /workouts/schedules/:id/skip` — ghi `SKIPPED` thật.
8. [ ] `PARTIALLY_COMPLETED` derive trong `recomputeScheduleProgress`.
9. [ ] `POST /workouts/schedules/:id/cancel` — ghi `CANCELLED` + lý do bắt buộc.

### Phase 4 — User level personalization (P1)
10. [ ] API `PATCH /profile` nhận thêm `competesInSport`.
11. [ ] Tài liệu hoá onboarding flow đề xuất (UI thực tế hoãn — quy mô lớn, cần thiết kế riêng).

### Phase 5 — RAG/knowledge base (P2)
12. [ ] Seed 3-5 `training_methods` record (JSON, review thủ công).
13. [ ] Thêm ISSN vào `source_registry.ts` allowlist (chỉ allowlist domain, không tự ingest ngay).

### Phase 6 — UI polish + test persona (P2)
14. [ ] Test fixture 4 persona × các tình huống mục 8 của prompt gốc.

---

## 9. Test Plan

Ma trận bắt buộc — 4 persona × 9 tình huống (đúng yêu cầu mục 8): thiếu dữ liệu, tập đều/tiến bộ, bỏ nhiều buổi, RPE/pain cao, InBody xấu đi, plateau nhiều chu kỳ, cần deload, cần rebuild, nutrition không ổn định. Triển khai ở Phase 6 dưới dạng fixture builder tái sử dụng (không hard-code ID thật).

---

## 10. Legal/Copyright Risks

Không đổi so với `TRAINING_KNOWLEDGE_BASE_PLAN.md` §6 — nhắc lại điểm quan trọng nhất: **bắt buộc review thủ công** trước khi bất kỳ `training_methods`/`coach_principles` record nào được đánh dấu `copyright_safe: true`; wording "lấy cảm hứng từ nguyên tắc công khai", không gắn tên coach vào tên tính năng.

## 11. AI Hallucination Risks

Không đổi so với `FITNESS_APP_DATA_AND_FEATURE_AUDIT.md` §14 — bổ sung: sau khi thêm `RecommendationAudit`, đảm bảo `inputSnapshot` lưu đúng số liệu **trước khi** LLM chạy, để có thể kiểm chứng LLM không tự chèn số liệu khác vào giải thích cuối cùng hiển thị cho user (đối chiếu `aiSummary` với `inputSnapshot` là một test có thể viết tự động: mọi con số xuất hiện trong `aiSummary` phải xuất hiện trong `metricsSnapshot`, nếu không → nghi ngờ hallucination).

---

## 12. Nhật ký triển khai (đã thực hiện trong phiên này, xác minh bằng test thật)

> Mọi mục dưới đây đã chạy `tsc --noEmit` + test thật (DB thật qua `FITNESS_DATABASE_URL`/`gymcoach_fitness_test`, không mock) trước khi ghi là "done".

### Phase 1 — Data foundation ✅
- `CycleMetricsResult` + 3 field mới: `nutritionConsistencyScore`, `missedSessionCount`, `volumeProgressionSlope` (hồi quy toàn bộ tuần, không chỉ đầu-cuối). 8 test unit + 4 test integration (DB thật) pass.
- `UserProfile.competesInSport` (user-service) — migration áp dụng cho DB dev, đã regenerate Prisma client, 3 test schema pass.
- `Exercise` + `movementPattern`/`mechanics`/`contraindications` — migration áp dụng cho DB dev + test, additive/nullable, không backfill đoán mò.

### Phase 2 — Training cycle decision engine ✅
- Bảng `RecommendationAudit` mới (migration áp dụng dev+test) — ghi 1 record mỗi lần `/evaluate` thật, cập nhật `userAction` khi accept/reject. **Phát hiện + sửa 1 bug thật lúc viết test**: write ban đầu dùng fire-and-forget (`void ...catch()`), gây race condition — một client gọi API đọc audit ngay sau accept có thể thấy dữ liệu cũ. Đã sửa thành `await` (vẫn bọc try/catch để không làm hỏng luồng chính). Xác nhận qua test tích hợp dùng ai-service thật (9/9 pass, bao gồm bước evaluate + accept).
- `computeGoalProgressScore()` có nhánh `ATHLETIC_PERFORMANCE` dùng `strengthProgressScore` — trước đây luôn trả `null` cho mục tiêu này (nhóm D không có tín hiệu tiến triển nào). 3 test pass.
- `proposedChanges` semantic validator mới (`proposed-change-validator.ts`) — lọc bỏ đề xuất có mức thay đổi số học phi thực tế (>60%) mà bộ lọc `allowedChanges` (chỉ kiểm tra TYPE) không bắt được. 8 test unit pass, đã wire vào `cycle-assessment.service.ts`, xác nhận 10/10 test cũ vẫn pass (không phá vỡ hành vi hiện có).

### Phase 3 — Workout log completion ✅
- `skipSchedule()` — ghi `SKIPPED` thật lần đầu tiên (trước đây tồn tại trong schema nhưng không có code path nào ghi). Route `POST /workouts/schedules/:id/skip`.
- `cancelSchedule()` — ghi `CANCELLED` + lý do bắt buộc. Route `POST /workouts/schedules/:id/cancel`.
- `PARTIALLY_COMPLETED` — phân biệt "đã log một phần" với "vừa bắt đầu, chưa log gì" (trước đây cả hai đều là `IN_PROGRESS`). Đã cập nhật ĐỦ 2 nơi đọc logic này để tránh drift: `recomputeScheduleProgress` (nguồn thật) và `checkWorkoutConsistency.ts` (script kiểm tra độc lập). Hợp đồng API bên ngoài (`sessionStatus`/`dayStatus`) giữ nguyên "in_progress" cho cả `IN_PROGRESS` và `PARTIALLY_COMPLETED` — không phá vỡ consumer hiện có.
- 5 test tích hợp mới (DB thật) + xác nhận 188/188 test toàn bộ fitness-service vẫn pass (không hồi quy).
- **Không làm**: coach/admin override + audit log — đúng như `workout-log-audit.md` đã ghi, hệ thống chưa có role coach/admin cho workout schedule nên chưa áp dụng được; exercise substitution giữa chừng session — chưa implement (out of scope thời gian, ghi nhận là gap).

### Phase 4 — User level personalization ✅ (backend + UI cơ bản)
- `competesInSport` đã wire xuyên suốt: Prisma schema → Zod schema (`profileSchema`) → repository (generic spread, không cần đổi) → ProfilePage UI (checkbox + giải thích ngắn). 3 test schema pass, frontend build sạch.
- **Không làm**: onboarding wizard đầy đủ (chọn level/goal/equipment/injury/schedule ngay lúc đăng ký) — quy mô lớn, cần thiết kế UI riêng, chưa implement trong pass này (đã ghi trong `USER_LEVEL_PERSONALIZATION_PLAN.md` như một hạng mục Phase 4 gốc).

### Phase 5 — RAG/knowledge base ✅ (mức seed, chưa ingest)
- `data/catalog/knowledge/training_methods.json` — 4 record đã review thủ công (FST-7-inspired, Mountain Dog phase structure, PHAT-inspired split, RP mesocycle/deload), đúng format `copyright_safe` + `wording_rule` yêu cầu, không copy lịch trả phí.
- `source_registry.ts` — thêm entry `issn_position_stands` (manual_dataset, ghi rõ JISSN là journal open-access nên thực tế truy xuất qua pubmed/pmc connector có sẵn, không phải API riêng). 7/7 test source-registry vẫn pass.
- **Không làm**: wiring các record `training_methods.json` vào pipeline ingest Qdrant thật — cố ý hoãn, vì ingest tự động cần thêm một lớp kiểm soát (script `data:ingest` hiện tại chưa có khái niệm "coach principle" riêng) và rủi ro bản quyền đòi hỏi thận trọng hơn một pass triển khai nhanh.

### Phase 6 — Persona test fixtures ✅ (mức có chọn lọc, không phải ma trận đầy đủ)
- Phát hiện quan trọng: `fixtures/persona-fixtures.ts` (4 persona A/B/C/D) **đã tồn tại** từ trước (không phải xây mới) — chỉ thiếu test chạy Decision Engine THẬT trên dữ liệu đó.
- `persona-decision-engine.integration.test.ts` mới: 3 test dùng dữ liệu persona thật qua pipeline `computeCycleMetrics` + `evaluateCycle` thật (không mock) — "thiếu dữ liệu" (Persona A), "0 buổi lên lịch" (không fabricate % tuân thủ), "RPE/pain cao" (Persona D).
- **Không làm — thành thật**: KHÔNG xây đủ ma trận 4 persona × 9 tình huống (36 tổ hợp). Lý do cụ thể: (a) "InBody xấu đi" và "plateau nhiều chu kỳ" cần dữ liệu InBody cross-service (giới hạn đã ghi nhận từ trước ở `adaptive-cycle-evaluation.integration.test.ts`); (b) **phát hiện quan trọng**: hiện tại Decision Engine's core numeric behavior (`averageSessionRpe`, `fatigueScore`...) **không hề khác nhau theo `experienceLevel`** — chỉ tầng giải thích AI (ai-service) mới gate kỹ thuật nâng cao theo trình độ. Nghĩa là nhiều tổ hợp "persona × tình huống" hiện cho ra kết quả decision-engine GIỐNG HỆT nhau bất kể persona — đây là một gap thật, không phải thứ nên che giấu bằng test giả tạo.

### Xác minh cuối cùng (toàn bộ, chạy thật)
- fitness-service: **188/188 pass** (`tsc --noEmit` sạch).
- ai-service: **262/262 pass** (`tsc --noEmit` sạch).
- user-service: **30/30 pass** (`tsc --noEmit` sạch).
- gateway: **21/21 pass**.
- frontend: `vite build` thành công, không lỗi.
- Tổng: **501 test pass, 0 fail** trên toàn bộ các service bị ảnh hưởng.

### Rủi ro/gap còn lại sau pass này (thành thật, không phóng đại)
1. ~~Legacy `/complete` và Adaptive `/evaluate` VẪN chưa hợp nhất (G9)~~ → **Đã sửa ở Phase 7 (xem bên dưới)**.
2. ~~`RecommendationAudit` mới chỉ wire vào Adaptive flow~~ → **Đã sửa ở Phase 7** — `completeCycle()` giờ dùng chung `runVersionedAssessment()`.
3. ~~Decision Engine chưa gia giảm theo `experienceLevel`/`competesInSport`~~ → **Đã sửa ở Phase 8**.
4. Chưa có `TrainingBlockPlan` (periodization nhiều pha/peaking) cho nhóm D — **VẪN CHƯA LÀM**, vẫn là thiết kế mức khái niệm (quy mô lớn, ngoài phạm vi Phase 7-12).
5. ~~Onboarding wizard đầy đủ — chưa làm~~ → **Đã làm ở Phase 9**.
6. ~~Ingest `training_methods.json` vào Qdrant — chưa làm~~ → **Đã làm ở Phase 10**, xác minh sống (live) qua Qdrant/Ollama thật.
7. ~~Ma trận persona × scenario đầy đủ — chưa làm~~ → **Đã làm ở Phase 11** (36/36 tổ hợp qua Decision Engine thật).

---

## 13. Nhật ký triển khai — Phase 7-12 (tiếp nối Phase 1-6 ở trên, xác minh bằng test thật)

> Cùng kỷ luật như Phase 1-6: mọi mục dưới đây đã chạy `tsc --noEmit` + test thật (DB thật qua `FITNESS_DATABASE_URL`/`gymcoach_fitness_test` chạy bên trong container `gymcoach-fitness-dev`, không mock) trước khi ghi là "done". Phase 10 còn được xác minh thêm bằng Qdrant + Ollama thật đang chạy trong môi trường dev (không chỉ unit test).

### Phase 7 — Hợp nhất luồng Training Cycle ✅

**Vấn đề gốc (G9)**: `completeCycle()` (route cũ `/complete`) chạy `classifyProgress()` (3 trạng thái KEEP/ADJUST/NEW_PLAN) + `analyzeCycleSafe()` (client AI cũ) hoàn toàn độc lập với `evaluateCycle()` (route `/evaluate`) chạy `computeCycleMetrics()` + Decision Engine 6 trạng thái + `assessCycleSafe()`. Hai luồng, hai bộ phân loại, hai audit trail khác nhau — rủi ro trôi lệch logic dài hạn.

**Đã sửa**: trích xuất logic dùng chung từ `evaluateCycle()` thành `training-cycle.service.ts`'s **`runVersionedAssessment(cycle, userId, clock)`** — hàm DUY NHẤT gọi `computeCycleMetrics()` → `runDecisionEngine()` (Decision Engine 6 trạng thái) → `assessCycleSafe()` (giải thích AI) → ghi `CycleAssessment` phiên bản hoá + `RecommendationAudit`. Cả `evaluateCycle()` (route `/evaluate`, không đổi hợp đồng API) **và** `completeCycle()` (route `/complete`, nhánh "đủ dữ liệu") giờ gọi CHUNG hàm này.

- `completeCycle()` giữ nguyên gate `INSUFFICIENT_DATA` cũ (không đổi hành vi nhánh này — vẫn set `decision: "INSUFFICIENT_DATA"` trực tiếp, không gọi Decision Engine, đúng như thiết kế cũ vì gate này đã đúng).
- Nhánh "đủ dữ liệu" của `completeCycle()`: KHÔNG còn gọi `classifyProgress()`/`runAnalysis()`/`analyzeCycleSafe()` (luồng cũ) — thay vào đó gọi `runVersionedAssessment()`, ghi `decision` = giá trị 6 trạng thái thật từ Decision Engine, `summary.unifiedAssessmentId` trỏ tới `CycleAssessment` vừa tạo.
- **Không xoá code cũ** (`classifyProgress`, `runAnalysis`, `training-cycle-classification.service.ts`) theo đúng yêu cầu — đánh dấu `@deprecated` bằng JSDoc, không còn route/luồng nào gọi tới, nhưng vẫn tồn tại trong repo phòng trường hợp cần tham chiếu.
- **Hệ quả hành vi quan trọng**: `completeCycle()` giờ chạy ĐỒNG BỘ (không còn fire-and-forget) vì gọi LLM thật bên trong — đã phát hiện và sửa **cùng một lớp bug timeout** đã sửa trước đó cho `evaluate()`: `trainingCycleService.complete()` (frontend `api.ts`) trước đây dùng timeout mặc định 10s của instance `api`, sẽ abort trước khi server LLM round-trip xong (5-90s thực tế đo được). Đã thêm override `{ timeout: 120000 }`, giống hệt cách `evaluate()` đã được sửa.
- **Frontend crash risk đã phát hiện + sửa**: `DecisionCard` (legacy UI) có `DECISION_CONFIG` chỉ map 4 giá trị (KEEP/ADJUST/NEW_PLAN/INSUFFICIENT_DATA) — sau khi hợp nhất, `TrainingCycle.decision` có thể là 1 trong 6 giá trị (thêm PROGRESS/DELOAD/REBUILD), truy cập `DECISION_CONFIG[decision].label` với giá trị không map được sẽ crash (`undefined.label`). Đã sửa: mở rộng `CycleDecision` type (frontend) thành 7 giá trị, đổi `DECISION_CONFIG` sang `Partial<Record<...>>`, thêm guard `if (!cfg) return null`, và mở rộng logic "defer sang AdaptiveAssessmentCard" (đã có sẵn cho `status === "COMPLETED"`) để áp dụng luôn cho `status === "ANALYZED"` khi đã có `CycleAssessment` thật — vì giờ đây một cycle ANALYZED gần như luôn có assessment thật, `DecisionCard` legacy sẽ tự động và vĩnh viễn nhường chỗ cho `AdaptiveAssessmentCard` (đã hỗ trợ đủ 6 trạng thái). `CycleHistoryRow` có cùng rủi ro crash (`DECISION_CONFIG[cycle.decision].label` không optional-chain) — đã sửa tương tự, fallback sang `ADAPTIVE_DECISION_CONFIG` khi decision là 1 trong 3 giá trị mới.
- Test mới: `training-cycle-unification.integration.test.ts` (DB thật) — seed 10 buổi tập thật trải 35 ngày (goal `ATHLETIC_PERFORMANCE` để tránh phụ thuộc InBody cross-service), gọi `completeCycle()`, xác nhận: decision KHÔNG phải INSUFFICIENT_DATA, đúng 1 `CycleAssessment` phiên bản 1 được tạo, đúng 1 `RecommendationAudit`, gọi `evaluateCycle()` sau đó tạo phiên bản 2 (không trùng lặp phiên bản 1) — chứng minh 2 route dùng chung 1 bộ đếm phiên bản.
- Test cũ vẫn pass nguyên vẹn (188 → **205/205** sau khi cộng thêm Phase 8/11's test mới, xem mục Xác minh cuối cùng).

### Phase 8 — Decision Engine gia giảm theo trình độ ✅

**Vấn đề gốc**: `cycle-decision.engine.ts`'s `evaluateCycle()` không nhận `experienceLevel`/`competesInSport` — mọi user, bất kể trình độ, dùng CHUNG một bộ ngưỡng số. `competesInSport` được lưu nhưng chưa từng được đọc ở logic quyết định. Ngoài ra phát hiện thêm 2 gap khi rà lại toàn bộ `CycleMetricsResult` field usage: `nutritionConsistencyScore` và `volumeProgressionSlope`/`missedSessionCount` được TÍNH nhưng KHÔNG BAO GIỜ được Decision Engine ĐỌC (dù đây là yêu cầu tường minh của prompt gốc: "adherence, missed/skipped sessions, nutrition consistency, volume slope").

**Đã sửa** (`cycle-decision.engine.ts` + `cycle-thresholds.config.ts`):
- `DecisionEngineInput` + 2 field mới: `experienceLevel?: "BEGINNER"|"INTERMEDIATE"|"ADVANCED"|"UNKNOWN"`, `competesInSport?: boolean`. `UNKNOWN`/thiếu → xử lý y hệt `BEGINNER` (không bao giờ nâng cấp ngầm lên `INTERMEDIATE`), đúng nguyên tắc đã có trong `USER_LEVEL_PERSONALIZATION_PLAN.md` §0.
- **"Professional"** = `experienceLevel === "ADVANCED" && competesInSport === true` (không phải giá trị enum thứ 5 — giữ đúng quyết định thiết kế đã ghi ở plan doc).
- **Ngưỡng DELOAD (fatigue/recovery) gia giảm theo trình độ**: beginner cần fatigue/recovery bất thường RÕ RỆT hơn mới trigger DELOAD (`highFatigueScoreBeginner=0.85`, `lowRecoveryScoreBeginner=0.25`) vì beginner hiếm khi thực sự overreach; advanced/professional trigger SỚM HƠN (`highFatigueScoreAdvanced=0.6`, `lowRecoveryScoreAdvanced=0.45`) vì tập gần giới hạn thật hơn. Mặc định (intermediate) giữ ngưỡng cũ (0.7/0.35) — không đổi hành vi hiện có cho nhóm này.
- **REBUILD không bao giờ fire cho BEGINNER/UNKNOWN** — lý do: quyết định này vốn dựa trên lịch sử "2 chu kỳ liên tiếp trước đó", một user mới tập chưa tích luỹ đủ lịch sử này (đúng như `USER_LEVEL_PERSONALIZATION_PLAN.md` §A đã ghi "REBUILD chưa đủ chu kỳ trước để so sánh").
- **Ngưỡng PROGRESS nghiêm ngặt hơn cho professional**: `progressScoreThresholdProfessional=0.5` thay vì mặc định `0.35` — một cuộc gọi sai "sẵn sàng tăng tải" tốn kém hơn với VĐV đang chuẩn bị thi đấu.
- **Gate INSUFFICIENT_DATA riêng cho professional**: `professionalMinimumDataQualityScore=0.65` — một mức dataQualityScore đủ cho ADVANCED thường vẫn có thể bị coi là chưa đủ cho professional.
- **`competesInSport` giờ THỰC SỰ ảnh hưởng quyết định** (không chỉ nằm im trong schema) — 2 điểm cụ thể: (a) ngưỡng PROGRESS ở trên, (b) gate INSUFFICIENT_DATA ở trên. `reasonCodes` mới `PROFESSIONAL_STRICTER_PROGRESS_BAR_MET`, `PROFESSIONAL_REQUIRES_HIGHER_DATA_QUALITY` để audit truy vết được tại sao.
- **`nutritionConsistencyScore` và `volumeProgressionSlope`** giờ là 2 tín hiệu có trọng số thật trong `computeProgressScore()` (composite score) — không thay thế `volumeTrendPercent` cũ (giữ cả 2, vì bất đồng giữa "trend đơn giản" và "slope hồi quy" tự nó là thông tin audit có giá trị, đã surfaced qua `conflictingSignals`). `missedSessionCount` được thêm vào `supportingMetrics` để audit (không thêm vào composite score vì đã được phản ánh gián tiếp qua `adherenceRate`).
- **Threading dữ liệu**: `runVersionedAssessment()` (fitness-service) giờ gọi `fetchUserProfile(userId)` MỘT LẦN DUY NHẤT cho cả 2 route (`/complete` và `/evaluate`, vì cùng chung hàm), lấy `experienceLevel`/`competesInSport` thật, truyền vào cả `runDecisionEngine()` VÀ payload gửi `assessCycleSafe()` (tầng giải thích AI) — prompt AI giờ có hướng dẫn tường minh theo trình độ (ví dụ: cấm đề xuất kỹ thuật nâng cao cho beginner).
- **Backstop code-level cho "beginner không bao giờ nhận volume/intensity cao"**: `proposed-change-validator.ts` (ai-service) thêm ngưỡng biến động tối đa RIÊNG cho beginner (`MAX_PLAUSIBLE_RELATIVE_CHANGE_BEGINNER = 20%`, so với 60% mặc định) — đây là chốt chặn ở TẦNG CODE (không phải chỉ nhắc trong prompt, LLM có thể bỏ qua), lọc mọi đề xuất LOAD/VOLUME/REPS/FREQUENCY thay đổi >20% cho beginner bất kể LLM nói gì.
- Test: 27 unit test (`cycle-decision.engine.test.ts`, +12 mới cho Phase 8) + 6 test matrix riêng (`persona-level-scenario-matrix.test.ts`, Phase 11) + 11 test (`proposed-change-validator.test.ts`, +3 mới) — tất cả pass.

### Phase 9 — Onboarding wizard ✅

**Trước đây**: không có onboarding flow nào — user mới vào thẳng dashboard với `UserProfile` rỗng, không có cách nào bắt buộc/khuyến khích nhập `experienceLevel`/`goal`/thiết bị/chấn thương ngay từ đầu (nguyên nhân gốc của nhiều user rơi vào `UNKNOWN` không cần thiết, đã ghi ở `USER_LEVEL_PERSONALIZATION_PLAN.md`).

**Đã làm**:
- **Backend** (user-service): 2 field Prisma mới trên `UserProfile` — `preferredSplit String?` (tên kiểu chia lịch, tự do, không phải enum, vì catalog thực tế phong phú hơn 1 enum cố định) và `hasCompletedOnboarding Boolean @default(false)`. Migration `20260803000000_user_profile_onboarding_fields`, additive, áp dụng cho DB dev (`gymcoach_user`), Prisma Client regenerate. Cả 2 field đã thêm vào `profileSchema` (Zod) — dùng chung endpoint ghi hiện có `PUT /profile/me`, không tạo route mới.
- **Frontend**: `OnboardingWizardPage.tsx` mới — wizard 6 bước (Trình độ & Mục tiêu → Lịch tập → Thiết bị → Sức khỏe & Thi đấu → Chỉ số cơ thể → Xem lại), theo đúng convention stepper đã có ở `PTApplicationPage.tsx`. Thu thập: `experienceLevel`, `goal`, `preferredTrainingDays` (chọn ngày trong tuần), `sessionDurationMinutes`, `preferredSplit`, `availableEquipment`, `injuries` (free text, tách bằng dấu phẩy), `competesInSport`, `age`/`gender`/`heightCm`/`currentWeight`/`targetWeight`. Có nút "Bỏ qua, thiết lập sau" — vẫn set `hasCompletedOnboarding: true` (lưu bất kỳ dữ liệu nào đã nhập) để tránh vòng lặp redirect vô hạn, nhưng cho phép user không nhập gì và vào dashboard ngay.
- **Redirect/prompt mechanism**: `RequireOnboarding.tsx` (component guard mới, cùng pattern với `RequireRole.tsx` đã có) — bọc toàn bộ subtree `/client/*`, chỉ áp dụng cho role `client` (không áp dụng PT/gym-owner/admin), tự động redirect sang `/client/onboarding` nếu `profile.hasCompletedOnboarding !== true`, tự loại trừ chính route onboarding để tránh redirect loop.
- **Đã sửa 1 bug có sẵn liên quan trực tiếp**: `ProfilePage.tsx`'s ô "Ghi chú sức khỏe" (injuries) là stub chết — không có `value`/`onChange`, hiển thị cứng "Không có chấn thương." bất kể dữ liệu thật. Vì wizard giờ ghi dữ liệu `injuries` thật, đã sửa `ProfilePage` để đọc/ghi đúng field này (nếu không sửa, dữ liệu wizard nhập vào sẽ "biến mất" khỏi mắt user khi họ mở lại trang Hồ sơ).
- **Xác minh sống (không chỉ build sạch)**: gọi thật `PUT /profile/me` qua user-service (đăng nhập user seed thật `john.doe@example.com`), xác nhận `preferredSplit`/`hasCompletedOnboarding` ghi/đọc đúng cả qua endpoint public (`/profile/me`) lẫn endpoint internal (`/internal/profile/:userId`, dùng bởi fitness-service để đọc `experienceLevel`/`competesInSport`) — phát hiện + xử lý 1 vấn đề thật: container `user-service` chạy `tsx watch` không tự nhận Prisma Client vừa regenerate cho tới khi restart container, đã restart để xác minh đúng. Đã dọn dữ liệu test khỏi profile user seed thật sau khi xác minh xong.
- Test mới: `profile.models.onboarding.test.ts` (user-service, 5 test — Zod schema cho 2 field mới).
- **Chưa làm** (giới hạn phạm vi, ghi nhận trung thực): không tự động điền `experienceLevel`/`competesInSport` từ wizard vào chính "chọn template" lúc tạo plan (wizard chỉ ghi vào `UserProfile`, các luồng đọc `UserProfile` hiện có tự động hưởng lợi — không cần thêm code, nhưng chưa có test end-to-end xác nhận riêng luồng "AI Plan Generation đọc đúng equipment/injuries mới nhập").

### Phase 10 — Ingest knowledge base vào Qdrant ✅ (xác minh sống, không chỉ code)

**Trước đây**: `data/catalog/knowledge/training_methods.json` (4 record coach-principle) tồn tại nhưng KHÔNG có pipeline ingest nào — `source_registry.ts`'s `manual_dataset` type (dùng cho `issn_position_stands`) mới chỉ ở mức allowlist/validation, chưa có code ingest thật cho bất kỳ manual dataset nào trong repo.

**Đã làm**:
- `ingestTrainingMethods.ts` (ai-service, `src/datasets/seed/`) — pipeline ingest MỚI, tách biệt với 3 pipeline nghiên cứu-giấy-tờ hiện có (`ingestEvidence.ts`, `knowledge-pipeline/*`, `knowledge/pipeline/*`), nhưng ghi vào CHUNG collection Qdrant `fitness_evidence` (768-dim, Cosine) mà `retriever.retrieveEvidence()` đã đọc — nghĩa là record mới lập tức khả dụng cho `cycle-assessment.service.ts` mà không cần đổi code retrieval.
- **Hàm thuần (pure function) tách riêng khỏi IO**: `mapTrainingMethodToPoint()` xuất khẩu riêng để unit-test không cần Qdrant/Ollama thật — 9 test (`ingest-training-methods.test.ts`) xác nhận: `source_url` luôn là citation http(s) đầu tiên (bắt buộc để `evidenceUsedFromDocs()` không âm thầm loại bỏ), record `copyright_safe !== true` bị TỪ CHỐI ingest (throw, không âm thầm bỏ qua), point ID ổn định/tất định (ingest lại không tạo trùng lặp), mọi field audit (`method_id`, `source_ref`, `reviewed_by`, `wording_rule`...) có mặt trên payload.
- **Phát hiện + sửa 1 vấn đề thật khi xác minh sống**: nội dung gốc (principle/constraints/usage_in_app) viết bằng tiếng Anh, trong khi các câu truy vấn RAG thật của `cycle-assessment.service.ts`'s `buildRagQueries()` đều bằng tiếng Việt — kiểm tra sống bằng embedding thật (Ollama `nomic-embed-text`) cho thấy các record tiếng Anh gần như KHÔNG BAO GIỜ lọt top-5 kết quả cho truy vấn tiếng Việt (thua xa 106 record tiếng Việt có sẵn trong `fitness_evidence`). Đã sửa: thêm một đoạn "khung tiếng Việt" (dịch `goal`/`target_level` + lặp lại nguyên văn `wording_rule` — vốn đã là tiếng Việt) vào đầu `textForEmbed`, KHÔNG viết lại nội dung tiếng Anh gốc đã qua review (`principle`/`constraints`/`contraindications` giữ nguyên, chỉ thêm, không thay). Xác minh lại sống: `FST-7 inspired finisher` lọt hạng #1 (score 0.735) cho truy vấn "kỹ thuật finisher tăng bơm máu cuối buổi tập cho nhóm cơ yếu".
- **Script xác minh** `testTrainingMethodsIntegration.ts` (`npm run ai:test:training-methods`) — không chỉ đếm point trong Qdrant, mà chạy THẬT qua `retriever.retrieveEvidence()` + `evidenceUsedFromDocs()` (đúng luồng `cycle-assessment.service.ts` dùng), exit code khác 0 nếu bất kỳ check nào fail. Đã chạy sống, tất cả check pass: cả 4 record có mặt trong Qdrant với title/source_url/copyright_safe đúng, retrieval thật trả về ít nhất 1 record `training_methods_manual_dataset` với citation hợp lệ.
- **RAG chỉ dùng để giải thích, không bao giờ quyết định**: không đổi bất kỳ dòng nào trong `cycle-decision.engine.ts` — nội dung ingest chỉ chảy vào `assessCycleSafe()` (tầng giải thích), và `cycle-assessment.service.ts` đã có sẵn cơ chế ép `output.decision` về đúng giá trị Decision Engine bất kể LLM trả về gì (không đổi ở Phase 10, chỉ xác nhận lại nguyên tắc này vẫn giữ nguyên).
- **Gap phát hiện thêm, ghi nhận trung thực (KHÔNG sửa vì ngoài phạm vi training_methods.json)**: 106 record `external_evidence_dataset` có sẵn từ trước trong `fitness_evidence` **đều có `source_url: null`** — nghĩa là chúng KHÔNG BAO GIỜ vượt qua gate trích dẫn của `evidenceUsedFromDocs()` (`if (!sourceUrl || !title) continue`), dù vẫn được dùng làm ngữ cảnh cho prompt. Đây là gap thật, có trước Phase 10, không thuộc phạm vi "ingest training_methods.json" — chỉ ghi nhận, chưa sửa.

### Phase 11 — Ma trận persona 4 trình độ × 9 tình huống ✅

`persona-level-scenario-matrix.test.ts` mới (fitness-service) — 6 test bao phủ đủ 36 tổ hợp (4 trình độ × 9 tình huống), gọi TRỰC TIẾP `evaluateCycle()` thật từ `cycle-decision.engine.ts` (không mock, không snapshot) với fixture `CycleMetricsResult` dựng thủ công (cùng kỹ thuật đã dùng xuyên suốt `cycle-decision.engine.test.ts`) — khác với `persona-decision-engine.integration.test.ts` (Phase 6 cũ, chạy qua DB thật nhưng chỉ 3/9 tình huống) ở chỗ: nhanh hơn (không cần DB), bao phủ ĐỦ 9 tình huống, nhưng KHÔNG đi qua `computeCycleMetrics()` thật (đã có test riêng cho hàm đó).

- **9 tình huống**: thiếu dữ liệu, tiến bộ đều, bỏ nhiều buổi (adherence thấp), buổi bị skip/cancel (adherence sát ngưỡng nhưng missedSessionCount cao), pain cao, RPE/fatigue cao, nutrition kém, plateau, InBody/thành phần cơ thể xấu đi.
- **Xác nhận quyết định KHÁC NHAU theo trình độ với cùng dữ liệu thô** (yêu cầu tường minh của prompt gốc): tình huống 6 (fatigue=0.65, recovery=0.4) → BEGINNER không DELOAD (ngưỡng 0.85/0.25 chưa chạm), ADVANCED có DELOAD (ngưỡng 0.6/0.45 đã chạm) — `assert.notDeepEqual` xác nhận toàn bộ output khác nhau, không chỉ decision.
- **Xác nhận professional + competesInSport có hành vi riêng biệt**: 2 test riêng — tình huống 2 (tiến bộ đều, ngưỡng PROGRESS khác nhau, `reasonCodes` phải chứa `PROFESSIONAL_STRICTER_PROGRESS_BAR_MET` nếu professional đạt PROGRESS) và biến thể tình huống 1 (dataQualityScore=0.6: ADVANCED bình thường qua được, professional bị chặn ở `INSUFFICIENT_DATA`).
- **Xác nhận beginner KHÔNG BAO GIỜ được đề xuất volume/intensity cao**: quét toàn bộ 9 tình huống, khẳng định `recommendedActionScope !== "full_rebuild"` và `decision !== "REBUILD"` cho beginner ở MỌI tình huống (không chỉ 1 case đơn lẻ).
- Tất cả 6 test pass, không cần DB (chạy < 1 giây).

---

## 14. Xác minh cuối cùng — Phase 7-12 (toàn bộ, chạy thật)

- **fitness-service**: `tsc --noEmit` sạch. **205/205 test pass** (chạy qua DB thật `gymcoach_fitness_test` bên trong container `gymcoach-fitness-dev`) — bao gồm 27 test Decision Engine (Phase 8, +12 so với 15 cũ), 6 test ma trận persona (Phase 11, mới), 1 test tích hợp hợp nhất luồng (Phase 7, mới), cộng toàn bộ 171 test đã có từ Phase 1-6 (đều pass nguyên vẹn, không hồi quy).
- **ai-service**: `tsc --noEmit` sạch. **292/292 test pass** (`test:all`, bao gồm test lồng trong `src/llm/__tests__` và `src/datasets/__tests__`) — bao gồm 9 test mới cho `ingestTrainingMethods.ts` (Phase 10) và 3 test mới cho ngưỡng beginner của `proposed-change-validator.ts` (Phase 8).
- **user-service**: `tsc --noEmit` sạch. **35/35 test pass** — bao gồm 5 test mới cho `preferredSplit`/`hasCompletedOnboarding` (Phase 9).
- **gateway**: `tsc --noEmit` sạch. **21/21 test pass** (không đổi so với Phase 6, không có thay đổi nào ở gateway trong pass này).
- **frontend**: `vite build` thành công, không lỗi mới (cảnh báo chunk-size là cảnh báo cũ, không liên quan tới thay đổi lần này).
- **Migration**: `prisma validate` sạch cho user-service; migration `20260803000000_user_profile_onboarding_fields` áp dụng trực tiếp cho DB dev qua `psql` + đánh dấu `migrate resolve --applied` (theo đúng convention đã dùng cho `competesInSport` migration trước đó) — KHÔNG đụng tới drift bookkeeping cũ 9 migration khác của user-service (đã ghi nhận từ trước, ngoài phạm vi pass này, xem ghi chú dưới).
- **Tổng**: **553 test pass, 0 fail** trên toàn bộ 4 service bị ảnh hưởng (205 + 292 + 35 + 21), cộng thêm xác minh sống ngoài test suite (Qdrant/Ollama thật cho Phase 10, HTTP thật cho Phase 9).

### Vấn đề môi trường phát hiện được (ngoài phạm vi công việc, chỉ ghi nhận)
- Container `gymcoach-ai-dev` hiện **unhealthy** — thiếu `@anthropic-ai/sdk` trong node_modules dù đã có trong `package.json` (thay đổi chưa commit, có trước phiên này). Nguyên nhân: `package.json` KHÔNG được bind-mount vào container (chỉ `src`/`prisma`/`data` được mount) nên image chưa rebuild để cài dependency mới. Không sửa vì ngoài phạm vi yêu cầu Phase 7-12 và cần rebuild image (hành động có ảnh hưởng rộng hơn) — mọi test/xác minh trong pass này đều KHÔNG phụ thuộc vào tính năng dùng `@anthropic-ai/sdk` (dùng Ollama local qua `LLM_PROVIDER` khác), nên không ảnh hưởng tới kết quả đã báo cáo.
- Drift bookkeeping `_prisma_migrations` cho user-service (9 migration cũ hiện "chưa áp dụng" theo Prisma dù cột/bảng thật đã tồn tại) — đã ghi nhận từ phiên trước, KHÔNG đụng tới trong Phase 7-12 (migration mới của Phase 9 áp dụng độc lập, không phụ thuộc việc giải quyết drift cũ).

### Rủi ro/gap còn lại sau Phase 7-12 (thành thật, không phóng đại)
1. `TrainingBlockPlan` (periodization nhiều pha/peaking cho nhóm D/professional) — vẫn CHƯA LÀM, quy mô lớn, cần thiết kế schema riêng (nhiều `TrainingCycle` nối tiếp có vai trò macrocycle khác nhau).
2. Onboarding wizard chưa có test end-to-end xác nhận dữ liệu mới nhập (equipment/injuries) thực sự ảnh hưởng tới AI Plan Generation — chỉ xác nhận wizard ghi đúng vào `UserProfile`, chưa xác nhận downstream.
3. 106 record `external_evidence_dataset` có sẵn thiếu `source_url` nên không bao giờ được trích dẫn — gap có trước Phase 10, chưa sửa (ngoài phạm vi).
4. Drift migration bookkeeping cũ của user-service (9 migration) vẫn chưa giải quyết — như đã ghi từ phiên trước.
5. Container `ai-service` dev thiếu dependency `@anthropic-ai/sdk` (môi trường, không phải code) — cần rebuild image, ngoài phạm vi pass này.
6. Ma trận persona Phase 11 dùng fixture `CycleMetricsResult` dựng tay (không qua `computeCycleMetrics()` thật từ DB) cho toàn bộ 9 tình huống — 3/9 tình huống trọng điểm ĐÃ có phiên bản chạy qua DB thật riêng (`persona-decision-engine.integration.test.ts`, Phase 6); 6/9 còn lại (bỏ nhiều buổi, skip/cancel, RPE/fatigue cao, nutrition kém, plateau, InBody xấu đi) chưa có phiên bản DB-thật tương ứng — vẫn là gap cross-service InBody đã ghi nhận từ Phase 6.
