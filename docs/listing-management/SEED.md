# Listing Management — Dữ liệu mẫu & dọn DB (trang trỏ)

Trang này chỉ chỉ đường; hướng dẫn đầy đủ nằm ở hai tệp nguồn, **đọc chúng trước khi chạy**:

| Công cụ | Tệp chuẩn | Dùng để |
|---|---|---|
| Seed marketplace | `scripts/seed-marketplace/SEED.md` | tạo dữ liệu giống thật: 1.000 khách, 80 PT, 25 chủ gym, 80 chi nhánh, 127 gói thành viên, 365 ảnh Pexels (có ghi nguồn trong `assets/ATTRIBUTION.md`) |
| db-clean | `scripts/db-clean/README-db-clean.md` | dọn dữ liệu test/E2E khỏi DB dev có sao lưu, thử khôi phục và manifest được duyệt |
| Báo cáo tương thích app cũ | `scripts/listing-compat-report.mjs` | chỉ đọc; cho biết có đủ điều kiện tắt `LISTING_LEGACY_CLIENT_COMPAT` hay chưa (xem [AMENITY_SYSTEM](AMENITY_SYSTEM.md) §5) |

## 1. Seed có gì

- **Ma trận kịch bản cố định**: PT P1–P16 và chủ gym O1–O10 phủ đủ trạng thái tin đăng (APPROVED, PENDING, CHANGES_REQUESTED, REJECTED, DRAFT, STALE), PT bị khóa/hạn chế, chi nhánh đóng tạm/đóng vĩnh viễn/tạm ngưng, chi nhánh đúng 20 ảnh, đề xuất tiện ích NEW/REENABLE/MERGED/REJECTED. Bảng đầy đủ ở SEED.md; số thực tế sau lần chạy thật nằm ở `_warroom/evidence/seed-live/REPORT.md`.
- **Hai tầng**: Tier A ghi thẳng DB (tài khoản khách, hồ sơ, InBody; id tất định, chỉ INSERT, chạy lại ra số liệu y hệt). Tier B đi qua **gateway thật** (đơn PT, tin đăng, ảnh qua presign→MinIO→confirm, chủ gym, tiện ích, hợp đồng thanh toán bằng trang giả lập VNPay), mỗi bước là "ensure" nên chạy lại không ghi thừa.
- Tài khoản: `<slug>@seed.gymini.test`; mật khẩu và admin seed xem mục *Accounts* của SEED.md (không chép vào tài liệu này).
- **Cố ý không có**: lịch sử buổi tập đã COMPLETED, đánh giá buổi, hợp đồng PT COMPLETED — API không lùi thời gian được và ghi bằng SQL cần khớp sổ cái payment-service. Báo cáo ghi là `contract.SKIPPED_no_api_for_completed_history`.

## 2. Đối tác tự chạy (`--target partner`)

Chạy trên **Postgres cục bộ của đối tác**, vào 7 DB riêng `gymcoach_<svc>_seedrun`; không đụng DB dev hiện có. Công thức đầy đủ (PowerShell) ở SEED.md mục *Live partner runbook*; khung:

1. `git pull`, `pnpm install --frozen-lockfile`, bật `postgres redis minio`.
2. `createdb` 7 DB `*_seedrun` (lệnh từ chối tên đã tồn tại; không bao giờ drop).
3. Dựng lại các service bằng `compose.seedrun.override.yml` (**bật cờ tạm**, xem §4).
4. Đặt `SEED_MARKETPLACE_CONFIRM=partner`, `SEED_DB_SUFFIX=seedrun`, rồi `node scripts/seed-marketplace/index.mjs --target partner --tier all --gateway http://localhost:3000 --fail-fast --evidence <tệp>`.
5. `node scripts/seed-marketplace/verify-integrity.mjs --target partner` — phải qua hết (lần ghi nhận: 11/11).
6. `snapshot.mjs` lưu số đếm; chạy lại phần còn thiếu bằng `--reseed`.
7. **Tắt cờ tạm** (§4).

Rào chắn (`lib/guard.mjs`): từ chối `NODE_ENV=production`, tên DB chứa `prod/staging/live`, host không phải máy cục bộ, và e-mail seed trùng tài khoản không thuộc seed (`SeedCollisionError`, chưa ghi gì). Đổi hậu tố DB thì phải đổi cả URL của service lẫn `SEED_DB_SUFFIX` — chỉ đổi CLI là không đủ.

## 3. Bẫy `SKIP_SEED=true` của `db-seeder`

Compose dev có service `db-seeder` (`infra/compose/docker-compose.dev.yml`) nạp lại dữ liệu test cũ mỗi lần `up`. Nó chỉ thoát sớm khi `SKIP_SEED=true` (mặc định `false`).

- Dựng stack dev trên DB đã dọn/seed **phải** đặt `SKIP_SEED=true` (trong `.env` hoặc môi trường), hoặc dùng `up --no-deps` cho từng service.
- Đã xảy ra: bật compose gốc thiếu cờ làm `db-seeder` nạp lại 105 tài khoản cũ sau khi dọn (phải audit và dọn lại).
- Compose `…seedrun…` / `compose.restore.override.yml` đã tính chuyện này; **không** chạy compose gốc một mình lên DB mới seed.

## 4. Quy tắc cờ tạm: bật chỉ trong lúc seed, rồi tắt và chứng minh

Seed cần 3 thứ tạm thời (SEED.md "Tier B prerequisites"):

| Cờ / chỉnh | Service | Vì sao |
|---|---|---|
| `PARTNER_APPLICATION_DEV_ECHO=true` | auth-service, gym-service | tạo tài khoản chủ gym mà không cần e-mail thật |
| `VNPAY_SIMULATE=true` | payment-service | cách duy nhất trả tiền giả lập khi chạy offline (gateway MOCK đã bị xóa) |
| nâng rate-limit `/auth/partner-applications/start` | gateway | seed gọi 25 lần, mặc định 10 lần / 15 phút / IP |

Quy tắc:
1. Chỉ bật bằng file override (không sửa `.env` lâu dài).
2. Khi xong, dựng lại các service với override "ready" **đặt cuối cùng** để đưa cờ về `false`.
3. **Chứng minh** bằng `printenv`, không bằng trí nhớ — ba lệnh phải in `false`:
   `docker exec gymcoach-payment-dev printenv VNPAY_SIMULATE`,
   `docker exec gymcoach-auth-dev printenv PARTNER_APPLICATION_DEV_ECHO`,
   `docker exec gymcoach-gym-dev printenv PARTNER_APPLICATION_DEV_ECHO`.
4. Chạy lại spec Playwright cần `DEV_ECHO` cũng theo quy tắc này (bật tạm, tắt, `printenv` ra `false`).

## 5. db-clean tóm tắt

Quy trình có cổng: `audit` (chỉ đọc, sinh manifest + `confirmToken`) → người có thẩm quyền duyệt → `approve` → `freeze` → `backup` (7 DB + thử khôi phục) → `clean --apply` (mỗi DB một transaction) → `verify` → `unfreeze` (kiểm đăng nhập thật, ghi `verify-clean.ok`). Mọi lệnh ghi trên dev cần `DBCLEAN_CONFIRM=dev`; seed dev cần thêm `verify-clean.ok`. Lệnh phục hồi thủ công (script chết) ở cuối README-db-clean.
