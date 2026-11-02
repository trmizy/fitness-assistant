# Eval integrity — reviewer receipt downgrade closure

Ngày 2026-11-02. Branch `feat/ai-coach-eval-integrity`; reviewed base `f0ab66c0`. Evidence **CODE AUDIT / TEST FIXTURE**, không phải đánh giá model hoặc scientific approval. Không merge/cherry-pick.

## Reproduction và bản vá P2

Probe trên HEAD trước sửa: packet có receipt hợp lệ được nhận với rawRecorded=1; sau khi chỉ xóa `reviewerExportHashes`, analyzer vẫn nhận rawRecorded=1 và tăng legacyPackets=1. Root cause: cả `validateAnnotation` và legacy counter đều dùng sự hiện diện của receipt map làm điều kiện kiểm tra; khi chưa có annotation, không có bước validation receipt độc lập.

Sau sửa:

- Factory seal `body.contract = reviewer-packet-v2` vào packetHash, tự tạo đầy đủ receipts R1/R2. Runner dùng kết quả factory thay vì tự gắn receipt sau đó.
- `validatePacketContract` chạy cho **mọi output**, kể cả chưa có annotations. Current contract bắt buộc có đúng hai receipts, được tái tính từ sealed body. Xóa, sửa, thiếu slot đều fail-closed. Annotation còn phải trỏ đúng receipt của reviewer slot.
- Packet kiểu reviewed `f0ab66c0` chưa có contract marker nhưng có representation version `redacted-canonical-v1` vẫn thuộc **receipt-required** contract; thiếu marker không biến nó thành legacy.
- Legacy V1 thật có đúng historical body shape `candidateHash,evidence,facts,instanceId,question,units`, không có receipt/representation. Chỉ nhận khi **exact packetHash** nằm trong `legacyV1PacketHashes` do trusted caller cung cấp qua options riêng, ngoài untrusted input/artifact JSON. Đây là explicit V1 policy; không suy ra legacy chỉ từ field bị thiếu.
- Tự gắn `reviewer-packet-v1`, xóa version/representation rồi rehash, hoặc thêm hash của packet V2 vào legacy pins đều không miễn kiểm tra receipt V2. Chỉ người kiểm soát trusted legacy policy mới có thể quyết định pin một historical specimen; không tự tạo pins từ incoming packets.
- Report ghi số receiptV2/legacyV1 và hash của trusted legacy policy. Invalid packet làm cả analysis lỗi, không skip dòng hoặc phát partial quality metrics. Lifecycle/failure counters, κ/bootstrap và paired comparisons không đổi.

Compatibility: annotations hiện hành gửi `reviewerExportHash` theo slot; các D1/D3 fixture helpers được cập nhật tương ứng. Legacy annotations không có receipt tiếp tục được nhận khi packet V1 đúng shape/hash và trusted caller đã pin từ nguồn lịch sử độc lập. Không tự reseal/migrate historical files hoặc sửa reviewer decisions.

P2 verification trước commit: D1, annotation infrastructure, D3/P2-1 và integrity suites: **38 pass / 0 fail / 0 skip**; TypeScript **exit 0**. Full scoped regression và redaction follow-up được ghi ở phần bàn giao cuối.

## Secret-pattern assessment

Probe bằng synthetic strings trên `f0ab66c0` xác nhận cả năm mẫu có thể lọt qua câu rationale vào reviewer artifact: `aws_secret_access_key=`, `token=`, Basic Authorization, `sk-`, `ghp_`. Object key có chữ secret đã được mask, nhưng điều đó không bảo vệ cùng chuỗi nằm trong prose. Vì vậy cần bản vá redaction riêng, không mở dự án DLP.

Giới hạn không đổi: patterns không phát hiện được mọi secret/PII/encoding; hash không phải authentication. Legacy pins phải do owner quản lý bên ngoài incoming artifact. Reviewer independence/scientific labels vẫn thuộc owner. CLI giữ FAKE_ONLY, không có quyền LIVE mới; không gọi Bedrock/Ollama/embedding/vector DB và không gỡ Ollama block.

## Review và tích hợp

Review đúng contract admission trước annotations, packetHash-bound version, derived R1/R2 receipts, explicit historical V1 pins và việc invalid input không bị skip. Chỉ tích hợp sau Claude Code xác minh; không yêu cầu mở lại toàn bộ kiến trúc. Không đụng scientific review, corpus hoặc frozen V2.
