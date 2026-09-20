# GYM_PARTNER_WEB_ROUTE_MAP.md

Bản đồ route web (`frontend/web`, react-router `createBrowserRouter` ở `src/app/routes.tsx`; trang lazy + named export) cho luồng đối tác tự đăng ký.
Không đụng `frontend/mobile`.

## 1. Route công khai (cùng tầng với `partner/invite/:token`)

| Route | Trang | Ghi chú |
|---|---|---|
| `/login` | `LoginPage` (đã có) | thêm CTA thứ yếu **dưới** khối "Cấu hình máy chủ" (cuối cột form, sau ~dòng 312) |
| `/partner/apply` | nhập email | chỉ 1 trường + "Tiếp tục"; link phụ "Đã có tài khoản đối tác? Đăng nhập" |
| `/partner/apply/check-email` | kiểm tra email | gửi lại (cooldown), đổi email, lỗi gửi/mạng |
| `/partner/apply/verify` | landing magic link | đọc `#token=` (chấp nhận `?token=`), `replaceState` xoá token **trước** khi gọi API, 4 trạng thái VALID/EXPIRED/USED/INVALID; `Referrer-Policy: no-referrer` |
| `/partner/apply/password` | tạo mật khẩu | email đã xác minh + strength + show/hide + khớp; ≥ 8 ký tự; sau khi xong gọi `bootstrap` rồi vào `/partner/application` |
| `/partner/invite/:token` | `PartnerInviteAcceptPage` (đã có) | **giữ nguyên** — vẫn phục vụ owner-mời-MANAGER (và lời mời OWNER cũ còn PENDING) |

## 2. Vùng ứng viên (đã đăng nhập, role gym_owner)

Guard mới `RequirePartnerApplicant` (không dùng `RequireOnboarding` vốn chỉ cho client). Trạng thái lấy từ `GET /owner/application/status` (`accessState`).

| Route | Khi nào hiện |
|---|---|
| `/partner/application` | tổng quan tiến độ + tự chuyển tới bước dở dang |
| `/partner/application/representative` · `brand` · `scale` · `branch` · `location` · `photos` · `verification` · `review` | ONBOARDING, CHANGES_REQUESTED (sửa được) |
| `/partner/application/status` | UNDER_REVIEW ("Hồ sơ đã gửi" + timeline từ sự kiện đã lưu) |
| `/partner/application/changes` | CHANGES_REQUESTED (thẻ theo mục, "Đánh dấu đã cập nhật", "Gửi lại hồ sơ") |
| `/partner/application/rejected` | REJECTED (lý do/ngày/ghi chú + "Liên hệ Gymini"; **không** có sửa/nộp lại) |
| `/partner/application/approved` | vừa duyệt ("Chào mừng…", Brand + chi nhánh đầu, "Đi tới trang quản lý") |

Khung wizard dùng `WizardShell` (rail trái + tiến độ %, thanh dưới dính trên mobile, `SaveIndicator`, autosave/resume).

## 3. Điều hướng theo trạng thái hồ sơ (yêu cầu #13 của review)

Chỉ role không đủ. Điểm ép duy nhất phía web là guard nhóm `gym-owner`; các điểm vào khác chỉ là tiện lợi:

| Điểm vào | Hành vi |
|---|---|
| `RootRedirect` (`components/RootRedirect.tsx`) | role gym_owner → hỏi `useGymOwnerAccessState()`: SETUP_INCOMPLETE/ONBOARDING/UNDER_REVIEW/CHANGES_REQUESTED/REJECTED → `/partner/application/...`; APPROVED_PAYOUT_PENDING → `/gym-owner` (wizard payout); ACTIVE/LEGACY → `/gym-owner/dashboard` |
| `LoginPage` sau đăng nhập (2 chỗ dùng `ROLE_HOME[role]`), khôi phục phiên, Capacitor resume, `useNativeBackNavigation` | đi qua cùng logic (không dùng thẳng `ROLE_HOME.gym_owner` cho ứng viên) |
| Nhóm `gym-owner` (`routes.tsx:283-290`) | thêm guard `RequireApprovedPartner`: ứng viên gõ URL tay `/gym-owner/*` → bị đẩy về `/partner/application` |
| `RequirePartnerApplicant` | chủ gym đã duyệt vào `/partner/application/*` → về `/gym-owner` |

`useGymOwnerAccessState`: khoá query `["partner-access", userId]`, refetch khi mount/focus, xoá khi đổi tài khoản/đăng xuất. `isReturnPathForRole` (`config/landing.ts`) không đổi nhưng returnTo `/gym-owner/*` của ứng viên vẫn bị guard chặn.
Test bắt buộc: kill/mở lại app, refresh phiên, mở thẳng URL với ONBOARDING/UNDER_REVIEW/NEEDS_INFO/REJECTED.

## 4. Sau khi duyệt (Gym Owner vận hành)

`/gym-owner/dashboard` (KPI chỉ từ dữ liệu thật) · `/gym-owner/gyms` (Brand + danh sách chi nhánh, "+ Thêm chi nhánh": Brand chỉ-đọc, **không** selector) · wizard chi nhánh sẵn có `/gym-owner/gyms/wizard/:id?` cho chi nhánh #2+ ·
`PartnerOnboardingWizard` (trong `AppShell`) tự rút gọn: liên hệ + brand đã có → chỉ còn payout (điều khoản đã nhận ở bước Xem lại).

## 5. Admin

| Route | Trang |
|---|---|
| `/admin/partners` | `AdminPartnersPage` tiến hoá thành **Duyệt hồ sơ đối tác**: thẻ "N hồ sơ chờ duyệt"; lọc UNDER_REVIEW / REQUEST_CHANGES / APPROVED / REJECTED; tab Đang hoạt động / Tạm ngưng / Chấm dứt; nhãn "Hồ sơ cũ (nhập tay)" cho 12 dòng cũ |
| `/admin/partners/:id` (chi tiết) | 2 cột: nội dung hồ sơ (đại diện, brand, quy mô, chi nhánh, vị trí + bản đồ, ảnh, pháp lý) + panel duyệt dính (Approve có tóm tắt tác động và bị vô hiệu kèm lý do khi còn issue chưa đóng/giấy tờ bắt buộc chưa chấp nhận; Request changes nhiều dòng; Reject bắt buộc lý do + ghi chú). Bảng giấy tờ [Chấp nhận]/[Yêu cầu cập nhật]; bảng issue [Đóng]/[Yêu cầu lại]; lịch sử đọc từ `PartnerAuditLog` |

**Gỡ (cuối W2, chỉ phía web):** `CreatePartnerModal`, `ProvisionResultModal`, nút "Cấp tài khoản", monitor lời mời, form sửa `canEdit = status==="PROSPECT"`. Các tab tài khoản/giấy tờ/tiền/audit cho đối tác ACTIVE giữ.
Endpoint backend cũ **chưa** trả 410 ở W2 — chỉ sau cổng ổn định W3 (W3.9).

## 6. Ma trận tái dùng / xây mới

| Thành phần | Chiến lược |
|---|---|
| `WizardShell`, `SaveIndicator` | **tái dùng** (khung wizard) |
| `StepPhotos` (mẫu upload nhiều ảnh, thứ tự, ảnh bìa, xoá) | **tái dùng mẫu**; đổi đích upload sang presign S3 + hạng mục ảnh |
| `GymLocationFields` (tỉnh/phường + nút định vị trình duyệt) | **tái dùng**; thêm `MapLocationPicker` (Leaflet + OSM, import động, ghim kéo được, lỗi bản đồ vẫn nhập tay) |
| `PartnerStatusBadge`, `statusConfig` | **tái dùng** cho `ApplicationStatusBadge` |
| `PartnerInviteAcceptPage` (thẻ đặt mật khẩu) | **mẫu** cho trang `/partner/apply/password` (nâng min 8 giữ nguyên; báo lệch 6 của `ForceChangePasswordScreen`, không tự sửa) |
| `PartnerOnboardingWizard` | **giữ**, chỉ còn payout sau duyệt |
| Mới | `PartnerOnboardingLayout`, `OnboardingProgress`, `DocumentUpload`, `PhotoUploader`, `MapLocationPicker`, `ReviewSection`, `AdminReviewPanel`, `ChangeRequestCard`, `ApplicationTimeline`, `RestrictedPartnerGuard`/`RequirePartnerApplicant`/`RequireApprovedPartner`, `PartnerStatusCard`, `BranchSummaryCard` |

Chuẩn giao diện: token màu sẵn có (đen + xanh #22C55E), chuyển động opacity/translate 120–220 ms, skeleton giữ shell (không spinner toàn trang), lỗi tiếng Việt dễ hiểu (không stack/Prisma/JWT/lỗi provider),
kiểm 360/390/430/768/1024/1440, không tràn ngang.

## 5. Đã xây (W2) — khác kế hoạch ở điểm nào

Đây là hiện trạng thật; các mục 1-2 ở trên là thiết kế ban đầu.

| Route thật | Trang | Khác thiết kế |
|---|---|---|
| `/partner/apply` | `PartnerApplyPage` | Trạng thái "kiểm tra email" (gửi lại có cooldown, đổi email) là **trạng thái của cùng trang**, không có route `check-email` riêng |
| `/partner/apply/verify` | `PartnerApplyVerifyPage` | Gộp cả bước **tạo mật khẩu** (không có route `password` riêng). Token đọc từ `#token=`/`?token=`, `history.replaceState` xoá trước khi gọi API; `setupToken` chỉ ở `sessionStorage` của tab (15 phút), xoá khi đặt xong. Sau đó `login` → `POST /owner/application/bootstrap` → `/partner/application` |
| `/partner/application` | `PartnerApplicationPage` | **Một route duy nhất**; trạng thái từ server chọn giao diện: ONBOARDING/CHANGES_REQUESTED → wizard 8 bước (state nội bộ, không đổi URL), UNDER_REVIEW → "Hồ sơ đã gửi" + timeline, REJECTED → trang kết quả. Không có `/status`, `/changes`, `/rejected`, `/approved` riêng |
| `/admin/partners` | `AdminPartnersPage` | Hai tab: **Hồ sơ đăng ký** (`AdminApplicationsPanel`: hàng đợi + duyệt) và **Đối tác** (danh sách cũ). Đã gỡ nút "Hồ sơ mới", `CreatePartnerModal`, "Cấp tài khoản", `ProvisionResultModal`, thẻ "đã mời > 7 ngày" |

Guard: `RequirePartnerApplicant` (chỉ ứng viên vào `/partner/application`), `RequireApprovedPartner` (chặn ứng viên khỏi `/gym-owner/*`), `RootRedirect` theo `accessState` (hook `useGymOwnerAccessState`, khoá cache theo userId). Lỗi tải trạng thái ở `RequireApprovedPartner` cho qua vì backend vẫn từ chối.

Lưu ý thực thi:
- Wizard **lưu khi bấm "Tiếp tục"** (không autosave từng phím); mở lại là vào bước đầu tiên còn thiếu.
- Không dùng lại `WizardShell`/`StepPhotos` của wizard chi nhánh cũ (đó là wizard tạo chi nhánh có duyệt riêng); wizard hồ sơ có khung riêng để không kéo theo bước duyệt chi nhánh.
- Tải lên độc lập nhà cung cấp lưu trữ (`uploadApplicationFile`): presign → POST tới `url` + `fields` backend trả về → confirm. Không có logic MinIO/S3 nào ở frontend.
- Bản đồ: Leaflet + OpenStreetMap (`MapLocationPicker`, nạp động thành chunk riêng); lỗi tải bản đồ vẫn dùng được nút "Dùng vị trí hiện tại".
- Địa chỉ hỗ trợ ở trang "bị từ chối" lấy từ `VITE_SUPPORT_EMAIL`; repo chưa có địa chỉ chính thức nên không tự đặt.
- Chưa làm: dashboard chủ gym dùng dữ liệu KPI thật (giữ nguyên trang hiện có), rút gọn `PartnerOnboardingWizard` (payout-only) — trang hiện có tự bỏ qua bước đã xong.
