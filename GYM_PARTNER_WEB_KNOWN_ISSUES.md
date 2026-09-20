# GYM_PARTNER_WEB_KNOWN_ISSUES.md

Những điều còn thiếu, còn rủi ro, hoặc cố ý hoãn của luồng **Gym Partner Self-Service Onboarding**.
Cập nhật 2026-09-20 (kết thúc W3). Bằng chứng kiểm thử: `GYM_PARTNER_WEB_TEST_REPORT.md`.

## 1. Chặn go-live (phải xong trước khi deploy production)

| # | Vấn đề | Vì sao chặn | Việc cần làm |
|---|---|---|---|
| G1 | **Chưa từng test trên AWS S3 thật** | Toàn bộ upload mới chỉ chạy trên MinIO cục bộ; hành vi riêng của S3 (điều kiện presigned POST, CORS, mã hoá mặc định, quyền IAM theo prefix) chưa được xác nhận | Cần quyền truy cập bucket từ máy dev (IAM user tạm hoặc role assume được), rồi chạy một smoke test **chỉ chạm S3** — không chạy `api-e2e.mjs` vì nó ghi dữ liệu thử vào DB |
| G2 | **Biến môi trường trên Lambda** | Hàm `fitness-assistant-dev-gym` cần `PARTNER_S3_PRIVATE_BUCKET` và `PARTNER_S3_REGION`; thiếu thì mọi upload trả **503 `UPLOADS_UNAVAILABLE`** | Người vận hành AWS đặt hai biến đó (đã yêu cầu). Không còn Terraform nào phải apply — `partner-uploads.tf` **đã xoá** |
| G3 | **Redis chia sẻ cho rate limit** | Limiter theo tiến trình không an toàn khi scale ngang. Production phải đặt `RATE_LIMIT_REQUIRE_SHARED=true`, và khi đó gateway **từ chối khởi động** nếu không có Redis | Cấp Redis (ElastiCache hoặc container) cho môi trường production |
| ~~G4~~ | ~~CloudFront/OAC cho ảnh công khai~~ | **Không còn cần (2026-09-20)** — đã bỏ bucket công khai; ảnh luôn riêng tư, phục vụ bằng presigned GET. Không bề mặt ẩn danh nào hiển thị ảnh phòng gym. | — |
| ~~G5~~ | ~~Chưa có địa chỉ hỗ trợ~~ | **Đã xong 2026-09-20** — `VITE_SUPPORT_EMAIL` mặc định `huytronh5@gmail.com` (trùng `SMTP_FROM`, thư trả lời về đúng hộp gửi) trong `docker-compose.dev.yml`; service `web` không có `env_file` nên giá trị phải nằm ở compose. Không phải bí mật: nó hiện trong bundle. | — |

## 2. Rủi ro đã biết, chấp nhận có điều kiện

- **R1 — Lộ sự tồn tại email.** `/auth/partner-applications/start` trả 409 rõ ràng khi email đã có tài
  khoản. Đây là **lựa chọn sản phẩm đã chốt** (chặn ngay ở bước nhập email cho thân thiện), và trùng
  với hành vi sẵn có của `/auth/register`. Ghi trong `GYM_PARTNER_SECURITY_MODEL.md` §4.
- **R2 — OpenStreetMap tile.** Bản đồ dùng tile công cộng của OSM, chỉ hợp lý ở lưu lượng nhỏ (fair-use).
  Lưu lượng lớn cần nhà cung cấp tile riêng. Lỗi tải bản đồ đã có đường lui: nút "Dùng vị trí hiện tại".
- **R3 — Không có EXPIRED/WITHDRAWN.** Hồ sơ bỏ dở nằm mãi ở ONBOARDING; không tự xoá, không tự hết hạn.
  Cố ý hoãn (quyết định D7).
- **R4 — Email chỉ là thông báo.** Gửi sau commit, lỗi gửi chỉ log, không rollback và **không có hàng đợi
  thử lại**. Sự thật luôn là trạng thái hồ sơ trên hệ thống.
- **R5 — Ảnh chi nhánh cũ vẫn nằm trên đĩa container.** Luồng ảnh cũ (`/uploads/gym-photos`, multer) không
  bị đụng tới và **không** có volume trong compose dev cho gym-service; trên Lambda thì các đường ghi đĩa
  này bị khoá 503. Di trú ảnh cũ sang S3 là **hạng mục riêng, chưa nằm trong kế hoạch**.
- **R7 — Job dọn tệp mồ côi cần lịch chạy.** `partner-upload-sweep` đã có trong `jobs-lambda.ts` nhưng
  chỉ chạy khi có EventBridge Scheduler gọi tới (giống hai sweep sẵn có). Chưa có lịch thì tệp bỏ dở
  vẫn tích tụ.
- **R6 — Hai module S3 song song.** `user-service/s3-upload.service.ts` (presigned PUT, `USER_UPLOAD_BUCKET`)
  và `gym-service/partner-s3.service.ts` (presigned POST, hai bucket) không dùng chung code. Gộp lại là việc
  dọn dẹp về sau, không cần cho luồng này.

## 3. Đã đối chiếu lại / cố ý không làm

- **Dashboard chủ gym**: đã rà 2026-09-20 với dữ liệu thật — mọi KPI, biểu đồ và bảng đều khớp DB, không
  có số bịa, bảng rỗng dùng empty state thật. Mục này **đóng**.
- **`PartnerOnboardingWizard`**: đã kiểm thật — sau khi duyệt, ứng viên **không bị hỏi lại** liên hệ/thương
  hiệu/điều khoản; wizard mở thẳng bước "Thông tin nhận tiền" (Bước 3/4). Chỉ còn gợn thẩm mỹ ở thanh tiến
  độ. **Không phải lỗi**, không làm.
- **Mobile (`frontend/mobile`) đóng băng ở Phase 7/15** — không đụng tới, không có màn hồ sơ đối tác.

## 4. Nợ kỹ thuật nhỏ

- `frontend/web` **không có tsconfig** nên không chạy được typecheck riêng; chỉ dựa vào `vite build`.
- Bundle `index.js` của web đã ~906 kB (cảnh báo của Vite). Leaflet được tách chunk riêng nên không làm
  nặng thêm đường vào chính, nhưng việc chia nhỏ bundle là nợ có sẵn từ trước.
- `scripts/partner-application-e2e/*` gọi Playwright từ harness **ngoài repo**
  (`D:/fitnessassistant-playwright-e2e/node_modules`). Máy khác muốn chạy phải sửa đường dẫn đó.
- Các script E2E tạo dữ liệu `@partner-e2e.test` và **không tự dọn**; phải xoá thủ công (README có ghi).

## 5. Đã đóng trong đợt này

- **Một bucket riêng tư (2026-09-20)**: bỏ bucket công khai, bỏ `CopyObject` sau duyệt, bỏ endpoint
  `publish-photos`, bỏ `PARTNER_S3_PUBLIC_BUCKET`/`_PUBLIC_BASE_URL`, **xoá `partner-uploads.tf`**.
  Ảnh sau duyệt vẫn PRIVATE, phục vụ bằng presigned GET. Cột `GymPhoto.visibility` **giữ nguyên**
  (không migration phá huỷ), chỉ ngừng ghi `PUBLIC`.
- **Dọn tệp mồ côi (2026-09-20)**: `partner-upload-sweep.service.ts` + job cùng tên trong
  `jobs-lambda.ts`. Xoá S3 trước, xoá dòng DB sau, để lần chạy sau thử lại được nếu S3 lỗi.

- **Logo thương hiệu (2026-09-20)**: tuỳ chọn, chủ gym tự thêm ở bước Thương hiệu, thay lúc nào cũng được;
  không nằm trong danh sách "còn thiếu" nên không chặn nộp hồ sơ. Lưu ở bucket riêng tư cùng chỗ với hồ sơ,
  đọc bằng presigned GET. Admin thấy logo trong màn duyệt. Migration `20260920000000_partner_brand_logo_upload`
  (chỉ thêm giá trị `LOGO` vào enum `PartnerUploadKind`).
- **Thông báo đăng nhập khi tài khoản bị vô hiệu (2026-09-20)**: đối tác bị tạm khoá/chấm dứt thì auth-service
  khoá tài khoản chủ sở hữu và trả 403 "Tài khoản đã bị vô hiệu hóa", nhưng `LoginPage` nuốt mất và hiện
  "Đã xảy ra lỗi. Vui lòng thử lại." — mời họ thử mãi mà không bao giờ vào được. Nay hiện đúng lý do server nói.
- Guard production cho lưu trữ: `gym-service/src/services/partner-s3.guard.ts` — production không thể trỏ
  nhầm vào MinIO/localhost; có 13 test.
- Gỡ luồng admin tạo/cấp tài khoản chủ gym: 410 cho hai endpoint, xoá code chết ở auth-service, gateway và
  web. Hạ tầng mời MANAGER giữ nguyên và đã hồi quy.
