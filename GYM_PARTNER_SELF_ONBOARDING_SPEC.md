# GYM_PARTNER_SELF_ONBOARDING_SPEC.md

Đặc tả nghiệp vụ cho luồng **Gym Partner Self-Service Onboarding** (backend + web). Nguồn sự thật theo thứ tự:
(1) quy tắc nghiệp vụ Ngài đã chốt trong task này → (2) code/API hiện hành → (3) các spec `GYM_PARTNER_*` /
`GYM_BRANCH_FORM_SPEC.md` → (4) web hiện tại → (5) Figma. Tài liệu này ghi lại kết quả audit W0 (18–19/9/2026),
không phải kế hoạch mơ hồ: mọi con số lấy từ code hoặc `SELECT` trên DB dev.

Phạm vi: `backend/services/auth-service`, `gym-service`, `backend/gateway`, `frontend/web`. **`frontend/mobile` và
mọi tài liệu mobile bị đóng băng ở Phase 7/15 — không đụng.**

## 1. Luồng chính (và là luồng DUY NHẤT để trở thành đối tác mới)

```
Login page → CTA "Trở thành đối tác Gymini" → nhập email → email chứa magic link
→ mở link (landing GET → POST verify) → đặt mật khẩu → phiên HẠN CHẾ
→ Người đại diện → Thương hiệu (đúng 1) → Quy mô → Chi nhánh đầu → Vị trí + ghim
→ Ảnh → Xác minh doanh nghiệp (giấy tờ) → Xem lại → Nộp (UNDER_REVIEW)
→ Admin: APPROVE | REQUEST_CHANGES | REJECT
→ chỉ sau APPROVE: ACTIVE Gym Owner (dashboard vận hành)
```

Chủ gym KHÔNG đi qua "Client → xin làm Gym Owner" (khác PT). Không còn "admin tạo tài khoản chủ gym / gửi link mời"
như đường thu nạp bình thường (xem §8).

## 2. Bất biến

```
1 tài khoản Gym Owner = ĐÚNG 1 Brand = 1..N Branch
```

Được ép ở **server**, không chỉ giao diện:

| Điểm ép | Trạng thái |
|---|---|
| `gym_partners.brand_id` UNIQUE | có sẵn (5/5 partner có brand khớp) |
| `gym_partner_accounts.user_id` UNIQUE | có sẵn — 1 tài khoản auth thuộc tối đa 1 đối tác |
| `gym_brands.owner_id` UNIQUE | **thêm mới** — đã kiểm: 5 brand / 5 owner_id khác nhau, an toàn |
| `brandId` của chi nhánh do server suy ra từ danh tính | có sẵn ở `gymService.createGym`; áp dụng cho draft chi nhánh |
| Không có selector Brand / tạo Brand #2 / chuyển chi nhánh giữa Brand | giữ nguyên; `attachBrand` trả 409 idempotent kể cả 2 request song song |
| Hồ sơ ứng tuyển chỉ có **đúng 1 chi nhánh** | thêm mới (`APPLICATION_SINGLE_BRANCH`) |

`businessScale` (ONE_BRANCH / MULTIPLE_BRANCHES) chỉ là **metadata onboarding**, không đổi mô hình dữ liệu và
không đổi số chi nhánh phải nộp. Chọn MULTIPLE_BRANCHES vẫn chỉ hoàn tất chi nhánh đầu; chi nhánh #2+ thêm sau khi
được duyệt bằng luồng "Thêm chi nhánh" thường (Brand hiển thị chỉ-đọc, không dropdown).

## 3. Dữ liệu thu thập theo bước

| Bước | Trường | Lưu ở đâu | Bắt buộc |
|---|---|---|---|
| Email | email (chuẩn hoá) | `PartnerApplicationToken.email` → `User.email` | có |
| Mật khẩu | mật khẩu ≥ 8 ký tự | auth `User.password` (bcrypt) | có |
| Người đại diện | họ tên; điện thoại; vai trò (GYM_OWNER / CO_FOUNDER / LEGAL_REPRESENTATIVE / AUTHORIZED_MANAGER) | `GymPartner.representativeName`, `GymPartnerAccount.contactPhone` (có sẵn), `GymPartner.representativeRole` | có |
| Thương hiệu | tên; logo; mô tả | `GymBrand.name/description` (qua `POST /owner/onboarding/brand` sẵn có), `GymBrand.logoKey` (mới) | tên: có |
| Quy mô | ONE_BRANCH / MULTIPLE_BRANCHES | `GymPartner.businessScale` (mới) | có |
| Chi nhánh đầu | tên, điện thoại, email, mô tả | `Gym` (status DRAFT) | tên + điện thoại |
| Vị trí | tỉnh/thành, phường/xã (không có quận — bỏ từ 1/7/2025), địa chỉ, ghi chú chỉ đường, toạ độ | `Gym.provinceCode/wardCode/address/locationNote/latitude/longitude` | có (theo `gymCreateSchema`) |
| Ảnh | ảnh cơ sở theo hạng mục EXTERIOR / MAIN_TRAINING_AREA / EQUIPMENT / CARDIO / CHANGING_ROOM / AMENITIES / OTHER | `GymPhoto` (`s3Key`, `category`, `visibility=PRIVATE` tới khi duyệt) | tối thiểu 1 (xem D12) |
| Xác minh | tên pháp lý, mã số thuế, số ĐKKD; giấy tờ | `GymPartner.legalName/taxCode/businessLicenseNo`; `GymPartnerDocument` | 3 giấy tờ bắt buộc (§5) |
| Xem lại/Nộp | chấp nhận điều khoản | `GymPartner.termsAcceptedVersion/At` (sẵn có) | có |

Payout (ngân hàng) **không** thu ở hồ sơ — thu sau khi duyệt bằng wizard rút gọn `PartnerOnboardingWizard` (D2).

## 4. Quy tắc theo tình huống

- **Email trùng tài khoản Customer/PT/Admin** → chặn ở bước nhập email, thông điệp thân thiện, không gửi link, không ghi đè `User.role`
  (quyết định của Ngài). Email thuộc GYM_OWNER đã có hồ sơ → "Đăng nhập để tiếp tục". Đánh đổi: lộ sự tồn tại của email — giống
  `POST /auth/register` hiện đang trả 409 "Email đã được sử dụng"; giảm nhẹ bằng giới hạn tần suất (DB theo email + gateway theo IP).
- **REQUEST_CHANGES** — có hai loại việc cần sửa: *issue theo mục* (REPRESENTATIVE/BRAND/BRANCH/LOCATION/PHOTOS/LEGAL/OTHER) và *giấy tờ* bị yêu cầu cập nhật.
  Ứng viên sửa, đánh dấu "đã cập nhật" từng issue, thay tệp giấy tờ, rồi nộp lại. **Nộp lại không đóng issue** — chỉ admin đóng.
- **REJECTED** là cuối với ứng viên: thấy lý do/ngày/ghi chú admin + "Liên hệ Gymini", **không** có "Sửa & nộp lại". Chỉ admin `reopen` (sẵn có).
- **APPROVE** = một `$transaction` DB duy nhất: partner VERIFIED + ACTIVE + chi nhánh đầu APPROVED + audit. Điều kiện: mọi issue RESOLVED, 3 giấy tờ bắt buộc đã được admin chấp nhận (có dấu vết), đúng 1 chi nhánh DRAFT. Không auto-verify giấy tờ.
- **Chi nhánh #2+** đi vòng duyệt chi nhánh thường (PENDING_REVIEW → APPROVED) sau khi kích hoạt.
- Chủ gym ACTIVE hiện có **không bị đưa qua onboarding mới**, không bị đổi trạng thái.

## 5. Giấy tờ & chính sách xác minh (dùng lại, không bịa)

`REQUIRED_DOC_TYPES` sẵn có (`partner-diligence.service.ts:13`) = **BUSINESS_LICENSE, REPRESENTATIVE_ID, PREMISES_PROOF**;
tuỳ chọn: TAX_CODE_CERTIFICATE, SITE_PHOTOS, FIRE_SAFETY_CERTIFICATE. Trạng thái giấy tờ dùng `PartnerDocumentStatus` sẵn có:
`PENDING` (chưa có tệp) · `RECEIVED` (= chờ duyệt) · `VERIFIED` · `REJECTED` (= "Cần cập nhật"). Thay tệp → `RECEIVED`, `version+1`.

**Cập nhật 2026-09-21 — một giấy tờ nhiều tệp.** Mỗi giấy tờ nhận 1..4 tệp (`GymPartnerDocumentFile`) — CCCD hai mặt, giấy phép nhiều trang. Admin vẫn duyệt theo *giấy tờ*, không theo từng tệp. Thêm/xoá tệp khi admin đã có quyết định (VERIFIED/REJECTED) = vòng mới: `RECEIVED`, `version+1`; còn đang chờ duyệt thì chỉ bổ sung, không tăng version. Xoá hết tệp → `PENDING`. Giấy tờ `VERIFIED` bị khoá cả thêm lẫn xoá ở server. Ứng viên xem được tệp của mình (ảnh có thumbnail).

Giấy tờ pháp lý **không bao giờ công khai**: bucket riêng tư, presigned GET ngắn hạn, chỉ owner của partner đó + ADMIN (chi tiết ở `GYM_PARTNER_SECURITY_MODEL.md`).

## 6. Giả định mặc định (đã nằm trong kế hoạch được duyệt; Ngài có thể đổi)

D1 approve duyệt luôn đúng 1 chi nhánh đầu trong 1 transaction · D2 điều khoản ở bước Xem lại, payout sau duyệt · D3 REJECTED là cuối, chỉ admin reopen ·
D4 12 dòng partner cũ tạo tay giữ nguyên (nhãn "Hồ sơ cũ"), lời mời OWNER PENDING duy nhất vẫn nhận được · D5 giấy tờ bắt buộc = `REQUIRED_DOC_TYPES` ·
D6 link 24h, `setupToken` 15 phút, gửi lại cách 60 s · D7 không làm EXPIRED/WITHDRAWN · D8 không commit/push nếu chưa được yêu cầu ·
D9 chính sách S3 production nằm ở Terraform, viết nhưng không apply · D10 chỉ admin đóng/mở lại issue.

**Hai điểm mới phát hiện ở W0, cần Ngài để mắt (mặc định nêu bên dưới, đổi được bằng một hằng số/nhánh code):**

- **D11 — giấy tờ chi nhánh đầu.** Wizard chi nhánh sẵn có (`gym-draft.service.ts:125-135`) khi `submitForReview` đòi thêm giấy tờ *cấp chi nhánh*
  `LEASE_OR_PROPERTY_DOC` + `FACILITY_PHOTOS` (upload đĩa/multer, bị khoá 503 trên Lambda). Hồ sơ ứng tuyển đã thu `PREMISES_PROOF` (cấp đối tác) và ảnh cơ sở có hạng mục.
  Đòi cả hai là thu trùng. **Mặc định:** với chi nhánh đầu trong hồ sơ, `PREMISES_PROOF` thay cho `LEASE_OR_PROPERTY_DOC`, ảnh cơ sở có hạng mục thay cho `FACILITY_PHOTOS`;
  bước "Xác minh chi nhánh" của wizard cũ **không** dùng trong hồ sơ (chi nhánh không chạy `submitForReview`, đi thẳng DRAFT → APPROVED khi duyệt). Chi nhánh #2+ vẫn dùng wizard đầy đủ.
- **D12 — số ảnh tối thiểu.** Code hiện tại **không có** ngưỡng ảnh tối thiểu (`GymPhoto` chỉ có trần 20). Yêu cầu nghiệp vụ nói "tối thiểu ảnh thật của chi nhánh"
  và cấm bịa số. **Mặc định:** hằng số `APPLICATION_MIN_PHOTOS = 1` (yếu nhất mà vẫn đúng "phải có ảnh thật"), khuyến nghị thêm ≥1 ảnh MẶT TIỀN; đổi ngưỡng chỉ là sửa hằng số.

## 7. Cải tiến thiết kế so với kế hoạch đã duyệt (ghi để minh bạch)

Kế hoạch mô tả `set-password` là saga hai datastore (auth → gọi gym-service). Khi audit phát hiện auth-service **không có client nào gọi gym-service**, tại hạ đơn giản hoá:
`set-password` chỉ ghi **một datastore** (auth DB: tạo `User` + đánh dấu token đã dùng, trong một transaction) rồi cấp JWT; hồ sơ đối tác được tạo bằng
`POST /owner/application/bootstrap` do chính ứng viên (đã đăng nhập) gọi ngay sau đó — idempotent, khoá theo `userId`. Hệ quả: không còn saga, không cần gọi chéo dịch vụ,
và "User chưa có partner" là một trạng thái bình thường có tên (`SETUP_INCOMPLETE`) với **0 quyền vận hành** — đúng yêu cầu #2 của review.

## 7b. Các quyết định thực thi phát sinh khi xây (W1)

- **Hồ sơ chỉ có 1 chi nhánh** (review điểm 6): `MULTIPLE_BRANCHES` chỉ là metadata; chi nhánh #2+ thêm sau khi duyệt bằng luồng thường. Server ép (`APPLICATION_SINGLE_BRANCH`) và `approve` đòi đúng 1 chi nhánh nháp.
- **Chi nhánh trong hồ sơ ở DRAFT** và KHÔNG vào hàng duyệt chi nhánh riêng: mọi góp ý về nó là issue cấp hồ sơ (BRANCH/LOCATION/PHOTOS). Khi approve, chi nhánh đi DRAFT → APPROVED bằng `applyGymApprovalTx` (bản theo-transaction của `gymService.setStatus`, có test khẳng định kết quả giống hệt).
- **Ảnh** ở bucket riêng tư cho tới khi duyệt; sau commit của approve mới sao chép sang vùng công khai (`CopyObject`, thử lại được qua `publish-photos`). Giấy tờ không bao giờ được sao chép.
- **Email** (nộp, yêu cầu sửa, nộp lại, duyệt, từ chối) chạy SAU commit; lỗi gửi chỉ log. Chế độ E2E `PARTNER_APPLICATION_DEV_ECHO=true` (bỏ qua ở production): auth-service trả link trong response và không gửi thật; gym-service chỉ log email hồ sơ.

## 8. Luồng admin cũ — phân loại

Kết luận: **LEGACY (đường TẠO OWNER bị gỡ khỏi quy trình bình thường)** + **phần dùng chung được GIỮ** vì đang phục vụ owner-mời-MANAGER.

- **Gỡ (chỉ đường tạo OWNER):** `POST /admin/partners` (`createPartner`), `POST /admin/partners/:id/provision` (`provisionOwnerAccount`), nút "Cấp tài khoản", `CreatePartnerModal`, `ProvisionResultModal`, monitor `invitedTooLong`, form sửa `canEdit = status==="PROSPECT"`.
- **Chết sẵn:** `createGymOwnerAccount` / `POST /auth/admin/gym-owners`, gateway `POST|GET /admin/gym-owners`, wrapper web `@deprecated` (0 caller).
- **Giữ:** `PartnerInvitation` + `createInvitation/validateToken/acceptInvitation/resend/revoke`, `createInvitedAccount`, `/partner-invitations/:token[/accept]`, trang `/partner/invite/:token`, `ForceChangePasswordScreen` + `mustChangePassword` (5 user còn true).
- **Chỉ ngừng TẠO, giữ TIÊU THỤ:** nhánh OWNER của `acceptInvitation` (còn 1 lời mời OWNER PENDING).
- **Lịch gỡ:** W2 chỉ ẩn/gỡ UI và ngừng caller mới → W3 chạy đủ E2E + bảo mật + hồi quy chủ gym cũ → **chỉ sau cổng ổn định** mới cho endpoint trả 410 và dọn code chết. Không xoá cột/enum/route dữ liệu.

## 9. Dữ liệu hiện có (DB dev, đo 19/9/2026)

| Bảng | Kết quả |
|---|---|
| `gym_partners` | 17: PROSPECT/NOT_VERIFIED 10 · PROSPECT/IN_REVIEW 1 · INVITED/VERIFIED 1 · ACTIVE/VERIFIED 5 |
| `gym_partner_accounts` | 5 OWNER/ACTIVE, đều `onboarding_completed_at` đã đặt; 0 MANAGER |
| `partner_invitations` | PENDING: 1 OWNER + 3 MANAGER; ACCEPTED: 4 OWNER |
| Partner chưa có account | 12 (11 PROSPECT + 1 INVITED) |
| `gym_brands` | 5 (5 owner_id khác nhau) |
| `gyms` | APPROVED 54, SUSPENDED 4 |
| Auth `users` GYM_OWNER | 16: 5 có `gym_partner_accounts`, **11 mồ côi** (không account, không sở hữu gym); 5 user còn `must_change_password=true` |

Tác động di trú: 5 đối tác ACTIVE không đổi; 12 dòng cũ giữ nguyên nhãn "Hồ sơ cũ"; 3 lời mời MANAGER PENDING cần luồng chấp nhận dùng chung còn nguyên;
11 user mồ côi bị **thu hết quyền vận hành ngầm** (xem `GYM_PARTNER_SECURITY_MODEL.md` §2) — họ không sở hữu gym nào nên không mất chức năng thật.

## 10. Ngoài phạm vi

SMS; trạng thái EXPIRED/WITHDRAWN; duyệt hàng loạt nhiều chi nhánh trong một hồ sơ; đổi Role enum của auth-service; mọi thay đổi ở `frontend/mobile` và tài liệu mobile.

## Trạng thái thực thi (2026-09-20)

W0 → W3 đã xong; mobile đóng băng ở Phase 7/15. Báo cáo: `GYM_PARTNER_WEB_IMPLEMENTATION_REPORT.md`,
`GYM_PARTNER_WEB_TEST_REPORT.md`, `GYM_PARTNER_WEB_KNOWN_ISSUES.md`. Luồng admin tạo/cấp tài khoản chủ gym
đã ngừng hẳn (410 `ENDPOINT_RETIRED`); hạ tầng mời MANAGER giữ nguyên. MinIO chỉ dùng dev/test, production
dùng S3 gốc của AWS và có guard chặn cấu hình sai (`gym-service/src/services/partner-s3.guard.ts`).
Chưa test trên S3 thật — xem mục chặn go-live trong Known Issues.
