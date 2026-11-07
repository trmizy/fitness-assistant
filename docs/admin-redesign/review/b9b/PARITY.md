# B9b — Parity (Người dùng, Giám sát hệ thống, Giám sát AI)

Nguồn: `audit/01_ADMIN_FRONTEND_INVENTORY.md` + đọc mã. Bằng chứng: **MOCK BROWSER TEST** (`page.route`, không backend thật; `scratchpad/b9b/run.mjs` → `b9b-results.json`, 171/171; smoke → `b9b-smoke-results.json`, 11/11), **UNIT** (`b9b-url-state.test.ts`, 5 ca), **CODE AUDIT**.
Lời gọi API trước/sau: `api-calls-before.txt` / `api-calls-after.txt` (cùng kịch bản). Khác biệt duy nhất: thêm `GET /admin/dashboard` (khối OCR chuyển vào Giám sát AI, cùng endpoint + query key `["admin-dashboard"]` như Tổng quan cũ). `/admin/users` vẫn không phân trang: lọc + chia trang phía client (20/trang), không thêm tham số server.

## 1. Người dùng — `UserManagement.tsx`
| # | Chức năng | Cách kiểm | KQ |
|---|---|---|---|
| US-01 | Danh sách `GET /admin/users` (không phân trang), đếm tổng/đang hoạt động | MOCK BROWSER (27 → 20 + 7, "27 · 17") | ✓ |
| US-02 | Tìm tên/email, lọc vai trò (8 lựa chọn gồm vai trò đối tác thật), lọc trạng thái | MOCK BROWSER (lọc Pending, MANAGER, tìm) | ✓ → vào URL `?q ?role ?status` |
| US-03 | Tra vai trò đối tác `GET /admin/partner-accounts/roles?userIds` (≤200/lần), lỗi → nhãn mặc định | MOCK BROWSER (call còn), CODE AUDIT (không đổi) | ✓ |
| US-04 | Bảng → `DataTable` (thẻ ở 390), nhãn Việt, pill token `--st-*` | MOCK BROWSER 1440/390/dark, axe | ✓ |
| US-05 | Chi tiết: panel `useState` → `ui/dialog` + `?id=` (reload/Back/Forward/Esc/trả focus) | MOCK BROWSER | ✓ |
| US-06 | Đổi vai trò (`PATCH /admin/users/:id/role {role}`, khoá khi không đổi) | MOCK BROWSER payload | ✓ |
| US-07 | Khóa / Mở khóa (`PATCH …/disable|enable`), huỷ không gửi gì, tự khoá/đổi vai trò bản thân bị chặn | MOCK BROWSER | ✓ |
| US-08 | Làm mới; lỗi ≠ rỗng + Thử lại; 403 không có Thử lại; skeleton; rỗng | MOCK BROWSER 500/403/empty/hang | ✓ |
| US-09 (mã) | Nút "Xem hồ sơ đầy đủ" và "Duyệt PT" không có handler (vô dụng) | **bỏ** (không có hành vi để giữ) | ghi chú |
| US-10 (mã) | Dialog xác nhận → `ActionDialog` trên `ui/dialog` (role alertdialog); nút chính emerald-700 vì `ConfirmDialog` mặc định emerald-600/trắng = 3.76:1 (trượt AA) | axe | ✓ |

## 2. Giám sát hệ thống — `SystemMonitoring.tsx`
| # | Chức năng | Cách kiểm | KQ |
|---|---|---|---|
| SY-01 | `GET /admin/system-monitor`, tự làm mới 30s, nút Làm mới, điểm sức khỏe, thẻ dịch vụ, biểu đồ độ trễ/uptime, Grafana, sự cố | MOCK BROWSER (75%, 3/4, sự cố) | ✓ |
| SY-02 | Lỗi tải ≠ rỗng + Thử lại; 403; skeleton | MOCK BROWSER | ✓ |
| SY-03 (đổi) | Làm mới lỗi: trước = thay cả trang bằng lỗi; nay giữ số liệu cũ + dải cảnh báo | MOCK BROWSER | ✓ (cải thiện) |
| SY-04 (đổi) | Chân trang in endpoint kỹ thuật → ẩn | MOCK BROWSER | ✓ |
| SY-05 | Màu cứng cam/đỏ/vàng (contrast) → token `--st-*` | axe | ✓ |
Không có `?id/?tab` (trang không có danh sách/tab).

## 3. Giám sát AI — `AdminAIObservability.tsx`
| # | Chức năng | Cách kiểm | KQ |
|---|---|---|---|
| AI-01 | 5 GET song song (overview, requests, queue, errors, knowledge); KPI; biểu đồ ý định/ngôn ngữ | MOCK BROWSER, api-calls | ✓ |
| AI-02 | Tab Yêu cầu/Hàng đợi/Lỗi/Kiến thức → `?tab=` | MOCK BROWSER (reload, Back) | ✓ |
| AI-03 | Lọc (Tất cả/Dự phòng/Chậm/Cảnh báo) → `?filter=`, trang → `?page=`; request `filter=slow&page=1&limit=20` y nguyên | MOCK BROWSER | ✓ (đổi lọc/trang không còn nháy cả trang, cùng request) |
| AI-04 | Chi tiết yêu cầu (`GET /admin/ai/requests/:id`): ngăn kéo tự viết → `ui/dialog` + `?id=`; id lạ (404) → danh sách + ghi chú | MOCK BROWSER (focus trap, Esc, trả focus, 500 trong dialog) | ✓ |
| AI-05 | Thao tác Kiến thức (enqueue/approve/reject/schedule/clear) | CODE AUDIT (không đổi) | ✓ |
| AI-06 | Lỗi/skeleton/403 toàn trang (không hiện KPI 0) | MOCK BROWSER | ✓ |
| AI-07 (thêm, Ngài duyệt) | "Thống kê quét InBody OCR (7 ngày)" {total, extracted, manual, pending} từ `GET /admin/dashboard` → `data.ocrStats`, key `["admin-dashboard"]`; loading skeleton, lỗi riêng + Thử lại, không hiện 0 | MOCK BROWSER (14/9/3/2; 500; hang; 403 AI vẫn hiện OCR) | ✓ |
| AI-08 | Chuỗi tiếng Anh ("in last 24h", "Relevance", "warning", "click for trace") → tiếng Việt; chip/trạng thái → token; biểu đồ tròn trang trí ẩn khỏi AT | axe | ✓ |
Lưu ý (CODE AUDIT, gateway): khi user-service không trả stats, gateway điền `ocrStats` = 0 → UI không phân biệt được "không biết" với 0; cần backend (không sửa ở đây).
