# B4 — Tài chính › Đối soát + header Tài chính: bằng chứng

Nhãn: **MOCK BROWSER TEST** (Playwright 1.61 + `page.route` mock mọi `/api/**`, vite dev cổng 5414 trong worktree `D:/admin-fr`, proxy trỏ về cổng chết → không chạm backend thật) + **UNIT TEST** (tsx) + **CODE AUDIT**. Không phải REAL BROWSER / REAL HTTP/API.

## Số liệu
- Unit: `npx tsx --test` toàn `__tests__` = **671/671** (627 baseline + 28 test B4 `b4-reconciliation.test.ts` + 16 test của worker B6a đang có trong cây). Test cũ `adminReconciliation.utils.test.ts` (41) không đổi, vẫn đạt.
- `vite build` ra scratchpad: đạt. `tsc` (cấu hình tạm chỉ-web, đã xoá): **227** = mốc, 0 lỗi trong tệp B4.
- Mock browser: **186/186** kiểm tra đạt (trong đó 38 lần axe: serious+critical = 0 ở cả `#admin-main` lẫn toàn tài liệu). 1440 sáng + tối, 390; không tràn ngang ở 390.
- Ảnh: `balanced|drift|error500|forbidden|loading|stale-*`, `exceptions-{all-open,collapsed,truncated,empty,p13-500,loading,stale}-*`, `header-{overview,reconciliation,withdrawals,refunds}-1440-light`, `kbd-focus-chip-1440-light`, bản tối `*-1440-dark`.

## Kịch bản đã chạy
balanced · drift 409 (E-01) · 500 · 403 (E-06) · 200 hỏng body · loading · stale (E-08, đồng hồ giả) · Ngoại lệ đủ 22 nhóm · truncated (23 nhóm "Chưa hiện hết") · rỗng (22 nhóm count 0) · P13 500 / U2 500 / P2 500 (nguồn còn lại vẫn hiện) · 403 cả hai · deep link `?view=` (balance/exceptions/ledger/gateway/bogus/không có) + `/admin/finance?tab=reconciliation&view=exceptions` · Back/Forward · bàn phím trên chip (Tab, Enter, Space, chip L3 tắt không kích hoạt được) · header: tiêu đề + nút Làm mới ở cả 4 tab × 1440/390 (kiểm đúng những endpoint nào được gọi lại và những endpoint nào KHÔNG) · parity B3/B5 (trang Tổng quan, Rút tiền vẫn render, nút Làm mới riêng còn nguyên).

## Ca kế hoạch §4
E-01 (409 → "Lệch sổ" đỏ + nguyên nhân kèm số đếm + liên kết sang Ngoại lệ, không "lỗi tải") · E-11 (nhóm "Cổng báo số tiền khác số Gymini": cổng, mã giao dịch cổng, kỳ vọng, cổng báo, chênh, số lần, "chưa có quy trình (G-15)") · E-06 · E-08 · T1: đếm DOM = 22 nhóm + 1 nhóm P2.

## Bảng kiểm từng con số (kỳ vọng tính độc lập trong script bằng `toLocaleString("vi-VN")` trên fixture)
| Số hiển thị | Dòng §3 | Trường DTO | Kịch bản | Mong đợi | Thực tế | Đạt |
|---|---|---|---|---|---|---|
| Tiền đang giữ hộ | §3 Tiền đang giữ hộ | P3 escrow | balanced | 590.800.000 ₫ | 590.800.000 ₫ | ✓ |
| Tổng quyền đòi | §3 Tổng quyền đòi | P3 claims | balanced | 590.800.000 ₫ | 590.800.000 ₫ | ✓ |
| Chênh lệch | §3 Chênh lệch sổ | P3 drift | balanced | 0 ₫ | 0 ₫ | ✓ |
| Quyền đòi: Khách hàng — số dư ví | §3 Bản đồ tiền giữ hộ | P3 breakdown.clientBalances | balanced | Khách hàng — số dư ví 184.250.000 ₫ | Khách hàng — số dư ví 184.250.000 ₫ | ✓ |
| Quyền đòi: PT — đang chờ giải phóng | §3 Bản đồ tiền giữ hộ | P3 breakdown.ptPending | balanced | PT — đang chờ giải phóng 96.400.000 ₫ | PT — đang chờ giải phóng 96.400.000 ₫ | ✓ |
| Quyền đòi: PT — khả dụng | §3 Bản đồ tiền giữ hộ | P3 breakdown.ptAvailable | balanced | PT — khả dụng 41.300.000 ₫ | PT — khả dụng 41.300.000 ₫ | ✓ |
| Quyền đòi: PT — đã khoá chờ chi | §3 Bản đồ tiền giữ hộ | P3 breakdown.ptLocked | balanced | PT — đã khoá chờ chi 12.500.000 ₫ | PT — đã khoá chờ chi 12.500.000 ₫ | ✓ |
| Quyền đòi: PT — tạm giữ | §3 Bản đồ tiền giữ hộ | P3 breakdown.ptHoldback | balanced | PT — tạm giữ 0 ₫ | PT — tạm giữ 0 ₫ | ✓ |
| Quyền đòi: Phòng gym — đang chờ giải phóng | §3 Bản đồ tiền giữ hộ | P3 breakdown.gymPending | balanced | Phòng gym — đang chờ giải phóng 128.700.000 ₫ | Phòng gym — đang chờ giải phóng 128.700.000 ₫ | ✓ |
| Quyền đòi: Phòng gym — khả dụng | §3 Bản đồ tiền giữ hộ | P3 breakdown.gymAvailable | balanced | Phòng gym — khả dụng 57.900.000 ₫ | Phòng gym — khả dụng 57.900.000 ₫ | ✓ |
| Quyền đòi: Phòng gym — đã khoá chờ chi | §3 Bản đồ tiền giữ hộ | P3 breakdown.gymLocked | balanced | Phòng gym — đã khoá chờ chi 8.000.000 ₫ | Phòng gym — đã khoá chờ chi 8.000.000 ₫ | ✓ |
| Quyền đòi: Nền tảng — doanh thu chờ | §3 Bản đồ tiền giữ hộ | P3 breakdown.platformRevenuePending | balanced | Nền tảng — doanh thu chờ 34.600.000 ₫ | Nền tảng — doanh thu chờ 34.600.000 ₫ | ✓ |
| Quyền đòi: Nền tảng — doanh thu đã hưởng | §3 Bản đồ tiền giữ hộ | P3 breakdown.platformRevenueAvailable | balanced | Nền tảng — doanh thu đã hưởng 27.150.000 ₫ | Nền tảng — doanh thu đã hưởng 27.150.000 ₫ | ✓ |
| Tiền đang giữ hộ (409) | §3 Tiền đang giữ hộ | P3 escrow | drift 409 | 590.800.000 ₫ | 590.800.000 ₫ | ✓ |
| Tổng quyền đòi (409) | §3 Tổng quyền đòi | P3 claims | drift 409 | 592.050.000 ₫ | 592.050.000 ₫ | ✓ |
| Chênh lệch (409) | §3 Chênh lệch sổ (409 vẫn có body) | P3 drift | drift 409 | -1.250.000 ₫ | -1.250.000 ₫ | ✓ |
| Quyền đòi (409): PT — khả dụng | §3 Bản đồ tiền | P3 breakdown.ptAvailable | drift 409 | PT — khả dụng 42.550.000 ₫ | PT — khả dụng 42.550.000 ₫ | ✓ |

Số đếm 22 nhóm: mỗi nhóm so với bảng kỳ vọng viết tay (`FULL_COUNTS` trong `run.mjs`), 0 sai lệch.

## Ghi chú / khoảng trống §3
- Nhóm "Cổng báo số tiền khác số Gymini" (P2) là nhóm thứ 23 (mức L2), thêm theo E-11; gọi `GET /admin/payments/gateway-discrepancies` qua `api` (chưa có wrapper trong `adminService`; `services/api.ts` không thuộc phạm vi B4). Badge sidebar/chip đếm (`countAttention`) KHÔNG gồm nhóm này — thay đổi nằm ngoài tệp B4.
- Chip "Đối chiếu cổng ↔ Gymini": chỉ ở dạng tắt, "L3 — chưa có nguồn độc lập (BLOCKED)". Không số liệu giả, không nút "Đã đối soát", không quy trình xử lý (ghi "chưa có quy trình (G-15)").
- Kế hoạch §2.3 ghi `?view=ledger|exceptions|gateway`; brief B4 dùng `balance|exceptions` → `ledger` vẫn vào chip Cân đối sổ, `gateway` rơi về Cân đối sổ.
- Prototype có "tổng tiền liên quan" mỗi nhóm; brief cấm cộng tiền ngoại lệ → header nhóm chỉ hiện số mục, mục cũ nhất chưa có (backend không trả thống nhất một trường "cũ nhất" cho cả 22 nhóm). Thông tin tên người (G-09) chưa có: dòng vẫn dùng mã rút gọn 8 ký tự.
- Mặc định mở sẵn các nhóm "Cần xem ngay" có mục; còn lại thu gọn (Mở hết / Thu gọn hết). Nội dung nhóm chỉ render khi mở — nếu spec E2E ngoài cây này tìm dòng bên trong nhóm đang đóng thì phải bấm mở trước.
- Header: nút "Làm mới" ở header làm `invalidateQueries` theo họ khoá của tab đang mở (Tổng quan: `admin/finance*`, `admin/finance-overview`, `pending-withdrawals`, `refund-requests`; Đối soát: `admin/finance*`; Rút tiền: `pending-withdrawals`; Hoàn tiền: `refund-requests`, `refund-calculation`). Nút Làm mới trong trang của B3/B5/hoàn tiền được GIỮ (không gỡ) để không phá test.
