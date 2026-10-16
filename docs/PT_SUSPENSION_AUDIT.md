# Kiểm kê: khi admin hạn chế một PT, hệ thống hiện làm gì (chuẩn bị cho "Phase 2.5A")

Ngày đọc mã: 2026-10-10, nhánh `feature/payment-gateways`, HEAD `2db694d`.

**Nhãn bằng chứng.** Mọi mục trong tài liệu này là `CODE AUDIT`: chỉ đọc mã, không chạy bất cứ thứ gì, không có gì được gắn nhãn "đã kiểm thử". Chỗ nào là suy luận từ mã (ví dụ một cuộc đua có thể xảy ra) thì ghi rõ "suy từ mã" và nó vẫn chỉ là `CODE AUDIT`, chưa được tái hiện. Chỗ nào không đọc tới thì ghi "không kiểm tra".

Quy ước đường dẫn: viết tắt `US` = `backend/services/user-service/src`, `AS` = `backend/services/auth-service/src`, `PS` = `backend/services/payment-service/src`, `GW` = `backend/gateway/src`, `GS` = `backend/services/gym-service/src`, `AI` = `backend/services/ai-service/src`.

Mục tiêu chủ sở hữu đã chốt (chỉ để làm bối cảnh, không triển khai gì ở đây): hạn chế PT không phải bằng chứng lỗi; tạm khoá không chấm dứt hợp đồng, không bồi thường, tạm dừng buổi tập không phạt vắng mặt, đóng băng tiền giữ lại của PT trên hợp đồng đang tranh chấp; khách được chờ hoặc rời đi với hoàn 100% giá trị chưa dùng, không phạt huỷ; cấm vĩnh viễn kết thúc dịch vụ nhưng không tự động bồi thường mọi khách; trách nhiệm tài chính là quyết định riêng, rõ ràng, có kiểm toán của admin; một khiếu nại không tạo nghĩa vụ với khách khác của PT; khoá nhầm phải đảo ngược được mà PT không bị phạt.

---

## 0. Mười phát hiện quan trọng nhất (tóm tắt)

1. `CODE AUDIT` Hôm nay **chỉ có một loại hạn chế PT: "khoá tài khoản"**, và nó luôn là cấm vĩnh viễn trên thực tế. Không có trạng thái "tạm khoá" riêng. Không có "hoàn tác": mở khoá chỉ bật lại đăng nhập và gỡ cờ ẩn, hợp đồng đã huỷ và tiền đã hoàn không được khôi phục (`US/routes/internal.routes.ts:39-50`, ghi chú "Contracts are NOT restored").
2. `CODE AUDIT` Khoá PT **huỷ và hoàn tiền mọi hợp đồng đang mở** bằng lý do `PT_BANNED` (`US/services/pt-deactivation.service.ts:14-19,141`), tức là đi ngược mục tiêu "tạm khoá không chấm dứt hợp đồng".
3. `CODE AUDIT` `PT_BANNED` nằm trong tập lỗi-của-PT của payment-service (`PS/services/contract-money.ts:290-294`), nên khi hợp đồng **có** tỷ lệ giữ lại > 0 thì lệnh khoá **tự động** bồi thường khách từ tiền giữ lại (`PS/services/contract-ledger.service.ts:935-944,1035-1041`). Tỷ lệ hiện luôn bằng 0 (`US/services/pt-holdback-rate.ts:21-23`) nên hôm nay không có đồng nào bị trả thêm.
4. `CODE AUDIT` Lệnh khoá **không bao giờ được thử lại tự động nếu chỉ một vài hợp đồng thất bại**: `deactivatePT` bắt lỗi từng hợp đồng rồi vẫn trả HTTP 200 (`US/services/pt-deactivation.service.ts:71-100`), auth-service coi 200 là thành công và đánh dấu SETTLED (`AS/services/pt-deactivation-relay.service.ts:62-65`). Chỉ có thông báo gửi tới `adminId` (có thể là chuỗi `"SYSTEM"`) (`US/services/pt-deactivation.service.ts:80-89`).
5. `CODE AUDIT` **Lỗi trong tiến trình thử lại ở auth-service**: sweep chạy lại các dòng `FAILED` bằng cách gọi `relayPtActiveStateChange`, hàm này tạo một dòng MỚI và chỉ đánh dấu dòng mới là SETTLED; dòng `FAILED` cũ không bao giờ được đóng (`AS/services/pt-deactivation-relay-sweep.service.ts:34-49`). Dòng DEACTIVATE cũ sẽ được gửi lại mỗi 5 phút mãi mãi, kể cả sau khi admin đã mở khoá (suy từ mã): PT đã được mở khoá có thể bị ẩn và bị huỷ hợp đồng trở lại.
6. `CODE AUDIT` **Lý do khoá không bao giờ đến được user-service**: gateway gửi thân rỗng `{}` (`GW/routes/proxy.routes.ts:615-621`), màn hình mobile cũng không gửi lý do (`frontend/mobile/src/services/api.ts:3932`). Mọi lần khoá đều mang lý do mặc định "Tài khoản huấn luyện viên bị khoá" (`US/services/pt-deactivation.service.ts:62`) và dòng `PtDeactivationCall.reason` là null. Không có bản ghi kiểm toán nào cho việc khoá/mở khoá (xem mục 5.4).
7. `CODE AUDIT` **Không có trạng thái "tạm dừng" nào** ở hợp đồng hay buổi tập. Khoảng 15 chỗ đọc `ContractStatus.ACTIVE` với nghĩa "đang chạy". Hậu quả lớn nhất nếu chỉ giữ hợp đồng ACTIVE mà PT không làm việc: `expireContracts` sẽ chấm dứt với lý do `EXPIRED` (hoàn 0) khi `endDate` qua, và toàn bộ giá trị chưa dùng chia cho PT/gym/nền tảng (`US/repositories/contract.repository.ts:160-166`, `PS/services/contract-money.ts:394-397,418-420`). Mục 4.
8. `CODE AUDIT` "Đóng băng" tiền giữ lại **chưa có chỗ biểu diễn**: số tiền giữ chỉ suy ra từ hậu tố mô tả dòng sổ cái (`PS/services/contract-ledger.service.ts:120-121,128-148`); `WalletStatus.FROZEN` có trong enum (`PS/prisma/schema.prisma:65-69`) nhưng không có mã nào đặt nó, và nếu đặt thì `withWallets` ném lỗi cho MỌI thao tác chạm ví đó (`PS/services/wallet.service.ts:232`), tức chặn luôn hoàn tiền cho khách khác của cùng PT. Mục 6.
9. `CODE AUDIT` Khoá PT **không đụng tới**: buổi `PT_NO_SHOW_REPORTED` (không nằm trong `FUTURE_SESSION_STATUSES`, `US/services/pt-deactivation.service.ts:22-27`, và không có tiến trình nào tự giải quyết nó); dịch vụ cá nhân hoá ở ai-service (cổng kiểm `isApprovedPt` bỏ qua `ptSuspended`, `US/routes/internal.routes.ts:97-113`); thoả thuận PT-Gym (gym-service không hề tham chiếu `ptSuspended`); yêu cầu rút tiền đang chờ.
10. `CODE AUDIT` Quyền admin chỉ có **một cấp** (`role === "ADMIN"`, `US/routes/admin.routes.ts:9-11`, `GW/routes/proxy.routes.ts:610-612`): bất kỳ admin nào cũng khoá được PT, duyệt và đánh dấu đã chi mọi lệnh rút tiền. Không có "hai người duyệt".

Các bước Phase 2.5A đề xuất nằm ở mục 9, các quyết định sản phẩm còn thiếu ở mục 10.

---

## 1. Mọi cách admin (hoặc hệ thống) hạn chế một PT hôm nay

### 1.1 Trạng thái và nơi lưu

| Trạng thái | Nơi lưu | Ai ghi | Ý nghĩa thực tế |
|---|---|---|---|
| `User.isActive` (bool) | auth-service, `backend/services/auth-service/prisma/schema.prisma:33` | `authService.setUserActive` (`AS/services/auth.service.ts:435-466`) | Chặn đăng nhập (`:400`), chặn làm mới phiên (`:482`), chặn `/auth/verify` (`:531`) |
| `UserProfile.ptSuspended` (bool) | user-service, `backend/services/user-service/prisma/schema.prisma:70` | `ptDeactivationService.setPtSuspended` (`US/services/pt-deactivation.service.ts:191-197`) | Ẩn khỏi tìm kiếm, chặn tạo hợp đồng mới, chặn đặt/xác nhận buổi |
| `UserProfile.isPT` + vai trò auth `PT` | user-service + auth-service | `profileService.adminSetPTStatus` (`US/services/profile.service.ts:210-216`) | Danh tính PT; xem 1.3 (hạ vai trò) |
| `PTApplication.status` (DRAFT, SUBMITTED, UNDER_REVIEW, NEEDS_MORE_INFO, APPROVED, REJECTED) | user-service, `schema.prisma:210-217` | `ptApplicationService.adminReviewAction` (`US/services/pt_application.service.ts:337-430`) | Hồ sơ duyệt; xem 1.3 |
| `UserProfile.isAcceptingClients` + `notAcceptingReason` | user-service | chính PT (`US/controllers/profile.controller.ts:425-445`) | PT tự đóng nhận khách mới; không phải hạn chế của admin |
| `PtDeactivationCall` (PENDING / SETTLED / FAILED) | auth-service, `schema.prisma:166-...` | `AS/services/pt-deactivation-relay.service.ts` | Hộp thư thử-lại cho lời gọi sang user-service, không phải trạng thái nghiệp vụ |

Không có enum, bảng hay cột nào mô tả "loại hạn chế" (tạm / vĩnh viễn), người ra quyết định, lý do, thời hạn hay ngày gỡ.

### 1.2 Các đường để hạn chế

1. **Khoá tài khoản** (đường chính). Chuỗi gọi:
   - Mobile admin: `frontend/mobile/app/admin/users.tsx:85-110` gọi `adminService.setUserActive` (`frontend/mobile/src/services/api.ts:3929-3934`), xác nhận bằng `lockConsequences` (`frontend/mobile/src/features/admin/adminUsers.ts:79-93`).
   - Gateway: `PATCH /admin/users/:userId/disable|enable`, `authMiddleware` + `requireRoles("ADMIN")`, chuyển tiếp sang auth-service với thân `{}` (`GW/routes/proxy.routes.ts:607-642`). Có thêm proxy chung `/auth/users` cho ADMIN (`GW/routes/proxy.routes.ts:688-697`) chuyển tiếp nguyên thân, nhưng không giao diện nào dùng.
   - auth-service: `PATCH /auth/users/:userId/disable|enable` (`AS/routes/auth.routes.ts:30-31`) → `authController.setUserActive` tự kiểm Bearer và vai trò ADMIN (`AS/controllers/auth.controller.ts:482-517`) → `authService.setUserActive`: ghi `isActive` trước (`AS/services/auth.service.ts:441-444`), rồi nếu vai trò là PT thì relay (`:445-458`).
   - Có thêm cổng nội bộ `POST /auth/internal/partner-auth/set-active` bằng service-secret (`AS/controllers/auth.controller.ts:592-599`) dùng cùng `setUserActive`; actor mặc định `"SYSTEM"`. Người gọi không được đọc trong lần kiểm kê này.
   - Relay: tạo dòng `PtDeactivationCall` PENDING rồi `POST {USER_SERVICE_URL}/internal/pt/:id/deactivate|reactivate` (timeout 15 giây) (`AS/services/pt-deactivation-relay.service.ts:35-43,55-76`).
   - user-service: `POST /internal/pt/:ptUserId/deactivate` (`US/routes/internal.routes.ts:23-37`) và `/reactivate` (`:39-50`).
   - Chủ sở hữu từng phần: auth-service giữ `isActive` và hộp thư thử-lại; user-service giữ `ptSuspended`, hợp đồng, buổi tập, thông báo; payment-service giữ tiền; gateway chỉ định tuyến và kiểm vai trò.
2. **Chấm dứt từng hợp đồng bằng tay** `POST /contracts/:id/terminate` với `reason=PT_BANNED` (chỉ admin: `US/controllers/contract.controller.ts:598-668`, bản đồ quyền ở `:612-625`). Chỉ xử lý một hợp đồng, không đụng tài khoản PT. Có ghi `AuditLog` (`:653-664`).
3. **Hạ vai trò PT** `PATCH /profile/admin/users/:userId/pt-status` (`US/routes/profile.routes.ts:102-106` → `US/controllers/profile.controller.ts:333-355` → `US/services/profile.service.ts:210-216`): đổi vai trò auth thành CUSTOMER (qua `/auth/internal/users/:id/role`) và `isPT=false`. **Không** huỷ hợp đồng, không hoàn tiền, không đặt `ptSuspended`. Không màn hình nào gọi (`setPTStatus` chỉ được định nghĩa ở `frontend/web/src/app/services/api.ts:3894-3899` và `frontend/mobile/src/services/api.ts:4105-4110`; không có nơi dùng). Cạm bẫy suy từ mã: `POST /withdrawals` chọn ví theo vai trò hiện tại (`PS/routes/wallet.routes.ts:82`), nên một PT bị hạ vai trò mà còn tiền trong ví PT sẽ không với tới ví đó nữa.
4. **Từ chối hồ sơ đã duyệt** `POST /pt-applications/admin/:id/review/REJECT` (`US/routes/pt_application.routes.ts:132-137`): `adminReviewAction` không kiểm trạng thái hiện tại và nhánh REJECTED chỉ ghi trạng thái, không đặt lại `isPT`, không đổi vai trò, không đụng hợp đồng (`US/services/pt_application.service.ts:365-368,431`). Nghĩa là một PT đã duyệt bị "từ chối" vẫn hoạt động bình thường.
5. **PT tự đóng nhận khách mới** (`isAcceptingClients=false`): chặn `requestContract` với thông báo "PT hiện đang tạm ngưng nhận khách mới" (`US/services/contract.service.ts:419-420`). Không áp dụng cho khách đang có hợp đồng.
6. Không có hạn chế tự động nào (không có "ba lần vi phạm thì khoá", không có tiến trình quét tài khoản). Quyền chấm dứt `PT_REPEATED_NO_SHOW` là quyền của khách chứ không phải hạn chế PT (`US/controllers/contract.controller.ts:619-639`).
7. gym-service có "tạm khoá đối tác" (`GymPartner.status = SUSPENDED`, `GS/services/partner.service.ts:405-426`) nhưng là của chủ gym, không áp cho PT. Đáng chú ý như một **tiền lệ trong repo**: có `suspendedAt/suspendedReason/suspendedBy`, `PartnerAuditLog` (`backend/services/gym-service/prisma/schema.prisma:524`) và chốt `assertAcceptsNewMoney` (`GS/services/partner-guard.service.ts:25-35`).

### 1.3 Có phân biệt tạm khoá và cấm vĩnh viễn không? Có hoàn tác không?

`CODE AUDIT` Không phân biệt. Hai cờ bool không có thời hạn, không có lý do, không có người thực hiện. "Hoàn tác" = `PATCH .../enable`: auth đặt `isActive=true`, relay gọi `/reactivate` chỉ gỡ `ptSuspended` (`US/routes/internal.routes.ts:39-50`). Hợp đồng đã `CANCELLED`/`terminationReason=PT_BANNED`, buổi tập đã `CANCELLED`, tiền đã hoàn: không khôi phục. Giao diện admin trên mobile nói thẳng điều này (`frontend/mobile/src/features/admin/adminUsers.ts:79-93`). Trên web, nút "Suspend account" chỉ là hình, không có `onClick` (`frontend/web/src/app/pages/admin/UserManagement.tsx:311-314`).

---

## 2. Chuỗi hệ quả từng bước khi khoá một PT

### 2.1 Thứ tự

1. `CODE AUDIT` auth-service ghi `isActive=false` (`AS/services/auth.service.ts:441-444`). Từ lúc này mọi lời gọi qua gateway của PT thất bại, vì `authMiddleware` hỏi `/auth/verify` cho **mỗi** yêu cầu (`GW/middleware/auth.middleware.ts:33-45`) và `verifyToken` ném 403 khi `isActive=false` (`AS/services/auth.service.ts:531-533`); gateway gom mọi lỗi verify thành 401. Đăng nhập (`:400`) và làm mới phiên (`:482`) cũng bị chặn. Ngoại lệ: kết nối WebSocket đã mở chỉ được kiểm lúc bắt tay (`GW/socket/socketAuth.ts:45-52`); không thấy mã nào ngắt kết nối khi khoá (không kiểm tra thêm).
2. `CODE AUDIT` Relay tạo dòng `PtDeactivationCall` rồi gọi user-service. Nếu HTTP lỗi (kể cả timeout 15 giây): dòng thành FAILED, lỗi bị nuốt, việc khoá tài khoản vẫn thành công (`AS/services/pt-deactivation-relay.service.ts:62-75`).
3. `CODE AUDIT` user-service `deactivatePT` (`US/services/pt-deactivation.service.ts:59-106`):
   - đặt `ptSuspended=true` trước (`:66`), để không khách nào đặt thêm trong lúc gỡ;
   - lấy "hợp đồng chặn" = PENDING_REVIEW, PENDING_SIGNATURE, PENDING_PAYMENT, ACTIVE (`:14-19,41-46`);
   - gỡ từng hợp đồng độc lập; lỗi một hợp đồng chỉ ghi nhận SKIPPED và gửi thông báo `REFUND_NEEDS_MANUAL_SETTLEMENT` cho `adminId` (`:71-100`, thông báo ở `:80-89`).
4. `CODE AUDIT` `unwindContract` (`US/services/pt-deactivation.service.ts:108-188`), trên từng hợp đồng:
   - (a) Huỷ buổi: một `prisma.session.updateMany` đặt `CANCELLED`, `cancelledBy="SYSTEM"`, `cancellationReason=reason` cho các buổi ở trạng thái REQUESTED, CONFIRMED, PENDING_CLIENT_CONFIRMATION, DISPUTED (`:120-127`, tập trạng thái ở `:22-27`). Không có điều kiện trạng thái tại thời điểm ghi (không CAS), không ghi `AuditLog`, không thông báo từng buổi, không đóng phòng online (`closeRoomOf` không được gọi).
   - (b) Tiền: `terminateContractMoney(contract.id, "PT_BANNED")` (`:141`). Hàm này (`US/services/contract-payout.service.ts:221-278`) chỉ gọi payment-service khi hợp đồng "có thể thanh toán" (có `paymentTransactionId`, có giá, có số buổi: `:59-64`), với khoá idempotency `CONTRACT_TERMINATE:<contractId>` (`:244-270`). Sau đó luôn ghi `status=CANCELLED`, `terminationReason=PT_BANNED`, `terminatedAt` bằng một `prisma.contract.update` không có điều kiện trạng thái (`:273-276`; `statusFor` ở `:9-13`).
   - (c) Hợp đồng chưa trả tiền (kết quả `null`): cập nhật lại `CANCELLED`, `cancelledBy="SYSTEM"` và thông báo "Không có khoản hoàn tiền (chưa ghi nhận thanh toán)" (`:143-164`). Hợp đồng đã trả: điền `cancelledBy/cancellationReason` (`:169`) và thông báo `CONTRACT_CANCELLED_PT_DEACTIVATED` kèm số tiền hoàn và số buổi chưa dùng (`:171-178`, `notifyClient` ở `:199-210`).

### 2.2 Hợp đồng theo từng trạng thái

| Trạng thái khi khoá | Hậu quả | Tiền |
|---|---|---|
| `PENDING_REVIEW` | `CANCELLED`, `terminationReason=PT_BANNED`, `cancelledBy=SYSTEM` | Không có tiền để chuyển |
| `PENDING_SIGNATURE` | Như trên. Không thấy lời gọi nào huỷ yêu cầu ký điện tử ở Dropbox trong `pt-deactivation.service.ts`; webhook ký xong bị bỏ qua vì trạng thái khác `PENDING_SIGNATURE` (`US/services/dropboxSignWebhook.service.ts:88-89`) | Không có |
| `PENDING_PAYMENT` | Như trên. Nếu lúc đó khách đang ở trang cổng thanh toán: cổng báo thành công → payment-service chuyển tiền vào ký quỹ **trước**, gọi kích hoạt, nhận 409 `CONTRACT_NOT_ACTIVATABLE` → hoàn đủ vào ví khách (`PS/services/reconciliation.service.ts:166-196`, `US/services/contract.service.ts:1538-1575`) | Hoàn đủ nếu đã trả |
| `ACTIVE` | Huỷ buổi chưa giao; `terminate` với `PT_BANNED`: hoàn 100% giá trị buổi chưa dùng, chia lại phần đã giao cho ba bên (mục 3) | Có |
| `COMPLETED`, `EXPIRED`, `CANCELLED`, `REJECTED` | Không đụng | Không |

### 2.3 Các thứ khác

- **Thông báo.** Khách: một thông báo theo hợp đồng (`CONTRACT_CANCELLED_PT_DEACTIVATED`). Admin: chỉ khi một hợp đồng thất bại (`REFUND_NEEDS_MANUAL_SETTLEMENT`, tới `adminId`; với cổng nội bộ `adminId` mặc định `"SYSTEM"`: `US/routes/internal.routes.ts:28`, `AS/controllers/auth.controller.ts:598`). **Không** thông báo cho PT, cho gym, hay cho từng buổi bị huỷ.
- **Chat và cuộc gọi.** `computeChatEligibility` trả `INACTIVE_USER` nếu một bên có `isActive=false` (`US/services/contract.service.ts:1388-1405`, `isUserActive` ở `:352-365`); `checkRelationship` cho cuộc gọi cũng vậy (`:1350-1358`). Hàm `isUserActive` **mở cửa khi auth-service lỗi** (trả `true`, `:363`). Chat-service dùng hai hàm này (`backend/services/chat-service/src/services/chat.policy.ts`, `call.policy.ts:30`). Việc khách có còn đọc được lịch sử chat không: không kiểm tra.
- **Đăng nhập và ví của chính PT.** Đăng nhập, làm mới, mọi API qua gateway (kể cả `/pt-wallet`, `POST /withdrawals`) đều thất bại. payment-service không có khái niệm tài khoản PT bị khoá (ví vẫn `ACTIVE`), nên mọi thao tác nội bộ vẫn chạy.
- **Yêu cầu rút tiền đang chờ.** Không ai đụng tới. `requestWithdrawal`, `approve`, `reject`, `markPaid` (`PS/services/withdrawal.service.ts:87,175,199,236`) không kiểm trạng thái PT. Yêu cầu PENDING/APPROVED của PT bị khoá vẫn nằm trong hàng đợi admin và admin vẫn duyệt/chi được; màn hình `frontend/web/src/app/pages/admin/AdminWithdrawals.tsx` chỉ hiện `ownerType`, không hiện tài khoản bị khoá.
- **Thoả thuận gym.** gym-service không có tham chiếu nào tới `ptSuspended` hay khoá PT (tìm không thấy trong `backend/services/gym-service/src`). `GymBrandPtAgreement` (`schema.prisma:1235-1271`), `GymPtCollaboration` cũ và `GymTrainerAffiliation` giữ nguyên; gym chủ không được báo. Phần của gym trên các hợp đồng được chốt qua `terminate` (entitlement của gym trên phần đã giao).
- **Tìm kiếm và bộ chọn.** Loại khỏi danh sách PT (`US/repositories/profile.repository.ts:144-151`, nhắc ở chú thích `:138-143`) và bộ ghép của AI (`US/services/agentic-fitness.service.ts:57`); chặn `requestContract` (`US/services/contract.service.ts:417-418`), `bookSession` (`US/services/booking.service.ts:231-234`), `confirmSession` (`:421-424`). **Không** lọc: chi tiết PT theo id vẫn trả hồ sơ kèm `ptSuspended` (`US/controllers/profile.controller.ts:280-306`; mobile dùng cờ này ở `frontend/mobile/app/client/services/pt/[id].tsx:251`); gói dịch vụ của PT (`US/routes/profile.routes.ts:110`); và **marketplace dịch vụ cá nhân hoá ở ai-service**: `GET /internal/pt-marketplace-eligibility` tính `isApprovedPt = isPT && application APPROVED`, bỏ qua `ptSuspended` (`US/routes/internal.routes.ts:97-113`), và ai-service chỉ dựa vào đó (`AI/services/personalized-service.service.ts:60-72,243-250`). Nghĩa là PT bị khoá vẫn bán được dịch vụ cá nhân hoá; các đơn dịch vụ cá nhân hoá đang chạy cũng không được gỡ và người bán không đăng nhập được để giao (nhắc thêm: tiền loại này vào AVAILABLE của người bán ngay, không qua ký quỹ, theo ghi chú ở `frontend/web/src/app/pages/admin/PTServiceRefunds.tsx:7-16`).
- **Truy cập huấn luyện/giáo án.** `findActivePtClientPair` chỉ chấp nhận hợp đồng `ACTIVE` (`US/repositories/contract.repository.ts:66-71`) → `US/routes/internal.routes.ts:76-79` → fitness-service (`backend/services/fitness-service/src/clients/user.client.ts:315`). Khi hợp đồng bị huỷ, PT mất quyền ghi dữ liệu của khách ngay lần kiểm kế tiếp. Giáo án đã giao: không có mã nào đụng tới.
- **Mở khoá.** Chỉ `isActive=true` và `ptSuspended=false`. Không khôi phục gì.

---

## 3. Khách nhận gì khi PT bị khoá; bồi thường sẽ là bao nhiêu nếu có tỷ lệ giữ lại

### 3.1 Công thức hoàn tiền hôm nay

`CODE AUDIT` Với `PT_BANNED`: `refund = ceil(price × (N − u − c) / N)` làm tròn LÊN theo hướng có lợi cho khách (`PS/services/contract-money.ts:154-159,386-392,405,235-237`), trong đó N = `totalSessions`, u = `usedSessions`, c = `compensatedSessions`. Không có phí (so với `CLIENT_CANCELLED` chỉ hoàn 90%: `:382-385`, `:87`). Phần còn lại `withheld = price − compensationValue − refund` chia ba bên theo bảng tỷ lệ chốt trên hợp đồng (`:418-420`); chia dư xuống làm tròn xuống (`:220-221`).

Đích đến: `credit(clientWallet, refund, "<label> — refund (PT_BANNED)")` vào ngăn **AVAILABLE** của ví khách; ký quỹ không động (`PS/services/contract-ledger.service.ts:1024-1028`). Tiền có mặt ngay trong ví in-app. Rút ra tiền mặt: dòng này khớp từ khoá "refund" nên được tính là "tiền hoàn có thể rút" (`PS/repositories/withdrawal.repository.ts:95-109`); khách gửi `POST /withdrawals` (`PS/routes/wallet.routes.ts:81-96`), tối thiểu 10.000đ (`PS/services/withdrawal.service.ts:25-31`), rồi **admin duyệt và đánh dấu đã chi thủ công** (`:175,236`). Khách có dùng được số dư ví để thanh toán thứ khác không: không kiểm tra.

### 3.2 Với tỷ lệ giữ lại = 0 thì không trả đồng nào thêm

`CODE AUDIT` Xác nhận bằng chuỗi sau:
1. `resolvePtHoldbackRate()` luôn trả `"0"` (`US/services/pt-holdback-rate.ts:21-23`); nó được chụp vào hợp đồng lúc tạo (`US/services/contract.service.ts:512`), nên mọi hợp đồng hiện hữu có `ptHoldbackRate=0` (cột mặc định 0, `schema.prisma:639`).
2. `holdbackArgOf` bỏ hẳn khoá `ptHoldbackRate` khỏi lời gọi khi tỷ lệ = 0 (`US/services/contract-payout.service.ts:42-46`), nên `terminate` gửi sang payment-service không có tham số này.
3. `holdbackCompensationTarget`: nếu không có tỷ lệ hoặc tỷ lệ bằng 0 thì trả `ZERO` (`PS/services/contract-money.ts:327-335`).
4. `terminateContract`: `holdbackPot = holdbackTarget(price, undefined) = 0`, nên `holding=false`, `compensation` giữ `ZERO` (`PS/services/contract-ledger.service.ts:918,935-944`) và dòng "compensation for the PT's removal" không được ghi (`:1035-1041`).
Kết luận: hôm nay lệnh khoá chỉ hoàn giá trị buổi chưa dùng; không bồi thường thêm.

### 3.3 Nếu hợp đồng có tỷ lệ giữ lại h > 0: sẽ trả chính xác bao nhiêu

Công thức (`PS/services/contract-ledger.service.ts:862-884` (chú thích), `:935-944`): `compensation = min(ptFaultCompensationTarget, held, ptStillToBePaid)`, với
- `ptFaultCompensationTarget = ceil(h × remaining)` cho `PT_BANNED` (`PS/services/contract-money.ts:310-335`; `PT_CANCELLED` giống; `PT_REPEATED_NO_SHOW` cộng thêm giá trị các buổi đã bồi thường),
- `held = ptHeld(...)` = (Σ dòng PENDING "— PT holdback retained") − (Σ dòng PENDING "— PT holdback released (no activity)"), kẹp bởi pending thật của hợp đồng (`:128-148`),
- `ptStillToBePaid = max(entitlement.pt − alreadyReleased.pt, 0)`.
Số này **chỉ lấy ra từ tiền giữ lại của PT**, không bao giờ từ AVAILABLE của PT, không do nền tảng ứng, không ghi nợ (`:868-879`). Nó nằm ngoài `refund`, `withheld`, `entitlement`.

Ví dụ tính tay (chưa chạy): giá 5.000.000đ, N=10, nền tảng 10% / PT 90% / gym 0%, h=0,10 → H = 500.000. PT đã giao u=3 buổi: mỗi buổi phần PT 450.000; đã giải phóng 850.000, đang giữ 500.000. Lệnh khoá: `remaining = 3.500.000`, `refund = 3.500.000`; `target = ceil(0,10 × 3.500.000) = 350.000`; `withheld = 1.500.000` → `entitlement.pt = 1.350.000`; `ptStillToBePaid = 1.350.000 − 850.000 = 500.000`; `held = 500.000`; `compensation = min(350.000, 500.000, 500.000) = 350.000`. Khách nhận 3.500.000 + 350.000 = **3.850.000đ** (hai dòng riêng); PT nhận phần giữ còn lại 150.000 (qua `settleParty` với `reserve=350.000`, `:955-998,1000-1003`); không dòng nào chạm AVAILABLE của PT.

Ghi chú: ngăn xếp tương tự áp cho `PT_CANCELLED` (PT tự huỷ) và `PT_REPEATED_NO_SHOW` (khách tự chấm dứt sau 3 lần PT vắng); chúng dùng chung `terminateContract` và `PT_FAULT_REASONS` (`PS/services/contract-money.ts:290-294`).

---

## 4. Trạng thái hợp đồng và buổi tập; có gì giống "tạm dừng" không

### 4.1 Các trạng thái hiện có

- `ContractStatus`: PENDING_REVIEW, PENDING_SIGNATURE, PENDING_PAYMENT, ACTIVE, COMPLETED, EXPIRED, CANCELLED, REJECTED (`schema.prisma:352-361`). `TerminationReason`: CLIENT_CANCELLED, PT_BANNED, PT_CANCELLED, MUTUAL, EXPIRED, COMPLETED, PT_REPEATED_NO_SHOW (`:379-387`).
- `SessionStatus`: REQUESTED, CONFIRMED, PENDING_CLIENT_CONFIRMATION, DISPUTED, PT_NO_SHOW_REPORTED, COMPLETED, CANCELLED, NO_SHOW (`:394-411`). `SessionDisputeType`: DELIVERY_DISPUTE, PT_NO_SHOW_CLAIM, CLIENT_NO_SHOW_CLAIM (`:416-426`). `RescheduleStatus`: PENDING, ACCEPTED, REJECTED, EXPIRED, CANCELLED (`:537-543`).
- **Không có** trạng thái tạm dừng ở hợp đồng hay buổi tập. Thứ gần nhất: `ptSuspended` (cờ ở PT, không phải ở hợp đồng) chỉ chặn đặt/xác nhận buổi mới; ma trận buổi tập có hàng `FORCE_MAJEURE` (huỷ, giữ nguyên quota, không phạt ai: `US/services/session-outcome.ts:44-49`) nhưng không có chỗ nào dùng nó cho hạn chế PT.

### 4.2 Mọi nơi coi `ACTIVE` là "đang chạy" (cái gì hỏng nếu hợp đồng bị tạm dừng)

| # | Nơi đọc | Điều nó giả định | Hỏng gì nếu thêm trạng thái / nếu PT bị tạm dừng mà hợp đồng vẫn ACTIVE |
|---|---|---|---|
| 1 | Quét hết hạn: `contractRepository.findExpiredContracts` (`US/repositories/contract.repository.ts:160-166`) → `contractService.expireContracts` (`US/services/contract.service.ts:1216-1232`) → `terminateContractMoney(..., "EXPIRED")`; bộ hẹn giờ `US/services/contract-expiry-sweep.service.ts:30-50` (10 phút) | ACTIVE và `endDate < now` thì hết hạn | **Nguy hiểm nhất.** `EXPIRED` hoàn 0 và chia TOÀN BỘ giá trị chưa dùng cho PT/gym/nền tảng (`PS/services/contract-money.ts:394-397,418-420`). Thời gian tạm dừng phải kéo dài `endDate` hoặc quét phải bỏ qua. `endDate` được đặt từ `validityDays` đúng lúc kích hoạt (`US/repositories/contract.repository.ts:395-412`) |
| 2 | Quét giải phóng tiền giữ khi nhàn rỗi: `findIdleHoldbackCandidates` (`US/repositories/contract.repository.ts:237-276`), `releaseIdleHoldbacks` (`US/services/contract.service.ts:1315-1347`), `runContractHoldbackSweep` (`US/services/contract-expiry-sweep.service.ts:59-80`, mỗi giờ) | ACTIVE, không buổi nào đáng kể trong 30 ngày | PT tạm dừng không có buổi nào → đồng hồ chạy → tiền giữ được trả cho PT (`PS/services/contract-ledger.service.ts:1112-1147`). Trạng thái buổi "tạm dừng" mới phải được thêm vào danh sách "giữ quyền lợi"; hoặc quét bỏ qua PT đang bị hạn chế. (Thay đổi `cancelledBy` trong Job 1 của phiên này không liên quan: buổi bị hệ thống huỷ vì tạm khoá không phải do PT huỷ nên không tính là hoạt động) |
| 3 | Đặt buổi: `bookSession` (`US/services/booking.service.ts:231-237`) | ACTIVE + PT không `ptSuspended` | Trạng thái mới phải được chặn ở đây (đã chặn bởi `ptSuspended`) |
| 4 | PT xác nhận buổi: `confirmSession` (`:394-423`, kiểm lại trong khoá lịch) | như trên | như trên |
| 5 | Tự xác nhận buổi chờ khách: `runAutoConfirm` (`US/services/session-autoconfirm.service.ts:60-97`), truy vấn `findExpiredPendingConfirmation` (`US/repositories/session.repository.ts:141-149`) | Không kiểm trạng thái hợp đồng hay PT | Buổi PENDING_CLIENT_CONFIRMATION vẫn tự xác nhận sau hạn, `deductQuotaOnce` trả tiền cho PT (`US/services/booking.service.ts:112-123`). Có thể muốn hoặc không muốn khi PT bị tạm khoá: quyết định sản phẩm |
| 6 | Quét tái thử thanh toán buổi: `runSettlementSweep` (`US/services/session-settlement-sweep.service.ts:47-95`) | Không kiểm trạng thái hợp đồng | Vẫn chạy cho hợp đồng bất kỳ |
| 7 | Hết hạn đề nghị dời lịch: `US/services/reschedule-expiry.service.ts:34-60` | Chỉ theo `originalStartAt` | Không ảnh hưởng hợp đồng, nhưng đề nghị dời lịch của PT tạm khoá sẽ hết hạn |
| 8 | Xử lý đóng phòng online: `US/services/room-close-resolution.service.ts:22-35,134,155-170` | Buổi ONLINE CONFIRMED qua giờ | **Phạt vắng mặt tự động**: PT không vào phòng, khách vào → `NO_SHOW`, `ptAtFault=true`, bồi thường tiền (`:155-170`); điều này cộng vào ngưỡng 3 lần `PT_REPEATED_NO_SHOW`. Không kiểm tra PT đang bị hạn chế |
| 9 | Báo PT vắng: `reportPtNoShow` (`US/services/booking.service.ts:943-980`), `respondToNoShowReport` (`:982-...`), `markNoShow` (`:828`) | Chỉ kiểm trạng thái buổi và thời gian chờ | Không kiểm hợp đồng hay PT bị hạn chế; khách có thể báo PT vắng khi PT bị tạm khoá. `PT_NO_SHOW_REPORTED` không có tiến trình hết hạn nào (chỉ `PENDING_CLIENT_CONFIRMATION` có), và `resolveDispute` chỉ nhận `DISPUTED` (`:623-625`) |
| 10 | Quy tắc một hợp đồng đang chạy/chờ cho mỗi cặp PT–khách: `contractRepository.findActiveByPair` (`US/repositories/contract.repository.ts:88-101`) dùng ở `US/services/contract.service.ts:484` | PENDING_REVIEW, PENDING_SIGNATURE, ACTIVE | Chỉ ở tầng ứng dụng, **không có ràng buộc duy nhất trong DB**; `PENDING_PAYMENT` không nằm trong danh sách (lỗ hổng sẵn có). Trạng thái "tạm dừng" mới phải được thêm vào, nếu không khách mở được hợp đồng thứ hai với cùng PT |
| 11 | Chat: `findRelationshipByPair` (ACTIVE, PENDING_SIGNATURE, COMPLETED: `US/repositories/contract.repository.ts:114-130`) → `computeChatEligibility` (`US/services/contract.service.ts:1377-...`) | Có quan hệ hợp đồng + cả hai `isActive` | Trạng thái mới phải thêm vào danh sách; hôm nay chat của PT bị khoá chặn bởi `isActive`, không phải bởi hợp đồng |
| 12 | Giáo án/coach: `findActivePtClientPair` (`:66-71`) → `checkActivePtClientRelationship` (`US/services/contract.service.ts:1366-1369`) → fitness-service (`fitness-service/src/clients/user.client.ts:315`) | ACTIVE, đọc mỗi yêu cầu | Trạng thái mới → mất quyền ngay |
| 13 | AI coach gắn hợp đồng: `US/controllers/contract.controller.ts:289-298` (ACTIVE theo khách) | ACTIVE | như trên |
| 14 | Hoàn tất tự nhiên: `checkAndCompleteContract` (`US/services/contract.service.ts:842-...`, `:847`) | Chỉ khi ACTIVE | Hợp đồng đang tạm dừng sẽ không tự hoàn tất |
| 15 | Phản hồi PT: `sendFeedback` (`:971-980`); thu nhập PT `getEarnings` (`:1428-1429`); xem InBody của khách `getClientHistory` dùng ACTIVE hoặc COMPLETED (`US/services/inbody.service.ts:56`); đếm ACTIVE ở thống kê admin `countActive` (`US/repositories/contract.repository.ts:337`) | ACTIVE | hiển thị/thao tác |
| 16 | Kích hoạt sau thanh toán `activateIfPendingGuarded` (`:395-412`) và huỷ do quá hạn trả `cancelIfPaymentOverdue`; huỷ tay `cancelContract` (`US/services/contract.service.ts:770-830`) | Chỉ PENDING_PAYMENT/PENDING_REVIEW | `cancelContract` từ chối ACTIVE ("use terminate") nên một khách muốn rời khỏi hợp đồng đang tạm dừng phải đi qua `terminate` |

Hai điểm bổ sung: (i) các kiểu trạng thái được lặp ở frontend (`frontend/web/src/app/types/index.ts`, `frontend/mobile/src/types/index.ts`), một giá trị enum mới sẽ phải xử lý ở cả hai; (ii) enum Prisma của user-service chưa hoàn toàn đồng bộ với migration (ghi chú dự án: "user-service migration drift"), nên mọi migration enum mới cần thử trên cơ sở dữ liệu `*_test` dựng bằng `migrate deploy` trước.

---

## 5. Cơ chế tranh chấp/khiếu nại có thể tái dùng

### 5.1 Tranh chấp cấp buổi tập (user-service)

`CODE AUDIT`
- Trạng thái `DISPUTED` (khách phản đối PT báo đã giao: `disputeSession`, `US/services/booking.service.ts:555-...`), `PT_NO_SHOW_REPORTED` (khách báo PT vắng: `:943`), kiểu `SessionDisputeType` (`schema.prisma:416-426`) chỉ để phân loại và kiểm toán.
- Admin giải quyết: `GET /admin/sessions/disputed`, `POST /admin/sessions/:id/resolve` (`US/routes/admin.routes.ts:13-14`) → `resolveDispute` với ba kết quả COMPLETED, CANCELLED, PT_NO_SHOW_CONFIRMED (`US/services/booking.service.ts:610-693`), chỉ nhận buổi `DISPUTED` (`:623-625`), ghi `resolvedBy/resolutionNote/resolvedAt`. Thông báo `SESSION_DISPUTE_RESOLVED`.
- Màn hình: web `frontend/web/src/app/pages/admin/AdminDisputes.tsx`, mobile `frontend/mobile/app/admin/resolve.tsx`.
- Giới hạn: đối tượng là **một buổi**, không có thực thể "vụ việc về PT" gom nhiều khách/hợp đồng; không có đường để khiếu nại về PT ngoài buổi tập.

### 5.2 Khiếu nại gym (gym-service)

`GymComplaint` có `source` (SELF_DETECTED, MEMBER_REPORT, PT_REPORT, PARTNER_DISCLOSED), `issueType`, `status` (OPEN, IN_PROGRESS, RESOLVED), `assignedAdminId`, `adminResponse`, `resolvedBy` (`backend/services/gym-service/prisma/schema.prisma:261-324`); admin route `/admin/complaints` (`GW/routes/proxy.routes.ts:1785-1790`), màn hình `frontend/web/src/app/pages/admin/AdminComplaintsPage.tsx`. Bắt buộc `gymId`; `PT_REPORT` là PT báo về gym. Không có đối tượng "PT" làm đích. Thiết kế cố ý không liên kết tự động sang hoàn tiền (chú thích `:284-289`). Tái dùng được **mẫu** (OPEN/IN_PROGRESS/RESOLVED, người được giao, phản hồi cuối) nhưng không dùng nguyên bảng.

### 5.3 Hàng đợi và màn hình admin hiện có

Hồ sơ PT chờ duyệt (`frontend/web/src/app/pages/admin/PTManagement.tsx`, `frontend/mobile/app/admin/pt-applications/`), tranh chấp buổi (trên), rút tiền (`AdminWithdrawals.tsx`, `frontend/mobile/app/admin/withdrawals.tsx`), hoàn tiền dịch vụ cá nhân hoá (`PTServiceRefunds.tsx`), đối soát (`AdminReconciliationPanel.tsx`), danh bạ người dùng (mobile `app/admin/users.tsx`; web `UserManagement.tsx` chỉ xem).

### 5.4 Bảng kiểm toán

- user-service `AuditLog` (`schema.prisma:1083-1101`), `AuditEntityType` = CONTRACT, SESSION, SERVICE_PACKAGE, PT_PROFILE (`:1076-1081`). Có `PT_PROFILE` nhưng hiện chỉ ghi bật/tắt nhận khách (`US/controllers/profile.controller.ts:436-445`). Khoá PT **không** ghi dòng nào; hợp đồng bị khoá cũng không có `CONTRACT_TERMINATED` (chỉ `terminate` bằng tay mới ghi: `US/controllers/contract.controller.ts:653-664`).
- auth-service `AuditLog` (`schema.prisma:131-144`) ghi đăng nhập, đặt lại mật khẩu...; `setUserActive` không ghi gì (tìm không thấy lời gọi `createAuditLog` trong đường này, chỉ có ở `AS/controllers/auth.controller.ts:102,191,217,247,316,633`).
- `PtDeactivationCall` (adminId, reason, status) là dấu vết duy nhất, nhưng `reason` luôn null (mục 0.6).
- Dấu vết tiền: `WalletLedgerEntry` và `LedgerOperation` (khoá idempotency) ở payment-service.
- Tiền lệ tốt trong repo: `PartnerAuditLog` ở gym-service.

### 5.5 Phân quyền admin

`CODE AUDIT` Chỉ có một cấp. Enum `Role` = CUSTOMER, PT, ADMIN, GYM_OWNER (`AS` schema `:19-24`). Mọi cổng admin kiểm `role === "ADMIN"`: gateway `requireRoles("ADMIN")` (`GW/routes/proxy.routes.ts:610-612`), user-service `roleMiddleware(["ADMIN"])` (`US/routes/admin.routes.ts:9-11`, `US/routes/pt_application.routes.ts:120-137`). Không có quyền mịn hơn, không có "người duyệt thứ hai". `assignedAdminId` ở gym-service thuần hiển thị. Hệ quả: người khoá PT, người duyệt rút tiền và người đánh dấu đã chi có thể là cùng một admin.

### 5.6 Loại thông báo đã có sẵn trong enum (`schema.prisma:444-509`)

Phù hợp ngay: `CONTRACT_CANCELLED_PT_DEACTIVATED` (đang dùng cho khoá), `SESSION_CANCELLED`, `SESSION_RESCHEDULE_REQUESTED`, `REFUND_NEEDS_MANUAL_SETTLEMENT`, `SESSION_DISPUTE_RESOLVED`, `GYM_COMPLAINT_RESOLVED`, `PT_APPLICATION_REVIEWED`. **Thiếu**: "PT bị tạm khoá", "PT được mở lại", "buổi bị tạm dừng do admin", "vụ việc đã có quyết định", "quyết định bồi thường". Thêm giá trị enum = migration Prisma cho user-service; mobile ánh xạ loại thông báo sang tiêu đề ở `frontend/mobile/src/features/notifications/notifications.ts:70-100`, web không có ánh xạ riêng cho các loại này (hiện hiển thị chung).

---

## 6. payment-service: biểu diễn "đóng băng" bằng những gì hiện có

### 6.1 Ba ngăn và cách tiền giữ được nhận ra

`CODE AUDIT`
- `Wallet`: `availableBalance`, `pendingBalance`, `lockedBalance`, `status` (ACTIVE | FROZEN | CLOSED) (`PS` schema `:116-132`, enum `:65-69`). `LedgerBucket` = PENDING, AVAILABLE, LOCKED (`:84-88`). Mỗi ví đối tác là MỘT ví gom pending của mọi hợp đồng của họ; phần của một hợp đồng chỉ suy ra từ các dòng sổ cái mang `transactionId` của hợp đồng đó (`pendingForTransaction`, `PS/services/wallet.service.ts:169-178`; `ownPending`, `PS/services/contract-ledger.service.ts:94-99`).
- Tiền "giữ lại" của PT trên một hợp đồng **không có cột hay bảng riêng**: nó là phần PENDING của hợp đồng nhưng không thể phân biệt với tiền "chưa kiếm được" nếu chỉ nhìn ngăn. Nó được suy ra bằng hậu tố mô tả: `HOLDBACK_RETAINED_SUFFIX = ' — PT holdback retained'` (ghi có PENDING) và `HOLDBACK_RELEASED_SUFFIX = ' — PT holdback released (no activity)'` (ghi nợ PENDING) (`PS/services/contract-ledger.service.ts:120-121`); `ptHeld` cộng trừ chúng rồi kẹp bởi `ownPending` (`:128-148`). `holdbackWasReleased` tìm dòng nợ PENDING có hậu tố "released" (kể cả dòng 0 đồng) như dấu đánh dấu "đã giải phóng, từ nay hợp đồng không còn giữ" (`:156-168`, ghi dấu ở `:1128`).
- Khoá idempotency nằm ở bảng `LedgerOperation` (`PS` schema `:305-312`), dạng `SESSION_RELEASE:<sessionId>`, `CONTRACT_TERMINATE:<contractId>`, `HOLDBACK_RELEASE:<contractId>`...; chạy trong cùng giao dịch DB với bút toán (`PS/services/ledger-idempotency.ts:20-28`).

### 6.2 Điều gì xảy ra với hợp đồng đang tranh chấp hôm nay

- `releasePtHoldback` (`PS/services/contract-ledger.service.ts:1112-1147`), được quét nhàn rỗi gọi (`US/services/contract.service.ts:1326`, `US/services/contract-payout.service.ts:292-301`): nếu chưa có dấu "đã giải phóng" thì lấy toàn bộ `ptHeld`, ghi nợ PENDING / ghi có AVAILABLE của PT và ghi dấu; hoàn toàn **không biết** hợp đồng đang tranh chấp.
- `terminateContract` theo từng lý do: kết thúc không lỗi PT (COMPLETED, EXPIRED, CLIENT_CANCELLED, MUTUAL) thì phần giữ về PT qua top-up thông thường (`PS/services/contract-ledger.service.ts:862-867`); lỗi PT (PT_CANCELLED, PT_BANNED, PT_REPEATED_NO_SHOW) thì khách nhận `min(target, held, ptStillToBePaid)` lấy ra từ phần giữ, phần còn lại về PT (`:868-879,935-944`). Cuối cùng nó rút cạn pending của hợp đồng (`:1014-1022`) và bù chênh lệch bằng "forfeited share" (`:1048-1051`) hoặc nền tảng ứng + ghi nợ PT (`coverShortfall`, `:706-...`, `:1052-1060`).
- `releaseSession` (`:413-520`): khi hợp đồng còn giữ, ba trường hợp: bơm thêm vào phần giữ (`:468-486`), hoặc trả đủ.

### 6.3 Tối thiểu cần thêm để: đóng băng / thả / trả cho khách theo quyết định admin / tất cả idempotent

Không thể dùng `WalletStatus.FROZEN` (chặn mọi thao tác chạm ví, gồm cả hoàn tiền cho khách khác: `PS/services/wallet.service.ts:229-233` và `:317-318`). Không nên chuyển phần giữ sang ngăn LOCKED: ngăn này chỉ dành cho lệnh rút đã duyệt (`PS/services/withdrawal.service.ts:175-189`) và khi phần giữ rời PENDING thì `ownPending` ở `terminateContract` không còn thấy nó, nên entitlement của PT sẽ bị coi là thiếu và phát sinh "shortfall" (nền tảng ứng, ghi nợ PT) (`:964-986,1052-1060`).

Phương án tối thiểu `CODE AUDIT` (đề xuất, chưa có gì được viết):
1. Một bảng đánh dấu, ví dụ `ContractMoneyHold` (khoá duy nhất theo `transactionId`): `status` (FROZEN | RELEASED | PAID_OUT), `caseId`, `frozenBy`, `frozenAt`, `releasedAt`, `paidToClient`, ghi chú. Không đổi cấu trúc ví/bucket.
2. Ba thao tác trong `contract-ledger.service.ts`, mỗi cái một khoá `LedgerOperation`: `freezeContractHold` (`HOLD_FREEZE:<caseId>`), `releaseContractHold` (`HOLD_RELEASE:<caseId>`), `payFromContractHold` (`HOLD_PAYOUT:<caseId>:<n>`: ghi nợ PENDING của PT, ghi có AVAILABLE của khách với mô tả chứa chữ "compensation" để tính là tiền rút được: `PS/repositories/withdrawal.repository.ts:95-109`).
3. Mọi đường hiện có phải đọc dấu này trong cùng khoá ví: (a) `releasePtHoldback` → không làm gì và không ghi dấu "released"; (b) `terminateContract` → trừ phần đóng băng khỏi `reserve`/top-up và khỏi vòng rút cạn (`:1014-1022`), không tính vào `held` cho bồi thường tự động; (c) `compensateNoShow`/`compensateLateArrival` (`:543-...`) → không rút từ phần đóng băng; (d) `releaseSession` → quyết định phần PT kiếm mới cũng bị giữ hay không.
4. Số dư đóng băng phải tính vào bất biến đối soát (ESCROW = tổng các ngăn: `PS/services/reconcile.service.ts:8-20,83-90`).

**Mọi đường hiện có có thể di chuyển phần tiền giữ mà không biết nó bị đóng băng**: `releasePtHoldback` (idle sweep và route `PS/routes/internal.routes.ts:592-610`), `terminateContract` (mọi lý do, kể cả `EXPIRED` từ quét hết hạn và `PT_BANNED` từ lệnh khoá), `compensateNoShow`/`compensateLateArrival` (cùng rút từ pending của hợp đồng; chú thích `:125-127` thừa nhận có thể ăn vào phần giữ), `refundUnactivatedContractPayment` (hoàn khi không kích hoạt được), và đường hoàn tiền cũ `POST /admin/payments/:id/refund` (`PS/routes/admin.routes.ts:151-...`) cho giao dịch dạng chuyển ví (cần kiểm tra thêm nếu còn dùng). Rút tiền không chạm được pending (chỉ AVAILABLE: `PS/services/withdrawal.service.ts:105-139`).

Lưu ý quan trọng: **vì tỷ lệ giữ lại hiện bằng 0 cho mọi hợp đồng, hôm nay không có "tiền giữ" nào để đóng băng**. Phần tiền thực sự chưa tới PT trên hợp đồng đang tranh chấp là phần PENDING "chưa kiếm được" (được ký quỹ che chắn, PT không rút được), còn phần đã giải phóng đã nằm chung trong AVAILABLE của PT, không tách theo hợp đồng được.

---

## 7. Cuộc đua và nguy cơ lặp sự kiện trong luồng khoá hiện tại

Tất cả `CODE AUDIT`, "suy từ mã" nghĩa là chưa tái hiện.

1. **Một phần hợp đồng thất bại không được thử lại** (đã tả ở mục 0.4). `deactivatePT` trả `{outcomes, suspended}` luôn 200 (`US/routes/internal.routes.ts:23-33`); relay không đọc `outcomes`. Hợp đồng SKIPPED giữ trạng thái ACTIVE với các buổi tương lai đã bị huỷ (bước huỷ buổi chạy trước tiền, `US/services/pt-deactivation.service.ts:120-141`) và `ptSuspended=true`. Chỉ có thông báo `REFUND_NEEDS_MANUAL_SETTLEMENT` gửi cho `adminId`. Muốn chạy lại phải khoá/mở khoá lại hoặc gọi tay `/internal/pt/:id/deactivate`.
2. **Dòng FAILED cũ không đóng** (suy từ mã): `AS/services/pt-deactivation-relay-sweep.service.ts:34-49` chọn `status: "FAILED"` rồi gọi `relayPtActiveStateChange` (tạo dòng mới). Dòng cũ vĩnh viễn FAILED → mỗi 5 phút gửi lại, lô 50 dòng cũ nhất trước. Kịch bản: khoá (lần gọi đầu lỗi) → admin mở khoá (REACTIVATE thành công) → sweep gửi lại DEACTIVATE cũ → `ptSuspended=true` và huỷ/hoàn các hợp đồng đang mở lần nữa, dù tài khoản đang `isActive=true`. Cũng không có thứ tự theo từng PT giữa các dòng.
3. **Huỷ buổi không có điều kiện trạng thái so với buổi vừa hoàn tất** (suy từ mã): `updateMany` huỷ buổi theo trạng thái lúc ghi (`US/services/pt-deactivation.service.ts:120-127`) nên không ghi đè buổi đã `COMPLETED`; nhưng `claimDeduction` chỉ kiểm `sessionDeducted=false` chứ không kiểm trạng thái (`US/repositories/session.repository.ts:107-113`). Nếu quét tự xác nhận (hoặc khách bấm xác nhận) đã chọn buổi `PENDING_CLIENT_CONFIRMATION` trước khi khoá huỷ nó, `deductQuotaOnce` (`US/services/booking.service.ts:112-123`) vẫn tăng `usedSessions`, gọi `releaseSessionMoney` và sau đó `updateStatus(COMPLETED)` ghi đè `CANCELLED` (`US/services/session-autoconfirm.service.ts:80-86`). Kết quả khả dĩ: hợp đồng đã chấm dứt mà `usedSessions` tăng thêm sau đó. Phần tiền ít bị ảnh hưởng vì pending của hợp đồng đã được rút cạn và `releaseSession` bị kẹp bởi `ownPending` (`PS/services/contract-ledger.service.ts:455-460`).
4. **Buổi `PENDING_CLIENT_CONFIRMATION` và `DISPUTED` bị huỷ im lặng**: PT đã báo đã giao bị mất khoản thanh toán cho buổi đó và tranh chấp đang mở của khách bị đóng mà admin chưa phán xử (`US/services/pt-deactivation.service.ts:22-27`). Ngược lại `PT_NO_SHOW_REPORTED` bị bỏ sót khỏi tập huỷ: nó nằm lại vĩnh viễn (PT không đăng nhập được để phản hồi, không tiến trình nào hết hạn nó, `resolveDispute` không nhận nó).
5. **Thanh toán đến cho hợp đồng của PT bị khoá**:
   - Đã xử lý: hợp đồng đã `CANCELLED` → kích hoạt trả 409 → payment-service hoàn đủ (mục 2.2).
   - Cửa sổ hẹp còn lại (suy từ mã): `terminateContractMoney` đọc hợp đồng (chưa có `paymentTransactionId` → không gọi tiền) rồi ghi `status=CANCELLED` **không điều kiện** (`US/services/contract-payout.service.ts:238-276`). Nếu giữa hai bước đó `activateIfPendingGuarded` (`US/repositories/contract.repository.ts:395-412`) kích hoạt hợp đồng với giao dịch vừa được thanh toán, thì ghi đè của khoá đặt lại `CANCELLED` + `PT_BANNED` trên một hợp đồng đã có `paymentTransactionId` và tiền đã ở ký quỹ/pending, không ai hoàn: không có quét nào trong user-service tìm hợp đồng `CANCELLED` có giao dịch (quét hết hạn chỉ lấy ACTIVE: `:160-166`). Điều này cùng loại với lỗi mà `cancelContract` tránh bằng `updateStatusIfCurrent` (`US/repositories/contract.repository.ts:365-376`).
6. **`terminate` bằng tay không có điều kiện trạng thái**: admin gọi `terminate` với `PT_BANNED` lên hợp đồng đã `COMPLETED/EXPIRED` sẽ ghi đè trạng thái thành `CANCELLED` và `terminationReason`, trong khi payment-service phát lại kết quả cũ theo khoá `CONTRACT_TERMINATE:<id>` (`US/services/contract-payout.service.ts:273-276`, `PS/services/ledger-idempotency.ts:20-28`). Tiền không đổi, nhưng sổ sách hợp đồng sai. Quan trọng nếu "hoàn tác" sau này dựa vào `terminationReason`.
7. **Khoá hai lần/đồng thời**: nhờ khoá idempotency `CONTRACT_TERMINATE:<id>` ở payment-service, thử lại không hoàn trùng. Hai admin cùng khoá và mở khoá: không có phiên bản hay thứ tự; `setPtSuspended` ghi đè theo ai đến sau.
8. **Rút tiền đang bay** (suy từ mã): yêu cầu PENDING không khoá tiền, chỉ APPROVED mới chuyển AVAILABLE → LOCKED (`PS/services/withdrawal.service.ts:175-189`); `terminateContract` có thể ghi nợ AVAILABLE của PT ("over-released, clawed back": `PS/services/contract-ledger.service.ts:987-996`), khiến `markPaid` ném `InsufficientBalanceError` (chú thích tại `PS/services/withdrawal.service.ts:247-249`). Với tỷ lệ giữ lại 0 và lệnh khoá thường không "chi quá" nên hiếm.
9. **Hoàn tiền quanh thông báo**: thông báo cho khách là best-effort (`.catch(() => {})`, `US/services/pt-deactivation.service.ts:199-209`), một thông báo hỏng không thử lại.
10. **Cổng xác thực mở khi lỗi**: `isUserActive` trả `true` khi auth-service không trả lời (`US/services/contract.service.ts:363`), nên trong lúc auth-service gián đoạn, chat/cuộc gọi tới PT bị khoá lại được phép.

---

## 8. Màn hình hiện có (chỉ kiểm kê; đường dẫn + nội dung)

**Admin, web** (`frontend/web/src/app/pages/admin/`)
- `UserManagement.tsx`: danh bạ người dùng (cột trạng thái Active/Inactive/Pending lấy từ gateway); nút "Suspend account" **không có hành vi** (`:311-314`).
- `PTManagement.tsx`: duyệt hồ sơ PT (APPROVE / REJECT / REQUEST_INFO).
- `AdminDisputes.tsx`: danh sách buổi `DISPUTED` và ba kết quả phán xử.
- `AdminWithdrawals.tsx`: hàng đợi rút tiền (PENDING/APPROVED), loại ví nhưng không hiện tài khoản bị khoá.
- `PTServiceRefunds.tsx`: hoàn tiền dịch vụ cá nhân hoá.
- `AdminReconciliationPanel.tsx`, `AdminFinancePage.tsx`, `AdminFinanceOverviewTab.tsx`: đối soát và tài chính.
- `AdminComplaintsPage.tsx`: khiếu nại gym.
- `AdminDashboard.tsx`: tổng quan, số hồ sơ chờ.
**Admin, mobile** (`frontend/mobile/app/admin/`): `users.tsx` (khoá/mở khoá thật, hộp xác nhận mô tả hậu quả qua `src/features/admin/adminUsers.ts:79-93`), `pt-applications/`, `applications/`, `resolve.tsx` (phân xử buổi tranh chấp), `withdrawals.tsx`, `finance.tsx`, `dashboard.tsx`, `marketplace.tsx`, `approvals.tsx`, `partners/`, `gyms/`.
**PT, web** (`frontend/web/src/app/pages/pt/`): `PTContractsPage.tsx` (hợp đồng, PT huỷ có hộp thoại), `PTSchedulePage.tsx`, `PTWalletPage.tsx`, `PTClientList.tsx`, `PTDashboard.tsx`, `PTServiceOrderPage.tsx`. **PT, mobile** (`frontend/mobile/app/pt/`): `contracts.tsx`, `schedule.tsx`, `wallet.tsx`, `dashboard.tsx`, `students/`, `service-orders/`, `collaborations.tsx`.
**Khách, web** (`frontend/web/src/app/pages/client/`): `ContractPage.tsx` (hợp đồng và thanh toán), `PTDiscoveryPage.tsx` (tìm PT), `WalletPage.tsx` (ví, rút tiền). **Khách, mobile** (`frontend/mobile/app/client/`): `services/index.tsx` (hợp đồng và thanh toán), `services/pt/[id].tsx` (chi tiết PT; có biểu ngữ khi `suspended` hoặc không nhận khách: `:251`), `services/booking.tsx`, `profile/wallet.tsx`, thông báo ánh xạ loại sự kiện ở `src/features/notifications/notifications.ts:70-100`.
**Không có**: màn hình nào cho PT biết mình bị hạn chế hay vì sao; màn hình nào cho khách chọn "chờ hay rời"; màn hình quản trị "vụ việc PT"; web không có chức năng khoá PT thật.

---

## 9. Đề xuất cắt nhỏ Phase 2.5A thành các bước backend độc lập

Nguyên tắc chọn bước: dựa vào những gì kiến trúc có sẵn (đã có cờ `ptSuspended` hoạt động ở đúng các chỗ đặt/xác nhận/hiển thị), tránh thêm trạng thái hợp đồng mới. Mỗi bước có thể kiểm thử riêng bằng cơ sở dữ liệu `*_test`.

### Điều kiện đầu (Bước 0): sửa các lỗi của luồng khoá hiện tại
- Việc: (a) sweep đóng dòng `FAILED` gốc khi thử lại thành công, và không gửi lại DEACTIVATE đã bị REACTIVATE sau đó vượt qua; (b) `deactivatePT` báo lỗi (hoặc relay đọc `outcomes`) khi có hợp đồng SKIPPED để được thử lại; (c) cho `reason` đi từ gateway/mobile tới user-service; (d) ghi `AuditLog` cho khoá/mở khoá và cho từng hợp đồng bị gỡ; (e) `terminateContractMoney` ghi trạng thái có điều kiện; (f) huỷ buổi bằng `transitionStatus` (CAS) và thêm `PT_NO_SHOW_REPORTED` vào xử lý; (g) `claimDeduction` kiểm trạng thái buổi.
- File: `AS/services/pt-deactivation-relay-sweep.service.ts`, `AS/services/pt-deactivation-relay.service.ts`, `AS/services/auth.service.ts`, `GW/routes/proxy.routes.ts` (thân yêu cầu), `US/services/pt-deactivation.service.ts`, `US/routes/internal.routes.ts`, `US/services/contract-payout.service.ts`, `US/repositories/session.repository.ts`.
- Schema: không, hoặc một cột `PtDeactivationCall.supersededAt` nếu chọn cách đóng dòng cũ bằng cột.
- Kiểm thử: `AS/__tests__/pt-deactivation-relay-sweep.test.ts` và `pt-deactivation-relay.test.ts` (mở rộng), `US/__tests__/pt-deactivation-shares-termination-path.test.ts` (mở rộng), thêm kiểm thử tích hợp cơ sở dữ liệu `*_test` cho cuộc đua kích hoạt/huỷ.
- Quyết định còn cần: Q1 bên dưới (nếu gom lỗi (e) vào bước này hay bước 6).

### Bước 1: bản ghi hạn chế PT và từ vựng
- Việc: bảng `PtRestriction` ở user-service (loại TEMPORARY/PERMANENT, trạng thái ACTIVE/LIFTED, mã lý do, ghi chú, người tạo, người gỡ, thời điểm) và `AuditLog` (`entityType=PT_PROFILE`) cho mọi chuyển trạng thái; dịch vụ `suspend/lift/ban` idempotent; `ptSuspended` trở thành giá trị suy ra từ bản ghi đang ACTIVE.
- File: `schema.prisma` + migration user-service, dịch vụ mới cạnh `pt-deactivation.service.ts`, `internal.routes.ts`.
- Schema: có (bảng + enum). Cần thử `migrate deploy` trên DB test trống do vấn đề lệch migration đã biết.
- Kiểm thử: tích hợp DB: tạo/gỡ/đổi loại, hai lần tạm khoá liên tiếp, gỡ khi không có hạn chế, `ptSuspended` đúng sau mỗi bước, mỗi bước ra một dòng kiểm toán.
- Quyết định còn cần: Q1, Q2.

### Bước 2: tạm khoá không chấm dứt hợp đồng
- Việc: endpoint admin "tạm khoá" ở user-service (qua gateway `/admin/pts/:id/suspend` và `/resume`) chỉ đặt bản ghi hạn chế TEMPORARY + `ptSuspended`; **không** đổi `isActive` ở auth, **không** gọi `terminateContractMoney`. Cổng `isApprovedPt` của marketplace (`US/routes/internal.routes.ts:100`) trả false khi bị tạm khoá; thông báo cho khách có hợp đồng ACTIVE (loại mới hoặc dùng loại sẵn). Nút "khoá tài khoản" hiện tại giữ nguyên nghĩa "cấm" (bước 6).
- File: `internal.routes.ts`, `profile.controller`/route admin, `GW/routes/proxy.routes.ts`, enum thông báo.
- Schema: có nếu thêm giá trị `NotificationEventType`.
- Kiểm thử: hợp đồng ACTIVE giữ nguyên; `bookSession`/`confirmSession`/`requestContract` bị chặn; tìm kiếm không hiện; marketplace `isApprovedPt=false`; tiền không đổi (stub `paymentClient` không bị gọi).
- Quyết định còn cần: Q1 (PT còn đăng nhập được không), Q2 (có thời hạn tối đa không), Q10 (hợp đồng đang PENDING_*).

### Bước 3: dừng đồng hồ thời gian của hợp đồng
- Việc: quét hết hạn bỏ qua hợp đồng của PT đang bị tạm khoá; khi gỡ, kéo dài `endDate` đúng bằng thời gian bị tạm khoá cho các hợp đồng ACTIVE có `endDate`; quét tiền giữ nhàn rỗi bỏ qua PT bị tạm khoá và tính đồng hồ từ lúc gỡ.
- File: `US/repositories/contract.repository.ts` (`findExpiredContracts`, `findIdleHoldbackCandidates`), `US/services/contract.service.ts`, dịch vụ gỡ ở bước 1.
- Schema: không (dùng cửa sổ trong `PtRestriction`); tuỳ chọn cột `Contract.endDateExtendedDays` để kiểm toán.
- Kiểm thử: cạnh `contract-validity-days-applied-on-activation.integration.test.ts` và `contract-holdback.integration.test.ts`: hợp đồng quá hạn trong lúc tạm khoá không bị `EXPIRED`; sau khi gỡ `endDate` tăng đúng; tiền giữ không giải phóng khi đang tạm khoá; đồng hồ nhàn rỗi khởi động lại sau gỡ.
- Quyết định còn cần: Q5.

### Bước 4: tạm dừng buổi tập không phạt
- Việc: khi tạm khoá, các buổi REQUESTED/CONFIRMED trong tương lai chuyển `CANCELLED` bằng đường `FORCE_MAJEURE` của ma trận (`US/services/session-outcome.ts:44-49`: giữ quota, không bồi thường, không ghi `ptAtFault`), `cancelledBy="SYSTEM"` với mã lý do riêng, dùng `transitionStatus` (CAS) và `AuditLog`; quét đóng phòng và `reportPtNoShow`/`markNoShow` không áp phạt cho buổi thuộc cửa sổ tạm khoá; thêm hết hạn hợp lý cho `PT_NO_SHOW_REPORTED` hoặc cách admin giải quyết nó.
- File: `US/services/booking.service.ts`, `US/services/room-close-resolution.service.ts`, `US/services/session-outcome.ts`, `US/repositories/session.repository.ts`.
- Schema: không (không cần trạng thái buổi mới; có thể thêm giá trị `SessionStatus` nếu chọn "khôi phục sau khi mở" ở Q3).
- Kiểm thử: `ptAtFault` không tăng; không có `paymentClient.noShow`; quota không đổi; hai lần chạy không xử lý trùng; không ảnh hưởng ngưỡng 3 lần `PT_REPEATED_NO_SHOW`.
- Quyết định còn cần: Q3, Q4.

### Bước 5: khách chọn chờ hoặc rời đi
- Việc: endpoint cho khách `POST /contracts/:id/leave-restricted-pt`, chỉ cho phép khi PT đang có hạn chế ACTIVE; gọi `terminateContractMoney` với lý do không lỗi (hoàn 100% giá trị chưa dùng, không phí, không bồi thường); khoá idempotency `CONTRACT_TERMINATE:<id>` sẵn có. "Chờ" không cần mã.
- File: `US/controllers/contract.controller.ts`, `US/services/contract.service.ts`, nếu thêm lý do mới thì `contract-money.ts` + `internal.routes.ts` zod enum ở payment-service + `schema.prisma` user-service.
- Schema: không nếu tái dùng `MUTUAL`; có (enum `TerminationReason`) nếu thêm lý do mới.
- Kiểm thử: khách rời được chỉ khi PT bị hạn chế; số tiền hoàn = `remainingValue` làm tròn lên; phần PT/gym/nền tảng trên phần đã giao đúng; gọi hai lần không hoàn trùng; sau khi gỡ hạn chế, không rời được.
- Quyết định còn cần: Q6.

### Bước 6: cấm vĩnh viễn không tự động bồi thường
- Việc: cấm = `isActive=false` + hạn chế PERMANENT; gỡ hợp đồng dùng lý do không lỗi thay vì `PT_BANNED` (hoàn 100% giá trị chưa dùng, không tự trích tiền giữ); mọi khoản bồi thường chuyển sang bước 8. Gom các sửa lỗi cuộc đua còn lại; thông báo cho PT và gym.
- File: `US/services/pt-deactivation.service.ts`, `US/services/contract-payout.service.ts`, payment-service zod enum nếu thêm lý do mới, `GS` nếu quyết định chấm dứt thoả thuận.
- Schema: có nếu thêm lý do mới.
- Kiểm thử: cập nhật `pt-deactivation-shares-termination-path.test.ts`; kiểm thử payment-service `pt-holdback.integration.test.ts`: tỷ lệ > 0 + cấm thì **không** bồi thường tự động.
- Quyết định còn cần: Q7, Q13.

### Bước 7: đóng băng tiền giữ lại (payment-service)
- Việc: như 6.3: bảng `ContractMoneyHold`, ba thao tác idempotent, và các kiểm tra trong `releasePtHoldback`, `terminateContract`, `compensateNoShow`/`compensateLateArrival`, `releaseSession`; route nội bộ `POST /internal/contracts/hold/{freeze,release,payout}`.
- File: `PS/services/contract-ledger.service.ts`, `PS/routes/internal.routes.ts`, `PS/clients`/user-service `contract-payout.service.ts` (phía gọi), `PS/prisma/schema.prisma` + migration.
- Schema: có.
- Kiểm thử: theo mẫu `pt-holdback.integration.test.ts` (tỷ lệ > 0): đóng băng rồi quét nhàn rỗi → không chuyển; đóng băng rồi `terminate` EXPIRED → phần đóng băng nguyên vẹn; thả rồi quét → chuyển; gọi hai lần cùng khoá → phát lại; đối soát giữ bất biến.
- Quyết định còn cần: Q9 (hôm nay chưa có tiền giữ để đóng băng).

### Bước 8: quyết định trách nhiệm tài chính tường minh
- Việc: bảng quyết định (vụ việc, hợp đồng/khách, số tiền, nguồn tiền, người quyết định, ghi chú) và thao tác trả `payFromContractHold`; một khiếu nại của một khách chỉ tạo quyết định cho hợp đồng của khách đó; kiểm toán đầy đủ.
- File: user-service (bảng + endpoint admin), `PS/services/contract-ledger.service.ts`, gateway.
- Schema: có.
- Kiểm thử: quyết định cho khách A không chạm hợp đồng của khách B; vượt quá phần đóng băng bị từ chối; lặp lại là phát lại; ghi `AuditLog`.
- Quyết định còn cần: Q8, Q11.

### Bước 9 (tuỳ chọn, sau cùng): API đọc cho màn hình "vụ việc"
Danh sách hạn chế đang mở, hợp đồng/buổi bị ảnh hưởng, tiền đóng băng, lịch sử kiểm toán. Chỉ backend; màn hình thuộc phase khác.

### Những điểm kiến trúc hiện tại làm cho mục tiêu của chủ sở hữu tốn kém, và cách rẻ nhất để đạt cùng độ an toàn

1. **"Tạm dừng hợp đồng" như một trạng thái mới là đắt**: 16 nhóm người đọc `ACTIVE` (mục 4.2), enum Prisma + hai bản kiểu frontend, quy tắc "một hợp đồng mỗi cặp" chỉ ở tầng ứng dụng, và lệch migration. Cách rẻ: **không đổi `ContractStatus`**; coi hạn chế là lớp phủ ở cấp PT (`PtRestriction` + `ptSuspended` đã hoạt động ở các chỗ đặt/xác nhận/hiển thị), chỉ sửa ba quét (hết hạn, tiền nhàn rỗi, đóng phòng) và kéo dài `endDate` khi gỡ.
2. **"Tạm dừng buổi tập"**: thay vì thêm trạng thái buổi, dùng đường `FORCE_MAJEURE` sẵn có (huỷ, giữ quota, không phạt). Đổi lại các buổi đó không tự khôi phục khi gỡ: khách đặt lại. Nếu muốn tự khôi phục thì mới cần trạng thái mới.
3. **"Đóng băng tiền giữ lại" là đắt và hôm nay vô nghĩa**: tiền giữ chỉ suy từ hậu tố mô tả; `WalletStatus.FROZEN` quá thô; `LOCKED` tạo shortfall. Khi tỷ lệ giữ = 0 (mọi hợp đồng thật) không có gì để đóng băng. Cách rẻ trong lúc chưa bật tiền giữ: **chặn rút tiền cấp ví PT** bằng một cờ quản trị ở payment-service (kiểm trong `requestWithdrawal`/`approve`/`markPaid`), không đụng sổ cái, hoàn tác bằng một cờ; nó chặn mọi tiền của PT chứ không riêng một hợp đồng. Chỉ làm bước 7 khi sản phẩm thực sự bật `resolvePtHoldbackRate`.
4. **"Cấm vĩnh viễn không tự bồi thường"**: rẻ nếu chỉ đổi lý do chấm dứt (một giá trị enum hoặc tái dùng `MUTUAL`); điều đắt là muốn có trách nhiệm tài chính "đúng người": số tiền phải lấy từ nguồn nào (Q8) vì quy tắc hiện tại cấm trích từ AVAILABLE của PT và cấm nền tảng ứng (`PS/services/contract-ledger.service.ts:876-879`).
5. **"Khoá nhầm phải đảo ngược được"**: với tạm khoá thì đạt được gần như tự nhiên nếu không phá gì (bước 2-4). Với **cấm vĩnh viễn thì không thể** hoàn tác vì hợp đồng đã huỷ và tiền đã hoàn. Cách rẻ để an toàn: quy trình hai bước (tạm khoá trước, cấm sau khi xem xét), và không cho cấm thực thi huỷ hợp đồng ngay mà chờ một cửa sổ xem xét ngắn.
6. **"Một khiếu nại không tạo nghĩa vụ với khách khác"**: đạt được tự động nếu tách bỏ việc lệnh khoá tự bồi thường (bước 6) và mọi trách nhiệm đi qua quyết định theo từng hợp đồng (bước 8).
7. **Quyền admin một cấp** làm cho quyết định tài chính khó "có kiểm soát" hơn: cách rẻ là ghi kiểm toán bắt buộc và lý do bắt buộc; hai-người-duyệt là quyết định sản phẩm (Q9).

---

## 10. Quyết định sản phẩm còn cần (mỗi cái một câu hỏi, kèm lựa chọn)

Q1. Một PT đang bị tạm khoá có được đăng nhập không?
 (A) Không, như khoá tài khoản hôm nay (dễ nhất, nhưng PT không phản hồi được buổi chờ và không khiếu nại được). (B) Có, chế độ hạn chế: xem lịch, phản hồi tranh chấp, không nhận khách mới, không rút tiền. (C) Có, chỉ đọc.

Q2. Tạm khoá có hạn tối đa không?
 (A) Không, admin gỡ tay. (B) Không tự gỡ nhưng nhắc admin xem lại sau N ngày. (C) Tự gỡ sau N ngày nếu không chuyển thành cấm.

Q3. Các buổi REQUESTED/CONFIRMED trong tương lai khi PT bị tạm khoá?
 (A) Huỷ không phạt, khách tự đặt lại (rẻ nhất). (B) Huỷ rồi tự khôi phục khi gỡ (cần trạng thái/ghi nhớ mới). (C) Giữ nguyên nhưng miễn phạt vắng mặt.

Q4. Các buổi đã ở `PENDING_CLIENT_CONFIRMATION`, `DISPUTED`, `PT_NO_SHOW_REPORTED` khi bắt đầu tạm khoá?
 (A) Để tự xác nhận như thường (PT vẫn được trả cho việc đã báo trước khi bị khoá). (B) Đóng băng hạn xác nhận cho tới khi gỡ. (C) Chuyển hết sang hàng đợi admin.

Q5. Thời hạn hợp đồng trong lúc tạm khoá?
 (A) Kéo dài `endDate` bằng đúng thời gian tạm khoá. (B) Không kéo dài, chỉ dựa vào quyền rời đi hoàn 100%. (C) Kéo dài nhưng có trần N ngày.

Q6. Khi khách rời PT đang bị hạn chế, ghi lý do chấm dứt nào?
 (A) Tái dùng `MUTUAL` (không cần migration, nhưng nhãn không đúng nghĩa). (B) Thêm lý do mới riêng cho "PT bị hạn chế" (cần migration enum + kiểm payment-service). (C) Thêm một lý do chung "không lỗi" dùng cho cả rời đi lẫn cấm vĩnh viễn.

Q7. Cấm vĩnh viễn: hợp đồng đang chạy xử lý thế nào?
 (A) Huỷ ngay, hoàn 100% giá trị chưa dùng (như hôm nay nhưng không bồi thường tự động). (B) Cho khách một cửa sổ N ngày để chọn: chuyển sang PT khác hoặc nhận hoàn tiền, hết cửa sổ thì huỷ. (C) Khách chủ động chấm dứt (không tự huỷ).

Q8. Nguồn tiền khi admin quyết định bồi thường cho một khách?
 (A) Chỉ từ tiền giữ lại đã đóng băng của chính hợp đồng đó (cần bật tỷ lệ giữ > 0). (B) Thêm cả AVAILABLE của PT (có thể làm số dư âm). (C) Nền tảng ứng và ghi nợ PT (cơ chế `coverShortfall` sẵn có). (D) Nền tảng tự chịu.

Q9. Quyết định tài chính và đóng băng có cần hai admin?
 (A) Một admin đủ, chỉ cần lý do + kiểm toán. (B) Người ra quyết định và người duyệt phải khác nhau. (C) Chỉ cần hai người khi số tiền vượt ngưỡng.

Q10. Hợp đồng chưa trả tiền (`PENDING_REVIEW`, `PENDING_SIGNATURE`, `PENDING_PAYMENT`) của PT bị tạm khoá?
 (A) Giữ nguyên nhưng không thể nhận/ký/thanh toán cho tới khi gỡ. (B) Tự huỷ không tiền (như cấm). (C) Cho khách chọn huỷ.

Q11. Khoá nhầm được gỡ thì khôi phục tới đâu?
 (A) Không làm gì thêm: chỉ gỡ cờ, khách đặt lại. (B) Khôi phục các buổi đã tự huỷ nếu còn khung giờ. (C) Có thể có phần đền bù cho PT cho thu nhập bị mất (cần quy tắc nền tảng). Và các buổi/vắng mặt bị ghi do hạn chế có được xoá khỏi bộ đếm `ptAtFault` không?

Q12. PT có thấy lý do và có kênh phản đối không?
 (A) Thấy lý do mã hoá + liên hệ hỗ trợ ngoài hệ thống. (B) Thấy lý do chi tiết. (C) Có quy trình khiếu nại có trạng thái (cần thực thể "khiếu nại PT").

Q13. Dịch vụ cá nhân hoá (ai-service) của PT bị hạn chế?
 (A) Tạm khoá: ẩn dịch vụ mới, đơn đang chạy vẫn giao. Cấm: ẩn và hoàn các đơn chưa giao. (B) Mọi hạn chế: ẩn và đóng băng đơn. (C) Chưa làm trong 2.5A (ghi lại như nợ).

Q14. Thoả thuận PT–gym khi PT bị hạn chế?
 (A) Không đổi gì. (B) Tạm khoá: ẩn PT khỏi danh sách HLV của gym; cấm: tự bắt đầu chấm dứt báo trước 14 ngày (cơ chế sẵn có). (C) Thông báo gym nhưng không đổi dữ liệu.

Q15. Khoảng trống trong lúc chưa bật tiền giữ lại (mọi hợp đồng thật có tỷ lệ 0): 2.5A có đóng băng gì không?
 (A) Không, chờ bật tiền giữ. (B) Làm "chặn rút tiền của PT" cấp ví như biện pháp tạm. (C) Bật tỷ lệ giữ (qua điều khoản PT) rồi làm bước 7.

---

*Hết. Tài liệu này chỉ là kiểm kê từ mã nguồn (CODE AUDIT); mọi con số trong ví dụ ở mục 3.3 là tính tay từ công thức trong mã, chưa được chạy.*

---

## Phụ lục — Lát 1 đã đổi gì (2026-10-10)

Nhãn bằng chứng của phụ lục này: các kiểm thử là `BACKEND INTEGRATION` (cơ sở dữ liệu `*_test` thật; payment-service được thay bằng `TEST FIXTURE` ở ranh giới client) hoặc `TEST FIXTURE` (không có DB). Mục 0–10 ở trên giữ nguyên là bản kiểm kê tại HEAD `2db694d`.

- **Mục 0.4 / 7.1 (thất bại một phần báo xong).** `deactivatePT` nay trả `complete` và trả lỗi HTTP khi còn hợp đồng chưa xong; auth-service giữ lệnh ở FAILED và sweep gọi lại *chính dòng đó*. Mỗi hợp đồng có kết quả riêng (`REFUNDED` / `CANCELLED_NO_REFUND` / `ALREADY_ENDED` / `FAILED` / `NOT_ATTEMPTED_SUPERSEDED`) trong phản hồi và trong `AuditLog` (`PT_LOCK_CONTRACT_UNWOUND` / `PT_LOCK_CONTRACT_UNWIND_FAILED`). "Cần xử lý" = hợp đồng vẫn ở trạng thái mở. Không thêm bảng.
- **Mục 0.5 / 7.2 (lệnh khoá cũ gửi lại).** `PtDeactivationCall.seq` (BIGINT do DB cấp) + trạng thái `SUPERSEDED` ở auth-service; `UserProfile.ptLockSeq` ở user-service. Sweep không gửi dòng có lệnh mới hơn cho cùng PT; user-service chỉ áp lệnh có `seq` không nhỏ hơn `ptLockSeq` bằng một `UPDATE ... WHERE` nguyên tử. Sweep còn nhặt dòng `PENDING` bị bỏ quên quá 2 phút.
- **Mục 0.6 / 5.4 (mất lý do và người thực hiện).** Gateway chuyển tiếp riêng `reason` (không chuyển cả thân); auth-service ghi `AuditLog` `ACCOUNT_LOCKED` / `ACCOUNT_UNLOCKED`; user-service ghi `AuditLog` (`PT_PROFILE`) `PT_LOCKED` / `PT_UNLOCKED` / `PT_LOCK_COMMAND_IGNORED_STALE`. Thiếu `reason` được lưu là null, không bị từ chối.
- **Mục 7.4 (chỉ phần buổi tập).** `PT_NO_SHOW_REPORTED` nay nằm trong tập buổi bị huỷ khi khoá: huỷ bởi `SYSTEM`, giữ quota, không bồi thường, không `ptAtFault`, báo cáo của khách giữ nguyên trên dòng và được ghi vào audit là "đóng mà chưa phân xử". Huỷ buổi dùng CAS theo trạng thái đã đọc cho từng buổi. Dịch vụ cá nhân hoá, gym-service, lệnh rút đang chờ: **chưa làm**.
- **Mục 7.5 / 7.6 (huỷ đè lên hợp đồng vừa kích hoạt / terminate đè hợp đồng đã kết thúc).** `terminateContractMoney` ghi trạng thái bằng một `updateMany` có điều kiện theo trạng thái và `paymentTransactionId` đã đọc, đọc lại và làm lại bước tiền nếu thua cuộc đua; hợp đồng đã ở trạng thái cuối không bị ghi sang trạng thái khác.
- Còn nguyên: mục 7.3 (`claimDeduction` không kiểm trạng thái buổi, tự xác nhận ghi đè `CANCELLED`), 7.7 (hai admin cùng lúc ghi `isActive` ở auth-service), 7.8–7.10.

---

## Phụ lục — Lát 2–3 đã đổi gì (2026-10-10)

Nhãn bằng chứng: các kiểm thử mới là `BACKEND INTEGRATION` (cơ sở dữ liệu `gymcoach_user_test` thật; payment-service, đẩy thông báo và auth-service được thay bằng `TEST FIXTURE` ở ranh giới client). Không có `REAL BROWSER`, không có `REAL HTTP/API` tới stack đang chạy. Các nhận định về nơi *không* đổi (payment-service, gym-service, ai-service, chat) là `CODE AUDIT`. Phương án B (không thêm trạng thái hợp đồng) giữ được: không có bằng chứng ngược lại.

**Bản ghi hạn chế.** Bảng `pt_restrictions` (một dòng mỗi đợt: loại TEMPORARY_SUSPENSION / PERMANENT_BAN, nhóm lý do + ghi chú nội bộ + lý do công bố, người áp, `started_at`, `ended_at`, người gỡ + lý do, lần cuối admin xác nhận tiếp tục) và `pt_restriction_contract_extensions` (mỗi dòng = một hợp đồng được cộng bù bao nhiêu ms bởi đợt nào; khoá duy nhất `(restriction_id, contract_id)`). Chỉ một đợt hoạt động mỗi PT: chỉ mục duy nhất một phần `pt_restrictions_one_active_per_pt ... WHERE ended_at IS NULL` (viết tay trong migration `20261010160000_pt_restrictions`, ghi chú trong `schema.prisma`). **Nguồn sự thật là dòng có `ended_at IS NULL`.** `user_profiles.pt_suspended` chỉ là bản sao suy ra, chỉ được ghi trong cùng giao dịch mở/đóng đợt (`syncPtSuspendedFlag`); đọc thấy cờ bật mà không có dòng nào (dữ liệu cũ) thì **chặn như cấm vĩnh viễn** (fail-closed), và migration đã đổ dữ liệu cũ thành một đợt PERMANENT_BAN. `pt_lock_seq` giữ nguyên vai trò: số thứ tự của luồng lệnh khoá/mở từ auth-service. Khoá/mở vĩnh viễn của lát 1 nay để lại dòng PERMANENT_BAN (và khoá khi đang tạm đình chỉ thì đóng đợt tạm với `CONVERTED_TO_PERMANENT`, mở đợt vĩnh viễn, rồi chạy quy trình huỷ-hoàn của lát 1). Mở khoá tài khoản **không** gỡ tạm đình chỉ; tạm đình chỉ không gỡ được cấm vĩnh viễn (409).

**Hàm hiệu lực.** `getEffectiveContractStatus()` (`pt-restriction.service.ts`) trả `PAUSED_BY_ADMIN` cho hợp đồng ACTIVE của PT đang bị hạn chế; `getEffectiveContractStatuses()` cho danh sách (thêm `effectiveStatus` vào `GET /contracts/pt`, `/client`, `/:id`; `status` lưu vẫn là `ACTIVE`).

**Buổi tập khi tạm đình chỉ** (một giao dịch, dưới khoá PT dùng chung với đặt/xác nhận buổi): mọi buổi REQUESTED/CONFIRMED chưa kết thúc bị huỷ theo hàng `FORCE_MAJEURE` của `session-outcome.ts` (giữ lượt, không bồi thường, không giải ngân), `cancelledBy = SYSTEM`, không `ptAtFault`, đề nghị dời lịch đang chờ bị đóng. Buổi PENDING_CLIENT_CONFIRMATION / DISPUTED / PT_NO_SHOW_REPORTED và buổi đã kết thúc trước thời điểm đình chỉ **không bị đụng**; tự xác nhận và xử lý đóng phòng bỏ qua PT bị hạn chế; khi gỡ, hạn xác nhận của khách được cộng đúng thời gian đã đóng băng.

**Cộng bù hạn hợp đồng** khi gỡ (cùng giao dịch với việc đóng đợt): với mỗi hợp đồng còn ACTIVE có `endDate`, `endDate += gỡ − max(bắt đầu đợt, kích hoạt)`, trừ khi `endDate` đã ≤ mốc đó (đã hết hạn trước khi đình chỉ → không cộng). Dùng hiệu hai thời điểm (UTC, ms) — không múi giờ, không ngày lịch. Lặp lại không cộng trùng nhờ đóng đợt có điều kiện + khoá duy nhất.

**API.** `POST /admin/pts/:ptUserId/suspend|lift-suspension|restrictions/justify`, `GET /admin/pts/:ptUserId/restrictions`, `GET /admin/pts/suspended` (admin; mục `/admin/pts` ở gateway); `GET /profile/me/restriction` (PT tự xem); `GET /internal/pt/:ptUserId/restriction` (dịch vụ khác); `isApprovedPt` ở `/internal/pt-marketplace-eligibility` nay tôn trọng hạn chế. Từ chối bằng HTTP 409 + `code` `PT_TEMPORARILY_UNAVAILABLE` (tạm đình chỉ) / `PT_ACCOUNT_LOCKED` (cấm). Quá `PT_RESTRICTION_OVERDUE_DAYS` (14) ngày kể từ lúc bắt đầu hoặc lần xác nhận cuối: cờ `overdue` trong danh sách — không làm gì khác.

**Thông báo.** Chỉ dùng loại sẵn có `SESSION_CANCELLED`, gửi cho khách và PT có buổi bị huỷ. Khoảng trống: không có loại nào nói "hợp đồng tạm dừng" / "đã mở lại" nên khách/PT không có buổi bị huỷ và mọi người lúc gỡ không nhận thông báo.

**Chưa làm (đúng phạm vi):** khách rút không phạt (chỉ có móc `clientExitOverrideWhilePtRestricted` trả null), đóng băng/đền tiền, tranh chấp, lệnh rút đang chờ, giao diện, bật giữ lại 10%, gym-service check-in huấn luyện (chỉ có đọc nội bộ `/internal/pt/:ptUserId/restriction`).
