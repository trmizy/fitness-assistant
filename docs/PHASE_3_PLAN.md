# Phase 3 — Kế hoạch: Client chọn PT → Gym → Membership → PT nhận → Hợp đồng nháp

- Ngày: 2026-10-17. Nhánh `feature/payment-gateways`, HEAD `f027c1d`. Chỉ đọc mã, không sửa mã, không ghi DB.
- Nhãn bằng chứng: toàn bộ phần audit là `CODE AUDIT` (đọc mã, chưa chạy). Không có gì ở đây là đã kiểm thử.
- Căn cứ: D66 (đóng 2.5, mở Phase 3), D1–D13, D18, D30, D38; `docs/GYM_PT_BRAND_PARTNERSHIP_AUDIT.md`; `docs/PHASE_2_5_EXIT_CHECKLIST.md` (M-B).

## 1. Phạm vi và không thuộc phạm vi

**Trong phạm vi** (Owner chốt, không mở rộng):
Client chọn PT → hệ thống xác định Gym phù hợp → kiểm Membership của Client → kiểm PT được phép nhận hợp đồng này (hạn chế theo hợp đồng và theo tài khoản, thỏa thuận PT–Gym cấp thương hiệu còn hiệu lực, gym đang mở, đối tác không bị khóa…) → PT nhận → Hợp đồng PT–Client ở trạng thái nháp → mã giới thiệu của PT tự điền khi có luồng đăng ký gym phù hợp → chuẩn bị dữ liệu cho bước thanh toán sau. Thanh toán chỉ mock/test/sandbox.

**Ngoài phạm vi:** thu tiền thật; Financial Hold, giữ lại 10%, M0/M1; GĐ1 SETTLING, GĐ2 idempotency payment; đổi công thức tiền, ledger, quyết toán; check-in QR của PT (Phase 2, chạy song song); Owner Management; thay đổi mô hình Membership; đổi D30.

## 2. Quy tắc đã chốt phải đúng sau Phase 3

- Hạn chế **theo hợp đồng** (D38): khiếu nại của Bình chỉ khóa hợp đồng An–Bình; không chặn PT nhận Client khác. Hạn chế **theo tài khoản** chặn mọi hợp đồng mới.
- Thỏa thuận PT–Gym ở **cấp thương hiệu** áp cho mọi chi nhánh đang mở của thương hiệu (D5). **Chi nhánh nơi Client thực sự tập** nhận phần gym theo **tỷ lệ của thỏa thuận thương hiệu**.
- Thỏa thuận cũ theo chi nhánh chỉ còn hiệu lực khi chưa bị thỏa thuận thương hiệu thay thế (D6–D8); không tự chọn tỷ lệ khi xung đột (D7).
- Kiểm lại gym **lúc PT nhận và lúc Client thanh toán**; tỷ lệ đổi giữa chừng thì từ chối, không tự sửa (D12). Hạn thanh toán 12 giờ kể từ khi PT nhận (D13).
- Chỉ hợp đồng **đã thanh toán** mới là "hợp đồng có sẵn"; hợp đồng nháp là "mới" nên bị chặn khi gym đóng, đối tác bị khóa hoặc thỏa thuận bắt đầu chấm dứt (D11).
- Client tập với PT tại gym phải có Membership (D18). Ba quan hệ độc lập: thỏa thuận PT–Gym, hợp đồng PT–Client, Membership Client–Gym; không gộp quyền giữa chúng (D1). Owner không đổi/gán PT của hợp đồng (D2).
- D30 giữ nguyên (PT tự hủy tính là hoạt động, không là buổi hoàn thành/doanh thu). Financial Hold/10% vẫn **TẮT**. `clientId` luôn lấy từ danh tính xác thực, không từ body.
- Giá, số buổi, tỷ lệ chỉ lấy từ gói dịch vụ và thỏa thuận, không từ request của Client (đã đúng trong `requestContract`).

## 3. Audit phụ thuộc tối thiểu

### 3.1 Bảng tổng hợp

| Thực thể | Service / bảng sở hữu | API liên quan đã có | Trạng thái | Chỗ tham chiếu chính |
|---|---|---|---|---|
| Client, PT (hồ sơ, `referralCode`, hạn chế) | user-service: `UserProfile`, `PtRestriction` | `assertPtAcceptsNewBusiness` / `assertPtMayAct` / `getBlockingRestriction` | **Dùng nguyên** | `pt-restriction.service.ts:185,223,232,330,344`; `contract.service.ts:437` (request), `:600` (accept), `:1550` (pay) |
| Gói dịch vụ PT | user-service: `PTServicePackage` | `ptServicePackageRepository.findById` | **Dùng nguyên** | `contract.service.ts:421-430` |
| Gym (thương hiệu + chi nhánh) | gym-service: `GymBrand`, `Gym.brandId`, `status`, `operationalStatus` | `GET /pt/:ptUserId/gyms` (công khai) | **Dùng nguyên** | `schema.prisma:858,895`; `collaboration.service.ts:136-147` |
| Thỏa thuận PT–Gym cấp thương hiệu | gym-service: `GymBrandPtAgreement` (+ bảng cũ `GymPtCollaboration`) | `GET /internal/collaborations/active`; `GET /pt/:ptUserId/gyms` | **Mở rộng nhỏ** (trả thêm `brandId`; user-service lưu snapshot) | `schema.prisma:1235`; `collaboration.service.ts:149,843,906`; `routes/internal.routes.ts:17` |
| Membership | gym-service: `GymMembershipPlan` (theo `brandId`), `GymMembershipContract` (theo `gymId` nơi mua) | `POST /gyms/:gymId/memberships`, `GET /me/gym-memberships`, `GET /gyms/:gymId/membership-warnings` | **Mở rộng** (thiếu API nội bộ "Client có Membership còn hạn ở thương hiệu này không") | `schema.prisma:1018,1043`; `client.routes.ts:19-40`; `checkin.service.ts:86-96` |
| Hợp đồng PT–Client | user-service: `Contract` | `POST /contracts/request`, `PATCH /:id/accept`, `POST /:id/pay` | **Mở rộng** (thêm snapshot thương hiệu/thỏa thuận/Membership) | `schema.prisma:563`; `contract.service.ts:391,596,1529` |
| Mã giới thiệu PT | user-service: `UserProfile.referralCode` | `GET /internal/profile/by-referral-code/:code`; `POST /gyms/:gymId/memberships` nhận `referralCode` | **Dùng nguyên** phần backend; **mới** phần tự điền ở UI | `schema.prisma:79`; `utils/referralCode.ts:22`; `membership.service.ts:177-194`; `GymDetailModal.tsx:59,98,271` |
| Luồng "xác định gym phù hợp" + "kiểm Membership" trước khi tạo hợp đồng | — | không có | **Mới** | xem 3.2 mục 2 và 5 |

### 3.2 Câu trả lời cho sáu câu hỏi

**1. Hợp đồng PT–Client hiện được tạo thế nào.**
- `POST /contracts/request` (`contract.routes.ts:25`) → `requestContract` (`contract.service.ts:391`): kiểm gói và PT (`:421-440`), cảnh báo ít lịch trống (`:441-467`), chốt tỷ lệ chia doanh thu **trước khi ghi DB** (`:468-500`), chặn trùng PT–Client (`:503`), tạo `PENDING_REVIEW` với snapshot gói, `gymId`, `source`, ba tỷ lệ, `ptHoldbackRate` (`:508-545`).
- `PATCH /contracts/:id/accept` → `acceptContract` (`:596`): kiểm PT không bị hạn chế (`:600`), **kiểm lại gym** (`assertGymStillAcceptsContract`, `:103-146`, gọi ở `:607`), rồi `PENDING_REVIEW → PENDING_PAYMENT` kèm `paymentDueAt` khi e-sign tắt (`REQUIRE_CONTRACT_ESIGN=false`, `:312`, `:626-646`) hoặc `PENDING_SIGNATURE` khi e-sign bật.
- `POST /contracts/:id/pay` → `pay` (`:1529`): kiểm PT, hạn thanh toán, **kiểm lại gym** (`:1563`), rồi gọi `paymentClient.checkout` với snapshot tỷ lệ. Kích hoạt ở `activateAfterPayment` (`:1615`).
- **Snapshot tỷ lệ** nằm ở ba cột `platformRate/ptRate/gymRate` (`schema.prisma:662-664`), ghi một lần ở `:526-528`. Mọi tính toán sau chỉ đọc ba cột này.
- **Gym được chọn bởi Client** qua `data.gymId` (tùy chọn, chỉ cho gói OFFLINE, `:471-479`); không chọn thì hợp đồng `INDEPENDENT`. Gym được kiểm bằng `gymClient.getActiveCollaboration` (`:480`), kiểm lại ở accept và pay. **Không có enum DRAFT**: `PENDING_REVIEW` là yêu cầu, `PENDING_PAYMENT` là trạng thái "sẵn sàng thanh toán" (`schema.prisma:357-366`).

**2. Membership: có model/API không, kiểm "còn hạn ở gym X / thương hiệu A" thế nào, có liên kết với hợp đồng không.**
- Có, trong gym-service. `GymMembershipPlan` thuộc **thương hiệu** (`brandId`), `GymMembershipContract` ghi `gymId` nơi mua nhưng **dùng được ở mọi chi nhánh cùng thương hiệu** (`membership.service.ts:104-109`).
- Cách kiểm hiện có chỉ nằm **bên trong check-in**: join `gyms.brand_id = gym_membership_plans.brand_id` rồi `gym_membership_contracts.client_id` và `status IN ('ACTIVE','EXPIRED')` (`checkin.service.ts:86-96`), sau đó kiểm hạn và số lượt (`:100-130`). Không có hàm/endpoint dùng lại được.
- API nội bộ của gym-service chỉ có 3 đường (`routes/internal.routes.ts:11-17`): activate, cancel-after-refund, `collaborations/active`. **Không có** đường tra Membership cho service khác.
- **Liên kết Membership ↔ Hợp đồng hiện không có.** `Contract` không có cột nào về Membership; `requestContract`, `acceptContract`, `pay` không gọi gì liên quan Membership; `booking.service.ts` cũng không. D18 (Client tập với PT tại gym phải có gói) chưa được thực thi ở đâu.
- Phát hiện kèm theo: `pt-discovery.service.ts:36` gọi `GET /internal/clients/:id/active-gyms` ở gym-service, nhưng **đường này không tồn tại** (grep toàn repo chỉ thấy nơi gọi). Hàm fail-soft nên chỉ làm nhãn "cùng phòng tập" không bao giờ hiện, không gây lỗi. Đây là lỗi kỹ thuật P2 (backlog), P3.1 sẽ sửa luôn vì cùng một truy vấn.

**3. Chi nhánh → thương hiệu → tỷ lệ thỏa thuận thương hiệu; hợp đồng đã dùng thỏa thuận thương hiệu chưa.**
- `Gym.brandId` → `GymBrand`; `activeRates(gymId, ptUserId)` (`collaboration.service.ts:906`) đọc gym, kiểm APPROVED + OPEN + đối tác không bị khóa (`:136-147`), tìm `GymBrandPtAgreement` ACCEPTED, chưa bắt đầu chấm dứt theo `(brandId, ptUserId)` (`:911-917`); chỉ khi không có mới rơi về dòng chi nhánh cũ chưa bị thay thế (`:918-924`). Thứ tự này do `pickAgreement` (`:149`) quyết định, dùng chung với `listAcceptedGymsForPt` (`:843`) nên danh sách gym gợi ý luôn khớp với bước tra tỷ lệ.
- **Hợp đồng đã dùng thỏa thuận thương hiệu**: `contract.service.ts:480` gọi endpoint nội bộ, đi qua `activeRates` ở trên. Tỷ lệ trên hợp đồng là tỷ lệ cấp thương hiệu; phần gym vào ví của `contract.gymId` (chi nhánh), nhất quán với quy tắc đã chốt (`payment-service/contract-ledger.service.ts:60`).
- **Thiếu**: `ActiveCollaborationRates` ở user-service (`gym.client.ts:9-14`) bỏ `agreementScope`; `collaborationId` bị bỏ (`contract.service.ts:496` chỉ lấy ba tỷ lệ); `Contract` không có cột thương hiệu/thỏa thuận. Kiểm lại ở accept/pay chỉ so ba tỷ lệ (`:131-146`), không biết hợp đồng thuộc thỏa thuận nào. Đây chính là điểm rủi ro số 1 của audit ngày 9/10, vẫn còn nguyên.

**4. Mã giới thiệu PT.**
- Có. `UserProfile.referralCode` (unique, `schema.prisma:79`), sinh một lần lúc duyệt PT bằng `assignReferralCodeIfMissing` (`utils/referralCode.ts:22`, gọi ở `pt_application.service.ts:383`), có script backfill. Hiển thị cho PT ở `PTProfilePage.tsx:206,753`.
- Nơi dùng: **chỉ ở mua Membership**. `POST /gyms/:gymId/memberships` nhận `referralCode` (`membership.controller.ts:24`); `resolveReferral` (`membership.service.ts:177-194`) kiểm mã tồn tại, không tự giới thiệu, PT có thỏa thuận dùng được tại gym đó (`activeRates`), và **lần đầu mua tại đúng chi nhánh đó** (`hasEverHadMembershipAt(clientId, gymId)`). Mã sai/không hợp lệ làm hỏng giao dịch mua theo từng mã lỗi; hoa hồng lấy từ phần gym (`GymMembershipReferral`).
- Luồng đăng ký gym/mua gói có sẵn: `GymDetailModal.tsx` (ô nhập mã ở `:59,98,271`, ô trống, người dùng tự gõ). **Chưa có** chỗ nào truyền mã của PT đang được chọn vào ô này. Luồng hire-PT (`PTDiscoveryPage.tsx`) không biết gì về Membership.

**5. Dùng nguyên / mở rộng / mới.**
- **Dùng nguyên:** bộ kiểm hạn chế PT (`pt-restriction.service.ts`), kiểm lại gym ở accept/pay, hạn thanh toán 12 giờ, snapshot gói và ba tỷ lệ, `listAcceptedGymsForPt`/`activeRates` (quy tắc brand), mua Membership kèm `referralCode`, `UserProfile.referralCode`, thanh toán mock.
- **Mở rộng:** `activeRates` trả thêm `brandId` (không đổi nghĩa trường cũ); `Contract` thêm 4 cột snapshot; `requestContract` và `acceptContract` thêm bước kiểm Membership; `gym.client.ts` thêm hàm tra Membership.
- **Mới:** API nội bộ tra Membership còn hạn của Client theo thương hiệu; endpoint "gym phù hợp + trạng thái điều kiện" cho Client; tự điền mã giới thiệu và chuyển hướng sang mua gói; read model "dữ liệu chuẩn bị thanh toán" (tính từ snapshot, không bảng mới).

**6. P0 phá trực tiếp luồng này: chưa phát hiện.** Không thấy lỗi nào làm luồng request → accept → pay (mock) hỏng hoặc sai tiền. Hai phát hiện P2/P3 ghi ở mục 3.2-2 và 3.2-3 là **thiếu chức năng/backlog**, không phải P0. Chưa chạy bài kiểm nào trong lượt này nên không khẳng định "luồng đang chạy đúng".

## 4. Luồng đề xuất, từng bước

Giả định kỹ thuật A1 (Owner có thể phản đối): **không thêm trạng thái DRAFT mới.** "Hợp đồng nháp" = `Contract` ở `PENDING_PAYMENT` sau khi PT nhận (đã có `paymentDueAt`, snapshot, và sẵn sàng thanh toán); `PENDING_REVIEW` là "yêu cầu chờ PT". Lý do: thêm giá trị enum chạm hàng chục chỗ so sánh trạng thái, kể cả mã tiền. Nếu Owner muốn một trạng thái DRAFT riêng, ghi vào mục 8.

| Bước | API | Kiểm tra | Ghi gì |
|---|---|---|---|
| 1. Client chọn PT + gói | có sẵn (khám phá PT, `PTServicePackage`) | gói còn bán, thuộc PT | không |
| 2. Xác định gym phù hợp + trạng thái điều kiện | **MỚI** user-service `GET /contracts/gym-options?ptUserId&packageId` (clientId lấy từ `x-user-id`) | Gói OFFLINE mới có gym. Giao của (a) chi nhánh PT dùng được: `listAcceptedGymsForPt` (đã gồm gym APPROVED+OPEN, đối tác không khóa, thỏa thuận cấp thương hiệu hoặc chi nhánh còn dùng được) và (b) thương hiệu mà Client có Membership còn hạn (API mới ở P3.1). Xếp: chi nhánh nằm trong `PTTrainingLocation` của PT trước, rồi chi nhánh Client mua gói, rồi tên | không. Trả: danh sách chi nhánh phù hợp (có `membershipId`), hoặc "thiếu Membership" kèm chi nhánh đề nghị, `referralCode` của PT |
| 3. Client xác nhận chi nhánh (hoặc mua gói) | có sẵn `POST /gyms/:gymId/memberships` (nhận `referralCode`) | quy tắc `resolveReferral` giữ nguyên | Membership ở gym-service (mock payment) |
| 4. Gửi yêu cầu | `POST /contracts/request` (mở rộng) | như hiện nay + kiểm lại chi nhánh bằng cùng bộ phân giải + **Membership còn hạn ở thương hiệu của chi nhánh** + PT không bị hạn chế tài khoản | tạo `PENDING_REVIEW` với `gymId`, `source=GYM`, ba tỷ lệ, và snapshot mới (bảng dưới) |
| 5. PT nhận | `PATCH /contracts/:id/accept` (mở rộng) | như hiện nay (`assertPtMayAct`, `assertGymStillAcceptsContract`) + **kiểm lại Membership** còn hạn + thỏa thuận hiện tại phải trùng `gymAgreementId`/tỷ lệ đã chụp, nếu không thì `GYM_TERMS_CHANGED` | `PENDING_PAYMENT`, `paymentDueAt` (D13). Đây là **Hợp đồng nháp** |
| 6. Chuẩn bị thanh toán | `GET /contracts/:id` (có sẵn; thêm vùng `checkoutContext` chỉ đọc, tính từ snapshot) | không | không ghi |
| 7. Thanh toán sau (ngoài phạm vi, chỉ mock) | `POST /contracts/:id/pay` (có sẵn, không đổi) | kiểm lại gym (D12) | không đổi |

**Trường của Hợp đồng nháp (sau bước 5):**
- Có sẵn: `ptUserId`, `clientUserId`, `status=PENDING_PAYMENT`, `packageId/packageName/totalSessions/price/sessionMode/sessionDurationMinutes/validityDays`, `gymId` (chi nhánh nơi Client tập), `source=GYM`, `platformRate/ptRate/gymRate` (tỷ lệ thỏa thuận cấp thương hiệu), `paymentDueAt`, `ptHoldbackRate` (hiện luôn 0).
- **Mới (nullable, hợp đồng cũ để trống):** `gymBrandId` (thương hiệu của chi nhánh), `gymAgreementId` + `gymAgreementScope` (`BRAND`|`BRANCH`, từ `collaborationId`/`agreementScope` mà gym-service đã trả), `gymMembershipId` (tham chiếu logic sang gym-service, không khóa ngoại liên service).
- **Mã giới thiệu: không lưu trên `Contract`.** Nguồn duy nhất vẫn là `UserProfile.referralCode`; API ở bước 2 chỉ trả mã để UI chuyển vào luồng mua gói. Tránh nguồn sự thật thứ hai.

## 5. Các lát cắt nghiệm thu độc lập

Không lát nào chạm `contract-payout.service.ts`, `contract-ledger.service.ts`, settlement, hay sổ cái payment. Kích hoạt/hoàn tiền/quyết toán không đổi. `contract.service.ts` là tệp chung với đường tiền: chỉ sửa trong `requestContract`/`acceptContract`, không sửa `terminate*`, `pay`, `activateAfterPayment`, sweep.

**P3.1 — Tra Membership theo thương hiệu (gym-service, chỉ đọc).**
- Phạm vi: hàm dùng chung "Client có Membership còn hạn ở thương hiệu của gym X" (cùng điều kiện join như `checkin.service.ts:86-96`, thêm: chưa hết hạn, còn lượt), lộ qua `GET /internal/clients/:clientId/active-memberships?gymId=` và đường `active-gyms` mà `pt-discovery` đang gọi nhầm. `activeRates` trả thêm `brandId`.
- Tệp: file mới `membership-eligibility.service.ts` + file route nội bộ mới; thêm một dòng mount ở `routes/internal.routes.ts`; `collaboration.service.ts` chỉ thêm `brandId` vào object trả về.
- Kiểm thử (gym-service, DB `*_test`, thêm guard tên DB như `user-service/src/__tests__/test-db-guard.ts` vì gym-service hiện chỉ kiểm có `DATABASE_URL`): có/không Membership, hết hạn, hết lượt, `PENDING_PAYMENT` không tính, Membership mua ở chi nhánh A dùng được ở chi nhánh B cùng thương hiệu, thương hiệu khác không dùng được, gym không có `brandId`.
- Nghiệm thu: trả đúng trong mọi ca trên; không đổi hành vi `activeRates` cũ.

**P3.2 — Snapshot thỏa thuận + Membership lên Hợp đồng (user-service, migration).**
- Phạm vi: 4 cột nullable ở mục 4; `gym.client.ts` đọc `agreementScope`, `brandId` và hàm tra Membership; `requestContract` ghi snapshot; `assertGymStillAcceptsContract` so thêm `gymAgreementId` (nếu có) để hợp đồng không âm thầm đổi sang thỏa thuận khác.
- Tệp: `prisma/schema.prisma` + migration mới (tên duy nhất, theo sau `20261012100000_...`; lưu ý ghi chú drift migration của user-service: kiểm bằng DB test dựng từ `migrate deploy`), `gym.client.ts`, `contract.service.ts` (`requestContract`, `assertGymStillAcceptsContract`), `contract.repository.ts` (cột mới).
- Kiểm thử (user-service, `guardedTest`, DB `gymcoach_user_test`, payment stub ở ranh giới client): hợp đồng gym có đủ snapshot; không gym thì các cột null; đổi thỏa thuận thương hiệu sang tỷ lệ khác → `GYM_TERMS_CHANGED` (đã có, giữ); thỏa thuận mới cùng tỷ lệ nhưng khác id → từ chối (hành vi mới, theo quyết định ở mục 8); hợp đồng cũ (cột null) vẫn accept/pay như trước.
- Nghiệm thu: bộ test hợp đồng hiện có (`contract-gym-recheck-and-payment-deadline`, `contract-activate-after-payment.integration`) vẫn xanh.

**P3.3 — Thực thi kiểm Membership ở request và accept.**
- Phạm vi: gói OFFLINE có `gymId` thì Membership còn hạn ở thương hiệu của chi nhánh là điều kiện (D18); lỗi có mã (`MEMBERSHIP_REQUIRED`, `MEMBERSHIP_EXPIRED`); gym-service không với tới được → 503 (như thỏa thuận, không coi là hợp lệ hay không hợp lệ); ghi `gymMembershipId`. Thời điểm kiểm phụ thuộc quyết định 8.1 và 8.2; **không code phần chưa chốt**.
- Tệp: `contract.service.ts` (`requestContract`, `acceptContract`), `gym.client.ts`. Không chạm `pay`.
- Kiểm thử: không có Membership → từ chối; Membership hết hạn giữa request và accept → từ chối ở accept, hợp đồng giữ `PENDING_REVIEW`; gym-service tắt → 503; hạn chế theo hợp đồng của An–Bình không chặn PT nhận Client khác (hồi quy D38); hạn chế theo tài khoản chặn.
- Nghiệm thu: ma trận trên xanh trên DB test; không hợp đồng nào tạo ra khi thiếu Membership.

**P3.4 — Endpoint "gym phù hợp" (user-service).**
- Phạm vi: `GET /contracts/gym-options` như bước 2; chỉ đọc; `clientId` từ `x-user-id`. Trả lý do bằng mã, không lộ tỷ lệ chia doanh thu cho Client.
- Tệp: file service/route/controller mới trong user-service; một dòng đăng ký route; gateway chỉ thêm đường nếu `/contracts` chưa bao trùm (`proxy.routes.ts:1294`, cần xác nhận khi làm).
- Kiểm thử: một chi nhánh phù hợp; nhiều chi nhánh; thiếu Membership (trả chi nhánh đề nghị + `referralCode`); PT bị hạn chế tài khoản; gói ONLINE (không gym); PT không có thỏa thuận (xem 8.4).
- Nghiệm thu: danh sách luôn là tập con của `listAcceptedGymsForPt` và không bao giờ đề xuất chi nhánh mà `requestContract` sau đó từ chối.

**P3.5 — Dữ liệu chuẩn bị thanh toán (chỉ đọc).**
- Phạm vi: vùng `checkoutContext` trong `GET /contracts/:id`: giá, số buổi, chi nhánh, thương hiệu, thỏa thuận, hạn thanh toán, trạng thái điều kiện kiểm lại. Tính từ snapshot, không bảng mới.
- Tệp: `contract.service.ts`/controller phần đọc. Không chạm `pay`.
- Kiểm thử: hợp đồng gym, hợp đồng độc lập, hợp đồng cũ không có snapshot. Nghiệm thu: khớp đúng dữ liệu `pay` sẽ gửi cho payment-service (so bằng test, không đổi `pay`).

**P3.6 — UI web/mobile (CẦN Owner duyệt riêng; quy tắc "không đổi UI nếu chưa được phép").**
- Phạm vi: bước chọn gym dùng P3.4; khi thiếu Membership chuyển sang mua gói với `referralCode` của PT tự điền (sửa `GymDetailModal.tsx` nhận mã qua tham số/route); hiển thị lý do bằng ngôn ngữ thường, không lộ mã nội bộ hay tỷ lệ.
- Tệp: `PTDiscoveryPage.tsx`, `GymDetailModal.tsx`, `frontend/mobile/app/client/services/pt/[id].tsx`, `api.ts` hai nền tảng.
- Kiểm thử: `REAL BROWSER` ở 360/375/390/412, và xóa cache khi đổi tài khoản (cache `gym-options` theo người dùng). Nghiệm thu: chỉ ghi VERIFIED khi có bằng chứng `REAL BROWSER`.

**P3.7 — Kiểm thử luồng liên dịch vụ (mock).**
- `BACKEND INTEGRATION` trên DB `*_test`, `FITNESS_DISABLE_REDIS=true` khi áp dụng, payment cổng MOCK: Client có Membership → request → PT accept → PENDING_PAYMENT → pay mock → ACTIVE; ca âm: PT bị hạn chế, gym đóng giữa chừng, thiếu Membership, thỏa thuận đổi tỷ lệ. Không dùng DB dev/prod. Báo cáo ghi đúng nhãn bằng chứng, không gọi code-reading là E2E.

Thứ tự: P3.1 → P3.2 → P3.3 → P3.4 → P3.5 → P3.6 (sau duyệt) → P3.7. P3.1 và P3.2 làm song song được (khác service, khác tệp).

## 6. Phối hợp với Phase 2 (PT QR Check-in) chạy song song

| Khu vực | Phase 3 chạm | Phase 2 dự kiến chạm | Rủi ro / cách tránh |
|---|---|---|---|
| gym-service `routes/internal.routes.ts` | thêm 1 dòng mount | có thể thêm tra buổi PT / quyền vào cửa | Xung đột dòng cạnh nhau. Phase 3 đặt route trong **tệp mới** và chỉ thêm 1 dòng mount |
| gym-service `collaboration.service.ts` | chỉ thêm `brandId` vào kết quả `activeRates` | audit L/D.2 đề xuất tách "ký mới được không" và "hợp đồng có sẵn còn thực hiện được không" | Phase 3 **không** sửa logic phân giải; nếu Phase 2 tách hàm, phải giữ nguyên chữ ký `activeRates` |
| gym-service `checkin.service.ts`, `GymCheckIn` | không sửa (chỉ đọc điều kiện join, viết lại thành hàm riêng) | sửa/mở rộng | Phase 3 sao chép điều kiện sang file mới, không refactor check-in |
| gym-service `schema.prisma` | không đổi schema | có thể thêm model/cột check-in | Phase 3 không có migration gym-service → tránh xung đột thứ tự migration |
| user-service `schema.prisma` + migration | 4 cột trên `Contract` | có thể thêm cột/bảng buổi tập | Hai migration độc lập, tên khác nhau; thống nhất thứ tự trước khi merge |
| user-service `contract.service.ts` | `requestContract`, `acceptContract`, `assertGymStillAcceptsContract` | ít khả năng; có thể đọc hợp đồng đang ACTIVE | Tệp chung với Financial Hardening (kết thúc/quyết toán): giữ diff nhỏ, rebase thường xuyên |
| user-service `internal.routes.ts`, `gym.client.ts` | thêm hàm client | có thể thêm endpoint "PT có buổi đủ điều kiện hôm nay" | Cộng thêm, không sửa dòng cũ |
| gateway `proxy.routes.ts` | có thể không cần | có thể thêm đường check-in PT | Nếu cả hai thêm, đặt khối riêng |

## 7. Ghi chú kiểm thử và vận hành

- Mọi test DB chạy trên `*_test` (`gymcoach_user_test`, `gymcoach_gym_test`), không đụng DB dev/prod, không in biến môi trường.
- Thanh toán chỉ cổng MOCK/sandbox. Không bật `SETTLEMENT_SWEEP_PARK_ORPHANS`, Financial Hold, hay 10% vì Phase 3 (D66, checklist M-C).
- Lỗi kỹ thuật phát hiện (không phải P0): `pt-discovery.service.ts:36` gọi đường không tồn tại (xử lý trong P3.1). Hai điểm yếu khác của audit 9/10 (hoàn tất chấm dứt không có job quét; thiếu mốc bắt đầu chấm dứt cho hợp đồng có sẵn) không thuộc luồng tạo hợp đồng nháp và giữ nguyên ở backlog.

## 8. OPEN BUSINESS DECISIONS

**Cập nhật 17/10 — Owner đã chốt (D67):**

| Mục | Quyết định |
|---|---|
| 8.1 Chưa có gói hội viên | **Chặn ngay khi gửi yêu cầu** (A). Lỗi nghiệp vụ rõ; frontend mời mua gói; không tự mua, không tự thanh toán. |
| 8.2 Gói ngắn hơn hợp đồng PT | **Chặn** nếu gói không bao phủ thời hạn hợp đồng (10 ngày / HĐ 60 ngày → chặn; 60/60 → cho; dài hơn → cho). Không tự gia hạn. |
| 8.3 Chi nhánh khách tập | DEFERRED, non-blocking — giữ quy tắc hiện tại: `gymId` chốt lúc tạo hợp đồng. |
| 8.4 Gói trực tiếp bắt buộc gym | DEFERRED — giữ thiết kế hiện tại (tùy chọn). |
| 8.5 So mã thỏa thuận lúc kiểm lại | DEFERRED — chưa làm (chỉ so tỷ lệ). |
| 8.6 Hoa hồng giới thiệu chi nhánh/thương hiệu | DEFERRED — giữ logic hiện tại. |
| Huy hiệu "cùng phòng tập" | DEFERRED — giữ logic hiện tại. |
| Trạng thái DRAFT | Không thêm; `PENDING_PAYMENT` sau khi PT nhận là hợp đồng nháp. |

Phần dưới giữ nguyên làm hồ sơ phương án đã cân nhắc.

**8.1 Client chưa có Membership thì xử lý thế nào, và kiểm ở bước nào?** D18 nói Client phải có gói để tập với PT tại gym, nhưng chưa nói khi nào bị chặn.
- A. Chặn ngay lúc gửi yêu cầu; dẫn Client đi mua gói rồi quay lại (mã giới thiệu tự điền).
- B. Cho gửi yêu cầu; chỉ chặn lúc PT nhận hoặc lúc thanh toán.
- C. Chặn lúc gửi yêu cầu nhưng cho phép "mua gói và gửi yêu cầu" trong một luồng liền mạch.
- Ví dụ: An chưa có gói ở thương hiệu GymX, chọn PT Cường (có thỏa thuận GymX). A: An phải mua gói trước khi PT thấy yêu cầu. B: Cường nhận yêu cầu rồi An mới phát hiện bị chặn khi trả tiền, hợp đồng nháp phí hạn 12 giờ.

**8.2 Membership phải còn hạn bao lâu so với hợp đồng?** Gói PT có thể kéo dài tới `validityDays` (ví dụ 90 ngày) nhưng Membership 30 ngày.
- A. Chỉ cần còn hạn tại thời điểm tạo/nhận hợp đồng.
- B. Cảnh báo Client nếu Membership hết trước hạn dự kiến của hợp đồng nhưng vẫn cho đi tiếp.
- C. Chặn nếu Membership hết trước ngày kết thúc dự kiến của hợp đồng.
- Ví dụ: Bình có Membership còn 10 ngày, mua gói PT 12 buổi/90 ngày. A: được. B: được, kèm cảnh báo. C: phải gia hạn Membership trước.

**8.3 "Chi nhánh nơi Client thực sự tập" là chi nhánh cố định của hợp đồng hay theo từng buổi?** Mã hiện nay chốt một `gymId` lúc tạo hợp đồng và phần gym về ví chi nhánh đó. Membership lại dùng được ở mọi chi nhánh của thương hiệu.
- A. Chi nhánh cố định lúc tạo hợp đồng (đúng như mã hiện tại; Client chỉ tập ở chi nhánh đã chọn).
- B. Chi nhánh cố định nhưng cho đổi trước buổi đầu tiên, có PT đồng ý.
- C. Theo từng buổi, phần gym về chi nhánh của buổi đó (chạm đường tiền và ledger, thuộc Financial Hardening).
- Ví dụ: Bình có Membership thương hiệu GymX, hợp đồng chọn GymX Quận 1, nhưng tuần sau tập ở GymX Quận 7. A: phần gym vẫn về Quận 1. C: tuần đó về Quận 7.

**8.4 Gói OFFLINE có bắt buộc gắn gym không?** Hiện gym là tùy chọn; không chọn thì hợp đồng độc lập, không có phần gym, không kiểm Membership.
- A. Giữ như nay: Client có thể chọn "không qua gym" khi PT không có thỏa thuận hoặc Client muốn tập ngoài gym.
- B. Nếu PT có ít nhất một thỏa thuận dùng được thì buộc chọn gym; PT không có thỏa thuận thì vẫn độc lập.
- C. Mọi gói OFFLINE phải qua gym.
- Ví dụ: Cường có thỏa thuận với GymX, An muốn tập ở công viên. A: được. B: không được (phải qua GymX). C: Cường không nhận được An.

**8.5 Hợp đồng có "dính" thỏa thuận cụ thể đã chụp không?** Nếu thỏa thuận thương hiệu bị chấm dứt rồi ký lại cùng tỷ lệ khi hợp đồng đang nháp.
- A. Chỉ so tỷ lệ như D12 hiện nay; thỏa thuận mới cùng tỷ lệ thì đi tiếp.
- B. Phải đúng `gymAgreementId` đã chụp; thỏa thuận mới thì từ chối và Client tạo yêu cầu mới.
- Ví dụ: Thỏa thuận GymX–Cường (PT 70/gym 20) bị chấm dứt hôm thứ Hai, ký lại 70/20 hôm thứ Ba, hợp đồng nháp của An tồn tại từ thứ Hai. A: An thanh toán được. B: An phải tạo lại.

**8.6 Hoa hồng giới thiệu tính theo chi nhánh hay thương hiệu** (câu 11 của audit ngày 9/10, nay ảnh hưởng đến tự điền mã). `hasEverHadMembershipAt(clientId, gymId)` tính theo chi nhánh.
- A. Giữ theo chi nhánh. B. Theo thương hiệu: đã từng có gói ở bất kỳ chi nhánh nào thì không có hoa hồng.
- Ví dụ: Bình từng mua gói ở GymX Quận 1, nay mua gói ở GymX Quận 7 qua mã của Cường. A: Cường vẫn được hoa hồng. B: không.

## 9. Backlog (không thuộc Phase 3)

Financial Hardening (GĐ1 SETTLING, GĐ2 idempotency payment, gỡ nhánh tự đền từ ví chung, Financial Hold/10%, đối soát, cổng production, dữ liệu tồn đọng) và Security Hardening (xoay khóa, `ALLOW_INSECURE_DEV_SECRETS` fail-closed) nằm ở M-C của `docs/PHASE_2_5_EXIT_CHECKLIST.md`, không chặn Phase 3 và Phase 3 không được dùng để mở thanh toán thật. Lỗi kỹ thuật nhỏ phát hiện ở đây (đường `active-gyms` không tồn tại, gym-service chưa có guard tên DB `_test`) đi vào backlog hoặc được P3.1 xử lý.

## 10. Checkpoint 17/10/2026 — PHASE 3 FUNCTIONAL SCOPE COMPLETE + VERIFIED

**Đã hoàn thành**

| Lát | Commit | Nội dung |
|---|---|---|
| P3.1 | `0e021aa` | gym-service: tra gói hội viên theo thương hiệu, `active-gyms`, `brandId` trong tỷ lệ |
| P3.2, P3.4, P3.5 | `07514f2` | Hợp đồng lưu thương hiệu/thỏa thuận/gói; `GET /contracts/gym-options`; `GET /contracts/:id/checkout-context` |
| P3.3 | `517ac34` | Chặn khi thiếu gói hội viên (`MEMBERSHIP_REQUIRED`) hoặc gói không bao phủ thời hạn (`MEMBERSHIP_DOES_NOT_COVER_CONTRACT`) |
| P3.7 | `e46b1aa` | Kiểm thử toàn luồng: gym-service + payment-service thật, sổ cái thật trên DB kiểm thử, cổng mô phỏng — 13/13 |
| P3.6 | `2654201` | Giao diện web + mobile; **VERIFIED trên trình duyệt thật** 360/375/390/412 (49/49 + thanh toán mô phỏng thành công/thất bại) |

**Kết quả kiểm thử chính:** P3.3 18/18; gym-options 16/16; checkout-context 10/10; snapshot 9/9; phase3-flow 13/13; cross-service-money 12/12; logic hiển thị 28/28 (web, mobile); REAL BROWSER 49/49 (Chromium, backend thật trên DB `*_p36_test`, cổng VNPay mô phỏng). Mobile (Expo) chưa chạy trên thiết bị/trình giả lập.

**Quy tắc đã chốt (không mở lại):** thiếu/không đủ hạn gói hội viên → chặn khi gửi yêu cầu; `PENDING_PAYMENT` sau khi PT nhận = hợp đồng nháp; gym đóng/khóa/chấm dứt không chọn được; hạn chế đúng hợp đồng chặn, hạn chế hợp đồng khác không chặn; không lộ tỷ lệ cho khách; checkout chỉ đọc và khớp số tiền Payment ghi nhận; callback lặp/đồng thời chỉ kích hoạt + ghi tiền một lần; tỷ lệ chia lấy từ thỏa thuận cấp thương hiệu (70/20/10 chỉ là dữ liệu kiểm thử).

**Backlog (không chặn Phase 3):** chưa kiểm lại gói hội viên lúc PT nhận/thanh toán; chưa so số lượt tập với số buổi; gói hiển thị có thể khác gói dùng để xét (chỉ hiển thị, quyết định vẫn đúng); tiền thanh toán thừa về ví nội bộ; chữ tiếng Anh trên trang hợp đồng; nút "Về Ví" ở màn thanh toán thất bại; nhãn "Nạp ví" trên trang VNPay mô phỏng; cảnh báo React button lồng button; mobile chưa kiểm trên thiết bị.

**Không phải Phase 3 (track riêng, chặn tiền thật):** Financial Hardening (SETTLING, Payment idempotency, gỡ nhánh tự đền từ ví AVAILABLE chung, đối soát, cổng khác, Financial Hold 10%) và Security Hardening (xoay khóa đã lộ — việc của Owner, `ALLOW_INSECURE_DEV_SECRETS`). **Phase 3 hoàn thành ≠ production-ready.**
