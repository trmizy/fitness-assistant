# Kế hoạch Security Hardening (D75 mục 4) — xoay khóa + chốt secret mặc định

> Ngày lập: 18–19/10/2026. Người lập: Claude (Sonnet 5.5). Đối tượng đọc: Ngài Đại Ma Vương.
> Nhãn bằng chứng: **CODE AUDIT** (đọc mã), **TEST FIXTURE** (3 bài kiểm thử "chứng minh điểm yếu" mới, xem §2.4), **HASH-COMPARE** (so khớp băm sha256 cắt ngắn giữa `.env` cục bộ và tệp được git theo dõi; không in giá trị). Không có mục nào ở đây là REAL BROWSER / REAL HTTP.
> **Quy tắc tuyệt đối của tài liệu này:** không có giá trị bí mật nào được in/ghi. Chỉ có tên biến, độ dài, và băm. Bốn băm 8 ký tự xuất hiện dưới đây (mục 1.2) là băm của các giá trị **đã công khai** trong mã nguồn được git theo dõi.
> **Chưa khóa nào được xoay.** Claude không có quyền vào dashboard nhà cung cấp. Không commit, không push, không sửa mã sản phẩm trong lượt này (chỉ thêm 4 tệp kiểm thử mới).

---

## 0. Tóm tắt cho Ngài (đọc phần này là đủ để quyết định)

### 0.1 Ba phát hiện quan trọng nhất

1. **Bốn "bí mật" dev hiện tại thực ra không phải bí mật.** So khớp băm cho thấy giá trị trong `.env` gốc của `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `INTERNAL_API_SECRET`, `POSTGRES_PASSWORD` **trùng từng ký tự** với chuỗi mặc định nằm sẵn trong mã/compose được git theo dõi (đã push). `INTERNAL_SERVICE_SECRET` xuất hiện trong 28 tệp mã nguồn + 11 tệp test; `POSTGRES_PASSWORD` trong 51 tệp. Nghĩa là "xoay" 4 biến này = **tạo bí mật thật lần đầu**, không phải thay bí mật cũ. Riêng `JWT_REFRESH_SECRET` khác mã mặc định nhưng nằm trong 4 commit lịch sử đã push (4 nhánh remote chứa).
2. **Chốt "từ chối secret mặc định" đang phụ thuộc hoàn toàn `NODE_ENV=production`** ở mọi chỗ (auth, gateway, 3 middleware, PT-document, S3 guard...). Có **3 điểm yếu đã được chứng minh bằng kiểm thử chạy thật** (`todo` — không làm đỏ bộ test): (a) auth-service chấp nhận token ADMIN giả ký bằng secret mặc định công khai khi `JWT_SECRET` trống & `NODE_ENV≠production`; (b) payment-service `/internal/*` (đường chuyển tiền) chấp nhận secret dev mặc định **dù đã cấu hình secret thật** khi `NODE_ENV≠production`; (c) fitness-service tin `x-user-id`/`x-user-role` trần (giả ADMIN) khi chưa đặt secret. Thêm 1 điểm yếu đã chứng minh **ngay cả khi `NODE_ENV=production`**: liên kết tài liệu CCCD của hồ sơ PT ký bằng chuỗi cố định trong mã nếu thiếu `PT_DOCUMENT_URL_SECRET`/`INTERNAL_SERVICE_SECRET` (mã chỉ ghi log lỗi, không từ chối).
3. **Log của auth-service và user-service ghi toàn bộ header của mọi request** (`pino-http` mặc định, không có `redact`): gồm `Authorization: Bearer …`, `x-gateway-secret` (chính là `INTERNAL_SERVICE_SECRET`), cookie. Vì vậy `docker logs` của hai service đó đang chứa secret nội bộ và access token. Xoay khóa mà không sửa việc này thì secret mới sẽ lại rò vào log.

### 0.2 Cần Ngài quyết (🔴 chỉ liên quan quyết định, không phải blocker phát triển)

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| Q1 | Có máy chủ thật nào (VPS/EC2/máy đối tác) đang chạy bằng bản sao `.env` này không? (đã hỏi ở bản kiểm kê 16/10, chưa có trả lời) | Nếu **có** → làm ngay S4 (JWT + INTERNAL) và các khóa bên thứ ba, ưu tiên cao hơn mọi việc khác. |
| Q2 | Duyệt thiết kế fail-closed ở §2.3 (cờ `ALLOW_INSECURE_DEV_SECRETS=true` là **cách duy nhất** để dùng giá trị mặc định/ngắn; không phụ thuộc `NODE_ENV`) | Đã được duyệt hướng ở D66; cần duyệt chi tiết §2.3 trước S2 vì chạm payment-service. |
| Q3 | Mã QR check-in gym ký bằng `CHECKIN_TOKEN_SECRET`→`INTERNAL_SERVICE_SECRET`→chuỗi cố định, hạn 365 ngày. Đổi `INTERNAL_SERVICE_SECRET` sẽ làm **mọi QR đã in hết hiệu lực**. Chọn: (A) tách khóa riêng, chấp nhận in lại QR (chưa có gym thật → rẻ); (B) giai đoạn chuyển tiếp xác minh cả khóa cũ lẫn mới | Khuyến nghị (A) nếu chưa có gym thật dùng QR; (B) nếu đã có. |
| Q4 | Cho Claude tự sinh giá trị ngẫu nhiên và ghi thẳng vào `.env` cục bộ (không in ra), rồi recreate stack dev để xoay JWT/INTERNAL/Postgres dev? Việc này đăng xuất mọi tài khoản dev và đổi mật khẩu role Postgres dev (chạm DB dev — trái quy tắc 7 nếu chưa được phép) | Cần Ngài cho phép từng bước (S4). |

### 0.3 Thứ tự đề xuất (chi tiết ở §4)

`S0` đường cơ sở băm (đã làm) → `S1` helper dùng chung + test → `S2` nối vào các service → `S3` harness dev/test đặt cờ → `S5` log hygiene (làm **trước** S4) → `S4` xoay khóa dev + mật khẩu → `S6` kiểm sau xoay → **cổng production (§4.3)**. Việc của Ngài trên dashboard (§1.1) làm song song, độc lập với S1–S3, và nên làm **sau** S5 để khóa mới không rò vào log.

---

## 1. Kế hoạch xoay từng khóa

### 1.1 Bảng tổng hợp (khóa → Ngài làm gì / Claude làm gì / Claude kiểm gì)

Độ ưu tiên: P-A = xoay trước tiền thật/dịch vụ công khai; P-B = trước go-live; P-C = dọn dẹp.

| Khóa | Hiện trạng đã kiểm | (a) Ngài trên dashboard | (b) Claude trong repo/config | (c) Claude kiểm sau |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` (len 108) | `.env` gốc; chưa vào git; có trong 2 transcript cục bộ; dùng bởi ai-service, user-service (InBody/ảnh) | P-A. Tạo khóa **mới theo từng môi trường** (dev / prod), đặt hạn mức chi tiêu; xóa khóa cũ | Cập nhật `.env`; đảm bảo `docker-compose.prod.yml` chỉ đọc biến này (đã có dòng 244); thêm cảnh báo trong `.env.example` | §1.3-V1, V2 |
| `SMTP_PASS` (Gmail, len 16) | `.env` gốc; chưa vào git; transcript | P-A. Thu hồi App Password cũ, tạo mới; **nên dùng tài khoản gửi thư riêng** cho hệ thống thay vì Gmail cá nhân | Cập nhật `.env`; xác nhận `email.service.ts` không log `pass` (đã đọc: chỉ log `to`/`subject`, nhưng dev-fallback log `{to, otp}` — xem F8) | V1, V2 + gửi OTP thử qua alias +test (Ngài duyệt) |
| `DROPBOX_SIGN_API_KEY` (len 64) | Ký điện tử **đang tắt** (không còn bước ký hợp đồng) | P-B. Revoke khóa; không cần tạo khóa mới nếu không dùng | Đặt biến rỗng trong `.env`; xác nhận provider báo lỗi cấu hình rõ ràng khi rỗng (`dropboxSign.provider.ts:14`) | V1, V2 |
| `METERED_API_KEY` (len 36) | chat-service, TURN cho gọi video | P-B. Regenerate khóa API | Cập nhật `.env` | V1, V2 |
| `PEXELS_API_KEY` (len 56) | fitness-service; rủi ro thấp (đọc ảnh) | P-C. Lấy khóa mới trên trang API của Pexels; khóa cũ không có nút thu hồi → nhắn Pexels hoặc chấp nhận rủi ro thấp | Cập nhật `.env` | V1 |
| `VNPAY_HASH_SECRET` + `VNPAY_TMN_CODE` | Sandbox (`vnpay.provider.ts` mặc định `sandbox.vnpayment.vn`); chưa vào git | P-B. Trên portal merchant **sandbox** yêu cầu cấp lại Hash Secret. TMN code là định danh, không cần xoay. **Khi lên thật: đăng ký merchant thật riêng, tuyệt đối không dùng lại khóa sandbox** | Cập nhật `.env`; xác nhận `VNPAY_SIMULATE` bị bỏ qua ở production (đã có, `vnpay.provider.ts:28-34`) | V1, V2 |
| `MOMO_*` (partner `MOMOBKUN…`), `ZALOPAY_KEY1/KEY2` (app 2553) | Khóa **demo công khai** của nhà cung cấp, `MOMO_SECRET_KEY` len 32, `ZALOPAY_KEY2` len 32 | Không cần xoay. Khi lên thật: lấy khóa merchant thật | Thêm vào cổng production (§4.3): phát hiện khóa demo ở production → từ chối khởi động (gateway-policy đã chặn gateway sandbox ở production, `gateway-policy.ts`) | — |
| `POSTGRES_PASSWORD` (len 17) | **Trùng giá trị mặc định công khai**, có trong 51 tệp được git theo dõi (44 test, `package.json:23`, 2 script, `fix.js`, `.env.example`, 3 tài liệu, compose) + lịch sử git từ 03/2026 (41 commit, 4 nhánh remote). Cũng nằm trong `DATABASE_URL` của 5 tệp `.env` từng service | Chỉ cần nếu có DB không phải dev dùng cùng mật khẩu. Production dùng RDS với mật khẩu riêng (compose prod đã tách `RDS_PASSWORD`) | P-B. Xem S4: đổi role dev bằng `ALTER ROLE` (cần Ngài cho phép chạm DB dev), cập nhật `.env` + 5 `DATABASE_URL`, đưa mật khẩu ra khỏi `package.json:23`/scripts/test (đọc từ env). Đồng thời đổi publish cổng Postgres sang `127.0.0.1:5433` (F9) | V1, V3 |
| `JWT_SECRET` (len 46) | **Trùng mặc định công khai** (`docker-compose.dev.yml`, `.env.example:30`); 6 commit lịch sử (đến 04/09/2026) | P-A nếu Q1=có | S4: sinh ngẫu nhiên ≥ 48 ký tự, ghi `.env` không in; xóa mặc định khỏi compose/`.env.example` | V1, V4 (token cũ bị 401) |
| `JWT_REFRESH_SECRET` (len 55) | Khác mã mặc định nhưng **có trong lịch sử đã push** (4 commit, 4 nhánh remote). `auth-service/.env` có **giá trị riêng khác `.env` gốc** (cần đồng bộ) | P-A nếu Q1=có | S4: sinh mới, **đặt một chỗ duy nhất** (gỡ bản trùng trong `auth-service/.env`); thu hồi toàn bộ refresh token trong DB (cần Ngài cho phép ghi DB dev) | V1, V4 |
| `INTERNAL_SERVICE_SECRET` (len 48) | **Trùng mặc định công khai** trong 28 tệp mã + 11 test + `.env.example`; 36 commit lịch sử. Là `x-gateway-secret` gateway gắn mọi request và `x-service-secret` các route nội bộ chuyển tiền | P-A nếu Q1=có | S2 trước (bỏ mọi chuỗi mặc định khỏi mã), rồi S4 sinh mới. **Chú ý hệ quả:** đổi nó làm mọi QR check-in gym đã in hết hạn (Q3) và đổi chữ ký liên kết tài liệu PT (hạn 5 phút, vô hại) | V1, V4, V5 |
| `INTERNAL_API_SECRET` (len 44) | **Trùng mặc định công khai** trong 3 middleware + compose; dùng cho chat-service (`joinToken`), user-service (`joinToken`, `booking.service.ts:1366`) và được 3 middleware chấp nhận | P-A nếu Q1=có | S4: user-service và chat-service **phải đổi cùng lúc** (HMAC token tham gia buổi học); khuyến nghị gộp một tên biến (F11) | V1, V4 |
| MinIO root (`MINIO_ROOT_USER` len 12 / `MINIO_ROOT_PASSWORD` len 19) | Không đặt trong `.env`; dùng **mặc định trong compose dev** (mục 1.2), công khai. Cũng là khóa S3 của `PT_MEDIA_S3_*` và `PARTNER_S3_*` | P-C (không có dashboard; production dùng IAM role, đã có guard `partner-s3.guard.ts` cấm khóa tĩnh/endpoint tùy chỉnh ở production) | S4: đặt `MINIO_ROOT_*` ngẫu nhiên trong `.env`, bỏ `:-mặc định`, bind cổng 9000/9001 vào `127.0.0.1`. MinIO đọc biến mỗi lần khởi động, bucket/dữ liệu giữ nguyên | V1, V6 |
| **Firebase Admin SDK (tệp JSON trong `secret/`)** — *không có trong bản kiểm kê 16/10* | Thư mục `secret/` bị `.gitignore` (tốt); dùng cho push FCM; chưa vào git | P-B. Firebase console → Project settings → Service accounts → tạo khóa mới, xóa khóa cũ | Cập nhật tệp cục bộ; xác nhận `secret/` vẫn không được theo dõi | V1 |
| `frontend/mobile/google-services.json` (khóa client Firebase) *— mới* | Được git theo dõi từ commit `b52c40d7`; khóa client Firebase vốn công khai theo thiết kế | P-C. Google Cloud Console → Credentials → giới hạn khóa theo package name + SHA-1 + chỉ các API cần | Không đổi mã | — |
| Grafana admin (`admin`/`admin`, ẩn danh Viewer) *— mới* | `docker-compose.dev.yml:715-722`, cổng 3100 publish mọi interface | — | Đổi sang biến `.env` + bind `127.0.0.1` (S3) | — |

### 1.2 Băm tham chiếu (chỉ cho giá trị **đã công khai** trong mã nguồn)

| Biến | độ dài | sha256 (8 ký tự) | Ý nghĩa |
|---|---|---|---|
| `INTERNAL_SERVICE_SECRET` | 48 | `d5f93d77` | = mặc định trong `gateway/src/utils/internal-secret.ts`, `gateway/src/app.ts:57` và 28 tệp khác |
| `JWT_SECRET` | 46 | `074337dc` | = mặc định trong `docker-compose.dev.yml` |
| `INTERNAL_API_SECRET` | 44 | `c1f7b0d2` | = mặc định trong 3 middleware + compose |
| `POSTGRES_PASSWORD` | 17 | `bf7b1b90` | = mặc định trong compose, scripts, `package.json`, 44 test |

Các giá trị khác (JWT_REFRESH, ANTHROPIC, SMTP…) **không** ghi băm vào tài liệu. Băm 16 ký tự của chúng đã được ghi vào **`secret/rotation-old-hashes.json`** (thư mục `secret/` bị gitignore, không commit) để chứng minh sau xoay rằng giá trị cũ đã biến mất khỏi cấu hình. **Tệp này phải được tạo TRƯỚC khi xoay** (đã làm 19/10); không xóa cho đến khi §1.3 xong.

Mặc định khác còn trong mã (băm không ghi, chỉ vị trí): chuỗi dev của MinIO (`docker-compose.dev.yml:290-291, 931-932, 968-969, 991`), `PT_DOCUMENT_URL_SECRET` fallback (`ptDocumentUrl.util.ts:34`), `CHECKIN_TOKEN_SECRET` fallback (`checkinToken.ts:13-16`), fallback riêng của chat-service (`chat.service.ts:8-10`, `push-relay.ts:12-14` — khác `INTERNAL_SERVICE_SECRET` của phần còn lại, tức là chat-service mà thiếu biến sẽ KHÔNG nói chuyện được với service khác).

### 1.3 Kiểm tra Claude chạy được sau khi xoay (không in giá trị)

- **V1 — băm cũ đã biến mất khỏi cấu hình đang dùng.** Script đọc `.env` (gốc + 5 tệp service), băm lại và so với `secret/rotation-old-hashes.json`; in `OK`/`STILL-OLD` theo tên biến. Kết quả mong đợi: không biến nào còn băm cũ (trừ `ZALOPAY_KEY*`, `MOMO_*`, `VNPAY_TMN_CODE` là định danh/khóa demo).
- **V2 — quét tệp được git theo dõi + working tree** bằng băm của mọi giá trị cũ (script quét `git ls-files`, so từng giá trị cũ bằng `includes` trong bộ nhớ, in tên biến + số tệp). Kỳ vọng: 0 tệp, **trừ** giá trị công khai đã nằm trong mã — chúng phải về 0 sau S2/S3/S4. **Lịch sử git sẽ vẫn chứa giá trị cũ** (không viết lại lịch sử, theo D65): chỉ vô hiệu hóa được bằng việc nhà cung cấp thu hồi — Claude **không thể** chứng minh khóa bên thứ ba "đã chết"; đó là việc xác nhận của Ngài (§1.4).
- **V3 — Postgres:** kết nối bằng thông tin mới thành công; thử đăng nhập bằng mật khẩu mặc định công khai (chuỗi đang nằm sẵn trong mã được theo dõi, nên dùng được mà không lộ gì mới) → kỳ vọng `password authentication failed`.
- **V4 — token cũ bị từ chối:** dùng mật khẩu/đăng nhập thử để lấy token trước xoay (hoặc ký bằng mặc định công khai) → sau xoay `GET /auth/me` qua gateway kỳ vọng 401; refresh token cũ kỳ vọng 401.
- **V5 — route nội bộ:** gọi `/internal/*` của gym/payment/user với secret mặc định công khai → kỳ vọng 401 ngay cả khi `NODE_ENV=development` (sau S2, không có cờ). Gọi với secret mới → 200.
- **V6 — dịch vụ khởi động:** `docker compose ... up -d --force-recreate`, health của 7 service + gateway; test hộp đen `e2e` chọn lọc (nhãn REAL HTTP / BACKEND INTEGRATION đúng loại).
- **V7 — log hygiene:** sau S5, khởi động, gọi 1 request có `Authorization` và qua gateway, đọc log và đếm số lần xuất hiện của băm giá trị (không in log thô) → kỳ vọng 0.

### 1.4 Cách Ngài xác nhận khóa cũ đã chết mà không để lộ giá trị

Không cần (và không nên) dán khóa cũ ở đâu cả. Với mỗi nhà cung cấp:
- Khóa cũ **không còn trong danh sách** khóa của dashboard (hoặc có trạng thái Revoked/Disabled), ghi lại ảnh chụp/ghi chú ngày giờ xoay (không chụp giá trị).
- Với Anthropic Console: mục "Last used" của khóa **mới** tăng khi dùng, và khóa cũ không còn trên danh sách; với Gmail: trang `myaccount.google.com/apppasswords` không còn mật khẩu ứng dụng cũ, và "Recent security activity" không có lần đăng nhập lạ; với Dropbox Sign/Metered: khóa cũ vắng khỏi trang API.
- Nếu muốn thử chủ động: dùng chính **bản sao khóa cũ trong trình quản lý mật khẩu của Ngài** gọi một API chỉ-đọc rẻ tiền và mong 401/403 — Claude không giữ bản sao nào và không thực hiện bước này.
- Sau khi Ngài báo "đã xoay X", Claude ghi vào `docs/` bằng chữ **"Ngài xác nhận"** (không phải "đã kiểm chứng") và chạy V1–V2.

---

## 2. Kiểm kê secret mặc định (CODE AUDIT, vị trí tệp:dòng)

Chú giải cột "Nếu `NODE_ENV` không đặt": **CHẤP NHẬN** = chạy với chuỗi công khai; **TIN HEADER** = tin danh tính do client gửi; **CHẶN** = từ chối/thoát.

### 2.1 Nhóm A — chốt nằm sai chỗ (chỉ production mới chặn)

| Vị trí | Hành vi | Nếu `NODE_ENV` không đặt trên máy thật | Sửa theo §2.3 |
|---|---|---|---|
| `auth-service/src/services/auth.service.ts:38,40` (dùng ở 54, 60, 492, 547) | `JWT_SECRET \|\| mặc định công khai`; `JWT_REFRESH_SECRET \|\| mặc định công khai` | **CHẤP NHẬN**: ai đọc repo ký được token ADMIN. **Đã chứng minh bằng kiểm thử** (§2.4) | Bỏ `\|\| literal`, dùng `requireSecret()` |
| `auth-service/src/server.ts:11-18` (mọi env), `:21-45` (chỉ `production`) | Thiếu `INTERNAL_SERVICE_SECRET` → thoát (tốt, mọi môi trường); JWT yếu/mặc định/<32 ký tự → thoát **chỉ khi production** | JWT mặc định chạy được | Chuyển kiểm JWT ra ngoài khối `if production` |
| `auth-service/src/controllers/auth.controller.ts:19-21` (fallback), `:27-34` (kiểm production), `:163-165`, `:383-452`, `:569`, `:661` | `INTERNAL_SERVICE_SECRET \|\| mặc định`. `:163-168`: **`/auth/forgot-password` tin `x-trusted-web-origin` nếu `x-gateway-secret` khớp** | CHẤP NHẬN. Với secret mặc định công khai kẻ tấn công đặt origin riêng → email đặt lại mật khẩu thật của nạn nhân chứa liên kết trỏ về domain kẻ tấn công (chiếm tài khoản). **F6** | Như trên + bỏ fallback |
| `auth-service/src/controllers/partner-application.controller.ts:12-13,23`; `services/pt-deactivation-relay.service.ts:30-31` | Fallback công khai | CHẤP NHẬN | Bỏ fallback |
| `auth-service/src/config/lambda-runtime.ts:127-147` | Kiểm secret/JWT chỉ khi chạy Lambda | — | Dùng cùng helper |
| `gateway/src/utils/internal-secret.ts:1-20` | `validateInternalSecret` return sớm nếu `nodeEnv !== "production"` | CHẤP NHẬN | Helper dùng chung |
| `gateway/src/app.ts:55-57`; `gateway/src/routes/proxy.routes.ts:35-41, 657, 675, 925, 1016, 1040…` | Gateway gắn `x-gateway-secret` / `x-internal-token` = secret hoặc **mặc định công khai** cho mọi service | CHẤP NHẬN: toàn hệ thống nói chuyện bằng chuỗi công khai | **proxy.routes.ts đang do phiên khác sửa — chỉ đọc**; kế hoạch: chỉ đổi dòng 35-41 sau khi phiên kia xong |
| `user-service/src/middleware/serviceSecret.middleware.ts:16-37`, `payment-service/…/serviceSecret.middleware.ts:5-38`, `gym-service/…/serviceSecret.middleware.ts:3-33` | Chấp nhận `DEV_DEFAULTS` (2 chuỗi) khi `NODE_ENV !== production` **ngay cả khi đã có secret thật**; production: chỉ thoát nếu cả hai biến yếu | **CHẤP NHẬN**: route `/internal/*` (ví, tất toán hợp đồng) mở cho ai có repo. **Đã chứng minh bằng kiểm thử** | Bỏ DEV_DEFAULTS khỏi tập chấp nhận trừ khi cờ bật |
| `shared/src/gatewayTrust.ts:41-60` | Không có literal, nhưng tin `x-gateway-secret` khớp env; khi env = giá trị công khai thì kẻ tấn công **giả danh bất kỳ user** (`x-user-id`, `x-user-role: ADMIN`) tới service qua cổng publish | Phụ thuộc giá trị env | Hết rủi ro khi giá trị env là bí mật thật + cổng không publish |
| `gym-service/src/clients/{auth,payment,profile,user}.client.ts:5-6`, `controllers/{owner-partner:19, partner:32}.controller.ts`, `middleware/request-context.middleware.ts:16`, `services/{checkin:10, pt-checkin:24}.service.ts`, `payment-service/src/routes/admin.routes.ts:15-16`, `services/reconciliation.service.ts:17-18`, `user-service/src/clients/{auth-service:42, gym:4, payment:4}.client.ts`, `ai-service/src/clients/payment.client.ts:8-10`, `controllers/plan.controller.ts:26-28`, `chat-service/src/services/{chat.service:8, push-relay:12}.ts` | **~25 chỗ** `process.env.X \|\| literal` để *gửi* header nội bộ | Gửi chuỗi công khai đi (chỉ lộ nếu phía nhận cũng chấp nhận mặc định) | Một hàm `internalSecret()` dùng chung; **gym-service đang do phiên khác sửa → chỉ đọc**, ghi nhận để làm sau |
| `ai-service/src/middleware/auth.middleware.ts:74-149` (nhánh 3, dòng 121-149); `fitness-service/src/middleware/auth.middleware.ts:67-86` | Chưa đặt secret + `NODE_ENV≠production` → **tin `x-user-id`/`x-user-role` trần** ("dev mode only") | **TIN HEADER** → giả ADMIN. **Đã chứng minh (fitness)** | Nhánh này chỉ khi cờ bật |
| `user-service/src/utils/ptDocumentUrl.util.ts:20-34` | `SECRET \|\| ""` rồi `EFFECTIVE_SECRET = SECRET \|\| literal`; production thiếu secret chỉ `logger.error`; `verifyDocumentUrl` (dòng ~87-95) **không** kiểm lại. Chú thích trong mã nói có kiểm — sai | **CHẤP NHẬN kể cả `NODE_ENV=production`**. Lộ ảnh CCCD/chân dung hồ sơ PT nếu đoán được tên tệp. **Đã chứng minh** | `requireSecret()`; bỏ literal; production + thiếu → thoát |
| `gym-service/src/utils/checkinToken.ts:13-19,41,49` | `CHECKIN_TOKEN_SECRET \|\| INTERNAL_SERVICE_SECRET \|\| literal`; hạn **365 ngày** (`GYM_QR_TTL_DAYS`) | CHẤP NHẬN; thêm tác dụng phụ khi xoay (Q3) | Khóa riêng bắt buộc; **gym-service chỉ đọc lúc này** |
| `user-service/src/utils/joinToken.ts:12-17`, `chat-service/src/utils/joinToken.ts:12-17` | Fail-fast nếu `INTERNAL_API_SECRET` thiếu (tốt, mọi env) nhưng chấp nhận giá trị yếu/mặc định | Chấp nhận giá trị công khai nếu env đặt giá trị đó | Kiểm yếu qua helper |
| `chat-service/src/app.ts:45,80`, `services/chat.policy.ts:6` | So `INTERNAL_API_SECRET`/`INTERNAL_SERVICE_SECRET` rỗng-an-toàn (không có literal) | OK nhưng 2 tên biến (F11) | Hợp nhất tên |

### 2.2 Nhóm B — tiện ích dev khóa theo `NODE_ENV` (cùng bản chất, không phải "secret mặc định")

Cùng một lỗi thiết kế ("không phải production = an toàn để mở"), nên **dùng chung cờ ở §2.3**:

| Vị trí | Hành vi dev | Rủi ro nếu quên `NODE_ENV=production` |
|---|---|---|
| `auth-service/src/services/auth.service.ts:177,304,377` + `email.service.ts:28,94` | SMTP chưa cấu hình → **API trả `devOtp` trong response** và log `{to, otp}` | Đăng ký/đặt lại mật khẩu mà không cần hộp thư (chiếm tài khoản) — F8 |
| `auth-service/src/services/partner-application.service.ts:50` | `PARTNER_APPLICATION_DEV_ECHO` | thấp (cần bật thêm biến) |
| `payment-service/src/providers/vnpay.provider.ts:28-34`, `routes/vnpay-return.routes.ts:10`, `services/gateway-policy.ts:20` | `VNPAY_SIMULATE=true` hiệu lực khi `≠production`: ai cũng đánh dấu "đã thanh toán" | **Tiền** — vẫn cần biến `VNPAY_SIMULATE=true` nên rủi ro thấp hơn, nhưng cùng loại |
| `gym-service/src/services/partner-s3.guard.ts:10-35` | Cho phép MinIO/khóa S3 tĩnh khi `≠production` | thấp–trung |
| `user-service/src/controllers/dropboxSignWebhook.controller.ts:47` | kiểm chữ ký webhook tùy theo `isProduction` | trung |

### 2.3 Thiết kế thay đổi mã (hướng đã duyệt ở D66)

**Nguyên tắc:** giá trị mặc định/ngắn/thiếu **luôn bị từ chối**, trừ khi có cờ tường minh `ALLOW_INSECURE_DEV_SECRETS=true`. Cờ **không** có hiệu lực (và gây thoát khởi động có thông điệp rõ) khi `NODE_ENV=production`. Không phụ thuộc việc `NODE_ENV` có được đặt hay không → quên `NODE_ENV` là **an toàn** (fail-closed), đúng yêu cầu D65.

1. **Một module dùng chung** `backend/shared/src/secrets.ts` (gatewayTrust đã nằm cùng gói nên mọi service import được):
   - `insecureDevSecretsAllowed(env = process.env): boolean` — `env.ALLOW_INSECURE_DEV_SECRETS === "true" && env.NODE_ENV !== "production"`.
   - `isWeakSecret(v)` — rỗng, `< 32` ký tự, một ký tự lặp, hoặc băm sha256 nằm trong **danh sách băm mặc định đã biết** (lưu băm, không lưu chuỗi — để module không tái tạo chuỗi công khai).
   - `requireSecret({ name, service, devFallback? })` — trả giá trị nếu mạnh; nếu yếu/thiếu và cờ bật → cảnh báo to *"INSECURE DEV SECRET ACTIVE: name"* rồi trả `devFallback`; còn lại **ném lỗi/`process.exit(1)` lúc khởi động** với thông điệp chỉ chứa tên biến + lý do (không giá trị).
   - `assertNoInsecureFlagInProduction()` — gọi ở đầu mỗi `server.ts`: nếu `NODE_ENV=production` và cờ có mặt (bất kể giá trị) → thoát.
   - `devHeaderTrustAllowed()` = `insecureDevSecretsAllowed()` cho nhánh Nhóm A "tin header" và Nhóm B (devOtp, VNPAY simulate...).
2. **Ba chỗ cần sửa lớn nhất, theo thứ tự rủi ro:** (i) `auth.service.ts` + `server.ts` (JWT); (ii) 3 `serviceSecret.middleware` + `gatewayTrust` + `gateway/utils/internal-secret.ts` (bỏ `DEV_DEFAULTS` khỏi tập `ACCEPTED`); (iii) `ptDocumentUrl.util.ts` + `checkinToken.ts` (khóa ký tách riêng). Nhóm A "tin header" (ai/fitness) và Nhóm B (devOtp…) gắn cờ ở bước sau.
3. **Gỡ ~25 `|| literal` phía gửi** bằng `internalSecret()` của shared (cũng `requireSecret`). Khi không có giá trị → lỗi rõ ràng thay vì gửi chuỗi công khai.
4. **Hợp nhất `INTERNAL_API_SECRET` vào `INTERNAL_SERVICE_SECRET`** (một khái niệm, hai tên là nợ lịch sử). Giai đoạn chuyển tiếp: chấp nhận cả hai; lệnh khởi động in cảnh báo dùng tên cũ; đổi tên hẳn ở slice sau khi `chat/user joinToken` chuyển sang `INTERNAL_SERVICE_SECRET`.
5. **Không crash cho production cấu hình đúng:** điều kiện duy nhất khiến production thoát là thiếu/yếu/mặc định — chính điều đã đúng với các kiểm production hiện có. Production cấu hình đúng (secret ≥ 32 ký tự ngẫu nhiên, cờ vắng mặt) → hành vi không đổi.
6. **Lộ trình triển khai không làm gãy dev/test:**
   - Phát hành helper + test (S1) **chưa nối vào đâu** → không đổi hành vi.
   - Trước khi nối (S2), đưa `ALLOW_INSECURE_DEV_SECRETS=true` vào: `docker-compose.dev.yml` (khối `environment` mọi service + gateway), `docker-compose.test.yml` (2 chỗ), `.github/workflows/docker-test.yml`, `docker/test/.env.test.example`, tập lệnh `test` của từng `package.json` hoặc một tệp `test-env` chung, `.env.example` (kèm chú thích "CHỈ dev"), và các harness `cross-service-money.harness.ts`, `multi-instance/mi.harness.ts`. Test cố tình thử hành vi production tự đặt env riêng (như `gateway.secret.test.ts`, `user-service lambda-runtime.test.ts`).
   - Nối từng service một (S2), mỗi lần chạy lại bộ test của chính service đó + các test "fail-closed" mới; 3 test `todo` ở §2.4 **bỏ cờ `todo`** khi tương ứng được sửa (chúng sẽ thành xanh).
   - Dev compose bỏ `${X:-mặc định}` cho mọi secret (S3/S4), thay bằng tập lệnh sinh `.env` dev ngẫu nhiên (`scripts/dev-init-secrets`), vì chuỗi mặc định công khai chính là nguồn gốc vấn đề.
7. **Hai bẫy compose cần xử lý trong S3** (CODE AUDIT; chưa kiểm bằng chạy riêng lẻ trên prod):
   - `docker-compose.dev.yml` dùng `${JWT_SECRET:-…}` ở khối `environment`, mà nội suy `${…}` đọc `infra/compose/.env` hoặc biến shell, **không phải `../../.env`** (chính tệp compose có chú thích này ở dòng ~850-868). Khối `environment` ghi đè `env_file`. Hệ quả: đổi `JWT_SECRET` trong `.env` gốc **có thể không có tác dụng** với các service dùng `:-mặc định`. Sửa: bỏ dòng `environment` cho secret (để `env_file` quyết định) hoặc luôn chạy `--env-file ../../.env`.
   - `docker-compose.prod.yml` dùng `${JWT_SECRET}` không mặc định nhưng lệnh trong chú thích đầu tệp là `docker compose -f infra/compose/docker-compose.prod.yml up` không có `--env-file`; biến không nội suy được → chuỗi rỗng ghi đè `env_file` → auth-service thoát ("must be set") — an toàn (fail-closed) nhưng quy trình triển khai ghi trong tệp **sai**. Thêm `--env-file ../../.env` vào hướng dẫn và kiểm bằng `docker compose config` đưa qua bộ lọc chỉ in tên+băm (cách đã dùng để lập tài liệu này, an toàn).

### 2.4 Kiểm thử chứng minh điểm yếu (TEST FIXTURE — đã chạy 18–19/10)

Đã **thêm 4 tệp test mới**, không chạm mã sản phẩm. Mỗi test đặt `{ todo: … }`: mô tả hành vi mong muốn, hiện **thất bại với thông điệp "WEAKNESS CONFIRMED"**, và vì là `todo` nên **không làm đỏ** `npm test`. Không in giá trị bí mật (chuỗi mặc định được đọc từ mã nguồn lúc chạy chỉ để làm khóa ký).

| Tệp | Chứng minh |
|---|---|
| `backend/services/auth-service/src/__tests__/default-secret-weakness.test.ts` | `NODE_ENV=staging`, `JWT_SECRET` trống: token `role: ADMIN` ký bằng chuỗi mặc định trong mã **được `authService.verifyToken` chấp nhận** |
| `backend/services/payment-service/src/__tests__/default-secret-weakness.test.ts` | `NODE_ENV=staging` + đã cấu hình secret mạnh: `x-service-secret` = chuỗi dev mặc định **vẫn qua** `serviceSecretMiddleware` |
| `backend/services/fitness-service/src/__tests__/internal-auth-missing-secret-weakness.test.ts` | Chưa đặt secret, `NODE_ENV=staging`: `x-user-id` + `x-user-role: ADMIN` trần được `internalAuthMiddleware` cho qua |
| `backend/services/user-service/src/__tests__/pt-document-url-default-secret-weakness.test.ts` | **`NODE_ENV=production`**, thiếu secret: chữ ký tính bằng chuỗi cố định trong mã được `verifyDocumentUrl` chấp nhận |

Chạy từng tệp: `cd backend/services/<svc> && npx tsx --test src/__tests__/<tệp>`. Kết quả cả 4: `todo 1`, `fail 0`, thông điệp WEAKNESS CONFIRMED. Chưa chạy lại toàn bộ bộ test của từng service (không có thay đổi mã sản phẩm nên không cần), nên **không** tuyên bố "regression đầy đủ".

---

## 3. Rủi ro xử lý credential khác

| # | Mục | Phát hiện (CODE AUDIT/HASH-COMPARE) | Đề xuất |
|---|---|---|---|
| F-H1 | `.env` trong lịch sử git | Hiện **không** có tệp `.env` thật được theo dõi (`.gitignore` có `*.env`); nhưng giá trị trong lịch sử: `POSTGRES_PASSWORD` 41 commit, `JWT_SECRET` 6, `JWT_REFRESH_SECRET` 4, `INTERNAL_API_SECRET` 5, `INTERNAL_SERVICE_SECRET` 36 (đến 17/10/2026); các khóa bên thứ ba (Anthropic, SMTP, Dropbox, Metered, Pexels, VNPay, MoMo, ZaloPay) **0 commit** (kiểm bằng `git log --all -S`, chỉ in số commit). Khóa quét dạng `sk-ant-`, `AIza`, `AKIA`, khóa riêng PEM trong các tệp được theo dõi: chỉ `google-services.json` (khóa client Firebase) và 2 test có `AKIA…` dạng giả (đã kiểm bằng mẫu: trông như placeholder) | Không viết lại lịch sử (D65). Coi giá trị cũ là đã chết sau khi xoay; dùng V2 để theo dõi. Cân nhắc bật GitHub secret scanning + push protection |
| F-H2 | Transcript Claude cục bộ | 2 transcript chứa khóa bên thứ ba + 1 lần in `DATABASE_URL` dev (17–18/10). **Lượt này không in giá trị nào** | Sau khi xoay: Ngài xóa 2 transcript cục bộ (việc của Ngài); phát hành quy tắc: lệnh `docker inspect`, `docker compose config`, `env`, `printenv`, `cat .env` bị cấm hoặc phải qua bộ lọc băm |
| F7 | **Log in header** | `pino-http` đặt trong `auth-service/src/app.ts:21` và `user-service/src/app.ts:38` dạng `pinoHttp({ logger })`, logger ở `shared/src/index.ts:3-5` không có `redact` → mỗi request ghi `req.headers` (Authorization, `x-gateway-secret`, `x-service-secret`, cookie) | S5: `redact` ở logger gốc cho `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-gateway-secret"]`, `["x-service-secret"]`, `["x-internal-token"]`, `res.headers["set-cookie"]`, các trường `password`/`token`/`otp`; test đơn vị kiểm log không chứa chuỗi mẫu. Cũng bỏ `otp` khỏi `logger.warn({to, otp})` (`email.service.ts:33`) |
| F8 | `devOtp` + log OTP | Xem §2.2 | Gắn cờ §2.3 |
| F9 | Cổng dev publish mọi interface | `docker-compose.dev.yml` publish Postgres (5433), Redis (6379), Qdrant (6333/6334), MinIO (9000/9001), Prometheus (9090), Grafana (3100, admin/admin + ẩn danh Viewer), và **cổng của chính các service** (3001–3007) — tức thiết bị cùng LAN (điện thoại, người lạ trên Wi-Fi) chạm trực tiếp, bỏ qua gateway, với secret công khai là đủ để giả danh bất kỳ user | S3: bind `127.0.0.1:` cho mọi cổng trừ gateway (3000) và web (5173) — cần cho điện thoại qua LAN/adb reverse; tách `docker-compose.dev.lan.yml` nếu cần mở cho thiết bị |
| F10 | Compose nội suy | Xem §2.3 mục 7 | S3 |
| F11 | Hai tên một khái niệm | `INTERNAL_SERVICE_SECRET` / `INTERNAL_API_SECRET`; chat-service có **fallback khác** ở 2 chỗ | Hợp nhất (§2.3.4) |
| F12 | `x-trusted-web-origin` | Chỉ tin khi `x-gateway-secret` đúng — an toàn **khi secret thật**; với secret công khai là lỗ hổng chiếm tài khoản (§2.1 dòng auth.controller) | Giải quyết bởi S2 + S4; thêm danh sách origin cho phép (allowlist) từ `FRONTEND_URL`/`TRUSTED_WEB_ORIGINS` như lớp bảo vệ thứ hai (đề xuất, cần duyệt vì đổi hành vi liên kết email) |
| F-Q | **QR check-in 365 ngày** (backlog D71) | `checkinToken.ts:19`; QR chụp từ xa dùng được nguyên năm; chỉ bị giới hạn bởi kiểm quyền lợi mỗi lần quét | Đã ghi backlog. Biện pháp **không đổi business rule** có thể tự làm: khóa riêng bắt buộc (Q3), thêm `kid`/phiên bản khóa để xoay mà không in lại hàng loạt, ghi `ipAddress`/`userAgent` quét để phát hiện bất thường. Đổi cơ chế QR (xoay mã theo ngày/ngắn hạn) → **hỏi Ngài** |
| F-P | **IP / User-Agent lưu trữ** (liên quan câu hỏi riêng tư D25) | Schema có cột `ip_address`/`user_agent` ở auth-service (`schema.prisma:136-137`), gym-service (`:556-557`), user-service (`:1154-1155`, `:1589-1590`) | Cần quyết định chính sách: (i) mục đích (phát hiện gian lận, nhật ký đồng ý điều khoản D25), (ii) thời hạn lưu, (iii) có hiển thị trong chính sách quyền riêng tư không. **Không đổi gì trước khi Ngài quyết** (đây là câu hỏi pháp lý/sản phẩm — 🔴 nếu muốn xóa hoặc băm) |
| F-C | CORS / giới hạn tần suất | Chỉ nêu khi liên quan trực tiếp credential: đăng nhập đã có `login-rate-limit` (test có sẵn). Không tìm thấy cấu hình CORS `*` ở `gateway/src/app.ts` bằng tìm kiếm mẫu (`CORS_ORIGIN` được đọc ở nơi khác) — **chưa kiểm sâu**, ghi ⚪ | Ngoài phạm vi; để production-readiness |
| F-S | Thư mục `secret/` | `.gitignore:172` bảo vệ; chứa JSON Firebase Admin | Giữ; thêm vào danh sách xoay (§1.1) |

---

## 4. Các lát triển khai (slice) có tiêu chí nghiệm thu

Mọi slice: làm → test → tự sửa → test lại → checkpoint ngắn (D71). Không commit/push khi chưa được bảo. Nhãn bằng chứng ghi đúng loại.

### S0 — Đường cơ sở & kiểm kê (ĐÃ XONG, Claude)
- Có `secret/rotation-old-hashes.json` (gitignore) chứa độ dài + sha256 16 ký tự các giá trị hiện tại của `.env` gốc + 5 `.env` service; tài liệu này; 4 test `todo`.
- **Nghiệm thu:** tệp tồn tại, `git check-ignore` xác nhận bị bỏ qua, không có giá trị thô trong tài liệu.

### S1 — Helper dùng chung + test (Claude, không đổi hành vi)
- `shared/src/secrets.ts` (§2.3.1) + test đơn vị: thiếu/ngắn/mặc định (theo băm)/ký tự lặp → bị từ chối; cờ bật + `NODE_ENV≠production` → cho phép + cảnh báo; cờ bật + `NODE_ENV=production` → thoát; production + mạnh → qua.
- **Nghiệm thu:** test mới xanh; build `shared` xanh; không service nào gọi nó (diff của `git status` chỉ thêm tệp). Không cần duyệt riêng.

### S3a — Harness dev/test đặt cờ (làm TRƯỚC S2)
- Thêm `ALLOW_INSECURE_DEV_SECRETS=true` vào mọi nơi liệt kê ở §2.3.6.
- **Nghiệm thu:** toàn bộ tập test hiện có của gateway/auth/user/payment/fitness/ai/chat (tập chạy thật nào chạy phải ghi rõ) cho **cùng kết quả như trước** (so với baseline đã ghi trong `_warroom` — số bài qua/lỗi đã biết). Dev stack khởi động như cũ.

### S2 — Nối helper vào service (Claude; cần Ngài duyệt Q2 vì chạm payment-service)
Thứ tự từng service, mỗi service chạy test của nó + test "fail-closed":
1. **auth-service** (JWT + internal; bỏ `|| literal`; kiểm thử weakness #1 thành xanh → bỏ `todo`).
2. **gateway** `utils/internal-secret.ts` + `app.ts` (còn `proxy.routes.ts:35-41` **chờ phiên khác xong**).
3. **user-service** middleware + `ptDocumentUrl.util.ts` (test #4 xanh, **kể cả production**) + `joinToken`.
4. **payment-service** middleware + `admin.routes.ts`, `reconciliation.service.ts` (test #2 xanh). *Không chạm logic tiền.*
5. **fitness-service**, **ai-service**: nhánh tin header chỉ khi cờ (test #3 xanh).
6. **chat-service**: bỏ fallback riêng; hợp nhất tên biến (§2.3.4).
7. **gym-service** — *chờ phiên khác sửa xong (đang có thay đổi chưa commit ở 30+ tệp gym-service)*: middleware, 4 client, `request-context`, `checkin`, `pt-checkin`, `checkinToken` (khóa riêng, Q3).
- **Nghiệm thu mỗi service:** (i) không còn `|| "<literal bí mật>"` (lệnh `git grep` theo băm danh sách mặc định = 0 kết quả trong `src/` không phải test); (ii) khởi động với cờ tắt + secret mặc định → thoát với thông điệp chỉ có tên biến; (iii) khởi động với cờ bật → chạy, có cảnh báo; (iv) `NODE_ENV=production` + cờ có mặt → thoát; (v) production + secret mạnh → chạy như cũ.

### S5 — Log hygiene (làm TRƯỚC S4, nhỏ)
- Thêm `redact` vào logger dùng chung + `pinoHttp`; bỏ `otp` khỏi log cảnh báo.
- **Nghiệm thu:** test đơn vị xác nhận log chứa `[Redacted]`; V7 = 0 lần xuất hiện băm secret/token mẫu.

### S3b — Compose & cổng (Claude)
- Bỏ `:-mặc định` khỏi secret trong `docker-compose.dev.yml`; thêm `scripts/dev-init-secrets` (sinh `.env` dev ngẫu nhiên, **không in**); bind `127.0.0.1` cho cổng không phải gateway/web; sửa hướng dẫn prod thêm `--env-file`; đổi Grafana admin sang biến.
- **Nghiệm thu:** `docker compose config` qua bộ lọc băm cho thấy mọi service nhận cùng một `INTERNAL_SERVICE_SECRET` mạnh và không còn băm trùng mặc định; quét cổng publish chỉ còn 3000/5173 trên mọi interface.

### S4 — Xoay khóa dev + phiên (Claude làm, **Ngài cho phép từng bước**: đụng DB dev và đăng xuất mọi người)
1. Sinh giá trị ngẫu nhiên (`crypto.randomBytes`) cho `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_SECRET`, `INTERNAL_API_SECRET`, `CHECKIN_TOKEN_SECRET`, `PT_DOCUMENT_URL_SECRET`, `MINIO_ROOT_*`, `POSTGRES_PASSWORD`; ghi thẳng vào `.env` (và đồng bộ 5 `DATABASE_URL`, gỡ `JWT_REFRESH_SECRET` trùng ở `auth-service/.env`); không in.
2. `ALTER ROLE` đổi mật khẩu Postgres dev; `docker compose up -d --force-recreate`.
3. Thu hồi phiên: đổi `JWT_SECRET` làm access token cũ chết; đổi `JWT_REFRESH_SECRET` làm refresh cũ chết; làm sạch bảng refresh token trong DB dev nếu Ngài cho phép.
4. Đưa mật khẩu Postgres ra khỏi `package.json:23`, `scripts/*.mjs`, `fix.js` và test (đọc từ env).
- **Nghiệm thu:** V1, V3, V4, V5, V6 xanh; người dùng seed đăng nhập lại được (REAL HTTP); QR check-in mới tạo và quét được (nếu Q3 chọn A).

### S6 — Kiểm sau xoay + ghi chép (Claude)
- Chạy V1–V7, ghi `docs/SECURITY_ROTATION_VERIFICATION_<ngày>.md` với nhãn bằng chứng; mục nhà cung cấp ghi "**Ngài xác nhận**" chứ không "đã kiểm chứng". Cập nhật `docs/PHASE_2_5_EXIT_CHECKLIST.md` hàng Security.

### 4.3 Cổng production (phải xong trước khi mở tiền thật / go-live)

1. Q1 đã trả lời; **tất cả khóa trong §1.1 mức P-A và P-B** đã được Ngài xác nhận xoay và S6 xanh.
2. S1–S3 xong; production khởi động thoát nếu có bất kỳ secret mặc định/ngắn/thiếu, hoặc có `ALLOW_INSECURE_DEV_SECRETS`, hoặc khóa demo VNPay/MoMo/ZaloPay, hoặc `VNPAY_SIMULATE=true`.
3. Production dùng bộ khóa **riêng** (Secrets Manager/SSM hoặc ít nhất `.env` do Ngài tạo trên máy chủ, không sao chép từ máy dev); không còn bản sao `.env` dev trên máy chủ.
4. Cổng nội bộ không publish ra ngoài (compose prod đã đúng; kiểm lại bằng quét cổng thật trên máy chủ).
5. S5 xong; kiểm tra log máy chủ thật không chứa header nhạy cảm.
6. Quyết định F-Q (QR) và F-P (IP/UA) đã được Ngài chốt hoặc ghi rõ là chấp nhận rủi ro.
7. Bật secret scanning/push protection trên repo; quy trình xoay khóa định kỳ (ít nhất mỗi 6 tháng và khi có người rời dự án).

---

## 5. Giới hạn của kế hoạch này (nói thẳng)

- Claude **không** kiểm chứng được khóa bên thứ ba đã chết; chỉ kiểm cấu hình cục bộ (băm) và kiểm lịch sử git.
- Không biết `NODE_ENV` thực tế của bất kỳ máy chủ thật nào → Q1.
- Các điểm yếu được chứng minh bằng test gọi hàm/middleware trực tiếp (TEST FIXTURE), **chưa** bằng REAL HTTP qua gateway.
- Chưa kiểm sâu CORS, bảo mật frontend, hay bí mật trong ảnh Docker đã build.
- gym-service và `backend/gateway/src/routes/proxy.routes.ts` đang do phiên khác sửa; mọi nhận xét về chúng là đọc, không sửa.
