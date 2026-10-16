# Mobile Migration Manifest — 67 màn thiết kế + 14 màn chỉ có ở web (4 chốt phase, 6 chờ quyết
định phạm vi, 4 chờ quyết định phase/xung đột)

> **Cập nhật 2026-09-21:** web đổi hẳn đường vào của chủ phòng gym — **chủ gym TỰ ĐĂNG KÝ, admin
> duyệt hồ sơ**; luồng admin cấp tài khoản (WB-03) đã bị gỡ (`POST /admin/partners` và
> `/admin/partners/:id/provision` trả **410 `ENDPOINT_RETIRED`**). Thêm WB-15..WB-18, đánh dấu WB-03 **đã
> bị thay thế**, thu hẹp WB-02 còn lời mời QUẢN LÝ, và ghi **hồi quy trên CL-09 (Phase 7 đã đóng)** vì
> trang chi tiết phòng gym của web vừa được làm lại. Chỉ cập nhật tài liệu — `frontend/mobile` không
> đổi, mobile vẫn dừng ở Phase 7/15. Chi tiết: mục "Bổ sung 2026-09-21" ở cuối bảng WEB-ONLY.
>
> **Cập nhật 2026-09-18:** thêm WB-11..WB-14 (FitnessRoadmap, AI Coach nút nổi + khối hành động, PT
> xem roadmap học viên, "Smart Substitute" dinh dưỡng) sau khi merge `origin/aws-deploy`. WB-12 đang
> **xung đột trực tiếp** với quyết định điều hướng Phase 4/9 đã chốt — chưa tự chọn bên nào, xem ghi
> chú trong bảng WEB-ONLY. WB-14 là hồi quy trên Phase 6 đã đóng — **đã vá 18/9** theo lệnh Ngài.
>
> **Cập nhật 2026-09-16:** thêm mục "WEB-ONLY" ở cuối. Ba màn đó **không** nằm trong 67 màn của bản
> thiết kế (Figma không vẽ chúng) nhưng **có thật trên web** và chặn đường vào của chủ phòng gym —
> theo đúng luật "web là sàn tối thiểu", thiếu chúng là thiếu thật, không phải quyết định. Phát hiện
> khi Ngài hỏi lại các thay đổi web cho gym-owner/admin đã vào plan chưa.
>
> Kiểm kê đầy đủ 67 màn hình `D:\New Frontend\src\screens\` đối chiếu với backend/API thật và
> `frontend/web` hiện hành, theo Phase 0.1 của kế hoạch di trú React Native. Dữ liệu lấy trực tiếp
> từ code thật (`routes.tsx`, `services/api.ts`, `backend/gateway/src/routes/proxy.routes.ts`,
> Prisma schema/middleware) — không suy đoán từ tên file. Trạng thái triển khai/kiểm chứng đều là
> "chưa làm/chưa kiểm" ở thời điểm viết (chưa có dòng code `frontend/mobile/` nào).

## Sự kiện nền tảng áp dụng cho toàn bộ bảng dưới

- **Map gateway → service** (đọc trực tiếp từ `proxy.routes.ts`): `/auth*`→**auth**;
  `/profile*,/contracts*,/sessions*,/availability*,/notifications*,/inbody*,/pt-applications*,
  /locations*,/pt/training-locations*`→**user**; `/workouts*,/training-cycles*,/coach*,
  /nutrition*,/imports*,/exports*,/templates*,/stats*,/exercises*,/equipment*,/food*`→**fitness**;
  `/plans*,/marketplace*,/ai*`→**ai**; `/chat*` (+ socket `call:*`)→**chat**;
  `/me/payments*,/me/wallet*,/me/pt-wallet*,/me/withdrawals*,/admin/payments*`→**payment**;
  `/gyms*,/owner/*,/admin/gyms*,/admin/brands*,/admin/partners*,/admin/complaints*,
  /me/gym-*,/me/complaints*,/complaint-photos*,/collaborations*,/partner-invitations*`→**gym**.
  `/admin/dashboard`, `/admin/users` là **tổng hợp ở tầng gateway** (gateway tự gọi nhiều service
  rồi gộp), không thuộc riêng 1 service. `/api/translate` xử lý hoàn toàn trong gateway.
- **Vai trò xác nhận từ `RequireRole`**: `/client/*`→`["client","pt"]` + `RequireOnboarding`;
  `/pt/*`→`["pt"]`; `/gym-owner/*`→`["gym_owner"]`; `/admin/*`→`["admin"]`. `UserRole` chỉ có
  `client|pt|gym_owner|admin` — **không có `gym_manager`**. MANAGER là `GymPartnerAccount` với
  `PartnerAccountRole=MANAGER`, được `auth.service.ts` cấp cứng `role: GYM_OWNER` ở tầng auth —
  ranh giới OWNER/MANAGER thật sự chỉ được gym-service's `partner-context.middleware.ts` áp: 
  `requirePartnerOwner` (403 với MANAGER) chặn ví/rút tiền/mời-thu hồi quản lý/đàm phán cộng tác
  PT/sửa thương hiệu/tạo-sửa chi nhánh; `requireGymScope` giới hạn MANAGER theo `scopedGymIds`.
  → RN phải tự kiểm tra tier OWNER/MANAGER qua dữ liệu partner-account trả về, không thể dựa vào
  route guard vai trò như web đang làm (guard vai trò không phân biệt được 2 tier này).

---

## SHARED (16)

| ID | Nguồn thị giác (New Frontend) | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec liên quan | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SH-01 | `Auth.tsx` | `pages/auth/LoginPage.tsx`+`RegisterPage.tsx` | `(auth)/login.tsx`,`register.tsx`,`otp-verify.tsx` | auth: `/auth/login`,`/auth/register`,`/auth/register/verify` | Public | — | login/register/otp | OTP grid | không | secure-store | 4 | **xong/đã kiểm trên emulator (13/9)** — OTP nằm trong `register.tsx` (không có file `otp-verify.tsx` riêng). CHƯA kiểm đầu-cuối `đăng ký → OTP → dashboard` (cần hộp thư thật, xem ADAPTERS §19.8). 15/9: "Gửi lại" OTP hoạt động thật (GAP-5), "Quên mật khẩu?" thành luồng tự phục vụ thật (GAP-4) — backend auth-service được sửa theo cho phép riêng của Ngài |
| SH-02 | `Onboarding.tsx` | **Không có 1:1** — web không có màn intro marketing riêng | `(auth)/welcome.tsx` (mới, không map web) | không gọi API | Public | — | 3 slide tĩnh | không | không | không | 4 | **xong/đã kiểm trên emulator (16/9)** — `app/welcome.tsx` (đặt ở gốc, KHÔNG trong `(auth)`: group đó đệm safe-area nên ảnh không tràn được lên status bar). Hiện 1 lần mỗi lần cài, cờ `intro.seen` trong AsyncStorage; xong thì quay về route gốc để nó tự chọn đích (ADAPTERS §20.12) |
| SH-03 | `SetupWizard.tsx` | `pages/client/OnboardingWizardPage.tsx` (`/client/onboarding`) | `(client)/onboarding.tsx` (chặn shell, không phải tab thường) | user (`profileService`) + fitness (`equipmentService`) | client, chặn tới khi `hasCompletedOnboarding` | — | goal/level/days/equipment | không | không | không | 5 (chuyển từ 4 — quyết định của Ngài 15/9) | **xong/đã kiểm trên emulator + backend thật (15/9)** — 6 bước theo dữ liệu web, giao diện theo `SetupWizard.tsx`; lưu đúng mọi trường vào `user_profiles` + 8 dòng `user_equipment` (đối chiếu DB), nháp khôi phục được sau khi tắt app. Xem ADAPTERS §20.8 |
| SH-04 | `Chat.tsx` | `pages/client/ChatCoachPage.tsx` (host `ChatPage.tsx`+`AICoachPage.tsx`), tái dùng ở `/pt/chat` | `(client)/chat/index.tsx`,`ai-coach.tsx`,`[conversationId].tsx`; `(pt)/chat.tsx` | chat: `/chat/conversations*`; ai: `/ai/sessions*`,`/ai/ask/stream` | client, pt | — | thread list/mở/gõ/AI stream | không | không | socket | 9 | xong 22/9 — `app/client/messages/[conversationId].tsx`; socket 2 chiều + typing + resume đã kiểm trên máy ảo (§25.1) |
| SH-05 | `MeetingRoom.tsx` | Không phải route — `components/call/CallOverlay.tsx`, mount toàn cục qua `CallProvider` | overlay toàn cục, không phải 1 route Expo Router | chat: WebSocket `call:initiate/offer/answer/ice_candidate/accept/reject/end` | mọi vai trò đã đăng nhập | — | connecting/live/ended | không | không | webrtc, mic/camera | 14 | **đã làm 30/9 (14.4), kiểm một phần** — `src/features/call/*` (CallProvider + CallOverlay dạng Modal toàn cục), nút gọi thoại/video ở đầu khung chat, nút "Tham gia buổi học" ở Buổi tập (khách) + Lịch dạy (PT). Kiểm thật máy ảo ↔ Chrome (web): video 2 chiều, gọi thoại 2 chiều, tắt micro/camera, cúp từ mỗi phía, nhỡ cuộc gọi. CHƯA kiểm: vào phòng buổi học (không có buổi ONLINE nào trong khung giờ), 2 máy thật khác mạng/TURN (ADAPTERS §40) |
| SH-06 | `PaymentResult.tsx` | `pages/client/PaymentResultPage.tsx` | `payments/result.tsx` | payment: `POST /me/payments/:id/sync` | client, pt | — | verifying/success/failed | không | có (return từ cổng, xem 14.1) | expo-web-browser | 14 (21/9: bỏ bản stub ở Phase 7 — Phase 7 dừng ở "chờ thanh toán", không mở cổng nào nên không có đường vào màn này; làm trọn cùng lúc mở cổng thật) | **xong 28/9 (14.1)** — `app/client/payments/result.tsx`; 4 lối vào (Hội viên, Hợp đồng, mua gói ở chi tiết gym, dịch vụ 1-1). Kiểm thật trên máy ảo + VNPay sandbox: mua gói → PAID → gói ACTIVE; app bị tắt giữa chừng → mở lại vào đúng màn kết quả. Chưa kiểm: nhánh app còn sống khi cổng trả về (máy ảo luôn tắt app), hợp đồng/đơn 1-1 bấm thật, MoMo (ADAPTERS §37) |
| SH-07 | `ReportIssue.tsx` | `components/gym/ReportIssueDialog.tsx` — chỉ thấy nhúng trong `GymMembershipsPage.tsx` | `(client)/report-issue.tsx` (mở từ nhiều nơi) | gym: `/gyms/:id/complaints`,`/me/complaints`,`/complaint-photos` | client, pt | — | Mới/Đang xử lý/Đã xử lý | ảnh minh chứng ×5 | không | camera/picker | 9 | xong 22/9 — `app/client/services/report-issue.tsx`, mở từ thẻ gói hội viên (ACTIVE / hết hạn ≤30 ngày); chưa gửi báo cáo thật |
| SH-08 | `Settings.tsx` (+`EquipmentSettings`,`NotificationPrefs`) | 3 route riêng: `SettingsPage.tsx`,`TrainingEquipmentSettingsPage.tsx`,`NotificationPreferencesPage.tsx` | `(client)/settings/index.tsx`,`training-equipment.tsx`,`notification-preferences.tsx` | fitness (`equipmentService`) + user (`notificationService`) | client, pt | — | toggle list | không | không | không | 9 | xong 22/9 — `profile/settings.tsx` + `equipment.tsx` + `notification-prefs.tsx`; WB-14 dinh dưỡng chuyển về Cài đặt (NutritionPrefsForm dùng chung); KHÔNG làm: giao diện/ngôn ngữ, đơn vị, công tắc buổi tập (mobile chưa có hành vi tương ứng) |
| SH-09 | `ExportData.tsx` | `pages/client/ExportDataPage.tsx` | `(client)/export-data.tsx` | fitness: `/exports/json`,`/exports/csv` | client, pt | — | preview→export | không | không | file-system, sharing | 9 | xong 22/9 — `profile/export.tsx` (tải → share sheet); màn đã kiểm, chưa bấm tải |
| SH-10 | `ImportWorkouts.tsx` | `pages/client/ImportWorkoutsPage.tsx` | `(client)/workout/import.tsx` | fitness: `/imports/*` | client, pt | — | preview rows | không | không | document-picker | 5 | **xong/đã kiểm trên emulator (15/9)** (PARTIAL: CREATE_CUSTOM khi ghép bài → phase sau) |
| SH-11 | `discover/Discover.tsx` | `pages/client/library/LibraryPage.tsx` | `(client)/library/index.tsx` | fitness: `getExercises`,`foodService.list`,`getMuscleTaxonomy` | client, pt | — | hub 4 mục | không | không | không | 5 | **xong/đã kiểm trên emulator (15/9)** — 16/9: dải "Bài tập có media" hiện ảnh minh hoạ 80px kèm tên (ADAPTERS §20.11) — 17/9: đủ 4 dải xem trước (bài tập, thực phẩm, kiến thức, nhóm cơ), hết PARTIAL |
| SH-12 | `discover/ExerciseLibrary.tsx` | `ExerciseLibraryPage.tsx`+`ExerciseDetailPage.tsx` | `library/exercises/index.tsx`,`[id].tsx` | fitness: `/exercises*` | client, pt | — | filter/ảnh minh hoạ động tác | không | không | không | 5 | **xong/đã kiểm trên emulator (15/9; ảnh 16/9)** — catalog KHÔNG có video/GIF: `video_url` là 2 khung JPG (free-exercise-db), danh sách hiện khung đầu 64px, chi tiết hiện khung 16:9 đổi qua lại như web (ADAPTERS §20.11). Không cần video player → bỏ ghi chú "video preview → Phase 14" |
| SH-13 | `discover/FoodLibrary.tsx` | `FoodLibraryPage.tsx`+`FoodDetailPage.tsx` | `library/foods/index.tsx`,`[id].tsx` | fitness: `/food*` | client, pt | — | sắp xếp theo macro + lọc | không | không | không | 6 | **xong/đã kiểm trên emulator + backend thật (17/9)** — `library/foods/index.tsx` + `[id].tsx`. Chip "nhóm thực phẩm" của bản thiết kế KHÔNG dựng: bảng `Food` không có cột nhóm; thay bằng sắp xếp theo macro và lọc bổ sung/có ảnh đúng như web (ADAPTERS §22.4). 13.159 món, 658 trang |
| SH-14 | `discover/GlobalSearch.tsx` | `GlobalSearchPage.tsx` | `library/search.tsx` hoặc `search.tsx` cấp client | fitness: `getExercises`,`foodService.search`,`getMuscleTaxonomy` | client, pt | — | kết quả gộp 4 nguồn | không | không | không | 5 | **xong/đã kiểm trên emulator (15/9)** — 16/9: kết quả bài tập có ảnh minh hoạ 48px (ADAPTERS §20.11) — 17/9: đủ 4 nhóm kết quả; nhóm kiến thức khớp ngay trong máy nên vẫn chỉ 2 request, hết PARTIAL |
| SH-15 | `discover/MuscleLibrary.tsx` | `MuscleLibraryPage.tsx`+`MuscleDetailPage.tsx` | `library/muscles/index.tsx`,`[id].tsx` | fitness: `/exercises/muscles` | client, pt | — | anatomy browse | không | không | không | 5 | **xong/đã kiểm trên emulator (15/9)** |
| SH-16 | `discover/NutritionKnowledge.tsx` | `NutritionKnowledgePage.tsx`+`NutritionArticlePage.tsx` | `library/learn/nutrition/index.tsx`,`[slug].tsx` | **KHÔNG GỌI BACKEND** — nội dung tĩnh `nutritionKnowledge.ts` | client, pt | — | list/article | không | không | không | 6 | **xong/đã kiểm trên emulator (17/9)** — `library/learn/index.tsx` + `[slug].tsx`; 12 bài tĩnh chép nguyên văn từ web, gọi 0 endpoint. Ảnh trong bản thiết kế KHÔNG dựng vì nội dung thật không có ảnh (ADAPTERS §22.4) |

---

## CLIENT (23)

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CL-01 | `Home.tsx` | `pages/client/ClientDashboard.tsx` | `(client)/dashboard.tsx` | user (`profileService`,`inbodyService`) + fitness (`workoutService`) | client, pt | — | KPI cards | không | không | không | 5 | **xong/đã kiểm trên emulator + backend thật (15/9)** — kéo-làm-mới xác nhận ở server (user-service nhận thêm đúng 1 `GET /profile/me` + 1 `GET /inbody` mỗi lần kéo); buổi đang tập dở hiện "Tiếp tục buổi tập" thay vì bị ẩn; "Sắp tới" bắt đầu SAU buổi ở thẻ lớn, không còn lặp lại (sửa 15/9, Ngài cho phép) (PARTIAL: 2 thẻ nudge → Phase 7/9). **17/9 — cặp ô dinh dưỡng đã dựng ở Phase 6**: Calo hôm nay + Đạm hôm nay, cùng nguồn số với màn Dinh dưỡng (`actualProgress` của `daily-task`, nếu không có thì tổng nhật ký ngày), bấm vào mở `/client/workout/nutrition`; refetch khi màn được focus (kiểm trên máy: ghi 1 bữa thật → quay lại Trang chủ, ô đổi 0 → 330 kcal / 62 g). Ô "Nước" của thiết kế **không dựng được** — không có nguồn dữ liệu nào trong backend (GAP-10), nên chỗ đó là Đạm. |
| CL-02 | `Workout.tsx` | `pages/client/TrainingPage.tsx` (tab host) | `(client)/workout/index.tsx`,`training-cycle.tsx` | fitness: `/workouts*`,`/training-cycles*` | client, pt | — | week schedule/log | không | không | không | 5 | **xong/đã kiểm trên emulator (15/9)** (3 tab: Lịch tuần/Nhật ký/Chu kỳ) |
| CL-03 | `Nutrition.tsx` | `pages/client/NutritionPage.tsx` | `(client)/nutrition/index.tsx` | fitness: `/nutrition*`,`/food*` | client, pt | — | macro rings/meals | không | không | không | 6 | **xong/đã kiểm trên emulator + backend thật (16/9)** — route `workout/nutrition` (dưới tab Tập luyện, theo doc 08 §4.2); vòng calo + 3 thanh macro, 4 nhóm bữa, vuốt-để-xoá, màn thêm món tìm trong 13k catalog. Đối chiếu macro: app 293 kcal/23.5P/6.8C/19.8F = đúng bản ghi backend; tổng ngày khớp 643 kcal (ADAPTERS §22.1) |
| CL-04 | `Services.tsx` | `pages/client/ServicesPage.tsx` (host 5 trang con) | `(client)/services/index.tsx` (tab host) | user + gym (xem CL-06..11) | client, pt | 01,02 | tab Tìm PT/Đặt lịch/Hợp đồng/Phòng gym/Hội viên | nhiều | không | không | 7 | **xong/đã kiểm end-to-end (17/9)** — `services/index.tsx` với đủ **4 tab** của thiết kế: Tìm PT, Phòng gym, Hội viên, Hợp đồng. Tab Hợp đồng phân biệt đúng **hai đường kết thúc khác nhau**: chưa phát sinh tiền thì `PATCH /contracts/:id/cancel` (rút yêu cầu), đã ACTIVE thì `POST /:id/terminate` kèm lý do — và chỉ chào 2 trong 7 lý do mà máy chủ cho phép phía khách. Hợp đồng ACTIVE hiện luôn số tiền hoàn nếu dừng ngay, lấy từ `/money-breakdown` chứ không tự tính. Kiểm thật: rút hợp đồng `021e8614…` PENDING_REVIEW → CANCELLED, `cancelledBy` đúng user. |
| CL-05 | `Profile.tsx` | `pages/client/ProfilePage.tsx` | `(client)/profile.tsx` | user: `profileService.*` | client, pt | — | edit info | ảnh đại diện picker | không | image-picker | 9 | xong 22/9 — `app/client/profile/index.tsx` (hub) + `profile/edit.tsx` (form web ProfilePage); số liệu thật; ảnh đại diện presign→multipart fallback; kiểm máy ảo (§25.5) |
| CL-06 | `Sessions.tsx` | Không có route riêng — nằm trong `BookingPage.tsx` | `(client)/services/booking.tsx` (tab con) | user: `/sessions*` | client, pt | 01 | upcoming/pending/past | không | không | không | 7 | **xong/đã kiểm end-to-end (17/9)** — `services/booking.tsx`, 3 phân đoạn **Cần xử lý / Sắp tới / Đã qua**. "Cần xử lý" đứng đầu vì chỉ nhóm đó có hạn chót chạy ngược (buổi PT đã báo dạy sẽ **tự xác nhận** nếu khách im lặng). |
| CL-07 | `SessionDetail.tsx` | Không có route riêng — hàng mở rộng trong `BookingPage.tsx` | modal/sheet trong `services/booking.tsx` | user: `cancelSession/clientConfirmSession/disputeSession/reportPtNoShow/reviewSession/...` | client, pt | 01 | theo máy trạng thái buổi tập | reschedule/no-show/dispute sheet | không | không | 7 | **xong/đã kiểm trên máy (17/9)** — sheet chi tiết chỉ chào đúng thao tác mà trạng thái cho phép: huỷ (kèm cảnh báo luật 24 giờ TRƯỚC khi bấm), đổi lịch (ẩn khi trong vòng 12 giờ — luật thật của máy chủ), xác nhận/khiếu nại, báo PT vắng (chỉ sau giờ bắt đầu + 15 phút), đánh giá sao. |
| CL-08 | `Booking.tsx` | `pages/client/BookingPage.tsx` (1494 dòng, gộp CL-06/07/08) | `(client)/services/booking.tsx` | user: `bookSession`, `availabilityService.getAvailableSlots` | client, pt | 01 | calendar/slot picker | không | không | không | 7 | **xong/đã kiểm end-to-end (17/9)** — chọn hợp đồng → 14 ngày → khung giờ rảnh thật của PT (`/availability/:id/slots`). Kiểm thật: đặt buổi 19/09 17:00 → backend tạo `7e7fe75a…` trạng thái **REQUESTED**; huỷ từ trên máy (còn >24 giờ) → CANCELLED, `sessionDeducted: false` đúng luật. |
| CL-09 | `GymDetail.tsx` (client-facing) | `components/gym/GymDetailModal.tsx` — modal, không phải route riêng (`/client/gyms/:id` redirect về list) | modal/sheet trong `services/gyms/index.tsx` | gym: `/gyms/:id*` | client, pt | 02,05 | hours/amenities/gallery/plans/reviews | GymDetailModal | không | không | 7 | **xong/đã kiểm end-to-end (17/9)** — `services/gyms/[id].tsx`. Tôn trọng **cả hai trục trạng thái** (`status` + `operationalStatus`), gói phải ACTIVE **và** trong cửa sổ mở bán, một khách chỉ có 1 gói mở tại mỗi gym (unique index của DB). Cảnh báo "đang có gói ở gym khác" **cảnh báo chứ không chặn**, xác nhận đi kèm thành `multiGymWarned`. Kiểm thật: gói `3df3f15e…` PENDING_PAYMENT đúng 300.000 đ / 30 ngày, rồi huỷ qua giao diện → CANCELLED. Dừng đúng ở "chờ thanh toán" (cổng thật là Phase 14). |
| CL-10 | `TrainerDetail.tsx` | Không có route riêng — panel/modal "Request Coaching" trong `PTDiscoveryPage.tsx` | modal trong `services/index.tsx` (tab Tìm PT) | user (`profileService.getPTDetail`) + gym (`collaborationService.listGymsForPt`) | client, pt | 06,07 | profile/reviews/hire CTA | Request Coaching Modal | không | không | 7 | **xong/đã kiểm trên máy ảo + backend thật (17/9)** — `services/pt/[id].tsx`: 3 phân đoạn (Giới thiệu / Gói dịch vụ / Đánh giá). **Phải ghép 2 nguồn**: `GET /profile/pts/:id` KHÔNG trả `ptApplication` lẫn số khung giờ trống (chỉ danh sách mới có), đổi lại có `recentReviews` — xem `mergePtSources`. |
| CL-11 | `ContractRequest.tsx` | Cùng "Request Coaching Modal" ở trên (KHÔNG phải `ContractPage.tsx` — đó là quản lý hợp đồng đã có) | modal trong `services/index.tsx` | user: `POST /contracts/request` | client, pt | 01 | package→payment→pending | Request Coaching Modal | có (payment return, xem SH-06) | không | 7 | **xong/đã kiểm end-to-end (17/9)** — gửi `POST /contracts/request` bằng `packageId` (không gửi giá), gym chỉ gắn với gói OFFLINE; 409 `LOW_AVAILABILITY` xử lý như CẢNH BÁO (sheet xác nhận → gửi lại với `acknowledgedLowAvailability`). Kiểm thật: hợp đồng `021e8614…` PENDING_REVIEW, 3.000.000 đ, source GYM, ptRate 0.5/gymRate 0.4 lấy từ thoả thuận thật; phía PT gọi `/contracts/pt` thấy đúng. Nhánh lỗi hiện nguyên văn thông điệp máy chủ (xem GAP-11). |
| CL-12 | `PersonalizedService.tsx` | `pages/client/PersonalizedServiceOrderPage.tsx` | `services/marketplace-orders/[id].tsx` | ai (`personalizedServiceApi.*`, 18 trạng thái) | client, pt | 03 | 18-state machine | intake/revision/check-in sheet | không | không | 8 | **xong/đã kiểm trên máy ảo + backend thật (22/9)** — route `plans/orders/[id]` (+ `plans/service/[id]` trước khi mua). Máy trạng thái thật có 16 trạng thái (doc 03 ghi 18). Một đơn thật đi 9 bước, 5 bước do khách bấm trên máy (Intake → yêu cầu sửa → chấp nhận v2 → check-in → hoàn thành → đánh giá), DB đối chiếu từng bước (ADAPTERS §24.3). Hoàn tiền + Khiếu nại: **⏸ tạm tắt 22/9 theo lệnh Ngài** (code comment lại, chờ bàn với partner — GAP-13). Mua: tạo đơn PENDING_PAYMENT, mở cổng để Phase 14. (PARTIAL: "Nhắn PT" mở tab Trò chuyện — Phase 9; GAP-13) |
| CL-13 | `Wallet.tsx` | `pages/client/WalletPage.tsx` | `(client)/wallet.tsx` | payment: `/me/wallet*`,`/me/withdrawals` | client, pt | 04 | balance/history/withdraw | withdraw request sheet | không | không | 9 | xong 22/9 — `app/client/profile/wallet.tsx`; số dư 26.353.275 ₫ khớp API (26353274.61); rút tiền: chưa gửi yêu cầu thật (§25.5) |
| CL-14 | `InBody.tsx` | `pages/client/InBodyModule.tsx` | `(client)/inbody/index.tsx`,`history.tsx` | user (`inbodyService`) + fitness (`trainingCycleService`) | client, pt | — | capture/history/compare | không | không | camera + thư viện ảnh | 6 | **xong/đã kiểm trên emulator + backend thật (16/9)** — `inbody/index` (Tổng quan + So sánh) và `inbody/entry` (nhập tay + kiểm tra kết quả OCR). Ảnh vào bằng **cả camera lẫn thư viện** (upload nhận jpeg/png/pdf ≤5MB, không quan tâm nguồn); OCR chỉ trích xuất, chỉ lưu sau khi người dùng xác nhận. "Điểm cơ thể" + "Phân tích AI" của bản thiết kế KHÔNG dựng (không có cột/endpoint). Có **phân tích theo vùng** (cơ/mỡ 5 vùng, cùng mức tham chiếu và ngưỡng của web) — ADAPTERS §22.2, GAP-9 |
| CL-15 | `Stats.tsx` | 3 route riêng: `ActivityHeatmapPage.tsx`,`MuscleHeatmapPage.tsx`,`ExerciseProgressChartPage.tsx` | `(client)/stats/activity.tsx`,`muscle.tsx`,`exercise-progress/[id].tsx` | fitness: `/stats/*` | client, pt | — | heatmap/PR chart | không | không | không | 6 (chuyển từ 5 — theo kế hoạch, Ngài xác nhận 15/9) | **xong/đã kiểm trên emulator + backend thật (17/9)** — `stats/activity.tsx` gộp 3 phân đoạn (Hoạt động / Nhóm cơ / Tiến bộ) đúng bản thiết kế, `stats/exercise-progress/[id].tsx` cho biểu đồ từng bài. Chỉ số vẽ được phụ thuộc `loggingMode`; buổi không ghi chỉ số bị LOẠI khỏi biểu đồ chứ không vẽ thành 0 (ADAPTERS §22.5) |
| CL-16 | `Templates.tsx` | `pages/client/TemplatesPage.tsx` | `(client)/workout/templates.tsx` | fitness (`templateService`) + user (`contractService`, để share) | client, pt | — | list/import/share | không | không | không | 5 | **xong/đã kiểm trên emulator (15/9)** (PARTIAL: chia sẻ cho người nhận → Phase 7/11, GAP-8) |
| CL-17 | `WorkoutLog.tsx` | Tab "Nhật ký tập" trong `TrainingPage.tsx` | `(client)/workout/index.tsx` (tab con) | fitness: `/workouts*` | client, pt | — | live set/rep/rest timer | không | không | không | 5 | **xong/đã kiểm E2E trên emulator + backend thật (15/9)** — 1 buổi thật: bắt đầu → tick 3 set → Thêm set → tick nốt → schedule `COMPLETED` 100% (đối chiếu DB). Sửa kèm: đọc `workoutSets` (không phải `sets` = số set dự kiến), đồng hồ tính từ `schedule.startedAt`, tab tuần/trang chủ dùng `status` thay vì "có workoutId". 16/9: buổi đã `COMPLETED` mở lại từ "+" hiện dạng tổng kết (đồng hồ đứng ở thời lượng thật, "Đã hoàn thành", "Về Tập luyện"), màn refetch mỗi lần focus — xem ADAPTERS §20.10 (PARTIAL: hàng đợi offline bền → xem GAP trong doc) |
| CL-18 | `Plans.tsx` | `pages/client/PlansPage.tsx` (host `AIPlansPage`+`PlanMarketplacePage`) | `(client)/plans/index.tsx`,`marketplace.tsx` | ai: `/plans*`,`/marketplace/*` | client, pt (+PT tab ẩn, xem PT-08/11) | 03 | AI plan/chợ kế hoạch | tạo dịch vụ/publish plan sheet | không | không | 8 | **xong/đã kiểm trên máy ảo + backend thật (22/9)** — `plans/index` (Kế hoạch AI: Tập luyện + Dinh dưỡng; Chợ: Miễn phí / Dịch vụ PT / Gói tập PT / Kế hoạch của tôi / Đơn dịch vụ), `plans/ai/[id]`, `plans/listing/[id]`. Lối vào: nút Kế hoạch ở header Tập luyện + lối tắt Trang chủ. (PARTIAL: sinh/điều chỉnh/giải thích bằng AI chưa chạy thật — máy dev không có LLM; áp dụng kế hoạch chợ không chạy tự động vì thay chương trình tập của tài khoản) |
| CL-19 | `NutritionExtras.tsx` (`NutritionGoals`,`MonthlySummary`) | Section trong `NutritionPage.tsx`, không phải route riêng | nested trong `nutrition/index.tsx` | fitness: `/nutrition/goals*` | client, pt | — | goal presets | không | không | không | 6 | **xong/đã kiểm trên emulator (16/9)** — `workout/nutrition/goals` (preset co giãn macro để qua được phép kiểm Atwater ±50 kcal của máy chủ, lịch sử mục tiêu) và `…/monthly` (tỉ lệ tuân thủ, lịch theo ngày). Ô "Nước TB/ngày" của bản thiết kế bị bỏ: sản phẩm không ghi nhận lượng nước (ADAPTERS §22.1) |
| CL-20 | `Notifications.tsx` | Không có trang riêng — dropdown panel trong `Topbar.tsx` | `(client)/notifications.tsx` (route thật trên mobile, khác web) | user: `/notifications*` | client, pt | — | grouped by date | không | có (tap push→route, xem 14.2) | notifications | 9 | xong 22/9 — `app/client/notifications.tsx` + chuông dashboard dùng số chưa đọc thật; bấm → đánh dấu đã đọc (DB) + mở màn tương ứng; kiểm máy ảo. **30/9 (14.2): thông báo đẩy FCM** — cùng `notificationRoute` cho thao tác bấm push; kiểm máy ảo: app mở / chạy nền (dev) / đã tắt (release) → mở đúng màn + đánh dấu đã đọc; đăng xuất huỷ token (ADAPTERS §38) |
| CL-21 | `Messages.tsx` | Cùng `ChatPage.tsx` conversation-list pane (SH-04) | `(client)/chat/index.tsx` (list pane) | chat: `listConversations` | client, pt | — | inbox list | không | không | không | 9 | xong 22/9 — `app/client/messages/index.tsx` (chỉ tin người–người; AI Coach = nút nổi WB-12); kiểm máy ảo |
| CL-22 | `PTApplication.tsx` | `pages/client/PTApplicationPage.tsx` | `(client)/pt-application/index.tsx` | user: `/pt-applications/me*` | client, pt | 06 | 6 trạng thái, 8 bước UI | không | không | document-picker | 9 | đã làm 22/9 — `app/client/profile/pt-application.tsx` (wizard 8 bước + màn trạng thái); ĐÃ nộp đơn thật 24/9 bằng john.doe, DB `pt_applications.status = SUBMITTED` (§25.6) |
| CL-23 | `AIPlanWizard.tsx` | Nhúng trong `AIPlansPage.tsx`, không route riêng | nested trong `plans/index.tsx` | ai: `/plans/*` (+fitness `equipmentService`,`workoutService`) | client, pt | — | wizard form→progress→result | không | không | không | 8 | **xong/đã kiểm giao diện (22/9)** — `plans/wizard` (tạo 3 bước + điều chỉnh), theo job thật `GET /plans/job/:id`; chỉ thu đúng các trường server nhận. (PARTIAL: chưa chạy được một job AI thật — không có LLM trên máy dev) |

---

## PT (13)

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PT-01 | `pt/PTDashboard.tsx` | `pages/pt/PTDashboard.tsx` | `(pt)/dashboard.tsx` | payment+user+ai | pt only | 01 | today sessions/pending | không | không | không | 10 | xong 25/9 — `app/pt/dashboard.tsx`; ví PT + 5 chỉ số thật, cảnh báo cần xử lý, chuyển không gian; hero là ví (không phải "tổng thu nhập" của web — §26.5) |
| PT-02 | `pt/PTStudents.tsx` | `pages/pt/PTClientList.tsx` | `app/pt/students/index.tsx` | user: `/contracts/pt*` | pt only | 01 | roster filter | không | không | không | 10 | xong 25/9 — 4 chip tiếng Việt kèm số đếm, tìm theo tên/gói; 35 hợp đồng khớp DB (§26.2) |
| PT-03 | `pt/PTStudentDetail.tsx` | `pages/pt/PTClientDetail.tsx` | `app/pt/students/[id].tsx` | user: `/contracts/pt`, `/sessions/contract/:id` | pt only | 01 | contract/progress | — | không | không | 10 | xong 25/9 — route theo **contractId** (§26.2); hợp đồng + danh sách buổi. Lộ trình/tóm tắt thể lực/giao giáo án (WB-13) ở Phase 11 |
| PT-04 | `pt/PTSchedule.tsx` | `pages/pt/PTSchedulePage.tsx` | `app/pt/schedule.tsx` | user: `/sessions*`,`/availability*` | pt only | 01 | calendar/exceptions | sheet ngày nghỉ | không | không | 10 | xong 25/9 — lịch tháng + hành động buổi bám guard backend (§26.3); soạn dải giờ thật thay lưới ô của thiết kế (§26.4), kiểm ghi khứ hồi trên DB. Đổi lịch/báo vắng → Phase 11 |
| PT-05 | `pt/PTWallet.tsx` | `pages/pt/PTWalletPage.tsx` | `app/pt/wallet.tsx` | payment: `/me/pt-wallet*` | pt only | 04 | balance/withdraw | withdraw sheet | không | không | 10 | xong 25/9 — ví PT riêng với ví hội viên; `ptTransactionLabel` dịch chuỗi nội bộ payment-service; số dư khớp DB |
| PT-06 | `pt/PTProfile.tsx` | `pages/pt/PTProfilePage.tsx` (gộp cả PT-10, PT-13) | `app/pt/profile.tsx` | user: `/profile/pts/:id`, `/pt/training-locations/me`, `/availability/me` | pt only | — | hồ sơ công khai + nơi tập | sheet nơi tập | không | clipboard | 10 | xong 25/9 — chuyên môn/đánh giá THẬT thay dữ liệu bịa của web (§26.5), mã giới thiệu, tóm tắt giờ rảnh, CRUD nơi tập, chuyển không gian + đăng xuất. PT-10/PT-13 vẫn ở Phase 11 |
| PT-07 | `pt/PTContracts.tsx` | `pages/pt/PTContractsPage.tsx` | `app/pt/contracts.tsx` | user: `/contracts/*`, `/sessions/*` | pt only | 01 | 4 nhóm: Yêu cầu/Đang chờ/Đang dạy/Kết thúc | sheet từ chối + phản hồi | không | không | 11 | xong 25/9 — nhận/từ chối/phản hồi/chấm dứt + buổi tập bung ra; **KHÔNG** dựng bước ký (e-sign tắt, §27.1); E2E chéo vai trò đạt (§27.2) |
| PT-08 | `pt/PTMarketplace.tsx` | Tab `MyServicesTab` trong `PlanMarketplacePage.tsx` (`/client/plans`) — **KHÔNG dưới `/pt/*`** | nested trong `(client)/plans/marketplace.tsx`, gated `isPT` | ai: `/marketplace/services*` | pt (nhưng qua route client, xem ghi chú cổng) | 03 | listing CRUD/orders | tạo dịch vụ sheet | không | không | 11 | xong 25/9 — dựng ở **không gian PT** (`app/pt/service-orders`, mục "Dịch vụ của tôi") thay vì nhét trong trang khách như web: dịch vụ và đơn nó sinh ra là một việc (§27.6) |
| PT-09 | `pt/PTMarketOrder.tsx` | `pages/pt/PTServiceOrderPage.tsx` | `app/pt/service-orders/{index,[id]}.tsx` | ai: `/marketplace/orders/*`, fitness: `/coach/clients/:id/plan-draft` | pt only | 03 | intake→draft→revision | sheet chọn bài tập | không | không | 11 | xong 25/9 — thêm màn danh sách (web không có); mỗi trạng thái đúng 1 hành động server nhận; bộ soạn giáo án + gợi ý AI (§27.6) |
| PT-10 | `pt/PTPackages.tsx` | Nhúng trong `PTProfilePage.tsx` | `app/pt/packages.tsx` (mở từ Hồ sơ) | user: `/profile/me/service-packages*` | pt only | — | CRUD giá/số buổi + tạm ẩn/ngừng bán | sheet gói | không | không | 11 | xong 25/9 — hiện giá mỗi buổi; xoá là lưu trữ mềm nên nhãn là "ngừng bán" (§27.5) |
| PT-11 | `pt/PTPublishPlan.tsx` | Tab `MineTab` trong `PlanMarketplacePage.tsx`, **hiện cho MỌI user, không riêng PT** | nested trong `(client)/plans/marketplace.tsx` | ai: `/marketplace/plans*` | client, pt (không chỉ PT — xem ghi chú cổng) | — | DRAFT→SUBMITTED→PUBLISHED/REJECTED | không | không | không | 11 | ĐÃ CÓ từ Phase 8 — `MineSection` trong `features/plans/MarketTab.tsx` (đăng / đăng lại / gỡ / gợi ý cải thiện). Không làm lại (§27.8) |
| PT-12 | `pt/PTPlanReview.tsx` | `pages/pt/PlanReviewPage.tsx` | `app/pt/plan-review.tsx` | ai: `/plans/pt/pending-review`, `/plans/:id/pt-review` | pt only | — | duyệt / góp ý + ghi chú | sheet quyết định | không | không | 11 | xong 25/9 — hàng chờ + lịch AI, hai quyết định ghim đáy; JSON của AI làm phẳng phòng thủ (§27.4) |
| PT-13 | `pt/PTGymCollab.tsx` | `CollaborationPanel as="PT"`, nhúng trong `PTProfilePage.tsx` | nested trong `(pt)/profile.tsx` | gym: `/me/collaborations*` | pt only | 07 | propose/accept/counter/end | không | không | không | 11 | xong 25/9 — `app/pt/collaborations.tsx` mở từ Hồ sơ; ba tỷ lệ phải cộng đúng 100%, nền tảng ≥ 10%; lượt trả lời lấy từ `proposedBy` chứ không từ status (§27.5) |

---

## GYM-OWNER (9)

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GY-01 | `gym/GymDashboard.tsx` | `pages/gym-owner/GymOwnerDashboard.tsx` | `app/gym-owner/dashboard.tsx` | gym: `listOwnedGyms`,`getOwnedWallet`,**`listOwnedPlans(brandId)`**,`listOwnedMemberships`,`listCheckins`,`getGymReviews`,`collaborationService.listForOwner` | gym_owner (OWNER+MANAGER vào được, dữ liệu theo scope) | 05,07 | cần-chú-ý (trên số liệu) · ví · 4 ô KPI · cột check-in 7 ngày · phân bổ hội viên · hội viên gần đây · thông tin nhanh | không | không | không | 12 | **xong 26/9** / đã kiểm trên emulator + backend thật (§28.7). Gói hội viên theo **brandId** chứ không phải gymId — truyền nhầm là 404 và ô gói đứng ở 0. Bỏ danh sách chi nhánh cuối trang của web (tài khoản thật có 54 chi nhánh, đã có tab riêng) |
| GY-02 | `gym/GymGyms.tsx` | `pages/gym-owner/MyGymsPage.tsx` | `app/gym-owner/gyms.tsx` | gym: `listOwnedGyms/listOwnedBrands/createGym/createBrand/updateBrand/getOnboardingStatus` | gym_owner; **tạo gym/brand chỉ OWNER** (`requirePartnerOwner`); MANAGER bị **ẩn** nút đổi tên + thêm chi nhánh | 05 | thương hiệu đơn (+tên đang chờ duyệt) · chi nhánh theo thương hiệu · bản nháp wizard (chỉ liệt kê) · gym độc lập cũ (chỉ đọc) | sheet đặt tên thương hiệu · sheet đổi tên · sheet thêm chi nhánh · bản đồ ghim toàn màn hình | không | WebView (Leaflet) | 12 | **xong 26/9** / đã kiểm đọc, biểu mẫu, ghim tay, **và cả hai thao tác ghi thật** (tạo chi nhánh → `PENDING_REVIEW` với `brand_id` do server suy từ quyền sở hữu; đổi tên thương hiệu → chỉ `pendingName` đổi, `approvedName` giữ nguyên — đối chiếu DB, §28.8). Port theo **dialog** của `MyGymsPage`, không phải wizard 7 bước. Không có bộ chọn thương hiệu ở bất kỳ đâu |
| GY-03 | `gym/GymDetail.tsx` (owner) | `pages/gym-owner/GymManagePage.tsx` (gộp GY-04/06/09) | `(gym-owner)/gyms/[id].tsx` | gym | gym_owner; **sửa/rút tiền chỉ OWNER**, MANAGER chỉ xem scope của mình | 05,07 | hours/amenities/gallery/verification | nhiều sheet | không | không | 12 | **xong 5/10 (14B.5, PG-A7)** — màn `app/gym-owner/branch.tsx`, kiểm máy ảo (ADAPTERS §47) |
| GY-04 | `gym/GymWallet.tsx` | Section trong `GymManagePage.tsx` | `app/gym-owner/wallet.tsx` (tab riêng, có bộ chọn chi nhánh) | gym (KHÔNG phải payment): `/owner/gyms/:gymId/wallet`,`/withdrawals` | gym_owner; **OWNER-tier only** | 04 | số dư + trần rút (đã trừ yêu cầu PENDING) + lịch sử | sheet rút tiền | không | không | 12 | **xong 26/9** / đã kiểm số dư thật 460.353 ₫ và chốt chặn vượt trần; **chưa gửi yêu cầu rút thật** (vết tiền, admin phải xử lý tay) — §29.2/§29.6 |
| GY-05 | `gym/GymManagers.tsx` | `pages/gym-owner/ManageManagersPage.tsx` | `(gym-owner)/managers.tsx` | gym: `/owner/partner-accounts*`,`/owner/partner-invitations*` | gym_owner; **OWNER-tier only** | — | invite/scope/revoke/resend | invite sheet | không | không | 12 | **xong 27/9** / đã mời thật rồi thu hồi, đối chiếu DB — không để lại vết (§30.6). Hộp mời có ô tìm chi nhánh vì tài khoản thật có 55 chi nhánh (§30.5) |
| GY-06 | `gym/GymPTCollab.tsx` | `pages/gym-owner/GymCollaborationsPage.tsx` + `components/gym/CollaborationPanel.tsx` | `app/gym-owner/collaborations.tsx` | gym: `/owner/collaborations*`, `profile: /profile/pts` (danh bạ HLV) | gym_owner; **OWNER-tier only** | 07 | mời/đồng ý/từ chối/trả giá lại/chấm dứt | sheet mời + sheet trả lời | không | không | 12 | **xong 26/9** / đã kiểm đọc + hộp mời; **chưa gửi lời mời thật** (đề nghị PENDING không rút lại được). Bảng trạng thái dùng chung với ghế HLV qua `features/collaboration` — §29.1. Chọn HLV từ danh bạ thay vì gõ UUID như web |
| GY-07 | `gym/AddBranchWizard.tsx` | `pages/gym-owner/AddBranchWizardPage.tsx` — **CHƯA phải luồng tạo chi nhánh chính thức** (dialog đơn giản ở GY-02 mới là luồng thật đang dùng) | `(gym-owner)/gyms/add-branch.tsx` | gym: `createDraftGym/submitForReview/...` | gym_owner; OWNER-tier only | 05 | 7 bước draft→submit | nhiều | không | camera (docs) | 12 | chưa làm/chưa kiểm |
| GY-08 | `gym/PartnerSetup.tsx` | `components/auth/PartnerOnboardingWizard.tsx` — chặn toàn bộ shell gym-owner, không phải 1 trang điều hướng tới | `(gym-owner)/partner-setup.tsx` (chặn shell, giống `RequireOnboarding`) | gym: `/owner/onboarding*` | gym_owner, chặn tới khi `onboarding.completed` | 05 | contact→brand→payout→terms | không | không | không | 12 | **xong 27/9 (mã)**, dựng thành **component chặn màn** `src/features/gymOwner/PartnerOnboardingWizard.tsx` do `RequirePartnerAccess` gọi — cố ý không phải route (route sẽ nằm trong vùng bị chặn). **ĐÃ KIỂM TRÊN MÁY 28/9** với chủ gym vừa được duyệt từ app (`p12-mobile`): mở thẳng bước 3/4 nhận tiền vì liên hệ + thương hiệu đã có từ hồ sơ → dashboard; DB `onboarding_completed_at` có, route vận hành 403 → 200 (§33.1 bước 12–13) |
| GY-09 | `gym/PartnerVerification.tsx` | **ĐÃ XÁC ĐỊNH (Ngài chọn)**: đây là `StepVerification` — giấy tờ xác minh THEO TỪNG CHI NHÁNH, đã có thật, nhúng trong GY-03/GY-07. **Không cần route Expo riêng** — gộp vào GY-03/GY-07. | (không có route riêng — nested trong `gyms/[id].tsx` và `gyms/add-branch.tsx`) | gym: branch-documents API (đã tồn tại) | gym_owner | 05 | lease/facility bắt buộc, PCCC tuỳ chọn | upload/reupload sheet | không | camera/document-picker | 12 | **xong 27/9** / giấy tờ nằm trong bước "Xác minh doanh nghiệp" của wizard: trạng thái từng loại, ghi chú của Gymini, tối đa 4 tệp mỗi loại. **Đã tải tệp thật 28/9** (PNG + PDF, qua gateway → MinIO) và thay tệp khi bị yêu cầu (bản 2) — sau khi sửa ba tầng lỗi tải lên (§33.2 mục 1) |

---

## ADMIN (6, AD-02/04 tách theo đúng 5+4 phân đoạn thật của mock; AD-03 là gap thật)

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AD-01 | `admin/AdminDashboard.tsx` | `pages/admin/AdminDashboard.tsx` | `(admin)/dashboard.tsx` | **Gateway tổng hợp** (auth+user+payment+health-probe) | admin only | — | KPI + đối soát | form refund thủ công (Gói lỗi, xem AD-04) | không | không | 13 | **xong + đã kiểm trên máy 28/9** — `app/admin/dashboard.tsx`; thêm hàng "việc đang chờ"; sức khoẻ bằng số đếm; "Chưa phân loại" cho phần gateway không tách vai trò (GAP-21) — §34 |
| AD-02 | `admin/AdminApprovals.tsx` (5 phân đoạn) | 4 trang: `AdminGymModeration.tsx`, `AdminPartnersPage.tsx`, `PTManagement.tsx`, `MarketplaceModeration.tsx` | `(admin)/gyms.tsx`,`partners.tsx`,`pts.tsx`,`marketplace.tsx` | gym (gym/brand/partner) + user (PT app) + ai (plan mod) | admin only | 05,06 | duyệt/từ chối/yêu cầu chỉnh sửa. **28/9 — XONG + đã kiểm trên máy (§35.3):** hub 4 hàng chờ có đếm; `app/admin/gyms/`, `pt-applications/`, `marketplace.tsx`. **16/9 — cập nhật theo `cc651e8`:** `AdminPartnersPage` nay còn là nơi **cấp tài khoản chủ phòng gym** với vòng đời PROSPECT→INVITED→ACTIVE→SUSPENDED/TERMINATED (xem WB-03); `AdminGymModeration` bị cắt phần tạo gym, chỉ còn duyệt | detail sheet mỗi loại | không | không | 13 | chưa làm/chưa kiểm |
| AD-03 | `admin/AdminPTs.tsx` (roster + suspend/reinstate) | **KHÔNG có trang tương đương** — chỉ có `PTManagement.tsx` cho *đơn ứng tuyển*, không có suspend/rating/roster | `(admin)/pts-roster.tsx` (mới, chờ backend) | **KHÔNG TỒN TẠI** — xem GAP-1 | admin only | — | — | — | không | không | 13 | **BLOCKED — xem MOBILE_BACKEND_GAPS.md GAP-1** (28/9: tạm ngưng/khôi phục PT làm được ở AD-05, §35.2) |
| AD-04 | `admin/AdminResolve.tsx` (4 phân đoạn) | 4 nơi: `AdminDisputes.tsx`, tab refund trong `AdminFinancePage.tsx`, form thủ công trong `AdminDashboard.tsx` ("Gói lỗi" — GAP-2), `AdminComplaintsPage.tsx` | `(admin)/disputes.tsx`,`finance.tsx` (tab refund),`complaints.tsx` | user (disputes) + ai (refund dịch vụ cá nhân hoá) + gym (refund hội viên+complaints) | admin only | 01,03,04 | resolve dispute/refund/complaint | photo grid, resolve sheet | không | không | 13 | **xong + đã kiểm trên máy 28/9** — `app/admin/resolve.tsx` 4 mục; từ chối hoàn tiền + đóng khiếu nại chạy thật; "Gói lỗi" = nhập mã như web (GAP-2) — §35.4 |
| AD-05 | `admin/AdminUsers.tsx` (có suspend/unlock) | `pages/admin/UserManagement.tsx` — **chỉ đọc, không có mutation suspend/enable** | `(admin)/users.tsx` | Gateway tổng hợp (đọc); **suspend/enable KHÔNG có** — xem GAP-3 | admin only | — | list+filter | — | không | không | 13 | **xong + đã kiểm trên máy 28/9** — `app/admin/users.tsx`; khoá/mở khoá thật sau khi sửa GAP-21 ở gateway (Ngài cho phép) — §35.1–35.2 |
| AD-06 | `admin/AdminWithdrawals.tsx` | Tab "withdrawals" trong `AdminFinancePage.tsx` (`/admin/withdrawals` redirect về `/admin/finance`) | `(admin)/finance.tsx` (tab withdrawals) | payment: `/admin/payments/withdrawals*` | admin only | 04 | pending→approved/rejected/paid | không | không | không | 13 | **xong + đã kiểm trên máy 28/9** — `app/admin/withdrawals.tsx`; giữ chỗ + từ chối chạy thật (ví về đúng số cũ); "Đã chi trả" chỉ kiểm tới hộp xác nhận, không trừ tiền tài khoản dùng chung — §34 |

---

## WEB-ONLY (4 chốt + 6 chờ quyết định) — có trên web, KHÔNG có trong 67 màn thiết kế

> Bản thiết kế Figma bắt đầu từ một chủ phòng gym đã đăng nhập được, nên không vẽ đoạn *làm sao họ
> vào được hệ thống*. Web thì có đủ, và backend cũng vậy. Bỏ ba màn này thì luồng gym-owner ở Phase 12
> không có đường bắt đầu — chủ gym không tự đăng ký được, admin phải cấp.

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WB-01 | **không có** (Figma không vẽ) | `components/auth/ForceChangePasswordScreen.tsx` — chặn toàn bộ shell khi `user.mustChangePassword`, đặt TRƯỚC cả wizard thiết lập đối tác | `(auth)/doi-mat-khau-bat-buoc.tsx` (chặn shell, giống `RequireOnboarding`) | auth: đổi mật khẩu; **mọi lần đổi mật khẩu thành công đều tự xoá cờ** (`auth.repository.ts`) | mọi vai trò có cờ `mustChangePassword` | — | không có đường thoát: không đóng, không điều hướng vòng | không | không | không | 12 | **xong 27/9** / `RequirePasswordChange` bọc ngoài `Slot` ở root nên không route nào lọt. Tối thiểu **8** ký tự theo auth-service — web ghi 6, đó là chỗ web lệch. Đổi xong là đăng xuất vì `changePassword` xoá hết refresh token (§31.5). **Chưa kiểm trên máy**: không có tài khoản nào mang cờ |
| WB-02 | **không có** (Figma không vẽ) — **21/9: THU HẸP**, route vẫn còn nhưng giờ chỉ dùng cho lời mời **QUẢN LÝ chi nhánh** (chủ gym không còn vào bằng link mời, xem WB-15) | `pages/auth/PartnerInviteAcceptPage.tsx`, route công khai `/partner/invite/:token` | `(auth)/partner-invite/[token].tsx` | gym: `/partner-invitations*` | **công khai** (chưa đăng nhập, xác thực bằng token trong link) | 05 | token hợp lệ/hết hạn/đã dùng → đặt mật khẩu | không | **có** — link mời gửi qua email, phải mở được bằng App Link | không | 12 | chưa làm/chưa kiểm |
| WB-03 | ~~**không có** (Figma không vẽ)~~ **21/9: ĐÃ BỊ THAY THẾ — KHÔNG LÀM.** Backend trả 410 `ENDPOINT_RETIRED`; thay bằng WB-15 (tự đăng ký) + WB-17 (admin duyệt hồ sơ) | ~~Luồng cấp tài khoản trong `pages/admin/AdminPartnersPage.tsx`~~ (thêm ở `cc651e8`, kèm `adminService.createGymOwner`) | nested trong `(admin)/partners.tsx` | gym: `/admin/partners*`; trả về `{ inviteLink, emailSent }` | admin only | 05 | PROSPECT → INVITED → ACTIVE → SUSPENDED/TERMINATED; gửi lại / thu hồi lời mời; đếm "đã mời >7 ngày chưa đăng nhập" | provision + kết quả (hiện link để copy khi email không gửi được) | không | clipboard (copy link mời) | 13 | chưa làm/chưa kiểm |
| WB-04 | **không có** (Figma không vẽ) | `pages/gym-owner/GymPlansPage.tsx`, route `/gym-owner/plans` | `app/gym-owner/plans.tsx` | gym: `/owner/brands/:brandId/plans` | gym_owner; tạo/ngừng bán chỉ OWNER | 02,05 | tạo gói, ngừng bán / mở bán lại, cửa sổ mở bán | sheet gói mới | không | không | 12 | **xong 26/9** / đã tạo gói thật rồi ngừng bán, đối chiếu DB — §29.3/§29.6. Không có bộ chọn chi nhánh: gói thuộc THƯƠNG HIỆU |

**Sáu route admin dưới đây có thật trên web nhưng CHƯA có quyết định có đưa lên mobile hay không.**
**Ngài quyết 2026-09-16: để tới khi bắt đầu Phase 13 mới chốt** — không quyết sớm, cũng không âm thầm
bỏ. Chúng là công cụ vận hành kiểu bàn làm việc, khác hẳn các màn duyệt/xử lý đã map:

| ID | Route web | Trang | Tính chất | Đề xuất |
|---|---|---|---|---|
| WB-05 | `/admin/gym-management` | `AdminGymManagementOverview.tsx` | Tổng quan quản trị hệ thống phòng gym | **Nên có** — cùng cụm gym-owner mà Ngài vừa sửa |
| WB-06 | `/admin/exercise-review` | `AdminExerciseReview.tsx` | Duyệt bài tập người dùng tạo | Nên có (cùng họ với duyệt nội dung ở AD-02) |
| WB-07 | `/admin/catalog-quality` | `AdminCatalogQuality.tsx` | Chất lượng dữ liệu catalog | Cân nhắc |
| WB-08 | `/admin/system` | `SystemMonitoring.tsx` | Giám sát hệ thống | Có lẽ để desktop |
| WB-09 | `/admin/workflows` | `AdminWorkflowStudio.tsx` | Trình dựng luồng nghiệp vụ | Có lẽ để desktop |
| WB-10 | `/admin/ai-observability` | `AdminAIObservability.tsx` | Quan sát hoạt động AI | Có lẽ để desktop |

**QUYẾT ĐỊNH 2026-09-27 (Ngài chốt) — cả sáu HOÃN, không đưa vào Phase 13.** Phase 13 chỉ gồm
AD-01..AD-06 (đúng các màn thiết kế) và **WB-17** (duyệt hồ sơ đối tác).

Lý do ghi lại để lần sau không phải hỏi lại: sáu route này là công cụ vận hành kiểu bàn làm việc —
bảng nhiều cột, biểu đồ giám sát, trình dựng luồng — vốn không hợp màn hình điện thoại, và không
route nào trong số đó là đường DUY NHẤT để một việc nghiệp vụ xảy ra (khác hẳn WB-17, thứ duy nhất
tạo ra được một chủ gym). Quản trị viên vẫn dùng chúng trên web.

Đây là **hoãn có ghi nhận**, không phải bỏ: nếu sau này mobile cần một trong sáu cái, mở lại mục này.
Hai cái gần nhất nếu phải chọn tiếp: WB-05 (cùng cụm gym-owner) và WB-06 (cùng họ duyệt nội dung với
AD-02).

## Bổ sung 2026-09-18 — cụm FitnessRoadmap + AI Coach + Dinh dưỡng người mới

> Phát hiện khi merge `origin/aws-deploy` (5 commit mới: `318e62c`,`1e0eaf6`,`16018e5`,`b43d6e9`,
> `96c1040`) vào `feature/payment-gateways` và soát diff `frontend/web` theo yêu cầu của Ngài. Bốn
> màn/cụm dưới đây **không nằm trong 67 màn thiết kế lẫn manifest cũ**, có thật trên web với backend
> thật (`ai-service`), nên theo đúng luật "web là sàn tối thiểu" phải được map, không phải tuỳ chọn.

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WB-11 | **không có** (Figma không vẽ) | `pages/client/RoadmapJourneyPage.tsx` (1346 dòng) + `GuidedRoadmapWizard.tsx` (1104 dòng, thuật sĩ tạo lộ trình) | `(client)/roadmap/index.tsx` + `(client)/roadmap/wizard.tsx` | **fitness-service**: `/fitness-roadmaps/*` (`current`,`draft/current`,`:id`,`diagnosis`,`projection`,`ai-draft`,`ai-draft/accept`, `activate`, `advance`, `rebuild`, `archive`). ai-service chỉ là máy sinh bản nháp nội bộ (`/generate-roadmap-draft`, do fitness-service gọi) — client không gọi thẳng ai-service | client | — (miền hoàn toàn mới, không thuộc `imports/01-07`) | DRAFT → ACTIVE → COMPLETED/CANCELLED/ARCHIVED; dự thảo AI/PT chỉ là DRAFT, **mọi bước kích hoạt/advance/rebuild/archive đều do CHÍNH KHÁCH bấm**; đối chiếu `reconciliationStatus` | wizard nhiều bước, thẻ dự báo pha, thẻ phân tích năng lượng | không | camera/ảnh (chẩn đoán thể trạng dùng ảnh — chia sẻ adapter với InBody) | **8** (Ngài chốt 22/9: gộp vào Phase 8, làm sau CL-18/23/12) | **xong/đã kiểm trên máy ảo + backend thật (22/9)** — phân đoạn "Lộ trình" trong Tập luyện + `roadmap/{index,wizard,create}`; thuật sĩ 4 bước tạo → kích hoạt thật (roadmap/giai đoạn/chu kỳ ACTIVE trong DB). (PARTIAL: advance sang giai đoạn kế chưa chứng minh được — cần một chu kỳ hoàn thành với đủ dữ liệu thật; e2e kiểm server giữ đúng giai đoạn, ADAPTERS §24.4) |
| WB-12 | `AICoach` nút nổi trong `New Frontend` giữ vai trò khác (mock tĩnh) | `components/layout/AICoachFloatingButton.tsx` + `AICoachFloatingPanel.tsx` (nút nổi TOÀN APP, tách khỏi Trò chuyện) + `components/agent/FitnessAgentBlocks.tsx` (khối hành động: đồng ý/từ chối điều chỉnh dinh dưỡng, quyết định chu kỳ, ảnh mục tiêu) | **CHƯA CHỐT** — xem ghi chú xung đột điều hướng ở Phase 9 | ai-service: `/ai/agent/*` (`recommendations/:id/choose`,`actions/:id/confirm`,`goal/confirm`,`goal-image`,`image-chat`) | client | — | AI có thể **tự hành động** qua chat (không chỉ trả lời), huy hiệu mức rủi ro LOW/MEDIUM/HIGH | panel nổi, không phải BottomSheet thường | không | ảnh (upload ảnh mục tiêu qua chat, JPEG/PNG ≤4MB) | 9 — **có xung đột, xem ghi chú** | **Quyết định 22/9 (Ngài chốt): NÚT NỔI như web** — tab "Trò chuyện" chỉ còn tin nhắn người–người; AI Coach là nút nổi mở bảng chat trên các màn client (thay quyết định gộp tab ngày 13/9). **Route: `app/client/ai-coach.tsx` + nút nổi `src/features/coach/AiCoachFab.tsx` (5 màn gốc tab client). Trạng thái 22/9: XONG — chat stream + lịch sử phiên (mở/đổi tên/xoá) + đủ khối hành động kiểm trên máy ảo; luồng ảnh chưa kiểm tới kết quả (GAP-15, khoá InBody); khối hành động chưa có dữ liệu thật để bấm (không có LLM).** |
| WB-13 | **không có** | `pages/pt/ClientRoadmapCard.tsx`, `ClientProgressCard.tsx`, `PtRoadmapDraftModal.tsx` (đều mới, nhúng trong `PTClientDetail.tsx` viết lại) | nested trong `(pt)/students/[id].tsx` | **fitness-service**: `GET /coach/clients/:clientId/roadmap`, `POST /coach/clients/:clientId/roadmap/draft` | pt — **chỉ khi có hợp đồng ACTIVE** với đúng học viên đó, kiểm lại mỗi request (`assertActivePtClientRelationship`) | — | PT **chỉ được xem + tạo bản NHÁP** (`createdByRole: PT`) để khách duyệt; không bao giờ kích hoạt/advance/rebuild/archive thay khách | modal soạn nháp | không | không | 11 | xong 25/9 — thẻ "Lộ trình" trong `app/pt/students/[id].tsx`, chỉ hiện khi hợp đồng ACTIVE. HLV chỉ xem + đề xuất bản nháp; kích hoạt/advance thuộc về khách (§27.7) |
| WB-14 | **không có** | `components/nutrition/BeginnerNutritionSummary.tsx` + `pages/client/settings/NutritionSection.tsx` — "Smart Substitute" | thẻ trong `client/workout/nutrition/index.tsx` (`src/components/nutrition/BeginnerNutritionSummary.tsx`); tuỳ chỉnh ngân sách/vùng miền tạm mở từ thẻ bằng BottomSheet, chuyển về Cài đặt ở Phase 9 | fitness-service: `GET /nutrition/food-suggestions?date&budgetLevel`, `POST /nutrition/food-suggestions/apply {date, items}`, `POST /nutrition/food-suggestions/substitute {foodId, foodName, quantityG, calories, protein, mode}`, `dailySummary` trong `GET /nutrition/daily-task`; user-service `PUT /profile/me {nutritionBudgetLevel, region}` | client | — | ẩn khi không có `dailySummary` (không có NutritionGoal); nút gợi ý ẩn khi đã vượt calo; gợi ý chỉ tải khi bấm; 4 chế độ đổi món; "Thêm bữa này" ghi log thật (bữa do server chọn theo giờ) rồi làm mới tổng ngày; không bỏ chọn được vùng miền (GAP-12) | BottomSheet tuỳ chỉnh gợi ý | không | không | 6 (vá 18/9 theo lệnh Ngài) | xong / đã kiểm tự động (unit + service) — kiểm máy ảo: xem ADAPTERS §22.7 |

**WB-14 là hồi quy trên một phase đã đóng.** Phase 6 (Dinh dưỡng + InBody + Thống kê) đã báo cáo
xong và được Ngài đồng ý qua ngày 17/9 — nhưng `NutritionPage.tsx` trên web vừa mọc thêm tính năng
"Smart Substitute" *sau* thời điểm đó. Đây không phải lỗi của Phase 6 lúc đóng (đúng sàn tối thiểu
tại thời điểm đó), mà là sàn tối thiểu tự nó dịch chuyển. Không tự ý mở lại Phase 6 để nhét thêm —
ghi nhận ở đây, chờ Ngài quyết: vá thêm vào Phase 6 ngay, hay gộp chung vào một đợt "rà lại parity"
trước Phase 15. **→ 18/9 Ngài chọn vá ngay; đã vá** (xem dòng WB-14 và ADAPTERS §22.7). Còn thiếu so
với web: công tắc "hiện macro" của Cài đặt › Dinh dưỡng (thiết lập hiển thị cục bộ) — thuộc Phase 9.

**WB-12 xung đột trực tiếp với quyết định điều hướng đã chốt cho Phase 4/9.** Doc 08 §4.2 + xác nhận
của Ngài ngày 2026-09-13 (ghi trong `client/_layout.tsx`): AI Coach gộp vào tab **Trò chuyện**, không
có nút nổi riêng — vì bản thiết kế gốc để nút nổi mà brief lại yêu cầu gộp tab, và Ngài đã chọn gộp
tab. Web hiện tại (`aws-deploy`) đã **đảo ngược đúng quyết định đó**: xoá `ChatCoachPage.tsx`, tách
AI Coach ra nút nổi toàn app riêng biệt, route `/chat` nay là tin nhắn thật. Theo đúng luật "2 nguồn
mâu thuẫn thì dừng và báo cáo, không tự chọn" — **chưa gán route Expo cho WB-12**, chờ Ngài chọn lại:
giữ nguyên quyết định gộp tab (bỏ qua thay đổi web này), hay đổi theo web sang nút nổi toàn app.

**Ba file admin KHÔNG cần dòng riêng** (đã kiểm): `AdminFinanceOverviewTab`, `AdminReconciliationPanel`,
`PTServiceRefunds` là **tab bên trong** `AdminFinancePage.tsx` → đã nằm trong AD-04/AD-06.

**Hệ quả cho kịch bản E2E bắt buộc của Phase 12:** kế hoạch viết *"Admin tạo tài khoản Gym Owner →
Owner đăng nhập lần đầu → bắt buộc đổi mật khẩu"*. Luồng thật bây giờ là **link mời**: admin cấp tài
khoản → hệ thống gửi link (hoặc admin copy link khi email lỗi) → chủ gym mở link đặt mật khẩu (WB-02)
→ nếu tài khoản bị gắn cờ `mustChangePassword` thì qua WB-01 → rồi mới tới wizard thiết lập đối tác
(GY-08). Kiểm Phase 12 phải đi theo thứ tự này, không phải theo câu chữ cũ.

> **21/9 — đoạn trên ĐÃ LỖI THỜI.** Luồng link mời cho CHỦ gym đã bị gỡ. Kịch bản E2E Phase 12 mới:
> khách vãng lai bấm "Trở thành đối tác" ở màn đăng nhập → nhập email (WB-15) → mở magic link trong email
> (App Link, token nằm ở `#fragment`) → đặt mật khẩu → wizard hồ sơ 9 bước (WB-16) → nộp → **bị chặn khỏi
> mọi màn vận hành** khi đang xét → admin yêu cầu sửa (WB-17) → ứng viên sửa, đánh dấu đã cập nhật, nộp
> lại → admin chấp nhận từng giấy tờ + đóng issue → duyệt → chủ gym vào dashboard, qua bước nhận tiền
> (GY-08) → thêm chi nhánh #2 **không có bộ chọn thương hiệu** → sửa hồ sơ (WB-18). WB-01 chỉ còn cho
> tài khoản cũ mang cờ `mustChangePassword`; WB-02 chỉ còn cho lời mời quản lý chi nhánh.

## Bổ sung 2026-09-21 — chủ gym tự đăng ký + hồ sơ phòng gym đầy đủ

> Nguồn: các commit web/backend `1306459`..`e1986e2` trên `feature/payment-gateways` (W0–W3 "Gym Partner
> Self-Service Onboarding" + các chỉnh sửa sau đó theo yêu cầu của Ngài). Đối chiếu trực tiếp
> `routes.tsx`, `services/partnerApplication.ts`, `services/api.ts` và route gym-service/auth-service —
> không suy từ tên file. Luật áp dụng như cũ: web là **sàn tối thiểu**, nên đây là việc bắt buộc, không
> phải tuỳ chọn.

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WB-15 | **không có** | CTA "Trở thành đối tác" dưới khối cấu hình máy chủ ở `LoginPage.tsx`; `pages/partner-application/PartnerApplyPage.tsx` (`/partner/apply`, nhập email + màn "kiểm tra email"), `PartnerApplyVerifyPage.tsx` (`/partner/apply/verify`, đọc token ở `#fragment`, xoá khỏi URL rồi mới gọi API, 4 trạng thái VALID/EXPIRED/USED/INVALID, đặt mật khẩu ≥8) | `(auth)/partner-apply/index.tsx` + `(auth)/partner-apply/verify.tsx` | **auth-service**: `POST /auth/partner-applications/start`, `/verify` (trả `setupToken` 15 phút), `/set-password` (saga tạo User + gọi gym-service bootstrap); cooldown 60 s/email ở DB + rate limit IP ở gateway | **công khai** (chưa đăng nhập) | `GYM_PARTNER_SELF_ONBOARDING_SPEC.md`, `GYM_PARTNER_SECURITY_MODEL.md` | email trùng tài khoản Khách/PT/Admin bị chặn ở bước nhập email; link 24 h, gửi lại vô hiệu link cũ; `setupToken` chỉ giữ trong bộ nhớ | không | **có** — magic link trong email phải mở được bằng App Link; token nằm ở `#fragment` (không lên server/log) — adapter deep link phải đọc được fragment | không | 12 | **xong 27/9** / **đã chạy thật đầu-đến-cuối**: CTA → email → liên kết dev → xác minh → đặt mật khẩu → DB có user `GYM_OWNER` mới (§31.7). Mã ở fragment; App Links chưa có nên nhận thêm đường dán liên kết/mã (§31.3) |
| WB-16 | **không có** | `pages/partner-application/PartnerApplicationPage.tsx` + `ApplicationWizard.tsx` (9 bước: Người đại diện → Thương hiệu (+logo tuỳ chọn) → Mạng xã hội (tuỳ chọn, chỉ https + đúng tên miền) → Quy mô → Chi nhánh đầu tiên → **Vị trí** (số nhà/đường + tỉnh/phường, bản đồ **tự ghim theo địa chỉ** qua Nominatim/OSM, kéo ghim để sửa) → Ảnh cơ sở → Xác minh doanh nghiệp (3 giấy tờ bắt buộc + 2 bổ sung MST/PCCC, **mỗi giấy tờ 1..4 tệp**, thumbnail + xem trước) → Xem lại & gửi) + `StatusViews.tsx` (đang xét / cần sửa theo thẻ issue / bị từ chối / đã duyệt) + `ChangeRequests.tsx`; guard `RequirePartnerApplicant`, `RootRedirect` điều hướng theo **trạng thái hồ sơ**, không chỉ theo role | `(partner-application)/_layout.tsx` (guard) + `index.tsx` (wizard) + `status.tsx` | **gym-service** `/owner/application/*`: `status`, `GET /`, `timeline`, `PUT representative/business-scale/brand/social/branch/legal`, `uploads/presign` + `uploads/confirm` (S3 presigned **POST**, server sinh khoá, confirm kiểm HEAD + magic bytes), `photos/*`, `GET`/`DELETE documents/:docType/files/:fileId`, `submit`, `resubmit`, `issues/:id/mark-updated` | gym_owner **chưa được duyệt**; mọi route vận hành `/owner/*` trả 403/409 cho tới khi APPROVED (cổng dương ở server) | như WB-15 + `GYM_PARTNER_STATE_MACHINE.md` | ONBOARDING → UNDER_REVIEW → CHANGES_REQUESTED ⇄ UNDER_REVIEW → APPROVED / REJECTED; khoá sửa khi đang xét / bị từ chối; giấy tờ PENDING/RECEIVED/VERIFIED/REJECTED ("Cần cập nhật"); issue OPEN → RESUBMITTED → RESOLVED (chỉ admin đóng) | xem ảnh/giấy tờ phóng to, thẻ yêu cầu sửa | không | **camera + thư viện ảnh + document picker (PDF)**; **upload multipart thẳng lên S3** bằng URL ký sẵn (adapter mới — không qua API của mình); **bản đồ** kéo-thả ghim (cần chọn thư viện bản đồ RN); gọi Nominatim (≤1 req/s, gửi được User-Agent riêng từ RN) | 12 | **xong 27/9** / wizard 9 bước + `ApplicantHome` chia 5 trạng thái ứng viên, đều là **component chặn màn** do `RequirePartnerAccess` dựng. `missing[]` của máy chủ là nguồn duy nhất quyết định tiến độ/bước/chặn nộp (§31.1). **Đã chạy thật 28/9**: khai đủ 9 bước, nộp, màn đang-xét-duyệt + tiến trình từ nhật ký, trọn vòng yêu cầu chỉnh sửa (đánh dấu mục + thay giấy tờ + gửi lại) (§33.1). **Chưa kiểm**: màn bị-từ-chối |
| WB-17 | **không có** (thay WB-03) | `pages/admin/AdminPartnersPage.tsx` giờ là **"Duyệt hồ sơ đối tác"** (tab Hồ sơ đăng ký / Đối tác) + `AdminApplicationsPanel.tsx`: hàng chờ theo trạng thái, chi tiết 2 cột, chấp nhận / yêu cầu cập nhật **từng giấy tờ** (xem từng tệp, mỗi lần xem ghi nhật ký), issue theo mục (đóng / yêu cầu lại), duyệt (bị khoá kèm lý do khi còn issue hoặc giấy tờ chưa chấp nhận) / từ chối (bắt buộc lý do) / mở lại, lịch sử từ `PartnerAuditLog`; hiện nguyên văn link mạng xã hội để kiểm | nested trong `(admin)/partners.tsx` | gym-service `/admin/partners/applications`, `/admin/partners/:id/application` (+ `documents/:docType/file?fileId=`, `documents/:docType/accept`, `request-changes`, `issues/:id/resolve|reopen`, `approve`, `reject`, `reopen`) | admin only | như WB-16 | approve là **một transaction**: đối tác VERIFIED+ACTIVE + chi nhánh đầu APPROVED; bấm đúp/2 admin → 409 | yêu cầu sửa nhiều dòng, xác nhận duyệt/từ chối | không | xem ảnh tại chỗ, PDF tải xuống | 13 | **xong 27/9 (đọc + xét duyệt)** / `app/admin/applications/` (hàng chờ + chi tiết), vào từ hub tab Duyệt. `approve.blockers` của máy chủ hiển thị nguyên văn, không dựng luật duyệt thứ hai (§32.1). Đã kiểm trên dữ liệu thật: 4 tab + bộ đếm, 6 loại giấy tờ, khối chặn duyệt. **Đã chạy thật 28/9**: xem tệp (có audit), chấp nhận từng giấy tờ, yêu cầu sửa kèm giấy tờ cụ thể, đóng mục, **duyệt** (§33.1). Thêm 28/9: yêu cầu cập nhật từng giấy tờ, khối quyết định theo trạng thái, **Mở lại hồ sơ** (§33.2). **Chưa chạy**: từ chối + mở lại (không từ chối đối tác thật) |
| WB-18 | **không có** | `pages/gym-owner/GymOwnerProfilePage.tsx`, route `/gym-owner/profile`, mở từ "Hồ sơ cá nhân" ở menu tài khoản: danh tính là **thương hiệu** (không có họ/tên); Thương hiệu (đổi tên chờ duyệt, giới thiệu **≤300 ký tự**, 4 link mạng xã hội — chỉ OWNER); lối tắt tới cài đặt từng chi nhánh (`/gym-owner/gyms/:id?settings=1`); số điện thoại liên hệ; **tài khoản nhận tiền** (chỉ OWNER); đổi mật khẩu | `(gym-owner)/profile.tsx` | gym-service `PATCH /owner/brands/:id` (tên → `pendingName`; giới thiệu; `facebookUrl/instagramUrl/tiktokUrl/youtubeUrl`), `GET /owner/onboarding/status` (trả `contactPhone`, `payout` cho OWNER), `PATCH /owner/onboarding/contact`, `PATCH /owner/onboarding/payout` (đổi sau lần đầu → nhật ký chỉ 4 số cuối + **email báo chủ gym**); auth-service `PATCH /auth/me/password` | gym_owner — MANAGER chỉ xem thương hiệu, không thấy tài khoản nhận tiền | — | pháp lý (tên pháp lý/MST/giấy phép) và người đại diện **không** tự sửa (đã được Gymini xác minh); email đăng nhập chưa đổi được ở mọi vai trò | không | không | không | 12 | **xong 27/9** / đã kiểm trên máy; luật link mạng xã hội chặn ngay trên ô nhập, `name` chỉ gửi khi tên thật sự đổi (§30.2). Nằm ở tab thứ tư của không gian chủ gym — lệch `gymTabs` ba tab của Figma có chủ ý (§30.3) |
| WB-19 | **không có** | `components/agent/FitnessAgentBlocks.tsx` + `services/fitnessAgent.ts` — commit `eba5a74` (trmizy, 20/9 "complete coach workflow readiness"), vào nhánh qua merge `e9a0cfe` 28/9, **sau** khi Phase 9 đóng (24/9): thẻ `WORKOUT_PLAN_PREVIEW` ("Lịch tập do AI Coach tạo" — từng ngày/bài, "Lưu lịch tập này" / "Bỏ qua bản này") và `NUTRITION_PLAN_PREVIEW` ("Thực đơn do AI Coach tạo" — kcal/macro, món loại trừ, gợi ý mềm, từng bữa); "Để sau" trên thẻ xác nhận chỉ hoãn tại máy (không còn hiện "Đã xác nhận") | vá vào `src/features/coach/AgentBlocks.tsx` | ai-service `POST /ai/agent/actions/:id/confirm` (sẵn có), **`POST /ai/agent/actions/:id/dismiss`** (mới — huỷ bản nháp trên server) | client | — | nháp → đã lưu / đã bỏ qua / hết hạn | không | không | không | 9 (hồi quy trên phase đã đóng, Ngài chọn vá ngay 1/10) | **xong 1/10, kiểm một phần** — component test 6/6 với thẻ thật server trả; API dismiss thật. Chưa thấy thẻ trên máy (D12) — ADAPTERS §42 |

**Dòng CŨ bị ảnh hưởng (không thêm ID mới):**

- **CL-09 — HỒI QUY TRÊN PHASE 7 ĐÃ ĐÓNG** (cùng dạng WB-14 với Phase 6). `GymDetailModal.tsx` tab "Chi tiết"
  giờ có: **"Thông tin giới thiệu"** đứng đầu (giới thiệu chi nhánh, chưa có thì dùng của thương hiệu, tối đa
  300 ký tự — dữ liệu cũ dài hơn được cắt ở khoảng trắng + "…"); **thư viện ảnh** (ảnh lớn hiện trọn không cắt,
  nút ‹ › cạnh ảnh lớn, dải ảnh nhỏ để chọn, xem toàn màn hình); **địa chỉ đủ** số nhà + phường/xã + tỉnh/thành
  (tên tra từ mã qua `/locations/*`) + chỉ dẫn đường đi; điện thoại/email bấm được; **bản đồ các chi nhánh cùng
  thương hiệu** + nút "Chỉ đường" (Google Maps theo toạ độ); **link mạng xã hội**; logo thương hiệu ở header.
  Backend `GET /gyms/:id` thêm `photos[]` (link ký tạm, chỉ khi chi nhánh đã duyệt), `brand.logoUrl`,
  `brand.facebookUrl|instagramUrl|tiktokUrl|youtubeUrl`, `brand.description`, `brandBranches[]` (id, tên, địa
  chỉ, toạ độ). **21/9 Ngài chọn: VÁ VÀO PHASE 7** (như WB-14 với Phase 6) — **đã vá + đã kiểm 21/9** (unit, E2E backend thật qua localhost + IP LAN, emulator). Bản đồ: WebView + Leaflet, hai chế độ (xem trước trong trang / toàn màn hình). Chi tiết: `MOBILE_PLATFORM_ADAPTERS.md` §23.9.
- **GY-02** (`MyGymsPage` — hộp "Thêm chi nhánh"): ô địa chỉ nằm cạnh tỉnh/phường, **bản đồ tự ghim theo địa
  chỉ** giống bước Vị trí của WB-16 (dùng chung `components/gym/addressAutoPin.tsx`, `geocode.ts`,
  `MapLocationPicker.tsx`); giới thiệu ≤300.
- **GY-03** (`GymManagePage` → "Cài đặt"): thêm **Giới thiệu & liên hệ** (giới thiệu ≤300, điện thoại, email —
  có hiệu lực ngay); ảnh dùng `url` do server trả (ảnh S3 là link ký tạm — **không** tự ghép `/uploads/...`);
  xoá ảnh S3 xoá luôn tệp; form rút tiền **điền sẵn tài khoản nhận tiền đã lưu**; `?settings=1` mở sẵn phần cài đặt.
- **GY-07** (wizard 7 bước thêm chi nhánh): giới thiệu tối đa 300 (khớp gợi ý 150–300 sẵn có).
- **GY-08** (trình thiết lập — bước nhận tiền): tài khoản nhập ở đây giờ **sửa lại được** ở WB-18 và được dùng
  để điền sẵn khi rút tiền (trước 21/9 nó được lưu nhưng không dùng ở đâu).
- **AD-02**: `AdminPartnersPage` không còn tạo/cấp tài khoản chủ gym — xem WB-17. Tab Tổng quan của đối tác tự
  đăng ký đọc SĐT từ tài khoản OWNER và tên từ người đại diện.
- **Thanh trên cùng**: web đã **gỡ ô tìm kiếm tổng** ở mọi vai trò (trang tìm kiếm vẫn vào từ Thư viện). Khi
  làm khung điều hướng mobile đừng port ô này lên header.
- **Mọi vai trò**: "Hồ sơ cá nhân" ở menu tài khoản dẫn theo vai trò — client `/client/profile`, PT
  `/pt/profile`, chủ gym `/gym-owner/profile` (WB-18); **admin chưa có trang hồ sơ**, nút bị ẩn.

**Adapter cần bổ sung vào `MOBILE_PLATFORM_ADAPTERS.md` khi mở Phase 12** (chưa ghi vào đó để không đụng
tài liệu đang đóng băng ngoài phạm vi được duyệt): (1) upload multipart thẳng lên S3 bằng presigned POST từ
URI camera/document picker, rồi `confirm` theo `uploadId`; (2) deep link đọc token ở `#fragment` và xoá nó
khỏi lịch sử điều hướng; (3) thư viện bản đồ RN cho ghim kéo-thả + bản đồ nhiều ghim chỉ xem (web dùng
Leaflet + tile OSM); (4) mở Google Maps chỉ đường bằng link ngoài.

---

## Điều kiện qua cổng (Phase 0.2)

```
TOTAL_EXPECTED = 67   (số màn của bản thiết kế — cổng Phase 0 tính trên đúng tập này)
MAPPED         = 67   (mọi ID đều có dòng, kể cả các dòng "không có 1:1" — đó là câu trả lời đã
                        xác định, không phải ô trống)
WEB_ONLY_EXTRA = 10   (thêm 16/9, không thuộc 67 màn thiết kế. WB-01..04 là BẮT BUỘC vì web là sàn
                        tối thiểu và chúng chặn đường vào của chủ phòng gym / nguồn gói hội viên.
                        WB-05..10 là sáu công cụ quản trị — CHỜ NGÀI QUYẾT có đưa lên mobile không.)
WEB_ONLY_ADD   = +4   (21/9: WB-15..18 thêm; WB-03 đã bị thay thế nên KHÔNG làm; WB-02 thu hẹp còn
                        lời mời quản lý. Cổng Phase 0 vẫn tính trên 67 màn thiết kế — không mở lại.)
UNMAPPED       = 0
UNKNOWN_API    = 0    (AD-03/AD-04's "Gói lỗi"/AD-05 là gap ĐÃ XÁC ĐỊNH — ghi ở
                        MOBILE_BACKEND_GAPS.md — không phải "chưa biết gọi gì")
UNKNOWN_ROLE   = 0
```

**Số học đạt đủ điều kiện kỹ thuật (67/67/0/0/0).** GY-09 đã được Ngài xác nhận là giấy tờ xác
minh theo chi nhánh (`StepVerification`, đã có sẵn) — gộp vào GY-03/GY-07, không cần route riêng.

**PHASE 0 ĐÃ ĐÓNG CỔNG.** Còn PT-08/PT-11 có 1 lệch nhỏ giữa giả định của bản mock (gắn nhãn "PT")
và hành vi thật của web (mở cho mọi client) — không chặn cổng, chỉ cần xác nhận hướng đi trước khi
thực thi Phase 11 (port đúng như mock gắn mác "PT-only", hay đúng như web hiện tại cho mọi client).

## Ghi chú thiết kế quan trọng rút ra được (không phải gap, nhưng ảnh hưởng kiến trúc RN)

- Rất nhiều màn hình "1 màn" trong New Frontend thật ra là 1 tab/section/modal bên trong 1 trang
  web lớn hơn (CL-04 tách 5, CL-15 tách 3, AD-02 tách 4, AD-04 tách 4...) — khi thiết kế route Expo
  Router, cân nhắc giữ đúng "1 route = 1 concept nghiệp vụ" như web đã làm, thay vì cố nhồi lại
  thành đúng 1 route để khớp hình dạng của New Frontend.
- GY-08 và SH-03 là **chặn toàn bộ shell** (như `RequireOnboarding`/`PartnerOnboardingWizard`),
  không phải 1 màn hình điều hướng tới bình thường — Phase 4 cần thiết kế cơ chế chặn cấp layout
  cho cả 2 trường hợp này ngay từ khung điều hướng, không phải thêm sau.
- GY-07 (wizard 7 bước) hiện KHÔNG phải luồng tạo chi nhánh chính thức trên web — luồng thật là
  dialog đơn giản ở GY-02. Port UI wizard theo New Frontend là đúng (vì đó mới là hướng sản phẩm
  muốn tới, và Phase 12 đã khoá bất biến one-owner-one-brand cho đúng cả 2 luồng), nhưng khi thực
  thi Phase 12 cần xác nhận: RN có build cả 2 luồng (dialog nhanh + wizard đầy đủ) hay chỉ 1?
- CL-10/CL-11 dùng chung 1 "Request Coaching Modal" trên web — không phải 2 màn tách biệt như New
  Frontend gợi ý (TrainerDetail riêng, ContractRequest riêng). Cân nhắc gộp lại đúng như web khi
  build Phase 7, tránh tạo 2 luồng UI cho cùng 1 hành động.

---

## Xung đột phạm vi phát hiện lúc mở Phase 5 (BÁO CÁO, chưa tự quyết)

1. **CL-01 `Stats.tsx` — Phase 5 hay Phase 6?** Bảng CLIENT ở trên xếp **CL-15 (`Stats.tsx`) vào
   Phase 5**, nhưng phần mô tả phase trong kế hoạch xếp `Stats.tsx` vào **Phase 6**
   ("Dinh dưỡng + InBody + Thống kê") và danh sách màn hình của Phase 5 không hề nhắc tới nó.
   Theo quy tắc "hai nguồn mâu thuẫn thì dừng và báo cáo", CL-15 tạm để ở Phase 6:
   `app/client/stats/activity.tsx` hiện là placeholder ghi rõ Phase 6. Đường dữ liệu đã được chứng
   minh sẵn — Trang chủ đang đọc chính `/stats/activity-heatmap` mà màn Thống kê sẽ dùng.
   **ĐÃ QUYẾT (Ngài, 2026-09-15): CL-15 thuộc Phase 6**, đúng như kế hoạch. Chỗ lệch là lỗi của bảng
   manifest lập ở Phase 0, không phải mâu thuẫn trong kế hoạch — bảng đã được sửa.

3. **Thư viện thực phẩm + kiến thức dinh dưỡng — Phase 5 hay Phase 6?** Đây là chỗ trùng THẬT trong
   kế hoạch: Phase 5 gồm `discover/*` (bao cả `FoodLibrary.tsx`, `NutritionKnowledge.tsx`), Phase 6
   cũng liệt kê đích danh hai màn này.
   **ĐÃ QUYẾT (Ngài, 2026-09-15): thuộc Phase 6.** Các phần PARTIAL "→ Phase 6" của cụm Thư viện (tìm
   kiếm nhóm thực phẩm + bài viết, xem trước thực phẩm/kiến thức) giữ nguyên hướng đó.

2. **SH-03 trình thiết lập hồ sơ — Phase 4 hay Phase 5?** Manifest xếp SH-03 vào Phase 4, nhưng
   doc comment của `app/client/onboarding.tsx` (viết ở Phase 4) tự ghi rằng trình hướng dẫn thật
   "là của Phase 5". Màn hình hiện vẫn là bản rút gọn "Bỏ qua, vào ứng dụng" của Phase 4.
   **ĐÃ QUYẾT (Ngài, 2026-09-15): SH-03 thuộc Phase 5.** Nguồn gốc: kế hoạch không giao
   `SetupWizard.tsx` cho phase nào (Phase 4 chỉ yêu cầu guard onboarding) — không phải mâu thuẫn trong
   kế hoạch, mà là khoảng trống. Phase 5 chưa đóng cho tới khi màn này được dựng thật.

## Sổ việc còn mở — ghi lại khi đóng Phase 13 (28/9)

Không việc nào dưới đây chặn việc qua Phase 14 (Ngài xác nhận 28/9). Ghi ở đây để khỏi rơi mất: mỗi dòng nói
**còn thiếu gì · vì sao chưa làm · cần gì để gỡ**. Khi một dòng xong, sửa cột "Trạng thái" và dẫn tới nơi ghi bằng
chứng — không xoá dòng.

### A. Chức năng chưa làm

| # | Việc | Vì sao còn mở | Cần gì để gỡ | Trạng thái |
|---|---|---|---|---|
| A1 | **AD-03** — danh sách PT đang hoạt động kèm đánh giá / số học viên | Backend không có endpoint roster PT tổng hợp (GAP-1). Riêng *tạm ngưng / khôi phục* một PT đã làm được ở AD-05 (khoá tài khoản → relay huỷ + hoàn tiền hợp đồng) | Ngài quyết có làm endpoint `GET /admin/pts` (+ rating, số học viên) ở user-service không | OPEN — chờ Ngài |
| A2 | **WB-05..WB-10** — 6 route admin chỉ có trên web: `gym-management`, `exercise-review`, `catalog-quality`, `system`, `workflows`, `ai-observability` | Ngài chọn hoãn 27/9: công cụ bàn làm việc, không hợp điện thoại | Ngài mở lại nếu cần; hai ứng viên gần nhất ghi ngay dưới bảng WB-05..10 | HOÃN (Ngài quyết) |

### B. Đã làm nhưng chưa kiểm được trên máy

| # | Việc | Vì sao chưa kiểm | Cần gì để kiểm | Trạng thái |
|---|---|---|---|---|
| B1 | **WB-01** — màn đổi mật khẩu bắt buộc (`mustChangePassword`) | Không tài khoản nào đang mang cờ; không đặt cờ lên tài khoản người khác để tạo ca thử | Một tài khoản thử mới có cờ (tạo qua đúng luồng đang đặt cờ, hoặc Ngài cho phép dùng DB test) | Chỉ có test thuần + `CODE AUDIT` |
| B2 | **WB-17** — *từ chối* rồi *mở lại* hồ sơ đối tác | Phải từ chối một đối tác thật; hồ sơ thử duy nhất (`p12-mobile`) đã được duyệt | Tạo thêm một hồ sơ thử qua WB-15 (magic link dev echo) rồi từ chối → mở lại → ứng viên sửa, nộp lại | Chỉ có `CODE AUDIT` + đối chiếu web |
| B3 | Nút **"Dùng vị trí hiện tại"** (GY-02 / bước Vị trí của hồ sơ) — nhánh thành công | GPS emulator đứng yên, `adb emu geo fix` không cập nhật | Kiểm trên điện thoại thật (Phase 14 có dùng máy thật) | Nhánh hết giờ / lấy vị trí gần nhất đã kiểm |

### C. Việc backend chờ Ngài quyết (mobile đã có cách đi tạm)

| GAP | Nội dung ngắn | Mobile đang làm gì | Cần Ngài quyết |
|---|---|---|---|
| GAP-2 | Hoàn tiền gói hội viên ngoại lệ không có danh sách gói bất thường — admin phải nhập mã gói | Làm đúng như web: ô nhập mã (kiểm dạng UUID) + lý do + hỏi lại | Có làm endpoint liệt kê gói bất thường (thanh toán treo, gym đóng cửa mà gói còn chạy…) không |
| GAP-13 | Khiếu nại / hoàn tiền đơn dịch vụ 1-1 phía khách chưa hoàn chỉnh | **Tạm tắt** giao diện phía khách từ 22/9; phía admin (AD-04) đã chạy được | Chính sách với partner — rồi mới bật lại phía khách |
| GAP-14 | Socket giữ JWT lúc bắt tay suốt đời kết nối → chat chết sau 15 phút | Đã vá phía mobile (kết nối lại khi token làm mới) | Có sửa gateway để nhận token mới giữa chừng (`auth:refresh`) không |
| GAP-19 | `requestContract` còn một câu lỗi tiếng Anh (`contract.service.ts` dòng 392) | Đã vá: ánh xạ sang tiếng Việt ở `contractRequestError()` | Cho phép đổi đúng một chuỗi ở user-service |
| GAP-20 | Liên kết xác minh đối tác không mở thẳng app (chưa có App Links) | Màn `partner/verify` nhận deep link, dán cả liên kết, hoặc dán riêng mã | Cần tên miền thật + `/.well-known/assetlinks.json` — việc hạ tầng khi có tên miền |

Chi tiết từng GAP: `MOBILE_BACKEND_GAPS.md`. Bằng chứng Phase 12–13: `MOBILE_PLATFORM_ADAPTERS.md` §30–§36.

## Sổ việc còn mở — Phase 14 (ghi 1/10)

Cùng cách ghi như trên. Phase 14 chưa đóng: code 14.1–14.4 đã có, nhưng "Xong khi" của kế hoạch đòi kiểm trên
thiết bị thật. Buổi thử bằng điện thoại thật dự định tối 30/9 **chưa chạy được** (máy tính không nhận điện thoại qua
USB — không thấy thiết bị ADB/MTP nào) → dời lại.

### D. Cần kiểm trên điện thoại thật (ROG Phone 6, USB + `adb reverse tcp:3000 / tcp:8081`, một bên web một bên app)

| # | Việc | Bằng chứng hiện có | Trạng thái |
|---|---|---|---|
| D1 | **14.4** gọi thoại + video app↔web cả hai chiều trên máy thật (đo lại thời gian từ lúc nghe tới lúc thông — máy ảo 6–7 s) | Máy ảo ↔ Chrome (§40) | OPEN |
| D2 | **14.4** "Tham gia buổi học" vào phòng thật, cả khách lẫn PT, ra rồi vào lại | Chưa có — cần buổi ONLINE + CONFIRMED trong khung giờ: đặt từ hytrongbeou trên hợp đồng ONLINE với huytronh4, PT xác nhận | OPEN |
| D3 | **14.4** khác mạng (điện thoại 4G ↔ máy tính Wi-Fi) để chứng minh TURN | Chưa có | OPEN |
| D4 | **14.4** loa ngoài/tai nghe, cuộc gọi điện thoại chen ngang, app ra nền, mất mạng giữa chừng | Chưa có | OPEN |
| D5 | **14.4** thời lượng cuộc gọi trên máy thật (GAP-23 đã sửa) | Máy ảo: "Video call ended (0:17)" | OPEN |
| D6 | **14.1** cổng thanh toán trả về khi app còn sống (foreground/background); hợp đồng PT + đơn 1-1 bấm thật; MoMo | Máy ảo chỉ kiểm được nhánh app bị tắt (§37.4) | OPEN |
| D7 | **14.2** push trên máy thật (mở / nền / đã tắt) + đổi tài khoản trên cùng máy | Máy ảo (§38) | OPEN |
| D8 | **14.3** camera quét mã QR thật → check-in | Không có (ảnh dán cảnh camera ảo không hiện — §39) | OPEN |
| D9 | **B3** nút "Dùng vị trí hiện tại" nhánh thành công | — | OPEN |
| D10 | **E2** cuộc gọi đến khi app **đã tắt hẳn** (bấm push → app mở → đổ chuông trong 30 s) — cần **bản release** (bản dev nạp mất >40 s, quá 30 s đổ chuông) | Máy ảo: ca app chạy nền đạt trọn vòng (§41) | OPEN |
| D11 | **E5** bấm "Huỷ thanh toán" trên VNPay thật → màn kết quả báo thất bại ngay | Test tích hợp route với chữ ký thật (§41) | OPEN |
| D12 | **WB-19** thẻ "Lịch tập do AI Coach tạo" hiện trên app thật (gõ "Tạo lịch tập 3 buổi mỗi tuần cho tôi") → Lưu / Bỏ qua; thực đơn cần LLM (máy dev không có Ollama) | Component test + API thật (§42) | OPEN |
| D13 | AI Coach: câu trả lời dạng văn bản (vd. nút gợi ý "Lập lịch tập cho tôi") **chạy chữ gần 1 giờ chưa xong** trên máy ảo — đo lại trên máy thật; nếu vẫn chậm là lỗi hiệu năng hiệu ứng chạy chữ của Phase 9 | Quan sát máy ảo 1/10 | OPEN |

### E. Chức năng còn thiếu / chờ Ngài quyết

| # | Việc | Cần gì | Trạng thái |
|---|---|---|---|
| E1 | **GY-03** chủ gym hiện mã QR check-in để in (đối ứng của 14.3) | `qrcode@1.5.4` (cùng bản web) + react-native-svg; màn `gym-owner/checkin-qr` | **XONG 1/10** — §41 |
| E2 | Thông báo **cuộc gọi đến khi app đã tắt** | chat-service đổ chuông người offline 30 s + push qua `/internal/push`; `call:sync` | **XONG 1/10** (app chạy nền đạt; app tắt hẳn → D10) — §41 |
| E3 | **Push cho tin nhắn chat** | chat-service → user-service `/internal/push` (không tạo dòng thông báo) | **XONG 1/10** — §41 |
| E4 | Tin hệ thống cuộc gọi còn tiếng Anh | `callLogContent` ở chat-service | **XONG 1/10** — §41 (tin cũ trong DB giữ nguyên tiếng Anh) |
| E5 | GAP-22 giao dịch cổng đã huỷ vẫn PENDING | `/payments/vnpay/return` đóng FAILED khi mã huỷ/từ chối có chữ ký | **XONG phần cổng 1/10** — §41; phần "huỷ gói hội viên" còn mở (GAP-22) |
| E6 | **Buổi tập tự do không theo giáo án** (web `WorkoutLogPage` → `logWorkout` / `updateWorkout`: chọn bài tuỳ ý cho một ngày trống rồi lưu) — mobile chỉ thêm lịch từ buổi của chương trình | Ngài quyết có làm hay loại trừ (phát hiện khi làm 14B.4, ADAPTERS §46) | **CHỜ NGÀI — 5/10 Ngài: ghi lại, bàn sau** |
| E7 | **"AI Insights" trên trang chủ web** (`ClientDashboard`) là hai câu ghép sẵn từ cân nặng / cơ InBody mới nhất dưới nhãn "AI · Trực tiếp" — không gọi AI nào, ai cũng nhận cùng một lời khuyên. Mobile không chép (ADAPTERS §49) | Gọi AI Coach thật, hoặc đổi tên thành "Tóm tắt" và bỏ nhãn AI — thuộc miền AI của partner | **CHỜ — 5/10 Ngài: ghi lại, bàn với partner sau** |


## Khoảng trống parity web → mobile — Phase 14B (ghi 3/10)

Nguồn: `MOBILE_WEB_PARITY_AUDIT_2026-10-03.md` (CODE AUDIT). Kế hoạch: Phase 14B trong plan mobile. Mỗi dòng khi xong
ghi trạng thái + nơi có bằng chứng (ADAPTERS §…), không xoá dòng.

| Mã | Nội dung | Cụm 14B | Trạng thái |
|---|---|---|---|
| PG-A1 | Chu kỳ tập & đánh giá chu kỳ (bắt đầu/hoàn thành/huỷ, đánh giá, đề xuất tập + dinh dưỡng, diet break, báo cáo, lịch sử) | 14B.1 | **XONG code + kiểm máy ảo 4/10** — ADAPTERS §43 (chưa commit; "Kết thúc chu kỳ" chưa bấm thật) |
| PG-A2 | Phản hồi sau buổi tập (cảm nhận, RPE, đau, mệt, từng bài) + lý do bỏ buổi | 14B.1 | **Phản hồi sau buổi: XONG 4/10** — §43. **Lý do bỏ buổi: XONG 4/10** sau khi sửa backend GAP-24 (Ngài cho phép) |
| PG-A3 | Sửa lịch & chương trình tập (bỏ/dời/thêm buổi, chương trình thủ công, sửa bài, superset, bài tự tạo, loại set, bài thay thế) | 14B.4 | **XONG 5/10** — ADAPTERS §46; chuỗi "Xong khi" chạy thật trên testuser009 (tạo chương trình → dời 1 buổi → đổi 1 bài → tập xong, DB khớp); 2 lỗi web ở GAP-26 (đã sửa web 5/10); còn mở: buổi tập tự do không theo giáo án (web `logWorkout`) — **Ngài 5/10: ghi lại, bàn sau** |
| PG-A4 | Thực hiện thực đơn (đánh dấu bữa, % đã ăn, sửa/xoá món, xoá bữa, trạng thái) + sửa nhật ký ăn | 14B.3 | **XONG 4/10** — ADAPTERS §45; kèm 2 lỗi web ghi ở GAP-25 (sửa nhật ký gọi sai PUT; sửa lượng không tính lại calo) |
| PG-A5 | PT: thẻ thể lực + tiến độ học viên, duyệt/sửa/từ chối đề xuất dinh dưỡng, diet break | 14B.2 | **XONG code + kiểm máy ảo 4/10** — ADAPTERS §44; Duyệt/Sửa/Từ chối chỉ có component test (dev DB không có đề xuất đang chờ PT) |
| PG-A6 | PT giao kế hoạch tập cho học viên | 14B.2 | **XONG 4/10** — §44 (giao thật cho John Doe theo lệnh Ngài, DB + thông báo khớp) |
| PG-A7 | Chủ gym: quản lý chi nhánh (= GY-03) | 14B.5 | **XONG 5/10 (chưa commit)** — ADAPTERS §47; từng mục sửa thật trên P12 Mobile Quan 1 rồi trả lại, MANAGER bị chặn đúng chỗ (máy + API); GAP-27 (server trả ảnh thiếu `url` sau đặt bìa / sắp xếp) |
| PG-B1 | Huỷ gói hội viên đang hoạt động | 14B.6 | **XONG 5/10** — §48; huỷ thật gói Titan của hytrongbeou qua API (Ngài cho phép), DB + sổ cái khớp |
| PG-B2 | Viết/xoá đánh giá phòng gym | 14B.6 | **XONG 5/10** — §48 (API viết/sửa/xoá + NOT_A_MEMBER; giao diện chưa bấm hết do máy ảo treo) |
| PG-B3 | Chi tiết hợp đồng + PDF (+ gửi lại ký điện tử) | 14B.6 | **BỎ 5/10 (Ngài: không còn ký hợp đồng điện tử)** — không làm khối ký / PDF; web gỡ link PDF (GAP-28 khép) |
| PG-B4 | PT đánh giá khách hàng | 14B.2 | **XONG 4/10** — §44 (đánh giá thật, DB khớp) |
| PG-B5 | Chia sẻ mẫu buổi tập (CL-16 PARTIAL, GAP-8) | 14B.6 | **XONG 5/10** — §48, máy ảo + DB; GAP-8 đóng |
| PG-B6 | AI giải thích kế hoạch | 14B.6 | **ĐÃ CÓ từ Phase 8** — `plans/ai/[id].tsx` (`POST /plans/explain`); không đổi (§48) |
| PG-B7 | Tạo/gỡ gói bán từ kế hoạch đã duyệt, "Gói bán của tôi" | 14B.6 | **CODE XONG 5/10** — §48; chưa tạo gói thật (không PT nào có kế hoạch được duyệt) |
| PG-B8 | Bộ lọc thư viện thực phẩm | 14B.6 | **XONG 5/10** — §48, máy ảo (FNDDS 271 trang = API) |
| PG-B9 | Nhận lời mời làm quản lý chi nhánh (= WB-02) | 14B.6 | **XONG 5/10** — §48 (máy: deep link + xem trước; nhận lời mời qua API vì máy ảo treo) |
| PG-C1 | Trang chủ khách: xu hướng cân nặng/cơ, calo tuần, kế hoạch đang dùng, AI Insights, tập gần đây, mỡ, số buổi | 14B.7 | **XONG 5/10** — §49 (máy ảo + API); số buổi 30 ngày + tập gần đây đọc đúng trường (web sai); không chép "Calories tuần này" (ô giữ chỗ) và "AI Insights" (câu ghép, không có AI) |
| PG-C2 | Tập luyện: hành trình cân nặng, phân bổ nhóm cơ / loại bài tập | 14B.4 | **XONG 5/10** — ADAPTERS §46 (tab Nhật ký; số khớp hồ sơ + InBody) |
| PG-C3 | InBody: cân bằng cơ thể, xu hướng mỡ, danh sách mọi lần đo | 14B.7 | **XONG 5/10** — §49 (máy ảo + API); xu hướng mỡ + tab Lịch sử; "Cân bằng cơ thể" làm lại theo chuẩn tham chiếu (WHO / InBody), không chép radar tuỳ ý của web |
| PG-C4 | Dinh dưỡng: nhận xét trong ngày, biểu đồ 7 ngày | 14B.3 | **XONG 4/10** — §45 |
| PG-C5 | Chi tiết PT: phương pháp huấn luyện, đối tượng & mục tiêu | 14B.7 | **XONG 5/10** — §49 (máy ảo + API) |
| PG-C6 | Tổng quan PT: biểu đồ doanh thu, cảnh báo học viên | 14B.7 | **XONG 5/10** — §49 (máy ảo + API); cảnh báo học viên đã có từ Phase 10 |
| PG-C7 | Tổng quan admin: tăng trưởng, vai trò, cảnh báo hệ thống, đăng ký gần đây | 14B.7 | **ĐÃ CÓ từ Phase 13** (`ac6f44b`) — §49; dòng audit 3/10 là dương tính giả, không đổi gì |
| PG-D1 | Admin: quản lý đối tác đang hoạt động | 14B.8 | **XONG 5/10** — §50; Ngài chọn làm toàn bộ trên mobile; chấm dứt hợp tác chỉ kiểm tới bước xác nhận (không đảo lại được) |
| PG-D2 | Admin: tổng quan tài chính + đối soát | 14B.8 | **XONG 5/10** — §50 |

Ghi chú: dòng **AD-02** ở bảng trên còn ghi "chưa làm/chưa kiểm" ở cột trạng thái nhưng đã **xong + đã kiểm 28/9**
(ADAPTERS §35.3) — nội dung cột trước đã ghi đúng.
