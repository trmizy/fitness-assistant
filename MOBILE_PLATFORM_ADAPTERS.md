# Mobile Platform Adapters — Web → React Native

> Kiểm kê trước cách mỗi hành vi phụ thuộc nền tảng ánh xạ từ `frontend/web` (Capacitor/WebView)
> sang `frontend/mobile` (React Native/Expo thật), và chốt sẵn thư viện/API RN tương ứng — theo
> đúng Phase 0.4 của kế hoạch di trú. Mục tiêu: không để từng màn hình tự phát hiện lệch nền tảng
> giữa chừng, mà có sẵn 1 quyết định tra cứu chung ngay từ Phase 1.
>
> Trạng thái mỗi dòng: 🟢 đã chốt (dùng được ngay) · 🟡 chốt tạm, cần xác nhận lại khi thực thi
> (version cụ thể/API có thể đổi) · 🔴 chưa chốt, cần quyết định trước khi phase liên quan bắt đầu.

## 1. Upload file / multipart/FormData

- **Web**: `FormData` + `axios` upload trực tiếp từ `<input type="file">`/canvas blob.
- **RN**: `FormData` vẫn dùng được với `axios`, nhưng value là `{ uri, name, type }` thay vì
  `File`/`Blob` — lấy `uri` từ `expo-image-picker`/`expo-camera`/`expo-document-picker`.
- Trạng thái: 🟢 — pattern chuẩn, không cần thư viện thêm ngoài 3 cái trên.

## 2. URI ảnh từ camera / thư viện ảnh

- **Web**: `<input type="file" accept="image/*" capture>` hoặc canvas.
- **RN**: `expo-camera` (chụp trực tiếp, cũng dùng cho QR ở Phase 14.3) + `expo-image-picker`
  (chọn từ thư viện có sẵn, cần cho gallery ảnh chi nhánh gym, ảnh minh chứng khiếu nại, ảnh InBody).
- Trạng thái: 🟢.

## 3. Tải xuống file (export data, hoá đơn...)

- **Web**: tạo Blob URL + `<a download>`.
- **RN**: không có khái niệm tải xuống trình duyệt — dùng `expo-file-system` ghi file vào
  `documentDirectory`, sau đó `expo-sharing`'s `shareAsync` để người dùng lưu/chia sẻ ra ngoài
  (không có "thư mục Downloads" phổ quát như web).
- Trạng thái: 🟡 — cần xác nhận hành vi đúng trên Android 13+ (scoped storage) lúc thực thi
  `ExportData.tsx` (Phase 9).

## 4. Xem PDF / file đính kèm (giấy tờ xác minh, hợp đồng...)

- **Web**: mở tab mới hoặc `<embed>`/viewer JS.
- **RN**: không có trình xem PDF gắn sẵn — dùng `expo-web-browser`'s `openBrowserAsync` trỏ tới
  URL file (nếu server phục vụ trực tiếp được), hoặc tải về bằng `expo-file-system` rồi mở bằng
  `expo-sharing`/intent hệ điều hành (`Linking.openURL` với URI file, tùy Android version).
- Trạng thái: 🟡 — cần chọn 1 cách cụ thể khi làm màn giấy tờ xác minh gym (Phase 12) và giấy tờ
  đối tác.

## 5. Share / Export (chia sẻ kết quả, xuất báo cáo)

- **Web**: Web Share API hoặc tải file.
- **RN**: `expo-sharing`'s `shareAsync`, hoặc `Share` API gốc của React Native cho chia sẻ text/URL
  đơn giản (không cần file).
- Trạng thái: 🟢.

## 6. Mở trình duyệt ngoài (thanh toán VNPay/ZaloPay)

- **Web (Capacitor)**: `@capacitor/browser`'s `Browser.open()`, chờ sự kiện `browserFinished`.
- **RN**: `expo-web-browser`'s `WebBrowser.openBrowserAsync(url)` — resolves ngay khi người dùng
  đóng tab, tương đương 1:1 `browserFinished`. Chi tiết đầy đủ về nguồn sự thật sau khi quay lại ở
  Phase 14.1 (luôn xác nhận qua `/sync`, không tin tham số trả về).
- Trạng thái: 🟢 — API tương đương đã xác nhận tồn tại.

## 7. Deep link / App Link

- **Web (Capacitor)**: `@capacitor/app`'s `appUrlOpen` event.
- **RN**: `Linking.addEventListener('url', ...)` + cấu hình `scheme` trong `app.json` (và Android
  App Links/`intentFilters` nếu cần universal link thật, không chỉ custom scheme).
- Trạng thái: 🟡 — cấu hình scheme/App Links cụ thể chốt ở Phase 1, nhưng việc dùng thật cho luồng
  thanh toán chỉ ở Phase 14 (theo mô hình RETURN TRANSPORT ở Phase 14.1).

## 8. Khôi phục socket sau khi resume (background → foreground)

- **Web**: trình duyệt hiếm khi treo hẳn kết nối WS khi tab chuyển nền (tuỳ OS).
- **RN**: `socket.io-client` có thể bị hệ điều hành đóng kết nối khi app vào nền lâu — bắt buộc lắng
  nghe RN `AppState` (`change` → `active`) để chủ động `socket.connect()` lại + refetch dữ liệu có
  khả năng lệch (tin nhắn mới, trạng thái cuộc gọi) thay vì tin socket tự hồi phục.
- Trạng thái: 🟡 — cần kiểm chứng thật trên thiết bị ở Phase 9 (chat) và Phase 14.4 (gọi video), đây
  là lỗi RN kinh điển, không giả định "chắc vẫn sống".
- **Cập nhật 2026-09-15 (Phase 5):** socket realtime của GATEWAY đã có trên mobile —
  `src/realtime/socketClient.ts` + `src/context/SocketContext.tsx` (port từ web), mount trong
  `app/_layout.tsx` bên trong `AppProvider`. Lắng nghe `AppState → active` để `connect()` lại đã viết
  sẵn trong provider. **Đã kiểm:** kết nối sống ở CẢ HAI đầu (xem §20.7). **Chưa kiểm:** kịch bản
  nền lâu → quay lại trên thiết bị thật — vẫn để Phase 9/14.4 như trên.
- **Đã kiểm trên emulator 2026-09-15 — nền lâu + mất mạng → quay lại:** app đang nối (1 kết nối
  ESTABLISHED ở gateway) → Home → ép Doze + tắt wifi/data 75 s → app log `disconnected: transport
  error`, gateway **không còn** kết nối → bật mạng, mở lại app → `[socket] connected` với id mới sau
  **~3 s**, gateway có kết nối mới. ✅ Tự phục hồi, người dùng không phải làm gì.
  **Giới hạn của bài thử:** không tách được lần nối lại đến từ bộ tự-reconnect của socket.io (mạng
  vừa có lại) hay từ listener `AppState → active` của provider — chỉ chứng minh app tự hồi phục,
  không chứng minh riêng từng đường. Kịch bản hãng điện thoại diệt app nền (Xiaomi/Samsung tiết kiệm
  pin) vẫn phải thử trên máy thật.

## 9. Clipboard

- **Web**: `navigator.clipboard`.
- **RN**: `expo-clipboard`.
- Trạng thái: 🟢 — dùng cho copy mã giới thiệu, mã QR check-in, số tài khoản ngân hàng payout.

## 10. Xin quyền (permission)

- **Web**: prompt trình duyệt theo từng API (camera, notification).
- **RN**: mỗi native module tự có API xin quyền riêng (`expo-camera`, `expo-notifications`,
  `expo-media-library`) — phải khai báo trước trong `app.json`'s `plugins`/`permissions`, và xử lý
  rõ ràng trường hợp người dùng từ chối vĩnh viễn (mở Settings hệ điều hành qua `Linking.openSettings()`).
- Trạng thái: 🟢 — pattern rõ, chi tiết từng quyền cụ thể chốt lúc dùng ở đúng phase (camera ở
  Phase 6/14.3, notification ở Phase 14.2, microphone ở Phase 14.4).

## 11. Hành vi bàn phím

- **Web**: trình duyệt tự đẩy layout hoặc dùng CSS `env(keyboard-inset-height)`.
- **RN**: `KeyboardAvoidingView` (behavior `padding` trên iOS, `height`/`undefined` trên Android tuỳ
  layout) hoặc `react-native-keyboard-controller` nếu `KeyboardAvoidingView` không đủ mượt cho các
  form dài (wizard nhiều bước, chat input).
- Trạng thái: 🟢 — **đã chốt ở Phase 4: dùng `KeyboardAvoidingView`, KHÔNG thêm
  `react-native-keyboard-controller`.** Quyết định này chờ tới khi có form thật để đo thay vì đoán
  ở Phase 3. Đo trên bàn phím Android thật ở màn đăng nhập/đăng ký: nội dung đẩy lên đủ, nút chính
  không bị che, không giật. Công thức đang dùng: `behavior="padding"` trên iOS và **để `undefined`
  trên Android** (Android tự resize cửa sổ; ép `behavior` ở đây gây đẩy hai lần), kèm
  `ScrollView` có `keyboardShouldPersistTaps="handled"` để bấm được nút khi bàn phím còn mở.
- Xem lại quyết định này nếu wizard nhiều bước ở Phase 7/8 (form dài, nhiều input liên tiếp) tỏ ra
  không đủ mượt — lúc đó mới là lúc có dữ liệu để cân nhắc thư viện ngoài.

## 12. Safe area

- **Web**: không áp dụng (không có notch/status bar riêng trong WebView đã xử lý qua CSS).
- **RN**: `react-native-safe-area-context` — bắt buộc bọc mọi màn hình có header/tab bar để tránh
  đè lên notch/status bar/gesture bar Android. `SafeAreaProvider` đặt ở `app/_layout.tsx`, từng
  màn hình dùng `SafeAreaView` hoặc `useSafeAreaInsets()`.
- Trạng thái: 🟢 — đã chạy thật, insets đúng (đo được top=53, bottom=24 trên emulator). Package này
  từng bị nghi gây crash suốt Phase 1; thủ phạm thật là react-native bị nạp 2 bản, đã fix ở §16.

## 13. Nút back phần cứng Android

- **Web (Capacitor)**: `@capacitor/app`'s `backButton` event, thường map vào lịch sử router.
- **RN**: `BackHandler.addEventListener('hardwareBackPress', ...)` — với Expo Router, hành vi mặc
  định (back = pop stack điều hướng) thường đã đúng, chỉ cần custom cho các trường hợp đặc biệt:
  BottomSheet đang mở (back = đóng sheet trước, không thoát màn hình), form đang dở dang (back =
  hỏi xác nhận huỷ), màn gọi video đang active (back = không thoát khỏi cuộc gọi ngay).
- Trạng thái: 🟡 — audit lại danh sách màn hình cần custom back-handler cụ thể khi build từng
  phase (đặc biệt Phase 7/8 các wizard nhiều bước, Phase 14.4 gọi video).

## 14. Notification (ngoài phần push đầy đủ ở Phase 14.2)

- **Web**: không có push thật trong bản Capacitor hiện tại (theo `.env.production.example`, các
  cờ realtime tắt mặc định) — mọi "thông báo" trên web là trong-app (badge/toast), không phải OS
  push.
- **RN**: `expo-notifications` — đây là khả năng MỚI so với bản Capacitor hiện tại, không phải
  port 1:1 từ cái web đã có. Chi tiết đầy đủ (đăng ký token, foreground/background/killed, tap →
  route) ở Phase 14.2 — dòng này chỉ ghi nhận rằng đây là tính năng mở rộng thật, không phải cổng
  1:1 nào từ web để đối chiếu.
- Trạng thái: 🔴 — chưa từng có baseline trên web để so sánh, cần thiết kế UX riêng (không chỉ port).

## 15. Runbook vận hành dev client Android trên Windows (phát hiện ở Phase 1)

Ba vấn đề vận hành thật gặp phải khi dựng dev client trên Windows + pnpm monorepo, không phải lỗi
code nghiệp vụ — ghi lại để không mất thời gian điều tra lại ở các phase sau.

### 15.1 — Trùng lặp module singleton khi tối ưu đường dẫn dài (Windows MAX_PATH)

`plugins/shortenPackagePaths.js` di dời react-native + vài native module ra thư mục ngắn
(`D:/.rn*`) qua robocopy + junction để né giới hạn MAX_PATH của Windows, và tự làm phẳng
("flatten") transitive deps kiểu pnpm sibling-context vào node_modules riêng của từng package đã
di dời. **Bẫy đã gặp**: nếu flatten luôn cả các package "singleton" (`react`, và chính các package
đang được di dời) vào node_modules của nhau, sẽ tạo ra 2 bản instance vật lý khác nhau của cùng 1
module — gây ANR trên MỌI lần chạm màn hình (registry JS/native lệch nhau). **Đã fix**: loại trừ
tập `SINGLETON_PACKAGES` (react + mọi key của `SHORTENED_PACKAGES`) khỏi bước flatten.

> Cùng loại bệnh "hai bản của một singleton" còn có một biến thể THỨ HAI, khó thấy hơn nhiều và
> loại trừ này không chạm tới được: cùng một thư mục vật lý bị Metro nhìn qua hai chuỗi đường dẫn
> khác nhau (junction so với đường dẫn store của pnpm). Đó là §16 — đọc §16 trước khi điều tra bất
> kỳ lỗi "view config undefined" hay "Unsupported top level event type" nào.

### 15.2 — ANR khi mở dev menu của expo-dev-menu (mọi lần triệu hồi đầu tiên)

Code hiển thị dev menu của `expo-dev-menu` (dùng chung giữa màn onboarding lần đầu VÀ menu dạng
bottom-sheet thường) treo UI thread ~15s (`Input dispatching timed out ... Waited 15000-15001ms
for MotionEvent`) — xác nhận là deadlock thật (không phải máy chậm) qua: tải hệ thống thấp lúc xảy
ra, tái hiện y hệt trên emulator mới khởi động lại, tái hiện y hệt qua cả đường dẫn deep-link lẫn
mở bằng icon launcher thường, và tái hiện ở CẢ nút "Continue" của onboarding LẪN nút tròn nổi (FAB)
mở menu thường (không phải lỗi riêng của màn onboarding). Khớp với 1 lớp lỗi từng có trong chính
changelog của `expo-dev-menu` ("Fix error on summoning dev-menu first time, that leads to the
application freeze" — bản rất cũ, đã fix từ lâu, nhưng project này có vẻ dính lại 1 biến thể chưa
fix, khả năng liên quan New Architecture/Bridgeless).

**Đã fix (loại bỏ mọi điểm chạm hiển thị dẫn tới code lỗi, không patch native code bên thứ ba)**:
`plugins/withDevMenuOnboardingSkipped.js` set 2 cờ AndroidManifest meta-data chính thức của
`DevMenuPreferences.kt`:
- `EXDevMenuIsOnboardingFinished=true` — bỏ qua màn onboarding toàn màn hình.
- `EXDevMenuShowFloatingActionButton=false` — ẩn hẳn nút tròn nổi luôn hiện trên màn hình.

Đã xác nhận ổn định qua 3 lần cold-relaunch liên tiếp bằng đường dẫn icon launcher thường: `Running
"main"` mỗi lần, 0 dòng ANR/crash. **Giới hạn còn lại (chấp nhận được, chỉ ảnh hưởng dev, không
ảnh hưởng người dùng thật)**: shake gesture / nhấn giữ 3 ngón / phím tắt Ctrl+M vẫn là cách chủ
động mở dev menu và vẫn sẽ dính đúng deadlock 15s này nếu dùng (recover được qua nút "Wait" của
hộp thoại ANR hệ thống) — vì không có cờ meta-data chính thức nào tắt được 3 lối vào đó ở bản
`expo-dev-menu@57.0.18`. Khuyến nghị: ưu tiên phím `r` (reload) ngay trong terminal Metro, hoặc
force-stop + mở lại app, thay vì mở dev menu trên máy khi cần reload/debug.

### 15.3 — Metro dev server tự treo giữa phiên làm việc dài

Nhiều lần trong phiên này, Metro (`npx expo start --dev-client`) vẫn `LISTENING` ở cổng 8081 (thấy
qua `netstat`) nhưng ngưng trả lời HTTP hoàn toàn (`/status` timeout từ cả curl lẫn PowerShell
`Invoke-WebRequest`), kèm log riêng của Metro từng ghi `"[timeout] connection terminated with
Device ... after not responding for 60 seconds"` — nghi vấn liên quan tới đúng lúc thiết bị bị ANR
15s ở trên khiến kết nối WebSocket của Metro với thiết bị bị xử lý sai và làm treo luôn HTTP
server. **Cách xử lý**: kill toàn bộ tiến trình `node` (PowerShell `Get-Process node | Stop-Process
-Force`) rồi khởi động lại `npx expo start --dev-client`, xác nhận `metro:instantiate` xuất hiện
trong `.expo/dev/logs/start.log` VÀ `Invoke-WebRequest http://127.0.0.1:8081/status` trả về 200
trước khi relaunch app — đừng tin riêng dòng log khởi động, phải test HTTP thật.

### 15.4 — Metro không theo dõi thay đổi file trong các thư mục đã relocate

File trong `D:/.rn*` (relocate bởi `shortenPackagePaths.js`) nằm NGOÀI `watchFolders` mặc định của
Metro (project root + node_modules) — Metro VẪN resolve/đọc được các file này lúc build bundle,
nhưng KHÔNG tự động phát hiện thay đổi nội dung của chúng để re-transform khi sửa trực tiếp file
trong đó lúc dev server đang chạy. Từng gây hiểu lầm nghiêm trọng: sửa 1 file `.ts` trong
`D:/.rngh`, relaunch app, thấy code CŨ vẫn chạy y hệt như chưa sửa gì — tưởng nhầm là "sửa không có
tác dụng" trong khi thực ra Metro đang phục vụ bundle cache cũ. **Cách xử lý**: sau khi sửa bất kỳ
file nào bên trong `D:/.rn*`, LUÔN kill hết `node` rồi khởi động lại `npx expo start --dev-client
--clear` (không phải `expo start` suông) trước khi relaunch app để kiểm tra — nếu không sẽ nhận
kết quả test sai (dương tính giả hoặc âm tính giả), y như từng xảy ra ở mục 16 dưới đây.

## 16. [ĐÃ GIẢI QUYẾT — 2026-09-13] React Native bị nạp 2 bản trong bundle

> **Trạng thái: ĐÃ FIX TẬN GỐC.** Bản vá nằm ở `frontend/mobile/metro.config.js` (hook
> `resolver.resolveRequest`). Toàn bộ triệu chứng dưới đây đã biến mất; `GestureHandlerRootView`,
> `SafeAreaProvider`, `SafeAreaView`, `useSafeAreaInsets`, `ScrollView`, `ActivityIndicator` và
> `react-native-svg` đều chạy đúng, đồng thời, dưới `<Slot>` — xác nhận bằng màn probe dựng riêng
> để mount tất cả cùng lúc (insets thật: top=53, bottom=24; log native sạch tuyệt đối).

### 16.1 — Nguyên nhân gốc

Bundle chứa **HAI bản react-native hoàn chỉnh**, đến từ hai đường dẫn khác nhau tới cùng một thư
mục vật lý:

```
../../../.rn/Libraries/...                                          (558 module)
../../node_modules/.pnpm/react-native@0.86.3_.../react-native/...   (522 module)
```

`plugins/shortenPackagePaths.js` chỉ thay thế liên kết **cấp cao nhất**
`frontend/mobile/node_modules/react-native` bằng junction trỏ tới `D:/.rn`. Nhưng pnpm còn tạo cho
MỖI package phụ thuộc một liên kết riêng `node_modules/.pnpm/<package-phụ-thuộc>/node_modules/
react-native`, và những liên kết đó vẫn trỏ về bản gốc trong store (bản gốc không bị xoá). Kết quả:

- code của app (`app/`, `src/`) → junction → `D:/.rn`
- mọi package cài qua pnpm (expo, expo-router, react-native-screens...) → đường dẫn store

Metro đánh khoá cache module bằng **chuỗi đường dẫn đã resolve**, nên hai chuỗi khác nhau = hai
module khác nhau, dù cùng trỏ về một file trên đĩa.

Hai bản react-native nghĩa là **hai bản của mọi singleton cấp module bên trong nó**. Cái vỡ rõ
nhất là `ReactNativeViewConfigRegistry`: component đăng ký view config vào instance A, trong khi
renderer Fabric đọc instance B — nên mọi tra cứu đều rỗng.

### 16.2 — Toàn bộ triệu chứng, đều từ MỘT nguyên nhân này

| Triệu chứng | Khi nào thấy |
|---|---|
| `View config getter callback for component 'AndroidProgressBar' must be a function (received undefined)` | bất kỳ `ActivityIndicator` nào |
| Y hệt vậy với `RCTScrollView` | bất kỳ `ScrollView` nào |
| `Unsupported top level event type "topLayout"/"topFocus"/"topInsetsChange" dispatched` | sự kiện mà dispatch config nằm trên view config renderer không nhìn thấy |
| Crash native SIGSEGV trong `MountingCoordinator::pullTransaction`, "trying to execute non-executable memory" | mount `GestureHandlerRootView`/`SafeAreaProvider`/`SafeAreaView`/`<Svg>` dưới `<Slot>` |
| Màn hình trắng/treo vĩnh viễn không log lỗi | cùng ca trên, tuỳ layout bộ nhớ heap |

Chẩn đoán cũ ("lỗi ABI do relocate path, phải gắn log vào `JNI_OnLoad`, có thể là lỗi upstream của
RN 0.86.3 + Bridgeless") là **SAI**. Không hề có vấn đề ABI hay native build nào: phía C++ nhận
component descriptor thiếu/không khớp chỉ vì phía JS đưa cho nó dữ liệu từ nhầm registry. Đó cũng là
lý do lỗi trông "không tất định" — nó phụ thuộc vào việc component nào tình cờ đăng ký vào registry
nào trước, chứ không phải hỏng bộ nhớ ngẫu nhiên.

### 16.3 — Cách tìm ra (dùng lại được cho lỗi tương tự sau này)

Tải thẳng bundle từ Metro rồi đếm đường dẫn module — 3 lệnh, quyết định ngay:

```bash
curl -s "http://127.0.0.1:8081/frontend/mobile/node_modules/expo-router/entry.bundle?platform=android&dev=true" -o bundle.js
grep -o "[^\"' ]*ReactNativeViewConfigRegistry\.js" bundle.js | sort -u   # >1 dòng = trùng lặp
grep -o "node_modules/\.pnpm/react-native@[^\"']*/node_modules/react-native/[A-Za-z0-9_/.-]*\.js" bundle.js | sort -u | wc -l
```

Bất cứ khi nào gặp "view config ... undefined" hoặc "Unsupported top level event type", **kiểm tra
cái này TRƯỚC**, đừng đi thẳng vào phía native.

### 16.4 — Bản vá

`metro.config.js` ép mọi import của package đã relocate chạy lại resolve như thể xuất phát từ gốc
dự án (nơi `node_modules/<pkg>` chính là junction), nên chỉ còn đúng một đường dẫn. Danh sách
package lấy thẳng từ `SHORTENED_PACKAGES` của `shortenPackagePaths.js` để không bao giờ lệch nhau.

Lưu ý cách làm: KHÔNG đưa đường dẫn tuyệt đối (`D:/.rn`) cho Metro như một tên module — Metro đọc
tên module đã viết lại như một module specifier, không phải đường dẫn hệ thống tệp, và biến nó
thành lookup tương đối vô vọng (`..\..\..\.rn`). Vào lại resolver bình thường với một origin khác
mới giữ nguyên được platform extension, `exports`/`main` và mọi thứ khác.

Kiểm chứng: bundle từ **10.850.613 → 7.521.182 byte**, số module từ **2406 → 1564**.

### 16.5 — Hệ quả: những workaround đã gỡ bỏ

- Bản vá tay trong `D:\.rn\Libraries\Renderer\implementations\ReactFabric-dev.js` (đặc cách trả
  `null` cho `topInsetsChange` thay vì ném lỗi) — **ĐÃ GỠ**, không còn cần. Đây vốn là chữa triệu
  chứng; sự kiện không đăng ký được là do registry sai, không phải do race của upstream.
- ⚠️ **Đính chính 2026-09-15:** ba bản vá JS khác trong cùng bản sao `D:\.rn` (`Libraries/Core/InitializeCore.js` ghi đè toàn cục `Object.defineProperty`, `setUpFuseboxReactDevToolsDispatcher.js`, `setUpDefaultReactNativeEnvironment.js`) **KHÔNG** được gỡ cùng lúc với bản vá Fabric ở trên, và mục này đã bỏ sót chúng. Chúng nằm im tới khi bản sao được dùng lại và làm dev client SIGSEGV — xem §21.2.
- `app/_layout.tsx` đã trả về hình dạng đúng chuẩn: `GestureHandlerRootView` → `SafeAreaProvider` →
  `QueryClientProvider` → `AppProvider` → `<Slot>`.
- Mục §12 (Safe area) trở lại 🟢.

### 16.6 — Anh em song sinh phía TypeScript (ĐÃ GIẢI QUYẾT, Phase 3)

Đúng cùng một bệnh nhưng ở `tsc` thay vì Metro, và có 2 dạng:

1. TypeScript không resolve nổi `react`/`react-native` từ các thư mục đã relocate
   (`D:/.rngh`, `D:/.rnsvg`...), vì phép walk-up của nó không bao giờ chạm tới
   `frontend/mobile/node_modules`. Hậu quả: interface khai báo dạng
   `extends PropsWithChildren<...>` **co lại thành rỗng** (truyền `children`/`style` vào
   `GestureHandlerRootView` bị báo lỗi), và class component của `react-native-svg` không còn
   được nhận là JSX component (`'Svg' cannot be used as a JSX component`).
2. Module augmentation của package khác nhắm vào **bản `react-native` khác**: NativeWind
   (`nativewind/types` → `react-native-css-interop/types`) khai báo `className` bằng
   `declare module "react-native"`, nhưng file đó resolve `react-native` theo vị trí của CHÍNH NÓ
   trong store pnpm — khác bản junction dự án dùng, nên phép merge không bao giờ xảy ra và **mọi
   `className` đều báo lỗi type** dù chạy thật hoàn toàn đúng.

**Bản vá (một dòng cho cả hai, trong `tsconfig.json`)**: `paths` trỏ thẳng vào FILE KHAI BÁO.

```jsonc
"react":        ["./node_modules/@types/react/index.d.ts"],
"react-native": ["./node_modules/react-native/types/index.d.ts"]
```

`paths` áp dụng cho MỌI file trong chương trình biên dịch, kể cả file nằm trong `node_modules` và
file ngoài cây dự án — nên nó vừa cho thư mục relocate thấy được `react`/`react-native`, vừa khiến
augmentation của NativeWind nhắm đúng vào cùng một module mà app dùng. Đây chính là thứ tương đương
`resolver.nodeModulesPaths` của Metro, chỉ là ở phía tsc.

**Cạm bẫy — trỏ vào thư mục package thay vì file khai báo thì HỎNG NẶNG HƠN**: `"react":
["./node_modules/react"]` khiến TypeScript dừng ở package runtime và KHÔNG lùi về `@types/react`
nữa, nên mọi `import` từ `react` thành `any` ngầm. Phải trỏ đích danh `.d.ts`.

Nhờ vậy đã **xoá bỏ được** file vá tay `types/relocated-packages.d.ts` (từng phải tự khai báo lại
`className` và các prop bị mất) — không còn cần dòng nào.

## 17. Quyết định adapter đã THỰC THI ở Phase 2 (lớp dữ liệu & auth)

Phase 2 port `frontend/web/src/app/services/api.ts` (5437 dòng, 37 service object) + `session.ts`,
`token.ts`, `tokenStore.ts`, `refresh-once.ts`, `sessionEvents.ts`, `secureStorage.ts`,
`socket.ts`, `config/serverUrl.ts`, `context/AppContext.tsx`. Nguyên tắc port: **giữ nguyên xi từng
dòng ở đâu có thể**, chỉ đổi đúng chỗ nền tảng bắt buộc phải khác, để file hai bên còn diff được với
nhau trong suốt phần còn lại của dự án. Dưới đây là TOÀN BỘ chỗ đã phải đổi — không còn chỗ nào khác.

### 17.1 — Lưu trữ thường: `@capacitor/preferences` → `src/services/storage.ts` (AsyncStorage)

Wrapper cố tình giữ ĐÚNG hình dạng API xấu xí của Capacitor (`get({key}) -> {value}`,
`set({key, value})`, `remove({key})`) thay vì viết API đẹp hơn — nhờ vậy `api.ts`/`session.ts` chỉ
khác web ở đúng dòng `import`. Backend là AsyncStorage: tương đương thật của Preferences (bền, theo
app, KHÔNG mã hoá).

### 17.2 — Lưu trữ bí mật: `@aparajita/capacitor-secure-storage` → `expo-secure-store`

Chỉ refresh token vào keystore (Android Keystore/iOS Keychain); access token vẫn ở storage thường vì
ngắn hạn và đằng nào cũng gửi đi mỗi request. Giữ nguyên cơ chế fallback của web: keystore hỏng thì
degrade xuống storage thường chứ không ném lỗi (sự cố lưu trữ không bao giờ được phép khoá người
dùng ra ngoài), nên đọc phải tra cả 2 nơi và logout phải xoá cả 2 nơi. Bỏ nhánh
`Capacitor.isNativePlatform()` vì app này luôn chạy native.

### 17.3 — `atob` không tồn tại trong Hermes → tự giải mã base64url + UTF-8

`token.ts` của web giải payload JWT bằng `atob` (global của trình duyệt). Hermes không có. Đã tự
viết bộ giải mã base64url + UTF-8 thuần JS (~50 dòng) thay vì thêm polyfill: polyfill là thêm phụ
thuộc nằm ngay trên đường khởi động nóng, và tạo nhánh code mà unit test chạy trong Node không đi
qua. Có test riêng cho cả 3 độ dài padding base64 và cho chuỗi UTF-8 nhiều byte (tên tiếng Việt) —
nếu bộ giải mã này sai âm thầm thì MỌI token sẽ bị coi là không đọc được, bị coi là hết hạn, và app
sẽ refresh token ở mọi request.

### 17.4 — `serverUrl.ts`: đọc đồng bộ thành bất đồng bộ, và không còn "same-origin"

Hai khác biệt bắt buộc:

1. **Không có same-origin để mặc định về.** Web mặc định `"/api"` (đường dẫn tương đối, Vite proxy
   chuyển tiếp tới gateway và CẮT tiền tố — route thật của gateway là `/auth/login`, KHÔNG phải
   `/api/auth/login`). App native không có origin nào để "cùng", nên mặc định phải là URL tuyệt đối
   trỏ thẳng gateway, KHÔNG có tiền tố `/api` — đúng hình dạng bản Capacitor đang dùng
   (`.env.capacitor`: `VITE_API_URL=http://192.168.2.100:3000`). Mặc định hiện tại:
   `http://10.0.2.2:3000` (alias của máy host nhìn từ emulator Android, chạy được ngay không cần
   cấu hình gì). Máy thật trên LAN phải set `EXPO_PUBLIC_API_URL` hoặc dùng override trong app.
2. **Đọc đồng bộ thành bất đồng bộ.** Web đọc `localStorage` đồng bộ ngay trong `apiBaseUrl()` mà
   `api.ts` gọi lúc load module. AsyncStorage không có API đọc đồng bộ, nên override được mirror vào
   1 biến cache mức module; `loadServerOverride()` nạp cache đó 1 lần lúc khởi động — **dòng đầu
   tiên của `bootstrapSession()`, trước khi request đầu tiên kịp đi**. Đổi địa chỉ trong app cũng
   không thể reload app như web, nên `api.ts` đăng ký `onServerUrlChange` để trỏ lại `baseURL` của
   cả 2 axios instance đang sống.

Biến đổi kèm theo: mọi `VITE_*` thành `EXPO_PUBLIC_*`; `import.meta.env.DEV` thành `__DEV__`.

### 17.5 — Upload file: `File` thành `{ uri, name, type }`

Đúng như §1 đã chốt. `api.ts` xuất thêm type `UploadFile` và helper `appendUpload()`; 5 điểm upload
(`profileService.uploadPhoto`, `inbodyService.upload`, `gymService.uploadGymPhoto`,
`gymService.uploadBranchDocument`, `gymService.uploadComplaintPhoto`) đổi tham số từ `File` sang
`UploadFile`. `name`/`type` phải là giá trị thật — thiếu `type` khiến server từ chối ảnh hợp lệ.

### 17.6 — `Blob` thành file URI cục bộ, KÈM ĐỔI TÊN HÀM (chú ý khi port màn hình sau này)

Không có Blob URL trên native: ảnh riêng tư phải trỏ `<Image source>` vào 1 file thật, và "tải
xuống" là ghi file vào bộ nhớ app rồi đưa cho share sheet của hệ điều hành. Module mới
`src/services/files.ts` (expo-file-system + expo-sharing, theo §3/§4) làm việc này; tải qua
downloader native của expo-file-system nên byte không đi qua JS (quan trọng với giấy tờ xác minh
dạng PDF vài MB), token gắn tay vì đường này không qua interceptor của axios.

**Các hàm đã ĐỔI TÊN** (cố ý — giữ tên `...Blob` cho thứ không còn trả Blob sẽ đánh lừa mọi màn hình
port sau này):

| Web (trả `Blob`) | Mobile (trả `string` = `file://` URI) |
|---|---|
| `adminService.fetchBranchDocumentBlob` | `adminService.fetchBranchDocumentFile` |
| `adminService.fetchComplaintPhotoBlob` | `adminService.fetchComplaintPhotoFile` |
| `gymService.fetchBranchDocumentBlob` | `gymService.fetchBranchDocumentFile` |
| `gymService.fetchComplaintPhotoBlob` | `gymService.fetchComplaintPhotoFile` |
| `triggerBrowserDownload(blob, name)` | `shareDownloadedFile(uri, mimeType?)` |

`exportService.downloadJson/downloadCsv` đổi kiểu trả về từ `{ blob, fileName }` sang
`{ uri, fileName }` (giữ nguyên tên hàm). Hai hàm này vẫn đi qua axios chứ không qua downloader
native vì cần đọc header `Content-Disposition` để lấy tên file server đặt; payload là JSON/CSV nhỏ
nên cho qua JS không sao.

`gymPhotoUrl(fileName)` giữ nguyên tên nhưng giờ trả URL tuyệt đối (web trả đường dẫn tương đối và
để trình duyệt tự resolve theo origin — `<Image source>` không làm được vậy).

### 17.7 — SSE streaming của AI Coach: `fetch` toàn cục thành `expo/fetch`

`fetch` toàn cục của RN là polyfill dựng trên XMLHttpRequest: `response.body` LUÔN là `null`, nên
`coachService.askStream` đọc stream bằng `.getReader()` sẽ im lặng không bao giờ nhận được token
nào. `expo/fetch` là bản cài đặt chạy trên networking native, `Response.body` là `ReadableStream`
thật, nên code SSE giữ nguyên, chỉ đổi đúng dòng import. `TextDecoder` có sẵn từ winter runtime của
Expo. `window.setTimeout/clearTimeout` thành `setTimeout/clearTimeout` toàn cục.

### 17.8 — Socket: thêm khôi phục theo `AppState` (thực thi §8)

`src/services/socket.ts` thêm `watchAppStateForSocketRecovery()`: nghe `AppState` chuyển sang
`active` thì chủ động `socket.connect()` lại nếu đang đứt. Chỉ kết nối lại socket ĐÃ tồn tại — nếu
không, việc đưa app về nền ở màn đăng nhập sẽ mở kết nối cho người chưa đăng nhập. Lưu ý còn nợ: kết
nối lại transport KHÔNG phát lại những gì đã bỏ lỡ — màn hình có dữ liệu do socket giữ đồng bộ (tin
nhắn, trạng thái cuộc gọi) vẫn phải tự refetch lúc resume (Phase 9 / Phase 14.4).

### 17.9 — `AppContext.tsx`: 2 phần chưa port được, là seam có chủ đích

- **Điều hướng khi hết phiên**: web gọi `navigate("/login")`. Phase 2 chưa có route `(auth)` nào,
  nên hiện chỉ xoá state phiên; phần điều hướng thật thuộc Phase 4 (nơi tạo group `(auth)` + guard
  vai trò). Cơ chế `onSessionExpired` đã nối sẵn và chạy đúng.
- **Deep link** (`appUrlOpen` của Capacitor): thuộc Phase 14.1 (đường về của cổng thanh toán), chưa
  có route đích nào để điều hướng tới nên chưa port — sẽ làm bằng `expo-linking` đúng theo §7.

Ngoài ra: `appStateChange` của Capacitor thành `AppState` của RN (làm mới token khi app quay lại
foreground); `window.location.pathname` thành `usePathname()` của expo-router; spinner `<div>` thành
`ActivityIndicator`; bỏ `sidebarOpen` (thanh bên desktop, thiết kế mobile không có); bỏ lời gọi
`clearPendingAiState` lúc logout (store đó thuộc màn AI Coach, về ở Phase 8).

### 17.10 — Màn debug tạm + hình dạng root layout sau Phase 2

`app/index.tsx` là màn debug TẠM cho tiêu chí "Xong khi" của Phase 2 (đăng nhập thật → gọi
`/auth/verify` → in JSON, kèm hiển thị địa chỉ máy chủ và trạng thái phiên). **Xoá ở Phase 4**, khi
RootRedirect và màn đăng nhập thật thay chỗ.

`app/_layout.tsx` sau Phase 2 có hình dạng chuẩn, không còn workaround nào:
`GestureHandlerRootView` → `SafeAreaProvider` → `QueryClientProvider` → `AppProvider` → `<Slot>`.

### 17.11 — Kết quả kiểm chứng thật (2026-09-13, emulator Android + backend Docker thật)

| Tiêu chí "Xong khi" của Phase 2 | Kết quả |
|---|---|
| Đăng nhập thật → gọi `/auth/verify` → in JSON ra màn debug | ✅ `john.doe@example.com`, JSON trả về đủ id/email/firstName/lastName/role=CUSTOMER/isActive |
| Tắt hẳn app rồi mở lại → vẫn còn phiên | ✅ sau `am force-stop` + mở lại: vẫn "đã đăng nhập · vai trò: client" |
| Tắt mạng giữa chừng → KHÔNG bị đăng xuất | ✅ 2 ca: (a) tắt hẳn wifi+data rồi gọi API → báo "Network Error", phiên còn nguyên; (b) tắt hẳn container gateway rồi khởi động lại app từ đầu → vẫn đăng nhập, dùng user đã cache |
| Unit test `refresh-once`/`token.ts` pass | ✅ 16/16 (`pnpm test`) |
| Typecheck sạch | ✅ `pnpm typecheck` |

### 17.12 — Kiểm thử

`pnpm test` trong `frontend/mobile` chạy `tsx --test` trên `src/services/__tests__/` — cùng kiểu với
test sẵn có của web (`node:test` thuần, không thêm framework). Hiện có 16 test: 4 cho
`refresh-once` (port nguyên xi từ web) + 12 mới cho `token.ts` (tập trung vào bộ giải mã tự viết ở
§17.3). `pnpm typecheck` = `tsc --noEmit`, sạch.

> Ghi chú: 2 lỗi type lộ ra lúc port (`extractPlanRecord` ép `UnknownRecord` thành
> `WorkoutPlanRecord`) là lỗi tiềm ẩn sẵn có của `api.ts` bên web, chỉ chưa bao giờ bị bắt vì
> `frontend/web` KHÔNG có `tsconfig.json`. Đã sửa bằng ép kiểu 2 bước ở bản mobile; bản web giữ
> nguyên (Phase 0-14 không sửa `frontend/web`).

## 18. Design system — quyết định đã THỰC THI ở Phase 3

Nguồn thị giác duy nhất: `D:\New Frontend\src\components\ui.tsx` (13 component + hook) và
`D:\New Frontend\src\index.css` (token + biến workspace). Mọi hằng số chuyển động được chép đúng
từng con số vào `src/theme/motion.ts` — **không tự chế giá trị mới**; nếu màn hình cần chuyển động
chưa có ở đó thì thêm vào đó kèm ghi chú lấy từ màn nào của bản thiết kế.

### 18.1 — NativeWind đã bật lại (crash trước đây chỉ là triệu chứng của §16)

Suốt Phase 1, bật NativeWind làm app crash lúc khởi động với `TypeError: property is not writable` /
`Global was not installed` trong `setUpDefaltReactNativeEnvironment`, và việc đó từng bị kết luận là
lỗi upstream còn mở của Expo. **Sai.** Đó là hệ quả trực tiếp của việc bundle có 2 bản react-native
(§16): code khởi tạo lõi của RN chạy 2 lần, và lần `Object.defineProperty(global, ...)` thứ hai đụng
đúng property non-configurable mà lần đầu vừa cài. Sau khi `metro.config.js` ép về 1 bản duy nhất,
NativeWind khởi động sạch — đã xác minh `className` áp dụng thật (nền, chữ, bo góc, viền), không chỉ
là "không crash".

Nhờ vậy toàn bộ design system viết bằng `className`, port gần như 1:1 chuỗi class của bản thiết kế
(vốn cũng là Tailwind) thay vì phải dịch tay sang StyleSheet.

### 18.2 — Đổi màu theo workspace: `vars()` thay cho `[data-workspace]`

Bản thiết kế đổi màu chủ đạo toàn app cho từng vai trò bằng cách ghi đè vài biến CSS trên 1 phần tử
bọc ngoài — client xanh lá `#22c55e`, PT tím `#8b5cf6`, gym xanh dương `#3b82f6`, admin teal
`#14b8a6` — nên một bộ component phục vụ cả 4 vai trò, không cần biến thể riêng.

`vars()` của NativeWind là đúng cơ chế đó, port 1:1. `src/theme/workspace.ts` xuất
`workspaceVars[workspace]` để đặt vào `style` của view bọc ngoài, cộng một context cho số ít chỗ
buộc phải có mã hex thật (stroke SVG, icon Lucide — `react-native-svg` nhận prop `color`, không có
`currentColor` để thừa kế như web).

**Cạm bẫy đã gặp**: biến phải chứa **kênh RGB cách nhau bằng khoảng trắng** (`"34 197 94"`), KHÔNG
phải hex, và tailwind bọc thành `rgb(var(--color-primary) / <alpha-value>)`. Nếu biến chứa hex thì
Tailwind không có gì để tính alpha và **mọi lớp có độ mờ bị bỏ qua âm thầm** — biểu hiện lúc gặp:
Badge tông `success` (`bg-primary/15`) mất hẳn nền trong khi các tông dùng màu literal xung quanh
vẫn đúng.

### 18.3 — Những chỗ RN buộc phải khác bản thiết kế

| Điểm | Web (bản thiết kế) | RN | Vì sao |
|---|---|---|---|
| Màu chữ | 1 chuỗi class trên `<button>` là đủ | tách đôi: container giữ layout/nền, `<Text>` giữ màu/cỡ/font | RN không cascade style chữ xuống con |
| Độ đậm chữ | `font-semibold` (Inter biến thiên) | `font-body-semibold` (Inter_600SemiBold) | app đóng gói các cut tĩnh, không có variable font |
| `:focus-within` | CSS lo | state `focused` trong `Input` | RN không có pseudo-class |
| `layoutId` (Segmented) | shared-layout transition của motion | 1 indicator giữ nguyên, spring x/width theo segment đo được | RN không có shared-layout; đo thật thay vì tính % để không lệch pixel |
| Biến thể stagger | parent điều phối children qua variants | parent phát delay theo index | Reanimated không có hệ variants |
| `.glass` | `backdrop-filter: blur(20px)` | giữ lớp nền mờ, BỎ blur | RN không có backdrop-filter. Toast và BottomSheet chuyển hẳn sang `bg-card` đặc: chúng nằm trên nội dung tuỳ ý, nền mờ không blur làm chữ khó đọc |
| Icon | `currentColor` | truyền prop `color` thật, lấy từ accent | `react-native-svg` không có currentColor |
| CountUp | cập nhật state mỗi frame | shared value chạy trên UI thread, chỉ chuỗi ĐÃ FORMAT nhảy về JS | dựng chuỗi là việc của JS thread; cách này giữ easing chính xác |
| ProgressRing | `motion.circle` | `useAnimatedProps` trên `strokeDashoffset` | cập nhật thuộc tính SVG trên UI thread, không re-render cây React |

### 18.4 — Ba thứ RN cần mà bản thiết kế không thể có

- **Haptic** (`src/lib/haptics.ts`): đặt tên theo Ý ĐỊNH (`tap`, `selection`, `threshold`,
  `success`, `warning`, `error`) chứ không theo cường độ, để đổi ánh xạ ở một chỗ. Tất cả đều
  fire-and-forget: máy không có motor, hoặc người dùng tắt rung, thì promise bị reject — và một cú
  rung hỏng không bao giờ được phép làm hỏng thao tác đã kích hoạt nó.
- **Nút back Android đóng BottomSheet** thay vì thoát màn hình. Sheet nuốt back là lỗi sheet kinh
  điển nhất của RN.
- **Haptic tại ngưỡng**: `BottomSheet` và `SwipeRow` rung đúng khoảnh khắc vượt ngưỡng commit (có
  chốt latch để chỉ rung 1 lần mỗi lần vượt, không phải mỗi frame), nên người dùng cảm nhận được
  điểm "thả ra là xong" mà không cần nhìn.

### 18.5 — BottomSheet phải tự bọc Modal

Đặt `absolute inset-0` bên trong `ScrollView` thì nó neo theo **nội dung cuộn**, không phải màn
hình — trên màn dài, sheet bị đẩy lên trên viewport hàng nghìn pixel: backdrop tối đi nhưng không
thấy sheet đâu. Đã bọc bằng `Modal` để component tự lo, không màn hình nào phải nhớ "chỉ được khai
báo sheet ở đâu".

Hai điều kèm theo, cả hai đều là bẫy thật đã gặp:
1. `Modal` trên Android là **cửa sổ native riêng**, `GestureHandlerRootView` gốc của app không với
   tới — phải có thêm một `GestureHandlerRootView` bên trong, nếu không gesture kéo-đóng không bao
   giờ chạy.
2. `GestureHandlerRootView` **không nhận `className`** (NativeWind chỉ viết lại className cho các
   component nó được dạy). Dùng `style`. Lúc dùng className, layout rơi về mặc định và sheet hiện ở
   ĐỈNH màn hình.

### 18.6 — Kiểm thử component

`pnpm test` chạy 2 tầng:
- `test:unit` — `tsx --test` cho logic thuần (Phase 2), 16 test.
- `test:components` — `jest` + `jest-expo` + `@testing-library/react-native`, 10 test: Toast
  (tự tắt sau 2200ms, toast sau thay toast trước và reset đồng hồ, `hide()` tắt ngay) và BottomSheet
  (đóng khi thả quá ngưỡng, giữ nguyên khi thả thiếu 1px, giữ nguyên khi đúng bằng ngưỡng — bản
  thiết kế dùng `>` chứ không phải `>=`). Gesture chạy qua jest-utils của chính gesture-handler nên
  `onUpdate`/`onEnd` thật của component được thực thi.

Bốn cạm bẫy khi dựng tầng jest, ghi lại để khỏi mò lại:
1. **KHÔNG đè `transformIgnorePatterns` của jest-expo** — đè là mất phần cho phép `.pnpm` đi qua, và
   file setup ESM của chính preset sẽ không nạp được. Phải MỞ RỘNG. Dưới pnpm, đường dẫn thật chứa
   `/node_modules/` HAI lần nên chỉ cho phép `.pnpm` là chưa đủ: từng package phát hành ESM
   (`lucide-react-native`, `nativewind`, `react-native-css-interop`) phải được nêu tên.
2. **`react` phải được ghim** bằng `moduleNameMapper`, cùng lý do như tsconfig: file nằm trong thư
   mục relocate không walk-up tới `frontend/mobile/node_modules` được, và Jest rơi vào
   `@types/react/index.d.ts` rồi cố chạy file khai báo như CommonJS. Đây là lần thứ BA của cùng một
   lỗi (Metro → tsc → Jest), xem §16.
3. **`react-native-worklets` cần resolver riêng** để bỏ đuôi `.native`, nếu không `setUpTests()` của
   Reanimated chết ngay lúc import ở `loadUnpackers`. Resolver có sẵn của worklets nhận diện file
   theo TÊN PACKAGE nên vô dụng ở đây (package đã relocate sang `D:/.rnw`) — `jest.resolver.js` áp
   dụng lại đúng quy tắc đó cho cả đường dẫn ngắn.
4. **`render` của `@testing-library/react-native` 14 là BẤT ĐỒNG BỘ.** Không `await` thì `screen`
   báo "render function has not been called" và giá trị trả về không có hàm query nào — trông hệt
   như cài đặt hỏng. Mọi tương tác (`press`, chạy timer) cũng phải bọc `await act(async () => ...)`
   mới flush kịp.

### 18.7 — `expo install --check`

Sạch, trừ đúng MỘT lệch có chủ đích:

```
react-native-worklets@0.10.4 - expected version: 0.10.1
```

**Giữ nguyên 0.10.4, không hạ xuống 0.10.1.** Phase 1 đã thử hạ đúng theo khuyến nghị này và nó
**làm hỏng native build** (CMake lệch hash đường dẫn giữa worklets và reanimated), phải revert. Đây
là lệch đã biết, đã kiểm chứng, không phải sơ suất — mọi lần chạy `expo install --check` sau này sẽ
còn thấy đúng dòng này.

`jest`/`@types/jest` lúc đầu cài bản 30 đã được hạ về đúng bản Expo mong đợi (29.7.0 / 29.5.14),
việc này cũng dọn luôn cảnh báo peer của `jest-watch-typeahead`.

### 18.8 — Kitchen sink

`app/(dev)/kitchen-sink.tsx` — mọi component ở mọi trạng thái, **không gắn vào điều hướng thật**,
mở bằng cách gõ route (`fitnessassistant://kitchen-sink`). Bộ chuyển workspace ở đầu màn là thứ giá
trị nhất ở đây: nó đổi màu cả màn qua biến accent, là cách nhanh nhất phát hiện component nào lỡ
hardcode màu xanh thay vì dùng `primary`.

## 19. Auth thật + khung điều hướng — quyết định đã THỰC THI ở Phase 4

### 19.1 — Cấu trúc route: group cho auth, segment THẬT cho từng vai trò

```
app/
  index.tsx              → RootRedirect (không render gì, chỉ quyết định đi đâu)
  (auth)/                → group, KHÔNG xuất hiện trong URL  →  /login, /register, ...
    _layout.tsx  login.tsx  register.tsx  forgot-password.tsx  server-config.tsx
  client/                → segment THẬT  →  /client/dashboard, ...
    _layout.tsx (Tabs + RequireRole + RequireOnboarding)
    dashboard  workout  services  messages  profile  onboarding(ẩn khỏi tab)
  pt/                    → /pt/dashboard, ...        (Tabs + RequireRole)
  gym-owner/             → /gym-owner/dashboard, ... (Tabs + RequireRole)
  admin/                 → /admin/dashboard, ...     (Tabs + RequireRole)
```

**Vì sao vai trò dùng thư mục thật chứ không dùng group `(client)`**: URL của từng workspace mang ý
nghĩa nghiệp vụ — `src/config/landing.ts` suy ra "zone" của mỗi vai trò từ chính đường dẫn
(`/pt/dashboard` → zone `/pt`) để quyết định một return-path có thuộc về vai trò đang đăng nhập hay
không. Dùng group sẽ xoá segment khỏi URL và làm logic đó vô nghĩa. Giữ nguyên hình dạng URL của web
còn giúp deep link mang sang được nguyên trạng.

Ngược lại, auth dùng group để `/login`, `/register` giống hệt web thay vì `/auth/login`.

### 19.2 — Tab bar client: theo tài liệu 08, KHÔNG theo bản thiết kế (Ngài chốt 2026-09-13)

Hai nguồn mâu thuẫn thật sự và đã dừng lại hỏi theo đúng quy tắc:

| | Tab 3 | Tab 4 | AI Coach |
|---|---|---|---|
| Tài liệu 08 §4.2 | Dịch vụ | **Trò chuyện** | (không nói) |
| Bản thiết kế (`App.tsx`) | **Dinh dưỡng** | Dịch vụ | nút tròn nổi trên tab bar |

**Quyết định của Ngài: theo tài liệu 08.** Nên 5 tab client là **Trang chủ · Tập luyện · Dịch vụ ·
Trò chuyện · Cá nhân**; **Dinh dưỡng gộp vào tab Tập luyện** (sub-navigation, dựng ở Phase 6); và
**không có nút nổi AI Coach** — AI Coach vào từ tab Trò chuyện.

Ba workspace còn lại lấy nguyên từ bản thiết kế (không có mâu thuẫn nào): PT = Tổng quan · Học viên ·
Lịch dạy · Ví · Hồ sơ; Gym = Tổng quan · Phòng gym · Ví; Admin = Tổng quan · Duyệt · Xử lý · Rút tiền.

### 19.3 — Guard

`RequireRole` bọc cả workspace, `RequireOnboarding` bọc thêm bên trong workspace client. Cả hai port
từ web, giữ nguyên hai quyết định quan trọng của bản gốc:

- **Chỉ là guard UX, KHÔNG phải ranh giới bảo mật** — chỉ RBAC ở backend mới quyết định dữ liệu nào
  đọc được. Guard này chặn *nhìn thấy*, không bảo vệ gì.
- **Onboarding fail OPEN**: query hồ sơ LỖI thì cho đi tiếp, không đá về wizard. Web đã dính đúng ca
  này khi gateway rate-limit: hồ sơ vốn đã hoàn tất, nhưng một lần gọi hỏng đẩy người dùng vào lại
  wizard. Onboarding là cổng UX, không phải cổng xác thực.

Một chỗ CỐ Ý khác web: màn 403 có nút **"Về trang chủ của bạn"**. Web có thanh địa chỉ nên bí thì
vẫn thoát được; ở đây nút back cứng sẽ *thoát app* khi route bị chặn nằm dưới đáy stack (vào bằng
deep link chẳng hạn), nên lối ra phải hiện rõ trên màn hình.

### 19.4 — Lỗi thật do test bắt được: PT mất chỗ đang xem sau khi đăng nhập lại

`isReturnPathForRole` của web từ chối mọi đường dẫn nằm ngoài zone của CHÍNH vai trò đó. Nhưng
workspace client lại nhận cả `pt` (`allow={["client","pt"]}` — một PT cũng là người tập). Hai chỗ
này mâu thuẫn: một PT đang xem `/client/dashboard`, bị đăng xuất, đăng nhập lại → return-path
`/client/dashboard` bị chính hàm này từ chối → rơi về `/pt/dashboard`, mất chỗ đang xem. **Web có
đúng lỗi này.**

Đã sửa bằng cách cho cả hai đọc chung MỘT bảng `ZONES_ALLOWED` trong `landing.ts`, thay vì để
allow-list của guard và phép kiểm zone tự phát biểu riêng rồi lệch nhau. Có test riêng cho ca này.

### 19.5 — "Quên mật khẩu" và "Gửi lại mã": nói thật thay vì dựng form giả

Kiểm tra backend TRƯỚC khi dựng gì (đúng thứ tự ưu tiên nguồn sự thật, đọc thẳng `auth.routes.ts`):

- `POST /auth/password-reset` CÓ tồn tại nhưng tiêu thụ **token nằm sẵn trong link** do luồng mời
  đối tác/admin phát hành. **Không có route nào cho phép người dùng tự yêu cầu link.**
- Không có endpoint gửi lại OTP đăng ký; cách duy nhất là gọi lại `/auth/register`.

Nên cả hai màn nói thẳng hiện trạng (màn "Quên mật khẩu" mở email tới hỗ trợ; nút "Gửi lại" hướng
dẫn đăng ký lại) thay vì dựng form thu thập email rồi chẳng gọi được đâu. Ghi vào
`MOBILE_BACKEND_GAPS.md` GAP-4 và GAP-5. Bản web cũng để link "Quên mật khẩu?" trỏ ngược `/login` vì
đúng lý do đó.

### 19.6 — Xử lý lỗi đăng nhập: bốn nhánh, không phải hai

Port nguyên từ web, vì đây là chỗ web đã trả giá trong QA mobile: một lần đăng nhập bị rate-limit
hiện đúng câu "sai mật khẩu" như lần sai thật, và người dùng cứ gõ lại mật khẩu đúng.

| Tình huống | Thông báo |
|---|---|
| 401 thật | "Email hoặc mật khẩu không đúng" |
| 429 | thông điệp thật của server (gateway trả text thuần, limiter của auth-service trả `{error}` JSON kèm đếm ngược), fallback mới là câu chung |
| Không có response (mất mạng/sai địa chỉ máy chủ) | "Không kết nối được máy chủ. Kiểm tra mạng hoặc cấu hình máy chủ." |
| Còn lại | "Đã xảy ra lỗi. Vui lòng thử lại." |

Nhánh "không có response" là bổ sung so với web: trên mobile, địa chỉ máy chủ sai là nguyên nhân
thường gặp nhất và người dùng cần được chỉ tới đúng màn cấu hình.

### 19.7 — Màn "Cấu hình máy chủ" (doc 08 §4.1)

Ẩn sau link nhỏ dưới form đăng nhập. Khác web ở chỗ **lưu xong KHÔNG reload app** — không thể;
`setServerOverride` trỏ lại baseURL của các axios instance đang sống qua `onServerUrlChange`
(§17.4), nên request kế tiếp đã dùng địa chỉ mới.

### 19.8 — Kết quả kiểm chứng thật (2026-09-13, emulator + backend Docker thật)

| Tiêu chí "Xong khi" của Phase 4 | Kết quả |
|---|---|
| Đăng nhập cũ vào đúng tab bar | ✅ `john.doe` (client) → `/client/dashboard`, tab bar 5 tab đúng tài liệu 08 |
| Vào nhầm route vai trò khác bị chặn | ✅ client mở `/pt/dashboard` → màn 403, không render nội dung workspace |
| Tắt mở lại app giữ đúng phiên/vai trò | ✅ force-stop + mở lại → khôi phục phiên, về đúng `/client/dashboard` |
| Đăng xuất → quay về đăng nhập | ✅ tự điều hướng về `/login` |
| Đăng nhập vai trò khác vào đúng workspace | ✅ `pt@example.com` → `/pt/dashboard`, **màu tím tự động**, tab bar PT riêng |
| Test điều hướng theo vai trò | ✅ 15 test logic (`landing.test.ts`) + 7 component test cho `RequireRole` |
| Typecheck | ✅ sạch |

**Chưa kiểm chứng được đầu-cuối**: `đăng ký → OTP → dashboard`. Form đăng ký gọi
`authService.register` thật và chuyển sang bước OTP, nhưng nhập được mã thì cần đọc hộp thư thật —
sẽ xác nhận cùng lúc với luồng email ở phase sau, không tự nhận là đã xong.

**Ghi chú vận hành**: máy chạy Docker (11 container) + Metro + emulator cùng lúc thì emulator chậm
tới mức Android bắn ANR "failed to complete startup" (nạp thư viện native mất >15 giây) và `adb
input text` rớt ký tự. Không phải lỗi app — nhưng nếu gặp lại, kiểm tra tải máy trước khi đi tìm lỗi
trong code.

---

## 20. Client A (Trang chủ + Thư viện) — quyết định đã THỰC THI ở Phase 5

### 20.1 — Danh sách dài: `@shopify/flash-list@2.0.2` (CHỐT)

Phase 0.5 đã yêu cầu "ưu tiên `@shopify/flash-list` **nếu** tương thích New Architecture tại thời
điểm Phase 5". Kiểm tại chỗ: FlashList v2 khai báo peer dependency đúng ba mục
`react`, `react-native`, `@babel/runtime` — **không còn native module**, nên không phải build lại
dev client, và đó chính là điều khiến nó thắng phương án giữ `FlatList`.

Đã dùng ở: thư viện bài tập (`app/client/library/exercises/index.tsx` — danh sách dài nhất phía
client) và taxonomy nhóm cơ. Nhóm cơ được **làm phẳng thành một danh sách có hàng tiêu đề** thay vì
lồng một list cho mỗi vùng giải phẫu — list lồng nhau sẽ vô hiệu hoá chính việc ảo hoá.

`keepPreviousData` bật cho phân trang catalog: thiếu nó thì mỗi lần lật trang danh sách trắng xoá và
nhảy về đầu trong lúc chờ mạng, trên điện thoại thấy rõ hơn hẳn trên web.

### 20.2 — Biểu đồ: `react-native-gifted-charts` (CHỐT), CHƯA dùng ở Phase 5

Kế hoạch bắt chốt thư viện biểu đồ ngay phase này. Chọn `react-native-gifted-charts@1.4.78` thay vì
`victory-native`: victory-native v41 dựng trên `@shopify/react-native-skia` — một native module
nặng, kéo theo build lại dev client và thêm một mắt xích nữa vào chuỗi relocate đường dẫn Windows.
gifted-charts chỉ cần `react-native-svg` (đã có sẵn, đã chạy) cộng `expo-linear-gradient`.

**Chưa màn hình nào ở Phase 5 dùng nó**: biểu đồ "Hoạt động tuần" trên Trang chủ là các thanh flex
tự vẽ, đúng y bản thiết kế (`New Frontend/src/screens/Home.tsx` cũng không dùng thư viện biểu đồ).
Thư viện được cài sẵn để Phase 6 (Thống kê) không phải dừng lại quyết định giữa chừng.

⚠️ `expo-linear-gradient` LÀ native module. Nó đã có trong `package.json` nhưng **chưa được nạp vào
dev client hiện tại** — lần đầu Phase 6 render một biểu đồ có gradient sẽ cần `expo prebuild` +
`expo run:android` lại. Ghi ra đây để Phase 6 biết trước, không phải phát hiện lúc màn hình trắng.

### 20.3 — Ngày tháng: `src/utils/date.ts` port nguyên văn từ web

`WorkoutSchedule.date` và các bản ghi InBody mang **nhãn Y-M-D**, không phải một mốc thời gian.
Đọc bằng `new Date(...)` trần sẽ lệch một ngày với mọi múi giờ khác UTC — web đã trả giá cho bài học
này (xem doc comment của `pages/client/schedule-lock.utils.ts`). File util tồn tại để mobile không
phải học lại theo từng màn hình: `toDateInputValue`, `parseApiDateOnly`, `inBodyDateKey`,
`sortInBodyNewestFirst` đều copy đúng nguyên bản.

### 20.4 — Kéo-làm-mới: `refetchQueries`, KHÔNG phải `invalidateQueries`

`src/hooks/usePullToRefresh.ts`. `invalidateQueries` đánh dấu dữ liệu cũ rồi trả về ngay, nên vòng
xoay tắt trước khi có gì về — cử chỉ trông như không làm gì trên mạng chậm. `refetchQueries` chỉ
resolve khi phần việc mạng thật sự xong, đúng cái người dùng đang chờ.

### 20.5 — Những gì CỐ Ý chưa dựng (không phải bỏ sót)

| Chi tiết trong bản thiết kế | Vì sao hoãn | Phase nhận |
|---|---|---|
| Thẻ "AI Coach có gợi ý mới" (Home) | Không có endpoint gợi ý nào tồn tại; render nó bây giờ là bịa ra một lời khẳng định backend chưa từng đưa ra | 9 |
| Thẻ "buổi tập chờ xác nhận" (Home) | Xác nhận buổi tập thuộc luồng hợp đồng/buổi tập | 7 |
| Hai ô calo/nước (Home) | Thuộc domain dinh dưỡng. **Bố cục hai ô giữ nguyên**, tạm điền chỉ số cơ thể (cân nặng, cơ bắp) đúng như web đang hiện trên chính màn này | 6 |
| Video preview của bài tập | `ExerciseMediaPreview` của web dựa vào thẻ `<video>`; bản RN cần `expo-video` (native) → gộp vào đợt build lại ở Phase 14 | 14 |
| Thư viện thực phẩm / Kiến thức dinh dưỡng | Domain dinh dưỡng | 6 |
| Tìm kiếm tổng hợp: nhóm thực phẩm + bài viết | Cùng lý do — trả kết quả dẫn tới một placeholder còn tệ hơn là chưa có | 6 |

### 20.6 — Cụm Tập luyện (CL-02 / CL-17 / CL-16 / SH-10)

**Không port 9.000 dòng của `WorkoutLogPage.tsx`.** Đó là một màn desktop ôm cả lịch tháng, phản
hồi buổi tập, dời lịch, thay bài, tạo bài tuỳ chỉnh. Port từng dòng sẽ ra một màn điện thoại không
ai thiết kế. Cái được port là **contract API** nó đã thiết lập — đúng endpoint, đúng cách xử lý
ngày — dựng lại thành ba segment mà bản thiết kế mobile thật sự yêu cầu.

**Ghi set theo từng set, không phải theo từng bài.** `startSchedule` đã tạo sẵn bộ khung
`WorkoutSet` có thật trong CSDL; mỗi dòng được ghi ngược bằng `PATCH /workouts/sets/:setId`
(`workoutService.updateSet`) — đúng hàng mà server đã tạo, không tự sinh set nào ở client.

**Offline: làm nửa thật, không làm nửa giả.** Web có hàng đợi sự kiện bền trên IndexedDB
(`enqueueWorkoutEvent`, Roadmap P1.4). Một hàng đợi làm dở còn tệ hơn không có — nó làm mất set
trong khi trông như đã lưu. Bản mobile phân biệt đúng hai loại lỗi: **có** HTTP response nghĩa là
server từ chối (hiện lỗi, hoàn tác dấu tích); **không có** response nghĩa là rớt mạng (giữ nguyên
giá trị, đánh dấu "chờ đồng bộ", bấm lại để gửi lại). Nút gạt offline trong bản prototype chỉ là
công tắc demo; phát hiện kết nối thật cần `@react-native-community/netinfo` (native) → gộp Phase 14.

**Đọc tệp CSV (adapter §0.4 "upload file")**: web dùng `FileReader` trên `<input type=file>`;
RN dùng `expo-document-picker` lấy URI rồi `expo-file-system` đọc UTF-8. Cả hai gửi đúng cùng một
body `{ fileName, csvContent }`, backend không phân biệt được hai client. Bộ lọc MIME để rộng vì
một số file provider của Android khai CSV thành `text/plain` hoặc `*/*` — parser của backend mới là
cổng thật.

**Nhập liệu số**: `TextInput` với `keyboardType="decimal-pad"` kèm hai nút ±, và chuẩn hoá dấu phẩy
thập phân (`"72,5"` → `72.5`) vì bàn phím số tiếng Việt cho ra dấu phẩy.

### 20.7 — Đóng tiêu chí "Xong khi" của Phase 5 (2026-09-15, emulator + backend thật)

Mỗi dòng dưới đây được xác nhận **ở phía server**, không chỉ nhìn giao diện.

| Tiêu chí | Cách chứng minh | Kết quả |
|---|---|---|
| Ghi 1 buổi tập thật end-to-end | john.doe, schedule `2ba2309a…`: bắt đầu → tick set 1-3 → "Thêm set" → tick set 4-5 → Kết thúc. Đọc `gymcoach_fitness` sau từng bước | ✅ 5/5 `workout_sets.completed = t`; schedule `IN_PROGRESS` → `COMPLETED`, 100%, `completed_at` có giá trị |
| Socket xác nhận sống | `netstat` trong `gymcoach-gateway-dev`: đúng 1 kết nối ESTABLISHED khi app chạy → **mất** khi force-stop app → **có lại** khi mở lại, cùng lúc logcat in `[socket] connected` | ✅ |
| Kéo-làm-mới gọi lại API thật | Đếm log request của user-service trước/sau 1 lần kéo trên Trang chủ | ✅ đúng +1 `GET /profile/me`, +1 `GET /inbody` |
| Đo hiệu năng trên thiết bị thật | — | ⏳ chưa có máy thật (số emulator ở `PERFORMANCE_BASELINE.md`) |

**Lưu ý kiểm chứng:** gateway KHÔNG log request được proxy, và sau khi restart cũng không in "Socket
connected" dù socket đang nối thật; fitness-service không log request nào. Log im lặng ở hai service
này không chứng minh được gì — phải đọc DB hoặc dùng phép thử bật/tắt kết nối ở trên.

**Lỗi thật tìm ra trong lúc kiểm (đã sửa, chỉ ở mobile):**

1. **Màn Đang tập hiện 0/0 set.** `normalizeWorkout` đọc `exercise.sets`, nhưng đó là *số set dự
   kiến* (một con số); các dòng set thật nằm ở `exercise.workoutSets`. Cùng lỗi ở màn chi tiết lịch
   sử `workout/[id].tsx`. Tên bài lấy thêm `exerciseNameSnapshot` làm dự phòng.
2. **Vừa bấm "Bắt đầu" đã bị đánh dấu xong.** Tab tuần coi "có `workoutId`" là xong, nhưng
   `startSchedule` tạo workout ngay lập tức với `status: IN_PROGRESS`. Hậu quả: thẻ hôm nay hiện ✓,
   không bấm được, người dùng không quay lại được buổi đang tập dở; Trang chủ thì ẩn buổi hôm nay và
   nhảy sang tuần sau. Sửa: đọc `schedule.status` (`COMPLETED` = xong, giống web
   `WorkoutLogPage.tsx`), thêm trạng thái "Đang tập"; Trang chủ chỉ loại `COMPLETED/SKIPPED/CANCELLED`
   và đổi nút thành "Tiếp tục buổi tập".
   **Web dính đúng lỗi này** (`ClientDashboard.tsx`, lọc `!workoutId`) — đã sửa cùng cách (lọc theo
   `status`) theo cho phép riêng của Ngài ngày 2026-09-15, là ngoại lệ có chủ đích với quy tắc "không
   sửa `frontend/web` trong Phase 0–14".
3. **Đồng hồ tính từ lúc mở màn**, không phải lúc bắt đầu buổi. Nay tính từ `schedule.startedAt`.
4. **App mobile chưa từng mở socket realtime nào.** Phase 2 chỉ port socket chat
   (`services/socket.ts`, không nơi nào gọi); `SocketProvider` của web chưa hề được port. Đã port
   (xem §8) — đây là port cho đủ tương đương web, không phải hành vi mới.


---

## 21. Hạ tầng build native — sự cố và cách sửa (2026-09-15, lúc đo hiệu năng Phase 5)

Toàn bộ mục này phát sinh khi cố build bản **release** để đo cold start thật. Không mắt xích nào là
lỗi nghiệp vụ; tất cả nằm ở cơ chế rút gọn đường dẫn (§15.1) và các dấu vết debug để lại từ §16.

### 21.1 — `pnpm add` âm thầm xoá cơ chế rút gọn đường dẫn

Chạy `pnpm add` trong `frontend/mobile` (để cài FlashList ở Phase 5) đã trỏ ngược các junction trong
`node_modules` về đường dẫn dài của pnpm store, và `postinstall` khi đó **không** nối lại. Không có gì
vỡ ngay: dev client đã cài vẫn chạy, Metro vẫn bundle được. Chỉ lộ ra khi build native:
`react-native-worklets:configureCMake...` không khởi chạy được `prefab_command.bat` (đường dẫn quá dài).

**Cách kiểm sau mọi lần `pnpm add/remove/install`:**
`(Get-Item node_modules\react-native -Force).Target` phải là `D:\.rn`, không phải một đường dẫn trong `.pnpm`.

### 21.2 — Bản sao ngắn bị nhiễm bẩn từ Phase 1

`D:/.rn*` là **cache** chép từ pnpm store, nhưng trong quá trình điều tra §16 đã có người sửa tay
trực tiếp bên trong nó và không khôi phục:

| Bản sao | Tệp | Bản chất | Xử lý |
|---|---|---|---|
| `D:/.rn` | `Libraries/Core/InitializeCore.js` (+ `.bak`) | Ghi đè toàn cục `Object.defineProperty` để nuốt `TypeError` | Bỏ — rác debug |
| `D:/.rn` | `src/private/devsupport/rndevtools/setUpFuseboxReactDevToolsDispatcher.js` | Chặn định nghĩa lại global | Bỏ — rác debug |
| `D:/.rn` | `src/private/setup/setUpDefaultReactNativeEnvironment.js` | Tắt hẳn require React DevTools | Bỏ — rác debug |
| `D:/.rn` | `Libraries/Renderer/implementations/ReactFabric-dev.js` | Chỉ còn khác dấu ngoặc | Bỏ |
| `D:/.rngh` | `android/.../RNGestureHandlerModule.kt` | **Sửa thật**: `install()` chạy inline thay vì `runOnJSQueueThread` (tự deadlock dưới Bridgeless; khớp bản viết lại 3.x của upstream) | **Giữ** — chuyển thành `pnpm patch` |

Hậu quả khi Metro được trỏ vào bản sao này: dev client **SIGSEGV** trên luồng JS
(`MountingCoordinator::pullTransaction` ← `FabricUIManagerBinding::schedulerDidFinishTransaction` ←
`ShadowTree::commit`) ngay sau khi tải bundle, trong khi cùng binary với react-native nguyên gốc
chạy bình thường. Kiểm bundle theo §16 cho thấy **không** có trùng module — nguyên nhân là JS bị sửa,
không phải lớp lỗi hai bản react-native.

**Đã sửa:**
1. Bản vá Kotlin thành bản vá chính thức: `patches/react-native-gesture-handler@2.32.0.patch`, khai
   báo trong `pnpm.patchedDependencies` ở `package.json` gốc. pnpm lưu bản đã vá ở một thư mục store
   riêng (`react-native-gesture-handler@2.32.0_patch_hash=...`).
2. Xoá cả 9 bản sao `D:/.rn*`, chạy `pnpm install --frozen-lockfile` để `postinstall` chép lại từ
   store. Kiểm chứng: `diff -rq -x build -x node_modules -x .cxx <store> <bản sao>` = **0** cho cả 9.
3. Mọi diff cũ được sao lưu trước khi xoá.

**Quy tắc:** không bao giờ sửa tay tệp bên trong `D:/.rn*` để thử nghiệm. Thay đổi cần tồn tại lâu
dài phải đi qua `pnpm patch`. Khi một gói đã relocate hành xử lạ, việc đầu tiên là diff bản sao với
nguồn store của nó.

> `pnpm patch --edit-dir D:/x` lỗi `EPERM mkdir 'D:\'` trên pnpm 8.15 — dùng thư mục tạm mặc định.

### 21.3 — Config plugin cục bộ phải import `expo/config-plugins`

Cả ba plugin trong `plugins/` từng `require("@expo/config-plugins")`. Gói có scope đó không phải
dependency trực tiếp nên pnpm không liên kết nó vào `frontend/mobile`. `expo prebuild` vẫn resolve
được, nhưng tác vụ `:expo-constants:createExpoConfig` do Gradle chạy lúc build release thì không
(`Cannot find module '@expo/config-plugins'`). Đã đổi cả ba sang `require("expo/config-plugins")` —
bản re-export chính thức của `expo`, vốn là dependency trực tiếp.

### 21.4 — Công thức build Android trên máy này

1. Xoá `android/build/generated/autolinking` sau mọi lần nối lại junction — tệp này ghim đường dẫn
   của lần cấu hình trước.
2. `NODE_PATH=D:\FitnessAssistant\frontend\mobile\node_modules;D:\FitnessAssistant\node_modules\.pnpm\node_modules`
   - Mục thứ nhất cho `:react-native-reanimated:assertWorkletsVersionTask`, chạy node từ `D:/.rnr`
     nơi `react-native-worklets` cố ý không được làm phẳng (singleton).
   - Mục thứ hai cho codegen (`generateCodegenArtifactsFromSchema`) chạy từ `D:/.rn`, vì bản làm
     phẳng thiếu các gói bắc cầu như `@babel/helper-validator-identifier`.
   - Chỉ ảnh hưởng các script node lúc build; bundle chạy trên máy vẫn do `metro.config.js` quyết định.
3. Release: thêm `NODE_ENV=production`.
4. Emulator: `-PreactNativeArchitectures=x86_64`.
5. Bản release chặn HTTP không mã hoá. Để đo với backend dev `http://10.0.2.2:3000` cần một lớp phủ
   **tạm thời** `android/app/src/release/AndroidManifest.xml` (`usesCleartextTraffic="true"`) — gỡ
   ngay sau khi đo, không phải cấu hình production.

Script tương ứng dùng trong phiên này: `build-android.ps1 -Variant debug|release [-Install]`.

### 21.5 — Kiểm chứng

| Kiểm | Kết quả |
|---|---|
| 9 bản sao `D:/.rn*` so với nguồn store | `diff -rq -x build -x node_modules -x .cxx` = **0** cho cả 9 (gesture-handler so với thư mục store đã vá) |
| Build debug (x86_64) | **BUILD SUCCESSFUL** trong 1 phút 14 giây — qua trót lọt `assertWorkletsVersionTask`, `createExpoConfig`, CMake worklets + app |
| Dev client mới trên emulator | Trang chủ dữ liệu thật, bộ đệm crash **0 dòng** qua toàn bộ chuỗi kiểm (trước khi sửa: SIGSEGV ngay khi mở) |
| Build release (x86_64) | **BUILD SUCCESSFUL** trong 14 phút 59 giây, `app-release.apk` 73,5 MB |
| Bản release chạy độc lập | `flags=0x0` (không debuggable), mở không cần Metro, gọi được API, crash 0 dòng |
| Lớp phủ cleartext tạm | Đã gỡ sau khi đo |

Số đo hiệu năng của bản release: xem `PERFORMANCE_BASELINE.md`.
