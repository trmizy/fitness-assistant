# Listing Management — Quy trình duyệt bản sửa

Bảng cột, ràng buộc DB và bản đồ endpoint đầy đủ nằm ở [ARCHITECTURE](ARCHITECTURE.md) §3–§4; tài liệu này tập trung vào **máy trạng thái, các mã xung đột và thông báo**. PT và Gym dùng cùng một máy trạng thái (`US/services/pt-listing*.ts`, `GS/services/gym-listing*.ts`).

## 1. Máy trạng thái

```
                 createDraft (bản công khai hoặc chép bản đóng ≤ 30 ngày)
(không có bản mở) ─────────────────────────────> DRAFT ──discard──> WITHDRAWN
                                                  │  ▲ saveDraft (draft_version+1)
                                                  │  └─ rebase (base_version := listing_version hiện tại)
                                                  │ submit
                                                  ▼
   withdraw ─> WITHDRAWN + DRAFT mới <────────── PENDING
                                                  │
        approve ─> APPROVED (áp vào bản công khai, listing_version+1)
        reject ─> REJECTED (không sinh bản nháp)
        request-changes ─> CHANGES_REQUESTED + DRAFT con (parent_revision_id)
        Admin direct-edit khi bản đang PENDING ─> STALE + DRAFT con đã rebase
```

| Trạng thái | Loại | Ý nghĩa | Ai đặt |
|---|---|---|---|
| `DRAFT` | mở | Owner/PT đang soạn, sửa tự do | tạo nháp, withdraw, request-changes, STALE |
| `PENDING` | mở | Đã gửi, **khóa sửa** (PUT/rebase/discard → 409 `REVISION_UNDER_REVIEW`) | submit |
| `APPROVED` | đóng | Đã áp vào tin công khai | Admin approve; bản `ADMIN_DIRECT` sinh ra ở trạng thái này |
| `REJECTED` | đóng | Bị từ chối, kèm `review_note` | Admin reject |
| `CHANGES_REQUESTED` | đóng | Cần sửa; DRAFT con giữ nguyên nội dung | Admin request-changes |
| `WITHDRAWN` | đóng | Owner tự rút (PENDING) hoặc bỏ nháp (DRAFT) | Owner/PT |
| `STALE` | đóng | Tin công khai đổi từ lúc gửi nên bản này không áp được | hệ thống |

Quy tắc chung: mỗi PT/chi nhánh có **tối đa 1 bản mở**; mọi chuyển trạng thái là `UPDATE … WHERE status = <cũ>` nên hai request đua nhau chỉ một thắng; bản đóng bất biến (trigger Postgres).

## 2. Khóa lạc quan: hai bộ đếm khác nhau

| Mã | Khi nào | Nghĩa | Client làm gì |
|---|---|---|---|
| `DRAFT_STALE` (409) | `expectedDraftVersion` ≠ `draft_version` ở PUT draft, submit, rebase | Nháp đã bị sửa ở nơi khác (tab khác/thiết bị khác) | Dùng `revision` trong body lỗi (đã kèm bản mới nhất), cho người dùng chọn ghi đè hay tải lại. `expectedDraftVersion` **bắt buộc** ở PUT và submit; chỉ tùy chọn ở rebase |
| `LISTING_STALE` (409) | `base_version` ≠ `listing_version` công khai ở submit/approve; `expectedListingVersion` sai ở direct-edit | Tin công khai đã đổi (Admin sửa, hoặc bản khác được duyệt) từ lúc bắt đầu soạn | Gọi `POST …/rebase` — giữ nội dung đang soạn, dời `base_version`; rồi submit lại |
| `REVISION_CLOSED` (409) | thao tác trên bản đã được xử lý | Thua cuộc đua | Tải lại |
| `REVISION_CONFLICT` (409) | không rơi vào các trường hợp trên | Thua đua không rõ nguyên nhân | Thử lại |

Cả hai 409 kèm `revision` + `listingVersion` trong body. `rebase` lọc payload qua `filterPayloadForDraft` (bỏ ảnh/tiện ích không còn dùng được) và ghi các chỉnh sửa tự động vào `system_adjustments`; kiểu thường gặp: `REBASED_AFTER_ADMIN_EDIT`, `AMENITY_DISABLED_REMOVED`, `PROPOSAL_APPROVED|MERGED|REJECTED_REMOVED`.

## 3. Hành vi của từng bước

| Bước | Điều kiện kiểm | Lỗi |
|---|---|---|
| `submit` | có bản mở; không PENDING; `draft_version` khớp; `base_version` = bản công khai; sau `validateRefs` phải **có thay đổi** so với bản công khai | 404 `NO_OPEN_REVISION`; 409 `REVISION_UNDER_REVIEW`/`DRAFT_STALE`/`LISTING_STALE`; 422 `NO_CHANGES`. Gym thêm 422 `AMENITIES_REQUIRED`, 409 `AMENITY_DISABLED` |
| `withdraw` | chỉ PENDING; tạo DRAFT mới cùng nội dung, `parent_revision_id` = bản vừa rút | 409 `REVISION_NOT_PENDING` (nháp thì dùng `discard`) |
| `approve` | PENDING; `base_version` còn khớp; ref còn hợp lệ. Áp trong **một** transaction (`applyXxxRevisionTx`) | 409 `ALREADY_DECIDED`, `LISTING_STALE` (bản chuyển STALE + DRAFT rebase), `REVISION_INVALID`. Gym: `CUSTOM_AMENITY_PENDING` (phải quyết đề xuất trước), `AMENITY_PROPOSAL_DEAD`, `AMENITY_DISABLED` — Admin chọn `dropRejectedAmenities` / `dropDisabledAmenities` để bỏ chúng và duyệt tiếp |
| `reject`, `request-changes` | `note` bắt buộc (1–1000 ký tự) | 409 `ALREADY_DECIDED` |
| `direct-edit` (Admin) | `reason` ≥ 10 ký tự (≤ 1000), `expectedListingVersion` khớp; phải có thay đổi | 409 `LISTING_STALE`; 422 `NO_CHANGES`; PT: 422 `PHOTO_NOT_PUBLISHED` (Admin chỉ sắp xếp/gỡ ảnh đang công khai, **không thêm** ảnh hình thể) |

### ADMIN_DIRECT

Admin sửa thẳng tin công khai không cần Owner gửi: tạo **một bản `APPROVED` với `source=ADMIN_DIRECT`**, lưu `admin_reason`, `previous_snapshot`, bump `listing_version`, ghi audit (`PT_LISTING_ADMIN_EDITED` / `LISTING_ADMIN_EDITED`). Hệ quả với bản đang mở của Owner:
- **PENDING** → `STALE` + một DRAFT con đã rebase (giữ công việc của Owner) + thông báo `*_LISTING_INVALIDATED`.
- **DRAFT** → không bị đụng, nhưng submit sẽ 409 `LISTING_STALE` cho tới khi `rebase`.
- Gỡ ảnh công khai (`…/retire`) cũng là một `ADMIN_DIRECT`; `purge:true` xóa luôn tệp (nếu không, tệp giữ 90 ngày).
- Direct-edit không báo gì cho Owner nếu không có bản PENDING nào bị vô hiệu.

## 4. Thông báo

| Sự kiện | Người nhận | `eventType` | Kênh |
|---|---|---|---|
| PT gửi duyệt | tất cả Admin đang online | `PT_LISTING_SUBMITTED` | đẩy realtime qua chat-service, **không lưu** (link `/admin/listings`) |
| Gym gửi duyệt | — | — | không có thông báo; Admin thấy ở hàng đợi (`GET /admin/listings/gyms?status=PENDING`) |
| Approve / Reject / Request-changes / bị vô hiệu | PT | `PT_LISTING_APPROVED` / `_REJECTED` / `_CHANGES_REQUESTED` / `_INVALIDATED` | lưu hộp thư trong transaction (entity `PT_LISTING`, link `/pt/listing`) |
| Như trên | chủ chi nhánh | `GYM_LISTING_APPROVED` / `_REJECTED` / `_CHANGES_REQUESTED` / `_INVALIDATED` | gym-service → user-service `/internal/notifications`, best-effort sau commit, link `/gym-owner/listings?gymId=` |
| Xử lý đề xuất tiện ích | chủ đề xuất | `GYM_AMENITY_PROPOSAL_REVIEWED` | như trên |
| Admin tắt tiện ích khỏi nháp | chủ chi nhánh | `GYM_LISTING_INVALIDATED` | như trên |

Thông báo gym tắt được bằng `LISTING_GYM_NOTIFICATIONS_ENABLED=false|0` (mặc định bật).

## 5. Endpoint (đường dẫn thật)

Qua gateway; Owner/PT lấy danh tính từ token, Admin cần role `ADMIN`.

| Vai | PT (user-service) | Gym (gym-service) |
|---|---|---|
| Đọc | `GET /profile/me/listing`, `GET …/preview` | `GET /owner/gyms/:id/listing`, `GET …/listing/preview` |
| Soạn | `POST …/draft`, `PUT …/draft`, `POST …/discard`, `POST …/rebase` | cùng 4 route dưới `/owner/gyms/:id/listing/` |
| Gửi/rút | `POST …/submit`, `POST …/withdraw` | như PT |
| Admin hàng đợi | `GET /admin/listings/pts` | `GET /admin/listings/gyms` |
| Admin chi tiết | `GET …/revisions/:rid`, `…/revisions/:rid/preview` | như PT |
| Admin quyết | `POST …/revisions/:rid/approve` · `/reject` · `/request-changes` | như PT |
| Admin sửa trực tiếp | `POST /admin/listings/pts/:ptUserId/direct-edit` | `POST /admin/listings/gyms/:gymId/direct-edit` |
| Admin gỡ ảnh | `POST …/pts/:ptUserId/physique/:photoId/retire` | `POST …/gyms/:gymId/photos/:photoId/retire` |
| Admin lịch sử | `GET …/pts/:ptUserId/history`, `GET …/pts/:ptUserId` | `GET …/gyms/:gymId/history`, `GET …/gyms/:gymId` |

Hàng đợi: `status` mặc định `PENDING`, nhận 7 giá trị trạng thái ở §1; sai → 400 `VALIDATION_FAILED`. Chi tiết mã lỗi từng route: ARCHITECTURE §4.1, §4.2, §4.4. Quy ước chung: mọi response Owner/PT/Admin `Cache-Control: no-store, private`; body mọi request `.strict()`.
