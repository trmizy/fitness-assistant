# Quản lý đối tác phòng tập

> Trạng thái: **Cả 5 phase đã xong** (nền tảng danh tính, admin cấp/quản lý tài khoản,
> chủ gym thiết lập + mời quản lý, hồ sơ thẩm định + hàng đợi, tạm khoá/chấm dứt/chiết
> khấu) — backend lẫn frontend. Kiểm chứng: 157 test tự động (120 gym-service + 37
> auth-service) + 73 khẳng định qua HTTP thật trên stack đang chạy, xem mục 8.

---

## 1. Tách đối tác / tài khoản — và vì sao

### Vấn đề trước đó

Một chủ gym **là** một `userId`. Hệ quả:

- Mật khẩu trở thành thứ bàn giao tay này sang tay khác giữa các quản lý chi nhánh.
- Quản lý nghỉ việc → phải đổi mật khẩu → cả nhà cùng gián đoạn.
- Nhật ký kiểm toán chỉ ghi được một danh tính duy nhất, không biết ai thực sự thao tác.

### Mô hình hiện tại

```
GymPartner  (pháp nhân — sở hữu 1 thương hiệu, 1 hồ sơ, 1 ví)
   │
   ├── GymPartnerAccount  nguyen.minh@…   OWNER    ← đúng 1, đang hoạt động
   ├── GymPartnerAccount  tran.hoa@…      MANAGER  ← chi nhánh Q1
   └── GymPartnerAccount  le.nam@…        MANAGER  ← chi nhánh Q7
```

Hộ kinh doanh cá thể → đối tác có đúng một tài khoản. Chuỗi lớn → thêm tài khoản.
**Cùng một mô hình**, khác nhau ở số tài khoản đăng nhập.

### ⛔ Đây KHÔNG phải `GYM_STAFF` quay lại

Vai trò `GYM_STAFF` đã bị gỡ khỏi hệ thống và **không được dựng lại**. Điểm khác biệt:

| | `GYM_STAFF` (đã gỡ) | Mô hình hiện tại |
|---|---|---|
| Vai trò ở auth-service | một enum riêng | vẫn đúng `GYM_OWNER` cho mọi tài khoản đối tác |
| Bộ định tuyến | router riêng | dùng chung `/owner/*` |
| Màn hình | màn hình riêng | dùng chung, ẩn/hiện theo quyền |
| Nơi phân quyền | tầng xác thực | gym-service tự phân giải |

`PartnerAccountRole` (`OWNER` / `MANAGER`) là quyền **bên trong một đối tác**, không phải
vai trò hệ thống. auth-service không biết khái niệm này tồn tại.

### Mấu chốt kỹ thuật: `principalUserId`

Mọi bảng sẵn có (`Gym.ownerId`, `GymBrand.ownerId`) đang khoá theo userId của **chủ sở
hữu**. Thay vì viết lại từng câu truy vấn quyền sở hữu, có một tầng dịch danh tính:

```
người gọi (userId)  ──resolvePartnerContext──>  { partnerId, role, scopedGymIds, principalUserId }
                                                                                    │
                                    mọi service sẵn có (getOwnedGym, …) dùng giá trị này
```

- Chủ sở hữu: `principalUserId === userId của chính họ`
- Quản lý: `principalUserId === userId của chủ sở hữu đối tác mình`

Nhờ vậy `gymService.getOwnedGym` và toàn bộ kiểm tra quyền sở hữu cũ chạy **y nguyên,
không sửa một dòng** — một quản lý thao tác dưới danh nghĩa hồ sơ của chủ sở hữu, còn
ranh giới quyền do hai guard riêng đảm nhiệm.

> ⚠️ **Hệ quả cho Phase 2 (chuyển quyền sở hữu):** vì `Gym.ownerId` là dữ liệu phi chuẩn
> hoá trỏ tới chủ sở hữu hiện tại, chuyển quyền sở hữu **không chỉ** là đổi cột `role`
> giữa hai tài khoản — nó phải ghi lại `Gym.ownerId` và `GymBrand.ownerId` của đối tác đó
> sang userId mới **trong cùng một giao dịch**. Quên bước này thì chủ mới đăng nhập vào
> thấy trống trơn. Có hàm `partnerService.assertOwnershipConsistent(partnerId)` để phát
> hiện lệch.

---

## 2. Vòng đời trạng thái đối tác

```
PROSPECT ──cấp tài khoản──> INVITED ──chấp nhận thư mời──> ACTIVE
    │                          │                             │
    └──từ chối──> (vẫn PROSPECT,  (chưa cài "hết hạn tự động│
       rejectedAt/reason)          cho thư mời OWNER" — xem   ↓
       mở lại: reopen()            mục 9)          SUSPENDED <──> ACTIVE
                                                          ↓
                                                     TERMINATED
```

- `PROSPECT → INVITED`: `partnerService.provisionOwnerAccount` (admin bấm "Cấp tài khoản").
- `INVITED → ACTIVE`: tự động khi tài khoản OWNER chấp nhận thư mời
  (`partnerInvitationService.acceptInvitation`) — không có hành động admin riêng.
- `ACTIVE ⇄ SUSPENDED`: `partnerService.suspend` / `unsuspend` (Phase 5 mục 4 bên dưới).
- `* → TERMINATED`: `partnerService.terminate` — **một chiều**, không có hành động nào đưa
  một đối tác đã TERMINATED quay lại trạng thái khác.
- Từ chối hồ sơ (`partnerDiligenceService.reject`/`reopen`, Phase 4) **không phải một
  trạng thái riêng** — cố ý giữ đúng 5 giá trị enum đặc tả liệt kê; PROSPECT bị từ chối chỉ
  khác PROSPECT mới ở hai cột `rejectedAt`/`rejectionReason`, `reopen()` xoá hai cột đó.

---

## 3. Ma trận quyền OWNER / MANAGER

Ranh giới một câu: **tiền và người thì chỉ chủ sở hữu.**

| Chức năng | OWNER | MANAGER | Chốt chặn trong mã |
|---|---|---|---|
| Xem ví, yêu cầu rút tiền | ✅ | ❌ | `requirePartnerOwner` |
| Mời / thu hồi tài khoản | ✅ | ❌ | `requirePartnerOwner` (`ownerPartnerController`) |
| Đàm phán cộng tác PT, mời PT | ✅ | ❌ | `requirePartnerOwner` |
| Sửa thông tin thương hiệu | ✅ | ❌ | `requirePartnerOwner` |
| Tạo / sửa chi nhánh | ✅ | ❌ | `requirePartnerOwner` |
| **Sửa** gói hội viên | ✅ | ❌ | `requirePartnerOwner` — xem ghi chú ⚠️ |
| **Xem** gói hội viên | ✅ | ✅ | không guard |
| Xem hội viên, check-in | ✅ | ✅ (chi nhánh được gán) | `requireGymScope` |
| Đổi trạng thái vận hành chi nhánh | ✅ | ✅ (chi nhánh được gán) | `requireGymScope` |
| Danh sách chi nhánh | ✅ (tất cả) | ✅ (chỉ chi nhánh được gán) | lọc trong `gymController.listOwned` |
| Trả lời đánh giá | — | — | 🚧 chức năng này **chưa tồn tại** trong hệ thống |

> ⚠️ **Sai khác có chủ ý so với bảng gốc.** Bảng gốc ghi "Quản lý gói hội viên: MANAGER ✅
> (chi nhánh được gán)". Không cài được như vậy: gói hội viên đã là tài sản **cấp thương
> hiệu** (một gói bán cho cả chuỗi, dùng được ở mọi chi nhánh — check-in đa chi nhánh dựa
> vào đó), nên "giới hạn theo chi nhánh" không diễn đạt được. Đã chốt: **chỉ chủ sở hữu
> sửa gói** (gói = giá bán = chạm tiền), quản lý vẫn đọc được để tư vấn khách.

Đừng làm ma trận chi tiết hơn hai cấp. Một thương hiệu, vài chi nhánh — phân quyền chi
tiết chỉ tạo thêm việc hỗ trợ mà không ai dùng.

---

## 4. Bảng hệ quả tạm khoá

Tạm khoá tài khoản **OWNER**, không phải toàn bộ đối tác — `partnerService.suspend` chỉ
đổi `partner.status` và khoá đăng nhập của đúng tài khoản OWNER (`authClient.setUserActive`).
Mọi hệ quả khác không cần code riêng — chúng đọc thẳng `partner.status` ở đúng chỗ đã có
sẵn từ trước:

| Đối tượng | Hệ quả | Cài ở đâu |
|---|---|---|
| Tài khoản OWNER | ❌ không đăng nhập được | `partnerService.suspend` gọi `authClient.setUserActive(false)` |
| Tài khoản MANAGER | ✅ vẫn hoạt động | không đụng tới — chỉ OWNER bị khoá |
| Bán gói hội viên mới / gia hạn | ❌ dừng | `partnerGuard.assertAcceptsNewMoney` trong `membershipService.purchase` **và** `retryPay` (gia hạn = bán mới, dùng chung cổng chặn) |
| Gói hội viên đang ACTIVE | ✅ chạy tới hết hạn | không có gì chặn — cổng chặn chỉ nằm ở lúc mua/thanh toán |
| Check-in hội viên còn hạn | ✅ bình thường | `checkin.service.ts` **cố ý không gọi** `partnerGuard` |
| Trang tìm kiếm công khai | ❌ ẩn | `gymService.listApproved`/`getApprovedById` lọc qua `partnerGuard.hiddenFromPublicOwnerUserIds()` (gồm cả TERMINATED) |
| Ghi nhận doanh thu vào ví | ✅ vẫn ghi | không đụng tới luồng thanh toán/webhook |
| Yêu cầu rút tiền | ❌ **đóng băng** | `partnerGuard.assertWithdrawalsAllowed` ở `POST /owner/gyms/:gymId/withdrawals` |
| Cộng tác PT mới | ❌ dừng | `partnerGuard.assertAcceptsNewMoney` trong `collaborationController.proposeAsGym` |
| Hợp đồng PT đang chạy | ✅ tiếp tục | không đụng tới |

Không thông báo lý do tạm khoá cho hội viên — `suspendedReason` chỉ admin thấy được (tab
Tổng quan của màn 360°), không lộ ra API công khai nào.

---

## 5. Chiết khấu — chụp ảnh, không đọc từ cấu hình

`PlatformCommissionRate` (bảng mới) — mỗi dòng là một mức + `effectiveFrom`. Đổi mức =
**thêm dòng mới**, `commissionRateService.setRate` không bao giờ `UPDATE` dòng cũ.

`commissionRateService.resolveEffectiveRateForOwner(ownerId)` trả về **một chuỗi số cụ
thể** tại đúng thời điểm gọi — ưu tiên `GymPartner.commissionRateOverride` đã đàm phán
riêng, không có thì dùng mức chung đang hiệu lực. `membership.service.ts#attemptPayment`
gọi hàm này **đúng lúc khách bấm thanh toán** rồi gửi thẳng số đó cho payment-service, nơi
đã có sẵn cơ chế đóng băng rate vào `metadata` của giao dịch (xem
`payment-service/internal.routes.ts`'s `/payments/checkout` — "frozen ... rather than
looked up at settlement time"). Đổi mức chung sau đó không hồi tố bất kỳ hợp đồng nào đã
lập.

> ⚠️ **Quyết định đã hỏi và chốt:** sàn tối thiểu hiện có của hệ thống (0.10, "floored at
> 10%, same as PT contracts") **giữ nguyên**, dù đặc tả ghi "5% chung". Cả mức chung lẫn
> `commissionRateOverride` đều bị `commissionRateService`'s `clamp()` kẹp lên 0.10 tại thời
> điểm áp dụng — dòng cấu hình vẫn lưu đúng 5% (làm bằng chứng ý định), chỉ số tiền trích ra
> thực tế là không đổi. Không đụng tới `contract-money.ts` (công thức 3 bên của hợp đồng
> PT) — thay đổi này chỉ nằm trong đường tính commissionRate cho riêng gói hội viên.

---

## 6. Các bất biến và nơi bảo vệ chúng

| # | Bất biến | Bảo vệ ở đâu |
|---|---|---|
| 1 | Mỗi đối tác có **đúng một** tài khoản `OWNER` đang `ACTIVE` | **Partial unique index** `gym_partner_accounts_one_active_owner` (`WHERE role='OWNER' AND status='ACTIVE'`) + kiểm trước ở `partnerInvitationService.createInvitation` |
| 2 | Mỗi đối tác có **tối đa một** `brandId` | Cột đơn + `UNIQUE INDEX gym_partners_brand_id_key` + `partnerService.attachBrand` |
| 3 | Một `userId` thuộc **tối đa một** đối tác | `UNIQUE INDEX gym_partner_accounts_user_id_key` + kiểm trong `acceptInvitation` |
| 4 | `MANAGER` phải có ít nhất một chi nhánh trong `scopedGymIds` | **CHECK constraint** `gym_partner_accounts_manager_needs_scope` + kiểm trong `createInvitation` |
| 5 | Thu hồi tài khoản `OWNER` cuối cùng → **từ chối** | `partnerService.revokeAccount` (đếm `countActiveOwners`, ném 409) |
| 6 | Token thư mời **chỉ lưu băm** | `partnerInvitationService` — sha256, token gốc chỉ trả về một lần lúc tạo |
| 7 | Thư mời quá hạn không dùng được | `validateToken` — ném 410 và đánh dấu `EXPIRED` ngay lúc chạm tới |

**Vì sao cả ở CSDL lẫn ở service:** kiểm ở tầng service là kiểm "đọc rồi mới ghi" — hai
yêu cầu đồng thời đều đọc thấy "chưa có OWNER nào" rồi cùng ghi. Ràng buộc ở CSDL làm
yêu cầu thứ hai thất bại thật. Kiểm ở service tồn tại để trả lời được **vì sao** thay vì
ném một lỗi ràng buộc thô ra cho người dùng.

Kiểm chứng: `src/__tests__/partner-identity.integration.test.ts` (12 bài — Phase 1) +
`src/__tests__/partner-lifecycle.integration.test.ts` (15 bài — Phase 2-5), cả hai chạy
trên CSDL thật.

---

## 7. Nhật ký kiểm toán

Bảng `PartnerAuditLog` (gym-service riêng, tách khỏi `AuditLog` của auth-service — bảng đó
khoá theo chính người gây sự kiện tự thân LOGIN/LOGOUT; ở đây chủ thể và đối tượng là hai
người khác nhau). Ghi: `actorUserId` (ai) · `action` (làm gì) · `partnerId`/`targetAccountId`
(lên ai) · `createdAt` (lúc nào) · `reason` · `ipAddress`/`userAgent`.

Ghi bắt buộc qua `partnerAuditService.record(...)`, gọi ở mọi hành động quản trị:
tạo/sửa hồ sơ, cấp tài khoản, gửi lại/thu hồi thư mời, đặt lại mật khẩu, buộc đăng xuất,
thu hồi tài khoản, chuyển quyền sở hữu, tạm khoá/bỏ tạm khoá/chấm dứt, **và xem dưới góc
nhìn đối tác** (`VIEWED_AS_PARTNER`) — thiếu dòng này thì tính năng "chỉ đọc, không tạo
token mạo danh nào" sẽ thành một cửa hậu không dấu vết. Ghi nhật ký không bao giờ làm hỏng
hành động chính: lỗi ghi chỉ log cảnh báo (`logger.error`), không throw — xem doc comment
của `partnerAuditService.record`.

Xem lại: tab "Nhật ký" của màn 360° (`GET /admin/partners/:id/audit-log`).

---

## Phụ lục A — Backfill dữ liệu cũ

Migration `20260908000000_gym_partner_identity` tạo cho **mỗi chủ gym đang có** một
`GymPartner` (`status=ACTIVE`, `partnerKind=INDIVIDUAL`, `legalName` lấy tạm theo tên
thương hiệu/chi nhánh) kèm một `GymPartnerAccount` role `OWNER`.

- `partnerKind=INDIVIDUAL`: đoán "hộ cá nhân" cho dữ liệu cũ an toàn hơn đoán "doanh
  nghiệp" rồi bịa ra một pháp nhân không tồn tại.
- `contactEmail` để trống: gym-service không hề lưu email chủ gym. Admin bổ sung ở Phase 4.

Ngoài ra `partnerService.resolveContextForUser` có **nhánh dự phòng**: tài khoản
`GYM_OWNER` không có hồ sơ đối tác vẫn hoạt động đúng như trước (tự làm chủ chính mình,
không giới hạn chi nhánh). Nhánh này dành cho CSDL seed thẳng vào bảng `gyms` ở môi trường
demo/test — không có nó thì các môi trường đó mất quyền truy cập ngay khi phase này lên,
một cách hỏng rất im lặng.

⚠️ **Bug thật bắt được lúc live-test, đã fix**: `onboardingService.getProgress` và
`requireOnboardingComplete` ban đầu tính `completed` bằng cách kiểm tra sống từng ô
(contactPhone/brandId/payout/terms) — một chủ gym được backfill (`onboardingCompletedAt`
đã set nhưng các ô kia null vì chưa từng tồn tại với họ) bị tính lại thành "chưa xong" mỗi
request, khoá họ ra khỏi chính hệ thống của mình. Fix: một khi `onboardingCompletedAt` đã
set (dù tự làm hay backfill), coi là xong vĩnh viễn — không đánh giá lại từng ô.

---

## 8. Nghiệm thu

**157 test tự động** — `npx tsx --test src/__tests__/*.test.ts` ở cả hai service:
- gym-service: 120/120 (gồm 27 bài Phase 1-5 kể trên, phần còn lại là test tiền/hội viên
  đã có từ trước, xác nhận không bị chạm vào).
- auth-service: 37/37.

**73 khẳng định qua HTTP thật** trên stack Docker đang chạy (script dùng một lần, không
còn lưu trong repo) — đi hết một vòng đời thật: admin tạo hồ sơ → cấp tài khoản → chủ sở
hữu chấp nhận thư mời qua link → hoàn tất 5 bước thiết lập → tạo 2 chi nhánh → admin duyệt
→ mời quản lý (owner tự làm) → quản lý chấp nhận + hoàn tất 2 bước của mình → **ma trận
quyền kiểm đủ 5 hành động cấm với MANAGER** (ví, rút tiền, mời PT, tạo chi nhánh, xem chi
nhánh ngoài phạm vi) → hồ sơ thẩm định (giấy tờ, nhật ký trao đổi, điều khoản, từ chối/mở
lại) → hàng đợi việc cần làm → đặt mức chiết khấu mới → tạm khoá (xác nhận cả 2 cột hệ quả)
→ bỏ tạm khoá → chấm dứt hợp tác. Cũng xác nhận **không ai bị ảnh hưởng ngoài ý muốn**: chủ
gym có sẵn (jane.smith, 10 chi nhánh) và một chủ gym "legacy" tổng hợp riêng (không có hồ
sơ đối tác) đều dùng được bình thường sau khi lên; đối soát tiền toàn nền tảng vẫn cân bằng.

Đã dọn sạch mọi dữ liệu test (`zzz-e2e-*`, `zzz-ui-*`) — vô hiệu hoá tài khoản đăng nhập
(không hard-delete), xoá các dòng `gym_partners`/`gyms`/`gym_brands`/`platform_commission_rates`
tự tạo, giữ nguyên dữ liệu thật (jane.smith, admin, seed accounts).

---

## 9. Phạm vi chưa làm (nói rõ để không ai tưởng thiếu sót)

- **"Thư mời hết hạn tự động quay về INVITED để mời lại"** trong sơ đồ trạng thái gốc —
  hiện thư mời hết hạn chỉ tự đánh dấu `EXPIRED` (mục 6, bất biến #7); đối tác vẫn ở
  `INVITED`, admin phải chủ động bấm "Gửi lại thư mời" chứ không có job nền tự động nhắc.
  Hàng đợi việc cần làm (mục 4.2 đặc tả) đã bù việc này: mục "Đã mời > 7 ngày chưa đăng
  nhập" (`invitedTooLong`) chỉ đúng đối tượng để admin chủ động xử lý.
- **"Trả lời đánh giá"** trong bảng quyền gốc — chức năng này **chưa tồn tại** trong hệ
  thống (không có API/màn hình nào cho gym trả lời review), nên không có gì để phân quyền.
  Không tự dựng thêm vì đó là tính năng mới, ngoài phạm vi "quản lý đối tác".
- **Tải tệp giấy tờ thật** (Phase 4) — `GymPartnerDocument.fileUrl` nhận một URL bất kỳ do
  admin dán vào; không có pipeline tải file lên/lưu trữ nào được dựng mới. Ứng dụng đã có
  cơ chế lưu trữ tệp riêng ở chỗ khác (InBody, application PT) nhưng việc nối dây upload
  thật cho giấy tờ đối tác vẫn cần một phiên làm việc riêng nếu cần dùng thật.
- **Frontend không match từng pixel mockup ASCII** trong đặc tả — đã dựng đúng luồng, đúng
  hành vi, đúng ranh giới quyền, đúng nguyên tắc (queue-first, chip màu, xác nhận có số
  liệu cụ thể cho hành động không đảo ngược được, empty-state không phải lỗi), nhưng dùng
  lại đúng ngôn ngữ thiết kế đã có sẵn của ứng dụng (Tailwind, phosphor-icons) thay vì tự
  chế theo khung ASCII.
