# Gym Coach — Mobile (Expo)

App mobile (React Native + Expo + TypeScript) cho hệ thống fitness-assistant,
dùng chung backend hiện có qua API Gateway (`backend/gateway`, port 3000).
UI viết mới hoàn toàn cho native, không port từ `frontend/web`.

Xem thêm:
- [API_MAP.md](./API_MAP.md) — khảo sát toàn bộ route gateway + shape response thật
- [DECISIONS.md](./DECISIONS.md) — mọi quyết định tự chọn khi gặp điểm mơ hồ, kèm lý do
- [BLOCKED.md](./BLOCKED.md) — các điểm phụ thuộc backend chưa hỗ trợ

## Cách chạy dev

Yêu cầu: Node ≥20, pnpm ≥8 (repo dùng pnpm workspace), backend chạy qua Docker
(`pnpm docker:up` ở root repo) hoặc trỏ `EXPO_PUBLIC_API_URL` sang backend đã
deploy.

```bash
# từ root repo (cài toàn bộ workspace, bao gồm apps/mobile)
pnpm install

# copy env mẫu, chỉnh nếu backend không chạy ở localhost:3000
cp apps/mobile/.env.example apps/mobile/.env

# chạy dev server
pnpm --filter @gym-coach/mobile start
```

Sau đó:
- Nhấn `w` để mở bản web (dễ test nhất, không cần emulator — dùng
  `react-native-web`). **Lưu ý**: `expo-sqlite` (offline queue, P7) không
  hỗ trợ web, hàng đợi offline sẽ luôn rỗng trên web (`src/offline/db.web.ts`
  tự trả `isOfflineQueueSupported() => false`) — test hàng đợi offline thật
  cần Android/iOS.
- Nhấn `a`/`i` nếu có Android emulator / iOS simulator cài sẵn, hoặc scan QR
  bằng app Expo Go (SDK 57) trên thiết bị thật cùng mạng LAN với máy dev —
  xem mục ["Chạy trên iPhone thật qua LAN"](#chạy-trên-iphone-thật-qua-lan)
  bên dưới.

Tài khoản demo (seed sẵn trong DB dev): `john.doe@example.com` /
`password123`.

```bash
# typecheck + lint (bắt buộc trước khi commit, xem CI/DoD từng phase)
pnpm --filter @gym-coach/mobile typecheck
pnpm --filter @gym-coach/mobile lint

# verify bundle không lỗi (không cần emulator) — cả 2 platform đều dùng được
npx expo export --platform android
npx expo export --platform web
```

## Chạy trên iPhone thật qua LAN

Dùng khi muốn test trên thiết bị thật thay vì web/simulator. App tự phát
hiện IP LAN nếu `.env` để trống `EXPO_PUBLIC_API_URL` (xem
[DECISIONS.md](./DECISIONS.md) mục "LAN — Item 2"), nhưng vẫn cần vài bước
thủ công phía backend + mạng.

### 1. Bật Ollama trên laptop (không dùng RunPod/tunnel nữa)

```bash
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

**Bắt buộc `0.0.0.0`, không phải `127.0.0.1`** — Docker container của
`ai-service` gọi vào qua `host.docker.internal:11434`, nếu Ollama chỉ bind
`127.0.0.1` thì Docker Desktop không reach được (dù `curl localhost:11434`
từ chính laptop vẫn thấy "hoạt động bình thường", đây là điểm dễ nhầm
nhất). Xem chi tiết ở [DECISIONS.md](./DECISIONS.md) mục "LAN — Item 4".

### 2. Xác định đúng IP LAN (không phải IP máy ảo)

```bash
# Windows
ipconfig
# tìm adapter có "Default Gateway" khác trống — đó là mạng thật (WiFi/Ethernet).
# Bỏ qua adapter tên "VMware", "VirtualBox", "vEthernet (WSL)", không có Default
# Gateway (đó là mạng ảo nội bộ, điện thoại không kết nối vào được).

# macOS/Linux
ifconfig
# hoặc: route get default   (macOS)  /  ip route get 1  (Linux)
```

Hoặc chạy `pnpm --filter @gym-coach/mobile start:lan` — script tự in ra IP
LAN đã phát hiện được bằng cùng logic app dùng (`scripts/detect-api-url.js`),
không cần đoán bằng tay.

### 3. Cài Expo Go + quét QR

1. Cài **Expo Go** từ App Store (SDK 57).
2. Đảm bảo iPhone **cùng WiFi** với laptop (không phải 4G/5G, không phải
   WiFi khách bị cô lập thiết bị — 1 số mạng công ty/quán cà phê chặn
   client-to-client, xem mục Fallback bên dưới nếu gặp).
3. Chạy `pnpm --filter @gym-coach/mobile start:lan` (hoặc `start`), mở
   Camera app trên iPhone, quét QR hiện trong terminal.
4. **Fast Refresh hoạt động tự động qua WebSocket** — sửa code trên laptop,
   app trên điện thoại tự cập nhật ngay, không cần build lại hay quét QR lại.

### 4. Fallback khi LAN không kết nối được

```bash
pnpm --filter @gym-coach/mobile start:tunnel
```

Dùng khi: mạng công ty/WiFi khách chặn kết nối client-to-client, firewall
chặn port Metro (8081), hoặc laptop/điện thoại ở 2 mạng con khác nhau.
`--tunnel` định tuyến qua dịch vụ ngrok-like của Expo, chậm hơn LAN trực
tiếp nhưng vượt qua được firewall.

### Troubleshooting

| Triệu chứng | Nguyên nhân thường gặp | Cách sửa |
|---|---|---|
| Quét QR được, app mở nhưng **trắng màn hình / timeout** | Windows Firewall chặn port 8081 (Metro) hoặc 3000 (gateway) trên profile mạng hiện tại | Windows Defender Firewall → Allowed apps → đảm bảo Node.js/Docker Desktop được phép trên profile **Private** (không phải Public) cho cả 2 port. Nếu WiFi hiện đang gắn nhãn "Public network", đổi thành "Private" trong Settings → Network. |
| Lỗi **"Network request failed"** khi đăng nhập/gọi API | `EXPO_PUBLIC_API_URL` (hoặc IP tự detect) không khớp IP hiện tại của laptop — IP đổi mỗi lần đổi mạng WiFi | Chạy lại `pnpm --filter @gym-coach/mobile start:lan` để xem IP mới; nếu `.env` có set cứng `EXPO_PUBLIC_API_URL`, xoá giá trị để dùng auto-detect, hoặc sửa tay theo IP mới. |
| Vẫn "Network request failed" dù IP đúng | iPhone đang dùng 4G/5G thay vì WiFi, hoặc WiFi khách cô lập thiết bị | Kiểm tra iPhone Settings → WiFi đang bật và đúng mạng với laptop; tắt "Low Data Mode"; thử `start:tunnel` nếu mạng khách chặn LAN. |
| App load được nhưng gọi AI Coach / tạo kế hoạch luôn lỗi/timeout | Ollama chưa chạy, hoặc bind `127.0.0.1` thay vì `0.0.0.0` | Xem bước 1 ở trên. Kiểm tra nhanh: `curl http://localhost:3000/plans/llm-health` qua gateway — `llmAvailable:false` kèm lỗi kết nối nghĩa là `ai-service` không reach được Ollama. |
| `start:lan` báo "Không tìm thấy IP LAN nào" | Laptop chỉ có adapter ảo đang active (VPN, VM), WiFi/Ethernet tắt | Bật WiFi/Ethernet thật, tắt VPN tạm thời nếu cần, chạy lại. |
| `expo start` crash ngay với `Error: EACCES: permission denied, lstat '...node_modules\...'` | Windows-only: Metro's file watcher gặp reparse point/junction hỏng trong `node_modules` (thường do Prisma engine cache hoặc pnpm's optional-platform-package stub cho hệ điều hành khác). Đã fix bằng cách thu hẹp `watchFolders` trong `metro.config.js` — nếu vẫn gặp, có thể có junction hỏng khác chưa loại trừ. | Xem toàn bộ quá trình chẩn đoán (3 lần thử) ở [DECISIONS.md](./DECISIONS.md) mục "LAN — Bug thật... Metro watcher crash EACCES". Cách tự chẩn đoán: đọc đường dẫn trong thông báo lỗi, nếu nó nằm ngoài `apps/mobile` hoặc `backend/shared`, thêm điều kiện loại trừ tương tự vào `config.watchFolders`. |

## Cấu trúc

```
apps/mobile/
  app/                    # expo-router — file-based routing
    _layout.tsx           # root: QueryClientProvider, bootstrap auth, notification handler
    index.tsx              # redirect gate: (auth) hoặc (app) tuỳ trạng thái đăng nhập
    (auth)/                # login, register (+OTP)
    (app)/
      _layout.tsx           # auth guard
      profile.tsx           # thông tin user, đổi mục tiêu, logout
      (tabs)/                # tab bar 5 mục
        index.tsx             # Dashboard
        workouts/              # hub, exercises (browse/pick), log, history, [id]
        plans/                  # hub (workout/nutrition plan), decision (chu kỳ AI)
        inbody/                 # hub (list+chart), add
        coach/                  # session list, [sessionId] (chat thread)
    dev/ui.tsx              # demo toàn bộ design system (P2), không nằm trong nav thật
  src/
    ui/                    # design system: theme, Button, Card, Input, Badge,
                             # Screen, Text, Skeleton, EmptyState, ErrorNotice
    api/                   # axios client (refresh-token dedupe), service theo
                             # resource (auth, profile, inbody, workouts, exercises,
                             # trainingCycles, plans, coach), React Query hooks (queries.ts)
    store/                 # zustand: authStore
    features/              # logic + component riêng theo màn hình (dashboard,
                             # workouts, inbody, plans, coach, notifications, profile)
    offline/                # SQLite queue (P7): db.ts, workoutQueue.ts, syncEngine.ts
    notifications/         # expo-notifications: setup, permissions, scheduler, pushToken (TODO)
    config/env.ts           # đọc EXPO_PUBLIC_* — base URL, feature flags
    i18n/strings.ts         # hằng số tiếng Việt (chưa dùng lib i18n đầy đủ)
    lib/                    # date/math/debounce helpers dùng chung
  metro.config.js          # watchFolders trỏ root workspace + resolve symlink pnpm
  app.json                 # tên, slug, scheme, icon, splash, bundle id
  eas.json                 # profile development/preview/production
```

## Feature flags

Đọc từ `.env` (build-time, `EXPO_PUBLIC_*`):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | Để trống = tự phát hiện IP LAN; nếu detect thất bại thì `http://localhost:3000` | Base URL gateway. Điền cứng để ép 1 chế độ cụ thể (VD: `http://localhost:3000` cho web/laptop only). Xem mục ["Chạy trên iPhone thật qua LAN"](#chạy-trên-iphone-thật-qua-lan). |
| `EXPO_PUBLIC_MOCK` | `0` | Đặt `1` để bật lớp mock (**chưa implement** — xem "Còn thiếu" bên dưới) |
| `EXPO_PUBLIC_FEATURE_CYCLES` | bật (mọi giá trị khác `"0"`) | Ẩn/hiện toàn bộ UI liên quan training-cycles (card chu kỳ ở Dashboard, card quyết định 3 nhánh ở Plans, gợi ý đóng chu kỳ ở InBody). Backend hiện ĐÃ có tính năng này (xem `docs/training-cycle-v2.md` ở root repo) nên mặc định bật — tắt bằng `EXPO_PUBLIC_FEATURE_CYCLES=0` nếu test với backend/DB chưa migrate. |

## Build EAS

```bash
npm install -g eas-cli   # hoặc npx eas-cli
eas login                 # cần tài khoản Expo — CHƯA chạy trong lúc build repo này
eas init                  # tạo EAS project thật, ghi projectId vào app.json (extra.eas) — CHƯA chạy
eas build --profile development --platform android   # hoặc ios
eas build --profile preview --platform all
eas build --profile production --platform all
```

**Chưa chạy `eas login`/`eas init`/`eas build` trong lúc build repo này** —
đây là hành động xác thực với tài khoản Expo thật của người dùng, ngoài phạm
vi tự động hoá của agent. `eas.json` đã có sẵn 3 profile; `preview` và
`production` dùng URL API placeholder (`https://*.YOUR_DOMAIN.example`) vì
backend hiện chỉ chạy local qua Docker — **phải sửa thành domain thật khi
backend có URL public**, trước khi build preview/production thật.

## Đã xong (P0–P13)

- P0 API map, P1 scaffold + monorepo, P2 design system, P3 auth (SecureStore +
  refresh dedupe), P4 tab nav, P5 Dashboard, P6 workout log (2-step API,
  stepper UI 1 tay), P7 offline queue (SQLite + NetInfo auto-sync), P8 InBody
  (chart SVG tự vẽ + form + gợi ý đóng chu kỳ), P9 Plans (workout/nutrition +
  quyết định chu kỳ), P10 Coach chat (non-streaming + loading indicator), P11
  local notifications (nhắc buổi tập + InBody), P12 polish (icon/splash,
  haptics, keyboard, error states, đổi mục tiêu), P13 build config này.

## Còn thiếu / phụ thuộc backend chưa có

Tổng hợp từ [BLOCKED.md](./BLOCKED.md) — chi tiết đầy đủ ở đó:

1. **`POST /workouts` không có idempotency key** — hàng đợi offline (P7)
   chống trùng tạm ở client (xoá khỏi queue ngay sau khi POST thành công +
   chặn sync đồng thời), rủi ro trùng thật sự chỉ còn ở 1 khe hẹp (app bị
   kill giữa lúc POST thành công và xoá queue) — chấp nhận được, nhưng cần
   backend thêm field `clientId` để loại bỏ hoàn toàn.
2. **Không có route đăng ký push token** (`backend/services/user-service`'s
   `/notifications` hiện chỉ là inbox trong app, không phải push registry) —
   P11 chỉ implement local notification; server push (FCM/APNs qua Expo Push
   Service) cần backend thêm 1-2 route mới (xem TODO chi tiết trong
   `src/notifications/pushToken.ts`).
3. **`EXPO_PUBLIC_MOCK`** được đọc trong `env.ts` nhưng lớp `apiMockAdapter`
   chưa implement — repo build lúc nào cũng có backend Docker chạy thật trong
   phiên nên không cần đến mock; nếu cần chạy mobile hoàn toàn offline không
   backend, đây là điểm cần bổ sung.
4. **P9's "Xác nhận áp dụng"** cho quyết định ADJUST/NEW_PLAN hiện chỉ ghi
   nhận (approve với `planId` cũ), CHƯA tự động gọi `/plans/workout/generate`
   với tham số từ đề xuất AI rồi approve plan mới — xem DECISIONS.md mục P9.
5. **Chưa test tương tác UI thật** (gõ form, bấm nút, cuộn danh sách) trên
   emulator/thiết bị — môi trường CLI lúc build repo này không có
   Android/iOS emulator hay trình duyệt. Mọi API call đã được verify thật
   bằng curl vào backend dev đang chạy (xem từng mục trong DECISIONS.md); cấu
   trúc code (typecheck/lint/bundle) đã verify sạch ở mọi phase. **Bước tiếp
   theo bắt buộc trước khi coi là "hoàn thành"**: chạy `pnpm --filter
   @gym-coach/mobile start` rồi thao tác thật qua từng luồng (đăng nhập → ghi
   buổi tập → thêm InBody → xem kế hoạch → chat coach → bật thông báo).
6. **App icon/splash là asset tự sinh đơn giản** (hình tròn trắng trên nền
   accent xanh, không phải logo thiết kế thật) — xem DECISIONS.md mục P12.
7. ~~`ErrorNotice` chưa phủ hết toàn bộ màn hình~~ — đã bổ sung thêm vào
   `workouts/[id].tsx`, `workouts/exercises.tsx`, `plans/decision.tsx`,
   `coach/index.tsx`, `coach/[sessionId].tsx` (lịch sử chat) sau lần rà soát
   thứ 2. Vẫn còn vài màn action-only (`inbody/add.tsx`, `GoalEditor.tsx`)
   chưa có, nhưng đó là nơi lỗi hiển thị trực tiếp qua state `error` cục bộ
   khi submit, không phải qua `ErrorNotice` cho 1 query hiển thị danh sách.
