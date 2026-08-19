# FITNESS_APP_DATA_AND_FEATURE_AUDIT.md

> **Vai trò**: Senior Product Engineer + AI Fitness System Architect + Strength & Hypertrophy Coach.
> **Phạm vi**: Toàn bộ codebase `fitness-assistant` — đọc và phân tích trước, không sửa code lớn.
> **Tài liệu liên quan** (đọc kèm, không lặp lại nội dung):
> - `docs/gym-fitness-research.md` — bằng chứng khoa học nền tảng (đã hoàn thành phiên trước)
> - `docs/TRAINING_CYCLE_DECISION_ENGINE.md` — chi tiết decision engine
> - `docs/USER_LEVEL_PERSONALIZATION_PLAN.md` — chi tiết 4 nhóm người dùng
> - `docs/TRAINING_KNOWLEDGE_BASE_PLAN.md` — chi tiết nguồn dữ liệu + schema knowledge base
>
> **Không có code lớn nào được implement trong phiên này** — đây thuần tuý là phân tích + thiết kế chờ approval, đúng yêu cầu.

---

## 1. Tổng quan app hiện tại

Fitness Assistant là một hệ microservices local-first:

```
Browser (React 18 + Vite :5173)
    ↓
API Gateway (:3000) — auth, rate limit, proxy
    ├── Auth Service (:3001)      — JWT
    ├── User Service (:3004)     — Profile, InBody (+ EasyOCR)
    ├── Fitness Service (:3002)  — Exercise, Workout, Nutrition, Training Cycle
    ├── AI Service (:3003)       — Ollama + Qdrant RAG + AI Plan/Chat
    └── Chat Service (:3005)     — Socket.IO, PT chat/call

Postgres (mỗi service 1 DB) · Redis (cache/queue) · Qdrant (vector) · n8n (automation)
```

**AI approach hiện tại**: RAG (Retrieval-Augmented Generation) qua Qdrant + Ollama — **không fine-tune model**. 4 collection Qdrant: `exercises`, `fitness_knowledge`, `fitness_faq`, `fitness_evidence`. Nguyên tắc đã ghi rõ trong README: "Evidence citations should come from retrieved metadata, not from model-generated text."

**Training Cycle** (tính năng trọng tâm của các phiên làm việc gần đây): đã có **2 luồng song song** — legacy 3-quyết định (`/complete`) và Adaptive 6-quyết định (`/evaluate`, mới hơn, kiến trúc trưởng thành hơn: versioned `CycleAssessment`, 5 cổng `INSUFFICIENT_DATA`, safety flags, idempotency). Chi tiết đầy đủ ở `TRAINING_CYCLE_DECISION_ENGINE.md`.

**Dữ liệu curated đã có sẵn** (phát hiện quan trọng, không nên bỏ qua khi lên roadmap): `data/catalog/` đã chứa catalog bài tập song ngữ rất chi tiết (`gym_exercises.csv` với movement_pattern, mechanics, rep-range theo mục tiêu, contraindications...), taxonomy đầy đủ (equipment/goals/levels/movement_patterns/muscles), catalog dinh dưỡng, FAQ, và một pipeline nghiên cứu khoa học tự động (`source_registry.ts` allowlist PubMed/PMC/Crossref/OpenAlex). Đây **không phải một app khởi đầu từ số 0** — nhiều nền móng knowledge-base đã tồn tại nhưng **chưa được production schema phản ánh đầy đủ**.

---

## 2. Điểm mạnh

1. **Kiến trúc microservices rõ ràng**, tách bạch trách nhiệm (auth/user/fitness/ai/chat), mỗi service 1 DB riêng — dễ scale/maintain độc lập.
2. **Nguyên tắc "code tính, LLM chỉ giải thích, RAG chỉ dẫn chứng"** đã được thiết lập và thực thi nghiêm túc trong Adaptive Decision Engine: LLM output bị ghi đè bởi Decision Engine cho `decision`/`requiresConfirmation`; `proposedChanges` ngoài `allowedChanges` bị lọc; macro/calo được đối chiếu bằng công thức Atwater chuẩn (không tin LLM tự tính).
3. **Data-sufficiency gating đã trưởng thành** ở Adaptive flow: 5 cổng `INSUFFICIENT_DATA` độc lập, null-semantics đúng cho adherence 0/0 (không đọc thành 0% hay 100%), InBody data-quality evaluator (outlier/interval/device-consistency) có cơ sở khoa học rõ ràng (BIA reliability research).
4. **Đã có unique-ACTIVE-cycle-per-user ở mức DB constraint** (không chỉ app-level check) — chống race condition hai tab.
5. **Test coverage cho domain training-cycle khá sâu**: 170+ test ở fitness-service bao gồm unit cho từng nhánh decision engine, integration test với DB thật, test race-condition concurrency thật.
6. **Catalog dữ liệu bài tập/dinh dưỡng/taxonomy đã tồn tại, chi tiết, song ngữ** — nền tảng tốt hơn nhiều app khởi nghiệp cùng loại.
7. **Foster (1998) training monotony/strain đã implement đúng công thức gốc** trong `getCycleReport()` — không phải nhiều app thể hình làm điều này.
8. **RulerSlider** (thanh kéo cho nhập số — RPE/RIR/tạ) và **URL state cho tab/ngày** (`workout-log-url.utils.ts`, `parseInitialWorkoutLogState`) **đã được xây dựng** — không phải đề xuất mới, chỉ cần rà soát độ phủ (đã dùng ở mọi nơi nhập số liệu hay chỉ một phần?).

---

## 3. Điểm yếu

1. **Hai luồng Training Cycle song song chưa hợp nhất** — rủi ro nhầm lẫn, trùng logic, khó bảo trì lâu dài (chi tiết `TRAINING_CYCLE_DECISION_ENGINE.md` §1).
2. **Exercise model production nghèo hơn catalog CSV đã có sẵn** — bỏ phí dữ liệu contraindications/regressions/progressions/rep-range theo mục tiêu đã được biên soạn công phu (`TRAINING_KNOWLEDGE_BASE_PLAN.md` §1).
3. **Không có khái niệm "Training Block Sequence"** cho periodization nhiều pha (accumulation → peak → taper) — chỉ có `TrainingCycle` đơn lẻ. Nhóm D (vận động viên chuyên nghiệp) không thể được phục vụ đúng nếu thiếu cái này.
4. **`experienceLevel` chỉ có 4 giá trị, không phân biệt "advanced" với "professional"** — cần cờ bổ sung (`competesInSport`) thay vì mở rộng enum tuỳ tiện (xem `USER_LEVEL_PERSONALIZATION_PLAN.md` §0).
5. **Không có onboarding wizard chọn level/mục tiêu** — xác nhận qua code: không tìm thấy trang onboarding riêng trong `frontend/web/src`; việc chọn goal/experienceLevel hiện chỉ nằm trong ProfilePage (chỉnh sửa sau khi đã vào app), không phải luồng bắt buộc lúc đăng ký. Hệ quả trực tiếp: nhiều user rơi vào `experienceLevel = UNKNOWN` không cần thiết, làm giảm chất lượng cá nhân hoá ngay từ đầu.
6. **`computeGoalProgressScore()` không có nhánh cho mục tiêu `ATHLETIC_PERFORMANCE`** — trả `null`, nghĩa là vận động viên hiệu suất (không phải bodybuilding) không có tín hiệu tiến triển nào được tính — ảnh hưởng trực tiếp nhóm D.
7. **Chưa có bảng `recommendation_audit`** tách biệt khỏi `CycleAssessment` — không trả lời được câu hỏi vận hành "bao nhiêu % đề xuất DELOAD bị user từ chối?".
8. **AI recommendation engine (`recommendation_engine.ts`, 1236 dòng) có gap đã tự ghi nhận trong `PROJECT_ROADMAP.md`** (tài liệu cũ, 2026-05-10, "~60% production-ready"): thiếu routine riêng cho legs/shoulders/core (rơi vào generic fallback), không filter theo equipment của user (đề xuất barbell cho người chỉ có dumbbell ở nhà), conversation context không đọc câu trả lời AI trước đó (chỉ đọc câu hỏi user). **Chưa xác nhận các bug này đã được sửa hay còn tồn tại** — cần kiểm tra lại vì tài liệu đã cũ hơn 2 tháng so với các phiên sửa lỗi training-cycle gần đây.
9. **RAG legacy path (`cycle-analysis.service.ts`) vẫn cắt evidence 500 ký tự và bỏ metadata trích dẫn thật** trong response cuối — đã sửa ở Adaptive flow nhưng chưa đồng bộ về legacy.
10. **Không có nguồn dữ liệu giấc ngủ** trong hệ thống — người dùng yêu cầu tính "sleep/recovery" metric nhưng schema hiện tại không có field nào lưu giấc ngủ.
11. **Nutrition consistency và missed-session-count chưa được đưa vào `CycleMetricsResult`** dùng bởi Decision Engine dù đã tính sẵn ở `getCycleReport()` — quyết định KEEP/ADJUST/DELOAD hiện KHÔNG xét yếu tố dinh dưỡng.

---

## 4. Dữ liệu cần thu thập (bổ sung so với hiện có)

| Dữ liệu | Hiện trạng | Đề xuất |
|---|---|---|
| Sleep hours/quality | Không có | Field tự báo cáo tối thiểu (không tích hợp wearable ở giai đoạn đầu) |
| `competesInSport` / `peakingDate` | Không có | Thêm vào `UserProfile` để phân biệt nhóm D |
| `nutritionConsistencyScore` trong Decision Engine input | Có tính riêng, chưa đưa vào engine | Thêm field vào `CycleMetricsResult` |
| `missedSessionCount` tuyệt đối trong Decision Engine input | Tương tự | Thêm field |
| `volumeProgressionSlope` (hồi quy toàn bộ tuần, không chỉ đầu-cuối) | Chưa có | Thêm hàm tương tự `linearTrend()` đã dùng cho body composition |
| Exercise: `movement_pattern`, `mechanics`, `regressions`, `progressions`, `contraindications`, rep-range theo mục tiêu | Có trong CSV catalog, thiếu trong Prisma model production | Mở rộng `Exercise` model hoặc bảng phụ tham chiếu catalog |
| Training block role (accumulation/peak/taper) | Không có | Bảng `TrainingBlockPlan` mới |

---

## 5. Nguồn dữ liệu đề xuất

Xem chi tiết đầy đủ (kèm giấy phép, rủi ro pháp lý cụ thể) tại `TRAINING_KNOWLEDGE_BASE_PLAN.md` §2. Tóm tắt:

- **Khoa học**: PubMed/PMC/Crossref/OpenAlex (đã dùng) + bổ sung ISSN Position Stands.
- **Exercise DB**: **wger** (CC-BY-SA 4.0, dùng được) — **không dùng ExRx** (bản quyền bảo hộ chặt) — MuscleWiki chỉ nếu trả phí + không lưu trữ lại media.
- **Coach philosophy**: chỉ trích nguyên tắc công khai (FST-7, Mountain Dog, PHAT, Renaissance Periodization, Nippard, Helms) — không copy lịch trả phí, wording kiểu "lấy cảm hứng từ nguyên tắc công khai".
- **Templates**: Full Body, Upper/Lower, PPL, Bro Split, Arnold Split, Powerbuilding, Specialization/Deload/Peaking Block.

---

## 6. Schema đề xuất

Xem đầy đủ 8 schema (`exercise_catalog`, `training_methods`, `coach_principles`, `research_evidence`, `plan_templates`, `user_level_rules`, `cycle_decision_rules`, `recommendation_audit`) tại `TRAINING_KNOWLEDGE_BASE_PLAN.md` §3, mỗi record có đủ `source_type/target_level/goal/principles/constraints/contraindications/evidence_strength/citations/usage_in_app/copyright_status` đúng format người dùng yêu cầu.

---

## 7. Logic cho 4 nhóm người dùng

Xem đầy đủ tại `USER_LEVEL_PERSONALIZATION_PLAN.md`. Tóm tắt nguyên tắc cốt lõi: **không thêm enum thứ 5** — nhóm D (chuyên nghiệp) = `ADVANCED` + cờ `competesInSport`, vì khác biệt thật nằm ở mục tiêu/mức giám sát, không phải công thức tính khác nhau. Bảng so sánh 4 nhóm × (tần suất, template, độ tin cậy RPE/RIR, kỹ thuật nâng cao, deload, ngưỡng INSUFFICIENT_DATA, dashboard) có đầy đủ trong tài liệu đó.

---

## 8. Training Cycle Decision Engine

Xem đầy đủ tại `TRAINING_CYCLE_DECISION_ENGINE.md`. Điểm mấu chốt:
- Adaptive flow (6 quyết định) đã khá trưởng thành — **việc chính còn lại là hợp nhất với legacy flow**, không phải xây từ đầu.
- 3 metric người dùng yêu cầu nhưng thực sự thiếu: `nutritionConsistencyScore`, `missedSessionCount` (tuyệt đối), `volumeProgressionSlope` (hồi quy đa điểm thay vì đầu-cuối).
- Cần bảng `RecommendationAudit` riêng (khác `CycleAssessment`) để lưu lịch sử tương tác user với từng đề xuất.

---

## 9. AI/RAG Architecture

Hiện trạng (đã xác nhận qua code + `docs/ai-rag-architecture.md`):
- Ollama (`qwen3:30b-a3b-instruct-2507-q4_K_M` theo README, `llama3.2:3b` theo roadmap cũ — **cần xác minh model nào đang thực sự chạy**, có khả năng đã nâng cấp giữa hai thời điểm viết tài liệu) + Qdrant (`nomic-embed-text`).
- 4 collection tách biệt theo mục đích sử dụng (exercises cho chat, fitness_evidence cho lý luận thành phần cơ thể...) — thiết kế hợp lý, tránh exercise-chat evidence lẫn với cycle-evidence.
- Evidence citation policy đã ghi rõ: chỉ dùng metadata đã retrieve, không để model tự bịa trích dẫn.
- **Gap**: legacy cycle-analysis path cắt evidence context ở 500 ký tự và bỏ metadata trích dẫn — nên đồng bộ với Adaptive flow đã sửa đúng.
- **Đề xuất bổ sung nguồn ingest**: theo `TRAINING_KNOWLEDGE_BASE_PLAN.md`, thêm ISSN Position Stands vào `source_registry.ts` allowlist.

---

## 10. UX/UI Improvements

| Hạng mục | Hiện trạng (xác nhận qua code) | Đề xuất |
|---|---|---|
| Onboarding chọn level/mục tiêu | **Không có trang riêng** — chỉ sửa trong ProfilePage sau khi vào app | Thêm wizard 2-3 bước ngay sau đăng ký: mục tiêu → mức kinh nghiệm (có mô tả rõ từng mức để user tự đánh giá đúng, tránh rơi vào UNKNOWN) → thiết bị có sẵn |
| Nhập InBody | Có `InBodyModule.tsx` + OCR | Cần đảm bảo cảnh báo rõ điều kiện đo (đói/no, sau tập hay không) ngay tại màn nhập, không chỉ ở màn kết quả — đúng tinh thần "chuẩn hoá điều kiện đo" từ nghiên cứu BIA |
| Nhập workout log | Có, dùng RulerSlider cho số liệu | Rà soát: RulerSlider đã phủ hết các input số (tạ/RPE/RIR) hay còn ô nhập text thường sót lại? |
| Dashboard chu kỳ | Có (`TrainingCyclePage.tsx`), đã qua nhiều vòng sửa lỗi hiển thị (0/0, stale proposal...) | Thêm hiển thị theo nhóm D: block sequence, peaking countdown (phụ thuộc schema mới) |
| Progress chart | Có volume theo tuần (Recharts) | Thêm biểu đồ InBody trend đa điểm (hiện `getProgress` chỉ trả summarized inBodyQuality, chưa có raw comparable-point series để vẽ line chart thật — đã ghi nhận là "known limitation" trong doc cũ) |
| Cảnh báo thiếu dữ liệu | Có (`INSUFFICIENT_DATA`, "Chưa có dữ liệu" thay vì 0%) | Đã tốt — giữ nguyên chuẩn này khi mở rộng thêm metric mới |
| Màn AI recommendation | Có (`AdaptiveAssessmentCard`) | Cho nhóm D: cần hiển thị rõ hơn "đây chỉ là diễn giải của AI, quyết định đến từ Decision Engine" — tăng minh bạch |
| Mobile responsiveness | `apps/mobile` (Expo/React Native riêng biệt) đã bị xóa khỏi repo — app mobile chính thức giờ là bản Capacitor bọc `frontend/web` (`frontend/web/android`), dùng chung 100% code React với web | Không còn code mobile riêng để rà soát nguyên tắc data-sufficiency — Capacitor dùng chung `trainingCycles.ts` của web nên tự động thừa hưởng mọi fix đã áp dụng ở đó |
| Empty/loading/error | Đã sửa nhiều lỗi fake-empty-state trong các phiên trước | Tiếp tục áp dụng pattern này khi thêm màn hình mới (block sequence, peaking) |
| Lock ngày đã qua | Có, và đã mở rộng khoá cả ngày tương lai (`schedule-lock.util.ts`) | Đã đầy đủ |
| URL state tab/day/exercise | **Đã có** (`workout-log-url.utils.ts`) | Rà soát độ phủ — có áp dụng cho TrainingCyclePage (tab lịch sử/chu kỳ nào đang xem) chưa, hay chỉ WorkoutLogPage? |

---

## 11. Roadmap ưu tiên

### Phase 1 — Data foundation
- [ ] Mở rộng `Exercise` Prisma model để phản ánh đủ cột giá trị từ `gym_exercises.csv` (movement_pattern, mechanics, regressions/progressions, contraindications, rep-range theo mục tiêu).
- [ ] Chuẩn hoá pipeline ingest wger (CC-BY-SA) làm nguồn bulk bổ sung, không trùng lặp catalog tiếng Việt đã có.
- [ ] Thêm `nutritionConsistencyScore`, `missedSessionCount`, `volumeProgressionSlope` vào `CycleMetricsResult`.
- [ ] Thêm `competesInSport` vào UserProfile.

### Phase 2 — Training cycle engine
- [ ] Hợp nhất legacy `/complete` vào Adaptive Decision Engine (một nguồn sự thật duy nhất).
- [ ] Thêm bảng `RecommendationAudit`.
- [ ] Thêm nhánh `computeGoalProgressScore()` cho `ATHLETIC_PERFORMANCE`.
- [ ] Validator ngữ nghĩa cho `proposedChanges` (tương tự `meal-plan-validator.ts`).

### Phase 3 — Knowledge base/RAG
- [ ] Ingest `coach_principles`/`training_methods` (FST-7, Mountain Dog, PHAT, RP...) qua review thủ công bắt buộc trước khi `copyright_safe: true`.
- [ ] Thêm ISSN Position Stands vào `source_registry.ts`.
- [ ] Đồng bộ evidence-citation fix (đã làm ở Adaptive) sang legacy cycle-analysis path, hoặc xoá path cũ sau khi hợp nhất Phase 2.

### Phase 4 — Personalization
- [ ] Onboarding wizard (level/goal/equipment).
- [ ] `user_level_rules` áp dụng cho 4 nhóm (constraints kỹ thuật nâng cao theo trình độ, đã có một phần qua `experienceLevel` gating).
- [ ] Thiết kế `TrainingBlockPlan` (chuỗi block cho periodization/peaking) — phục vụ nhóm D.

### Phase 5 — Polish
- [ ] Rà soát mobile app đồng bộ nguyên tắc data-sufficiency với web.
- [ ] Biểu đồ InBody trend đa điểm thật (mở rộng `getProgress` trả comparable-point series).
- [ ] Test coverage cho 4 nhóm người dùng × 6 quyết định (ma trận đầy đủ).
- [ ] Seed/demo account cho từng nhóm (beginner/intermediate/advanced/pro) để QA thủ công dễ dàng.

---

## 12. Danh sách task cụ thể để implement (tổng hợp, tham chiếu 3 doc con)

Xem danh sách chi tiết, đã đánh số theo từng file:
- `TRAINING_CYCLE_DECISION_ENGINE.md` §6 (6 task)
- `USER_LEVEL_PERSONALIZATION_PLAN.md` mục D §"Task cụ thể còn thiếu" (3 task)
- `TRAINING_KNOWLEDGE_BASE_PLAN.md` §6 (5 hành động rủi ro pháp lý)

---

## 13. Rủi ro pháp lý/bản quyền

Tóm tắt (đầy đủ ở `TRAINING_KNOWLEDGE_BASE_PLAN.md` §6):
1. Không bulk-scrape ExRx/MuscleWiki nội dung đầy đủ.
2. wger (CC-BY-SA) dùng được, cần attribution.
3. Không gắn tên coach còn hoạt động thương mại vào tên tính năng — dùng wording "lấy cảm hứng từ nguyên tắc công khai".
4. Không quote nguyên văn sách có bán — chỉ nguyên tắc đã phổ biến công khai qua kênh miễn phí.
5. Bắt buộc review thủ công trước khi đánh dấu `copyright_safe: true`.

---

## 14. Rủi ro AI hallucination

1. **RAG evidence bị cắt/mất metadata ở legacy path** — rủi ro AI trình bày "trích dẫn" không thể verify được nguồn thật. Đã sửa ở Adaptive, chưa đồng bộ.
2. **Macro/calo do LLM tự tính** — đã có validator (`meal-plan-validator.ts`) đối chiếu và tự sửa, không tin số LLM — nguyên tắc này cần áp dụng cho MỌI số liệu định lượng mới thêm (nutrition consistency, volume slope...), không chỉ macro.
3. **`proposedChanges` của Adaptive flow chưa có validator ngữ nghĩa riêng** — rủi ro LLM đề xuất thay đổi ngoài taxonomy hợp lệ hoặc giá trị phi thực tế (vd tăng 500% volume) mà không bị chặn như macro đã được chặn.
4. **Coach principles nếu ingest tự động không qua review** — rủi ro không phải "hallucination" theo nghĩa kỹ thuật nhưng là rủi ro nội dung sai lệch/bản quyền bị coi là "AI tự bịa" dưới góc nhìn người dùng.
5. **`experienceLevel = UNKNOWN` do thiếu onboarding** — không phải hallucination trực tiếp, nhưng là nguyên nhân gốc khiến AI phải đưa ra quyết định "an toàn nhất" (không đề xuất kỹ thuật nâng cao) cho nhiều user đáng lẽ đủ điều kiện — giảm giá trị sản phẩm gián tiếp do thiếu dữ liệu đầu vào, không phải lỗi AI.

---

## 15. Test cases cần có (bổ sung so với 170+ test hiện có)

| Test case | Vì sao cần |
|---|---|
| `computeGoalProgressScore()` với goal `ATHLETIC_PERFORMANCE` trả về điểm thật, không phải `null` | Sau khi implement nhánh mới ở Phase 2 |
| Decision Engine với input `competesInSport: true` — xác nhận không dùng fallback đơn giản | Đúng yêu cầu "không dùng logic đơn giản" cho nhóm D |
| `RecommendationAudit` ghi đúng 1 record mỗi lần `/evaluate`, `userAction` cập nhật đúng khi accept/reject | Bảng mới |
| Ma trận 4 nhóm user × 6 quyết định (24 tổ hợp) — ít nhất test smoke cho mỗi ô, không chỉ với dữ liệu giả định trung tính | Đảm bảo behavior đúng theo từng nhóm, không chỉ đúng về mặt kỹ thuật chung |
| `meal-plan-validator`-style test cho `proposedChanges` validator mới | Sau khi implement |
| Onboarding wizard: user chọn level → `experienceLevel` được set đúng, không rơi về `UNKNOWN` | Sau khi implement Phase 4 |
| wger-imported exercise không trùng lặp với catalog tiếng Việt đã có (dedupe test) | Trước khi ingest bulk |
| Legacy `/complete` sau khi hợp nhất — đảm bảo API cũ (nếu còn giữ để tương thích ngược) trả kết quả nhất quán với Adaptive engine cho cùng input | Tránh regression khi hợp nhất Phase 2 |

---

## Giới hạn của báo cáo này (thành thật)

1. Phiên phân tích này **không đọc toàn bộ 1236 dòng của `recommendation_engine.ts`** hay từng dòng frontend — dựa trên đọc trọng điểm (kích thước file, cấu trúc, grep có mục tiêu) kết hợp kiến thức tích luỹ sâu về domain training-cycle từ các phiên làm việc trước trong cùng dự án.
2. **Chưa xác nhận trực tiếp** các bug ghi trong `PROJECT_ROADMAP.md` (2026-05-10) còn tồn tại hay đã được sửa ở các phiên gần đây hơn — cần một lượt kiểm tra riêng trước khi lên lịch sửa.
3. Model LLM đang chạy thực tế (`qwen3:30b...` theo README vs `llama3.2:3b` theo roadmap cũ) **chưa được xác minh trực tiếp qua container đang chạy** trong phiên này.
4. Đề xuất `TrainingBlockPlan`/peaking cho nhóm D là **thiết kế mức khái niệm**, chưa có schema Prisma cụ thể — cần một vòng thiết kế riêng trước khi implement.
