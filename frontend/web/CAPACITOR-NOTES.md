# Capacitor Android wrapper — ghi chú bàn giao

Bọc `@gym-coach/web` (Vite 6 + React 18) bằng Capacitor để ra **APK debug** chạy trên điện thoại
Android cùng mạng LAN với máy chủ dev. Không phải bản ký phát hành, không dùng HTTPS/domain thật.

---

## 1. Mạng LAN

**IP LAN đang dùng: `192.168.1.56`** (card Wi-Fi của máy dev).

Ba biến trong `frontend/web/.env.capacitor` (file này **bị gitignore** vì khác nhau theo từng máy/mạng):

```
VITE_API_URL=http://192.168.1.56:3000
VITE_SOCKET_URL=http://192.168.1.56:3000
VITE_CHAT_WS_URL=http://192.168.1.56:3005
```

> **Vì sao bắt buộc:** mặc định `api.ts` dùng đường dẫn tương đối `/api` và dựa vào proxy của Vite
> dev server. Trong APK không có Vite dev server — WebView phục vụ file tĩnh từ `localhost`, nên
> `/api` sẽ trỏ ngược vào chính WebView và mọi request đều hỏng. Hai socket cũng vậy
> (`socketClient.ts`, `socket.ts` mặc định same-origin).
>
> `VITE_API_URL` **không** có hậu tố `/api` — gateway phục vụ route ở gốc (`/auth/login`, …);
> chính proxy của Vite mới là thứ cắt bỏ tiền tố đó.

### Khi đổi sang mạng WiFi khác

```powershell
# 1. Lấy IP LAN mới
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*'
} | Select-Object IPAddress, InterfaceAlias
```

2. Sửa cả 3 dòng trong `.env.capacitor` sang IP mới.
3. Kiểm chứng từ chính máy dev (phải ra 200, nếu không thì điện thoại chắc chắn cũng không gọi được):
   ```powershell
   curl http://<IP_MỚI>:3000/health
   ```
4. Build lại + cài lại APK (xem mục 5).

### Firewall

Máy này **đang tắt Windows Firewall ở cả 3 profile** (Domain/Private/Public = False), nên **không cần
tạo rule** cho cổng 3000/3005. Nếu sau này bật firewall lại, cần chạy (yêu cầu quyền admin):

```powershell
New-NetFirewallRule -DisplayName "FitnessAssistant Gateway 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "FitnessAssistant Chat 3005" -Direction Inbound -Protocol TCP -LocalPort 3005 -Action Allow -Profile Private
```

---

## 1b. Dùng app KHÔNG cần chung WiFi — Cloudflare Tunnel

Địa chỉ LAN ở mục 1 chỉ chạy khi điện thoại **cùng WiFi** với máy dev. Muốn dùng ở mạng bất kỳ
(4G, WiFi khác), mở một **Cloudflare quick tunnel** — miễn phí, không cần tài khoản:

```
Nhấp đúp:  D:\FitnessAssistant\Khoi-dong-Tunnel.bat
```

Script tự kiểm tra gateway `:3000` còn sống rồi in ra URL công khai dạng
`https://<ngau-nhien>.trycloudflare.com`. **Giữ cửa sổ đó mở** trong lúc dùng app.

### Dán URL vào app (không cần build lại)

Màn hình **Đăng nhập** → cuối trang bấm **"Cấu hình máy chủ"** → dán URL → **"Lưu và tải lại"**.
Địa chỉ lưu trong `localStorage` (`config/serverUrl.ts`) và **thắng** giá trị build-time, nên mỗi lần
tunnel đổi URL chỉ cần dán lại — **không phải build/cài lại APK**. Để trống rồi Lưu = quay về địa chỉ
LAN mặc định của bản build.

### Chỉ cần MỘT tunnel

Gateway đã proxy luôn websocket của chat qua `/chat-socket.io` (xem `proxy.routes.ts` +
`server.ts` forward sự kiện `upgrade`), nên một URL phục vụ tất cả. Đã kiểm chứng thật qua tunnel:

| Đường | Kết quả |
|---|---|
| `GET /health` | ✅ 200 |
| `POST /auth/login` | ✅ 200 + token |
| `GET /me/wallet` (API có xác thực) | ✅ 200 |
| `/chat-socket.io/` (chat realtime) | ✅ 200 + `sid` |
| `/socket.io/` (socket của gateway) | ✅ 200 + `sid` |

> **Bẫy đã gặp:** phải trỏ tunnel vào `http://127.0.0.1:3000`, **không** dùng `localhost`. Trên Windows
> dual-stack, `localhost` phân giải ra IPv6 `::1` trước trong khi Docker chỉ publish IPv4 → cloudflared
> trả 502 `dial tcp [::1]:3000 ... actively refused`. Script đã dùng `127.0.0.1`.

> CORS: gateway đã cho phép sẵn origin `http://localhost` của app (`utils/corsOrigins.ts`), không phải sửa.

### Khi lên thật
Quick tunnel đổi URL mỗi lần chạy và không có SLA — chỉ hợp demo. Muốn URL cố định thì dùng
**named tunnel** (cần tài khoản Cloudflare + domain), rồi nhúng thẳng vào `.env.capacitor`.

---

## 2. Luồng thanh toán — chọn **Cách A**

**Không sửa gì** ở `WalletPage.tsx`. Luồng nạp ví qua cổng ngoài (VNPay/ZaloPay) **không nằm trong
phạm vi chạy được của APK bản này**.

Lý do kỹ thuật: `WalletPage.tsx:39` dùng `window.location.href = result.redirectUrl`. Trong WebView,
lệnh này điều hướng app ra khỏi origin của chính nó sang trang cổng thanh toán; khi cổng redirect
ngược về `payments/result` thì app đã ở ngoài và không quay lại được.

Nếu sau này cần bật: cài `@capacitor/browser`, tại đúng chỗ gọi redirect thì dùng
`Browser.open({ url: result.redirectUrl })` khi `Capacitor.isNativePlatform()` là true (giữ nguyên
`window.location.href` cho web), rồi cho app polling trạng thái giao dịch sau khi người dùng quay lại.
**Không** làm deep link.

---

## 3. Môi trường build

| Thành phần | Giá trị |
|---|---|
| JDK | **21** — `C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot` (`JAVA_HOME` đã set) |
| Android SDK | `C:\Users\Windows\AppData\Local\Android\Sdk` (`ANDROID_HOME` đã set) |
| compileSdk / targetSdk | 36 |
| minSdk | 24 |
| build-tools | 36.0.0 |
| Capacitor | 8.5.x (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`) |
| appId / appName | `vn.fitnessassistant.app` / Fitness Assistant |

`android/local.properties` (gitignore) trỏ `sdk.dir` vào SDK ở trên.

---

## 4. Quyền Android

`android/app/src/main/AndroidManifest.xml`:

| Mục | Phục vụ tính năng |
|---|---|
| `INTERNET` | Mọi request API/socket |
| `CAMERA` | Video call (`useWebRTC.ts`), quét QR check-in gym (`GymCheckinPanel.tsx`), chụp phiếu InBody |
| `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | Voice/video call qua WebRTC |
| `android:usesCleartextTraffic="true"` | Gọi API qua HTTP trong LAN (Android 9+ chặn mặc định) |

`capacitor.config.ts` đặt `androidScheme: 'http'` — quan trọng: nếu để mặc định `https`, origin app là
`https://localhost` và WebView sẽ chặn **mọi** request `http://` tới gateway (triệu chứng: request im
lặng không đi).

---

## 5. Lệnh cần chạy lại mỗi khi sửa code web

```bash
# 1. Build web (mode capacitor) + đồng bộ sang project Android
cd D:\FitnessAssistant\frontend\web
pnpm run app:sync

# 2. Build lại APK
cd android
.\gradlew.bat assembleDebug

# 3. Cài lại lên máy (đường dẫn APK ở mục 6)
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

> Nếu mở terminal mới mà Gradle báo lỗi Java version, set lại:
> `$env:JAVA_HOME="C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot"`

---

## 6. File APK

```
frontend/web/android/app/build/outputs/apk/debug/app-debug.apk
```

Cài lên máy thật:

```powershell
adb devices                     # phải thấy thiết bị ở trạng thái "device"
adb install -r <đường dẫn>\app-debug.apk
adb shell pm grant vn.fitnessassistant.app android.permission.CAMERA
adb shell pm grant vn.fitnessassistant.app android.permission.RECORD_AUDIO
adb shell monkey -p vn.fitnessassistant.app -c android.intent.category.LAUNCHER 1
adb logcat -s chromium Capacitor CapacitorConsole
```

Trên điện thoại cần bật trước: *Cài đặt → Giới thiệu điện thoại → bấm 7 lần vào "Số hiệu bản dựng"*,
rồi bật **Gỡ lỗi USB** trong *Tuỳ chọn nhà phát triển*, cắm cáp và bấm **Cho phép**.

---

## 7. Kết quả kiểm thử

### Đã xác minh trên máy dev

| Hạng mục | Kết quả |
|---|---|
| `pnpm --filter @gym-coach/web dev` vẫn chạy trên trình duyệt | ✅ HTTP 200, Vite ready ~1s |
| `pnpm run app:sync` chạy không lỗi | ✅ |
| `android/app/src/main/assets/public/` có file web | ✅ có `index.html` + `assets/` |
| `dist/assets/*.js` chứa `192.168.1.56:3000` | ✅ có cả `:3000` và `:3005` |
| `curl http://192.168.1.56:3000/health` từ máy dev | ✅ 200 |
| `curl http://192.168.1.56:3005/health` (chat) | ✅ 200 |
| Manifest đủ 4 quyền + `usesCleartextTraffic="true"` | ✅ |
| `gradlew assembleDebug` | ✅ BUILD SUCCESSFUL (1m11s) |
| `app-debug.apk` tồn tại | ✅ 17 MB |
| `apps/mobile` không bị thay đổi | ✅ |

### Kiểm thử trên điện thoại thật — **CHƯA XÁC MINH**

| # | Bước | Trạng thái |
|---|---|---|
| 1 | App mở lên hiện màn hình đăng nhập | ⏳ chưa chạy |
| 2 | Đăng nhập thành công | ⏳ chưa chạy |
| 3 | Dashboard tải được dữ liệu | ⏳ chưa chạy |
| 4 | Chat real-time nhận được tin nhắn | ⏳ chưa chạy |
| 5 | Video call bật được camera | ⏳ chưa chạy |
| 6 | Chụp ảnh phiếu InBody mở được máy ảnh | ⏳ chưa chạy |

**Lý do chưa xác minh:** `adb devices` không thấy thiết bị nào — chưa có điện thoại cắm vào máy dev
(cần bật Gỡ lỗi USB và cấp quyền ủy quyền trên máy). APK đã sẵn sàng cài; xem lệnh ở mục 6.

---

## 8. Những chỗ phải làm khác với đề bài (và lý do)

| Đề bài | Thực tế đã làm | Lý do |
|---|---|---|
| JDK **17** | JDK **21** | Capacitor 8 biên dịch ở `source release: 21`; build với JDK 17 fail ngay `:capacitor-android:compileDebugJavaWithJavac` — `invalid source release: 21`. |
| Tải Android SDK cmdline-tools về `C:\Android` | Dùng SDK **sẵn có** ở `C:\Users\Windows\AppData\Local\Android\Sdk` | Máy đã có sẵn SDK đủ `platforms;android-36` + `build-tools;36.0.0` + `platform-tools` (adb) và license đã chấp nhận — không cần tải lại. |
| `app:sync` dùng `npx cap sync android` | `pnpm exec cap sync android` | Repo dùng pnpm workspace; `npx` không phân giải được binary `cap` (`could not determine executable to run`). |
| Tạo firewall rule cho 3000/3005 | **Không tạo** | Windows Firewall đang tắt toàn bộ 3 profile → cổng đã thông LAN sẵn. (Tiến trình hiện tại cũng không có quyền admin; nếu bật firewall lại thì xem lệnh ở mục 1.) |
| — | Thêm `server.watch.ignored: ["**/android/**"]` vào `vite.config.ts` | Chỉ là cấu hình. Không có nó, mỗi lần Gradle build lại ghi file vào `android/app/build/...` khiến dev server reload trang vô cớ. |

Không sửa bất kỳ logic nghiệp vụ nào trong `frontend/web/src`.
Thư mục `apps/mobile` **không bị đụng tới**.
