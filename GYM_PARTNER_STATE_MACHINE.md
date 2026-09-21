# GYM_PARTNER_STATE_MACHINE.md

Máy trạng thái của hồ sơ đối tác Gym tự đăng ký. **Không thêm enum vòng đời mới**: tái dùng `GymPartnerStatus` và
`PartnerVerificationStatus` của gym-service; chỉ thêm enum nhỏ cho thứ chưa có tương đương (issue, vai trò đại diện, quy mô, hạng mục).
Xem thêm `GYM_PARTNER_STATUS_MAPPING.md` (năm trục trạng thái độc lập — không được gộp).

## 1. Ánh xạ trạng thái nghiệp vụ → dữ liệu thật

| Trạng thái nghiệp vụ | `User` (auth) | `GymPartner.status` | `verificationStatus` | Ghi chú |
|---|---|---|---|---|
| EMAIL_VERIFICATION_PENDING | chưa có | chưa có | — | chỉ có dòng `PartnerApplicationToken` |
| EMAIL_VERIFIED | chưa có | chưa có | — | `verifiedAt` trên token; đã có `setupToken` |
| PASSWORD_CREATED / SETUP_INCOMPLETE | role GYM_OWNER | **chưa có** | — | `User` đã tạo, `bootstrap` chưa chạy; **0 quyền vận hành** |
| ONBOARDING | GYM_OWNER | **PROSPECT** (định nghĩa lại = "ứng viên") | NOT_VERIFIED | `GymPartnerAccount(OWNER, ACTIVE, onboardingCompletedAt=null)`, `submittedAt=null` |
| UNDER_REVIEW | GYM_OWNER | PROSPECT | **IN_REVIEW** | `submittedAt` có giá trị; khoá sửa |
| REQUEST_CHANGES | GYM_OWNER | PROSPECT | **NEEDS_INFO** | issue OPEN và/hoặc giấy tờ REJECTED; mở khoá sửa |
| REJECTED | GYM_OWNER | PROSPECT | **REJECTED** | `rejectedAt/rejectionReason`; khoá sửa; chỉ admin reopen |
| APPROVED → ACTIVE | GYM_OWNER | **ACTIVE** | **VERIFIED** | một transaction; chi nhánh đầu APPROVED |
| ACTIVE, còn bước payout | GYM_OWNER | ACTIVE | VERIFIED | `onboardingCompletedAt=null` → 409 `ONBOARDING_INCOMPLETE` (wizard rút gọn) |
| ACTIVE vận hành | GYM_OWNER | ACTIVE | VERIFIED | `onboardingCompletedAt` đã đặt |
| SUSPENDED / TERMINATED | — | SUSPENDED / TERMINATED | không đổi | như hiện hành (§4) |
| EXPIRED / WITHDRAWN | — | — | — | **reserved, chưa làm** (D7) |

Tại sao PROSPECT dùng được: sau khi bỏ luồng admin tạo hồ sơ tay, PROSPECT không còn nghĩa "admin mở hồ sơ, chưa có tài khoản"; nó được định nghĩa lại thành
"ứng viên chưa được duyệt". `reject()` (`partner-diligence.service.ts:89-102`) đòi `status === 'PROSPECT'` — vẫn đúng, **không cần nới**.
`GymPartnerStatus.INVITED` và `PartnerAccountStatus.INVITED` **giữ trong enum** (1 dòng đang giữ; bỏ enum Postgres rủi ro) — chỉ ngừng ghi mới.

## 2. Chuyển trạng thái (mỗi mục theo mẫu: đi đâu / ai / API / email / route / quyền)

### EMAIL_VERIFICATION_PENDING
- Tới: EMAIL_VERIFIED (verify) · quá hạn 24 h (EXPIRED token, cho gửi lại) · thay bằng token mới khi gửi lại (token cũ vô hiệu).
- Ai: người nộp (công khai, không cần đăng nhập). API: `POST /auth/partner-applications/start`, `…/verify`.
- Email: link xác minh. UI: `/partner/apply/check-email`. Quyền vận hành: không có (chưa có tài khoản).

### PASSWORD_CREATED / SETUP_INCOMPLETE
- Tới: ONBOARDING khi `POST /owner/application/bootstrap` chạy (idempotent, khoá theo `userId`). Ai: chính ứng viên (đã có JWT). Email: không.
- UI: tự chuyển vào `/partner/application`. Quyền vận hành: **không**; chỉ gọi được `status` và `bootstrap`.

### ONBOARDING
- Tới: UNDER_REVIEW (`POST submit`, điều kiện có/atomic `WHERE verification_status IN (NOT_VERIFIED, NEEDS_INFO)`).
- Ai: ứng viên. Email: "đã nhận hồ sơ" (sau commit). UI: wizard 8 bước. Quyền vận hành: **không**; chỉ `application/*`, `onboarding/*`, brand, draft chi nhánh, ảnh, upload.
- Server chặn: tạo Brand #2, tạo chi nhánh thứ 2 (`APPLICATION_SINGLE_BRANCH`), gửi `brandId` từ client (bị bỏ qua).

### UNDER_REVIEW
- Tới: REQUEST_CHANGES · REJECTED · ACTIVE (approve). Ai: **ADMIN**. API: `POST /admin/partners/:id/request-changes` · `…/reject` · `…/approve`.
- Email: cần sửa / từ chối / đã duyệt. UI ứng viên: trang "Hồ sơ đã gửi" + timeline (chỉ đọc). Quyền vận hành: **không**.

### REQUEST_CHANGES (NEEDS_INFO)
- Tới: UNDER_REVIEW (`POST resubmit`) · REJECTED (admin). Ai: ứng viên / admin.
- Điều kiện resubmit: mọi issue OPEN đã được ứng viên đánh dấu "đã cập nhật" (→ RESUBMITTED) **và** mọi giấy tờ bị yêu cầu đã được thay tệp. Nộp lại **không** đóng issue nào.
- UI: thẻ theo mục → nhảy đúng bước; "Gửi lại hồ sơ". Quyền vận hành: **không**; sửa được các mục.

### REJECTED
- Tới: NOT_VERIFIED/ONBOARDING (`reopen`, chỉ admin; xoá `rejectedAt` và reset `verificationStatus`). Ai: ADMIN. UI ứng viên: lý do/ngày/ghi chú + "Liên hệ Gymini"; **không** nút sửa/nộp lại.
- Server khoá mọi thay đổi và nộp khi REJECTED (409).

### ACTIVE (sau approve)
- Tới: SUSPENDED / TERMINATED (admin, đường hiện hành). Không quay về PROSPECT.
- Quyền vận hành: chỉ khi thoả cổng dương (`GYM_PARTNER_SECURITY_MODEL.md` §1) — gồm `onboardingCompletedAt != null`.

## 3. Trạng thái giấy tờ (`PartnerDocumentStatus`, tái dùng)

```
PENDING (chưa có tệp) ──upload+confirm──▶ RECEIVED (= chờ duyệt)
RECEIVED ──admin Chấp nhận──▶ VERIFIED            [audit DOCUMENT_ACCEPTED]
RECEIVED ──admin Yêu cầu cập nhật (+lý do)──▶ REJECTED (= "Cần cập nhật")  [audit DOCUMENT_UPDATE_REQUESTED]
REJECTED ──ứng viên thêm/xoá tệp──▶ RECEIVED (version+1)   [audit DOCUMENT_REPLACED]
RECEIVED ──xoá hết tệp──▶ PENDING   (giấy tờ nhiều tệp, từ 2026-09-21)
VERIFIED ──(không tự đổi)
```
Approve **không bao giờ** tự đặt VERIFIED; đòi 3 giấy tờ bắt buộc (BUSINESS_LICENSE, REPRESENTATIVE_ID, PREMISES_PROOF) đang VERIFIED qua một lần duyệt có dấu vết.

## 4. Trạng thái issue (`PartnerReviewIssueStatus`, enum mới — không có tương đương)

```
OPEN ──ứng viên "đánh dấu đã cập nhật" (+ghi chú)──▶ RESUBMITTED   [audit ISSUE_MARKED_UPDATED]
RESUBMITTED ──admin Đóng──▶ RESOLVED                                  [audit ISSUE_RESOLVED]
RESUBMITTED ──admin Yêu cầu lại (+lời nhắn)──▶ OPEN
```
Khác `GymBranchReviewIssue` (tự đóng khi nộp lại) ở chỗ **chỉ admin** mới đóng. Approve bị chặn khi còn issue OPEN hoặc RESUBMITTED.
Hạng mục (`PartnerReviewCategory`): REPRESENTATIVE · BRAND · BRANCH · LOCATION · PHOTOS · LEGAL · OTHER.

## 5. Sự kiện audit (`PartnerAuditLog`, ghi TRONG cùng transaction với thay đổi trạng thái)

APPLICATION_SUBMITTED · CHANGES_REQUESTED · ISSUE_MARKED_UPDATED · APPLICATION_RESUBMITTED · ISSUE_RESOLVED · DOCUMENT_UPLOADED · DOCUMENT_REPLACED ·
DOCUMENT_ACCEPTED · DOCUMENT_UPDATE_REQUESTED · APPLICATION_APPROVED · APPLICATION_REJECTED · APPLICATION_REOPENED (+ `VIEWED_AS_PARTNER` sẵn có cho mỗi lần admin xem giấy tờ).
`actorUserId` = người thực hiện (admin hoặc chính ứng viên). Timeline của ứng viên và lịch sử của admin **đọc từ bảng này**, không dùng mốc thời gian tự tính ở frontend;
ứng viên chỉ nhận các trường an toàn (không có ghi chú nội bộ của admin).

## 6. SUSPENDED / TERMINATED — mã hoá đúng hệ quả hiện hành (không đổi nghiệp vụ)

Theo `GYM_PARTNER_SUSPENSION_CONSEQUENCES.md` + `partner-guard.service.ts`: SUSPENDED khoá **đăng nhập OWNER** (auth `setUserActive(false)`), MANAGER vẫn hoạt động,
hội viên/check-in đang chạy vẫn chạy, chặn bán mới/rút tiền/cộng tác PT mới. Cổng dương mới phải phản ánh đúng: SUSPENDED → OWNER **DENY**, MANAGER giữ phạm vi vận hành hiện có;
TERMINATED → DENY (tài khoản bị REVOKED). Mọi giá trị enum chưa được phân loại → **DENY** (test ma trận chạy trên chính enum Prisma).

## 7. OWNER vs MANAGER (audit — bất biến không bị phá)

| | OWNER | MANAGER |
|---|---|---|
| Số lượng | đúng 1 ACTIVE / đối tác (partial unique index) | nhiều, mỗi người bị giới hạn `scopedGymIds` (CHECK ≥ 1) |
| Brand/chi nhánh | tạo/sửa Brand, tạo/sửa chi nhánh, gói, ví, rút tiền, mời/thu hồi tài khoản, cộng tác PT | chỉ xem hội viên/check-in và bật tắt trạng thái vận hành trong phạm vi |
| Sở hữu | `Gym.ownerId`/`GymBrand.ownerId` = userId của OWNER (scalar, không mảng) | không sở hữu gì |
| Thành OWNER khác? | — | chỉ qua `transferOwnership` (hoán đổi nguyên tử: owner cũ → MANAGER, MANAGER → OWNER, ghi lại toàn bộ `ownerId` trong 1 `$transaction`) |

Không có co-ownership, không có Brand thứ hai; MANAGER không thể "vô tình" trở thành chủ Brand khác. Luồng tự đăng ký **chỉ tạo OWNER**; MANAGER chỉ vào bằng lời mời của owner (hạ tầng dùng chung được giữ).
