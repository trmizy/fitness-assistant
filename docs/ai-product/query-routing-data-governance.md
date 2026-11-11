# Query-routing data governance (Phase 4.7R6)

Phạm vi: dữ liệu dùng để **đánh giá/huấn luyện bộ định tuyến** (safety envelope, Programming routing). Không áp dụng cho tri thức được truy xuất (Qdrant).

## 1. Nguồn được phép (theo thứ tự ưu tiên)

1. Truy vấn Gymini thật **đã có sự đồng ý** và **đã khử định danh** — chỉ khi quy trình thu thập/consent đã tồn tại. Hiện **chưa có**; không tự động xuất hội thoại production.
2. Câu do người bản ngữ **độc lập** tự viết từ kịch bản ngữ nghĩa (`data/eval/query-routing-independent/writer_scenarios.md`).
3. Văn bản công khai dạng truy vấn có giấy phép và provenance rõ ràng (cần quyết định riêng trước khi dùng).
4. Dữ liệu tổng hợp R5 (`data/eval/query-classifiers/`) — **chỉ** làm dữ liệu phát triển / phân loại lỗi / hard-negative; không phải bằng chứng độc lập.

Cấm: cào diễn đàn y tế/cộng đồng riêng tư khi chưa có quyết định licensing + provenance; dùng LLM làm "người gán nhãn" hoặc tạo nhãn tự động rồi gọi là độc lập.

## 2. Khử định danh / trường bị cấm

Không lưu: tên, SĐT, email, ID tài khoản/người dùng, URL cá nhân, số hồ sơ, chi tiết hồ sơ bệnh án chính xác (ngày, bệnh viện, tên bác sĩ), lịch sử cá nhân thô. Công cụ `detectPii` / `validateRow` chặn email, SĐT, chuỗi ≥ 8 chữ số, URL; việc kiểm tra này không thay thế rà soát của con người.

## 3. Lưu trữ / repo

- Repo chỉ chứa: protocol, template, mã công cụ, dữ liệu tổng hợp, và (sau này) tập đánh giá **đã khử định danh** có băm SHA256 trong manifest.
- Không commit bất kỳ dữ liệu thật chưa khử định danh; bản gốc (nếu có) nằm ngoài repo, có thời hạn lưu giữ do chủ dữ liệu quy định.
- Nhãn của annotator lưu bằng **mã bút danh** (A01, A02…); không lưu tên/email trong artifact commit.

## 4. Quyền truy cập annotator

Annotator chỉ thấy `id` + `text` (blind export). Không thấy đầu ra bộ luật/mô hình, ID lỗi cũ, điểm tin cậy hay family.

## 5. Consent dữ liệu người dùng thật

Bất kỳ dữ liệu từ người dùng thật cần: mục đích được nêu, đồng ý rõ ràng, khử định danh trước khi vào repo, quyền rút lại. Chưa có cơ chế → **không dùng**.

## 6. Tình trạng provenance hiện tại

| Tập | Nguồn | Trạng thái |
|---|---|---|
| `data/eval/query-classifiers/*` (R5) | tự viết bởi implementation author, tổng hợp | development-only; calibration đã bị chỉnh sau khi quan sát (đã ghi nhận) |
| `data/eval/retrieval/*` V1–V5 | tự viết, tổng hợp | dev/diagnostic; V1–V5 đã tiêu thụ |
| `data/eval/query-routing-independent/*` | giao thức/mẫu | **chưa có dữ liệu có nhãn** |

## 7. Quy tắc dùng LLM

LLM được phép hỗ trợ dựng công cụ, hướng dẫn, mô tả kịch bản. LLM **không** được tính là annotator và không được dùng để tạo độ đồng thuận liên-annotator.

## 8. Bổ sung R6A — từ chối cột dữ liệu cá nhân ở mức schema

Công cụ chú thích từ chối (lỗi, không chỉ cảnh báo) bất kỳ CSV nào có cột `email`, `phone`, `user_id`, `account_id`, `full_name`, `name`, `medical_record_id`, `address`, `dob`, `ip` (không phân biệt hoa thường/dấu gạch). Gói pilot chỉ chứa thẻ kịch bản, không có câu mẫu do implementation agent viết.
