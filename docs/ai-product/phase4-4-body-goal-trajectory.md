# Phase 4.4 — Observed body state + goal gap / trajectory foundation

Nhãn bằng chứng: `CODE AUDIT` · `TEST FIXTURE` · `BACKEND INTEGRATION` (Postgres `*_test` cô lập; user-service là stand-in HTTP) · `REAL HTTP/API` (auth + user-service + fitness-service thật chạy cục bộ trên DB test → reader ai-service → `CoachStateV0`). Không có `REAL BROWSER`. 0 LLM call. Chưa nối vào hội thoại; không thêm router topic/intent.

## 1. Starting gap
Audit: có InBody lịch sử và engine xu hướng/chất lượng trong cycle, nhưng không có đường đọc ngoài cycle; `currentWeight` không có lịch sử; không lịch sử `targetWeight`; target roadmap là Json tự do; nghĩa của `muscleMass` chưa chứng minh được; `fetchInBodyHistory` nuốt lỗi thành `[]`.

## 2. Source-of-truth map (CODE AUDIT)
| Dữ liệu | Owner / bảng | Ghi bởi | Thời điểm / đơn vị | Lịch sử | Sửa được | Raw/derived |
|---|---|---|---|---|---|---|
| `InBodyEntry.weight/bodyFat(kg)/bodyFatPct/muscleMass/…` | user-service `inbody_entries` | `POST/PATCH /inbody`, OCR upload (`status: manual|extracted|pending`) | `date` + `dateOnly` (≤1/ngày/user), kg, % | CÓ | CÓ | raw |
| `UserProfile.currentWeight` | user-service `user_profiles` | `PUT/PATCH /profile` **và** tự đồng bộ từ InBody mới nhất (`syncLatestInBodyToProfile`) | chỉ `updatedAt` chung của profile | KHÔNG | CÓ | hỗn hợp, không có provenance |
| `UserProfile.targetWeight`, `goal` | user-service | profile write | idem | KHÔNG | CÓ | raw |
| `UserProfile.startingWeight(+Source)` | user-service | lần đầu có cân nặng | idem | 1 điểm | — | snapshot |
| `TrainingCycle.baselineMetrics` / `targetMetrics` | fitness-service | `buildCycleBaselineMetrics` lúc kích hoạt cycle (typed: `INBODY{weight,measuredAt}` hoặc `PROFILE_FALLBACK{weight}`); `targetMetrics` có thể do PT/caller ghi | lúc cycle bắt đầu | theo cycle | không | snapshot |
| `FitnessRoadmap` (`goalType`, `status`, `plannedStartAt/EndAt`) + `RoadmapPhase` (`phaseType`, `status`, ngày) | fitness-service | roadmap service | typed DateTime | version chain | CÓ | raw typed |
| `FitnessRoadmap.targetMetrics`, `configuration`, `RoadmapPhase.objective` | fitness-service | roadmap service | Json | — | — | **free-form `z.record(z.unknown())`** |
| `CycleAssessment.computedMetrics` | fitness-service | decision engine | Json | theo version | — | derived |
Hiện consumer AI: chat dùng toàn bộ InBody + profile qua `profile_extractor` (raw); không đọc roadmap/cycle body analytics.

## 3. currentWeight vs InBody (provenance, không chọn ngầm)
`currentWeight` = loại **D**: giá trị do người dùng sửa tay **hoặc** auto-sync từ InBody mới nhất; không có timestamp/nguồn nên không thể biết cái nào mới hơn. Chính sách:
- **`latest` = InBody mới nhất** (có `measuredAt`, `source`) — dùng làm `currentKg` của gap (`currentSource: MEASURED_INBODY`, kèm `currentAsOf`).
- `profileReportedWeight` luôn được giữ riêng (`kg`, `matchesLatestMeasurement`, `differenceFromLatestKg`); khi khác ≥ 0,05 kg, `gap.alternateCurrent` nêu rõ giá trị profile và chênh lệch.
- Chỉ khi **không có** InBody: gap dùng profile với `currentSource: PROFILE_REPORTED`, `currentAsOf: null`.
Smoke thật cho thấy A: profile 86 → sau 4 InBody profile tự đồng bộ = 82 (khớp) — nên đồng bộ là chuyện bình thường nhưng không được giả định.

## 4. InBody field semantics
`weight`,`height`,`bmi`,`bodyFatPct` (%), `bodyFat` (kg, **bắt buộc** — suy từ `weight×pct` nếu thiếu khi tạo tay), `muscleMass` (kg, **bắt buộc**), `visceralFat`, `bmr`, segmental lean/fat, `status`. Chỉ `weight`, `bodyFatPct`, `muscleMass` được đưa vào body state. `bodyFatPct` null ⇒ giữ null (không suy từ kg).

## 5. muscleMass conclusion — **`MUSCLE_MASS_SEMANTICS_UNRESOLVED`**
Bằng chứng: đường OCR gán `muscleMass = result.skeletal_muscle_mass || 0` (prompt vision: "Skeletal muscle mass in kg") ⇒ với hàng `extracted` là SMM. Đường nhập tay chỉ có nhãn UI "Cơ bắp (kg)" và comment trong code gọi là "skeletal muscle mass" nhưng không có định nghĩa/validation; không thể chứng minh người dùng nhập SMM chứ không phải khối lượng nạc/cơ nói chung. Cùng một cột chứa hai nguồn ⇒ không chứng minh được. Hệ quả: tên trung tính `muscleMassKg`, `muscleMassSemantics: "UNRESOLVED"`, `muscleMassProvenance {extracted, manual, unknown}`; không bao giờ `skeletal…`. Ngoài ra OCR ghi `|| 0` khi thiếu ⇒ **0 được coi là thiếu** (không phải 0 kg). (Engine cycle hiện gọi đại lượng này `skeletalMuscleTrend`; tên đó không được mang sang Coach State.)

## 6. Body observation model
`BodyObservation { measuredAt, weightKg, bodyFatPct|null, muscleMassKg|null, source EXTRACTED|MANUAL|UNKNOWN, excludedFromTrend }`.

## 7. Body state model (`CoachStateV0.body`)
`dataQuality`, `observations {totalOnRecord, inLookback, comparableInLookback, firstAt, latestAt}`, `latest`, `previous` (điểm liền trước trong lookback), `latestAgeDays`, `trends {weight, bodyFat, muscleMass}`, `quality {outlierCount, intervalWarningCount, mixedSources, confidenceMultiplier, flags}`, `muscleMass*`, `profileReportedWeight`, `lookbackDays`. Không có chuỗi thô.

## 8. Trend reuse + lookback
Tái dùng `evaluateInBodyQuality` và `computeBodyCompositionTrends` (least-squares; ngưỡng `flat` 0,05 kg/tuần của engine). Việc thêm duy nhất: **một điểm không bao giờ là xu hướng** — engine trả `direction:"flat"` cho n=1 (có test chứng minh) và lớp này đổi thành `INSUFFICIENT_HISTORY`. Từ vựng trung tính `UP|FLAT|DOWN` (không "improving"). Xu hướng cơ chỉ dùng điểm có `muscleMass>0`.
**Lookback:** mặc định **90 ngày**, tham số `lookbackDays` 14–365. Lý do: nhịp đo InBody do người dùng quyết định, thưa hơn nhiều so với buổi tập (evaluator coi <3 ngày là không độc lập); 90 = 3 × độ dài cycle mặc định (30 ngày) để người đo hằng tháng vẫn có ≥2 điểm. Đây là `PRODUCT_HEURISTIC`, không phải hằng số khoa học; không dùng 28 ngày của training.

## 9. Outlier / data-quality behavior
Giữ nguyên luật engine: điểm bị đánh dấu (đổi cân/ngày hoặc %mỡ vượt ngưỡng) **vẫn hiện ở `latest`** với `excludedFromTrend: true`, bị loại khỏi xu hướng, đếm trong `outlierCount`, hạ chất lượng xuống `PARTIAL`; không xoá. Nguồn lẫn (manual+extracted) ⇒ `mixedSources`. Chất lượng: `NO_DATA` (không có hàng nào), `STALE` (có nhưng không có trong lookback; `latest` vẫn hiện kèm tuổi), `INSUFFICIENT_HISTORY` (<2 điểm so sánh được), `PARTIAL` (outlier/nguồn lẫn), `SUFFICIENT`.

## 10. Goal target model
`goal.currentTarget`: `AVAILABLE{weightKg, source: PROFILE_TARGET_WEIGHT, history: TARGET_HISTORY_UNAVAILABLE}` hoặc `NO_TARGET`. Chỉ đo cân nặng; không có "target body-fat/SMM" typed ⇒ `UNSUPPORTED_TARGET_METRIC` được định nghĩa nhưng chưa phát sinh.

## 11. Target-history limitation
`TARGET_HISTORY_UNAVAILABLE` được gắn thẳng vào target. Mảnh lịch sử duy nhất: `startingState.targetAtCycleStartKg` — chỉ khi `cycle.targetMetrics` đúng dạng `{source:"GOAL_AT_CYCLE_START", targetWeight}` (giá trị do PT/caller ghi bị bỏ qua).

## 12. Goal gap
`{currentKg, targetKg, differenceKg = current − target (có dấu), absoluteKg, currentSource, currentAsOf, alternateCurrent}`; không nhãn tốt/xấu/xa. Lý do vắng: `NO_TARGET`, `NO_CURRENT_WEIGHT`.

## 13. Observed trajectory
Từ các điểm **so sánh được** trong lookback: `timeSpanDays, observationCount, first/latestWeightKg, observedChangeKg, observedRateKgPerWeek` (slope của engine), `directionRelativeToGap` = hình học (hướng xu hướng so với dấu của gap: `TOWARD_TARGET|AWAY_FROM_TARGET|FLAT|NOT_APPLICABLE`) — không phải đánh giá. Không ngoại suy, không "bao lâu nữa đạt mục tiêu". Không dùng dinh dưỡng/tập luyện để giải thích.

## 14. Target-date availability
**Không có** trường typed nào định nghĩa hạn chót cho cân nặng mục tiêu. `FitnessRoadmap.plannedEndAt` là mốc kết thúc của kế hoạch, không phải hạn đạt target (được expose đúng nhãn `roadmap.plannedEndAt`, không dùng làm deadline); `goalIntent`/`targetMetrics` là Json tự do ⇒ không tin.

## 15. On-track evaluability
`onTrack: { status: "NOT_EVALUABLE", reasons[], classification: "DEFERRED" }` — luôn như vậy hôm nay (luôn kèm `NO_TARGET_DATE`). Lý do khác tính theo đầu vào: `NO_TARGET`, `NO_STARTING_STATE`, `INSUFFICIENT_BODY_HISTORY`, `STALE_BODY_DATA`. `ON_TRACK_CLASSIFICATION_DEFERRED`: không có luật tốc độ thẩm quyền; engine forecast/reconciliation hiện có dựa trên số học calo nên cố ý không dùng ở đây.

## 16. Roadmap normalization
Chỉ cột typed: roadmap `ACTIVE` (id, name, goalType, plannedStart/End) + phase đang `ACTIVE` (id, name, phaseType, ngày). `targetMetrics`/`configuration`/`objective` Json không bao giờ được đọc (test: giá trị free-form không xuất hiện trong output). `startingState`: chỉ baseline typed của **cycle ACTIVE** (`scope: ACTIVE_CYCLE_BASELINE`; Json sai dạng bị bỏ qua) — không thay bằng "latest"; không có thì `NO_ACTIVE_CYCLE`/`NO_VALID_BASELINE_SNAPSHOT`. Cũng trả `profileStartingWeightKg` (cân nặng đầu tiên từng ghi, không phải điểm bắt đầu mục tiêu).

## 17–18. CoachStateV0.body và goal expansion
```ts
CoachStateV0 = { asOf; goal?; training?; nutrition?; body? }
goal = { type?; currentTarget?; startingState?; profileStartingWeightKg?; gap?; trajectory?; roadmap?; dataQuality? }
```
`goal.type` giữ nguyên hợp đồng 4.1 (từ profile); các trường mới chỉ có khi yêu cầu `includeGoalState`. Không có placeholder sleep/HRV/recovery.

## 19. Enterprise Data integration
Endpoint fitness-service `GET /stats/body-goal-state?lookbackDays=` (authMiddleware, không tham số userId, chỉ đọc). InBody/profile đọc qua client nội bộ **bản strict mới** (`fetchInBodyHistoryStrict`, `fetchUserProfileStrict`) — bản cũ nuốt lỗi thành `[]`/null (đúng cho cycle, sai cho đọc coach). Lỗi upstream ⇒ HTTP 502 ⇒ `AuthoritativeRead.error`. ai-service: `bodyGoalReader.getBodyGoalState` (ok/absent/error + guard cấu trúc), need `BODY_GOAL_COACH_STATE`; không có reader roadmap riêng (cùng một read).

## 20. Demand-driven fetching
`getCoachStateV0` nhận `includeBody`, `includeGoalState` (mặc định false). body + goal-state dùng **một** read; `includeGoalState` bỏ qua read profile (type lấy từ chính read này). Training-only/nutrition-only không bao giờ gọi body; body-only không gọi training/nutrition.

## 21. Cross-user isolation
Identity từ token; test unit (credential B, JSON không chứa roadmapId/target của A), DB integration (A/B), smoke thật.

## 22. HTTP smoke — REAL HTTP/API
auth(3991)+user-service(3994)+fitness(3992) cục bộ trên `gymcoach_*_test`; InBody tạo qua `POST /inbody`, profile qua `PUT /profile/me`, JWT thật. Qua `getCoachStateV0({includeBody, includeGoalState})`:
| User | Kết quả |
|---|---|
| A (4 InBody + target 75) | body `SUFFICIENT`, weight `DOWN` −0,57 kg/tuần (4 điểm), gap 82→75 = +7 `MEASURED_INBODY`, quan sát −4 kg `TOWARD_TARGET`, on-track `NOT_EVALUABLE` [NO_TARGET_DATE, NO_STARTING_STATE] |
| B (1 InBody + target) | `INSUFFICIENT_HISTORY`, không có xu hướng, gap có |
| C (target, không InBody; profile 80) | body `NO_DATA`; gap 80→75 `PROFILE_REPORTED` |
| D (3 InBody, không target) | xu hướng `FLAT`, `NO_TARGET`, gap không có |
| E (trống) | `NO_DATA`, `NO_TARGET` |
| F (token sai) | `error` |
Đã dọn dữ liệu seed, tiến trình, container. (Roadmap/cycle thật được kiểm ở integration test; smoke không tạo roadmap.)

## 23. Performance
Một request: 2 HTTP nội bộ song song tới user-service (lịch sử InBody + profile) + 2 truy vấn Prisma (cycle ACTIVE, roadmap ACTIVE kèm phases). InBody là toàn lịch sử nhưng bị chặn cấu trúc ≤1 hàng/ngày/user (~365/năm); lọc lookback phía fitness-service. Chưa thêm tham số `from` cho route nội bộ user-service để không đụng service khác — ghi nhận là cải tiến sau. Smoke: ~20–150 ms/lượt (lượt đầu lạnh), ≤4 bản ghi/user. Không N+1.

## 24. Focused tests
- `fitness-service/.../body-goal-state.test.ts` 16/16 (lookback, no body, single, multiple vs engine, disagreement, gap 82/75, profile-only, no target, no target date, full input deferred, snapshot validation, body fat missing, muscle unresolved, outlier, stale, roadmap typed-only).
- `...body-goal-state.integration.test.ts` 1/1 (cycle + roadmap thật, Json tự do không rò, A/B, upstream 503 ⇒ throw).
- `ai-service/.../coach-state-body-goal.test.ts` 9/9 (reader, demand-driven, slices, trajectory pass-through, no body, upstream failure, cross-user, 0 LLM).

## 25. Regression tests (scoped)
fitness: body + nutrition + training analytics unit/integration, `cycle-metrics.engine`, `training-cycle-metrics.service`, `cycle-decision.engine`, `stats.service.integration` ⇒ 113/113. ai-service: `coach-state-*` (4.1/4.3/4.4), `training-coach-integration` (4.2), enterprise-data, assembler, CI-V2 global, unified-coach e2e, bounded-turn, revision, readers ⇒ 131/131. `tsc --noEmit` sạch cả hai service. Training-only `getCoachStateV0` không gọi body (test).

## 26. Intentional behavior changes
Không thay đổi hiển thị. Route mới `GET /stats/body-goal-state`; hai hàm strict trong `user.client.ts`; `CoachStateV0.goal.type` thành optional (chỉ kiểu). Không đụng training-coach conversation code (không sửa phiên này), không router topic/intent, không semantic schema.

## 27. Remaining gaps
- `muscleMass` chưa phân giải (cần quyết định UI/nhập liệu: tách SMM khỏi "cơ bắp" nhập tay hoặc xác nhận nhãn).
- Không có hạn chót typed cho target ⇒ on-track chưa đánh giá được; cần một trường hạn chót typed hoặc luật tốc độ có thẩm quyền.
- Không lịch sử `targetWeight`; `currentWeight` không provenance (nên thêm timestamp/nguồn nếu cần).
- Roadmap `targetMetrics` vẫn Json tự do.
- Đọc InBody toàn lịch sử (chặn ≤1/ngày) — nên có tham số `from`.
- UTC; chưa timezone người dùng. Chưa có hydration/ECW/TBW; evaluator `weightWaterConflict` vẫn no-op.

## 28. Recommended Phase 4.5
Một lớp review **mô tả, không kê đơn**: ghép slice body/goal + nutrition + training thành "bức tranh quan sát" có kiểm soát chất lượng (liệt kê tín hiệu nào đủ dữ liệu, cái nào không), trước khi có bất kỳ giải thích nhân quả nào. Song song nên giải quyết hai khoảng trống dữ liệu chặn on-track: trường hạn chót typed cho target và phân giải `muscleMass`.
