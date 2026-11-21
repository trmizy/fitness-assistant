# Gymini — Sổ tay dự án (HANDBOOK)

> Tổng hợp ngày 17/11/2026 từ ~640 báo cáo, kế hoạch và sổ lỗi cũ. Mục lục toàn bộ thư mục: [`docs/README.md`](README.md).
> **Mã nguồn, migration và kết quả test mới chạy luôn có thẩm quyền cao hơn tài liệu này.**
> Bản gốc của tài liệu cũ được lưu trữ ngoài repo trên máy chủ dự án (hỏi chủ dự án nếu cần).
> Repo GitHub công khai: chi tiết lỗ hổng bảo mật chưa vá, credential và bằng chứng nội bộ KHÔNG ghi vào đây.

## 1. Cách dùng sổ tay

| Muốn biết | Đọc |
| --- | --- |
| Dự án là gì, chạy thế nào | `README.md` ở gốc repo |
| Luật nghiệp vụ (tiền, hợp đồng, khiếu nại, quyền) | Mục 2 |
| Kiến trúc, môi trường dev, triển khai, bẫy thường gặp | Mục 3 |
| Lỗi/việc còn mở, quyết định đang chờ | Mục 4 |
| Tài liệu nghiên cứu, runbook, giấy phép | [`docs/README.md`](README.md) |

Nguyên tắc giữ tài liệu gọn:

- Mọi file `.md` của dự án nằm trong `docs/` (ngoài các `README.md` cạnh mã). Hook pre-commit chặn `.md` ở chỗ khác.
- Cập nhật sổ tay này thay vì viết báo cáo mới cho mỗi phiên.
- Ghi chú chỉ dùng local đặt tên `*.local.md` (bị `.gitignore`, hook chặn commit).
- Bằng chứng test của một đợt để ngoài repo; khi đợt đóng, chuyển kết luận vào mục 4.
- Việc đã sửa và xác minh thì xoá khỏi mục 4.
- Nhãn bằng chứng dùng đúng loại: `REAL BROWSER` · `REAL HTTP/API` · `BACKEND INTEGRATION` · `TEST FIXTURE` · `CODE AUDIT`.


## 2. Luật nghiệp vụ

> Nguyên tắc đọc: **mã là nguồn sự thật**. Mọi con số dưới đây đã đối chiếu với mã trong `backend/services/*/src` trừ khi có ghi chú "(chưa đối chiếu mã)". Cổng thanh toán đang chạy thật: **chỉ VNPay và ZaloPay** (MoMo, PayOS đã ngừng ngày 11/11/2026; giá trị enum `MOMO`/`PAYOS`/`MOCK`/`STRIPE`/`MANUAL_BANK_TRANSFER` vẫn nằm trong `PaymentProviderType` để giữ lịch sử, nhưng `payment-service/src/providers/` chỉ còn `vnpay.provider.ts` và `zalopay.provider.ts`).

### 2.1 Vai trò và quyền

| Vai trò | Là ai | Ghi chú nghiệp vụ |
|---|---|---|
| `CUSTOMER` (Client) | Người tập | Mua hợp đồng PT, gói hội viên gym, dịch vụ cá nhân hoá. Ví khách **không nạp tiền** (`POST /wallet/topup` trả 410 `TOPUP_REMOVED`); chỉ nhận hoàn tiền/bồi thường. |
| `PT` | Huấn luyện viên đã được duyệt hồ sơ | Phải xác nhận điều khoản PT (§2.11) trước khi nhận hợp đồng mới. |
| `GYM_OWNER` | Tài khoản đối tác phòng gym | Vai trò hệ thống duy nhất của mọi tài khoản đối tác; quyền chi tiết do gym-service quyết (mục dưới). `GYM_STAFF` đã bị xoá hẳn, **không được thêm lại**. |
| `ADMIN` | Quản trị viên | Chỉ **một cấp** vai trò; tách quyền bằng quy tắc "bốn mắt" ở những chỗ có tiền (§2.6, §2.7). |

**Vai trò nội bộ trong một đối tác gym** (`PartnerAccountRole`, chỉ gym-service biết; auth-service không có khái niệm này): `OWNER`, `MANAGER`, `RECEPTIONIST` (lễ tân), `ACCOUNTANT` (kế toán). Danh mục quyền nằm ở một chỗ duy nhất `backend/services/gym-service/src/services/partner-permissions.ts`; mặc định **từ chối**; ranh giới một câu: **tiền và người chỉ chủ sở hữu**.

| Nhóm việc | OWNER | MANAGER | RECEPTIONIST | ACCOUNTANT |
|---|---|---|---|---|
| Sửa thương hiệu/chi nhánh/gói, mời-thu hồi tài khoản, cộng tác PT, rút tiền, đóng cửa vĩnh viễn, quản lý tin đăng | có | không | không | không |
| Xem chi nhánh, gói + giá | có | có | chi nhánh (rút gọn) | có |
| Hội viên đầy đủ, danh sách check-in, check-in PT, đóng cửa tạm | có | có (theo chi nhánh được gán) | không | không |
| Quầy lễ tân: khách hôm nay (chỉ tên hiển thị), tra hội viên rút gọn, check-in hộ sau khi xác minh danh tính (OTP email / đối chiếu ảnh + mã hội viên / ngoại lệ do quản lý duyệt) | có | có | có | không |
| Xem ví, yêu cầu rút (che số tài khoản), xuất CSV, tổng hoa hồng PT (không theo từng PT) | có | không | không | có (không thấy danh tính hội viên) |

- Bất biến (ràng buộc DB): mỗi đối tác đúng **1 OWNER ACTIVE**; MANAGER bắt buộc có ≥1 chi nhánh được gán; một `userId` thuộc tối đa 1 đối tác; 1 đối tác = 1 thương hiệu = 1..N chi nhánh.
- Chuyển quyền chủ sở hữu phải ghi lại `Gym.ownerId` và `GymBrand.ownerId` trong **cùng một transaction** (hai cột này trỏ tới owner hiện tại).
- **PT chỉ coaching client khi** hợp đồng `ACTIVE` đúng cặp (PT, client), kiểm lại mỗi request, không có "grandfathering". PT được: xem tóm tắt/tiến độ/roadmap, tạo **bản nháp** roadmap (client phải tự kích hoạt), tạo-giao giáo án thủ công, duyệt/từ chối/sửa đề xuất dinh dưỡng. PT **không bao giờ**: kích hoạt/đẩy/archive roadmap, ghi đè quyết định `CycleAssessment`, tạo `NutritionGoal` vòng qua luồng review, đọc dữ liệu client của PT khác, tự cung cấp thiết bị tập của client.
- Danh tính (`userId`/`clientId`) luôn lấy từ token đã xác thực, không tin body; mọi thao tác PT/coach phải kiểm lại quan hệ thật ở server.

### 2.2 Mô hình nào sở hữu dữ liệu nào

Không tạo nguồn sự thật thứ hai cho bất kỳ mục nào dưới đây.

| Mô hình | Sở hữu |
|---|---|
| `UserProfile` | Bối cảnh nhân khẩu/hồ sơ người dùng |
| InBody / số đo | Trạng thái cơ thể đã đo |
| `FitnessRoadmap` | Hành trình dài hạn |
| `RoadmapPhase` | Một giai đoạn chiến lược |
| `TrainingCycle` | Một khối thực thi/đánh giá |
| `WorkoutProgram` | Đơn thuốc tập luyện |
| `WorkoutSchedule` | Lịch thực thi thuộc chu kỳ (liên kết thật giữa chương trình và chu kỳ; `TrainingCycle.planId` không bao giờ được ghi) |
| `Exercise.id` | Danh tính bài tập chuẩn |
| `NutritionGoal` | Calo/macro có thẩm quyền |
| `NutritionProgram` | Thực đơn thực thi, sinh từ một `NutritionGoal` qua `sourceGoalId` |
| `CycleAssessment` | Thẩm quyền quyết định thích nghi (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD) |
| `RecommendationAudit` / `CoachClientActionAudit` | Dấu vết kiểm toán/nguồn gốc |
| Forecast (`fitness-roadmap-forecast.engine.ts`) | Chỉ là kịch bản không ràng buộc, không bao giờ ghi đè số đo thật |

Mô hình tiền/hợp đồng: **user-service sở hữu hợp đồng và buổi tập; payment-service sở hữu sổ cái và mọi công thức tiền** (`contract-money.ts`). user-service không tự tính một con số tiền nào, chỉ gửi bảng tỷ lệ đã đóng băng và ghi lại kết quả. Hồ sơ khiếu nại (Case) chỉ là lớp bọc đọc/điều phối, không phải nguồn sự thật của trạng thái buổi, ví hay nghĩa vụ.

### 2.3 Hợp đồng PT và buổi tập

**Giá và gói.** Gói dịch vụ PT (`PTServicePackage`, user-service) khác hẳn gói kế hoạch tập (`TrainingPackage`, ai-service: bán nội dung). Khi khách mua, `Contract` **sao chép** (không tham chiếu) `packageName`, `price`, `totalSessions`, `sessionMode`, `sessionDurationMinutes` qua hàm thuần `buildPackageSnapshot(pkg)` — không nhận body của khách nên không thể bị khách tự khai giá. Ràng buộc gói: `sessionCount ≥ 1`, `price > 0`, `sessionMode` chỉ ONLINE/OFFLINE, 15–240 phút/buổi, tối đa **10 gói chưa lưu trữ**/PT, không xoá cứng (chỉ `archivedAt`). Từ khi có workflow Tin đăng (§2.10) các route tạo/sửa/xoá gói trực tiếp trả 409 `LISTING_REVIEW_REQUIRED`; gói đổi qua bản sửa có duyệt.

**Vòng đời trạng thái hợp đồng:** `PENDING_REVIEW → (PT nhận) PENDING_PAYMENT → (thanh toán) ACTIVE → COMPLETED/EXPIRED/CANCELLED`; còn `REJECTED`. `PENDING_SIGNATURE` chỉ tồn tại khi bật e-sign.
- **Hạn thanh toán: 12 giờ kể từ lúc PT nhận** (`CONTRACT_PAYMENT_DEADLINE_HOURS`, mặc định 12); quá hạn tự huỷ, khách phải tạo yêu cầu mới.
- **Ký điện tử đang tắt:** môi trường dev/E2E/scale đặt `REQUIRE_CONTRACT_ESIGN=false` nên hợp đồng đi thẳng `PENDING_PAYMENT`; route webhook Dropbox Sign không được đăng ký khi cờ tắt. Mặc định trong mã (khi biến không đặt) là **bật** — phải đặt `false` tường minh ở môi trường chạy.
- Khách có tối đa **2 PT khác nhau cùng lúc** (đếm hợp đồng `PENDING_REVIEW/PENDING_SIGNATURE/PENDING_PAYMENT/ACTIVE`, **không** tính MARKETPLACE) → vượt trả 409 `CLIENT_PT_LIMIT_REACHED` (`MAX_LIVE_PTS_PER_CLIENT = 2`).
- Cảnh báo lịch trống ít (không chặn cứng): máy chủ trả 409 `LOW_AVAILABILITY` kèm `availableSlots`/`packageSessions` khi slot 28 ngày tới < số buổi gói; client gửi lại với `acknowledgedLowAvailability: true`; bằng chứng lưu ở `Contract.lowAvailabilityWarned`/`slotsAtPurchase`. PT tắt `isAcceptingClients` thì ẩn nút mua (vẫn xếp cuối danh sách), không ảnh hưởng hợp đồng đang chạy.
- **Quyền lợi buổi:** `totalSessions` và `price` **bất biến sau khi ký**. Còn lại = `max(0, totalSessions − usedSessions − compensatedSessions)` (hàm duy nhất `getRemainingEntitlements` ở `contract.service.ts`). PT vắng buổi → `compensatedSessions += 1` (**không** giảm `totalSessions`). Hợp đồng còn có `extraSessions` (buổi tặng thêm).
- Điều kiện hợp đồng có gym: phải có hợp tác PT–gym `ACCEPTED` (§2.9) — gym gọi lỗi mạng thì **503, không tạo hợp đồng** (không bao giờ rơi về tỷ lệ độc lập); gym không hợp tác → 400; `sessionMode=ONLINE` kèm `gymId` → 400. Kiểm lại gym **lúc PT nhận và lúc khách thanh toán**; tỷ lệ đổi giữa chừng thì từ chối (`GYM_TERMS_CHANGED`), không tự sửa. Gói OFFLINE tại gym đòi khách có **gói hội viên còn hạn bao phủ thời hạn hợp đồng** tại thương hiệu của chi nhánh (`MEMBERSHIP_REQUIRED`), chặn ngay khi gửi yêu cầu.
- **Bảng tỷ lệ** `platformRate + ptRate + gymRate = 1` (so sánh tuyệt đối bằng `Decimal`); `platformRate ≥ 0,10` (`MIN_PLATFORM_RATE`); `gymRate = 0` nếu ONLINE/không gắn gym; độc lập mặc định **90/10/0**. Tỷ lệ **đóng băng** lên hợp đồng và vào metadata giao dịch lúc checkout — đổi tỷ lệ sau đó không ảnh hưởng hợp đồng cũ.
- Quyền chấm dứt (`POST /contracts/:id/terminate`): lý do quyết định ai chịu thiệt nên **không tin giá trị người gọi gửi** (PT không được tự khai `MUTUAL`).

| Lý do chấm dứt | Hoàn khách | Ai được khai |
|---|---|---|
| `CLIENT_CANCELLED` | `0,90 × remaining` (`CONTRACT_CLIENT_CANCEL_REFUND_RATE`) | khách, admin |
| `PT_BANNED` | 100% `remaining` | chỉ admin |
| `PT_CANCELLED` | 100% `remaining` (không phạt PT; holdback đang tắt) | PT, admin |
| `MUTUAL` | 100% `remaining` | chỉ admin |
| `EXPIRED` / `COMPLETED` | 0 | hệ thống quét hạn / admin |
| `PT_REPEATED_NO_SHOW` | như lỗi PT (khách tự chấm dứt sau 3 lần PT vắng) | khách |
| `CLIENT_EXIT_DUE_TO_PT_RESTRICTION` | 100% `remaining`, không phí, không bồi thường, PT không có lỗi | **server tự thay** khi PT đang bị hạn chế (§2.8); client vẫn gửi `CLIENT_CANCELLED` |

Phạt tính trên `remaining` (phần chưa dùng) chứ không trên tổng giá: phạt cố định trên tổng sẽ cho hoàn **âm** với hợp đồng >10 buổi (ví dụ 20 buổi/2.000.000đ, tập 19 buổi, huỷ: hoàn `0,9 × 100.000 = 90.000đ`).

**Vòng đời buổi tập** (`SessionStatus`): `REQUESTED → CONFIRMED → PENDING_CLIENT_CONFIRMATION → COMPLETED`; nhánh `CANCELLED`, `NO_SHOW`, `PT_NO_SHOW_REPORTED`, `DISPUTED`. Không trạng thái nào đi lùi.
- PT chỉ **báo** hoàn thành (sau `scheduledEndAt`); khách xác nhận / khiếu nại / im lặng → **tự xác nhận sau 3 ngày** (`SESSION_AUTO_CONFIRM_DAYS`). Báo vắng mặt (cả hai chiều) chỉ được sau `scheduledStartAt`.
- Năm trạng thái còn **giữ quyền lợi** khi đếm số buổi được đặt: `REQUESTED, CONFIRMED, PENDING_CLIENT_CONFIRMATION, DISPUTED, PT_NO_SHOW_REPORTED`.
- Đặt buổi và dời lịch chạy dưới khoá advisory theo PT (`pg_advisory_xact_lock`) để không double-book; kiểm số buổi còn lại + trùng giờ + tạo buổi nằm trong **một** transaction. Giờ kết thúc luôn tính ở server từ `sessionDurationMinutes` của hợp đồng.

Quy tắc huỷ buổi hiện hành (chủ sở hữu chốt 20/11/2026 — **không còn mốc 24 giờ**): huỷ buổi `CONFIRMED` luôn tốn kém cho bên huỷ, vào bất kỳ thời điểm nào trước giờ hẹn. Huỷ buổi `REQUESTED` (chưa xác nhận) miễn phí, không tiền, không trừ quota (`cancelSession` xử lý nhánh này riêng). Dời lịch miễn phí, tối đa 2 lần dời được chấp nhận/buổi, không được gửi trong vòng 12 giờ trước giờ hẹn cũ, giờ mới phải cách hiện tại ≥ 24 giờ (xem §2.4).

| # | Ai | Sự kiện | Kết quả buổi | Quota | Bồi thường khách | PT được trả |
|---|---|---|---|---|---|---|
| 1 | Khách | Huỷ buổi `CONFIRMED` | `CANCELLED` | **trừ 1 buổi** | không | **có** (trọn buổi) |
| 2 | PT | Huỷ buổi `CONFIRMED` / chặn ngày có buổi đã xác nhận | `NO_SHOW` | buổi được tính là đã xử lý (`compensatedSessions` + 1) | **có** — 1 buổi bằng tiền, PT chịu | không |
| 3 | PT | Không tới | `NO_SHOW` | như dòng 2 | **có** | không |
| 4 | Bất khả kháng (PT đang bị hạn chế) | Huỷ | `CANCELLED` | giữ | không | không |

Nguồn duy nhất: `resolveSessionOutcome()` ở `user-service/src/services/session-outcome.ts` (không còn tham số báo trước / `SESSION_LATE_CANCEL_HOURS`). Mọi đường huỷ/vắng (`addException`, `cancelSession`, `markNoShow`, phòng online) phải đi qua hàm này, không tự tính.

**Khiếu nại buổi (đường cũ một admin)** chỉ phát sinh từ hai hướng (khách khiếu nại `PENDING_CLIENT_CONFIRMATION`; PT phủ nhận `PT_NO_SHOW_REPORTED`); admin chọn một trong ba kết luận: `COMPLETED` (trừ quota, PT được trả), `CANCELLED` (giữ quota, không ai được trả), `PT_NO_SHOW_CONFIRMED` (giữ quota, **bồi thường khách** qua đúng công thức PT vắng). Khi cờ T0 của V2.1 bật, mọi phán quyết phải qua hồ sơ (§2.7).

### 2.4 Lịch, đặt buổi, dời lịch, nhiều PT

- **Lịch rảnh có một nguồn sự thật:** `PTAvailability` (+ `PTScheduleException` cho ngày nghỉ). Ghi được ngay cả khi hồ sơ đang chờ duyệt; không đi qua duyệt tin đăng. Cột lịch trong `PTApplication` chỉ là lịch sử, không đọc không ghi.
- PT thu hẹp lịch: **không chặn**; có buổi `CONFIRMED` ngoài khung mới → cảnh báo kèm danh sách nhưng vẫn lưu, **không tự huỷ** buổi đã xác nhận (muốn bỏ thì dùng dời lịch). PT chưa công bố lịch rảnh → chặn đặt lịch với thông báo rõ.
- Slot hiển thị cho khách: `GET /availability/:ptUserId/slots?date=&bookableOnly=true`, chỉ trả `HH:mm`; bỏ giờ quá hạn đặt trước **24 giờ** và khung trùng buổi; khung trùng buổi `REQUESTED/CONFIRMED` của **chính người xem** với bất kỳ PT nào cũng bị ẩn. Đặt buổi vẫn kiểm lại ở server.
- **Khách không có 2 buổi chồng giờ**, kể cả với 2 PT khác nhau (`REQUESTED` + `CONFIRMED` giữ chỗ); chỉ chặn chồng giờ, không có khoảng nghỉ (07:00–08:00 rồi 08:00–09:00 được) → 409 `CLIENT_SCHEDULE_CONFLICT`. Áp cho đặt buổi, đề xuất dời lịch (cả hai phía) và chấp nhận dời lịch. Thứ tự khoá: PT → hợp đồng → khách. Lỗi 409 `CLIENT_PT_LIMIT_REACHED`/`CLIENT_SCHEDULE_CONFLICT` là đúng thiết kế, không phải bug.
- **Dời lịch hai phía** (chỉ buổi `CONFIRMED`): gửi trước giờ bắt đầu **≥ 12 giờ** (`RESCHEDULE_ORIGINAL_CUTOFF_MS`); lý do bắt buộc (≤500 ký tự); giờ mới phải trong khung rảnh, không chồng buổi (dùng lại `assertSlotBookable`); tối đa **2 lần dời đã được chấp nhận**/buổi (đếm `ACCEPTED`, không đếm đề xuất bị từ chối); mỗi buổi tối đa 1 yêu cầu `PENDING`; **chỉ bên kia mới trả lời**; từ chối/rút/hết hạn thì buổi giữ lịch cũ. Tự hết hạn khi quá `originalStartAt` mà chưa ai trả lời (job nền mỗi 10 phút). Dời lịch **không** đụng hạn mức buổi và không phát sinh bồi thường.
- Tìm PT: lọc chuyên môn ở server (`hasSome` trên `mainSpecialties`); ô tìm `q` khớp họ tên, tên phòng tập, địa chỉ (bỏ dấu), **không khớp chuyên môn**. Việt Nam hai cấp hành chính (Tỉnh/Thành → Phường/Xã), **không** có lọc cấp huyện; `wardCode` thiếu `provinceCode` → 400. Xếp hạng mặc định: cùng phòng tập của khách (`SAME_GYM`) > cùng phường/xã > cùng tỉnh > còn lại; trong cùng hạng điểm đánh giá giảm dần, PT chưa có đánh giá xếp sau; PT đã tắt nhận khách luôn cuối. Lấy gym của khách lỗi → mất nhãn (không sai nhãn).
- Nhật ký kiểm toán user-service (`AuditLog`, không khoá ngoại để xoá hồ sơ không xoá bằng chứng): ghi `CONTRACT_*`, `SESSION_RESCHEDULE_*`, `SERVICE_PACKAGE_*`, `PT_PROFILE`; chỉ ghi thao tác GHI; actor tiến trình nền là `SYSTEM`; ghi log lỗi không làm hỏng thao tác chính nhưng phải log mức `error`.

### 2.5 Gói hội viên gym và check-in QR

- **Mua gói:** thanh toán qua cổng (VNPay/ZaloPay); đơn chờ thanh toán chưa từng trả tự huỷ sau **10 phút** (`GYM_MEMBERSHIP_PENDING_PAYMENT_STALE_MINUTES`). Hoa hồng nền tảng cố định `PLATFORM_COMMISSION_RATE` mặc định 10%.
- **Gia hạn cộng dồn (chủ sở hữu chốt 19/11/2026):** khách đang có gói (đang chạy hoặc đã xếp hàng) ở một thương hiệu vẫn mua được gói mới; gói mới bắt đầu đúng lúc gói mới nhất của thương hiệu đó hết (không chồng, không mất ngày), ngày thật được chốt lúc thanh toán xong (khoá advisory theo khách+thương hiệu). Gói chưa đến ngày bắt đầu là `ACTIVE` có `startDate` ở tương lai: **không** là hội viên hiện tại, **không** check-in được (`NOT_STARTED`), hiện `isUpcoming`. Chỉ đơn **chưa thanh toán** mới chặn mua tiếp. Tiền: không đổi payment-service — tiền vào ngăn chờ lúc thanh toán như cũ và chỉ được giải phóng khi **chính gói đó** hết hạn (sweep theo `endDate` của nó). Khách không tự huỷ được gói chưa bắt đầu (`MEMBERSHIP_UPCOMING_CANCEL_DISABLED`); admin hoàn tiền thì hoàn **toàn bộ giá** (chưa dùng ngày nào). Thuê PT qua gym **không còn đòi gói phủ hết hợp đồng** (chỉ cảnh báo `coverage.coversContract=false`); thay vào đó đặt/dời buổi tại chi nhánh vào ngày không có gói hiệu lực (hoặc gói gia hạn đã xếp hàng) bị từ chối 422 `SESSION_NOT_COVERED_BY_MEMBERSHIP`.
- **Khách tự huỷ gói: KHÔNG hoàn tiền** (chỉ đổi trạng thái; giao diện phải nói rõ trước khi xác nhận). **Chỉ admin hoàn tiền** (`refundByAdmin`), và chỉ 3 tình huống: phòng gym vi phạm/bị khoá; phòng ngừng hoạt động khi khách còn hạn; lỗi giao dịch (thanh toán xong nhưng kích hoạt thất bại vĩnh viễn). Hoàn theo tỷ lệ số ngày còn lại, **làm tròn xuống tới nghìn đồng** (`proratedRefundAmount`; 299.999,84đ → 299.000đ). Thu hồi hoa hồng giới thiệu **chỉ chạy khi admin hoàn tiền**, không chạy khi khách tự huỷ.
- **Giải phóng ngăn chờ gói hội viên:** giữ trong ngăn chờ tới khi gói huỷ/hết hạn (đánh đổi có chủ đích: giải phóng dần theo ngày **chưa làm**). Khi gói hết hạn tự nhiên, khách tự huỷ hoặc admin hoàn tiền: giải phóng đúng **phần còn lại quy thuộc gói đó** (đọc từ bút toán theo `transactionId`, không tính lại `rate × P`), gồm **ba phần**: gym, nền tảng, hoa hồng giới thiệu PT chưa thu hồi. `membership-release` chỉ chạy khi gói đã huỷ hoặc hết hạn.
- **Mã giới thiệu PT:** chỉ dùng được khi PT có cộng tác `ACCEPTED` với đúng gym đang bán, và chỉ cho **gói hội viên đầu tiên** của khách tại đó; sai mã/PT không cộng tác/khách đã từng là hội viên → từ chối kèm thông báo riêng. Hoa hồng = `GYM_MEMBERSHIP_REFERRAL_RATE` (10%) trên **giá gộp** của gói, trừ vào phần gym.
- **Đăng ký nhiều phòng gym:** cảnh báo, không chặn; liệt kê tên phòng + ngày hết hạn; bằng chứng ở `GymMembershipContract.multiGymWarned`.
- **Check-in hội viên (QR chi nhánh):** mỗi lượt quét = 1 lượt ghé (`usedVisits += 1`); cùng một gói cách lượt trước **≥ 60 giây** (`COOLDOWN_MS`); không giới hạn số lượt/ngày; chạm `totalVisits` thì gói tự `EXPIRED` trong cùng transaction rồi đi đường giải phóng tiền có sẵn; khoá `FOR UPDATE` chống quét đồng thời. Check-in hộ bởi lễ tân: xem §2.1.
- **Check-in PT (mô hình X, đã chốt):** PT quét **QR của chi nhánh** (PT không sinh mã); chỉ được vào khi có ít nhất một buổi trực tiếp (OFFLINE) đủ điều kiện của hợp đồng `gymId` = chi nhánh đó trong ngày (ngày D theo `Asia/Ho_Chi_Minh`). Bản ghi duy nhất mỗi (chi nhánh, PT, ngày) (`gym_pt_check_ins`, UPSERT, `scan_count` tăng khi quét lại). Buổi `DISPUTED`/`PT_NO_SHOW_REPORTED` và hợp đồng đang kết thúc/đã kết thúc không làm căn cứ; hạn chế theo hợp đồng chỉ loại buổi của hợp đồng đó, hạn chế tài khoản loại hết. user-service không trả lời → từ chối có mã `PT_SESSION_CHECK_UNAVAILABLE` (không bao giờ coi là "không có buổi"). Check-in PT **không đổi** trạng thái buổi, bộ đếm hay sổ cái (chỉ-đọc cạnh chuỗi tiền). Điểm yếu đã biết: QR chi nhánh sống 365 ngày, ảnh chụp dùng từ xa chưa bị chặn.

### 2.6 Dòng tiền, ví, escrow, phí, hoàn tiền, rút tiền

**Nguyên tắc vàng:** ESCROW chỉ đổi khi tiền thật vào/ra nền tảng; mọi thao tác khác chỉ chuyển *quyền đòi* giữa các ngăn. Mọi chuyển tiền đi qua `withWallets` (một đường tiền duy nhất); công thức chỉ ở payment-service.

```
Khách thanh toán (VNPay/ZaloPay) → checkout đóng băng tỷ lệ, chưa dịch chuyển đồng nào
 → webhook có chữ ký (hoặc job đối soát hỏi lại):
     ESCROW += P ; PT chờ += ptRate×P ; Gym chờ += gymRate×P ; Nền tảng(REVENUE) chờ += platformRate×P
 → gọi ngược user-service kích hoạt hợp đồng
Mỗi buổi COMPLETED (hoặc tự duyệt sau 3 ngày): ngăn CHỜ → ngăn KHẢ DỤNG theo tỷ lệ × unit (u = P/N); ESCROW không đổi
```

- **Ba ngăn ví:** `pendingBalance` (thuộc chủ ví nhưng gắn buổi chưa diễn ra), `availableBalance` (được phép rút), `lockedBalance` (đã duyệt rút, chưa chuyển khoản xong). **Hai ví hệ thống** (`ownerType = PLATFORM`): `ESCROW` (mọi đồng đã nhận chưa chi) và `REVENUE` (hoa hồng nền tảng đã hưởng).
- **Bất biến đối soát:** `ESCROW.available = Σ(pending + available + locked)` của mọi ví không phải ESCROW (khách + PT + gym + REVENUE). Lệch dù 1 đồng = sổ sách không còn đáng tin. `GET /admin/payments/reconciliation` trả 409 khi lệch; `negativeWallets` luôn phải rỗng.
- **Bất biến D48 — chỉ dùng tiền của chính hợp đồng (gộp 18/11/2026 từ kế hoạch Financial Hardening 19/10, đối chiếu commit 21–22/10):** bồi thường PT vắng/đến muộn, chia hoa hồng giới thiệu hội viên và hoàn đơn dịch vụ cá nhân hoá chỉ lấy từ **tiền chờ của chính giao dịch/hợp đồng đó** — **không** rút ví khả dụng gộp của PT, **không** để nền tảng ứng, **không** ghi nợ PT rồi khấu vào buổi dạy của hợp đồng khác; mọi nhánh fallback `LEDGER_STRICT_OWN_FUNDS` đã xoá (commit `78689e95`). Phần thiếu trở thành **nghĩa vụ mở** cho admin (`ObligationKind` = `NO_SHOW`/`LATE_ARRIVAL`/`REFUND_SHORT`/`OVER_RELEASED`/`APPEAL_AWARD`/`GYM_DEBT`…, `contract-ledger.service.ts`); `OVER_RELEASED` chỉ báo sự cố cho admin, không tự rút. Khách trả tiền **sau khi đã huỷ** được hoàn tự động cho hợp đồng PT (`refundUnactivatedContractPayment`, dùng trong `reconciliation.service.ts`). Chi tiết thiết kế cũ (DQ-1…DQ-10) nằm trong gói lưu trữ.
- **Đếm `u` (buổi tính là đã dùng):** `COMPLETED`; `NO_SHOW` do **khách**. Không tính: `NO_SHOW` do PT, `PENDING_CLIENT_CONFIRMATION`, `DISPUTED`, `REQUESTED`, `CONFIRMED`, `CANCELLED`.
- **PT vắng buổi:** khách nhận đúng `unit`; trừ ngăn chờ PT `ptRate×unit`, gym `gymRate×unit`, nền tảng `platformRate×unit` (nền tảng không giữ hoa hồng buổi không diễn ra); ESCROW không đổi.
- **Làm tròn:** tính bằng `Decimal`, không làm tròn trung gian; PT và gym làm tròn **xuống**; **phần dư về doanh thu nền tảng**; hoàn khách làm tròn **lên**. `splitThreeWays()` tự khẳng định tổng phần = số gốc.
- **Ngăn chờ không đủ** (PT vắng quá nhiều): trừ ngăn chờ → trừ ngăn khả dụng → nền tảng ứng từ `REVENUE` và ghi `PartnerReceivable` → `REVENUE` cũng thiếu thì **từ chối toàn bộ**. Khách luôn được nhận đủ. `PartnerReceivable` được tự trừ dần vào các lần ghi có sau (`recoverReceivables`).
- **Holdback 10% của PT:** đã cài nhưng **TẮT** — `resolvePtHoldbackRate()` trả `"0"` trừ khi bật `PT_HOLDBACK_NEW_CONTRACTS_ENABLED=true` **và** điều khoản PT là bản chính thức (không phải nháp) **và** PT đã xác nhận đúng bản đó. Tỷ lệ là ảnh chụp trên hợp đồng; tắt sau này không đụng hợp đồng đã có.
- **Hoàn tiền không qua ví khách:** khách không nạp tiền; ví khách chỉ nhận hoàn tiền/bồi thường. Khách chỉ được **rút phần có nguồn hoàn trả/bồi thường** (nhận diện qua mô tả bút toán chứa `refund`/`compensation`; sai thì sai về phía thiếu, không bao giờ thừa).
- **Dịch vụ cá nhân hoá (ai-service):** dùng chính bơm checkout + webhook chung (`purpose = PERSONALIZED_SERVICE_PURCHASE`), tiền vào ngăn chờ PT + nền tảng (không có gym) cho tới khi khách chấp nhận bản giao (hoặc **tự chấp nhận sau 3 ngày**, `PERSONALIZED_SERVICE_AUTO_ACCEPT_DAYS`). Huỷ trước khi PT bắt đầu hoặc admin duyệt hoàn: hoàn từ ngăn chờ → khả dụng → ghi nợ PT; có thể hoàn từng phần nhiều lần.
- **Idempotency:** mọi thao tác tiền không phải giao dịch gốc dùng khoá nghiệp vụ cố định (`SESSION_RELEASE:<id>`, `PT_NO_SHOW:<id>`, `CONTRACT_TERMINATE:<id>`, `MEMBERSHIP_RELEASE:<id>`, `MEMBERSHIP_REFERRAL:<id>`, `REFERRAL_CLAWBACK:<id>`, `WITHDRAWAL:<id>`, `WITHDRAWAL_LOCK:<id>`, `WITHDRAWAL_UNLOCK:<id>`, `PERSONALIZED_RELEASE:<id>`, `PERSONALIZED_REFUND:<orderId>:<amount>`); gọi lại replay kết quả cũ, không chạy lần hai.
- Giải phóng theo buổi là **best-effort** (lỗi payment-service không được huỷ buổi đã xác nhận; chấm dứt hợp đồng sẽ bù lại), còn bồi thường PT vắng **ném lỗi** (khách đang bị nợ tiền).

**Rút tiền (thủ công hoàn toàn — không có API chi hộ):**
- Trạng thái `PENDING → APPROVED (tuỳ chọn) → PAID`, hoặc `REJECTED` bất cứ lúc nào trước `PAID`. Tối thiểu **10.000đ** (`MIN_WITHDRAWAL_AMOUNT`).
- `approve()`: `AVAILABLE → LOCKED` (ESCROW không đổi) → khoản đã duyệt an toàn trước mọi khoản thu hồi phát sinh sau. `reject()` sau khi đã duyệt: `LOCKED → AVAILABLE`. `markPaid()` là nơi **duy nhất** tiền rời nền tảng: trừ `LOCKED` **và ESCROW**; mỗi lần tạo một `PaymentTransaction` `purpose = WITHDRAWAL` làm điểm neo.
- Số được rút: PT/gym = `availableBalance − Σ(yêu cầu đang PENDING)`; khách xem trên.
- **Bốn mắt:** khoản rút **≥ 5.000.000đ** (`WITHDRAWAL_FOUR_EYES_MIN_VND`) phải được duyệt bởi một admin và **một admin khác** xác nhận đã chi (`markPaid`); đi thẳng từ `PENDING` sang `PAID` bị từ chối → 409 `FOUR_EYES_REQUIRED`. Dưới ngưỡng thì không đổi. Hoàn tiền của admin không thuộc luật này.
- Khoảng trống đã biết: khoản `PENDING` chưa được giữ chỗ, một khoản thu hồi cùng lúc vẫn có thể ăn vào số tiền yêu cầu; quy tắc ưu tiên (thu hồi thắng) đã chốt nhưng chưa cài tự động.
- Admin tài chính (đọc): `GET /admin/payments/transactions` (tìm khớp chính xác theo id/payer/hợp đồng/gói/gym/PT, `limit` 1..100), `/transactions/:id` (hành trình tiền, bút toán, hoàn tiền liên quan), đối soát cổng. Tiền luôn là **chuỗi thập phân đúng như lưu**, không làm tròn; DTO whitelist, **không bao giờ** trả `extraData`, `metadata`, `idempotencyKey`, payload webhook; màn hình chỉ đọc.
- Đã loại khỏi phạm vi có chủ đích: chi trả tự động; luồng đóng cửa hàng loạt gym (xử lý từng gói qua `refundByAdmin`); endpoint quyết toán hoa hồng cũ (410 `ENDPOINT_RETIRED`); `GYM_STAFF`.

### 2.7 Khiếu nại / tranh chấp / kháng nghị (Dispute Case V2.1)

**Tình trạng bật tắt:** toàn bộ chức năng fail-closed; một cờ chỉ có hiệu lực khi biến đúng chuỗi `"true"` **và** `NODE_ENV=test` **và** DB cách ly được chấp nhận (hoặc môi trường E2E/dev dùng chung có tệp override riêng + payment-service đồng thuận cho cờ tiền). **Ngoài test/E2E, production luôn khoá.** Tám cờ `DISPUTE_CASE_*`: `EXECUTION_ENABLED`, `T0`, `EVIDENCE_STORAGE_ENABLED`, `LATE_OPEN_RECONCILIATION_ENABLED`, `D65B_RESOLUTION_ENABLED`, `TIMERS_ENABLED`, `APPEALS_ENABLED`, `DECISION_REPLACEMENT_ENABLED`. T0 và thanh toán khoản bồi thường muộn "L còn mở" **không** nằm trong danh sách được phép của E2E/dev (chỉ test cách ly).

**Nguyên tắc nền** (đang chạy):
1. Case chỉ là lớp bọc; trạng thái buổi, ví, sổ cái, nghĩa vụ vẫn ở chỗ cũ.
2. **Một cửa ra tiền**: mọi phán quyết đi qua lõi phán quyết rồi tới sổ cái payment-service.
3. **Im lặng không phải thừa nhận**: hết hạn chỉ chuyển bước/chuyển cấp, không kết tội, không tự chi tiền. Thiếu dữ liệu ≠ dữ liệu nói "không có".
4. **Danh tính từ token**; **bốn mắt** cho mọi quyết định ảnh hưởng tiền/quyền buổi/lỗi PT: người duyệt khác người đề xuất; khách và PT của chính hợp đồng không được đề xuất/duyệt kể cả có vai trò ADMIN; người duyệt khai không xung đột lợi ích (tính cả nhân viên đối tác của thương hiệu gym).
5. **Lịch sử chỉ thêm, không sửa/xoá** (trigger DB chặn UPDATE/DELETE); quyết định cũ được thay bằng bản ghi mới tham chiếu nó. Mọi thao tác ghi có khoá idempotency.
6. **Tiền chỉ lấy từ chính hợp đồng đó**; thiếu thì thành nghĩa vụ mở; không tạo nguồn tiền hay nợ giả.

**Quy tắc tiền/quyền buổi** (ví dụ 1.000.000đ/4 buổi, 90/10: một buổi V = 250.000đ, đến muộn L = 125.000đ = nửa V):
- PT vắng đã xác minh: khách hoàn V, **bị trừ một quyền buổi**, không có buổi bù; PT không nhận tiền buổi đó.
- PT đến muộn (chỉ buổi ONLINE, D77): khách được bồi thường L từ giá trị chính buổi đó, L trả **trước** khi nhả tiền buổi; PT vắng + D77 trên cùng buổi → khách nhận V (L nằm trong V), không bao giờ V + L; buổi có D77 không được phán quyết "Huỷ". Chỉ 4 tổ hợp D77 × phán quyết được mở (Hoàn thành hoặc PT vắng, × hợp đồng đang chạy hoặc đã kết thúc) khi L đã trả đủ tiền mặt; mọi trạng thái khác của L vẫn khoá.
- Holdback (D88) chỉ chi cho nghĩa vụ đã xác minh là do PT và không khi buổi/hợp đồng còn Case mở. Hoàn thủ công của admin không được đụng khoản đang có hồ sơ mở hoặc quyết định đã duyệt.
- Điều kiện áp chính sách cho hợp đồng: phải có **kết luận chính sách đã duyệt bốn mắt** (kết luận mới nhất có hiệu lực); **không hợp đồng nào được tự động xếp đủ điều kiện**; làm theo hợp đồng, không cần Case giả. Không phải bằng chứng: điều khoản bản nháp, mốc 20/10/2026, văn bản nhập tay, việc PT đã chấp nhận điều khoản.

**Quy trình hồ sơ** (đa phần sau cờ `TIMERS`/`APPEALS`):
- Hạn phản hồi: PT trả lời báo vắng **48 giờ**; mỗi bên phản hồi lần đầu **72 giờ**; mỗi vòng bổ sung **48 giờ**; tính giờ liên tục từ lúc **thông báo trong ứng dụng** được ghi (không tính email/push), tạm dừng khi tài khoản bên đó bị khoá. PT im lặng quá 48 giờ → buổi chuyển `DISPUTED` để điều tra (hệ thống không bao giờ đồng ý thay PT).
- SLA: cảnh báo ngày **10**, quá hạn ngày **14** (ngày lịch) — chỉ cảnh báo và chuyển cấp, không tự phán quyết. Tiền đang giữ: rà soát mỗi 7 ngày với quyết định "tiếp tục giữ, kèm lý do" hoặc một lối ra; quá 30 ngày chuyển lên chủ dự án (chưa đối chiếu mã).
- **Kháng nghị:** mỗi bên **một lần** cho mỗi hồ sơ, trong **14 ngày** kể từ lúc thông báo kết luận được ghi hợp lệ (`APPEAL_WINDOW_DAYS = 14`); người xét độc lập với người điều tra và người duyệt; kết quả là kết luận mới tham chiếu cũ. Nghĩa vụ tài chính sau kháng nghị chỉ tạo khi xác định được số tiền và bên chịu (hiện chỉ PT vắng, PT chịu); chưa rõ thì "cần đối soát". Thay quyết định đã duyệt chỉ khi chưa gây tác động nào, bốn mắt, quyết định cũ giữ nguyên.
- Vụ bế tắc nằm trong hàng đợi hiển thị, có người phụ trách và nhật ký, tiền giữ an toàn. Đóng hồ sơ (`CLOSED`) cần lý do, không nhả tiền, không đổi trạng thái buổi. Nguồn bằng chứng tạm không đọc được → 503, thử lại có giãn cách, sau 5 lần chuyển cấp.
- Bằng chứng: ghi rõ chứng minh được/không chứng minh được gì; hai bằng chứng cùng gốc tính một; không có thang điểm; chat chỉ là bằng chứng khi một bên nộp/đồng ý; không gắn nhãn "máy chủ đã xác minh" cho thứ chưa kiểm thật; mỗi lần đọc đều ghi nhật ký.
- **Khiếu nại gym/gói hội viên:** giao dịch/gym đóng cửa/gym vi phạm nếu được xác lập thì hoàn qua đường hoàn tiền có sẵn; khiếu nại ra vào/vận hành không có hoàn tiền; khiếu nại **không tự hoàn tiền** (chỉ thực thi quyết định đã duyệt bốn mắt, đúng một lần). Gói hết hạn mà còn khiếu nại mở thì chỉ giữ phần tiền chưa tất toán của **chính gói đó**. Số hoàn chốt **theo ngày hội viên khiếu nại** (gói 300.000đ/30 ngày, khiếu nại khi còn 20 ngày → 200.000đ), làm tròn xuống nghìn đồng. Gym chỉ cung cấp bằng chứng/giải trình trong chi nhánh của mình, không thấy danh tính hội viên, kết luận hay tiền. SLA gym: cảnh báo ngày 10, quá hạn ngày 14, kháng nghị 14 ngày (`complaint-case/rules.ts`).
- **Hiển thị tiền cho người dùng:** tiền ghi vào ví ≠ ngân hàng đã chuyển; `BUSINESS_DONE` ≠ tiền đã tới tay; `PAID_VIA_LEDGER` ≠ `PAID_VERIFIED`; `WAIVED`/`RESOLVED_OTHER` không bao giờ hiện là "đã trả"; luôn tách số đã ghi vào ví và số chưa nhận; không lộ mã nội bộ/enum/ID.
- Để sau: tự động xếp loại điều kiện chính sách, sửa quyết định đã thực thi (bằng hồ sơ điều chỉnh), nguồn tiền khắc phục khi kháng nghị thắng mà không còn phần giữ, bảo vệ khẩn cấp một người quyết, thời hạn giữ tối đa tuyệt đối.

### 2.8 Hạn chế / đình chỉ PT

**Nguồn sự thật là bảng `pt_restrictions`** (user-service): mỗi dòng là một **đợt** hạn chế (lịch sử, không phải cờ). Dòng có `ended_at IS NULL` nghĩa là PT đang bị hạn chế **ngay bây giờ**; `UserProfile.ptSuspended` chỉ là bản sao suy ra, chỉ ghi trong cùng transaction mở/đóng đợt (đọc thấy cờ bật mà không có dòng nào → chặn như cấm vĩnh viễn, fail-closed). Ba mức (D38):

| Mức | `scope`/`type` | Ý nghĩa |
|---|---|---|
| Hạn chế theo hợp đồng | `CONTRACT` + `TEMPORARY_SUSPENSION` | Chỉ khoá coaching trên **một** hợp đồng; PT vẫn nhận client khác |
| Tạm đình chỉ PT | `ACCOUNT` + `TEMPORARY_SUSPENSION` | Tạm dừng toàn PT, **đảo ngược được**, hợp đồng vẫn `ACTIVE` |
| Cấm vĩnh viễn | `ACCOUNT` + `PERMANENT_BAN` | Khoá tài khoản; chấm dứt và hoàn mọi hợp đồng mở |

- Mỗi PT tối đa 1 đợt ACCOUNT đang mở và 1 đợt CONTRACT/hợp đồng (chỉ mục duy nhất từng phần). Mở khoá tài khoản **không** gỡ tạm đình chỉ; tạm đình chỉ không gỡ được cấm vĩnh viễn (409). Khoá khi đang tạm đình chỉ → đóng đợt tạm (`CONVERTED_TO_PERMANENT`), mở đợt cấm, chạy quy trình huỷ-hoàn.
- **Tạm đình chỉ không phải bằng chứng lỗi:** không chấm dứt hợp đồng (trạng thái lưu vẫn `ACTIVE`, trạng thái hiệu lực `PAUSED_BY_ADMIN` qua `getEffectiveContractStatus`), không bồi thường, không phạt vắng mặt. Buổi `REQUESTED/CONFIRMED` chưa kết thúc bị huỷ theo hàng bất khả kháng (giữ quota, không bồi thường, `cancelledBy = SYSTEM`, không `ptAtFault`); buổi `PENDING_CLIENT_CONFIRMATION`/`DISPUTED`/`PT_NO_SHOW_REPORTED` không bị đụng, tự duyệt và xử lý phòng online **bỏ qua PT bị hạn chế**; khi gỡ, hạn xác nhận của khách được cộng bù thời gian đóng băng.
- Khi gỡ: mỗi hợp đồng còn `ACTIVE` có `endDate` được **cộng bù** `gỡ − max(bắt đầu đợt, kích hoạt)`, trừ khi đã hết hạn trước khi đình chỉ (không cộng); idempotent (`pt_restriction_contract_extensions`). Quét hết hạn và quét giải phóng holdback nhàn rỗi bỏ qua PT bị hạn chế.
- **Khách rút không phạt:** khi PT đang bị hạn chế (hoặc hợp đồng đó bị hạn chế), khách gửi `CLIENT_CANCELLED` bình thường nhưng **server** tự quyết đây là lối thoát trung tính (`CLIENT_EXIT_DUE_TO_PT_RESTRICTION`): hoàn 100% giá trị chưa dùng, không phí 10%, không bồi thường PT, PT không có lỗi; việc kiểm tra và khoá nằm trong cùng critical section với suspend/lift (khoá advisory theo PT), điều khoản chấm dứt được ghi bền trước khi gọi payment-service nên lift giữa chừng không đổi giá. "Chờ" không cần thao tác.
- Cấm vĩnh viễn hiện **vẫn dùng lý do `PT_BANNED`** (hoàn 100%); nếu hợp đồng có holdback > 0 thì lệnh cấm sẽ tự bồi thường khách từ phần giữ — hôm nay holdback = 0 nên không có đồng nào thêm. Quyết định trách nhiệm tài chính tường minh, đóng băng tiền giữ lại, quyền rút tiền của PT bị hạn chế, dịch vụ cá nhân hoá và thoả thuận PT–gym của PT bị khoá: **chưa làm** (chưa đối chiếu mã phần này).
- Quá `PT_RESTRICTION_OVERDUE_DAYS` (14) ngày kể từ lúc bắt đầu hoặc lần xác nhận cuối: cờ `overdue` trong danh sách — chỉ hiển thị, không làm gì khác. Từ chối bằng HTTP 409 `PT_TEMPORARILY_UNAVAILABLE` (tạm đình chỉ) / `PT_ACCOUNT_LOCKED` (cấm). API: `POST /admin/pts/:ptUserId/suspend|lift-suspension|restrictions/justify`, `GET /admin/pts/:ptUserId/restrictions`, `GET /admin/pts/suspended`, `GET /profile/me/restriction` (PT tự xem), `GET /internal/pt/:ptUserId/restriction`.
- Khoá tài khoản (auth-service `isActive=false`) chặn mọi request qua gateway; lệnh khoá chuyển sang user-service qua hộp thư thử lại có số thứ tự `seq` (lệnh cũ không đè lệnh mới). Khoá/mở khoá ghi `AuditLog` (`ACCOUNT_LOCKED`/`PT_LOCKED`...).
- Ma trận buổi/hợp đồng: phần lớn nơi đọc `ContractStatus.ACTIVE` giữ nguyên nghĩa; **không thêm trạng thái hợp đồng mới** — hạn chế là lớp phủ cấp PT.

### 2.9 Cộng tác PT ↔ gym và đối tác gym

**Cộng tác PT–gym:** thương lượng `PENDING → COUNTERED → ACCEPTED/REJECTED/EXPIRED/TERMINATED`; mỗi đề xuất lại ghi đè tỷ lệ và đảo `proposedBy`; bên vừa đề xuất không tự accept đề xuất của mình; tối đa **5 vòng** (`MAX_COLLABORATION_ROUNDS`), mỗi đề xuất sống **7 ngày** (`COLLABORATION_OFFER_TTL_DAYS`); `actor` suy ra từ route, không nhận từ body. Hiện **thỏa thuận cấp thương hiệu** (`GymBrandPtAgreement`) là chuẩn: một thỏa thuận ACCEPTED áp cho mọi chi nhánh đang mở của thương hiệu; thỏa thuận cũ theo chi nhánh (`GymPtCollaboration`) chỉ còn hiệu lực khi chưa bị thỏa thuận thương hiệu thay thế (một dòng đã bị thay thế không bao giờ sống lại). Chấm dứt thỏa thuận thương hiệu có thời gian báo trước mặc định **14 ngày** (`COLLABORATION_TERMINATION_NOTICE_DAYS`); hợp đồng đang chạy giữ nguyên tỷ lệ cũ vì tỷ lệ là ảnh chụp. Chỉ OWNER thương lượng/mời PT. Phần gym của hợp đồng vào ví của **chi nhánh** (`contract.gymId`). Chi nhánh phải `APPROVED` + `OPEN` và đối tác không `SUSPENDED/TERMINATED` mới nhận hợp đồng mới.

**Tự đăng ký đối tác (luồng DUY NHẤT với đối tác mới):** nhập email → magic link → đặt mật khẩu → phiên hạn chế → wizard hồ sơ (người đại diện, thương hiệu **đúng 1**, quy mô, **chi nhánh đầu duy nhất**, vị trí + ghim, ảnh, giấy tờ, xem lại + điều khoản) → nộp → admin duyệt. Email trùng Customer/PT/Admin bị chặn ở bước nhập email (không đổi `User.role`). `businessScale` chỉ là metadata; chi nhánh #2+ thêm sau khi được duyệt bằng luồng thường. Luồng admin cũ tạo/cấp tài khoản OWNER đã ngừng (410 `ENDPOINT_RETIRED`); hạ tầng mời MANAGER giữ nguyên.

| Khái niệm | Giá trị |
|---|---|
| Magic link | token băm sha256, hạn **24 giờ**, gửi lại cách **60 giây** + trần/ngày theo email; link dùng fragment `#token=`; `setupToken` hạn **15 phút**, dùng 1 lần |
| Giấy tờ bắt buộc | `BUSINESS_LICENSE`, `REPRESENTATIVE_ID`, `PREMISES_PROOF` (mỗi giấy tờ 1..4 tệp); admin chấp nhận từng giấy tờ, **approve không bao giờ tự đặt VERIFIED** |
| Ảnh cơ sở | tối thiểu **1** ảnh (`APPLICATION_MIN_PHOTOS`), tối đa 20 |
| Upload | tối đa 10 MB; `jpeg/png/webp` (ảnh), `pdf/jpeg/png` (giấy tờ); kiểm magic bytes; bucket riêng tư, tải bằng presigned GET ≤120 giây; MinIO chỉ dev/test |
| Approve | **một** `$transaction`: partner `ACTIVE` + `VERIFIED` + chi nhánh đầu `APPROVED` + audit; cần mọi issue `RESOLVED`, 3 giấy tờ bắt buộc đã được chấp nhận, đúng 1 chi nhánh nháp |

Trạng thái hồ sơ (năm trục độc lập, **không gộp**): vòng đời `GymPartnerStatus` (`PROSPECT` = "ứng viên chưa duyệt", `INVITED` chỉ còn cho hồ sơ cũ, `ACTIVE`, `SUSPENDED`, `TERMINATED` một chiều); thẩm định `PartnerVerificationStatus` (`NOT_VERIFIED → IN_REVIEW → NEEDS_INFO ⇄ IN_REVIEW → VERIFIED` hoặc `REJECTED`); chi nhánh `GymStatus` (kiểm duyệt) và `GymOperationalStatus` (`OPEN`/`TEMPORARILY_CLOSED`/`PERMANENTLY_CLOSED`); khiếu nại. Đổi tên/địa chỉ chi nhánh đã duyệt không làm tụt `status`. `REJECTED` là cuối với ứng viên (chỉ admin `reopen`); chỉ `NEEDS_INFO` mới sửa/nộp lại được; nộp lại **không** đóng issue (chỉ admin đóng). Mọi chuyển trạng thái ghi đúng 1 dòng `PartnerAuditLog` trong cùng transaction.

**Cổng vận hành (cho phép dương tính, mặc định từ chối):** truy cập vận hành chỉ khi đồng thời `partner.status = ACTIVE` ∧ `verificationStatus = VERIFIED` ∧ `account.status = ACTIVE` ∧ `onboardingCompletedAt != null`. Thiếu payout → 409 `ONBOARDING_INCOMPLETE`; `PROSPECT/INVITED` → 403 `PARTNER_APPLICATION_PENDING`; chưa thẩm định → `PARTNER_NOT_VERIFIED`. "Chủ gym cũ" (`isLegacy`) chỉ được coi là hợp lệ khi **chứng minh được** sở hữu qua `Gym.ownerId`/`GymBrand.ownerId`; tài khoản `GYM_OWNER` mồ côi có 0 quyền vận hành. `partnerId` luôn suy từ danh tính, không nhận từ body.

**Đình chỉ đối tác (`SUSPENDED`):** chỉ khoá **đăng nhập OWNER** (MANAGER vẫn làm việc, phạm vi hiện có). Hệ quả: chặn bán mới và gia hạn, chặn rút tiền, chặn cộng tác PT mới, ẩn khỏi tìm kiếm công khai; **giữ nguyên** hội viên đang hiệu lực (chạy tới hết hạn), check-in hội viên còn hạn, doanh thu đã ghi ví, hợp đồng PT đang chạy. `TERMINATED` → từ chối, tài khoản bị thu hồi. Lý do đình chỉ chỉ admin thấy; hộp thoại xác nhận phải hiện tác động thật (số hội viên, giá trị còn lại, số dư sắp đóng băng), lý do bắt buộc, nút an toàn là nút mặc định.

#### 2.9.1 Bổ sung chi tiết cho đối tác gym (gộp 18/11/2026 từ các spec đối tác gym cũ)

> Các mục dưới đây lấy từ spec thiết kế 9/2026 (`GYM_*.md` ở gốc repo cũ, đã lưu trữ ngoài repo); **mã vẫn là nguồn đúng** — đối chiếu mã trước khi dựa vào chi tiết.

- **Cơ chế `principalUserId`:** gym-service dịch người gọi thành `{ partnerId, role, scopedGymIds, principalUserId }`; `principalUserId` là userId của OWNER (với owner là chính họ, với manager là owner của đối tác). Nhờ đó mọi truy vấn sở hữu cũ (`Gym.ownerId`, `GymBrand.ownerId`) chạy nguyên không sửa; ranh giới quyền thật do hai guard `requirePartnerOwner` (tiền + người) và `requireGymScope` (chi nhánh được gán). Chuyển quyền chủ sở hữu là **hoán đổi nguyên tử** (owner cũ → MANAGER, MANAGER → OWNER) và ghi lại `ownerId` ở mọi bảng trong một `$transaction`; `partnerService.assertOwnershipConsistent` phát hiện lệch. Không làm ma trận quyền mịn hơn các vai trò hiện có.
- **Chỉ OWNER sửa gói hội viên** (gói là giá = tiền; MANAGER chỉ xem để tư vấn). Gói là tài sản **cấp thương hiệu**: một gói bán dùng được ở mọi chi nhánh của thương hiệu. Phạm vi truy cập theo chi nhánh (`SINGLE_BRANCH`/`ALL_BRAND_BRANCHES`, chụp ảnh quyền lúc mua) đã được chủ dự án **hoãn (8/9/2026)** vì đổi ngữ nghĩa thanh toán + check-in — hỏi trước khi làm.
- **Bất biến mô hình dữ liệu:** 1 chủ = 1 thương hiệu = 1..N chi nhánh; không có chi nhánh "đứng riêng" qua wizard mới, không đổi/gỡ thương hiệu của chi nhánh (chủ dự án chốt "Gỡ bỏ ngay": đã xoá ô chọn thương hiệu và trường `brandId` khỏi `gymUpdateSchema`; dòng chi nhánh cũ đã đứng riêng giữ nguyên, không migration phá huỷ); `attachBrand` trả 409 idempotent kể cả hai request song song. Địa chỉ chi nhánh chỉ **tỉnh – phường** (Việt Nam bỏ cấp quận/huyện từ 1/7/2025: **không thêm lại** trường quận/huyện). MANAGER **không thấy** (ẩn, không phải vô hiệu) "Thêm chi nhánh", Hồ sơ thương hiệu, đổi tên thương hiệu.
- **Chi nhánh đầu & thẩm định:** với đối tác mới `GymBrand.approvedName = null`, tên đang nhập nằm ở `pendingName`; duyệt chi nhánh đầu cũng duyệt tên thương hiệu công khai nên màn duyệt phải nói rõ. Thẩm định chi nhánh **không** hỏi lại giấy phép kinh doanh / mã số thuế / giấy tờ người đại diện (đã thu ở thẩm định đối tác) — chỉ giấy tờ theo địa điểm (thuê/sở hữu mặt bằng, PCCC nếu có, ảnh cơ sở). Trong hồ sơ ứng tuyển, chi nhánh đầu dùng `PREMISES_PROOF` thay giấy tờ thuê và ảnh cơ sở có hạng mục thay ảnh chi nhánh; chi nhánh #2+ vẫn đi wizard đầy đủ.
- **Hồ sơ tự đăng ký — bảng trạng thái nghiệp vụ → dữ liệu:** chưa xác minh email: chỉ có dòng `PartnerApplicationToken`; đã đặt mật khẩu nhưng chưa `bootstrap` (`SETUP_INCOMPLETE`): `User` role `GYM_OWNER`, chưa có `GymPartner`, **0 quyền vận hành**; `bootstrap` idempotent khoá theo `userId`; `ONBOARDING` = `PROSPECT` + `NOT_VERIFIED` (`PROSPECT` nay nghĩa "ứng viên chưa duyệt"); `UNDER_REVIEW` = `IN_REVIEW`; `REQUEST_CHANGES` = `NEEDS_INFO`; `REJECTED` khoá sửa và nộp (409), chỉ admin `reopen`. `GymPartnerStatus.INVITED`/`PartnerAccountStatus.INVITED` giữ trong enum chỉ để không phải bỏ enum Postgres — ngừng ghi mới. `set-password` chỉ ghi **một datastore** (auth DB, một transaction) vì auth-service không gọi gym-service; hồ sơ đối tác tạo bằng `POST /owner/application/bootstrap` do chính ứng viên gọi. Không có `EXPIRED`/`WITHDRAWN` (hoãn có chủ đích). `businessScale` chỉ là metadata; hồ sơ chỉ có đúng 1 chi nhánh (`APPLICATION_SINGLE_BRANCH`), chi nhánh đầu ở DRAFT và đi DRAFT → APPROVED khi duyệt (`applyGymApprovalTx`).
- **Issue và giấy tờ của hồ sơ:** issue `OPEN` →(ứng viên "đã cập nhật" + ghi chú) `RESUBMITTED` →(**chỉ admin** đóng) `RESOLVED`, hoặc admin yêu cầu lại → `OPEN`; approve bị chặn khi còn `OPEN`/`RESUBMITTED`; hạng mục `REPRESENTATIVE`/`BRAND`/`BRANCH`/`LOCATION`/`PHOTOS`/`LEGAL`/`OTHER`. Giấy tờ: `PENDING` →(tải lên + xác nhận) `RECEIVED` →(admin chấp nhận) `VERIFIED`, hoặc (yêu cầu cập nhật + lý do) `REJECTED` ("Cần cập nhật") →(ứng viên thay tệp) `RECEIVED` version+1; xoá hết tệp → `PENDING`. Mọi chuyển trạng thái ghi **đúng 1 dòng** `PartnerAuditLog` trong cùng transaction (`APPLICATION_SUBMITTED`, `CHANGES_REQUESTED`, `ISSUE_MARKED_UPDATED`, `ISSUE_RESOLVED`, `DOCUMENT_ACCEPTED`, `APPLICATION_APPROVED`… và `VIEWED_AS_PARTNER` mỗi lần admin xem giấy tờ); timeline của ứng viên và lịch sử admin đọc từ bảng này, ứng viên chỉ thấy trường an toàn. `approve` = `UPDATE … WHERE status='PROSPECT' AND verification_status='IN_REVIEW'` phải khớp đúng 1 dòng (hai admin cùng lúc → một thắng, một nhận 409); email gửi **sau** commit, lỗi gửi chỉ log, không có hàng đợi thử lại.
- **Cổng vận hành — chi tiết:** hàm thuần `evaluateOperationalAccess` viết bằng `switch` vét cạn trên `GymPartnerStatus` (`assertNever`: thêm giá trị enum mới = lỗi biên dịch cho tới khi được phân loại; mọi giá trị chưa biết → từ chối). Mã lỗi: không có tài khoản đối tác và không chứng minh được legacy → 403 `NO_PARTNER_ACCOUNT`; `SUSPENDED` → OWNER 403 `PARTNER_SUSPENDED` (MANAGER giữ phạm vi hiện có); `TERMINATED` → 403 `PARTNER_TERMINATED`. Hai bộ resolver: `resolveOperationalContext` (nghiêm, cho toàn `/owner/*` trừ nhóm ứng viên và nhánh `GYM_OWNER` của `/me/collaborations`) và `resolveApplicantContext` (chỉ `application/*` + `onboarding/*`; user mồ côi chỉ gọi được `GET status` và `POST bootstrap`). Lỗ hổng đã vá: trước đây "không có `GymPartnerAccount`" = legacy toàn quyền, nên cả user `GYM_OWNER` mồ côi cũng có quyền; nay `isLegacy` chỉ khi tồn tại `Gym.ownerId = userId` hoặc `GymBrand.ownerId = userId`.
- **Magic link / giới hạn tần suất — chi tiết:** token thô = `randomBytes(32)` base64url, DB chỉ lưu sha256 (`tokenHash` UNIQUE), không có dữ liệu nghiệp vụ trong URL; link dùng fragment `#token=…` (không gửi lên server/CDN/log/Referer), trang landing đọc `location.hash` rồi **lập tức `history.replaceState`** trước khi `POST verify`; bộ quét email chỉ GET trang tĩnh nên không tiêu token; token email **không bị tiêu khi verify** (chỉ khi `set-password` xong) nên mở lại link vẫn được; `verify` trả `VALID|EXPIRED|USED|INVALID` + `setupToken` 15 phút dùng 1 lần; trang verify gửi `Referrer-Policy: no-referrer`; **không log token thô ở tầng nào**. `PARTNER_APPLICATION_DEV_ECHO` chỉ cho E2E, không bật ở production. Giới hạn tần suất: theo email ở DB (an toàn nhiều instance) + theo IP ở gateway (Redis khi có `REDIS_URL`, không thì bộ nhớ — không an toàn khi scale ngang); production đặt `RATE_LIMIT_REQUIRE_SHARED=true` để gateway từ chối khởi động nếu thiếu Redis. Chặn email trùng Customer/PT/Admin **lộ sự tồn tại email** — đánh đổi đã chấp nhận (giống `POST /auth/register` trả 409), giảm nhẹ bằng giới hạn tần suất, thông điệp không nói vai trò, không có endpoint "email tồn tại?".
- **Upload hồ sơ đối tác — chi tiết:** khoá đối tượng do **server** sinh (`partner-applications/{partnerId}/{kind}/{uuid}.{ext}`), client không gửi `objectKey`; `presign` tạo `PartnerUploadIntent`, `confirm` nhận `uploadId` và chỉ chấp nhận intent của chính partner đó; presigned POST có điều kiện `Content-Type` + `content-length-range`, hạn 5 phút; `confirm` luôn `HEAD` rồi đọc **magic bytes** (`%PDF-`, PNG, JPEG, `RIFF…WEBP`), sai → xoá object + từ chối, không tin `Content-Type` của client; đọc lại bằng presigned GET ≤120 giây, giấy tờ ép `attachment`. **Không gửi header SSE tới MinIO** (MinIO từ chối nếu chưa cấu hình KMS). `partner-s3.guard.ts` làm gym-service **từ chối khởi động ở production** nếu có endpoint tuỳ chỉnh/path-style/khoá tĩnh/biến bucket công khai — phải gọi ở **cả** `server.ts`, `lambda.ts` và `jobs-lambda.ts` (từng lỗi: entrypoint Lambda không đi qua `server.ts` nên guard không chạy trên AWS). Job `partner-upload-sweep` xoá tệp của lượt tải lên hết hạn mà không bao giờ được xác nhận (xoá S3 trước, dòng DB sau để thử lại được); schedule `fitness-assistant-dev-gym-partner-upload-sweep` **đang DISABLED trên AWS dev** (kiểm 18/11/2026) — bật khi cần.
- **Khiếu nại gym (`GymComplaint`) và ghi chú nội bộ:** một bảng chung cho mọi nguồn (`SELF_DETECTED`/`MEMBER_REPORT`/`PT_REPORT`/`PARTNER_DISCLOSED`); trạng thái `OPEN → IN_PROGRESS → RESOLVED`, `RESOLVED` là cuối — không kháng nghị, không hội thoại (một `adminResponse` cuối), không tự động hoàn tiền, không báo cáo ẩn danh. Hội viên chỉ báo cáo được nếu có gói đang `ACTIVE` hoặc hết hạn ≤ **30 ngày** tại đúng chi nhánh (chặt hơn luật đánh giá "từng trả tiền"). Ảnh bằng chứng riêng tư, chỉ người tải lên hoặc admin xem; giải quyết gửi thông báo `GYM_COMPLAINT_RESOLVED` qua `POST /internal/notifications` của user-service. Ghi chú nội bộ `PartnerInternalNote` **chỉ** có ở route admin (`/admin/partners/:id/internal-notes`), không bao giờ ở `owner.routes.ts` (vì thế chủ gym không thấy).
- **Nhãn tiếng Việt cho trạng thái (không bao giờ hiện enum thô; mỗi nhãn kèm icon + chữ + màu, không chỉ màu):** `PROSPECT` "Tiềm năng", `INVITED` "Đã mời, chờ thiết lập", `ACTIVE` "Đang hoạt động", `SUSPENDED` "Đang tạm khoá", `TERMINATED` "Đã chấm dứt hợp tác", `NOT_VERIFIED` "Chưa thẩm định", `IN_REVIEW` "Đang xem xét", `NEEDS_INFO` "Cần bổ sung hồ sơ", `VERIFIED` "Đã thẩm định", `REJECTED` (thẩm định) "Đã từ chối thẩm định", chi nhánh `PENDING_REVIEW` "Đang chờ duyệt", `APPROVED` "Đã duyệt", `REJECTED` "Đã từ chối", `SUSPENDED` "Đã tạm khoá", `OPEN` "Đang mở cửa", `TEMPORARILY_CLOSED` "Tạm đóng cửa", `PERMANENTLY_CLOSED` "Đã đóng cửa vĩnh viễn". `REJECTED` thẩm định và `rejectedAt`/`rejectionReason` của PROSPECT luôn đi cùng nhau (`reject`/`reopen`); mọi chuyển thẩm định khác đi qua `setVerificationStatus`, nơi **từ chối** giá trị `REJECTED` để chỉ có một đường tới nó. Đối tác đã qua `PROSPECT` trước khi cột thẩm định ra đời được backfill `VERIFIED` (không khoá chủ gym thật).

### 2.10 Tin đăng và kiểm duyệt

- **Phạm vi:** PT (user-service) và chi nhánh gym (gym-service) dùng cùng máy trạng thái bản sửa: `DRAFT → PENDING → APPROVED | REJECTED | CHANGES_REQUESTED | WITHDRAWN | STALE`. Mỗi PT/chi nhánh tối đa **1 bản mở**; `PENDING` khoá sửa (409 `REVISION_UNDER_REVIEW`); mọi chuyển trạng thái là `UPDATE … WHERE status = <cũ>` nên đua nhau chỉ một thắng; bản đóng bất biến (trigger Postgres).
- **Khoá lạc quan hai bộ đếm:** `DRAFT_STALE` (nháp bị sửa nơi khác) và `LISTING_STALE` (tin công khai đã đổi từ lúc soạn → `rebase`); hai 409 kèm `revision` + `listingVersion`.
- `reject`/`request-changes` bắt buộc `note` (1–1000 ký tự). **Admin direct-edit:** `reason` ≥10 ký tự + `expectedListingVersion` khớp, tạo bản `APPROVED` với `source = ADMIN_DIRECT`; bản `PENDING` đang có chuyển `STALE` + DRAFT con đã rebase; Admin chỉ sắp xếp/gỡ ảnh PT đang công khai, **không thêm** (không ai ngoài PT đưa ảnh hình thể lên).
- **Trường chỉ đổi qua duyệt:** PT — hồ sơ chữ (bio/phương pháp ≤2000 ký tự, chuyên môn/nhóm khách/mục tiêu ≤10 mục), gói dịch vụ (giá ≤1 tỷ, 1–200 buổi, 15–240 phút, `validityDays` 1–3650), ảnh hình thể ≤ **5** công khai; Gym — `description` ≤ **300** ký tự, tiện ích tổng ≤ 60 (gửi duyệt cần ≥1 tiện ích hoặc đề xuất), ảnh ≤ **20**. Chi nhánh chỉ có bản sửa khi `APPROVED` hoặc `SUSPENDED` và chưa đóng vĩnh viễn. Tên/địa chỉ gym đổi vào `pendingName/pendingAddress`, admin duyệt mới thành `approvedName/approvedAddress`; `city`, `phone`, `email`, vị trí, giờ mở cửa vẫn sửa trực tiếp, không qua duyệt. Hợp đồng đã tạo không đổi theo tin đăng.
- **Tiện ích:** catalogue chung, chỉ 2 trạng thái `ACTIVE`/`DISABLED`; tên 2–40 ký tự, duy nhất sau chuẩn hoá (bỏ dấu); đề xuất `NEW`/`REENABLE` do admin duyệt/gộp/từ chối theo nhóm; tắt một tiện ích gỡ nó khỏi mọi bản DRAFT đang mở (bản PENDING giữ nguyên). Cột `Gym.facilities` chỉ là bản sao cho app cũ (chỉ ghi qua `syncFacilitiesMirrorTx`). Tương thích app cũ mặc định bật (`LISTING_LEGACY_CLIENT_COMPAT`).
- **Vòng đời ảnh:** `STAGED → PUBLISHED → RETIRED → DISCARDED`; presign (hạn 10 phút) → upload thẳng S3 → confirm (kiểm magic bytes, sha256 tính trên byte thật, mã hoá lại WebP ≤2048 px, **xoá EXIF/GPS**, trùng hash thì dùng lại); ≤8 MB, JPEG/PNG/WebP; ảnh công khai phục vụ qua `/media/*` (chỉ khi `PUBLISHED` và chủ đang hiển thị công khai, redirect 302 tới presigned GET 10 phút); ảnh `RETIRED` giữ tệp 90 ngày; job dọn mỗi 10 phút.
- **Luật hiển thị công khai:** PT hiện khi `isPT` ∧ hồ sơ `APPROVED` ∧ `!ptSuspended` ∧ không có hạn chế phạm vi `ACCOUNT` đang mở (hạn chế `CONTRACT` không ẩn). Gym hiện trong danh sách khi `APPROVED` ∧ `OPEN` ∧ chủ không bị ẩn; trang chi tiết chấp nhận thêm `TEMPORARILY_CLOSED` (kèm lý do/ngày mở lại, nhưng mua gói/check-in vẫn bị chặn). DTO công khai là allowlist (`toPublicPtDto`, `toPublicGymDto`): không lộ `s3Key`, `storageKey`, `content_hash`, bản nháp, ảnh chưa công khai.
- Thông báo: gửi duyệt → đẩy realtime cho admin đang online (không lưu); kết quả duyệt → lưu hộp thư cho PT/chủ gym (`*_LISTING_APPROVED|REJECTED|CHANGES_REQUESTED|INVALIDATED`).

### 2.11 Điều khoản PT

- Văn bản 9 điều một nguồn (`user-service/src/services/pt-terms.ts`), hiện mã `2026-10-pt-draft-1` với `PT_TERMS_IS_DRAFT = true` — **vẫn là bản nháp**, chờ chủ dự án duyệt nguyên văn rồi phát hành dưới mã chính thức mới (mọi PT phải xác nhận lại).
- Cổng trung tâm `assertPtTermsForNewContract`: PT **chưa xác nhận đúng phiên bản đang phục vụ thì không nhận được hợp đồng mới** (409 `PT_TERMS_NOT_ACCEPTED`), áp cho cả `acceptContract` và nhánh admin; hợp đồng `ACTIVE` đã có không đổi. Xác nhận lưu ở bảng `pt_terms_acceptances` (nguồn `APPLICATION` hoặc `RECONFIRM`); API `POST /pt-applications/terms/accept`, `GET /pt-applications/terms`.
- Điều khoản dẫn chiếu thẳng các hằng số thật (hạn thanh toán 12 giờ, khách huỷ buổi đã xác nhận thì mất buổi và PT vẫn được trả, PT huỷ thì bồi thường khách 1 buổi, hoàn 90% khi khách chấm dứt hợp đồng…), và chốt phát hành `check-pt-terms-release` ngăn phát hành nhầm bản nháp. Holdback 10% chỉ được bật khi điều khoản đã phát hành chính thức và PT đã xác nhận đúng bản đó (§2.6).
- Chưa xong: Điều 5 (nguồn tiền bồi hoàn) chờ quyết định; lưu IP/user-agent chờ chính sách quyền riêng tư; cảnh báo cho khách khi PT chưa xác nhận.

### 2.12 Mâu thuẫn tài liệu cũ so với mã (ghi nhận khi đối chiếu)

| Chỗ | Tài liệu cũ nói | Mã thực tế (đã theo) |
|---|---|---|
| PT vắng buổi | trừ `totalSessions` đi 1 (sơ đồ vòng đời, kịch bản C "còn 9 buổi", mô tả dời lịch) | `totalSessions`/`price` **bất biến**; tăng `compensatedSessions` |
| Cổng thanh toán | VNPay / ZaloPay / MoMo; "MOCK bị xoá"; "PayOS/Stripe/chuyển khoản" còn trong enum | chỉ `vnpay` + `zalopay` có provider; enum còn `MOCK/MOMO/PAYOS/STRIPE/MANUAL_BANK_TRANSFER` (chỉ để giữ lịch sử) |
| Cộng tác PT–gym | thoả thuận theo từng chi nhánh (`GymPtCollaboration`) | thoả thuận cấp thương hiệu (`GymBrandPtAgreement`) là chuẩn; bản theo chi nhánh chỉ còn cho cặp chưa chuyển |
| Hạn chế PT | chỉ có "khoá tài khoản" = cấm vĩnh viễn, không tạm khoá, không đóng băng | đã có `pt_restrictions` 3 mức, tạm đình chỉ không chấm dứt hợp đồng, khách rút không phạt (`client-exit.service.ts`) |
| Bốn mắt rút tiền | "duyệt (tuỳ chọn) rồi chi"; quyền admin một cấp, không hai người | khoản ≥ 5.000.000đ bắt buộc admin duyệt ≠ admin xác nhận đã chi (`FOUR_EYES_REQUIRED`) |
| Gói dịch vụ PT | PT tự tạo/sửa/xoá gói qua `/profile/me/service-packages` | các route ghi trả 409 `LISTING_REVIEW_REQUIRED`; đổi gói qua Tin đăng có duyệt |
| Vai trò đối tác gym | chỉ `OWNER` / `MANAGER` | thêm `RECEPTIONIST`, `ACCOUNTANT` (`partner-permissions.ts`) |
| Ký điện tử | "tắt" | mặc định mã là bật; tắt bằng `REQUIRE_CONTRACT_ESIGN=false` (đã đặt ở các compose dev/E2E/scale) |
| Phase 3 | "chỉ cổng MOCK/sandbox" | MOCK không còn provider; thanh toán thật qua VNPay/ZaloPay |


## 3. Kiến trúc & vận hành

Phần này mô tả hệ thống đang chạy thật (đối chiếu với `infra/compose/*.yml`, `package.json`, `.env.example`, code các service). Khi tài liệu cũ và cấu hình lệch nhau, cấu hình/code là nguồn đúng.

### 3.1 Sơ đồ dịch vụ & cổng

Gymini là monorepo pnpm (`pnpm-workspace.yaml`: `frontend/*`, `backend/gateway`, `backend/services/*`, `backend/shared`). Trình duyệt/app chỉ nói chuyện với **gateway** (Express, cổng 3000); gateway xác thực JWT rồi proxy sang service đích.

| Thành phần | Thư mục | Cổng host (dev compose) | Container dev |
|---|---|---|---|
| Web (Vite dev server) | `frontend/web` | 5173 | `gymcoach-web-dev` |
| API gateway | `backend/gateway` | 3000 | `gymcoach-gateway-dev` |
| auth-service | `backend/services/auth-service` | 3001 | `gymcoach-auth-dev` |
| fitness-service | `backend/services/fitness-service` | 3002 | `gymcoach-fitness-dev` |
| ai-service | `backend/services/ai-service` | 3003 | `gymcoach-ai-dev` |
| user-service | `backend/services/user-service` | 3004 | `gymcoach-user-dev` |
| chat-service | `backend/services/chat-service` | 3005 | `gymcoach-chat-dev` |
| gym-service | `backend/services/gym-service` | 3006 | `gymcoach-gym-dev` |
| payment-service | `backend/services/payment-service` | 3007 | `gymcoach-payment-dev` |
| PostgreSQL | image Postgres | **5433** (→ 5432 trong container) | `gymcoach-postgres` |
| Redis | | 6379 | `gymcoach-redis` |
| Qdrant | vector DB | 6333 (REST), 6334 (gRPC) | `gymcoach-qdrant` |
| MinIO (S3 cục bộ) | | 9000 (API), 9001 (console) | `gymcoach-minio` (+ `minio-init` tạo bucket) |
| Ollama (profile `local-ollama`) | | 11434 | `gymcoach-ollama` |
| Prometheus / Grafana (profile `observability`) | | 9090 / 3100 | |

Vai trò từng service (tóm tắt):

- **auth-service**: tài khoản, mật khẩu, JWT (access token mặc định **15 phút**, refresh **7 ngày**, đổi được bằng `JWT_ACCESS_EXPIRY`/`JWT_REFRESH_EXPIRY`), OTP, audit đăng nhập.
- **user-service**: hồ sơ người dùng (`UserProfile`), InBody, hồ sơ PT, hợp đồng PT-khách, buổi tập 1-1, địa điểm/tỉnh-phường, khiếu nại (dispute), upload ảnh; chạy thêm bước nạp 34 tỉnh + 3.321 phường lúc khởi động.
- **fitness-service**: bài tập, chương trình tập, nhật ký tập, Roadmap/Phase/TrainingCycle/CycleAssessment, dinh dưỡng (`NutritionGoal`, `NutritionProgram`), danh mục thực phẩm.
- **ai-service**: AI Coach (chat/SSE), sinh kế hoạch tập/ăn bất đồng bộ (BullMQ), RAG trên Qdrant, pipeline tri thức/bằng chứng.
- **gym-service**: phòng gym, chi nhánh, gói hội viên, tin đăng, check-in QR, đánh giá, đối tác gym.
- **payment-service**: ví, ledger, escrow, nạp tiền (VNPay/ZaloPay), rút tiền, hoàn tiền.
- **chat-service**: hội thoại, thông báo realtime, báo hiệu cuộc gọi thoại/video (Socket.IO).

Ghi chú: gateway có route riêng cho từng prefix (`/auth`, `/profile`, `/workouts`, `/ai`, `/chat`, `/payments`, `/gyms`, …) trong `backend/gateway/src/routes/proxy.routes.ts`; ảnh trong bucket MinIO cũng được gateway proxy (`/<bucket>/...`) để link ký sẵn dùng được qua LAN/tunnel.

Biến thể compose khác (xem 3.7): prod 1-EC2 (`docker-compose.prod.yml`, **không có chat-service**, Postgres là RDS), môi trường scale (`docker-compose.scale.yml`, cổng 59xxx), E2E dispute (`docker-compose.e2e-dispute.yml`, cổng 58xxx), test (`docker-compose.test.yml` ở gốc repo, cổng 55433/56379/56333).

### 3.2 Cơ sở dữ liệu

- **Mỗi service một database riêng trên cùng một Postgres** (không có FK xuyên service; liên kết giữa service chỉ bằng `userId`/id logic, tính nhất quán do tầng ứng dụng giữ).
  `infra/compose/postgres-init.sql` tạo 7 DB: `gymcoach_auth`, `gymcoach_user`, `gymcoach_fitness`, `gymcoach_ai`, `gymcoach_chat`, `gymcoach_payment`, `gymcoach_gym`.
  (Tài liệu kiến trúc cũ ghi "một database `gymcoach` chung cho 4 service" — đã lỗi thời.)
- ORM: **Prisma 5** (`prisma/schema.prisma` mỗi service; chat-service đọc `CHAT_DATABASE_URL`).
- Redis: cache (fitness) + hàng đợi BullMQ (`workout-generation` ở fitness, `ai-tasks` ở ai-service) + store dùng chung cho rate limit gateway. Qdrant: kho vector cho RAG.
- **Quy tắc migration**
  - Migration được commit trong `prisma/migrations/` và áp bằng `prisma migrate deploy` (Dockerfile.dev/compose chạy lệnh này lúc khởi động; build chỉ `prisma generate`).
  - Migration phải **viết tay có kiểm soát**; **không** chạy `prisma migrate dev`, `migrate reset`, `db push` lên DB dev/official. CLI test của repo (`test:db:*` trong user/gym/chat-service) từ chối `migrate dev`, `migrate reset`, `db execute`, `studio`, `--force-reset` (`backend/services/user-service/src/__tests__/setup/README.md`).
  - Lưu ý: script `db:migrate` trong `package.json` các service hiện trỏ tới `prisma migrate dev` — **đừng dùng** cho DB dev/official, dùng `migrate deploy`.
  - Một số model từng chưa có file migration (dựng DB mới bằng `migrate deploy` có thể thiếu bảng) — kiểm tra trước khi dựng DB trống.
- Công cụ liên quan: `tools/db-migrator/README.md` (ECS one-shot chuyển 7 DB local sang Aurora: các chế độ `preflight`, `schema-audit`, `apply-prepatch`, `restore`, `verify`; `restore` là thao tác **xoá** dữ liệu đích rồi nạp lại).
- Lệnh gốc repo hữu ích: `pnpm prisma:generate` (cả 7 service), `pnpm prisma:migrate:test` (`scripts/prisma-test.mjs`), `pnpm lint` (`scripts/check-repo-hygiene.mjs`).

### 3.3 AI

**Nhà cung cấp & mô hình** (mặc định trong `docker-compose.dev.yml`/`.env.example`):

| Mục | Giá trị mặc định | Ghi chú |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | còn `anthropic` (cần `ANTHROPIC_API_KEY`) và `openai` (tương thích OpenAI) |
| `LLM_MODEL` | `qwen3:4b-instruct-2507-q4_K_M` | chat, JSON, kế hoạch, tool call |
| `EMBEDDING_MODEL` | `nomic-embed-text` (768 chiều) | **luôn** chạy qua Ollama, kể cả khi `LLM_PROVIDER=anthropic`; mô hình chat không bao giờ dùng làm embedding |
| `LLM_BASE_URL` / `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama chạy trên Windows host |
| `LLM_TIMEOUT_MS` / `EMBEDDING_TIMEOUT_MS` | 300000 / 120000 | |
| `LLM_NUM_CTX` / `LLM_JSON_NUM_CTX` | 8192 / 8192 | |

**Ba cách chạy Ollama**:
1. Khuyến nghị: Ollama trên Windows, mở `OLLAMA_HOST=0.0.0.0:11434 ollama serve` (không phải 127.0.0.1, nếu không container không gọi được qua `host.docker.internal`).
2. Docker-local: `docker compose -f infra/compose/docker-compose.dev.yml --profile local-ollama up -d --build` (service `ollama` + `ollama-model-puller`, CPU, kéo `LOCAL_OLLAMA_CHAT_MODEL` và `EMBEDDING_MODEL`).
3. Ollama từ xa qua tunnel SSH riêng: trỏ `LLM_BASE_URL`/`OLLAMA_BASE_URL` về cổng tunnel trên host; không mở Ollama ra Internet.

**RAG (Qdrant)** — runtime không huấn luyện mô hình:
- Collection: `exercises` (chỉ cho chat AI Coach), `fitness_knowledge`, `fitness_faq`, `fitness_evidence`.
- Sinh kế hoạch tập **không** chọn bài từ Qdrant: dùng danh mục bài tập của fitness-service (id thật), chỉ truy xuất `fitness_evidence` khi cần lập luận thể thành phần cơ thể.
- Trích dẫn bằng chứng phải lấy từ metadata đã truy xuất (title/source_url/…), không lấy từ chữ model sinh ra.
- Nạp/làm mới (chạy trong `backend/services/ai-service`): `pnpm run ingest -- --collection=all`, `pnpm run ai:reindex`, `pnpm run data:validate`, `pnpm run data:ingest`. Đánh giá: `ai:test:rag`, `ai:eval:retrieval`, `test:evaluation`, `test:policy`.
- Pipeline nghiên cứu/bằng chứng (`src/knowledge`): chỉ chạy khi `ENABLE_RESEARCH_AUTOMATION=true`; nguồn allowlist (PubMed, PMC, Crossref, OpenAlex, hướng dẫn chính thức), có hàng đợi duyệt `data/research_review_queue.jsonl`; `knowledge-worker` là profile `knowledge`.
- Huấn luyện QLoRA là quy trình riêng thủ công, xem `training/README.md`; không thuộc khởi động ứng dụng.

**Kế hoạch & chat**
- Kế hoạch tập/ăn là job bất đồng bộ (BullMQ): API tạo job → worker sinh JSON + validate → client poll/nhận socket `ai:plan:job:*`. Timeout chỉnh qua `AI_PLAN_TIMEOUT_MS`, `AI_PLAN_RETRY_TIMEOUT_MS`.
- Chat có ngân sách thời gian riêng cho context/RAG/evidence/LLM (`AI_CHAT_*_TIMEOUT_MS`). Khi UI báo "chưa có phản hồi chi tiết": kiểm tra `/health` (cả model chat và embedding), log AI (timeout/model thiếu), collection Qdrant, rồi cờ `usedFallback`/`fallbackReason` trong response.

**Vision (ảnh) và dự phòng Gemini**
- Quét InBody (user-service, `INBODY_VISION_PROVIDER`, mặc định hiện là `anthropic`, model `INBODY_VISION_MODEL`) và ảnh trong AI Coach (image-chat, goal-image trong ai-service) gọi **Claude (Anthropic) trước**.
- Nếu Anthropic không phục vụ được (hết tín dụng/billing, 401/403/429/529, 5xx, mạng, thiếu key) → **dự phòng Gemini** qua REST (`GEMINI_API_KEY`, danh sách model `GEMINI_VISION_MODELS`, mặc định `gemini-3.5-flash,gemini-3-flash-preview`). Lỗi "câu trả lời Anthropic không dùng được" (`VisionUnusableError`) thì **không** fallback. Không log khóa, ảnh hay nội dung trả lời.
- `GEMINI_API_KEY` không có trong `.env.example` (đặt tay trong `.env`). Tuyệt đối không commit khóa API.
- Nhánh Ollama cho InBody (`INBODY_VISION_OLLAMA_MODEL=qwen2.5vl:3b`) còn trong code nhưng đang không dùng làm mặc định.

### 3.4 Realtime, chat & gọi video

- Hai kênh Socket.IO:
  1. **Gateway socket** (`/socket.io`, mặc định `VITE_SOCKET_URL`=gateway): JWT đặt trong `socket.handshake.auth.token`, gateway xác thực qua auth-service. Dùng cho thông báo, tin nhắn chat, tiến trình job AI, số liệu dashboard, presence.
  2. **Chat-service socket** cho báo hiệu cuộc gọi thoại/video (`call:*`). Đường chuẩn là **qua gateway** ở path `/chat-socket.io` (gateway rewrite sang `/socket.io` của chat-service và forward cả WebSocket upgrade); web dev dùng Vite proxy cùng path; `VITE_CHAT_WS_URL` (trỏ thẳng cổng 3005) chỉ là ghi đè tuỳ chọn.
- REST vẫn là nguồn sự thật cho dữ liệu lưu trữ; socket chỉ đẩy sự kiện.
- Sự kiện server: `notification:new`, `chat:message:new` (+ tương thích cũ `chat:new_message`, `chat:conversation_updated`), `chat:typing`, `chat:error`, `ai:coach:chunk|done|error`, `ai:plan:job:created|progress|completed|failed`, `dashboard:metrics:update`, `user:presence:update`. Sự kiện client: `chat:join_conversation|leave_conversation`, `chat:message:send` (+ `chat:send_message` cũ), `chat:typing`, `ai:plan:subscribe|unsubscribe`, `dashboard:subscribe|unsubscribe`.
- Phòng (rooms): `user:{userId}`, `role:{role}`, `chat:{conversationId}` (join được kiểm với chat-service bằng JWT), `ai-job:{jobId}`, `dashboard:{scope}`.
- Bẫy đã biết: gateway dùng lại JWT lúc bắt tay suốt đời kết nối nên socket chết sau ~15 phút (hết hạn access token); mobile đã vá bằng cách nối lại; quyết định backend còn treo.
- Kiểm tra thủ công nhanh: đăng nhập 2 người cùng hội thoại ở 2 trình duyệt, gửi tin từ A → B thấy ngay không cần reload; reload cả hai thì tin vẫn còn (nhờ REST).

### 3.5 Miền tập luyện & dinh dưỡng (tóm tắt)

Chuỗi sở hữu dữ liệu (không tạo nguồn sự thật thứ hai — bảng đầy đủ ở `CLAUDE.md`):

```
UserProfile + InBody (đo thật)
   └─> FitnessRoadmap  (hành trình dài hạn)
         └─> RoadmapPhase  (giai đoạn chiến lược)
               └─> TrainingCycle  (một khối thực thi/đánh giá, ~4 tuần)
                     ├─ WorkoutProgram (đơn tập) ── WorkoutSchedule (lịch thực thi thuộc chu kỳ;
                     │                              đây là liên kết thật program↔cycle)
                     └─ CycleAssessment (quyết định thích ứng: KEEP / PROGRESS / ADJUST / DELOAD / REBUILD)
NutritionGoal (calo/macro có phiên bản) ──sourceGoalId──> NutritionProgram (thực đơn)
```

- **Đo vs. trạng thái vs. mục tiêu vs. kê đơn là năm khái niệm khác nhau**: InBody (append-only) → `UserProfile.currentWeight` (cache "mới nhất") → `startingWeight` (đặt một lần cho cả hành trình) → `TrainingCycle.baselineMetrics` (đặt một lần mỗi chu kỳ) → `targetWeight` (chỉ đổi khi người dùng sửa hồ sơ) → `NutritionGoal` (hàng ACTIVE mới mỗi lần đổi, hàng cũ thành `SUPERSEDED`).
- **Đánh giá chu kỳ** (`POST /training-cycles/:id/evaluate`, đồng bộ): `cycle-metrics.engine.ts` tính chỉ số (tuân thủ, tiến bộ sức mạnh, mệt mỏi/đau, xu hướng thành phần cơ thể, chất lượng dữ liệu) → `cycle-decision.engine.ts` ra quyết định có kiểm soát (5 cổng `INSUFFICIENT_DATA` rồi điểm tổng hợp có trọng số) → ai-service chỉ **giải thích** (RAG + LLM, quyết định luôn bị ghi đè bằng giá trị của engine, đề xuất ngoài `allowedChanges` bị lọc). Người dùng Accept/Reject chỉ ghi `userDecision`, không tự tạo/kích hoạt kế hoạch mới.
- **Tiến triển từng bài tập** (`exercise-progression.engine.ts`): quyết định của chu kỳ là trần của quyết định bài tập (`DELOAD` ép bài tập về DELOAD; `REBUILD` → REVIEW; không có chu kỳ = như `KEEP`).
- **Dinh dưỡng**: user-service giữ onboarding/sàng lọc/InBody; fitness-service giữ `NutritionGoal`/`NutritionProgram`/hoàn thành bữa/engine quyết định (`nutrition-bootstrap.engine.ts` tạo goal đầu tiên xác định, `nutrition-decision.engine.ts` điều chỉnh thích ứng; **engine xác định quyết định, LLM chỉ giải thích**). Chỉ mục duy nhất từng phần bảo đảm mỗi user có một goal ACTIVE và một chu kỳ ACTIVE; protein không bị giảm khi giảm calo.
- **Dự báo** (`fitness-roadmap-forecast.engine.ts`) chỉ là kịch bản không ràng buộc, không bao giờ ghi đè số đo thật.

#### 3.5.1 Bổ sung cho miền tập luyện (gộp 18/11/2026 từ các thiết kế roadmap/bài tập 9/2026)

> Lấy từ tài liệu thiết kế 9/2026 (đã lưu trữ ngoài repo); mã vẫn là nguồn đúng.

- **Danh tính bài tập chỉ là `Exercise.id`.** Không dùng tên, bí danh, tên nguồn, id ngoài, kiểu vận động/dụng cụ/nhóm cơ làm danh tính thay thế; `ExerciseSource(sourceName, externalId)`, `ExerciseAlias` và khớp tên đã chuẩn hoá chỉ là đầu vào của bộ phân giải. Lưu tự động chỉ ghi `WorkoutProgramExercise.exerciseId` sau khi phân giải được, theo thứ tự: `exerciseId` tường minh → `sourceName + externalId` → bí danh → tên chuẩn hoá **chỉ khi duy nhất**. Nếu `exerciseId` tường minh có nhưng sai/đã lưu trữ/chưa xuất bản/người gọi không thấy → **ghi thất bại, không lùi về khớp tên**. Hiển thị khi ghi: `SYSTEM + PUBLISHED + archivedAt=null` hoặc `USER_CUSTOM` của chính người gọi; chợ/xác thực công khai chỉ `SYSTEM + PUBLISHED`; đọc lịch sử theo FK vẫn giải được bài đã ngừng dùng. Tên trùng được phép trong kho nhưng **không** làm danh tính lưu tự động (7 nhóm trùng đã thấy 9/2026, một số không gộp mù vì khác dụng cụ/kiểu vận động); hợp đồng AI: fitness-service đưa danh sách cho phép có giới hạn, AI chỉ được trả `exerciseId` trong danh sách, tên/ghi chú của AI không bao giờ là danh tính, fitness-service là thẩm quyền cuối lúc áp dụng; thay thế bài dựa trên `Exercise.id` + bộ chấm điểm xác định theo dụng cụ/kiểu vận động/nhóm cơ.
- **Roadmap REBUILD (xem trước → áp dụng):** chỉ khi pha `ACTIVE` có chu kỳ vừa `COMPLETED/ANALYZED`, không còn chu kỳ `ACTIVE`, `CycleAssessment` mới nhất có `decision = REBUILD` và chưa có quyết định tập/dinh dưỡng chờ duyệt, và chưa có `RecommendationAudit` `ROADMAP_REBUILD_APPLIED` cho `assessmentId` đó. Đề xuất mặc định (không AI/PT): chèn **một pha `RECOVERY` 14 ngày** (`maxCycles = 1`) rồi nối lại mọi pha `PLANNED` còn lại **nguyên trạng**, giữ độ dài gốc, dời mốc thời gian (giống `DELOAD` ở mức pha). Áp dụng trong một transaction với khoá advisory `fitness-roadmap:<userId>` (cùng khoá `activate/advance/archive`): pha hiện tại → `COMPLETED`, mọi pha `PLANNED` phía sau → `SKIPPED` (không xoá), tạo pha mới với `phaseIndex` tiếp theo `max + 1` toàn roadmap, kích hoạt pha đầu bằng `activatePhaseInTransaction`; idempotent theo `assessmentId` (đã áp dụng thì trả lại projection hiện tại).
- **Nháp roadmap do AI (`generateAiRoadmapDraft`) không bao giờ ghi DB:** chỉ `acceptAiRoadmapDraft` tạo roadmap thật (qua `createDraftRoadmap`). Hai lớp kiểm độc lập: ai-service (Zod: `phaseType` hợp lệ, 1–12 pha, mỗi pha 1–26 tuần; `callLlmJson` thử lại 3 lần) và fitness-service (tự kiểm lại enum `phaseType` bằng schema của riêng nó, không import từ ai-service; bỏ giá trị ngoài enum). Kẹp xác định: mỗi pha 1–26 tuần, tổng ≤ **104 tuần** (phần vượt bị bỏ kèm cảnh báo, không cắt thầm), `safetyScreeningStatus = FOLLOW_UP_SUGGESTED` luôn ép thêm cảnh báo phía server, không còn pha hợp lệ → một pha `FAT_LOSS` mặc định. AI hỏng/hết giờ → bản nháp dự phòng xác định một pha (độ tin cậy 0, có cảnh báo), không bao giờ ném lỗi.

### 3.6 Mobile

- **Expo là ứng dụng mobile DUY NHẤT** (`frontend/mobile`, Expo 57 / React Native 0.86 / expo-router, NativeWind). **Capacitor đã ngừng từ 17/10/2026** — không lên kế hoạch/build/test Capacitor nữa.
- Kiểm thử UI: **Maestro** (flows ở `frontend/mobile/.maestro/listing/`, xem README ở đó; chỉ nói chuyện với gateway, đọc thông tin đăng nhập từ biến môi trường, không commit mật khẩu, nhớ làm sạch `commands*.json` của Maestro). Unit/component: `pnpm --filter mobile test` (`tsx --test` + `jest`), HTTP e2e: `test:e2e`.
- **Android App Links**: `app.json` khai `intentFilters` cho `https://gymini.vn` và `https://www.gymini.vn` với `pathPrefix /gyms/` (kèm scheme tuỳ biến `fitnessassistant`); web phát `assetlinks.json`. Link được giữ qua đăng nhập khi khởi động nguội và mở trang đích với neo trang chủ bên dưới (nút back hệ thống không thoát app).
- Mobile gọi cùng gateway (chat qua `EXPO_PUBLIC_CHAT_WS_URL`/gateway); push qua Firebase (khóa service-account nằm trong thư mục `secret/` bị gitignore, mount read-only vào user-service; thiếu thư mục = tắt push).
- Quy ước adapter Web→RN đã chốt: lưu trữ qua AsyncStorage/`expo-secure-store`; upload multipart bằng `File` của Expo; SSE AI Coach bằng `expo/fetch`; socket phải nối lại theo `AppState` khi app quay về foreground; thanh toán VNPay/ZaloPay mở trình duyệt ngoài.
- **Bẫy**: `nativewind` phải giữ đúng **4.2.6**; `pnpm add` có thể âm thầm làm hỏng các junction `D:/.rn*` (do `plugins/shortenPackagePaths.js` né MAX_PATH của Windows), và sửa file trong các thư mục đã relocate thì phải kill `node` và `expo start --clear`; kiểm tra bundle không chứa 2 bản react-native (nguyên nhân mọi lỗi view-config/SIGSEGV lạ).

#### 3.6.1 Quy ước adapter Web → React Native bổ sung (gộp 18/11/2026 từ `MOBILE_PLATFORM_ADAPTERS.md`, `PERFORMANCE_BASELINE.md`)

- **Tệp/ảnh:** `FormData` giữ được với axios nhưng giá trị là `{ uri, name, type }` (không phải `File`/`Blob`), `uri` lấy từ `expo-image-picker`/`expo-camera`/`expo-document-picker`. **Tải xuống** không có trình duyệt: ghi vào `documentDirectory` bằng `expo-file-system` rồi `expo-sharing` `shareAsync` (không có thư mục Downloads phổ quát; Android 13+ scoped storage). **Xem PDF/giấy tờ:** không có trình xem gắn sẵn — `expo-web-browser` `openBrowserAsync` tới URL, hoặc tải về rồi mở bằng intent hệ điều hành. Chia sẻ text/URL dùng `Share` gốc; sao chép dùng `expo-clipboard`.
- **Thanh toán cổng:** mở trình duyệt ngoài bằng `WebBrowser.openBrowserAsync` (resolve khi người dùng đóng tab); **luôn xác nhận kết quả qua `/payments/:id/sync`, không tin tham số trả về**.
- **Socket:** phải nghe `AppState` (`change → active`) để chủ động `connect()` lại + refetch dữ liệu có thể lệch (tin nhắn mới, trạng thái cuộc gọi), không giả định socket tự hồi phục (đã kiểm trên emulator: nền lâu + mất mạng → quay lại tự nối lại ~3 s; chưa kiểm kịch bản hãng điện thoại diệt app nền).
- **Giao diện:** bàn phím — `KeyboardAvoidingView` (`behavior="padding"` trên iOS, **`undefined` trên Android** vì Android tự resize cửa sổ; ép `behavior` gây đẩy hai lần) kèm `ScrollView keyboardShouldPersistTaps="handled"`; không thêm `react-native-keyboard-controller` cho tới khi có dữ liệu đo. **Safe area:** `SafeAreaProvider` ở `app/_layout.tsx`, mọi màn có header/tab bar dùng `SafeAreaView`/`useSafeAreaInsets()`. **Nút back Android:** mặc định (pop stack) thường đúng; chỉ tuỳ biến khi sheet đang mở (đóng sheet trước), form dở dang (hỏi xác nhận), cuộc gọi video đang active (không thoát ngay).
- **Quyền & push:** mỗi module native tự xin quyền và phải khai báo trong `app.json` (`plugins`/`permissions`); xử lý "từ chối vĩnh viễn" bằng `Linking.openSettings()`. **Push (`expo-notifications`/FCM) là tính năng MỚI so với bản Capacitor cũ** (bản cũ chỉ có thông báo trong app) — không phải cổng 1:1 từ web nên cần thiết kế UX riêng.
- **Hiệu năng (nguyên tắc từ `PERFORMANCE_BASELINE.md`):** danh sách dài (thư viện bài tập/thực phẩm, lịch sử giao dịch, học viên/chi nhánh) dùng `FlatList`/`FlashList` với `keyExtractor` ổn định và item memo hoá; ảnh dùng `expo-image` (cache đĩa/bộ nhớ, placeholder), **không tải ảnh full-size cho thumbnail**; đo bằng release build, số liệu thật trước khi báo "xong"; chỉ số vượt ngưỡng thì báo cáo + đề xuất khắc phục (ảo hoá list, cache ảnh, giảm re-render, giảm API song song), **không tự nới ngưỡng**; chạy lại toàn bảng trên thiết bị thật trước khi coi là ổn định.

### 3.7 Chạy local (dev compose)

Yêu cầu: Windows + Docker Desktop (Linux containers), Node ≥ 20, pnpm 8 (corepack), Ollama nếu dùng AI.

```powershell
Copy-Item .env.example .env        # lần đầu; không commit .env
corepack enable; pnpm install
docker compose -f infra/compose/docker-compose.dev.yml up -d --build
docker compose -f infra/compose/docker-compose.dev.yml ps
```

Script tiện lợi ở gốc: `pnpm docker:up|down|build`, `pnpm docker:reset-seeder`, `pnpm seed:cleanup`.

**Các file compose** (`infra/compose/`):

| File | Mục đích |
|---|---|
| `docker-compose.dev.yml` | stack dev hot-reload (bind-mount `src/`; `tsx watch` cho backend, Vite cho web) |
| `docker-compose.low-resource.yml` | override cho laptop yếu: giới hạn CPU/RAM, giảm polling (`-f dev.yml -f low-resource.yml`) |
| `docker-compose.dispute-dev.yml` | override bật Dispute V2.1 trên dev (cổng "dev-shared"; bỏ file này = khoá lại hết) |
| `docker-compose.e2e-dispute.yml` | môi trường E2E dispute cách ly (project `gymini-e2e-dispute`) |
| `docker-compose.scale.yml` | môi trường scale cách ly (project `gymini-scale`, Postgres/Redis/MinIO riêng, cổng 59xxx bind 127.0.0.1) |
| `docker-compose.prod.yml` | 1 EC2, Postgres = RDS, không bind-mount, không có chat-service |
| `scripts/seed-marketplace/official/compose.official.override.yml` | trỏ auth/user/gym/payment/chat/gateway sang DB `_official` |

**Profile trong dev compose** (chỉ 3 profile tồn tại): `local-ollama` (Ollama + model puller), `knowledge` (knowledge-worker), `observability` (Prometheus, Grafana, postgres/redis exporter). Ví dụ: `docker compose -f infra/compose/docker-compose.dev.yml --profile knowledge up -d knowledge-worker`.

**Kiểm tra sức khoẻ**: `GET http://localhost:3000/health` (gateway), `http://localhost:3003/health` (AI: kiểm cả model chat lẫn embedding), `http://localhost:5173` (web).

**Container chạy giờ Việt Nam** (`TZ=Asia/Ho_Chi_Minh`) — bắt buộc, vì code đọc giờ địa phương của tiến trình (đặt lịch PT, khung giờ rảnh).

**Dừng**: `... down` giữ dữ liệu; `... down -v` xoá volume (DB, Qdrant, queue, Ollama local) — chỉ khi chủ ý reset hoàn toàn, **không** dùng lên volume dev đang giữ dữ liệu thật của đợt test.

**Tài khoản seed của dev compose** (`db-seeder`, script `scripts/seed-test-users.mjs`): khách `testuser001..100@example.com`, PT `testpt001..005@example.com`, mật khẩu `Test@123456`. Bỏ qua bằng `SKIP_SEED=true`. Dọn bằng `pnpm seed:cleanup`.

### 3.8 Bẫy thường gặp khi chạy dev

| # | Bẫy | Cách xử lý |
|---|---|---|
| 1 | Dev stack hiện dùng DB `gymcoach_*_official` (từ 15/11/2026) cho auth/user/gym/payment/chat; fitness/ai vẫn ở `gymcoach_fitness`/`gymcoach_ai` | Mỗi lần `up -d --force-recreate` phải **giữ** `-f scripts/seed-marketplace/official/compose.official.override.yml`, nếu không service quay lại DB `gymcoach_<svc>` cũ (DB cũ không bị sửa, dùng làm đường lui) |
| 2 | `compose up` trơn kích hoạt `db-seeder` và gieo lại dữ liệu test cũ vào DB | Dùng `SKIP_SEED=true` hoặc `up -d --no-deps <service>` |
| 3 | `user-service` bind-mount `prisma/` và chạy `prisma migrate deploy` lúc boot | Mọi migration **chưa commit** trong working tree sẽ chạm vào DB dev ngay lần boot tới — đừng để migration nháp trong cây làm việc chính |
| 4 | `tsx watch` không nhận thay đổi trên ổ Windows bind-mount | Sau khi sửa code backend: `docker compose ... restart <service>`; container `web-dev` cũng cần restart sau khi sửa `src` (Vite polling chỉ giúp được một phần); đổi `backend/shared/src` phải `build` lại image |
| 5 | Sửa `.env` không có tác dụng với container đang chạy | `docker compose -f ... up -d --force-recreate <service>` (kèm override `_official` nếu đang dùng) |
| 6 | Test làm bẩn DB dev | Chụp `pg_dump` mọi DB `gymcoach_*` (cả `_official`) **trước** mỗi đợt test để khôi phục sau; không đụng DB dev chỉ để cho test pass |
| 7 | Mobile (emulator) 10.0.2.2 làm rơi 1 byte | Dùng `localhost` + `adb reverse tcp:3000 tcp:3000`; `nativewind` giữ 4.2.6; upload ảnh từ RN dùng `File.upload` multipart của Expo |
| 8 | Test tự động cần DB sạch | Dùng DB `*_test` (`postgres-test`, cổng 55433) và `FITNESS_DISABLE_REDIS=true` khi áp dụng; **không** trỏ test vào DB dev |
| 9 | Gateway giới hạn tốc độ `/auth/*` (khoảng 20 lần/15 phút/IP) | Lỗi 429 khi lặp đăng nhập nhiều lần là rate limit, không phải bug — chờ hết cửa sổ |
| 10 | Dịch vụ `*_PUBLIC_VIA_REQUEST` ký link ảnh theo địa chỉ người gọi | Qua LAN/tunnel ảnh vẫn hiện; đừng đặt `NODE_ENV=production` hay biến AWS khi chạy local (chặn email miền test chỉ bật khi có `AWS_LAMBDA_FUNCTION_NAME`) |
| 11 | Gateway/fitness-service không log từng request | Muốn kiểm chứng ghi dữ liệu: xem DB, log user-service, hoặc `netstat` |
| 12 | Dispute V2.1 trên dev/official: cổng khoá nếu thứ tự file compose sai | Thứ tự đúng: `dev.yml` → `compose.official.override.yml` → `docker-compose.dispute-dev.yml` (file dispute **cuối**); user/payment/gym phải cùng một họ DB |

### 3.9 Kiểm thử

| Loại | Lệnh / nơi chạy | Nhãn bằng chứng đúng |
|---|---|---|
| Unit theo service | `pnpm --filter @gym-coach/<svc> test` (`tsx --test`); gốc repo `pnpm test` (gồm `test:session`) | BACKEND INTEGRATION/CODE AUDIT tuỳ phạm vi — luôn nói rõ suite nào đã chạy |
| Docker test (cách ly) | `pnpm docker:test:fast` (cài lockfile, `prisma generate`, build, unit test, AI build, research dry-run, không Ollama thật); `pnpm docker:test:full` (Postgres/Redis/Qdrant test, `LLM_PROVIDER=mock`, seed Qdrant mẫu, smoke RAG); `USE_OLLAMA=true` để dùng Ollama thật; `docker:test:logs`, `docker:test:down` | BACKEND INTEGRATION |
| DB test thủ công | Postgres test `localhost:55433`, DB `gymcoach_<svc>_test`; phần lớn test tự **bỏ qua (không fail)** nếu `DATABASE_URL` không khớp `_test`/`postgres-test`. Với user/gym/chat-service dùng `npm run test:db:migrate` (đặt `TEST_DATABASE_URL`) rồi `npm test` | BACKEND INTEGRATION |
| Fitness-service theo nhóm | Nhóm 1: `_test`; nhóm 2 (catalog dev-seeded: thực phẩm USDA, muscle map…) cần DB dev **chỉ-đọc/đúng chủ đích**; nhóm 3 (adaptive cycle) cần `INTERNAL_SERVICE_SECRET` + `USER_SERVICE_URL`; catalog cách ly: `pnpm --filter @gym-coach/fitness-service run test:catalog:setup` rồi `test:catalog` | BACKEND INTEGRATION |
| E2E dispute cách ly | `scripts/e2e-dispute/{up,seed,status,down,reset}.sh` + `smoke.mjs`; gateway `127.0.0.1:58100`; xem `scripts/e2e-dispute/README.md`. Tài khoản/hợp đồng ban đầu = TEST FIXTURE; thanh toán/dispute/ledger chạy thật qua gateway | REAL HTTP/API (phần luồng), TEST FIXTURE (phần dựng sẵn) |
| UI mobile | Maestro (`frontend/mobile/.maestro`) trên emulator/thiết bị | Không có nhãn riêng: ghi rõ "Maestro trên emulator/thiết bị thật" (không gọi là REAL BROWSER) |
| UI web | Playwright — bộ harness E2E nằm **ngoài repo** (dự án riêng `fitnessassistant-playwright-e2e`, nhiều pha E1–E8); mỗi lần đăng nhập thật tính vào rate limit `/auth/*` | REAL BROWSER |
| AI/RAG | `ai:test:rag`, `ai:eval:retrieval`, `test:evaluation`, `test:policy`; chạy `ai:test:seed-rag` để tạo 4 collection test | BACKEND INTEGRATION |

Nguyên tắc: không gọi việc đọc code là "E2E"; không gọi dữ liệu dựng sẵn là luồng người dùng thật; không gọi suite hẹp là "toàn bộ regression"; chỉ ghi VERIFIED khi có bằng chứng.

### 3.10 Seed & dọn dữ liệu

- **Seed marketplace** (`scripts/seed-marketplace/`, chi tiết `SEED.md`): sinh dữ liệu giống thật để mọi màn hình (tìm PT/gym, workspace chủ gym/PT, hàng đợi admin) có dữ liệu — quy mô LARGE: 1.000 khách, 80 PT (ma trận trạng thái hồ sơ/tin đăng), 25 chủ gym/80 chi nhánh, 127 gói hội viên, ảnh Pexels (`assets/`, kèm `ATTRIBUTION.md`). Tài khoản seed: `<slug>@seed.gymini.test` (mật khẩu seed cố định ghi trong `SEED.md`, đổi bằng `SEED_MARKETPLACE_PASSWORD`; admin seed `marketplace-admin@seed.gymini.test`).
  - Lệnh: `node scripts/seed-marketplace/index.mjs --target test|dev|official|fresh|partner --tier a|b|all|scale`, kiểm toàn vẹn `verify-integrity.mjs --target ...`.
  - **Cẩn thận**: không truyền `--target` thì mặc định là `test` (DB `*_seed_test`, cổng 55433). Mọi target ghi thật đều cần `SEED_MARKETPLACE_CONFIRM=<target>`; seed không bao giờ UPDATE/DELETE ngoài miền seed và dừng khi trùng email với tài khoản không thuộc seed.
- **CSDL "official" cho buổi phản biện** (`scripts/seed-marketplace/official/README.md`): 5 DB `gymcoach_{auth,user,gym,payment,chat}_official` (fitness/ai không đổi). Hai lớp: **SYNTHETIC** (`--tier scale`: ~10.400 PT, 2.500 gym, 25.000 khách, `@scale.gymini.test`, chỉ để xem — thao tác tiền trả 409) và **REAL** (`--tier all`, `@seed.gymini.test`, giao dịch thật qua ví/ledger/escrow, thanh toán bằng VNPay simulator hoặc sandbox). Guard: chỉ DB đúng tên `_official`, DB đích rỗng khi nạp lớp scale, chỉ Postgres localhost, từ chối tên chứa `prod`/`staging`/`live`. Thứ tự: tạo DB → `migrate deploy` + nạp tỉnh/phường → ward geo → lớp scale (~18 phút) → dựng service trỏ `_official` kèm override seed tạm → business seed → **tắt** override seed → verify → copy avatar vào volume `user_uploads`. Đường lui = chạy lại compose không kèm override `_official`.
- **Scale benchmark** (`docker-compose.scale.yml`, project `gymini-scale`): luôn truyền `-p gymini-scale -f infra/compose/docker-compose.scale.yml`; **không** `down -v` trừ khi cố ý xoá dữ liệu.
- **Dọn dữ liệu** (`scripts/db-clean/db-clean.mjs`, xem `scripts/db-clean/README-db-clean.md`): quy trình có rào chắn `audit` (chỉ đọc) → `approve` → `freeze` → `backup` (`pg_dump -Fc` cả 7 DB + thử restore) → `clean --apply` (mỗi DB một transaction) → `verify` → `unfreeze`; có `restore`, `recover`, `status`. Hàng rào an toàn: từ chối ví còn tiền (`deletedWalletsWithMoney`), kiểm tra đối soát không đổi, kiểm tra trigger bất biến (allowlist), chỉ chạy local, đòi `DBCLEAN_CONFIRM=dev`; không có cờ override.
- **Tài khoản demo dev** `testuser*/testpt*`: gieo bởi `db-seeder` (mục 3.7), dọn bằng `pnpm seed:cleanup`.

### 3.11 Triển khai AWS dev

Nguồn: audit 11/11/2026 (**CODE AUDIT**, không gọi AWS), [`deployment/AWS_DEPLOYMENT_RUNBOOK.md`](deployment/AWS_DEPLOYMENT_RUNBOOK.md), [`deployment/AWS_DEV_DAILY_START_STOP_RUNBOOK.md`](deployment/AWS_DEV_DAILY_START_STOP_RUNBOOK.md), [`deployment/terraform-requirements-v2.md`](deployment/terraform-requirements-v2.md), `infra/terraform/**/README.md`. Phần lớn tài nguyên (Lambda, Aurora, ECS, SQS, EventBridge, Secrets…) **không có IaC trong repo** — nguồn duy nhất là script + docs, độ tin thấp hơn.

- Region `ap-southeast-1`. Web: `gymini.vn`/`www.gymini.vn` → CloudFront (S3 qua OAC). API: `api.gymini.vn` → API Gateway HTTP API (v2, **không có authorizer** — JWT kiểm trong từng service). SSE AI Coach đi riêng qua Lambda Function URL ở path `/ai/ask/stream` của CloudFront.
- Backend: mỗi service (trừ gateway Express và chat) là **Lambda Node.js 22** trong VPC (`lambda.ts`, kèm `*-jobs`, `ai-worker` (SQS), `ai-stream`, `*-migrate`); service gọi nhau bằng Lambda invoke trực tiếp. **chat-service chạy ECS Fargate** sau ALB (HTTP:80, TLS kết thúc ở CloudFront `/socket.io/*`). **Gateway Express không deploy lên AWS.**
- Dữ liệu: **Aurora PostgreSQL Serverless v2** (một cụm, mỗi service một DB logic, URL dựng lúc cold start từ Secrets Manager); không ElastiCache — AI dùng SQS thay BullMQ, rate limit bằng DynamoDB; vector = **OpenSearch Serverless**; LLM = **Bedrock** (Nova Pro; quota tài khoản chính bằng 0 nên dùng vai trò cross-account `BEDROCK_CROSS_ACCOUNT_ROLE_ARN`). Job nền = EventBridge Scheduler (13 lịch "tạm dừng được" + vài lịch riêng).
- **Mô hình chi phí on-demand** — lifecycle chạy bằng `scripts/aws/dev-start.ps1` / `dev-stop.ps1` (mặc định **dry-run**, thêm `-Execute` mới chạy thật): `-Backend` (Aurora + khôi phục lịch, tự kéo theo `-Network` NAT, `-Ai` OpenSearch VPCE, `-Secrets`), `-Chat` (ALB + ECS + đồng bộ API GW/CloudFront), `-Network`, `-Ai`, `-Secrets`. `dev-status.ps1` xem trạng thái; `dev-cost-leak-check.ps1` kiểm tài nguyên còn tính tiền; auto-stop mặc định 6 giờ (Scheduled Task Windows `dev-auto-stop.ps1`). Quên `-Backend` khi dừng thì Aurora vẫn tính tiền. Các bước từng cờ: xem `docs/deployment/AWS_DEV_DAILY_START_STOP_RUNBOOK.md`.
- **CI/CD** (`.github/workflows`): `dev-build.yml` (push `aws-deploy`, build zip Lambda), `dev-deploy.yml` (thủ công, OIDC, mặc định `dry_run=true`, **chỉ** `update-function-code`), `chat-deploy.yml` (image ECR → ECS), `infra-plan.yml`/`infra-deploy.yml` (change set API Gateway), `pr-validation.yml`, `docker-test.yml`. **Migration không chạy trong CI** (chạy tay qua Lambda `*-migrate`); **frontend không có workflow deploy** — build tay, `aws s3 sync` (assets trước, `index.html` cuối với `no-cache`) rồi invalidation CloudFront.
- Terraform (`infra/terraform/`, runbook `AWS_DEPLOYMENT_RUNBOOK.md`): chỉ tạo bucket frontend/uploads/vectors, OIDC, hello Lambda, budget; **không** là nguồn của Lambda/Aurora. Trước mỗi `apply` kiểm kế hoạch không có destroy bất ngờ, NAT, RDS/Aurora, ECS, OpenSearch, ElastiCache, môi trường production. `frontend-cdn.yaml` (CFN) đã lệch live — đừng redeploy stack đó.
- Mobile AWS: profile `aws-dev` trong `frontend/mobile/eas.json` (APK, trỏ `https://api.gymini.vn`, chat `https://gymini.vn`).
- Khác biệt quan trọng so với local: không Redis/Ollama/Qdrant (thay bằng SQS/Bedrock/OpenSearch), file lưu S3 thật (không MinIO), bằng chứng dispute không dùng được trên Lambda (ghi file tạm), giới hạn payload ~6MB, cold start chậm khi Aurora/NAT tắt, Lambda chặn đăng ký email miền test (`TEST_ACCOUNT_BLOCKED`). Dispute V2.1 route `dispute-cases` có thể **chưa** có trong API Gateway baseline (chưa kiểm lại).
- Việc cần REAL HTTP/API để chốt (chưa xác nhận): cấu hình thực của Lambda/Aurora, route parity API Gateway, cách migrate hiện tại cho auth/user/fitness trên AWS.

### 3.12 Đợt kiểm & sửa AWS dev 17–18/11/2026

**Bằng chứng:** REAL BROWSER trên `https://gymini.vn`, REAL DEVICE (ROG, APK release trỏ `https://api.gymini.vn`), REAL HTTP/API. Cấu hình AWS chỉ được **đọc** từ phía team. Mọi thay đổi cấu hình và hạ tầng do partner làm.

**Môi trường đã xác nhận:**
- Web chạy qua CloudFront `E2MHD79JFC1700` (`gymini.vn`, `www`). API là API Gateway `id1iz7upbl`, tên miền `api.gymini.vn`.
- Lambda: `fitness-assistant-dev-{auth,user,user-jobs,gym,payment,fitness,ai}`.
- Aurora `fitness-assistant-dev-aurora`: PG 17, Serverless v2, 2 instance. **Data API đã bật** để thao tác dữ liệu test.
- Mọi Lambda dùng **một bucket** `fitness-assistant-uploads-dev-191798898985`, mã hoá mặc định AES256.
- Chat (ECS) và mọi lịch EventBridge đang **tắt**.
- Tài khoản AWS là tài khoản mượn, luật làm việc có trong bộ nhớ dự án:
  - không bật hay tắt dịch vụ;
  - chỉ thao tác dữ liệu;
  - lỡ bật nhầm thì tắt trong 3 giờ.

**Lỗi tìm thấy và đã sửa:**

| Lỗi | Nguyên nhân | Sửa (nơi) |
|---|---|---|
| Upload trên web lỗi | CORS bucket thiếu `gymini.vn` / `www.gymini.vn` | cấu hình bucket (partner) |
| Hồ sơ đối tác gym, thêm chi nhánh, nút "Tôi đồng ý" không gửi được | API Gateway thiếu allow-header `x-gymini-client`, `x-gymini-listing-flow`, `x-gymini-venue-consent` | CORS API Gateway (partner) |
| Hợp đồng PT kẹt `PENDING_SIGNATURE` | Lambda `user` thiếu `REQUIRE_CONTRACT_ESIGN=false`; code mặc định **bật** khi thiếu biến | env Lambda. Hợp đồng đã kẹt huỷ được qua API (`e053d0e9`) |
| Lời mời nhân viên 502, check-in hộ, giao khiếu nại 503, mail gym không gửi, `gym-options` 503 | gym↔auth và user↔gym/payment gọi bằng URL localhost | Lambda invoke `*_LAMBDA_NAME` (`d8e86133`) |
| Trang duyệt bài tập 500 | thiếu CSV danh mục trên Lambda | đóng gói CSV (`d8e86133`) |
| VNPay báo chữ ký sai khi tên gói có `( )` | `encodeURIComponent` không mã hoá `!'()*` | ký kiểu urlencode, kiểm chấp nhận cả hai (`e053d0e9`) |
| Giờ buổi tập lệch 7 tiếng, dời lịch luôn bị từ chối | Lambda chạy UTC | env `TZ=Asia/Ho_Chi_Minh` cho mọi Lambda |
| Giấy tờ chi nhánh, ảnh khiếu nại 503 | multer ghi ổ đĩa, Lambda không có | presign S3 → POST → confirm (`f907be8d`, `0ccda7a1`) |
| Ảnh PT 503 | Lambda `user` thiếu bucket và quyền S3 | env `PT_MEDIA_S3_BUCKET` + IAM |
| ZaloPay "not enabled" | chốt an toàn production + thiếu khoá | env khoá **sandbox** + `ZALOPAY_PRODUCTION_VERIFIED=true`. **Chỉ dùng với khoá sandbox** |
| Lỗi giao diện web | ADM-01, PT-05/08/11, LEAK-01, NOTIF-01, MGR-01, WIZ-01, tiêu đề mail lời mời, lời chào AI, chữ vận hành ZaloPay/Grafana | `e053d0e9`, `0ccda7a1`, `59b108db` |
| `/admin/users` trên Lambda bỏ qua phân trang | client gọi auth qua Lambda gửi `rawQueryString: ""`, mất mọi query | phân trang và lọc trong DB (`497adcb7`) |
| `/admin/dashboard`, "Hôm nay" kéo toàn bộ user (vượt 6 MB); lọc `notIn` vượt 32.767 tham số | | tổng hợp trong DB `POST /auth/users/dashboard-summary`; `recentUsers` có `id` + `partnerRole` (`051d43f1`) |
| `/auth/internal/test-account-ids` đọc cả bảng | | lọc trong SQL (`e367aaf3`) |
| Mobile | MOB-ISO-01 (đăng xuất rồi đăng nhập người khác vẫn mở màn của người trước), mã giao dịch thô, nhãn vai trò, chặn WebP ở giấy tờ, lộ email/mã | `9fa41442` (nhánh `feature/payment-gateways`) |

**Cấu hình đặt tay ngoài IaC:** CORS (bucket và API Gateway), env Lambda (`REQUIRE_CONTRACT_ESIGN`, `TZ`, `*_LAMBDA_NAME`, `PT_MEDIA_S3_BUCKET`, ZaloPay) và IAM. Đã ghi lại thành `scripts/aws/dev-manual-config.mjs`: chạy không tham số là chỉ kiểm, `--apply` là áp. Pipeline cấu hình nào ghi đè thì phải đặt lại.

**Quy trình deploy đã dùng:**
1. Partner push lên `aws-deploy`. `dev-build.yml` build zip Lambda.
2. Chủ repo chạy **DEV Application Deploy (Lambda code)** từ nhánh `aws-deploy` với `build_run_id` và `services`. Chạy `dry_run=true` trước rồi mới `false`, và duyệt environment `dev`.
3. Đổi thư viện `shared` thì build cả 6 service, nhưng chỉ deploy service đổi hành vi. Service gọi endpoint mới phải lên **sau** service cung cấp endpoint (ví dụ `auth` trước `user`).
4. Web: `aws s3 sync dist` **không `--delete`**, giữ `runtime-config.json`, rồi `index.html`/`sw.js`/manifest với `no-cache`, cuối cùng invalidation CloudFront.
5. Workflow chỉ chạy `update-function-code`, **không** ghi cấu hình.

**Kết quả kiểm sau sửa:**
- Web: test lại toàn bộ 16 mục, quét 270 lượt tải trang ở 390 px và desktop, sáng và tối.
- Mobile trên máy thật: đủ 3 vai trò + nhân viên + admin. VNPay và ZaloPay sandbox quay về app qua `fitnessassistant://`.
- APK cũ 14/11 vẫn chạy với backend mới (chế độ ân hạn khi thiếu header xác nhận nơi tập).
- `/admin/users` (REAL HTTP/API): phân trang, lọc `role`/`status`, tìm tên có dấu, `ids=`, lỗi 400 đều đúng, khoảng 0,2 giây.

**Dữ liệu test:** mọi tài khoản và dữ liệu sinh ra khi test đã được hoàn tác về mốc trước khi test (Data API, plan lọc theo thực thể test, drift tiền = 0). Dữ liệu partner tạo trong cùng khoảng thời gian được giữ nguyên.

**Còn mở (AWS):**
- `partnerRole=…` ở `/admin/users` mất khoảng 3 giây vì gọi gym-service từng đợt. Nếu chậm hơn thì làm endpoint lọc vai trò ở gym-service.
- Backend chỉ ký URL avatar `s3://` ở **hồ sơ của chính mình**. Màn hiện avatar người khác chưa ký.
- `/translate` 404 (không có gateway trên AWS).
- Mail đặt lại mật khẩu và mail lời mời kế toán vào Spam (chưa có SPF/DKIM).
- Bản đồ vai trò chính xác cho "người mới đăng ký" trên mobile cần `recentUsers.id` (đã có từ `051d43f1`, chưa kiểm trên máy).
- Code `aws-deploy` sau `0ccda7a1` (`59b108db`, `497adcb7`, `051d43f1`, `e367aaf3`) chưa gộp về `feature/payment-gateways`. Khi gộp: **chỉ lấy code, không lấy `.md`/`docs/` cũ của `aws-deploy`**, và cẩn thận các tệp cấu hình agent bị `.gitignore` ở nhánh này nhưng `aws-deploy` có track.

---
**Mâu thuẫn tài liệu cũ ↔ cấu hình đã được xử lý trong phần này** (đã ghi giá trị từ config): (1) `LLM_MODEL` mặc định là `qwen3:4b-instruct-2507-q4_K_M` (tài liệu cũ ghi `fitness-coach-qwen2.5-1.5b:q4_K_M`); (2) DB là 7 database `gymcoach_<svc>` (tài liệu cũ ghi một DB `gymcoach` chung); (3) dev compose chỉ có 3 profile `local-ollama`/`knowledge`/`observability` (tài liệu cũ nhắc profile `automation` không tồn tại); (4) chat-service socket đi qua gateway ở `/chat-socket.io` (tài liệu cũ ghi mặc định nối thẳng cổng 3005); (5) script `db:migrate` trong package.json dùng `prisma migrate dev`, trái quy tắc "chỉ `migrate deploy`".


## 4. Việc còn mở (cập nhật 17/11/2026)

Cách đọc: 🔴 nghiêm trọng · 🟡 nên sửa · ⚪ nhỏ. Mỗi mục ghi chỗ trong mã nếu biết. "Cần quyết định của chủ dự án" nghĩa là việc kỹ thuật chưa làm được khi chưa có luật nghiệp vụ.
Danh sách này đã lọc theo lịch sử commit tới `e15b1f99` (17/11) và theo mã hiện tại: các lỗi đã sửa (vd. InBody ghi chéo người dùng, payment sập khi DB lỗi, form sửa chi nhánh của admin, máy trạng thái đơn PT, hộp thoại không trợ năng, khoản bù kháng nghị gym, tự trừ nợ GYM_DEBT, hardening sổ cái FH-1..FH-9) không còn ở đây. Mục nào chưa kiểm lại được sau đợt sửa ghi "(chưa xác minh lại)".
Không còn 🔴 nào ở mức ứng dụng; các 🔴 còn lại đều là cổng production (mục 4.8).

### 4.1 Tiền, ví, thanh toán

- 🟡 **Đối chiếu cổng mức L3 (hỏi trực tiếp VNPay `querydr`) chưa kiểm chứng được.** Sandbox trả mã 99 "Unexpected error" cho mọi lệnh hỏi (kể cả hash sai); UI không vỡ, trả "Không hỏi được". Cần merchant sandbox có mở `querydr` hoặc file quyết toán. Chỗ: payment-service `GET /admin/payments/gateway-reconciliation/l3`. Cần quyết định/hỗ trợ của chủ dự án (xin merchant VNPay).
- 🟡 **Quy mô tiền tồn đọng trên production chưa được kiểm kê (FH-0).** Dev từng có sổ chờ âm 5.500.000 đ, 3.200.000 đ khách kẹt ở hợp đồng đã chết, 920.000 đ hoàn vượt, 70.000 đ nợ PT do lỗi nền tảng; production chưa ai đọc (chỉ đọc, do chủ dự án chạy). (chưa xác minh lại)
- 🟡 **Hoàn tiền admin: hai yêu cầu hoàn đồng thời cho cùng một giao dịch gốc.** Route đã chặn theo trạng thái (`ALREADY_REFUNDED`/`NOT_REFUNDABLE`, `payment-service/src/routes/admin.routes.ts` ~268-275) và lấy danh tính admin từ token, nhưng cơ chế "claim nguyên tử trên giao dịch gốc" chưa được kiểm lại bằng hai request song song. (chưa xác minh lại)
- 🟡 **Công cụ dọn DB `scripts/db-clean` không tạo được manifest sạch trên schema hiện tại**: `policy.mjs` chưa phân loại các bảng mới (`reconciliation_runs`, `gym_case_*`, `dispute_case_*`, `d65b_*`, `pt_discovery_*`, `vietnam_ward_geo`…) nên các ca D2/D4 đỏ. Đã sửa phần nguy hiểm (từ chối xoá ví còn tiền / huỷ khi lệch đối soát đổi — gốc khoản lệch 17.367.806,50) nhưng phần phân loại bảng chưa làm. (chưa xác minh lại sau 15/11)
- ⚪ **Khoản điều chỉnh lệch đối soát trên dev (17.367.806,50 đ)** đã xử lý 15/11 bằng script một lần (`scripts/money/dev-drift-adjust-20261115.mjs`, chỉ dev loopback + `--confirm-dev`): drift về 0,00. Tác dụng phụ còn lại: báo cáo tài chính trên DB dev đó tính khoản này là "đã chi trả" (giao dịch PAID purpose WITHDRAWAL). Chỉ ảnh hưởng số liệu dev. Gốc lệch là 2 lần chạy dọn DB (25/10 và 01/11), không phải lỗi code tiền.
- ⚪ Yêu cầu rút tiền đang chờ chưa "đặt chỗ" nên khấu nợ cùng lúc có thể làm số dư nhỏ hơn dự kiến (`contract-ledger.service.ts` ~769-778). Rút tiền gym: Ngài đã chọn cho rút phần vượt nợ.
- ⚪ Người dùng không tự huỷ được yêu cầu rút tiền đang chờ (N13C-08). (chưa xác minh lại)
- ⚪ Còn một câu lỗi tiếng Anh ở route nội bộ `payment-service/src/routes/internal.routes.ts:249`.
- ⚪ Test `zalopay-callback-verification` chập chờn (race TRUNCATE ↔ tiến trình settlement nền của harness); tệp/service không đổi từ 11/11.
- ⚪ Khi ví REVENUE không đủ để ứng cho khoản bù kháng nghị gym thì giữ CHẶN (không chuyển đồng nào, hồ sơ chờ thử lại) — đây là quyết định, không phải lỗi; chỉ ghi nhận rằng nhánh ứng-nợ GYM_DEBT chưa được kích thật trong đợt test 16–17/11 do ví REVENUE chỉ có 3.000 đ (đã kiểm ở 15/11).
- ⚪ Khoản giữ buổi chưa xác minh (D65-B): cờ riêng mặc định tắt; ca "không có khoản giữ UNCONFIRMED", SLA ngày 10/14 + quét tiền giữ, hết hạn kháng nghị 14 ngày chưa phủ hết bằng giao diện thật. (chưa xác minh lại)

### 4.2 Tài khoản, hồ sơ, đơn PT, hợp đồng PT

- 🟡 **InBody: form nhập tay không có BMR và mỡ nội tạng; quét ảnh InBody thiếu BMR/mỡ nội tạng** (LỖI-33, N13G-05). Backend đã chặn giá trị rác, ảnh toàn số 0 và cho xoá bản ghi; thiếu trường là chức năng. Chỗ: user-service `inbody.service.ts`, form InBody web. (chưa xác minh lại)
- 🟡 **Xoá InBody có thể làm hỏng tham chiếu bên fitness** (vd. `startInbodyId` của chu kỳ): quyết định là xoá bản ghi cuối vẫn giữ cân nặng hồ sơ, còn fitness phải chịu được bản ghi không còn — việc của partner, chưa có xác nhận đã làm.
- ⚪ Đánh dấu thông báo đã đọc với id sai định dạng trả 200 (nên 404) — coordinator hoãn.
- ⚪ Lỗi zod tiếng Anh ("Required", "Expected string") còn lọt trong `details[]` của vài route 400 (rút tiền, admin mark-paid thiếu `bankReference`). (chưa xác minh lại)
- ⚪ Thông báo "tổng hợp" tiếng Anh/UUID rải rác ở các tab quản trị khác ngoài những chỗ đã sửa (vd. mã `d0d00000` của admin ở vài tab). (chưa xác minh lại)
- ⚪ Admin không có UI thêm/sửa/xoá bài tập, mẫu tập, thiết bị, món ăn (chỉ có "Bài tập trùng lặp" và "Chất lượng bài tập") — thuộc miền partner/fitness.

### 4.3 Gym và đối tác

- 🟡 **Link chia sẻ gym / Android App Links `gymini.vn/gyms`**: `assetlinks.json` đã có trong mã và đã giả lập `pm set-app-links` trên ROG; xác thực thật cần domain `gymini.vn` phục vụ đúng tệp và AWS dev bật. Link chia sẻ trong app hiện dùng địa chỉ tạm. Cần chủ dự án/partner báo khi bật AWS.
- 🟡 **Việc ngày deploy luồng đối tác gym** (không chặn tính năng, cần một phiên deploy riêng): nghiệm thu S3 thật (presigned POST, CORS, mã hoá), policy IAM hẹp của role gym (chỉ chạy được trên Lambda), biến `PARTNER_S3_PRIVATE_BUCKET`/`PARTNER_S3_REGION` trên Lambda (thiếu → 503 `UPLOADS_UNAVAILABLE`), Redis chia sẻ cho rate limit khi production (`RATE_LIMIT_REQUIRE_SHARED=true`), Lambda trong VPC phải tới được S3 (Gateway Endpoint), job dọn tệp mồ côi đang DISABLED. (chưa xác minh lại)
- ⚪ Hồ sơ đối tác bỏ dở nằm mãi ở ONBOARDING (không có EXPIRED/WITHDRAWN) — hoãn có chủ đích; email xác minh gửi một lần, không hàng đợi thử lại; ảnh chi nhánh cũ (`/uploads/gym-photos`, multer) chưa di trú sang S3; bản đồ dùng tile OSM công cộng (chỉ hợp lưu lượng nhỏ).
- ⚪ Còn dở theo spec đối tác gym 9/2026 (gộp 18/11/2026): thông báo cho chủ gym về sự kiện đối tác (admin yêu cầu sửa chi nhánh, nhận lời mời, bị đình chỉ) **chưa nối** — mới có `GYM_COMPLAINT_RESOLVED`; trang chi tiết đối tác của admin còn thiếu 3 tab BRAND / MEMBERSHIPS / PT COLLABORATIONS; chưa có bước kiểm responsive đủ 360/390/430/768/1024/1440 trên mọi màn đã chạm (phần lớn chỉ kiểm ở 1440 px); phạm vi gói hội viên theo chi nhánh đã hoãn (§2.9.1). (chưa đối chiếu lại với mã)
- ⚪ Admin: nút "Xem hồ sơ gym" cần gõ tay `membershipId` đã được thay bằng ô chọn gói (INT-15 đã xong) — không còn mở.
- ⚪ Còn mã thô/UUID cắt ở vài chỗ: "Check-in gần đây" của lễ tân (id khách bị cắt), giá "700000" không định dạng ở trang hồ sơ gym, "Chi nhánh #221cf50f" ở hộp "Báo cáo vấn đề" (đã sửa một phần). (chưa xác minh lại)
- ⚪ Gói offline gửi được khi PT chưa gắn gym nào — **cần quyết định của chủ dự án** (N15M-14).

### 4.4 Chat, gọi điện, thông báo

- 🟡 **GAP-14: socket chat giữ JWT lúc bắt tay suốt đời kết nối → chat/gọi chết sau 15 phút** vì token hết hạn. Mobile đã vá (kết nối lại khi token làm mới); gateway chưa nhận token mới giữa chừng (không có `auth:refresh` trong `backend/gateway`). Web/bản AWS: (chưa xác minh lại). **Cần quyết định của chủ dự án** (có sửa gateway không).
- 🟡 **Tin chat không làm tăng chuông, không có huy hiệu chưa đọc/đã xem; web không gọi `PATCH /read`** (N09F-05). Tính năng đính kèm/đang gõ cũng chưa có. Chat hội viên ↔ nhân viên gym không tồn tại trong mã. (chưa xác minh lại)
- ⚪ Chưa kiểm được: rớt websocket thật rồi nhận bù, token hết hạn giữa chat, overlay gọi ở 1366.
- ⚪ Bản aws-dev tắt socket (chat poll) — mobile đã sửa chat tự cập nhật ở 90fe5287, phần socket thật chưa bật.

### 4.5 Giao diện web (team)

- 🟡 Hộp thoại/ngăn kéo tự viết còn lại trong các màn **thuộc partner** (Nutrition, WorkoutLog, `AICoachFloatingPanel`): chưa Esc/khoá cuộn/role=dialog; phần của team (~36 hộp thoại) đã thay bằng component dùng chung. Panel AI Coach không khoá cuộn, Esc/nền không đóng.
- ⚪ Tương phản chữ thấp ở giao diện sáng (chip PT 2,14; nhãn mục tiêu dinh dưỡng 2,16/2,40; chip ngày tập; nút AI-draft ở `AssignPlanModal` 1,17) và vài vùng bấm 28–36 px còn lại ở 390. (chưa xác minh lại sau đợt sửa)
- ⚪ Trang đơn dịch vụ cá nhân hoá của khách quay vòng và của PT trắng trơn khi ai-service tắt (503); `/pt/plans` giấu việc AI tắt; câu "Chưa rõ yêu cầu đã được xử lý" cho 503 chắc chắn (N13J-01/09, N13G-18) — một phần là hạ tầng (AI không chạy trên máy dev), một phần cần khung báo lỗi chung.
- ⚪ Gateway trả HTML "Cannot GET…" (và gym-service trả HTML) cho đường admin lạ thay vì JSON tiếng Việt (N11D2-07, N13F-07).
- ⚪ Ảnh seed hỏng ở `/client/library`, foods, exercises (URL pexels trả 422).
- ⚪ Một test web đỏ có sẵn do CRLF (`chat-request-identity`) — không thuộc diff gần đây.
- ⚪ Chưa kiểm bằng trình duyệt: giao diện sáng 1366 cho luồng `/gyms/:id` (link chia sẻ → đăng nhập → đúng gym), wizard/nhân viên ở 360/412.

### 4.6 App mobile (Expo)

- 🟡 **Các ca còn lại cần máy thật** (ROG/TECNO): gọi thoại/video khác mạng 4G↔Wi-Fi (chứng minh TURN), loa ngoài/cuộc gọi chen ngang/mất mạng giữa chừng, camera quét QR check-in thật, nút "Dùng vị trí hiện tại" nhánh thành công (GPS emulator không đủ), cuộc gọi đến khi app đã tắt hẳn (cần bản release), push trên máy thật mở/nền/tắt + đổi tài khoản trên cùng máy, đo thời lượng cuộc gọi. Đợt 16–17/11 trên ROG đã đạt: VNPay/ZaloPay qua app, App Link khởi động nguội + đăng nhập, thông báo mở đúng màn, admin phân trang, rút tiền hiện tên. (chưa xác minh lại phần còn lại)
- ⚪ AI Coach trên máy thật: câu trả lời văn bản chạy chữ rất chậm trên emulator (có thể là hiệu năng hiệu ứng của Phase 9); thẻ "Lịch tập do AI Coach tạo" chưa thấy trên app thật. Cần AI chạy được (xem 4.7).
- ⚪ Không có công tắc sáng/tối trên mobile. Nhãn ví PT lệch giữa các màn, huy hiệu vai trò lễ tân/kế toán chưa chính xác, danh sách quản lý không tự làm mới, địa chỉ gym lặp (N15M-05/09/12/13). (chưa xác minh lại)
- ⚪ 6 route admin chỉ có trên web (`gym-management`, `exercise-review`, `catalog-quality`, `system`, `workflows`, `ai-observability`) — hoãn theo ý chủ dự án (xem mục "Đã tắt có chủ đích").

### 4.7 Phần của partner (ai-service, fitness-service) — team không sửa, gom gửi partner

Quyết định 14/11: lỗi của hai service này chỉ ghi và bàn giao. Chưa có xác nhận partner đã sửa.
- 🟡 Dinh dưỡng: ghi bữa ăn 99.999.999 kcal/ngày 2030/PATCH âm vẫn nhận (N13G-07); `GET /nutrition/goals` tự bịa 2000/150/200/65 "RECOMMENDED" cho người chưa có mục tiêu, trong khi active-state = NO_ACTIVE_GOAL (N13G-08); thư viện món không có món Việt (phở bò, chả giò… → 0; "phở" ra bánh quy), "Cơm tấm" lấy tên USDA tiếng Anh (N13G-09).
- 🟡 Nhập file Strong: cân -60, RPE 15 vẫn ghi và buổi quá khứ không xoá được (N13G-10); xuất dữ liệu `bodyMetrics` luôn rỗng vì đọc bảng cũ (`export.service.ts:78`, N13G-11); `GET /exercises?search=` bỏ qua bộ lọc (N15M-04).
- 🟡 `ENV-05`: lệnh khởi động `gymcoach-fitness-dev` là `prisma db push --accept-data-loss && prisma db seed && pnpm run dev` — mỗi lần bật container đều đẩy schema và seed lại; nên đổi sang `migrate deploy`.
- 🟡 Trang web thuộc partner: "Workout Log"/"At Gym"/"Intermediate"/"4.8" ghi cứng (`WorkoutLogPage.tsx` ~4651), banner sai "đã đổi sang Tăng cơ…" (~4505), nhãn tiếng Anh thô trong thư viện bài tập ("advanced", "ELBOW FLEXION", "UNDOCUMENTED_DO_NOT_RELY_ON", "free_exercise_db"), nút "Chat" ở chi tiết khách PT mở trang trống (`PTClientDetail.tsx:311`), 503 danh sách chờ duyệt hiện là "Không có kế hoạch nào đang chờ duyệt" (N13G-12..17). (chưa xác minh lại)
- ⚪ Hoàn thành chu kỳ ngay ngày 0 vẫn được; chữ "Decision Engine" lộ cho người dùng; tham số truy vấn sai → 500; kế hoạch PT giao không ghi nguồn gốc; `GET /training-cycles/active` 404 khi chưa có chu kỳ (lỗi console) (N13G-20..23, N13J-10).
- ⚪ "AI Insights" trên trang chủ web (`ClientDashboard`) là hai câu ghép sẵn từ cân nặng/cơ InBody dưới nhãn "AI · Trực tiếp", không gọi AI nào (E7) — **cần quyết định của chủ dự án + partner** (gọi AI Coach thật hay đổi tên "Tóm tắt").
- ⚪ AI trên cụm dev local chưa chạy được (ai-service cần Ollama; chủ dự án quyết 14/11: KHÔNG cài Ollama) nên chưa kiểm: AI plan wizard, giải thích kế hoạch, nutrition agent, tạo `NutritionProgram`, `CycleAssessment` KEEP/PROGRESS/ADJUST/DELOAD/REBUILD, PT duyệt đánh giá, OCR InBody thật. Mọi trang admin/PT gọi `/marketplace/orders/refund-requests` nhận 503 khi AI tắt (trang vẫn hiện).
- ⚪ Phát hiện từ audit cũ, chưa xác minh lại: cờ Conversational Intelligence không chi phối mọi lời gọi LLM; ngân sách timeout LLM cho lượt chat tới ~170 s; `/health` của ai-service lộ URL LLM nội bộ; Redis/vector store/LLM sập chưa kiểm hành vi.

### 4.8 Cổng production (bảo mật, hạ tầng) — chưa làm; không chặn demo/khoá luận

Nguồn là audit tháng 10; đối chiếu với mã hiện tại thì các mục sau vẫn còn: (CODE AUDIT 17/11)
- 🔴/🟡 Các lỗ hổng bảo mật cụ thể chưa vá (secret, xác thực, OTP, token, xoay khoá) được ghi riêng ở `docs/SECURITY_OPEN.local.md` — **chỉ có ở máy chủ dự án, không đẩy lên GitHub**. Hỏi chủ dự án nếu cần.
- 🔴 **Không có TLS, không có cổng backup/rollback cho migration, không backup tự động + diễn tập khôi phục** (G-03, G-04, G-13); mục tiêu deploy production chưa xác định, IaC mới cho dev (G-12). Monitoring/cảnh báo chưa nằm trong deploy (G-14), health endpoint chỉ là liveness (G-15).
- 🟡 Migration lịch sử còn "drift catch-up" (một số model chưa có file migration, db mới dựng bằng `migrate deploy` có thể thiếu bảng) — chưa chứng minh dựng lại từ đầu cho mọi service (G-20). (chưa xác minh lại)
- 🟡 CI (`.github/workflows`) có `pr-validation`/`docker-test`/dev-deploy nhưng audit cũ ghi chưa chạy typecheck, lint mã, quét phụ thuộc (G-11). (chưa xác minh lại)
- ⚪ Giới hạn tần suất chỉ theo IP (chưa quota theo người cho endpoint AI); tham chiếu `user_id` giữa các DB là mềm (không FK); `reports/`, `training/` và vài tệp vận hành nằm trong repo; vài bundle web lớn (~906 kB).

### 4.9 Hạ tầng dev, môi trường, quy trình

- 🟡 **Cụm dev compose**: Postgres `max_connections=60` thấp hơn tổng pool Prisma của các service → hết kết nối khi tải song song (từng gây sự cố 10:55–11:12Z 13/11); đã trả về 60 theo ý chủ dự án. `restart policy "no"` nên Docker sập là cả cụm không tự bật lại.
- 🟡 **`tsx watch` không tự nạp lại trên ổ Windows gắn volume**: sau khi sửa code phải `docker restart` container dev (user-dev, gym-dev, payment-dev, chat-dev, gateway-dev), nếu không dev chạy code cũ.
- 🟡 **Script dọn MinIO không an toàn**: 16/11 chạy `minio-cleanup --delete` mà không kiểm danh sách NEW đã xoá nhầm 379 ảnh gốc seed `_seed-masters/gym/*`; đã khôi phục đủ 467/467 từ `scripts/seed-marketplace/assets`. Cần thêm guard (dry-run bắt buộc, loại prefix seed) trước khi dùng lại. Còn vài ảnh test mồ côi.
- ⚪ Hai tệp override seed: `compose.restore.override.yml` từng đổi lệnh thành `pnpm run dev` (bỏ `migrate deploy` khi restart) và `compose.seedrun.override.yml` từng ghi cứng `VNPAY_SIMULATE=true`. (chưa xác minh lại)
- ⚪ Migration đã commit hết (`20261114100000`, `20261114120000` user/gym, `20261115100000`/`20261115200000` payment, `20261115100000` user). Riêng migration payment `20261115200000_gym_debt_auto_recovery_event` tới 15/11 chưa áp lên dev và phải `migrate deploy` tay; user-dev tự áp khi khởi động. (chưa xác minh lại trạng thái DB dev)
- ⚪ Cây làm việc có tệp rác chưa commit: `backend/services/user-service/uploads/`, `frontend/mobile/p2bundle.js`, `p3.mjs`, một ảnh trong `frontend/web/android/Icon/`, tệp `scripts/seed-marketplace/assets/30KB…`; ba README đã sửa nhưng chưa commit vì hook chặn `.md` (`frontend/mobile/.maestro/listing/README.md`, `scripts/db-clean/README-db-clean.md`, `scripts/seed-marketplace/official/README.md`).
- ⚪ Hai script E2E/Playwright vẫn gọi harness ngoài repo (`D:/fitnessassistant-playwright-e2e`) và để lại dữ liệu `@partner-e2e.test`; selector Playwright cũ dùng placeholder ô đăng ký PT cần cập nhật (placeholder đổi ở FIX4-DISPUTE).

### 4.10 Quyết định đang chờ chủ dự án

1. **Hoa hồng ngoại lệ cho đối tác tự đăng ký (self-service)**: hiện không có cách đặt hoa hồng riêng (override) cho gym/PT tự đăng ký; chỉ admin seed có. Cần chọn: thêm cơ chế override hay giữ tỷ lệ chuẩn.
2. **GAP-14**: có sửa gateway để socket nhận token mới giữa chừng (`auth:refresh`) hay giữ cách kết nối lại ở client (mobile đã vá)?
3. **GAP-2**: có làm endpoint liệt kê gói hội viên bất thường (thanh toán treo, gym đóng mà gói còn chạy…) cho admin hoàn tiền ngoại lệ, thay cho việc nhập tay mã gói?
4. **GAP-13 (chính sách với partner)**: khiếu nại/hoàn tiền đơn dịch vụ 1-1 phía khách — chốt chính sách rồi mới bật lại giao diện (đang tắt trên mobile).
5. **Buổi tập tự do không theo giáo án** (E6, web `WorkoutLogPage` `logWorkout`/`updateWorkout`): làm trên mobile hay loại trừ? Chủ dự án nói "bàn sau".
6. **"AI Insights" giả trên trang chủ web** (E7): gọi AI Coach thật hay đổi tên và bỏ nhãn AI (miền partner).
7. **Danh sách PT đang hoạt động kèm đánh giá/số học viên cho admin** (AD-03, `GET /admin/pts`): có làm endpoint tổng hợp không? Admin hiện đã có trang hồ sơ PT phân trang + tìm kiếm. (chưa xác minh lại)
8. **Gói offline khi PT chưa có gym** (N15M-14): cho gửi hay chặn?
9. **Địa chỉ web công khai dùng cho link chia sẻ gym trong app** (hiện địa chỉ tạm/`gymini.vn`): chốt khi partner bật AWS; kèm việc phục vụ `assetlinks.json` thật.
10. **Bật "giữ lại 10% thu nhập PT"** (cờ `PT_HOLDBACK_NEW_CONTRACTS_ENABLED`, hiện tắt) cần chốt mô hình M0/M1 và D49 (`SERVICE_DISCONTINUED_BY_PLATFORM`); khi bật, `PT_BANNED` còn nằm trong `PT_FAULT_REASONS` (`contract-money.ts` ~321).
11. **Bảo mật/production**: các câu hỏi thứ tự xoay khoá và thiết kế fail-closed — xem `docs/SECURITY_OPEN.local.md` (chỉ local).
12. **Kiểm kê tiền production (FH-0)**: chủ dự án (hoặc người được phép đọc) chạy chỉ-đọc trước khi tin bất kỳ con số tiền nào trên production.
13. **Bật cờ Dispute V2.1 ở production** và thời điểm (hiện tắt; bật trên DB `_official` cho buổi phản biện 17/11).
14. **Gửi danh sách lỗi cho partner** (mục 4.7) và xin partner sửa/trả lời; chưa có xác nhận đã gửi/đã sửa. Khi nào test app trên máy thật đợt kế (đã chốt "để sau").
15. **Ngưỡng bốn mắt rút tiền** (`WITHDRAWAL_FOUR_EYES_MIN_VND`, mặc định 5.000.000 đ) có giữ nguyên khi lên production không.
16. **Khi nào xoá/giữ tài khoản và hồ sơ QA còn lại** (10 tài khoản `qa.n13` ở trạng thái vô hiệu vì dính tiền; hồ sơ `gym_case_*`/`dispute_case_*` giữ làm audit — đã chọn giữ).

### 4.11 Đã tắt có chủ đích (không phải lỗi)

- **Giữ lại 10% thu nhập PT (FH-9 holdback)**: tắt; `PT_HOLDBACK_NEW_CONTRACTS_ENABLED` mặc định off, `resolvePtHoldbackRate` (user-service `pt-holdback-rate.ts`) trả "0" khi tắt; hợp đồng đã có snapshot giữ nguyên quy tắc. Không có phí 10% khi PT tự chấm dứt (D92). Khoản trừ phạt PT huỷ cũng tắt.
- **Dispute V2.1 (khiếu nại/tranh chấp)**: mọi cờ mặc định TẮT ở dev/production, chỉ bật trong test/E2E và trên DB `_official` phục vụ buổi phản biện; cổng runtime fail-closed (`dispute-dev.yml`). D65-B (duyệt bốn mắt khoản giữ buổi PT vắng) có cờ riêng mặc định tắt.
- **Điều khoản PT**: bản nháp bị tắt; bản chính thức `2026-11-pt-v1` đã duyệt 11/11; PT đã xác nhận bản nháp phải xác nhận lại trước khi nhận hợp đồng mới.
- **Ký điện tử hợp đồng (e-sign) tắt**: không có bước ký; không thể đặt `EXPIRED` thủ công cho hợp đồng (quyết định 11/11).
- **Hoàn tiền/khiếu nại đơn dịch vụ 1-1 phía khách** bị comment out trên mobile từ 22/9, chờ chính sách partner (phía admin AD-04 vẫn chạy).
- **MoMo, PayOS (và MOCK) đã ngừng**: provider/callback bị xoá, webhook chỉ còn ZaloPay (MoMo/PayOS nhận 404 và chỉ ghi log); enum DB, nhãn lịch sử và `.env`/compose giữ nguyên; chỉ còn VNPay + ZaloPay.
- **Chủ gym trả lời đánh giá**: bỏ khỏi phạm vi hiện tại (chưa có API), làm sau theo ý chủ dự án 14/11.
- **Màn "bắt buộc đổi mật khẩu"** (`mustChangePassword`) đã gỡ ở web và mobile; cờ không còn trả trong phản hồi đăng nhập (cột DB giữ).
- **Trang công khai `/gyms/:id` cho khách vãng lai** đã bỏ: link chia sẻ → đăng nhập → mở đúng gym (quyết định 15/11).
- **Chi nhánh bị đình chỉ trên hệ thống**: hội viên có gói vẫn check-in tới hết hạn, ẩn khỏi tìm kiếm, không bán/gia hạn; tạm đóng thật vẫn chặn check-in; gói hội viên không tự huỷ/hoàn khi đình chỉ (hoàn là thao tác admin riêng).
- **Nợ gym (GYM_DEBT)**: ví REVENUE không đủ ứng khoản bù kháng nghị gym thì giữ CHẶN; GYM_DEBT tự trừ vào khoản tiền khả dụng kế tiếp của gym, rút tiền gym cho rút phần vượt nợ, không tự trừ nợ đang trong luồng thanh toán tay.
- **PT bị tạm khoá vẫn đăng nhập và rút tiền được**; ai cũng nhắn được cho PT đã duyệt khi chưa có hợp đồng; admin chi thẳng dưới ngưỡng bốn mắt từ PENDING (ghi người duyệt = chính admin); chặn chạy đối soát 30 giây. Đều là quyết định 14/11.
- **6 route admin chỉ trên web** (WB-05..10), Capacitor/`mobile e2e harness` cũ, kế hoạch nâng cấp frontend 4-actor cũ: đã bỏ/hoãn theo chủ dự án (mobile chỉ Expo).
- **Rate limit gateway** mặc định 100/phút; chỉ nâng cho stack scale test (`gymini-scale`), không đổi mặc định.
- **Ảnh seed/ảnh PT lộ mặt, bản quyền ảnh seed**: dự án khoá luận, không production nên không xử lý.

### 4.12 Chưa kiểm được (không phải lỗi đã biết)

- Luồng bốn mắt rút tiền ≥ 5 triệu đã kiểm đạt trên dev local (13/11); trên môi trường partner (11/11) chưa có ví đủ tiền nên chưa kiểm.
- Kháng nghị gym/quyết định thay thế cần admin thứ 3/4 — đã kiểm ở dev nội bộ, chưa kiểm trên môi trường chỉ có 2 admin.
- Giao diện: bấm hết tab/drawer/modal ở giao diện sáng; chữ thô `PENDING_PAYMENT`/`CANCELLED`/"nutrition plan ready" chưa kiểm vì tài khoản quét không có dữ liệu đó (chưa kiểm ≠ đã sửa).
- Dispute: D77 online-trễ, kết quả CANCELLED, trả nghĩa vụ, hợp đồng mới qua VNPay trong luồng tranh chấp; engine chỉ có 3 kết quả (không có hoàn một phần/không hoàn).
- Hiệu năng: tìm PT/gym đã đo trên scale (10.400 PT/2.500 gym/25.000 khách, 14→4 câu SQL/request); chưa đo trên Aurora/AWS.


## 5. Tài liệu khác

Danh sách đầy đủ tài liệu trong `docs/` và các tài liệu buộc phải nằm cạnh mã (vì script/test đọc theo đường dẫn):
xem [`docs/README.md`](README.md).

Mã nguồn và test còn chú thích trỏ tới một số file `docs/*.md` cũ đã lưu trữ (ví dụ `docs/money-flow.md`,
`docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md`). Nội dung còn hiệu lực của chúng đã gộp vào mục 2–4 của sổ tay này.
