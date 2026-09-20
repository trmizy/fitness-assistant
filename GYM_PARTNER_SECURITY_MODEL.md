# GYM_PARTNER_SECURITY_MODEL.md

Mô hình bảo mật của luồng đối tác tự đăng ký. Nguyên tắc chung: **backend ép quyền; giao diện chỉ là tiện ích**. Mọi điều dưới đây phải có test ở W3.

## 1. Cổng vận hành — cho phép dương tính, mặc định từ chối

Hàm thuần `evaluateOperationalAccess(ctx) → {allowed, code}` viết bằng `switch` **vét cạn** trên `GymPartnerStatus` (kèm `assertNever`):
thêm giá trị enum mới = lỗi biên dịch cho tới khi được phân loại. Mọi nhánh không nhận diện = **DENY**.

Cho phép truy cập vận hành thường **chỉ khi đồng thời**:

```
partner.status === ACTIVE
AND partner.verificationStatus === VERIFIED
AND partnerAccount.status === ACTIVE
AND partnerAccount.onboardingCompletedAt != null
```

| Thiếu | Kết quả |
|---|---|
| không có account & không chứng minh được legacy | 403 `NO_PARTNER_ACCOUNT` |
| `account.status !== ACTIVE` | 403 (như hiện nay) |
| `partner.status ∈ {PROSPECT, INVITED}` | 403 `PARTNER_APPLICATION_PENDING` |
| `verificationStatus !== VERIFIED` | 403 `PARTNER_NOT_VERIFIED` |
| `partner.status = SUSPENDED` | OWNER: 403 `PARTNER_SUSPENDED`; MANAGER: giữ phạm vi hiện có (đúng `GYM_PARTNER_SUSPENSION_CONSEQUENCES.md`) |
| `partner.status = TERMINATED` | 403 `PARTNER_TERMINATED` |
| chỉ thiếu `onboardingCompletedAt` | **409** `ONBOARDING_INCOMPLETE` (vừa duyệt, còn payout) — hành vi hiện tại, không phải ứng viên |
| giá trị chưa biết | 403 mặc định |

Áp dụng cho **mọi** route vận hành: toàn `/owner/*` của gym-service (trừ nhóm ứng viên, mục 2) và nhánh GYM_OWNER của `/me/collaborations`.
Test: ma trận chạy vòng lặp trên chính các enum Prisma (`GymPartnerStatus × PartnerVerificationStatus × PartnerAccountStatus × OWNER/MANAGER × có/không onboardingCompletedAt`).
Chủ gym ACTIVE hiện có (5/5 VERIFIED, onboarding xong) đi thẳng như cũ.

## 2. Sửa lỗ hổng `isLegacy` và tài khoản mồ côi

Hiện tại "không có `GymPartnerAccount`" = "legacy full quyền" (`partner.service.ts:44-54`), kéo theo bỏ qua cổng onboarding và bỏ qua `partnerGuard`.
Dữ liệu: **0** chủ gym thật đang dựa vào nó, **11** user GYM_OWNER mồ côi (không account, không gym, không brand) lại được hưởng — và mọi user GYM_OWNER
mới sinh ra trong khoảng giữa `set-password` và `bootstrap` cũng sẽ vậy.

Quy tắc mới: `isLegacy = true` **chỉ khi chứng minh được** sở hữu cũ từ dữ liệu có thẩm quyền — tồn tại `Gym.ownerId = userId` **hoặc** `GymBrand.ownerId = userId`.
Không chứng minh được → **không có quyền vận hành nào**; `onboarding-gate`, `onboarding.controller`, `partnerGuard` cũng không được coi họ là legacy.

Hai bộ resolver:
- `resolveOperationalContext` — nghiêm, dùng cổng dương.
- `resolveApplicantContext` — chỉ cho nhóm `application/*` + `onboarding/*`: cần role GYM_OWNER; user mồ côi chỉ gọi được `GET status` và `POST bootstrap`.

Test bắt buộc: từng kiểu mồ côi (không account + không gym/brand; có `must_change_password=true`; user mới chưa `bootstrap`) → không một route vận hành nào cho qua; `status`/`bootstrap` vẫn dùng được;
legacy chứng minh được (có `Gym`/`GymBrand`) vẫn qua.

## 3. Magic link (token email)

- Token thô = `crypto.randomBytes(32).toString('base64url')`; DB chỉ lưu `sha256` (`tokenHash` UNIQUE). Không có dữ liệu nghiệp vụ trong URL.
- Hạn 24 h; gửi lại → vô hiệu token cũ (mẫu `invalidatePasswordResets`); cooldown 60 s + trần/ngày theo email đọc từ DB.
- **Link dùng fragment** `…/partner/apply/verify#token=<raw>` — fragment không gửi lên server/CDN/log/Referer. Trang landing (GET, HTML tĩnh) đọc `location.hash` (chấp nhận thêm `?token=`), **lập tức `history.replaceState` xoá token khỏi URL/history**, rồi mới `POST verify`. Bộ quét email chỉ GET trang tĩnh nên **không tiêu** token.
- `POST verify` trả `VALID | EXPIRED | USED | INVALID` (chỉ trả email khi VALID) + `setupToken` ngắn hạn (15 phút, dùng 1 lần, băm ở server, gắn với dòng token; verify lại sinh cái mới, cái cũ vô hiệu). Token email **không bị tiêu** khi verify (chỉ khi `set-password` xong) nên refresh/mở lại link vẫn được.
- `set-password` nhận `setupToken` (không còn token email trong URL/body), chạy **một transaction auth DB**.
- Trang verify có `Referrer-Policy: no-referrer`. `setupToken` chỉ nằm trong bộ nhớ/`sessionStorage` của tab, xoá sau khi đặt mật khẩu.
- **Không log token thô ở bất kỳ tầng nào** (gateway, auth-service, access log). Test grep log.
- Cờ `PARTNER_APPLICATION_DEV_ECHO` (mặc định tắt, không được bật ở production) chỉ phục vụ E2E.

## 4. Liệt kê tài khoản (anti-enumeration) — đánh đổi đã chấp nhận

Quyết định của Ngài: email trùng Customer/PT/Admin → chặn ngay ở bước nhập email với thông điệp thân thiện. Việc đó **tiết lộ** email đã có tài khoản — giống `POST /auth/register` hiện đang trả 409 "Email đã được sử dụng".
Giảm nhẹ: giới hạn tần suất theo email (DB) + theo IP (gateway), thông điệp không nói tài khoản thuộc vai trò nào, không có endpoint riêng "email tồn tại?".

## 5. Giới hạn tần suất

| Tầng | Cơ chế | An toàn nhiều instance? |
|---|---|---|
| Theo email | cooldown + trần/ngày đọc từ DB (`sentAt/sentCount`) | **có** |
| Theo IP | gateway (`trust proxy` đã bật) — store Redis khi có `REDIS_URL`; không có → bộ nhớ | Redis: có · bộ nhớ: **không** |

`emailActionRateLimit` của auth-service (in-memory; sau gateway `req.ip` là IP gateway nên thực chất chỉ theo email) **không dùng** cho endpoint này.
**Yêu cầu go-live:** store chia sẻ. Production đặt `RATE_LIMIT_REQUIRE_SHARED=true` → gateway từ chối khởi động nếu không có Redis. Limiter theo tiến trình chỉ chấp nhận cho local/MVP và phải bị ghi rõ là chặn go-live.

## 6. Upload S3 (giấy tờ + ảnh cơ sở)

- Hai mức phơi nhiễm KHÁC nhau. **Bucket riêng tư** (giấy tờ pháp lý và ảnh trong lúc đang nộp hồ sơ): module Terraform sẵn có `infra/terraform/modules/private-s3-bucket` — Block Public Access đủ 4 cờ, SSE **AES256** mặc định, versioning. **Ảnh công khai** chỉ tồn tại SAU khi duyệt (server-side `CopyObject` sang vùng công khai qua CDN/`GYM_PHOTO_PUBLIC_BASE_URL`); giấy tờ **không bao giờ** được copy. Terraform được viết + checklist go-live, **không apply**.
- Khoá đối tượng do **server** sinh: `partner-applications/{partnerId}/{kind}/{uuid}.{ext}`. Client không gửi `objectKey`; `presign` tạo `PartnerUploadIntent`, `confirm` nhận `uploadId` và chỉ chấp nhận intent của chính partner đó — không gắn khoá tuỳ ý hay của partner khác.
- Allowlist: ảnh `jpeg/png/webp`; giấy tờ `pdf/jpeg/png`. Từ chối HTML/SVG/XML/JS/office. Tối đa 10 MB (tiền lệ PT docs) + trần số tệp theo loại.
- Presigned POST có điều kiện `Content-Type` + `content-length-range`, hạn 5 phút. `confirm` luôn `HEAD` (kích thước, content-type, môi trường không-local phải có SSE AES256/kms) rồi đọc **magic bytes** (`%PDF-`, PNG, JPEG, `RIFF…WEBP`); sai → xoá object + từ chối. Không tin `Content-Type` client khai.
- Đọc lại: presigned GET ≤ 120 s, ép `ResponseContentType` = loại đã xác thực; giấy tờ ép `attachment` (ảnh inline). Chỉ owner của partner đó + ADMIN; mỗi lần admin xem giấy tờ ghi `PartnerAuditLog` (`VIEWED_AS_PARTNER`); không log URL đã ký.
- Mã hoá: dựa default-encryption của bucket (chuẩn dự án). **Không gửi header SSE tới MinIO** (MinIO từ chối nếu chưa cấu hình KMS).
- MinIO dev: endpoint override, `forcePathStyle: true`, bootstrap bucket, CORS cho origin web, anonymous-read **chỉ** prefix công khai; bucket riêng tư không có chính sách công khai. Không dùng đĩa cục bộ → chạy được trên Lambda.

### 6b. Một bucket, mọi tệp riêng tư — và MinIO KHÔNG BAO GIỜ lên AWS

Quyết định (2026-09-20, sau khi kiểm hạ tầng AWS thật): **dùng lại bucket sẵn có của user-service**,
không tạo bucket mới, **không có bucket công khai, không CloudFront**.

Vì sao bỏ bucket công khai: hiện **không bề mặt ẩn danh nào của sản phẩm hiển thị ảnh phòng gym** —
route công khai `/gyms`, `/gyms/:id` không trả ảnh, và `gymPhotoUrl` ở web/mobile chỉ được gọi trong
wizard của chủ gym và màn duyệt của admin (đều đã đăng nhập). Một bucket công khai + CDN sẽ là hạ tầng
không ai dùng. Khi nào có trang tìm phòng gym cho khách thì mới dựng.

Hệ quả: ảnh chi nhánh **vẫn PRIVATE sau khi duyệt**, phục vụ bằng presigned GET như giấy tờ. Không có
bước `CopyObject`, không có endpoint `publish-photos`, không có `PARTNER_S3_PUBLIC_*`.

| | Dev / test | AWS production |
|---|---|---|
| Kho | MinIO (`infra/compose/docker-compose.dev.yml`, một bucket, không chính sách ẩn danh) | bucket S3 sẵn có `fitness-assistant-uploads-dev-…`, prefix `partner-applications/` |
| `PARTNER_S3_ENDPOINT` / `_PUBLIC_ENDPOINT` | `http://minio:9000` / `http://localhost:9000` | **để trống** |
| `PARTNER_S3_FORCE_PATH_STYLE` | `true` | **để trống hoặc `false`** |
| Thông tin xác thực | khoá dev | **IAM role của Lambda** (`…-gym-lambda-role`), giới hạn `partner-applications/*` |
| `PARTNER_S3_PUBLIC_BUCKET` / `_PUBLIC_BASE_URL` | **không đặt** | **không đặt** — guard sẽ chặn khởi động nếu thấy |
| `PARTNER_S3_REQUIRE_SSE` | không cần | `true` (bucket mã hoá mặc định AES256) |

Cưỡng chế bằng code (`gym-service/src/services/partner-s3.guard.ts`): khi `NODE_ENV=production`,
gym-service **từ chối khởi động** nếu có endpoint tuỳ chỉnh, path-style, khoá tĩnh, hoặc biến của
bucket công khai đã bị gỡ. Không tệp triển khai production nào được chứa MinIO.

Dọn rác: `partner-upload-sweep` (job trong `jobs-lambda.ts`) xoá tệp của những lượt tải lên đã hết hạn
mà người dùng không bao giờ bấm xác nhận — nếu không thì chúng nằm lại vĩnh viễn và vẫn tính tiền.

Smoke test trên **S3 thật** là yêu cầu trước-deploy (mục G1 trong Known Issues); chưa có tài nguyên AWS
nào do repo này tạo ra.

## 7. Phân quyền theo dữ liệu (chống truy cập chéo)

- Mọi endpoint applicant suy `partnerId` từ danh tính (`principalUserId`), **không** nhận từ body/URL. `brandId` của chi nhánh do server suy ra.
- Endpoint admin `/admin/partners/*` chỉ ADMIN (gateway `requireRoles('ADMIN')` + gym-service). Ứng viên không đọc được giấy tờ của người khác kể cả khi biết khoá.
- Sau khi nộp và khi REJECTED, server khoá sửa (409). Chỉ NEEDS_INFO mới sửa được.
- Bất biến 1 Owner = 1 Brand giữ bằng ràng buộc DB (`gym_partners.brand_id` UNIQUE, `gym_brands.owner_id` UNIQUE, `gym_partner_accounts.user_id` UNIQUE) chứ không chỉ mã ứng dụng.

## 8. Atomic & audit

- `approveApplication` = **một `prisma.$transaction` thật** (toàn bộ dữ liệu cùng DB gym-service): `UPDATE … WHERE status='PROSPECT' AND verification_status='IN_REVIEW'` phải khớp đúng 1 dòng (2 admin cùng lúc → 1 thành công, 1 nhận 409); điều kiện đọc **trong** transaction; brand/chi nhánh/audit cùng commit. Không có commit thứ hai, không gọi auth-service. Email, `CopyObject` chạy **sau** commit (lỗi thì log + thử lại, không rollback, không tuyên bố atomic cho chúng).
- Mọi chuyển trạng thái (nộp, yêu cầu sửa, đánh dấu đã cập nhật, nộp lại, chấp nhận/yêu cầu cập nhật giấy tờ, thay tệp, đóng issue, duyệt, từ chối, mở lại) ghi đúng 1 dòng `PartnerAuditLog` **trong cùng transaction** — rollback thì không có dòng.
- Timeline ứng viên và lịch sử admin đọc từ bảng này; ứng viên chỉ thấy trường an toàn.

## 9. Cách ly người dùng phía web

Khoá cache React Query gắn userId; đổi tài khoản không để lộ dữ liệu người trước (`gymini-account-session-isolation`). Điều hướng gốc/đăng nhập/khôi phục phiên dựa trạng thái hồ sơ (`GET /owner/application/status`) — nhưng đó chỉ là UX; quyền thật do §1.

## 10. Rủi ro còn lại (đã biết)

R1 `approveApplication` + tách `owner.routes.ts` nằm trên đường chủ gym thật → hồi quy chủ gym ACTIVE/legacy bắt buộc · R4 OSM tile chỉ hợp lý cho lưu lượng nhỏ (chính sách sử dụng công bằng) ·
R5 limiter theo tiến trình không scale ngang · R6 nhánh Lambda song song: tránh file Lambda · R8 phụ thuộc kiểm kê route (đã làm: chỉ `/owner/*` + `/me/collaborations`).
