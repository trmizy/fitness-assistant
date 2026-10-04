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

## ⏳ Đang chờ Ngài quyết định (chốt lại 2026-09-24, khi đóng Phase 9)

Hai gap dưới đây **không chặn** Phase 10 (không gian HLV), nhưng phải được quyết trước khi coi
luồng tiền / chat là hoàn chỉnh. Ghi ở đây để các phase sau không vô tình bỏ quên:

| Gap | Đang vướng gì | Ai quyết | Mobile đang làm gì tạm |
|---|---|---|---|
| **GAP-13** — khiếu nại / hoàn tiền đơn 1-1 | `openDispute` không kiểm trạng thái đơn và `DISPUTED` không có đường ra (không màn admin, không API phân xử); chính sách hoàn tiền theo tiến độ chưa chốt | **Ngài + partner** | Hai nút "Yêu cầu hoàn tiền" / "Khiếu nại" đang **comment lại** (không xoá) trong `app/client/plans/orders/[id].tsx` — tìm chuỗi "TẠM TẮT 22/9". Helper + unit test vẫn giữ để bật lại là chạy ngay |
| **GAP-14** — socket gateway giữ token lúc bắt tay | Access token sống 15 phút nhưng gateway dùng lại token bắt tay cho mọi lần gọi chat-service → socket mở lâu bị từ chối vào phòng / gửi tin | **Quyết định backend** (web cũng dính) | `ensureFreshSocket()` trong `src/realtime/socketClient.ts` tự kết nối lại khi token bắt tay còn < 60s — đã kiểm socket 3,5 giờ tuổi vẫn nhắn được |

Khi Ngài chốt: GAP-13 cần backend (guard trạng thái + luồng admin) → web → rồi mới bỏ comment ở mobile;
GAP-14 nếu backend làm mới token theo từng lần gọi thì cách vá của mobile trở thành thừa nhưng vô hại.

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

- **Đối chiếu lại 28/9 (Phase 13, `CODE AUDIT`):** backend nay CÓ đường "tạm ngưng PT" gián tiếp:
  `PATCH /admin/users/:id/disable|enable` (gateway → auth-service `setUserActive`) khoá tài khoản, và
  nếu tài khoản là PT thì **relay `DEACTIVATE`/`REACTIVATE` sang user-service** (có hàng thử lại). Vẫn
  **không có** danh sách roster PT kèm rating/số học viên. Nghĩa là: tạm ngưng/khôi phục một PT làm
  được từ màn Người dùng (AD-05) nếu Ngài cho mở hành động đó; màn roster riêng như mock vẫn BLOCKED.

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

- **Đối chiếu lại 28/9 (Phase 13, `CODE AUDIT`):** endpoint KHÔNG còn là "chưa rõ ngữ nghĩa":
  `PATCH /admin/users/:userId/disable|enable` là khoá/mở **mọi** tài khoản (chỉ ADMIN), kèm relay PT ở
  GAP-1. Web vẫn chỉ dùng nó ở màn chủ gym. **Chỗ hỏng thật nằm ở danh sách:** gateway `GET /admin/users`
  gán cứng `status = "Active"` và bỏ `isActive` mà auth-service đã trả → một tài khoản vừa bị khoá vẫn
  hiện "Active". Xem GAP-21. Còn lại là quyết định sản phẩm của Ngài: mobile có mở nút khoá/mở khoá
  cho người dùng thường không (web chưa có).

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

## GAP-19 — `requestContract` còn một thông báo lỗi tiếng Anh sót lại

- Phát hiện: Phase 11 (PT-07), 2026-09-25, khi khách gửi yêu cầu hợp đồng cho PT đã có hợp đồng.
- `contract.service.ts` viết gần như toàn bộ lỗi của `requestContract` bằng tiếng Việt (dòng 308–326:
  "Gói dịch vụ này đã ngừng bán", "PT hiện đang tạm ngưng nhận khách mới", …) nhưng **dòng 392** vẫn là
  `throw err("You already have an active or pending contract with this PT", 409)`.
- Hậu quả: người dùng Việt thấy nguyên câu tiếng Anh. Web cũng hiện y hệt (cùng endpoint).
- Mobile (đã vá, không đụng backend): `contractRequestError()` trong
  `src/features/services/contracts.ts` ánh xạ các chuỗi tiếng Anh đã biết sang tiếng Việt và cho qua
  nguyên văn những câu vốn đã tiếng Việt. Đã kiểm trên máy: toast nay là "Bạn đang có hợp đồng với huấn
  luyện viên này rồi…".
- Sửa tận gốc chỉ là đổi một chuỗi ở user-service — nhỏ, nhưng thuộc backend nên chờ Ngài cho phép.
- Trạng thái: ĐÃ VÁ PHÍA MOBILE — backend chờ quyết định.
## GAP-13 — Khiếu nại / hoàn tiền đơn dịch vụ 1-1: luồng chưa hoàn chỉnh — ⏸ TẠM TẮT TRÊN MOBILE, CHỜ BÀN VỚI PARTNER

- Phát hiện: Phase 8 (CL-12), 2026-09-22, đọc `ai-service/src/services/personalized-service.service.ts`
  + `controllers/personalized-service.controller.ts` + web admin.
- **Khiếu nại (`POST /marketplace/orders/:id/dispute`, `openDispute`)**:
  - Không kiểm trạng thái đơn — chỉ kiểm người gọi là khách **hoặc PT** của đơn, rồi đặt `DISPUTED`.
  - `DISPUTED` chỉ được GHI ở đúng một chỗ, **không chỗ nào đọc lại**: không màn admin, không API xử lý, không
    bước nào đưa đơn ra khỏi trạng thái này (trang "Khiếu nại buổi tập" của admin web là cho buổi tập hợp
    đồng PT, không phải đơn 1-1). Khiếu nại chính đáng cũng nằm im mãi.
  - Hậu quả cụ thể khi gọi được:
    1. Đơn `PENDING_PAYMENT` → `DISPUTED`: khách trả tiền xong, `activateAfterPayment` chỉ cập nhật đơn còn
       `PENDING_PAYMENT` nên bỏ qua → tiền đã bị giữ, đơn không kích hoạt.
    2. Đơn `CANCELLED` / `REFUNDED` / `COMPLETED` → `DISPUTED`: lịch sử đơn sai; với `COMPLETED` tiền đã chuyển
       cho PT từ lúc khách chấp nhận, và khách mất quyền đánh giá (đánh giá chỉ khi `COMPLETED`).
    3. PT cũng khiếu nại được → đẩy đơn đang chạy của khách sang `DISPUTED`, khách không check-in / kết thúc
       dịch vụ được nữa (hai việc đó chỉ khi `ACCEPTED`/`ACTIVE`).
- **Hoàn tiền (`POST /marketplace/orders/:id/refund-request`, `requestRefund`)**: có kiểm trạng thái (chặn
  REFUNDED/CANCELLED/REFUND_REQUESTED) và admin có luồng duyệt (`/marketplace/orders/refund-requests`,
  `refund-resolve`), nhưng vẫn gọi được từ `DISPUTED`, và chính sách "ai được hoàn bao nhiêu khi PT đã làm một
  phần" chưa được chốt với partner.
- Web: có hàm `openDispute` nhưng **không nút nào gọi**; nút "Yêu cầu hoàn tiền / Khiếu nại" của web chỉ gọi
  hoàn tiền (web KHÔNG đổi trong đợt này).
- **Mobile (22/9, lệnh Ngài)**: comment lại — KHÔNG xoá — hai nút "Yêu cầu hoàn tiền" + "Khiếu nại", hai sheet
  và hai mutation trong `frontend/mobile/app/client/plans/orders/[id].tsx` (tìm "TẠM TẮT 22/9"). Helper
  `canRequestRefund` / `canDispute` và unit test của chúng vẫn giữ. "Huỷ đơn" (trước khi PT làm) vẫn bật.
  Banner "Đang yêu cầu hoàn tiền / Đang khiếu nại" vẫn hiện nếu đơn đã ở hai trạng thái đó.
- **Việc cần làm sau (sau khi Ngài bàn với partner)**:
  1. Chốt chính sách: ai được khiếu nại (khách, PT, cả hai), ở trạng thái nào; hoàn tiền bao nhiêu theo tiến độ.
  2. Backend (ai-service): guard trạng thái cho `openDispute`; luồng admin xử lý `DISPUTED` (xem, phân xử,
     đưa đơn về trạng thái trước / hoàn tiền / đóng); không cho `requestRefund` từ `DISPUTED` nếu chính sách
     không muốn.
  3. Web: màn admin cho khiếu nại đơn 1-1; tách nút hoàn tiền / khiếu nại cho khách nếu chính sách giữ cả hai.
  4. Mobile: bỏ comment ở `orders/[id].tsx` (ba chỗ) + kiểm lại trên máy.
- Trạng thái: ⏸ TẠM TẮT — chờ Ngài bàn với partner. **Xác nhận lại 24/9 (đóng Phase 9): vẫn đang chờ, mang sang Phase 10.**

## GAP-14 — Socket gateway giữ token lúc bắt tay suốt đời kết nối → chat hỏng sau 15 phút

- Phát hiện: Phase 9 (SH-04), 2026-09-22, kiểm chat realtime trên máy ảo: tin PT gửi không tới máy.
- Nguyên nhân: `backend/gateway/src/socket/socketAuth.ts` lưu `socket.data.authToken` lúc bắt tay;
  `handlers/chat.handlers.ts` dùng đúng token đó để gọi chat-service mỗi lần `chat:join_conversation`
  (kiểm quyền) và `chat:message:send` (lưu tin). Access token sống 15 phút (`JWT_ACCESS_EXPIRY`), nên một
  socket mở lâu hơn 15 phút bị từ chối vào phòng / gửi tin, dù socket vẫn "connected" — lỗi trả qua
  `chat:error`, không có dấu hiệu nào khác. Web dính y hệt (tab web mở > 15 phút rồi vào chat).
- Mobile (đã làm, không đụng backend): `realtime/socketClient.ts` nhớ token đã bắt tay; `ensureFreshSocket()`
  kết nối lại socket (callback `auth` làm mới phiên) trước khi vào phòng / gửi tin nếu token đó còn < 60s.
  Đã kiểm trên máy ảo: socket 3,5 giờ tuổi → vào lại hội thoại → nhận/gửi realtime bình thường.
- Đề xuất backend (chờ quyết định): cho client gửi token mới qua một sự kiện (vd `auth:refresh`) hoặc để
  gateway tự làm mới/kiểm lại token mỗi lần gọi service; web cũng hưởng lợi.
- Trạng thái: ĐÃ VÁ PHÍA MOBILE — backend chờ quyết định. **Xác nhận lại 24/9 (đóng Phase 9): vẫn đang chờ, mang sang Phase 10.**

## GAP-15 — Ảnh trong AI Coach (image-chat, goal-image) chạy bằng khoá Anthropic dành riêng cho InBody

- Phát hiện: Phase 9 (WB-12), 2026-09-22, khi kiểm luồng "Gửi ảnh & hỏi AI" trên máy ảo.
- Nguyên nhân (đọc code, không đọc giá trị khoá): `ai-service/src/services/fitness-vision-chat.service.ts`
  (và bản goal-image cùng mẫu) chọn nhà cung cấp theo thứ tự `LLM_PROVIDER=bedrock` → **`ANTHROPIC_API_KEY`
  có mặt** → Ollama `GOAL_VISION_MODEL`. Container `gymcoach-ai-dev` hiện có `ANTHROPIC_API_KEY` (khoá Ngài
  quy định **chỉ dùng cho quét InBody**), không đặt `GOAL_VISION_MODEL` → mọi ảnh gửi AI Coach đi qua khoá đó.
  Web dính y hệt (cùng endpoint).
- Đã xảy ra: 1 yêu cầu image-chat lúc kiểm (09:40, 22/9), server trả 500. **Đính chính (kiểm lại 22/9):** 500 là
  `PayloadTooLargeError` ở bước đọc body (GAP-18) — yêu cầu **chưa tới Anthropic**, khoá chưa bị dùng. **Đã ngừng mọi
  kiểm thử luồng ảnh** (cả "Ảnh hình thể tham khảo") cho tới khi Ngài quyết.
- Mobile (đã làm): lỗi 5xx của `/ai/agent/*` hiện câu tiếng Việt, không hiện câu tiếng Anh thô của server.
- Cần Ngài quyết (backend/cấu hình, mobile không đụng): (a) bỏ `ANTHROPIC_API_KEY` khỏi env của ai-service,
  chỉ để service InBody dùng; hoặc (b) thêm cờ riêng (vd `VISION_CHAT_PROVIDER`) để image-chat/goal-image
  không tự dùng khoá InBody; hoặc (c) cho phép dùng khoá cho hai luồng này.
- **Quyết định 22/9 (Ngài): chọn (c)** — cho phép image-chat và goal-image dùng khoá này. Chỉ hai luồng ảnh đó;
  mọi luồng khác vẫn cấm dùng khoá.
- Trạng thái: ĐÃ QUYẾT (c) — không cần đổi backend. Luồng ảnh được phép kiểm trên máy.

## GAP-16 — Image user-service dev mang bản `@gym-coach/shared` cũ → mọi thao tác agent qua user-service lỗi 500

- Phát hiện: Phase 9 (WB-12), 22/9, hỏi AI Coach "Tìm PT cho tôi" trên máy ảo: hỏi đủ mục tiêu/ngày/ngân sách
  thì server trả "An unexpected error occurred".
- Chuỗi lỗi (đã kiểm): ai-service → `POST user-service /profile/agent/candidates` → 500. Chạy thẳng hàm
  `agenticFitnessService.candidates` trong container: `TypeError: Cannot read properties of undefined (reading
  'parse')` — `AgentPreferencesSchema` là `undefined` vì `/app/backend/shared/dist` trong image
  `compose-user-service` là bản build 13/9, chưa có `fitness-agent` (thêm sau merge 18/9). Image ai-service
  thì có bản mới. `src` của user-service được mount nhưng `shared/dist` nằm cứng trong image.
- Ảnh hưởng: mọi công cụ agent ở user-service (`/profile/agent/candidates`, `/goal`, `/drafts`, …) → web và
  mobile đều không ra được gợi ý PT/chương trình, không tạo được nháp hợp đồng qua AI Coach.
- Không phải lỗi code — môi trường dev cũ. Cách sửa: build lại image user-service (lưu ý gotcha
  `patchedDependencies` với Dockerfile.dev) rồi recreate container. Mobile không tự làm (đụng backend đang chạy
  chung) — chờ Ngài cho phép.
- Phía mobile (đã sửa, do dữ liệu thật lộ ra): khối WORKFLOW_MISSING_DATA nhận `known` dạng `{label, value}` (web
  khai `string[]` và render thẳng → nhiều khả năng web cũng sập ở khối này); enum mục tiêu hiện tiếng Việt.
- **22/9 — ĐÃ XỬ LÝ (Ngài cho phép):** build lại + recreate `user-service` (migrate status "up to date" trước khi
  chạy) và `fitness-service` (image này cũng mang shared cũ → `/workouts/agent/candidates` 500; `migrate diff` DB ↔
  schema rỗng nên `db push --accept-data-loss` lúc khởi động không đổi gì). Tên biến môi trường trước/sau giống
  hệt; cả hai healthy; `AgentPreferencesSchema` có mặt. Tìm PT qua AI Coach hết 500 (trả kết quả thật).
  Lưu ý: lần khởi động fitness chạy `seed_all` như mọi lần, và lần này importer `exercise_muscle_mapping` **chèn
  3.065 dòng ánh xạ bài tập–nhóm cơ** (bỏ qua 36 trùng) — dữ liệu danh mục, không phải dữ liệu người dùng; image cũ
  chưa có importer này. `auth-service` cũng còn shared cũ nhưng không dùng phần agent — chưa đụng.
- Trạng thái: ĐÃ XỬ LÝ (môi trường dev).

## GAP-17 — AI Coach "gợi ý chương trình tự tập" hỏng khi hồ sơ chưa có trình độ tập

- Phát hiện: Phase 9 (WB-12), 22/9, sau khi GAP-16 đã xử lý. "tôi tự tập, gợi ý chương trình" → hỏi mục tiêu → hỏi
  ngày tập → server trả "An unexpected error occurred".
- Nguyên nhân (đã kiểm): `fitness-service /workouts/agent/candidates` trả **422 "Provide goal, training days and
  experience level"**; hồ sơ john có `experienceLevel` = null. Workflow `find-pt-program` của ai-service không có
  bước hỏi trình độ, và lỗi 422 bị đổi thành câu tiếng Anh chung chung — người dùng kẹt, không biết cần bổ sung gì.
  Web dính y hệt.
- Không sửa dữ liệu john để test qua (quy tắc repo). Mobile không đổi backend.
- Đề xuất backend: thêm slot "trình độ tập" vào workflow này (hoặc đọc từ hồ sơ và hỏi nếu thiếu), và trả 422 thành
  câu hỏi/thông điệp tiếng Việt thay vì lỗi chung.
- **22/9 — ĐÃ SỬA (lệnh Ngài, sửa backend ai-service):** thêm slot "trình độ tập" (PROFILE_FACT → `experienceLevel`,
  qua khối "Cập nhật hồ sơ" có sẵn) vào workflow gợi ý chương trình (`find-pt-program.workflow.ts`); parser
  `parseExperienceLevel` (`slot-values.ts`, không nhận nhầm "mỗi buổi"); `experienceLevel` vào whitelist ghi hồ sơ +
  bí danh trong context (`fitness-agent-tools.ts`); bỏ `experienceLevel` khỏi AgentPreferences khi tiếp tục
  (`fitness-agent.service.ts`); mục tiêu trong phần "đã biết" hiện tiếng Việt thay enum. Test mới
  `agent-workflow-program-experience.test.ts` (BACKEND INTEGRATION, DB `gymcoach_ai_test`) 2/2 + test cũ
  `agent-workflow-program-e2e` xanh. REAL emulator: hỏi đủ 4 mục → khối "Trình độ tập: Chưa thiết lập → Mới tập"
  (không bấm xác nhận để khỏi ghi hồ sơ john). Web: khối xác nhận của web chưa có nhãn cho `experienceLevel`
  (sẽ hiện tên trường thô) — không sửa web.
- Trạng thái: ĐÃ SỬA.

## GAP-18 — "Gửi ảnh & hỏi AI" (image-chat) hỏng với ảnh chụp thật: giới hạn body 100 KB

- Phát hiện: Phase 9 (WB-12), 22/9, gửi 1 ảnh (≈1,1 MB) qua "Gửi ảnh & hỏi AI" → 500; log ai-service:
  `PayloadTooLargeError: request entity too large`.
- Nguyên nhân (đọc code): `ai-service/src/app.ts` chỉ nới `express.json({ limit: "6mb" })` cho
  `/ai/agent/goal-image`; `/ai/agent/image-chat` rơi vào `express.json()` mặc định **100 KB**. Ảnh gửi dạng base64
  JSON, nên ảnh > ~75 KB đều bị từ chối trước khi tới xử lý — web (cho chọn tới 4 MB) dính y hệt.
- Lỗi này bị trả thành 500 chung → mobile hiện "Không thể phân tích ảnh. Vui lòng thử lại." (đã kiểm trên máy).
- Mobile không tự nén ảnh xuống < 100 KB để lách (ảnh sẽ quá mờ để máy/lịch tập đọc được, và web vẫn hỏng).
- Đề xuất backend: thêm `app.use("/ai/agent/image-chat", express.json({ limit: "6mb" }))` như goal-image; trả 413
  với thông điệp tiếng Việt.
- goal-image (giới hạn 6 MB) đã kiểm trên máy 22/9 — chạy tới kết quả thật (sau khi mobile sửa nhãn loại ảnh).
- **22/9 — ĐÃ SỬA (lệnh Ngài):** `ai-service/src/app.ts` thêm `express.json({ limit: "6mb" })` cho
  `/ai/agent/image-chat`; lỗi body quá lớn nay trả 413 "Ảnh quá lớn. Hãy chọn ảnh JPEG/PNG dưới 4 MB." thay vì 500.
  REAL emulator: gửi ảnh phòng gym + "Phòng tập này có gì?" → AI trả lời đúng nội dung ảnh (qua khoá theo GAP-15 (c)).
- Trạng thái: ĐÃ SỬA.

## GAP-20 — Liên kết xác minh đối tác không mở được thẳng ứng dụng (Phase 12, WB-15)

**Hiện trạng.** Thư "Xác minh email để trở thành đối tác" trỏ tới trang WEB:
`{x-public-base-url}/partner/apply/verify#token=…`. Trên điện thoại, một liên kết https chỉ mở thẳng
ứng dụng khi có **App Links đã xác minh tên miền** (Android cần `assetlinks.json` trên chính tên miền
đó). Môi trường phát triển chưa có tên miền nào để xác minh.

**Ảnh hưởng.** Người dùng bấm liên kết trong thư trên điện thoại sẽ mở trình duyệt, không mở app.

**Ứng dụng đang xử lý thế nào.** Màn `partner/verify` nhận mã theo ba đường: deep link
`fitnessassistant://partner/verify#token=…`, dán cả liên kết, hoặc dán riêng mã. Đủ dùng, nhưng
không phải trải nghiệm đúng.

**Cần ở phía backend/hạ tầng (khi có tên miền thật).** Phục vụ `/.well-known/assetlinks.json` với
`applicationId` và dấu vân tay chứng chỉ ký của ứng dụng; giữ nguyên dạng liên kết hiện tại (mã ở
fragment) — không cần đổi gì trong thư.

**Không chặn Phase 12.**

## GAP-21 — Danh bạ người dùng của admin gán sai vai trò và trạng thái (Phase 13, AD-01/AD-05)

**Phát hiện 28/9** khi dựng AD-01 trên dữ liệu thật. Nằm ở gateway (`backend/gateway/src/routes/
proxy.routes.ts`), hai route tổng hợp `GET /admin/dashboard` và `GET /admin/users`:

1. **Vai trò:** `role: u.role === "PT" ? "PT" : "Client"` (và biến thể có "Admin") → mọi tài khoản
   **GYM_OWNER hiện là "Client"**. Thấy thật: `p12-mobile@example.com` (chủ gym vừa được duyệt) nằm
   trong "Đăng ký gần đây" với nhãn khách hàng.
2. **Phân bổ vai trò của dashboard** chỉ có `Clients` + `Trainers` → 143 + 8 = 151 trên tổng 205;
   54 tài khoản (chủ gym, quản trị viên…) không thuộc cột nào.
3. **Trạng thái:** `/admin/users` gán cứng `status = "Active"` (chú thích trong code: "We don't have a
   suspended/inactive field yet") — nhưng auth-service **đã** trả `isActive`. Hệ quả: khoá một tài
   khoản xong, danh sách vẫn nói "Active".
4. `recentUsers` của dashboard gán `status = "Pending"` cho mọi PT — nhãn không có nghĩa gì với PT đã duyệt.

**Mobile đang xử lý thế nào.** AD-01 hiện phần chênh là **"Chưa phân loại"** kèm một câu giải thích,
thay vì để 151 và 205 mâu thuẫn cạnh nhau. Nhãn vai trò từng dòng vẫn là của máy chủ (app không có cách
biết đúng hơn). AD-05 **chưa** làm hành động khoá/mở — làm rồi mà danh sách không phản ánh thì người
duyệt không biết mình vừa làm gì.

**Cần ở gateway (nhỏ):** ánh xạ `GYM_OWNER` → một nhãn riêng; thêm cột chủ gym (và admin nếu muốn) vào
`roleData`; lấy `status` từ `isActive` của auth-service; bỏ "Pending" cho PT. Không đổi hình dạng
câu trả lời.

**Không chặn AD-01 / AD-06. Chặn phần "khoá/mở khoá" của AD-05.**

**ĐÃ SỬA 28/9 (Ngài cho phép):** `backend/gateway/src/utils/adminUserView.ts` + `proxy.routes.ts` —
nhãn "Gym Owner", lát "Gym owners" trong `roleData`, `status` từ `isActive`, bỏ "Pending" cho PT. Test 3 ca
mới, gateway 41/41; `REAL HTTP/API` sau `docker compose restart api-gateway`. Chi tiết:
`MOBILE_PLATFORM_ADAPTERS.md` §35.1. Trạng thái: **ĐÃ SỬA**.

## GAP-22 — Giao dịch cổng đã huỷ vẫn nằm PENDING (Phase 14.1) — ĐÃ SỬA ý 1 (1/10), ý 2 còn mở

**Thấy 28/9 khi kiểm thanh toán trên mobile** (không phải lỗi app — app hiện đúng lời server):

1. Bấm **Huỷ thanh toán** trên VNPay sandbox → cổng trả về app với mã huỷ, nhưng `/payments/vnpay/return`
   chỉ xử lý nhánh PAID; `POST /me/payments/:id/sync` hỏi VNPay thì cổng vẫn trả `PENDING`. Người dùng thấy
   "Đang chờ xác nhận" thay vì "chưa thành công". Ví dụ: `53f0cf45…`, `30f52af2…`.
2. **Huỷ gói hội viên đang chờ** (`/me/gym-memberships/:id/cancel`) → gói CANCELLED nhưng giao dịch cổng đi
   kèm vẫn PENDING.

**Mobile đang làm gì:** màn kết quả nói "Đang chờ xác nhận … nếu bạn đã trả tiền, kiểm tra lại sau" và có
nút "Kiểm tra lại" — đúng như web. Không tự suy ra "thất bại" từ `status` trên deep link.

**Cần Ngài quyết (backend, không gấp):** có cho `vnpay/return` ghi FAILED khi chữ ký hợp lệ và mã là huỷ
(như nó đã ghi PAID), và cho việc huỷ gói/hợp đồng huỷ luôn giao dịch PENDING đi kèm không. Nếu không, các
giao dịch này chỉ đóng khi quét đối soát làm hết hạn.

**1/10 — Ngài cho sửa (E5), đã sửa ý 1:** `/payments/vnpay/return` có chữ ký hợp lệ và `vnp_ResponseCode` là thất bại
dứt khoát (24 huỷ, 11 hết hạn, 09/10/12/13/79 thẻ/OTP/mật khẩu, 51 không đủ tiền, 65 vượt hạn mức, 75 ngân hàng bảo
trì) → `failFromSignedGatewayResult` đưa giao dịch PENDING/PROCESSING sang FAILED (cùng luật tra theo cổng + khớp cổng
như `handleEvent`). Không đụng mã 07 (đã trừ tiền nhưng bị nghi ngờ) và 99. PAID không bao giờ bị hạ; một PAID đến
muộn vẫn lật FAILED → PAID. Test `gateway-failure-closes-checkout.integration.test.ts` 6/6 (gymcoach_payment_test, gồm
route với chữ ký thật + chữ ký bị sửa). **Ý 2 (huỷ gói hội viên thì huỷ luôn giao dịch PENDING) chưa làm:** nếu khách
vừa trả tiền ở cổng đúng lúc bấm huỷ gói, đánh CANCELLED giao dịch sẽ khiến PAID đến sau bị bỏ qua — cần thiết kế
riêng (hỏi cổng trước khi huỷ), để lại.

## GAP-23 — Tin nhắn "cuộc gọi đã kết thúc" luôn ghi thời lượng 0:00 (Phase 14.4) — ĐÃ SỬA 30/9

**Thấy 30/9 khi kiểm gọi video máy ảo ↔ web** (web bị y hệt — không phải lỗi app): cuộc gọi dài ~2 phút vẫn sinh
tin hệ thống "Video call ended (0:00)". `call.handler.ts` tính thời lượng bằng `endedAt − startedAt`, nhưng
`startedAt` chỉ được ghi trong `callService.setActive()` — hàm này không có chỗ nào gọi, nên `call_sessions.status`
cũng không bao giờ lên `ACTIVE` (đi thẳng CONNECTING → ENDED). Ví dụ: `8c82c3e0…`.

**Mobile đang làm gì:** hiển thị nguyên văn tin hệ thống như web; đồng hồ trong màn gọi là đồng hồ tại máy.

**Cần Ngài quyết (backend, không gấp):** thêm một sự kiện kiểu `call:connected` (client gửi khi ICE "connected")
để server gọi `setActive`, hoặc cho server ghi `startedAt` ngay lúc chấp nhận — cả web lẫn mobile phải cùng đổi.
Tin hệ thống còn là tiếng Anh ("Video call ended", "Missed video call").

**Đã sửa 30/9 (Ngài chọn cách 2):** client gửi `call:connected` khi RTCPeerConnection lên "connected" (web
`CallContext.tsx` + mobile `CallProvider.tsx`); chat-service `call:connected` → `callService.markConnected`: chỉ
caller/callee được gửi; lần đầu ghi `startedAt` + `ACTIVE` bằng câu UPDATE có điều kiện `startedAt IS NULL` (hai bên
báo cùng lúc thì chỉ một bên thắng), các lần sau (bên kia, vào lại phòng buổi học) chỉ đưa lại `ACTIVE`, không đổi
`startedAt`; cuộc gọi đã kết thúc/còn đổ chuông không bị "hồi sinh". Cuộc gọi không bao giờ thông vẫn ghi 0:00 — đúng.
Bản Capacitor cũ không gửi sự kiện này: nếu một bên còn bản cũ thì bên kia vẫn gửi; cả hai bản cũ thì như trước.
Kiểm: `src/__tests__/call-connected.test.ts` 6/6 + `call-membership.test.ts` 4/4 trên `gymcoach_chat_test` (DB test
mới tạo 30/9); gọi thật máy ảo ↔ Chrome → DB `started_at` 08:55:09, `ended_at` 08:55:26, tin "Video call ended (0:17)".
Tin hệ thống vẫn là tiếng Anh (chưa đổi).

## GAP-24 — Lý do bỏ buổi tập không bao giờ lưu được (14B.1, PG-A2) — CHỜ NGÀI QUYẾT

**Thấy 4/10 khi kiểm trên máy ảo** (web bị y hệt — cùng endpoint, không phải lỗi app): bỏ một buổi rồi chọn lý do →
`POST /workouts/schedules/:id/feedback` luôn trả 400 "skipReason is required for a skipped/cancelled session", dù body
có `skipReason`. Nguyên nhân (fitness-service `models/session-feedback.models.ts`): `sessionFeedbackInputSchema =
z.union([completionFeedbackSchema, skipCancelFeedbackSchema])`. Zod thử schema "hoàn thành" trước; schema đó toàn trường
tuỳ chọn và không `.strict()`, nên body bỏ buổi **khớp luôn** và bị lột mất `skipReason`, `shouldAdjustPlan`,
`userAvailableMakeupDay` (parse ra `{}`). Service thấy buổi SKIPPED mà không có lý do → 400. Test hiện có không bắt được vì
chỉ kiểm từng schema riêng và gọi service trực tiếp, bỏ qua `z.union` của controller.

**Hệ quả:** lý do bỏ buổi, "muốn điều chỉnh kế hoạch", ngày tập bù chưa từng được lưu ở cả web lẫn mobile; các cờ dựa trên
chúng trong tóm tắt phản hồi chu kỳ (bỏ buổi do bận / thiếu động lực / quá khó…) không bao giờ bật.

**Bằng chứng:** REAL HTTP/API — body `{"skipReason":"schedule_conflict","shouldAdjustPlan":true,"userAvailableMakeupDay":"2026-10-06"}`
lên buổi `5995d96e…` (SKIPPED) → 400 như trên, DB không có dòng; parse cục bộ `sessionFeedbackInputSchema` cùng body → `{}`.

**Mobile đang làm gì:** hộp "Vì sao bạn bỏ buổi tập này?" giống web; bấm Lưu hiện lỗi "Không thể ghi nhận. Vui lòng chọn
lý do." (đúng thông báo của web). Không lách ở phía app.

**Đề xuất sửa (backend, 1 dòng, miền Tập luyện — cần Ngài cho phép theo quyết định Phase 0.3):** đảo thứ tự
`z.union([skipCancelFeedbackSchema, completionFeedbackSchema])` — schema bỏ buổi bắt buộc có `skipReason` nên body hoàn
thành vẫn rơi về schema hoàn thành — kèm một test gọi đúng `sessionFeedbackInputSchema`/controller với body bỏ buổi.

