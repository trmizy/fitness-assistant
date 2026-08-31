# Ứng dụng di động (Capacitor) — tài liệu bàn giao

Tài liệu cho phần vỏ Android chạy bằng Capacitor bọc `frontend/web`. Ghi lại **quy tắc**
và **lý do**, không chỉ mô tả code — để lần sau sửa không vô tình phá lại.

> **Trạng thái:** Phần 1 (khôi phục phiên), Phần 3.1 (bỏ điều hướng nạp lại trang) và
> Phần 4 (thanh toán qua trình duyệt hệ thống) đã xong. Nghiệm thu trên máy ảo Android
> thật (Pixel_10_Pro_XL): Phần 1 **11/11**, Phần 3.1 **5/5**, Phần 4 **8/8 trên Android +
> 3/3 trên web**. Mốc đo thời gian chuyển trang sau 3.1: **trung vị 137 ms** (min 64,
> max 546) — đã dưới ngưỡng 250 ms trước cả khi động vào hiệu ứng.
> Phần 2 (nút Back) đã xong: **8/8** cho khách hàng, cộng kiểm thử riêng cho quản trị
> viên, chủ phòng tập và hộp thoại. Phần 3.2 + 3.3 (hiệu ứng, trạng thái chờ) đã xong:
> **7/7 trên máy ảo** + phép thử trễ mạng cho phần giữ dữ liệu cũ. Thời gian chuyển trang
> giảm từ **trung vị 137 ms → 97 ms**. **Toàn bộ 4 phần đã hoàn thành.**

## Cách kiểm thử trên Android (dùng lại được)

Vì các lỗi này chỉ lộ trong WebView, mọi thay đổi phải nghiệm thu trên Android, không chỉ
trên trình duyệt.

```bash
# 1. Trỏ app về máy chủ chạy trên host — 10.0.2.2 là alias localhost cho máy ảo.
#    Dùng .env.capacitor.local (đã gitignore) để không đụng .env.capacitor của LAN thật.
cat > frontend/web/.env.capacitor.local <<'EOF'
VITE_API_URL=http://10.0.2.2:3000
VITE_SOCKET_URL=http://10.0.2.2:3000
VITE_CHAT_WS_URL=http://10.0.2.2:3005
EOF

# 2. Build + cài (cần JDK 21, và `cap` phải gọi qua node_modules/.bin — npx không chạy được)
cd frontend/web && npx vite build --mode capacitor && ./node_modules/.bin/cap sync android
cd android && JAVA_HOME=<jdk-21> ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**Điều khiển và quan sát WebView** (bản debug đã bật devtools):

```bash
adb shell cat /proc/net/unix | grep webview_devtools_remote   # lấy tên socket (đổi theo PID)
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
# rồi Playwright: chromium.connectOverCDP("http://127.0.0.1:9222")
```

### Cài thêm thư viện? Nhớ cả container dev

`gymcoach-web-dev` có `node_modules` **riêng, nằm trong image** — cài trên host bằng
`pnpm add` là chưa đủ, dev server trong container sẽ trả **500** cho module vừa import.
Sau khi cài trên host:

```bash
docker cp frontend/web/package.json gymcoach-web-dev:/app/frontend/web/package.json
docker exec gymcoach-web-dev sh -c "cd /app && pnpm install --no-frozen-lockfile"
docker restart gymcoach-web-dev
```

Cùng loại bẫy đã gặp với `backend/shared` (dist đóng cứng trong image) và `user-service`
(package.json cũ trong image) — **không có gì ngoài `src/` được bind-mount**.

### Hai cái bẫy khi kiểm thử, đã mất thời gian vì chúng

1. **Trên Android, `@capacitor/preferences` KHÔNG dùng `localStorage`.** Nó ghi vào
   SharedPreferences: `/data/data/<pkg>/shared_prefs/CapacitorStorage.xml`. Đọc
   `localStorage` trên thiết bị luôn ra rỗng — chỉ bản chạy web mới dùng localStorage kèm
   tiền tố `CapacitorStorage.`.
2. **Sửa file XML đó từ ngoài trong khi app đang chạy là vô hình với app.** Android giữ
   SharedPreferences trong bộ nhớ; ghi đè file không làm app thấy. Muốn đổi giá trị cho app
   thấy thật thì gọi qua chính plugin trong WebView:
   `window.Capacitor.Plugins.Preferences.set({ key, value })`. Ghi file trực tiếp chỉ dùng
   được khi app **đã tắt hẳn**.

---

## 1. Luồng khôi phục phiên đăng nhập

**File:** `src/app/services/session.ts`, `src/app/services/token.ts`, gắn vào
`src/app/context/AppContext.tsx`.

### Vì sao phải có

Trước đây bước khởi động chỉ đọc `accessToken` và `user`, **không hề đụng tới
`refreshToken`**. Access token vốn ngắn hạn, nên sau khi đóng app một lúc thì lần mở
sau nó luôn quá hạn — app vẫn hiện như đã đăng nhập, request đầu tiên trả 401, rồi
người dùng bị đá ra màn hình đăng nhập. Trong khi đó `refreshToken` vẫn nằm trong bộ
nhớ, vẫn còn hiệu lực, **chưa từng được hỏi tới**.

**Quy tắc mới:** `refreshToken` quyết định "có phiên hay không"; `accessToken` chỉ
quyết định "có cần làm mới trước khi gọi request đầu tiên hay không".

### Lúc khởi động — `bootstrapSession()`

Chạy **trước** khi router vẽ bất cứ màn hình nào. Trong lúc chờ chỉ hiện màn hình khởi
động, tuyệt đối không vẽ màn hình đăng nhập rồi nhảy sang bảng điều khiển.

```
Khởi động app
  ↓
Đọc accessToken + refreshToken
  ↓
Không có refreshToken ─────────────────────────────→ xoá phiên → ĐĂNG NHẬP
  ↓
Có refreshToken
  ↓
accessToken còn hạn (> 60 giây)?
  ├─ CÒN ─────────────────────────┐
  └─ HẾT / hỏng / không đọc được  │
        ↓                          │
     POST /auth/refresh            │
        ├─ server từ chối (4xx) → xoá phiên → ĐĂNG NHẬP
        ├─ không gọi được (mạng/5xx) → GIỮ phiên, vào app bằng user đã lưu
        └─ thành công → lưu token mới ─┤
                                       ↓
                            POST /auth/verify
                                       ↓
                      ┌────────────────┼─────────────────┐
                   200 OK          401/403          lỗi khác
                      ↓                ↓                ↓
                 lưu user mới     xoá phiên      GIỮ phiên, dùng
                   → VÀO APP      → ĐĂNG NHẬP    user đã lưu → VÀO APP
```

**Vì sao dùng `/auth/verify` chứ không phải `/profile/me`:** `/profile/me` trả về
`UserProfile`, có `isPT` nhưng **không có `role`**. `AppContext` suy ra toàn bộ vai trò
từ `user.role`, nên nếu khôi phục bằng `/profile/me` thì mọi tài khoản ADMIN và
GYM_OWNER sẽ âm thầm bị hạ xuống thành khách hàng sau mỗi lần mở lại app.
`/auth/verify` trả đúng bản ghi tài khoản (`id`, `email`, `firstName`, `lastName`,
`role`, `isActive`).

### Điểm hạ cánh sau khi khôi phục — quan trọng không kém

Khôi phục được phiên vẫn **chưa đủ**. WebView của Capacitor **luôn khởi động ở `/`**, và
route `/` trước đây là `<Navigate to="/login" replace />` cứng. Nghĩa là mỗi lần mở app
đều bị đẩy sang màn hình đăng nhập bất kể phiên còn tốt đến đâu — mà `LoginPage` thì chỉ
điều hướng đi **sau khi bấm đăng nhập thủ công thành công**, nên người dùng ngồi lại đó và
phải gõ mật khẩu. Trên web hiếm gặp vì người ta mở URL cụ thể; trên app thì lần nào cũng dính.

Vì vậy có **một bảng đích duy nhất** (`src/app/config/landing.ts`) dùng chung cho cả ba nơi:

| Vai trò | Màn hình chính |
|---|---|
| Khách hàng | `/client/dashboard` |
| PT | `/pt/dashboard` |
| Chủ phòng tập | `/gym-owner/dashboard` |
| Quản trị viên | `/admin/dashboard` |

- `RootRedirect` (route `/`) — đã đăng nhập thì vào thẳng màn hình chính, chưa thì `/login`
- `LoginPage` — tự chuyển vào app nếu vào trang này khi phiên vẫn còn
- Form đăng nhập — dùng chung bảng này thay vì tự viết lại chuỗi if/else

### Lúc quay lại từ nền — `ensureFreshAccessToken()`

Nghe `appStateChange` của `@capacitor/app`. Khi app active trở lại và access token sắp
hết hạn thì làm mới ngay, không đợi request đầu tiên thất bại.

### Nguyên tắc: mất mạng ≠ mất phiên

`refreshAccessToken` phân biệt rõ hai tình huống, thay vì gộp cả hai thành `null` như
trước:

| Tình huống | Kết quả | Hành động |
|---|---|---|
| Server trả 4xx — token bị thu hồi/hết hạn | `null` | Xoá phiên, ra đăng nhập |
| Không gọi được / server 5xx | ném `RefreshUnavailableError` | **Giữ nguyên phiên** |

Gộp hai cái này chính là lý do khiến mạng chập chờn cũng đăng xuất người dùng.

### Kiểm tra token sắp hết hạn

`isAccessTokenExpiringSoon()` giải mã phần payload của JWT lấy `exp`, coi là hết hạn nếu
còn **dưới 60 giây**. Mọi trường hợp bất thường (không đọc được, thiếu `exp`, sai định
dạng) đều coi như hết hạn và đi đường làm mới — không bao giờ đoán rằng token còn tốt.

Các hàm này **không xác minh chữ ký** và không cần: đó là việc của server. Phía client
chỉ trả lời câu hỏi "có nên gửi token này đi không", một câu hỏi về thời điểm, không
phải về bảo mật.

---

## 2. Quy tắc: mọi request đi qua một client dùng chung

**Mọi request cần xác thực đều phải đi qua `api` trong `src/app/services/api.ts`.**

Chỉ riêng instance đó mới:
1. Gắn `Authorization` từ `@capacitor/preferences` (đọc bất đồng bộ — không thể làm
   trong code đồng bộ)
2. Tự làm mới token khi gặp 401 rồi thử lại request đúng một lần
3. Xếp hàng các lời gọi đồng thời sau **một** lần làm mới duy nhất (`makeRefreshOnce`)

Gọi `axios` trực tiếp kèm token tự đọc sẽ mất cả ba, và **chết ngay khi access token hết
hạn**. Đây từng là nguyên nhân khiến `UserManagement.tsx` (và trước đó là
`AdminDashboard.tsx`, `AdminWorkflowStudio.tsx`) rơi vào trạng thái "không tải được"
vĩnh viễn.

### Điều kiện kích hoạt làm mới

**Bất kỳ 401 nào** từ endpoint không thuộc nhóm xác thực đều đáng thử làm mới một lần.
Trước đây còn đòi mã lỗi phải là `UNAUTHORIZED` hoặc thông báo khớp
`/token|unauthorized/i` — nghĩa là chỉ cần một service diễn đạt lỗi 401 khác đi là toàn
bộ cơ chế làm mới tắt ngóm. Số lần thử lại đã được chặn bằng cờ `_retry`.

`/auth/logout` **cố ý** nằm trong nhóm loại trừ: nó được gọi với phiên đã chết sẵn, không
được phép kích hoạt vòng lặp làm mới.

### Ngoại lệ có kiểm soát

- **Luồng khôi phục phiên** truyền cờ `_skipAuthRedirect`. Interceptor vẫn thử làm mới,
  nhưng không tự chuyển trang khi thất bại — `bootstrapSession` tự quyết định hiển thị
  màn hình đăng nhập, **không nạp lại app**.
- **Socket.IO** (`realtime/socketClient.ts`, `services/socket.ts`) đọc token trực tiếp vì
  nó không đi qua axios. Xem mục Hạn chế.
- **`AdminWorkflowStudio.tsx`** đọc token để ghép vào URL của n8n studio, không phải để
  gọi API. Xem mục Hạn chế.

---

## 3. Đăng xuất

Đăng xuất **phải thu hồi refresh token phía máy chủ** (`POST /auth/logout`) trước khi
xoá dữ liệu cục bộ. Trước đây chỉ xoá cục bộ, nên một bản sao của refresh token vẫn tiếp
tục dùng được sau khi người dùng đã "đăng xuất".

Gọi theo kiểu cố gắng hết sức: nếu lỗi mạng thì vẫn xoá cục bộ và chuyển trang — không
được giam người dùng trong một phiên mà họ đã yêu cầu kết thúc.

---

## 3b. Nút Back của Android

**File:** `src/app/hooks/useNativeBackNavigation.ts` (gắn trong `AppShell`) và
`src/app/hooks/useBackDismissible.ts`.

### Thứ tự ưu tiên

```
Bấm Back
  ↓
1. Đang mở lớp phủ (hộp thoại/bảng trượt)?  → đóng lớp trên cùng
2. Đang mở ngăn kéo bên?                     → đóng ngăn kéo
3. Đang ở màn hình chính của vai trò?        → lần 1 cảnh báo, lần 2 trong 2 giây thì thoát
4. Còn lịch sử để lùi (canGoBack)?           → navigate(-1)
5. Hết lịch sử mà chưa ở màn hình chính?     → về màn hình chính (thay thế lịch sử)
```

**Chỉ thoát app khi đang ở màn hình chính, và phải bấm hai lần.** Không bao giờ để Back từ
một trang con dẫn thẳng ra ngoài app.

Màn hình chính theo vai trò: dùng chung `ROLE_HOME` trong `src/app/config/landing.ts`
(cùng bảng với đăng nhập và khôi phục phiên — xem mục 1).

### Vì sao bước 3 đứng trước bước 4 (khác thứ tự đặc tả)

Đặc tả xếp `canGoBack` trước, nhưng như vậy lại mâu thuẫn với chính tiêu chí nghiệm thu
của nó ("ở màn hình gốc bấm Back lần đầu → hiện thông báo"). Khi người dùng đã đi vài trang
rồi **quay về màn hình chính**, lịch sử KHÔNG rỗng — nếu `canGoBack` được ưu tiên thì Back
sẽ lùi ngược qua các trang cũ thay vì hỏi thoát. Đã hỏi và Ngài chọn: **về tới màn hình
chính nghĩa là muốn thoát**, giống hầu hết app Android.

### Lớp phủ muốn Back đóng được thì phải đăng ký

App có ~28 hộp thoại **tự viết** (`fixed inset-0` + `useState`), không dùng thư viện và
không nghe phím Escape — nên không có cách nào phát hiện chung. Mỗi cái đăng ký bằng một
dòng:

```tsx
const [open, setOpen] = useState(false);
useBackDismissible(open, () => setOpen(false));
```

Đây là **chồng (stack)**, không phải danh sách: hộp thoại có thể lồng nhau, và Back phải
đóng đúng cái trên cùng.

Đã áp dụng cho: ngăn kéo bên (qua `sidebarOpen` sẵn có), `PaymentMethodDialog` (không đóng
khi đang gửi yêu cầu), `CheckinScanModal` (đóng luôn giải phóng camera), và
`PersonalizedServiceDetailModal`. **Các hộp thoại còn lại chưa đăng ký** — thêm dần khi
đụng tới, chỉ tốn một dòng.

---

## 4. Quy tắc điều hướng

**Đường dẫn nội bộ dùng React Router. Trang ngoài mới dùng trình duyệt/`window.location`.**

Mỗi lần `window.location.href/assign` cho một đường dẫn nội bộ là WebView **nạp lại toàn
bộ ứng dụng**: huỷ cây React, nạp lại bundle, dựng lại ngữ cảnh, khôi phục phiên, gọi lại
API, vẽ lại. Thêm hiệu ứng đẹp đến mấy cũng không che được — phải bỏ trước khi động vào
hiệu ứng.

### Trường hợp `services/api.ts` — ngoài cây React

File này không gọi được `useNavigate`. Nó **phát sự kiện** `session-expired`
(`services/sessionEvents.ts`), `AppContext` lắng nghe và điều hướng bằng router. Có sẵn
đường lui: nếu chưa ai lắng nghe (lỗi xảy ra trước khi React kịp mount) thì mới dùng
`window.location` để người dùng không mắc kẹt.

### Những chỗ `window.location` được giữ lại có chủ đích

| Vị trí | Lý do |
|---|---|
| `AIPlansPage.tsx` (đọc `search`/`href`) | Chỉ đọc tham số, không điều hướng |
| `AppContext.tsx` (đọc `pathname`) | Chỉ đọc |
| `LoginPage.tsx` — `reload()` | Sau khi đổi "Cấu hình máy chủ": **phải** nạp lại để mọi module đọc lại địa chỉ mới |
| `PwaUpdatePrompt.tsx` — `reload()` | Áp dụng bản cập nhật service worker |
| `sessionEvents.ts` (fallback) | Chỉ chạy khi không có listener nào |

---

## 5. Luồng thanh toán trên di động

**File:** `src/app/services/paymentGateway.ts` — dùng chung cho **cả bốn** điểm thanh toán:
`ContractPage`, `GymDetailPage`, `GymMembershipsPage`, `PlanMarketplacePage`.

| Nền tảng | Cách mở cổng thanh toán |
|---|---|
| Web | `window.location.href = url` — **giữ nguyên như cũ** |
| App (Capacitor) | `Browser.open()` — tab trình duyệt hệ thống, **app React vẫn sống phía sau** |

Trong app, `window.location.href = <url cổng>` sẽ **đưa cả WebView rời khỏi ứng dụng
React**: phá lịch sử điều hướng, mất sạch trạng thái trong bộ nhớ, và khi cổng chuyển
hướng ngược lại thì app đã ở ngoài, không quay về được.

### Nhận kết quả: dựa vào việc tab đóng, không dựa vào deep link

Backend hiện trả về `${FRONTEND_URL}/client/payments/result` (URL **web**), nên app không
chờ deep link. Nó chờ **tab đóng** (`browserFinished`) rồi tự vào màn hình kết quả của
mình kèm `txnId`, và màn hình đó hỏi máy chủ.

Cách này xử lý luôn trường hợp **người dùng đóng tab giữa chừng**: app không đoán là đã
huỷ, mà hỏi máy chủ trạng thái thật rồi hiển thị đúng như vậy.

Deep link `fitnessassistant://` **đã khai báo sẵn** trong `AndroidManifest.xml` và có
listener `appUrlOpen`, nhưng chưa có gì phụ thuộc vào nó. Khi nào payment-service có URL
trả về cho mobile, chỉ cần trỏ vào scheme đó là chạy, **không phải sửa app**.

> ⚠️ Khi parse deep link: với scheme tuỳ chỉnh, `fitnessassistant://client/payments/result`
> cho ra **host = `client`**, `pathname = /payments/result`. Bỏ host đi sẽ điều hướng nhầm
> tới `/payments/result` (không có route này → 404). Phải ghép lại `/${host}${pathname}`.

### ⚠️ Deep link KHÔNG phải bằng chứng thanh toán

Tuyệt đối không coi `?success=true` trên liên kết trả về là bằng chứng đã trả tiền — **bất
kỳ ai cũng mở được một liên kết như vậy**. Liên kết chỉ được dùng làm **đường đi**, không
phải **sự thật**.

Sự thật duy nhất là câu trả lời của máy chủ: `PaymentResultPage` luôn gọi
`POST /me/payments/:id/sync` và chỉ báo thành công khi máy chủ xác nhận. Webhook từ cổng
thanh toán vẫn là nguồn sự thật duy nhất, đúng như thiết kế backend hiện tại.

*Đã kiểm chứng trên máy ảo:* mở thủ công
`fitnessassistant://client/payments/result?txnId=totally-made-up&success=true` → app hiện
**"Không xác nhận được — Có lỗi khi kiểm tra trạng thái giao dịch"**, không hề coi là đã
thanh toán.

---

## 6. Giới hạn hiệu ứng và trạng thái chờ

### Hiệu ứng chuyển trang — chỉ `transform` và `opacity`, 160–220 ms

**File:** `src/app/components/layout/AppShell.tsx`.

| | Trước | Sau |
|---|---|---|
| Thuộc tính | `clip-path` (circle mask) | `opacity` + `translateY(8px)` |
| Thời lượng | 400 ms | **180 ms** |
| Chế độ | `mode="wait"` | `mode="sync"`, bỏ hiệu ứng biến mất |

Vì sao đổi:

- **`clip-path` không được tăng tốc phần cứng** trong WebView Android. Mỗi lần chuyển trang
  là một lần vẽ lại mặt nạ tròn đang lớn dần bằng CPU — đúng vào lúc người dùng đang chờ nội
  dung mới.
- **`mode="wait"` còn tệ hơn cả chi phí vẽ**: trang cũ phải chạy xong hiệu ứng biến mất rồi
  trang mới mới bắt đầu vẽ, biến hai nửa 0.4 giây thành một khoảng khựng thấy rõ giữa lúc
  chạm và lúc nội dung hiện ra.
- 180 ms nằm trong khoảng 160–220 ms mà mắt đọc là "nhạy"; 400 ms đọc là "phải chờ".
- `initial={false}` để lần vẽ đầu tiên lúc mở app không bị làm mờ dần.

**Chỉ vùng nội dung được animate.** Thanh trên, thanh dưới và ngăn kéo bên nằm **ngoài** hộp
`motion.div` nên đứng yên — đó là thứ khiến chuyển trang đọc thành "app đổi màn hình" thay vì
"trang nạp lại".

> ⚠️ **Vì sao phải là `transform`, và cái bẫy đi kèm:** một phần tử có `transform` khác `none`
> sẽ trở thành **containing block** cho mọi con `position: fixed` — nghĩa là mọi modal
> (`fixed inset-0`) bên trong sẽ bị neo sai chỗ. An toàn ở đây là nhờ framer-motion trả về
> `transform: none` khi mọi giá trị đều mặc định (`motion.dev.js`: `transformIsDefault ? "none"`),
> nên khi hiệu ứng nghỉ thì không còn containing block. **Đã kiểm chứng trên máy ảo:**
> `transform: none` lúc nghỉ, và modal vẫn phủ đúng toàn màn hình (448×920 = đúng viewport).
> Nếu sau này thêm `scale`, `rotate` hay giữ transform ở trạng thái nghỉ thì **phải kiểm tra lại
> modal**.

### Trạng thái chờ

Phần lớn đã đúng sẵn, không cần đụng:

- `QueryClient` đã có `staleTime: 30s`, `refetchOnWindowFocus: false` → quay lại một trang vừa
  xem không gọi lại API, không hiện vòng xoay.
- **Không có `invalidateQueries()` toàn cục** ở đâu cả. `queryClient.clear()` chỉ dùng ở 3 chỗ
  trong `AppContext` (đăng nhập, hết phiên, đăng xuất) — đều đúng, để không rò dữ liệu người
  dùng cũ.
- 12 chỗ đã dùng khung xương (`animate-pulse`) sẵn.

Phần còn thiếu là **giữ dữ liệu cũ khi đổi bộ lọc/trang**: không chỗ nào dùng `placeholderData`,
nên mỗi lần đổi bộ lọc là dữ liệu về `undefined` và danh sách nháy rỗng. Đã thêm
`placeholderData: keepPreviousData` cho đúng **5 truy vấn khoá theo bộ lọc/trang**:

| File | Khoá theo |
|---|---|
| `admin/AdminCatalogQuality.tsx` | loggingMode, status, search, page |
| `admin/AdminExerciseReview.tsx` (danh sách) | status, decisionTier, search |
| `admin/MarketplaceModeration.tsx` | filter |
| `admin/PTManagement.tsx` | filter |
| `client/ActivityHeatmapPage.tsx` | from, to |

> **Không** áp dụng cho truy vấn khoá theo **ID/thực thể** (`order.id`, `selectedRef`,
> `userScopeId`, `activeSessionId`). Ở đó giữ dữ liệu cũ nghĩa là **hiện nhầm dữ liệu của thực
> thể khác** trong lúc chờ — tệ hơn hẳn một ô trống.

---

## 7. Hạn chế đã biết

- **Refresh token lưu trong `@capacitor/preferences`, chưa dùng kho bảo mật của hệ điều
  hành.** `Preferences` bền hơn `localStorage` nhưng **không phải kho bí mật được mã
  hoá** — trên Android nó là `SharedPreferences` thường. Bản vận hành thật nên chuyển
  sang Android Keystore / iOS Keychain. Cố ý chưa làm trong đợt này.
- **Socket.IO không hưởng cơ chế làm mới token.** Hai file socket đọc `accessToken` một
  lần lúc kết nối. Nếu token hết hạn giữa chừng, kết nối realtime có thể bị từ chối cho
  tới lần kết nối lại. Chưa nằm trong phạm vi đợt này.
- **`AdminWorkflowStudio.tsx`** nạp `accessToken` một lần lúc mount để ghép vào URL
  studio; nếu token hết hạn sau đó, liên kết có thể mở ra trạng thái chưa đăng nhập.

---

## Quyết định phát sinh

Những chỗ khác với đặc tả ban đầu, kèm lý do:

### 1. Dùng `/auth/verify` thay cho `/profile/me` khi khôi phục phiên
Đặc tả ghi "gọi `/profile/me` → vào app". Kiểm chứng trực tiếp trên API đang chạy cho
thấy `/profile/me` **không trả về `role`**, mà `AppContext` lại suy ra toàn bộ vai trò từ
`user.role`. Làm theo đúng đặc tả sẽ khiến admin và chủ phòng tập bị hạ thành khách hàng
sau mỗi lần mở lại app. `/auth/verify` trả đúng bản ghi tài khoản nên được dùng thay thế.

### 2. Sửa thêm `RequireRole.tsx` (ngoài phạm vi đặc tả)
Đặc tả không nhắc tới file này. Khi kiểm thử tiêu chí "xoá `refreshToken` → phải ra màn
hình đăng nhập", phát hiện guard này `return null` khi chưa đăng nhập, dựa trên giả định
rằng `AppShell` bên trong sẽ lo việc chuyển trang — nhưng trả về `null` chính là thứ ngăn
`AppShell` được gắn vào cây. Kết quả: truy cập `/admin/*` hay `/pt/*` khi chưa đăng nhập
chỉ hiện **màn hình trắng** đứng nguyên tại URL đó. Đây là lỗi có sẵn từ trước, nhưng nằm
đúng trong tiêu chí nghiệm thu nên đã sửa thành `<Navigate to="/login" replace />`.

### 3. Sửa thêm route `/` và `LoginPage` (ngoài phạm vi đặc tả) — **đây mới là nguyên nhân gốc**
Đặc tả quy toàn bộ lỗi cho bước khởi động chỉ đọc `accessToken`. Chẩn đoán đó **đúng nhưng
chưa đủ**. Khi kiểm thử trên máy ảo Android thật, bắt được network cho thấy
`POST /auth/verify` trả **200 kèm user hợp lệ** — tức là khôi phục phiên đã thành công trọn
vẹn — **mà app vẫn nằm ở `/login`**.

Lý do: WebView luôn khởi động ở `/`, route đó redirect cứng sang `/login`, và `LoginPage`
không hề tự chuyển đi khi phiên còn sống. Nếu chỉ sửa phần khôi phục phiên theo đúng đặc tả
thì **lỗi người dùng báo cáo vẫn còn nguyên**. Đã thêm `RootRedirect` + bảng đích dùng chung
và cho `LoginPage` tự điều hướng khi đã đăng nhập.

### 4. `RegisterPage.tsx` không cần sửa — đã đúng sẵn
Đặc tả liệt kê `RegisterPage.tsx:147` dùng `window.location.href = "/client/dashboard"`.
Kiểm tra mã nguồn hiện tại: file này **đã dùng `navigate("/client/onboarding")`** rồi (có lẽ
đã sửa trong đợt merge `master` gần đây). Không đụng tới.

### 5. `PlanMarketplacePage.tsx` cũng điều hướng thanh toán — đặc tả bỏ sót
Đặc tả liệt kê 3 chỗ thanh toán (`ContractPage`, `GymDetailPage`, `GymMembershipsPage`).
Rà toàn bộ `src/` tìm thấy **chỗ thứ tư**: `PlanMarketplacePage.tsx` khi mua dịch vụ cá nhân
hoá cũng `window.location.href = url`. Đã xử lý cùng nhóm ở Phần 4 (tổng cộng **4 chỗ**).

### 7. Deep link: khai báo sẵn nhưng luồng thanh toán không phụ thuộc vào nó
Mục 4.2 yêu cầu nhận kết quả bằng deep link. Nhưng backend redirect về
`${FRONTEND_URL}/client/payments/result` (URL web) — muốn deep link hoạt động thật thì
**phải sửa payment-service**, trong khi ràng buộc ghi rõ "không đụng backend đợt này".
Đã hỏi và Ngài chọn: **không đụng backend**. Luồng thanh toán vì vậy dựa vào sự kiện
`browserFinished` (tab đóng) — vẫn đạt trọn các tiêu chí 4.1/4.3/4.4, và xử lý luôn ca
"đóng tab giữa chừng". Intent-filter + listener `appUrlOpen` vẫn được khai báo sẵn để bật
deep link sau này không cần sửa app.

### 6. Nút Back ở màn hình chính: ưu tiên hỏi thoát thay vì lùi theo lịch sử
Đặc tả Phần 2 tự mâu thuẫn (thứ tự ưu tiên đặt `canGoBack` trước, nhưng tiêu chí nghiệm thu
lại đòi cảnh báo thoát khi ở màn hình gốc). Đã hỏi và Ngài chọn **luôn hỏi thoát khi đã ở
màn hình chính**. Xem mục 3b.

### 7. Màn hình chính của chủ phòng tập: giữ `/gym-owner/dashboard`
Đặc tả Phần 2 ghi `/gym-owner/gyms`, nhưng route index, màn hình sau đăng nhập và bảng đích
chung đều dùng `/gym-owner/dashboard`. Đã hỏi và Ngài chọn giữ `dashboard` để cả ba nơi
dùng đúng một nguồn sự thật.

### 8. Phân biệt "server từ chối" với "không gọi được server" khi làm mới token
Đặc tả không nêu. `refreshAccessToken` cũ bắt mọi lỗi và trả `null`, nghĩa là mất sóng
cũng bị coi như refresh token bị thu hồi → xoá phiên → đăng xuất oan. Vì cả mục 1.1 và
1.2 đều dựa vào kết quả của hàm này, không phân biệt hai tình huống sẽ tạo ra đúng loại
lỗi mà Phần 1 đang đi sửa. Đã thêm `RefreshUnavailableError` cho nhánh "không biết".
