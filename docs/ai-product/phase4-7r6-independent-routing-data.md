# Phase 4.7R6 — independent routing corpus + conservative safety envelope

Tiếp nối R5 (`PHASE4_7R5_CLASSIFIER_BLOCKED`). R6 **không** thêm alias, không huấn luyện classifier mới, không tạo held-out V6, không tích hợp production, không đụng Qdrant.

Nhãn bằng chứng: `CODE AUDIT` (thiết kế, công cụ) · `TEST FIXTURE` (test đơn vị). Không có `REAL BROWSER`/`REAL HTTP/API`/`LIVE QDRANT` evaluation.

## 0. Kết quả

| Hạng mục | Verdict |
|---|---|
| Dữ liệu | **`INDEPENDENT_ANNOTATION_REQUIRED`** — chưa có nhãn của con người độc lập |
| Kiến trúc safety | **`SAFETY_ENVELOPE_DESIGN_READY`** (thiết kế + prototype inert + test; chưa đo trên dữ liệu độc lập) |
| Phase | **`PHASE4_7_STILL_PARTIAL`** |

`INDEPENDENT_ROUTING_DATA_READY` không được tuyên bố: chưa có nhãn độc lập, guideline chưa đóng băng, chưa đo agreement, chưa có split đã đóng băng.

## 1. Vì sao dừng alias / classifier

Bốn vòng từ vựng cho dev ≈ 1,0 nhưng held-out mới luôn rớt; hai họ classifier nhẹ (TF-IDF+LR, embedding+LR) có AP gần như bằng nhau trong R5 → điểm nghẽn là **độ phủ dữ liệu và nguồn nhãn**, không phải thuật toán. Thêm alias hay hàng dữ liệu tự viết sẽ biến tập độc lập thành tập tuning khác. Alias đã bị đóng băng.

## 2. Trạng thái dữ liệu R5

825 safety + 612 Programming hàng: **chỉ là dữ liệu phát triển** (seed, phân loại lỗi, hard-negative). Calibration đã được mở rộng sau khi quan sát hiệu năng calibration đầu tiên (đã ghi nhận trong R5) nên cũng là dữ liệu phát triển. Không dùng làm bằng chứng độc lập.

Giả thuyết Programming hybrid (`deterministic OR classifier`: precision 0,806 / recall 0,744) được phát hiện **sau** khi quan sát test nội bộ R5 → chỉ là **giả thuyết mới**, `PROGRAMMING_HYBRID_CANDIDATE`, chưa tích hợp; phải khai báo trước khi xem kết quả độc lập và không chỉnh ngưỡng trên test độc lập.

## 3. Giao thức dữ liệu độc lập (đã tạo)

`data/eval/query-routing-independent/`: `README.md`, `annotation_guidelines.md` (DRAFT), `writer_scenarios.md` (15 nhóm kịch bản ngữ nghĩa, không có danh sách từ khoá, không câu held-out cũ), `annotation_schema.json`, `annotation_batch_template.csv`, `adjudication_template.csv`. Nhãn safety: `NORMAL_FITNESS | GENERAL_INFORMATION_ONLY | SAFE_ABSTAIN` + thẻ phụ; nhãn Programming: `PROGRAMMING | NOT_PROGRAMMING` + domain phụ. Không có nhãn chẩn đoán/bệnh/độ nặng y khoa.

Mục tiêu khi có người gán nhãn: 400–600 câu safety (≈ 40–50% liên quan/không chắc), 300–450 câu Programming; ≥ 2 annotator độc lập + adjudication; raw agreement + Cohen's kappa; chia theo family; băm SHA256.

**Câu hỏi chính sách còn mở** (guideline mục E): đau nhẹ cục bộ cá nhân; choáng một lần sau tập nặng; ngưỡng "gần đây" của thủ thuật; kiến thức chung kèm "mình"; bệnh nền đã kiểm soát. Nếu pilot cho thấy bất đồng ở đây, phải có quyết định sản phẩm trước khi đóng băng guideline — không huấn luyện trên chính sách mâu thuẫn.

## 4. ConservativeSafetyEnvelope

`src/llm/safety-envelope.ts` — **inert**, không module production nào import (có test kiểm tra). Chỉ quyết định *có cho phép lời khuyên tập luyện cá nhân hóa hay không*; không chẩn đoán, không phân độ, không phát biểu y khoa.

- Trạng thái: `SAFE_CLEAR | SAFETY_RELEVANT | SAFETY_UNCERTAIN`. Hành động: `ALLOW_NORMAL_FITNESS | GENERAL_INFORMATION_ONLY | SAFE_ABSTAIN`.
- Đầu vào: chỉ `SafetySignalResolution` (kèm `narrative`) và cờ classifier tương lai; không đọc văn bản thô, DB, hay LLM.
- Chính sách: HIGH_RISK + cá nhân → SAFE_ABSTAIN; HIGH_RISK kiến thức chung → GENERAL_INFORMATION_ONLY; CAUTION cá nhân (không phải đáp ứng tập luyện bình thường) → GENERAL_INFORMATION_ONLY; **tín hiệu triệu chứng/sự kiện/chức năng cá nhân mà không lớp nào giải thích → SAFETY_UNCERTAIN → SAFE_ABSTAIN**; đáp ứng tập luyện bình thường và không tín hiệu → ALLOW_NORMAL_FITNESS (không áp dụng cho mọi câu cá nhân).
- Bất biến: SAFE_ABSTAIN chỉ cho phép `SAFETY_ABSTENTION`; CATALOG/PROGRAMMING/STRENGTH/HYPERTROPHY/cá nhân hóa bị chặn. GENERAL_INFORMATION_ONLY chỉ cho phép giáo dục chung.
- Classifier tương lai chỉ **leo thang**; đầu ra "normal" không bao giờ hạ một trạng thái RELEVANT/UNCERTAIN (reason `CLASSIFIER_DOWNGRADE_IGNORED`).
- Giới hạn trung thực: envelope chỉ đáng tin bằng độ phủ của tín hiệu đầu vào (symptom/event/functional signals). Câu kể cá nhân hoàn toàn không có tín hiệu nào vẫn là `SAFE_CLEAR` — đó chính là khoảng trống mà dữ liệu độc lập + (có thể) classifier phải đo. Envelope **chưa** được đo trên dữ liệu độc lập, nên `SAFETY_ENVELOPE_DESIGN_READY` nghĩa là *thiết kế/hợp đồng/test sẵn sàng*, không phải hiệu năng đã được chứng minh.

## 5. Công cụ chú thích (local, CSV)

`src/llm/query-routing-data/routing-data-tools.ts` (hàm thuần) + `src/scripts/routingAnnotationTool.ts`: `export-blind`, `annotate` (blind, resumable, annotator bút danh, timestamp, uncertain/comment), `audit` (schema, PII, trùng khớp, gần trùng Jaccard ≥ 0,8, rò rỉ so với 1.124 câu V1–V5), `agreement` (raw + Cohen's kappa); adjudication chỉ giải quyết bất đồng bằng dòng adjudication tường minh; `POLICY_AMBIGUITY` không bao giờ được chốt. Smoke test trên 3 dòng giả: PII được chặn, export chỉ còn `id,text`.

## 6. Kiểm thử

`safety-envelope-and-routing-data-4-7r6.test.ts` — 18 test (hành động envelope, bất biến SAFE_ABSTAIN, GENERAL_INFORMATION_ONLY, allow bình thường, classifier không hạ, module inert, schema, trùng/gần trùng, rò rỉ, split family, blind export, agreement, adjudication, CSV, không PII/không dòng có nhãn). Chạy lại cùng R4/R3/R5-runtime: 37/37. `tsc --noEmit` sạch. **Không** tuyên bố full-repo regression: không có code production nào bị sửa.

## 7. Trạng thái bất biến

HEAD `187745350ab147003d030d4826c430e84dfe3e59` (không commit); Qdrant 187 / 7072 / 5946 / 207; `RAG_RETRIEVAL_V2` OFF; `HELDOUT_V6_NOT_CREATED`; không classifier artifact; `training/`, `docs/ai-training/` không đổi.

## 8. Hành động tối thiểu tiếp theo

1. Chủ sản phẩm trả lời 5 câu chính sách (guideline mục E).
2. Tuyển ≥ 2 người bản ngữ độc lập: một nhóm viết câu từ `writer_scenarios.md`, một nhóm gán nhãn blind; chạy pilot nhỏ → đóng băng `ANNOTATION_GUIDELINES_V1`.
3. Chỉ sau `INDEPENDENT_ROUTING_DATA_READY` mới cân nhắc: đo envelope, đo deterministic vs classifier vs hybrid, rồi (nếu cần) đóng băng một candidate và khi đó mới tạo held-out V6.

## Addendum — Phase 4.7R6A (2026-10-11)

Năm câu hỏi chính sách mở (mục 3, guideline mục E) đã được chủ sản phẩm quyết và đóng băng thành `ANNOTATION_GUIDELINES_V1` (băm trong `ANNOTATION_GUIDELINES_V1.freeze.json`). Gói bàn giao con người (HANDOFF, 40 thẻ kịch bản pilot) đã chuẩn bị; vẫn 0 người viết / 0 annotator / 0 dòng nhãn → `INDEPENDENT_ANNOTATION_REQUIRED`. Envelope vẫn inert, được siết theo chính sách. Chi tiết: `phase4-7r6a-safety-policy-annotation-pilot.md`.
