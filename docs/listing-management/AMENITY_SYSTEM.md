# Listing Management — Hệ thống tiện ích

Một catalogue chung cho mọi chi nhánh; chủ gym chọn từ catalogue hoặc **đề xuất** tiện ích mới, Admin quyết. Mã nằm ở gym-service (`GS` = `backend/services/gym-service/src`): `services/gym-amenity-catalog.service.ts` (catalogue + đề xuất), `services/gym-amenity.service.ts` (bản sao `facilities`), `services/gym-amenity-selection.service.ts` (chọn ở hồ sơ đăng ký), `services/amenity-catalog.ts` (hằng số). Kiến trúc chung: [ARCHITECTURE](ARCHITECTURE.md).

## 1. Catalogue (`amenities`)

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | chỉ **hai**: `ACTIVE`, `DISABLED` (đề xuất sống ở bảng khác, không bao giờ là một dòng catalogue) |
| Nguồn | `SYSTEM` (18 dòng, `slug` = nhãn enum `GymFacility`, id `amenity-sys-<slug>`) hoặc `CUSTOM` (Admin tạo / sinh từ đề xuất, `slug` ngẫu nhiên) |
| Nhóm | `FACILITY`, `TRAINING_ZONE`, `SERVICE`, `RECOVERY` |
| Tên | 2–40 ký tự; duy nhất theo `name_normalized` (bỏ dấu, `đ→d`, chữ thường, gộp khoảng trắng) — "Phòng boxing" = "phong BOXING" |
| Biểu tượng | `iconKey` phải thuộc allowlist 30 khóa lucide (`AMENITY_ICON_KEYS`); sai → 422 `ICON_NOT_ALLOWED` |

**Tắt một tiện ích** (`PATCH /admin/amenities/:id {status:"DISABLED"}`): mọi bản **DRAFT** đang mở bị bỏ tiện ích đó (ghi `AMENITY_DISABLED_REMOVED`, báo chủ `GYM_LISTING_INVALIDATED`); bản **PENDING** giữ nguyên (Admin thấy cảnh báo; duyệt cần `dropDisabledAmenities` nếu không → 409 `AMENITY_DISABLED`); tiện ích DISABLED biến khỏi hồ sơ công khai (`publishedAmenities` chỉ lấy ACTIVE) và bản sao `facilities` được đồng bộ lại. **Bật lại** cũng đồng bộ lại bản sao.

## 2. Đề xuất (`amenity_proposals`)

Trạng thái: `PENDING → APPROVED | REJECTED | MERGED | CANCELLED`. Loại: `NEW` (tên chưa có) hoặc `REENABLE` (trùng tên một tiện ích đang DISABLED).

### Chủ gym — `POST /owner/amenities/proposals {gymId, name, suggestedCategory, note?}`

Mọi thao tác chạy dưới advisory lock theo tên chuẩn hóa nên cùng một tên luôn xử lý tuần tự (không 500 vì trùng).

| Tên đề xuất khớp… | Kết quả |
|---|---|
| tiện ích **ACTIVE** | 200 `{matchedAmenity}` — không tạo đề xuất, chủ chọn tiện ích đó |
| tiện ích **DISABLED** | đề xuất `REENABLE` (200) |
| không khớp gì | đề xuất `NEW` (201) |
| đề xuất PENDING của **chính chủ cho cùng chi nhánh** | trả lại đề xuất đó (idempotent, `created:false`) |
| đề xuất PENDING của chủ khác / chi nhánh khác | đề xuất **riêng**; hàng đợi Admin nhóm theo loại + tên + đích |

Sửa/hủy: `PATCH|DELETE /owner/amenities/proposals/:id` chỉ khi PENDING. Lỗi: 404 `PROPOSAL_NOT_FOUND`; 409 `PROPOSAL_ALREADY_DECIDED`, `PROPOSAL_IN_REVIEW` (đang nằm trong bản PENDING — rút bản trước), `PROPOSAL_NAME_TAKEN`, `AMENITY_ALREADY_EXISTS`; 422 `NAME_INVALID`.

### Admin — `GET /admin/amenities/proposals`, rồi một trong ba

Mỗi lần gọi xử lý **một nhóm** trong một transaction; có đề xuất không còn PENDING → toàn bộ rollback, 409 `PROPOSAL_ALREADY_DECIDED`.

| Hành động | Body | Kết quả | Lỗi riêng |
|---|---|---|---|
| `POST …/proposals/approve` | `proposalIds`, tùy chọn `category`, `iconKey`, `sortOrder`, `name`, `reenableAndMerge` | `NEW` → tạo tiện ích CUSTOM (mặc định nhóm chủ gợi ý, icon mặc định của nhóm) → `APPROVED`. `REENABLE` → bật lại tiện ích đích → `APPROVED` | 422 `PROPOSAL_GROUP_MISMATCH` (khác loại/tên/đích); 422 `NAME_MISMATCH` (đổi tên khác tên chủ đề xuất); 409 `AMENITY_EXISTS_DISABLED` nếu trùng tên một tiện ích đã tắt — phải gửi lại với `reenableAndMerge:true` (không bao giờ ngầm) |
| `POST …/proposals/merge` | `proposalIds`, `targetAmenityId`, `reenableAndMerge?` | gộp vào tiện ích có sẵn → `MERGED` | 404 `AMENITY_NOT_FOUND`; 409 `AMENITY_EXISTS_DISABLED` nếu đích đang DISABLED |
| `POST …/proposals/reject` | `proposalIds`, `reason` (3–500) | `REJECTED` | — |

Sau quyết định, trong cùng transaction:
- Bản sửa **mở** nhắc tới các đề xuất đó được viết lại: tiện ích kết quả được thêm vào `amenityIds`, đề xuất bị bỏ khỏi `proposalIds`, ghi `system_adjustments` (`PROPOSAL_APPROVED|MERGED|REJECTED_REMOVED`). DRAFT tăng `draft_version` (client cũ nhận `DRAFT_STALE`); PENDING giữ trạng thái.
- Chi nhánh **chưa có tin công khai** (DRAFT của wizard, PENDING_REVIEW…) không có bản sửa: tiện ích kết quả được gắn thẳng vào `gym_amenities`.
- Audit (`amenity_audit_logs` + audit đối tác) và thông báo `GYM_AMENITY_PROPOSAL_REVIEWED` cho từng chủ.

Admin cũng tạo trực tiếp (`POST /admin/amenities`, 409 `AMENITY_NAME_TAKEN` nếu trùng), sửa (`PATCH /admin/amenities/:id`, trường `reason` tùy chọn) và xem `GET /admin/amenities/:id/history`.

## 3. `gym_amenities` và bản sao `Gym.facilities`

| | Nguồn chuẩn | Bản sao |
|---|---|---|
| Bảng/cột | `gym_amenities` (gym × amenity) | cột `gyms.facilities` (mảng `GymFacility`) |
| Nội dung | mọi tiện ích của chi nhánh, cả CUSTOM | slug của các tiện ích **SYSTEM + ACTIVE**, theo `sort_order` — CUSTOM không có giá trị enum nên chỉ xuất hiện ở `amenities[]` |
| Ai ghi | transaction áp bản sửa, Admin direct-edit, hồ sơ đăng ký/wizard | **chỉ** `syncFacilitiesMirrorTx` |
| Ai đọc | client mới đọc `amenities[]` | app cũ đọc `facilities` |

`syncFacilitiesMirrorTx` được gọi bởi: áp bản sửa, Admin direct-edit, bật/tắt tiện ích (đồng bộ mọi chi nhánh đang dùng), ghi facilities của chi nhánh DRAFT. Mọi transaction ghi vào `gyms`/`gym_partners` phải gọi `withCompatWriter(tx)`, nếu không trigger ghi `WRITER_ABSENT` (xem ARCHITECTURE §8).

## 4. Bước Tiện ích của hồ sơ đăng ký đối tác

- `PUT /owner/application/amenities` body `.strict()`: `amenityIds?` (id catalogue, có mặt thì **là toàn bộ** lựa chọn), `proposals?` (≤ 10 `{name, suggestedCategory, note?}`), `proposalIds?` (đề xuất PENDING của mình để giữ). Gắn vào chi nhánh DRAFT duy nhất của hồ sơ. Tiện ích lạ → 422 `AMENITY_UNKNOWN`; đã tắt → 422 `AMENITY_DISABLED`.
- `GET /owner/application/amenities/catalog`: catalogue cho ứng viên chưa được duyệt (mount trước cổng vận hành).
- `POST /owner/application/submit` và `/resubmit`: cần ≥ 1 tiện ích ACTIVE **hoặc** đề xuất PENDING của chi nhánh, nếu không 422 `AMENITIES_REQUIRED` — áp dụng khi `amenitiesRequired()` đúng (xem §5). Cũng áp cho tạo chi nhánh mới và gửi duyệt chi nhánh/bản sửa tin.
- Hồ sơ ở bước 7 trên 10; bản sửa tin sau khi duyệt dùng `PUT …/listing/draft` (xem MODERATION_WORKFLOW).

## 5. Tương thích app cũ

| Mục | Giá trị (code: `services/legacy-compat.service.ts`) |
|---|---|
| Cờ | `LISTING_LEGACY_CLIENT_COMPAT` — mặc định **bật** ở mọi môi trường; chỉ `false`/`0` tắt; đọc mỗi lần gọi |
| Header | `X-Gymini-Listing-Flow: <số nguyên ≥ 2>` = client mới (code chấp nhận 2, 3…; thiếu, `1`, chữ, số thập phân = client cũ). `X-Gymini-Client` chỉ để đo |
| Bắt buộc ≥ 1 tiện ích khi | client mới, **hoặc** thực thể đã tạo bởi flow ≥ 2, **hoặc** cờ tắt |

| Request | Cờ | Kết quả |
|---|---|---|
| client mới, thiếu tiện ích | bật/tắt | 422 `AMENITIES_REQUIRED` |
| client cũ, thiếu tiện ích | **bật** | chấp nhận; chi nhánh/hồ sơ đánh `legacy_no_amenities`, ghi `legacy_client_at`, sự kiện `ACCEPTED` (cùng transaction, cùng `now()`) |
| client cũ, thiếu tiện ích | tắt | 422 `AMENITIES_REQUIRED` + sự kiện `REJECTED_422` (transaction riêng) |

Sự kiện nằm ở `legacy_compat_events` (`ACCEPTED`/`REJECTED_422`/`REJECTED_OTHER`; request có header mới thì **không** ghi). Muốn tắt cờ: chạy `node scripts/listing-compat-report.mjs <DATABASE_URL> [--days=14]` (chỉ đọc; exit 0 = đủ điều kiện, 3 = chưa, 1 = lỗi). Báo cáo không bao giờ tự tắt cờ; quyết định thuộc về người có quyền.
