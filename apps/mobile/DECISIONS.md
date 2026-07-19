# Quyết định tự động (không hỏi lại) — Mobile app

Ghi theo yêu cầu "Nguyên tắc tự quyết khi mơ hồ" của prompt gốc. Format:
quyết định → lý do → ảnh hưởng.

## P0 — Cấu trúc repo khác giả định trong prompt

**Quyết định**: giữ nguyên đường dẫn `apps/mobile` như prompt yêu cầu (không
đổi sang `frontend/mobile`), nhưng dùng package name thật
`@gym-coach/shared` (không phải `@fitness/shared`/`packages/shared`) khi
import code dùng chung, và trỏ tới `backend/gateway` (không phải
`apps/api-gateway`), `frontend/web` (không phải `apps/web`).

**Lý do**: prompt được soạn dựa trên giả định monorepo dạng `apps/*` +
`packages/shared`, nhưng repo thật dùng `frontend/*` + `backend/*` +
`backend/shared`, quản lý bởi pnpm workspace khai trong
`pnpm-workspace.yaml`. Đổi toàn bộ layout sang `apps/*`/`packages/*` sẽ là
một refactor không liên quan tới yêu cầu ("chỉ thêm, không đổi behavior
cũ" — mục 4 quy tắc thực thi). Giữ `apps/mobile` là hợp lý vì đây là thư
mục MỚI, không đụng tới cấu trúc cũ.

**Ảnh hưởng**: `pnpm-workspace.yaml` sẽ được thêm dòng `apps/*` ở Phase 1
(chỉ thêm, không sửa dòng cũ). Toàn bộ API_MAP.md dùng path thật, không
dùng path giả định trong prompt.

## P0 — Tên package `@fitness/shared` không tồn tại

**Quyết định**: nếu Phase 1 cần import type dùng chung, dùng
`@gym-coach/shared` (package thật ở `backend/shared`). Nếu
`backend/shared` không export đủ type cần cho mobile (ví dụ types cho
`TrainingCycle`, `CycleSummary` hiện chỉ định nghĩa trong
`frontend/web/src/app/services/api.ts`, không có trong `backend/shared`),
mobile sẽ tự định nghĩa lại type tương ứng trong
`apps/mobile/src/api/types.ts` thay vì sửa `backend/shared` để thêm export
mới (tránh đụng code dùng chung của các service backend khi không thật sự
cần).

**Lý do**: `backend/shared/src/{schemas.ts,types.ts}` được viết chủ yếu cho
giao tiếp giữa các backend service (internal), không phải là nguồn types
đầy đủ cho toàn bộ API response mà frontend cần — bằng chứng là
`frontend/web` cũng tự định nghĩa lại phần lớn type (`TrainingCycle`,
`CycleSummary`,...) trong `api.ts` thay vì import từ `backend/shared`.
Mobile đi theo đúng pattern web đã dùng.

**Ảnh hưởng**: `apps/mobile/src/api/types.ts` sẽ là nguồn type chính cho
mobile, viết tay dựa theo `API_MAP.md`, không tự động sync với backend.

## P0 — training-cycles đã tồn tại trên backend (khác giả định "chưa có")

**Quyết định**: bật `FEATURE_CYCLES=true` mặc định trong `.env.example`
của mobile, nhưng vẫn giữ nguyên toàn bộ cơ chế feature-flag như prompt
yêu cầu (đọc từ env, không hard-code), để dễ tắt khi test với backend cũ
chưa migrate.

**Lý do**: prompt viết "nếu chưa có — mobile sẽ để sau feature flag", ngụ
ý phòng trường hợp chưa build. Thực tế đã build đầy đủ (xem
`docs/training-cycle-v2.md`), nên bật mặc định là đúng tinh thần yêu cầu
("Nếu backend có training-cycles..." ở Phase 5/9).

**Ảnh hưởng**: card "Chu kỳ hiện tại" ở Dashboard (P5) và card quyết định
3 nhánh ở Plans (P9) sẽ render thật ngay từ đầu, không phải fallback.

## P3 — Xác minh auth flow: backend thật CÓ chạy trong phiên, nhưng không
có emulator/browser tương tác

**Quyết định**: xác minh flow đăng nhập bằng cách gọi thẳng
`POST http://localhost:3000/auth/login` với tài khoản demo
(`john.doe@example.com`/`password123`) qua curl, đối chiếu response thật
với `LoginResponse` type đã viết trong `src/api/types.ts` — khớp chính
xác (`user.role`, `accessToken`, `refreshToken` ở top-level). Kết hợp
`tsc --noEmit`, `eslint .`, và `npx expo export --platform web` (bundle
1:1 module resolution, không lỗi) làm bằng chứng code đúng cấu trúc.
**Chưa** verify được tương tác UI thật (gõ form, bấm nút, xem SecureStore
lưu đúng) vì môi trường CLI này không có Android/iOS emulator hoặc trình
duyệt để thao tác — không phải do thiếu backend.

**Lý do**: DoD P3 yêu cầu "flow đăng nhập... hoạt động khi backend chạy
local", và backend container (`gymcoach-gateway-dev` + các service) đang
chạy thật trong phiên này (`docker ps` xác nhận). Việc xác minh response
shape qua curl là bước kiểm tra khách quan nhất có thể trong giới hạn
công cụ hiện có.

**Ảnh hưởng / hướng dẫn test lại thủ công**:
1. `pnpm --filter @gym-coach/mobile start` rồi nhấn `w` để mở bản web
   (`react-native-web` đã cài) — dễ test nhất không cần emulator.
2. Hoặc `pnpm --filter @gym-coach/mobile android`/`ios` nếu có
   emulator/simulator cài sẵn.
3. Đăng nhập bằng `john.doe@example.com` / `password123` (tài khoản
   seed có sẵn trong DB dev).
4. Kỳ vọng: vào `/(app)` thấy "Xin chào, John" + email; bấm "Đăng xuất"
   quay lại `/(auth)/login`; tắt app mở lại (hoặc reload) vẫn giữ đăng
   nhập nhờ SecureStore (bootstrap đọc token đã lưu).
5. Test refresh: access token hết hạn sau 15 phút (`JWT_ACCESS_EXPIRY`)
   — để app mở >15 phút rồi gọi 1 API bất kỳ (P5 trở đi) sẽ tự refresh
   qua `POST /auth/refresh`, không văng ra login.
