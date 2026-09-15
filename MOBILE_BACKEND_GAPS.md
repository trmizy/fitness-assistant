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
- Trạng thái: ĐÃ BÁO CÁO — chờ quyết định. **Hiện trạng bản mobile**: màn `app/(auth)/forgot-password.tsx`
  nói thẳng là chưa có chức năng tự đặt lại và mở email tới bộ phận hỗ trợ, KHÔNG dựng form giả thu
  thập email rồi chẳng gọi được đâu. Bản web cũng đang để link "Quên mật khẩu?" trỏ ngược về
  `/login` vì đúng lý do này.

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
- Trạng thái: ĐÃ BÁO CÁO — chờ quyết định. **Hiện trạng bản mobile**: nút "Gửi lại" nói rõ chưa có
  chức năng và hướng dẫn quay lại đăng ký lại, thay vì im lặng không làm gì.

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
