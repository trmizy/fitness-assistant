# Vòng 4 — Tài liệu bàn giao

Cập nhật dần theo từng phase. Mọi quyết định khác với tài liệu nhiệm vụ gốc được ghi vào mục
**"Quyết định phát sinh"** cuối mỗi phase, kèm lý do — không sửa lặng lẽ.

---

## Phase A — Hai lỗ hổng concurrency trong `booking.service.ts` (P0)

Trạng thái: **XONG**, 3 fix + 6 test mới, toàn bộ 249 test của user-service xanh
(`node_modules/.bin/tsx.cmd --test src/__tests__/*.test.ts`).

### 1. Primitive `transitionStatus` — vì sao cần, dùng ở đâu, chỗ nào CHƯA chuyển đổi

**Vì sao cần**: `sessionRepository.updateStatus` (bản cũ) là một `db.session.update({where:{id}})`
trần — không có điều kiện tiên quyết trên `status`. Hai request đồng thời cùng đọc session ở
status X đều "thắng" và đều chạy side effect của mình. Đây chính xác là cách `cancelSession`'s
CONFIRMED branch có thể trừ quota hai lần (double-deduct) trước bản vá này.

`transitionStatus(id, expected: SessionStatus[], next, extra?, db?)` đóng vai trò
compare-and-swap (CAS), mô phỏng đúng phong cách `claimDeduction` đã có sẵn ở
[session.repository.ts:78-84](../backend/services/user-service/src/repositories/session.repository.ts#L78-L84)
(CAS trên cờ `sessionDeducted`) nhưng tổng quát hoá cho trường `status`:

```ts
transitionStatus: async (id, expected, next, extra?, db = prisma) => {
  const { count } = await db.session.updateMany({
    where: { id, status: { in: expected } },
    data: { status: next, ...extra },
  });
  return count === 1;
}
```

`updateMany`'s where-clause làm cho điều kiện tiên quyết atomic với chính câu ghi. Chỉ request
nào mà `expected` vẫn còn khớp với status hiện tại trong DB mới nhận `count === 1` (thắng) và
được phép chạy tiếp side effect (quota/tiền/thông báo). Mọi request thua nhận `false` → phải dừng
lại, trả 409 "Buổi tập đã được xử lý", **không đụng gì khác**.

**Đã chuyển sang dùng `transitionStatus`** (đúng phạm vi bắt buộc của Phase A):
- `cancelSession` — cả 2 nhánh REQUESTED và CONFIRMED
  ([booking.service.ts:692-698](../backend/services/user-service/src/services/booking.service.ts#L692-L698),
  [734-744](../backend/services/user-service/src/services/booking.service.ts#L734-L744))
- `confirmSession` — toàn bộ hàm viết lại, chạy trong `withPtScheduleLock`
  ([booking.service.ts:358+](../backend/services/user-service/src/services/booking.service.ts#L358))

**CHƯA chuyển đổi** (quyết định có cân nhắc, theo đúng quyền "nếu phát sinh rủi ro thì để lại"
mà tài liệu gốc cho phép):
- `markNoShow`, `respondToNoShowReport`, `disputeSession`/`openDispute`, `resolveDispute`

Lý do để lại: các hàm này vẫn dùng `updateStatus` trần (không CAS) để đổi status session, nhưng
mọi side-effect tiền/quota phía sau chúng đã đi qua đường đã được bảo vệ sẵn —
`deductQuotaOnce` (CAS qua `claimDeduction`) hoặc `compensateNoShowMoney`/`releaseSessionMoney`
(idempotency-key qua `settleTracked`, xem mục 2 bên dưới). Tức là: có race trên bản thân dòng
session-status (2 request có thể cùng ghi status), nhưng KHÔNG có race trên tiền/quota — hậu quả
tệ nhất là log/thông báo trùng, không phải double-charge. Rủi ro chuyển đổi các hàm này ngay bây
giờ (nhiều nhánh trạng thái hơn `cancelSession`/`confirmSession`, một số có vòng phản hồi hai
phía PT/khách) cao hơn lợi ích trong khung thời gian vòng này — đúng nguyên tắc "cách sửa an
toàn nhất là cách nhỏ nhất giải quyết đúng vấn đề đã nêu" của tài liệu gốc. Để lại cho vòng sau
nếu cần.

### 2. Ba đường tăng/trừ quota — cơ chế bảo vệ từng đường

| Đường | Hàm | Cơ chế bảo vệ | Ghi chú |
|---|---|---|---|
| Trừ quota khi buổi tập tự động xác nhận | `deductQuotaOnce` | CAS qua `claimDeduction` (cờ `sessionDeducted: false → true`) | Đã an toàn từ trước Vòng 4 |
| Bồi thường/giải ngân tiền khi no-show hoặc release | `compensateNoShowMoney` / `releaseSessionMoney` | Idempotency-key qua `settleTracked` (bảng `session_settlements`) | Đã an toàn từ trước Vòng 4 |
| Trừ/tăng quota khi huỷ buổi (`cancelSession`) | `contractRepository.incrementSession` | **Trước Vòng 4: KHÔNG có bảo vệ nào** — đây là P0 A1 | Nay được gác bởi `transitionStatus` CAS chạy TRƯỚC nó — chỉ request thắng CAS mới gọi `incrementSession` |

`cancelSession` là đường DUY NHẤT trong cả hệ thống từng gọi thẳng `contractRepository
.incrementSession` mà không qua CAS hay idempotency-key nào — đây chính là lỗ hổng A1.

### 3. Quy tắc "đọc lại bên trong lock"

`withPtScheduleLock(ptUserId, contractId, fn)` mở advisory lock Postgres
(`pg_advisory_xact_lock`), transaction-scoped. Quy tắc bắt buộc: **mọi dữ liệu dùng để quyết định
entitlement/status bên trong `fn` phải được đọc lại trên chính `tx` của lock đó** — không được
tái dùng biến đã đọc TRƯỚC khi vào lock.

Lý do: một biến đọc trước lock là ảnh chụp tại thời điểm đó; giữa lúc đọc và lúc lock thực sự
được cấp, một request khác hoàn toàn có thể đã ghi đè dữ liệu đó. So sánh "một nửa tươi (đọc
trong `tx`), một nửa cũ (biến ngoài lock)" nhìn giống như đã khoá nhưng thực chất vô hiệu hoá tác
dụng của lock.

Ba chỗ áp dụng trong Phase A:
- **A3 (`bookSession`)**: trước bản vá, `contract` được đọc ở dòng ~186 (ngoài lock), rồi
  `getRemainingEntitlements(contract)` bên trong lock lại dùng chính biến cũ đó để so với
  `countActiveByContract(contractId, tx)` (biến này thì đã đúng, đọc qua `tx`) — nửa tươi nửa cũ.
  Fix: thêm tham số `db` cho `contractRepository.findById` (mặc định `prisma`, có thể truyền
  `tx`), rồi bên trong lock gọi `const freshContract = await contractRepository.findById(contractId, tx)`
  và dùng `freshContract` cho MỌI so sánh entitlement. Biến `contract` đọc trước lock vẫn được
  giữ lại cho các kiểm tra không liên quan quota (ownership, sessionMode, duration).
- **A2 (`confirmSession`)**: viết lại từ đầu để chạy trong `withPtScheduleLock`; bên trong lock,
  đọc lại cả `session` (qua `tx.session.findUnique`) lẫn `contract` (qua
  `contractRepository.findById(..., tx)`) — không tái dùng bất kỳ object nào đọc trước lock.
- **A1 (`cancelSession`)**: không cần đọc lại contract bên trong lock vì A1 không dùng
  `withPtScheduleLock` — CAS của `transitionStatus` tự nó là cơ chế đồng bộ hoá đủ cho tình
  huống một session bị hai request cùng huỷ (không có "khung giờ" hay "entitlement" nào cần đọc
  lại, chỉ có status của chính session đó).

### Test đã viết (`booking-race-conditions.integration.test.ts`, thêm 6 test, tất cả real-Postgres, không mock DB)

1. Hai `cancelSession` đồng thời trên cùng session CONFIRMED → `usedSessions` tăng đúng 1 lần,
   request thua nhận 409.
2. `confirmSession` khi hợp đồng đã CANCELLED → bị từ chối.
3. `confirmSession` khi hợp đồng đã quá `endDate` → bị từ chối.
4. `confirmSession` khi PT bị khoá (`ptSuspended`) → bị từ chối.
5. Hai `confirmSession` cho hai session khác nhau, cùng khung giờ, cùng PT → chỉ một thành công.
6. `bookSession`: hợp đồng bị dùng hết quyền lợi đúng lúc giữa lần đọc trước-lock và lúc vào lock
   → bị chặn, không tạo session.

Toàn bộ 6 test PASS, cùng 2 test B1/B2 cũ trong file vẫn PASS, cùng toàn bộ 249 test của
user-service vẫn PASS.

### Quyết định phát sinh (Phase A)

1. **Migration drift chặn `migrate deploy`** (không liên quan Phase A, phát hiện khi cố chạy
   test): Postgres dev cục bộ bị kẹt ở migration `20260323000000_create_pt_contract_baseline`
   (lỗi `type "PTApplicationStatus" already exists`, mã 42710 — đối tượng đã tồn tại sẵn qua
   `db push` từ trước, không phải thiếu dữ liệu), chặn đứng 13 migration mới hơn (bao gồm
   `add_compensated_sessions`, `add_session_settlements` mà chính Phase A tests cần). Đã hỏi
   Ngài trước khi xử lý; được đồng ý chạy `prisma migrate resolve --applied
   20260323000000_create_pt_contract_baseline` rồi `prisma migrate deploy` cho 13 migration còn
   lại (toàn bộ là ADD COLUMN/CREATE TABLE mới, không DROP). Không đụng dữ liệu đã có, chỉ sửa sổ
   sách theo dõi migration của Postgres dev cục bộ.
2. **2 file test cũ cần cập nhật mock** — `pt-late-cancel-compensates-via-shared-outcome.test.ts`
   và `late-cancel-releases-money.test.ts` mock `sessionRepository.updateStatus`, nhưng
   `cancelSession` sau Phase A gọi `transitionStatus` thay vì `updateStatus`. Đã đổi mock sang
   `transitionStatus` (giữ nguyên tên gọi trong mảng `calls` để không phải đổi assertion nào) —
   không đổi hành vi nghiệp vụ nào, chỉ theo đúng primitive mới mà A1 giới thiệu.

---

## Phase B — Validate server-side cho brand/gym/plan (gym-service)

Trạng thái: **XONG**. Toàn bộ 65 test của gym-service xanh (41 cũ + 24 mới), chạy với
`DATABASE_URL=postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_gym` (xem ghi
chú môi trường cuối mục này).

### Những gì đã thêm

- `src/schemas/brand.schemas.ts` — `brandCreateSchema`, `brandUpdateSchema`
- `src/schemas/gym.schemas.ts` — `gymCreateSchema`, `gymUpdateSchema`
- `src/schemas/plan.schemas.ts` — `planCreateSchema`, `planUpdateSchema`
- `src/middleware/validate.middleware.ts` — `validateBody(schema)`, chạy ở ROUTE layer
  (`owner.routes.ts`), trước khi controller/service thấy `req.body`. Sai → 400
  `{success:false, error:{code:'VALIDATION_ERROR', message:"<thông báo tiếng Việt, chỉ rõ
  field>"}}`. Đúng → `req.body` được thay bằng dữ liệu đã parse (đã trim/coerce đúng type).
- Gắn vào 6 route trong `owner.routes.ts`: `POST/PATCH /brands`, `POST/PATCH /gyms`,
  `POST/PATCH /gyms/:gymId/plans`.

### Ràng buộc từng field

| Model | Field | Ràng buộc |
|---|---|---|
| Plan | `name` | trim, 2-100 ký tự |
| Plan | `price` | số, > 0, trần 1.000.000.000đ (chặn nhập nhầm thêm số 0, cột DB là Decimal(12,2) nên còn dư nhiều) |
| Plan | `durationDays` | số nguyên, 1-3650 |
| Plan | `visitLimit` | `null` (không giới hạn) hoặc số nguyên dương |
| Plan | `saleStartAt`/`saleEndAt` | nếu cả hai có trong CÙNG request thì phải `saleStartAt <= saleEndAt` (xem lưu ý dưới) |
| Plan | `status` (chỉ update) | chỉ nhận `ACTIVE`/`INACTIVE` |
| Brand | `name` | trim, không rỗng, tối đa 100 ký tự |
| Brand | `description` | tối đa 2000 ký tự |
| Gym | `name` | trim, không rỗng, tối đa 150 ký tự |
| Gym | `address` | trim, không rỗng, tối đa 300 ký tự |
| Gym | `email` | đúng định dạng email, hoặc chuỗi rỗng (cho phép xoá email đã có) |
| Gym | `description`/`city`/`phone` | chỉ giới hạn độ dài, không bắt buộc |
| Gym | `brandId` (chỉ create) | phải là uuid |

### Lưu ý quan trọng: schema ở route layer KHÔNG thay thế `assertSaleWindowValid`

`planCreateSchema`/`planUpdateSchema` có `.refine()` kiểm `saleStartAt <= saleEndAt`, nhưng
refine này chỉ thấy được `req.body` của MỘT request — nếu một lần update chỉ gửi `saleEndAt`
mới (không gửi lại `saleStartAt` cũ), schema không có cách nào biết `saleStartAt` đang lưu
trong DB để so sánh. `plan.service.ts`'s `assertSaleWindowValid` (đã có từ trước, merge với
giá trị đang lưu trong DB) **vẫn là chốt chặn thật cho trường hợp update một phần** — không
được xoá hàm đó, và tại hạ không đụng vào nó.

### Ghi chú môi trường (không phải bug, để lần sau khỏi mất công dò lại)

`gym-service` (khác với `user-service`) **không có file `.env` riêng** và `prisma.ts` không
load dotenv — chạy `tsx --test` trực tiếp từ host (ngoài Docker) thiếu `DATABASE_URL`, integration
test báo lỗi "Environment variable not found: DATABASE_URL" trông như test hỏng nhưng thực ra
chỉ do thiếu biến môi trường. DB của gym-service trong Postgres dev dùng chung là
`gymcoach_gym` (không phải `gymcoach` mặc định) — set tay:
`export DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_gym"`
trước khi chạy `pnpm test` cục bộ.

### Quyết định phát sinh (Phase B)

Không có quyết định nào khác với tài liệu gốc trong phase này — phạm vi làm đúng những gì
tài liệu liệt kê (3 cặp schema, validate ở route layer, message tiếng Việt chỉ rõ field).

## Phase C — Brand & branch/gym management

Trạng thái: **XONG**. Backend + frontend đầy đủ, 89/89 test gym-service xanh (41 cũ + 24
Phase B + 24 mới Phase C). `docker compose build gym-service && up -d gym-service` chạy sạch,
migration tự áp khi container khởi động ("No pending migrations to apply").

### Quyết định phát sinh — ĐÃ HỎI TRƯỚC KHI LÀM

Tài liệu gốc giả định có sẵn "màn hình quản lý thương hiệu của admin" để thêm nút "Duyệt đổi
tên thương hiệu" vào. Kiểm tra thực tế: **frontend chưa có bất kỳ trang admin nào cho gym/brand**
(không có UI gọi `PATCH /admin/gyms/:id/status` dù route đã tồn tại từ trước). Đã hỏi Ngài
trước khi quyết — được chọn: tạo trang admin mới `AdminGymModeration.tsx` (4 tab: chờ duyệt lần
đầu, đổi tên/địa chỉ gym chờ duyệt, đổi tên thương hiệu chờ duyệt, đã đóng cửa vĩnh viễn), thêm
vào nav admin (`/admin/gyms`).

### 4. `approvedName`/`pendingName` — luồng duyệt lần đầu và luồng đổi tên sau này

**Thiết kế**: `name`/`address` (Gym) và `name` (GymBrand) vẫn là giá trị làm việc hiện tại, chủ
sở hữu sửa tự do, mọi nơi KHÔNG phải trang công khai đều đọc trực tiếp (biên lai check-in, danh
sách hội viên, dashboard chủ gym...) — không đổi vai trò so với trước Vòng 4. `approvedName`/
`pendingName` (và `approvedAddress`/`pendingAddress` cho Gym) là lớp phủ kiểm duyệt CHỈ hai
điểm cuối công khai đọc (`gymService.listApproved`/`getApprovedById`, thay `name`→`approvedName`
trước khi trả về — response DTO giữ nguyên tên field `name`/`address`, nên các trang công khai
phía frontend — GymsPage/GymPage/GymDetailPage — **không cần sửa gì cả**).

- **Duyệt lần đầu (brand)**: khi admin duyệt chi nhánh ĐẦU TIÊN của brand (hành động sẵn có —
  `PATCH /admin/gyms/:id/status` → APPROVED), nếu `brand.approvedName` đang null →
  `approvedName = pendingName`, xoá `pendingName`. Không cần hành động admin mới.
- **Duyệt lần đầu (gym)**: cùng lúc gym đó được duyệt lần đầu (`approvedName` đang null) →
  `approvedName = pendingName`, `approvedAddress = pendingAddress`, xoá cả hai pending. Cùng
  một hành động admin (`setStatus`), không cần nút riêng.
- **Đổi tên sau này**: `updateBrand`/`updateOwnedGym` chỉ dời `pendingName`/`pendingAddress` —
  KHÔNG đụng `approvedX`. Phải dùng nút mới: "Duyệt tên/địa chỉ mới" (gym,
  `PATCH /admin/gyms/:id/approve-rename`) / "Duyệt đổi tên thương hiệu" (brand,
  `PATCH /admin/brands/:id/approve-rename`) — **đây là phần dễ quên nhất đúng như tài liệu gốc
  cảnh báo**, vì lần đổi tên sau không có chi nhánh mới nào đi kèm để "tiện tay" duyệt chung.
- **Duyệt lại sau SUSPENDED**: `gymService.setStatus` chỉ backfill khi `approvedName === null`
  — duyệt lại lần 2/3 sau khi từng bị khoá sẽ KHÔNG âm thầm thăng một pending rename chưa qua
  `approveRename` (có test riêng xác nhận hành vi này).
- **UI chủ sở hữu**: `GymManagePage.tsx` (gym) và `MyGymsPage.tsx`'s `BrandGroup` (brand) đều
  hiện dòng "Tên mới đang chờ duyệt: …" khi `pendingName`/`pendingAddress` khác null.

### 5. Hai trục trạng thái của gym + toàn bộ điểm kiểm

| Trục | Field | Ai đổi | Ý nghĩa |
|---|---|---|---|
| Kiểm duyệt (đã có từ trước) | `status`: PENDING_REVIEW/APPROVED/REJECTED/SUSPENDED | Admin | Gym có được phép tồn tại trên nền tảng không |
| Vận hành (Vòng 4 / C3, mới) | `operationalStatus`: OPEN/TEMPORARILY_CLOSED/PERMANENTLY_CLOSED | Chủ gym | Gym có đang mở cửa thật không |

Mọi điểm kiểm yêu cầu APPROVED nay yêu cầu **CẢ HAI** APPROVED và OPEN:

| Điểm kiểm | File | Trước Vòng 4 | Sau Vòng 4 |
|---|---|---|---|
| Hiển thị công khai | `gym.repository.ts` `findApproved`/`findApprovedById` | `status: APPROVED` | + `operationalStatus: OPEN` |
| Mua gói (`purchase`) | `membership.service.ts:101` | `status !== APPROVED` | + `operationalStatus !== OPEN` |
| Trả lại thanh toán (`retryPay`) | `membership.service.ts:192` | như trên | như trên |
| Kích hoạt sau thanh toán (`activateViaTransaction`) — **quan trọng nhất** | `membership.service.ts:395` | như trên | như trên — MỞ RỘNG chốt chặn có sẵn, không viết mới |
| Check-in | `checkin.service.ts` raw SQL | join `gyms.status` | + `gyms.operational_status` |

`PERMANENTLY_CLOSED` là trạng thái MỘT CHIỀU — không có API nào đổi ngược lại được.

**Kịch bản quan trọng nhất** (checkout lúc OPEN, chủ đóng TEMPORARILY_CLOSED trước khi gateway
xác nhận, gateway xác nhận sau): tự động rơi vào nhánh PENDING_ISSUE có sẵn từ trước (vốn được
xây cho trường hợp SUSPENDED) → hoàn tiền 100%, không kích hoạt. Có test riêng xác nhận
(`activate-rechecks-gym-status.test.ts`).

**Actionable item cho PERMANENTLY_CLOSED**: KHÔNG tự động hoàn tiền hội viên đang ACTIVE (đúng
yêu cầu tài liệu). `GET /admin/gyms/permanently-closed` liệt kê gym + số hội viên ACTIVE cần xử
lý — admin dùng lại hành động hoàn tiền CÓ SẴN (`refundByAdmin`, lý do `GYM_CLOSED`, đã có từ
trước) trên từng hội viên, không viết logic hoàn tiền mới. `logger.warn` khi đóng vĩnh viễn,
theo đúng "không cần hệ thống incident đầy đủ".

### 6. Chính sách bồi thường khi đóng cửa — CHỈ TÀI LIỆU, KHÔNG PHẢI CODE

| Tình huống | Chính sách |
|---|---|
| Tạm đóng cửa ≤ 7 ngày | Không bồi thường |
| Tạm đóng cửa > 7 ngày | Chủ gym yêu cầu, admin duyệt thủ công (chưa có API riêng — dùng `refundByAdmin` nếu admin quyết định hoàn) |
| Đóng cửa vĩnh viễn | Admin hoàn tiền theo tỷ lệ còn lại (`refundByAdmin`, lý do `GYM_CLOSED` — đã có sẵn) |

Không có logic đếm ngày/tự động nào được viết cho bảng này — đúng yêu cầu tài liệu gốc.

### 7. Ghi chú cho vòng sau: `accessScope` / `accessBrandIdSnapshot`

C4 cho phép chủ gym di chuyển một gym giữa các brand (`updateOwnedGym({brandId})`, `null` để
tháo ra) — tái dùng đúng check sở hữu `brandService.getOwnedBrand` đã có, không viết logic mới.

**Vấn đề để lại cho vòng sau (chưa làm, chỉ ghi chú)**: `GymMembershipContract` hiện đọc
`membership.gym.brandId` TRỰC TIẾP (sống) mỗi lần cần biết "hội viên này thuộc brand nào" —
không giống `priceAtPurchase` hay các tỷ lệ chia doanh thu (`platformRate`/`ptRate`/`gymRate`),
vốn đã được ĐÓNG BĂNG tại thời điểm mua. Hậu quả: nếu một gym bị chủ sở hữu di chuyển sang brand
khác SAU KHI đã bán hội viên, quyền truy cập của hội viên đã mua thay đổi ngầm mà không ai đồng
ý cả — một hội viên mua "quyền vào chuỗi X" có thể tự nhiên thấy mình thuộc chuỗi Y. Vòng sau
cần thêm `GymMembershipContract.accessBrandIdSnapshot` (đóng băng lúc mua, giống `priceAtPurchase`)
và đổi mọi chỗ kiểm tra quyền truy cập theo brand sang đọc field đó thay vì `membership.gym.brandId`
sống. Chưa làm trong Vòng 4 vì tài liệu gốc đánh dấu rõ "quyết định đã có, hoãn vòng này".

### Test đã viết

- `brand-gym-moderation-and-operational-status.test.ts` (24 test mới) — C1 (4), gym first-approval
  (2), C2 (3), C3 state machine (7), C4 (3), cộng thêm 2 test purchase/retryPay TEMPORARILY_CLOSED
  trong `gym-status-guards.test.ts`, 1 test TEMPORARILY_CLOSED trong
  `checkin-gym-status-guard.integration.test.ts`, 1 test kịch bản "quan trọng nhất" trong
  `activate-rechecks-gym-status.test.ts`.
- Sửa 4 mock cũ (`gym-status-guards.test.ts`, `activate-rechecks-gym-status.test.ts`,
  `referral-settlement-retries-after-failure.test.ts`) thiếu `operationalStatus: 'OPEN'` — mock
  tay không tự có field mới như row Prisma thật, nếu không sửa sẽ báo lỗi sai (gym bị chặn dù
  đang APPROVED). Sửa 1 test Phase B (`gymUpdateSchema` brandId) vì C4 cố ý thêm brandId vào
  schema update — giả định cũ của test không còn đúng nữa.

### Quyết định phát sinh khác

- Gateway thiếu khai báo proxy `/admin/brands` (chỉ có `/admin/gyms`) — cùng loại "sibling path
  cần khai báo riêng" như gotcha `/owner/brands` đã ghi chú sẵn trong chính file đó. Đã thêm.
- `frontend/web` không có `tsconfig.json` nào cả (xác nhận qua tìm kiếm) — không chạy được
  `tsc --noEmit` để kiểm type độc lập. Xác minh bằng `vite build` (esbuild transpile + bundle)
  thay thế — build sạch, 3024 module, không lỗi. Cảnh báo bundle-size/ảnh nặng đã có từ trước,
  thuộc phạm vi Phase D, không phải lỗi phát sinh từ Phase C.

## Phase D — Hiệu năng mobile

Trạng thái: **XONG cả 3 (D1/D2/D3)**. `vite build` sạch sau mỗi bước, không lỗi.

### D1 — Nén & gộp ảnh nền (số liệu trước/sau)

- **Trước**: 2 bản `bg-gym.jpg` giống hệt nhau (md5 trùng), mỗi bản 6,326,255 byte (~6.03MB),
  5888×3264 — một bản ở `public/bg-gym.jpg` (Vite copy nguyên văn ra `dist/` dù không component
  nào import trực tiếp path đó), một bản ở `src/assets/bg-gym.jpg` (import qua Vite, ra
  `dist/assets/bg-gym-[hash].jpg`). **Cả hai đều thực sự bị đóng gói vào bản build production**
  — tổng ~12MB ảnh trùng lặp, không phải chỉ 6MB "rác không dùng tới".
- **Sau**: 1 bản duy nhất `public/bg-gym.webp`, resize còn rộng 1440px, WebP quality 80,
  **136,412 byte (133KB)** — dưới xa mục tiêu 400KB. Dùng `sharp-cli` qua `npx` (không có
  ImageMagick/cwebp/ffmpeg cài sẵn trên máy).
- Sửa đúng 3 nơi tham chiếu thật (đã audit bằng grep toàn repo, không chỉ AppShell.tsx):
  `AppShell.tsx` (bỏ import Vite, dùng string path `/bg-gym.webp`), `public/offline.html`
  (CSS `url()`), `public/sw.js` (`PRECACHE_URLS` — kèm bump `APP_VERSION` để service worker cũ
  đã cài không tiếp tục phục vụ/tìm file `.jpg` đã xoá từ cache cũ).
- Audit ảnh >500KB toàn repo (loại trừ `node_modules`/`dist`/`android` build output): **không
  còn ảnh nào khác vượt ngưỡng**.

### D2 — Code-splitting theo route (số liệu trước/sau)

- **Trước**: `routes.tsx` có ~49 import trang tĩnh (đúng như tài liệu mô tả, con số 61 có thể
  tính cả các import không phải trang). Bundle JS chính duy nhất:
  **2,678.90 kB / gzip 709.08 kB** — mọi route, kể cả các trang admin một client thường không
  bao giờ vào, đều nằm chung một file tải ngay từ đầu.
- **Sau**: mọi trang chuyển sang `lazy(() => import("...").then(m => ({default: m.X})))`.
  Xác nhận trước khi viết: `grep -rl "export default" src/app/pages/` → rỗng — **toàn bộ trang
  trong codebase là named export**, nên áp dụng đúng 1 khuôn mẫu `.then(m => ({default: m.X}))`
  cho tất cả, không có ngoại lệ default-export nào phải xử lý riêng.
  Bundle chính còn: **704.23 kB / gzip 219.80 kB** (giảm **73.7%** raw, **69.0%** gzip). Phần
  còn lại tách thành ~60 chunk riêng theo từng trang, tải theo nhu cầu.
- `<Suspense fallback={<PageSkeleton />}>` đặt ĐÚNG quanh `<Outlet/>` bên trong
  `<motion.div>`/`<AnimatePresence mode="sync">` đã có sẵn trong `AppShellInner`
  (`AppShell.tsx`) — **không đụng** logic animation/`mode="sync"`/clipPath-đã-gỡ (nằm trong danh
  sách "đã đúng, không sửa" của tài liệu gốc). Topbar/Sidebar/BottomNav nằm ngoài `<main>`, nên
  không bao giờ bị Suspense ảnh hưởng — bottom nav không giật khi chuyển trang. `Root` (bọc
  `/login`, `/register`) cũng được bọc Suspense riêng vì không có nav chrome để mà "chỉ vùng nội
  dung" — toàn bộ `<Outlet/>` ở đó đã là vùng nội dung.
- `PageSkeleton` mới (`components/layout/PageSkeleton.tsx`) — tái dùng `Skeleton` primitive có
  sẵn (`components/ui/skeleton.tsx`), không viết CSS pulse-animation mới.
- Hệ quả cấu trúc (chưa test tương tác trực tiếp DevTools, suy ra từ cơ chế): mỗi route giờ là
  1 chunk JS riêng, chỉ `import()` khi route đó thực sự render — một tài khoản client không bao
  giờ vào `/admin/*` thì trình duyệt không bao giờ fetch chunk admin, vì file đó chưa từng được
  yêu cầu.

### D3 — Cache token trong bộ nhớ

`services/tokenStore.ts` mới — biến module-level, `get()`/`set()` đồng bộ. KHÔNG phải nguồn sự
thật (storage `@capacitor/preferences` vẫn là) — chỉ là bản sao trong bộ nhớ để tránh round-trip
native-bridge mỗi request.

**Mọi nơi ghi/xoá accessToken đều ghi CẢ HAI (storage + tokenStore), đúng thứ tự, không thiếu
bên nào** (đã audit toàn repo bằng grep `key:\s*"accessToken"`, không chỉ sửa chỗ tài liệu nêu):

| File | Hàm | Trước | Sau |
|---|---|---|---|
| `api.ts` interceptor | request interceptor | `await Preferences.get(...)` mỗi request | `tokenStore.get()` đồng bộ |
| `api.ts` | `refreshAccessToken` | `Preferences.set` | + `tokenStore.set` |
| `api.ts` | `authService.login` | `Preferences.set` | + `tokenStore.set` |
| `api.ts` | `authService.verifyRegistration` | `Preferences.set` | + `tokenStore.set` |
| `api.ts` | `clearStoredSession` (logout) | `Preferences.remove` | + `tokenStore.set(null)` |
| `api.ts` | AI chat streaming (`fetch` thô, không qua interceptor) | `await Preferences.get` mỗi lần gửi | `tokenStore.get()` |
| `session.ts` | `bootstrapSession` | — | **THÊM**: seed `tokenStore.set(accessToken)` ngay sau khi đọc storage, TRƯỚC bất kỳ request nào khác chạy |
| `session.ts` | `ensureFreshAccessToken` (resume app) | `await Preferences.get` | `tokenStore.get()` |
| `realtime/socketClient.ts`, `services/socket.ts` | socket auth callback | `await Preferences.get` mỗi lần connect/reconnect | `tokenStore.get()` |
| `AdminWorkflowStudio.tsx` | đọc token hiển thị link | `useEffect` + `Preferences.get` async | `useState(() => tokenStore.get())` đồng bộ |

**Điểm bắt buộc đã tự kiểm tra kỹ** (đúng cảnh báo tài liệu gốc: "làm hỏng chính thứ vừa sửa
xong ở vòng trước" nếu chỉ ghi memory mà quên storage): không có write site nào chỉ gọi
`tokenStore.set` mà thiếu `Preferences.set`/`.remove` đi kèm — xác nhận lại bằng đọc code, không
phải chỉ chạy build.

**Giới hạn xác nhận**: đã build sạch (`vite build`, 0 lỗi) và đọc lại toàn bộ luồng ghi/đọc để
xác nhận tính đúng đắn logic, nhưng **chưa** tự tay force-quit/mở lại app Capacitor thật để quan
sát trực tiếp DevTools/hành vi trên thiết bị trong phiên này — không có phiên Android/emulator
đang chạy sẵn ở đây. Ngài nên tự xác nhận bước này trên máy/điện thoại thật trước khi coi Phase D
là đóng hẳn.

### Quyết định phát sinh (Phase D)

- Không có ImageMagick/cwebp/ffmpeg/PIL cài sẵn trên máy — dùng `npx --yes sharp-cli` (tải tạm
  qua npx, không thêm dependency vĩnh viễn vào `package.json`) để resize + convert WebP.
- Mở rộng phạm vi D3 một chút so với chữ nghĩa tài liệu (chỉ nêu đích danh `api.ts:165`): áp
  dụng cùng pattern cho 2 file socket (`socketClient.ts`, `socket.ts`), 1 chỗ AI streaming
  `fetch()` thô, và `AdminWorkflowStudio.tsx` — tất cả đều đọc CÙNG key `accessToken` mà tài
  liệu đang thay đổi ý nghĩa nguồn-sự-thật của nó; để sót một chỗ sẽ tạo ra 2 cách đọc token
  khác nhau tồn tại song song trong cùng codebase, rủi ro lệch pha cao hơn là thêm vài dòng sửa.

## Phase E — Tuỳ chọn (E1-E5, đã làm cả 5)

Trạng thái: **XONG cả 5**. 260/260 test user-service, 93/93 gym-service, 26/26 payment-service.

### E1 — Grace period 15 phút trước khi báo vắng mặt

`NO_SHOW_GRACE_MINUTES` (env-var, mặc định 15) — `booking.service.ts`. Áp dụng CẢ HAI chiều:
`markNoShow` (PT báo khách/tự nhận) và `reportPtNoShow` (khách báo PT). Message lỗi đổi từ
"Chưa tới giờ buổi tập" sang "Chưa thể báo vắng mặt — cần đợi ít nhất N phút sau giờ hẹn" (đúng
hơn về mặt ngữ nghĩa — buổi tập ĐÃ tới giờ, chỉ là chưa hết grace) — đã cập nhật 3 test cũ dùng
regex khớp message cũ, thêm 4 test mới kiểm biên (5 phút = còn trong grace, 20 phút = hết grace).

### E2 — Quyền chấm dứt hợp đồng sau lần thứ 3 PT vắng mặt (KHÔNG tự động)

- `Session.ptAtFault` (mới) — true CHỈ khi NO_SHOW là lỗi PT thật (tự nhận, đồng ý báo cáo của
  khách, hoặc admin xác nhận qua `resolveDispute`) — không bao giờ set cho khách vắng mặt.
- `TerminationReason.PT_REPEATED_NO_SHOW` (mới, cả user-service lẫn payment-service) — dùng lại
  ĐÚNG công thức hoàn 100% đã có sẵn của `PT_BANNED`/`MUTUAL` trong `contract-money.ts` (không
  viết công thức tiền mới) — rủi ro với mã tiền ở mức tối thiểu vì chỉ thêm 1 case trỏ vào logic
  đã test sẵn.
- Chốt chặn thật ở server: `contractService.repeatedNoShowEligibility(contractId)` đếm lại
  `ptAtFault` — KHÔNG BAO GIỜ tin số đếm phía client. Client tự khai báo lý do
  `PT_REPEATED_NO_SHOW` mà chưa đủ 3 lần → 403.
- UI: `ContractPage.tsx` — banner 2 nút "Tiếp tục" / "Chấm dứt hợp đồng" xuất hiện lại MỖI LẦN mở
  hợp đồng đang đủ điều kiện (không lưu trạng thái "đã tắt vĩnh viễn") — bấm "Tiếp tục" chỉ ẩn
  cho lượt xem hiện tại, không gọi API nào — hệ thống không bao giờ tự chấm dứt.

### E3 — `effectiveAt` cho chấm dứt hợp tác PT↔gym (báo trước)

`GymPtCollaboration.effectiveAt` (mới, nullable). `terminate()` không truyền `effectiveAt` →
y hệt hành vi cũ (chấm dứt ngay). Truyền ngày tương lai → `status` VẪN `ACCEPTED` (PT còn hiển
thị đang cộng tác) tới ngày đó, nhưng `activeRates()` từ chối NGAY LẬP TỨC (chặn mã giới thiệu/
sao chép tỷ lệ MỚI) — đúng "hợp tác mới bị chặn ngay, hợp đồng đang chạy tiếp tục tới
effectiveAt". `finalizeIfEffective` (nhại `expireIfStale` có sẵn) tự chốt TERMINATED khi
effectiveAt đã qua, gọi từ mọi đường đọc (`listFor`). Không có UI chọn ngày báo trước — API đã
sẵn sàng, chỉ owner/PT tự gọi qua API trực tiếp nếu cần cho tới khi có UI riêng.

### E4 — `SessionDisputeType` (chỉ audit/màn hình admin)

Enum mới: `DELIVERY_DISPUTE` / `PT_NO_SHOW_CLAIM` / `CLIENT_NO_SHOW_CLAIM`. Không đổi
`resolveDispute`'s 3 kết quả — thuần phân loại. `disputeSession` phân biệt dựa vào `ptNotes`
("Client no-show" → CLIENT_NO_SHOW_CLAIM, còn lại → DELIVERY_DISPUTE); `respondToNoShowReport`
DENY luôn là PT_NO_SHOW_CLAIM (rõ ràng, không cần suy luận). Thêm badge nhỏ ở `AdminDisputes.tsx`.
Không backfill dữ liệu cũ (không đủ tin cậy suy ngược từ text tự do như E2's ptAtFault).

### E5 — Đổi tên app, thêm plugin, tách cấu hình dev/prod

- **Đổi tên**: "Fitness Assistant" → **"Gymini"** (theo Ngài chọn khi được hỏi — tài liệu gốc
  không cho tên cụ thể). Sửa `capacitor.config.ts`'s `appName` + `strings.xml`'s `app_name`/
  `title_activity_main`. KHÔNG đổi `appId`/`package_name`/`custom_url_scheme` (đổi bundle ID là
  thay đổi lớn hơn nhiều, không được yêu cầu). KHÔNG đụng `manifest.webmanifest` (PWA) — đó là
  danh tính khác ("Fitness AI - Gym Coach"), nằm ngoài phạm vi câu hỏi đã hỏi Ngài.
- **3 plugin mới**: `@capacitor/splash-screen`, `@capacitor/status-bar`, `@capacitor/haptics` —
  cài qua pnpm, xác nhận cả 7 plugin (kể cả 3 mới) được `cap sync` nhận diện đúng. StatusBar
  wiring: hook mới `useNativeStatusBar.ts` (tách riêng khỏi `AppContext.tsx` — KHÔNG đụng
  `bootstrapSession`/`appStateChange`/`appUrlOpen` đã có sẵn), `Style.Light` cho theme tối của
  app, no-op trên web, nuốt lỗi native (không phải thứ đáng làm crash app). SplashScreen: chỉ
  cấu hình mặc định hợp lý trong `capacitor.config.ts`, KHÔNG viết code JS gọi
  show/hide thủ công (rủi ro treo màn hình splash nếu quên gọi hide — để native tự lo qua
  `launchAutoHide`). Haptics: chỉ cài, chưa gắn vào điểm chạm cụ thể nào (tài liệu chỉ yêu cầu
  "thêm plugin", không có đặc tả UX cụ thể — tránh tự bịa hành vi rung).
- **Tách dev/prod**: `capacitor.config.ts` đọc `process.env.CAPACITOR_ENV` — mặc định (không có
  biến) = an toàn cho production (`androidScheme: 'https'`, không có `cleartext`). Script cũ
  `app:build`/`app:sync` (LAN dev, đã có sẵn `.env.capacitor`) đổi sang set
  `CAPACITOR_ENV=dev` (qua `cross-env`, mới thêm — cần cho Windows) — **hành vi giữ y nguyên
  cho ai đang dùng 2 lệnh này**. Script MỚI `app:build:prod`/`app:sync:prod` không set biến,
  cho ra cấu hình production sạch. Đã kiểm chứng THẬT bằng cách chạy cả `pnpm app:sync` (ra
  `androidScheme:"http", cleartext:true`) và `pnpm app:sync:prod` (ra `androidScheme:"https"`,
  không có `cleartext`) rồi so `capacitor.config.json` sinh ra — đúng như thiết kế.

### Quyết định phát sinh (Phase E)

- Đã hỏi Ngài trước khi đổi tên app (tài liệu gốc không cho tên) — được chọn "Gymini".
- E3 không có UI chọn ngày báo trước ở owner/PT — chỉ backend. Nếu cần UI, để lại cho vòng sau
  (không có trong 9 tiêu chí chấp nhận gốc của Vòng 4, và E3 vốn đã là hạng mục tuỳ chọn).
- E2 tái dùng công thức tiền có sẵn (không viết công thức mới) — quyết định có cân nhắc để giảm
  rủi ro chạm vào `contract-money.ts`, đã ghi rõ lý do ở trên.
