# B3 — Tài chính › Tổng quan: bằng chứng

Nhãn: **MOCK BROWSER TEST** (Playwright 1.61 + `page.route` mock mọi `/api/**`, vite dev trên cổng 5403 trong worktree `D:/admin-fr`, proxy gateway/chat trỏ về cổng chết nên không chạm backend thật) + **UNIT TEST** (tsx). Không phải REAL BROWSER / REAL HTTP/API.

## Số liệu
- Unit: `npx tsx --test` toàn `__tests__` = **627/627** (baseline 565 + 44 test B3 `b3-finance-overview.test.ts` + 18 test B5 của worker khác đang có trong cây).
- `vite build` ra scratchpad: đạt. `tsc` (cấu hình tạm chỉ-web, đã xoá): **227** lỗi (baseline 236; −9 là 9 lỗi recharts của tab cũ đã bỏ), 0 lỗi trong tệp B3.
- Mock browser: **147/147** kiểm tra đạt (scenario: balanced · drift/409 · 500 · 403 · loading · stale · kỳ rỗng; 1920/1440/390; sáng + tối ở 1440; 400 INVALID_RANGE; P3 200 nhưng body hỏng; A-02; kỳ tuỳ chọn; bàn phím). axe serious+critical = **0** ở mọi lần chạy (cả `#admin-main` lẫn toàn tài liệu). Không tràn ngang ở 390 và 1920.
- Ảnh: `balanced|drift|error500|forbidden|loading|empty|stale-{1920,1440,390}-light.png`, `{balanced,drift,error500}-1440-dark.png`, `custom-range-1440-light.png`.

## Bảng kiểm từng con số (số hiển thị → §3 → trường DTO → kết quả)
| Số hiển thị | Dòng §3 | Trường DTO | Kịch bản | Mong đợi | Thực tế | Đạt |
|---|---|---|---|---|---|---|
| Tiền đang giữ hộ | §3 Tiền đang giữ hộ | P3 escrow | balanced | 590.800.000 ₫ | 590.800.000 ₫ | ✓ |
| Tổng quyền đòi | §3 Tổng quyền đòi | P3 claims | balanced | 590.800.000 ₫ | 590.800.000 ₫ | ✓ |
| Chênh lệch (cân đối sổ ví) | §3 Chênh lệch sổ | P3 drift | balanced | 0 ₫ | 0 ₫ | ✓ |
| Bản đồ: Khách hàng — số dư ví (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.clientBalances | balanced | Khách hàng — số dư ví 184.250.000 ₫ 31,2% | Khách hàng — số dư ví 184.250.000 ₫ 31,2% | ✓ |
| Bản đồ: PT — đang chờ giải phóng (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.ptPending | balanced | PT — đang chờ giải phóng 96.400.000 ₫ 16,3% | PT — đang chờ giải phóng 96.400.000 ₫ 16,3% | ✓ |
| Bản đồ: PT — khả dụng (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.ptAvailable | balanced | PT — khả dụng 41.300.000 ₫ 7,0% | PT — khả dụng 41.300.000 ₫ 7,0% | ✓ |
| Bản đồ: PT — đã khoá chờ chi (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.ptLocked | balanced | PT — đã khoá chờ chi 12.500.000 ₫ 2,1% | PT — đã khoá chờ chi 12.500.000 ₫ 2,1% | ✓ |
| Bản đồ: PT — tạm giữ (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.ptHoldback | balanced | PT — tạm giữ 0 ₫ 0,0% | PT — tạm giữ 0 ₫ 0,0% | ✓ |
| Bản đồ: Phòng gym — đang chờ giải phóng (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.gymPending | balanced | Phòng gym — đang chờ giải phóng 128.700.000 ₫ 21,8% | Phòng gym — đang chờ giải phóng 128.700.000 ₫ 21,8% | ✓ |
| Bản đồ: Phòng gym — khả dụng (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.gymAvailable | balanced | Phòng gym — khả dụng 57.900.000 ₫ 9,8% | Phòng gym — khả dụng 57.900.000 ₫ 9,8% | ✓ |
| Bản đồ: Phòng gym — đã khoá chờ chi (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.gymLocked | balanced | Phòng gym — đã khoá chờ chi 8.000.000 ₫ 1,4% | Phòng gym — đã khoá chờ chi 8.000.000 ₫ 1,4% | ✓ |
| Bản đồ: Nền tảng — doanh thu chờ (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.platformRevenuePending | balanced | Nền tảng — doanh thu chờ 34.600.000 ₫ 5,9% | Nền tảng — doanh thu chờ 34.600.000 ₫ 5,9% | ✓ |
| Bản đồ: Nền tảng — doanh thu đã hưởng (số tiền) | §3 Bản đồ tiền giữ hộ | P3 breakdown.platformRevenueAvailable | balanced | Nền tảng — doanh thu đã hưởng 27.150.000 ₫ 4,6% | Nền tảng — doanh thu đã hưởng 27.150.000 ₫ 4,6% | ✓ |
| Bản đồ: tổng quyền đòi | §3 Tổng quyền đòi | P3 claims | balanced | 590.800.000 ₫ | 590.800.000 ₫ | ✓ |
| Tiền vào nền tảng | §3 Tiền vào nền tảng (kỳ) | P4 totals.income | balanced | 529.000.000 ₫ | 529.000.000 ₫ | ✓ |
| Tiền ra khỏi nền tảng | §3 Tiền ra khỏi nền tảng (kỳ) | P4 totals.expense | balanced | 122.000.000 ₫ | 122.000.000 ₫ | ✓ |
| Doanh thu nền tảng đã thực hiện | §3 Doanh thu đã thực hiện (kỳ) | P4 totals.netRevenue | balanced | 52.900.000 ₫ | 52.900.000 ₫ | ✓ |
| Luỹ kế — Đã hưởng | §3 Doanh thu luỹ kế | P4 platformRevenue.available | balanced | 27.150.000 ₫ | 27.150.000 ₫ | ✓ |
| Luỹ kế — Còn chờ | §3 Doanh thu luỹ kế | P4 platformRevenue.pending | balanced | 34.600.000 ₫ | 34.600.000 ₫ | ✓ |
| Luỹ kế — Tính đến (giờ VN) | §3 Doanh thu luỹ kế | P4 platformRevenue.asOf (07:32Z) | balanced | 26/10/2026 14:32 | 26/10/2026 14:32 | ✓ |
| Bảng kỳ: dòng đầu (vào/ra/doanh thu) | §3 Tiền vào/ra, doanh thu (kỳ) | P4 buckets[0].income/expense/netRevenue | balanced | 28/09 24.000.000 ₫ 2.000.000 ₫ 2.400.000 ₫ | 28/09 24.000.000 ₫ 2.000.000 ₫ 2.400.000 ₫ | ✓ |
| Bảng kỳ: dòng cuối | §3 … | P4 buckets[29] | balanced | 27/10 8.000.000 ₫ 1.000.000 ₫ 800.000 ₫ | 27/10 8.000.000 ₫ 1.000.000 ₫ 800.000 ₫ | ✓ |
| Bảng kỳ: dòng 'Cả kỳ' = DTO totals (không cộng lại phía client) | §3 totals | P4 totals.* | balanced | Cả kỳ 529.000.000 ₫ 122.000.000 ₫ 52.900.000 ₫ | Cả kỳ 529.000.000 ₫ 122.000.000 ₫ 52.900.000 ₫ | ✓ |
| Hàng đợi: Đã duyệt, chờ chuyển khoản — số | §3 Đã duyệt – chờ chuyển khoản | P7 status=APPROVED (count) | balanced | 1 | 1 | ✓ |
| Hàng đợi: Rút tiền chờ duyệt — số | §3 Rút tiền chờ duyệt | P7 status=PENDING (count) | balanced | 2 | 2 | ✓ |
| Hàng đợi: Ngoại lệ đối soát cần xem — số (đếm, không cộng tiền) | §3 Ngoại lệ đối soát | P13 summary + U2 items (countAttention.critical) | balanced | 5 | 5 | ✓ |
| Hàng đợi: Hoàn tiền dịch vụ — số | §3 Hoàn tiền dịch vụ (A1) | A1 list length | balanced | 2 | 2 | ✓ |
| Chênh lệch (lệch sổ, 409) | §3 Chênh lệch sổ (409 vẫn có body) | P3 drift | drift 409 | -1.250.000 ₫ | -1.250.000 ₫ | ✓ |
| Tiền đang giữ hộ (409) | §3 Tiền đang giữ hộ | P3 escrow | drift 409 | 590.800.000 ₫ | 590.800.000 ₫ | ✓ |
| Tổng quyền đòi (409) | §3 Tổng quyền đòi | P3 claims | drift 409 | 592.050.000 ₫ | 592.050.000 ₫ | ✓ |
| Bản đồ (409): PT — khả dụng | §3 Bản đồ tiền | P3 breakdown.ptAvailable | drift 409 | PT — khả dụng 42.550.000 ₫ 7,2% | PT — khả dụng 42.550.000 ₫ 7,2% | ✓ |
| tile-escrow | — | — | 500 | — (error) | — / error | ✓ |
| tile-claims | — | — | 500 | — (error) | — / error | ✓ |
| tile-balance | — | — | 500 | — (error) | — / error | ✓ |
| tile-income | — | — | 500 | — (error) | — / error | ✓ |
| tile-expense | — | — | 500 | — (error) | — / error | ✓ |
| tile-net-revenue | — | — | 500 | — (error) | — / error | ✓ |
| tile-rev-available | — | — | 500 | — (error) | — / error | ✓ |
| tile-rev-pending | — | — | 500 | — (error) | — / error | ✓ |
| tile-rev-asof | — | — | 500 | — (error) | — / error | ✓ |
| Tiền vào (kỳ rỗng) — số 0 thật trên thành công | §3 Tiền vào nền tảng (kỳ) | P4 totals.income | empty period | 0 ₫ | 0 ₫ | ✓ |

Kỳ vọng được tính độc lập trong script (`toLocaleString("vi-VN")` trên fixture), không dùng hàm của app.

## Ca kế hoạch §4
H-01 (balanced: Cân bằng + bản đồ = 100% claims) · E-01 (409 có body → "Lệch sổ", không "lỗi tải") · A-01 (kỳ rỗng) · A-02 (đổi nhóm giữ chiều cao, mờ 50%, URL đổi, số cũ còn đến khi có số mới) · E-06 (403 → không số nào) · E-08 (chip "Dữ liệu lúc HH:mm — đã cũ N phút", dùng đồng hồ giả: poll hỏng sau khi đã có số).

## Khoảng trống §3 / quyết định cần Ngài
1. `transactionCount` (P4, theo cột và tổng) KHÔNG có dòng §3 → đã **bỏ cột "Số giao dịch"** của tab cũ. Nếu cần, thêm một dòng §3 rồi hiện lại.
2. Tổng tiền của hàng đợi "Hoàn tiền dịch vụ": §3 chỉ có `totalPaid/alreadyRefunded/refundableCeiling` theo TỪNG đơn (A2); không có dòng "Σ giá" → hàng chỉ hiện **số đơn**, không hiện tổng (prototype có tổng 1.198.000 ₫ — không thể có từ dữ liệu thật mà không gọi A2 cho từng đơn).
3. "Cũ nhất" của hàng "Ngoại lệ đối soát": §3 có "cũ nhất" nhưng các dòng chuẩn hoá hiện không có mốc thời gian đồng nhất → chưa hiện; chỉ hiện số (critical, khớp huy hiệu thanh bên) + số "theo dõi".
4. Prototype ghi doanh thu luỹ kế lấy từ P3; DTO thật có ở **P4** `platformRevenue` → dùng P4.
5. P3 `ptHoldback`, `ptLocked`, `gymLocked` có trong DTO (audit 02) nhưng prototype chỉ có 9 ngăn → bản đồ có 10 dòng; nhãn "PT — tạm giữ" lấy từ `BUCKET_LABEL.HOLDBACK`.
6. Giữ nhóm "Quý" của tab cũ (backend hỗ trợ) dù spec S2 chỉ liệt kê ngày/tuần/tháng.
7. Layout `AdminFinancePage` (ngoài phạm vi B3) vẫn có h1 "Tài chính" và khung max-w-5xl; tab chỉ dùng h2 cho các khối. Đổi H1 thành "Tổng quan tài chính" + nút "Làm mới" ở header trang cần sửa file đó.
8. `KpiCard` không bị đụng (3 trang khác dùng; chip của nó vẫn có lỗi tương phản nền sáng đã biết) — `StatTile` là thành phần mới, dùng token `--st-*`/`--adm-*`.

## Ghi chú kỹ thuật
- "Hiện tại" ← P3, poll 60s; 409 kèm body xử lý trong `queryFn` (`reconciliationFromHttpError`), đánh dấu "mã 409" trong callout. Chip "Cân bằng" chỉ khi `balanced===true` VÀ drift = 0; lệch dưới 1 đồng hiện đủ số lẻ, không bao giờ "0 ₫" cạnh "Lệch sổ".
- P4 giữ nguyên khoá `["admin","finance-overview",group,from,to]`; `keepPreviousData` để giữ chiều cao khi đổi kỳ. Kỳ/nhóm nằm trên URL (`?period=&group=&from=&to=`).
- Hàng đợi dùng cùng khoá + cùng hàm gọi với huy hiệu thanh bên → chia sẻ cache. P7 đúng 100 dòng → "≥N".
- Tiền: `parseCents` (bigint, chuỗi Decimal) → `centsToDong` làm tròn khi hiển thị; không `Number()` trên tiền (chỉ `Number` để vẽ trục/độ rộng thanh).
- Máy dev có gateway thật ở :3000/:3005; lần chạy đầu của probe có socket chat đi qua proxy mặc định (bị từ chối vì JWT giả, không ghi gì) — đã chuyển proxy sang cổng chết cho mọi lần chạy chính thức.
