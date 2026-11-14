# CSDL chính thức cho buổi phản biện khóa luận (`--target official`)

Hướng dẫn cho bên partner: tự **sinh** bộ cơ sở dữ liệu dùng trong buổi phản biện trên máy của mình (không có file dump nào được gửi). Bộ dữ liệu gồm hai lớp trên cùng các DB `gymcoach_<svc>_official`:

| Lớp | Nguồn | Quy mô | Bản chất |
|---|---|---|---|
| Lịch sử quy mô lớn | `--tier scale` | 10.400 PT (10.000 công khai) · 2.500 phòng gym · 900 chủ gym · 25.000 khách hàng · hợp đồng/buổi tập/đánh giá lịch sử | **SYNTHETIC** (dữ liệu tổng hợp, `data_origin = SYNTHETIC`, email `@scale.gymini.test`) |
| Tài khoản test thật | `--tier all` (business seed) | ~1.080 khách + 80 PT + 25 chủ gym, hợp đồng và hội viên đã thanh toán qua simulator | **REAL** (`data_origin = REAL`, email `@seed.gymini.test`) |

Sự thật cần nói thẳng khi trình bày (không che):

* Toàn bộ **lịch sử** (số hợp đồng, đánh giá, buổi tập, hội viên cũ) là dữ liệu **tổng hợp**, chỉ để duyệt/tìm kiếm/xem hồ sơ ở quy mô lớn.
* Tài khoản **SYNTHETIC chỉ để xem**: mọi thao tác tiền (yêu cầu hợp đồng, mua gói, mua hội viên) bị chặn với mã **409**.
* Luồng **tiền chỉ chạy với tài khoản REAL** (`@seed.gymini.test`). Hợp đồng/giao dịch của nhóm này là thật trong hệ thống (có ví, ledger, escrow), thanh toán bằng VNPay simulator hoặc cổng sandbox bạn đã cấu hình.
* Ảnh PT/gym là ảnh Pexels có giấy phép (xem `assets/ATTRIBUTION.md`); ảnh đại diện là DiceBear sinh cục bộ.

> An toàn: `--target official` chỉ ghi vào DB tên đúng `gymcoach_{auth,user,gym,payment}_official`, **bắt buộc DB rỗng** khi nạp lớp scale, chỉ chạy với Postgres ở `localhost` (host khác phải thêm cờ `--allow-remote-host`), từ chối mọi tên/host chứa `prod`/`staging`/`live`, và bắt buộc `SEED_MARKETPLACE_CONFIRM=official`. Các DB cũ (`gymcoach_<svc>`) không bị đụng tới nên luôn dùng làm đường lui.

## 0. Điều kiện cần

* Repo ở đúng commit này, đã `pnpm install --frozen-lockfile` (lệnh dùng `node_modules` sẵn có của từng service, không cài gì thêm).
* Docker Desktop; Postgres (container dev `gymcoach-postgres`, cổng `5433`) và MinIO dev (`9000`) đang chạy: `docker compose -f infra/compose/docker-compose.dev.yml up -d postgres redis minio`.
* Bucket MinIO tồn tại (dev compose tạo sẵn `gymini-user-media` và `gymini-partner-private`; nếu bạn dùng tên khác thì đặt đúng biến môi trường ở bước 3).
* Ổ đĩa trống ≳ 3 GB cho DB (~1,5 GB), MinIO (~0,5 GB) và avatar (~0,2 GB); RAM ≳ 2 GB cho tiến trình seed (đỉnh ~450 MB).

PowerShell, chạy ở gốc repo. Đặt biến kết nối một lần cho cả phiên (đổi cho đúng máy bạn; **không dán mật khẩu vào chat/log**):

```powershell
$env:SEED_PG_HOST = 'localhost'; $env:SEED_PG_PORT = '5433'
$env:SEED_PG_USER = 'gymcoach';  $env:SEED_PG_PASSWORD = '<mật khẩu Postgres dev của bạn>'
$pg = "postgresql://$($env:SEED_PG_USER):$($env:SEED_PG_PASSWORD)@localhost:5433"
```

## 1. Tạo 5 DB `_official` (DB MỚI, không đụng DB cũ)

`auth`, `user`, `gym`, `payment` được seed; `chat` cần DB riêng để cuộc trò chuyện sinh ra khi seed không lẫn vào DB cũ. (`fitness`/`ai` **không** đổi: chúng giữ danh mục bài tập/thực phẩm/tri thức; luồng marketplace không dùng.)

```powershell
foreach ($s in 'auth','user','gym','payment','chat') {
  docker exec gymcoach-postgres createdb -U $env:SEED_PG_USER "gymcoach_${s}_official"
  if ($LASTEXITCODE -ne 0) { throw "createdb $s lỗi (đã tồn tại? KHÔNG drop DB cũ, kiểm tra trước khi tiếp tục)" }
}
```

## 2. `prisma migrate deploy` từng service + nạp tỉnh/phường

Mỗi service dùng migration có trong repo. (~1 phút tổng, tùy máy.)

```powershell
foreach ($s in 'auth','user','gym','payment') {
  Push-Location "backend/services/$s-service"
  $env:DATABASE_URL = "$pg/gymcoach_${s}_official"
  node_modules/.bin/prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "migrate $s lỗi" }
  Pop-Location
}
Push-Location backend/services/chat-service
$env:CHAT_DATABASE_URL = "$pg/gymcoach_chat_official"; $env:DATABASE_URL = $env:CHAT_DATABASE_URL
node_modules/.bin/prisma migrate deploy; Pop-Location

# 34 tỉnh + 3.321 phường (dữ liệu tham chiếu, ~30 giây)
Push-Location backend/services/user-service
$env:DATABASE_URL = "$pg/gymcoach_user_official"
node_modules/.bin/tsx prisma/seed_vietnam_locations.ts; Pop-Location
Remove-Item Env:DATABASE_URL, Env:CHAT_DATABASE_URL
```

> **Chưa khởi động service nào trỏ vào DB `_official` trước khi seed lớp scale.** (Lớp scale cần DB rỗng; service chạy lên sẽ tự ghi vài dòng hệ thống.)

## 3. Biến môi trường seed (MinIO + xác nhận)

Lớp scale copy ~1.100 ảnh Pexels gốc vào MinIO rồi nhân lên (~34.500 bản copy phía server). Với `--target official` **không có giá trị mặc định nào**: phải khai báo MinIO của bạn (cùng biến mà service dùng), nếu thiếu seed dừng **trước khi ghi dòng nào**; endpoint trùng MinIO của môi trường scale (`:59000`) bị từ chối.

```powershell
$env:SEED_MARKETPLACE_CONFIRM = 'official'
$env:SEED_MINIO_ENDPOINT   = 'http://127.0.0.1:9000'    # endpoint MinIO nhìn từ MÁY HOST (không phải http://minio:9000 trong mạng compose)
$env:SEED_MINIO_ACCESS_KEY = '<access key MinIO>'
$env:SEED_MINIO_SECRET_KEY = '<secret key MinIO>'
$env:PT_MEDIA_S3_BUCKET        = 'gymini-user-media'          # bucket ảnh PT (user-service dùng cùng tên)
$env:PARTNER_S3_PRIVATE_BUCKET = 'gymini-partner-private'     # bucket ảnh gym (gym-service dùng cùng tên)
$env:SEED_AVATARS_DIR = "$PWD/scripts/seed-marketplace/.runtime/official/profile-photos"   # (tùy chọn) nơi ghi avatar WebP
$env:NODE_ENV = 'development'; $env:SEED_PT_DOCUMENT_UPLOAD = 'multipart'   # cho bước business seed (giấy tờ PT upload multipart vì không có bucket AWS)
```

Seed kiểm tra kết nối và sự tồn tại của hai bucket **trước khi ghi DB**.

## 4. Thứ tự lệnh

| # | Lệnh | Thời gian tham khảo |
|---|---|---|
| 4.1 | Ward geo | ~2 giây |
| 4.2 | Lớp scale (DB rỗng bắt buộc): ~1,16 triệu dòng, 10.410 avatar, ~35.800 ảnh MinIO, rồi 8 kiểm tra | ~18 phút (đo thực 17,9 phút; đỉnh RAM ~425 MB) |
| 4.3 | Dựng service trỏ `_official` + bật quyền tạm của seed | 2-4 phút (service lên healthy) |
| 4.4 | Business seed (tài khoản REAL): ~1.100 request HTTP, ~200 ghi nghiệp vụ, thanh toán qua simulator | ~20-25 phút (lần chạy lại/resume: ~3-4 phút) |
| 4.5 | Tắt quyền tạm, chạy chế độ thường | 2-4 phút |
| 4.6 | Kiểm tra tính toàn vẹn (scale 8 + business 11, gồm kiểm tra file MinIO/avatar) | ~2 phút |
| 5 | Copy avatar vào user-service | ~1 phút |

```powershell
# 4.1 tọa độ/bbox phường (bắt buộc trước lớp scale: bước verify C6 kiểm GPS từng gym/PT trong bbox phường)
node scripts/seed-marketplace/load-ward-geo.mjs --target official

# 4.2 lớp SYNTHETIC. Kết thúc bằng bộ kiểm tra scale (8 mục); lỗi => exit 1, KHÔNG sang bước tiếp theo.
node scripts/seed-marketplace/index.mjs --target official --tier scale --batch 1000
#     bị ngắt giữa chừng: chạy lại đúng lệnh trên kèm --resume (có checkpoint, không ghi trùng)
```

Mật khẩu 18 ký tự ngẫu nhiên của các tài khoản demo scale được ghi **chỉ** vào `scripts/seed-marketplace/.runtime/official/scale-demo-accounts.txt` (thư mục `.runtime/` bị gitignore, không bao giờ in ra màn hình/log). Khoảng 36.000 tài khoản còn lại dùng một mật khẩu ngẫu nhiên đã bị hủy nên **không ai đăng nhập được** (chỉ để xem).

```powershell
# 4.3 chuyển service sang DB _official, kèm quyền TẠM chỉ dành cho lúc seed
#     (owner link trả thẳng trong response, VNPay simulator, nới rate limit gateway). Xem chú thích trong 2 file override.
docker compose -f infra/compose/docker-compose.dev.yml `
  -f scripts/seed-marketplace/official/compose.official.override.yml `
  -f scripts/seed-marketplace/official/compose.official.seed.override.yml `
  up -d --no-deps --force-recreate auth-service user-service gym-service payment-service chat-service api-gateway
# chờ các container healthy (docker compose ps), rồi:

# 4.4 business seed: Tier A (DB) + Tier B (HTTP qua gateway, đúng các luồng thật). Chạy TRÊN dữ liệu scale; idempotent.
node scripts/seed-marketplace/index.mjs --target official --tier all --gateway http://localhost:3000 --fail-fast --evidence _warroom/evidence/official/business-run.json
#     lỗi giữa chừng: chạy lại cùng lệnh (mỗi bước là "ensure": bước đã xong không ghi thêm)

# 4.5 TẮT quyền tạm: tạo lại service với CHỈ file override DB (không có file seed)
docker compose -f infra/compose/docker-compose.dev.yml `
  -f scripts/seed-marketplace/official/compose.official.override.yml `
  up -d --no-deps --force-recreate auth-service user-service gym-service payment-service chat-service api-gateway
docker exec gymcoach-auth-dev printenv PARTNER_APPLICATION_DEV_ECHO   # phải là false
docker exec gymcoach-gym-dev  printenv PARTNER_APPLICATION_DEV_ECHO   # phải là false
docker exec gymcoach-payment-dev printenv VNPAY_SIMULATE              # false trừ khi chính bạn muốn thử thanh toán bằng simulator

# 4.6 toàn vẹn: cả 2 bộ trên dữ liệu hỗn hợp (scale-tier 8 mục + business-seed 11 mục). Exit 0 = đạt.
node scripts/seed-marketplace/verify-integrity.mjs --target official --with-media
```

> Lưu ý VNPay simulator: payment-service vẫn cần `VNPAY_TMN_CODE` / `VNPAY_HASH_SECRET` khác rỗng (simulator tự ký URL trả về bằng chúng). File override seed lấy giá trị từ `.env` của bạn, không có thì dùng chuỗi giả; lỗi `PROVIDER_NOT_CONFIGURED` nghĩa là thiếu cả hai.

Rate limit gateway: **không** sửa lâu dài. Bản nới chỉ có trong `compose.official.seed.override.yml` (Tier B gửi hàng nghìn request từ một IP, trong khi mặc định của code là 100 request/phút và 20 lần đăng nhập/15 phút); sau 4.5 gateway quay về cấu hình thường của bạn. File compose của môi trường scale (`docker-compose.scale.yml`) nâng giới hạn chỉ để benchmark, không dùng cho DB chính thức.

## 5. Avatar: đưa file vào user-service

Ảnh PT/gym phục vụ qua MinIO + gateway nên không cần làm gì thêm. **Avatar** (~10.400 file WebP `<userId>.webp`) nằm trong `SEED_AVATARS_DIR` và phải có trong thư mục upload của user-service để `GET /uploads/profile-photos/<userId>.webp` trả 200. Dev compose dùng volume `user_uploads` gắn vào `/app/backend/services/user-service/uploads`:

```powershell
# thư mục đích nằm trong volume => bền qua --force-recreate
docker exec gymcoach-user-dev mkdir -p /app/backend/services/user-service/uploads/profile-photos
docker cp "$env:SEED_AVATARS_DIR/." gymcoach-user-dev:/app/backend/services/user-service/uploads/profile-photos/
docker exec gymcoach-user-dev sh -c "ls /app/backend/services/user-service/uploads/profile-photos | wc -l"   # >= 10.400
```

(Có thể thay bằng bind mount `./scripts/seed-marketplace/.runtime/official/profile-photos:/app/backend/services/user-service/uploads/profile-photos` trong file override của bạn.) Tên file là UUID nên không đè avatar cũ của DB dev.

## 6. Tài khoản & cái gì dùng được

* **Danh sách tài khoản demo scale** (mật khẩu từng tài khoản): `scripts/seed-marketplace/.runtime/official/scale-demo-accounts.txt`, gitignored, mở trực tiếp bằng trình soạn thảo; gồm admin scale, khách/PT/chủ gym mẫu theo tỉnh. Chúng là SYNTHETIC: xem được, **409 khi thao tác tiền**.
* **Tài khoản REAL (giao dịch được)**: `<slug>@seed.gymini.test`, mật khẩu cố định tài liệu hóa trong `SEED.md` (đặt `SEED_MARKETPLACE_PASSWORD` trước bước 4.4 nếu muốn mật khẩu riêng). Admin: `marketplace-admin@seed.gymini.test`. Tài khoản gợi ý: `pham-thu-uyen` (khách), `tran-minh-khoa` (PT đã duyệt), `nguyen-truong-thanh` (chủ gym ACTIVE). Danh sách đầy đủ: `SEED.md`.
* Hai lớp cùng hiện trong tìm kiếm PT/gym; PT/gym REAL nhận khách thật, PT/gym SYNTHETIC chỉ hiển thị.

## 7. Chuyển hệ thống của bạn sang DB `_official` và đường lui

Chuyển = chạy service với `compose.official.override.yml` (đổi `DATABASE_URL` của auth/user/gym/payment/chat sang `_official`, giữ `prisma migrate deploy` lúc khởi động). Quay lại DB cũ = chạy lại lệnh `up -d --force-recreate ...` **không kèm** file override đó; DB cũ chưa hề bị sửa. Muốn giữ cả hai: dùng hai file `.env`/hai project compose, không dùng chung volume.

Nếu bạn không dùng dev compose của repo: chỉ cần đặt `DATABASE_URL` của từng service sang `gymcoach_<svc>_official` (chat: `CHAT_DATABASE_URL`) và giữ nguyên mọi biến khác.

## 8. Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `REFUSED (CONFIRM_MISSING)` | chưa đặt `SEED_MARKETPLACE_CONFIRM=official` |
| `REFUSED (DB_NOT_ALLOWLISTED / DB_SERVICE_MISMATCH)` | tên DB không đúng `gymcoach_<svc>_official` |
| `REFUSED (HOST_NOT_ALLOWED)` | Postgres không ở `localhost`; nếu thật sự cần: thêm `--allow-remote-host` |
| `SCALE_ALREADY_SEEDED` / `OFFICIAL_NOT_EMPTY` | DB không rỗng (đã seed hoặc service đã chạy trên đó). Tạo DB `_official` mới, hoặc nếu lần chạy trước bị ngắt dùng `--resume` |
| `OFFICIAL_FOREIGN_DATA` | có tài khoản ngoài `@scale.gymini.test` / `@seed.gymini.test` trong DB: bạn đang trỏ nhầm DB, dừng lại |
| `MEDIA_ENV_MISSING` / `MEDIA_ENDPOINT_REFUSED` / `MEDIA_UNREACHABLE` | thiếu/sai biến MinIO ở bước 3 hoặc bucket chưa tạo |
| `Scale integrity failed ...` | đọc `scripts/seed-marketplace/.runtime/official/scale-report.json`; lỗi kiểm tra 6 thường do chưa chạy 4.1 (ward geo) |
| Tier B: `429` / "Too many ..." | quên file `compose.official.seed.override.yml` ở bước 4.3 |
| Tier B: `400 PROVIDER_NOT_CONFIGURED` | payment-service thiếu `VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` (xem lưu ý VNPay ở bước 4); sửa rồi chạy lại cùng lệnh 4.4, seed tiếp tục từ chỗ dừng |
| Tier B: `no /payments/vnpay/sim URL` | `VNPAY_SIMULATE` chưa bật trên payment-service (bước 4.3) |
| Avatar 404 | chưa chạy bước 5 hoặc sai thư mục đích |
| Ảnh PT/gym 404 | service đọc bucket/endpoint khác với bước 3 (so khớp `PT_MEDIA_S3_*` và `PARTNER_S3_*` trong `.env`) |
| Cần làm lại từ đầu | tạo DB `_official` MỚI (đổi tên cũ sang `_official_old` bằng `ALTER DATABASE ... RENAME` nếu muốn), KHÔNG dùng `down -v` lên volume dev |
