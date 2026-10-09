# Kiểm tra hiện trạng và thiết kế di trú: hợp tác Gym–PT cấp thương hiệu và check-in PT theo buổi tập trong ngày

- Ngày đọc mã: 2026-10-09, 16:38–16:55 (giờ Việt Nam). Nhánh `feature/payment-gateways`, commit đầu `dd42451`.
- Phạm vi: chỉ đọc. Không sửa tệp nào, không commit, không ghi cơ sở dữ liệu. Tệp này là tệp duy nhất được tạo.
- Hai tác tử khác đang sửa `backend/services/gym-service` và `backend/services/payment-service`. Tại 16:43 hai thư mục này chưa có thay đổi; tại 16:54 đã có 24 tệp bị sửa (7 trong số đó là client Prisma sinh tự động) và 3 mục mới, chưa commit. Tôi đã đọc lại phần khác biệt và đánh lại số dòng theo cây làm việc lúc 16:55 cho các tệp bị sửa. Xem mục "Thay đổi đồng thời" ngay dưới. Số dòng của các tệp đó có thể lệch tiếp.

## Quy ước nhãn bằng chứng

| Nhãn | Nghĩa |
|---|---|
| `CODE AUDIT` | Đọc trực tiếp trong mã, có đường dẫn và số dòng. Chưa chạy, chưa kiểm thử. |
| `READ-ONLY DB QUERY` | Truy vấn SELECT đã chạy thật. **Trong tài liệu này không có truy vấn nào được chạy** (xem mục B). |
| `SUY LUẬN` | Kết luận rút ra từ mã đã đọc nhưng chưa có bằng chứng trực tiếp. Cần xác nhận trước khi dựa vào. |
| `ĐỀ XUẤT` | Khuyến nghị thiết kế, chưa tồn tại trong mã. |

Không có nội dung nào trong tài liệu này được coi là đã kiểm thử hay đã xác minh.

## Thay đổi đồng thời phát hiện lúc 16:54

Trong lúc tôi viết tài liệu, các tác tử khác đã sửa những tệp tôi vừa đọc. Tất cả đều chưa commit. Tôi chỉ đọc phần khác biệt (`git diff`), không chạy gì. `CODE AUDIT`

| Tệp | Thay đổi liên quan tới tài liệu này |
|---|---|
| `gym-service/src/services/collaboration.service.ts` | Thêm hằng `NEW_CONTRACT_ELIGIBLE` (`:47-51`): `ACCEPTED`, `effectiveAt` null, phòng gym `APPROVED` và `OPEN`. `activeRates` (`:404`) và `listAcceptedGymsForPt` (`:370`) cùng dùng hằng này. Hai lỗ hổng tôi ghi nhận tại `dd42451` (thiếu `OPEN`; bộ chọn phòng gym lệch với `activeRates`) đã được vá trong cây làm việc |
| `gym-service/src/repositories/affiliation.repository.ts` | `findPublicByGym` (`:20-35`) có `select` tường minh, không còn trả `commissionRate` và `invitedBy` ra điểm cuối công khai |
| `gym-service/src/routes/pt.routes.ts`, `src/middleware/partner-context.middleware.ts` | `GET /me/collaborations`: tài khoản MANAGER của đối tác không còn đọc được (thêm `requirePartnerOwnerForOwners`) |
| `gym-service/src/routes/owner.routes.ts:130` | `GET /owner/gyms/:id/closure-impact` chuyển từ `requireGymScope` sang `requirePartnerOwner` |
| `gym-service/src/services/gym.service.ts`, `gym.controller.ts`, `gym.repository.ts`, `prisma/schema.prisma:973-979` | Đóng cửa vĩnh viễn chỉ dành cho chủ sở hữu; thêm `Gym.closedBy`. Số dòng của `schema.prisma` sau dòng 972 lệch +7 |
| `gym-service/prisma/migrations/20261009000000_gym_closed_by/` (mới) | `ALTER TABLE "gyms" ADD COLUMN "closed_by" TEXT` |
| `gym-service/src/__tests__/collaboration-authorization.integration.test.ts` (mới) và bốn tệp kiểm thử bị sửa | Ca kiểm thử cho các thay đổi trên |
| `payment-service/src/routes/internal.routes.ts:525-537`, `contract-ledger.service.ts`, `contract-money.ts` | Thêm tham số tuỳ chọn `ptCancellationCompensationRate` cho `POST /internal/contracts/terminate`: tỷ lệ bồi thường khi PT huỷ, "frozen onto THIS contract when it was signed". Chú thích ghi chưa có nơi nào gửi tham số này |

Điều cần lưu ý cho hai thay đổi trong tài liệu này:

- Phần đánh giá `activeRates` ở mục D và L đã được viết lại theo cây làm việc. Những điểm còn thiếu (trạng thái đối tác, hoàn tất chấm dứt không có job quét, thiếu mốc bắt đầu chấm dứt, hợp đồng không lưu mã thoả thuận) không bị các thay đổi trên đụng tới.
- `ptCancellationCompensationRate` là một điều khoản nữa được chụp lên hợp đồng lúc ký. Nếu điều khoản đó sẽ thuộc về thoả thuận Gym–PT thì bảng thoả thuận cấp thương hiệu (mục C.3) cần cột tương ứng, và user-service phải chụp nó cùng lúc với ba tỷ lệ. Tôi không xác định được ý định thiết kế của tác tử kia.
- Mọi số dòng của các tệp trong bảng trên được lấy lúc 16:55 và có thể lệch tiếp. Các tệp không có trong bảng vẫn khớp `dd42451`.

---

## Tóm tắt

### Năm điểm rủi ro cao nhất khi triển khai

1. **Hợp đồng không lưu tham chiếu tới thoả thuận, và thoả thuận không lưu thời điểm bắt đầu chấm dứt.** `Contract` chỉ có `gymId` và ba tỷ lệ (`user-service/prisma/schema.prisma:624-637`); `collaborationId` do gym-service trả về bị bỏ đi (`contract.service.ts:383`). `terminate()` với ngày tương lai chỉ ghi `effectiveAt` và `terminatedBy` (`collaboration.service.ts:314-317`). Hệ quả: không có dữ liệu nào phân biệt "hợp đồng có sẵn được phép hoàn tất" với "hợp đồng mới phải chặn". Hợp đồng đang ở `PENDING_REVIEW`/`PENDING_SIGNATURE`/`PENDING_PAYMENT` đã chụp tỷ lệ từ lúc tạo yêu cầu và vẫn thanh toán được sau khi chấm dứt, vì tỷ lệ chỉ được tra một lần (`contract.service.ts:367`). `CODE AUDIT`
2. **Xung đột tỷ lệ và việc mở rộng phạm vi không có sự đồng ý.** Quy tắc cứng của chủ sở hữu (không tự chọn một tỷ lệ) khiến ràng buộc duy nhất mới theo (thương hiệu, PT) không thể đặt lên bảng cũ khi còn nhóm 3. Ngoài ra nhóm 1 và 2 cũng đổi nghĩa: hai bên từng đồng ý cho một chi nhánh, nay áp dụng cho mọi chi nhánh. Chưa biết quy mô vì cơ sở dữ liệu dev đang tắt. `CODE AUDIT` + `SUY LUẬN`
3. **`activeRates` còn thiếu điều kiện, và ở cấp thương hiệu mỗi lỗ hổng nhân lên theo số chi nhánh.** Trong cây làm việc lúc 16:55 (chưa commit), `activeRates` và `listAcceptedGymsForPt` đã dùng chung bộ lọc `NEW_CONTRACT_ELIGIBLE`: `ACCEPTED`, `effectiveAt` null, phòng gym `APPROVED` và `OPEN` (`collaboration.service.ts:47-51, 370, 404`); tại `dd42451` hai điều kiện `OPEN` và `effectiveAt` còn thiếu ở một trong hai hàm. Vẫn còn thiếu: trạng thái đối tác bị tạm khoá hay chấm dứt. Việc chuyển `ACCEPTED → TERMINATED` khi hết hạn báo trước chỉ xảy ra khi có người gọi danh sách (`:344`, `:352`), không có job quét. Điều kiện "gói đầu tiên" của hoa hồng giới thiệu tính theo chi nhánh (`membership.repository.ts:23-35`), nên một khách có thể sinh hoa hồng ở từng chi nhánh của cùng thương hiệu. `CODE AUDIT`
4. **Múi giờ và lời gọi liên dịch vụ trên đường check-in.** "Hôm nay" trong user-service dựa vào biến môi trường `TZ` của tiến trình, chỉ được đặt trong `infra/compose/docker-compose.dev.yml`; không tìm thấy trong `docker-compose.prod.yml`, `docker-compose.low-resource.yml` hay `infra/terraform`. gym-service chưa có hàm tính ngày địa phương. Check-in PT thêm một phụ thuộc đồng bộ vào user-service ngay tại cửa phòng tập, trong khi cách xử lý lúc user-service không phản hồi chưa được quyết. `CODE AUDIT` + `SUY LUẬN`
5. **Hai nguồn sự thật cho quan hệ thương mại.** `GymTrainerAffiliation` có thể thành `ACTIVE` mà không cần thoả thuận nào (`affiliation.service.ts:13-43`), mang `commissionRate` riêng và mặc định `visibility = PUBLIC` (`schema.prisma:1090-1091`). Nếu check-in PT hoặc danh sách PT công khai dựa vào affiliation thì PT có quyền mà không có thoả thuận. Nếu tái dùng bảng `GymCheckIn` cho PT thì số "lượt check-in hôm nay" và biểu đồ 7 ngày của chủ gym bị cộng lẫn PT. `CODE AUDIT`

### Câu hỏi cần chủ sở hữu quyết định

1. Nhóm 1 và 2 (PT có một hoặc nhiều thoả thuận chi nhánh cùng tỷ lệ trong một thương hiệu): di trú tự mở rộng ra mọi chi nhánh với tỷ lệ cũ, hay phải có cả chủ gym và PT xác nhận lại phạm vi mới?
2. Nhóm 3 (khác tỷ lệ) trong lúc chưa giải quyết: tỷ lệ cũ của từng chi nhánh có tiếp tục cho phép ký hợp đồng **mới** tại đúng chi nhánh đó không, hay chặn mọi hợp đồng mới của cặp (thương hiệu, PT) cho tới khi hai bên thống nhất?
3. Đề xuất đang thương thảo (`PENDING`/`COUNTERED`) tại thời điểm chuyển đổi: để tự hết hạn kèm thông báo, hay chuyển thành đề xuất cấp thương hiệu?
4. Phòng gym cũ không có thương hiệu (`brandId = null`): giữ thoả thuận cấp chi nhánh vô thời hạn, tự gắn vào thương hiệu của chủ gym nếu có, hay bắt chủ gym tạo thương hiệu trước?
5. "Chi nhánh đủ điều kiện đang hoạt động" có đúng là `status = APPROVED` và `operationalStatus = OPEN` không? Chi nhánh `TEMPORARILY_CLOSED` có được hoàn tất hợp đồng cũ không? Chủ gym hoặc PT có được loại trừ từng chi nhánh khỏi thoả thuận không? Chi nhánh mở sau ngày ký có tự được bao phủ không?
6. Hợp đồng đang ở `PENDING_REVIEW`, `PENDING_SIGNATURE` hoặc `PENDING_PAYMENT` khi bắt đầu chấm dứt: coi là hợp đồng có sẵn (được thanh toán tiếp) hay hợp đồng mới (phải chặn)?
7. Thời hạn báo trước 14 ngày là mức tối thiểu bắt buộc hay giá trị mặc định có thể đổi? Một bên có được chấm dứt ngay lập tức không? Có được rút lại yêu cầu chấm dứt đang chờ không?
8. Sau khi thoả thuận đã `TERMINATED`, hợp đồng cũ còn được **đặt buổi mới** không, hay chỉ được hoàn tất các buổi đã đặt? Có giới hạn thời gian không?
9. "Hạn chế khẩn cấp" do ai áp (quản trị viên, chủ gym, hay cả hai), trên phạm vi nào (PT tại một chi nhánh, PT tại cả thương hiệu, hay cả thoả thuận), và có dừng ngay cả hợp đồng cũ lẫn check-in PT không? Khái niệm này chưa tồn tại trong mã.
10. Khi quản trị viên tạm khoá hoặc chấm dứt đối tác (`GymPartner.status`), có chặn hợp đồng PT mới tại các chi nhánh của đối tác và chặn check-in PT không? Hiện tại không chặn cái nào.
11. Hoa hồng giới thiệu: điều kiện "gói hội viên đầu tiên" tính theo chi nhánh như hiện tại hay theo thương hiệu?
12. Sau thay đổi, PT có tự xuất hiện công khai trong danh sách huấn luyện viên của mọi chi nhánh, chỉ ở chi nhánh PT chọn, hay không ở đâu cả? Có bỏ luồng "mời PT → `ACTIVE`" không cần thoả thuận không?
13. Điểm cuối công khai `GET /pt/:ptUserId/gyms` có tiếp tục trả bảng tỷ lệ chia doanh thu cho người chưa đăng nhập không?
14. Buổi tập ở trạng thái `DISPUTED` hoặc `PT_NO_SHOW_REPORTED` trong ngày D có được tính để check-in không? Buổi đã `PENDING_CLIENT_CONFIRMATION` hoặc `COMPLETED` sớm trong ngày có cho PT vào lại sau đó cùng ngày không?
15. PT vừa có gói hội viên riêng vừa có buổi tập đủ điều kiện: ưu tiên đường PT (không trừ lượt của gói) hay đường hội viên?
16. Khi user-service không phản hồi lúc PT quét mã: từ chối và báo thử lại, hay cho vào và đánh dấu chưa xác minh?
17. Ghi một bản ghi check-in PT mỗi ngày (quét lại trả về bản ghi cũ) hay mỗi lần quét một bản ghi?
18. Xác nhận toàn hệ thống dùng một múi giờ `Asia/Ho_Chi_Minh` cho mọi chi nhánh. Buổi tập vắt qua nửa đêm được tính cho ngày bắt đầu, hay cả hai ngày?
19. Chủ gym được xem tín hiệu nào về PT (số ngày check-in so với số buổi hoàn thành), và dữ liệu nào về khách phải ẩn?
20. Khách của PT không có gói hội viên có được vào phòng tập cho buổi đó không? Quy tắc đích chỉ nói về PT; mã hiện tại từ chối khách không có gói (`NO_MEMBERSHIP`).

---

## A. Bản đồ sử dụng

Mọi dòng trong mục này là `CODE AUDIT`.

### A.1 gym-service

| Vị trí | Hiện làm gì | Cần đổi cho cấp thương hiệu |
|---|---|---|
| `prisma/schema.prisma:1165-1204` `GymPtCollaboration` | Khoá theo `gymId` + `ptUserId`; quan hệ `gym`; chỉ mục `[gymId, status]`, `[ptUserId, status]` | Xem mục C. Cần `brandId`, thời điểm bắt đầu chấm dứt |
| `prisma/schema.prisma:1084-1103` `GymTrainerAffiliation` | `@@unique([gymId, ptId])`, `visibility` mặc định `PUBLIC`, `commissionRate` riêng | Xem mục E |
| `prisma/schema.prisma:986-988` | `Gym.affiliations`, `Gym.collaborations` | Thêm quan hệ từ `GymBrand` nếu dùng bảng mới |
| `prisma/migrations/20260811073209_.../migration.sql` | Tạo bảng `gym_pt_collaborations`, khoá ngoại tới `gyms` | Không sửa tệp cũ |
| `prisma/migrations/20260811085507_.../migration.sql:11-13` | Chỉ mục duy nhất một phần `gym_pt_collaborations_accepted_pair_key` trên `(gym_id, pt_user_id) WHERE status = 'ACCEPTED'` | Giữ nguyên cho dòng cũ. Xem mục C |
| `prisma/migrations/20260902060000_.../migration.sql` | Thêm cột `effective_at` | Không đổi |
| `src/services/collaboration.service.ts:72-88` `expireIfStale` | Chuyển `EXPIRED` khi đọc | Dùng lại cho bảng mới |
| `:99-115` `finalizeIfEffective` | Khi `effectiveAt` đã qua: `TERMINATED` + `updateMany` affiliation theo `gymId, ptId` thành `SUSPENDED` | Phải xử lý mọi chi nhánh của thương hiệu; nên có job quét thay vì chỉ chạy khi đọc |
| `:125-172` `propose` | Kiểm `gym` tồn tại; chặn nếu đã có dòng `PENDING/COUNTERED/ACCEPTED` cho cặp `(gymId, ptUserId)` (`:142-149`) | Kiểm theo `(brandId, ptUserId)`. Không gọi `finalizeIfEffective`, nên dòng `ACCEPTED` đã quá `effectiveAt` vẫn chặn đề xuất mới |
| `:180-287` `respond` | `ACCEPT` trong transaction (`:213-237`), upsert affiliation `ACTIVE` theo `gymId_ptId` (`:224-234`) và sao `proposedGymRate` sang `commissionRate`; bắt `P2002` (`:249`) | Đổi khoá; quyết định số phận affiliation (mục E) |
| `:304-334` `terminate` | Ngày tương lai: chỉ ghi `effectiveAt`, `terminatedBy` (`:314-317`). Ngay lập tức: `TERMINATED` + affiliation `SUSPENDED` (`:320-332`) | Thêm mặc định 14 ngày và thời điểm bắt đầu; hiện không có mức tối thiểu, không có rút lại |
| `:337-353` `listFor` | Phía chủ gym: lấy mọi `gym` theo `ownerId` rồi lọc `gymId in (...)` | Lọc theo thương hiệu của chủ |
| `:368-390` `listAcceptedGymsForPt` | Lọc bằng `NEW_CONTRACT_ELIGIBLE` (`:47-51`, mới thêm, chưa commit); trả `collaborationId`, `gym`, `rates`. Tại `dd42451` chỉ lọc `ACCEPTED` và `APPROVED` | Phải trải thoả thuận thương hiệu thành danh sách chi nhánh đủ điều kiện |
| `:393-414` `activeRates` | Xem mục D | Xem mục D |
| `:417-427` `assertParty` | Phía GYM: `gymService.getOwnedGym(row.gymId, actorUserId)` | Kiểm chủ của thương hiệu |
| `src/controllers/collaboration.controller.ts:30-47` `proposeAsPt` | Lấy `gymId` từ đường dẫn; không gọi `partnerGuard` | Đường dẫn theo thương hiệu |
| `:50-77` `proposeAsGym` | `assertParty` (`:60`) + `partnerGuard.assertAcceptsNewMoney` (`:63`) | Như trên |
| `:79-117` `respondAsPt`, `respondAsGym` | Theo `:id` | Không đổi hình dạng |
| `:119-137` `terminateAsPt`, `terminateAsGym` | Đọc `effectiveAt` tuỳ chọn từ thân yêu cầu (`:21-26`) | Mặc định 14 ngày phía máy chủ |
| `:141-147` `listMine` | Rẽ theo vai trò | Không đổi |
| `:157-169` `internalActiveRates` | `gymId`, `ptUserId` từ query; 404 `NO_ACTIVE_COLLABORATION` | Giữ nguyên chữ ký (mục D) |
| `src/services/affiliation.service.ts:13-23` `invite` | Tạo affiliation `PENDING`, không kiểm `ptId` có phải PT, không kiểm thoả thuận | Mục E |
| `:33-43` `respond` | PT chấp nhận → `ACTIVE` | Mục E |
| `src/repositories/affiliation.repository.ts:20-35` `findPublicByGym` | `status ACTIVE` + `visibility PUBLIC`; có `select` tường minh, không trả `commissionRate` và `invitedBy` (mới thêm, chưa commit) | Mục E |
| `:37-43` `findByPT`, `findPendingByPT` | Theo `ptId` | Mục E |
| `src/controllers/affiliation.controller.ts:6-39` | Năm handler | Mục E |
| `src/routes/public.routes.ts:16` | `GET /gyms/:gymId/trainers` | Mục E |
| `src/routes/public.routes.ts:21` | `GET /pt/:ptUserId/gyms`, công khai | Giữ; đổi nội dung |
| `src/routes/pt.routes.ts:14-16` | `GET/PATCH /pt/gym-invitations`, `GET /pt/gym-affiliations` | Mục E |
| `src/routes/pt.routes.ts:20-22` | `POST /gyms/:gymId/collaborations`, `PATCH/DELETE /collaborations/:id` | Thêm tuyến theo thương hiệu |
| `src/routes/pt.routes.ts:27-41` | `GET /me/collaborations`; nhánh `GYM_OWNER` nay đòi cấp OWNER qua `requirePartnerOwnerForOwners` (mới thêm, chưa commit) | Không đổi đường dẫn |
| `src/routes/owner.routes.ts:161` | `POST /owner/gyms/:gymId/trainers` | Mục E |
| `src/routes/owner.routes.ts:167-169, 176` | Tuyến chủ gym, đều `requirePartnerOwner` | Thêm tuyến theo thương hiệu |
| `src/routes/internal.routes.ts:17` | `GET /internal/collaborations/active` | Giữ |
| `src/services/membership.service.ts:177-194` `resolveReferral` | `activeRates(gymId, ptUserId)` (`:185`), rồi `hasEverHadMembershipAt(clientId, gymId)` (`:190`) | Đi qua bộ phân giải mới; xem câu hỏi 11 |
| `src/services/gym.service.ts:476` `closureImpact` | Đếm `gymPtCollaboration` `ACCEPTED` theo `gymId` | Đếm thoả thuận thương hiệu bao phủ chi nhánh |
| `src/services/partner.service.ts:405-428, 512-573` | Tạm khoá / chấm dứt đối tác: không chạm collaboration hay affiliation | Xem câu hỏi 10 |
| `src/services/partner-guard.service.ts:17-27` | `assertAcceptsNewMoney`, chỉ được gọi ở `proposeAsGym` | Gọi thêm trong bộ phân giải |
| `src/jobs-lambda.ts:8-11`, `src/server.ts:18-21` | Ba job, không job nào chạm collaboration | Thêm job hoàn tất chấm dứt |
| `src/__tests__/collaboration-active-rates-gym-status.test.ts` | Tạo dòng `ACCEPTED` theo `gymId` rồi gọi `activeRates`; đang được mở rộng thêm ca cho `OPEN` và `listAcceptedGymsForPt` (`:113, 130, 152`, chưa commit) | Viết lại dữ liệu mẫu |
| `src/__tests__/collaboration-authorization.integration.test.ts` (tệp mới, chưa được git theo dõi) | Kiểm ai được đọc và ghi thoả thuận: MANAGER bị 403, chủ của đối tác khác không thấy, PT chỉ thấy của mình | Viết lại theo thương hiệu |
| `src/__tests__/collaboration-effective-at.test.ts` | Bốn ca về `effectiveAt` và affiliation | Viết lại |
| `src/__tests__/collaboration-rates.test.ts` | `validateRates`, `MAX_ROUNDS` | Không đổi |
| `src/__tests__/gym-closure-impact.integration.test.ts:76-92` | `activeCollaborations` theo chi nhánh | Viết lại |
| `src/__tests__/operational-gate.routes.test.ts:193, 223` | Khẳng định tuyến `/gyms/:gymId/collaborations`, `/me/collaborations` | Thêm tuyến mới |
| `src/generated/prisma/*` | Client Prisma sinh sẵn, có trong cây mã | Sinh lại bằng `prisma generate` |

Không có đường quản trị viên nào đọc collaboration: `src/routes/admin.routes.ts` không có kết quả khi tìm `collaborat`.

### A.2 user-service

| Vị trí | Hiện làm gì | Cần đổi |
|---|---|---|
| `src/clients/gym.client.ts:38-50` | `GET /internal/collaborations/active`, timeout 3 giây; 404 → `null`; lỗi khác → `GymServiceUnavailableError` | Không đổi nếu giữ chữ ký `(gymId, ptUserId)` |
| `src/services/contract.service.ts:358-388` | Có `gymId`: chặn gói `ONLINE` (`:359-365`), gọi gym-service (`:367`), 503 khi không gọi được (`:369-375`), 400 khi không có thoả thuận (`:377-382`), chép ba tỷ lệ (`:383`), `source = GYM` (`:384`) | Lưu thêm mã thoả thuận và phạm vi (mục D, L) |
| `:398-425` | Tạo hợp đồng với `gymId` và ba tỷ lệ | Thêm cột mới |
| `:1256-1268` | Thanh toán: gửi `rates` và `parties.gymId` của hợp đồng | Không đổi |
| `src/services/contract-payout.service.ts:25-35` | `ratesOf`, `partiesOf` đọc từ hợp đồng | Không đổi |
| `src/repositories/contract.repository.ts:184-187` `countActiveByGyms` | Đếm hợp đồng `ACTIVE` theo danh sách `gymId` | Không đổi |
| `src/routes/internal.routes.ts:236-249` | `POST /internal/contracts/count-active-by-gyms` | Không đổi |
| `src/services/pt-discovery.service.ts:32-48` | Gọi `GET {gym-service}/internal/clients/:id/active-gyms` | **Tuyến này không tồn tại trong gym-service** (`internal.routes.ts` chỉ có ba tuyến). Lời gọi luôn lỗi và trả tập rỗng, nên nhãn `SAME_GYM` không bao giờ đến từ gói hội viên |
| `src/services/pt-discovery.service.ts:64-72` | Nhãn `SAME_GYM` so `PTTrainingLocation.gymId` | Không liên quan tới thoả thuận. Không đổi |
| `src/controllers/profile.controller.ts:190, 215, 222-226`; `src/repositories/profile.repository.ts:97, 182-183` | Lọc và ưu tiên PT theo `UserProfile.gymId` | Không liên quan tới thoả thuận. Không đổi |
| `src/repositories/pt_application.repository.ts:165-173` | Chép `gymId` của địa điểm chính sang `UserProfile.gymId` | Không đổi |
| `prisma/schema.prisma:191` `UserProfile.gymId`; `:925` `PTTrainingLocation.gymId` | Tham chiếu chi nhánh do PT tự khai, không FK, không kiểm thoả thuận | Không đổi. Lưu ý: đây **không** phải bằng chứng quan hệ thương mại |
| `prisma/schema.prisma:271` `PTApplication.gymAffiliation` | Chuỗi tự do trong hồ sơ PT | Không liên quan dù trùng tên |
| `prisma/schema.prisma:552-673` `Contract` | Không có cột nào tham chiếu collaboration | Thêm (mục D) |

### A.3 payment-service

| Vị trí | Hiện làm gì | Cần đổi |
|---|---|---|
| `src/routes/internal.routes.ts:611-620, 624, 648` | Hoa hồng giới thiệu khoá theo `transactionId`, `gymId`, `ptUserId`, `idempotencyKey` | Không đổi |
| `src/services/membership-ledger.service.ts:61-76, 134-148, 232-248` | Ví `GYM` lấy theo `gymId` | Không đổi |
| `src/services/contract-ledger.service.ts:57, 74-79` | Ví `GYM` theo `parties.gymId`; lỗi nếu có phần gym mà thiếu `gymId` | Không đổi |
| `src/routes/internal.routes.ts:758-773` | Rút tiền theo `gymId` | Không đổi |

Không có chỗ nào trong payment-service khoá theo mã collaboration (tìm `collaborat` chỉ ra một chú thích tại `internal.routes.ts:319`). Vì hợp đồng vẫn chọn một chi nhánh và tiền vẫn về ví chi nhánh đó, payment-service không cần đổi.

### A.4 Gateway (`backend/gateway/src/routes/proxy.routes.ts`)

| Dòng | Tuyến | Cần đổi |
|---|---|---|
| `1551` | `GET /gyms/:gymId/trainers` | Mục E |
| `1618-1629` | `/pt/gym-invitations`, `/pt/gym-affiliations` (vai trò `PT`) | Mục E |
| `1632-1649` | `POST /gyms/:gymId/collaborations`, `PATCH/DELETE /collaborations/:id` (vai trò `PT`) | Tuyến PT theo thương hiệu phải khai báo riêng |
| `1651-1656` | `GET /me/collaborations` (`PT`, `GYM_OWNER`) | Không đổi |
| `1658-1661` | `GET /pt/:ptUserId/gyms`, không xác thực | Không đổi |
| `1675-1680` | `/owner/gyms` (bao trùm) | Không đổi |
| `1684-1689` | `/owner/brands` (bao trùm) | Tuyến chủ gym đặt dưới `/owner/brands/...` sẽ tự đi qua |
| `1702-1707` | `/owner/collaborations` | Không đổi |
| `1588-1593` | `/me/gym-checkins` (`CUSTOMER`, `PT`) | Không đổi cho thay đổi 2 |

Gateway chỉ chuyển tiếp các tiền tố được khai báo tường minh (chú thích tại `:1681-1683`, `:1709-1710`), nên tiền tố mới không có ở đây sẽ trả 404.

### A.5 `frontend/web/src`

| Vị trí | Hiện làm gì | Cần đổi |
|---|---|---|
| `app/services/api.ts:5355-5397` `collaborationService` | Bảy hàm; `terminate` gọi `DELETE` không có thân (`:5392-5396`) nên luôn chấm dứt ngay | Tuyến theo thương hiệu; gửi ngày hiệu lực |
| `app/services/api.ts:5413-5416` `listTrainers` | Có định nghĩa, không nơi nào gọi | Mục E |
| `app/services/api.ts:5590` | Kiểu trả về `closureImpact` có `activeCollaborations` | Đổi nghĩa |
| `app/components/gym/CollaborationPanel.tsx:10-23` | Kiểu `Collaboration` có `gymId`, không có `effectiveAt` | Thêm `brandId`, `effectiveAt` |
| Các trang dùng: xem mục F | | |

### A.6 `frontend/mobile`

| Vị trí | Hiện làm gì | Cần đổi |
|---|---|---|
| `src/services/api.ts:5994-6035` `collaborationService` | Cùng bảy hàm như web | Như web |
| `src/services/api.ts:6052-6053` `listTrainers` | Có định nghĩa, không nơi nào gọi | Mục E |
| `src/features/collaboration/collaboration.ts:17-37` `CollabRow` | Có `gymId`, `gym` | Thêm `brandId` |
| `src/features/gymOwner/gymOwner.ts:313-316` `acceptedCollabCount` | Lọc `c.gymId === gymId`; chú thích "a collaboration is per gym, not per brand" | Đổi logic |
| `src/features/services/ptDiscovery.ts:286-319` | `normalizePartnerGyms`, `ratesLabel` | Giữ nếu điểm cuối vẫn trả theo chi nhánh |
| `src/features/__tests__/gymOwner.test.ts:273` | Khẳng định "a collaboration belongs to one branch not the whole brand" | Viết lại |
| `src/features/__tests__/pt.test.ts:215-241`, `gymOwnerClusterB.test.ts:27`, `ptDiscovery.test.ts:322-330` | Kiểm nhãn trạng thái và hình dạng dữ liệu | Rà lại |
| Các màn dùng: xem mục F | | |

### A.7 Chưa kiểm tra

Các kho kiểm thử ngoài monorepo (`D:\fitnessassistant-playwright-e2e`, `D:\fitnessassistant-mobile-e2e`, bộ demo) chưa được đọc. Trong monorepo, `scripts/partner-application-e2e/api-e2e.mjs:155, 164-165` có gọi `/owner/collaborations` và `/me/collaborations`.

---

## B. Phân loại dữ liệu

**Chưa chạy truy vấn nào.** `docker ps -a` lúc 16:40 cho thấy cả ngăn xếp đã dừng, gồm `gymcoach-postgres` (Exited (0), 16 giờ trước). Không có tiến trình nào nghe cổng 5432 hoặc 5433. Theo chỉ dẫn, tôi không khởi động ngăn xếp.

Thông tin kết nối (`CODE AUDIT`):

- Container `gymcoach-postgres`; người dùng mặc định `gymcoach` (`infra/compose/docker-compose.dev.yml:899`).
- gym-service dùng cơ sở dữ liệu `gymcoach_gym`, user-service dùng `gymcoach_user` (`infra/compose/postgres-init.sql`, `docker-compose.dev.yml:236, 899`).
- `backend/services/user-service/.env` lại trỏ tới `localhost:5433/gym_coach_users`, khác tên với cơ sở dữ liệu của ngăn xếp Docker. Cần xác định đúng cơ sở dữ liệu trước khi chạy.
- Hai cơ sở dữ liệu tách rời nên không nối bảng trực tiếp được; nhóm 7 chạy riêng.

Cách chạy tối thiểu (chỉ khởi động Postgres, phiên chỉ đọc):

```bash
docker start gymcoach-postgres
docker exec -i gymcoach-postgres psql -U gymcoach -d gymcoach_gym -v ON_ERROR_STOP=1
```

Các câu SQL dưới đây được viết từ lược đồ Prisma và tệp migration, chưa từng được thực thi; cần chạy thử trước khi dựa vào kết quả.

### B.1 Truy vấn trên `gymcoach_gym` (chưa chạy)

```sql
BEGIN READ ONLY;

-- Tổng quan theo trạng thái
SELECT status, count(*) FROM gym_pt_collaborations GROUP BY status ORDER BY status;

-- Nhóm 1, 2, 3: ACCEPTED, chưa bắt đầu chấm dứt, phòng gym có thương hiệu
WITH acc AS (
  SELECT col.id, col.gym_id, g.brand_id, col.pt_user_id,
         col.proposed_pt_rate, col.proposed_gym_rate, col.platform_rate, col.accepted_at
  FROM gym_pt_collaborations col
  JOIN gyms g ON g.id = col.gym_id
  WHERE col.status = 'ACCEPTED' AND col.effective_at IS NULL AND g.brand_id IS NOT NULL
),
grp AS (
  SELECT brand_id, pt_user_id,
         count(*) AS n_rows,
         count(DISTINCT (proposed_pt_rate, proposed_gym_rate, platform_rate)) AS n_rate_tables
  FROM acc GROUP BY brand_id, pt_user_id
)
SELECT
  count(*) FILTER (WHERE n_rows = 1)                        AS nhom1_mot_thoa_thuan,
  count(*) FILTER (WHERE n_rows > 1 AND n_rate_tables = 1)  AS nhom2_nhieu_cung_ty_le,
  count(*) FILTER (WHERE n_rows > 1 AND n_rate_tables > 1)  AS nhom3_nhieu_khac_ty_le
FROM grp;

-- Nhóm 3: từng dòng (chỉ mã và tỷ lệ)
WITH acc AS (
  SELECT col.id, col.gym_id, g.brand_id, col.pt_user_id,
         col.proposed_pt_rate, col.proposed_gym_rate, col.platform_rate, col.accepted_at
  FROM gym_pt_collaborations col
  JOIN gyms g ON g.id = col.gym_id
  WHERE col.status = 'ACCEPTED' AND col.effective_at IS NULL AND g.brand_id IS NOT NULL
),
grp AS (
  SELECT brand_id, pt_user_id,
         count(*) AS n_rows,
         count(DISTINCT (proposed_pt_rate, proposed_gym_rate, platform_rate)) AS n_rate_tables
  FROM acc GROUP BY brand_id, pt_user_id
)
SELECT a.brand_id, a.pt_user_id, a.id AS collaboration_id, a.gym_id,
       a.proposed_pt_rate, a.proposed_gym_rate, a.platform_rate, a.accepted_at
FROM acc a JOIN grp USING (brand_id, pt_user_id)
WHERE grp.n_rows > 1 AND grp.n_rate_tables > 1
ORDER BY a.brand_id, a.pt_user_id, a.accepted_at;

-- Nhóm 4: đang thương thảo
SELECT count(*)                                                        AS dong_dang_mo,
       count(*) FILTER (WHERE col.expires_at < now())                  AS da_qua_han_chua_duoc_danh_dau,
       count(DISTINCT (g.brand_id, col.pt_user_id))
         FILTER (WHERE g.brand_id IS NOT NULL)                         AS cap_thuong_hieu_pt
FROM gym_pt_collaborations col JOIN gyms g ON g.id = col.gym_id
WHERE col.status IN ('PENDING', 'COUNTERED');

-- Nhóm 5: đã chấm dứt, hoặc ACCEPTED có effective_at
SELECT count(*) FILTER (WHERE status = 'TERMINATED')                                              AS da_cham_dut,
       count(*) FILTER (WHERE status = 'ACCEPTED' AND effective_at >  now())                      AS dang_bao_truoc,
       count(*) FILTER (WHERE status = 'ACCEPTED' AND effective_at <= now())                      AS qua_han_chua_hoan_tat
FROM gym_pt_collaborations;

-- Cặp (thương hiệu, PT) vừa có dòng sạch vừa có dòng đang chấm dứt
SELECT g.brand_id, col.pt_user_id,
       count(*) FILTER (WHERE col.effective_at IS NULL)     AS dong_sach,
       count(*) FILTER (WHERE col.effective_at IS NOT NULL) AS dong_dang_cham_dut
FROM gym_pt_collaborations col JOIN gyms g ON g.id = col.gym_id
WHERE col.status = 'ACCEPTED' AND g.brand_id IS NOT NULL
GROUP BY g.brand_id, col.pt_user_id
HAVING count(*) FILTER (WHERE col.effective_at IS NULL) > 0
   AND count(*) FILTER (WHERE col.effective_at IS NOT NULL) > 0;

-- Nhóm 6: thoả thuận trên phòng gym không có thương hiệu
SELECT col.status, count(*)
FROM gym_pt_collaborations col JOIN gyms g ON g.id = col.gym_id
WHERE g.brand_id IS NULL GROUP BY col.status ORDER BY col.status;

SELECT count(*) FILTER (WHERE b.id IS NOT NULL) AS chu_gym_da_co_thuong_hieu,
       count(*) FILTER (WHERE b.id IS NULL)     AS chu_gym_chua_co_thuong_hieu
FROM gym_pt_collaborations col
JOIN gyms g ON g.id = col.gym_id
LEFT JOIN gym_brands b ON b.owner_id = g.owner_id
WHERE g.brand_id IS NULL;

-- Kiểm tra phụ: chi nhánh có thương hiệu thuộc chủ khác
SELECT count(*) FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE b.owner_id <> g.owner_id;

-- Kiểm tra phụ cho mục E: affiliation ACTIVE không có thoả thuận ACCEPTED
SELECT a.visibility, count(*)
FROM gym_trainer_affiliations a
WHERE a.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM gym_pt_collaborations c
                  WHERE c.gym_id = a.gym_id AND c.pt_user_id = a.pt_id AND c.status = 'ACCEPTED')
GROUP BY a.visibility;

ROLLBACK;
```

### B.2 Truy vấn trên `gymcoach_user` (chưa chạy)

```sql
BEGIN READ ONLY;

-- Nhóm 7: hợp đồng tham chiếu gym_id
SELECT count(*)                                                                       AS hop_dong_co_gym,
       count(DISTINCT gym_id)                                                         AS so_gym,
       count(*) FILTER (WHERE status = 'ACTIVE')                                      AS dang_chay,
       count(*) FILTER (WHERE status IN ('PENDING_REVIEW','PENDING_SIGNATURE','PENDING_PAYMENT')) AS dang_cho
FROM contracts WHERE gym_id IS NOT NULL;

-- Dữ liệu lệch giữa gym_id, source và gym_rate
SELECT count(*) FROM contracts
WHERE (gym_id IS NOT NULL AND source <> 'GYM')
   OR (gym_id IS NULL AND source = 'GYM')
   OR (gym_id IS NULL AND gym_rate > 0);

-- Có cột nào tham chiếu collaboration không
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (column_name ILIKE '%collab%' OR column_name ILIKE '%agreement%');

-- Hình thức buổi tập của hợp đồng gắn phòng gym (phục vụ mục G)
SELECT s.session_mode, s.status, count(*)
FROM sessions s JOIN contracts c ON c.id = s.contract_id
WHERE c.gym_id IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

ROLLBACK;
```

Về câu "có hợp đồng nào tham chiếu mã collaboration không": theo lược đồ thì không thể có, vì model `Contract` không có cột đó (`user-service/prisma/schema.prisma:552-673`, `CODE AUDIT`). Truy vấn `information_schema` ở trên để xác nhận trên cơ sở dữ liệu thật.

---

## C. Thiết kế di trú

Toàn bộ mục này là `ĐỀ XUẤT`, dựa trên các dữ kiện `CODE AUDIT` được dẫn kèm.

### C.1 Ràng buộc của kho mã

- Migration viết tay bằng SQL. `Dockerfile:51` và `Dockerfile.dev:30` chạy `prisma migrate deploy` mỗi lần container khởi động, nên tệp migration mới sẽ tự áp dụng vào dev ở lần khởi động kế tiếp. `CODE AUDIT`
- `package.json:10` có script `db:migrate` = `prisma migrate dev`. Không được chạy script này (hay `migrate reset`) lên dev. `CODE AUDIT`
- Về lệch lược đồ trong gym-service: mọi model đều có `CREATE TABLE` và mọi enum đều có `CREATE TYPE` trong thư mục migration (đã đối chiếu tên bảng và tên enum; chưa đối chiếu từng cột). Tuy vậy có hai chỉ mục duy nhất một phần chỉ tồn tại trong SQL, không có trong `schema.prisma`: `gym_pt_collaborations_accepted_pair_key` (`20260811085507:11-13`) và `unique_open_membership_per_gym` (`20260626000001:106-108`). `prisma migrate dev` hoặc `migrate diff` sẽ coi chúng là thừa và đề nghị xoá. Chú thích tại `schema.prisma:999-1001` ghi lại đúng sự cố loại này đã xảy ra. `CODE AUDIT`
- Lệch lược đồ của user-service (model không có migration) đã được ghi nhận từ trước; tôi không kiểm lại trong lần này. Điều này liên quan vì mục D đề nghị thêm cột vào `contracts`.
- Một tác tử khác vừa thêm migration `20261009000000_gym_closed_by` (thêm cột `gyms.closed_by`, chưa được git theo dõi). Dấu thời gian của migration mới phải đứng sau tệp này và sau mọi tệp họ thêm tiếp.

### C.2 Thêm cột vào bảng cũ hay tạo bảng mới

Khuyến nghị: **tạo bảng mới cho thoả thuận cấp thương hiệu, giữ `gym_pt_collaborations` làm bản ghi điều khoản cũ**, chỉ thêm vào bảng cũ vài cột đánh dấu có thể null.

Lý do:

1. Quy tắc cứng buộc nhóm 3 phải giữ nhiều dòng `ACCEPTED` cho cùng (thương hiệu, PT). Nếu dùng chung một bảng, chỉ mục duy nhất `(brand_id, pt_user_id) WHERE status = 'ACCEPTED'` không tạo được cho tới khi mọi xung đột được giải quyết. Với bảng mới, ràng buộc này có ngay từ lúc tạo bảng.
2. Điều khoản cũ (tỷ lệ, `acceptedAt`, trạng thái) không bao giờ bị ghi đè, nên lùi lại chỉ là ngừng đọc bảng mới.
3. Chỉ mục duy nhất hiện có và các kiểm thử hiện có vẫn đúng cho dòng cũ.
4. Hai bảng có cùng hình dạng thương thảo (`proposedBy`, `round`, `expiresAt`), nên mã dịch vụ tham số hoá được.

Cái giá: bộ phân giải phải đọc hai bảng trong giai đoạn chuyển đổi.

Phương án thay thế (thêm `brand_id` và cột phạm vi vào bảng cũ) giữ nguyên mã dòng, nhưng chỉ mục duy nhất mới phải có thêm điều kiện phân biệt phạm vi, và `gym_id` phải đổi nghĩa thành "chi nhánh gốc".

### C.3 Lược đồ phác thảo

```sql
-- Bảng mới
CREATE TABLE "gym_brand_pt_agreements" (
  "id" TEXT PRIMARY KEY,
  "brand_id" TEXT NOT NULL REFERENCES "gym_brands"("id") ON DELETE RESTRICT,
  "pt_user_id" TEXT NOT NULL,
  "proposed_pt_rate" DECIMAL(6,4) NOT NULL,
  "proposed_gym_rate" DECIMAL(6,4) NOT NULL,
  "platform_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.10,
  "status" "CollaborationStatus" NOT NULL DEFAULT 'PENDING',
  "proposed_by" "CollaborationParty" NOT NULL,
  "round" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "termination_initiated_at" TIMESTAMP(3),   -- mới: mốc phân biệt hợp đồng cũ và mới
  "effective_at" TIMESTAMP(3),
  "terminated_at" TIMESTAMP(3),
  "terminated_by" TEXT,
  "origin" TEXT NOT NULL DEFAULT 'NATIVE',   -- NATIVE | MIGRATED
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "gym_brand_pt_agreements_accepted_key"
  ON "gym_brand_pt_agreements" ("brand_id", "pt_user_id") WHERE "status" = 'ACCEPTED';
CREATE UNIQUE INDEX "gym_brand_pt_agreements_open_key"
  ON "gym_brand_pt_agreements" ("brand_id", "pt_user_id") WHERE "status" IN ('PENDING', 'COUNTERED');
CREATE INDEX ON "gym_brand_pt_agreements" ("pt_user_id", "status");

-- Bảng xung đột (nhóm 3)
CREATE TABLE "gym_pt_agreement_conflicts" (
  "id" TEXT PRIMARY KEY,
  "brand_id" TEXT NOT NULL,
  "pt_user_id" TEXT NOT NULL,
  "legacy_collaboration_ids" TEXT[] NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',      -- OPEN | RESOLVED
  "resolved_agreement_id" TEXT,
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX ON "gym_pt_agreement_conflicts" ("brand_id", "pt_user_id") WHERE "status" = 'OPEN';

-- Cột đánh dấu trên bảng cũ, đều cho phép null
ALTER TABLE "gym_pt_collaborations"
  ADD COLUMN "superseded_by_agreement_id" TEXT,
  ADD COLUMN "superseded_at" TIMESTAMP(3),
  ADD COLUMN "termination_initiated_at" TIMESTAMP(3);
```

Chỉ mục duy nhất thứ hai (một thương thảo đang mở cho mỗi cặp) là bổ sung: hiện tại bảng cũ chỉ có ràng buộc cho `ACCEPTED`, còn "một thương thảo đang mở" chỉ được kiểm ở tầng ứng dụng (`collaboration.service.ts:142-156`). `CODE AUDIT`

### C.4 Điền dữ liệu

Việc điền dữ liệu **không** nằm trong tệp migration, vì tệp đó tự chạy lúc khởi động và không có chế độ chạy thử. Dùng một script riêng trong gym-service, và một job tương ứng trong `jobs-lambda.ts` cho môi trường Lambda (theo khuôn `GymServiceJobName`, `jobs-lambda.ts:8-36`).

Quy tắc cho từng nhóm:

| Nhóm | Hành động |
|---|---|
| 1 (một dòng `ACCEPTED`) | Tạo một thoả thuận thương hiệu `ACCEPTED`, `origin = MIGRATED`, cùng ba tỷ lệ, `accepted_at` giữ nguyên. Ghi `superseded_by_agreement_id` lên dòng cũ. **Chờ câu hỏi 1.** |
| 2 (nhiều dòng, cùng tỷ lệ) | Tạo một thoả thuận; `accepted_at` lấy mốc sớm nhất; đánh dấu mọi dòng cũ. **Chờ câu hỏi 1.** |
| 3 (nhiều dòng, khác tỷ lệ) | Không tạo thoả thuận. Không sửa dòng cũ nào. Tạo một dòng trong `gym_pt_agreement_conflicts` liệt kê mã các dòng cũ. Không dùng mới nhất, cao nhất, thấp nhất hay trung bình. |
| 4 (`PENDING`/`COUNTERED`) | Không chuyển đổi tự động: đề xuất cho một chi nhánh không phải là sự đồng ý cho cả thương hiệu. **Chờ câu hỏi 3.** Lưu ý mỗi đề xuất chỉ sống 7 ngày kể từ lần ra giá gần nhất và tối đa 5 vòng (`collaboration.service.ts:14-16`), nên nếu chặn đề xuất mới trên bảng cũ thì các dòng này tự cạn. |
| 5 (`TERMINATED`, hoặc `ACCEPTED` có `effective_at`) | Không tạo thoả thuận. Dòng `ACCEPTED` có `effective_at` tiếp tục đi tới `TERMINATED` theo luật cũ. Điền `termination_initiated_at` bằng `updated_at` và ghi rõ đây là ước lượng. |
| 6 (phòng gym không thương hiệu) | Để nguyên ở bảng cũ. **Chờ câu hỏi 4.** |
| Cặp vừa có dòng sạch vừa có dòng đang chấm dứt | Coi như xung đột: tạo dòng xung đột, không tạo thoả thuận. |

Giải quyết nhóm 3: chủ gym và PT thương thảo một thoả thuận thương hiệu bằng đúng luồng `propose → respond`. Khi thoả thuận đó được `ACCEPTED`, cùng transaction đánh dấu mọi dòng cũ của cặp là đã thay thế và đóng dòng xung đột. Tỷ lệ trên dòng cũ không bị sửa.

### C.5 Chạy thử, báo cáo xung đột, chạy lại, lùi lại

- **Chạy thử là mặc định.** Script chỉ ghi khi có cờ `--apply`. Ở chế độ chạy thử, script chạy cùng các truy vấn phân loại như mục B.1 trong một transaction `READ ONLY` và in số lượng từng nhóm cùng danh sách hành động dự kiến.
- **Báo cáo xung đột.** Xuất một tệp (JSON hoặc CSV) gồm `brand_id`, `pt_user_id`, và với mỗi dòng cũ: `collaboration_id`, `gym_id`, ba tỷ lệ, `accepted_at`. Không có tên, email hay số điện thoại.
- **Chạy lại không gây trùng.** Chỉ xử lý dòng cũ có `superseded_by_agreement_id IS NULL`. Trước khi chèn, kiểm thoả thuận `ACCEPTED` đã tồn tại cho cặp; chỉ mục duy nhất là chốt cuối. Dòng xung đột dùng chỉ mục duy nhất trên trạng thái `OPEN`. Mỗi cặp một transaction, để một cặp lỗi không chặn các cặp khác.
- **Lùi lại.** Trước khi chuyển ghi sang bảng mới: xoá các thoả thuận `origin = MIGRATED`, đặt lại `superseded_*` về null, xoá dòng xung đột. Bảng cũ chưa hề bị đổi điều khoản nên trạng thái trở về đúng như trước. Sau khi đã có thoả thuận `NATIVE` được ký trên bảng mới thì chỉ còn đi tiếp, không lùi được mà không mất dữ liệu thật.
- **Đi tiếp.** Bộ phân giải đọc theo một cờ cấu hình ba mức: chỉ bảng cũ, cả hai, chỉ bảng mới.

### C.6 Thứ tự chuyển đổi và thời điểm áp ràng buộc duy nhất

1. Migration chỉ thêm (mục C.3). Chưa có mã nào đọc. Ràng buộc duy nhất của bảng mới có hiệu lực ngay.
2. Triển khai mã với bộ phân giải ở mức "chỉ bảng cũ". Hành vi không đổi.
3. Chạy thử script, chủ sở hữu duyệt báo cáo, trả lời câu hỏi 1–4.
4. Chạy script với `--apply`. Chuyển cờ sang "cả hai": ưu tiên thoả thuận thương hiệu, không có thì dùng dòng cũ chưa bị thay thế của đúng chi nhánh đó.
5. Chuyển ghi: `propose`, `respond`, `terminate` mới ghi vào bảng mới. Các mã dòng cũ vẫn dùng được cho `REJECT` và `terminate`.
6. Khi không còn dòng xung đột `OPEN`, không còn dòng cũ `PENDING`/`COUNTERED`, và nhóm 6 đã có quyết định: chuyển cờ sang "chỉ bảng mới". Bảng cũ giữ lại để tra cứu.

Nếu chọn phương án một bảng, chỉ mục duy nhất mới chỉ áp được sau bước 6, và sau khi truy vấn tìm cặp trùng trả về không dòng. `SUY LUẬN`: `CREATE INDEX CONCURRENTLY` không chạy được trong một migration nhiều câu lệnh của Prisma, nên cần một tệp migration chỉ chứa đúng câu lệnh đó.

### C.7 Giữ cho tham chiếu cũ hoạt động

- `GET /internal/collaborations/active?gymId=&ptUserId=` giữ nguyên chữ ký và mã lỗi, nên user-service không cần đổi để tiếp tục chạy.
- `GET /pt/:ptUserId/gyms` tiếp tục trả `[{ collaborationId, gym, rates }]` theo từng chi nhánh, nên hai ứng dụng khách không vỡ. Mobile đọc `row.gym.id` chứ không đọc `collaborationId` (`ptDiscovery.ts:299-310`). `CODE AUDIT`
- `GET /me/collaborations` và `GET /owner/collaborations` trả hợp nhất hai bảng, thêm trường phạm vi. Giao diện cũ đọc `c.gym?.name ?? c.gymId.slice(0, 8)` (`CollaborationPanel.tsx:164`), nên dòng cấp thương hiệu không có `gymId` sẽ làm vỡ màn hình cũ; cần trả trường tương thích hoặc cập nhật giao diện cùng lúc. `CODE AUDIT`

---

## D. `activeRates(gymId, ptUserId)` ở cấp thương hiệu

### D.1 Hiện trạng (`CODE AUDIT`, `collaboration.service.ts:393-414`)

Điều kiện trong cây làm việc lúc 16:55: cùng `gymId` và `ptUserId`, cộng bộ lọc dùng chung `NEW_CONTRACT_ELIGIBLE` (`:47-51`): `status = 'ACCEPTED'`, `effectiveAt IS NULL`, `gym.status = 'APPROVED'`, `gym.operationalStatus = 'OPEN'`. Lấy dòng `acceptedAt` mới nhất. Trả `collaborationId`, `platformRate`, `ptRate`, `gymRate`.

Điều kiện `OPEN` là thay đổi chưa commit của tác tử khác; tại `dd42451` hàm chỉ kiểm `APPROVED`. Mua gói và check-in đã kiểm cả hai trục từ trước (`membership.service.ts:100`, `checkin.service.ts:99`).

Điều kiện **không** có:

- Trạng thái đối tác. `partnerGuard.assertAcceptsNewMoney` chỉ được gọi khi chủ gym đề xuất (`collaboration.controller.ts:63`).
- PT còn hoạt động. user-service kiểm `ptSuspended` trước khi gọi (`contract.service.ts:323-324`), gym-service không kiểm.

### D.2 Thứ tự phân giải đề xuất (`ĐỀ XUẤT`)

1. Đọc `gym` theo `gymId`. Không có → không có thoả thuận.
2. Giữ: `gym.status = 'APPROVED'`.
3. Giữ: `gym.operationalStatus = 'OPEN'` (vừa được thêm trong cây làm việc).
4. Thêm: đối tác sở hữu không ở `SUSPENDED` hoặc `TERMINATED` (chờ câu hỏi 10).
5. `gym.brandId` có giá trị → tìm thoả thuận thương hiệu: `brandId`, `ptUserId`, `status = 'ACCEPTED'`, `effectiveAt IS NULL`, không có hạn chế khẩn cấp.
6. Nếu thoả thuận cho phép loại trừ chi nhánh (chờ câu hỏi 5): chi nhánh này không bị loại trừ.
7. Không có thoả thuận thương hiệu, hoặc `gym.brandId` là null → dùng dòng cũ của đúng `(gymId, ptUserId)`: `ACCEPTED`, `effectiveAt IS NULL`, `superseded_at IS NULL`. Nhánh này phục vụ nhóm 3 và nhóm 6.
8. Trả `{ agreementId, scope: 'BRAND' | 'LEGACY_BRANCH', brandId, gymId, platformRate, ptRate, gymRate }`. Giữ thêm khoá `collaborationId` để tương thích.

Phải giữ phân biệt "không có thoả thuận" (404) với "không gọi được" (lỗi), đúng như `gym.client.ts:46-48` và `contract.service.ts:369-382` đang làm.

Cần tách hai câu hỏi mà hiện đang dùng chung một hàm:

- **Được ký hợp đồng mới không?** Các điều kiện ở trên, gồm cả `effectiveAt IS NULL`.
- **Hợp đồng có sẵn này còn được thực hiện không?** Dùng cho check-in PT và giai đoạn kết thúc. Điều kiện khác hẳn: bỏ qua `effectiveAt`, chấp nhận cả `TERMINATED` theo đường thông thường, nhưng vẫn kiểm chi nhánh đang hoạt động và hạn chế khẩn cấp. Xem mục L.

Để trả lời được câu thứ hai, user-service nên lưu `gymAgreementId` và `gymAgreementScope` lên hợp đồng lúc tạo (hiện `collaborationId` bị bỏ tại `contract.service.ts:383`).

### D.3 Các hàm khác cần cùng cách phân giải

| Hàm | Vị trí | Ghi chú |
|---|---|---|
| `listAcceptedGymsForPt` | `collaboration.service.ts:368-390` | Phải trả đúng tập chi nhánh mà `activeRates` chấp nhận. Trong cây làm việc hai hàm đã dùng chung một bộ lọc; bộ phân giải mới phải giữ tính chất này |
| `resolveReferral` | `membership.service.ts:177-194` | Qua `activeRates`. Xem câu hỏi 11 |
| `propose` (kiểm tồn tại) | `collaboration.service.ts:142-156` | Theo `(brandId, ptUserId)`; nên hoàn tất chấm dứt quá hạn trước khi kiểm |
| `respond` (`ACCEPT`) | `:213-237` | Kiểm lại điều kiện chi nhánh và đối tác tại thời điểm chấp nhận |
| `terminate`, `finalizeIfEffective` | `:304-334`, `:99-115` | Tác động affiliation theo mọi chi nhánh |
| `listFor` (phía chủ gym) | `:346-352` | Theo thương hiệu |
| `assertParty` | `:417-427` | Chủ của thương hiệu |
| `closureImpact` | `gym.service.ts:476` | Thoả thuận bao phủ chi nhánh |
| Bộ kiểm quyền check-in PT | mới | Mục G, H |
| `partnerService.terminationImpact` | `partner.service.ts:462-499` | Hiện không đếm thoả thuận PT; cân nhắc thêm |
| Đếm phía khách | web `GymOwnerDashboard.tsx:252-254`; mobile `gymOwner.ts:314-316` | Đang lọc `c.gymId === activeGymId` |

---

## E. Affiliation và collaboration

Mọi dữ kiện trong mục này là `CODE AUDIT`, trừ phần ghi `ĐỀ XUẤT`.

**Affiliation `ACTIVE` có được tạo mà không cần collaboration được chấp nhận không? Có.**

- `affiliationService.invite` (`affiliation.service.ts:13-23`): chủ gym tạo affiliation cho một `ptId` bất kỳ lấy từ thân yêu cầu. Chỉ kiểm quyền sở hữu chi nhánh. Không kiểm `ptId` là PT, không kiểm thoả thuận. `commissionRate` và `visibility` nhận thẳng từ thân yêu cầu.
- `affiliationService.respond` (`:33-43`): PT chấp nhận → `status = 'ACTIVE'`, `joinedAt = now`.
- Tuyến: `POST /owner/gyms/:gymId/trainers` (`owner.routes.ts:161`), `PATCH /pt/gym-invitations/:id` (`pt.routes.ts:15`). Cả hai đều đi qua gateway (`proxy.routes.ts:1675-1680`, `1618-1623`).
- Tạo trùng `(gymId, ptId)` sẽ vi phạm ràng buộc duy nhất; controller không bắt riêng lỗi này nên trả 500 (`affiliation.controller.ts:17-19`).

**Ai đọc affiliation?**

| Nơi đọc | Vị trí |
|---|---|
| Danh sách PT công khai của chi nhánh | `findPublicByGym` (`affiliation.repository.ts:20-35`) → `GET /gyms/:gymId/trainers` (`public.routes.ts:16`). Trong cây làm việc, điểm cuối này không còn trả `commissionRate` và `invitedBy`; tại `dd42451` nó trả cả dòng |
| Lời mời đang chờ của PT | `findPendingByPT` (`:41-43`) → `GET /pt/gym-invitations` |
| Mọi affiliation của PT | `findByPT` (`:37-39`) → `GET /pt/gym-affiliations` |

Không còn nơi nào khác. Check-in không đọc affiliation (toàn bộ `checkin.service.ts`). Chú thích tại `collaboration.service.ts:222-223` nói affiliation "grants the trainer free check-in and floor access", nhưng không có mã nào thực hiện điều đó.

Phía giao diện: `listTrainers` có trong `api.ts` của web (`:5413`) và mobile (`:6052`) nhưng không màn hình nào gọi. Tìm `gym-invitations` và `gym-affiliations` trong `frontend/web/src` và `frontend/mobile` không có kết quả. Vậy luồng mời và danh sách công khai hiện chỉ dùng được qua API.

**Hai bản sao của cùng một con số.** Khi chấp nhận collaboration, `proposedGymRate` được chép sang `affiliation.commissionRate` (`collaboration.service.ts:230, 233`). Luồng mời lại cho chủ gym tự nhập `commissionRate` (`affiliation.service.ts:19`). Không tính toán tiền nào đọc `commissionRate`.

**`visibility` mặc định là `PUBLIC`** (`schema.prisma:1090`). Lệnh upsert khi chấp nhận không đặt `visibility`, nên PT tự xuất hiện công khai ở chi nhánh đó.

**Khuyến nghị (`ĐỀ XUẤT`):**

- Thoả thuận cấp thương hiệu là nguồn sự thật duy nhất cho quan hệ thương mại: tỷ lệ, vòng đời, chấm dứt, quyền check-in.
- Affiliation trở thành bản ghi trình bày theo chi nhánh: PT hiển thị ở chi nhánh nào, công khai hay nội bộ, hình thức làm việc. Nó không cấp quyền gì và chỉ có hiệu lực khi có thoả thuận còn hiệu lực bao phủ chi nhánh đó.
- Bỏ `commissionRate` khỏi vai trò dữ liệu sống: ngừng ghi, giữ cột.
- Không tự tạo affiliation `PUBLIC` cho mọi chi nhánh khi thoả thuận thương hiệu được chấp nhận. Nếu làm vậy, PT bị liệt kê công khai ở những nơi chưa từng làm việc. Chờ câu hỏi 12.
- Luồng mời độc lập nên bị đóng, hoặc chỉ cho phép khi đã có thoả thuận.
- Trước khi quyết, chạy truy vấn "affiliation `ACTIVE` không có thoả thuận" ở mục B.1 để biết có bao nhiêu dòng như vậy.

---

## F. Kiểm kê giao diện

Chỉ liệt kê, không thiết kế. Mọi dòng là `CODE AUDIT`.

### F.1 Web

| Trang hoặc thành phần | Hiện hiển thị gì | Cần đổi gì |
|---|---|---|
| `pages/gym-owner/GymCollaborationsPage.tsx` (tuyến `/gym-owner/collaborations`, `routes.tsx:315`; mục "Quản lý cộng tác" trong `Sidebar.tsx:91`, chỉ chủ sở hữu) | Mọi collaboration của mọi chi nhánh; phản hồi, ra giá lại, chấm dứt. Không tạo đề xuất mới ở đây | Trở thành nơi chính; mỗi dòng là một PT thay vì một cặp PT–chi nhánh; thêm trạng thái báo trước và xung đột |
| `components/gym/CollaborationPanel.tsx` (dùng chung) | Danh sách: tên chi nhánh hoặc `PT <8 ký tự mã>` (`:164-165`). Nút đề xuất chỉ hiện khi có `gymId` (`:127`). Chủ gym mời bằng cách gõ mã người dùng của PT (`:52, 100`). Tỷ lệ mặc định 55/35, nền tảng cố định 10. "Chấm dứt hợp tác" gọi ngay, không chọn ngày (`:112-119`, `:218`) | Bỏ phụ thuộc `gymId`; hiển thị phạm vi thương hiệu; chấm dứt có báo trước; hiển thị ngày hiệu lực |
| `pages/gym-owner/GymManagePage.tsx:599-605` | Bảng collaboration của riêng chi nhánh, nơi tạo đề xuất mới | Bỏ hoặc chuyển thành chỉ xem |
| `pages/gym-owner/GymManagePage.tsx:431` | Cảnh báo đóng cửa: "N cộng tác PT đang hoạt động tại chi nhánh này" | Đổi cách đếm và câu chữ |
| `pages/gym-owner/GymManagePage.tsx:597` → `components/gym/GymCheckinPanel.tsx` | Mã QR và 6 lượt check-in gần nhất theo `clientId` rút gọn (`:36-40, 107-113`) | Thay đổi 2: phân biệt PT với hội viên |
| `pages/gym-owner/GymOwnerDashboard.tsx:241-254` | Chỉ số số PT hợp tác của chi nhánh đang chọn | Đổi cách đếm |
| `pages/gym-owner/GymOwnerDashboard.tsx:226-231, 249, 83-89, 310` | "Check-in hôm nay" và biểu đồ 7 ngày, tính trên trình duyệt từ tối đa 50 dòng gần nhất (`checkin.repository.ts:4-10`) | Thay đổi 2: quyết định có tính PT hay không |
| `pages/pt/PTProfilePage.tsx:241-247, 867-887` | PT chọn một phòng gym trong danh sách công khai rồi gửi đề xuất; xem và phản hồi | Chọn thương hiệu thay vì chi nhánh |
| `pages/client/PTDiscoveryPage.tsx:286-290, 1337-1371` | Khách chọn "Tập tại phòng gym nào?" từ `GET /pt/:id/gyms`; dòng mô tả chia doanh thu | Danh sách thành mọi chi nhánh đủ điều kiện. Dòng `:1364` đọc `g.ptRate`, `g.gymRate`, `g.platformRate` ở cấp ngoài, trong khi API trả lồng trong `rates` (`collaboration.service.ts:381-389`); `SUY LUẬN`: dòng này đang hiển thị `NaN%` |
| `components/gym/CheckinScanModal.tsx` (mở từ `pages/client/GymMembershipsPage.tsx:217`) | Quét mã; bảng thông báo lỗi `:8-15` không có `GYM_NOT_ACTIVE` | Thay đổi 2: thông báo và thẻ kết quả cho PT |
| `types/index.ts:687-694` `GymCheckIn` | `membershipId: string` bắt buộc | Thay đổi 2 |

Các chỗ có chữ `gymAffiliation` (`pages/admin/PTManagement.tsx:963`, `pages/client/PTApplicationPage.tsx:1672`, `pages/client/PTDiscoveryPage.tsx:930-937`) là trường chữ tự do của hồ sơ PT, không liên quan.

Không có trang quản trị nào hiển thị collaboration. Khu vực làm việc của PT (`/pt/*`) không có lối vào quét mã check-in.

### F.2 Mobile

| Màn hình hoặc module | Hiện hiển thị gì | Cần đổi gì |
|---|---|---|
| `app/gym-owner/collaborations.tsx` | Danh sách gộp mọi chi nhánh (`:88-89`); mời PT theo từng chi nhánh (`:114`); phản hồi (`:131`); chấm dứt ngay (`:149`) | Như trang web tương ứng |
| `app/gym-owner/dashboard.tsx:107-129, 363-380` | Số PT hợp tác của chi nhánh (`acceptedCollabCount`), băng báo đề nghị đang chờ | Đổi cách đếm |
| `app/gym-owner/dashboard.tsx:96-122, 241` | "Lượt check-in hôm nay" và xu hướng | Thay đổi 2 |
| `app/gym-owner/branch.tsx:102-105` | Liên kết tới mã QR và "Cộng tác huấn luyện viên" | Rà lại vị trí liên kết |
| `src/features/gymOwner/BranchSections.tsx:612` | Câu cảnh báo đóng cửa có số cộng tác PT | Đổi cách đếm và câu chữ |
| `app/gym-owner/checkin-qr.tsx:41-48, 154-159` | Mã QR và 20 lượt check-in gần nhất theo `clientId` | Thay đổi 2 |
| `app/pt/collaborations.tsx:65-110` (lối vào `app/pt/profile.tsx:345`) | PT xem, đề xuất tới một phòng gym chọn từ danh sách, phản hồi, chấm dứt ngay | Chọn thương hiệu; báo trước |
| `app/client/services/pt/[id].tsx:99-103` + `src/features/services/ptDiscovery.ts:286-319` | Bộ chọn phòng gym khi thuê PT, có nhãn "PT 55% · gym 35%" | Danh sách chi nhánh mở rộng |
| `app/client/services/checkin.tsx` + `src/features/services/checkin.ts` (lối vào `app/client/services/index.tsx:704`) | Quét mã, thông báo lỗi, thẻ kết quả có số lượt đã dùng (`checkin.ts:42-58`) | Thay đổi 2: kết quả cho PT không có số lượt |
| `src/features/collaboration/collaboration.ts`, `src/features/pt/pt.ts:314-329`, `src/features/gymOwner/gymOwner.ts:313-321` | Kiểu dữ liệu, nhãn trạng thái, hàm đếm | Thêm phạm vi thương hiệu |

Khu vực PT trên mobile (`app/pt/*`) không có lối vào quét mã check-in.

---

## G. Mô hình buổi tập trong user-service

Mọi dữ kiện là `CODE AUDIT`.

### G.1 Model và trạng thái

`Session` (`user-service/prisma/schema.prisma:677-742`), bảng `sessions`:

- `contractId` bắt buộc, quan hệ tới `Contract` (`:679, 730`).
- `ptUserId`, `clientUserId` (`:680-681`).
- `sessionMode SessionMode @default(OFFLINE)` (`:683`). Enum gồm `ONLINE`, `OFFLINE`, `HYBRID` (`:428-432`).
- `scheduledStartAt`, `scheduledEndAt` (`:686-687`).
- `location String?` (`:689`): chữ tự do do khách gửi khi đặt (`booking.service.ts:218, 362`).
- **Không có `gymId`** và không có tham chiếu địa điểm nào khác. Nhận định của người yêu cầu là đúng: chỉ hợp đồng có `gymId` (`:624`).

`SessionStatus` (`:394-411`):

| Trạng thái | Nghĩa | Tính là "đã xác nhận, chưa huỷ"? |
|---|---|---|
| `REQUESTED` | Khách đã đặt, PT chưa xác nhận | Không |
| `CONFIRMED` | PT đã xác nhận | Có |
| `PENDING_CLIENT_CONFIRMATION` | PT báo đã dạy xong (hoặc báo khách vắng), chờ khách xác nhận | Có, nếu muốn cho PT vào lại cùng ngày |
| `COMPLETED` | Đã xong và đã quyết toán | Có, như trên |
| `DISPUTED` | Khách khiếu nại | Chờ câu hỏi 14 |
| `PT_NO_SHOW_REPORTED` | Khách báo PT vắng | Chờ câu hỏi 14 |
| `CANCELLED` | Đã huỷ | Không |
| `NO_SHOW` | Có bên vắng. PT huỷ dưới 24 giờ cũng được gắn nhãn này (`session-outcome.ts:67-73`) | Không |

### G.2 `sessionMode` nằm ở đâu

Ở ba nơi, chép dần xuống:

1. `PTServicePackage.sessionMode` (`:959`), chú thích ghi chỉ `ONLINE` hoặc `OFFLINE`.
2. `Contract.sessionMode` (`:565`, có thể null), chép từ gói lúc tạo (`contract.service.ts:409`).
3. `Session.sessionMode` (`:683`). Khi đặt buổi, nếu hợp đồng có `sessionMode` thì buổi buộc phải trùng (`booking.service.ts:242-251`); nếu hợp đồng không có thì lấy từ thân yêu cầu, mặc định `OFFLINE` (`:359`).

Hợp đồng có `gymId` không thể là `ONLINE`: bị chặn tại `contract.service.ts:359-365`. `SUY LUẬN`: vì gói chỉ là `ONLINE` hoặc `OFFLINE`, mọi hợp đồng gắn phòng gym tạo qua đường này đều là `OFFLINE`, và mọi buổi của chúng cũng vậy. Dữ liệu cũ có thể khác; truy vấn cuối ở mục B.2 để kiểm.

### G.3 Truy vấn trả lời "PT X có buổi đủ điều kiện tại phòng gym G trong ngày D không" (`ĐỀ XUẤT`)

```sql
SELECT s.id, s.contract_id, s.status, s.scheduled_start_at, s.scheduled_end_at,
       c.status AS contract_status, c.created_at AS contract_created_at
FROM sessions s
JOIN contracts c ON c.id = s.contract_id
WHERE s.pt_user_id = :ptUserId
  AND c.gym_id = :gymId
  AND s.session_mode = 'OFFLINE'
  AND s.status IN ('CONFIRMED', 'PENDING_CLIENT_CONFIRMATION', 'COMPLETED')
  AND s.scheduled_start_at <  :dayEndUtc     -- 00:00 ngày D+1 theo giờ địa phương, đổi sang UTC
  AND s.scheduled_end_at   >  :dayStartUtc   -- 00:00 ngày D theo giờ địa phương, đổi sang UTC
  AND c.status IN ('ACTIVE', 'COMPLETED')
ORDER BY s.scheduled_start_at
LIMIT 20;
```

Ghi chú:

- Cột thời gian là `TIMESTAMP(3)` không múi giờ, Prisma lưu UTC. So sánh theo khoảng thời điểm, không ép kiểu ngày trong SQL, để dùng được chỉ mục `scheduledStartAt` (`:738`) và không phụ thuộc múi giờ của phiên.
- Điều kiện chồng lấn khoảng xử lý buổi vắt qua nửa đêm (chờ câu hỏi 18).
- Lọc `c.status` là cần thiết. `SUY LUẬN`: `contract.service.ts` không có lệnh nào cập nhật `session` (tìm `sessionRepository.` và `prisma.session.` chỉ ra một lệnh đếm tại `:847`); chỉ `pt-deactivation.service.ts:120` huỷ buổi hàng loạt. Do đó buổi `CONFIRMED` có thể còn lại dưới một hợp đồng đã `CANCELLED`. Tôi chưa đọc hết thân hàm chấm dứt hợp đồng để khẳng định.
- `COMPLETED` của hợp đồng được giữ vì buổi cuối cùng hoàn tất sẽ đóng hợp đồng ngay trong ngày D.
- Trả về danh sách mã buổi và mã hợp đồng, không chỉ đúng/sai, để gym-service lưu làm căn cứ (mục J, K).
- Truy vấn này không trả lời điều kiện "hợp đồng được thoả thuận bao phủ"; phần đó do gym-service quyết (mục D.2, L).

---

## H. Đường gọi liên dịch vụ

### H.1 Các điểm cuối nội bộ đang có (`CODE AUDIT`)

**gym-service gọi user-service**

| Điểm cuối | Phía gọi | Timeout | Khi lỗi |
|---|---|---|---|
| `POST /internal/contracts/count-active-by-gyms` | `gym-service/src/clients/user.client.ts:16-29` | 5 giây | Ghi log, trả 0 |
| `POST /internal/notifications` | `user.client.ts:38-44` | 5 giây | Ghi log, bỏ qua |
| `GET /internal/profile/by-referral-code/:code` | `profile.client.ts:13-36` | 5 giây | 404 → `null`; lỗi khác ném lên |

**user-service gọi gym-service**

| Điểm cuối | Phía gọi | Timeout | Khi lỗi |
|---|---|---|---|
| `GET /internal/collaborations/active` | `user-service/src/clients/gym.client.ts:38-50` | 3 giây | 404 → `null`; lỗi khác → `GymServiceUnavailableError` → 503 cho người dùng |
| `GET /internal/clients/:id/active-gyms` | `pt-discovery.service.ts:35-38` | 3 giây | Trả tập rỗng. **Tuyến không tồn tại ở gym-service** |

**Khác**

| Điểm cuối | Phía gọi |
|---|---|
| `GET /auth/internal/users/:userId` (auth-service; trả `role`, `isActive`: `auth.controller.ts:463-472`) | `gym-service/src/clients/auth-service.client.ts:33-51`, timeout 3 giây |
| `POST /internal/gym-memberships/:id/activate`, `/cancel-after-refund` (gym-service) | payment-service (`gym-service/src/routes/internal.routes.ts:11-12`) |

### H.2 Xác thực và quy ước

- Header `x-service-secret`, giá trị `INTERNAL_SERVICE_SECRET`. Middleware của gym-service chấp nhận thêm `INTERNAL_API_SECRET`; giá trị mặc định của dev chỉ được nhận ngoài production; production từ chối khởi động nếu bí mật yếu (`gym-service/src/middleware/serviceSecret.middleware.ts:5-50`). user-service có middleware cùng khuôn (`user-service/src/middleware/serviceSecret.middleware.ts:16-61`); tôi chỉ đọc lướt tệp này.
- Tuyến `/internal` không được gateway chuyển tiếp ra ngoài (chú thích tại `user-service/src/routes/internal.routes.ts:15`).
- Quy ước lỗi đã được ghi thành nguyên tắc: không gộp "không gọi được" vào "không có" (`gym.client.ts:16-30`, `docs/money-flow.md` §14.3).
- Trên Lambda: `profile.client.ts:15-25` gọi thẳng Lambda của user-service khi có `USER_LAMBDA_NAME`. `user.client.ts` thì chỉ dùng HTTP. Client mới phải theo khuôn có nhánh Lambda (`lambda-http.client.ts`).

### H.3 Có điểm cuối phù hợp chưa

Chưa. Cần một điểm cuối mới ở user-service (`ĐỀ XUẤT`), ví dụ:

`GET /internal/pt/:ptUserId/gym-sessions?gymId=G&from=<ISO>&to=<ISO>`

Trả `{ ptActive: boolean, sessions: [{ sessionId, contractId, status, scheduledStartAt, scheduledEndAt, contractStatus, contractCreatedAt, gymAgreementId }] }`.

- gym-service tính khoảng `[from, to)` cho ngày D rồi gửi sang, để chỉ một dịch vụ làm phép đổi múi giờ (mục I).
- `ptActive` lấy từ `UserProfile.isPT` và `ptSuspended`. Trạng thái tài khoản đăng nhập (`isActive`) gym-service đã có đường lấy từ auth-service.
- Cần thêm một điểm cuối tra trạng thái hàng loạt theo mã buổi cho tín hiệu ở mục K.

### H.4 Lựa chọn khi user-service không phản hồi

| Lựa chọn | Hành vi | Hệ quả |
|---|---|---|
| Từ chối có mã riêng | Trả 503 với mã như `PT_SESSION_CHECK_UNAVAILABLE`, ứng dụng báo thử lại | Không ghi bản ghi sai. PT có buổi thật bị chặn ở cửa trong lúc sự cố; lễ tân phải xử lý tay |
| Cho vào, đánh dấu chưa xác minh | Ghi check-in với cờ chưa xác minh, job đối soát sau | Không chặn PT. Mở cửa cho lạm dụng trong lúc sự cố; cần thêm job và quy trình xử lý bản ghi không khớp |
| Dùng kết quả đã lưu | Lần quét thành công đầu tiên trong ngày được lưu; quét lại cùng ngày không gọi lại | Chỉ giúp lần quét thứ hai trở đi; không dùng một mình được |

Khuyến nghị: lựa chọn một, kết hợp lựa chọn ba (bản ghi theo ngày ở mục J đóng luôn vai trò kết quả đã lưu). Timeout 3 giây như `gym.client.ts`. Không bao giờ dịch sự cố thành "hôm nay không có buổi". Chờ câu hỏi 16.

---

## I. Múi giờ

### I.1 Hiện trạng (`CODE AUDIT`)

- user-service dựa vào múi giờ của tiến trình. ``new Date(`${data.scheduledDate}T${data.scheduledTime}:00`)`` (`booking.service.ts:257`), `getDay()`/`getHours()` (`:289-291`, `:162-164`), `setHours(0,0,0,0)` (`:305-308`, `:174-177`), `localDateKey` (`availability.service.ts:78-80`).
- Múi giờ đó được đặt bằng `TZ: Asia/Ho_Chi_Minh` cho từng container trong `infra/compose/docker-compose.dev.yml` (chú thích giải thích tại `:94-104`; gym-service tại `:897`).
- Lỗi đã từng xảy ra: dùng `toISOString().slice(0, 10)` (UTC) để khoá ngày trong khi đọc giờ theo địa phương, làm buổi đã đặt bị tính lệch sang hôm sau (`docs/money-flow.md:1244-1267`, `availability.service.ts:69-77`).
- fitness-service dùng cách khác: hằng `APP_SCHEDULE_TIME_ZONE = "Asia/Ho_Chi_Minh"` và `Intl.DateTimeFormat` với `timeZone` tường minh (`fitness-service/src/utils/schedule-lock.util.ts:27-38`).
- Model `Gym` không có trường múi giờ (`gym-service/prisma/schema.prisma:892-1004`).
- Phía khách tính "hôm nay" theo giờ thiết bị: web `GymOwnerDashboard.tsx:249`, mobile `gymOwner.ts:264-266`.
- gym-service chưa có logic ngày địa phương nào; check-in hiện chỉ so thời điểm (`checkin.service.ts:103, 113-116`).

`SUY LUẬN`: tìm `TZ` và `Ho_Chi_Minh` trong `docker-compose.prod.yml`, `docker-compose.low-resource.yml` và `infra/terraform` không có kết quả. Nếu production không đặt `TZ` ở nơi khác thì user-service ở đó chạy UTC và mọi phép tính ngày treo tường bị lệch 7 giờ. Tôi không xác định được cấu hình production thật.

`docs/FULL_SYSTEM_TEST_REPORT_2026-10-07.md:329` (LỖI-11) ghi một lỗi ranh giới ngày khác ở fitness-service; đó là tài liệu lịch sử, tôi không kiểm lại trong mã.

### I.2 Quy tắc đề xuất cho "ngày D của chi nhánh G" (`ĐỀ XUẤT`)

1. Một múi giờ cho toàn hệ thống: `Asia/Ho_Chi_Minh`, khai báo thành hằng số trong gym-service, cùng tên và cùng giá trị với hằng của fitness-service.
2. D là ngày lịch tại múi giờ đó của **thời điểm máy chủ nhận lượt quét**. Không lấy từ thiết bị, không lấy từ `TZ` của tiến trình.
3. Tính bằng `Intl.DateTimeFormat('en-CA', { timeZone })`, như `calendarDateLabel` đã làm.
4. Khoảng của ngày D là `[D 00:00 +07:00, D+1 00:00 +07:00)`. Việt Nam không đổi giờ mùa nên độ lệch cố định.
5. gym-service đổi khoảng này sang hai thời điểm UTC và gửi cho user-service; user-service chỉ so thời điểm.
6. Lưu D dưới dạng cột `DATE` trên bản ghi check-in PT.
7. Nếu sau này cần múi giờ theo chi nhánh: thêm `Gym.timeZone` và chỉ sửa một hàm.

---

## J. Mô hình dữ liệu cho check-in PT

### J.1 Hiện trạng (`CODE AUDIT`)

`GymCheckIn` (`gym-service/prisma/schema.prisma:1106-1119`): `membershipId` bắt buộc với quan hệ bắt buộc tới `GymMembershipContract`; `clientId` và `checkedInBy` bắt buộc. Khoá ngoại `gym_check_ins_membership_id_fkey` là `ON DELETE RESTRICT` (`20260718000001:39`).

Mọi nơi đọc hoặc ghi `GymCheckIn`:

| Nơi | Vị trí | Giả định có gói hội viên? |
|---|---|---|
| Ghi khi quét | `checkin.service.ts:143-146` | Có |
| Chống quét đúp | `checkin.service.ts:113-116`, lọc theo `membershipId` | Có, nhưng dòng không có gói không ảnh hưởng |
| Danh sách của chi nhánh | `checkin.repository.ts:4-10` (50 dòng mới nhất) → `GET /owner/gyms/:gymId/checkins` (`owner.routes.ts:157`) | Mọi dòng được coi là một lượt khách |
| Lịch sử của người dùng | `checkin.service.ts:176-182`, lọc `clientId` → `GET /me/gym-checkins` | Như trên |
| Web: bảng check-in | `GymCheckinPanel.tsx:36-40, 107-113` | Hiển thị `clientId` rút gọn |
| Web: chỉ số và biểu đồ | `GymOwnerDashboard.tsx:226-231, 249, 83-89, 310` | Đếm mọi dòng |
| Web: kiểu dữ liệu | `types/index.ts:687-694` | `membershipId: string` |
| Mobile: bảng điều khiển | `dashboard.tsx:96-98, 121-122`; `gymOwner.ts:264-275` | Đếm mọi dòng |
| Mobile: màn mã QR | `checkin-qr.tsx:18, 45-48, 159` | Hiển thị như hội viên |
| Kiểm thử | `checkin-exhausts-visits-expires-membership.integration.test.ts:57`; `checkin-gym-status-guard.integration.test.ts:65` | Xoá theo `membershipId` |

Những thứ **không** đọc `GymCheckIn`:

- Quyền đánh giá phòng gym: dựa vào gói đã thanh toán (`review.service.ts:26-29`).
- Chi trả và giải phóng tiền: dựa vào `usedVisits` và trạng thái gói (`checkin.service.ts:124-141`; tìm `gymCheckIn` trong `src` không ra tệp nào thuộc phần chi trả).
- Khiếu nại: không có tham chiếu `gymCheckIn`.

### J.2 Hai lựa chọn

**Lựa chọn 1: dùng lại `GymCheckIn`, cho `membershipId` null.**

Phải làm: bỏ `NOT NULL` trên `membership_id`, đổi quan hệ thành tuỳ chọn, thêm cột loại chủ thể, thêm cột căn cứ.

Những gì hỏng hoặc sai nghĩa:

- `clientId` phải chứa mã PT, tức một cột mang hai nghĩa.
- Mọi bảng và chỉ số ở J.1 đếm PT như khách: "check-in hôm nay" và biểu đồ 7 ngày tăng, bảng gần đây hiện PT dưới nhãn hội viên (mobile dùng `memberLabel` "Khách #…", `gymOwner.ts:324-327`).
- Lịch sử `GET /me/gym-checkins` của một PT cũng là hội viên bị trộn hai loại.
- Kiểu dữ liệu ở web và mobile phải sửa.
- Lùi lại khó: không khôi phục được `NOT NULL` khi đã có dòng null.

**Lựa chọn 2: bảng riêng cho check-in PT** (`ĐỀ XUẤT`).

Gợi ý cột: `id`, `gym_id`, `brand_id`, `pt_user_id`, `local_date DATE`, `checked_in_at`, `basis` (theo thoả thuận, hoặc hoàn tất hợp đồng cũ), `agreement_id`, `qualifying_session_ids TEXT[]`, `contract_ids TEXT[]`. Ràng buộc duy nhất `(gym_id, pt_user_id, local_date)` nếu chọn một bản ghi mỗi ngày (câu hỏi 17).

- Không nơi nào ở J.1 bị ảnh hưởng.
- Đường PT không chạm `gym_membership_contracts`, nên yêu cầu "không trừ lượt của khách, không hoàn tất buổi, không giải phóng tiền" được bảo đảm bằng cấu trúc.
- Có sẵn dữ liệu cho tín hiệu ở mục K.
- Cái giá: muốn chủ gym thấy PT trong danh sách hôm nay thì cần thêm một truy vấn và sửa giao diện.

Khuyến nghị: lựa chọn 2.

### J.3 Điểm cần xử lý ở cả hai lựa chọn (`CODE AUDIT`)

- Tuyến `POST /me/gym-checkins` đã cho cả `CUSTOMER` và `PT` (`client.routes.ts:16, 43`; gateway `proxy.routes.ts:1588-1593`). Hàm `checkInByGymToken` luôn đi đường hội viên và ném `NO_MEMBERSHIP` (`checkin.service.ts:96`).
- Phản hồi hiện có `usedVisits`, `totalVisits`, `planName`, `endDate` (`checkin.service.ts:149-157`). Mobile chuẩn hoá thành thẻ có số lượt (`checkin.ts:42-58`). Phản hồi cho PT cần một trường phân loại.
- `CODE_STATUS` thiếu `GYM_NOT_ACTIVE` (`checkin.controller.ts:7-14`), nên lỗi này trả về dạng `{ error: { message } }` thay vì `{ error: { code } }`. Mobile đã xử lý cả hai dạng (`checkin.ts:24`); web thì không có thông báo cho mã này.
- Mã QR có hạn mặc định 365 ngày (`checkinToken.ts:19`) và không gắn với ngày. Ảnh chụp mã dùng được từ bất kỳ đâu; hiện hệ thống không kiểm vị trí.
- PT vừa là hội viên: xem câu hỏi 15.

---

## K. Bề mặt lạm dụng của quy tắc này

### K.1 Ai tạo và ai xác nhận buổi tập (`CODE AUDIT`)

- **Chỉ khách đặt buổi.** `bookSession` yêu cầu người gọi là `contract.clientUserId` (`booking.service.ts:225-228`); tuyến `POST /sessions` (`session.routes.ts:8`). Không có đường nào để PT tự tạo buổi.
- **Chỉ PT xác nhận.** `confirmSession` yêu cầu `session.ptUserId === ptUserId` (`:394-397`).
- Vậy PT không tự xác nhận buổi do mình tạo, vì PT không tạo được buổi. Nhưng khi khách đã đặt, việc chuyển sang `CONFIRMED` hoàn toàn do PT quyết. Cánh cửa thật sự là hành động đặt buổi của khách.
- Đặt buổi phải trước ít nhất 24 giờ (`:268-271`), hợp đồng phải `ACTIVE` (`:237-239`), và số buổi đang giữ không vượt quyền lợi còn lại (`:337-340`).

### K.2 Các đường lách

| Tình huống | Mã cho phép? | Chi phí cho người lạm dụng |
|---|---|---|
| PT và một khách thông đồng (hoặc tài khoản khách do PT tự lập) có hợp đồng gắn phòng gym, đặt buổi mỗi ngày | Có | Mỗi buổi là một buổi đã trả tiền; phòng gym vẫn nhận phần chia theo `gymRate` |
| Check-in xong, khách huỷ buổi cùng ngày | Có. Huỷ dưới 24 giờ: `CANCELLED`, trừ một buổi, PT vẫn được trả (`session-outcome.ts:51-56`) | Một buổi của hợp đồng |
| Check-in xong, PT huỷ buổi cùng ngày | Có. Dưới 24 giờ: `NO_SHOW`, khách được bồi thường, PT chịu (`session-outcome.ts:67-73`) | PT bị trừ tiền |
| Check-in buổi sáng cho buổi lúc tối muộn, rồi xin dời lịch | Có, nếu còn hơn 12 giờ trước giờ bắt đầu (`booking.service.ts:1234-1237`) và bên kia chấp nhận. Tối đa 2 lần dời mỗi buổi (`:1255-1258`) | Không tốn buổi: một buổi cho quyền vào tới ba ngày khác nhau |
| Dời một buổi từ ngày xa về hôm nay | Có. `assertSlotBookable` không kiểm quy tắc đặt trước 24 giờ (`:132-180`); chỉ cần giờ mới ở tương lai (`:1264`) và bên kia chấp nhận | Không |
| PT báo hoàn thành buổi không diễn ra | Chỉ sau `scheduledEndAt` (`:495-497`); khách xác nhận, hoặc hệ thống tự xác nhận sau `AUTO_CONFIRM_DAYS` | Tiền được giải phóng như buổi thật |
| Buổi `REQUESTED` chưa được PT xác nhận | Không đủ điều kiện | — |

Nhận xét: mọi đường lách đều cần một hợp đồng đã thanh toán gắn với G và sự hợp tác của bên khách. Đường không tốn chi phí là dời lịch sau khi đã check-in.

### K.3 Buổi có thể bị huỷ hoặc dời sau khi PT đã check-in không

Có, cả hai, như bảng trên. Không có mã nào liên kết check-in với buổi tập, nên hiện không có gì ngăn. `CODE AUDIT`

Hướng giảm thiểu (`ĐỀ XUẤT`, cần chủ sở hữu quyết): lưu mã các buổi làm căn cứ lúc check-in; coi một buổi đã được dùng làm căn cứ cho ngày D là không còn làm căn cứ cho ngày khác sau khi dời.

### K.4 Tín hiệu có thể hiển thị cho chủ gym (`ĐỀ XUẤT`)

Theo từng PT, từng chi nhánh, trong một khoảng thời gian:

- Số ngày có check-in PT.
- Trong các ngày đó, số buổi làm căn cứ kết thúc ở `COMPLETED` hoặc `PENDING_CLIENT_CONFIRMATION`.
- Số ngày check-in mà mọi buổi làm căn cứ về sau thành `CANCELLED`, `NO_SHOW`, hoặc bị dời sang ngày khác.
- Số lần dời lịch được chấp nhận sau thời điểm check-in.

Điều kiện kỹ thuật: gym-service lưu mã buổi lúc check-in, và user-service có điểm cuối trả trạng thái hiện tại theo danh sách mã buổi. Chủ gym chỉ thấy PT và các con số, không thấy danh tính khách. Chờ câu hỏi 19.

---

## L. Giai đoạn kết thúc thoả thuận

Mọi dữ kiện là `CODE AUDIT`.

### L.1 Điều gì trong mã hiện tại sẽ ngăn PT hoàn tất hợp đồng có sẵn sau khi thoả thuận `TERMINATED`

Hiện tại: **không có gì.**

- `bookSession` (`booking.service.ts:222-239`) kiểm quyền sở hữu, `ptSuspended`, hợp đồng `ACTIVE`, ngày hết hạn, lịch rảnh. Không gọi gym-service.
- `confirmSession` (`:409-423`) và `completeSession` (`:483-497`) cũng không gọi.
- Chi trả từng buổi dùng tỷ lệ và `gymId` chụp trên hợp đồng (`contract-payout.service.ts:25-35`), nên tiền tiếp tục về ví chi nhánh.

Điều này khớp với mục tiêu "hợp đồng có sẵn được hoàn tất". Các điểm sẽ thành vật cản khi triển khai:

1. **Check-in PT, nếu dùng lại `activeRates`.** Hàm trả `null` ngay khi `effectiveAt` có giá trị (`collaboration.service.ts:47-51, 404`). PT sẽ bị từ chối ở cửa trong suốt thời gian báo trước và sau đó, dù hợp đồng còn chạy. Cần bộ kiểm riêng cho việc thực hiện hợp đồng có sẵn (mục D.2).
2. **Không xác định được hợp đồng nào là "có sẵn".** Hợp đồng không lưu mã thoả thuận, và thoả thuận không lưu thời điểm bắt đầu chấm dứt. Cần `Contract.gymAgreementId` và `termination_initiated_at`.
3. **Affiliation chuyển `SUSPENDED`** khi chấm dứt (`:328-331`, `:108-111`). Hiện chỉ làm PT biến khỏi danh sách công khai. Nếu sau này quyền vào cửa dựa trên affiliation thì đây thành vật cản.
4. **Không ký lại được trong thời gian báo trước.** `propose` thấy dòng `ACCEPTED` và trả 409 (`:142-155`). Sau khi `effectiveAt` đã qua, nếu chưa ai gọi danh sách thì dòng vẫn `ACCEPTED` và tiếp tục chặn.

### L.2 Điều gì sẽ tiếp tục hoạt động một cách sai

| Hành vi | Bằng chứng | Vì sao sai so với mục tiêu |
|---|---|---|
| Hợp đồng đã yêu cầu trước khi chấm dứt vẫn được chấp nhận và thanh toán, có phần chia cho phòng gym | Tỷ lệ chỉ tra một lần tại `contract.service.ts:367`; không có lần tra lại nào khác trong user-service | "Chặn hợp đồng mới ngay lập tức" bị rò (câu hỏi 6) |
| Đặt buổi, xác nhận buổi, chi trả tại chi nhánh đã `SUSPENDED`, `TEMPORARILY_CLOSED` hoặc `PERMANENTLY_CLOSED` | `booking.service.ts` không có lần kiểm trạng thái phòng gym nào | Mục tiêu là "trong khi chi nhánh còn hoạt động" |
| Hợp đồng mới tại chi nhánh do chủ gym tự đóng | Tại `dd42451` `activeRates` không kiểm `operationalStatus`. Trong cây làm việc đã kiểm (`collaboration.service.ts:47-51, 404`), chưa commit | Đã được sửa trong cây làm việc; cần giữ khi chuyển sang cấp thương hiệu |
| Hợp đồng mới tại chi nhánh của đối tác bị quản trị viên tạm khoá hoặc chấm dứt | `partner.service.ts:405-428, 512-573` không chạm collaboration; `activeRates` không gọi `partnerGuard` | Đối tác bị khoá vẫn nhận tiền mới qua hợp đồng PT |
| `GET /pt/:ptUserId/gyms` liệt kê chi nhánh đang trong thời gian báo trước, và chi nhánh đã đóng | Tại `dd42451` chỉ lọc `ACCEPTED` và `APPROVED`. Trong cây làm việc đã dùng `NEW_CONTRACT_ELIGIBLE` (`collaboration.service.ts:370`), chưa commit | Đã được sửa trong cây làm việc; cần giữ khi chuyển sang cấp thương hiệu |
| Trạng thái vẫn `ACCEPTED` sau khi `effectiveAt` đã qua | Chỉ `listFor` gọi `finalizeIfEffective` (`:344, 352`); không có job quét | Bảng điều khiển hiện "Đang hợp tác", `closureImpact` đếm sai (`gym.service.ts:476`), affiliation vẫn `ACTIVE` và công khai |
| Thời hạn báo trước không tới được người dùng | Web và mobile gọi `DELETE` không có thân (`api.ts:5392-5396` của web; `collaborations.tsx:149` và `pt/collaborations.tsx:110` của mobile) | Mọi lần chấm dứt từ giao diện là ngay lập tức; mặc định 14 ngày phải đặt ở máy chủ |
| Gọi `terminate` lần hai trên dòng đang báo trước | Điều kiện duy nhất là `status === 'ACCEPTED'` (`collaboration.service.ts:308`) | Bên nào cũng rút ngắn được về "ngay lập tức"; không có mức tối thiểu, không có rút lại (câu hỏi 7) |
| PT bị vô hiệu hoá tài khoản vẫn có collaboration `ACCEPTED` và affiliation công khai | `pt-deactivation.service.ts` không gọi gym-service (tìm `GYM_SERVICE`, `gymClient` không có kết quả) | `SUY LUẬN`: danh sách công khai và bộ chọn phòng gym vẫn hiện PT đó |
| Hoa hồng giới thiệu | `activeRates` loại dòng có `effectiveAt` (`membership.service.ts:185`) | Hành vi này **đúng**: bị chặn ngay khi bắt đầu chấm dứt |

---

## Những điều chưa xác định được

1. Số lượng thật của bảy nhóm dữ liệu: cơ sở dữ liệu dev đang tắt, không truy vấn nào được chạy.
2. Cấu hình `TZ` của production: không tìm thấy trong tệp compose production hay Terraform; có thể được đặt ở nơi khác.
3. Chấm dứt hợp đồng PT có huỷ các buổi đã đặt hay không: chỉ thấy `pt-deactivation.service.ts:120` huỷ hàng loạt; chưa đọc hết thân hàm chấm dứt trong `contract.service.ts`.
4. Tài khoản vai trò PT có vào được màn hình check-in của khu vực khách (web `/client/gym-memberships`, mobile `/client/services/checkin`) hay không: phụ thuộc cơ chế chuyển hồ sơ, chưa đọc.
5. Dòng `PTDiscoveryPage.tsx:1364` có thật sự hiển thị `NaN%` hay không: suy ra từ mã, chưa mở trình duyệt.
6. Lệch lược đồ ở cấp cột trong gym-service: chỉ đối chiếu tên bảng và tên enum.
7. Lệch lược đồ của user-service: không kiểm lại.
8. Các kho kiểm thử ngoài monorepo có dữ liệu mẫu hay ca kiểm thử nào phụ thuộc collaboration cấp chi nhánh hay không.
9. Trạng thái cuối cùng của các thay đổi mà hai tác tử khác đang thực hiện trong gym-service và payment-service: tôi chỉ đọc phần khác biệt lúc 16:54–16:55; họ có thể còn sửa tiếp.
