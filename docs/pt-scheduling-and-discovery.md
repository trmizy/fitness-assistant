# Lịch rảnh, dời lịch hai phía, tìm kiếm và ưu tiên PT

Tài liệu bàn giao Phase 2. Ai sắp sửa code liên quan tới **lịch rảnh của PT, dời lịch buổi tập,
hay thứ tự sắp xếp danh sách PT** thì đọc hết file này trước.

| | |
|---|---|
| Lịch rảnh | `user-service/src/services/availability.service.ts` |
| Dời lịch | `booking.service.ts` — `requestReschedule` / `respondToReschedule` |
| Hết hạn đề xuất | `reschedule-expiry.service.ts` |
| Tìm kiếm | `repositories/profile.repository.ts` — `findPTs`, `findPtUserIdsMatchingText` |
| Ưu tiên & nhãn | `pt-discovery.service.ts` — `enrichForDiscovery` |
| Nhật ký kiểm toán | `services/audit.service.ts` |

---

## 1. Lịch rảnh chỉ có MỘT nguồn sự thật

### Ba triệu chứng, một nguyên nhân

Trước đây lịch rảnh nằm ở **hai nơi** và không đồng bộ ngược lại nhau:

| Nơi lưu | Trường | Dùng khi nào |
|---|---|---|
| `PTApplication` | `availableDays`, `availableFrom`, `availableUntil`, `availabilityBlocks`, … | Lúc nộp hồ sơ |
| `PTAvailability` | `dayOfWeek`, `startTime`, `endTime`, `isActive` | Lúc vận hành |

Ba triệu chứng tưởng rời rạc đều mọc từ đó:

1. PT không sửa được lịch khi hồ sơ đang chờ duyệt
2. Admin mở hồ sơ thấy lịch cũ lúc nộp, không phải lịch PT vừa sửa
3. Phải chạy một bước seed sau khi duyệt hồ sơ

Sửa từng triệu chứng riêng lẻ chỉ là vá tạm. Gộp về một nguồn thì cả ba biến mất cùng lúc.

### Nguyên tắc

> **Lịch rảnh là dữ liệu vận hành, không phải dữ liệu hồ sơ.** `PTAvailability` là nguồn sự
> thật duy nhất.

- Ghi được vào `PTAvailability` **ngay từ khi đang soạn hồ sơ** — không có điều kiện chặn theo
  trạng thái hồ sơ đối với riêng phần lịch. Tuyến `PUT /availability/me` chỉ gác theo **vai
  trò** (`PT` hoặc `ADMIN`), không gác theo trạng thái duyệt.
- Admin xem hồ sơ thì đọc từ `PTAvailability` — luôn là dữ liệu mới nhất.
- Các trường lịch trong `PTApplication` **giữ lại nhưng là dữ liệu lịch sử**, không đọc không
  ghi nữa. Không xoá cột để không mất hồ sơ cũ.

### ⚠️ `seedInitialAvailability` vẫn còn — khác đề bài

Đề bài yêu cầu **bỏ hàm** này. Thực tế nó vẫn nằm ở `availability.service.ts`, được đánh dấu
`@deprecated` và còn **một** nơi gọi: `getAvailableSlots()` gọi nó khi PT chưa có dòng
`PTAvailability` nào.

Lý do giữ: những PT được duyệt **trước khi** hệ thống `PTAvailability` ra đời không có dòng nào
cả, và bỏ hẳn nhánh này thì lịch của họ rỗng — khách không đặt được buổi nào. Đây là lối thoát
cho dữ liệu cũ, không phải một nguồn sự thật thứ hai: nó chỉ chạy khi nguồn thật **rỗng**, và
chỉ ghi một lần.

> **Việc còn lại:** khi chắc chắn mọi PT đang hoạt động đều đã có `PTAvailability`, xoá cả hàm
> lẫn lời gọi. Kiểm tra bằng: `SELECT count(*) FROM user_profiles p WHERE p."isPT" AND NOT
> EXISTS (SELECT 1 FROM pt_availability a WHERE a.pt_user_id = p."userId")`. Bằng 0 thì xoá được.

### Xung đột khi PT thu hẹp lịch

**Không chặn PT thu hẹp lịch rảnh.** Nhu cầu này chính đáng — PT có quyền đổi giờ làm việc.

| Việc | Xử lý |
|---|---|
| Có buổi `CONFIRMED` nằm ngoài khung giờ mới | Trả cảnh báo kèm **danh sách buổi bị ảnh hưởng**, nhưng **vẫn lưu** |
| Buổi đã xác nhận | **Tuyệt đối không tự động huỷ** |
| Đặt buổi mới | Chỉ được trong khung giờ mới |

**Vì sao không tự huỷ:** buổi đã xác nhận là một cam kết giữa hai người, và một trong hai người
không có mặt lúc hệ thống quyết định huỷ nó. Tự huỷ còn kéo theo công thức bồi thường
(`docs/money-flow.md` §5) — tức là **tự động chuyển tiền** vì một thao tác sửa lịch. Nếu PT
thật sự muốn bỏ các buổi đó, dùng luồng dời lịch ở §2.

---

## 2. Dời lịch hai phía

### Vòng đời

```
                    ┌──────────────────────────────► ACCEPTED
                    │        bên kia chấp nhận       (buổi đổi sang giờ mới,
                    │                                 vẫn CONFIRMED)
   PT hoặc khách    │
   đề xuất  ──►  PENDING ─────────────────────────► REJECTED
                    │        bên kia từ chối          (buổi GIỮ NGUYÊN giờ cũ)
                    │
                    ├─────────────────────────────► CANCELLED
                    │        người gửi rút lại        (buổi GIỮ NGUYÊN giờ cũ)
                    │
                    └─────────────────────────────► EXPIRED
                             quá giờ bắt đầu ban đầu  (buổi GIỮ NGUYÊN giờ cũ)
                             mà chưa ai trả lời
                             — tiến trình nền quét
```

**Buổi tập giữ nguyên `CONFIRMED` trong suốt quá trình.** Một đề xuất là *lời mời*, không phải
một thay đổi: tới khi bên kia đồng ý thì lịch cũ vẫn là thứ cả hai nợ nhau, và vẫn là giờ phải
có mặt.

### Toàn bộ quy tắc

| Quy tắc | Chi tiết |
|---|---|
| Trạng thái buổi | Chỉ áp dụng cho buổi đang `CONFIRMED` |
| Thời điểm gửi | Trước `scheduledStartAt`, **và cách giờ bắt đầu ít nhất 12 tiếng** |
| Thời gian đề xuất | Phải trong khung rảnh của PT, không chồng buổi khác — **dùng lại đúng `assertSlotBookable()` của `bookSession()`** |
| Lý do | **Bắt buộc**, tối đa 500 ký tự |
| Số lần tối đa | **2 lần dời đã được chấp nhận** cho mỗi buổi, tính cả hai phía |
| Chỉ một yêu cầu mở | Mỗi buổi tối đa một yêu cầu `PENDING` |
| Tự hết hạn | Quá `originalStartAt` mà chưa ai trả lời → `EXPIRED`, buổi giữ lịch cũ |
| Từ chối | Buổi **giữ nguyên** lịch cũ, không tự huỷ |
| Chấp nhận | Cập nhật `scheduledStartAt`/`scheduledEndAt`, giữ `CONFIRMED`, **không** đụng hạn mức buổi |
| Ai được trả lời | **Chỉ bên kia.** Người gửi không tự chấp nhận đề xuất của chính mình |

Vài chỗ đáng chú ý:

- **Ngưỡng 12 tiếng chặt hơn đề bài.** Đề bài chỉ yêu cầu "trước `scheduledStartAt`". Dời lịch
  trước giờ tập 10 phút thì bên kia gần như chắc chắn không kịp đọc, và một đề xuất không ai
  kịp trả lời chỉ có một kết cục là `EXPIRED` — tốn một lượt thương lượng mà không được gì.
- **Đếm số lần dời dựa trên `ACCEPTED`**, không phải tổng số đề xuất. Một đề xuất bị từ chối
  không làm buổi tập xê dịch, nên tính nó vào hạn mức là phạt người đề xuất vì bên kia nói không.
- **`originalStartAt` là ảnh chụp lúc đề xuất**, nên mốc hết hạn vẫn đúng ngay cả khi buổi đã
  bị một yêu cầu trước đó dời đi.

### Điểm cuối

| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| `POST` | `/sessions/:id/reschedule` | Đề xuất giờ mới |
| `PATCH` | `/sessions/:id/reschedule/:requestId` | Bên kia chấp nhận hoặc từ chối |
| `DELETE` | `/sessions/:id/reschedule/:requestId` | Người gửi tự rút lại |
| `GET` | `/sessions/:id/reschedule-history` | Lịch sử dời lịch, phục vụ phân xử tranh chấp |

### Tiến trình nền

`reschedule-expiry.service.ts`, mặc định 10 phút một lần (`RESCHEDULE_EXPIRY_INTERVAL_MS`).
Cùng khuôn mẫu với tiến trình tự duyệt buổi tập: có khoá chống chạy chồng, cập nhật có điều kiện
theo trạng thái hiện tại (`status: "PENDING"` trong mệnh đề `where` của lệnh ghi), và cô lập lỗi
theo lô.

Cập nhật có điều kiện là thứ ngăn việc ghi đè: ai đó có thể vừa trả lời trong khoảng giữa lúc
đọc và lúc ghi, và một yêu cầu **đã được trả lời không được biến thành `EXPIRED`**.

### 🔗 Liên hệ với công thức bồi thường

Cơ chế này cho phép PT xử lý bận đột xuất mà **không phải bồi thường**, vì buổi tập không bị huỷ
mà chỉ đổi giờ.

Nó **giảm trực tiếp** số trường hợp phải áp dụng công thức PT vắng buổi ở `docs/money-flow.md`
§5 — công thức đó trừ `ptRate × unit` khỏi ngăn chờ của PT, cộng `unit` vào ví khách, và
**giảm `totalSessions` đi 1**. Nói cách khác: mỗi lần dời lịch thành công là một lần PT không
mất một buổi và khách không phải nhận tiền thay cho buổi tập họ vốn muốn có.

Đó là lý do luồng dời lịch đáng làm cho tử tế thay vì để PT chỉ có nút huỷ.

---

## 3. Việt Nam áp dụng hai cấp hành chính — KHÔNG thêm bộ lọc cấp huyện

> **Đọc kỹ trước khi "sửa nhầm" thành ba cấp.**

Việt Nam đã chuyển sang **chính quyền địa phương hai cấp từ 01/7/2025**: cấp huyện bị bãi bỏ,
chỉ còn **Tỉnh/Thành phố → Phường/Xã**.

Thiết kế hiện tại dùng `provinceCode` + `wardCode` **là đúng với quy định hiện hành**. Ý kiến
"bộ lọc thiếu `districtCode` vì hành chính Việt Nam có 3 cấp" **không còn đúng**.

Bằng chứng ngay trong code: `PTTrainingLocation` có trường tên `legacyDistrictName` — chính
nhóm phát triển đã coi cấp huyện là dữ liệu lịch sử.

`legacyDistrictName` chỉ dùng để **hiển thị** địa chỉ cũ cho dễ nhận biết, **không** được dùng
làm tiêu chí lọc. Trong toàn hệ thống **không có tham số `districtCode` nào**.

---

## 4. Tìm kiếm và lọc

### Lọc chuyên môn — ở máy chủ

Tham số `specialties` (danh sách, hoặc chuỗi ngăn bởi dấu phẩy), lọc bằng phép giao trên mảng
`mainSpecialties` (`hasSome`).

Trước đây giao diện tải toàn bộ danh sách PT rồi lọc ở trình duyệt — càng nhiều PT càng chậm,
và **phân trang sai** vì lọc diễn ra sau khi đã cắt trang. Toàn bộ phần lọc ở trình duyệt đã bỏ.

### Tìm theo từ khoá `q`

Khớp **họ tên**, **tên phòng tập** (`PTTrainingLocation.gymName`) và **địa chỉ** (`addressLine`),
bỏ dấu tiếng Việt — gõ `california` ra được `California Fitness`.

Làm bằng SQL chứ không kéo hết PT vào bộ nhớ rồi lọc — đó đúng là sai lầm mà VĐ5.2 sinh ra để
sửa. Bỏ dấu bằng `translate()` **có sẵn trong Postgres**, không dùng `unaccent`: `unaccent` là
một extension phải cài trên mọi môi trường, mà thiếu extension thì truy vấn **âm thầm trả về
rỗng** thay vì báo lỗi.

> ⚠️ **Khác đề bài:** VĐ5.3 liệt kê cả chuyên môn trong phạm vi tìm kiếm, nhưng ô tìm kiếm
> **cố ý không khớp chuyên môn** (commit `10b1ba7`). Lý do: trang khám phá đặt một hàng chip
> chuyên môn ngay cạnh ô tìm kiếm, nên gõ chữ là cách chậm hơn để làm việc mà một cú bấm đã
> làm xong; và một ô tìm kiếm âm thầm khớp trên nhiều trường thì kết quả của nó **khó giải thích
> cho người dùng**. Tên phòng tập và địa chỉ ở lại vì không bộ lọc nào phủ chúng — *"PT ở
> California Fitness"* không có chỗ nào khác để diễn đạt.

### Kiểm tra tham số ở máy chủ

Gửi `wardCode` mà thiếu `provinceCode` → **`400`** kèm thông báo rõ ràng. Giao diện có ràng buộc
này nhưng máy chủ thì không — **không được tin dữ liệu từ giao diện**. `wardCode` không phải số
cũng là `400`.

---

## 5. Ưu tiên PT cùng phòng tập

### Nút thắt đã gỡ

`PTTrainingLocation.gymName` là chuỗi tự do, không có khoá ngoại tới bảng `Gym`, nên không xác
định được hai bên có cùng phòng tập hay không. Đã thêm khoá ngoại **`gymId` (cho phép rỗng)**.

`gymName` **giữ nguyên** dạng chữ tự do cho các phòng tập chưa có trên nền tảng — thực tế sẽ có
rất nhiều, không được ép PT phải chọn từ danh sách. Khi PT khai địa điểm: gợi ý chọn từ danh
sách phòng tập đã có; không thấy thì gõ tay và để `gymId` rỗng.

### Thứ tự sắp xếp

Áp dụng khi khách **không** chọn tiêu chí sắp xếp cụ thể (`applyRanking`):

| Hạng | Điều kiện | `matchReason` |
|---|---|---|
| 1 | PT có địa điểm dạy tại phòng tập khách đang là hội viên | `"SAME_GYM"` |
| 2 | PT cùng phường/xã với khách | `"SAME_WARD"` |
| 3 | PT cùng tỉnh/thành với khách | `"SAME_PROVINCE"` |
| 4 | Còn lại | `null` |

Trong cùng một hạng: điểm đánh giá giảm dần, **PT chưa có đánh giá xếp sau** — "chưa có đánh
giá" không phải "đánh giá tệ nhất".

**PT đã tắt nhận khách luôn xếp cuối cùng**, bất kể hạng nào. Họ vẫn đáng để đọc hồ sơ, chỉ là
không đáng xếp đầu.

Giao diện hiện nhãn **"Cùng phòng tập của bạn"** cho `SAME_GYM` — tín hiệu có giá trị cao với
khách đã trả tiền hội viên ở đó.

### Chịu lỗi: hỏng thì mất nhãn, không được sai nhãn

Lấy danh sách phòng gym của khách qua gym-service. Nếu gọi không được → **trả về tập rỗng**,
danh sách vẫn chạy, chỉ mất nhãn.

Đây là điểm **khác hẳn** với việc lấy tỷ lệ cộng tác lúc tạo hợp đồng, chỗ đó lỗi mạng phải trả
`503` và từ chối tạo hợp đồng (`docs/money-flow.md` §14.3). Khác biệt nằm ở **cái giá của việc
đoán sai**: ở đây là một cái nhãn thiếu, ở kia là **chia sai tiền của phòng gym**.

### Không làm phần toạ độ

Sắp xếp theo khoảng cách địa lý cần thêm toạ độ cho **cả** phòng tập **và** địa điểm dạy của PT,
cộng với một chỉ mục không gian — là một khối công việc riêng.

Ưu tiên "cùng phòng tập" trước vì đó là tín hiệu **mạnh hơn** khoảng cách đường chim bay: khách
đã trả tiền hội viên ở đó thì gần như chắc chắn muốn tập với PT tại đó, kể cả khi có PT khác gần
nhà hơn.

---

## 6. Nhật ký kiểm toán

Bảng `audit_logs` trong user-service (migration `20260811120000_add_audit_log`).

### Hai khác biệt có chủ đích so với `AuditLog` của auth-service

1. **Không có khoá ngoại tới `UserProfile`.** auth-service quan hệ log với `User` kèm
   `onDelete: Cascade` — đúng cho lịch sử đăng nhập, **sai ở đây**: xoá một hồ sơ sẽ xoá đúng
   phần bằng chứng mà tranh chấp về hồ sơ đó cần tới. `actorUserId` chỉ là chuỗi id.
2. **Cặp `entityType` + `entityId` thay cho một `userId` trần**, vì thứ được kiểm toán là một
   hợp đồng, một buổi tập hay một gói dịch vụ — không phải một con người.

### Những gì được ghi

| Thực thể | Hành động |
|---|---|
| `CONTRACT` | `CONTRACT_PENDING_SIGNATURE`, `CONTRACT_REJECTED`, `CONTRACT_CANCELLED`, `CONTRACT_TERMINATED` |
| `SESSION` | `SESSION_RESCHEDULE_REQUESTED` / `_ACCEPTED` / `_REJECTED` / `_WITHDRAWN` / `_EXPIRED` |
| `SERVICE_PACKAGE` | `_CREATED`, `_UPDATED`, `_ARCHIVED` — xem `docs/pt-service-packages.md` §8 |
| `PT_PROFILE` | `PT_ACCEPTING_CLIENTS_ON` / `_OFF` |

Mỗi bản ghi chuyển trạng thái hợp đồng ghi **cả trạng thái đi ra**, không chỉ trạng thái đi vào.
Nửa "từ đâu" mới làm dòng ghi có ích: *"đã huỷ"* một mình không nói được khách bỏ ngang một hợp
đồng đang chạy đã trả tiền, hay từ chối một hợp đồng còn chờ ký — hai câu chuyện rất khác nhau.

Với dời lịch, bản ghi có `originalStartAt` và `effectiveStartAt`. Trên nhánh từ chối,
`effectiveStartAt` **bằng giờ cũ** — nói thẳng ra thay vì để người đọc tự suy từ tên hành động.

### Ba quy ước

- **Ghi log hỏng không được làm hỏng thao tác đang kiểm toán.** Từ chối dời lịch vì không ghi
  được một dòng log là biến vấn đề sổ sách thành sự cố dịch vụ.
- **Nhưng không nuốt lặng.** Một dấu vết biến mất âm thầm còn tệ hơn không có dấu vết, vì nó
  được tin trong khi đang khuyết. Lỗi ghi rơi vào log mức `error` kèm nguyên payload đã mất.
- **Chỉ ghi thao tác GHI.** Không kiểm toán thao tác đọc — bảng sẽ đầy nhiễu và tín hiệu thật
  ("giờ này đã bị đổi, bởi người kia, lúc đó") bị chôn mất.

**Actor của tiến trình nền là `SYSTEM`** (hằng `SYSTEM_ACTOR`), không phải `null`: "không ai" và
"hệ thống" là hai câu trả lời khác nhau cho câu hỏi *ai đã làm việc này*, và ở đây chỉ một câu
là đúng.

### 📌 Chưa ghi IP và user-agent ở tầng service

Hai cột `ipAddress`/`userAgent` **có** trong bảng và **được điền** ở hai chỗ ghi log từ
controller (`CONTRACT_TERMINATED`, `PT_ACCEPTING_CLIENTS_*`), nhưng **rỗng** ở những chỗ ghi từ
tầng service.

Lý do: ghi ở tầng service bảo đảm **mọi lối vào đều được phủ**, bất kể tuyến nào gọi tới; luồn
`req` xuống chừng chục chữ ký hàm service chỉ để lấy hai trường phụ là một thay đổi lan rộng
đổi lấy rất ít. Bốn dữ kiện quan trọng — ai, làm gì, trên cái gì, lúc nào — đều đã đủ.

---

## 7. Những gì CHƯA làm

- **Sắp xếp theo khoảng cách địa lý.** Cần toạ độ cho phòng tập và địa điểm dạy, cộng chỉ mục
  không gian. Xem §5.
- **Xoá `seedInitialAvailability`.** Còn lại vì dữ liệu PT cũ. Điều kiện để xoá ở §1.
- **Thông báo đẩy khi đề xuất dời lịch tự hết hạn.** Tiến trình nền đổi trạng thái và ghi
  `AuditLog`, nhưng không báo cho hai bên. Họ chỉ biết khi mở lại buổi tập.

---

## 8. Quyết định phát sinh

**Ô tìm kiếm không khớp chuyên môn** — khác VĐ5.3. Lý do đầy đủ ở §4.

**Ngưỡng 12 tiếng cho đề xuất dời lịch** — chặt hơn đề bài. Lý do ở §2.

**`seedInitialAvailability` chưa xoá** — khác VĐ3 mục 4. Lý do và điều kiện xoá ở §1.

**Đếm số lần dời theo yêu cầu `ACCEPTED`** thay vì tổng số đề xuất. Đề bài viết "2 lần dời cho
mỗi buổi, tính cả hai phía"; cách hiểu đã chọn là *hai lần buổi tập thật sự xê dịch*. Đề xuất bị
từ chối không dời được gì, nên tính nó vào hạn mức là phạt người đề xuất vì bên kia nói không.

**Thông báo dời lịch từng chết âm thầm.** Cả hai chỗ gọi `notificationService.create` dùng
`eventType: "SESSION_UPDATE"` — một giá trị **không có trong enum `NotificationEventType`** —
nên Prisma từ chối mọi dòng và `.catch(console.error)` nuốt lỗi. Hệ quả: *"PT đề xuất giờ mới →
khách nhận thông báo"* chưa bao giờ chạy. Đã đổi sang `SESSION_RESCHEDULE_REQUESTED` /
`_ACCEPTED` / `_REJECTED` (các giá trị vốn đã có sẵn trong enum từ đầu), và kiểm chứng bằng
cách chạy thật luồng đề xuất → chấp nhận rồi đọc bảng `notifications`.

**Hai luồng đếm slot lấy mốc bắt đầu khác nhau** — chi tiết ở `docs/pt-service-packages.md` §9.
