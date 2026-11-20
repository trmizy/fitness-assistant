# 11 — Evidence và độ phủ

Ngày 2026-10-19 (Asia/Saigon). START_HEAD: 003545c6da8d524e8c4f6fbe4575444102f1fc50. Nhánh aws-deploy.

Bằng chứng: **CODE AUDIT / STATIC_CODE_VERIFIED** trong phạm vi từng trích đoạn; không có test chạy, REAL BROWSER, REAL HTTP/API, live runtime hay deployment verification. Định nghĩa test được đọc không tương đương UNIT_TEST_VERIFIED hoặc INTEGRATION_TEST_VERIFIED.

**INDEPENDENT_AUDIT_PARTIALLY_VERIFIED**. 101/101 inventory checks (100% ID/domain/status consistency); 38/101 = 37.6% capability có scoped source trace, không phải full-stack correctness. 20/20 BDG và 36/36 G có classification hoặc blocker, không phải 56/56 confirmed defects. 14/14 domain reconciled về cấu trúc; 0/14 fully workflow-verified. 0 runtime tests. Không gộp các tỷ lệ này thành phần trăm hoàn thành toàn audit.

Required input hiện có; không SOURCE_NOT_FOUND trong bộ yêu cầu. Markdown đọc theo section và extraction có giới hạn, JSON parse đầy đủ; không claim mọi material sentence của tất cả report đã xác minh. source-evidence.json chứa line range/excerpt/SHA và scope; baseline-integrity.json chứa fingerprint tracked+untracked trước audit (không chứa nội dung secret).

Chưa xác minh nguồn độc lập:

CAP-01-01, CAP-01-02, CAP-01-04, CAP-01-06, CAP-01-08, CAP-01-09, CAP-02-01, CAP-02-02, CAP-02-03, CAP-02-04, CAP-03-01, CAP-03-02, CAP-03-03, CAP-03-06, CAP-03-07, CAP-03-08, CAP-03-09, CAP-03-10, CAP-03-12, CAP-03-13, CAP-04-01, CAP-04-02, CAP-04-03, CAP-04-04, CAP-04-06, CAP-05-01, CAP-05-02, CAP-05-03, CAP-05-06, CAP-06-03, CAP-06-04, CAP-07-01, CAP-07-02, CAP-07-03, CAP-07-04, CAP-07-05, CAP-07-06, CAP-08-05, CAP-08-06, CAP-09-06, CAP-09-08, CAP-09-09, CAP-10-01, CAP-10-02, CAP-10-03, CAP-10-04, CAP-10-05, CAP-11-01, CAP-11-02, CAP-11-05, CAP-11-06, CAP-11-07, CAP-11-08, CAP-12-01, CAP-12-02, CAP-12-03, CAP-12-04, CAP-12-05, CAP-12-06, CAP-12-07, CAP-13-01, CAP-13-02, CAP-13-03, CAP-13-04, CAP-14-02, CAP-14-03, CAP-14-04, CAP-14-07, CAP-14-08

Blockers / remaining work:

- All-state-changing/security/AI capabilities have not been exhaustively independently traced.
- AICAP-06..10, ML artifacts and full RAG runtime authority need deeper tracing.
- PT notes, delegated AI tools and cross-service communication authorization not exhaustively traced.
- Production architecture/runtime unavailable under read-only local authorization.
- No negative boot/regression/DB integration/browser tests executed.

Domain 14-domain taxonomy không chứng minh exhaustive decomposition. Có subflow quan trọng bị inventory quá gộp: payment provider-specific verification/escrow/reconciliation ở webhook.service.ts và PT roadmap draft/training approve/reject routes. Không phát hiện đủ bằng chứng một domain thứ 15 độc lập. Không tuyên bố parity web/mobile: mobile Expo riêng, web Capacitor riêng.

Exact next step: Complete remaining high-risk capability source trace starting with delegated tool authorization, payment settlement/refunds and gym/admin owner gates; then close evidence fields before full-baseline signoff.

No source/config/schema/infra/db changes, commit, push, training, deployment or real-customer data access performed by this audit. Integrity comparison saved separately after report generation.


**Snapshot cuối sau bổ sung:** 38/101 = 37.6% scoped source coverage; 16 AICAP scoped entries; 3 NEW gaps; 81 evidence records. 0 test chạy; 0 full-stack verified. Không dùng tỷ lệ này như phần trăm mission đã hoàn tất.

Exact remaining capability set (thay list trước): CAP-01-01, CAP-01-02, CAP-01-04, CAP-01-06, CAP-01-08, CAP-01-09, CAP-02-01, CAP-02-02, CAP-02-03, CAP-02-04, CAP-03-01, CAP-03-02, CAP-03-03, CAP-03-06, CAP-03-07, CAP-03-08, CAP-03-09, CAP-03-10, CAP-03-12, CAP-04-01, CAP-04-02, CAP-04-03, CAP-04-04, CAP-04-06, CAP-05-01, CAP-05-02, CAP-05-03, CAP-05-06, CAP-06-03, CAP-06-04, CAP-07-01, CAP-07-02, CAP-07-03, CAP-07-04, CAP-07-05, CAP-07-06, CAP-08-06, CAP-09-09, CAP-10-01, CAP-10-02, CAP-10-03, CAP-10-04, CAP-10-05, CAP-11-01, CAP-11-02, CAP-11-05, CAP-11-06, CAP-11-07, CAP-11-08, CAP-12-01, CAP-12-02, CAP-12-03, CAP-12-04, CAP-12-05, CAP-12-06, CAP-12-07, CAP-13-01, CAP-13-02, CAP-13-03, CAP-14-03, CAP-14-04, CAP-14-07, CAP-14-08.

Next: Finish endpoint-policy inventory for NEW-GAP-003, then remaining high-risk state-changing capability source traces and frontend/model/permission fields.


**Sự cố phạm vi:** hashing ban đầu đọc bytes các file tên heldout (gồm Qwen datasets); không hiển thị/dùng nội dung, không train/eval/sửa. Không thể khẳng định heldout untouched. Đã loại khỏi đọc tiếp; xem AUDIT_BOUNDARY_INCIDENT.md.
