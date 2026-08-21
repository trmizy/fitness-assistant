# Training Knowledge Base Plan — Nguồn dữ liệu & Schema

> Design record. Current ingestion commands and runtime behavior are documented
> in `ai-service-operations.md` and `backend/services/ai-service/DATASETS.md`.

> Bổ sung cho `docs/gym-fitness-research.md` (bằng chứng khoa học đã thu thập) và `docs/ai-rag-architecture.md` (kiến trúc RAG hiện có). Tài liệu này tập trung vào: (1) nguồn dữ liệu công khai hợp pháp còn thiếu, (2) schema knowledge-base có cấu trúc để AI dùng nhất quán, (3) rủi ro pháp lý/bản quyền.
>
> **Không implement trong tài liệu này** — bản thiết kế chờ approval.

---

## 1. Hiện trạng đã có (xác nhận qua đọc code/data thật)

Dự án **đã có** một pipeline dữ liệu curated đáng kể — không bắt đầu từ số 0:

```
data/catalog/plans/gym_exercises.csv          — catalog bài tập song ngữ, RẤT chi tiết
data/catalog/plans/gym_workout_plans.csv      — template chương trình
data/catalog/plans/gym_workout_plan_days.csv
data/catalog/plans/gym_workout_plan_exercises.csv
data/catalog/nutrition/gym_foods.csv          — thực phẩm
data/catalog/nutrition/gym_meal_plans.csv
data/catalog/taxonomy/ref_*.csv               — equipment, goals, levels, movement_patterns, muscles
data/catalog/qa/gym_faq_qa.csv
data/research/{raw,normalized,fixtures}       — pipeline nghiên cứu khoa học (PubMed/PMC/Crossref/OpenAlex qua source_registry.ts)
```

`gym_exercises.csv` đã có các cột: `movement_pattern, primary_muscles, secondary_muscles, mechanics (compound/isolation), is_unilateral, force_type, setup, execution_steps, breathing, common_errors, regressions, progressions, contraindications, hypertrophy_rep_range, strength_rep_range, endurance_rep_range, rest_seconds_default, tempo_default` — **đã giàu hơn** những gì `Exercise` model production hiện có (`fitness-service/prisma/schema.prisma`: chỉ có `exerciseName, typeOfActivity, typeOfEquipment, bodyPart, type, muscleGroupsActivated, instructions, videoUrl`).

**Gap thật số 1**: catalog CSV giàu dữ liệu tồn tại như **tài sản ingest**, nhưng **schema production KHÔNG phản ánh đủ độ chi tiết đó** — ứng dụng thật (Exercise Prisma model, không phải Qdrant) đang bỏ phí phần lớn cột giá trị (regressions/progressions/contraindications/rep-range theo mục tiêu).

`source_registry.ts` (ai-service) đã allowlist: PubMed, PMC metadata, Crossref, OpenAlex, thủ công — đúng nguyên tắc "không bịa nguồn".

---

## 2. Nguồn dữ liệu công khai đề xuất bổ sung

### 2.1 Scientific evidence (mở rộng thêm — không thay thế pipeline hiện có)

| Nguồn | Vai trò | Truy cập |
|---|---|---|
| PubMed / PMC | Đã dùng | — |
| **ISSN (International Society of Sports Nutrition)** Position Stands | Chưa thấy trong `source_registry.ts` — nên thêm cho chủ đề protein/creatine/nutrient timing | ISSN position stands công khai, có DOI |
| **ACSM Position Stands** khác (ngoài Progression Models đã dùng) | Vd: ACSM Guidelines for Exercise Testing | acsm.org, PubMed |
| Crossref / OpenAlex | Đã dùng | — |
| Google Scholar (chỉ để tìm, không scrape hàng loạt) | Bổ trợ tìm citation, không phải nguồn ingest tự động | — |

### 2.2 Exercise database — **có xét pháp lý rõ ràng** (đã research)

| Nguồn | Giấy phép | Khuyến nghị |
|---|---|---|
| **wger** (github.com/wger-project/wger) | App: AGPL-3.0. **Exercise catalog: CC-BY-SA 4.0** (dữ liệu gốc CC-BY-SA 3.0) | ✅ **Dùng được** — cho phép mục đích thương mại, chỉ cần ghi nguồn (attribution) + chia sẻ dữ liệu phái sinh cùng giấy phép. Có REST API công khai. |
| **ExRx.net** | Bản quyền được bảo hộ và **thực thi nghiêm** — không cấp phép hàng loạt, chỉ đôi khi cho phép trích một phần nhỏ khi được hỏi trực tiếp | ❌ **Không dùng làm nguồn ingest hàng loạt** — chỉ có thể tham chiếu link công khai (không copy nội dung) |
| **MuscleWiki API** | Cấp phép có trả phí, giới hạn: chỉ hiển thị metadata (tên/mô tả/nhóm cơ/độ khó/hướng dẫn) qua API, **cấm tải video/thumbnail/bodymap về lưu trữ**, bắt buộc ghi "Powered by MuscleWiki" | ⚠️ **Chỉ dùng nếu trả phí + tuân thủ chặt điều khoản** — không phù hợp để bulk-ingest vào Qdrant tự host, chỉ phù hợp gọi API runtime nếu muốn video demo |
| NHANES (đã có `data/raw/nhanes`) | Dữ liệu chính phủ Mỹ, public domain | ✅ Đã dùng cho dữ liệu dinh dưỡng/nhân trắc học tham chiếu |

**Kết luận pháp lý cho exercise catalog**: dùng **wger làm nguồn bulk chính** để làm giàu `gym_exercises.csv`/`Exercise` model (bổ sung exercise còn thiếu, không trùng lặp với catalog tiếng Việt đã tự biên soạn), **không dùng ExRx**, MuscleWiki chỉ cân nhắc nếu ngân sách cho phép và chỉ dùng qua API (không lưu trữ lại).

### 2.3 Coach/training philosophy — CHỈ trích xuất nguyên tắc công khai (không copy lịch trả phí)

| Coach/Phương pháp | Nguyên tắc công khai có thể trích xuất | Nguồn tham khảo |
|---|---|---|
| **Mike Israetel / Renaissance Periodization** | Mesocycle 4 tuần + deload, volume-first linear progression, MEV/MRV/MAV framework | Video YouTube công khai, sách *Scientific Principles of Hypertrophy Training* (có bán, chỉ trích nguyên tắc không trích nguyên văn) |
| **Jeff Nippard** | Progressive overload có cấu trúc, deload định kỳ, "evidence-based" workflow | Video YouTube công khai |
| **Eric Helms** | Deload 4-8 tuần, autoregulation, RIR calibration | *Muscle and Strength Training Pyramid* (miễn phí ở nhiều nơi), MASS review |
| **Hany Rambod — FST-7** | Nguyên tắc công khai rộng rãi: 7 set cuối buổi, rep 8-12, nghỉ 30-45s, mục tiêu "pump"/kéo giãn fascia | Đã được viết lại bởi hàng chục trang thể hình (BarBend, Muscle & Brawn...) — **là public knowledge**, không phải lịch trả phí cụ thể |
| **John Meadows — Mountain Dog** | Cấu trúc 4 pha: pre-activation → strength/tension → pump (drop-set/rest-pause/mechanical drop-set) → (finisher) | Tương tự — nguyên tắc đã phổ biến rộng, không trích nguyên lịch tập cụ thể có bản quyền |
| **Layne Norton — PHAT** | Kết hợp power day (nặng, rep thấp) + hypertrophy day (nhẹ hơn, rep cao, volume cao) trong cùng tuần, mỗi nhóm cơ 2 lần/tuần | Nguyên tắc "Power Hypertrophy Adaptive Training" đã công khai hoá rộng rãi |
| **Arnold Split** | Chest+Back cùng ngày (siêu tổ hợp đối kháng), 6 ngày/tuần, high-volume | Tên gọi + cấu trúc đã là kiến thức phổ thông (từ sách *Encyclopedia of Modern Bodybuilding*, xuất bản 1985), không phải chương trình độc quyền còn hiệu lực bản quyền thương mại theo cách các coach hiện đại bán lịch |

**Nguyên tắc trích xuất (bắt buộc)**: chỉ lưu **method/principle/constraint** dạng tóm tắt (như ví dụ schema ở mục 3), **không** copy nguyên văn từng buổi tập/từng set cụ thể từ một cuốn ebook hay chương trình bán sẵn có bản quyền. Khi hiển thị cho user, dùng wording "lấy cảm hứng từ nguyên tắc công khai của [method]" — không tuyên bố "đây là lịch của [coach]".

### 2.4 Training templates (đã có phần trong catalog, bổ sung thêm)

| Template | Đã có trong catalog? | Bổ sung đề xuất |
|---|---|---|
| Full Body | Cần kiểm tra `gym_workout_plans.csv` | Nếu thiếu, thêm |
| Upper/Lower | — | Thêm |
| Push Pull Legs | — | Thêm (đã dùng phổ biến trong `recommendation_engine.ts` hiện tại) |
| Bro Split | — | Thêm, gắn tag `target_level: ["advanced"]` |
| Arnold Split | — | Thêm, gắn tag `target_level: ["advanced"]`, ghi rõ nguồn gốc lịch sử (Arnold Schwarzenegger, sách 1985) — không tuyên bố độc quyền |
| Powerbuilding (PHAT-inspired) | — | Thêm, `target_level: ["intermediate", "advanced"]` |
| Specialization Block | — | Thêm, gắn với `findLaggingMuscleGroups()` đã có trong code |
| Deload Block | Có khái niệm nhưng chưa phải "template" độc lập | Thêm như một `plan_template` riêng, không chỉ là tham số `%` giảm tải |
| Peaking Block | Chưa có | Thêm — cần schema mới `TrainingBlockPlan` (xem `TRAINING_CYCLE_DECISION_ENGINE.md`) |

---

## 3. Schema knowledge base đề xuất

Theo đúng format người dùng yêu cầu, đề xuất 8 "bảng" (có thể là Postgres table hoặc file JSON versioned trong `data/catalog/knowledge/` tuỳ giai đoạn — xem mục 5 cho khuyến nghị nơi lưu).

### 3.1 `exercise_catalog`
```json
{
  "exercise_id": "EX00001",
  "source_type": "curated_vi | wger_import",
  "name_vi": "Đẩy ngực phẳng với tạ đòn",
  "name_en": "Flat Barbell Bench Press",
  "target_level": ["beginner", "intermediate", "advanced"],
  "goal": ["muscle_gain", "strength"],
  "principle": "Compound horizontal push, primary chest builder",
  "constraints": ["Cẩn trọng nếu đau vai trước", "Cần spotter khi tải nặng"],
  "contraindications": ["Viêm gân vai cấp tính"],
  "evidence_strength": "n/a (kỹ thuật, không phải claim khoa học)",
  "citations": [],
  "usage_in_app": "Bài chính (compound) cho buổi Push/Upper/Chest",
  "copyright_status": "original_curated | wger_cc_by_sa"
}
```

### 3.2 `training_methods`
```json
{
  "method": "FST-7 inspired finisher",
  "source_type": "coach_public_method",
  "target_level": ["intermediate", "advanced"],
  "goal": "hypertrophy",
  "principle": "High-rep pump sets (7×8-12, nghỉ 30-45s) cuối buổi cho nhóm cơ mục tiêu",
  "constraints": [
    "Tránh cho người mới hoàn toàn",
    "Tránh khi recovery score thấp",
    "Tránh khi pain score cao"
  ],
  "usage_in_app": "Finisher tuỳ chọn cho nhóm cơ yếu (lagging muscle group)",
  "copyright_safe": true,
  "wording_rule": "Gọi là 'lấy cảm hứng từ nguyên tắc FST-7 công khai', không gọi 'lịch của Hany Rambod'"
}
```

### 3.3 `coach_principles`
```json
{
  "coach_ref": "renaissance_periodization",
  "principle": "Mesocycle 4 tuần hypertrophy + 1 tuần deload; volume-first linear progression",
  "source_type": "coach_public_content",
  "evidence_strength": "practitioner_synthesis",
  "citations": ["https://www.jtsstrength.com/mesocycle-design-for-hypertrophy/"],
  "usage_in_app": "Cơ sở cho độ dài mesocycle mặc định (28 ngày) trong Decision Engine",
  "copyright_safe": true
}
```

### 3.4 `research_evidence` (đã có phần tương đương trong `data/research/normalized` — chuẩn hoá thêm)
```json
{
  "citation_id": "morton2018",
  "source_type": "peer_reviewed_meta_analysis",
  "title": "Systematic review, meta-analysis and meta-regression of protein supplementation...",
  "source_url": "https://www.researchgate.net/publication/318368028...",
  "year": 2018,
  "evidence_strength": "high (meta-analysis, n=1863)",
  "finding": "Breakpoint ~1.62g/kg/ngày; CI 95% tới ~2.2g/kg/ngày",
  "usage_in_app": "PROTEIN_BELOW_EVIDENCE_RANGE flag trong getCycleReport()",
  "copyright_status": "public_metadata_only"
}
```

### 3.5 `plan_templates`
```json
{
  "template_id": "ppl_advanced_6day",
  "name": "Push Pull Legs nâng cao (6 ngày/tuần)",
  "target_level": ["advanced"],
  "goal": ["hypertrophy"],
  "days_per_week": 6,
  "structure_principle": "Mỗi nhóm cơ 2 lần/tuần, volume 12-20 set/nhóm cơ chính/tuần",
  "inspired_by": ["general PPL convention", "evidence-based dose-response (Schoenfeld 2017)"],
  "copyright_safe": true
}
```

### 3.6 `user_level_rules`
```json
{
  "level": "beginner",
  "max_advanced_technique_allowed": false,
  "min_days_per_week": 2,
  "max_days_per_week": 3,
  "rpe_rir_trust_weight": 0.5,
  "default_template_ids": ["full_body_beginner_3day"]
}
```

### 3.7 `cycle_decision_rules`
Tương ứng trực tiếp với `cycle-thresholds.config.ts` đã có trong code — đề xuất **đồng bộ hoá 2 chiều**: file JSON này nên là "bản sao có thể đọc được cho AI/RAG giải thích ngưỡng", còn `cycle-thresholds.config.ts` vẫn là nguồn sự thật runtime. Không tạo 2 nguồn số riêng biệt dễ lệch nhau — nếu làm, cần script đồng bộ tự động (generate JSON từ TS config lúc build), không copy tay.

### 3.8 `recommendation_audit`
Xem thiết kế đầy đủ (bảng DB, không phải JSON tĩnh) tại `TRAINING_CYCLE_DECISION_ENGINE.md` mục 4.

---

## 4. Trường bắt buộc cho MỌI record (đã áp dụng nhất quán ở trên)

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `source_type` | ✅ | `peer_reviewed_meta_analysis \| position_stand \| coach_public_method \| coach_public_content \| curated_vi \| wger_import \| user_generated` |
| `evidence_strength` | ✅ (trừ exercise kỹ thuật thuần) | `high (meta-analysis) \| moderate (single study/RCT) \| practitioner_synthesis \| anecdotal` |
| `citations`/`source_url` | ✅ nếu `source_type` là khoa học | Rỗng cho phép nếu là kỹ thuật thuần tuý (không phải claim) |
| `copyright_status`/`copyright_safe` | ✅ | Bắt buộc review thủ công trước khi `true` cho bất kỳ nội dung nào lấy cảm hứng từ coach thương mại |
| `usage_in_app` | ✅ | Bắt buộc — nếu không biết dùng ở đâu thì không nên ingest |
| `target_level`/`goal` | ✅ | Để filter đúng theo 4 nhóm người dùng |

---

## 5. Nơi lưu trữ đề xuất (theo giai đoạn)

- **Giai đoạn 1 (nhanh, ít rủi ro)**: file JSON/CSV versioned trong `data/catalog/knowledge/` — dễ review qua PR, dễ audit thủ công trước khi ingest vào Qdrant.
- **Giai đoạn 2 (khi ổn định)**: bảng Postgres riêng trong ai-service (không phải fitness-service) cho `coach_principles`/`training_methods`/`research_evidence` có versioning + `reviewedBy`/`reviewedAt` (ai đã duyệt bản ghi này là an toàn bản quyền) — **không tự động ingest nội dung coach mà chưa qua review thủ công**.

---

## 6. Rủi ro pháp lý — tóm tắt hành động

1. **Không** bulk-scrape ExRx.net hoặc MuscleWiki nội dung đầy đủ (video/hình ảnh) — vi phạm điều khoản rõ ràng.
2. **Có thể** dùng wger (CC-BY-SA) làm nguồn bulk, nhớ ghi attribution.
3. **Không** đặt tên tính năng/lịch tập gắn với tên riêng coach còn hoạt động thương mại (Hany Rambod, John Meadows đã mất — vẫn tôn trọng thương hiệu Mountain Dog Diet do người kế thừa quản lý, Layne Norton) — dùng wording "lấy cảm hứng từ nguyên tắc công khai".
4. Với sách có bán (*Scientific Principles of Hypertrophy Training*, *Muscle and Strength Training Pyramid*) — chỉ trích **nguyên tắc/kết luận đã được tác giả phổ biến công khai qua video/blog miễn phí**, không quote nguyên đoạn văn dài từ sách.
5. Cần một bước **review thủ công bắt buộc** (không tự động hoá) trước khi bất kỳ `coach_principles`/`training_methods` record nào được đánh dấu `copyright_safe: true` và đưa vào production knowledge base.
