# Phase 4.6 — Knowledge / RAG grounding + retrieval hardening

Nhãn bằng chứng: `LIVE QDRANT` (đọc/tìm kiếm thật trên `gymcoach-qdrant` đang chạy, localhost:6333, không ghi) · `TEST FIXTURE` · `CODE AUDIT`. Embedding chạy **CPU-only** (Ollama `nomic-embed-text`, `options.num_gpu=0`; `ollama ps` = 100% CPU, VRAM không đổi) vì GPU đang bận training. Không có LLM generation, không đổi CoachState, không đổi semantic schema. Bộ đo + số liệu thô: `data/eval/retrieval/rag-grounding-eval-v1.json`, `rag-grounding-results-2026-10-11.json`; script: `src/scripts/evaluateRagGrounding.ts`.

## 1. Starting architecture
`retriever.retrieveForChat`: tối đa ~4 biến thể truy vấn → embed → tìm **song song 4 collection** (`exercises`, `fitness_knowledge`, `fitness_faq`, `fitness_evidence`) mỗi collection top-5 → loại < 0,35 → gộp, sort theo cosine thô → top-5 → `compactRetrieval` (≤3 doc thường + ≤3 evidence). Không rerank/hybrid/domain filter; chỉ evidence mang `source_url`.

## 2. Live Qdrant inventory (`LIVE QDRANT`)
| Collection | Points | Vector | Payload (thật) | Ghi chú |
|---|---|---|---|---|
| `fitness_evidence` | **184** | 768, Cosine | title, source_type, category, content, source_url, evidence_level, tags, chunk_id, document_id, source_name, trust/quality_score, language… | 43 từ JSONL curated (`external_evidence_dataset`), 137 từ pipeline PubMed/web (`knowledge_update_pipeline`), 4 phương pháp coach |
| `fitness_knowledge` | 7.072 | 768, Cosine | `docId, titleVi, contentVi, category, tags` | **không** có cờ synthetic/nguồn |
| `fitness_faq` | 5.946 | 768, Cosine | `faqId, questionVi, answerVi, category, tags` | idem |
| `exercises` | 207 | 768, Cosine | `exerciseName, typeOfActivity, typeOfEquipment, bodyPart, type, muscleGroupsActivated, instructions` | tiếng Anh |
Không có payload index nào (`payload_schema = {}`); filter bằng payload là quét.

## 3. Collection semantics → source class
`CURATED_EVIDENCE` (paper / position stand / guideline: 120 curated_summary + 57 paper − 4 method…) · `CURATED_REFERENCE` (4 phương pháp coach `training_methods_manual_dataset`, web/unknown-level) · `SYNTHETIC_KNOWLEDGE` (`fitness_knowledge`, `fitness_faq`; CSV nguồn ghi `source_group=synthetic_knowledge`, đã kiểm hàng mẫu: câu hỏi tổ hợp mẫu, có cả tổ hợp vô nghĩa như "protein … cải thiện tư thế") · `CATALOG` (`exercises`). Phân loại dựa trên ingestion + payload (`classifySource`), không chỉ tên collection.

## 4. Drift repo ↔ Qdrant
- Audit nói "83 chunk"; live có **184**: 137 điểm từ pipeline mà JSONL repo không có.
- **40/83 chunk curated trong `data/processed/evidence/` KHÔNG có trong Qdrant** (id vắng; 20 file × 2 chunk: ISSN creatine/caffeine/timing, ACSM 2016, IOC supplements/RED-S, WHO…). Tiêu đề trùng nhờ bản pipeline khác nội dung nên nhìn bề ngoài tưởng đủ. Hệ quả đo được: nhiều truy vấn supplements/RED-S trả bài PubMed thay vì tóm tắt ISSN/IOC.
- Trùng nội dung trong `fitness_evidence`: **25 nhóm / 50 điểm**.
- Không sửa dữ liệu trong phase này (chỉ báo cáo).

## 5. Embedding / vector compatibility
Cả 4 collection: `nomic-embed-text` (Ollama) 768-d, Cosine; truy vấn và tài liệu đều **không prefix** (`inputType` bị Ollama bỏ qua). Cùng mô hình + metric ⇒ cùng *thang*, nhưng không cùng *phân phối*.

## 6. Score comparability — **`CROSS_COLLECTION_SCORES_NOT_COMPARABLE`**
Trên 111 truy vấn thật: điểm trung vị của tài liệu **liên quan** = **0,797** (synthetic, tiếng Việt, ngắn) vs **0,715** (evidence, tiếng Anh, dài). Evidence liên quan thua synthetic liên quan hệ thống ⇒ so điểm thô xuyên collection ưu tiên ngôn ngữ/độ dài, không phải độ tin cậy. Ngưỡng `MIN_SCORE=0,35` không bao giờ kích hoạt (điểm thấp nhất quan sát 0,55; truy vấn ngoài phạm vi vẫn trả 5 doc).

## 7. Retrieval baseline (current, flag OFF; 111 truy vấn, 106 trong phạm vi)
| Chỉ số | Baseline |
|---|---|
| topicHit@1 / @3 | 0,528 / 0,575 |
| curatedEvidence@1 / @3 (câu khoa học, n=54) | **0,204 / 0,204** |
| relevantCuratedEvidence@3 | 0,185 |
| syntheticTop1Rate (câu cần evidence) | **0,796** (toàn bộ 0,868) |
| duplicateRate (tài liệu trùng ≥0,9 Jaccard) | **0,375** (208/555) |
| falseSourceRate (ngoài phạm vi) | **1,0** (5/5 vẫn trả 5 doc) |
| catalog recall@3 (câu catalog) | 0 |
| ctx tokens (ước = ký tự/3) p50/p90/max | 349 / 610 / 1.393 |

## 8. Failure taxonomy (baseline, câu khoa học n=54 + rà thủ công ≥20 truy vấn)
| Nhóm | n |
|---|---|
| WRONG_DOMAIN (synthetic lạc đề: "sữa tươi" cho InBody, "RPE" cho RED-S…) | 25 |
| NO_CURATED_EVIDENCE_RETRIEVED (synthetic liên quan chiếm hết slot) | 18 |
| OK (evidence liên quan ở top-1) | 10 |
| WRONG_DOMAIN (evidence lạc đề) | 1 |
Kèm: DUPLICATE_CHUNKS (FAQ vs knowledge cùng đáp án, 37,5%), SCORE_COMPARISON_ARTIFACT (§6), LANGUAGE_MISMATCH (truy vấn Việt vs evidence Anh), CATALOG_MIXED (catalog đẩy bài sai, vd "push up dùng dụng cụ gì" → Resistance Band Deadlift), NO_RELEVANT_SOURCE (superset/dropset/AMRAP/mang thai/huyết áp không có trong KB nhưng vẫn trả doc).

## 9. Evaluation set
111 câu (106 trong phạm vi + 5 ngoài phạm vi): PROGRAMMING 10, HYPERTROPHY 9, STRENGTH 6, TECHNIQUE 8, NUTRITION 20, BODY_COMPOSITION 11, RECOVERY 8, SUPPLEMENTS 10, SAFETY 7, TERMINOLOGY 9, EXERCISE_CATALOG 8, + câu Anh/Việt hỗn hợp/viết tắt. Gold: domain, lớp nguồn ưu tiên, từ khoá khái niệm, `noSynth`. Mức "liên quan" = có từ khoá (không dấu) — **proxy**, không phải đánh giá người; có rà thủ công bổ sung. Hạn chế: bộ này vừa dùng để chỉnh ngưỡng vừa để đo ⇒ lạc quan; chưa có held-out.

## 10. Source-class policy (V2)
Câu khoa học: `CURATED_EVIDENCE` (≤3) → `CURATED_REFERENCE` (≤1) → `SYNTHETIC` (≤2, **co còn 1** khi đã có ≥2 evidence mạnh) → `CATALOG` loại. Câu catalog/technique: `CATALOG` → `SYNTHETIC` → evidence. Tổng ≤ 4. Synthetic vẫn là fallback, luôn gắn nhãn.

## 11. Domain policy
`inferDomains` (từ khoá xác định, đa miền/không miền được phép; không gọi LLM). Dùng để: chỉ tìm `exercises` khi miền catalog/technique; chọn thứ tự lớp; siết cổng liên quan (câu không có miền nào phải khớp ≥60% từ, câu có miền ≥50%). **Không** lọc cứng theo `category`: `category` của synthetic quá thô ("concepts" 2.250 hàng) và của pipeline nhiễu; metadata không đủ để lọc thật ⇒ ghi nhận là khoảng trống metadata.

## 12. Ranking / merge policy
Không so điểm thô xuyên lớp. Mỗi ứng viên: sàn cosine **theo lớp** (evidence 0,55; reference 0,60; synthetic 0,62; catalog 0,58) + cổng từ vựng (từ của người dùng, hoặc ≥2 từ glossary Anh cho nguồn tiếng Anh) → xếp **trong lớp** theo `0,65·cosine + 0,35·lexical`. Evidence được thêm một truy vấn mở rộng tiếng Anh bằng glossary xác định (~45 quy tắc). Không có reranker/cross-encoder mới; không phụ thuộc GPU.

## 13. Dedup
Khoá = **phần thân** đoạn (bỏ header evidence, "Title:/Q:", nửa câu hỏi của FAQ) → Jaccard ≥ 0,82 trên từ >3 ký tự; giữ lớp có thẩm quyền cao hơn rồi điểm cao hơn. Đoạn khác nhau không bị gộp (test).

## 14. Chunk-context findings (`fitness_evidence` live)
`section/heading`: **0/184** có. Chunk >0 của tài liệu nhiều chunk: 32/103 bắt đầu giữa câu (chữ thường/ngoặc). Chunk p50 530 / p90 1.125 / max 1.196 ký tự. Tiêu đề tài liệu có trong payload (và V2 đưa vào ngữ cảnh) nên đoạn cắt giữa câu vẫn biết thuộc nguồn nào, nhưng không biết mục/quần thể. Không đổi chunking ở phase này.

## 15. Provenance contract
`RetrievedKnowledgeSource { sourceClass, sourceId, title, publisher, year, url, section, synthetic, evidenceLevel }` gắn vào `doc.metadata.knowledgeSource`. Evidence: sourceId từ `document_id | method_id | chunk_id`, publisher từ `source_name` (có ở nhóm pipeline), year từ `published_at`/tiêu đề, URL chỉ nhận `http(s)`. Live: **100%** chunk curated evidence trả về có title + (url|id).

## 16. Synthetic-content policy
`synthetic: true` theo collection; hiển thị "Tài liệu tham khảo nội bộ của Gymini — KHÔNG phải nghiên cứu khoa học, không trích dẫn như bằng chứng". Không lọt vào khối "Bằng chứng khoa học". Câu chỉ có synthetic ⇒ vẫn có fallback nhưng nhãn không đổi (test).

## 17. Citation readiness
`buildKnowledgeContext` → `{claimSupportText, source, relevance PRIMARY|SECONDARY, domain}`; `renderKnowledgeContext` in `title — publisher, year [nguồn: url]`. Đủ để trả lời "nguồn nào?" cho evidence; synthetic/catalog không có citation (đúng). Không có số trang (không bịa).

## 18. Conflict policy V0
Hẹp và xác định: hai nguồn **khác nhau** cùng là evidence curated có khoảng `a–b g/kg` **rời nhau** ⇒ giữ cả hai, đặt `conflictNote`, ngữ cảnh ghi "nêu cả hai kèm bối cảnh, không tự chọn một". Live: kích hoạt ở N01, N10, C01, C02, C07 (ISSN 1,4–2,0 vs 2,3–3,1 g/kg khi hạn chế năng lượng). Không có luật "mới hơn thắng"; recency không dùng (metadata không chứng minh quan hệ phiên bản).

## 19. RAG V2 implementation
- `llm/knowledge-source.ts` (lớp nguồn, provenance, context contract), `llm/retrieval-v2.ts` (thuật toán), `retriever.ts` (flag + seam `retrieverDeps.embed`), `prompt_builder.ts` (render có nhãn khi doc có `knowledgeSource`; đường legacy giữ nguyên).
- **Flag:** `RAG_RETRIEVAL_V2=on` (mặc định OFF). Lý do cần flag riêng: thay đổi vật chất kết quả RAG production; không có flag hiện hữu phù hợp (`CONVERSATIONAL_INTELLIGENCE_V2` là routing). OFF = byte-identical (đường code cũ không đổi; 3 điểm gọi embed chỉ đi qua seam mặc định `llmService`).

## 20. Baseline → V2
| Chỉ số | Baseline | V2 |
|---|---|---|
| topicHit@1 | 0,528 | **0,679** |
| topicHit@3 | 0,575 | **0,792** |
| curatedEvidence@1 (sci) | 0,204 | **0,944** |
| relevantCuratedEvidence@1 / @3 | 0,185 / 0,185 | **0,778 / 0,852** |
| syntheticTop1 (câu cần evidence) | 0,796 | **0,000** |
| duplicateRate | 0,375 | **0** |
| falseSourceRate (ngoài phạm vi) | 1,0 | **0** |
| emptyRetrieval (trong phạm vi) | 0 | 0,075 (8/106) |
| catalog recall@3 | 0 | 0,333 |
| provenance completeness (evidence) | 1,0 | 1,0 |
| avg docs trả về | 5 | 2,95 |
| ctx tokens p50 / p90 / max (ước) | 349 / 610 / 1.393 | 554 / 710 / 793 |
**Đánh đổi thẳng thắn:** p50 ngữ cảnh *tăng* (đoạn evidence dài hơn FAQ ngắn) nhưng max giảm gần một nửa; recall mất ở T08, Z03, Z07 (câu SAFETY — baseline "liên quan" phần lớn do khớp từ ngẫu nhiên); 8 câu trả rỗng đúng nghĩa KB (superset/dropset/AMRAP, "bằng chứng tốt cho supplement", khám bác sĩ…) mà baseline từng trả doc lạc đề.

## 21. Per-domain (V2: topicHit@3 / relevantEvidence@3 / syntheticTop1 / empty)
PROGRAMMING 0,80/0,60/0/0,10 · HYPERTROPHY 0,78/0,78/0/0,11 · STRENGTH 0,67/0,50/0/0 · TECHNIQUE 0,88/0,13/0,25/0,13 · NUTRITION **0,95/0,95/0/0** · BODY_COMPOSITION **0,91/0,91/0/0** · RECOVERY 0,75/0,50/0,13/0 · SUPPLEMENTS 0,90/0,80/0/0,10 · SAFETY **0,43/0,29**/0/0,14 · TERMINOLOGY **0,56/0,22**/0,33/0,33 · EXERCISE_CATALOG 0,75/0/0,75/0. (Baseline mọi miền: syntheticTop1 0,44–1,0; relevantEvidence@3 ≤0,44.)

## 22. Real Qdrant smoke
Toàn bộ số liệu trên là truy vấn thật vào Qdrant live + embedding thật (CPU), không dùng dữ liệu người dùng. Môi trường: Qdrant (docker, 4 collection), Ollama `nomic-embed-text` CPU, retriever thật qua `retrieveForChat` với flag bật/tắt.

## 23. Performance
Retrieval (cache embed ấm) p50/p90: baseline 66/84 ms, V2 64/73 ms. Chi phí thật thêm của V2: **1 embedding bổ sung** cho truy vấn mở rộng (CPU ~0,2 s/lần sau khi model đã nạp; lần đầu nạp model ~7 s) và 1–2 tìm kiếm evidence; không quét toàn collection, không model mới.

## 24. Focused tests
`ai-service/src/__tests__/rag-retrieval-v2.test.ts` 15/15 (fixture đúng dạng payload live): phân loại lớp, provenance, domain, dedup (+không gộp đoạn khác), evidence-ưu-tiên dù cosine thấp hơn, synthetic-only có nhãn, no-source, catalog chỉ khi cần + nhãn, sàn theo lớp, giới hạn ngữ cảnh, conflict (+không báo khi chồng lấn), citation, off-mode.

## 25. Regression (scoped, không phải full repo)
ai-service 476/481 pass (4 skip theo cổng DB, **1 fail đã biết từ Phase 4.2**: `agent-workflow-create-workout-plan` regex `/8 b[aÃ ]i/` lỗi mã hoá trong chính test). Gồm 26 file RAG/knowledge/prompt + progress-review 4.5, coach-state 4.1/4.3/4.4, training-coach 4.2, assembler, enterprise-data, CI-V2 global, unified-coach. Các route CoachState cá nhân **không** gọi RAG (không đổi). `tsc --noEmit` sạch.

## 26. Remaining KB gaps (đo được)
- 40 chunk curated chưa nằm trong Qdrant (supplements/IOC/WHO/ISSN timing…) — cần ingest lại; tác động lớn nhất lên SUPPLEMENTS/RECOVERY/SAFETY.
- SAFETY (0,43) và TERMINOLOGY (0,56): gần như chỉ có synthetic; superset/dropset/AMRAP/RIR không có nguồn.
- Không có evidence tiếng Việt cho tăng cơ/volume cụ thể (PROGRAMMING chỉ 0,60).
- `fitness_evidence`: 25 nhóm trùng; 100% không có section/heading; 47 điểm thiếu `language`.
- `fitness_knowledge/faq`: không có cờ synthetic hay nguồn trong payload (hiện suy ra theo collection).
- Catalog tiếng Anh vs truy vấn tiếng Việt: recall catalog thấp; thông tin kỹ thuật chủ yếu đến từ hàng synthetic dẫn xuất.
- Ngưỡng V2 hiệu chỉnh trên chính bộ đánh giá.

## 27. Recommended Phase 4.7
(1) Ingest lại 40 chunk curated + loại 25 nhóm trùng + gắn `synthetic=true`/`language`/`publisher` vào payload (sửa dữ liệu, có thể kiểm chứng bằng chính bộ đo này). (2) Bật V2 sau flag ở môi trường thử, so A/B có người chấm 30 câu. (3) Chỉ sau đó mới nối `RAG + CoachState` cho câu cá nhân hoá, vẫn không nhân quả/kê đơn.
