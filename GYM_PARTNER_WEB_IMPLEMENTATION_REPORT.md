# GYM_PARTNER_WEB_IMPLEMENTATION_REPORT.md

Báo cáo thực thi **Gym Partner Self-Service Onboarding** — W0 (audit) → W1 (backend) → W2 (web) → W3
(kiểm thử + ổn định + gỡ luồng cũ). Kết thúc 2026-09-20. Mobile **đóng băng ở Phase 7/15**, không đụng.

Tài liệu liên quan: `GYM_PARTNER_SELF_ONBOARDING_SPEC.md`, `GYM_PARTNER_STATE_MACHINE.md`,
`GYM_PARTNER_SELF_ONBOARDING_API_GAPS.md`, `GYM_PARTNER_SECURITY_MODEL.md`,
`GYM_PARTNER_WEB_ROUTE_MAP.md`, `GYM_PARTNER_WEB_TEST_REPORT.md`, `GYM_PARTNER_WEB_KNOWN_ISSUES.md`.

## 1. Kết quả nghiệp vụ

Trước: chủ phòng gym chỉ vào được Gymini khi admin tạo hồ sơ tay rồi bấm "Cấp tài khoản" và gửi link mời.

Nay có **một đường duy nhất**: chủ gym tự đăng ký bằng email → liên kết xác minh → đặt mật khẩu → vùng
onboarding hạn chế → khai người đại diện, **một** thương hiệu, quy mô, chi nhánh đầu, vị trí trên bản đồ,
ảnh, giấy tờ pháp lý → nộp → admin duyệt từng giấy tờ, yêu cầu chỉnh sửa, phê duyệt hoặc từ chối → **chỉ
sau khi phê duyệt** mới là chủ gym vận hành.

Bất biến giữ nguyên: **1 Owner = 1 Brand = 1..N Branch**. Thương hiệu luôn suy từ danh tính, không bao giờ
là input của người dùng.

## 2. Kiến trúc (tóm tắt những gì đã xây)

### auth-service — cổng công khai
- Model `PartnerApplicationToken` (migration `20260919010000_partner_application_tokens`): chỉ lưu **băm
  sha256**, cooldown 60 s + trần số email/ngày **đọc từ DB** (an toàn khi nhiều instance), `setupToken`
  15 phút dùng một lần.
- `POST /auth/partner-applications/{start,verify,set-password}`. Link trong email là **fragment**
  (`#token=`), `verify` là **POST** nên bộ quét email không tiêu link và **không** tiêu token; chỉ
  `set-password` mới tiêu.
- Cờ dev `PARTNER_APPLICATION_DEV_ECHO` (mặc định tắt, bị bỏ qua khi `NODE_ENV=production`) trả link trong
  response và không gửi email thật — dùng cho E2E.

### gym-service — hồ sơ, cổng vận hành, duyệt
- Migration `20260919000000_partner_self_service_application` + `20260919020000_partner_document_viewed_audit`
  (**chỉ cộng thêm**, không xoá cột/enum): `GymPartner` thêm `submittedAt`/người đại diện/quy mô,
  `GymBrand.logoKey` + `@@unique(ownerId)`, `GymPartnerDocument` thêm `fileKey`/`mimeType`/`sizeBytes`/
  `version`/`reviewNote`, bảng `PartnerUploadIntent`, `GymPhoto` thêm `s3Key`/`category`/`visibility`,
  model `GymPartnerReviewIssue`, 13 giá trị mới cho `PartnerAuditAction`.
- **Cổng vận hành cho phép dương tính** (`partner-access.policy.ts`): `switch` vét cạn trên
  `GymPartnerStatus` kèm `assertNever` — thêm giá trị enum mới sẽ **lỗi biên dịch** cho tới khi được phân
  loại; mọi nhánh không nhận diện = DENY. Chỉ cho qua khi partner ACTIVE + VERIFIED + account ACTIVE +
  `onboardingCompletedAt`. Sửa luôn lỗ hổng `isLegacy`: "không có account" **tự nó** không còn nghĩa là
  full quyền — phải **chứng minh được** sở hữu cũ (`Gym.ownerId` hoặc `GymBrand.ownerId`).
- `owner.routes.ts` tách làm hai: vùng ứng viên (`/owner/application/*`, `/owner/onboarding/*`) đứng trước
  cổng; vùng vận hành đứng sau `requireOperationalAccess`.
- `/owner/application/*`: status, bootstrap (idempotent), get, timeline (đọc từ `PartnerAuditLog`), lưu từng
  phần, presign/confirm, quản lý ảnh, submit/resubmit/mark-updated.
- `/admin/partners/:id/application/*`: xem hồ sơ + `approve.blockers`, xem giấy tờ (presigned GET 120 s,
  **mỗi lần xem ghi `DOCUMENT_VIEWED`**), accept từng giấy tờ, request-changes, resolve/reopen issue,
  approve, reject, reopen, publish-photos.
- **Approve là một `prisma.$transaction` thật**: khoá dòng + `updateMany` có điều kiện (bấm đúp/2 admin →
  409), đọc lại điều kiện **trong** transaction, duyệt luôn chi nhánh đầu bằng `applyGymApprovalTx` (bản
  theo-transaction của `gymService.setStatus`), ghi audit trong cùng transaction. Email và `CopyObject`
  ảnh chạy **sau** commit, thử lại được.

### Lưu trữ
- Presign → trình duyệt POST thẳng lên kho → confirm. **Khoá đối tượng do server sinh**; client chỉ có
  `uploadId`. `confirm` chạy HEAD (cỡ, content-type) rồi đọc **magic bytes**, sai thì **xoá object**.
- Hai mức phơi nhiễm: bucket **riêng tư** cho giấy tờ và ảnh khi đang chờ duyệt; bucket **công khai** chỉ
  nhận ảnh **sau khi duyệt** qua `CopyObject`. Giấy tờ **không bao giờ** được sao chép.
- MinIO chỉ dùng cho **dev/test**; production dùng S3 gốc của AWS. `partner-s3.guard.ts` khiến production
  **không khởi động được** nếu cấu hình trỏ về endpoint tuỳ chỉnh, path-style, khoá tĩnh hoặc URL công khai
  không phải https / trỏ về localhost, `minio`, IP nội bộ.

### gateway
- Proxy `/owner/application`; limiter riêng cho `/auth/partner-applications/(start|resend)` dùng **store
  Redis** khi có `REDIS_URL`, rơi về bộ nhớ chỉ cho local, và `RATE_LIMIT_REQUIRE_SHARED=true` làm gateway
  **từ chối khởi động** khi thiếu store chia sẻ.

### frontend/web
- Công khai: `/partner/apply`, `/partner/apply/verify` (gộp cả bước đặt mật khẩu). Token bị xoá khỏi
  URL/history **trước** mọi lời gọi API; `setupToken` chỉ nằm trong `sessionStorage` của tab.
- `/partner/application`: **một route**, trạng thái từ server chọn giao diện — wizard 8 bước, trang "đã gửi"
  + timeline, hoặc trang bị từ chối.
- Điều hướng theo trạng thái hồ sơ: `useGymOwnerAccessState` (khoá cache theo userId), `RootRedirect`,
  `RequirePartnerApplicant`, `RequireApprovedPartner`.
- Admin: `AdminPartnersPage` thành hai tab — **Hồ sơ đăng ký** (hàng đợi + màn duyệt) và **Đối tác** (danh
  sách cũ).
- Bản đồ Leaflet + OpenStreetMap, nạp động thành chunk riêng.
- Tải lên **độc lập nhà cung cấp lưu trữ**: không có một dòng logic MinIO/S3 nào ở frontend.

## 3. Gỡ luồng admin cũ (W3.9 — chỉ làm sau khi qua cổng ổn định)

- `POST /admin/partners`, `POST /admin/partners/:id/provision` → **410 `ENDPOINT_RETIRED`**.
- Xoá code chết: `createGymOwnerAccount`, `authController.createGymOwner`, `/auth/admin/gym-owners`, hai
  route gateway `/admin/gym-owners`, 4 wrapper web `@deprecated`. UI: `CreatePartnerModal`,
  `ProvisionResultModal`, nút "Hồ sơ mới", nút "Cấp tài khoản", thẻ "đã mời > 7 ngày".
- **Giữ nguyên**: hạ tầng mời MANAGER và nhánh tiêu thụ lời mời OWNER cũ còn PENDING.
- **Không xoá** cột hay enum nào. 12 hồ sơ đối tác cũ tạo tay không bị đổi.

## 4. Những chỗ đã làm khác kế hoạch (và vì sao)

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| `set-password` là **saga hai datastore** | `set-password` chỉ ghi **một** datastore (auth) rồi client gọi `POST /owner/application/bootstrap` | Đơn giản hơn và an toàn hơn: user chưa bootstrap chỉ là `SETUP_INCOMPLETE`, **không có quyền vận hành nào**; `bootstrap` idempotent theo `userId` UNIQUE |
| Nhiều route con `/partner/application/*` | **Một** route, trạng thái server chọn giao diện | Tránh URL nói một đằng trạng thái một nẻo; tải lại trang luôn đúng thật |
| Dùng lại `WizardShell`/`StepPhotos` của wizard chi nhánh | Khung wizard riêng | Wizard chi nhánh gắn với vòng duyệt chi nhánh riêng; dùng lại sẽ kéo theo bước không thuộc hồ sơ |
| Autosave từng phím | Lưu khi bấm "Tiếp tục" | Mỗi bước là một lời gọi API có kiểm; mở lại vào đúng bước đầu tiên còn thiếu |
| `/pt/:ptUserId/gyms` phải qua cổng | Xác nhận đây là **route công khai** | Không gắn `authMiddleware`; trả kết quả như nhau dù có token hay không — không phải lỗ hổng |

## 5. Thay đổi hạ tầng kèm theo

- `COPY patches ./patches` vào 8 `Dockerfile.dev` của backend + `frontend/web/Dockerfile.dev` — `pnpm.patchedDependencies`
  ở root làm build container hỏng nếu thiếu.
- Compose dev: thêm `minio` + `minio-init` + volume, các biến `PARTNER_S3_*`, `REDIS_URL` và limiter cho
  gateway, `PARTNER_APPLICATION_DEV_ECHO`.
- Phụ thuộc mới: `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`
  (gym-service); `rate-limit-redis` (gateway); `leaflet` + `@types/leaflet` (web).
- `infra/terraform/environments/dev/partner-uploads.tf` — **viết nhưng chưa apply** (theo D9).

## 6. Kiểm chứng

Xem `GYM_PARTNER_WEB_TEST_REPORT.md`. Tóm tắt: 241 + 59 + 29 test backend, 90 kiểm tra REAL HTTP/API,
26 bước REAL BROWSER ở desktop và 30 bước ở mỗi độ rộng 360/390/412, 4 kiểm tra hồi quy admin cũ — tất cả
xanh sau khi gỡ luồng cũ. Script tái lập ở `scripts/partner-application-e2e/`.

**Chưa kiểm:** AWS S3 thật, Terraform apply, Redis production, hồi quy toàn repo. Chi tiết và các hạng mục
chặn go-live ở `GYM_PARTNER_WEB_KNOWN_ISSUES.md`.

## 7. Trạng thái git

Nhánh `feature/payment-gateways`, **chưa commit, chưa push** (theo D8). Khoảng 103 đường dẫn thuộc task này
(không tính `frontend/mobile`, `.claude/skills`, `frontend/web/android` là của workstream khác).
