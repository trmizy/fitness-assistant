# Listing Management — Quyền sửa trường & DTO công khai

Kiến trúc chung: xem [ARCHITECTURE](ARCHITECTURE.md). Tài liệu này chỉ trả lời 3 câu: **trường nào chỉ sửa được qua bản sửa có duyệt**, **route nào bị khóa**, **Client được thấy trường nào**. Ký hiệu đường dẫn như ARCHITECTURE (`US` = user-service/src, `GS` = gym-service/src).

## 1. Trường nằm trong bản sửa (chỉ đổi qua duyệt)

Payload bản sửa là schema `.strict()` — khóa lạ → 400 `VALIDATION_FAILED` (`US/services/pt-listing.schemas.ts`, `GS/services/gym-listing.schemas.ts`).

### PT

| Nhóm | Trường | Giới hạn (code) |
|---|---|---|
| Hồ sơ chữ (`profile`, 8 trường) | `professionalBio` | ≤ 2000 ký tự |
| | `trainingMethodsApproach` | ≤ 2000 ký tự |
| | `mainSpecialties`, `targetClientGroups`, `primaryTrainingGoals` | ≤ 10 mục, mỗi mục ≤ 60 ký tự, tự loại trùng |
| | `languages` | ≤ 10 mục, mỗi mục ≤ 30 ký tự |
| | `websiteUrl`, `linkedinUrl` | ≤ 300 ký tự, phải `http(s)://` |
| Gói dịch vụ (`packages`) | `name` (≤ 80), `description` (≤ 1000), `price` (> 0, ≤ 1 tỷ), `sessionCount` (1–200), `sessionMode` (ONLINE/OFFLINE), `sessionDurationMinutes` (15–240), `validityDays` (1–3650 hoặc null), `isActive`, `archive` | ≤ 10 gói chưa lưu trữ; payload ≤ 30 phần tử |
| Ảnh hình thể | `photoIds`, `coverPhotoId` | ≤ 5 ảnh công khai (xem [PHOTO_LIFECYCLE](PHOTO_LIFECYCLE.md)) |

`UserProfile.specialties` được đồng bộ từ `mainSpecialties` trong chính transaction áp bản sửa. Giá "từ" **suy ra** từ gói đang bán, không có chỗ để sửa.

### Chủ chi nhánh gym

| Trường | Giới hạn (code) |
|---|---|
| `description` | ≤ 300 ký tự (`MAX_DESCRIPTION_LENGTH`) |
| `amenityIds` + `proposalIds` | tổng ≤ 60 (422 `AMENITY_LIMIT`); chỉ tiện ích ACTIVE (xem [AMENITY_SYSTEM](AMENITY_SYSTEM.md)); gửi duyệt cần ≥ 1 tiện ích hoặc đề xuất |
| `proposalIds` | ≤ 10 phần tử, phải là đề xuất PENDING của chính chủ (422 `PROPOSAL_NOT_OWNED`) |
| `photoIds`, `coverPhotoId` | ≤ 20 ảnh công khai |

Chi nhánh chỉ có bản sửa khi `status` là `APPROVED` hoặc `SUSPENDED` và chưa đóng vĩnh viễn (đóng tạm thì vẫn sửa được) — `LISTING_EDITABLE_STATUSES`, `GS/services/gym-listing.helpers.ts`. DRAFT → 409 `GYM_IS_DRAFT`; còn lại → 409 `LISTING_NOT_AVAILABLE`.

## 2. Trường không nằm trong bản sửa

| Trường | Cách đổi |
|---|---|
| Gym: `name`, `address` | Vẫn qua `PATCH /owner/gyms/:id`, nhưng chỉ ghi vào `pendingName`/`pendingAddress`; Admin duyệt mới thành `approvedName`/`approvedAddress` (`gym.service.ts` `updateOwnedGym`) |
| Gym: `city`, `phone`, `email`, `provinceCode`, `wardCode`, `latitude`, `longitude`, `locationNote`, giờ mở cửa | Vẫn sửa trực tiếp, **không** qua duyệt (code ghi rõ "stays freely editable") |
| PT: `yearsOfExperience`, chứng chỉ, lịch rảnh, `serviceMode`, `operatingAreas`, nơi tập… | Không thuộc payload → workflow Tin đăng không đụng tới |
| Hợp đồng đã tạo | Chụp lại giá/số buổi lúc tạo; sửa gói không đổi hợp đồng cũ |

## 3. Route bị khóa (đường cũ)

Body lỗi dùng chung: `{ success:false, error:{ code, message }, message }`. Mỗi lần gọi ghi một dòng `client_compat_events` (best-effort, không ảnh hưởng response).

| Route | Điều kiện | Kết quả |
|---|---|---|
| `PATCH /owner/gyms/:id` có `description` hoặc `facilities` | chi nhánh **không** DRAFT | 409 `LISTING_REVIEW_REQUIRED` — cả request bị từ chối, chưa ghi gì |
| `PATCH /owner/gyms/:id` | chi nhánh DRAFT (wizard) | cho qua (facilities ghi vào `gym_amenities` rồi đồng bộ bản sao) |
| `POST/PUT/PATCH/DELETE /owner/gyms/:id/photos…` (4 route ghi) | **mọi** trạng thái | 410 `UPLOAD_ROUTE_RETIRED`, trả trước khi middleware upload chạy → không có gì ghi xuống đĩa. `GET …/photos` vẫn đọc |
| `POST /profile/me/service-packages`, `PATCH`/`DELETE …/:id` | mọi PT | 409 `LISTING_REVIEW_REQUIRED` |
| `POST /me/service-packages`, `PATCH`/`DELETE /me/service-packages/:id` | mọi PT | 409 `LISTING_REVIEW_REQUIRED` (6 route ghi tất cả) |
| `GET …/service-packages` của chính PT | | vẫn đọc được |

Thông điệp tiếng Việt cố định: "Thay đổi này cần gửi duyệt. Hãy cập nhật ứng dụng để dùng mục Tin đăng." / "Cách tải ảnh này đã ngừng hoạt động…" (`GS/services/client-compat.service.ts`, `US/controllers/pt_service_package.controller.ts`).

## 4. DTO công khai — allowlist

Hai hàm `toPublicPtDto` / `toPublicGymDto` đọc một kiểu "đã nhãn công khai" (`PublishedPtSource`, `PublishedGymSource`); không thể truyền revision hay ảnh STAGED vào. **Cột mới không ra ngoài cho tới khi ai đó thêm vào hàm này.**

### Gym (`GS/services/gym-public.ts`)

| Có | Không bao giờ |
|---|---|
| `id`, `brandId`, `name` (= `approvedName ?? name`), `approvedName`, `address` (= `approvedAddress ?? address`), `approvedAddress`, `description`, `city`, `provinceCode`, `wardCode`, `latitude`, `longitude`, `locationNote`, `phone`, `email`, `status`, `operationalStatus`, `closureReason`, `expectedReopenAt`, `createdAt`, `updatedAt` | `pendingName`, `pendingAddress`, `pendingNameNote`, `pendingAddressNote`, `changesRequested*`, `ownerId`, `closedBy`, `wizardStep`, `closedAt`, `reopenedAt`, `listing_version`, `legacy_*`, `created_flow_version` |
| `amenities[]` = `{slug, name, category, iconKey}` (chỉ ACTIVE); `facilities` (bản sao cho app cũ) | tiện ích DISABLED, đề xuất |
| `coverPhotoUrl`, ảnh PUBLISHED dạng `/media/gym-photos/:id` | ảnh STAGED/RETIRED/DISCARDED, `s3Key`, `fileName`, `content_hash` |
| `brand`: `id`, `name`, `approvedName`, `description`, 4 link mạng xã hội, `logoUrl` | `pendingName`, `logoKey`, `ownerId` của brand |

### PT (`US/services/pt-public-dto.ts`)

| Có | Không |
|---|---|
| Tên, `photoUrl`, `specialties`, `isAcceptingClients`, `notAcceptingReason`, `searchCity/District/Ward`; `ptApplication` chọn lọc (bio, kinh nghiệm, học vấn, lịch rảnh, link, `mainSpecialties`, `languages`, chứng chỉ 6 trường, giá "từ" suy ra) | `ptSuspended` thật (luôn `false` — PT bị khóa không xuất hiện), `gymId` nội bộ, hạn chế, ghi chú duyệt, các cột `PTApplication` khác |
| Gói đang bán (`isActive` và chưa lưu trữ), ảnh PUBLISHED `/media/pt-physique/:id`, `coverPhotoUrl`, `avgRating`, `ratingCount` | bản nháp, ảnh STAGED, `storageKey`, `content_hash` |

Các trường giá cũ (`desiredSessionPrice`, `onlinePricePerSession`…) giữ cho app đã cài nhưng **tính từ gói**; `monthlyProgramPrice`, `packagePrice`, `sessionsPerPackage`, `additionalPricingNotes` luôn `null`.

## 5. Luật hiển thị (khớp với list/detail/media)

| Đối tượng | Hiển thị khi | Ngoại lệ |
|---|---|---|
| PT | `isPT` ∧ hồ sơ APPROVED ∧ `!ptSuspended` ∧ không có hạn chế phạm vi `ACCOUNT` đang mở | hạn chế `CONTRACT` không ẩn |
| Gym — **danh sách** và mọi route con (plans*, trainers, reviews, media, uploads) | `APPROVED` ∧ `operationalStatus=OPEN` ∧ chủ không bị `partnerGuard` ẩn | — |
| Gym — **chi tiết `GET /gyms/:id`** (B43) | như trên nhưng chấp nhận cả `TEMPORARILY_CLOSED` → 200, kèm `closureReason`/`expectedReopenAt` | `PERMANENTLY_CLOSED`, chưa duyệt, đối tác bị ẩn → 404 |

\* `GET /gyms/:id/plans` của chi nhánh đóng tạm trả 200 **không có gói** + trạng thái đóng (C2-03); mua gói/check-in vẫn bị chặn. `gymDetailWhere()` / `findTemporarilyClosedDetailGym()` trong `gym-public.ts`.
