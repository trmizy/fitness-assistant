# GYM_PARTNER_WEB_KNOWN_ISSUES.md

Những điều còn thiếu, còn rủi ro, hoặc cố ý hoãn của luồng **Gym Partner Self-Service Onboarding**.
Cập nhật 2026-09-20 (kết thúc W3). Bằng chứng kiểm thử: `GYM_PARTNER_WEB_TEST_REPORT.md`.

## 1. Việc của ngày DEPLOY — không chặn tính năng

> **Đọc trước khi lo lắng.** Không mục nào dưới đây là lỗi của tính năng. Luồng đăng ký đối tác chạy
> đầy đủ và đã được kiểm kỹ trên stack dev cục bộ (Docker + Postgres + MinIO); nó **không phụ thuộc
> AWS** để hoạt động. Đây là danh sách việc cho **một phiên làm việc riêng về deploy**, do người vận
> hành AWS chủ trì. Tới lúc đó mở file này ra là đủ, không cần dựng lại bối cảnh.

| # | Vấn đề | Vì sao chặn | Việc cần làm |
|---|---|---|---|
| G1a | **Hành vi của S3 thật chưa nghiệm thu** | Điều kiện đã ký của presigned POST, mã hoá mặc định, presigned GET, CORS — MinIO có thể khác S3 | Chạy `scripts/partner-application-e2e/s3-smoke.ts` trên bucket thật (không chạm CSDL). Chạy bằng credential nào cũng được — phần này không phụ thuộc IAM của gym |
| G1b | **Policy IAM hẹp của role gym chưa nghiệm thu** | `Put/Get/Delete` trên `partner-applications/*` đủ hay không thì **chỉ chạy chính hàm Lambda với role đó mới biết**; chạy script bằng credential khác không kiểm được điều này | Nghiệm thu ở bước deploy. Rà bằng CODE AUDIT: code chỉ gọi PutObject (qua presigned POST), GetObject (HeadObject, GET theo Range, presigned GET) và DeleteObject; **không bao giờ ListBucket** — nên policy hiện tại là đủ |
| G2 | **Biến môi trường trên Lambda** | Hàm `fitness-assistant-dev-gym` cần `PARTNER_S3_PRIVATE_BUCKET` và `PARTNER_S3_REGION`; thiếu thì mọi upload trả **503 `UPLOADS_UNAVAILABLE`** | Người vận hành AWS đặt hai biến đó (đã yêu cầu). Không còn Terraform nào phải apply — `partner-uploads.tf` **đã xoá** |
| G3 | **Redis chia sẻ cho rate limit** | Limiter theo tiến trình không an toàn khi scale ngang. Production phải đặt `RATE_LIMIT_REQUIRE_SHARED=true`, và khi đó gateway **từ chối khởi động** nếu không có Redis | Cấp Redis (ElastiCache hoặc container) cho môi trường production |
| ~~G4~~ | ~~CloudFront/OAC cho ảnh công khai~~ | **Không còn cần (2026-09-20)** — đã bỏ bucket công khai; ảnh luôn riêng tư, phục vụ bằng presigned GET. Không bề mặt ẩn danh nào hiển thị ảnh phòng gym. | — |
| ~~G5~~ | ~~Chưa có địa chỉ hỗ trợ~~ | **Đã xong 2026-09-20** — `VITE_SUPPORT_EMAIL` mặc định `huytronh5@gmail.com` (trùng `SMTP_FROM`, thư trả lời về đúng hộp gửi) trong `docker-compose.dev.yml`; service `web` không có `env_file` nên giá trị phải nằm ở compose. Không phải bí mật: nó hiện trong bundle. | — |

| G6 | **Lambda gắn VPC có tới được S3 không** | Runbook ghi Lambda phải gắn VPC nếu Aurora private, và NAT Gateway nằm trong danh sách cần soi kỹ (khả năng cao là không có). VPC + không NAT + không **S3 Gateway Endpoint** = mọi lời gọi S3 **treo rồi timeout**: presign vẫn chạy (ký cục bộ), trình duyệt vẫn tải lên được, nhưng bước `confirm` (`HeadObject` + đọc magic bytes) chết → **không ai nộp được hồ sơ** | Kiểm `VpcConfig` của hàm gym; nếu có subnet thì xem route table có `com.amazonaws.ap-southeast-1.s3` không. Thiếu thì thêm **S3 Gateway Endpoint — miễn phí**, khác NAT. Dấu hiệu tốt: nếu hàm `user` đã gọi S3 thành công trên AWS thì đường mạng có sẵn |

### Vì sao danh sách này không thể đóng bằng cách test kỹ hơn ở cục bộ

Bốn lớp sau nằm ngoài tầm với của stack cục bộ **về nguyên lý**, không phải vì thiếu công sức:

| Lớp | Vì sao cục bộ không thấy |
|---|---|
| VPC không tới được S3 (G6) | Không có VPC ở máy cục bộ |
| Đường code chỉ chạy trên Lambda | `lambda.ts` / `jobs-lambda.ts` **chưa bao giờ** chạy cục bộ — đã có một lỗi thật lòi ra từ đây |
| Policy IAM hẹp của role gym (G1b) | Cục bộ dùng khoá MinIO toàn quyền |
| Nhiều instance (rate limit bộ nhớ) | Cục bộ chỉ một tiến trình |

Cách đóng duy nhất: **deploy lên dev rồi chạy một vòng đăng ký thật ở đó**. Một vòng đó đi qua VPC,
qua role thật, qua S3 thật, qua Lambda thật — thay thế được cả bốn lớp. Đừng cố suy đoán cho hết trước.

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
- **R7 — Job dọn tệp mồ côi chưa được bật.** Schedule `fitness-assistant-dev-gym-partner-upload-sweep`
  (`rate(1 day)`) đã tồn tại nhưng đang **DISABLED**, vì hàm `gym-jobs` đang chạy chưa có code của job
  này. Bật sau khi deploy nhánh `feature/payment-gateways`, nếu không mỗi ngày sẽ có một lần gọi hỏng.
- **R8 — Luồng đối tác chưa deploy.** Route `/owner/application/*`, ba migration mới và job dọn rác mới
  chỉ nằm trên nhánh, chưa lên Lambda dev nào và chưa chạy trên Aurora dev. Mọi kiểm chứng tới giờ là
  trên stack dev cục bộ.
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

- **Hồi quy chủ gym cũ qua trình duyệt (2026-09-21)** — đóng rủi ro R1 tự nêu từ đầu kế hoạch (tách
  `owner.routes.ts` + đổi nghĩa `isLegacy` nằm trên đường đi của chủ gym thật). 14/14:
  không bị đẩy sang vùng ứng viên, dashboard và ba trang vận hành mở được, tạo chi nhánh đúng thương
  hiệu và đi vòng duyệt bình thường. Kịch bản: `scripts/partner-application-e2e/legacy-owner-regression.cjs`.
- **Thanh toán ZaloPay thật (2026-09-21)** — REAL BROWSER, người dùng tự trả 300.000đ: giao dịch PAID,
  hợp đồng ACTIVE gắn đúng mã giao dịch, chia 270k cho gym + 30k hoa hồng, **không cộng trùng** (đúng 3
  bút toán), không sinh giao dịch hay hợp đồng trùng. Webhook của ZaloPay không tới được localhost mà
  giao dịch vẫn về PAID — chứng minh đường `/payments/:id/sync` hoạt động đúng.
- **Hai lỗi giao diện CÓ SẴN, phát hiện khi hồi quy và đã sửa (2026-09-21)**:
  - `GymOwnerDashboard` truyền `gymId` vào `listOwnedPlans(brandId)` → 404 mỗi lần mở dashboard và ô
    "Gói hội viên đang bán" luôn bằng 0. Sau khi sửa: 20, hết 404.
  - Lưới tìm phòng gym dùng `align-items: stretch`, một chuỗi 40 chi nhánh bung ra kéo hai thẻ cùng
    hàng cao 1811px thành ô rỗng. Sau khi sửa: thẻ bung 472px, thẻ bên cạnh giữ 152px.

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
- **Sửa lỗi guard không chạy trên Lambda (2026-09-21, commit `8b1404e`)**: guard được gọi ở `server.ts`,
  nhưng Lambda có entrypoint riêng và không đi qua đó — nên trên AWS, lời hứa "cấu hình sai thì từ chối
  khởi động" là sai; lỗi chỉ lộ ra khi có người tải tệp. Nay gọi ở cả `lambda.ts` và `jobs-lambda.ts`.
  Đây là lớp lỗi **chỉ môi trường AWS mới phơi bày**.
- Gỡ luồng admin tạo/cấp tài khoản chủ gym: 410 cho hai endpoint, xoá code chết ở auth-service, gateway và
  web. Hạ tầng mời MANAGER giữ nguyên và đã hồi quy.
