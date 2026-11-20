# Listing Management — Vòng đời ảnh

Áp dụng cho ảnh hình thể PT (`pt_physique_photos`, user-service) và ảnh chi nhánh gym (`gym_photos`, gym-service). Hai bên làm cùng một quy trình; số khác nhau ghi riêng. Kiến trúc chung: [ARCHITECTURE](ARCHITECTURE.md).

## 1. Trạng thái

| Trạng thái | Nghĩa | Client thấy? | Chuyển sang |
|---|---|---|---|
| `STAGED` | Đã upload & xác nhận, chưa nằm trong tin công khai | Không (chỉ Owner/PT/Admin qua link ký 15 phút trong JSON xem trước) | `PUBLISHED` khi bản sửa chứa nó được duyệt; `DISCARDED` khi bị xóa/dọn |
| `PUBLISHED` | Đang công khai | Có, qua `/media/*` | `RETIRED` khi bản duyệt sau không còn nó, hoặc Admin gỡ |
| `RETIRED` | Đã gỡ, tệp giữ để xem lịch sử | Không | `DISCARDED` sau 90 ngày (tệp bị xóa, dòng giữ) hoặc ngay khi Admin `purge` |
| `DISCARDED` | Tệp đã mất | Không | — |

Chi nhánh **chưa từng công khai** (`DRAFT`, `PENDING_REVIEW`, `REJECTED`) sở hữu ảnh STAGED của mình; lần duyệt **đầu tiên** chuyển STAGED → PUBLISHED, chọn đúng 1 ảnh bìa và đánh lại `sort_order` 0..n-1 (`publishStagedGymPhotosTx`). Từ đó mọi thay đổi ảnh đi qua bản sửa. Chi nhánh DRAFT được dùng `PUT …/photos/reorder` và `PATCH …/photos/:photoId/cover`; chi nhánh đã gửi duyệt dùng payload bản sửa (409 `GYM_NOT_DRAFT`).

## 2. Giới hạn

| | PT | Chi nhánh gym | Mã khi vượt |
|---|---|---|---|
| Ảnh công khai | 5 (`MAX_PHYSIQUE_PHOTOS`) | 20 (`MAX_GYM_PHOTOS`) | 422 `PHOTO_LIMIT` |
| Ảnh STAGED cùng lúc | 15 | 40 | 422 `STAGED_LIMIT` |
| Presign chưa dùng, còn hạn | 20 | 20 | 429 `TOO_MANY_UPLOADS` |
| Dung lượng | 8 MB | 8 MB | policy chặn ở bước upload; vượt khi confirm → 422 `IMAGE_TOO_LARGE` |
| Định dạng | JPEG, PNG, WebP | như PT | 422 `IMAGE_INVALID` |
| Điểm ảnh / cạnh dài | ≤ 40 MP / thu về ≤ 2048 px | như PT | 422 `IMAGE_INVALID` |
| Hạn presign | 10 phút | 10 phút | 409 `INTENT_EXPIRED` |

Bìa phải là một ảnh trong `photoIds` (422 `COVER_NOT_IN_PHOTOS`); DB chỉ cho **1 bìa PUBLISHED** mỗi chủ.

## 3. Upload: presign → PUT → confirm

| Bước | Route (PT) | Route (Gym) | Làm gì |
|---|---|---|---|
| 1 | `POST /profile/me/listing/physique/presign {contentType}` | `POST /owner/gyms/:id/listing/photos/presign` | kiểm giới hạn, tạo intent, trả `{uploadId, url, fields, method:"POST", maxBytes, expiresAt}` |
| 2 | client POST thẳng lên S3/MinIO với `fields` | như PT | không đi qua backend |
| 3 | `POST …/physique/confirm {uploadId}` | `POST …/listing/photos/confirm` | xác nhận (dưới đây) |
| xóa | `DELETE …/physique/:photoId` | `DELETE …/listing/photos/:photoId` | chỉ ảnh STAGED chưa nằm trong bản mở: 409 `PHOTO_PUBLISHED`, `PHOTO_IN_REVIEW` |

Confirm (`US/services/pt-physique-upload.service.ts`, `GS/services/gym-listing-upload.service.ts`):
1. Nhận intent bằng UPDATE có điều kiện (đúng chủ, còn hạn, chưa dùng) → 404 `UPLOAD_NOT_FOUND`, 409 `INTENT_EXPIRED` / `INTENT_ALREADY_USED`.
2. `HEAD` kiểm cỡ, rồi đọc toàn bộ tệp (≤ 8 MB).
3. **Magic bytes** của nội dung thật phải là JPEG/PNG/WebP và khớp `Content-Type` đã lưu.
4. **sha256** tính trên byte thật, không tin hash từ client.
5. `sharp` giải mã (`limitInputPixels` 40 MP, `failOn:'error'`), tự xoay theo EXIF, thu ≤ 2048 px, **mã hóa lại WebP** (q82) — xóa EXIF/GPS. Bản gốc không được giữ làm ảnh công khai.
6. Ghi tệp `…/<photoId>.webp`, rồi `INSERT … ON CONFLICT (chủ, content_hash) WHERE status IN ('STAGED','PUBLISHED') DO NOTHING`. Trùng hash → trả ảnh sẵn có với `deduplicated:true`, không tạo bản thứ hai.

Admin up ảnh chi nhánh: `POST /admin/listings/gyms/:gymId/photos/presign|confirm`. **PT không có route này** — không ai ngoài PT được đưa ảnh hình thể lên; Admin chỉ sắp xếp/gỡ.

## 4. Phục vụ ảnh công khai (`/media/*`)

| Route | Điều kiện | Kết quả |
|---|---|---|
| `GET/HEAD /media/pt-physique/:photoId` | ảnh PUBLISHED ∧ PT hiển thị công khai | 302 → presigned GET **10 phút**, `Cache-Control: private, max-age=300` |
| `GET/HEAD /media/gym-photos/:photoId` | ảnh PUBLISHED ∧ chi nhánh hiển thị công khai | như trên |
| `GET /uploads/gym-photos/:file` | ảnh cũ lưu đĩa, kiểm từng request | stream |
| mọi trường hợp còn lại (STAGED/RETIRED/DISCARDED, chủ bị ẩn, không tồn tại) | | 404, không ký gì |

Không cần đăng nhập; gateway trả 405 cho phương thức khác GET/HEAD. URL `/media/<id>` **không hết hạn** nên client lưu cache được; link ký phía sau hết hạn 10 phút và **không thu hồi được** — ảnh vừa gỡ vẫn truy cập được tối đa ~10 phút bằng link đã phát (Admin dùng `purge` để xóa tệp ngay).

## 5. Job dọn (sweep)

Mỗi 10 phút (`PT_LISTING_SWEEP_INTERVAL_MS`, `GYM_LISTING_SWEEP_INTERVAL_MS`), mỗi lượt tối đa 100 mục mỗi việc, mỗi ảnh một transaction `FOR UPDATE SKIP LOCKED`, điều kiện kiểm lại trong transaction:

| Việc | Điều kiện | Kết quả |
|---|---|---|
| Intent bỏ dở | presign hết hạn > 1 giờ; hoặc đang xác nhận > 5 phút mà không ra ảnh | xóa object, đóng/xóa intent |
| Ảnh STAGED mồ côi | **không** bản mở (DRAFT/PENDING) nào liệt kê ∧ **không** bản đóng trong 30 ngày liệt kê ∧ tạo > 7 ngày ∧ (gym) chi nhánh đã từng công khai | `DISCARDED` + xóa tệp |
| Ảnh RETIRED | gỡ > 90 ngày | xóa tệp, `DISCARDED` |

Ảnh PUBLISHED không bao giờ bị job đụng. Xóa tệp xảy ra **trước** khi đổi dòng; lỗi xóa → rollback, lượt sau thử lại.

## 6. Biến môi trường (chỉ tên)

| Dịch vụ | Biến |
|---|---|
| user-service (ảnh PT) | `PT_MEDIA_S3_ENDPOINT`, `PT_MEDIA_S3_PUBLIC_ENDPOINT`, `PT_MEDIA_S3_REGION`, `PT_MEDIA_S3_FORCE_PATH_STYLE`, `PT_MEDIA_S3_ACCESS_KEY_ID`, `PT_MEDIA_S3_SECRET_ACCESS_KEY`, `PT_MEDIA_S3_BUCKET`, `PT_MEDIA_S3_PUBLIC_VIA_REQUEST` (dev; bị bỏ qua khi `NODE_ENV=production`) |
| gym-service (ảnh chi nhánh) | `PARTNER_S3_ENDPOINT`, `PARTNER_S3_PUBLIC_ENDPOINT`, `PARTNER_S3_REGION`, `PARTNER_S3_FORCE_PATH_STYLE`, `PARTNER_S3_ACCESS_KEY_ID`, `PARTNER_S3_SECRET_ACCESS_KEY`, `PARTNER_S3_PRIVATE_BUCKET`, `PARTNER_S3_PUBLIC_VIA_REQUEST`; khóa đối tượng `listing-photos/<gymId>/…` |
| web dev (Vite) | `PT_MEDIA_S3_BUCKET`, `PARTNER_S3_PRIVATE_BUCKET` (chỉ để dựng đường proxy) |

Giá trị khóa lấy từ `.env`/compose của từng môi trường; không ghi vào tài liệu hay commit. Dev compose dùng MinIO với bucket `gymini-user-media` (PT) và `gymini-partner-private` (gym).

**Lưu ý dev (Vite proxy):** ở chế độ `…_PUBLIC_VIA_REQUEST=true`, backend ký link theo đúng địa chỉ trang đang mở (localhost, IP LAN, tunnel) với đường dẫn `/<bucket>/<key>`. Vite phải proxy cả hai đường dẫn bucket này sang gateway (`frontend/web/vite.config.ts`), nếu thiếu proxy `/gymini-user-media`, ảnh PT sẽ trả HTML của SPA thay vì ảnh (lỗi BUG-1 đã sửa ở commit `f0d9812c`). Đổi tên bucket → đặt đúng `PT_MEDIA_S3_BUCKET` cho web-dev và restart container web.
