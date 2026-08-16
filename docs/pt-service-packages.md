# Gói dịch vụ của PT, ảnh chụp giá, và cảnh báo lịch trống

Tài liệu bàn giao Phase 1. Ai sắp sửa code liên quan tới **giá gói, tạo hợp đồng, hay con số
slot trống hiện cho khách** thì đọc hết file này trước.

| | |
|---|---|
| Model gói | `user-service/prisma/schema.prisma` — `PTServicePackage` |
| Nghiệp vụ gói | `user-service/src/services/pt_service_package.service.ts` |
| Ảnh chụp giá | `contract.service.ts` — `buildPackageSnapshot()` |
| Đếm slot | `availability.service.ts` — `countSlotsFromRows()` |
| Di trú | `user-service/src/scripts/migrate-pt-service-packages.ts` |
| Kiểm thử ảnh chụp | `src/__tests__/contract-price-snapshot.test.ts` (7 test) |
| Kiểm thử đếm slot | `src/__tests__/slot-counting.test.ts` (14 test) |

Chạy kiểm thử:

```bash
cd backend/services/user-service && npm test
```

---

## 1. Hệ thống có HAI khái niệm "gói" — không được gộp

Đây là nguồn nhầm lẫn chính của cả phase.

| | Gói **kế hoạch tập** | Gói **dịch vụ PT** |
|---|---|---|
| Model | `TrainingPackage` (ai-service) | `PTServicePackage` (user-service) |
| Bán cái gì | **Nội dung** — một kế hoạch tập soạn sẵn | **Dịch vụ** — số buổi PT kèm cặp trực tiếp |
| Mua xong nhận gì | Quyền xem kế hoạch | Hợp đồng có hạn mức buổi, ràng buộc, hoàn tiền |
| Ai bán | Bất kỳ ai xuất bản kế hoạch | Chỉ PT đã được duyệt |
| Đường dẫn | `/marketplace/plans` | `/profile/me/service-packages` |
| Dính tới tiền hợp đồng | ❌ | ✅ — xem `docs/money-flow.md` |

Nhãn ở chợ kế hoạch đã đổi thành **"Bán kế hoạch tập"** để không lẫn với gói buổi coaching
(commit `c964361`).

---

## 2. Ảnh chụp giá vào hợp đồng

### Quy tắc

Khi khách mua, `Contract` **sao chép** các giá trị dưới đây từ `PTServicePackage`, **không**
tham chiếu động:

```
packageId              ← chỉ để tra cứu nguồn gốc
packageName            ← ảnh chụp tên
price                  ← ảnh chụp giá
totalSessions          ← ảnh chụp số buổi
sessionMode            ← ảnh chụp
sessionDurationMinutes ← ảnh chụp
```

Cài đặt gom vào **một hàm thuần tuý** `buildPackageSnapshot(pkg)`.

### Vì sao là một hàm riêng, và vì sao nó chỉ nhận `pkg`

Đây là tính chất **bảo mật**, không phải sở thích trình bày. Hàm không có tham số nào mang
được thân yêu cầu của khách vào, nên **không có sửa đổi tương lai nào lỡ tay tin nó được**.

Khách tự khai `price` là lỗ hổng kinh điển: gói 10 buổi bị mua với giá một đồng. Nếu để lời gọi
`contractRepository.create` đọc trực tiếp từ `data`, chỉ cần một lần copy-paste là thủng.

### Vì sao là bản sao chứ không phải tham chiếu

PT có quyền đổi giá hoặc lưu trữ gói bất cứ lúc nào. Hợp đồng đã ký **không được đổi theo** —
khách đã đồng ý một con số, bên bán không được sửa nó về sau từ phía nào cả.

Đây **cùng một nguyên tắc** với việc khoá bảng tỷ lệ chia hoa hồng tại thời điểm ký
(`docs/money-flow.md` §12). Hai chỗ dùng chung một lý lẽ: *cái gì hai bên đã thoả thuận thì
đóng băng tại thời điểm thoả thuận*.

### Ghi chú về kiểu số

`price` được thu về `number` vì đó là kiểu `contractRepository.create` nhận. **An toàn có căn
cứ, không phải may mắn**: cột là `Decimal(14,2)`, giá trị lớn nhất biểu diễn được là `10^12` với
hai chữ số thập phân — tức `10^14` đơn vị nhỏ nhất, nằm gọn trong khoảng số nguyên mà `double`
biểu diễn chính xác (`2^53 ≈ 9×10^15`).

Có một test ghim đúng biên này (`999999999999.99` và `0.01`), nên nếu ai nới cột rộng ra thì
test **vỡ ầm ĩ** thay vì âm thầm làm tròn hợp đồng của người ta.

> ⚠️ Mọi **phép tính** trên tiền vẫn phải nằm ở payment-service và dùng `Decimal`. Chỗ này chỉ
> là chép nguyên xi, không phải tính toán.

---

## 3. Đếm slot trống

### Công thức

`countSlotsFromRows()` — hàm thuần tuý, nhận dữ liệu đã đọc sẵn từ CSDL:

```
Với mỗi ngày D trong [fromDate, toDate]:
   nếu D nằm trong PTScheduleException  → bỏ qua cả ngày
   ngược lại, với mỗi PTAvailability khớp thứ của D và isActive:
        chia [startTime, endTime] thành các khối sessionDurationMinutes
        khối nào chưa có buổi REQUESTED/CONFIRMED trùng giờ → +1
```

| Yếu tố bị trừ | Nguồn |
|---|---|
| Ngày nghỉ ngoại lệ | `PTScheduleException` — trừ **trọn ngày** |
| Buổi đã đặt | `Session` ở trạng thái `REQUESTED` hoặc `CONFIRMED` |
| Khối lịch đã tắt | `PTAvailability.isActive = false` |
| Phần lẻ cuối khối | Không đủ một buổi thì không tính (09:00–17:30, buổi 60′ → 8 slot, không phải 8,5) |

**Cửa sổ mặc định 28 ngày**, hằng số `availabilityService.SLOT_LOOKAHEAD_DAYS`. Chọn 4 tuần vì
đủ dài để có tín hiệu, đủ ngắn để lịch PT còn tương đối ổn định.

### Hiệu năng

Ba truy vấn gom cho **cả trang**, không phải 3N. Danh sách 20 PT vẫn là ba truy vấn.
Chưa dùng Redis — ở quy mô hiện tại ba truy vấn đã đủ nhanh; nếu đo thấy chậm thì thêm đệm
được mà không đổi giao diện hàm.

### 🐛 Lỗi múi giờ — đọc kỹ trước khi sửa chỗ này

Bản cũ khoá ngày bằng `toISOString().slice(0, 10)` (**giờ UTC**) trong khi lấy thứ bằng
`getDay()` và giờ bằng `getHours()` (**giờ địa phương**). Container chạy `TZ=Asia/Ho_Chi_Minh`
(commit `78a3702`), nên nửa đêm địa phương ngày 12 là **17:00 UTC ngày 11** — hai vế lệch nhau
đúng một ngày.

Hậu quả **không phải** "bỏ qua buổi đã đặt", mà là **trừ nhầm sang ngày hôm sau**:

| Tình huống | Bản cũ | Đúng ra |
|---|---|---|
| Buổi đặt ngày **thứ Sáu** | Đẩy sang thứ Bảy — ngày PT không làm việc — **biến mất hoàn toàn** | Trừ 1 |
| Buổi đặt **ngay trước ngày nghỉ** | Đẩy vào ngày nghỉ, ngày đó bị bỏ qua → **biến mất** | Trừ 1 |
| Buổi đặt **đúng ngày nghỉ** | Đẩy sang ngày làm việc kế tiếp → **trừ nhầm một slot đang trống thật** | Không trừ gì thêm |
| Buổi đặt giữa tuần | Đẩy sang hôm sau; **tổng vô tình đúng** nhưng sai ngày | Trừ 1 đúng ngày |

Nghĩa là PT kín lịch thứ Sáu vẫn quảng cáo thứ Sáu còn trống. Con số này gác cửa hộp thoại cảnh
báo lúc mua, nên sai ở đây là khách mua nhầm.

**Cách sửa:** hàm `localDateKey()` đọc `getFullYear/getMonth/getDate`, cùng đồng hồ với
`getDay()` và `getHours()`. Nguyên tắc chung: **thứ gì so sánh ngày theo lịch treo tường thì
phải đọc cùng một đồng hồ với thứ đọc giờ.**

Bộ test dựng `Date` bằng hàm tạo giờ địa phương nên **đúng ở mọi múi giờ**, không chỉ UTC+7.

---

## 4. Ba lớp cảnh báo lịch trống

**Không chặn cứng.** Slot sẽ trống dần theo thời gian; chặn cứng là chặn nhầm những hợp đồng
hoàn toàn khả thi.

| Lớp | Cơ chế | Vì sao |
|---|---|---|
| **1** | Công tắc `isAcceptingClients` trên `UserProfile` | PT tự biết năng lực của mình rõ hơn mọi thuật toán — hiệu quả nhất so với công sức |
| **2** | `availableSlotsNext28Days` trả kèm hồ sơ và danh sách PT | Cho khách con số trước khi quyết định |
| **3** | Hộp thoại xác nhận khi `slot < sessionCount` | Chỉ hỏi khi thật sự có rủi ro |

Chi tiết từng lớp:

- **Lớp 1.** PT tắt nhận khách → ẩn nút mua, hiện nhãn *"Tạm ngưng nhận khách mới"*. **Vẫn hiện
  trong kết quả tìm kiếm** nhưng xếp cuối — khách vẫn cần xem được hồ sơ. Hợp đồng đang chạy
  không bị ảnh hưởng.
- **Lớp 3.** Máy chủ trả `409` kèm mã `LOW_AVAILABILITY`, `availableSlots`, `packageSessions` —
  **không phải** tạo hợp đồng thành công. Giao diện hiện hộp thoại rồi gửi lại kèm
  `acknowledgedLowAvailability: true`.

**Lưu bằng chứng đã cảnh báo:** `Contract.lowAvailabilityWarned` và `Contract.slotsAtPurchase`.
Dùng khi phân xử tranh chấp kiểu *"mua rồi không tập được"*. Cùng khuôn mẫu với
`multiGymWarned` ở gói hội viên (`docs/money-flow.md` §13.7).

---

## 5. Kết quả di trú

Chạy lại lúc bàn giao (`npx tsx src/scripts/migrate-pt-service-packages.ts`):

```
Tìm thấy 12 PT đang hoạt động.
  PT đã có gói, bỏ qua : 5
  Gói sẽ tạo           : 0
  PT không sinh được   : 7
```

**Ba nhánh của script**, theo đúng đề bài:

1. Có `offlinePackagePrice` → tạo gói `OFFLINE`
2. Có `onlinePackagePrice` → tạo thêm gói `ONLINE`
3. Chỉ có `packagePrice` → tạo một gói theo `serviceMode` của PT

Tên tự sinh `"Gói {sessionCount} buổi"`, `isActive = true`, `sessionsPerPackage` rỗng thì mặc
định 10 buổi.

**Idempotent:** PT đã có gói chưa lưu trữ thì bỏ qua. Chạy lại sau lỗi giữa chừng **không nhân
đôi gói của ai** — đã kiểm chứng bằng cách chạy lại và thấy tạo 0 gói.

### 7 PT không sinh được gói — và vì sao

Cả bảy đều **không có bản ghi `PTApplication`**, nên không có giá nào để chuyển. Script **nêu
đích danh từng người** thay vì lặng lẽ bỏ qua, đúng yêu cầu.

Nguyên nhân gốc: sự cố `prisma db push --accept-data-loss` mô tả ở commit `5219cc8` đã **làm
rỗng bảng `pt_applications`** (hiện chỉ còn 3 dòng cho 12 PT). Đây là **mất dữ liệu có thật**,
không phải thiếu sót của script.

> ⚠️ **Việc còn lại cho người vận hành.** Bảy PT này hiện **không bán được gì** — họ biến mất
> khỏi luồng bán hàng đúng như đề bài cảnh báo. Không có cách nào tự khôi phục vì giá gốc đã mất.
> Phải hoặc nhờ từng PT khai lại gói qua giao diện, hoặc phục hồi `pt_applications` từ bản sao
> lưu trước sự cố rồi chạy lại script.

---

## 6. Điểm cuối

| Phương thức | Đường dẫn | Ai gọi |
|---|---|---|
| `GET` | `/profile/me/service-packages` | PT xem gói của mình, gồm cả gói đã lưu trữ |
| `POST` | `/profile/me/service-packages` | PT tạo gói |
| `PATCH` | `/profile/me/service-packages/:id` | PT sửa gói |
| `DELETE` | `/profile/me/service-packages/:id` | Lưu trữ gói (xoá mềm) |
| `GET` | `/profile/pts/:ptUserId/service-packages` | Khách xem gói đang bán — **chỉ `isActive` và chưa lưu trữ** |

⚠️ **Tiền tố `/profile` là bắt buộc khi đi qua gateway.** user-service mount bộ tuyến này ở
**hai** chỗ — `app.use("/me/service-packages", ...)` trong `app.ts` và một lần nữa trong
`profile.routes.ts` — nhưng gateway **chỉ proxy `/profile`**. Gọi thẳng `/me/service-packages`
qua cổng 3000 trả `404`. Bản mount trong `app.ts` hiện **không tuyến nào ngoài chạm tới được**.

---

## 7. Ràng buộc nghiệp vụ

- `sessionCount >= 1`, `price > 0`
- `sessionMode` không nhận `HYBRID` — chỉ `ONLINE` hoặc `OFFLINE`
- `sessionDurationMinutes` trong khoảng 15–240
- Tối đa **10 gói chưa lưu trữ** mỗi PT — tránh làm rối giao diện khách
- **Không xoá cứng**, chỉ đặt `archivedAt`, vì hợp đồng cũ còn tham chiếu `packageId`
- Gói đã lưu trữ **không sửa được** nữa

---

## 8. Nhật ký kiểm toán

Ba thao tác trên gói đều ghi `AuditLog` (bảng `audit_logs` của user-service):

| Hành động | Ghi kèm |
|---|---|
| `SERVICE_PACKAGE_CREATED` | tên, giá, số buổi, hình thức |
| `SERVICE_PACKAGE_UPDATED` | **chỉ những trường thật sự đổi**, dạng `{before, after}` |
| `SERVICE_PACKAGE_ARCHIVED` | tên, có hợp đồng đang tham chiếu hay không |

`SERVICE_PACKAGE_UPDATED` chỉ ghi phần thay đổi, vì ghi cả dòng mỗi lần sửa sẽ **chôn một lần
đổi giá giữa hàng chục giá trị không đổi**. Đổi giá chính là bằng chứng mà tranh chấp về ảnh
chụp giá cần tới.

Chi tiết mô hình `AuditLog`: xem `docs/pt-scheduling-and-discovery.md` §6.

---

## 9. Quyết định phát sinh

Ghi lại những chỗ khác với đề bài, kèm lý do — **không sửa lặng lẽ**.

**Không dùng Redis để đệm số slot.** Đề bài yêu cầu "gom truy vấn **hoặc** lưu đệm Redis 5
phút". Đã chọn vế đầu: ba truy vấn gom cho cả trang thoả yêu cầu "số truy vấn không tăng tuyến
tính theo số PT" mà không thêm một tầng đệm nữa — mà đệm thì lại kéo theo câu hỏi làm mất hiệu
lực lúc nào khi PT vừa đổi lịch.

**`countAvailableSlotsForPT` tách khỏi phần đọc CSDL.** Phần số học nằm ở
`countSlotsFromRows()`, thuần tuý và test được bằng dữ liệu cố định. Không tách thì lỗi múi giờ
ở §3 vẫn còn nguyên tới hôm nay — nó chỉ lộ ra khi có test ghim từng ngày cụ thể.

**Luồng khám phá đếm slot từ thời điểm gọi, không từ nửa đêm.** `enrichForDiscovery` truyền
`new Date()` làm `fromDate`, nên ngày đầu tiên chỉ tính phần còn lại của hôm nay. Hợp lý cho
danh sách (không mời khách đặt vào giờ đã trôi qua), nhưng **khác** với
`countAvailableSlotsForPT` dùng ở luồng tạo hợp đồng — hàm đó lùi về nửa đêm địa phương. Hai
con số có thể lệch nhau trong phạm vi một ngày. Chưa hợp nhất vì mỗi bên đang đúng với mục đích
của mình; nếu sau này khách thắc mắc "sao trang danh sách ghi khác trang mua" thì đây là chỗ cần
xem.

**Các trường giá trong `PTApplication` giữ nguyên, không xoá.** Chúng trở thành **thông tin
tham khảo lúc nộp hồ sơ**, không còn là nguồn sự thật. Giữ lại để không mất lịch sử hồ sơ.
