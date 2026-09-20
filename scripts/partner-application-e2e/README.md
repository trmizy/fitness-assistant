# Gym Partner self-service onboarding — E2E scripts

Chạy trên stack dev thật (`docker compose -f infra/compose/docker-compose.dev.yml up -d`). Cần bật chế độ thử nghiệm để không gửi email thật và lấy được link:

    PARTNER_APPLICATION_DEV_ECHO=true docker compose -f infra/compose/docker-compose.dev.yml up -d auth-service gym-service

(đổi lại về mặc định sau khi chạy). Dùng Playwright của harness ngoài repo (`D:/fitnessassistant-playwright-e2e`) và tài khoản seed (`admin@example.com`, `john.doe@example.com`, `pt@example.com`).

| Script | Nhãn bằng chứng | Nội dung |
|---|---|---|
| `browser-e2e.cjs` | REAL BROWSER | luồng chính: CTA → email → magic link → mật khẩu → wizard → nộp → admin yêu cầu sửa → nộp lại → duyệt → dashboard |
| `browser-e2e-mobile.cjs` | REAL BROWSER | như trên ở 360/390/412px (`W=390 node ...`), kèm kiểm tràn ngang |
| `api-e2e.mjs` | REAL HTTP/API | magic link, phân quyền, upload, vòng đời giấy tờ/issue, approve song song, gỡ luồng cũ (410), log không lộ token |
| `admin-regression.cjs` | REAL BROWSER | danh sách/chi tiết đối tác cũ của admin còn chạy, không còn nút tạo/cấp tài khoản |

Mỗi lần chạy tạo dữ liệu `@partner-e2e.test`; dọn bằng cách xoá các user/partner/brand/gym đó ở DB dev và đối tượng trong MinIO. Không chạy trên DB có dữ liệu thật của khách.
