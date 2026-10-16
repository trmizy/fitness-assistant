# Phase 4.7R5 — calibrated query classifiers (safety backstop + Programming fallback)

Tiếp nối 4.7R4 (V5: safety recall 0,808 / HIGH 0,632, PROGRAMMING 0,308, 3 unsafe + 3 personal fallthrough). R5 thay hai quyết định từ vựng còn lại bằng **hai bộ định tuyến nhỏ chạy CPU** (chỉ là router: không chẩn đoán, không kê đơn, không chọn nguồn, không đổi trạng thái). Qdrant đóng băng; không đổi ranking/trọng số retrieval; `RAG_RETRIEVAL_V2` vẫn OFF; không cờ production mới.

Nhãn bằng chứng: `TEST FIXTURE` (dữ liệu tổng hợp, kiểm tra nội bộ) · `CODE AUDIT`. Không có `REAL BROWSER` / `REAL HTTP/API` / `LIVE QDRANT` evaluation nào trong R5 vì không có gì được tích hợp.

## 0. Kết quả

**`CLASSIFIER_CANDIDATE_NOT_READY` → `PHASE4_7R5_CLASSIFIER_BLOCKED`.** Cả hai bộ phân loại **trượt bài kiểm tra nội bộ** (chạy đúng một lần, mục tiêu khai báo trước). Theo quy tắc phase: dừng; **không** tích hợp vào `retrieveV2`, **không** đóng băng `RAG_V2_5_CANDIDATE`, **không** tạo held-out V6, **không** chạy đánh giá RAG.

| Router | Mục tiêu (khai báo trước) | Classifier đơn lẻ | V2.4 deterministic | Deterministic OR classifier |
|---|---|---|---|---|
| Safety (n=120, 64 dương) | recall ≥ 0,95 và FP ≤ 0,08 | recall **0,750**, FP **0,143** (FAIL) | recall 0,656, FP 0,143 | recall 0,922, FP 0,214 |
| Programming (n=87, 39 dương) | precision ≥ 0,80 và recall ≥ 0,70 | precision 0,833, recall **0,641** (FAIL) | precision 0,905, recall 0,487 | precision 0,806, recall 0,744 |

Ghi chú diễn giải (không thay đổi kết luận): classifier **tốt hơn** deterministic V2.4 trên recall ở cả hai tác vụ, và "deterministic OR classifier" vượt ngưỡng recall của Programming — nhưng mục tiêu đã khai báo áp dụng cho classifier đơn lẻ và Safety không đạt dưới cả ba cấu hình. Không hạ ngưỡng sau khi thấy kết quả.

## 1. Dữ liệu

`data/eval/query-classifiers/` — tổng hợp, viết tay, đã khử định danh, **không** có hội thoại/log người dùng thật; không sao chép câu V1–V5.

| Tác vụ | Tệp | Mẫu sau lọc rò rỉ | Chia theo **họ mẫu** (family) 70/15/15 |
|---|---|---|---|
| Safety | `personal-safety-families-v1{,b,c}.json` | 581 train / 124 calibration / 120 test = 825 | không trùng family giữa các split (kiểm tra bằng assert) |
| Programming | `programming-families-v1{,b,c}.json` | 430 train / 95 calibration / 87 test = 612 | như trên |

- Rò rỉ: so khớp chuẩn hóa (bỏ dấu) với 1.124 câu dev/held-out V1–V5; trùng khớp hoàn toàn hoặc Jaccard ≥ 0,8 bị **loại** khỏi tập (danh sách `droppedForLeakage` trong manifest của bộ train).
- Manifest chia tách: `familyIdsHash`/`textHash` mỗi split ghi trong `train-report` (scratch) và trong `internal-test-result.json` có SHA256 của `predeclared-targets.json` (`0f08ef00…9054`).
- **Trung thực về quy trình:** bản đầu (v1+v1b: 632/444 mẫu) cho calibration FP 0,40 ở recall 0,97 → chẩn đoán lỗi trên **split calibration** (không phải test) cho thấy dữ liệu quá ít, nên đã thêm họ mẫu `v1c` **trước** khi chấm test. Chẩn đoán chỉ chỉ ra *lớp* thiếu độ phủ; không chép câu calibration. Việc này làm calibration không còn hoàn toàn "chưa nhìn thấy" — đã ghi nhận; test split chưa từng được chấm trước lần chạy duy nhất.

## 2. Mô hình (≤ 2 họ, cấu hình cố định, không sweep)

- (a) embedding `nomic-embed-text` đóng băng 768-d (chuẩn hóa L2) + logistic regression;
- (b) TF-IDF (từ 1–2-gram + char 3–4-gram trên từ đã bỏ dấu, minDf 2, tối đa 6.000 đặc trưng) + logistic regression.
- Huấn luyện: Adam, lr 0,05, 600 epoch, L2 0,005, class weight cân bằng; hiệu chuẩn Platt trên split calibration; ngưỡng chọn trên calibration bằng cách tối đa hóa **biên xấu nhất** so với mục tiêu khai báo.
- Chọn mô hình: average-precision trên calibration (hòa → log-loss thấp hơn). Safety → TF-IDF, Programming → embedding (AP gần nhau: 0,867 vs 0,866).
- `trainConfigHash` được ghi trong báo cáo; **không có artifact nào được ghi vào `src/llm/query-classifiers/artifacts/`** (thư mục trống) vì test trượt.

## 3. Lỗi trên test nội bộ (chẩn đoán, không dùng để chỉnh)

- Safety — FN: hậu phẫu gián tiếp (4), mang thai (3), khó thở (3), chảy máu/GI (2), tương tác thuốc (2), bệnh nền nêu tên (2); FP: ẩn dụ (5), DOMS (2), cứng cơ (1).
- Programming — FN: overload (4), frequency (3), load (2), program_mixed (3), order/structure; FP: nutrition (2), recovery, general_health, cardio_info.

Kết luận kỹ thuật: với ~600–800 câu tổng hợp, bộ phân loại lexical/embedding nhỏ không đạt đồng thời recall ≥ 0,95 và FP ≤ 0,08 trên các **họ mẫu chưa thấy**; hai họ đặc trưng (TF-IDF và embedding) có AP tương đương nhau, tức giới hạn nằm ở **độ phủ dữ liệu**, không ở lựa chọn thuật toán. Lưu ý thêm: classifier dựa embedding gắn với provider (`nomic-embed-text` 768-d); retrieval production có thể dùng provider khác (1024-d), nên runtime phải kiểm tra số chiều và rơi về deterministic.

## 4. Mã được thêm (không nối vào đường production)

- `src/llm/query-classifiers/classifier-runtime.ts` — suy luận TS thuần từ artifact JSON (validate, Platt, ngưỡng, bucket điểm, telemetry không chứa văn bản thô); mọi lỗi → `null` để caller dùng deterministic. **Chưa được `retrieveV2` hay `personalized-interpretation` gọi.**
- `src/scripts/trainQueryClassifiers.ts` — trainer offline Node/TS, hai stage: `train` (không đọc nhãn test) và `test` (từ chối chạy nếu thiếu `predeclared-targets.json` hoặc đã có `internal-test-result.json`).
- `src/__tests__/query-classifier-runtime-4-7r5.test.ts` — 6 test (fold dấu, validate artifact, chấm điểm xác định, embedding sai chiều → null, thiếu artifact → null, bucket).

Không có test tích hợp (fast-path bypass, precedence, OFF parity…) vì không có tích hợp để kiểm thử.

## 5. Trạng thái bất biến

HEAD `187745350ab147003d030d4826c430e84dfe3e59` (không commit); Qdrant 187 / 7072 / 5946 / 207 với id/content hash trùng tuyệt đối manifest pre-R5 (`qdrant-snapshot-post-phase4-7r5-2026-10-11.json`); `RAG_RETRIEVAL_V2` OFF; `training/` và `docs/ai-training/` không đổi; held-out V1–V5 không bị chỉnh sửa.

## 6. Hướng đi tiếp theo (đề xuất, không thực hiện)

1. Nguồn dữ liệu **thật, đã khử định danh** (hoặc người gán nhãn độc lập) cho Safety thay vì dữ liệu tự viết — đây là điểm nghẽn chính.
2. Xem xét hạ vai trò classifier thành "tín hiệu thận trọng" (chuyển sang `TITLED_EVIDENCE_ONLY`/abstain) thay vì cổng nhị phân; cần một ngưỡng sản phẩm được duyệt, không phải mục tiêu kỹ thuật.
3. Quyết định sản phẩm: chấp nhận PHASE4_7_STILL_PARTIAL và giữ `RAG_RETRIEVAL_V2` OFF, hoặc mở workstream thu thập dữ liệu — không nên tiếp tục thêm alias/regex.
