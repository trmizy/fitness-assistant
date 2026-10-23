# Phase 2.5 — Checklist kết thúc

Cập nhật 17/10/2026 theo quyết định Owner: **Phase 2.5 ĐÓNG về roadmap.** Các việc chuẩn bị tiền thật chuyển sang track riêng (Financial Hardening, Security Hardening) và **không** là điều kiện để phát triển Phase 3.

Ký hiệu: ✅ đạt, có bằng chứng · 🟡 một phần · ⬜ chưa làm.

## M-A — Phase 2.5 Functional Complete: ✅ ĐẠT

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| PT restriction (tài khoản, cấm vĩnh viễn) | ✅ | Lát 2–4; `pt-restriction-*` |
| Restriction theo hợp đồng — một Client khiếu nại chỉ ảnh hưởng hợp đồng đó | ✅ | D38; `pt-restriction-contract-scope*` (18 kiểm thử bắt buộc) |
| Client rút khi PT bị hạn chế, hoàn đúng quyền lợi | ✅ | D32/D36/D37; `client-exit-*`, sổ cái thật kịch bản C |
| Buổi treo / tranh chấp giữ đúng, không tự giải phóng | ✅ | F2, F3, D52; `contract-ending-held-sessions`, `session-delivery-cas` |
| F1/F2/F3, F4, đua lệnh, quyết toán toàn vẹn, chống trả trùng | ✅ | GĐ0; `contract-race-family`, `timeout-faults` 31/31, `restart-recovery` 6/6, `mi-races` 13/13, `mi-crash` 14/14 |
| VNPay đối chiếu số tiền (+ ZaloPay/PayOS/MoMo, chặn production chưa xác minh) | ✅ | `vnpay-amount-verification` 34/34, các bộ callback |
| Kiểm thử liên dịch vụ với sổ cái thật | ✅ | `cross-service-money*` 12/8/7/3/23 |
| Migration + rollback | ✅ | D57-6, D58 mục 7 |

## M-B — Phase 3 Development Ready

Không yêu cầu Financial Hardening.

| Hạng mục | Trạng thái |
|---|---|
| Git checkpoint Phase 2.5 | ✅ (17/10) |
| API/contract cần cho Phase 3 đã rõ | 🟡 xem `docs/PHASE_3_PLAN.md` mục audit phụ thuộc |
| Phụ thuộc Membership ↔ Contract được xác định | 🟡 audit tối thiểu trong `PHASE_3_PLAN.md` |
| Phase 2 PT Check-in chạy song song, không chặn | ✅ (quyết định Owner) |
| Không có P0 trực tiếp phá luồng Phase 3 | ✅ chưa phát hiện |

## M-C — Production / Real Money Ready (track riêng, KHÔNG chặn Phase 3)

| Hạng mục | Trạng thái |
|---|---|
| GĐ1 SETTLING (gồm tách phần hoàn được khỏi khoản chưa xác minh — D65-B) | ⬜ |
| GĐ2 Payment idempotency (fingerprint, tra cứu theo khóa) | ⬜ |
| Gỡ nhánh tự đền từ ví AVAILABLE chung (N7/D48) | ⬜ |
| Financial Hold + giữ lại 10% (+ chọn M0/M1) | ⬜ — đang TẮT |
| Đối soát: trang admin chỉ đọc, phát hiện khoản treo lâu, giám sát `[MoneyAttention]` | ⬜ |
| Cổng thanh toán production (VNPay merchant thật, cờ `*_PRODUCTION_VERIFIED`) | ⬜ |
| Security: xoay khóa đã lộ, `ALLOW_INSECURE_DEV_SECRETS` (production fail-closed) | ⬜ |
| Triển khai: migrate là bước riêng, sao lưu/khôi phục, kiểm tra hậu triển khai | ⬜ |
| Kiểm kê + xử lý dữ liệu tồn đọng (D62), bật tách dòng mồ côi sau duyệt riêng | ⬜ — `SETTLEMENT_SWEEP_PARK_ORPHANS` mặc định TẮT |
| SLA tranh chấp, hạn 48h `PT_NO_SHOW_REPORTED`, circuit breaker, dashboard | ⬜ backlog |
| REAL BROWSER / thiết bị cho luồng tiền | ⬜ |

**Phase 3 tuyệt đối chưa mở thanh toán thật** cho tới khi M-C đạt.

## Quy tắc xử lý vấn đề mới (từ 17/10)

- P0/P1 làm sai nghiệp vụ đã chốt → báo Owner và sửa.
- Bug kỹ thuật không ảnh hưởng business rule → backlog.
- Production hardening → Financial/Security Hardening backlog.
- Business rule mới chưa quyết → **không** thêm vào code; ghi vào `OPEN BUSINESS DECISIONS` trong `docs/PHASE_3_PLAN.md`.
