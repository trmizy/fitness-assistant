# GYM_PARTNER_WEB_TEST_REPORT.md

Kiểm chứng luồng **Gym Partner Self-Service Onboarding** (W1 backend + W2 web) trên stack dev thật.
Ngày chạy: **2026-09-20**. Nhãn bằng chứng dùng đúng quy ước của `CLAUDE.md`.

Script tái lập: `scripts/partner-application-e2e/` (README ở đó nói cách chạy).

## 1. Tổng hợp

| Bộ | Nhãn | Kết quả |
|---|---|---|
| gym-service (`tsx --test`, DB `gymcoach_gym_test`) | BACKEND INTEGRATION | **241/241 pass** |
| auth-service (`tsx --test`) | BACKEND INTEGRATION | **59/59 pass** |
| gateway (`tsx --test`) | BACKEND INTEGRATION | **29/29 pass** |
| `api-e2e.mjs` qua gateway `:3000` | REAL HTTP/API | **90/90 pass** |
| `browser-e2e.cjs` (1280px) | REAL BROWSER | **26/26 pass**, 0 lỗi JS |
| `browser-e2e-mobile.cjs` 360 / 390 / 412px | REAL BROWSER | **30/30 pass** mỗi độ rộng, không tràn ngang |
| `admin-regression.cjs` | REAL BROWSER | **4/4 pass** |
| `vite build` (frontend/web) | CODE AUDIT | build thành công |

**Chưa chạy, phải nêu rõ:** đây **không phải** "regression toàn repo". Các service `user-service`,
`fitness-service`, `payment-service`, `chat-service`, `ai-service` **không được chạy test** trong đợt
này vì luồng đối tác không sửa code của chúng. Cũng **chưa** test trên **AWS S3 thật** (xem mục 6).

## 2. REAL BROWSER — luồng chính (§87)

Đi hết một vòng đời thật, không bỏ bước:

CTA ở `/login` (nằm **dưới** khối "Cấu hình máy chủ", đã đo toạ độ y) → `/partner/apply` nhập email →
link xác minh (chế độ `PARTNER_APPLICATION_DEV_ECHO`) → mở link, **token bị xoá khỏi URL** trước khi
gọi API → đặt mật khẩu → tự đăng nhập + `bootstrap` → wizard 8 bước (người đại diện, thương hiệu, quy
mô nhiều chi nhánh, chi nhánh đầu, vị trí + ghim bản đồ, ảnh, giấy tờ, xem lại) → nộp → trang "Hồ sơ đã
gửi" + timeline → admin mở hàng đợi, thấy chi tiết, **nút Duyệt bị vô hiệu kèm lý do** → admin yêu cầu
chỉnh sửa → ứng viên thấy thẻ yêu cầu, **nút "Gửi lại" bị khoá** tới khi đánh dấu đã cập nhật → gửi lại
→ admin chấp nhận từng giấy tờ, đóng vấn đề → **Duyệt** → ứng viên vào workspace chủ gym.

Kèm theo trong cùng lần chạy: refresh trang landing sau verify vẫn dùng được; mở thẳng
`/gym-owner/dashboard` khi đang là ứng viên bị đẩy về `/partner/application`; vào `/` cũng vậy.

## 3. REAL HTTP/API — 90 kiểm tra (`api-e2e.mjs`)

**Magic link:** token rác → INVALID; token rỗng → 400; gửi lại trong 60 s → 429 `RESEND_COOLDOWN`;
gửi lại sau cooldown làm **link cũ chết**; verify lại **không tiêu** token email; `setupToken` bị thay
bởi lần verify sau, không dùng lại được, mật khẩu < 8 ký tự bị từ chối; link đã dùng → USED; link hết
hạn → EXPIRED.

**Chặn email trùng:** email của Customer/PT/Admin → 409 `EMAIL_IN_USE`; email đã là đối tác → 409
`EMAIL_ALREADY_PARTNER`; vai trò của Client **không** bị đổi thành GYM_OWNER.

**Cổng vận hành (cho phép dương tính):** ứng viên ONBOARDING bị chặn ở 9 route vận hành
(`/owner/gyms`, `/owner/brands`, tạo chi nhánh, partner-accounts, invitations, collaborations,
memberships, wallet, plans) — tất cả 403 `PARTNER_APPLICATION_PENDING`; `/me/collaborations` 403;
3 route admin 403; không token → 401; client bị chặn khỏi hàng đợi admin. `/pt/:id/gyms` được xác nhận
là **route công khai** (trả kết quả giống nhau có hay không có token) nên không thuộc diện cổng.

**Bất biến 1 Owner = 1 Brand:** hai PUT `/brand` song song vẫn chỉ ra **một** brand id; gọi
`/owner/onboarding/brand` không tạo brand thứ hai; `brandId` client gửi bị **bỏ qua**; ứng viên không
tạo được chi nhánh nháp thứ hai. Sau khi duyệt, chi nhánh #2 thuộc **đúng brand đó** và đi vòng duyệt
chi nhánh thường (PENDING_REVIEW, không tự APPROVED).

**Upload:** SVG/HTML bị từ chối ngay ở presign (415), quá cỡ 413; tệp HTML khai là PNG bị **xoá và từ
chối ở confirm** (422, kiểm magic bytes); `uploadId` lạ → 404; confirm khi chưa tải tệp → 409; ứng viên
B **không** confirm được `uploadId` của A, **không** xoá được ảnh của A.

**Riêng tư giấy tờ:** admin đọc qua presigned URL hạn ngắn, **mỗi lần xem ghi `DOCUMENT_VIEWED`**; bỏ
chữ ký đi thì 403; khoá giấy tờ **không tồn tại** trong bucket công khai. Ảnh chỉ thành PUBLIC **sau**
khi duyệt.

**Vòng đời:** nộp thiếu → 400 `APPLICATION_INCOMPLETE` kèm danh sách; nộp đúp song song không 5xx;
sau nộp mọi sửa 409 `APPLICATION_LOCKED`; từ chối là **cuối** với ứng viên (sửa/nộp lại/nộp đều 409)
cho tới khi admin `reopen`; nộp lại **không** đóng issue (RESUBMITTED, chỉ admin đóng); thay giấy tờ →
RECEIVED + version+1; duyệt bị chặn khi còn giấy tờ chưa chấp nhận hoặc issue chưa đóng.

**Approve atomic:** hai lệnh duyệt song song → **đúng 1 thành công, 1 nhận 409**, và **đúng một** dòng
audit `APPLICATION_APPROVED`. Kết quả cuối kiểm bằng SQL: `ACTIVE/VERIFIED/APPROVED`.

**Sau duyệt:** còn 409 `ONBOARDING_INCOMPLETE` cho tới khi xong bước payout, rồi `accessState` = ACTIVE
và vùng vận hành mở.

**Vệ sinh log:** grep log gateway/auth/gym trong khoảng thời gian chạy — **không** chứa token thô,
`setupToken` hay mật khẩu.

## 4. Gỡ luồng admin cũ (W3.9) — chỉ làm SAU khi các mục trên xanh

- `POST /admin/partners` và `POST /admin/partners/:id/provision` → **410 `ENDPOINT_RETIRED`**.
- Xoá code chết: `authService.createGymOwnerAccount`, `authController.createGymOwner`, route
  `/auth/admin/gym-owners`, hai route gateway `/admin/gym-owners` (POST + GET), các wrapper web
  `@deprecated` (`createGymOwner`, `listGymOwners`, `createPartner`, `provisionPartnerOwner`).
  Đã xác nhận bằng HTTP: cả ba endpoint nay trả **404**.
- **Giữ nguyên** hạ tầng mời MANAGER (`PartnerInvitation`, `/partner-invitations/:token[/accept]`,
  trang `/partner/invite/:token`, `createInvitedAccount`) và nhánh tiêu thụ lời mời OWNER cũ.
- Không xoá cột/enum nào.
- Hồi quy sau khi gỡ: 3 bộ backend + 90 kiểm tra API + E2E trình duyệt + `admin-regression.cjs` đều
  chạy lại và xanh. Danh sách 24 hồ sơ đối tác cũ của admin vẫn hiển thị, các tab chi tiết không lỗi JS.

## 5. Đối chiếu 14 điểm review

| # | Điểm | Bằng chứng |
|---|---|---|
| 1 | Cổng cho phép dương tính | API: 9 route vận hành + `/me/collaborations` đều 403 đúng mã |
| 2 | Lỗ hổng `isLegacy` | `partner-access.policy.test.ts` + `operational-gate.routes.test.ts` (241 test) |
| 3 | Duyệt từng giấy tờ có kiểm toán | API: accept từng loại, `DOCUMENT_VIEWED` ghi mỗi lần xem, approve không tự VERIFIED |
| 4 | CTA dưới "Cấu hình máy chủ" | REAL BROWSER: so toạ độ y |
| 5 | Issue OPEN→RESUBMITTED→RESOLVED | API + REAL BROWSER: nộp lại không đóng issue; chỉ admin đóng |
| 6 | Mỗi hồ sơ đúng 1 chi nhánh | API: tạo nháp thứ 2 bị chặn; approve đòi đúng 1 |
| 7 | 410 + dọn code chết sau cổng ổn định | mục 4 ở trên, chạy sau cùng |
| 8 | Cứng hoá S3 | API: MIME/cỡ/magic bytes/khoá chéo/presigned GET; guard production (mục 6) |
| 9 | Vệ sinh URL magic link + `setupToken` | REAL BROWSER (URL sạch) + API (setupToken bị thay/không tái dùng) + log sạch |
| 10 | Rate limit chia sẻ | cooldown DB kiểm bằng API; limiter Redis ở gateway có test riêng (29 test) |
| 11 | Approve atomic thật | API: 200/409 + đúng 1 dòng audit + SQL trạng thái cuối |
| 12 | UI ↔ server nhất quán ở REJECTED | API: 409 cho mọi thao tác; REAL BROWSER: không có nút sửa/nộp lại |
| 13 | Điều hướng theo trạng thái hồ sơ | REAL BROWSER: `/`, `/gym-owner/*` đều đẩy ứng viên về hồ sơ |
| 14 | Audit mọi chuyển trạng thái | API: đếm audit; timeline ứng viên đọc từ `PartnerAuditLog` |

## 6. Điều KHÔNG được coi là đã kiểm

- **AWS S3 thật: CHƯA TEST.** Toàn bộ phần tải lên chạy trên MinIO cục bộ. Đây là **yêu cầu trước khi
  deploy**, không phải điều kiện của W2/W3 (theo quyết định của người dùng).
- **Terraform `infra/terraform/environments/dev/partner-uploads.tf`**: chưa `validate`, chưa `apply`,
  và **chưa nối biến `PARTNER_S3_*` vào runtime production** — deploy lúc này thì upload trả 503.
- **Redis production** cho rate limit chia sẻ: chưa có; `RATE_LIMIT_REQUIRE_SHARED=true` là chặn go-live.
- **Email thật**: các lần chạy đều ở chế độ dev-echo, không gửi thư thật.
- **Hồi quy toàn repo**: chưa chạy; xem danh sách suite đã chạy ở mục 1.

Guard production của lưu trữ (`gym-service/src/services/partner-s3.guard.ts`) có 13 test: khi
`NODE_ENV=production`, service **từ chối khởi động** nếu cấu hình trỏ về endpoint tuỳ chỉnh,
path-style, khoá tĩnh, hoặc URL công khai không phải https / trỏ về localhost, `minio`, IP nội bộ.

## 7. Bổ sung 2026-09-20 (sau W3)

Ba việc làm thêm theo yêu cầu, đều kiểm bằng dữ liệu thật:

- **Dashboard chủ gym** — REAL BROWSER + SQL: cả bốn KPI (ví, hội viên ACTIVE, check-in hôm nay, điểm đánh
  giá), biểu đồ 7 ngày, phân bổ hội viên, "gói đang bán", "PT đang hợp tác" đều khớp DB (đối tác mới → tất cả
  bằng 0), bảng rỗng dùng empty state thật, **không có phần trăm tăng/giảm bịa**.
- **Vòng đời tạm khoá/chấm dứt** — REAL BROWSER + REAL HTTP/API, 19 kiểm tra: suspend ghi `SUSPENDED` và khoá
  tài khoản chủ sở hữu ở auth-service; bỏ tạm khoá thì dùng lại được ngay; terminate ghi `TERMINATED` và chặn
  tiếp. Phát hiện một lỗi UX (thông báo đăng nhập chung chung) — **đã sửa**, xem dưới.
- **Logo thương hiệu (tuỳ chọn)** — BACKEND INTEGRATION + REAL BROWSER, 12 kiểm tra: chưa có thương hiệu thì
  từ chối kèm mã `BRAND_REQUIRED`; tải lên ghi `logo_key` đúng prefix `/brand/`; hiện lại bằng presigned GET;
  thay logo đổi khoá; **không** bị tính là mục còn thiếu; admin thấy logo trong màn duyệt.

Chạy lại sau các thay đổi trên: gym-service **242/242**, auth-service **59/59**, gateway **29/29**,
`api-e2e.mjs` **90/90**, `browser-e2e.cjs` **26/26**, `browser-e2e-mobile.cjs` **30/30** ở 360 và 412px,
`admin-regression.cjs` **4/4**, `vite build` sạch.

## 8. Bổ sung 2026-09-20 (chuyển sang một bucket riêng tư)

Sau khi người vận hành AWS xác nhận hạ tầng thật (Lambda theo từng service, role riêng cho gym, chỉ có
môi trường dev, không có CloudFront), kiến trúc lưu trữ được rút gọn: **một bucket, mọi tệp riêng tư**.

Đã gỡ: bucket công khai, bước `CopyObject` sau duyệt, endpoint `publish-photos`, biến
`PARTNER_S3_PUBLIC_BUCKET`/`_PUBLIC_BASE_URL`, và file `infra/terraform/environments/dev/partner-uploads.tf`.
Đã thêm: job `partner-upload-sweep` dọn tệp của những lượt tải lên không bao giờ được xác nhận.

Chạy lại toàn bộ sau thay đổi: gym-service **240/240**, auth-service **59/59**, gateway **29/29**,
`api-e2e.mjs` **92/92** (thêm 3 kiểm tra mới: ảnh sau duyệt vẫn PRIVATE và giữ nguyên khoá, URL ảnh là
presigned có chữ ký, bỏ chữ ký đi thì 403), `browser-e2e.cjs` **26/26**, `browser-e2e-mobile.cjs`
**30/30** ở 390px, `admin-regression.cjs` **4/4**, `vite build` sạch.

**Vẫn chưa test trên AWS S3 thật** (mục G1) — máy dev không có khoá AWS. Và khi có quyền thì **không
chạy `api-e2e.mjs`** vì nó ghi dữ liệu thử vào CSDL; cần một smoke test chỉ chạm S3.

## 9. Bổ sung 2026-09-21 — đóng cổng ổn định W3

**Hồi quy chủ gym cũ (REAL BROWSER, 14/14)** — đóng rủi ro **R1** tự nêu từ đầu kế hoạch. Lái một chủ
gym ACTIVE có từ trước phiên này: không bị đẩy sang vùng ứng viên, dashboard đủ bốn KPI, ba trang vận
hành mở được, tạo chi nhánh thành công đúng thương hiệu và vào `PENDING_REVIEW`, hộp thoại không có
bộ chọn thương hiệu, **không request 4xx/5xx nào**, tự dọn chi nhánh thử.

**Thanh toán thật bằng ZaloPay (REAL BROWSER, người dùng tự trả 300.000đ)** — giao dịch PAID, hợp đồng
ACTIVE gắn đúng `payment_txn_id`, hạn 30 ngày, chia 270k cho gym + 30k hoa hồng, **đúng 3 bút toán
không cộng trùng**, không sinh giao dịch hay hợp đồng trùng. Webhook ZaloPay không tới được localhost
mà giao dịch vẫn về PAID — chứng minh đường `/payments/:id/sync` đúng như thiết kế.

**Ba lỗi CÓ SẴN phát hiện và đã sửa trong đợt này**: guard lưu trữ không chạy trên Lambda; dashboard
truyền `gymId` vào endpoint nhận `brandId` (404 + ô gói luôn 0 → nay 20); lưới tìm phòng gym kéo giãn
cả hàng (1811px → 472px, thẻ bên cạnh giữ 152px).

### Ba luồng hồi quy KHÔNG chạy, và vì sao

Kế hoạch W3 liệt kê chúng. Đã đối chiếu bằng `git diff` trên đúng 8 commit của đợt này (111 file):
**không commit nào chạm vào ba luồng này**, nên rủi ro hồi quy bằng không.

| Luồng | Bằng chứng không bị ảnh hưởng |
|---|---|
| Đăng ký Client mới (OTP) | 0 file liên quan `register`/`otp` bị sửa |
| Ứng tuyển PT | 0 file liên quan `ptApplication` bị sửa |
| Mời MANAGER + nhận link | 0 file liên quan `invitation`/`invite` bị sửa; thêm nữa `partner-identity.integration.test.ts` có phủ `createInvitation`/`acceptInvitation`, và 3 lời mời MANAGER + 1 lời mời OWNER đang PENDING trong DB dev vẫn nguyên vẹn |

Thanh toán thì không cần suy luận — đã trả tiền thật và kiểm bằng SQL.

## 10. Dọn dữ liệu

Mọi tài khoản `@partner-e2e.test`, hồ sơ/brand/chi nhánh sinh ra khi chạy, và đối tượng trong hai
bucket MinIO đã được xoá. `PARTNER_APPLICATION_DEV_ECHO` trả về mặc định `false`. Không sửa DB dev để
làm test pass; test tích hợp dùng DB riêng `gymcoach_gym_test`.
