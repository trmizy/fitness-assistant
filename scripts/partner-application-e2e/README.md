# Gym Partner self-service onboarding — E2E scripts

Chạy trên stack dev thật (`docker compose -f infra/compose/docker-compose.dev.yml up -d`). Cần bật chế độ thử nghiệm để không gửi email thật và lấy được link:

    PARTNER_APPLICATION_DEV_ECHO=true docker compose -f infra/compose/docker-compose.dev.yml up -d auth-service gym-service

(đổi lại về mặc định sau khi chạy). Dùng Playwright của harness ngoài repo (`D:/fitnessassistant-playwright-e2e`) và tài khoản seed (`admin@example.com`, `john.doe@example.com`, `pt@example.com`).

| Script | Nhãn bằng chứng | Nội dung |
|---|---|---|
| `browser-e2e.cjs` | REAL BROWSER | luồng chính: CTA → email → magic link → mật khẩu → wizard → nộp → admin yêu cầu sửa → nộp lại → duyệt → dashboard |
| `browser-e2e-mobile.cjs` | REAL BROWSER | như trên ở 360/390/412px (`W=390 node ...`), kèm kiểm tràn ngang |
| `api-e2e.mjs` | REAL HTTP/API | magic link, phân quyền, upload, vòng đời giấy tờ/issue, approve song song, gỡ luồng cũ (410), log không lộ token |
| `s3-smoke.ts` | REAL HTTP/API | **Không chạm CSDL, không HTTP ứng dụng.** Nghiệm thu bucket S3 thật trước khi deploy: presigned POST + điều kiện đã ký, HEAD, mã hoá, presigned GET, bỏ chữ ký → 403, CORS, xoá. Mọi khoá nằm dưới `partner-applications/smoke-test/` và được dọn sạch |
| `admin-regression.cjs` | REAL BROWSER | danh sách/chi tiết đối tác cũ của admin còn chạy, không còn nút tạo/cấp tài khoản |

Mỗi lần chạy tạo dữ liệu `@partner-e2e.test`; dọn bằng cách xoá các user/partner/brand/gym đó ở DB dev và đối tượng trong MinIO. Không chạy trên DB có dữ liệu thật của khách.

## Nghiệm thu bucket AWS thật (`s3-smoke.ts`)

Script duy nhất được phép trỏ vào hạ tầng thật — các script còn lại tạo người dùng và hồ sơ trong CSDL
nên **không bao giờ** chạy với Aurora dev.

```
cd backend/services/gym-service
PARTNER_S3_PRIVATE_BUCKET=<tên bucket> PARTNER_S3_REGION=ap-southeast-1 PARTNER_S3_SMOKE_ORIGIN=<origin của web> npx tsx ../../../scripts/partner-application-e2e/s3-smoke.ts
```

Không truyền khoá trên dòng lệnh: SDK tự đọc `~/.aws/credentials`, hoặc IAM role nếu chạy trong AWS.

**Kiểm được**: bucket, region, CORS, điều kiện đã ký của presigned POST, mã hoá mặc định, presigned GET.
**Không kiểm được**: policy IAM hẹp của role gym-service — chạy bằng credential nào thì kiểm quyền của
credential đó. Phần ấy chỉ nghiệm thu được khi chính hàm Lambda chạy với role của nó (xem G1b trong
`GYM_PARTNER_WEB_KNOWN_ISSUES.md`).
