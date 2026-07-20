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

> **CẬP NHẬT (LAN config task, item 3)**: quyết định ở trên đã LỖI THỜI
> — đã fix triệt để bằng cách tách `src/offline/db.web.ts` (Metro tự
> chọn file `.web.ts` khi bundle platform web, không bao giờ resolve
> `expo-sqlite` cho web nữa). `npx expo export --platform web` giờ
> CHẠY LẠI ĐƯỢC (đã verify thật, không phải suy đoán) — xem mục "LAN —
> Item 3" bên dưới. Từ giờ có thể verify cả 2 platform
> (`android` + `web`) thay vì chỉ `android`.

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

## P11 — Notification: chỉ local, không có endpoint push-token nào tồn
tại ở backend để implement dù muốn

**Xác nhận**: đọc thẳng `backend/services/user-service/src/routes/notification.routes.ts`
— chỉ có `GET /`, `GET /unread-count`, `PATCH /:id/read`,
`PATCH /read-all` (inbox thông báo TRONG APP), không có route nào để
đăng ký push token. Xác nhận đúng như prompt dự đoán ("CHƯA implement
server push"). TODO đầy đủ (3 việc backend cần làm + cách mobile nối
vào sau này) đã ghi ở `src/notifications/pushToken.ts`.

**Hướng dẫn test thủ công** (không có emulator trong phiên CLI này):
1. `pnpm --filter @gym-coach/mobile android`/`ios` trên simulator/thiết
   bị thật (local notification hoạt động cả trên simulator, không cần
   thiết bị thật như push).
2. Vào `/(app)/profile`, bấm "Đồng bộ nhắc lịch" ở card Thông báo — hệ
   điều hành sẽ hỏi quyền thông báo lần đầu, chấp nhận.
3. Kỳ vọng: text kết quả hiện "Đã đặt N nhắc lịch" nếu có buổi tập theo
   lịch trong 7 ngày tới hoặc có chu kỳ ACTIVE sắp kết thúc trong ≤3
   ngày; ngược lại hiện "Không có lịch nào cần nhắc".
4. Để test nhận thông báo thật nhanh (không đợi đúng ngày/giờ 7h/9h),
   sửa tạm `REMINDER_HOUR`/`INBODY_HOUR` trong `scheduler.ts` thành giờ
   hiện tại +1 phút, hoặc set breakpoint/log ngày trigger để xác nhận
   tính đúng ngày trước khi build thật lâu dài.
5. Kiểm tra danh sách đã đặt bằng `listScheduledReminders()`
   (`Notifications.getAllScheduledNotificationsAsync()`) qua debugger
   nếu cần xác minh không có nhắc lịch bị đặt trùng sau nhiều lần bấm
   "Đồng bộ" (vì luôn cancel-all rồi đặt lại, xem `scheduler.ts`).

## P12 — Icon/splash: asset đơn giản tự sinh (không có công cụ tạo ảnh),
không phải logo thiết kế thật

**Quyết định**: viết 1 script Node dùng `zlib` (built-in, không cài
thêm gói ảnh nào) tự encode PNG thô — icon/splash/adaptive-icon/
favicon đều là 1 hình tròn trắng đơn giản trên nền accent xanh
(`#22c55e`) hoặc nền trong suốt (foreground/monochrome/splash, theo
đúng convention Android adaptive icon: background riêng, foreground
riêng, monochrome đơn sắc cho themed icon Android 13+).

**Lý do**: môi trường CLI này không có công cụ tạo ảnh/thiết kế. Một
hình khối đơn giản đúng màu brand vẫn tốt hơn giữ logo mặc định của
Expo (con chim xanh dương không liên quan gì tới app), và đúng tinh
thần "tạo asset đơn giản đúng brand màu accent" mà prompt cho phép.

**Ảnh hưởng**: đây KHÔNG phải logo thiết kế thật — nên thay bằng asset
thật (icon có chữ/biểu tượng tạ tay, wordmark...) trước khi phát hành
lên store. `app.json` đã trỏ đúng các file này + cấu hình
`expo-splash-screen` plugin (nền `#09090b` khớp `colors.bg` trong
theme, dark-first).

## P12 — Xác minh: các thay đổi khác đã curl-verify lại

`PUT /profile/me` với đúng payload `GoalEditor.tsx` gửi (`{goal}`) vào
backend dev thật — trả `{profile}` khớp chính xác `UpdateProfileInput`/
`UserProfile`. Các phần còn lại của P12 (haptics, KeyboardAvoidingView
gộp vào `Screen.tsx`, `ErrorNotice` cho 1 số màn hình chính) là thay
đổi thuần UI/UX phía client, không có API mới cần verify.

**Phạm vi đã rà loading/error/empty**: Dashboard (2 card), Tập luyện
(hub + lịch sử), InBody (hub), Kế hoạch (hub) — đây là các màn hình có
lưu lượng cao nhất. KHÔNG rà exhaustively toàn bộ 20+ màn hình trong
app (VD: `workouts/[id].tsx`, `plans/decision.tsx` vẫn chỉ có
loading, chưa có `ErrorNotice` retry) do giới hạn thời gian — nhưng
pattern (`ErrorNotice` component dùng chung) đã có sẵn, dễ áp dụng
tiếp cho các màn còn lại.

(Ghi chú: mục "chưa rà hết" ở trên đã được bổ sung thêm ở 1 commit
sau đó — xem lịch sử git, không sửa lại đoạn trên để giữ nguyên bối
cảnh lúc viết.)

## LAN — Item 1: CORS gateway KHÔNG chặn request không có Origin header
(không phải bug cần sửa)

**Xác nhận qua đọc code thật** (`backend/gateway/src/app.ts` dòng 34,
trước khi sửa): `if (!origin || allowedOrigins.includes(origin))` —
request không có Origin header (đúng hành vi của Expo Go/React Native
`fetch`, khác hẳn trình duyệt) đã được cho qua từ trước, không phải lỗi
phổ biến như prompt cảnh báo. Không có gì cần sửa cho việc Expo Go gọi
API qua LAN.

**Vấn đề THẬT tìm thấy khi đọc kỹ**: danh sách origin cho phép là 1
mảng cứng chỉ gồm 3 cổng (`3000`/`5173`/`5678`) + biến env
`CORS_ORIGIN` (đã tồn tại sẵn, KHÔNG phải `CORS_ALLOWED_ORIGINS` như
prompt đoán — dùng đúng tên biến thật). Khi chạy `expo start --web`
(item 3), Expo phục vụ web qua cổng Metro mặc định (`8081`), không nằm
trong danh sách cứng → bị CORS chặn thật khi web-mode gọi gateway.

**Fix**: tạo `backend/gateway/src/utils/corsOrigins.ts` — hàm dùng
chung `isAllowedOrigin(origin)`: cho qua mọi origin dạng
`http://localhost:<bất kỳ port>` / `http://127.0.0.1:<bất kỳ port>`
bằng regex (thay vì liệt kê cứng từng port), cộng thêm origin trong
`CORS_ORIGIN` (giữ nguyên cơ chế cũ), và luôn cho qua khi không có
Origin header. Áp dụng cho cả `app.ts` (Express `cors()`) và
`socket/index.ts` (Socket.IO's `cors.origin` — nhận cùng dạng
callback function) để nhất quán, dù mobile hiện chưa dùng gateway's
Socket.IO (chat AI coach dùng HTTP, chat PT↔client dùng chat-service
port 3005 riêng, không qua gateway).

**Xác minh live**: sau khi sửa, `docker restart gymcoach-gateway-dev`
(bind-mount trên Windows không tự reload file MỚI tạo dù `tsx watch`
đang chạy — file sửa trong file cũ có vẻ vẫn tự reload được nhưng file
mới thì không, restart cho chắc). Test 3 trường hợp qua curl:
`Origin: http://localhost:8081` → `204` + header
`Access-Control-Allow-Origin` đúng (trước đây sẽ bị `500`);
`Origin: http://evil.example.com` → vẫn `500` (đúng, không nới lỏng
bảo mật); không có Origin header → `200` (không đổi, native mobile đã
luôn hoạt động).

**Không sửa**: `backend/services/chat-service` cũng có `CORS_ORIGIN`
tương tự nhưng hard-code `http://localhost:5173` thẳng trong
`docker-compose.dev.yml` (không đọc biến env như gateway) — bất nhất
nhưng KHÔNG ảnh hưởng mobile (mobile chưa dùng chat-service's socket,
xem API_MAP.md §4.6), để nguyên tránh sửa ngoài phạm vi cần thiết.

## LAN — Item 2: tự phát hiện IP LAN — 2 lần thử, lần 1 SAI (đã tự phát
hiện qua verify, không phải đoán)

**`scripts/detect-api-url.js`**: Node thuần (`os.networkInterfaces()`),
loại interface tên chứa `vmware|virtualbox|wsl|vethernet|loopback|hyper-v`
(regex, không phải whitelist tên card WiFi cụ thể — bền hơn qua nhiều
máy khác nhau), ưu tiên dải `192.168.x` rồi `10.x` rồi bất kỳ IPv4
non-internal nào còn lại (Node không expose default-gateway trực tiếp
nên không thể biết chắc 100% "đâu là mạng thật", đây là heuristic tốt
nhất có thể mà không thêm dependency). Test thật trên máy dev: chỉ có
1 candidate (`Wi-Fi: 192.168.1.16`), đúng.

**Lần thử 1 (SAI — tự phát hiện qua verify, đã sửa lại)**: `app.config.ts`
set thẳng `process.env.EXPO_PUBLIC_API_URL = "http://<ip>:3000"` trước
khi return config, kỳ vọng Metro's babel-preset-expo inline giá trị này
vào bundle giống hệt cơ chế đọc từ `.env`. **Verify bằng cách export
bundle thật rồi grep chuỗi IP trong file `.hbc`** — không thấy, bundle
chỉ có `localhost:3000` (giá trị fallback cứng trong `env.ts`). Nghĩa
là Metro chạy bước inline `EXPO_PUBLIC_*` trong 1 worker process khác
với process của Expo CLI đã evaluate `app.config.ts`, nên mutation
`process.env` không có tác dụng — đây LÀ MỘT PHÁT HIỆN THẬT, không
phải giả định, nhờ luôn kiểm tra output thay vì tin logic suông.

**Lần thử 2 (ĐÚNG)**: chuyển sang cơ chế `extra` — `app.config.ts` trả
`{...config, extra: {...config.extra, detectedApiUrl}}`, và
`src/config/env.ts` đọc `Constants.expoConfig?.extra?.detectedApiUrl`
qua `expo-constants` (gói đã cài từ P1) làm fallback thứ 2 (sau
`process.env.EXPO_PUBLIC_API_URL`, trước `"http://localhost:3000"`
cứng). Đây là cơ chế Expo chính thức cho "giá trị tính lúc config-time,
đọc lúc app chạy" — khác hẳn `EXPO_PUBLIC_*` (chỉ dành cho giá trị tĩnh
đọc thẳng từ `.env`, inline bằng babel).

**Verify lần 2**: `npx expo config --type public` (đúng manifest mà
`expo start` phục vụ cho Expo Go quét QR, và cũng là nguồn native build
dùng để sinh config nhúng vào app) — output có đúng
`extra.detectedApiUrl: 'http://192.168.1.16:3000'`. Export bundle
`.hbc` qua `expo export` KHÔNG chứa chuỗi IP (đúng như dự kiến — export
JS-only không sinh native manifest, `Constants.expoConfig` chỉ có đầy
đủ khi chạy qua `expo start`/native build thật, không phải lúc bundle
tĩnh) — không phải dấu hiệu lỗi, chỉ là giới hạn của cách verify này;
xác nhận đúng cơ chế đã đủ qua lệnh `expo config`.

**Chưa verify được**: hành vi runtime thật trên Expo Go (không có
thiết bị/emulator trong phiên CLI) — `Constants.expoConfig.extra.
detectedApiUrl` có thực sự tới được `env.ts` khi app chạy thật trên
điện thoại hay không vẫn là suy luận dựa trên tài liệu chính thức của
`expo-constants` + xác nhận qua `expo config`, chưa phải bằng chứng
runtime 100%. Ghi rõ vào README mục troubleshooting.

## LAN — Item 3: sửa được luôn root cause khiến `expo start --web` hỏng
từ P7 (không chỉ thêm script tiện ích)

**Phát hiện khi làm theo đúng chỉ dẫn "kiểm tra `src/offline/db.ts` đã
guard đúng chưa"**: `getDb()`/các hàm trong `workoutQueue.ts` ĐÃ guard
đúng ở LOGIC runtime (mọi hàm check `isOfflineQueueSupported()` trước
khi gọi `getDb()`), nhưng đó không phải nguyên nhân `expo-sqlite` làm
hỏng bundle web — nguyên nhân là **Metro phải resolve tĩnh mọi import ở
đầu file** (`import * as SQLite from "expo-sqlite"` trong `db.ts`) bất
kể logic runtime có gọi tới hay không. Guard bằng `if` bên trong hàm
KHÔNG giúp được gì ở bước bundle.

**Fix thật (không phải chỉ thêm early-return như prompt gợi ý — early-
return không đủ)**: tạo `src/offline/db.web.ts` — quy ước
platform-extension chuẩn của Metro (`.web.ts` tự được chọn khi bundle
platform web, hoàn toàn không cần cấu hình gì thêm), export cùng chữ
ký hàm (`isOfflineQueueSupported() => false`,
`getDb() => throw`) nhưng KHÔNG import `expo-sqlite` — nên Metro không
bao giờ đưa `expo-sqlite` vào bundle graph khi build cho web nữa.

**Verify thật**: `npx expo export --platform web` chạy THÀNH CÔNG lần
đầu tiên kể từ khi thêm `expo-sqlite` ở P7 (trước đây lỗi
`Unable to resolve module` ngay lập tức) — không phải suy đoán, đã
chạy lệnh thật và xem output. Do đó cập nhật lại quyết định P7 ở trên
(đánh dấu lỗi thời) — từ giờ `expo export` verify được cả `--platform
android` lẫn `--platform web`.

**Scripts thêm vào `package.json`**: `start:lan` (chạy
`scripts/start-lan.js` — in IP LAN + nhắc nhở rồi spawn `expo start`
kế thừa stdio để CLI tương tác của Expo vẫn hoạt động bình thường,
không dùng `npx expo start` trực tiếp trong `package.json` script vì
cần in thêm dòng nhắc trước), `start:tunnel` (`expo start --tunnel`),
`start:web` (giống hệt script `web` đã có sẵn từ P1 — giữ cả 2 tên vì
không có lý do xoá script cũ, tránh phá quy ước gọi lệnh đã quen).

## LAN — Item 4: đúng tên biến `LLM_BASE_URL` (không phải
`OLLAMA_BASE_URL`/`OLLAMA_HOST`/`OLLAMA_URL` như prompt đoán) + đổi port
11435 → 11434

**Xác nhận qua đọc code thật** (`backend/services/ai-service/src/services/llm.service.ts`
dòng 7): `const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434"`.
Có thêm `OLLAMA_BASE_URL` set song song trong `docker-compose.dev.yml`
(cùng giá trị) — không phải tên chính, có vẻ để dự phòng/tương thích
cho code khác, KHÔNG phải biến chính `llm.service.ts` đọc.

**Phát hiện quan trọng khi đọc `docker-compose.dev.yml` (dòng
251-257 và 331-336, cả `ai-service` và `knowledge-worker`)**: giá trị
mặc định trước đó là `http://host.docker.internal:11435` (port
**11435**, không phải 11434 chuẩn của Ollama) — đây chính là port SSH
tunnel Windows tới RunPod đã dùng suốt phiên trước (khớp với
`docs`/comment cũ "RunPod remote Ollama is reached only through a
Windows SSH tunnel"). Đổi hẳn sang **11434** (port mặc định thật của
`ollama serve`) ở cả 2 nơi: root `.env.example` và cả 2 block trong
`docker-compose.dev.yml` (`ai-service` + `knowledge-worker`, dùng
chung endpoint).

**`extra_hosts: ["host.docker.internal:host-gateway"]` ĐÃ CÓ SẴN** cho
cả 2 service từ trước (dòng 306-311 và 361-362, kèm comment giải thích
lý do cần — DNS override `8.8.8.8` ở service làm hỏng auto-inject
`host.docker.internal` mặc định của Docker Desktop) — không phải thêm
mới như prompt gợi ý, chỉ cập nhật lại comment (bỏ nhắc "RunPod SSH
tunnel", thay bằng "Ollama chạy trên Windows host laptop").

**Verify live** (không chỉ đọc code, đã restart thật):
`docker compose up -d --no-deps ai-service` rồi gọi
`GET /plans/llm-health` qua gateway — `llmUrl` đổi đúng thành
`http://host.docker.internal:11434` (trước đó `:11435`), và quan trọng
hơn: response đổi từ lỗi kết nối chung chung (`"error":"Error"`, port
11435 không có gì lắng nghe) sang lỗi CỤ THỂ
`"Missing model(s): qwen3:30b-a3b-instruct-2507-q4_K_M"` — nghĩa là
ai-service ĐÃ kết nối thành công tới 1 Ollama instance thật ở
`host.docker.internal:11434` (Docker-local `gymcoach-ollama` container
đang publish cổng 11434 ra host trong phiên hiện tại — không có model
`qwen3:30b` nên báo thiếu model, không phải lỗi mạng). Điều này chứng
minh đường mạng container→host qua `host.docker.internal:11434` hoạt
động đúng; khi user chạy `ollama serve` thật trên laptop (theo hướng
dẫn README) sẽ thay thế đúng vị trí này.

**Không sửa**: root `.env.example` cũng có `LLM_API_KEY`, `LLM_NUM_CTX`,
`LLM_JSON_NUM_CTX` không liên quan tới thay đổi này, giữ nguyên.

## LAN — Bug thật phát sinh khi user tự chạy `start:lan`: Metro watcher
crash EACCES (3 lần thử, 2 lần đầu SAI — phát hiện bằng cách chạy thật,
không phải đọc code suông)

**Báo lỗi từ user** khi chạy `pnpm --filter @gym-coach/mobile start:lan`
thật lần đầu:
```
Error: EACCES: permission denied, lstat
'...\backend\services\auth-service\node_modules\.ignored_prisma'
    at FallbackWatcher.emitError ...
```

**Nguyên nhân gốc**: `metro.config.js` (viết từ P1) set
`config.watchFolders = [workspaceRoot]` — Metro's file watcher (crawl
bằng `FallbackWatcher`, dùng khi không có Watchman — mặc định trên
Windows vì Watchman không hỗ trợ tốt) đi bộ đệ quy TOÀN BỘ repo, bao
gồm `node_modules` của từng backend service. `.ignored_prisma` là 1
**ReparsePoint** (junction Windows, xác nhận bằng
`Get-Item -Force ... | Select Attributes` — không phải đoán) — khả năng
cao do Prisma engine cache hoặc artifact từ Docker bind-mount tạo ra,
`fs.lstat` không đọc được → crash toàn bộ dev server.

**Vì sao không phát hiện được trong suốt quá trình build (P0-P13 +
CORS/IP/scripts/Ollama)**: mọi lần verify trước giờ đều dùng
`npx expo export` (build 1 lần rồi thoát) — KHÔNG bao giờ khởi động
watcher thật sự lâu dài. `expo start` (dev server, cách user thực sự
dùng) mới kích hoạt code path này. Đây là lỗ hổng thật trong cách
verify suốt session — ghi nhận rõ, không né tránh.

**Lần thử 1 (SAI — verify bằng cách chạy `expo start` thật, không phải
đọc code rồi tự tin)**: dùng `resolver.blockList` (regex loại
`backend/services/*/node_modules`, `backend/gateway/node_modules`,
`frontend/*/node_modules`) trong khi vẫn giữ
`watchFolders=[workspaceRoot]`. Đọc `metro/src/node-haste/DependencyGraph/createFileMap.js`
xác nhận `blockList` được truyền vào làm `ignorePattern` của
metro-file-map — TƯỞNG là đủ. Chạy `expo start` thật (background,
theo dõi 20-30s) → **vẫn crash y hệt**. Lý do (đọc lại code kỹ hơn):
`ignorePattern` chỉ lọc KẾT QUẢ sau khi Walker đã `lstat` toàn bộ file
trong quá trình đi bộ — không ngăn được việc `lstat` chính file gây
lỗi trong lúc đi bộ.

**Lần thử 2 (SAI — cũng verify bằng cách chạy thật, phát hiện lỗi khác)**:
thu hẹp `watchFolders` còn
`[projectRoot, workspaceRoot/node_modules, backend/shared]` (bỏ hẳn
`backend/services/*`, giữ lại root `node_modules` để đảm bảo resolve
được dep hoisted của pnpm). Chạy `expo start` thật → **crash khác**,
lần này ở `node_modules/.pnpm/lightningcss@1.30.1/node_modules/lightningcss-freebsd-x64`
— stub package cho optional dependency của platform khác (FreeBSD),
pnpm trên Windows để lại reparse point hỏng cho những package
platform-specific không áp dụng được. Kết luận: root `node_modules`
(`.pnpm` store) cũng rải rác đầy loại lỗi này, không chỉ ở
`backend/services/*` — không có cách nào liệt kê hết bằng blockList.

**Lần thử 3 (ĐÚNG — verify đầy đủ nhất, không chỉ "không crash" mà còn
xác nhận resolve đúng)**: `watchFolders = [projectRoot, backend/shared]`
— bỏ HẲN root `node_modules` khỏi watch. Dựa trên hiểu biết: resolve
module (tìm file lúc bundle) và watch file (theo dõi đổi để hot-reload)
là 2 cơ chế khác nhau trong Metro — `resolver.nodeModulesPaths` +
`unstable_enableSymlinks` (đã có sẵn từ P1) đủ để Metro TỰ resolve qua
symlink pnpm tạo sẵn trong `apps/mobile/node_modules`, không cần thư
mục đích nằm trong `watchFolders`.

Verify đầy đủ (không chỉ "chạy không crash" mà xác nhận cả resolve
đúng):
1. `expo start --port 8084` chạy nền, đợi 30s → **không crash**, log
   hiện `Waiting on http://localhost:8084`, `netstat` xác nhận cổng
   đang LISTENING thật.
2. `curl http://localhost:8084/` → trả về đúng HTML app thật (title
   "Gym Coach").
3. `curl` thẳng vào URL bundle thật lấy từ HTML
   (`/apps/mobile/node_modules/expo-router/entry.bundle?platform=web...`)
   → **200, 9.7MB**, không phải lỗi resolve.
4. Grep nội dung bundle: chứa chuỗi `"pino"` — `pino` là dependency
   THẬT của `@gym-coach/shared` (không phải dep trực tiếp của mobile) —
   xác nhận chuỗi resolve xuyên qua workspace package (mobile →
   `@gym-coach/shared` → `pino`) hoạt động đúng dù `backend/shared`'s
   own `node_modules` và root `node_modules` đều không nằm trong
   `watchFolders`.
5. Sau đó chạy lại `npx expo export --platform android` +
   `--platform web` (static export) — vẫn pass như trước, không có gì
   đổi ở đường này (export không dùng watcher).

**Bài học rút ra** (áp dụng ngược cho các lần verify trước đó trong
session): với watcher/dev-server, "code đọc có vẻ đúng" và thậm chí
"resolver.blockList về mặt tài liệu có nghĩa đúng" KHÔNG đủ — phải
chạy `expo start` thật, đợi qua giai đoạn crawl (không chỉ vài giây
đầu), và thử tải bundle thật để xác nhận resolve, mới coi là verify
xong. `npx expo export` không thay thế được việc này cho phần liên
quan tới watcher.

## EAS init chạy nhầm thư mục — user tự chạy `eas login`/`eas init`/
`eas build` (đúng theo README hướng dẫn, nhưng README lúc đó chưa cảnh
báo rõ phải đứng đúng thư mục)

**Sự việc**: user chạy `npx eas-cli init` và `npx eas-cli build` từ
**thư mục gốc repo** (`C:\D_Backup\project_personal\fitness-assistant`)
thay vì `apps/mobile`. EAS CLI không tìm thấy project Expo hợp lệ ở
gốc repo nên tự tạo mới `app.json` (`{"expo":{"extra":{"eas":{"projectId":...}}}}`)
và `eas.json` (bản mặc định, không có 3 profile với `env` như file
thật của mobile) NGAY TẠI gốc repo — hoàn toàn tách biệt khỏi
`apps/mobile/app.json`/`apps/mobile/eas.json` đã build từ P13.

**Điều QUAN TRỌNG**: project EAS thật `@trmizy/ai-gym-coach`
(ID `135dafba-2dbc-45c1-a4e5-a54a43c79170`) **đã được tạo thật trên
tài khoản Expo của user** — đây là tài nguyên cloud thật, không xoá.
Chỉ cần gắn đúng `projectId` vào file cấu hình đúng chỗ.

**Fix**: 
1. Thêm `expo.owner: "trmizy"` + `expo.extra.eas.projectId` (giữ nguyên
   ID đã tạo) vào `apps/mobile/app.json` — merge, không tạo file mới
   (đã có `extra.detectedApiUrl` từ trước, `app.config.ts`'s
   `{...finalConfig.extra, detectedApiUrl}` tự gộp đúng cả 2, verify
   qua `expo config` thấy cả `eas.projectId` lẫn `detectedApiUrl` cùng
   lúc).
2. Xoá 2 file rác `app.json`/`eas.json` ở gốc repo (`git status` xác
   nhận chưa từng commit — an toàn xoá thẳng, không phải revert).
3. Cập nhật README: thêm cảnh báo rõ **"luôn chạy lệnh eas từ trong
   apps/mobile"** ở đầu mục Build EAS, tránh lặp lại sự cố.

**Không cần**: chạy lại `eas init` (đã dùng project thật, chạy lại chỉ
tạo thêm project trùng lặp trên tài khoản Expo) — chỉ cần `eas build`
từ đúng thư mục `apps/mobile` là dùng được `projectId` đã gắn sẵn.

## EAS build lần đầu báo lệch `slug` — đổi slug cho khớp project đã tạo,
không tạo project mới

**Lỗi thật từ user** khi chạy `eas build --profile development --platform ios`
(đã đứng đúng thư mục `apps/mobile` lần này):
```
Project config: Slug for project identified by "extra.eas.projectId"
(ai-gym-coach) does not match the "slug" field (gym-coach-mobile).
```

**Nguyên nhân**: project EAS tạo lúc `eas init` chạy nhầm ở gốc repo
(xem mục trên) được đặt tên `ai-gym-coach` (lấy theo `name` trong
`package.json` gốc repo lúc đó). `apps/mobile/app.json` lại có
`slug: "gym-coach-mobile"` — EAS yêu cầu 2 giá trị này khớp nhau để
xác nhận đúng project.

**Fix**: đổi `slug` trong `apps/mobile/app.json` thành `"ai-gym-coach"`
(khớp project đã tồn tại) thay vì tạo project EAS mới — tránh có 2
project trùng lặp trên tài khoản Expo của user. `name` (hiển thị,
"Gym Coach") không đổi, chỉ `slug` (định danh kỹ thuật) đổi.

**Phụ**: lệnh `eas build` tự cài `expo-dev-client` (bắt buộc cho
development build) — đã accept, thêm vào `package.json`/`pnpm-lock.yaml`,
verify lại typecheck/lint/export sau khi có thêm dependency này, không
phát sinh vấn đề gì.

## Hạ SDK 57 → 54 để tương thích Expo Go public trên App Store

**Bối cảnh**: Expo Go bản public trên App Store (iOS) chỉ hỗ trợ SDK 54
tại thời điểm này — SDK 55 vẫn đang chờ Apple duyệt (xác nhận qua
[changelog chính thức của Expo](https://expo.dev/changelog/expo-go-and-app-store-may-2026),
không phải đoán), SDK 57 (project đang dùng) còn xa hơn nữa. Trên iOS,
Apple chỉ cho cài đúng 1 bản Expo Go mới nhất từ App Store — không có
cách nào "cài bản cũ hơn" như Android — nên project BẮT BUỘC phải chạy
đúng SDK mà Expo Go public hỗ trợ, không có lựa chọn nào khác ngoài hạ
SDK hoặc trả phí Apple Developer Program cho development build.

**Quy trình hạ cấp** (theo đúng flow chính thức của Expo cho việc đổi
SDK, dùng để NÂNG cấp bình thường nhưng áp dụng ngược để hạ):
```bash
npx expo install expo@54.0.36   # version chính xác lấy từ `npm view expo dist-tags` (sdk-54 tag)
npx expo install --fix           # tự động hạ cấp ~20 gói expo-*/react-native/react/typescript kèm theo
```
Toàn bộ `expo-router` (57.0.7→6.0.24), `react-native` (0.86.0→0.81.5),
`react` (19.2.3→19.1.0), `typescript` (6.0.3→5.9.3),
`eslint-config-expo` (57.0.0→10.0.0) và ~15 gói `expo-*` khác đều đổi
version theo — đây là hệ quả bình thường của việc SDK number không map
1:1 với version riêng của từng gói con.

**Lỗi phát sinh #1 — `expo-status-bar` không còn config plugin**:
`expo-status-bar@3.0.9` (bản SDK 54) không có `app.plugin.js` — khác
với bản SDK 57 vốn có. Xoá `"expo-status-bar"` khỏi mảng `plugins`
trong `app.json` (chỉ đăng ký config plugin cho package nào THẬT SỰ có
plugin — status bar component tự hoạt động không cần config plugin).

**Lỗi phát sinh #2 — sau khi hạ SDK, `expo export`/`expo start` lỗi
"Unable to resolve module .../expo-router/entry.js"**: đây là hệ quả
gián tiếp của cách `metro.config.js` đang cấu hình (`watchFolders`
thu hẹp còn `[projectRoot, backend/shared]`, xem mục "LAN — Bug thật
... EACCES" phía trên). Search thấy đây là
[lỗi đã biết](https://github.com/expo/router/issues/748) khi
expo-router + pnpm monorepo không khớp với cách Metro tự động phát
hiện monorepo (từ SDK 52, `expo/metro-config` tự đọc
`pnpm-workspace.yaml` và set `watchFolders` = MỌI package trong
workspace + root `node_modules`; `@expo/cli`'s logic resolve
`main: "expo-router/entry"` phụ thuộc vào việc `watchFolders` khớp
đúng với cấu trúc monorepo mà nó tự phát hiện — thu hẹp thủ công làm
lệch giả định này). Fix: bỏ hẳn việc override `watchFolders` thủ công,
để `getDefaultConfig()` tự set (xác nhận qua
`node -e "console.log(getDefaultConfig(__dirname).watchFolders)"` —
list ra đúng từng package + root `node_modules`).

**Lỗi phát sinh #3 — quay lại EACCES watcher crash (khác lần trước)**:
việc khôi phục `watchFolders` đầy đủ làm quay lại watcher crash gốc,
nhưng lần này crash ở FILE KHÁC (`lightningcss-darwin-x64` trong ROOT
`node_modules/.pnpm`, không phải `backend/services/*`). Áp dụng lại
`resolver.blockList` cho `backend/services/*` (dùng lại pattern cũ) +
thêm pattern mới cho package platform-specific — **nhưng blockList
KHÔNG fix được lỗi này** (xem giải thích đầy đủ trong
`metro.config.js`'s comment): `filterDir` chỉ ngăn RECURSE vào thư mục
bị match, không ngăn được `lstat` chạy trên từng entry khi liệt kê nội
dung của thư mục CHA chưa bị block — mà đúng entry gây crash
(`lightningcss-darwin-x64`) là con trực tiếp của
`.pnpm/lightningcss@.../node_modules/` (thư mục cha không, và không
nên, bị block).

**Nguyên nhân gốc thật sự**: quét bằng PowerShell
(`Get-ChildItem -Recurse -Attributes ReparsePoint`) tìm thấy **102 reparse
point hỏng** rải khắp `node_modules/.pnpm` — toàn bộ là stub package
platform-specific (esbuild, rollup, lightningcss, @tailwindcss/oxide,
msgpackr-extract, fsevents...) mà pnpm để lại cho các OS/arch KHÁC
Windows thay vì bỏ qua hẳn. `Directory.Delete()`/`rmdir` chuẩn không
xoá được (báo lỗi "the directory name is invalid" — xác nhận đây là
reparse point hỏng thật ở tầng filesystem). Fix: dùng
`fsutil reparsepoint delete <path>` để gỡ tag reparse point trước, rồi
`Remove-Item -Force -Recurse` — xoá thành công cả 102/102. Sau khi xoá,
`expo start` chạy ổn định, `expo export` cả 2 platform pass.

**Đã thử nhưng KHÔNG dùng** (`pnpm.supportedArchitectures` trong
`package.json`, để pnpm chỉ cài đúng platform hiện tại, tránh lặp lại
sự cố sau lần `pnpm install` sau): pnpm 8.15.0 báo
`"pnpm" field in package.json is no longer read by pnpm` — không tìm
được vị trí cấu hình đúng cho version pnpm này trong thời gian hợp lý,
bỏ qua vì không phải blocker cho việc chính (Expo Go tương thích) —
**nếu lỗi EACCES tái diễn sau 1 lần `pnpm install` trong tương lai**,
lặp lại đúng quy trình `fsutil reparsepoint delete` + `Remove-Item` ở
trên (script PowerShell đầy đủ nằm trong lịch sử conversation, có thể
yêu cầu Claude Code viết lại).

**Verify cuối**: `expo start` chạy thật (không chỉ export tĩnh), fetch
manifest thật (`curl http://localhost:8087/`) xác nhận
`"runtimeVersion":"exposdk:54.0.0"` (đúng SDK Expo Go public hỗ trợ) +
`launchAsset.url` trỏ đúng bundle thật; fetch thẳng bundle đó trả về
200/9.8MB — không phải suy đoán, đã tải thật bundle Hermes bytecode
qua HTTP từ dev server đang chạy. `typecheck`/`lint`/`expo export` cả
2 platform đều pass sau toàn bộ quá trình.
