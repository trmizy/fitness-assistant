# 04 — Đặc tả prototype Admin (Phase 3)

Prototype **độc lập, tĩnh**, nằm ở `docs/admin-redesign/prototype/` — KHÔNG import từ `frontend/web`, không
nằm trong bundle production theo cấu trúc (Vite chỉ build `frontend/web/src`). Dữ liệu là **mẫu**, có băng
"DỮ LIỆU MẪU — PROTOTYPE" cố định trên đầu mọi màn.

Mục tiêu: Ngài duyệt **kiến trúc thông tin, mật độ, ngôn ngữ trạng thái tiền, chuyển động** trước khi sửa
mã thật. Không phải để tái sử dụng mã — khi hiện thực sẽ dùng `components/ui/*` có sẵn.

## 1. Kỹ thuật

- Tệp: `index.html`, `styles.css`, `data.js`, `app.js`. JS thuần (ES2020, không framework, không build).
  Không CDN script. Font: Google Fonts `Inter` (có fallback hệ thống) — cùng font app đang dùng.
- Định tuyến hash: `#/overview`, `#/finance`, `#/finance/reconciliation`, `#/finance/transactions`,
  `#/finance/transactions/<id>` (mở drawer trên bảng), `#/finance/withdrawals`. Back/forward phải đúng.
- Bộ lọc của bảng giao dịch ghi vào hash query (`#/finance/transactions?status=PAID&provider=VNPAY`).
- Token màu: chép giá trị **light** và **dark** từ `frontend/web/src/styles/theme.css` (`.light`/
  `[data-theme=light]` và `:root`) cho `--background --foreground --card --primary --accent --destructive
  --border --muted-foreground`. Prototype mặc định LIGHT; có nút chuyển dark (`data-theme`).
- Thêm token ngữ nghĩa MỚI (đề xuất cho theme.css sau này), mỗi token có cặp light/dark đạt AA:
  - Trạng thái: `--st-success`, `--st-warning`, `--st-danger`, `--st-info`, `--st-pending`, `--st-neutral`
    (+ `-bg` nhạt cho nền chip). Chip luôn có **chữ + icon**, không chỉ màu.
  - Trạng thái tiền (KHÁC trạng thái nghiệp vụ, KHÔNG dùng xanh lá):
    `--money-held` (tiền đang giữ hộ — indigo), `--money-pending` (chờ giải phóng — amber),
    `--money-available` (khả dụng — teal), `--money-locked` (đã khoá chờ chi — violet),
    `--money-out` (đã rời nền tảng — slate-blue), `--money-revenue` (doanh thu nền tảng — mực trung tính đậm).
  - Nút chính = `--primary` của app (emerald). "Khớp/cân bằng" = `--st-success` + icon ✓. Không màu nào
    dùng cho hai nghĩa.
- Số tiền: `Intl.NumberFormat('vi-VN')` + " ₫", `font-variant-numeric: tabular-nums`, cột tiền căn phải.
  Mọi số tiền trong `data.js` là **số nguyên đồng** (giống VND thực tế). Không count-up, không animate số dư.
  Giá trị lỗi/thiếu hiển thị "—" kèm lý do, **không bao giờ 0**.
- Ngày giờ: `dd/MM/yyyy HH:mm` giờ Việt Nam; cạnh biểu đồ ghi chú "Kỳ tính theo UTC (backend hiện tại)".

## 2. Shell (mọi màn)

- Sidebar trái 248px, **thu gọn được** thành rail 64px (nút ở chân sidebar, nhớ bằng localStorage có
  try/catch). Nhóm có tiêu đề nhỏ, mỗi mục có icon SVG nội tuyến + nhãn + **badge số việc chờ** nếu có:
  - (không tiêu đề) **Hôm nay** `#/overview`
  - **Tài chính**: Tổng quan tài chính · Đối soát · Giao dịch · Rút tiền · Hoàn tiền (mục Hoàn tiền trỏ
    `#/finance` và hiện toast "ngoài phạm vi prototype")
  - **Đối tác & người dùng**: Người dùng · Hồ sơ PT · Đối tác phòng gym · Chi nhánh · Tin đăng & tiện ích
  - **Khiếu nại & kiểm duyệt**: Tranh chấp buổi tập · Khiếu nại phòng gym · Chợ kế hoạch · Bài tập
  - **Hệ thống**: Giám sát hệ thống · Giám sát AI
  Mục ngoài phạm vi prototype: bấm → toast "Màn này giữ nguyên chức năng hiện tại, chỉ đổi vị trí điều
  hướng". Chỉ báo mục đang chọn là **một thanh dọc trượt** (transform translateY, 180ms) giữa các mục.
- Header: breadcrumb ngắn (Tài chính / Đối soát), tiêu đề trang, dòng phụ ngữ cảnh, bên phải: "Cập nhật
  lúc HH:mm:ss" + nút làm mới, nút theme, avatar.
- Trong nhóm Tài chính: thanh tab ngang dưới header (Tổng quan · Đối soát · Giao dịch · Rút tiền) với
  gạch chân trượt — đây là cấp 2. Cấp 3 = chip trạng thái / bộ lọc trong trang + drawer chi tiết.
- **Thanh "Kịch bản"** nổi góc dưới phải (chỉ có trong prototype): Bình thường · Đang tải · Lỗi máy chủ
  (500) · Không có quyền (403) · Dữ liệu cũ (>2 phút) · Lệch sổ. Mỗi kịch bản đổi UI tương ứng (mục 5).
- **Nút "Hiện nguồn dữ liệu"** (chỉ prototype): bật thì mỗi KPI/khối có nhãn nhỏ dạng
  `GET /admin/payments/reconciliation · escrow` hoặc `CẦN API MỚI · G-05` (màu cảnh báo). Mã G-xx lấy từ
  `audit/02_FINANCIAL_CONTRACT_AUDIT.md` §6.
- 390px: sidebar thành drawer (hamburger), tab cấp 2 cuộn ngang, padding 16px, không cuộn ngang trang.

## 3. Màn hình

### S1 — Hôm nay `#/overview`
Mục đích: admin biết ngay việc cần làm. Không KPI trang trí.
1. Dải "Việc cần xử lý" (lưới card, sắp theo độ khẩn): mỗi card = tên hàng đợi, số mục, mục cũ nhất bao lâu,
   tổng tiền nếu là hàng đợi tiền, nút đi tới. Hàng đợi: Rút tiền chờ duyệt (P7 PENDING) · Đã duyệt chờ chuyển
   khoản (P7 APPROVED) · Tranh chấp buổi tập (U1) · Yêu cầu hoàn tiền dịch vụ (A1) · Ngoại lệ đối soát cần xem
   (P13 + U2) · Hồ sơ PT chờ duyệt · Hồ sơ đối tác chờ duyệt · Chi nhánh chờ duyệt · Tin đăng chờ duyệt.
2. "Sức khoẻ sổ sách" một dòng: Cân bằng ✓ (hoặc Lệch X ₫ — đỏ) · Tiền đang giữ hộ · kiểm lúc … → Đối soát.
3. Hai card nhỏ nền tảng: Người dùng (tổng, mới 7 ngày — nguồn `/admin/dashboard`), Giám sát hệ thống
   (dịch vụ lỗi / tổng). Không hiển thị "+0 tháng này" hay số không có nguồn.

### S2 — Tổng quan tài chính `#/finance`
1. Băng **"Hiện tại"** (không phụ thuộc kỳ, ghi rõ "tính đến HH:mm"): Tiền đang giữ hộ (`escrow`) · Tổng quyền
   đòi của các bên (`claims`) · Chênh lệch (`drift`, chip Cân bằng/Lệch).
2. **Bản đồ tiền đang giữ** — một thanh ngang xếp chồng 100% = tiền đang giữ hộ, chia theo *ai đang có quyền
   đòi* và *ngăn*: Khách (ví) · PT chờ / khả dụng / đã khoá · Phòng gym chờ / khả dụng / đã khoá ·
   Nền tảng chờ / khả dụng. Màu theo `--money-*`. Dưới thanh là bảng số chính xác (cột tiền căn phải, %),
   hover/focus một đoạn thanh → làm nổi dòng bảng và ngược lại. Đây là phần thay cho Sankey.
3. Băng **"Trong kỳ"** với bộ chọn kỳ (7 ngày · 30 ngày · Tháng này · Tuỳ chọn) và nhóm (ngày/tuần/tháng):
   Tiền vào nền tảng (`totals.income`) · Tiền ra khỏi nền tảng (`totals.expense`, chú thích: "hoàn về ví
   khách chưa tính cho tới khi rút") · Doanh thu nền tảng đã thực hiện (`totals.netRevenue`).
   Biểu đồ cột đôi vào/ra theo kỳ (SVG tự vẽ, có trục, tooltip bàn phím được) + bảng kỳ thu gọn được.
   Đổi kỳ: biểu đồ và bảng giữ chiều cao, mờ 50% + shimmer 400ms rồi hiện dữ liệu mới.
4. **Doanh thu nền tảng luỹ kế** tách riêng khỏi băng kỳ: Đã hưởng (`platformRevenue.available`) · Còn chờ
   (`pending`) · "tính đến".
5. Hàng đợi tài chính (như S1 nhưng chỉ tiền), mỗi card có tổng tiền.

### S3 — Đối soát `#/finance/reconciliation` (đầu tư nhiều nhất)
Tab cấp 3 (chip): **Cân đối sổ** · **Ngoại lệ** · **Đối chiếu cổng ↔ Gymini** (badge "Đề xuất — cần API").
- *Cân đối sổ* (CÓ THẬT hôm nay): dạng "cầu" hai cột: trái "Tiền đang giữ hộ" = 1 số; phải "Quyền đòi" = các
  dòng cộng dồn → tổng; dưới cùng "Chênh lệch = 0 ₫ ✓". Danh sách ví âm (rỗng = "Không có ví âm ✓").
  Giải thích ngắn bất biến (thu gọn được, 200ms). Kịch bản "Lệch sổ": chênh lệch đỏ, panel "Nguyên nhân có
  thể & bước tiếp theo" (ví âm, ví lệch sổ cái, bút toán thiếu — liên kết sang tab Ngoại lệ), ghi chú
  "backend trả HTTP 409 kèm dữ liệu ở trạng thái này — UI vẫn hiển thị số".
- *Ngoại lệ*: danh sách nhóm ngoại lệ thay cho 22 khối: mỗi dòng = mức (Cần xem ngay / Theo dõi), tên dễ hiểu,
  số mục, mục cũ nhất, tổng tiền liên quan, nguồn (P13 / U2 / P2). Bấm → mở rộng danh sách mục (tối đa 5 +
  "xem tất cả"), mỗi mục có mã rút gọn + nút sao chép, người liên quan bằng TÊN.
- *Đối chiếu cổng ↔ Gymini* (PROTOTYPE của hợp đồng backend G-04/G-05/G-07): tóm tắt kỳ (nguồn: VNPay ·
  ZaloPay · PayOS, kỳ, số sự kiện cổng, số giao dịch Gymini, Khớp, Cần xem). Hai cột:
  trái **Từ cổng thanh toán** (sự kiện webhook/truy vấn: cổng, mã giao dịch của cổng, số tiền cổng báo,
  thời điểm, trạng thái cổng); phải **Trong Gymini** (giao dịch: mã, mục đích, số tiền, trạng thái, tổng bút
  toán đã ghi). Mỗi dòng có chip trạng thái khớp. Chọn một dòng một bên → dòng tương ứng bên kia nổi lên
  (cuộn tới, viền primary), các dòng khác mờ nhẹ; đường nối không cần.
  Panel so sánh ở dưới (trượt lên 220ms): số tiền cổng / Gymini / chênh lệch; **khoá khớp** (vd
  `providerTransactionId = vnp_TxnRef`, ✓/✗ từng khoá); chứng cứ (thời điểm callback, số lần gửi lại);
  nguyên nhân có thể; "Bước tiếp theo" là hướng dẫn chữ — **không có nút "Đánh dấu đã đối soát"**, thay bằng
  ghi chú "Ghi nhận xử lý cần API G-15 + nhật ký kiểm toán".
  Trạng thái khớp (ghi rõ cái nào là *suy ra hiển thị*): Khớp (khoá + số tiền) · Lệch số tiền (có thật:
  `metadata.gatewayDiscrepancy`) · Cổng có, Gymini không tìm thấy (suy ra: webhook `processedAt` null) ·
  Gymini đã thu, chưa thấy sự kiện cổng (suy ra) · Cổng gửi trùng (suy ra: nhiều event cùng mã) ·
  Chờ cổng xác nhận (PENDING). Chú giải trạng thái ở chân.
  390px: banner "Đối chiếu hai phía cần màn hình ≥ 1024px" + chế độ chỉ đọc một cột có công tắc Cổng/Gymini.

### S4 — Giao dịch + Hành trình tiền `#/finance/transactions[/<id>]`
- Thanh lọc: ô tìm mã chính xác, chip Trạng thái, Cổng, Mục đích, Kỳ; nút "Cột" (ẩn/hiện cột nâng cao).
  Cột mặc định: Thời gian · Mã (rút gọn + sao chép) · Người trả (tên) · Loại · Số tiền · Trạng thái · Cổng ·
  Liên quan. ~40 dòng mẫu, phân trang "Trang 1/3" kiểu server. Đổi lọc: bảng không biến mất (mờ + shimmer).
- Drawer phải 560px (390px: toàn màn) mở bằng bấm dòng / Enter; Esc đóng, focus quay lại dòng. Nội dung:
  1. Đầu: số tiền lớn, chip trạng thái, mục đích, cổng, mã đầy đủ + sao chép.
  2. **Hành trình tiền** (timeline dọc): Tạo thanh toán → Chuyển sang cổng → Cổng xác nhận → Trạng thái Gymini
     → Ghi sổ (tiền vào giữ hộ + chia 3 ngăn chờ) → Giải phóng theo buổi → (Kết thúc/hoàn tiền) → (Rút tiền).
     Mỗi bước: trạng thái bằng icon+chữ thuộc **5 loại phân biệt**: Đã xảy ra · Đang chờ · Không áp dụng ·
     Không đọc được dữ liệu · Thiếu bản ghi (bất thường); thời điểm; nguồn; mã tham chiếu; mức xác minh.
     Có một giao dịch mẫu cho mỗi biến thể: hợp đồng PT bình thường, hợp đồng bị chấm dứt có hoàn về ví,
     gói hội viên, giao dịch lệch số tiền, giao dịch PENDING, giao dịch PAID nhưng kích hoạt thất bại.
  3. **Phân chia**: tỷ lệ đóng băng lúc thanh toán (PT/gym/nền tảng) → số tiền từng bên, đã giải phóng / còn chờ.
  4. **Bút toán** (bảng Nợ/Có): ví · ngăn · Nợ · Có · số dư trước → sau · mô tả (đã dịch sang tiếng Việt).
  5. Liên quan: hợp đồng / gói, yêu cầu rút tiền, hoàn tiền.
  6. "Chi tiết kỹ thuật" thu gọn (mặc định đóng): idempotency key, providerTransactionId, metadata rút gọn
     (KHÔNG có redirectUrl — xem G-14).
  Mỗi mục 2–5 có nhãn nguồn khi bật "Hiện nguồn dữ liệu" (phần lớn là `CẦN API MỚI · G-05`).

### S5 — Rút tiền `#/finance/withdrawals`
Chip: Chờ duyệt · Đã duyệt – chờ chuyển khoản · Đã chuyển · Từ chối (hai chip cuối gắn "cần API G-08").
Dòng: người yêu cầu (tên + vai trò), số tiền, số khả dụng hiện tại, tuổi yêu cầu, thông tin nhận tiền.
Hành động trong dialog xác nhận (focus trap, Esc, trả focus):
- **Duyệt**: ghi rõ "Số tiền sẽ chuyển từ *khả dụng* sang *đã khoá*. Tiền CHƯA được chuyển." + số tiền + người.
- **Đã chuyển khoản**: bắt buộc nhập mã tham chiếu ngân hàng, hiện số tiền + người + "Thao tác này ghi tiền
  đã rời nền tảng, không hoàn tác được". Nút bận khi đang gửi (mô phỏng 800ms), chống bấm hai lần; kết quả
  thành công chỉ hiện sau khi "server" trả về.
- Mô phỏng 409 (đã được admin khác xử lý): thông báo cụ thể + tải lại dòng.

## 4. Chuyển động

Biến CSS: `--dur-press 100ms`, `--dur-fast 140ms`, `--dur-base 200ms`, `--dur-drawer 240ms`,
`--ease-out cubic-bezier(.2,0,0,1)`. Chỉ animate `transform`/`opacity`. Danh sách:
nav indicator trượt · tab gạch chân trượt · sidebar thu/mở (width + nhãn mờ) · hover/press nút và dòng ·
chip lọc · drawer trượt + nền mờ · panel so sánh trượt lên · dialog scale .98→1 + fade · mở rộng/thu gọn
(grid-template-rows 0fr→1fr) · loading giữ chiều cao + shimmer · chuyển trang fade 160ms.
KHÔNG: animate từng dòng bảng, count-up số, chặn click khi đang chạy hiệu ứng.
`@media (prefers-reduced-motion: reduce)`: mọi duration ≈ 0, bỏ shimmer, giữ đổi trạng thái tức thì.

## 5. Kịch bản trạng thái (thanh Kịch bản)

| Kịch bản | UI bắt buộc |
|---|---|
| Đang tải | skeleton đúng kích thước khối, không số 0 |
| Lỗi máy chủ 500 | từng khối: "Không tải được — lỗi máy chủ" + Thử lại + mã tham chiếu mẫu; hàng đợi KHÔNG hiện "không có yêu cầu" |
| 403 | "Tài khoản này không có quyền xem dữ liệu tài chính" — không hiện số |
| Dữ liệu cũ | chip vàng "Dữ liệu lúc HH:mm — đã cũ 3 phút" + làm mới; số vẫn hiện nhưng mờ nhẹ |
| Lệch sổ | S2/S3 chênh lệch đỏ, S1 dòng sức khoẻ đỏ, nguyên nhân + bước tiếp theo |

## 6. Truy cập

Landmark (`nav`, `main`, `aside`), `aria-current` cho nav, tab dùng `role=tablist` + phím mũi tên, bảng có
`<th scope>` và `aria-sort`, focus-visible rõ (vòng 2px primary), mọi icon-only button có `aria-label`,
vùng thông báo `aria-live=polite` cho toast, tương phản AA ở cả light và dark.

## 7. Chỉnh theo ảnh tham chiếu của Ngài (26/10) — batch P3-R

Nguồn quyết định: Master Plan §2.4. Ảnh tham chiếu: dashboard admin nền sáng (thẻ KPI có ô biểu tượng, panel
"Alertas" dạng dòng + viên đếm, panel hoạt động gần đây, sidebar nhóm có mục chọn nền xám). **Chỉ đổi trình bày —
nội dung, kịch bản và mọi logic tiền giữ nguyên; THÊM nhãn mức đối soát L1/L2/L3 (L3 = BLOCKED) và `DESIGN EXPLORATION — EXTERNAL DATA SOURCE NOT IMPLEMENTED` theo brief Dispute V2.1 B3 (prototype cũ chưa có các nhãn này).**

### 7.1 Token (styles.css)
Light: nền trang `#f7f8fa`, thẻ `#fff`, viền `#e6e8ec`, bóng `0 1px 2px rgba(16,24,40,.05)`, bo thẻ 12, bo nút/ô 10.
Ô biểu tượng 40×40, bo 10, nền = màu ngữ nghĩa 10–12 %, icon = màu đậm. Màu ô biểu tượng: info (xanh dương),
warning (hổ phách), danger (đỏ), neutral (xám); xanh lá Gymini chỉ cho logo/nút hành động chính. H1 26–28/700,
số KPI 28–32/700 `font-variant-numeric: tabular-nums`. Dark: giữ, ánh xạ cùng vai trò. Không gradient, không glass.

### 7.2 Shell
- Topbar mảnh (cao ~56): ngữ cảnh/breadcrumb trái; phải: "Cập nhật lúc …".
- Header trang: H1 + phụ đề xám + nút viền "Làm mới" (icon + chữ) bên phải.
- Sidebar: ô logo Gymini + "Gymini · Quản trị"; nhãn nhóm chữ hoa xám nhỏ; mục chọn = nền xám bo tròn, chữ đậm,
  **bỏ vạch xanh trái**; giữ viên đếm việc chờ; danh sách cuộn riêng; đáy sidebar: "Đổi giao diện" + thẻ người dùng
  (avatar chữ, tên, email, mũi tên). Bỏ nút theme/avatar khỏi topbar. Thu gọn thành rail vẫn hoạt động.

### 7.3 S1 Hôm nay (bố cục mới)
1. Hàng 4 `StatTile`: Cần xử lý về tiền (số mục + tổng tiền **chỉ cộng rút đã duyệt + hoàn dịch vụ**; ngoại lệ chỉ
   đếm — chú thích ghi rõ), Rút tiền chờ duyệt (số + tổng), Hồ sơ chờ duyệt (PT + đối tác + chi nhánh + tin đăng),
   **Cân đối sổ ví (ESCROW = Σ quyền đòi)** — Cân bằng / Lệch X ₫ (kịch bản lệch sổ đổi ô sang danger); chú thích ghi phạm vi: chỉ so số dư các ví với ví giữ hộ, KHÔNG phải kết luận sức khoẻ toàn hệ thống (không kiểm cổng, quyết toán, nghĩa vụ treo).
2. Hàng 4 chỉ số gọn (icon trái): Người dùng, Mới 7 ngày, Dịch vụ đang chạy (x/y), Tranh chấp đang mở.
3. Hai cột: **Việc cần xử lý** (`AttentionList`: dòng nền xám nhạt bo góc, tên + "cũ nhất …" + viên đếm phải, tiền
   đứng trước, mỗi dòng là link tới màn tương ứng) | **Mục mới tạo gần nhất trong các hàng đợi** (`RecentQueueList`: nhãn loại
   dạng viên nhỏ + tên/đối tượng đậm + chú thích + thời gian phải, đường kẻ mảnh; cuối panel ghi "Nguồn: mục mới nhất
   của từng hàng đợi theo `createdAt`, đọc từ tập kết quả có giới hạn của mỗi hàng đợi — không phải mọi sự kiện gần đây, chưa có nhật ký hoạt động (G-23)").
4. Bỏ 9 thẻ hàng đợi lớn viền đỏ cũ và khối "Nền tảng" cũ (đã gộp vào hàng 2).
Trạng thái tải/500/403/dữ liệu cũ áp cho từng ô: lỗi → "—" + lý do, không "0".

### 7.4 S2 Tổng quan tài chính
- 3 thẻ "Hiện tại" và 3 thẻ "Trong kỳ" thành `StatTile` có ô biểu tượng (tiền giữ hộ = info, quyền đòi = neutral,
  chênh lệch = success/danger theo `balanced`; tiền vào = info, tiền ra = neutral, doanh thu đã thực hiện = info).
  Giữ nguyên chú thích nghĩa (vd "Cộng cả nạp ví khách (backend hiện tính vậy)").
- "Hàng đợi tài chính" (4 thẻ viền đỏ) → `AttentionList` như S1.
- Bản đồ tiền giữ hộ + biểu đồ vào/ra: giữ nội dung, khung thẻ theo token mới.

### 7.5 S3–S5 + drawer
Áp shell, thẻ, bảng (header xám nhạt `#f3f4f6`, dòng gọn 44–48, số căn phải tabular), viên trạng thái theo
ngữ nghĩa. Không đổi nội dung, nhãn mức đối soát, kịch bản, dialog, 409 cứng của w4.

### 7.6 Bất biến phải còn nguyên (kiểm khi nghiệm thu)
Giao dịch callback sai số tiền = **Thất bại** + `gatewayDiscrepancy`, không ghi sổ · 409 = có lệch, không phải lỗi
tải · đã duyệt ≠ đã chuyển · không nút "Đã đối soát" · không count-up · banner "DỮ LIỆU MẪU — PROTOTYPE" · đủ 6
kịch bản · nút "Hiện nguồn dữ liệu" gắn nguồn cho mọi số mới (S1 hàng 1–2 dùng nguồn bảng bổ sung ở Master Plan §3).
