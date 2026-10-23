# Listing Management — Kiến trúc

Tin đăng (listing) = phần **công khai** của một PT (hồ sơ chữ, gói dịch vụ, ảnh hình thể) hoặc một chi nhánh gym (mô tả, tiện ích, ảnh). Mọi thay đổi sau khi đã duyệt đi qua **bản sửa (revision)** do Admin duyệt; Client chỉ thấy bản đang công khai.

Ký hiệu đường dẫn: `US` = `backend/services/user-service/src`, `GS` = `backend/services/gym-service/src`, `GW` = `backend/gateway/src`, `FW` = `frontend/web/src/app`, `FM` = `frontend/mobile`.

Tài liệu này mô tả **code đang commit** (code là chuẩn; kế hoạch chỉ là lịch sử). Các tài liệu cùng thư mục: [FIELD_PERMISSIONS](FIELD_PERMISSIONS.md), [MODERATION_WORKFLOW](MODERATION_WORKFLOW.md), [AMENITY_SYSTEM](AMENITY_SYSTEM.md), [PHOTO_LIFECYCLE](PHOTO_LIFECYCLE.md), [TEST_MATRIX](TEST_MATRIX.md), [MOBILE_WEB_UI](MOBILE_WEB_UI.md).

## 1. Nguyên tắc cốt lõi

| # | Nguyên tắc | Cơ chế (file) |
|---|---|---|
| 1 | Một nơi duy nhất ghi phần công khai | PT: `applyPtListingRevisionTx` (`US/services/pt-listing-apply.service.ts`). Gym: `applyGymListingRevisionTx` (`GS/services/gym-listing-apply.service.ts`) |
| 2 | Client chỉ thấy bản đang công khai | PT: `toPublicPtDto` nhận `PublishedPtSource` (`US/services/pt-public-dto.ts`). Gym: `toPublicGymDto` nhận `PublishedGymSource` (`GS/services/gym-public.ts`). Kiểu dữ liệu không nhận được một revision |
| 3 | Một luật hiển thị cho danh sách, chi tiết, media | PT: `ptPublicWhere()` / `isPtPubliclyVisible()`. Gym: `gymPublicWhere()` / `isGymPubliclyVisible()` |
| 4 | Lịch sử bất biến | Trigger Postgres chặn UPDATE/DELETE bản đã đóng (xem §3) |
| 5 | Mọi chuyển trạng thái là UPDATE có điều kiện trên trạng thái cũ | `updateMany({ where: { status: X } })` → 2 request đua nhau chỉ 1 thắng, request kia 409 |
| 6 | Danh tính lấy từ token, không từ body | PT: `req.user.id` + `requireApprovedPt`. Gym: `requireOwnedListingGym` (sai chủ → 404) |
| 7 | Mọi body dùng zod `.strict()` | `US/services/pt-listing.schemas.ts`, `GS/services/gym-listing.schemas.ts` — khóa lạ → 400 `VALIDATION_FAILED` |

## 2. Dịch vụ sở hữu dữ liệu nào

| Dữ liệu | Service | Bảng chính | Migration |
|---|---|---|---|
| Tin đăng PT, ảnh hình thể, gói | user-service | `pt_listing_revisions`, `pt_physique_photos`, `pt_media_upload_intents`, `client_compat_events`; cột `user_profiles.listing_version/listing_published_at`, `pt_service_packages.version` | `backend/services/user-service/prisma/migrations/20261017173131_pt_listing_revisions` |
| Tin đăng chi nhánh, tiện ích, ảnh chi nhánh | gym-service | `gym_listing_revisions`, `amenities`, `amenity_proposals`, `gym_amenities`, `amenity_audit_logs`, `legacy_compat_events`, `compat_writer_heartbeats`, `client_compat_events`; cột `gyms.listing_version/listing_published_at/legacy_client_at/legacy_no_amenities/created_flow_version`, `gym_partners.application_flow_version`, `gym_photos.status/content_hash/retired_at` | `backend/services/gym-service/prisma/migrations/20261018155636_amenity_catalog_listing_revisions` |
| Loại thông báo cho chủ gym | user-service (enum) | `NotificationEventType` | `backend/services/user-service/prisma/migrations/20261020132616_gym_listing_notification_types` (thêm `GYM_LISTING_APPROVED/REJECTED/CHANGES_REQUESTED/INVALIDATED`, `GYM_AMENITY_PROPOSAL_REVIEWED`) |

Nguồn chuẩn (không tạo nguồn thứ hai):
- Tiện ích của chi nhánh = bảng `gym_amenities`. Cột `gyms.facilities` **chỉ là bản sao** cho app cũ; chỉ `syncFacilitiesMirrorTx` (`GS/services/gym-amenity.service.ts`) được ghi (xem AMENITY_SYSTEM).
- Giá "từ" của PT **suy ra** từ gói đang bán (`computeFromPrices`, `US/services/pt-public-dto.ts`), không ghi lại vào `PTApplication`.
- Gói là **mẫu**; hợp đồng chụp lại giá/số buổi lúc tạo. Áp bản sửa gói = cập nhật tại chỗ + `version++` chỉ khi đổi trường thương mại (`PACKAGE_COMMERCIAL_FIELDS`).

## 3. Mô hình dữ liệu của một bản sửa

`pt_listing_revisions` và `gym_listing_revisions` cùng cấu trúc:

| Cột | Ý nghĩa |
|---|---|
| `status` | `DRAFT` `PENDING` (mở) · `APPROVED` `REJECTED` `CHANGES_REQUESTED` `WITHDRAWN` `STALE` (đóng) |
| `source` | `OWNER` hoặc `ADMIN_DIRECT` |
| `base_version` | `listing_version` công khai lúc bắt đầu sửa; lệch lúc gửi → `LISTING_STALE` |
| `draft_version` | tăng mỗi lần lưu; `expectedDraftVersion` sai → `DRAFT_STALE` |
| `payload` (jsonb) | **trạng thái mong muốn đầy đủ** (không phải patch). PT: `{profile{8 trường}, packages[], photoIds[], coverPhotoId}`. Gym: `{description, amenityIds[], proposalIds[], photoIds[], coverPhotoId}` |
| `previous_snapshot` | bản công khai ngay trước khi áp (ghi cùng lúc đóng) |
| `system_adjustments` | những gì server tự chỉnh (tiện ích bị tắt, đề xuất đã xử lý, rebase…) |
| `parent_revision_id` | trỏ bản sinh ra nó (withdraw / request-changes / STALE / chép từ bản đóng) |
| `review_note` / `owner_note` / `admin_reason` | ghi chú Admin / ghi chú Owner / lý do sửa trực tiếp (≥ 10 ký tự) |

Ràng buộc DB (đều trong migration):
- Index unique một phần: tối đa **1 bản mở** (DRAFT hoặc PENDING) mỗi PT / mỗi chi nhánh — `pt_listing_revisions_one_open_per_pt`, `gym_listing_revisions_one_open_per_gym`.
- Trigger `*_immutable` (`pt_listing_revisions_guard_closed`, `gym_listing_revisions_guard_closed`): bản đã đóng không sửa/xóa được, trừ `system_adjustments` và `updated_at`.
- Ảnh: unique một phần cho **1 ảnh bìa PUBLISHED** và cho **(chủ, content_hash)** — chi tiết ở PHOTO_LIFECYCLE.

## 4. Bản đồ endpoint

Gateway chỉ kiểm vai trò; service kiểm lại và lấy người thực hiện từ token (`GW/routes/proxy.routes.ts`: `/admin/listings/pts` ~L1370, `/media/pt-physique` ~L1384, `/media/gym-photos` ~L1403, `/admin/listings/gyms`, `/admin/amenities`, `/owner/amenities` ~L1899–1915; `/owner/gyms` và `/profile` có sẵn).

Mọi response của Owner/PT/Admin: `Cache-Control: no-store, private` + `Vary: Authorization` (`noStorePrivate`). JSON công khai: `no-cache`. Redirect media: `private, max-age=300`.

Body lỗi chung: `{ success:false, error:{ code, message }, message, ...extra }`; 409 kèm `revision` + `listingVersion` để client hiển thị hộp thoại.

### 4.1 PT (user-service) — `US/routes/pt-listing.routes.ts`, mount `/profile/me/listing` (`profile.routes.ts:15`)

Vai trò: token hợp lệ **và** `isPT` + hồ sơ `APPROVED` (không thì 403 `NOT_A_PT` / `PT_NOT_APPROVED`).

| Method | Path | Mục đích | Mã lỗi chính |
|---|---|---|---|
| GET | `/profile/me/listing` | bản công khai, bản mở, ảnh, lịch sử 20 bản, `limits` | 403 |
| POST | `.../draft` `{copyFromRevisionId?}` | tạo nháp từ bản công khai hoặc chép bản đóng ≤ 30 ngày | 409 `OPEN_REVISION_EXISTS`, `REVISION_NOT_CLOSED`, `REVISION_TOO_OLD_TO_COPY`; 404 `REVISION_NOT_FOUND` |
| PUT | `.../draft` `{expectedDraftVersion, payload, ownerNote?}` | lưu nháp | 409 `DRAFT_STALE`, `REVISION_UNDER_REVIEW`; 404 `NO_OPEN_REVISION`; 422 `PHOTO_*`, `PACKAGE_*`, `COVER_NOT_IN_PHOTOS`; 400 `VALIDATION_FAILED` |
| POST | `.../submit` `{expectedDraftVersion}` | gửi duyệt | 409 `DRAFT_STALE`, `LISTING_STALE`, `REVISION_UNDER_REVIEW`; 422 `NO_CHANGES` |
| POST | `.../withdraw` | rút bản PENDING → WITHDRAWN + sinh DRAFT mới | 409 `REVISION_NOT_PENDING` |
| POST | `.../discard` | bỏ nháp DRAFT → WITHDRAWN | 409 `REVISION_UNDER_REVIEW` |
| POST | `.../rebase` `{expectedDraftVersion?}` | giữ nội dung đang soạn, dời `base_version` lên bản công khai hiện tại | 409 `DRAFT_STALE`, `REVISION_UNDER_REVIEW` |
| GET | `.../preview` | xem trước bản mở (`isPreview:true`, ảnh STAGED có link ký 15 phút + `expiresAt`) | 404 `NO_OPEN_REVISION` |
| POST | `.../physique/presign` `{contentType}` | xin link upload | 422 `STAGED_LIMIT`; 429 `TOO_MANY_UPLOADS`; 503 `UPLOADS_UNAVAILABLE` |
| POST | `.../physique/confirm` `{uploadId}` | xác nhận, kiểm nội dung thật | 422 `IMAGE_INVALID`, `IMAGE_TOO_LARGE`; 404 `UPLOAD_NOT_FOUND`; 409 `INTENT_EXPIRED`, `INTENT_ALREADY_USED` |
| DELETE | `.../physique/:photoId` | xóa ảnh STAGED | 409 `PHOTO_PUBLISHED`, `PHOTO_IN_REVIEW`; 404 `PHOTO_NOT_FOUND` |

### 4.2 Chủ gym (gym-service) — `GS/routes/owner-listing.routes.ts`, mount trong `owner.routes.ts:128-129`

Vai trò: `GYM_OWNER` + `requirePartnerOwner` (MANAGER → 403) + cổng vận hành; chi nhánh không phải của mình → **404**.

| Method | Path | Mục đích | Mã lỗi chính |
|---|---|---|---|
| GET | `/owner/gyms/:id/listing` | tin đăng + bản mở + lịch sử | 409 `GYM_IS_DRAFT`, `LISTING_NOT_AVAILABLE` |
| POST | `.../listing/draft` `{copyFromRevisionId?}` | tạo nháp (201) | như PT |
| PUT | `.../listing/draft` | lưu nháp | 409 `DRAFT_STALE`; 422 `PHOTO_*`, `AMENITY_UNKNOWN`, `AMENITY_DISABLED`, `AMENITY_LIMIT`, `PROPOSAL_NOT_OWNED` |
| POST | `.../listing/submit` | gửi duyệt | 409 `DRAFT_STALE`, `LISTING_STALE`, `AMENITY_DISABLED`; 422 `AMENITIES_REQUIRED`, `NO_CHANGES` |
| POST | `.../listing/withdraw` · `/discard` · `/rebase` | như PT | như PT |
| GET | `.../listing/preview` | xem trước | 404 |
| POST | `.../listing/photos/presign` · `/confirm` | upload ảnh (cả chi nhánh DRAFT của wizard) | như PT; 409 `PARTNER_REQUIRED` |
| PUT | `.../listing/photos/reorder` `{photoIds}` | chỉ chi nhánh **DRAFT** | 409 `GYM_NOT_DRAFT`; 422 `PHOTO_SET_MISMATCH` |
| PATCH | `.../listing/photos/:photoId/cover` | chỉ chi nhánh DRAFT | 409 `GYM_NOT_DRAFT` |
| DELETE | `.../listing/photos/:photoId` | xóa ảnh STAGED | 409 `PHOTO_PUBLISHED`, `PHOTO_IN_REVIEW` |
| GET | `/owner/amenities` | danh mục ACTIVE + đề xuất của mình | |
| POST | `/owner/amenities/proposals` `{gymId,name,suggestedCategory,note?}` | đề xuất (xem AMENITY_SYSTEM) | 422 `NAME_INVALID` |
| PATCH / DELETE | `/owner/amenities/proposals/:id` | sửa / hủy đề xuất PENDING | 404 `PROPOSAL_NOT_FOUND`; 409 `PROPOSAL_ALREADY_DECIDED`, `PROPOSAL_IN_REVIEW`, `PROPOSAL_NAME_TAKEN`, `AMENITY_ALREADY_EXISTS` |

Đường cũ bị khóa (`GS/routes/owner.routes.ts:105-114`, `GS/services/gym.service.ts:279`):
- `PATCH /owner/gyms/:id` có `description`/`facilities` khi chi nhánh không phải DRAFT → 409 `LISTING_REVIEW_REQUIRED`.
- `POST|PUT|PATCH|DELETE /owner/gyms/:id/photos...` (ghi đĩa) → **410** `UPLOAD_ROUTE_RETIRED` với mọi trạng thái; `GET .../photos` vẫn đọc.
- PT: `POST|PATCH|DELETE /profile/me/service-packages[/:id]` và `/me/service-packages` → 409 `LISTING_REVIEW_REQUIRED` (`US/controllers/pt_service_package.controller.ts`).

### 4.3 Hồ sơ đăng ký đối tác — `GS/routes/application.routes.ts`

| Method | Path | Ghi chú |
|---|---|---|
| PUT | `/owner/application/amenities` | lưu bước Tiện ích (chọn + đề xuất) |
| GET | `/owner/application/amenities/catalog` | danh mục cho ứng viên chưa được duyệt (mount trước cổng vận hành) |
| POST | `/owner/application/uploads/presign` · `/confirm`, PUT `/photos/reorder`, PATCH `/photos/:photoId/cover`, DELETE `/photos/:photoId` | ảnh hồ sơ |
| POST | `/owner/application/submit` · `/resubmit` | cần ≥ 1 tiện ích với client mới (422 `AMENITIES_REQUIRED`) |

### 4.4 Admin — mọi route `ADMIN`

PT (`US/routes/admin-pt-listing.routes.ts`, mount `/admin/listings/pts` trong `US/routes/admin.routes.ts:36`) và Gym (`GS/routes/admin-listing.routes.ts`, mount `/admin/listings/gyms` trong `GS/routes/admin.routes.ts:28`) cùng bộ route:

| Method | Path (sau tiền tố) | Mục đích | Mã lỗi chính |
|---|---|---|---|
| GET | `/?status=&q=&page=` (Gym thêm `brandId`, `gymId`) | hàng đợi; `status` mặc định `PENDING` | 400 `VALIDATION_FAILED` |
| GET | `/revisions/:rid` | bản sửa + diff với bản công khai + cờ `stale` | 404 `REVISION_NOT_FOUND` |
| GET | `/revisions/:rid/preview` | xem trước như Client | 404 |
| POST | `/revisions/:rid/approve` `{note?}` (Gym: `dropRejectedAmenities?`, `dropDisabledAmenities?`) | duyệt + áp | 409 `ALREADY_DECIDED`, `LISTING_STALE`, `REVISION_INVALID`; Gym: 409 `CUSTOM_AMENITY_PENDING`, `AMENITY_PROPOSAL_DEAD`, `AMENITY_DISABLED`; 422 `AMENITIES_REQUIRED`, `PHOTO_LIMIT` |
| POST | `/revisions/:rid/reject` `{note}` | từ chối (note bắt buộc) | 409 `ALREADY_DECIDED` |
| POST | `/revisions/:rid/request-changes` `{note}` | yêu cầu sửa + DRAFT con | 409 `ALREADY_DECIDED` |
| POST | `/:ptUserId` hoặc `/:gymId` + `/direct-edit` | sửa trực tiếp (`reason` ≥ 10 ký tự, `expectedListingVersion`) | 409 `LISTING_STALE`; 422 `NO_CHANGES`, `PHOTO_NOT_PUBLISHED` (PT) |
| POST | PT `/:ptUserId/physique/:photoId/retire` · Gym `/:gymId/photos/:photoId/retire` `{reason, purge?}` | gỡ ảnh đang công khai | 404 `PHOTO_NOT_FOUND` |
| POST | Gym `/:gymId/photos/presign` · `/confirm` | Admin up ảnh chi nhánh (**PT: không có route này**) | |
| GET | `/:id/history` · `/:id` | lịch sử + audit · bản đang công khai | |

Danh mục tiện ích (`GS/routes/admin-listing.routes.ts`, `/admin/amenities`): `GET /`, `POST /`, `GET /proposals`, `POST /proposals/approve|reject|merge`, `PATCH /:id`, `GET /:id/history` — chi tiết ở AMENITY_SYSTEM.

### 4.5 Công khai

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/gyms`, `/gyms/:id`, `/gyms/:gymId/plans`, `/gyms/:gymId/trainers`, `/gyms/:gymId/reviews`, `/pt/:ptUserId/gyms` | mọi route đi qua `gymPublicWhere()`; chi nhánh không hiển thị → 404 |
| GET | `/profile/pts`, `/profile/pts/:userId`, `/profile/pts/:id/service-packages` | `toPublicPtDto`; PT ẩn → 404 |
| GET/HEAD | `/media/pt-physique/:photoId` (`US/routes/media.routes.ts`), `/media/gym-photos/:photoId` (`GS/routes/media.routes.ts`) | không auth; chỉ ảnh `PUBLISHED` của chủ đang hiển thị, 302 sang presigned GET 10 phút; còn lại 404. Gateway chặn phương thức khác GET/HEAD (405) |
| GET | `/uploads/gym-photos/:file` (`GS/app.ts`) | URL cũ của ảnh lưu đĩa, kiểm từng request (đã bỏ `express.static`) |

Luật hiển thị:
- **PT**: `isPT` ∧ hồ sơ `APPROVED` ∧ `!ptSuspended` ∧ không có hạn chế phạm vi `ACCOUNT` đang mở. Hạn chế theo `CONTRACT` **không** ẩn.
- **Gym**: `status=APPROVED` ∧ `operationalStatus=OPEN` ∧ chủ không nằm trong `partnerGuard.hiddenFromPublicOwnerUserIds()`.

## 5. Luồng tổng quát

```
Owner/PT soạn nháp ─ upload ảnh (STAGED) ─ submit ─> PENDING ─ Admin approve ─> applyXxxRevisionTx (1 transaction)
                                                       │                          ├ khóa dòng chủ (FOR UPDATE)
                                                       ├ reject / request-changes ├ ghi cột công khai + gói/tiện ích
                                                       └ admin direct-edit ──────>├ ảnh: payload→PUBLISHED, còn lại→RETIRED
                                                          (PENDING → STALE)       ├ listing_version++ , listing_published_at
                                                                                  └ audit + thông báo
```

Thứ tự khóa (tránh deadlock): bản sửa mở → dòng chủ (profile/gym) → gói → ảnh (`ORDER BY id FOR UPDATE`). Gym: đề xuất → bản sửa → gym (khi duyệt đề xuất tiện ích).

## 6. Job nền và cấu hình

| Thành phần | File | Mặc định / biến môi trường |
|---|---|---|
| Dọn ảnh/intent PT | `US/services/pt-listing-sweep.service.ts` (đăng ký ở `US/server.ts`) | 10 phút; `PT_LISTING_SWEEP_INTERVAL_MS` |
| Dọn ảnh/intent gym | `GS/services/gym-listing-sweep.service.ts` | 10 phút; `GYM_LISTING_SWEEP_INTERVAL_MS` |
| Nhịp tim ghi sự kiện tương thích | `GS/services/compat-writer-heartbeat.service.ts` | 10 phút; `COMPAT_WRITER_HEARTBEAT_INTERVAL_MS` |
| Cờ tương thích APK cũ | `GS/services/legacy-compat.service.ts` | `LISTING_LEGACY_CLIENT_COMPAT` (mặc định bật) |
| Thông báo chủ gym | `GS/services/gym-listing-notify.ts` | `LISTING_GYM_NOTIFICATIONS_ENABLED` (mặc định bật; `false`/`0` tắt) |
| Lưu ảnh PT | `US/services/pt-media-s3.service.ts` | `PT_MEDIA_S3_ENDPOINT/PUBLIC_ENDPOINT/REGION/FORCE_PATH_STYLE/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET` (compose dev: bucket `gymini-user-media`) |
| Lưu ảnh gym | `GS/services/listing-photo-storage.ts` + `partner-s3.service.ts` | `PARTNER_S3_*`; bucket riêng `PARTNER_S3_PRIVATE_BUCKET`, tiền tố `listing-photos/<gymId>/` |

Cả hai service đều cần `sharp` (đã nằm trong dependency).

## 7. Cache và làm mới

- Backend không cache PT/Gym; đọc công khai luôn truy vấn DB nên duyệt xong thấy ngay.
- `UserProfile.specialties` đồng bộ từ `mainSpecialties` trong chính transaction áp bản sửa (`pt-listing-apply.service.ts`, bước 7) → lọc chuyên môn đúng ngay.
- Client (React Query `staleTime` 30 giây): thiết bị khác thấy dữ liệu mới sau tối đa 30 giây hoặc khi kéo làm mới. Hạn chế đã biết.

## 8. Việc cần biết khi bảo trì

| Mục | Ghi chú |
|---|---|
| Thêm giá trị enum `GymFacility` | Phải thêm 1 dòng SYSTEM vào `SYSTEM_AMENITY_SEEDS` (`GS/services/amenity-catalog.ts`), 1 migration chèn `amenities`, và nhãn ở web/mobile — `amenity-facility-contract.test.ts` kiểm sự lệch này |
| Thêm cột vào phần công khai | Thêm vào `toPublicXxxDto` (allowlist), **và** vào schema payload + `diffPayloads` + apply. Cột không có trong allowlist thì không bao giờ ra ngoài |
| Ghi vào `gyms`/`gym_partners` | Transaction phải gọi `withCompatWriter(tx)` (`GS/repositories/compat-writer.ts`) — nếu không, trigger ghi `WRITER_ABSENT` làm hỏng bằng chứng tắt cờ (xem MODERATION_WORKFLOW §6) |
| Migration | Viết tay, timestamp phải lớn hơn migration lớn nhất hiện có |
