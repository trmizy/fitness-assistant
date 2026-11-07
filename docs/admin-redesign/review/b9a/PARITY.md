# B9a — Parity (Hồ sơ PT, Chi nhánh, Đối tác phòng gym)

Nguồn: `audit/01_ADMIN_FRONTEND_INVENTORY.md` (ADM-08..10, 50..77) + đọc mã (chức năng audit bỏ sót ghi "mã").
Bằng chứng: **MOCK BROWSER TEST** (`page.route`, không backend thật; kịch bản `scratchpad/b9a/run.mjs`, kết quả `b9a-results*.json`), **BACKEND INTEGRATION** = không có, **CODE AUDIT** = đọc mã/so sánh lời gọi, **UNIT** = `tsx --test` (`b9a-url-state.test.ts`).
Lệnh gọi API trước/sau: `api-before.txt` / `api-after.txt` (grep trong 4 file) và `api-calls-before.txt` / `api-calls-after.txt` (chạy cùng kịch bản trên HEAD và trên bản mới, **MOCK BROWSER TEST**).

Phạm vi B9a làm: **PT, Chi nhánh (kiểm duyệt), Đối tác (+ hồ sơ đăng ký)**. `/admin/gym-management` và `/admin/listings` theo Master Plan §2.3 là "giữ" → không sửa, chỉ chạy smoke (tải được, không tràn 390, không lỗi trang). Users + AI = B9b (chưa làm).

## 1. Hồ sơ PT — `PTManagement.tsx` (ADM-08, 09, 10)

| # | Chức năng | Cách kiểm | Kết quả |
|---|---|---|---|
| PT-01 | Danh sách hồ sơ, lọc trạng thái (Tất cả/Mới/Đang xem xét/Cần bổ sung/Đã duyệt/Đã từ chối) — `GET /pt-applications/admin?status=`, key `["admin-pt-applications", filter]`, keepPreviousData | MOCK BROWSER (chip → request có `status=`), CODE AUDIT (key/params y nguyên) | ✓ |
| PT-02 | Tìm theo tên/email (client-side) | CODE AUDIT (hàm lọc không đổi) | ✓ |
| PT-03 | Thẻ hồ sơ: tên, email, số năm KN, ngày nộp, số chứng chỉ, số ảnh/video, trạng thái | MOCK BROWSER (screenshot 1440/390/dark) | ✓ |
| PT-04 | Lỗi tải ≠ rỗng, nút Thử lại (`pt-applications-load-error`) | MOCK BROWSER 500 + 403 (thông báo "không có quyền") | ✓ (403 mới) |
| PT-05 | Chi tiết: `GET /pt-applications/admin/:id`, lỗi → dùng dòng của danh sách | MOCK BROWSER (detail 500 → vẫn mở bằng dòng danh sách) | ✓ |
| PT-06 | Màn chi tiết (ảnh, liên hệ, giới thiệu, học vấn, lịch, giá, MXH, gym) — chỉ hiển thị | MOCK BROWSER screenshot; CODE AUDIT (không đụng JSX nội dung) | ✓ |
| PT-07 | Xem giấy tờ (3 mục: danh tính / chứng chỉ / ảnh sản phẩm) — **modal tự viết → `ui/dialog`** | MOCK BROWSER: mở, focus trap, Esc, trả focus, chuyển mục, axe | ✓ (Esc/focus mới) |
| PT-08 | Ghi chú nội bộ + phản hồi gửi người nộp | MOCK BROWSER (payload chứa adminNote/feedback) | ✓ |
| PT-09 | Duyệt có xác nhận (B1) — `POST …/review/APPROVE` | MOCK BROWSER: hộp xác nhận, Huỷ không gửi gì, Xác nhận gửi đúng URL | ✓ |
| PT-10 | Từ chối có xác nhận + bắt buộc lý do, `rejectionReason = feedback` (B1) | MOCK BROWSER: nút khoá khi thiếu lý do; POST REJECT chứa lý do | ✓ |
| PT-11 | Cần bổ sung (REQUEST_INFO), Xem xét (UNDER_REVIEW) | CODE AUDIT (không đổi, không có xác nhận như trước) | ✓ |
| PT-12 | Toast thành công/lỗi (`listingErrorMessage`), invalidate `["admin-pt-applications"]` | CODE AUDIT | ✓ |
| PT-13 | Về danh sách | MOCK BROWSER (nút mũi tên có tên truy cập, Back trình duyệt) | ✓ |
| PT-14 (mã) | Hồ sơ mở chi tiết = `useState` | **thay bằng `?id=`** (+ `?status=`): reload/Back/Forward | MOCK BROWSER ✓; id lạ → danh sách + dải ghi chú | ✓ |
| PT-15 (mã) | Mã hồ sơ in nguyên uuid | rút gọn 8 ký tự, bấm để sao chép | MOCK BROWSER (không in uuid đầy đủ) | ✓ |

## 2. Chi nhánh — `AdminGymModeration.tsx` (ADM-51..55)

| # | Chức năng | Cách kiểm | Kết quả |
|---|---|---|---|
| GY-01 | 5 tab (Chờ duyệt lần đầu / Đổi tên-địa chỉ / Đổi tên thương hiệu / Đã đóng cửa / Tất cả chi nhánh) kèm số đếm; 3 query `["admin-gyms"]`, `["admin-brands"]`, `["admin-gyms-permanently-closed"]` | MOCK BROWSER (từng tab, screenshot); CODE AUDIT | ✓ |
| GY-02 | Duyệt / Từ chối chi nhánh có xác nhận (B1) — `PATCH /admin/gyms/:id/status {status}` | MOCK BROWSER: xác nhận trước, Huỷ không gửi, PATCH REJECTED đúng; vòng focus (Esc, trả focus) | ✓ |
| GY-03 | Xem chi tiết review (`BranchReviewDetail`) | MOCK BROWSER (panel hiện, reload giữ) | ✓ |
| GY-04 | Yêu cầu chỉnh sửa theo hạng mục (`BranchReviewIssuesPanel` → `POST …/branch-review-issues`) | CODE AUDIT (không đổi) | ✓ |
| GY-05 | Duyệt đổi tên/địa chỉ gym; yêu cầu chỉnh sửa tên/địa chỉ (`RequestChangesPanel`) | CODE AUDIT | ✓ |
| GY-06 | Duyệt đổi tên thương hiệu | CODE AUDIT | ✓ |
| GY-07 | Danh sách đã đóng cửa vĩnh viễn + số hội viên cần hoàn | MOCK BROWSER screenshot (tab closed) | ✓ |
| GY-08 | Tất cả chi nhánh: tìm kiếm, sửa trực tiếp (`PATCH /admin/gyms/:id`) | MOCK BROWSER screenshot; CODE AUDIT | ✓ |
| GY-09 | Lỗi tải ≠ rỗng + Thử lại; 403; rỗng; skeleton | MOCK BROWSER 500/403/empty/hang | ✓ |
| GY-10 (mã) | Tab/chi nhánh xem chi tiết = `useState` | **`?tab=` + `?id=`**; tab mặc định → URL sạch; tab/id lạ → mặc định + ghi chú | MOCK BROWSER + UNIT ✓ |
| GY-11 (mã) | Pill trạng thái chi nhánh (`ModerationStatusBadge`, contrast thấp ở giao diện sáng) | `GymStatusPill` (token `--st-*`, cùng nhãn) | MOCK BROWSER axe | ✓ |

## 3. Đối tác phòng gym — `AdminPartnersPage.tsx` + `AdminApplicationsPanel.tsx` (ADM-56..70)

| # | Chức năng | Cách kiểm | Kết quả |
|---|---|---|---|
| PA-01 | Hồ sơ đăng ký: danh sách + đếm + bộ lọc 5 trạng thái (`GET /admin/partners/applications`) | MOCK BROWSER (list, empty, 500) | ✓ |
| PA-02 | Chi tiết hồ sơ: nội dung, giấy tờ, vấn đề, lịch sử, tiện ích, ảnh (`GET /admin/partners/:id/application`) | MOCK BROWSER (deep link `?id=`, screenshot); CODE AUDIT | ✓ |
| PA-03 | Chấp nhận giấy tờ, yêu cầu chỉnh sửa, đóng/mở lại vấn đề | CODE AUDIT (không đụng) | ✓ |
| PA-04 | **Phê duyệt hồ sơ** — `window.confirm` → `ConfirmDialog` (cùng nội dung) | MOCK BROWSER: hộp xác nhận, POST `/application/approve` sau khi xác nhận | ✓ |
| PA-05 | **Mở lại hồ sơ bị từ chối** — `window.confirm` → `ConfirmDialog` | CODE AUDIT (cùng cơ chế PA-04) | ✓ (không dựng được hồ sơ REJECTED trong mock) |
| PA-06 | Từ chối hồ sơ (lý do + ghi chú) | CODE AUDIT | ✓ |
| PA-07 | Danh sách đối tác: lọc trạng thái, tìm kiếm, hàng đợi "Cần bạn xử lý" (`GET /admin/partners?status`, `/queue`) | MOCK BROWSER (3 thẻ, chip → `?status=`) | ✓ |
| PA-08 | Chi tiết đối tác 8 tab: Tổng quan / Tài khoản / Chi nhánh / Giấy tờ / Tiền / Nhật ký / Ghi chú nội bộ / Khiếu nại (+ các `GET` con) | MOCK BROWSER (tab → `?tab=`, reload, Back/Forward); `api-calls-*` cùng tập | ✓ |
| PA-09 | Sửa hồ sơ đối tác + chiết khấu riêng (xác nhận đổi chiết khấu — B1) | CODE AUDIT (không đổi) | ✓ |
| PA-10 | Tài khoản: đổi tên chủ, đặt lại mật khẩu, **buộc đăng xuất (xác nhận)**, **thu hồi (xác nhận)**, chuyển quyền sở hữu (xác nhận), gửi lại/thu hồi thư mời | MOCK BROWSER: buộc đăng xuất + thu hồi — xác nhận trước, DELETE sau xác nhận, trả focus; còn lại CODE AUDIT | ✓ |
| PA-11 | Giấy tờ, nhật ký liên hệ, ghi chú nội bộ, trạng thái thẩm định, khiếu nại của đối tác | CODE AUDIT; tab hiển thị (MOCK BROWSER) | ✓ |
| PA-12 | Tạm khoá (lý do bắt buộc) / Bỏ tạm khoá — `ui/dialog` (đã dùng từ B1) | MOCK BROWSER: nút khoá khi thiếu lý do, POST `/suspend` chứa lý do, focus trap, Esc, trả focus (mới: về nút "Hành động") | ✓ |
| PA-13 | Chấm dứt hợp tác (xem trước hệ quả, chính sách hội viên, lý do) | MOCK BROWSER (khoá khi thiếu chính sách+lý do, focus, Esc) | ✓ |
| PA-14 | "Xem dưới góc nhìn đối tác" | MOCK BROWSER (mở, focus, Esc) | ✓ |
| PA-15 | Lỗi ≠ rỗng, 403, skeleton | MOCK BROWSER (partners 500/403/empty, apps 500/empty, partner 500/403, hang) | ✓ |
| PA-16 (mã) | View + đối tác chọn = `useState` | **`?view=&id=&tab=&status=`**; id đối tác/hồ sơ không tồn tại (404) → danh sách (replace) + dải ghi chú; view/tab lạ → mặc định | MOCK BROWSER + UNIT ✓ |
| PA-17 (mã) | Màu chữ trạng thái cứng (red/amber/green/blue-300/400) gây thiếu tương phản ở giao diện sáng | đổi sang token `--st-*` (cả 4 file) | MOCK BROWSER axe = 0 | ✓ |

## 4. Trang giữ nguyên (smoke)
`/admin/gym-management` (ADM-50) và `/admin/listings` (ADM-71..77): không sửa mã; MOCK BROWSER: tải được ở 1440/390, không tràn ngang, không lỗi trang. `AdminListingsPage` đã có `?tab=&rid=` (Master Plan: "giữ").

## 5. Lệch so với yêu cầu / ghi chú
- Truy vấn mới (thêm, cộng thêm, không đổi cái cũ): `["admin-pt-application-detail", id]` (cùng `GET /pt-applications/admin/:id`; hành vi "lỗi → dùng dòng danh sách" giữ nguyên). `getById` giờ gọi ở 2 chỗ (nạp trước khi mở + deep link) nhưng cùng URL, `staleTime 15s` nên không gọi đôi.
- `ui/dialog` đã dùng sẵn cho 4 hộp thoại đối tác từ B1; việc làm mới là modal giấy tờ PT + 2 `window.confirm`. Radix không trả focus cho hộp thoại không có Trigger → thêm `shared/b9aReturnFocus.ts` (không sửa `components/ui/*`).
- `AdminListingsPage`/`gym-management` không đổi (§2.3 "giữ"). Users + AI = B9b.
- Phân trang phía server cho PT/đối tác/chi nhánh: **không làm** (ngoài phạm vi "chuyển cơ học"; cần API — audit §6 P1).
- So sánh lời gọi trước/sau chạy trên HEAD (không có sửa của phiên khác) và worktree (có sửa của phiên khác): chênh duy nhất `GET /admin/payments/gateway-discrepancies` đến từ `useAdminNavBadges.ts` của phiên B3b, không phải từ 4 trang này.
