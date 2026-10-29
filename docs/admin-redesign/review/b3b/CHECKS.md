# B3b — Hôm nay (`/admin/dashboard`) + huy hiệu Đối soát tính P2 + bỏ nút Làm mới trùng: bằng chứng

Nhãn: **MOCK BROWSER TEST** (Playwright 1.61, `page.route` mock mọi `/api/**`, vite dev cổng 5431 với `GATEWAY_PROXY_TARGET` trỏ cổng chết → không chạm backend thật; script `run.mjs`/`harness.mjs` ở scratchpad `b3b/`), **UNIT TEST / TEST FIXTURE** (tsx), **CODE AUDIT** (đọc backend chỉ-đọc). Không phải REAL BROWSER / REAL HTTP/API.

## Số liệu
- Unit: `npx tsx --test` toàn `__tests__` = **725/725** (gồm **45** test mới `b3b-today.test.ts`, + test của B9a trong cây).
- `vite build` ra scratchpad `b3b/dist`: đạt. `tsc` (cấu hình tạm chỉ-web, đã xoá): **216** (mốc 227; −11 vì `AdminDashboard.tsx` cũ có 11 lỗi, đã đo bằng cách biên dịch lại bản cũ = 227); **0** lỗi trong tệp B3b.
- Mock browser: **220/220** kiểm tra đạt; **16** lượt axe (mỗi lượt chạy cả `#admin-main` và toàn tài liệu): serious+critical = **0**. Ảnh: `ok-*`, `drift-*`, `err-*`, `loading-*`, `forbidden-*`, `stale-*`, `empty-*`, `badge-p2-*`, `finance-*` (1920/1440/390 + tối 1440). Không tràn ngang ở 390.

## Kịch bản đã chạy
tất cả nguồn OK · sổ lệch 409 (không phải lỗi tải) · một nguồn 500 (tranh chấp; rút tiền; chi nhánh; P2; người dùng 500 + giám sát 200 hỏng) · tất cả đang tải (hang, rồi nhả) · 403 mọi nguồn (một panel, không số) và 403 một phần · stale (đồng hồ giả, làm mới thất bại → số cũ giữ, mờ, chip) · hàng đợi rỗng (số 0 thật vì đã tải) · "Làm mới" của Hôm nay: đúng **1** request cho mỗi nguồn trong 13 nguồn · huy hiệu Đối soát: P2=2 → 12, P2=0 → 10, P2 500 → không huy hiệu, P13 500 → không huy hiệu · huy hiệu = số dòng "Ngoại lệ đối soát" trên Hôm nay · 5 tab/chip Tài chính: không còn nút Làm mới trong trang, đúng 1 nút (header), header gọi lại **đúng** các truy vấn của tab, mỗi cái một lần · bấm từng dòng trong 9 dòng → đúng route · thẻ hoàn hội viên vẫn chạy ở `/admin/finance/refunds?type=membership`.

## Bảng kiểm từng con số (mỗi số → §3 → trường DTO → xác nhận ở backend)
Kỳ vọng tính tay trong `run.mjs` từ fixture (không đọc ngược từ UI). Ghi chú "trên Hôm nay" = số mock kịch bản "OK".

| Số hiển thị | Dòng §3 | Trường DTO | Backend (đã đọc) | Mock → hiển thị |
|---|---|---|---|---|
| Rút tiền đã duyệt chờ chuyển: số, tổng, cũ nhất | §3 "Đã duyệt – chờ chuyển khoản" | P7 `status=APPROVED`, `amount`, `reviewedAt` | `payment-service/src/repositories/withdrawal.repository.ts:29-34` (PENDING+APPROVED, `take 100`), `routes/admin.routes.ts:110`, model `schema.prisma:178-194` | 2 · 15.300.000 ₫ · 3 ngày |
| Rút tiền chờ duyệt: số, tổng, cũ nhất | §3 "Rút tiền chờ duyệt" | P7 `status=PENDING`, `amount`, `createdAt` | cùng trên; trần 100 → "≥" | 2 · 2.200.000 ₫ · 2 ngày |
| Ngoại lệ đối soát cần xem (P13+U2) | §3 "Ngoại lệ đối soát" | `countAttention`: P13 `summary.*`, U2 `needsAttention/endedWithoutSettledEnding.items` | `payment-service/src/routes/admin-obligations.routes.ts`; `user-service/src/routes/admin.routes.ts:18` | 8 + 2 = 10 |
| …cộng nhóm "Cổng báo số tiền khác số Gymini" (P2) | §3 "Sai lệch số tiền cổng" | P2 mỗi dòng = 1 mục; `metadata.gatewayDiscrepancy` | `payment-service/src/routes/admin.routes.ts:39-49` (cap 200 → "≥") | +2 = 12 |
| Hoàn tiền dịch vụ chờ: số, cũ nhất | §3 "Hoàn tiền dịch vụ" (A1) | `status=REFUND_REQUESTED`, `refundRequestedAt`, `titleSnapshot` | `ai-service/src/routes/personalized-service.routes.ts:21`; `services/personalized-service.service.ts:828-833` (không cap, cũ nhất trước) | 2 · 3 ngày. **Không có tổng tiền** (Ngài 28/10: tổng hoàn tiền không đưa vào tổng quan) |
| Cần xử lý về tiền (ô 1) | §2.1 + bổ sung "Cần xử lý về tiền" | số mục = đã duyệt + ngoại lệ + hoàn DV; tiền = **chỉ** tổng rút đã duyệt | gộp 3 nguồn trên | 2+12+2 = 16 mục · 15.300.000 ₫ |
| Hồ sơ PT chờ duyệt | bổ sung "Hồ sơ chờ duyệt" | `GET /pt-applications/admin?status=SUBMITTED` → mảng; thời điểm vào hàng đợi `submittedAt` (fallback `createdAt`); tên `user.firstName/lastName` | `user-service/src/routes/pt_application.routes.ts:125-130`; `controllers/pt_application.controller.ts:246-283`; `repositories/pt_application.repository.ts:262-283`; `schema.prisma:316,319` | 2 · 3 ngày |
| Hồ sơ đối tác chờ duyệt | idem | `counts.IN_REVIEW` (groupBy: thiếu khoá = 0), `items[].verificationStatus/submittedAt/createdAt/brandName` | `gym-service/src/routes/admin.routes.ts:85`; `controllers/application-review.controller.ts:30-35`; `services/partner-application-review.service.ts:557-598` | 1 · 55 phút |
| Chi nhánh chờ duyệt | idem | `/admin/gyms` → `status==="PENDING_REVIEW"`, `name`, `createdAt` | `gym-service/src/routes/admin.routes.ts:33`; `controllers/gym.controller.ts:132-138`; `repositories/gym.repository.ts:53-59` | 1 · 2 giờ |
| Đề xuất tiện ích chờ duyệt (đang gọi là "Tin đăng" ở §2.1) | idem | `groups.length`; `groups[].proposals[].createdAt/name` | `gym-service/src/services/gym-amenity-catalog.service.ts:449-488` (`take: 1000`; `proposalDto` `:89-102`) | 3 · 2 ngày |
| Hồ sơ chờ duyệt (ô 3) | idem | tổng 4 nguồn; 1 nguồn lỗi → "—" + nguồn nào lỗi + số đã đọc | — | 2+1+1+3 = 7 hồ sơ |
| Cân đối sổ ví | §3 "Chênh lệch sổ" | P3 `escrow/claims/drift/balanced`; **409 vẫn có body = lệch** | `payment-service/src/routes/admin.routes.ts:51-57`; tái dùng `fetchReconciliation` + `balanceVerdict` của B3/B4 | "Cân bằng" / "Lệch 1.250.000 ₫" (drift −1.250.000) |
| Người dùng | bổ sung "Người dùng / mới 7 ngày" | `GET /auth/users` → `users.length` (non-ADMIN) | `gateway proxy.routes.ts:731-739` (proxy thẳng, lỗi thật lan ra); `auth-service/src/repositories/auth.repository.ts:12-26`; `controllers/auth.controller.ts:60-103` | 5 |
| Mới 7 ngày | idem | `users[].createdAt` (ISO) ≥ now−7d; một `createdAt` không đọc được → "—" | cùng trên | 3 |
| Dịch vụ đang chạy | bổ sung "Dịch vụ đang chạy" | `data.summary.healthyCount / serviceCount` | `gateway proxy.routes.ts:214-239`, `buildMonitorSummary :~188-211` (đếm cả dịch vụ tuỳ chọn) | 9/9 |
| Tranh chấp đang mở | §3 "Tranh chấp chờ phán quyết" (U1) | mảng Session DISPUTED: `disputedAt`, `disputeType`, `id` | `user-service/src/routes/admin.routes.ts:16`; `controllers/booking.controller.ts:210-217`; `repositories/session.repository.ts:224-230` (không cap, `disputedAt` asc); `schema.prisma:778-838` | 2 · 2 ngày |
| Mục mới tạo gần nhất (7 hàng đợi) | §3 "Mục mới tạo gần nhất" | mục mới nhất mỗi hàng đợi theo thời điểm vào hàng đợi: rút tiền/PT/đối tác/chi nhánh/tiện ích = `createdAt` (PT: `submittedAt` trước); hoàn tiền = `refundRequestedAt`; tranh chấp = `disputedAt` | như các dòng trên | thứ tự Tiện ích 35′ → Hoàn tiền 40′ → Đối tác 55′ → PT → Chi nhánh → Rút tiền → Tranh chấp |

## Con số bị bỏ vì không có API tin cậy
- **Tổng tiền hoàn dịch vụ**, **tổng tiền tranh chấp (amountAtStake)** ở dòng Việc cần xử lý: danh sách A1/U1 không trả số tiền hoàn/ở rủi ro (A2 chỉ theo từng đơn; U2 `sessionValue` nằm trong tập có giới hạn) → không hiện, không cộng.
- **Số ví khả dụng của người rút** (G-08), **tên người** trong dòng rút tiền/tranh chấp (G-09): không có → dùng loại chủ ví + mã buổi tập rút gọn.
- **Nhật ký hoạt động thật** (G-23): không có → panel ghi rõ là "mục mới nhất của hàng đợi".
- **Tin đăng PT/gym (revision)**: sidebar cũng không đếm → dòng chỉ là **đề xuất tiện ích**; hàng đợi duyệt bản sửa tin đăng chưa vào Hôm nay.

## Bảng tương đương: dữ liệu Hôm nay cũ → nay
| Khối cũ | Số liệu | Nay | Lý do |
|---|---|---|---|
| Khối tiền (ESCROW / doanh thu / balanced) | `data.money` | **Giữ**, thành ô "Cân đối sổ ví" (balanced/lệch từ P3 trực tiếp, kèm phạm vi). Doanh thu nền tảng chuyển sang Tài chính › Tổng quan (đã có) | một nguồn P3; số cũ dùng `|| ` ép lỗi thành 0 |
| KPI Tổng người dùng | `kpis.totalUsers` (mất nguồn → 0) | **Giữ** (chỉ số gọn "Người dùng") từ `GET /auth/users` | nguồn cũ trả 0 khi auth lỗi; nguồn mới lỗi thật |
| "+0 tháng này" | hằng số giả | **Bỏ** | không có nguồn |
| KPI PT đã xác minh / chờ duyệt | `verifiedPTs`, `pendingPT` | PT chờ duyệt → dòng "Hồ sơ PT chờ duyệt" (nguồn ADM-08, chính xác hơn). "PT đã xác minh" **bỏ** | số cũ suy ra từ role/isPT, không phải hàng đợi |
| KPI Hợp đồng đang hiệu lực | `kpis.activeContracts` | **Bỏ khỏi Hôm nay** (còn ở trang Người dùng cột hợp đồng) | không phải việc cần xử lý; `|| 0` |
| KPI Buổi tập hôm nay | `kpis.sessionsToday` | **Bỏ** | không phải việc cần xử lý (null → 0 ở màn cũ) |
| Biểu đồ tăng trưởng người dùng + biểu đồ vai trò | `userGrowth`, `roleData` | **Bỏ** | trang trang trí, không có việc; còn xem được ở trang Người dùng |
| Thống kê quét InBody OCR 7 ngày | `ocrStats` | **Bỏ khỏi Hôm nay — hiện KHÔNG có chỗ nào khác hiển thị** → **câu hỏi cho Ngài** (giữ ở Giám sát AI?) | thiết kế duyệt bỏ khối "Nền tảng" cũ |
| Cảnh báo hệ thống | `systemAlerts` (chuỗi tiếng Anh) | **Bỏ**; tình trạng dịch vụ = chỉ số "Dịch vụ đang chạy x/y"; chi tiết ở Giám sát hệ thống (`recentErrors`) | trùng Giám sát hệ thống |
| Bảng Đăng ký gần đây | `recentUsers` | **Bỏ** (Người dùng đã sắp theo ngày tạo) | không phải hàng đợi |
| Thẻ hoàn tiền hội viên ngoại lệ | `MembershipRefundCard` | **Chuyển** sang `/admin/finance/refunds?type=membership` (đã có, testid nguyên vẹn — kiểm bằng mock); Hôm nay chỉ còn một dòng liên kết | §2.3 |
| Chip "x% hệ thống khỏe mạnh" | `monitor.healthScore` | **Bỏ**; thay bằng "Dịch vụ đang chạy x/y" | không đặt tên "sức khoẻ" cho số cục bộ |

## Việc dọn dẹp
1. Huy hiệu Đối soát: `exceptionAttention` (`reconciliationView.ts`) = `countAttention` + số dòng P2; `useAdminNavBadges.ts` dùng `RECON_KEYS.*` + `fetchObligations/fetchSessionsReport/fetchGatewayDiscrepancies` (một hàm duy nhất, đã tách khỏi `useExceptionReports`). Thiếu một trong ba nguồn → **không huy hiệu** (không hiện số thiếu). Hôm nay dùng cùng hàm nên khớp.
2. Bỏ 5 nút Làm mới trong trang: `finance-refresh` (Tổng quan), `recon-balance-refresh`, `recon-exceptions-refresh` (`AdminReconciliationBlocks.tsx`, thêm vào danh sách vì nút nằm ở đó chứ không ở `reconciliation/*`), `admin-withdrawals-refresh`, `admin-refunds-refresh`. Giữ: `finance-asof`, `recon-balance-asof`, `admin-withdrawals-updated`, `admin-refunds-updated`, và các chip "Dữ liệu lúc … đã cũ" (nút "Làm mới" nằm trong chip chỉ xuất hiện khi dữ liệu cũ — giữ làm lối hồi phục, không phải nút trùng thường trực).

## Độ lệch / điểm cần lưu ý
- `shared/AttentionList.tsx` (đọc-chỉ theo brief) sửa tối thiểu: `role="status"` của dòng đang tải chuyển từ `<li>` vào `<div>` bên trong — `<li role=status>` vi phạm luật axe `list` (serious) khi trang đang tải. Cũng ảnh hưởng Tổng quan tài chính (B3) → nên chạy lại axe loading ở B3.
- Thời điểm "vào hàng đợi" dùng `submittedAt/refundRequestedAt/disputedAt` thay `createdAt` cho PT/hoàn tiền/tranh chấp (createdAt của các bản ghi này là lúc tạo nháp/đơn/buổi tập, không phải lúc vào hàng đợi) — ghi rõ trong ghi chú nguồn.
- Chưa sửa (ngoài phạm vi, báo): banner "N mục cần xem ngay" trong trang Ngoại lệ và dòng "Ngoại lệ đối soát" của Tổng quan tài chính (B3) vẫn dùng `countAttention` không gồm P2 → lệch với huy hiệu mới (12 vs 10 trong kịch bản mock).
- `GET /auth/users` không phân trang: Hôm nay tải cả danh sách để đếm (đúng nguồn của dashboard cũ). Nếu số người dùng lớn nên có API đếm (đề xuất, không làm).
- 6 truy vấn hàng đợi + 4 P-báo cáo dùng chung khoá với sidebar/trang gốc; thêm 3 truy vấn chỉ Hôm nay đọc (người dùng, giám sát) — poll 5 phút / 1 phút.
- Dùng vite `cacheDir` riêng cho mock (cache `node_modules/.vite` dùng chung qua junction gây "Invalid hook call" khi nhiều dev server) — chỉ ảnh hưởng hạ tầng kiểm thử.
