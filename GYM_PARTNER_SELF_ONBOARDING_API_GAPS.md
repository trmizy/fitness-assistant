# GYM_PARTNER_SELF_ONBOARDING_API_GAPS.md

Khoảng trống giữa API/DB hiện hành và luồng tự đăng ký. Đã kiểm bằng code + `SELECT` (19/9/2026). "Có sẵn" = dùng lại nguyên; "Mới" = phải xây;
"Đổi" = sửa hành vi hiện có (rủi ro cao hơn, ghi riêng).

## 1. Khoảng trống chính

| # | Khoảng trống | Bằng chứng | Xử lý |
|---|---|---|---|
| G1 | Không có luồng email→link→mật khẩu cho ứng viên; không có hạ tầng magic link (chỉ OTP đăng ký + `PasswordResetToken` + `PartnerInvitation`) | grep toàn repo: 0 "magic link" | **Mới** `PartnerApplicationToken` (mẫu `PasswordResetToken`) |
| G2 | Sau đăng nhập không có gì phân biệt ứng viên với chủ gym đã duyệt: `resolveContextForUser` không nhìn `GymPartnerStatus`; account ACTIVE là qua; mọi route `/owner/*` chỉ bị chặn bởi `onboardingCompletedAt` | `partner.service.ts:41-84`, `owner.routes.ts:33-46` | **Mới** cổng dương `evaluateOperationalAccess` + tách router (rủi ro cao) |
| G3 | `isLegacy` cho **mọi** GYM_OWNER không có `GymPartnerAccount` full quyền + bỏ qua cổng onboarding + bỏ qua `partnerGuard` tiền | `partner.service.ts:44-54`, `onboarding-gate.middleware.ts:17`, `onboarding.controller.ts:18`, `partner-guard.service.ts:19,32`; 11 user mồ côi | **Đổi** chỉ còn khi chứng minh được sở hữu (`Gym`/`GymBrand`); sửa test `partner-identity.integration.test.ts:262` |
| G4 | Không có chỗ ứng viên tự tải giấy tờ: `GymPartnerDocument.fileUrl` do admin gõ URL; chưa có lý do/người duyệt/phiên bản; không có gì buộc giấy tờ VERIFIED trước khi partner VERIFIED | `partner-diligence.service.ts:41-61,127-150` | **Mới** upload S3 + vòng duyệt từng tệp |
| G5 | gym-service chưa dùng S3; toàn bộ upload là multer đĩa, riêng tư thì bị `isLambdaRuntime()` khoá 503 | `branch-document-photo.controller.ts:17-38` | **Mới** module S3 (mẫu `user-service/s3-upload.service.ts`); MinIO cho dev (compose chưa có) |
| G6 | Không có "request changes" cấp **partner** theo mục; `NEEDS_INFO` chỉ có 1 chuỗi `verificationNotes` | `partner-diligence.service.ts:127-150` | **Mới** `GymPartnerReviewIssue` (mẫu `GymBranchReviewIssue`) nhưng đóng bởi admin |
| G7 | Không có hành động nộp hồ sơ; APPROVE chưa có nghĩa "kích hoạt" (ACTIVE hiện chỉ đặt khi chấp nhận lời mời) | `partner-invitation.service.ts:174-176` | **Mới** `submit/resubmit`, `approveApplication` (1 `$transaction`) |
| G8 | Thiếu cột: tên/vai trò người đại diện, quy mô, `submittedAt`, logo Brand | `\d gym_partners`, `\d gym_brands` | **Mới** migration cộng thêm |
| G9 | `gym_brands.owner_id` chưa UNIQUE (chỉ `gym_partners.brand_id`) | schema | **Mới** `@@unique([ownerId])` — đã xác nhận sạch (5/5) |
| G10 | Không có `PartnerAuditAction` cho nộp/duyệt hồ sơ; chú thích `actorUserId` nói "quản trị viên" | `schema.prisma:417-460` | **Mới** thêm giá trị enum + nới chú thích |
| G11 | Không có bản đồ / geocoding ở web (quyết định cũ "không API định vị trả phí") | grep Leaflet/Maps: 0 | **Mới** Leaflet + OSM (Ngài đã duyệt); không giả toạ độ đã xác thực |
| G12 | Web không phân biệt ứng viên: `RootRedirect` chỉ theo role; nhóm `gym-owner` chỉ `RequireRole` | `RootRedirect.tsx:22`, `routes.tsx:283-290` | **Mới** `useGymOwnerAccessState`, `RequireApprovedPartner`, `RequirePartnerApplicant` |
| G13 | Rate limit: auth-service in-memory, không `trust proxy` (sau gateway `req.ip` là IP gateway → khoá thực tế chỉ theo email); gateway có `trust proxy` + limiter bộ nhớ, đã cài gói `redis` nhưng chưa dùng | `emailActionRateLimit.middleware.ts`, `gateway app.ts:21`, `rateLimit.middleware.ts` | **Mới** cooldown/trần theo email **ở DB** + limiter IP ở gateway (Redis khi có); production bắt buộc store chia sẻ |
| G14 | Web không có test runner trong repo | grep | E2E dùng harness Playwright ngoài repo: `D:\fitnessassistant-playwright-e2e` (đã xác nhận tồn tại) |
| G15 | `/me/collaborations` (PT+GYM_OWNER) nằm ngoài `/owner/*`, chỉ chặn theo role | `pt.routes.ts:25-31`, gateway `:2638-2644` | **Đổi** nhánh GYM_OWNER phải đi qua cổng dương |

## 2. Kiểm kê route cho GYM_OWNER (kết quả — mục W0 "route census")

Tìm `requireRoles(...GYM_OWNER...)` toàn `backend/`:

- **Gateway** (`proxy.routes.ts`): `/owner/gyms` (2666), `/owner/brands` (2675), `/owner/branch-documents` (2684), `/owner/collaborations` (2693), `/owner/onboarding` (2700), `/owner/partner-accounts` (2706), `/owner/partner-invitations` (2712), và **`/me/collaborations`** dùng chung PT+GYM_OWNER (2642). Chưa có prefix cho `/owner/application` → phải thêm proxy tường minh.
- **gym-service**: `owner.routes.ts:33` (`router.use(... requireRoles('GYM_OWNER'), resolvePartnerContext)` cho toàn `/owner`), `pt.routes.ts:29` (`/me/collaborations`).
- **Các service khác** (payment, user, chat, fitness, ai): **không** có `requireRoles` nào nhắc GYM_OWNER; tiền của chủ gym (ví, rút tiền, gói, hội viên, check-in, cộng tác) nằm hết trong gym-service `/owner/gyms/...`.

⇒ Bề mặt "vận hành Gym Owner" = **toàn bộ `/owner/*` của gym-service + `/me/collaborations`**. Các route đăng nhập/hồ sơ/thông báo/chat dùng chung cho mọi vai trò không phải chức năng Gym Owner. Kiểm kê gọn (R8 thấp).
Artefact test: một bảng route được kiểm ở W3 (vòng lặp qua bảng, mỗi hàng một ca ứng viên → phải bị chặn).

## 3. Hợp đồng API mới

### auth-service (công khai, qua gateway `/auth/partner-applications/*`)

| Endpoint | Body | Trả về | Ghi chú |
|---|---|---|---|
| `POST …/start` | `{email}` | 200 chung / chặn thân thiện nếu email đã là Customer/PT/Admin/đối tác | cooldown 60 s + trần/ngày theo email (DB); IP limit ở gateway; email chứa link `…/partner/apply/verify#token=<raw>` |
| `POST …/verify` | `{token}` | `{status: VALID|EXPIRED|USED|INVALID, email?, setupToken?, setupExpiresAt?}` | POST để bộ quét email không tiêu link; verify **không** tiêu token email |
| `POST …/set-password` | `{setupToken, password}` | `{accessToken, refreshToken, user}` | **một transaction auth DB**: tạo `User(GYM_OWNER, mustChangePassword=false)` + đánh dấu `usedAt`; mật khẩu ≥ 8; không gọi gym-service |

Cờ dev-only `PARTNER_APPLICATION_DEV_ECHO` (mặc định tắt, cấm ở production) đưa link vào response `start` để E2E lấy được (token gốc không lưu).

### gym-service — applicant (`/owner/application/*`, đã xây — W1)

Vùng ứng viên nằm TRƯỚC cổng vận hành. Chỉ `status` và `bootstrap` dùng được khi chưa có tài khoản đối tác; mọi route còn lại đòi tài khoản OWNER, và thao tác ghi đòi hồ sơ ở ONBOARDING hoặc CHANGES_REQUESTED (409 `APPLICATION_LOCKED` nếu đang xét duyệt/đã từ chối).

| Route | Ghi chú |
|---|---|
| `GET /status` | `accessState` (SETUP_INCOMPLETE · ONBOARDING · UNDER_REVIEW · CHANGES_REQUESTED · REJECTED · APPROVED_PAYOUT_PENDING · ACTIVE · LEGACY · SUSPENDED · TERMINATED · RESTRICTED) + `editable` — dùng cho điều hướng gốc |
| `POST /bootstrap` | tạo `GymPartner`(PROSPECT, SELF_SERVICE) + `GymPartnerAccount`(OWNER, ACTIVE); idempotent theo `userId`; 409 `LEGACY_OWNER` nếu đã đứng tên gym |
| `GET /` · `GET /timeline` | hồ sơ + phần còn thiếu + issue + giấy tờ · timeline đọc từ `PartnerAuditLog` (chỉ trường an toàn) |
| `PUT /representative` · `/business-scale` · `/brand` · `/branch` · `/legal` | mỗi hồ sơ đúng 1 Brand và đúng 1 chi nhánh (`APPLICATION_SINGLE_BRANCH`); `brandId` do server suy ra; dữ liệu chi nhánh kiểm bằng chính `gymCreateSchema` |
| `POST /uploads/presign` → (trình duyệt POST lên S3) → `POST /uploads/confirm` | ảnh + giấy tờ; client chỉ có `uploadId`, không bao giờ gửi khoá S3 |
| `PUT /photos/reorder` · `PATCH /photos/:photoId/cover` · `DELETE /photos/:photoId` | quản lý ảnh (chỉ ảnh của chính chi nhánh nháp) |
| `POST /submit` · `POST /resubmit` · `POST /issues/:id/mark-updated` | nộp (400 `APPLICATION_INCOMPLETE` kèm từng mục thiếu) · gửi lại (409 `ISSUES_NOT_ACKNOWLEDGED` / `DOCUMENTS_NOT_REPLACED`) · đánh dấu "đã cập nhật" (OPEN→RESUBMITTED) |

### gym-service — admin (`/admin/partners/…`, ADMIN — đã xây)

| Route | Ghi chú |
|---|---|
| `GET /applications?verificationStatus=` | hàng đợi + số đếm theo trạng thái (đứng trước `/:id`) |
| `GET /:id/application` | hồ sơ đầy đủ + từng giấy tờ + issue + `approve: {canApprove, blockers[]}` + lịch sử audit |
| `GET /:id/application/documents/:docType/file?fileId=` | presigned GET 120 s cho MỘT tệp (thiếu `fileId` = tệp đầu), PDF ép tải xuống; **mỗi lần xem ghi `DOCUMENT_VIEWED`** kèm `fileId` |
| `POST /:id/application/documents/:docType/accept` | RECEIVED → VERIFIED (`DOCUMENT_ACCEPTED`); approve KHÔNG tự làm việc này |
| `POST /:id/application/request-changes` | `{issues[], documents[]}` trong 1 transaction → NEEDS_INFO |
| `POST /:id/application/issues/:issueId/resolve` · `/reopen` | chỉ admin đóng / mở lại (RESUBMITTED|RESOLVED → OPEN kèm lời nhắn) |
| `POST /:id/application/approve` | 1 `$transaction` thật; 409 `APPROVE_BLOCKED` kèm `blockers`; 409 nếu người khác vừa duyệt |
| `POST /:id/application/reject` · `/reopen` · `/publish-photos` | từ chối (cuối với ứng viên) · mở lại · sao chép ảnh sang vùng công khai (thử lại được) |

Các thao tác admin cũ trên hồ sơ SELF_SERVICE (`PATCH /:id`, `PUT/POST documents`, `reject`, `reopen`, `verification-status`, `provision`) bị chặn 409 `SELF_SERVICE_APPLICATION` — một vòng đời duy nhất, mọi bước có audit. Hồ sơ cũ (ADMIN_CREATED) không bị ảnh hưởng.

## 4. Migration (một migration gym-service, chỉ CỘNG THÊM — không xoá cột/enum)

- `GymPartner`: `submittedAt`, `representativeName`, `representativeRole` (enum `PartnerRepresentativeRole`), `businessScale` (enum `PartnerBusinessScale`).
- `GymBrand`: `logoKey`; `@@unique([ownerId])`.
- `GymPartnerDocument`: `fileKey`, `mimeType`, `sizeBytes`, `uploadedBy`, `version`, `reviewNote` (giữ `fileUrl`; **người/lúc duyệt dùng lại `verifiedBy`/`verifiedAt` sẵn có**, không thêm cột mới).
- **2026-09-21:** bảng con `gym_partner_document_files` (migration `20260921000000_partner_document_files`) — một giấy tờ 1..4 tệp. Migration chép `file_key` cũ sang bảng mới rồi đặt `file_key/mime_type/size_bytes` của giấy tờ về NULL (cột giữ lại, không còn ghi). Endpoint ứng viên mới: `GET` và `DELETE /owner/application/documents/:docType/files/:fileId` (xem = presigned 120 s của chính mình; xoá tệp chưa được duyệt thì xoá hẳn khỏi S3, tệp thuộc bộ admin đã quyết định thì chỉ gỡ khỏi hồ sơ, khoá giữ trong audit).
- `GymPhoto`: `s3Key`, `category`, `visibility` (PRIVATE|PUBLIC).
- Bảng mới: `PartnerUploadIntent`, `GymPartnerReviewIssue` (+ enum `PartnerReviewIssueStatus`, `PartnerReviewCategory`).
- `PartnerAuditAction`: thêm 13 giá trị (`ALTER TYPE … ADD VALUE`): 12 ở migration đầu + `DOCUMENT_VIEWED` ở migration `20260919020000_partner_document_viewed_audit`.
- auth-service (migration riêng): bảng `PartnerApplicationToken`.

Rủi ro migration: thấp (chỉ cộng thêm; dữ liệu cũ nguyên vẹn; `gym_brands` đã kiểm 5 brand / 5 owner_id khác nhau nên đặt UNIQUE an toàn). `ALTER TYPE … ADD VALUE` chạy được trong migration của Prisma trên PostgreSQL ≥ 12 miễn giá trị mới chưa được dùng trong chính migration đó — repo đã có tiền lệ (`GymStatus` + `DRAFT`). Đã kiểm bằng `prisma migrate diff` với shadow DB: **không lệch** giữa migration và schema.

## 5. Khoảng trống hạ tầng / môi trường (không phải code nghiệp vụ)

- **Build Docker backend bị hỏng** vì `pnpm.patchedDependencies` ở root (patch gesture-handler của mobile Phase 0–5) không được `COPY patches` trong `Dockerfile.dev` → cần thêm 1 dòng cho các service phải build lại (đã được duyệt trong kế hoạch, W1.0).
- **Không có S3 tương thích ở dev** → thêm MinIO (compose) + CORS + bootstrap bucket; Terraform sản xuất viết nhưng không apply.
- **Chưa có store rate limit chia sẻ** → Redis ở gateway; production đặt `RATE_LIMIT_REQUIRE_SHARED=true`.
