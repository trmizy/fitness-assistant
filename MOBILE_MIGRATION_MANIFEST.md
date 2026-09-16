# Mobile Migration Manifest — 67 màn thiết kế + 3 màn chỉ có ở web

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
| SH-04 | `Chat.tsx` | `pages/client/ChatCoachPage.tsx` (host `ChatPage.tsx`+`AICoachPage.tsx`), tái dùng ở `/pt/chat` | `(client)/chat/index.tsx`,`ai-coach.tsx`,`[conversationId].tsx`; `(pt)/chat.tsx` | chat: `/chat/conversations*`; ai: `/ai/sessions*`,`/ai/ask/stream` | client, pt | — | thread list/mở/gõ/AI stream | không | không | socket | 9 | chưa làm/chưa kiểm |
| SH-05 | `MeetingRoom.tsx` | Không phải route — `components/call/CallOverlay.tsx`, mount toàn cục qua `CallProvider` | overlay toàn cục, không phải 1 route Expo Router | chat: WebSocket `call:initiate/offer/answer/ice_candidate/accept/reject/end` | mọi vai trò đã đăng nhập | — | connecting/live/ended | không | không | webrtc, mic/camera | 14 | chưa làm/chưa kiểm |
| SH-06 | `PaymentResult.tsx` | `pages/client/PaymentResultPage.tsx` | `payments/result.tsx` | payment: `POST /me/payments/:id/sync` | client, pt | — | verifying/success/failed | không | có (return từ cổng, xem 14.1) | expo-web-browser | 7 (stub)/14 (đủ) | chưa làm/chưa kiểm |
| SH-07 | `ReportIssue.tsx` | `components/gym/ReportIssueDialog.tsx` — chỉ thấy nhúng trong `GymMembershipsPage.tsx` | `(client)/report-issue.tsx` (mở từ nhiều nơi) | gym: `/gyms/:id/complaints`,`/me/complaints`,`/complaint-photos` | client, pt | — | Mới/Đang xử lý/Đã xử lý | ảnh minh chứng ×5 | không | camera/picker | 9 | chưa làm/chưa kiểm |
| SH-08 | `Settings.tsx` (+`EquipmentSettings`,`NotificationPrefs`) | 3 route riêng: `SettingsPage.tsx`,`TrainingEquipmentSettingsPage.tsx`,`NotificationPreferencesPage.tsx` | `(client)/settings/index.tsx`,`training-equipment.tsx`,`notification-preferences.tsx` | fitness (`equipmentService`) + user (`notificationService`) | client, pt | — | toggle list | không | không | không | 9 | chưa làm/chưa kiểm |
| SH-09 | `ExportData.tsx` | `pages/client/ExportDataPage.tsx` | `(client)/export-data.tsx` | fitness: `/exports/json`,`/exports/csv` | client, pt | — | preview→export | không | không | file-system, sharing | 9 | chưa làm/chưa kiểm |
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
| CL-01 | `Home.tsx` | `pages/client/ClientDashboard.tsx` | `(client)/dashboard.tsx` | user (`profileService`,`inbodyService`) + fitness (`workoutService`) | client, pt | — | KPI cards | không | không | không | 5 | **xong/đã kiểm trên emulator + backend thật (15/9)** — kéo-làm-mới xác nhận ở server (user-service nhận thêm đúng 1 `GET /profile/me` + 1 `GET /inbody` mỗi lần kéo); buổi đang tập dở hiện "Tiếp tục buổi tập" thay vì bị ẩn; "Sắp tới" bắt đầu SAU buổi ở thẻ lớn, không còn lặp lại (sửa 15/9, Ngài cho phép) (PARTIAL: 2 thẻ nudge → Phase 7/9, 2 ô dinh dưỡng → Phase 6) |
| CL-02 | `Workout.tsx` | `pages/client/TrainingPage.tsx` (tab host) | `(client)/workout/index.tsx`,`training-cycle.tsx` | fitness: `/workouts*`,`/training-cycles*` | client, pt | — | week schedule/log | không | không | không | 5 | **xong/đã kiểm trên emulator (15/9)** (3 tab: Lịch tuần/Nhật ký/Chu kỳ) |
| CL-03 | `Nutrition.tsx` | `pages/client/NutritionPage.tsx` | `(client)/nutrition/index.tsx` | fitness: `/nutrition*`,`/food*` | client, pt | — | macro rings/meals | không | không | không | 6 | **xong/đã kiểm trên emulator + backend thật (16/9)** — route `workout/nutrition` (dưới tab Tập luyện, theo doc 08 §4.2); vòng calo + 3 thanh macro, 4 nhóm bữa, vuốt-để-xoá, màn thêm món tìm trong 13k catalog. Đối chiếu macro: app 293 kcal/23.5P/6.8C/19.8F = đúng bản ghi backend; tổng ngày khớp 643 kcal (ADAPTERS §22.1) |
| CL-04 | `Services.tsx` | `pages/client/ServicesPage.tsx` (host 5 trang con) | `(client)/services/index.tsx` (tab host) | user + gym (xem CL-06..11) | client, pt | 01,02 | tab Tìm PT/Đặt lịch/Hợp đồng/Phòng gym/Hội viên | nhiều | không | không | 7 | chưa làm/chưa kiểm |
| CL-05 | `Profile.tsx` | `pages/client/ProfilePage.tsx` | `(client)/profile.tsx` | user: `profileService.*` | client, pt | — | edit info | ảnh đại diện picker | không | image-picker | 9 | chưa làm/chưa kiểm |
| CL-06 | `Sessions.tsx` | Không có route riêng — nằm trong `BookingPage.tsx` | `(client)/services/booking.tsx` (tab con) | user: `/sessions*` | client, pt | 01 | upcoming/pending/past | không | không | không | 7 | chưa làm/chưa kiểm |
| CL-07 | `SessionDetail.tsx` | Không có route riêng — hàng mở rộng trong `BookingPage.tsx` | modal/sheet trong `services/booking.tsx` | user: `cancelSession/clientConfirmSession/disputeSession/reportPtNoShow/reviewSession/...` | client, pt | 01 | theo máy trạng thái buổi tập | reschedule/no-show/dispute sheet | không | không | 7 | chưa làm/chưa kiểm |
| CL-08 | `Booking.tsx` | `pages/client/BookingPage.tsx` (1494 dòng, gộp CL-06/07/08) | `(client)/services/booking.tsx` | user: `bookSession`, `availabilityService.getAvailableSlots` | client, pt | 01 | calendar/slot picker | không | không | không | 7 | chưa làm/chưa kiểm |
| CL-09 | `GymDetail.tsx` (client-facing) | `components/gym/GymDetailModal.tsx` — modal, không phải route riêng (`/client/gyms/:id` redirect về list) | modal/sheet trong `services/gyms/index.tsx` | gym: `/gyms/:id*` | client, pt | 02,05 | hours/amenities/gallery/plans/reviews | GymDetailModal | không | không | 7 | chưa làm/chưa kiểm |
| CL-10 | `TrainerDetail.tsx` | Không có route riêng — panel/modal "Request Coaching" trong `PTDiscoveryPage.tsx` | modal trong `services/index.tsx` (tab Tìm PT) | user (`profileService.getPTDetail`) + gym (`collaborationService.listGymsForPt`) | client, pt | 06,07 | profile/reviews/hire CTA | Request Coaching Modal | không | không | 7 | chưa làm/chưa kiểm |
| CL-11 | `ContractRequest.tsx` | Cùng "Request Coaching Modal" ở trên (KHÔNG phải `ContractPage.tsx` — đó là quản lý hợp đồng đã có) | modal trong `services/index.tsx` | user: `POST /contracts/request` | client, pt | 01 | package→payment→pending | Request Coaching Modal | có (payment return, xem SH-06) | không | 7 | chưa làm/chưa kiểm |
| CL-12 | `PersonalizedService.tsx` | `pages/client/PersonalizedServiceOrderPage.tsx` | `services/marketplace-orders/[id].tsx` | ai (`personalizedServiceApi.*`, 18 trạng thái) | client, pt | 03 | 18-state machine | intake/revision/check-in sheet | không | không | 8 | chưa làm/chưa kiểm |
| CL-13 | `Wallet.tsx` | `pages/client/WalletPage.tsx` | `(client)/wallet.tsx` | payment: `/me/wallet*`,`/me/withdrawals` | client, pt | 04 | balance/history/withdraw | withdraw request sheet | không | không | 9 | chưa làm/chưa kiểm |
| CL-14 | `InBody.tsx` | `pages/client/InBodyModule.tsx` | `(client)/inbody/index.tsx`,`history.tsx` | user (`inbodyService`) + fitness (`trainingCycleService`) | client, pt | — | capture/history/compare | không | không | camera + thư viện ảnh | 6 | **xong/đã kiểm trên emulator + backend thật (16/9)** — `inbody/index` (Tổng quan + So sánh) và `inbody/entry` (nhập tay + kiểm tra kết quả OCR). Ảnh vào bằng **cả camera lẫn thư viện** (upload nhận jpeg/png/pdf ≤5MB, không quan tâm nguồn); OCR chỉ trích xuất, chỉ lưu sau khi người dùng xác nhận. "Điểm cơ thể" + "Phân tích AI" của bản thiết kế KHÔNG dựng (không có cột/endpoint). Có **phân tích theo vùng** (cơ/mỡ 5 vùng, cùng mức tham chiếu và ngưỡng của web) — ADAPTERS §22.2, GAP-9 |
| CL-15 | `Stats.tsx` | 3 route riêng: `ActivityHeatmapPage.tsx`,`MuscleHeatmapPage.tsx`,`ExerciseProgressChartPage.tsx` | `(client)/stats/activity.tsx`,`muscle.tsx`,`exercise-progress/[id].tsx` | fitness: `/stats/*` | client, pt | — | heatmap/PR chart | không | không | không | 6 (chuyển từ 5 — theo kế hoạch, Ngài xác nhận 15/9) | chưa làm/chưa kiểm |
| CL-16 | `Templates.tsx` | `pages/client/TemplatesPage.tsx` | `(client)/workout/templates.tsx` | fitness (`templateService`) + user (`contractService`, để share) | client, pt | — | list/import/share | không | không | không | 5 | **xong/đã kiểm trên emulator (15/9)** (PARTIAL: chia sẻ cho người nhận → Phase 7/11, GAP-8) |
| CL-17 | `WorkoutLog.tsx` | Tab "Nhật ký tập" trong `TrainingPage.tsx` | `(client)/workout/index.tsx` (tab con) | fitness: `/workouts*` | client, pt | — | live set/rep/rest timer | không | không | không | 5 | **xong/đã kiểm E2E trên emulator + backend thật (15/9)** — 1 buổi thật: bắt đầu → tick 3 set → Thêm set → tick nốt → schedule `COMPLETED` 100% (đối chiếu DB). Sửa kèm: đọc `workoutSets` (không phải `sets` = số set dự kiến), đồng hồ tính từ `schedule.startedAt`, tab tuần/trang chủ dùng `status` thay vì "có workoutId". 16/9: buổi đã `COMPLETED` mở lại từ "+" hiện dạng tổng kết (đồng hồ đứng ở thời lượng thật, "Đã hoàn thành", "Về Tập luyện"), màn refetch mỗi lần focus — xem ADAPTERS §20.10 (PARTIAL: hàng đợi offline bền → xem GAP trong doc) |
| CL-18 | `Plans.tsx` | `pages/client/PlansPage.tsx` (host `AIPlansPage`+`PlanMarketplacePage`) | `(client)/plans/index.tsx`,`marketplace.tsx` | ai: `/plans*`,`/marketplace/*` | client, pt (+PT tab ẩn, xem PT-08/11) | 03 | AI plan/chợ kế hoạch | tạo dịch vụ/publish plan sheet | không | không | 8 | chưa làm/chưa kiểm |
| CL-19 | `NutritionExtras.tsx` (`NutritionGoals`,`MonthlySummary`) | Section trong `NutritionPage.tsx`, không phải route riêng | nested trong `nutrition/index.tsx` | fitness: `/nutrition/goals*` | client, pt | — | goal presets | không | không | không | 6 | **xong/đã kiểm trên emulator (16/9)** — `workout/nutrition/goals` (preset co giãn macro để qua được phép kiểm Atwater ±50 kcal của máy chủ, lịch sử mục tiêu) và `…/monthly` (tỉ lệ tuân thủ, lịch theo ngày). Ô "Nước TB/ngày" của bản thiết kế bị bỏ: sản phẩm không ghi nhận lượng nước (ADAPTERS §22.1) |
| CL-20 | `Notifications.tsx` | Không có trang riêng — dropdown panel trong `Topbar.tsx` | `(client)/notifications.tsx` (route thật trên mobile, khác web) | user: `/notifications*` | client, pt | — | grouped by date | không | có (tap push→route, xem 14.2) | notifications | 9 | chưa làm/chưa kiểm |
| CL-21 | `Messages.tsx` | Cùng `ChatPage.tsx` conversation-list pane (SH-04) | `(client)/chat/index.tsx` (list pane) | chat: `listConversations` | client, pt | — | inbox list | không | không | không | 9 | chưa làm/chưa kiểm |
| CL-22 | `PTApplication.tsx` | `pages/client/PTApplicationPage.tsx` | `(client)/pt-application/index.tsx` | user: `/pt-applications/me*` | client, pt | 06 | 6 trạng thái, 8 bước UI | không | không | document-picker | 9 | chưa làm/chưa kiểm |
| CL-23 | `AIPlanWizard.tsx` | Nhúng trong `AIPlansPage.tsx`, không route riêng | nested trong `plans/index.tsx` | ai: `/plans/*` (+fitness `equipmentService`,`workoutService`) | client, pt | — | wizard form→progress→result | không | không | không | 8 | chưa làm/chưa kiểm |

---

## PT (13)

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PT-01 | `pt/PTDashboard.tsx` | `pages/pt/PTDashboard.tsx` | `(pt)/dashboard.tsx` | payment+user+ai | pt only | 01 | today sessions/pending | không | không | không | 10 | chưa làm/chưa kiểm |
| PT-02 | `pt/PTStudents.tsx` | `pages/pt/PTClientList.tsx` | `(pt)/clients/index.tsx` | user: `/contracts/pt*` | pt only | 01 | roster filter | không | không | không | 10 | chưa làm/chưa kiểm |
| PT-03 | `pt/PTStudentDetail.tsx` | `pages/pt/PTClientDetail.tsx` | `(pt)/clients/[id].tsx` | user+fitness (`ptCoachService`) | pt only | 01 | contract/progress | assign plan modal | không | không | 10 | chưa làm/chưa kiểm |
| PT-04 | `pt/PTSchedule.tsx` | `pages/pt/PTSchedulePage.tsx` | `(pt)/schedule.tsx` | user: `/sessions*`,`/availability*` | pt only | 01 | calendar/exceptions | không | không | không | 10 | chưa làm/chưa kiểm |
| PT-05 | `pt/PTWallet.tsx` | `pages/pt/PTWalletPage.tsx` | `(pt)/wallet.tsx` | payment: `/me/pt-wallet*` | pt only | 04 | balance/withdraw | withdraw sheet | không | không | 10 | chưa làm/chưa kiểm |
| PT-06 | `pt/PTProfile.tsx` | `pages/pt/PTProfilePage.tsx` (gộp cả PT-10, PT-13) | `(pt)/profile.tsx` | user+gym | pt only | — | edit profile | không | không | không | 10 | chưa làm/chưa kiểm |
| PT-07 | `pt/PTContracts.tsx` | `pages/pt/PTContractsPage.tsx` | `(pt)/contracts.tsx` | user: `/contracts/*` | pt only | 01 | pending→active→completed | sign flow sheet | không | không | 11 | chưa làm/chưa kiểm |
| PT-08 | `pt/PTMarketplace.tsx` | Tab `MyServicesTab` trong `PlanMarketplacePage.tsx` (`/client/plans`) — **KHÔNG dưới `/pt/*`** | nested trong `(client)/plans/marketplace.tsx`, gated `isPT` | ai: `/marketplace/services*` | pt (nhưng qua route client, xem ghi chú cổng) | 03 | listing CRUD/orders | tạo dịch vụ sheet | không | không | 11 | chưa làm/chưa kiểm |
| PT-09 | `pt/PTMarketOrder.tsx` | `pages/pt/PTServiceOrderPage.tsx` | `(pt)/service-orders/[id].tsx` | ai: `/marketplace/orders/*` | pt only | 03 | intake→draft→revision | không | không | không | 11 | chưa làm/chưa kiểm |
| PT-10 | `pt/PTPackages.tsx` | Nhúng trong `PTProfilePage.tsx` | nested trong `(pt)/profile.tsx` | user: `/profile/me/service-packages*` | pt only | — | CRUD giá/số buổi | không | không | không | 11 | chưa làm/chưa kiểm |
| PT-11 | `pt/PTPublishPlan.tsx` | Tab `MineTab` trong `PlanMarketplacePage.tsx`, **hiện cho MỌI user, không riêng PT** | nested trong `(client)/plans/marketplace.tsx` | ai: `/marketplace/plans*` | client, pt (không chỉ PT — xem ghi chú cổng) | — | DRAFT→SUBMITTED→PUBLISHED/REJECTED | không | không | không | 11 | chưa làm/chưa kiểm |
| PT-12 | `pt/PTPlanReview.tsx` | `pages/pt/PlanReviewPage.tsx` | `(pt)/plans-review.tsx` | ai: `/plans/pt/pending-review` | pt only | — | review/comment | không | không | không | 11 | chưa làm/chưa kiểm |
| PT-13 | `pt/PTGymCollab.tsx` | `CollaborationPanel as="PT"`, nhúng trong `PTProfilePage.tsx` | nested trong `(pt)/profile.tsx` | gym: `/me/collaborations*` | pt only | 07 | propose/accept/counter/end | không | không | không | 11 | chưa làm/chưa kiểm |

---

## GYM-OWNER (9)

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GY-01 | `gym/GymDashboard.tsx` | `pages/gym-owner/GymOwnerDashboard.tsx` | `(gym-owner)/dashboard.tsx` | gym | gym_owner (OWNER+MANAGER vào được, dữ liệu theo scope) | 05,07 | tổng quan | không | không | không | 12 | chưa làm/chưa kiểm |
| GY-02 | `gym/GymGyms.tsx` | `pages/gym-owner/MyGymsPage.tsx` | `(gym-owner)/gyms/index.tsx` | gym: `createGym/createBrand` | gym_owner; **tạo gym/brand chỉ OWNER** (`requirePartnerOwner`) | 05 | brand đơn+list chi nhánh | tạo gym dialog | không | không | 12 | chưa làm/chưa kiểm |
| GY-03 | `gym/GymDetail.tsx` (owner) | `pages/gym-owner/GymManagePage.tsx` (gộp GY-04/06/09) | `(gym-owner)/gyms/[id].tsx` | gym | gym_owner; **sửa/rút tiền chỉ OWNER**, MANAGER chỉ xem scope của mình | 05,07 | hours/amenities/gallery/verification | nhiều sheet | không | không | 12 | chưa làm/chưa kiểm |
| GY-04 | `gym/GymWallet.tsx` | Section trong `GymManagePage.tsx` + tóm tắt ở `GymOwnerDashboard.tsx` | `(gym-owner)/wallet.tsx` (tổng hợp) + nested trong `gyms/[id].tsx` (theo chi nhánh) | gym (KHÔNG phải payment): `/owner/gyms/:gymId/wallet*` | gym_owner; **OWNER-tier only** | 04 | balance/withdraw theo chi nhánh | withdraw sheet | không | không | 12 | chưa làm/chưa kiểm |
| GY-05 | `gym/GymManagers.tsx` | `pages/gym-owner/ManageManagersPage.tsx` | `(gym-owner)/managers.tsx` | gym: `/owner/partner-accounts*`,`/owner/partner-invitations*` | gym_owner; **OWNER-tier only** | — | invite/scope/revoke/resend | invite sheet | không | không | 12 | chưa làm/chưa kiểm |
| GY-06 | `gym/GymPTCollab.tsx` | `pages/gym-owner/GymCollaborationsPage.tsx` | `(gym-owner)/pt-collab.tsx` | gym: `/owner/collaborations*` | gym_owner; **OWNER-tier only** | 07 | propose/counter/reject/end | không | không | không | 12 | chưa làm/chưa kiểm |
| GY-07 | `gym/AddBranchWizard.tsx` | `pages/gym-owner/AddBranchWizardPage.tsx` — **CHƯA phải luồng tạo chi nhánh chính thức** (dialog đơn giản ở GY-02 mới là luồng thật đang dùng) | `(gym-owner)/gyms/add-branch.tsx` | gym: `createDraftGym/submitForReview/...` | gym_owner; OWNER-tier only | 05 | 7 bước draft→submit | nhiều | không | camera (docs) | 12 | chưa làm/chưa kiểm |
| GY-08 | `gym/PartnerSetup.tsx` | `components/auth/PartnerOnboardingWizard.tsx` — chặn toàn bộ shell gym-owner, không phải 1 trang điều hướng tới | `(gym-owner)/partner-setup.tsx` (chặn shell, giống `RequireOnboarding`) | gym: `/owner/onboarding*` | gym_owner, chặn tới khi `onboarding.completed` | 05 | contact→brand→payout→terms | không | không | không | 12 | chưa làm/chưa kiểm |
| GY-09 | `gym/PartnerVerification.tsx` | **ĐÃ XÁC ĐỊNH (Ngài chọn)**: đây là `StepVerification` — giấy tờ xác minh THEO TỪNG CHI NHÁNH, đã có thật, nhúng trong GY-03/GY-07. **Không cần route Expo riêng** — gộp vào GY-03/GY-07. | (không có route riêng — nested trong `gyms/[id].tsx` và `gyms/add-branch.tsx`) | gym: branch-documents API (đã tồn tại) | gym_owner | 05 | lease/facility bắt buộc, PCCC tuỳ chọn | upload/reupload sheet | không | camera/document-picker | 12 | chưa làm/chưa kiểm |

---

## ADMIN (6, AD-02/04 tách theo đúng 5+4 phân đoạn thật của mock; AD-03 là gap thật)

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AD-01 | `admin/AdminDashboard.tsx` | `pages/admin/AdminDashboard.tsx` | `(admin)/dashboard.tsx` | **Gateway tổng hợp** (auth+user+payment+health-probe) | admin only | — | KPI + đối soát | form refund thủ công (Gói lỗi, xem AD-04) | không | không | 13 | chưa làm/chưa kiểm |
| AD-02 | `admin/AdminApprovals.tsx` (5 phân đoạn) | 4 trang: `AdminGymModeration.tsx`, `AdminPartnersPage.tsx`, `PTManagement.tsx`, `MarketplaceModeration.tsx` | `(admin)/gyms.tsx`,`partners.tsx`,`pts.tsx`,`marketplace.tsx` | gym (gym/brand/partner) + user (PT app) + ai (plan mod) | admin only | 05,06 | duyệt/từ chối/yêu cầu chỉnh sửa. **16/9 — cập nhật theo `cc651e8`:** `AdminPartnersPage` nay còn là nơi **cấp tài khoản chủ phòng gym** với vòng đời PROSPECT→INVITED→ACTIVE→SUSPENDED/TERMINATED (xem WB-03); `AdminGymModeration` bị cắt phần tạo gym, chỉ còn duyệt | detail sheet mỗi loại | không | không | 13 | chưa làm/chưa kiểm |
| AD-03 | `admin/AdminPTs.tsx` (roster + suspend/reinstate) | **KHÔNG có trang tương đương** — chỉ có `PTManagement.tsx` cho *đơn ứng tuyển*, không có suspend/rating/roster | `(admin)/pts-roster.tsx` (mới, chờ backend) | **KHÔNG TỒN TẠI** — xem GAP-1 | admin only | — | — | — | không | không | 13 | **BLOCKED — xem MOBILE_BACKEND_GAPS.md GAP-1** |
| AD-04 | `admin/AdminResolve.tsx` (4 phân đoạn) | 4 nơi: `AdminDisputes.tsx`, tab refund trong `AdminFinancePage.tsx`, form thủ công trong `AdminDashboard.tsx` ("Gói lỗi" — GAP-2), `AdminComplaintsPage.tsx` | `(admin)/disputes.tsx`,`finance.tsx` (tab refund),`complaints.tsx` | user (disputes) + ai (refund dịch vụ cá nhân hoá) + gym (refund hội viên+complaints) | admin only | 01,03,04 | resolve dispute/refund/complaint | photo grid, resolve sheet | không | không | 13 | chưa làm/chưa kiểm (riêng "Gói lỗi" xem GAP-2) |
| AD-05 | `admin/AdminUsers.tsx` (có suspend/unlock) | `pages/admin/UserManagement.tsx` — **chỉ đọc, không có mutation suspend/enable** | `(admin)/users.tsx` | Gateway tổng hợp (đọc); **suspend/enable KHÔNG có** — xem GAP-3 | admin only | — | list+filter | — | không | không | 13 | **PARTIAL — đọc được, suspend/unlock xem GAP-3** |
| AD-06 | `admin/AdminWithdrawals.tsx` | Tab "withdrawals" trong `AdminFinancePage.tsx` (`/admin/withdrawals` redirect về `/admin/finance`) | `(admin)/finance.tsx` (tab withdrawals) | payment: `/admin/payments/withdrawals*` | admin only | 04 | pending→approved/rejected/paid | không | không | không | 13 | chưa làm/chưa kiểm |

---

## WEB-ONLY (4 chốt + 6 chờ quyết định) — có trên web, KHÔNG có trong 67 màn thiết kế

> Bản thiết kế Figma bắt đầu từ một chủ phòng gym đã đăng nhập được, nên không vẽ đoạn *làm sao họ
> vào được hệ thống*. Web thì có đủ, và backend cũng vậy. Bỏ ba màn này thì luồng gym-owner ở Phase 12
> không có đường bắt đầu — chủ gym không tự đăng ký được, admin phải cấp.

| ID | Nguồn thị giác | Nguồn web hiện hành | Route Expo (đề xuất) | Backend + API chính | Vai trò/quyền | Spec | Trạng thái quan trọng | Modal/Sheet | Deep link | Năng lực native | Phase | Impl/Verify |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WB-01 | **không có** (Figma không vẽ) | `components/auth/ForceChangePasswordScreen.tsx` — chặn toàn bộ shell khi `user.mustChangePassword`, đặt TRƯỚC cả wizard thiết lập đối tác | `(auth)/doi-mat-khau-bat-buoc.tsx` (chặn shell, giống `RequireOnboarding`) | auth: đổi mật khẩu; **mọi lần đổi mật khẩu thành công đều tự xoá cờ** (`auth.repository.ts`) | mọi vai trò có cờ `mustChangePassword` | — | không có đường thoát: không đóng, không điều hướng vòng | không | không | không | 12 | chưa làm/chưa kiểm |
| WB-02 | **không có** (Figma không vẽ) | `pages/auth/PartnerInviteAcceptPage.tsx`, route công khai `/partner/invite/:token` | `(auth)/partner-invite/[token].tsx` | gym: `/partner-invitations*` | **công khai** (chưa đăng nhập, xác thực bằng token trong link) | 05 | token hợp lệ/hết hạn/đã dùng → đặt mật khẩu | không | **có** — link mời gửi qua email, phải mở được bằng App Link | không | 12 | chưa làm/chưa kiểm |
| WB-03 | **không có** (Figma không vẽ) | Luồng cấp tài khoản trong `pages/admin/AdminPartnersPage.tsx` (thêm ở `cc651e8`, kèm `adminService.createGymOwner`) | nested trong `(admin)/partners.tsx` | gym: `/admin/partners*`; trả về `{ inviteLink, emailSent }` | admin only | 05 | PROSPECT → INVITED → ACTIVE → SUSPENDED/TERMINATED; gửi lại / thu hồi lời mời; đếm "đã mời >7 ngày chưa đăng nhập" | provision + kết quả (hiện link để copy khi email không gửi được) | không | clipboard (copy link mời) | 13 | chưa làm/chưa kiểm |
| WB-04 | **không có** (Figma không vẽ) | `pages/gym-owner/GymPlansPage.tsx`, route `/gym-owner/plans` (gói hội viên theo THƯƠNG HIỆU — `dde6a59`) | `(gym-owner)/plans.tsx` | gym: gói hội viên theo brand | gym_owner | 02,05 | CRUD gói; gói thuộc thương hiệu, không thuộc riêng chi nhánh | tạo/sửa gói | không | không | 12 | chưa làm/chưa kiểm — **bắt buộc**: không có gói thì luồng mua hội viên của client (CL-09) không có gì để mua |

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

**Ba file admin KHÔNG cần dòng riêng** (đã kiểm): `AdminFinanceOverviewTab`, `AdminReconciliationPanel`,
`PTServiceRefunds` là **tab bên trong** `AdminFinancePage.tsx` → đã nằm trong AD-04/AD-06.

**Hệ quả cho kịch bản E2E bắt buộc của Phase 12:** kế hoạch viết *"Admin tạo tài khoản Gym Owner →
Owner đăng nhập lần đầu → bắt buộc đổi mật khẩu"*. Luồng thật bây giờ là **link mời**: admin cấp tài
khoản → hệ thống gửi link (hoặc admin copy link khi email lỗi) → chủ gym mở link đặt mật khẩu (WB-02)
→ nếu tài khoản bị gắn cờ `mustChangePassword` thì qua WB-01 → rồi mới tới wizard thiết lập đối tác
(GY-08). Kiểm Phase 12 phải đi theo thứ tự này, không phải theo câu chữ cũ.

---

## Điều kiện qua cổng (Phase 0.2)

```
TOTAL_EXPECTED = 67   (số màn của bản thiết kế — cổng Phase 0 tính trên đúng tập này)
MAPPED         = 67   (mọi ID đều có dòng, kể cả các dòng "không có 1:1" — đó là câu trả lời đã
                        xác định, không phải ô trống)
WEB_ONLY_EXTRA = 10   (thêm 16/9, không thuộc 67 màn thiết kế. WB-01..04 là BẮT BUỘC vì web là sàn
                        tối thiểu và chúng chặn đường vào của chủ phòng gym / nguồn gói hội viên.
                        WB-05..10 là sáu công cụ quản trị — CHỜ NGÀI QUYẾT có đưa lên mobile không.)
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
