# Phase 4.7R — RAG generalization remediation + fresh final gate

Tiếp nối Phase 4.7 (`PHASE4_7_PARTIAL`, blocker `RAG_V2_GENERALIZATION_BLOCKER`). Không phải phase tính năng mới: không đụng CoachState, không đụng `training/`, `docs/ai-training/`, `SemanticInterpretationSchema`, không huấn luyện mô hình, `RAG_RETRIEVAL_V2` **vẫn mặc định OFF**, không bắt đầu coaching thích ứng.

Nhãn bằng chứng: `LIVE QDRANT` (retrieval thật + Qdrant thật + embedding `nomic-embed-text` chạy CPU) · `TEST FIXTURE` · `BACKEND INTEGRATION` (orchestrator thật + Postgres `*_test`, retrieval/model stub) · `CODE AUDIT`. Không có `REAL BROWSER`; không chạy Qwen thật (GPU đang bận bởi phiên huấn luyện).

## 0. Kết quả

**`RAG_V2_GENERALIZATION_FAIL`** — held-out V2 mới (72 câu, chạy **một lần**) hụt **1/9** điều kiện: `falseSource` 0,313 > 0,20. Tám điều kiện còn lại đạt. Không retune sau khi thấy kết quả; mọi chỉnh sửa tiếp theo cần `heldout-v3`.

| Điều kiện (khai báo trước) | Baseline (legacy) | **V2.1 held-out V2** | Ngưỡng | |
|---|---|---|---|---|
| topicHit@3 (47 câu trong phạm vi) | 0,426 | **0,787** | ≥ 0,60 | ✓ |
| relevantCuratedEvidence@3 (câu cần evidence) | 0,088 | **0,824** | ≥ 0,55 | ✓ |
| cải thiện so với baseline | — | **+0,736** | ≥ +0,30 | ✓ |
| syntheticTop1 (câu cần evidence) | 0,853 | **0** | ≤ 0,15 | ✓ |
| duplicateRate | 0,397 | **0** | ≤ 0,05 | ✓ |
| **falseSource (16 câu ngoài phạm vi)** | 1,0 | **0,313 (5/16)** | ≤ 0,20 | **✗** |
| emptyRetrieval (trong phạm vi) | 0 | **0,106** | ≤ 0,25 | ✓ |
| HYPERTROPHY topicHit@3 (sàn khai báo trước) | — | **0,833** (n=6) | ≥ 0,50 | ✓ |
| safe-abstention success (9 câu) | 0 | **0,889** | ≥ 0,75 | ✓ |

Báo cáo không có ngưỡng: `catalogRecall@3` = 1,0 (5/5); ngữ cảnh p50/p90/max = 528/719/791 token (ước = ký tự/3; baseline max 1.224); độ trễ truy hồi p50/p90 = 67/87 ms (baseline 186/356).

## 1. Chẩn đoán: held-out V1 giờ là *diagnostic*

`rag-grounding-heldout-v1.json` đã bị quan sát ⇒ **không còn là held-out**. Tên khái niệm: `RAG_GENERALIZATION_DIAGNOSTIC_V1`. Được dùng cho phân tích lỗi/hồi quy phát triển; **không** được dùng cho verdict khái quát hoá. Kết quả lịch sử (`rag-grounding-heldout-results-2026-10-11.json`) giữ nguyên.

## 2. Phát hiện quan trọng: "40 chunk curated chưa ingest" là SAI

Phase 4.6/4.7 so khớp theo **id điểm** (`stableId(chunk.id)`) nên coi 40/83 chunk repo là "vắng". `CODE AUDIT` + `LIVE QDRANT` so khớp theo **nội dung đã chuẩn hoá** (83 chunk trong `data/processed/evidence/*.jsonl` × 184 điểm live):

| Kết quả | Số chunk |
|---|---|
| Có trong Qdrant, nội dung **trùng khít** | **80** |
| Thật sự vắng | **3** (`issn-creatine-2017-chunk-0001`, `morton-2018-protein-meta-analysis-chunk-0001`, `slater-2019-energy-surplus-hypertrophy-chunk-0001`) |
| Chunk repo có >1 điểm live trùng nội dung | 25 (khớp đúng "25 nhóm trùng") |

Pipeline cũ đã ingest các file JSONL dưới id dạng UUID/`document_id:chunk` (105 điểm mang `source_file=data/processed/evidence/…` = 80 chunk + 25 bản trùng), nên id không khớp `stableId`. Các lần truy hồi trượt ISSN/IOC trước đây là **lỗi truy hồi/ánh xạ truy vấn**, không phải thiếu nội dung.

> ⚠ `datasets/seed/ingestEvidence.ts` upsert theo `stableId(chunk.id)`: chạy lại **sẽ tạo thêm ~80 điểm trùng**. Đừng chạy lại script đó trên Qdrant hiện tại; nếu cần, dedupe theo nội dung trước (xem §7).

## 3. Bảng phân loại lỗi của Diagnostic V1 (trước khi sửa)

23 lỗi (21 câu trong phạm vi không có kết quả liên quan top-3 + 2 rò ngoài phạm vi). Nguyên nhân chính (mỗi câu một nguyên nhân):

| Nguyên nhân chính | Số | Ví dụ (id) |
|---|---|---|
| SLANG_OR_ALIAS_MISS | 8 | HN02, HP02, HP05, HP06, HH01, HH02, HH04, HZ02 |
| CURATED_CONTENT_MISSING | 6 | HR05, HZ03, HZ04, HM01, HM04, HT03 |
| QUERY_NORMALIZATION_MISS | 3 | HH03, HS02, HR02 |
| LANGUAGE_MISMATCH | 2 | HN01, HH05 |
| METADATA_QUALITY_FAILURE | 2 | HN08, HU02 |
| OOD_LEXICAL_COLLISION | 2 | HX01 (cold brew), HX03 (lãi suất) |
| CURATED_CONTENT_NOT_INGESTED / EVIDENCE_RANKING_FAILURE / WRONG_DOMAIN / CATALOG_BOUNDARY / CONFLICT_SCOPE / SYNTHETIC_FALLBACK_TOO_EARLY | 0 | — |

Theo miền: NUTRITION 3 (LANG, SLANG, META) · PROGRAMMING 3 (SLANG×3) · HYPERTROPHY 5 (SLANG×3, QNORM, LANG) · STRENGTH 1 (QNORM) · RECOVERY 2 (QNORM, CONTENT) · SUPPLEMENTS 1 (META) · SAFETY 3 (SLANG, CONTENT×2) · TERMINOLOGY 2 (CONTENT×2) · TECHNIQUE 1 (CONTENT) · OOS 2 (OOD×2).

Cơ chế gốc tìm thấy khi lần theo từng truy vấn (`LIVE QDRANT`):
1. **Vector ghép sai ngôn ngữ**: V2 nối cụm tiếng Anh vào câu tiếng Việt rồi nhúng chung ⇒ vector bị phần tiếng Việt chi phối, tài liệu tiếng Anh (ISSN protein…) không lên.
2. **Glossary 45 dòng không phủ cách nói tự nhiên** ("cơ nở", "hạ tạ chậm", "dây quấn hạn chế máu").
3. **Khớp chuỗi con** trên văn bản đã bỏ dấu: `"ngan"` khớp "ngắn", `"hang"` khớp "hàng", `"e co"` khớp trong "ph**e co**ld" ⇒ rò OOD.
4. **Mở rộng theo liên tưởng**: `cà phê → caffeine` biến công thức cold brew thành câu hỏi bổ sung caffeine.
5. **Phân loại sai nguồn**: 9 chunk "cycle_training_knowledge_2026" (tiếng Việt, `evidence_level=practitioner_consensus`, không URL) bị gán `CURATED_EVIDENCE` và thắng các bài báo tiếng Anh nhờ trùng từ tiếng Việt phổ thông.
6. **Metadata**: `published_at` của pipeline bị hiển thị như năm xuất bản; `source_name` ("PubMed E-utilities", "Curated Local Evidence JSONL") bị coi là publisher.
7. **Conflict V0** coi `0,25–0,40 g/kg/bữa` và `1,4–2,0 g/kg/ngày` là hai khuyến nghị mâu thuẫn.

## 4. Sửa bug evaluator

Mô tả "in ra `undefined`" **không tái hiện** với code lúc đó: khoá `…improvement_over_baseline_min` đọc đúng (kết quả lưu có `improvementMinRequired: 0.3`). Lỗi thật: ngưỡng cải thiện chỉ được **in ra**, chưa bao giờ được **đánh giá** (cần baseline) và không nằm trong `passAll`. Sửa: logic gate tách thành `src/llm/rag-gate.ts` (`evaluateGate`, thuần, có test) — nạp ngưỡng, đánh giá `improvement_over_baseline` khi có `--baseline=`, **fail-closed** khi thiếu baseline, thêm `domainFloors` và `safeAbstention_success_min` khai báo trước. Evaluator hiểu nhãn kỳ vọng `EVIDENCE_EXPECTED / REFERENCE_ACCEPTABLE / CATALOG_EXPECTED / SAFE_ABSTENTION_EXPECTED / NO_SOURCE_EXPECTED` (nhãn cũ `pref`/`inScope` vẫn chạy). Kết quả lịch sử không bị đổi. Test: 3 (`rag-remediation-4-7r.test.ts`).

## 5. Sửa phạm vi xung đột (conflict scope)

`rangeScope()` đọc **phạm vi thời gian** (mỗi bữa / mỗi ngày), **mẫu số** (cân nặng / khối lượng nạc) và **bối cảnh** (thâm hụt / dư calo / thường) từ chữ quanh con số. `detectRangeConflict` chỉ báo xung đột khi hai nguồn **khác nhau** có khoảng **rời nhau** và phạm vi **biết rõ và bằng nhau**. Phạm vi khác/không đọc được ⇒ **không** có `conflictNote`; thay bằng `conflictScopeUncertain` (hiển thị: "không so sánh trực tiếp các con số"), diễn giải 4.7 không vào trạng thái `CONFLICTING_EVIDENCE`. Test: theo bữa vs theo ngày; cân nặng vs khối lượng nạc; hai khoảng theo ngày/cân nặng thật sự lệch vẫn kích hoạt; phạm vi không đọc được = UNKNOWN. Hai fixture cũ dùng mẫu số FFM bị cập nhật vì hành vi đúng đã đổi (ghi ở §13).

## 6. Provenance

`resolveYear()` / `resolvePublisher()` (knowledge-source.ts). Trạng thái: `VERIFIED / SOURCE_PROVIDED / INGESTION_DERIVED / UNKNOWN`.
- `year` chỉ hiển thị khi **VERIFIED**: năm trong ngoặc của tiêu đề curated ("(Guest et al. 2021)"), hoặc `published_at` được URL/`source_file` xác nhận (ScienceDaily `/releases/2026/05/…`).
- `published_at` pipeline không có gì xác nhận (PubMed ghi ngày 1 của tháng) ⇒ `SOURCE_PROVIDED`, giữ ở `unverifiedYear`, **không** in "2026".
- ngày trùng `ingested_at/created_at` ⇒ `INGESTION_DERIVED`.
- `publisher` bỏ tên *kênh thu thập* (`PubMed E-utilities`, `Curated Local Evidence JSONL`, `… RSS`); giữ `collectedVia` để audit. Tiêu đề/URL/id vẫn dùng được.
- `evidence_level ∈ {practitioner_consensus, practitioner_synthesis, professional_source}` ⇒ `CURATED_REFERENCE`, kể cả khi `source_type=curated_summary`.

`LIVE QDRANT` kiểm tra: 7 truy vấn chủ đề của diễn giải 4.7 — năm hiển thị chỉ khi VERIFIED (Morton 2018, Brewer 2021, Hall 2011, Slater 2019…); bài PubMed pipeline không còn năm.

## 7. Inventory Qdrant trước/sau và ingest

| Collection | Trước | Sau | Ghi chú |
|---|---|---|---|
| `fitness_evidence` | 184 | **187** | +3 chunk curated (xem dưới) |
| `fitness_knowledge` | 7.072 | 7.072 | không đổi |
| `fitness_faq` | 5.946 | 5.946 | không đổi |
| `exercises` | 207 | 207 | không đổi |

Baseline phục hồi được trước khi đổi: snapshot Qdrant gốc `fitness_evidence-…-2026-10-11-02-06-56.snapshot` (sha256 `a076f91a…`) + manifest `qdrant-snapshot-pre-phase4-7r-2026-10-11.json` (id/hash nội dung từng collection, cấu hình 768-d Cosine, payload mẫu) + manifest sau `…post…ingest…json`.

**Ingest (chỉ 3 chunk curated của repo, provenance sẵn có):** id xác định `stableId(chunk.id)` (cùng sơ đồ với `ingestEvidence.ts`), payload cùng hình dạng + `ingested_at`, nhúng `nomic-embed-text` CPU; trước khi ghi kiểm tra điểm chưa tồn tại. Bỏ qua 80 chunk (trùng khít nội dung live). **Không xoá** 25 bản trùng — chưa có bằng chứng an toàn cho migrate xoá; truy hồi V2.1 dedupe lúc chạy (`dropped.duplicate`).

## 8. HYPERTROPHY và SAFETY — kết luận nguyên nhân

**HYPERTROPHY** (Diagnostic V1: 0/5): `QUERY_MAPPING_FAILURE + LANGUAGE_MISMATCH`. Nội dung curated tin cậy **có sẵn** trong Qdrant và truy hồi được: ACSM Position Stand (RT prescription, overview of reviews), *Progressive Overload Affects the Magnitude of Hypertrophy*, *How Slow Should You Go?* (tempo, meta-analysis), 3 bài BFR, 2 bài người lớn tuổi/nữ, *muscle length/ROM*, pre-exhaustion, *Skeletal muscles do not compete*… Không phải CONTENT_MISSING, không phải NOT_INGESTED. Sau sửa: Diagnostic V1 1,0 (5/5); held-out V2 0,833 (5/6). Miss còn lại là phía từ vựng: "nâng chậm hay nâng nhanh" (không có "tạ").

**SAFETY**: `MULTIPLE`. Nguồn tin cậy hiện có: IOC REDs 2023, IOC dietary supplements 2018, ISSN caffeine/creatine (an toàn), BFR-osteoarthritis gối, *visceromegaly/protein*. **Thiếu hẳn**: triệu chứng tim mạch/huyết áp, thai kỳ, cột sống/thoát vị, chấn thương cơ xương khớp, tiểu đường. Chính sách mới: với khái niệm an toàn (`safety:true`) **chỉ** bằng chứng curated có **tiêu đề** nói về tình trạng đó được trả; FAQ synthetic, tài liệu practitioner, catalog **không bao giờ** là thẩm quyền an toàn. Không tìm thấy ⇒ trả rỗng và để chính sách an toàn bảo thủ hiện có (không phải RAG) xử lý. Hệ quả có chủ đích: miền SAFETY của dev gốc (nhãn `ANY` chấp nhận synthetic) giảm topicHit 0,57 → 0,14 — đó là *chuyển từ synthetic sang abstain*, không phải hồi quy chất lượng.

## 9. Thiết kế V2.1

Module mới `src/llm/fitness-concepts.ts` (thuần, xác định, không model, không mạng):

1. **Chuẩn hoá theo khái niệm**: 67 khái niệm + 14 cue catalog (alias VN/EN đã bỏ dấu, cụm tiếng Anh để hỏi evidence, `docTerms` để kiểm tra "tài liệu có nói về khái niệm này") — bảng *khái niệm*, không phải bảng câu. Mỗi biểu mẫu khớp bắt đầu ở ranh giới từ.
2. **Không mở rộng theo liên tưởng**: từ nhập nhằng cần tín hiệu thể hình đi kèm (`cà phê` + tập/mg/liều ⇒ caffeine; một mình ⇒ không). "cold brew" ⇒ không khái niệm ⇒ **không gọi cả collection evidence**.
3. **Truy vấn tiếng Anh riêng**: mỗi khái niệm (≤3) được nhúng **một mình** và tìm trên `fitness_evidence`; bản gốc tiếng Việt dùng cho synthetic/reference. Tối đa 1 + 3 embedding/câu; câu không có khái niệm chỉ tốn 1.
4. **Topic guard**: bằng chứng/practitioner phải *nói về* ít nhất một khái niệm đã nhận diện (so khớp theo ranh giới từ). Khái niệm *từ vựng* (RIR/RPE/1RM/superset…) chỉ được hỗ trợ bởi **tiêu đề** — bài báo nhắc RPE như thang đo không phải định nghĩa.
5. **Cổng ngoài phạm vi**: không có khái niệm ⇒ không có bằng chứng; synthetic/catalog chỉ qua khi ≥2 từ nội dung khớp **cả từ** (≥60%); truy vấn có dấu thì khớp **giữ dấu** ("ngân hàng" ≠ "ngắn"). Ý định mua sắm/tin tức ("mua", "ra mắt", "giá") mà không có tín hiệu hỏi kiến thức ⇒ trả rỗng, 0 embedding, 0 search.
6. **An toàn**: như §8.
7. **Pack**: giữ chính sách theo lớp nguồn (điểm cosine **không** so xuyên collection — `CROSS_COLLECTION_SCORES_NOT_COMPARABLE` giữ nguyên); nguồn khác nhau trước, lặp chunk cùng bài chỉ để lấp quota; câu khoa học chỉ *nhắc* tên bộ phận cơ thể ưu tiên evidence trước catalog.
8. Giữ: sàn cosine theo lớp, trọng số lexical 0,35, `maxTotal 4`, dedupe Jaccard 0,82, nhãn synthetic, flag `RAG_RETRIEVAL_V2` mặc định OFF (OFF ⇒ đường legacy không đổi; có test).

## 10. Bộ dev khái quát hoá V2 (104 câu) và quy trình

`rag-grounding-generalization-dev-v2.json`: 104 câu viết **sau** khi Diagnostic V1 bị quan sát, cố ý nhắm họ lỗi (tiếng lóng, song ngữ, hypertrophy, safety, thuật ngữ, 16 câu OOD thuộc nhiều họ độc lập: đồ uống, tài chính, lập trình, du lịch, mua sắm, sức khoẻ ngoài thể hình, tiếng Anh, và truy vấn 1–3 từ). Nhãn kỳ vọng có SAFE_ABSTENTION (8 câu). Lặp thay đổi chỉ trên **dev 111 + Diagnostic V1 + dev V2**; không tạo held-out mới cho đến khi cấu hình đóng băng.

## 11. Số liệu dev trước/sau (`LIVE QDRANT`, đều là dữ liệu tuning — KHÔNG là verdict)

| Tập | Cấu hình | topicHit@3 | relevantCuratedEv@3 | synthTop1 | dup | falseSrc | empty |
|---|---|---|---|---|---|---|---|
| dev gốc (111) | baseline | 0,575 | 0,185 | 0,796 | 0,375 | 1,0 | 0 |
| | V2 (4.6) | 0,792 | 0,852 | 0 | 0 | 0 | 0,075 |
| | **V2.1** | 0,792 | 0,870 | 0,019 | 0 | 0 | 0,142 |
| Diagnostic V1 (56) | baseline | 0,38 | 0,059 | 0,941 | 0,468 | 1,0 | 0 |
| | V2 (4.7) | 0,58 | 0,559 | 0,059 | 0 | 0,333 | 0,20 |
| | **V2.1** | 0,84 | 0,941 | 0,029 | 0 | 0 | 0,08 |
| Dev V2 (104) | baseline | 0,377 | 0,057 | 0,906 | 0,419 | 1,0 | 0 |
| | **V2.1** | 0,922 | 0,943 | 0,019 | 0 | 0 | 0,026 |

Dev V2: safe-abstention 1,0 (8/8; baseline 0/8). Dev gốc: `emptyRetrieval` tăng 0,075 → 0,142 và `SAFETY` giảm — chủ yếu do chính sách an toàn mới (§8) và các từ vựng không có nội dung (superset, dropset, AMRAP, PP: KB không có định nghĩa ⇒ trả rỗng thay vì FAQ lạc đề).

## 12. Cấu hình RAG_V2_1_CANDIDATE (đóng băng) và held-out V2

`data/eval/retrieval/rag-v2-1-candidate-freeze-2026-10-11.json`: sha256 từng file (`retrieval-v2.ts` `85be2db3…`, `fitness-concepts.ts` `e71d264e…`, `knowledge-source.ts` `b33bb5d9…`), nội dung Qdrant sau ingest (id/content-set hash 4 collection), `configHash = bf19b694…`. Sau thời điểm đó **không** đổi xếp hạng/sàn/trọng số/từ điển/guard/ưu tiên nguồn/dedupe/Qdrant (đã kiểm tra lại byte-identical trước khi chạy). Chỉ module gate của *evaluator* (`rag-gate.ts`) được mở rộng (safeAbstention + domain floors) **trước** khi viết held-out V2.

`rag-grounding-heldout-v2.json`: 72 câu, tạo **sau** khi đóng băng; sha256 trước khi chạy `62475422a39cda94…` (bằng sau khi chạy). Ngưỡng + sàn miền + ngưỡng abstention khai báo trong file trước khi chạy. Cơ cấu: EVIDENCE 34 · REFERENCE 8 · CATALOG 5 · SAFE_ABSTENTION 9 · NO_SOURCE 16 (công thức, tài chính, router, lịch sử, trà, mua laptop, `curl`, `bench warrant`, `plank` gỗ, ngủ trong thời tiết nóng, kem chống nắng, vé máy bay, bơi trẻ em, SQL, set menu, trồng rau). Phong cách: tường thuật ngôi thứ nhất, từ khoá, tiếng Anh, trộn ngôn ngữ, so sánh "A hay B", nhập nhằng tiếng Anh, sức khoẻ ngoài thể hình.

## 13. Kết quả held-out V2 theo miền và lỗi (một lần, không sửa)

| Miền | n | topicHit@3 | empty |
|---|---|---|---|
| NUTRITION | 14 | 0,786 | 0 |
| SUPPLEMENTS | 4 | 1,0 | 0 |
| BODY_COMPOSITION | 4 | 0,75 | 0,25 |
| SAFETY (EVIDENCE_EXPECTED) | 3 | 0,667 | 0 |
| RECOVERY | 3 | 1,0 | 0 |
| STRENGTH | 3 | 0,667 | 0 |
| HYPERTROPHY | 6 | 0,833 | 0,167 |
| PROGRAMMING | 5 | 0,40 | 0,60 |
| EXERCISE_CATALOG | 5 | 1,0 | 0 |

**Rò ngoài phạm vi (5/16 → FAIL):** K061 *trà đào cam sả pha sao cho đậm vị* — "đậm" (đ**ậ**m) bị gấp dấu thành `dam` = "đạm" ⇒ khái niệm protein (`DIACRITIC_FOLD_COLLISION`); K063 `curl command…`, K064 `bench warrant…`, K065 *tấm plank gỗ sồi…* — tên bài tập/dụng cụ trong ngữ cảnh khác (`AMBIGUOUS_ENGLISH_TERM`, rò sang catalog/synthetic); K066 *ngủ ngon hơn khi trời nóng* — khái niệm `sleep` + nhắc "sleep" ngẫu nhiên trong tài liệu (`GENERIC_LIFESTYLE_PHRASE`). Họ lỗi mới không có trong dev (từ nhập nhằng tiếng Anh dạng lệnh/luật/vật liệu) — đúng loại held-out nhằm phát hiện.

**Miss trong phạm vi (10):** PROGRAMMING 3/5 (K021 "bài cô lập trước…", K036/K041 tiếng Việt thuần của tài liệu practitioner), K005 "phân tích trở kháng sinh học", K006 "thiếu hụt năng lượng tương đối" (từ Việt hoá của RED-S), K013, K015 "nâng chậm", K032 "dải phân bố đa chất dinh dưỡng", K037/K038 (nhãn REFERENCE_ACCEPTABLE: trả bài PA/ISSN nhưng không khớp từ khoá của nhãn). Đa số là `SLANG_OR_ALIAS_MISS`/từ Việt hoá thuật ngữ — phía từ điển, không phải ranh giới thiết kế.

**Safe-abstention 8/9:** K049 (*mang thai tháng thứ năm*) — "có thai" không có trong từ điển ⇒ không nhận ra khái niệm an toàn ⇒ trả bài tập tạ chung; vẫn nằm trong ngưỡng 0,75.

## 14. Hồi quy tích hợp Phase 4.7 (`BACKEND INTEGRATION`)

Không thiết kế lại lớp diễn giải. Chạy với retrieval V2.1 thật (qua fixture io) + Postgres test: protein (CURATED_SUFFICIENT), BIA/cân nặng (không kết luận mất mỡ), **RPE** (bài báo chỉ nhắc RPE ⇒ không phải nguồn ⇒ `NO_RELEVANT_KNOWLEDGE`, 0 model call — test mới), no-source (0 model call), partial-data/partial-service-error, an toàn (câu có cờ đỏ không bị lớp diễn giải nhận — đường bảo thủ cũ), conflict (cùng phạm vi ⇒ CONFLICTING_EVIDENCE; khác phạm vi ⇒ không), workflow tìm PT còn dang dở sống sót sau diễn giải và tiếp tục đúng 1 lần.
`LIVE QDRANT` (7 chủ đề `knowledgeQuery` của diễn giải): protein → Morton 2018 + intra-workout + 1 synthetic; BIA → Brewer 2021 + ESPEN; RPE → rỗng; calories → ISSN Diets + Hall 2011 + Slater 2019; tim mạch → rỗng. Không năm xuất bản giả.

## 15. Test

- Mới: `rag-remediation-4-7r.test.ts` **25** (gate evaluator ×3, chuẩn hoá lóng, không mở rộng liên tưởng, ranh giới từ, hypertrophy lóng → bài tempo, OOD cold brew, OOD giữ dấu, ý định mua sắm, topic guard, practitioner ≠ evidence, từ vựng chỉ qua tiêu đề, an toàn, fallback synthetic, ưu tiên nguồn, catalog sau evidence, conflict scope ×4, provenance ×3, dedupe).
- Sửa/thêm trong suite 4.6–4.7: `personalized-interpretation.test.ts` 17 (fixture FFM → cùng mẫu số; +scope differs; +RPE no-source); `rag-retrieval-v2.test.ts` 15 (fixture conflict dùng cùng phạm vi).
- Hồi quy có phạm vi (không phải full repo): **475/475, 0 skipped** (ai-service: interpretation 4.7, RAG V2 4.6, remediation 4.7R, progress-review, coach-state ×3, training-coach, context-assembler, enterprise-data, CI-V2 global/remediation/v2, phase3-r1, readers, turn-understanding ×2, bounded-turn ×3, revision-route-parity, retriever_scope, codex ×3, llm bugfix + narrator). `tsc --noEmit` sạch. DB: isolated `gymcoach_ai_test` @55433, `FITNESS_DISABLE_REDIS=true`.

## 16. Khoảng trống còn lại

1. **Không bật `RAG_RETRIEVAL_V2`** — gate khái quát hoá chưa qua (falseSource 0,313).
2. Từ vựng nhập nhằng ngoài phạm vi (`curl`, `bench`, `plank` gỗ) cần tín hiệu ngữ cảnh *tích cực* (ví dụ tên bài tập chỉ tính khi có động từ/ngữ cảnh luyện tập) và cổng gấp-dấu cho `đậm/đạm`; từ điển cần phủ từ Việt hoá thuật ngữ (RED-S, tempo, BIA). Cần `heldout-v3` sau khi sửa.
3. Nội dung thiếu thật: tim mạch, huyết áp, thai kỳ, cột sống/thoát vị, định nghĩa RIR/RPE/superset/dropset/AMRAP/PP, BMI, hít thở khi nâng, kỹ thuật chi tiết (tư thế khuỷu tay).
4. 25 điểm trùng chưa dọn (chỉ dedupe lúc truy hồi). Chunk pipeline thiếu `source_name`/năm đáng tin; `published_at` PubMed chưa xác nhận.
5. `ingestEvidence.ts` không idempotent đối với dữ liệu live hiện có (xem §2).
6. Chưa chạy model thật (Qwen) và flag-on HTTP/gateway — việc của rollout, không thuộc phạm vi này.
7. Từ điển khái niệm do người viết: dev V2 đạt 0,92 vì được tuning trên nó; con số held-out (0,787) mới là ước lượng trung thực.

## 17. Rollout vẫn tách riêng

Dù held-out qua, chưa bật mặc định: còn cần smoke Qwen thật khi GPU rảnh, kiểm tra hành vi nguồn/claim, và xác minh flag-on qua HTTP/gateway.
