# 03 — Phân tích sản phẩm tham khảo (Phase 2)

Ngày 26/10/2026. Chỉ ghi pattern hữu ích cho Gymini, không sao chép UI hay mã. Không truy cập
màn hình đăng nhập riêng (Stripe Dashboard, Modern Treasury app) — mọi nhận định dựa trên
tài liệu công khai, nhãn **PUBLIC DOCS**.

## Giấy phép (kiểm qua GitHub API ngày 26/10)

| Nguồn | Giấy phép | Trạng thái | Kết luận tái sử dụng |
|---|---|---|---|
| Negentropy-Solutions/matcha | AGPL-3.0 | 7★, push 03/2026 | **Không chép mã** (AGPL lây sang cả web). Chỉ học pattern. |
| The-Commit-Company/mint | AGPL-3.0 | **archived** | Không chép, không phụ thuộc. Chỉ học pattern. |
| tremorlabs/tremor | Apache-2.0 | push 10/2025 | Có thể tham khảo/chép từng component (Tailwind + Radix, khớp stack) kèm ghi công. Không cần cài gói. |
| formancehq/ledger | Không tìm thấy tệp LICENSE ở gốc qua API → **NOT VERIFIED** | đang hoạt động | Chỉ học khái niệm sổ cái (Go backend, không dùng được ở frontend). |

## Pattern giữ lại

| # | Pattern | Nguồn | Vì sao hợp Gymini | Độ khớp stack |
|---|---|---|---|---|
| R1 | **Expected ↔ actual**: phía "kỳ vọng" (bản ghi nội bộ) và phía "thực tế" (giao dịch ngoài). Chỉ tự khớp khi MỌI điều kiện khớp; nhiều ứng viên → không tự khớp, đẩy sang thủ công. | Modern Treasury — reconciliation rules / exception handling | Đúng tinh thần "hai số bằng nhau không chứng minh là một giao dịch". Gymini hiện có khoá thật (`transactionId` FK, `providerRef`) → hiển thị khoá khớp, không suy theo số tiền. | Thuần UI, không phụ thuộc. |
| R2 | Trạng thái **partially reconciled** khi tổng phần đã khớp < số kỳ vọng. | Modern Treasury | Áp vào: một PaymentTransaction ↔ nhiều bút toán (ESCROW + 3 ngăn chờ). Hiển thị "tổng bút toán / số tiền giao dịch". | UI suy ra (derived) — phải gắn nhãn. |
| R3 | **Balance summary**: số dư đầu kỳ + hoạt động − chi ra = số dư cuối kỳ; drill-down từ mỗi con số xuống danh sách bút toán. | Stripe — payout reconciliation report | Khớp bất biến ESCROW của Gymini; dạng "cầu" (bridge) dễ hiểu hơn biểu đồ. Cần backend cung cấp số đầu/cuối kỳ (xem gap). | recharts không cần; bảng + số. |
| R4 | Tách **gross / fee / net** theo *reporting category* (charge, refund, fee, payout…). | Stripe | Gymini hiện không ghi phí cổng (chờ audit B xác nhận) → hiển thị "phí cổng: chưa ghi nhận", không tự tính. | — |
| R5 | Báo cáo **giao dịch** (payment accounting — sự kiện từng payment) tách khỏi báo cáo **quyết toán** (settlement — theo lô, gồm payout/điều chỉnh); chênh lệch giữa hai báo cáo là bình thường do thời điểm. | Adyen reporting | Gymini cần cảnh báo "khác kỳ / khác thời điểm" thay vì gọi là lệch. Payout ở Gymini là rút tiền thủ công (markPaid). | — |
| R6 | Hai cột chọn hai phía, chọn một dòng → làm nổi các dòng liên quan phía kia, panel chênh lệch ở dưới. | Matcha / Mint (pattern) | Đây là layout chính của F3. | Tự viết bằng Tailwind; không chép. |
| R7 | KPI card nhỏ có nhãn + giá trị + delta + liên kết drill-down; bảng dày đặc có filter bar dạng chip. | Tremor | Khớp hướng "data-dense but readable". | Apache-2.0, Tailwind v4 + Radix — khớp. |
| R8 | Giao dịch sổ cái = nhiều *posting* (source → destination, asset, amount); số dư theo tài khoản; mọi thứ append-only. | Formance | Gymini: `WalletLedgerEntry` (bucket, balanceBefore/After) cùng `transactionId` = một "journal". Hiển thị dạng bảng Nợ/Có thay vì JSON. | — |

## Pattern loại bỏ

- **Sankey dòng tiền**: với Gymini mỗi thanh toán chia ra ESCROW + 3 ngăn chờ, rồi nhiều lần giải phóng theo buổi → hàng nghìn cạnh, không đọc được, và dễ bị hiểu là tiền thật dịch chuyển (thực ra phần lớn chỉ là chuyển *quyền đòi* — money-flow §1 "nguyên tắc vàng"). Thay bằng: biểu đồ cột tiền vào/ra ESCROW theo ngày + bảng phân loại.
- **Nút "Mark as reconciled"**: backend không có trạng thái khớp/đối soát lưu trữ (chờ audit B xác nhận) → không có.
- **Count-up số tiền, sparkline cho số dư**: dễ gây hiểu nhầm, bỏ.
- **Command palette toàn cục**: Admin có ~17 trang; điều hướng hai cấp + tìm theo ID trong Tài chính đủ dùng. Để backlog.

## Nguồn

- Modern Treasury: [Reconciliation rules](https://docs.moderntreasury.com/payments/docs/defining-reconciliation-rules), [Exception handling — manual reconciliation](https://docs.moderntreasury.com/payments/docs/exception-handling-manual-reconciliation), [Expected payment object](https://docs.moderntreasury.com/platform/reference/expected-payment-object)
- Stripe: [Payout reconciliation report](https://docs.stripe.com/reports/payout-reconciliation)
- Adyen: [Interactive payment accounting report](https://help.adyen.com/knowledge/finance/reports-and-reconciliation/interactive-payment-accounting-report), [Aggregate settlement details report](https://docs.adyen.com/reporting/settlement-reconciliation/batch-level/aggregate-settlement-details-report)
- GitHub: matcha, mint, tremor, formancehq/ledger (metadata qua api.github.com)
