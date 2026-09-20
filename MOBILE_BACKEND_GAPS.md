# Mobile Backend Gaps

> Backend là read-only trong suốt dự án viết lại app mobile React Native (xem nguyên tắc chung của
> kế hoạch di trú). Nếu bất kỳ phase nào phát hiện mobile cần một khả năng backend chưa tồn tại
> (endpoint thiếu, trường dữ liệu thiếu, trạng thái không thể đạt được qua API hiện có...), ghi lại
> ở đây theo đúng mẫu bên dưới, đánh dấu luồng bị ảnh hưởng `BLOCKED`/`PARTIAL`, và báo cáo cho
> Ngài — **không** tự chế hành vi nghiệp vụ chỉ tồn tại ở frontend để "cho chạy được".

## Mẫu ghi 1 gap

```
### GAP-<số thứ tự> — <tên ngắn>

- Phát hiện ở phase: <Phase N, tên>
- Màn hình/luồng bị ảnh hưởng: <ID màn hình trong MOBILE_MIGRATION_MANIFEST.md>
- Backend service liên quan: <service>
- Mô tả thiếu gì cụ thể: <...>
- Mức ảnh hưởng: BLOCKED (không làm được luồng chính) / PARTIAL (làm được nhưng thiếu 1 phần)
- Đã thử tìm endpoint thay thế chưa: <có/chưa, kết quả>
- Đề xuất (không tự làm nếu chưa được đồng ý): <thêm endpoint mới / mở rộng response / v.v.>
- Trạng thái: OPEN / ĐÃ BÁO CÁO — chờ quyết định / ĐÃ CÓ QUYẾT ĐỊNH (ghi rõ quyết định)
```

## Danh sách gap hiện tại

*(3 gap dưới đây được phát hiện ngay ở Phase 0 khi đối chiếu 67 màn hình New Frontend với
`frontend/web`/backend thật — trước khi Phase 1 bắt đầu, không phải phát sinh giữa chừng code.)*

### GAP-1 — Không có chức năng quản lý roster PT đang hoạt động (suspend/reinstate)

- Phát hiện ở phase: Phase 0 (đối chiếu manifest)
- Màn hình/luồng bị ảnh hưởng: AD-03 (`admin/AdminPTs.tsx`)
- Backend service liên quan: user-service (gần nhất) — không có endpoint thật
- Mô tả thiếu gì cụ thể: New Frontend có màn danh sách PT đang hoạt động với rating/số học viên/
  nút tạm ngưng-khôi phục. Web hiện tại (`PTManagement.tsx`) chỉ xử lý ĐƠN ỨNG TUYỂN PT
  (`ptApplicationService`), không có endpoint suspend/reinstate một PT đã duyệt, không có dữ liệu
  rating/số học viên tổng hợp theo PT.
- Mức ảnh hưởng: BLOCKED — không thể làm màn này đúng như mock nếu không có backend mới.
- Đã thử tìm endpoint thay thế chưa: có — chỉ thấy `/admin/partners/:id/suspend` (đình chỉ ĐỐI TÁC
  GYM, không liên quan PT) và `/admin/users/:id/disable` (vô hiệu hoá tài khoản chung, không có
  rating/student-count, không phải "suspend nghiệp vụ PT" đúng nghĩa).
- Đề xuất (không tự làm nếu chưa được đồng ý): cần endpoint mới ở user-service, vd
  `PATCH /admin/pts/:id/status` + `GET /admin/pts` (roster tổng hợp kèm rating/student count).
- Trạng thái: OPEN — chờ Ngài quyết định có làm mới backend cho việc này hay bỏ tính năng khỏi
  Phase 13.

### GAP-2 — "Gói lỗi" (hoàn tiền hội viên gym bất thường) không có hàng đợi, chỉ có form nhập ID thủ công

- Phát hiện ở phase: Phase 0 (đối chiếu manifest)
- Màn hình/luồng bị ảnh hưởng: AD-04 (phân đoạn "Gói lỗi" trong `admin/AdminResolve.tsx`)
- Backend service liên quan: gym-service (`POST /admin/gym-memberships/:id/refund` đã tồn tại)
- Mô tả thiếu gì cụ thể: endpoint hoàn tiền tồn tại, nhưng không có endpoint liệt kê "các gói hội
  viên đang ở trạng thái bất thường cần hoàn tiền" — `AdminDashboard.tsx` (web) tự thừa nhận qua
  comment trong code: admin phải tự gõ tay ID gói hội viên, không có picker/danh sách.
- Mức ảnh hưởng: PARTIAL — vẫn hoàn tiền được nếu biết ID, nhưng không có cách nào để admin tự
  phát hiện gói nào cần xử lý qua UI.
- Đã thử tìm endpoint thay thế chưa: có — không tìm thấy endpoint liệt kê/tìm kiếm gói hội viên
  theo trạng thái bất thường.
- Đề xuất: cần endpoint mới liệt kê gói hội viên theo tiêu chí bất thường (vd thanh toán treo quá
  X ngày, gym đã đóng nhưng gói còn ACTIVE...) trước khi RN có thể làm màn hàng đợi như mock.
- Trạng thái: OPEN — chờ quyết định: build lại đúng form-nhập-ID như web (parity floor, không tệ
  hơn hiện tại) cho Phase 13, hay yêu cầu thêm backend trước.

### GAP-3 — Quản lý người dùng (AdminUsers) không có hành động suspend/kích hoạt lại

- Phát hiện ở phase: Phase 0 (đối chiếu manifest)
- Màn hình/luồng bị ảnh hưởng: AD-05 (`admin/AdminUsers.tsx`)
- Backend service liên quan: auth-service (có `updateUserRole`/disable-enable nhưng chỉ được nối
  dây từ `AdminGymModeration.tsx` cho tài khoản chủ gym, không phải từ danh mục người dùng chung)
- Mô tả thiếu gì cụ thể: `UserManagement.tsx` (web) hiện chỉ đọc (list + filter), không có nút
  suspend/kích hoạt lại nào được nối vào danh mục người dùng chung, dù `adminService` trong
  `api.ts` có sẵn hàm generic cho việc này (chỉ chưa được dùng ở đúng chỗ này).
- Mức ảnh hưởng: PARTIAL — hàm backend generic có vẻ tồn tại, nhưng chưa xác nhận nó hoạt động
  đúng ý nghĩa "suspend một user bất kỳ" hay chỉ dành riêng ngữ cảnh chủ gym.
- Đã thử tìm endpoint thay thế chưa: có — thấy hàm `adminService` liên quan nhưng chưa xác nhận
  dùng được tổng quát; cần kiểm tra kỹ hơn ở auth-service khi thực thi Phase 13, không giả định.
- Đề xuất: xác nhận lại đúng semantics của endpoint disable/enable ở auth-service trước khi quyết
  định port thẳng vào AD-05 hay cần endpoint riêng.
- Trạng thái: OPEN — cần xác nhận kỹ hơn khi bắt đầu Phase 13 (không blocking Phase 0).

### GAP-4 — Không có luồng "quên mật khẩu" tự phục vụ cho người dùng thường

- Phát hiện ở phase: Phase 4 (luồng Auth thật)
- Màn hình/luồng bị ảnh hưởng: màn đăng nhập (`app/(auth)/login.tsx`) — link "Quên mật khẩu?"
- Backend service liên quan: auth-service
- Mô tả thiếu gì cụ thể: auth-service CÓ `POST /auth/password-reset`, nhưng nó tiêu thụ một **token
  nằm sẵn trong link** (`authService.resetPasswordWithToken`) — token đó do luồng mời đối tác/admin
  phát hành, không phải do người dùng tự yêu cầu. **Không có route nào cho phép người dùng gửi
  email của chính mình để nhận link đặt lại.** Đã kiểm tra trực tiếp toàn bộ `auth.routes.ts`
  (không có `/forgot-password`, không có endpoint request-reset nào) chứ không suy đoán từ tài liệu.
- Mức ảnh hưởng: PARTIAL — đăng nhập/đăng ký hoạt động đầy đủ; chỉ người dùng quên mật khẩu là
  không tự khôi phục được.
- Đã thử tìm endpoint thay thế chưa: có — `POST /auth/password-reset` (cần token có sẵn),
  `PATCH /auth/me/password` (cần đang đăng nhập, nên vô dụng với người đã quên mật khẩu),
  `/internal/partner-auth/:op` (nội bộ giữa các service, không public). Không cái nào dùng được.
- Đề xuất (không tự làm nếu chưa được đồng ý): thêm `POST /auth/password-reset/request` nhận email,
  phát hành token có hạn và gửi mail bằng đúng hạ tầng gửi mail sẵn có của OTP đăng ký.
- Trạng thái: ~~ĐÃ BÁO CÁO — chờ quyết định~~ → **ĐÃ LÀM (2026-09-15)** theo quyết định của Ngài: làm
  GAP-4 và **cho phép sửa backend** — ngoại lệ có chủ đích với quy tắc "backend không bao giờ bị sửa".
  - **Backend (auth-service):** `POST /auth/password-reset/request { email }` →
    `authService.requestPasswordReset`. Dùng lại `issuePasswordResetToken` (token băm sha256, dùng một
    lần, huỷ link cũ) với hạn **1 giờ** (link admin phát hành vẫn 24 giờ), gửi mail bằng
    `sendPlainEmail`. Link dẫn tới trang web SẴN CÓ `/dat-lai-mat-khau/:token` → `POST /auth/password-reset`
    — bước đổi mật khẩu thật dùng chung đúng một đường code với link đối tác.
  - **Chống dò email:** mọi trường hợp (không có tài khoản / bị khoá / đang trong thời gian chờ 60 s /
    gửi mail lỗi) trả **cùng một** câu 200. Ngoại lệ duy nhất: `devResetLink` khi không cấu hình SMTP
    và không phải production — cùng đánh đổi `devOtp` của đăng ký.
  - **Chống "password-reset poisoning":** host của link chỉ lấy từ `FRONTEND_URL`, **không** lấy
    `x-public-base-url` của gateway (header đó dựng từ `X-Forwarded-Host` do client gửi — endpoint
    không cần đăng nhập, nên kẻ xấu có thể yêu cầu reset cho email nạn nhân với host giả để token
    rơi về tên miền của họ). **Cập nhật cùng ngày:** host của link giờ lấy từ header
    `x-trusted-web-origin` — gateway chỉ đặt header này từ Origin của trình duyệt khi Origin qua được
    chính sách tin cậy CORS (`trustedWebOrigin`, xoá mọi bản client tự gửi), và service chỉ tin nó khi
    `x-gateway-secret` khớp (cổng 3001/3006 được publish, gọi thẳng vào không giả được). Không có Origin
    (app mobile) → `FRONTEND_URL`. Link đối tác của gym-service (`partner.controller.ts`,
    `owner-partner.controller.ts`) đã chuyển sang cùng cơ chế, bỏ `x-public-base-url`. 4 test gateway mới.
  - **Giới hạn tần suất:** middleware mới `emailActionRateLimit` (5 yêu cầu/15 phút/email, đếm cả
    thành công vì mỗi yêu cầu có thể gửi một email) + thời gian chờ 60 s theo tài khoản trong service.
  - **Mobile:** `app/(auth)/forgot-password.tsx` thành form email → trạng thái "Kiểm tra hộp thư" (câu
    chữ có điều kiện "nếu email này có tài khoản"), gửi lại sau 60 s, vẫn giữ link liên hệ hỗ trợ.
    Mở token ngay trong app cần deep link → Phase 14.
  - **Kiểm chứng:** 8 unit test mới (tổng auth-service 45/45); kiểm thật qua gateway: email lạ,
    john.doe, gọi lại ngay, và gửi kèm `X-Forwarded-Host` giả đều nhận cùng câu 200; DB có đúng 1 token
    (`requested_by` NULL, hạn 60 phút); email sai định dạng → 400.
  - **Cấu hình (đã sửa theo cho phép của Ngài):** `FRONTEND_URL` trong `.env` từ IP LAN cũ
    `192.168.2.103` → `192.168.2.100`; tạo lại 4 container đọc biến này (gateway, auth, gym, payment —
    `env_file` không nạp lại khi chỉ restart). Với request từ web, link không còn phụ thuộc giá trị tĩnh
    này nữa (theo Origin tin cậy); chỉ request từ app mobile còn dùng nó.
  - **Web (đã sửa theo cho phép của Ngài):** link "Quên mật khẩu?" → trang mới `/quen-mat-khau`
    (`ForgotPasswordPage.tsx`); nút "Gửi lại" OTP trong `RegisterPage.tsx` gọi `POST /auth/register/resend`
    kèm đếm ngược (trước đây đăng ký lại từ đầu). `vite build` qua.
  - **Kiểm bằng hộp thư thật (15/9, `huytronh5+gap5@gmail.com`):** yêu cầu đặt lại gửi kèm
    `Origin: http://192.168.2.100:5173` → 200, DB có đúng 1 token (`requested_by` NULL, hạn 60 phút), log
    auth-service ghi "Email sent" + "Self-service password reset link issued". **Ngài mở link trong
    email và tự đặt mật khẩu mới:** request đổi mật khẩu tới từ trang
    `http://192.168.2.100:5173/dat-lai-mat-khau/…` (Referer, trình duyệt Edge), gateway gắn
    `x-trusted-web-origin` đúng giá trị đó → token đánh dấu đã dùng, `users.updatedAt` cùng thời điểm,
    refresh token của tài khoản còn **0** (mọi phiên bị huỷ), audit log `PASSWORD_RESET`, đăng nhập bằng
    mật khẩu cũ → **401**. ✅ Luồng GAP-4 đầu-cuối với hộp thư thật.
  - Ghi nhận nhỏ: logger request của auth-service in cả header `referer`, nên URL chứa token nằm trong
    log. Token ở đây đã bị tiêu thụ ngay trong chính request đó (dùng một lần), nên rủi ro thấp; nếu muốn
    chặt hơn thì lọc `referer` khỏi log request.

### GAP-5 — Không có endpoint gửi lại mã OTP đăng ký

- Phát hiện ở phase: Phase 4 (luồng Auth thật)
- Màn hình/luồng bị ảnh hưởng: bước OTP trong `app/(auth)/register.tsx`
- Backend service liên quan: auth-service
- Mô tả thiếu gì cụ thể: bản thiết kế có nút "Gửi lại" ở màn nhập OTP, nhưng auth-service chỉ có
  `POST /auth/register` (tạo tài khoản + gửi mã) và `POST /auth/register/verify`. Không có endpoint
  resend riêng; cách duy nhất để phát lại mã là gọi lại `/auth/register` với cùng thông tin.
- Mức ảnh hưởng: PARTIAL — đăng ký vẫn hoàn tất được nếu mã tới nơi; chỉ mất đường cứu khi mã thất
  lạc/hết hạn.
- Đã thử tìm endpoint thay thế chưa: có — không có route resend nào trong `auth.routes.ts`.
- Đề xuất: thêm `POST /auth/register/resend` nhận email, có giới hạn tần suất.
- Trạng thái: ~~ĐÃ BÁO CÁO — chờ quyết định~~ → **ĐÃ LÀM (2026-09-15)** theo quyết định của Ngài (cùng
  ngoại lệ cho phép sửa backend như GAP-4).
  - **Backend:** `POST /auth/register/resend { email }` → `authService.resendRegistrationOtp`. Chỉ chạy
    trên bản ghi `EmailVerification` đang chờ: giữ nguyên mật khẩu băm + tên của lần đăng ký gốc, chỉ
    thay mã (nên resend không bao giờ đổi được tài khoản sắp tạo), cấp hạn mới, **đặt lại số lần nhập
    sai về 0**. Cùng thời gian chờ `OTP_RESEND_SECONDS` với `register()`. Không có đăng ký chờ → 404;
    email đã có tài khoản → 409; trong thời gian chờ → 429. Cùng middleware `emailActionRateLimit`.
  - **Mobile:** nút "Gửi lại" trong `register.tsx` gọi thật, đếm ngược 60 s từ lúc mã được gửi, xoá các ô
    đã nhập (chúng thuộc mã vừa hết hiệu lực) và báo "mã cũ không còn dùng được".
  - **Kiểm chứng:** 4 unit test mới; kiểm thật qua gateway: không có đăng ký chờ → 404, john.doe → 409,
    gửi lại ngay sau đăng ký → 429 "đợi 56s", sau 62 s → 200 và DB cho thấy `otpHash` đổi, `sentAt` mới,
    `attempts` 3 → 0, `passwordHash` giữ nguyên. Bản ghi thử đã xoá.
  - **Đã kiểm bằng hộp thư thật (15/9):** đăng ký `huytronh5+gap5@gmail.com` trên emulator → bấm "Gửi
    lại" nhiều lần (mỗi lần DB đổi `otpHash`/`sentAt`, log ghi "OTP email sent") → Ngài nhận mã của lần
    gửi mới nhất (300542) → `POST /auth/register/verify` → 201, tài khoản CUSTOMER được tạo, bản ghi chờ
    bị xoá → đăng nhập tài khoản mới trên app vào thẳng trình thiết lập hồ sơ (SH-03). Lần nhập mã trên
    giao diện đã điền đủ 6 ô nhưng phím Back của công cụ điều khiển đưa app về đăng nhập trước khi bấm
    Xác nhận, nên bước verify cuối gọi thẳng API bằng đúng mã thật đó. (Log không thấy trước đó chỉ vì
    container chưa được tạo lại — sau khi tạo lại, auth-service ghi log bình thường.)

---

## GAP-6 — Không có endpoint nào trả "hoạt động theo tuần" cho Trang chủ

- Phát hiện ở phase: Phase 5 (CL-01 Trang chủ)
- Màn hình/luồng bị ảnh hưởng: thẻ "Hoạt động tuần" trên `app/client/dashboard.tsx`
- Backend service liên quan: fitness-service (stats)
- Mô tả thiếu gì cụ thể: bản thiết kế có một biểu đồ cột 7 ngày. Web không hề có thứ tương đương —
  ô "Calories tuần này" của web là một placeholder ghi thẳng "Không có dữ liệu · Đồng bộ thiết bị
  tập luyện để xem dữ liệu calo".
- Mức ảnh hưởng: **KHÔNG chặn** — `GET /stats/activity-heatmap?from&to` đã trả đúng thứ cần
  (`days: [{date, state}]`), nên bản mobile dựng biểu đồ tuần và cả chuỗi ngày tập từ endpoint đó.
- Đề xuất: không cần endpoint mới. Ghi lại ở đây để lần sau không ai đi tìm một API "weekly
  activity" vốn không tồn tại.
- Trạng thái: ĐÃ GIẢI QUYẾT bằng endpoint sẵn có.

---

## GAP-7 — `POST /workouts/:id/sets` có thật nhưng chưa client nào bọc

- Phát hiện ở phase: Phase 5 (CL-17 nhật ký tập sống)
- Màn hình/luồng bị ảnh hưởng: nút "Thêm set" trong `app/client/workout/log.tsx`
- Backend service liên quan: fitness-service (`workout.routes.ts:196` →
  `workoutController.addSet` → `workoutService.addSet`)
- Mô tả thiếu gì cụ thể: endpoint tồn tại đầy đủ (có kiểm rpe 1-10, rir 0-5, setType theo
  SET_TYPES), nhưng **tầng service của cả web lẫn mobile đều chưa có hàm gọi nó** — đó là lý do
  màn nhật ký của web không thêm được set ngoài bộ khung giáo án.
- Mức ảnh hưởng: KHÔNG chặn — bản thiết kế mobile có yêu cầu "Thêm set", nên wrapper
  `workoutService.addSet` được viết ở phía mobile theo đúng contract thật của endpoint.
  **Backend không bị đụng tới.**
- Trạng thái: ĐÃ XỬ LÝ ở phía client (mobile).
- **Port ngược sang web: HOÃN — quyết định của Ngài 2026-09-15, "để sau chưa làm ngay".** Khi làm cần
  lưu ý: (1) kế hoạch cấm sửa `frontend/web` trong Phase 0–14, nên chỉ làm khi được cho phép riêng;
  (2) `WorkoutLogPage.tsx` có hàng đợi offline bền (`enqueueWorkoutEvent`) — thêm set phải đi qua hàng
  đợi đó, không gọi thẳng API, nếu không set thêm lúc mất mạng sẽ mất; (3) mở rộng + chạy lại bộ E2E web.
- **Đã kiểm E2E 2026-09-15:** "Thêm set" trên emulator tạo đúng hàng `workout_sets` set_number 5 trong
  `gymcoach_fitness`; tick nốt thì schedule chuyển `COMPLETED`.
- **Ghi nhận thêm (không chặn, KHÔNG sửa backend):** `addSet` không tính lại tiến độ, và
  `recomputeScheduleProgress` lấy `total_sets` từ **giáo án** chứ không từ số set đã ghi. Sau khi thêm
  1 set ngoài giáo án, schedule lưu `completed_sets = 5`, `total_sets = 4` (số hoàn thành lớn hơn tổng).
  `progress_percent` vẫn đúng vì tính theo số *bài*, không theo số set. Màn nào sau này hiện
  "x/y set" từ hai cột này sẽ ra "5/4" — nên đếm từ `workoutSets` thay vì tin hai cột đó.

---

## GAP-8 — Chia sẻ mẫu buổi tập cần danh tính người nhận từ domain hợp đồng

- Phát hiện ở phase: Phase 5 (CL-16 Mẫu buổi tập)
- Màn hình/luồng bị ảnh hưởng: `app/client/workout/templates.tsx`
- Backend service liên quan: fitness-service (`POST /templates/:id/share`) + user-service (contracts)
- Mô tả thiếu gì cụ thể: endpoint share nhận `recipientUserId`. Web lấy id đó bằng cách liệt kê
  hợp đồng PT/khách đang ACTIVE (`contractService.getByPT`/`getByClient`). Trên mobile, domain hợp
  đồng thuộc Phase 7/11 nên chưa có nguồn nào để chọn người nhận.
- Mức ảnh hưởng: PARTIAL — tạo mẫu và áp mẫu vào lịch đều chạy thật; chỉ riêng chia sẻ bị hoãn.
- Đề xuất: không cần backend mới; chỉ cần Phase 7/11 lên là nối được.
- Trạng thái: HOÃN CÓ CHỦ ĐÍCH — không dựng ô nhập user-id tự do, vì đó là thứ không ai dùng đúng.

## GAP-9 — InBody: thiếu `muscleMass` trả 500, và không có đường xoá phiếu đo

- Phát hiện: Phase 6 (CL-14), 2026-09-16, thử trực tiếp trên backend đang chạy.
- Mong đợi: tạo phiếu đo thiếu một trường bắt buộc thì nhận 400 kèm thông điệp đọc được; và người
  dùng nhập nhầm thì xoá được phiếu.
- Thực tế:
  1. `POST /inbody` không có `muscleMass` → **500 `{"error":"Internal server error"}`**. Cột
     `muscleMass` không nullable nên lỗi rơi thẳng xuống Prisma. Trường `bodyFat` đã được xử lý tử tế
     (suy ra từ `weight × bodyFatPct`, hoặc 400 kèm hướng dẫn) — `muscleMass` thì chưa.
  2. Không có `DELETE /inbody/:id`. Routes chỉ có `GET /`, `GET /latest`, `GET /client/:id`,
     `POST /`, `PATCH /:id`, `POST /upload`. Phiếu đo sai chỉ sửa đè được, không xoá được; phiếu đo
     nhầm NGÀY thì phải sửa ngày (và có thể đụng ràng buộc một-phiếu-một-ngày).
- Mức ảnh hưởng: PARTIAL — luồng chính chạy đủ.
- Đã xử lý ở client: form bắt buộc nhập khối cơ và chặn tại chỗ, nên người dùng không chạm được vào
  lỗi 500. Phần xoá thì mobile **không dựng nút xoá** thay vì gọi một endpoint không tồn tại.
- Đề xuất (không tự làm nếu chưa được đồng ý): đưa `muscleMass` vào cùng nhánh kiểm tra với `bodyFat`
  (400 kèm thông điệp), và thêm `DELETE /inbody/:id` chỉ cho chủ sở hữu.
- Trạng thái: ĐÃ BÁO CÁO — chờ quyết định.

## GAP-10 — Không có đường nào ghi lượng nước uống (chỉ có mục tiêu)

- Phát hiện: Phase 6 (CL-01 — hai ô chỉ số Trang chủ), 2026-09-17, rà thẳng code backend.
- Màn hình/luồng bị ảnh hưởng: CL-01 (ô "Nước" trong thiết kế `New Frontend/src/screens/Home.tsx`),
  CL-19 (ô "Nước TB / ngày" của bản tổng kết tháng).
- Backend service liên quan: fitness-service.
- Mô tả thiếu gì cụ thể: thiết kế vẽ ô nước dạng "đã uống / mục tiêu" (1.6 / 3.0 L). Trong backend:
  - `NutritionGoal.waterMl` (`prisma/schema.prisma:432`) có thật, đọc/ghi được qua
    `GET|PUT /nutrition/goals` — nhưng đây là **MỤC TIÊU**, không phải lượng đã uống.
  - `NutritionLog` không có trường nước; không có route nào kiểu `POST /nutrition/water`.
  - `BodyMetrics.body_water` (`schema.prisma:463`) là **% nước trong cơ thể** của phép đo InBody,
    lại **không route API nào đọc nó**, và dù có cũng không phải lượng nước uống trong ngày.
  Tức là cái thiết kế vẽ không có nguồn dữ liệu nào cả — không phải mobile chưa gọi.
- Mức ảnh hưởng: PARTIAL — phần calo của cặp ô vẫn có dữ liệu thật.
- Đã thử tìm endpoint thay thế chưa: có, không có gì thay thế được (xem ba gạch đầu dòng trên).
- Đã xử lý ở client: Trang chủ hiển thị **Calo hôm nay** (thật) và **Đạm hôm nay** (thật) thay vì vẽ
  một ô nước vĩnh viễn "— / 3.0 L"; bản tổng kết tháng bỏ hẳn ô nước. Mục tiêu nước vẫn đặt được ở
  màn Mục tiêu dinh dưỡng vì `waterMl` ghi được — chỉ là chưa có gì đối chiếu với nó.
- Đề xuất (không tự làm nếu chưa được đồng ý): thêm bảng/route ghi nước theo ngày
  (`POST /nutrition/water { date, ml }` + tổng hợp trong `daily-task`), khi đó ô nước của thiết kế
  mới dựng được đúng nghĩa.
- Trạng thái: ĐÃ BÁO CÁO — chờ quyết định.

## GAP-11 — Danh sách gym hợp tác của PT rộng hơn điều kiện tạo hợp đồng

- Phát hiện: Phase 7 (CL-10/CL-11), 2026-09-17, thử thật trên máy ảo rồi truy ngược DB.
- Màn hình/luồng bị ảnh hưởng: CL-11 (chọn phòng gym khi gửi yêu cầu hợp đồng gói OFFLINE).
- Backend service liên quan: gym-service (nguồn danh sách) + user-service (nơi kiểm khi tạo).
- Mô tả thiếu gì cụ thể: **hai truy vấn lệch nhau đúng một điều kiện.**
  - `GET /pt/:ptUserId/gyms` → `collaborationService.listAcceptedGymsForPt`:
    `where { ptUserId, status: 'ACCEPTED', gym: { status: 'APPROVED' } }`.
  - `POST /contracts/request` → gọi `gymClient.getActiveCollaboration` → `activeRates`:
    cùng điều kiện trên **cộng thêm `effectiveAt: null`** (Vòng 4 / Phase E3: hợp tác đang chờ
    chấm dứt thì không được dùng cho hợp đồng MỚI).
  Kết quả: bộ chọn phòng gym liệt kê cả những hợp tác đang chờ chấm dứt, người dùng chọn xong thì
  nhận 400 *"PT chưa có thoả thuận hợp tác với phòng gym này"* — một thông điệp vừa sai vừa khó hiểu,
  vì thoả thuận có thật, chỉ là sắp hết hiệu lực. Kiểm chứng trên DB: PT `f506697b…` có 9 hợp tác
  ACCEPTED, **4 trong đó `effective_at` đã đặt** và đúng 4 cái đó bị từ chối, 5 cái còn lại tạo được
  hợp đồng bình thường.
- Mức ảnh hưởng: PARTIAL — vẫn tạo được hợp đồng qua phòng gym, chỉ là người dùng có thể chọn nhầm.
- Đã thử tìm endpoint thay thế chưa: có. Không có: response của danh sách **không trả `effectiveAt`**
  nên client không thể tự lọc ra những hợp tác sắp hết hiệu lực.
- **Web cũng dính y hệt** (dùng chung endpoint này ở `PTDiscoveryPage`) — đây là lỗi backend, không
  phải khác biệt do bản mobile.
- Đã xử lý ở client: hiện nguyên văn thông điệp lỗi của máy chủ thay vì nuốt lỗi, và **không tự bịa**
  bộ lọc dựa trên dữ liệu không có.
- Đề xuất (không tự làm nếu chưa được đồng ý): cho `listAcceptedGymsForPt` dùng đúng điều kiện của
  `activeRates` (`effectiveAt: null`), hoặc trả thêm `effectiveAt` để client tự đánh dấu "sắp kết
  thúc hợp tác".
- Trạng thái: ĐÃ BÁO CÁO — chờ quyết định.

---

## GAP-12 — Không bỏ chọn được vùng miền (region) một khi đã chọn

- Phát hiện: vá WB-14 vào Phase 6, 2026-09-18, gọi thật `PUT /profile/me`.
- Màn hình/luồng bị ảnh hưởng: tuỳ chỉnh gợi ý món (ngân sách + vùng miền) — mobile đặt tạm trong
  thẻ tóm tắt dinh dưỡng, web đặt ở Cài đặt › Dinh dưỡng.
- Backend service liên quan: user-service, `models/profile.models.ts`:
  `region: z.enum(["BAC", "TRUNG", "NAM"]).optional()` — **không có `.nullable()`**.
- Mô tả thiếu gì cụ thể: gửi `{ region: null }` bị trả **400** `Expected 'BAC' | 'TRUNG' | 'NAM',
  received null` (đã thử thật trên john.doe). Không có cách nào khác để xoá trường này về rỗng, dù
  engine gợi ý coi rỗng là "gợi ý chung toàn quốc" và giao diện web ghi rõ "chạm lại để bỏ chọn".
- **Web dính lỗi này**: `NutritionSection.tsx` gửi `region: null` khi chạm lại vùng đang chọn → toast
  "Không thể cập nhật". Đây là lỗi backend/web, không phải khác biệt do mobile.
- Mức ảnh hưởng: PARTIAL — đổi vùng được, chỉ không xoá được.
- Đã xử lý ở client: mobile **không gửi** yêu cầu biết chắc sẽ hỏng — chạm lại vùng đang chọn không
  làm gì, và bỏ dòng "chạm lại để bỏ chọn" khỏi chú thích (`regionToSend` trong
  `src/features/nutrition/foodSuggestions.ts`, có unit test).
- Đề xuất (không tự làm nếu chưa được đồng ý): `.nullable().optional()` cho `region` (và
  `nutritionBudgetLevel` nếu muốn về mặc định).
- Tác dụng phụ trong lúc kiểm: tài khoản test john.doe nay có `region = NAM` (trước là rỗng) — không
  đưa về rỗng được qua API vì chính lỗi này; sửa DB trực tiếp cần Ngài cho phép.
- Trạng thái: ĐÃ BÁO CÁO — chờ quyết định.
