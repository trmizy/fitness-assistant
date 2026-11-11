# ADMIN REDESIGN MASTER PLAN — Gymini

Ngày lập: 26/10/2026 · Trạng thái: **GATE A ĐÃ DUYỆT 26/10 (D1, D6, D7, D8) — đang B1; tranh chấp do phiên khác làm (B6b ngoài phạm vi)** · (lịch sử: CHỜ DUYỆT GATE A — đã nhận ảnh tham chiếu của Ngài (26/10), prototype được
chỉnh theo §2.4 (batch P3-R)** · Kế hoạch này lập MỘT lần; sau khi duyệt, chỉ cập nhật cột Trạng thái/Bằng chứng
của từng batch. Phiên nhận bàn giao (26/10 chiều) chỉ sửa tại chỗ, không viết kế hoạch mới.

Tài liệu đi kèm (đều nằm trong `docs/admin-redesign/`):

| Tệp | Nội dung | Nhãn bằng chứng |
|---|---|---|
| `audit/01_ADMIN_FRONTEND_INVENTORY.md` | 15 route, 66 chức năng ADM-xx, ~45 thao tác ghi, 16 phát hiện UX | CODE AUDIT |
| `audit/02_FINANCIAL_CONTRACT_AUDIT.md` | 28 endpoint admin, hợp đồng dữ liệu từng trường tiền, thực trạng đối soát, chuỗi truy vết, 22 khoảng trống G-01..G-22 | CODE AUDIT |
| `audit/03_REFERENCE_ANALYSIS.md` | Modern Treasury, Stripe, Adyen, Matcha, Mint, Tremor, Formance — pattern giữ/bỏ, giấy phép | PUBLIC DOCS |
| `04_PROTOTYPE_SPEC.md` | Đặc tả 5 màn prototype, token, chuyển động, kịch bản lỗi | — |
| `prototype/` + `review/` | Prototype HTML độc lập, ảnh 1440/1920/390, video tương tác | MOCK BROWSER TEST (không phải REAL FINANCIAL E2E) |
| Ảnh tham chiếu của Ngài (26/10) | Dashboard admin nền sáng "Panel de Administracion" — chỉ dùng làm hướng visual (§2.4), không chép thương hiệu/dữ liệu | — |

---

## 0. Phase 0 — Baseline & an toàn (ĐÃ LÀM)

| Mục | Kết quả |
|---|---|
| Repo / nhánh / HEAD | `D:/FitnessAssistant`, `feature/payment-gateways`, `78eba2a5` |
| Worktree khác | `D:/fa` (detached 47c4b229), `D:/fitness-assistant-frontend-upgrade` (frontend-upgrade — **kế hoạch cũ, Ngài đã bỏ**), `D:/g27` (detached 02bb021e, build app) |
| Tệp đã track đang sửa | `docs/FULL_SYSTEM_TEST_REPORT_2026-10-07.md`, `frontend/web/.../partner-application/PartnerApply{,Verify}Page.tsx` — **của phiên khác**, ngoài phạm vi Admin, không đụng |
| Backend | Sạch so với HEAD → mọi API trong audit 02 có ở HEAD, không có API "chỉ tồn tại trong working tree" |
| Ranh giới sở hữu | ai-service / fitness-service thuộc partner (chỉ đọc). payment/user/gym-service + gateway + web: nhóm này |
| Đã ghi trong lượt này | Chỉ thư mục mới `docs/admin-redesign/**`. Không sửa mã, không commit, không chạy DB/stack |

**Nhánh khi bắt đầu hiện thực (B0):** tạo worktree `D:/admin-fr` nhánh `admin-finance-redesign` từ `78eba2a5`
(không đụng cây chính, không mang theo PartnerApply* dirty). node_modules: junction về cây chính như `D:/g27`. Nếu sau này buộc phải cài gói: chạy preflight chỉ đọc trước (`packageManager`, hash lockfile, các script `pre/post/install` và `prepare`, `patchedDependencies`, junction `D:/.rn*`, không có phiên Metro/Expo/Gradle nào đang chạy), không dùng `npx -y`, luôn `--frozen-lockfile`.
Phải hỏi lại Ngài nếu đến lúc đó HEAD đã đổi.

---

## 1. Kết luận audit (tóm tắt — chi tiết ở 01/02)

### 1.1 Chức năng Admin hiện có
- 15 trang, sidebar phẳng 15 mục, một vai trò `admin` duy nhất. 66 chức năng: **57 IMPLEMENTED, 9 PARTIAL**,
  0 UI ONLY nguyên trang (riêng "+0 tháng này" ở Dashboard là chữ cứng), 10 wrapper API không có UI (NOT VERIFIED).
- ~45 thao tác ghi, chỉ ~12 có xác nhận. 5 thao tác **chuyển tiền thật**: hoàn tiền gói hội viên (dán UUID ở
  Dashboard), duyệt hoàn tiền dịch vụ cá nhân hoá, đánh dấu đã chi rút tiền, phân xử tranh chấp buổi tập,
  chấm dứt đối tác có hoàn tiền.

### 1.2 Kiến trúc tiền (nguồn sự thật = payment-service)

```
Cổng (VNPay/ZaloPay/PayOS/MoMo) ──webhook/poll──▶ PaymentTransaction (PAID, khoá: id = transactionId)
        │ payment_webhook_events (payload thô, KHÔNG FK, KHÔNG có API admin)
        ▼
  ESCROW.available += P   ─┬─ PT.pending      += ptRate·P      (tỷ lệ đóng băng ở metadata.rates)
   (tiền mặt đang giữ)     ├─ GYM.pending     += gymRate·P
                           └─ REVENUE.pending += phần còn lại
  Mỗi buổi xác nhận:  pending → available (ESCROW không đổi)
  Chấm dứt/hoàn:      vét pending, CLIENT.available += refund (vẫn trong ESCROW — chưa rời nền tảng)
  Rút tiền:  approve: available → locked │ markPaid: locked −X và ESCROW −X (tiền RỜI nền tảng, PaymentTransaction WITHDRAWAL)
Bất biến:   ESCROW.available = Σ(pending+available+locked+holdback) của mọi ví khác  →  GET /admin/payments/reconciliation
```

- **Mức đối soát (theo brief Dispute V2.1 B3):** L1 = bất biến sổ nội bộ (có); L2 = callback/IPN do hệ thống tự lưu (có trong bảng webhook, chưa có API — không phải xác minh độc lập); L3 = báo cáo độc lập từ PSP/ngân hàng → **BLOCKED** (không gọi là "một phần"). Mỗi màn đối soát ghi rõ nguồn và mức.
- **Đối soát hôm nay chỉ là bất biến nội bộ** (cột số dư ví với nhau). Không có: dữ liệu quyết toán của cổng,
  phí cổng, net, chargeback, trạng thái "đã đối soát", lịch sử lần đối soát. Sai lệch số tiền cổng có lưu
  (`metadata.gatewayDiscrepancy`) nhưng không có quy trình xử lý (`resolved` luôn false).
- Bút toán nối với giao dịch bằng FK tin cậy (`wallet_ledger_entries.transaction_id`), nhưng **không có API admin
  nào đọc bút toán, chi tiết giao dịch, danh sách ví, hay lịch sử rút tiền**. Danh sách giao dịch = 200 dòng mới
  nhất, không lọc, không phân trang, trả cả `metadata.redirectUrl`.
- Hoàn tiền hiện nay = **ghi có vào ví khách** (không trả về thẻ). Tiền chỉ rời nền tảng khi khách rút.

### 1.3 🔴 Phát hiện cần Ngài quyết (không tự sửa — backend chưa được phép)

| ID | Phát hiện | Mức | Đề xuất |
|---|---|---|---|
| G-03 | `POST /admin/payments/:id/refund` lấy `adminId` từ **body** (giả mạo được người thực hiện trong nhật ký) và sinh idempotency key ngẫu nhiên mỗi lần (bấm đúp → 2 lần thử đảo tiền). Endpoint trả 400 cho mọi giao dịch qua cổng hiện nay — chỉ dữ liệu cũ dùng được; **frontend không gọi nó**. | P0 bảo mật/tiền | Phương án A (khuyến nghị): khoá endpoint thành 410 như `commissions/settle` — nhỏ, không ai dùng. B: sửa dùng `req.user.userId` + `Idempotency-Key` + CAS. |
| G-01/G-02 | Một vai trò ADMIN: ai là admin cũng duyệt + chi rút tiền, hoàn tiền, phân xử. Không có bốn mắt qua HTTP. | P0 kiểm soát | Quyết định nghiệp vụ: có cần quyền `finance:*` và người chi ≠ người duyệt không? Nếu có → batch BE-2. |
| ADM-03/25/27/30 | Thao tác chuyển tiền không có hộp xác nhận/xem trước số tiền; duyệt hoàn tiền không kiểm `≤ trần` phía client (backend có kiểm? NOT VERIFIED). | P0 UX tiền | Batch B1 (chỉ frontend) — làm trước redesign. |

---

## 2. Kiến trúc thông tin mới

### 2.1 Phản biện đề xuất "6 workspace + điều hướng cấp 2"

Admin chỉ có 15 trang. Chia 6 workspace mà mỗi workspace ẩn mục con sau một cú bấm = trung bình 2,5 trang/
workspace và **thêm một cú bấm cho mọi lần chuyển**; "Vận hành" và "Kiểm soát & Rủi ro" chồng nhau (tranh chấp
buổi tập vừa là vận hành vừa là tiền). Khuyến nghị:

- **Cấp 1 = sidebar nhóm** (5 nhóm có tiêu đề, luôn thấy mọi mục, có badge số việc chờ, thu gọn được thành rail
  icon). Biết mình ở đâu nhờ nhóm + chỉ báo; không mất cú bấm.
- **Cấp 2 = tab ngang dưới header CHỈ ở Tài chính** (nơi duy nhất có ≥5 màn liên quan chặt) — mỗi tab là một route.
- **Cấp 3 = chip trạng thái / bộ lọc trong trang (ghi vào URL) + drawer chi tiết** (`?id=`), không route con thừa.
- "Tổng quan" đổi thành **"Hôm nay"**, bố cục theo ảnh tham chiếu (§2.4) nhưng vẫn đặt việc cần làm lên đầu:
  (1) 4 ô KPI có ô biểu tượng: *Cần xử lý về tiền* (đã duyệt chờ chuyển + ngoại lệ đối soát + hoàn tiền dịch vụ: số
  mục + tổng), *Rút tiền chờ duyệt*, *Hồ sơ chờ duyệt* (PT + đối tác + chi nhánh + tin đăng), *Cân đối sổ ví (ESCROW = Σ quyền đòi)*
  (cân bằng/lệch theo hợp đồng 409 — chỉ phạm vi số dư ví, không phải sức khoẻ toàn hệ thống); (2) 4 chỉ số gọn: người dùng, người dùng mới 7 ngày, dịch vụ đang chạy,
  tranh chấp đang mở; (3) hai panel: **"Việc cần xử lý"** (danh sách dòng xám có viên đếm, tiền đứng trước, mỗi dòng
  dẫn tới hàng đợi) và **"Mục mới tạo gần nhất trong các hàng đợi"** (mục `createdAt` mới nhất trong tập kết quả có giới hạn của từng hàng đợi hiện có — không phải nhật ký
  hoạt động, G-23). Mọi con số phải có dòng ở §3; không có API thì không hiện.
- Command palette: không làm (chưa có lợi rõ). Tìm theo mã chính xác đặt trong Tài chính → Giao dịch.

### 2.2 Sơ đồ

```
Hôm nay                                  /admin/dashboard (giữ URL)
Tài chính ── [Tổng quan | Đối soát | Giao dịch* | Rút tiền | Hoàn tiền]
             Đối soát: chip [Cân đối sổ (L1) | Ngoại lệ (L1) | Đối chiếu cổng↔Gymini* — DESIGN EXPLORATION]
             Rút tiền: chip [Chờ duyệt | Đã duyệt – chờ chuyển | Đã chuyển* | Từ chối*]
             Hoàn tiền: chip [Dịch vụ cá nhân hoá | Gói hội viên (ngoại lệ)]
Đối tác & người dùng ── Người dùng · Hồ sơ PT · Đối tác phòng gym · Chi nhánh · Tin đăng & tiện ích
Xử lý vụ việc (Case Management) ── Tranh chấp buổi tập · Khiếu nại phòng gym · Chợ kế hoạch · Bài tập (trùng lặp + chất lượng)
             (hàng đợi vụ việc PT / Gym / MEM, an toàn, bế tắc — theo DISPUTE_CASE_DESIGN_V2_1, CHƯA duyệt; Gate A chỉ có layout
             Case Workspace nhãn DESIGN EXPLORATION — DISPUTE CASE V2.1 NOT APPROVED, không hành động tiền)
Hệ thống ── Giám sát hệ thống · Giám sát AI
(* = cần API mới, xem §6)
```

Ghi chú: "Tổng quan Gym" (`/admin/gym-management`) thành trang đầu của "Đối tác phòng gym" (giữ URL, đổi vị trí).
"Duyệt bài tập trùng lặp" + "Ma trận chất lượng catalog" gộp nhãn nhóm "Bài tập" (2 tab, giữ 2 URL). "Sổ cái"
**không thành trang riêng**: xem bút toán trong drawer giao dịch (và trang ví khi có G-09) — tránh nổ trang.
"Báo cáo" gộp vào Tài chính → Tổng quan (bộ chọn kỳ + bảng kỳ); xuất CSV chờ endpoint có quyền (G-04).

### 2.3 Ánh xạ route cũ → mới

| Route cũ | Nav cũ | Vị trí mới | Trang/tab | Quyền | Deep link | Rủi ro |
|---|---|---|---|---|---|---|
| /admin, /admin/dashboard | Tổng quan | Hôm nay | — | admin | giữ | Thấp — nội dung đổi, thẻ hoàn tiền hội viên chuyển sang Tài chính → Hoàn tiền |
| /admin/finance?tab=overview | Tài chính | Tài chính | /admin/finance | admin | giữ; `?tab=overview` → redirect | Thấp |
| /admin/finance?tab=reconciliation | Tài chính | Tài chính › Đối soát | /admin/finance/reconciliation`?view=ledger\|exceptions\|gateway` | admin | redirect từ `?tab=` | Trung bình — tách 22 khối thành danh sách ngoại lệ; phải giữ đủ 22 nhóm (kiểm đếm) |
| /admin/finance?tab=withdrawals, /admin/withdrawals | Tài chính | Tài chính › Rút tiền | /admin/finance/withdrawals`?status=` | admin | 2 redirect cũ giữ, trỏ route mới | Trung bình — thao tác tiền |
| /admin/finance?tab=refunds, /admin/pt-service-refunds | Tài chính | Tài chính › Hoàn tiền | /admin/finance/refunds`?type=service\|membership` (B6a dùng `type`) | admin | redirect | Trung bình |
| — | — | Tài chính › Giao dịch | /admin/finance/transactions`?q&status&provider&purpose&from&to&id=` | admin (+finance:read nếu BE-2) | mới | Phụ thuộc G-04/G-05 |
| /admin/users | Người dùng | Đối tác & người dùng | giữ | admin | giữ + `?id=` cho chi tiết | Thấp |
| /admin/pts | Quản lý PT | Đối tác & người dùng › Hồ sơ PT | giữ | admin | thêm `?id=` (hiện là useState) | Thấp |
| /admin/gym-management | Tổng quan Gym | Đối tác phòng gym (trang đầu) | giữ | admin | giữ | Thấp |
| /admin/partners | Đối tác | Đối tác phòng gym | giữ, `?view=&id=&tab=` | admin | thêm URL state | Trung bình — file 1.174 dòng |
| /admin/gyms | Chi nhánh | Chi nhánh | giữ, `?tab=` | admin | thêm URL state | Thấp |
| /admin/listings | Tin đăng & tiện ích | giữ | giữ (đã có `?tab`,`?rid`) | admin | giữ | Thấp |
| /admin/disputes | Khiếu nại buổi tập | Xử lý vụ việc › Tranh chấp buổi tập | giữ | admin | thêm `?id=` | Trung bình — phân xử có tiền; **luồng phán quyết không đổi cho tới khi V2.1 được duyệt** |
| /admin/complaints | Khiếu nại | Xử lý vụ việc › Khiếu nại phòng gym | giữ | admin | giữ | Thấp |
| /admin/marketplace | Chợ kế hoạch | › Chợ kế hoạch | giữ | admin | giữ | Thấp (ai-service: chỉ frontend) |
| /admin/exercise-review, /admin/catalog-quality | 2 mục riêng | › Bài tập (2 tab) | giữ 2 URL | admin | giữ | Thấp |
| /admin/system | Giám sát hệ thống | Hệ thống | giữ | admin | giữ | Thấp |
| /admin/ai-observability | Giám sát AI | Hệ thống | giữ, `?tab=` | admin | thêm URL state | Thấp |

Quy tắc: **không route cũ nào thành 404**; mọi redirect là `<Navigate replace>` giữ query; quyền vẫn là
`RequireRole admin` + backend (ẩn nút ≠ phân quyền).

### 2.4 Hướng visual — theo ảnh tham chiếu của Ngài (26/10)

| Yếu tố trong ảnh | Quyết định |
|---|---|
| Topbar mảnh chứa ngữ cảnh trang; dưới là H1 đậm + phụ đề xám + nút viền "Làm mới" bên phải | **Theo**: topbar mảnh (breadcrumb/ngữ cảnh), header trang = H1 + phụ đề + "Cập nhật lúc …" + nút viền |
| Thẻ KPI: nhãn xám, số lớn đậm, chú thích nhỏ, **ô biểu tượng màu nhạt góc phải**; thẻ trắng, viền mảnh + bóng rất nhẹ, bo ~10–12 | **Theo**, nhưng màu ô biểu tượng theo **ngữ nghĩa** (info xanh dương / warning hổ phách / danger đỏ / neutral xám); xanh lá Gymini chỉ cho thương hiệu/hành động. Bỏ viền đỏ trái của thẻ hàng đợi |
| Hàng chỉ số gọn (biểu tượng trái + số + chú thích) | **Theo có chọn lọc**: chỉ số có API |
| Panel "Alertas": dòng xám bo góc + viên đếm bên phải | **Theo**: "Việc cần xử lý" dạng danh sách viên đếm (dùng lại ở Tổng quan tài chính cho hàng đợi tài chính) |
| Panel "Actividad Reciente": nhãn + tên đậm + chú thích + thời gian phải | **Theo bố cục**; dữ liệu = mục mới nhất của các hàng đợi hiện có, ghi rõ nguồn. Nhật ký hoạt động thật cần backend (G-23) |
| Sidebar: ô logo + tên, nhãn nhóm chữ hoa xám, icon nét, **mục đang chọn = nền xám bo tròn (không vạch trái)**, cuối có "Đổi giao diện" + thẻ người dùng (avatar, email, mũi tên), danh sách cuộn riêng | **Theo**; giữ thêm viên đếm việc chờ (tốt hơn ảnh) |
| Thương hiệu tím, logo | **Không theo** — giữ màu và logo Gymini |
| Số tiền "$ 4325000" không phân nhóm | **Không theo** — `590.800.000 ₫`, số tabular, căn phải trong bảng |
| Nút chat nổi | **Không theo** |

Token visual (prototype; thành `--st-*`/`--money-*` trong `theme.css` nếu quyết định 7 được duyệt): nền trang
`#f7f8fa`, thẻ `#fff`, viền `#e6e8ec`, bóng `0 1px 2px rgba(16,24,40,.05)`, bo 10/12; ô biểu tượng 40×40 bo 10,
nền = màu 10–12 %, icon = màu đậm; H1 26–28/700; số KPI 28–32/700 tabular; Inter. Chế độ tối vẫn giữ (nút người
dùng). Chi tiết từng màn: `04_PROTOTYPE_SPEC.md` §7.

---

## 3. Financial Data Contract Matrix (các con số sẽ hiển thị ở MVP)

Quy ước chung: tiền VND, JSON là **chuỗi Decimal** (raw row có thể `"100000"` hoặc `"100000.5"`, báo cáo
`toFixed(2)`) → parse bằng một hàm duy nhất `parseMoney(string) → bigint đồng` (làm tròn theo backend: không làm
tròn trung gian, hiển thị 0 chữ số lẻ). Không `Number()` trực tiếp. Lỗi/thiếu → "—" + lý do, không bao giờ 0.
Thời gian ISO UTC → hiển thị giờ VN. Mọi số "hiện tại" ghi "tính đến HH:mm"; poll ghi "cập nhật lúc".

| UI | Ý nghĩa nghiệp vụ | Service · API | Trường DTO | Thời gian | Quy tắc trạng thái / loại trừ | Nguồn sự thật | Đã kiểm? |
|---|---|---|---|---|---|---|---|
| Tiền đang giữ hộ | Mọi đồng đã nhận qua cổng chưa chi ra | payment · P3 `GET /admin/payments/reconciliation` | `escrow` | hiện tại | chỉ ESCROW.available; HTTP **409 vẫn có body** khi lệch | ví ESCROW | CODE AUDIT |
| Tổng quyền đòi | Phần của khách/PT/gym/nền tảng trên số tiền đó | P3 | `claims` | hiện tại | gồm pending+available+locked+holdback, cả REVENUE | ví | CODE AUDIT |
| Chênh lệch sổ | escrow − claims; ≠0 = sổ không đáng tin | P3 | `drift`, `balanced` | hiện tại | 409 ≠ lỗi tải | tính live | CODE AUDIT |
| Bản đồ tiền giữ hộ (từng đoạn) | Ai đang có quyền đòi, ở ngăn nào | P3 | `breakdown.clientBalances, ptPending, ptAvailable, ptLocked, ptHoldback, gymPending, gymAvailable, gymLocked, platformRevenuePending, platformRevenueAvailable` | hiện tại | `clientBalances` gộp mọi ngăn của khách | ví | CODE AUDIT |
| Ví âm | Lỗi sổ, luôn phải rỗng | P3 | `negativeWallets[]` | hiện tại | tên người cần lookup (G-09) | ví | CODE AUDIT |
| Tiền vào nền tảng (kỳ) | PAID mọi mục đích trừ REFUND/WITHDRAWAL | P4 `GET /admin/payments/finance-overview` | `totals.income`, `buckets[].income` | `paidAt`, **bucket UTC** | **gồm WALLET_TOPUP cũ** (G-18) | PaymentTransaction | CODE AUDIT (`finance-report.service.ts:84`) |
| Tiền ra khỏi nền tảng (kỳ) | REFUND+WITHDRAWAL đã PAID | P4 | `totals.expense` | `paidAt` UTC | hoàn về ví khách **không** tính tới khi rút — ghi chú dưới số | PaymentTransaction | CODE AUDIT (`:91`) |
| Doanh thu nền tảng đã thực hiện (kỳ) | CREDIT−DEBIT ngăn AVAILABLE của ví REVENUE | P4 | `totals.netRevenue` | `createdAt` bút toán, UTC | trừ purpose WITHDRAWAL; pending không tính | sổ cái | CODE AUDIT (`:56-64,102`) |
| Doanh thu nền tảng luỹ kế: đã hưởng / còn chờ | Số dư ví REVENUE | P4 | `platformRevenue.available/pending/asOf` | hiện tại | **không theo kỳ — tách khỏi băng kỳ** | ví REVENUE | CODE AUDIT |
| Rút tiền chờ duyệt: số, tổng | Yêu cầu PENDING | P7 `GET /admin/payments/withdrawals` | lọc `status=PENDING`, Σ`amount` | `createdAt` | trần 100 dòng → nếu =100 ghi "≥100" | WithdrawalRequest | CODE AUDIT |
| Đã duyệt – chờ chuyển khoản | APPROVED (tiền đã khoá) | P7 | `status=APPROVED` | `reviewedAt` | ≠ đã chuyển | WithdrawalRequest + ví locked | CODE AUDIT |
| Số khả dụng của người rút | để admin so khi duyệt | **không có** | — | — | BACKEND GAP G-08 (`walletAvailableNow`) → MVP không hiện | ví | — |
| Ngoại lệ đối soát (nhóm, số, cũ nhất) | Nghĩa vụ treo, ví lệch, đã trả chưa kích hoạt… | P13 `GET /admin/payments/obligations` + U2 `GET /admin/sessions/reconciliation` | `summary.*`, các list, `truncated` | `generatedAt` | giữ đủ 22 nhóm hiện có; `truncated` phải hiện | payment + user-service | CODE AUDIT |
| Sai lệch số tiền cổng | Cổng báo số khác số Gymini | P2 `GET /admin/payments/gateway-discrepancies` | `metadata.gatewayDiscrepancy{expectedAmountVnd, reportedAmountVnd, provider, gatewayTransactionNo, occurrences, firstDetectedAt}` | `firstDetectedAt` | `resolved` không bao giờ true → hiện "chưa có quy trình xử lý" | PaymentTransaction.metadata | CODE AUDIT |
| Tranh chấp chờ phán quyết + tiền liên quan | | U1 + U2 `disputes.items[].amountAtStake` | | `disputedAt` | `amountAtStake` là JS number → format, không tính tiếp | user-service | CODE AUDIT |
| Hoàn tiền dịch vụ: đã trả / đã hoàn / trần | | ai-service A1/A2 | `totalPaid, alreadyRefunded, refundableCeiling` | — | **Float** (G-17) → chỉ hiển thị, chặn nhập > trần | ai-service (partner) | CODE AUDIT |
| Giao dịch, chi tiết, bút toán, webhook | | **cần** G-04/G-05 | — | — | MVP: KHÔNG làm explorer trên P1 (lộ redirectUrl, 200 dòng) | — | — |

**Bổ sung cho "Hôm nay" (§2.1, §2.4) — phi tài chính, trường DTO chính xác: TO VERIFY ở B2/B3 trước khi nối API**

| UI | Ý nghĩa | Nguồn (audit 01) | Ghi chú bắt buộc | Đã kiểm? |
|---|---|---|---|---|
| Cần xử lý về tiền (số + tổng) | APPROVED chờ chuyển + nhóm ngoại lệ cần xem + hoàn tiền dịch vụ chờ | P7 + P13/U2 + A1 (các dòng trên) | tổng chỉ cộng **cùng loại tiền cùng nghĩa** (số tiền rút đã duyệt + hoàn dịch vụ); ngoại lệ chỉ đếm, không cộng tiền | CODE AUDIT (nguồn) |
| Hồ sơ chờ duyệt | PT + đối tác + chi nhánh + tin đăng | `GET /pt-applications/admin?status=` (ADM-08), `GET /admin/partners/overview-stats` (ADM-50), `GET /admin/gyms` (ADM-51), listings queue (ADM-71) | đếm theo từng nguồn, một nguồn lỗi → ô đó "—" + lý do, không tính 0 | TO VERIFY |
| Người dùng / mới 7 ngày | | `GET /admin/dashboard` (ADM-01) | màn cũ `|| 0` biến lỗi thành 0 — **không chép lại** | TO VERIFY |
| Dịch vụ đang chạy | | trang Giám sát hệ thống (audit 01) | | TO VERIFY |
| Tranh chấp đang mở | | `GET /admin/sessions/disputed` (ADM-32) | | CODE AUDIT (nguồn) |
| Mục mới tạo gần nhất trong các hàng đợi | mục `createdAt` mới nhất trong tập kết quả có giới hạn của từng hàng đợi trên (không phải thời điểm hoạt động gần nhất) | các nguồn trên | **suy ra**, ghi "Nguồn: hàng đợi …"; không phải nhật ký hoạt động (G-23) | — |

---

## 4. Luồng H/A/E và ca kiểm thử (P0/P1 trước)

Tier: T1 = frontend/mock, T2 = backend integration trên `*_test`, T3 = financial E2E trên stack seed cô lập.
Tất cả hiện **NOT RUN** trừ khi ghi khác.

| Case | Tiền điều kiện | Actor | Trigger | API | Trạng thái hệ thống mong đợi | UI mong đợi | Khôi phục | Tier |
|---|---|---|---|---|---|---|---|---|
| H-01 | Sổ cân bằng | admin | mở Tài chính | P3, P4 | — | Cân bằng ✓, bản đồ tiền = 100% escrow | — | T1, T3 |
| H-02 | 1 yêu cầu rút PENDING | admin | Duyệt → xác nhận | P8 | available→locked, ESCROW không đổi | dialog nêu "tiền CHƯA chuyển", sau đó chip "Đã duyệt – chờ chuyển" | — | T1, T2, T3 |
| H-03 | yêu cầu APPROVED | admin | Đã chuyển khoản + mã NH | P10 | locked−X, ESCROW−X, PaymentTransaction WITHDRAWAL | chỉ báo thành công sau 200; P3 vẫn cân bằng | — | T2, T3 |
| H-04 | đơn REFUND_REQUESTED | admin | Duyệt hoàn ≤ trần | A3 | ví khách +X (key `PERSONALIZED_REFUND:<id>:<X>`) | dialog nêu "hoàn vào ví khách", số, trần | — | T1, T3 |
| A-01 | không có giao dịch trong kỳ | admin | chọn kỳ | P4 | buckets rỗng | "Không có giao dịch trong kỳ" — không vẽ trục 0 giả | — | T1 |
| A-02 | đổi nhóm ngày→tháng | admin | chip | P4 | — | bảng giữ chiều cao, mờ rồi cập nhật; URL đổi | — | T1 |
| A-03 | P7 trả đúng 100 dòng | admin | mở Rút tiền | P7 | — | "Hiển thị 100 yêu cầu cũ nhất — có thể còn nữa" | — | T1 |
| A-04 | rút PENDING → markPaid thẳng | admin | Đã chuyển khoản | P10 | tự khoá rồi trừ (lối tắt hợp lệ) | dialog nêu rõ bỏ qua bước duyệt | — | T2 |
| A-05 | tranh chấp, hợp đồng đang kết thúc | admin | phân xử | U3 | 409 `CONTRACT_ENDING` | thông báo cụ thể, không toast chung | tải lại | T1, T2 |
| E-01 | sổ lệch | admin | mở Tài chính | P3 → **409 + body** | — | Lệch X ₫ đỏ + nguyên nhân + liên kết Ngoại lệ; **không** hiện "lỗi tải" | xem Ngoại lệ | T1, T2 |
| E-02 | P7 lỗi 500 | admin | mở Rút tiền | P7 | — | "Không tải được hàng đợi rút tiền" + Thử lại; **không** "không có yêu cầu" | retry GET an toàn | T1 |
| E-03 | admin khác vừa chi | admin | Đã chuyển khoản | P10 | replay `WITHDRAWAL:<id>` → trả PAID | "Yêu cầu đã được chi lúc … bởi …" + làm mới dòng | không bấm lại | T2 |
| E-04 | bấm đúp Duyệt | admin | 2 click | P8 | khoá `WITHDRAWAL_LOCK:<id>` → 1 lần | nút bận sau click đầu | — | T1, T2 |
| E-05 | ví không đủ khi duyệt | admin | Duyệt | P8 | **500 INTERNAL_ERROR** hiện nay (G-13) | "Số dư khả dụng không đủ — yêu cầu cần xem lại" khi có mã 409; trước đó hiện lỗi máy chủ kèm mã tham chiếu | KHÔNG tự retry | T2 |
| E-06 | 403 | không phải admin / token hết | mở Tài chính | mọi | — | trang "Không có quyền", không hiện số | đăng nhập lại | T1 |
| E-07 | mạng mất giữa mutation | admin | Đã chuyển khoản | P10 | không biết đã ghi chưa | "Chưa xác nhận được kết quả — kiểm tra lại trước khi thao tác" + nút tải lại trạng thái; **không** tự retry POST | GET lại yêu cầu | T1 |
| E-08 | dữ liệu cũ | admin | để tab lâu, poll lỗi | P3/P13 | — | chip "Dữ liệu lúc HH:mm — đã cũ N phút" | làm mới | T1 |
| E-09 | đổi tài khoản admin | admin A → B | logout/login | — | — | không còn cache query của A (key có userId hoặc clear on logout) | — | T1 |
| E-10 | duyệt hoàn > trần | admin | nhập số | A3 | 400 `..._INVALID_AMOUNT` | chặn ngay ở form, nêu trần | — | T1, T2 |
| E-11 | sai lệch số tiền cổng | — | callback sai số | webhook | FAILED/không settle + `gatewayDiscrepancy` | Ngoại lệ "Sai lệch số tiền cổng" có kỳ vọng/thực, cổng, mã cổng | xử lý ngoài hệ thống (G-15) | T2 |
| E-12 | callback trùng | — | 2 IPN | webhook | 1 settle (CAS) | không hiện trùng tiền | — | T2 (đã có test backend? NOT VERIFIED) |

---

## 5. Kiến trúc frontend (khi hiện thực)

Tái sử dụng: `ui/DataTable` (bảng desktop/thẻ mobile), `ConfirmDialog`/`ImpactDialog`, `ErrorState`/`EmptyState`,
`KpiCard`, `StatusBadge`, `tabs`, `sheet` (drawer), `chart` (recharts + CSS var), `PageHeader`, `skeleton`.
`motion` 12 đã có — không thêm thư viện. React Query cho mọi fetch (thay `useEffect+setInterval`).

Thành phần mới (chỉ khi có ≥2 nơi dùng):

| Thành phần | Dùng ở | Ghi chú |
|---|---|---|
| `AdminShell` (sidebar nhóm, rail, badge) | mọi trang admin | tách khỏi `AppShell` chung; giữ Topbar, chuông thông báo; bỏ AI coach/call overlay ở admin. Theo §2.4: topbar mảnh, mục đang chọn nền xám bo tròn, "Đổi giao diện" + thẻ người dùng cuối sidebar, nav cuộn riêng |
| `StatTile` (thẻ KPI có ô biểu tượng ngữ nghĩa) | Hôm nay, Tổng quan tài chính | ưu tiên mở rộng `KpiCard` sẵn có (sửa tương phản chip nền sáng đã biết) thay vì viết mới |
| `AttentionList` (dòng + viên đếm, sắp theo độ khẩn) | Hôm nay, Tổng quan tài chính (hàng đợi tài chính) | mỗi dòng là link tới hàng đợi; lỗi một nguồn → dòng đó "—" |
| `RecentQueueList` | Hôm nay | nhãn nguồn bắt buộc |
| `adminNav.ts` | sidebar + breadcrumb | một nguồn cấu hình nhóm/route/badge-query |
| `FinanceLayout` + tab route | 5 tab Tài chính | `<Outlet>` |
| `Money` (`parseMoney`, `<Money value tone>`) | mọi số tiền admin | thay 3 formatter; "—" khi null |
| `MoneyStateBadge`, `FinancialStatusBadge` | bảng, drawer | token `--money-*` / `--st-*` |
| `QueryStateBoundary` (loading/error/403/stale) | mọi khối | lỗi ≠ rỗng; hiện "cập nhật lúc" |
| `useAdminError` | mọi mutation | mở rộng `handleAdminError` của listings: map 400/403/404/409/500 theo 3 kiểu lỗi backend |
| `MoneyActionDialog` | rút tiền, hoàn tiền, phân xử, hoàn hội viên | người, số tiền, tác động lên ngăn ví, nút bận, chống bấm đúp, chỉ báo thành công khi server xác nhận |
| `TransactionDrawer`, `MoneyJourneyTimeline`, `LedgerEntryTable` | Giao dịch (Full) | chờ G-05 |

Query key: `['admin', <userId>, 'finance', ...filters]` + `queryClient.clear()` khi logout (theo
`gymini-account-session-isolation`). Token mới thêm vào `styles/theme.css` (cả light và dark), không màu cứng.

Chuyển động: theo `04_PROTOTYPE_SPEC.md` §4 (100–240 ms, chỉ transform/opacity, reduced-motion). Responsive:
ưu tiên 1440/1280/1920; kiểm 768/390. **Chỉ desktop (≥1024px)**: đối chiếu hai phía cổng↔Gymini; mobile chỉ
đọc một cột. Thao tác tiền trên mobile được, qua dialog toàn màn.

---

## 6. Sổ rủi ro & phụ thuộc backend

| ID | Cần gì | Chặn batch | Ưu tiên | Ghi chú |
|---|---|---|---|---|
| G-03 | khoá/sửa admin refund | không (frontend không dùng) | **P0** | §1.3 · **trùng B-6 của Dispute V2.1**: hai workstream thống nhất một hướng (danh tính lấy từ token kèm chuỗi ủy quyền, V2.1 §1.5.3) trước khi bên nào sửa |
| G-01/G-02 | quyền `finance:*`, bốn mắt rút tiền | BE-2, phân quyền UI | P0 nghiệp vụ | cần Ngài quyết |
| G-04 | `GET /admin/payments/transactions` phân trang/lọc, DTO whitelist (G-14), tên người | B7 | P0 cho explorer | |
| G-05 | `GET /admin/payments/transactions/:id` (webhook events, bút toán, ledger ops, obligations, holdback, withdrawal) | B7 | P0 cho explorer | |
| G-06 | reconciliation trả 200 + `status`, lưu `reconciliation_runs` | B4 (MVP chịu được 409) | P1 | |
| G-08 | lịch sử rút tiền + `ownerName`, `walletAvailableNow` | B5 full | P1 | |
| G-13 | mã lỗi ổn định, 409 cho xung đột/số dư | B1 hiển thị tốt hơn | P1 | |
| G-07/G-15 | dữ liệu quyết toán cổng, FK webhook, quy trình xử lý sai lệch | B8 | P1/P2 | phụ thuộc cổng có file quyết toán sandbox |
| G-09/G-10 | ví/bút toán explorer, cột `kind` | B7 full | P1 | |
| G-11 | holdback review qua HTTP | sau khi bật FH-9 | P1 | tính năng đang TẮT |
| G-12/G-16 | actor + AuditLog cho hoàn hội viên/phân xử | B6 lịch sử | P2 | |
| G-17/G-18 | kiểu tiền thống nhất; kỳ theo giờ VN | B3 ghi chú | P2 | ai-service thuộc partner → bàn giao |
| G-23 | API nhật ký hoạt động admin (ai làm gì lúc nào, toàn hệ thống) — hiện chỉ có `audit-log` theo từng đối tác | không (panel "Mới nhất" suy ra từ hàng đợi) | P2 | thêm 26/10 khi áp ảnh tham chiếu |
| R-UI-1 | `AppShell` dùng chung mọi vai trò | B2 | — | tách AdminShell để không ảnh hưởng client/PT/gym |
| R-UI-2 | file lớn (1.877/1.174/1.145 dòng) | B9 | — | chỉ dời vị trí + URL state, không viết lại |
| R-ENV | Phiên khác sửa web cùng cây | mọi batch | — | làm trong worktree riêng |

---

## 7. Batch hiện thực (sau Gate A)

Chủ sở hữu mặc định: worker (Sonnet) viết mã; Claude (Opus) nghiệm thu; phần cơ học lớn (B9) có thể giao Codex
kèm brief. Ước lượng = ngày-agent. "Hoàn tác" = revert commit của batch; batch B2 trở đi phụ thuộc B2
(shell + token) nên **không revert B2 độc lập khi B3+ đã vào**.

| Batch | Mục tiêu | Phạm vi / tệp | API | Phụ thuộc | Song song được | Kiểm thử & tiêu chí nghiệm thu | Rủi ro | Công | MVP? |
|---|---|---|---|---|---|---|---|---|---|
| **P3-R** | Chỉnh prototype theo ảnh tham chiếu (trước Gate A) | chỉ `prototype/` + `review/` theo spec §7 | — (fixture) | ảnh Ngài | — | ảnh 1920/1440/1280/768/390 + video mới; bàn phím, reduced-motion, axe chạy thật trong trình duyệt; bất biến tiền giữ nguyên | thấp | 0,5–1 | (Gate A) |
| **B0** ✅ XONG 26/10 | Worktree + baseline — `D:/admin-fr`, nhánh `admin-finance-redesign` @ `f0d9812c` (Ngài duyệt D8/D6/D1/D7), node_modules junction về cây chính; baseline: test web **512/512**, `vite build` đạt, `tsc` (cấu hình tạm chỉ web) **236 lỗi có sẵn** (37 dòng ở pages/admin) = mốc không được tăng | `D:/admin-fr`, nhánh `admin-finance-redesign` | — | Gate A | — | `tsc`, `vite build`, test web hiện có xanh (ghi số) | thấp | 0,5 | ✓ |
| **B1** ✅ XONG 27/10 (chưa commit) — test 536/536, build đạt, tsc 236 = mốc; MOCK BROWSER TEST 70/70 (1440+390, `review/b1/`); `AdminDisputes` KHÔNG đụng (phiên khác làm tranh chấp). Phát hiện khi review: `markPaid` nhận cả PENDING (tự khoá rồi trừ) — "Duyệt" chỉ là bước giữ chỗ tuỳ chọn, không bắt buộc. Gap mới: không có API admin đọc gói hội viên theo id (không xem trước được số hoàn); `PATCH /admin/gyms/:id/status` không nhận lý do. E2E ở repo Playwright chung (02-wallet, 16-phase4, 26-personalized-service) cần thêm bước bấm xác nhận | **An toàn thao tác tiền (trước redesign)** | `AdminWithdrawals`, `PTServiceRefunds`, `AdminDashboard` (thẻ hoàn hội viên), `AdminDisputes`, `AdminGymModeration` (lý do reject/suspend), `AdminPartnersPage` (revoke/force-logout), `PTManagement` (bỏ `alert`); `useAdminError`; `Money` | P7–P10, A2–A3, G1, U3 | B0 | 2 worker (tiền / không tiền) | T1: mỗi thao tác có dialog, nút bận, lỗi ≠ rỗng, 409 cụ thể, chặn > trần; E-02/E-04/E-07/E-10 | trung bình | 2 | ✓ |
| **B2** ✅ XONG 27/10 (chưa commit) — test 565/565, build đạt, tsc 236 = mốc; MOCK BROWSER 439/439 route×(1440/768/390)+redirect+back/forward+badge, 96/96 shell (bàn phím, bẫy focus drawer, rail, reduced-motion, axe 0 trên shell); vai trò khác giữ AppShell cũ (so DOM/ảnh với HEAD); parity 15 trang + 2 URL cũ đạt (`review/b2/PARITY.md`). Ghi chú: topbar admin không còn pill tác vụ AI cá nhân + chấm realtime (admin không chạy tác vụ AI kế hoạch); theme mặc định chỉ ghi khi người dùng tự chọn; vite dev ghi cache vào `node_modules/.vite` qua junction (cache, không phải mã) | Shell + token | `AdminShell`, `adminNav.ts`, `theme.css` (+`--st-*`,`--money-*`), `routes.tsx` admin block, redirects | badge: P7, U1, A1, P13, pt-applications, partners queue, gyms, listings | B0 | — | T1: mọi route cũ mở được (bảng §2.3), back/forward, rail, 390/768/1440, axe 0 lỗi nghiêm trọng; shell khớp §2.4 (ảnh đặt cạnh ảnh tham chiếu) | trung bình — routes dùng chung | 2 (+0,5 port từ prototype tĩnh) | ✓ |
| **B3** ✅ XONG 27/10 (chưa commit) — test 627/627 (chung B3+B5), build đạt, tsc 227 (< mốc 236, bỏ lỗi recharts cũ); MOCK BROWSER 147/147 (cân/lệch 409/500/403/loading/stale/kỳ rỗng/400/200 sai dạng × 1920/1440/390 + dark), axe 0, bảng đối chiếu 41/41 trường (`review/b3/CHECKS.md`). Gap §3: bỏ cột "Số giao dịch" (transactionCount chưa có dòng §3); hàng hoàn dịch vụ chỉ đếm; doanh thu luỹ kế lấy từ P4 `platformRevenue` (không phải P3); tiêu đề trang/nút Làm mới ở header thuộc `AdminFinancePage` (để batch sau). **Ngài 28/10:** giữ bỏ "Số giao dịch" và tổng tiền hoàn dịch vụ (không thêm dòng §3); cho phép sửa `AdminFinancePage` ở batch sau | Tài chính › Tổng quan | `FinanceLayout`, `FinanceOverview` | P3, P4, P7, P13, U1/U2, A1, P2 | B2 | với B5 | T1: H-01, A-01, A-02, E-01, E-06, E-08; số khớp response từng trường (fixture); `StatTile` + `AttentionList` theo §2.4 | thấp | 1,5 (+0,25 port) | ✓ |
| **B4** ✅ XONG 29/10 (chưa commit) — test 671/671 (chung B4+B6a), build đạt, tsc 227 = mốc; MOCK BROWSER 186/186, axe 0 (38 lượt), `review/b4/CHECKS.md`. Chip `?view=balance\|exceptions`, đủ 22 nhóm + nhóm 23 "Cổng báo số tiền khác số Gymini" (P2, L2 — callback tự lưu; backend không bao giờ đặt `resolved=true` nên mục cũ ở mãi mức cần xem); chip L3 tắt BLOCKED. Header `AdminFinancePage`: tiêu đề theo tab + Làm mới (Ngài cho phép 28/10). Còn mở: huy hiệu thanh bên chưa tính P2; P2 gọi `api.get` trực tiếp (chưa có hàm trong `adminService`); hai nút Làm mới (header + trong trang) | Đối soát: Cân đối sổ + Ngoại lệ | `Reconciliation*` (dời `AdminReconciliationBlocks` sang danh sách nhóm, giữ `adminReconciliation.utils` + 41 test) | P3, P13, U2, P2 | B3 | — | T1: đủ 22 nhóm (đếm), `truncated` hiện, E-01, E-11 | trung bình | 2 (+0,25 port) | ✓ |
| **B5** ✅ XONG 27/10 (chưa commit) — test 627/627, build đạt, tsc 227; MOCK BROWSER 172/172 (chip + `?status=`, duyệt → 1 POST, đã chi trả từ PENDING/APPROVED, 409/400/500/mất mạng không thử lại, từ chối, rỗng, loading, 403, ≥100 dòng; 1440/390/dark; chạy lại B1 E-02/04/05/07), `review/b5/CHECKS.md`; T2 KHÔNG CHẠY (DB test dùng chung). Chip "Đã chuyển"/"Từ chối" tắt chờ G-08. Còn mở: tương phản chữ phụ trong `MoneyActionDialog` (B1) 4,09–4,46:1 < 4,5 — sửa ở batch sau | Rút tiền | `Withdrawals` + `MoneyActionDialog` | P7–P10 | B1, B2 | với B3 | T1 + T2 trên `gymcoach_payment_test`: H-02, H-03, A-03, A-04, E-03, E-04, E-05 | cao (tiền) | 1,5 | ✓ |
| **B6** — **B6a ✅ XONG 29/10 (chưa commit)**: MOCK BROWSER 250/250, axe 36/36 = 0 kể cả trong hộp thoại; chip `?type=service\|membership`; thẻ hoàn hội viên tách thành `refunds/MembershipRefundCard` dùng chung với Hôm nay; Từ chối nay qua MoneyActionDialog (payload không đổi); sửa tương phản MoneyActionDialog (token admin, không đổi token toàn cục) — B5 chạy lại axe = 0; B1 chạy lại 30/30. Gap: không xem trước được số hoàn hội viên (không có API đọc gói theo id); `ConfirmDialog` dùng chung vẫn 4,09:1 ở chế độ tối. B6b vẫn chờ V2.1 | Hoàn tiền (B6a) · Tranh chấp (B6b — **CHỜ Dispute V2.1 được duyệt**, không làm lại phân xử trên `AdminDisputes`/hai nút) | B6a: `Refunds` (dịch vụ + hội viên); B6b: theo V2.1 | A1–A3, G1, U1–U3 | B1, B2 | với B5 | T1: H-04, A-05, E-10 | cao | 1,5 | ✓ |
| **B3b** ✅ XONG 29/10 (chưa commit) — test 725/725 (chung B3b+B9a), build đạt, tsc 216 (< 227); MOCK BROWSER 220/220, axe 0 (16 lượt), field table có file:line backend (`review/b3b/CHECKS.md`). 13 nguồn độc lập; thẻ hoàn hội viên chỉ còn link; huy hiệu Đối soát + Tổng quan + chip Ngoại lệ + dải "cần xem ngay" đều tính P2 (điều phối viên sửa 3 chỗ còn lệch sau worker); bỏ 5 nút Làm mới trùng. Bỏ khỏi Hôm nay, chưa có chỗ mới: thống kê OCR InBody (`ocrStats`). `GET /auth/users` không phân trang | Hôm nay (`/admin/dashboard`) | `AdminDashboard` theo §2.1/§2.4: StatTile + AttentionList + RecentQueueList; thẻ hoàn hội viên chuyển hẳn sang Tài chính › Hoàn tiền (Hôm nay chỉ còn dòng dẫn tới); kèm dọn: huy hiệu thanh bên tính nhóm P2, bỏ nút Làm mới trùng trong các tab Tài chính | §3 bổ sung "Hôm nay" (trường DTO TO VERIFY trước khi nối) | B3, B6a | với B9a | T1: mọi số có dòng §3, lỗi một nguồn → "—", không 0 ₫ khi tải/lỗi; parity thẻ cũ | thấp | 1 | ✓ |
| **B9** — **B9a ✅ XONG 29/10 (chưa commit)**: PT, Chi nhánh (kiểm duyệt), Đối tác (+ hồ sơ đăng ký): `?id`/`?tab`/`?status`, modal → `ui/dialog`, 2 `window.confirm` → ConfirmDialog; parity PT-01..15, GY-01..11, PA-01..17 đạt (PA-05 chỉ CODE AUDIT); lời gọi API không đổi (+1 queryKey chi tiết hồ sơ PT cùng GET); MOCK BROWSER 187/187, axe 0. `/admin/gym-management`, `/admin/listings` giữ nguyên (smoke). **B9b ✅ XONG 30/10 (chưa commit):** Người dùng (DataTable, `?id/?role/?status/?q/?page`, chi tiết trong ui/dialog, phân trang phía client vì `/auth/users` không phân trang; bỏ 2 nút không có xử lý "Xem hồ sơ đầy đủ"/"Duyệt PT"), Giám sát hệ thống (giữ số cũ + dải báo khi làm mới lỗi), Giám sát AI (`?tab/?filter/?page/?id`, + khối thống kê OCR InBody từ `GET /admin/dashboard` cùng query key cũ); MOCK BROWSER 171/171 + smoke P2 11/11 (thanh bên/Tổng quan/chip/dải đều 12; P2 lỗi → không huy hiệu), axe 0. Còn mở: `ConfirmDialog` dùng chung nút mặc định 3,76:1; gateway điền 0 cho `ocrStats` khi user-service lỗi (không phân biệt "chưa biết" với 0 — cần backend) | Di chuyển trang phi tài chính | URL state (`?id`, `?tab`) cho PT, partners, gyms, AI; `DataTable` ở users; thay modal tự viết bằng `ui/dialog` | hiện có | B2 | Codex được (cơ học) | T1: parity 66 chức năng (checklist từ audit 01), deep link | trung bình | 3 | ✓ (parity) |
| **B10** ✅ XONG 30/10 (chưa commit) — 12 lỗi đã sửa (F1–F12, `review/b10/AUDIT.md`): ConfirmDialog dùng chung 3,76→5,48:1 (chỉ đổi nền sáng), 7 tablist có phím mũi tên, 3 select thiếu nhãn, 2 modal tự viết có role/bẫy focus/Esc, 11 route tắt animation khi giảm chuyển động, giữ chỗ ô tiền (CLS Hôm nay 0,191→0,065; Tổng quan 0,121→0,0002), 2 trang ngừng hỏi máy chủ khi tab ẩn; test 742/742, tsc 215; MOCK BROWSER: axe 0 trên 57 tổ hợp route×khổ (trừ 3 lỗi ở AdminDisputes — phiên khác), bàn phím 37/37; Lighthouse KHÔNG CHẠY (chưa cài). Còn mở: nút biểu tượng 28–37px ở 390; `KpiCard`/`EntityCard` dùng chung h4 dưới h2; call site ConfirmDialog của PT/chủ gym/khách chỉ CODE AUDIT | Motion, a11y, hiệu năng | toàn admin | — | B3–B9 | — | review-animations checklist, reduced-motion, bàn phím toàn bộ, Lighthouse a11y ≥ 95 trang tài chính | thấp | 1 | ✓ |
| **BE-1** | API tài chính (cần duyệt riêng) | payment-service: G-03, G-04, G-05, G-06, G-08, G-13, G-14 | mới | duyệt Ngài | 1 worker high | T2 trên `*_test`: phân quyền ADMIN, phân trang, DTO không lộ redirectUrl, invariant sau mọi test | cao | 4 | Full |
| **B7** | Giao dịch + Hành trình tiền | `Transactions`, `TransactionDrawer`, `MoneyJourneyTimeline`, `LedgerEntryTable` | G-04, G-05 | BE-1 | — | T1 + T3: 6 biến thể giao dịch của prototype trên dữ liệu seed | trung bình | 2,5 (+0,25 port) | Full |
| **BE-2** | Phân quyền tài chính + bốn mắt | auth-service claim, các service | mới | quyết định Ngài | — | T2 | cao | 3 | Full |
| **B8** | Đối chiếu cổng ↔ Gymini | `GatewayReconciliation` | G-07, G-15 | BE-1, quyết định nguồn quyết toán | — | T2/T3 với file quyết toán sandbox | cao | 3 | Full |
| **B11** ✅ XONG 30/10 — stack cô lập (DB `gymcoach_*_afr_test` trên 55433, cổng 43000–43007, Redis riêng tạm; đã dọn sạch). BACKEND INTEGRATION: payment-service 766/766, user-service tiền/tất toán 81 qua/0 lỗi/4 bỏ qua (chạy lại có env 6/6) — chạy theo phạm vi, không phải toàn repo. REAL HTTP/API 44/45 (27 endpoint admin phân quyền đúng; rút tiền/hoàn tiền bấm hai lần → đúng một bút toán; bất biến ESCROW = Σ quyền đòi đúng 15/15 lần). REAL BROWSER (stack cô lập, DB test): H-01..H-04, E-01, E-10, A-01, A-02 ĐẠT; E-03 đạt về chức năng (400 + toast + tải lại, không trùng tiền) nhưng không hiện "đã chi lúc … bởi …"; A-03 chưa chạy, A-04 chỉ API; bấm xác nhận chỉ ở 1440. Phát hiện: F1 (P3) `mark-paid` gọi lại trên yêu cầu đã PAID trả 400 INVALID_STATUS, không phải 200 như audit ghi (chỉ gọi đồng thời mới trả 200) — sửa mô tả audit, backend giữ nguyên; F2 (P3) câu "tiền đã chuyển thẳng vào ví PT, không giữ tạm" ở hoàn tiền dịch vụ sai so với sổ (phần PT nằm ở PT.pending) — đã bỏ câu này. Chưa phủ: rút tiền của PT; `/me/withdrawals` coi GYM_OWNER là CLIENT (cần kiểm riêng) | QA tích hợp | toàn bộ | — | tất cả | — | T1 đủ; T2 các endpoint dùng; T3 H-01..H-04, E-01, E-03 trên stack seed cô lập (`*_seedrun`/test) — không DB dev | — | 2 | ✓ |
| **B12** | Release | build, smoke, ghi chú rollback (redirect giữ route cũ), known issues | — | B11 | — | `vite build`, smoke REAL BROWSER trên stack cô lập | — | 0,5 | ✓ |

> **Trạng thái 09/11/2026 (Ngài):** MVP XONG và đã lên tree chính + GitHub (cùng Dispute V2.1). Bản **Full** (BE-1, B7, BE-2, B8) **HOÃN, làm sau**; không bắt buộc để hệ thống chạy. Thứ tự khuyến nghị khi làm lại:
> 1. **BE-2 + G-01/G-02 trước** (kiểm soát tiền, không phải UI): hiện một ADMIN một mình duyệt + chi rút tiền/hoàn tiền. Cần Ngài quyết mô hình (bốn mắt trên ngưỡng / mọi khoản / quyền finance riêng) trước khi viết mã. Nên xong trước khi chạy tiền thật quy mô lớn.
> 2. **BE-1 → B7** (công cụ vận hành: tra giao dịch theo mã, hành trình tiền). G-03 đã được backend sửa (E6 F1, danh tính lấy từ token) nên BE-1 còn G-04, G-05, G-06, G-08, G-13, G-14.
> 3. **B8** khi có nguồn dữ liệu quyết toán của cổng (file/API đối soát VNPay/PayOS).

**MVP** (không đổi backend): B0–B6, B9, B10, B11, B12 ≈ 17,5 + 1 (port prototype tĩnh) ≈ 18,5 ngày-agent. **Full** thêm BE-1, B7, BE-2, B8 ≈ +12,75.
Thứ tự đề xuất: B0 → B1 → B2 → (B3 ∥ B5) → B4 → B6 → B9 → B10 → B11 → B12; BE-1 có thể chạy song song từ sau B2 nếu duyệt.

Bằng chứng bắt buộc mỗi batch: danh sách tệp, lệnh kiểm và số đạt/lỗi, ảnh 1440 + 390 cho màn đụng tới, nhãn
đúng loại (không gọi T1 là E2E), `git status` cuối batch.

---

## 8. Gate

| Gate | Điều kiện | Trạng thái |
|---|---|---|
| A — Audit + thiết kế | 01, 02, 03, 04, Master Plan, prototype + ảnh/video | **chờ Ngài duyệt** |
| B — Shell | B2 đạt, mọi route cũ mở được, a11y/responsive | — |
| C — Tài chính hiển thị & chức năng | B3–B6 đạt; lỗi ≠ rỗng ≠ 0; dialog tiền | — |
| D — Tích hợp tài chính | T2 các endpoint dùng; invariant giữ sau mọi thao tác; không false success/zero | — |
| E — Release | B11–B12; known issues; rollback | — |

## 8b. Review package (Gate A)

| Mục | Vị trí | Nhãn |
|---|---|---|
| Prototype | `prototype/index.html` (mở bằng trình duyệt, file://). Thanh "Kịch bản" góc dưới phải: Bình thường / Đang tải / 500 / 403 / Dữ liệu cũ / Lệch sổ. Nút "Hiện nguồn dữ liệu" gắn API hoặc mã G-xx cho từng con số | TEST FIXTURE |
| Ảnh | `review/01..26-*.png`: 1440 (5 màn + 3 tab đối soát + 2 drawer + dialog), 1920 (2), dark 1440 (1), 390 (6), kịch bản (7) | MOCK BROWSER TEST (Playwright 1.61) |
| Video | `review/video-1-dieu-huong`, `-2-giao-dich`, `-3-doi-chieu-cong`, `-4-rut-tien` (.webm, 1440) | MOCK BROWSER TEST |
| Đã kiểm | không lỗi trang; không cuộn ngang 390/1440 ở 8 route; không "0 ₫" ở trạng thái tải/500/403 (6 route × 2 độ rộng); kịch bản bình thường escrow = Σ quyền đòi | TEST FIXTURE |
| CHƯA kiểm | bàn phím (mũi tên trên tab, bẫy focus, Esc), reduced-motion — mới soát mã | NOT RUN → **chạy trong P3-R** |
| Sau P3-R (26/10 tối, XONG) | Bộ cũ `review/v1/` (26 PNG + 4 WebM); bộ mới `review/p3r/` (46 PNG + 5 WebM + `P3R_CHECKS.md`). Kiểm: bàn phím (bẫy focus drawer/dialog/menu, Esc, trả focus) đạt; reduced-motion đạt; axe serious+critical = 0 (1440 sáng/tối, 390); tràn ngang 390 = 0; không "0 ₫" ở tải/500/403; 48 tổ hợp 8 route × 6 kịch bản không lỗi. Vòng 2 sửa 3 lỗi ngữ nghĩa do điều phối viên phát hiện (bỏ hướng dẫn xử lý tự đặt → "chưa có quy trình (G-15)"; "Khớp" = suy ra hiển thị; hành trình FAILED không còn dấu tích thành công). Ảnh `02/10/12/14` chưa chụp lại sau vòng 2 (nhãn nhóm sidebar cũ hai dòng — mã đã sửa) | MOCK BROWSER TEST — static prototype |
| **Bản chất prototype** | **STATIC HIGH-FIDELITY DESIGN PROTOTYPE** (HTML/CSS/JS thuần, mở `file://`, dữ liệu mẫu). KHÔNG phải React; KHÔNG nối router, auth guard, API thật; component KHÔNG tái dùng trực tiếp; "loại khỏi production build" không áp dụng; chưa giải quyết parity chức năng. Nợ hiện thực: port sang stack web (đã cộng vào công B2/B3/B4/B7) | — |
| Không phải | E2E, REAL HTTP, BACKEND INTEGRATION — prototype không gọi API |

Quyết định thiết kế nhỏ đã chốt trong prototype: kịch bản lệch sổ dùng **tổng quyền đòi** làm 100% của bản đồ tiền
(vì đó là số mỗi bên được hưởng; phần escrow thiếu hiện riêng ở chênh lệch). "Tiền vào" **giữ đúng** công thức
backend (gồm nạp ví cũ) kèm ghi chú — frontend không tự loại trừ (G-18 đề xuất sửa ở backend).
Sai lệch số tiền cổng hiển thị đúng hành vi backend: giao dịch **Thất bại**, không ghi sổ (đúng thiết kế), tiền nằm ở cổng.

## 9. Quyết định cần Ngài

1. **IA**: sidebar 5 nhóm + tab cấp 2 chỉ ở Tài chính (thay cho 6 workspace) — duyệt?
2. **G-03**: khoá endpoint hoàn tiền admin cũ thành 410 (khuyến nghị) hay sửa? Làm ngay như một fix P0 nhỏ?
3. **Phân quyền tài chính + bốn mắt (G-01/G-02)**: có đưa vào phạm vi (BE-2) không, và ngưỡng tiền nào cần người thứ hai?
4. **BE-1** (API giao dịch/chi tiết/lịch sử rút tiền): duyệt cho nhóm này làm ở payment-service? Không có nó, Giao dịch + Hành trình tiền chỉ là prototype.
5. **Đối chiếu cổng (B8)**: có cần thật không ở giai đoạn này (cần file quyết toán từ VNPay/ZaloPay/PayOS) hay để sau?
6. **B1 làm trước redesign** (thêm xác nhận cho thao tác tiền trên trang hiện tại) — duyệt?
7. **Theme admin**: thiết kế ưu tiên light, vẫn theo nút sáng/tối của người dùng; thêm token `--st-*`/`--money-*` vào theme.css — duyệt? *(Khớp với ảnh tham chiếu Ngài gửi 26/10.)*
8. **Worktree riêng** `D:/admin-fr` cho toàn bộ hiện thực — duyệt?

**Phân loại (26/10 tối)** — chỉ 4 quyết định chặn bước tiếp theo; phần còn lại không cần duyệt bây giờ.

| ID | Câu hỏi | Khuyến nghị | Phương án khác | Rủi ro | Chặn batch | Cần duyệt | Loại |
|---|---|---|---|---|---|---|---|
| D8 | Worktree `D:/admin-fr`, nhánh `admin-finance-redesign` — **từ commit nào?** (HEAD đã đổi 78eba2a5 → f0d9812c trong phiên) | Tạo từ HEAD tại lúc duyệt (f0d9812c hoặc mới hơn), chuyển bản sao `docs/admin-redesign/**`; không commit/merge/đụng backend | Giữ 78eba2a5 (thiếu commit mới của phiên khác) | Thấp | B0 (mọi batch) | Ngài | **Chặn ngay** |
| D6 | B1 (xác nhận/xem trước cho thao tác tiền trên trang admin hiện tại) làm trước redesign | Có | Gộp vào B5/B6 (chậm sửa 🔴 ADM-03/25/27/30) | Trung bình (đụng thao tác tiền, không đổi API) | B1 | Ngài | **Chặn ngay** |
| D1 | IA: sidebar 5 nhóm luôn thấy + badge; tab cấp 2 chỉ ở Tài chính; nhóm "Xử lý vụ việc" | Có | 6 workspace (thêm 1 cú bấm mỗi lần chuyển) | Thấp | B2 | Ngài | **Chặn ngay** (trước B2) |
| D7 | Theme admin ưu tiên sáng + token `--st-*`/`--money-*` trong theme.css (khớp ảnh tham chiếu) | Có | Giữ dark mặc định | Thấp (token mới, không đổi màu vai trò khác) | B2 | Ngài | **Chặn ngay** (trước B2) |
| D2 | G-03 endpoint hoàn tiền admin cũ: khoá 410 hay sửa | Khoá 410 — **nhưng do workstream backend/Dispute V2.1 (B-6) quyết cùng**, không thuộc redesign | Sửa: danh tính từ token + khoá idempotency ổn định | Cao nếu để mở (giả mạo người thực hiện) | Không chặn redesign; chặn production nói chung | Ngài + backend | **Chặn production (backend)** |
| D4 | BE-1: API giao dịch/chi tiết/lịch sử rút ở payment-service | Duyệt khi MVP xong | Không làm (Giao dịch + Hành trình tiền chỉ là prototype) | Trung bình | B7 | Ngài | Hoãn (Full) |
| D3 | Phân quyền tài chính + bốn mắt (BE-2), ngưỡng tiền | Đưa vào Full; ngưỡng do Ngài đặt | Giữ một vai trò ADMIN | Cao về kiểm soát nội bộ | BE-2 | Ngài (chính sách) | Hoãn (Full) — nhưng là rủi ro production đã biết |
| D5 | Đối chiếu cổng thật (B8, L3) | Để sau, cần file quyết toán sandbox VNPay/ZaloPay/PayOS | Làm ngay (không có nguồn → không thể) | — | B8 | Ngài | Hoãn |
