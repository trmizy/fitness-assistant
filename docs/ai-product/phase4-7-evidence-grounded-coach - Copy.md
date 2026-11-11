# Phase 4.7 — Evidence-grounded personalized coach interpretation

Nhãn bằng chứng: `LIVE QDRANT` (held-out, đọc thật, embedding CPU) · `TEST FIXTURE` · `BACKEND INTEGRATION` (orchestrator thật + Postgres `*_test`, retrieval/model stub) · `REAL HTTP/API` (auth + user-service + fitness-service thật → `tryTurn` + Qdrant thật + RAG V2 thật + embedding CPU; **LLM = mock**). Không có `REAL BROWSER`. Không sửa `training/`, `docs/ai-training/`, semantic schema, CoachState semantics, dữ liệu Qdrant, RAG V2.

## 1. Starting architecture
CoachState (training/nutrition/body+goal) → `ProgressReviewV0` (4.5, mô tả) → RAG V2 sau `RAG_RETRIEVAL_V2` (4.6). Hai nhánh chưa gặp nhau: review cá nhân không dùng tri thức; RAG không biết dữ liệu cá nhân.

## 2. Held-out RAG gate (chạy TRƯỚC khi tích hợp)
Bộ mới `data/eval/retrieval/rag-grounding-heldout-v1.json`: 56 câu (50 trong phạm vi + 6 ngoài phạm vi), viết độc lập với bộ dev 111 câu (câu khẳng định, tiếng lóng, câu dài có ngữ cảnh, Anh–Việt lẫn lộn; không paraphrase bộ cũ). **Ngưỡng được khai báo trong file trước khi chạy**; V2 bị đóng băng (sha256 `retrieval-v2.ts` = `cb70211f…`), Qdrant không bị sửa (184/7072/5946/207 trước & sau). Chạy **một lần**, không chỉnh lại.

## 3. Held-out results (`LIVE QDRANT`)
| Chỉ số | Dev (111) | Held-out baseline | Held-out V2 | Ngưỡng đã khai báo | |
|---|---|---|---|---|---|
| topicHit@3 | 0,792 | 0,38 | **0,58** | ≥ 0,60 | ✗ (thiếu 0,02) |
| relevantCuratedEvidence@3 (sci) | 0,852 | 0,059 | **0,559** | ≥ 0,55 | ✓ |
| cải thiện so baseline | +0,667 | — | **+0,500** | ≥ +0,30 | ✓ |
| syntheticTop1 (câu cần evidence) | 0 | 0,941 | **0,059** | ≤ 0,15 | ✓ |
| duplicateRate | 0 | 0,468 | **0** | ≤ 0,05 | ✓ |
| falseSource (ngoài phạm vi) | 0 | 1,0 | **0,333** (2/6) | ≤ 0,20 | ✗ |
| emptyRetrieval (trong phạm vi) | 0,075 | 0 | **0,20** | ≤ 0,25 | ✓ |
Theo miền (V2, topicHit@3): BODY_COMPOSITION 1,0 · SUPPLEMENTS 0,8 · STRENGTH 0,75 · TECHNIQUE 0,67 · NUTRITION 0,625 · RECOVERY 0,6 · PROGRAMMING 0,5 · TERMINOLOGY 0,5 · **SAFETY 0,25 · HYPERTROPHY 0,0** (3/5 rỗng).

**Verdict: `RAG_V2_GENERALIZATION_FAIL`** (2/6 ngưỡng hụt) — `RAG_V2_GENERALIZATION_BLOCKER`. Không có "sụp đổ": V2 vẫn tốt hơn hẳn baseline và không còn synthetic ở top-1, nhưng khái quát hoá kém dev. Nguyên nhân quan sát được (không dùng để chỉnh lại): (a) glossary tiếng Anh viết tay không phủ tiếng lóng/cách nói mới ("hạ tạ chậm", "dây quấn hạn chế máu", "tạ nhẹ nhiều rep") ⇒ 10 truy vấn rỗng, đặc biệt HYPERTROPHY; (b) 11/50 trong phạm vi (22%) trả tài liệu **lạc đề** (không rỗng, không liên quan); (c) rò ngoài phạm vi: "cà phê cold brew" khớp "caffeine" (từ vựng thật), "lãi suất…" khớp tài liệu tiếng Việt chung. Kết luận: ngưỡng/glossary đã quá khớp bộ dev, như đã cảnh báo ở 4.6.

## 4. Supported personalized interpretation classes
Câu có **chỉ số cá nhân cụ thể** + **cụm "ý nghĩa/hiểu thế nào/đáng chú ý/nói lên điều gì"** + `của tôi/mình`: PROTEIN, CALORIES, BODY_FAT/BIA, WEIGHT, RPE_RIR, VOLUME, CONSISTENCY/tiến bộ.

## 5. Unsupported / not claimed
Đọc lại số liệu thuần ("protein trung bình của tôi?" → 4.5/4.3, 0 RAG); kiến thức thuần ("protein quan trọng thế nào?", "RPE là gì?" → RAG hiện có); review tổng thể ("có gì đáng chú ý trong dữ liệu?" → 4.5, không RAG); hành động/khuyến nghị ("giảm calo giúp tôi", "nên…" → proposal/HITL hiện có); an toàn/đỏ-cờ (đau, chóng mặt, tim, thoát vị… → đường bảo thủ hiện có, không dùng tri thức synthetic); "đúng tiến độ?" (4.5, `NOT_EVALUABLE`).

## 6. Routing
`READ_STATE` + `ReadTopic = "PERSONAL_INTERPRETATION"` (TypeScript-only), kiểm tra **trước** 4.5/4.2. Cần `ctx.personalInterpretation = GYMINI_UNIFIED_AI_COACH=on **và** RAG_RETRIEVAL_V2=on` (cộng `CONVERSATIONAL_INTELLIGENCE_V2=on` để `runGlobalTurn` chạy). Không đổi `SemanticInterpretationSchema`, `llm-route.ts`, ontology. Không thêm flag mới.

## 7. Personal evidence contract
`PersonalizedInterpretationContext { questionTopics, personalEvidence (EvidenceItem[] từ builder 4.5), limitations, domains{state,quality}, knowledge{items, coverage, conflict} }`. Chỉ slice mà topic cần được đọc (`readCoachStateSlices`, per-slice ok/absent/error). Không gửi set thô, log ăn, lịch sử InBody, Json roadmap.

## 8. Knowledge evidence contract
Đúng `RetrievedKnowledgeSource` + `KnowledgeContextItem` của 4.6 (class, sourceId, title, publisher, year, url, synthetic) và `conflictNote`. Một truy vấn RAG V2 duy nhất, câu truy vấn kiến thức dựng **xác định** từ topic (không phải nguyên văn câu hỏi).

## 9. Authority hierarchy
Số liệu cá nhân: CoachState (code render). Khẳng định khoa học: nguồn curated đã truy xuất (code render, kèm nguồn). Synthetic: chỉ giải thích khái niệm, không ghi đè, nhãn "không phải nghiên cứu". Mô hình không phải authority thứ ba: chỉ viết **một khối diễn giải ngắn** đã qua kiểm tra.

## 10. Knowledge coverage states
`CURATED_SUFFICIENT` (≥2 evidence) · `CURATED_PARTIAL` (1 evidence hoặc reference) · `SYNTHETIC_ONLY` · `NO_RELEVANT_KNOWLEDGE` · `CONFLICTING_EVIDENCE`. Quyết định hành vi: NO_RELEVANT ⇒ không gọi model, câu "chưa tìm thấy tài liệu phù hợp"; SYNTHETIC_ONLY ⇒ cấm khung "theo nghiên cứu"; PARTIAL ⇒ thêm cảnh báo hạn chế.

## 11–12. Scientific claim grounding & provenance
Khối kiến thức luôn do code in: `title — publisher, year [nguồn: url]` + đoạn hỗ trợ (≤260 ký tự). Câu của model bị kiểm: tên tổ chức (ACSM/ISSN/WHO/IOC/ESPEN/…) chỉ được nhắc nếu có trong nguồn truy xuất; trích dẫn kiểu `[1]` bị cấm; khung "nghiên cứu cho thấy/theo khuyến nghị" bị cấm khi không có curated. `facts.sources` trả cấu trúc nguồn (class, id, title, publisher, year, url, synthetic) ⇒ trả lời "nguồn nào?" mà không phải tìm lại.

## 13. Source conflicts
Giữ cả hai khoảng + câu "mình không chọn một con số; mức phù hợp tùy bối cảnh"; không đề xuất target mới. **Hạn chế V0 phát hiện khi test:** bộ phát hiện chỉ so khoảng `g/kg` rời nhau, nên liều theo **bữa** (0,25–0,40 g/kg/bữa) và theo **ngày** (1,4–2,0 g/kg/ngày) bị đánh dấu xung đột nhầm. Chưa sửa (V2 đóng băng); ghi vào gaps.

## 14–15. Synthetic fallback & no-source
Synthetic-only: "Trong kho kiến thức nội bộ của Gymini (không phải nghiên cứu khoa học): …". Không có nguồn: dữ kiện cá nhân vẫn trả; phần khoa học nói thẳng không có; không thay bằng bộ nhớ model. Smoke thật: câu RPE ⇒ KB không có chứng cứ RPE ⇒ "chưa tìm thấy tài liệu phù hợp".

## 16. Data-quality behaviour
Giữ nguyên câu của 4.5: phạm vi ngày có dữ liệu ("Trong các ngày có dữ liệu (10/28 ngày)…"), NO_DATA/STALE/ERROR phân biệt; slice lỗi ⇒ "chưa đọc được", slice khác vẫn diễn giải.

## 17–18. Causality & prescription boundary
Câu chốt cố định: "Đây là các quan sát cùng xuất hiện; dữ liệu hiện tại không chứng minh quan hệ nhân quả, và mình không thay đổi mục tiêu hay kế hoạch của bạn." Validator chặn nguyên nhân (`vì/nhờ/khiến/dẫn đến/làm cho/nguyên nhân/do việc…`, kiểm trên chữ có dấu), lời khuyên (`nên/hãy … giảm/tăng…`, "giảm thêm", điều chỉnh calo/lịch), "tối ưu/lý tưởng/hoàn hảo", plateau/giấc ngủ/cơ xương/SMM, "đúng tiến độ" (cho phép câu phủ định).

## 19–21. Narration, validation, fallback
Tối đa **1** `callLlmJson` (`purpose: GENERAL_QA`, `NARRATION_BUDGET`). Đầu vào: snapshot dữ kiện + ≤3 đoạn kiến thức (≤300 ký tự) + xung đột. Kiểm tra: số phải thuộc (dữ kiện ∪ văn bản kiến thức ∪ năm nguồn), nguồn, nhân quả, khuyến nghị, tối ưu, trích dẫn số, quyền uy khoa học. Hỏng/timeout/bị loại ⇒ câu diễn giải **xác định** theo topic (vẫn đủ dữ kiện + nguồn + giới hạn).

## 22–24. Demand-driven RAG, call budget, token budget
RAG chỉ chạy ở lớp này (readback, review, training readback không đụng RAG; có test). Mỗi câu: 1 truy vấn RAG + ≤1 model call; NO_RELEVANT/không dữ liệu cá nhân ⇒ 0 model call. Prompt tổng hợp (ước = ký tự/3) trên 3 fixture: **p50 1.027 / p90 1.032 / max 1.032 token** (test fail nếu >1.600).

## 25–26. Workflow continuity & isolation
Workflow "Tìm PT" chờ ngân sách ⇒ hỏi diễn giải ⇒ nhận câu trả lời + "Bạn vẫn đang tìm PT dở…"; hàng workflow giữ nguyên; không ghi profile; "2 triệu." chạy workflow đúng 1 lần. Cross-user: B không thấy 82/78/75/86 của A; RAG chỉ là tri thức toàn cục.

## 27. HTTP/tryTurn smoke — REAL HTTP/API (LLM mock)
Auth+user+fitness thật cục bộ (DB test), JWT thật, Qdrant live, RAG V2 thật (embedding CPU, `RAG_RETRIEVAL_V2=on`):
- **A protein**: dữ kiện 140 g vs 150 g (24/28 ngày) + hai nguồn curated có tiêu đề/URL (Morton 2018; một bài PubMed) + diễn giải xác định + câu nhân quả.
- **A BIA/cân nặng**: dữ kiện cân nặng + Brewer 2021 (InBody 770) với URL.
- **A RPE**: KB không có chứng cứ ⇒ nói thẳng chưa có nguồn, 0 model call.
- **C/B (thiếu dữ liệu cá nhân)**: "chưa có đủ dữ liệu cá nhân", vẫn nêu nguồn, không số cá nhân.
Quan sát cần ghi: (i) với "protein… về lịch sử thế chiến" câu truy vấn kiến thức dựng từ topic nên phần lạc đề bị bỏ qua (chấp nhận được, ghi nhận); (ii) năm của bài PubMed pipeline = 2026 (lấy từ `published_at`, có thể là ngày thu thập chứ không phải năm xuất bản) — **provenance năm chưa đáng tin cho nhóm pipeline**.
Đã dọn dữ liệu seed/tiến trình/container.

## 28. Real-model smoke
`MODEL_SMOKE_DEFERRED_DUE_TO_GPU_CONTENTION` (GPU 3667/4096 MiB bởi phiên training; chỉ embedding CPU). Mọi bài kiểm hallucination dùng narration stub; narration thật chưa được đo (unsupported numbers/sources, latency, fallback rate chưa có số).

## 29. Focused tests
`personalized-interpretation.test.ts` 15/15: phân loại (6 có / 8 không), routing + OFF parity, CURATED, demand-driven, BIA, SYNTHETIC_ONLY, NO_RELEVANT, conflict, partial coverage, partial error, cross-user, validator (10 loại hallucination), hallucination ở mức câu trả lời + fallback + timeout, token budget, `tryTurn` continuity + RAG-flag-off.

## 30. Regression (scoped, không phải full repo)
ai-service **290/290**: interpretation 4.7, rag-retrieval-v2 4.6, progress-review 4.5, coach-state 4.1/4.3/4.4, training-coach 4.2, assembler, enterprise-data, CI-V2 global + remediation, unified-coach e2e, bounded-turn, revision, phase3-r1, readers, turn-understanding, codex-*. `tsc --noEmit` sạch.

## 31. Intentional user-visible changes
Chỉ khi **cả ba** flag on (`CONVERSATIONAL_INTELLIGENCE_V2`, `GYMINI_UNIFIED_AI_COACH`, `RAG_RETRIEVAL_V2`): các câu §4 được trả lời bằng dữ kiện + nguồn + diễn giải. `RAG_RETRIEVAL_V2` vẫn mặc định OFF; OFF ⇒ router không nhận lớp này (có test), không retrieval mới.

## 32. Remaining gaps
- **`RAG_V2_GENERALIZATION_BLOCKER`**: không được bật `RAG_RETRIEVAL_V2` ở production vì held-out hụt 2/6 ngưỡng (topicHit@3 0,58; false-source 0,33; HYPERTROPHY 0/5; SAFETY 0,25). Cần thay đổi có nguyên tắc (không chỉnh ngưỡng trên bộ này) rồi đo lại bằng một bộ held-out **mới**.
- 40 chunk curated vẫn chưa ingest; năm/publisher của nhóm pipeline chưa đáng tin.
- Conflict V0 báo nhầm khoảng theo bữa vs theo ngày.
- Chưa có số đo narration thật (GPU).
- Câu hỏi có vế lạc đề không bị phát hiện (truy vấn kiến thức dựng từ topic).
- Chưa có trích dẫn trong UI; "nguồn nào?" dựa vào văn bản/`facts.sources`.

## 33. Recommended next phase
(1) Sửa **độ phủ truy vấn**, không phải ngưỡng: mở rộng/loại bỏ phụ thuộc glossary viết tay (vd. nhúng đa ngôn ngữ cho evidence, hoặc glossary có kiểm soát từ chính KB), rồi đánh giá lại bằng **held-out thứ ba**; (2) ingest 40 chunk + chuẩn hoá `published_at`/publisher; (3) chỉ khi gate qua mới bật `RAG_RETRIEVAL_V2` cho thử nghiệm có người chấm.

## Addendum — Phase 4.7R (2026-10-11)

Held-out V1 (56 câu) đã bị quan sát ⇒ nay là **Diagnostic V1**, không còn dùng cho verdict. Sau remediation (V2.1: chuẩn hoá theo khái niệm, topic guard, cổng ngoài phạm vi, conflict theo phạm vi, provenance) **held-out V2 mới (72 câu, chạy một lần)**: topicHit@3 0,787 · relevantCuratedEvidence@3 0,824 (+0,736 so với baseline) · syntheticTop1 0 · duplicate 0 · empty 0,106 · HYPERTROPHY 0,833 · safe-abstention 0,889 — **nhưng falseSource 0,313 > 0,20 ⇒ `RAG_V2_GENERALIZATION_FAIL`**. Blocker retrieval của Phase 4.7 **chưa đóng**; `RAG_RETRIEVAL_V2` vẫn OFF. Chi tiết, đính chính ("40 chunk chưa ingest" thực ra là 3), và họ lỗi còn lại: `phase4-7r-rag-generalization-remediation.md`.
