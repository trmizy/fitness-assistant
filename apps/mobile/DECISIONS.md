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

## P6 — Xác minh flow ghi buổi tập bằng curl mô phỏng chính xác request

**Quyết định**: thay vì chỉ tin vào build/typecheck, đã curl mô phỏng
CHÍNH XÁC chuỗi request mà `log.tsx` thực hiện: `POST /workouts` (tạo
workout + WorkoutExercise summary) → 2× `POST /workouts/:id/sets` (per-
set reps/weight/rpe) → `GET /workouts/:id` (đối chiếu response khớp
type `Workout`/`WorkoutExercise`/`WorkoutSet`) → `DELETE /workouts/:id`
dọn dẹp. Toàn bộ chuỗi trả đúng shape, đúng status code (201/200), xác
nhận flow 2 bước (workout summary + set chi tiết) — bắt buộc vì
`WorkoutExercise.sets/reps/weight` chỉ là số tổng hợp, chi tiết từng
set nằm ở bảng `WorkoutSet` riêng, tạo qua endpoint khác.

**Lý do**: đây là API call sequence phức tạp nhất trong app (2 endpoint
phối hợp), rủi ro sai lệch cao nhất nếu chỉ dựa vào đọc code backend.

**Ảnh hưởng / còn thiếu**: vẫn chưa test được thao tác UI thật (nhập
set bằng stepper, thêm/xoá set, chọn bài tập qua danh sách) do không có
emulator/trình duyệt tương tác trong phiên CLI này — xem hướng dẫn test
thủ công ở mục P3 phía trên, áp dụng tương tự cho luồng
Tập luyện → Chọn bài tập → Ghi buổi tập → Lưu.

## P7 — `expo export --platform web` không còn dùng để verify sau khi
thêm `expo-sqlite`

**Quyết định**: chuyển bước bundle-verify (DoD "chạy `npx expo export`
để verify") từ `--platform web` sang `--platform android` kể từ P7 trở
đi.

**Lý do**: `expo-sqlite`'s web implementation (`expo-sqlite/web/worker.ts`)
import trực tiếp 1 file `.wasm` (`wa-sqlite.wasm`) mà Metro's web
bundler không resolve được (`Unable to resolve module` khi chạy
`expo export --platform web`) — đây là giới hạn có thật của chính gói
`expo-sqlite` khi bundle cho web, không phải lỗi code của app. Vì app
này chỉ target Android/iOS thật (web chỉ được dùng làm proxy verify
không cần emulator), việc sửa lỗi bundling web của 1 thư viện native
nằm ngoài phạm vi công việc — chuyển sang verify bằng
`--platform android` (cũng không cần emulator/thiết bị thật, chỉ bundle
JS) là lựa chọn đúng mục đích hơn.

**Ảnh hưởng**: mọi lần chạy DoD "expo export" từ P7 trở đi trong session
này đều dùng `--platform android` thay vì `--platform web`. `/dev/ui`
(P2) và các phase trước đó vẫn bundle OK trên web vì chưa import
`expo-sqlite`.

## P7 — Không có server-side idempotency key cho `POST /workouts`

Xem chi tiết đầy đủ (3 hướng đã thử, đề xuất backend, giải pháp tạm
thời) tại [BLOCKED.md](./BLOCKED.md#p7--post-workouts-không-có-idempotency-key--clientid).

## P9 — "Xác nhận áp dụng" ở màn quyết định chu kỳ chỉ ghi nhận, chưa
tự tạo kế hoạch mới

**Quyết định**: nút "Xác nhận áp dụng" gọi
`POST /training-cycles/:id/approve` với `nextPlanId = cycle.planId`
(kế hoạch hiện tại) cho cả 3 nhánh quyết định (KEEP/ADJUST/NEW_PLAN),
thay vì tự động sinh kế hoạch mới từ `newPlanDraft`/`adjustDetails`
trước khi approve.

**Lý do**: `approve()` phía backend không validate `nextPlanId` phải là
1 plan mới thật (chỉ ghi thẳng vào cột), nên gửi `planId` cũ là an toàn
kỹ thuật. Nhưng đúng ngữ nghĩa đầy đủ của ADJUST/NEW_PLAN phải là: gọi
`POST /plans/workout/generate` với tham số từ `newPlanDraft` (goal,
daysPerWeek, splitSuggestion...), chờ job hoàn tất (polling), rồi mới
approve với plan mới đó. Đây là 1 luồng nhiều bước, phụ thuộc màn "tạo
kế hoạch AI" mà 14-phase spec KHÔNG liệt kê như 1 mục riêng (chỉ có
"xem kế hoạch hiện tại" ở P9) — coi như ngoài phạm vi lần build đầu
tiên này.

**Ảnh hưởng**: "Xác nhận áp dụng" hiện tại có ý nghĩa gần với "đã xem
và ghi nhận đề xuất" hơn là "áp dụng kế hoạch mới thật sự". Việc sinh
kế hoạch mới từ đề xuất AI là điểm mở rộng tự nhiên tiếp theo, cần thêm
1 phase riêng (generate + poll job + auto-approve) nếu muốn hoàn thiện.

## P10 — Coach chat: chỉ dùng `POST /ai/ask` (không streaming), loading
indicator thay cho SSE

**Quyết định**: dùng endpoint non-streaming `POST /ai/ask` với timeout
client 180s + `AbortController` để huỷ, hiển thị bubble "AI đang phân
tích..." trong lúc chờ — KHÔNG implement `POST /ai/ask/stream` (SSE).

**Lý do**: prompt cho phép rõ "streaming nếu API hỗ trợ (nếu không thì
loading indicator)". React Native's `fetch` không hỗ trợ
`ReadableStream`/SSE parsing đồng nhất như trình duyệt — cần polyfill
riêng (`react-native-sse`, hoặc tự parse qua XHR `onprogress`), độ ổn
định phụ thuộc engine JS (Hermes) và version RN, và KHÔNG thể verify
thật trong phiên CLI này vì không có emulator/thiết bị để test luồng
stream trực tiếp. Endpoint non-streaming đã verify thật (xem bên dưới)
và cho trải nghiệm chấp nhận được với loading indicator rõ ràng.

**Ảnh hưởng**: nếu sau này muốn thêm streaming thật, cần: (1) thêm
`react-native-sse` hoặc polyfill fetch-stream, (2) viết lại
`coachApi.ask` thành 1 hook xử lý event `status`/`token`/`done`/`error`
giống `frontend/web`'s `chatStream`, (3) test trên thiết bị thật vì
đây là hành vi network-layer khó verify qua bundle/typecheck.

**Xác minh**: `POST /ai/ask` với đúng payload `coach.ts` gửi (chỉ
`question`, không `sessionId` — luồng "trò chuyện mới") vào backend dev
thật, LLM (`qwen3:30b`) trả lời trong <1s (nhánh fallback vì model
"starting up or overloaded" đúng lúc gọi) — xác nhận response envelope
`{success, data:{conversationId, sessionId, answer, ...}}` khớp chính
xác `AskResponseData`, bất kể model trả lời thật hay fallback.
