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
| ~~Video preview của bài tập~~ | **ĐÃ LÀM 16/9 (§20.11)** — ghi chú cũ sai: catalog không có video, `video_url` là 2 khung JPG, chỉ cần `expo-image`, không cần `expo-video` | 5 |
| ~~Thư viện thực phẩm / Kiến thức dinh dưỡng~~ | **ĐÃ LÀM 17/9 (§22.4)** | 6 |
| ~~Tìm kiếm tổng hợp: nhóm thực phẩm + bài viết~~ | **ĐÃ LÀM 17/9** — cùng dải xem trước ở hub Khám phá | 6 |

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

**HOÃN CÓ CHỦ ĐÍCH — Ngài quyết 2026-09-15 ("1 và 4 note lại làm sau"), Phase 5 chưa đóng cho tới khi xong:**

1. **Đo hiệu năng trên điện thoại Android tầm trung thật** (tiêu chí "Xong khi" bắt buộc). Cần Ngài có máy.
   Khi đo, điều tra luôn hai chỉ số đã vượt ngưỡng trên emulator: mở app tới Trang chủ ~5,0–7,7 s (ngưỡng
   2,5 s) và Trang chủ đủ dữ liệu ~10 s (ngưỡng 1,5 s); đo nốt độ trễ điều hướng, frame drop luồng JS,
   bài RAM 10 phút. Phương pháp + ngưỡng: `PERFORMANCE_BASELINE.md`.
2. ~~**Bấm thử trên trình duyệt hai thay đổi web** của GAP-4/GAP-5~~ → **ĐÃ LÀM (2026-09-16)**, xem §20.13.

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

### 20.8 — SH-03 trình thiết lập hồ sơ (chuyển vào Phase 5 theo quyết định của Ngài, 2026-09-15)

**Hai nguồn, chia đúng thứ tự thẩm quyền:** giao diện theo `New Frontend/SetupWizard.tsx` (thanh tiến
độ phân đoạn + "Bỏ qua", ô icon + tiêu đề lớn, thẻ lựa chọn có vòng tick, trượt 220 ms giữa các bước);
hành vi + dữ liệu theo web `OnboardingWizardPage.tsx`. Bản thiết kế chỉ có 4 câu hỏi nhanh với lựa
chọn KHÔNG phải giá trị backend lưu ("Tăng sức mạnh", "2 buổi/tuần") — mobile giữ đủ 6 bước và mọi
trường của web (enum trình độ/mục tiêu thật, danh sách ngày trong tuần, thiết bị theo catalog, sàng lọc
an toàn, chỉ số cơ thể), mặc theo bố cục bản thiết kế. Câu "Bạn tập ở đâu?" của bản thiết kế sống lại
thành hàng gợi ý nơi tập ở bước thiết bị.

**Giữ nguyên từ web, có chủ đích:** một đường ghi cho mỗi thứ (`PUT /profile/me`, thiết bị chỉ qua
`PUT /equipment/me`); "Bỏ qua" vẫn lưu và đặt `hasCompletedOnboarding`; hồ sơ mới được ghi vào cache
ĐỒNG BỘ trước khi điều hướng (nếu không RequireOnboarding đá ngược lại); `activityLevel` bắt buộc, không
tự điền mặc định; sàng lọc an toàn chỉ ghi khi đã tới bước đó. Nháp theo từng user: AsyncStorage
(web: localStorage). Mới trên mobile: bàn phím số tiếng Việt gõ dấu phẩy → chuẩn hoá `"68,5"` → `68.5`.
Port kèm: `src/components/EquipmentPicker.tsx` (không có vùng cuộn lồng — cả danh sách nằm trong trang),
`src/utils/units.ts`. "Đăng xuất" giữ ở bước 1 dù bản thiết kế không có: tới khi màn Hồ sơ được dựng
(Phase 9) đây là chỗ duy nhất trong app một client đang đăng nhập có thể đăng xuất.

**Sửa kèm — thanh tab:** `hiddenRoutes` chỉ đặt `href: null` (bỏ NÚT tab) nên thanh tab vẫn hiện dưới
wizard, dẫn người chưa thiết lập sang phần khác của app. Thêm `fullScreenRoutes` vào `WorkspaceTabs`
(`tabBarStyle: { display: "none" }`), dùng cho `onboarding`.

**Kiểm chứng trên emulator (john.doe, mở thẳng `/client/onboarding`):** đi hết 6 bước — nút Tiếp tục
khoá đúng ở bước 1 và 5; gợi ý "Gym tại nhà" chọn đúng 8 thiết bị; tick 1 câu sàng lọc hiện cảnh báo;
đổi kg↔lb hiển thị đúng (71.3 kg → 157.2 lb, 68.5 kg → 151 lb); màn Xem lại đủ 10 dòng. Tắt hẳn app rồi
mở lại → nháp khôi phục đúng bước 6 kèm thông báo. Bấm Hoàn tất → DB `user_profiles`: BEGINNER,
MUSCLE_GAIN, `[1,3,5]`, split null, MODERATELY_ACTIVE, 28, MALE, 172, 71.3, **68.5**,
FOLLOW_UP_SUGGESTED `["bone_joint"]`; `user_equipment` đúng 8 dòng; `availableEquipment` cũ được
server tự đồng bộ. Hồ sơ + thiết bị của john.doe đã khôi phục về đúng ảnh chụp trước bài thử
(so khớp: IDENTICAL).

**Hai lỗi do chính Tại hạ gây ra, bắt được trên thiết bị (đã sửa):** (1) bước sau thừa hưởng vị trí cuộn
của bước trước → ô icon bị che dưới thanh tiến độ; sửa bằng cuộn về đầu mỗi khi đổi bước. (2) Lúc thêm
bản sửa (1) quên import `useRef` → hot reload ném Render Error đúng lúc bấm Hoàn tất, lượt lưu đầu
không tới backend; phát hiện nhờ đối chiếu DB (hồ sơ không đổi) chứ không phải nhờ giao diện.

### 20.9 — Kiểm thử tự động + lint của Phase 5 (2026-09-15)

**Tách logic ra module thuần để test được** (hành vi giữ nguyên, màn hình chỉ import lại):
`src/features/workout/normalizeWorkout.ts` (log.tsx), `src/features/workout/trainingWeek.ts`
(tab Lịch tuần), `src/features/dashboard/dashboardWeek.ts` (cột tuần, chuỗi ngày, next/Sắp tới, nhãn
thay đổi), `src/features/onboarding/onboardingPayload.ts` (payload + chặn bước của SH-03),
`src/components/navigation/hiddenRouteOptions.ts` (ẩn thanh tab).

**Unit test (`tsx --test`, script `test:unit` giờ quét `src/**/__tests__/*.test.ts`) — 96 test.** Mỗi
lỗi thật gặp ở Phase 5 có một test chặn tái phát: đọc `workoutSets` chứ không phải `sets` (0/0),
buổi IN_PROGRESS không bị tính là xong, buổi đang tập vẫn là "next", "Sắp tới" không lặp buổi ở thẻ
lớn, `bodyPartLabel` nhận chữ thường, dấu phẩy thập phân, lời chào sau nửa đêm. Kèm ngày tháng
(timezone của nhãn date-only), đổi đơn vị, payload onboarding (không mặc định `activityLevel`, sàng lọc
an toàn chỉ khi tới bước, `preferredSplit` null tường minh).

**Component test (jest) — 31 test / 7 suite**, mới: `usePullToRefresh` (refetch đủ key, spinner giữ tới
khi xong, lỗi vẫn tắt spinner), `SocketContext` (kết nối khi có phiên, ngắt khi đăng xuất, trạng thái
theo sự kiện, nối lại khi app về foreground mà socket đã rớt), `EquipmentPicker` (không lộ mục nội bộ,
tìm bằng tiếng Việt, chọn cả nhóm, preset "Gym tại nhà" đúng 8 slug).

**Lint:** `pnpm lint` = `expo lint` với `eslint.config.js` (flat config của `eslint-config-expo` 57,
ESLint 9). Kết quả: **0 lỗi, 17 cảnh báo**. 17 cảnh báo đều là luật của React Compiler
(`set-state-in-effect`, `preserve-manual-memoization`, `immutability`) được hạ xuống warn có chủ đích:
app **không bật** React Compiler, và `immutability` báo sai cho cách ghi `sharedValue.value = …` của
Reanimated — đây là backlog nếu sau này bật compiler, không phải lỗi đang chạy. Các lỗi thật lint tìm
ra đã sửa: `Date.now()` trong lúc render (tab Chu kỳ), dependency không ổn định của
`usePullToRefresh`, thiếu dependency trong effect của log.tsx, import thừa/trùng, globals Node/Jest
cho file config. `api.ts` tắt riêng `array-type` (port nguyên văn từ web, giữ diff được).

**Lưu ý hạ tầng:** cài ESLint bằng `pnpm add` lại tháo junction `D:/.rn*` (đúng như memory đã cảnh
báo) — đã dừng Metro trước, chạy lại `node scripts/shorten-package-paths.js`, kiểm junction trỏ đúng
`D:\.rn`, `D:\.rnw`, `D:\.rnr`, `D:\.rngh` rồi mới mở lại Metro.

**Chưa có:** E2E tự động cho luồng Phase 5 trên app RN (Maestro/Detox chưa được dựng); các luồng đầu-cuối
của Phase 5 hiện được kiểm thủ công trên emulator + đối chiếu backend (§20.7, §20.8).

### 20.10 — Màn Đang tập (CL-17) hiện sai buổi đã hoàn thành (2026-09-16)

**Triệu chứng:** buổi hôm nay đã `COMPLETED`, bấm "+" mở lại màn Đang tập thì vẫn thấy "Đang tập", đồng
hồ chạy tiếp từ giờ bắt đầu buổi sáng (721:33), nút "Kết thúc buổi tập".

**Hai nguyên nhân, cả hai đều ở frontend:**
1. Đồng hồ chỉ được seed một lần mỗi workout và luôn `running = true`, không xét `status`.
2. Dữ liệu cũ: `log` là màn trong Stack của tab Tập luyện nên **vẫn mounted** khi đổi tab, và
   `staleTime` 30s toàn app khiến màn mới push vẫn render bản cache. Tái hiện trên emulator: DB đã
   `COMPLETED 4/4` mà màn vẫn "Đang tập", 0/4 set, đồng hồ chạy. Chỉ sửa (1) là chưa đủ.

**Sửa:**
- `sessionClockState(schedule, workout, now)` (thuần, có test): `COMPLETED` thì đồng hồ đứng ở thời
  lượng thật (`completedAt − startedAt`, dự phòng `durationSeconds`, rồi 0), còn lại đếm từ
  `startedAt`/`createdAt`, không âm. Seed lại theo khoá `workoutId:status`.
- Buổi COMPLETED hiện dạng tổng kết: tiêu đề "Buổi tập hôm nay", badge "Đã hoàn thành", nhãn "Tổng
  thời gian", ẩn nút tạm dừng, chân màn là "Về Tập luyện". Set vẫn sửa được (backend cho sửa trong ngày).
- `useFocusEffect` refetch lịch hôm nay + workout mỗi lần màn được focus; hai query của màn này
  `staleTime: 0` (dữ liệu phiên tập sống, không phải catalog). Các dòng set được hydrate lại từ lần
  fetch của lần focus đó; `keepUnsyncedRows` giữ nguyên dòng "chờ đồng bộ" để không mất giá trị chưa
  tới server. Refetch nền không phải do focus vẫn không ghi đè giá trị đang gõ.

**Kiểm:** unit 106/106 (thêm 7 test `sessionClockState`, 3 test `keepUnsyncedRows`), typecheck sạch,
lint 0 lỗi. Emulator + backend thật với một buổi thử của john.doe: đang tập (00:33 → 00:37 chạy) →
bỏ tick 1 set qua API, mở lại màn → "Đang tập" 3/4, đồng hồ chạy → rời màn, tick nốt qua API (DB
`COMPLETED 4/4`, 526s) → mở lại màn → "Buổi tập hôm nay", "Đã hoàn thành", 4/4, **08:46 đứng yên ở
hai ảnh cách 7 giây**, không nút tạm dừng, "Về Tập luyện". Dữ liệu thử đã xoá.


### 20.11 — Ảnh minh hoạ động tác (2026-09-16)

**Ngài hỏi vì sao mobile không có ảnh động tác.** Kiểm lại DB: catalog **không có GIF**. Cột
`exercises.video_url` (873/1090 dòng có giá trị) trỏ tới ảnh **JPG tĩnh** của bộ free-exercise-db, và
mỗi bài có đúng **2 khung**: `.../<Tên bài>/0.jpg` (đầu động tác) và `1.jpg` (cuối); khung `2.jpg` trả
404. Web đã tạo cảm giác ảnh động bằng cách đổi qua lại hai khung mỗi 900ms
(`ExerciseMediaPreview.tsx`). Mobile chưa đọc trường này ở bất kỳ màn nào — thiếu sót khi port, không
phải giới hạn backend; ghi chú cũ ở màn chi tiết còn tưởng nhầm là cần `expo-video`.

**Cách làm:** `src/features/library/exerciseMedia.ts` (thuần, có test) suy ra hai khung theo đúng luật
của web — chỉ viết lại path khi URL thuộc free-exercise-db **và** kết thúc `.jpg`; URL khác giữ nguyên
để không phá link do admin/PT nhập. `src/components/ui/ExerciseMedia.tsx` vẽ ảnh bằng **`expo-image`**
(cache đĩa + bộ nhớ, đúng chiến lược ảnh ở PERFORMANCE_BASELINE), cross-fade 300ms theo nhịp 900ms khi
`animate`, nhãn "Demo", và **giữ nguyên icon quả tạ** cho 217 bài không có media.

**Đặt ở đâu và vì sao:** danh sách bài tập (64px), tìm kiếm (48px), dải "Bài tập có media" ở hub
(80px), màn Đang tập và màn buổi tập đã xong (48px) — tất cả **chỉ khung đầu**; riêng màn chi tiết bài
tập dùng khung 16:9 **có chuyển động**. Danh sách không cho chạy chuyển động: 30 dòng tự đổi khung theo
30 bộ đếm riêng là chuyển động thừa và là việc vô ích cho luồng cuộn. `normalizeWorkout` mang thêm
`mediaUrl` để màn Đang tập không phải tự đi tra catalog.

**Hai lỗi gặp khi làm, đều do Tại hạ:**
1. Đặt `{/* … */}` làm biểu thức ngay sau nhánh ternary → Metro báo `TransformError SyntaxError`, máy
   ảo **chạy tiếp bundle cũ** nên sửa mới trông như không có tác dụng. Bài học: khi sửa mà màn hình
   không đổi, mở LogBox đọc lỗi trước, đừng suy đoán layout.
2. Thẻ trong `ScrollView` ngang bị kéo cao hết màn vì `alignItems` mặc định là `stretch` — các chip chỉ
   có chữ trước đây không lộ ra; thêm `items-start` cho `contentContainerClassName`.

**Kiểm trên emulator + backend thật:** `/exercises` trả đúng `videoUrl` (danh sách, chi tiết,
`hasVideo=true`); hub, danh sách (kể cả sau khi cuộn 3 lần), tìm kiếm, chi tiết đều hiện ảnh; chi tiết
đổi khung thật (nằm xuống → gập bụng lên) với nhãn "Demo"; bài Push-Ups (`video_url` NULL) hiện icon dự
phòng ở màn buổi tập. Unit 113/113, typecheck sạch, lint 0 lỗi.

**Chưa đo:** ảnh hưởng của ảnh tới frame drop khi cuộn danh sách dài — cần đo trên máy thật cùng đợt
với mục hiệu năng còn treo (§20.7).

### 20.12 — SH-02 màn intro lần đầu (2026-09-16, món sót của Phase 4)

**Vì sao đến giờ mới làm:** manifest ghi SH-02 "chưa làm" từ Phase 4 và **không** tài liệu nào ghi là
hoãn có chủ đích — tức sót thật, phát hiện khi rà lại toàn bộ Phase 1→5.

**Nguồn:** chỉ có bản thiết kế (`New Frontend/src/screens/Onboarding.tsx`); web không có màn tương
đương (vào thẳng `/login`), nên không có hành vi nào để port. Màn này không gọi API.

**Ba quyết định đáng ghi:**
1. **Đặt ở gốc `app/welcome.tsx`, không trong `(auth)`.** Group `(auth)` đệm safe-area phía trên cho
   các màn form; để trong đó thì ảnh nền không chạy lên dưới status bar được như thiết kế.
2. **Hiện 1 lần mỗi lần cài**, cờ `intro.seen` trong AsyncStorage (`Preferences`). Cả "Bỏ qua" lẫn
   "Bắt đầu ngay" đều ghi cờ — cả hai đều nghĩa là "đã xem". Đọc cờ **chỉ khi chưa đăng nhập**:
   người đang có phiên không bao giờ thấy màn này, và cold start tới Trang chủ vốn đã là đường chậm
   nhất (`PERFORMANCE_BASELINE.md`), không nên cõng thêm một lượt đọc bộ nhớ.
3. **Tên thương hiệu — ĐÃ CHỐT: "Gymini"** (Ngài quyết 2026-09-16, "tên chính thức của hệ thống").
   Trước đó ba nơi ghi ba kiểu: thiết kế "Gymini", web "Fitness AI" (`RegisterPage.tsx`), `app.json`
   "FitnessAssistant". Web thật ra đã dùng Gymini ở khắp nơi (bộ icon `Gymini*Icon`, token trong
   `theme.css`) — chỗ ghi "Fitness AI" mới là ngoại lệ.
   **Đã đổi trong mobile:** chữ trên màn intro, `expo.name` và 4 chuỗi xin quyền trong `app.json`.
   **Cố ý KHÔNG đổi:** `scheme` (`fitnessassistant`), `slug`, `bundleIdentifier`/`package`
   (`vn.fitnessassistant.app`) — Phase 15 bắt buộc giữ nguyên deep-link scheme và applicationId khi
   cutover; đổi chúng là mất deep link và mất đường cập nhật của bản đã cài.
   **Lưu ý:** `expo.name` và chuỗi xin quyền chỉ đổi trên máy sau một lần **build native lại** (nhãn
   launcher nằm trong `strings.xml` do prebuild sinh ra) — gộp vào đợt build của Phase 14.
   **Chưa đổi, cần Ngài cho phép riêng:** web `RegisterPage.tsx` ghi "Fitness AI"; backend ghi
   "AI Gym Coach" ở tiêu đề email xác minh, email đặt lại mật khẩu và trang trả về VNPay.

**Lỗi tự gây, bắt được trên máy ảo:** `finish()` điều hướng cứng tới `/login`, nên người **đang đăng
nhập** mở màn này (deep link, hoặc cài lại mà keychain còn) bấm xong lại rơi vào form đăng nhập. Sửa:
`router.replace("/")` để route gốc tự chọn đích theo vai trò.

**Kiểm trên emulator:** 3 slide đúng thiết kế (ảnh nền + lớp phủ chuyển sắc, ô icon, tiêu đề 2 dòng,
chấm nở rộng ở slide hiện tại); slide cuối bỏ "Bỏ qua" và đổi nút thành "Bắt đầu ngay"; "Bỏ qua" khi
đang đăng nhập → vào thẳng Trang chủ. Typecheck sạch, lint 0 lỗi.

### 20.13 — Bấm thử trên trình duyệt GAP-4/GAP-5 (2026-09-16)

Món hoãn số 2 của Phase 5. Chạy bằng Playwright (bộ sẵn có ở `D:\fitnessassistant-playwright-e2e`)
trên `vite dev`, khung nhìn 420×900 cho giống điện thoại. **7/7 pass:**

| Kiểm | Kết quả |
|---|---|
| `/quen-mat-khau` mở được | ✅ |
| Trả lời đồng nhất, không tiết lộ email có tài khoản hay không | ✅ "Nếu `khong-co-tai-khoan-gap4@example.com` có tài khoản…" — dùng email KHÔNG có tài khoản nên không có hộp thư thật nào nhận thư thử |
| Nút gửi lại có đếm ngược và bị khoá | ✅ "Gửi lại sau 60s", `disabled` |
| "Dùng email khác" quay lại form | ✅ |
| Đăng ký → bước nhập OTP | ✅ |
| Nút "Gửi lại" OTP khoá kèm đếm ngược | ✅ "Không nhận được mã? Gửi lại sau 60s" |
| Đếm ngược chạy thật | ✅ 60s → 56s sau 4 giây |

**Dọn dẹp:** bài test đăng ký tạo 1 dòng `email_verifications` (chưa có `users` vì chưa xác minh) —
đã xoá. Kịch bản giữ ở scratchpad, không commit vào repo.

**Lưu ý hạ tầng:** `pnpm` không có trong PATH của shell nền → chạy Vite bằng
`node node_modules/vite/bin/vite.js`. Và trong ESM của Node trên Windows, `"/d/..."` bị hiểu thành
`C:\d\...`; phải dùng `file:///D:/...`.

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

---

## 22. Client B (Dinh dưỡng + InBody) — quyết định đã THỰC THI ở Phase 6

### 22.1 — Cụm Dinh dưỡng (CL-03 / CL-19)

**Route nằm dưới tab Tập luyện** (`workout/nutrition/…`), đúng tài liệu 08 §4.2 và quyết định của
Ngài ngày 13/9: Dinh dưỡng là điều hướng con của một tab lớn, không phải tab thứ sáu. Cửa vào là nút
quả táo ở đầu tab Tập luyện.

**Ba luật của backend mà giao diện phải tôn trọng** (đều kiểm bằng API thật, không đọc code suông):
1. API lưu và trả **`fats`**, không phải `fat`. **Web đang đọc `log.fat` khi cộng ngày → tổng chất
   béo trên web luôn bằng 0.** Đây là lỗi thật của web, Tại hạ ghi lại chứ chưa sửa vì web đang đóng
   băng. Mobile đọc `fats`, giữ `fat` làm dự phòng.
2. `POST /nutrition` kiểm macro bằng `z.number().positive()` → **gửi 0 là 400**. Payload bỏ hẳn macro
   rỗng thay vì gửi 0; một món không có đạm là sự thật về món đó, không phải lỗi người dùng.
3. `PUT /nutrition/goals` từ chối mục tiêu mà macro không cộng ra đúng calo (Atwater 4/4/9, ±50 kcal).
   Màn Mục tiêu chạy đúng phép kiểm đó tại chỗ, và preset **co giãn macro theo calo mới** thay vì chỉ
   đổi con số calo như bản thiết kế — nếu không thì mọi preset đều bị máy chủ từ chối.

**Tổng của ngày:** lấy `dailyTask.actualProgress` khi có chương trình (số của máy chủ), còn lại thì
cộng từ nhật ký — đúng thứ tự ưu tiên của web.

**Cố ý không dựng:** thẻ "Nhiệm vụ AI hôm nay" chỉ hiện khi **thật sự có chương trình dinh dưỡng**
(`hasProgram`), vì không có chương trình thì không có nhiệm vụ nào để nói; ô "Nước TB/ngày" ở Tổng
kết tháng bị bỏ vì sản phẩm không ghi nhận lượng nước uống ở đâu cả.

**Đối chiếu phép tính macro (tiêu chí "Xong khi" của Phase 6):** thêm "Almond chicken" 150g →
app xem trước 293 kcal · 23.5P · 6.8C · 19.8F → backend lưu **đúng từng số** → màn hình cộng
643/2.000 kcal · 36/150 · 65/200 · 27/65, khớp tổng backend (643 · 35,5 · 64,8 · 26,8).

### 22.2 — InBody (CL-14)

**Ảnh vào bằng hai đường, không chỉ camera.** `POST /inbody/upload` nhận multipart `image`, chấp nhận
**image/jpeg, image/png, application/pdf**, đuôi `.jpg/.jpeg/.png/.pdf`, tối đa **5 MB**, và không
quan tâm ảnh từ đâu — web cũng chỉ là `<input type="file" accept="image/*">`. Mobile vì thế có cả
**Chụp phiếu đo** lẫn **Chọn ảnh từ thư viện** (`expo-image-picker`, `quality: 0.6` vừa nén xuống
dưới 5 MB vừa ép về JPEG cho khớp danh sách cho phép).

**OCR không bao giờ tự lưu.** `/inbody/upload` chỉ trích xuất; màn "Kiểm tra kết quả quét" là nơi
người dùng đối chiếu rồi mới `POST /inbody`. Giống web, và là thứ tự duy nhất trung thực — OCR trên
ảnh chụp phiếu giấy là phỏng đoán cho tới khi có người xác nhận.

**Khối cơ là bắt buộc trong form** dù bản thiết kế chỉ đánh sao cho cân nặng: cột `muscleMass` không
nullable và thiếu nó thì máy chủ trả **500 trần** (xem GAP-9). Mỡ thì máy chủ tự suy từ
`cân nặng × %mỡ`, nên form chỉ hỏi phần trăm và hiện trước số kg sẽ được lưu.

**Cố ý không dựng:** "Điểm cơ thể" (thang 0-100) và thẻ "Phân tích AI" trong bản thiết kế **không có
cột, không có endpoint, web cũng không có** → biểu đồ lịch sử vẽ cân nặng thật thay cho điểm số bịa.
(Web có nhắc "AI" nhưng là AI **trích xuất số từ ảnh**, không phải một đoạn nhận xét.)

**"Nước cơ thể" — nói cho chính xác:** phiếu InBody (`InBodyEntry` của user-service) không có trường
nước. Có một cột `body_water` ở bảng **khác** (`body_metrics` của fitness-service) nhưng **không route
API nào đọc nó** — chỉ dịch vụ xuất dữ liệu chạm tới. Vậy nên không hiện, và lý do là "không có đường
lấy ra", không phải "sản phẩm không có khái niệm nước".

**Phân tích theo vùng — Tại hạ từng ghi nhầm là "cố ý bỏ", thật ra là SÓT (đã sửa 16/9):** web có mục
"Phân tích cơ thể theo vùng" (sơ đồ cơ/mỡ cho tay T-P, thân, chân T-P), form nhập tay của web cho nhập
đủ 10 trường, OCR cũng đọc được, và DB đang có **4.354 phiếu có dữ liệu theo vùng**. Mobile nay hiện
hai thẻ "Cơ theo vùng" / "Mỡ theo vùng" — chỉ khi phiếu thật sự có số liệu — dùng **đúng mức tham
chiếu và ngưỡng của web** (tay 3,2 / thân 24 / chân 9,5 kg cho cơ; 1,0 / 8,0 / 2,3 kg cho mỡ; dưới 90%
là Thấp, trên 110% là Cao). Form cũng có đủ 10 ô, để tuỳ chọn và mở rộng khi cần.

**Vẽ bằng hình người (`react-native-svg`), theo yêu cầu của Ngài 16/9.** Bản đầu Tại hạ làm dạng 5
hàng thanh ngang và lập luận rằng hình người tốn bề ngang — sai: hình người đọc nhanh hơn hẳn. Hình
học lấy đúng của web (`viewBox 100×220`: đầu, thân, hai tay, hai chân) để hai client vẽ cùng một cơ
thể, **nhưng khác một điểm có chủ đích**: web để hình xám và ghi số bên cạnh, mobile **tô chính từng
vùng** theo mức so với tham chiếu (Thấp 32% đục · Bình thường 66% · Cao 100% · không có số liệu 12%),
nên hình dáng tự nói trước khi đọc số — tay trái 84% hiện tối rõ bên cạnh tay phải 106%. Nhãn vẫn là
`Text` của RN đặt hai bên (không phải `<Text>` trong SVG) để giữ đúng font của app và xuống dòng được.

**Hai lỗi nhỏ sửa ngay sau lần chụp đầu:** nhãn dính sát tay/chân (khoảng cách cột quá hẹp), và ô màu
chú thích tàng hình vì đặt kích thước bằng class — phải đặt `width/height` bằng style thật.

**Phiếu không có số liệu theo vùng thì ẨN HẲN thẻ — Ngài quyết 2026-09-16.** Hai phiếu thật của
john.doe đều để trống cả 10 cột (phiếu nhập tay hầu như luôn vậy; chỉ phiếu chụp từ máy InBody mới có),
nên màn Tổng quan của tài khoản đó không thấy hình người — **đúng như thiết kế, không phải lỗi**. Tại
hạ có đề xuất thay bằng một thẻ rỗng kèm lời mời nhập, Ngài chọn giữ nguyên cách ẩn. Đừng "sửa" ngược
thành hiện thẻ với mọi vùng 0 kg: người xem sẽ tưởng cơ thể mình bằng 0 hoặc tưởng app hỏng.

### 22.3 — Bốn lỗi tự gây, bắt được trên máy ảo

1. **Bàn phím che kín BottomSheet** khi tìm món: sheet là `Modal` nên không co theo `adjustResize`.
   Tách luồng thêm món thành màn riêng; sheet chỉ còn dùng cho hộp xác nhận không có ô nhập.
2. **Màn không tải lại khi quay lại** (giống §20.10): xoá một món qua API mà màn vẫn hiện. Thêm tải
   lại theo `useFocusEffect` cho cả Dinh dưỡng lẫn InBody.
3. **Cột biểu đồ tàng hình:** trong hàng `items-end`, cột lấy chiều cao theo nội dung nên chiều cao
   phần trăm của thanh bar ra 0. Phải cho vùng vẽ một chiều cao thật (`h-24`).
4. **Lưu xong không quay lại màn trước:** `router.back()` không làm gì khi màn đang là gốc của stack
   (mở thẳng bằng deep link). Dùng `canGoBack()` rồi mới `back()`, không thì `replace`.

### 22.4 — Thư viện thực phẩm (SH-13) và Kiến thức dinh dưỡng (SH-16), 2026-09-17

**SH-13 — bản thiết kế lọc theo "nhóm thực phẩm", dữ liệu thì không có thứ đó.** Bảng `Food` không
có cột nhóm; chính web đã ghi chú điều này rồi đưa ra thứ tính được: sắp xếp theo macro
(`sortBy=name|protein|carbs|fats`) và lọc theo nguồn / dạng / thực phẩm bổ sung / có ảnh. Mobile giữ
đúng bố cục thiết kế (ô tìm, hàng chip, mỗi dòng có ảnh + macro) nhưng chip mang nghĩa thật.

**Tìm và duyệt là hai endpoint khác nhau:** `/food/search` khớp mờ, trả mảng trần, **không phân
trang**; `/food` phân trang toàn bộ 13.159 món. Nên khi đang tìm thì hàng chip sắp xếp/lọc **ẩn đi**
thay vì giả vờ có tác dụng — giống web.

**SH-16 gọi 0 endpoint.** Nội dung là 12 bài tĩnh, **chép nguyên văn** từ
`frontend/web/.../nutritionKnowledge.ts` sang `src/features/library/nutritionKnowledge.ts` (có ghi
chú tắt luật `array-type` để giữ y bản gốc, còn diff được khi web sửa). Spec đứng sau nội dung này
yêu cầu bài viết phải ổn định, không sinh live bằng mô hình — nên chép là đúng, không phải lười.
Bản thiết kế vẽ ảnh cho mỗi bài; nội dung thật **không có ảnh**, nên thẻ dẫn bằng nhãn nhóm + thời
gian đọc thay vì một tấm ảnh bịa. Nút "Hỏi AI về chủ đề này" của web thuộc domain AI Coach (Phase 9),
chưa dựng.

**Gỡ xong hai món nợ ở §20.5:** hub Khám phá nay có đủ 4 dải xem trước (bài tập, thực phẩm, kiến
thức, nhóm cơ) và màn Tìm kiếm có đủ 4 nhóm kết quả. Nhóm kiến thức được khớp **ngay trong máy** chứ
không gọi mạng, nên một lần tìm vẫn chỉ tốn 2 request.

**Một lỗi bố cục lặp lại lần thứ ba:** `ScrollView` ngang để trần trong một cột sẽ nở hết chiều cao
còn lại, đẩy danh sách xuống dưới màn hình. Phải bọc trong `View` (đúng như màn thư viện bài tập đã
làm). Đây là lần thứ ba cùng một lỗi trong dự án — nếu gặp một hàng chip bị giãn, hãy nhìn ngay vào
chỗ này.

### 22.5 — Thống kê (CL-15), 2026-09-17

**Một màn ba phân đoạn, không phải ba trang.** Bản thiết kế gom Hoạt động / Nhóm cơ / Tiến bộ sau một
`Segmented`; web tách thành ba trang riêng. Trên điện thoại bản thiết kế đúng hơn, và đó cũng là nơi
nút "Thống kê" ở Trang chủ đang trỏ tới (`/client/stats/activity`). Biểu đồ tiến bộ của từng bài tập
vẫn là màn riêng (`stats/exercise-progress/[id]`) vì nó cần cả bộ chọn chỉ số.

**Số liệu mẫu trong bản thiết kế KHÔNG được bê vào làm mặc định.** Mock ghi "chuỗi 24 ngày", "186
buổi tập"; màn thật lấy `currentStreakDays`/`totalWorkouts` từ `/stats/workouts`, nên tài khoản mới
đọc ra 0 và 1 — đúng sự thật, không phải một con số cho đẹp.

**Chỉ số nào vẽ được là do kiểu ghi của bài tập quyết định** (bảng lấy từ web): bài trọng lượng cơ
thể không có 1RM để ước tính, bài tính giờ không có khối lượng, và với **tốc độ thì số nhỏ hơn là
tốt hơn** — nên `summarize()` nhận cờ `lowerIsBetter` thay vì mặc định "tăng là tốt".

**Một lỗi thật do test bắt được trước khi lên máy:** `seriesFor` dùng `Number.isFinite(Number(x))` để
lọc, mà `Number(null)` bằng **0** — buổi không ghi chỉ số bị vẽ thành 0. Đúng cái bẫy mà chính doc
comment của hàm đó cảnh báo. Đã lọc `null/undefined` tường minh. Kiểm trên máy: Push-Ups (REPS_LOAD)
có `maxWeightKg` toàn null → màn hiện "Chưa có số liệu cho chỉ số này" thay vì một cột 0 kg, đổi sang
"Số lần lặp" thì ra đúng 12 reps ngày 15/09.

**Thư viện biểu đồ — quyết định Phase 5 vẫn đứng nhưng chưa dùng tới.** `react-native-gifted-charts`
đã cài và **chạy được trong Expo** (nó thử `react-native-linear-gradient`, không có thì rơi về
`expo-linear-gradient`, thứ dự án đã có). Tuy vậy ba biểu đồ của Phase 6 (lưới hoạt động, thanh nhóm
cơ, cột tiến bộ) đều là hình đơn giản, vẽ tay bằng `View`/`react-native-svg` gọn hơn là kéo cả một
thư viện biểu đồ vào — giữ gifted-charts cho biểu đồ phức tạp hơn ở phase sau.

### 22.6 — Hai ô chỉ số trên Trang chủ, và tầng kiểm thử service/API (2026-09-17)

**Ô "Nước" của bản thiết kế không có nguồn dữ liệu — không phải mobile quên gọi.** Rà thẳng backend:
`NutritionGoal.waterMl` là **mục tiêu** (đọc/ghi được ở `GET|PUT /nutrition/goals`, màn Mục tiêu dinh
dưỡng đã dùng), `NutritionLog` không có trường nước, không có route nào ghi lượng nước uống, còn
`BodyMetrics.body_water` là **% nước trong cơ thể** của phép đo InBody và **không route nào đọc nó**.
Vẽ một ô "— / 3.0 L" vĩnh viễn rỗng thì tệ hơn là không vẽ, nên cặp ô dinh dưỡng của Trang chủ là
**Calo hôm nay + Đạm hôm nay**, cả hai đều là số thật. Ghi thành GAP-10 trong
`MOBILE_BACKEND_GAPS.md`. Cặp ô cơ thể (Cân nặng / Cơ bắp) mà web vẫn hiện ở màn này được giữ, nằm
ngay dưới — Trang chủ nay có hai hàng ô thay vì một.

**Số calo phải khớp với màn Dinh dưỡng, không được tự tính kiểu khác.** Trang chủ dùng đúng ba nguồn
của `nutrition/index.tsx`: `actualProgress` của `/nutrition/daily-task` khi có chương trình, nếu không
thì `sumTotals(normalizeLogs(...))` trên nhật ký trong ngày. Trang chủ là gốc của tab nên **vẫn nằm
trong bộ nhớ** lúc người dùng ghi bữa ở màn khác; thiếu `useFocusEffect` refetch thì ô vẫn là con số
trước bữa ăn suốt 30 giây `staleTime` — lỗi hệt CL-17 ở §20.x, lần thứ tư của cùng một cái bẫy.

**Tầng kiểm thử mới: `test:components` giờ chạy cả service/API test.** `jest.config.js` thêm
`<rootDir>/src/services/__tests__/api/**/*.test.ts` vào `testMatch` (thư mục con `api/` để không giẫm
lên `test:unit`, vốn quét `src/**/__tests__/*.test.ts` bằng `tsx --test`). Cách làm:
`src/services/__tests__/api/httpStub.ts` chỉ thay **adapter** của axios instance thật — baseURL,
interceptor request/response, cách axios dựng query và body đều chạy thật; chỉ cái mở socket là giả.
Lỗi trả về được ném đúng dạng `AxiosError` kèm `response`, nên interceptor nhìn thấy đúng thứ nó sẽ
thấy với gateway thật.

Ba thứ phải mock trong `jest.setup.js` mới nạp được `services/api.ts`: AsyncStorage (dùng mock
in-memory chính package phát hành), `expo-secure-store` (Map in-memory) và `expo-file-system`/
`expo-sharing` (module native, `services/files.ts` import ở tầng đầu). Không có chúng thì suite chết
ngay lúc import, chưa kịp chạy test nào.

**24 test cho hai domain**, mỗi test bám một hợp đồng đã tự tay kiểm với backend: `fats` chứ không
phải `fat` (đúng cái làm web cộng ra 0 g mỡ), bỏ hẳn macro bằng 0 vì `z.number().positive()`, 400 của
Atwater ±50 kcal, envelope `data.data` chỉ có ở nhóm endpoint chương trình, `/inbody` trả mảng không
thứ tự nên sắp xếp là việc của client, 500 khi thiếu `muscleMass` (GAP-9), `/inbody/upload` chỉ
TRÍCH XUẤT chứ không lưu, và không hề có `DELETE /inbody/:id`.

**Ba thứ của môi trường phải sửa mới chạy được tầng này** (đều là nợ có sẵn, không do Phase 6 sinh ra):
1. `jest` phải chạy **qua pnpm** (`pnpm test:components`), không gọi `node node_modules/jest/bin/jest.js`
   trực tiếp: pnpm mới đặt `NODE_PATH` tới `node_modules/.pnpm/node_modules`, thiếu nó babel không tìm
   thấy `babel-preset-expo` và cả suite đỏ vì lý do hoàn toàn giả.
2. `@types/node` chưa được khai báo ở `frontend/mobile` (pnpm strict nên không nhìn thấy bản ở gốc).
3. TypeScript đã ghim `~6.0.3`: `baseUrl` bị khai tử (TS5101 làm hỏng cả lượt chạy) và `types` không
   còn tự gom. `tsconfig.json` nay bỏ `baseUrl` (từ TS 5.0, `paths` tự tính theo vị trí file config)
   và khai báo `"types": ["node", "jest"]`. Trước khi sửa: 298 lỗi, toàn lỗi ma trong file test.

Kết quả sau khi sửa: `test:unit` 185/185, `test:components` **55/55 (9 suite)**, `typecheck` 0 lỗi,
`lint` 0 lỗi / 19 cảnh báo (đều là luật React Compiler đã ghi ở §18.6, không phải từ code mới).


### 22.7 — WB-14 "Smart Substitute" vá vào Phase 6 (2026-09-18)

- **Thẻ** `src/components/nutrition/BeginnerNutritionSummary.tsx`, đặt giữa thẻ tổng calo và thẻ chương trình
  trong `client/workout/nutrition/index.tsx` (đúng thứ tự web). Logic thuần ở
  `src/features/nutrition/foodSuggestions.ts` (13 unit test), 6 service test mới cho 3 endpoint + `dailySummary`.
- Ẩn hẳn khi `dailySummary` null — tức tài khoản chưa có NutritionGoal thật (`GET /nutrition/goals` vẫn trả
  mặc định 2000 kcal nhưng đó không phải bản ghi, fitness-service không dùng nó làm mục tiêu).
- Gợi ý chỉ tải khi bấm (như web). Lựa chọn đổi món gắn với `dataUpdatedAt` của truy vấn gợi ý, dữ liệu mới
  thì tự hết hiệu lực — thay cho `useEffect` reset của web (lint React Compiler cấm setState trong effect).
- "Thêm bữa này" → `POST /nutrition/food-suggestions/apply`; server tự chọn bữa theo giờ. Sau đó làm mới
  `nutrition-daily-task`, `nutrition-logs` (mobile có danh sách log riêng — web không cần), `food-suggestions`.
- Ngân sách/vùng miền: web ở Cài đặt › Dinh dưỡng; mobile chưa có Cài đặt (Phase 9) nên mở tạm từ dòng
  "Tuỳ chỉnh" trong thẻ, BottomSheet. Không bỏ chọn vùng miền được → **GAP-12**.
- **Kiểm trên máy ảo (john.doe):** thẻ hiện đúng 2.000 kcal/150 g; mở gợi ý ra 3 phương án; đổi món "Rẻ hơn"
  ra 3 ứng viên, chọn Tofu thay tại chỗ; "Thêm bữa này" → backend có đúng 2 log (Tofu 432 + Rice 390, bữa
  snack), `dailySummary.consumedCalories` = 822, màn hình cập nhật 1.178 kcal còn lại, nút thành "Đã thêm".
  Đã xoá 2 log thử sau đó.
- **Điều kiện môi trường:** engine tìm món bằng bí danh tiếng Việt (`food_aliases`). DB local có 13k món USDA
  nhưng **0 bí danh** → mọi gợi ý rỗng. Đã chạy seed có sẵn trong repo
  (`docker exec gymcoach-fitness-dev ./node_modules/.bin/tsx prisma/seed_food_aliases.ts`, 2.731 bí danh).
  DB mới dựng lại phải chạy lại bước này.
- **Sự cố kéo theo từ lần merge aws-deploy:** lockfile của nhánh đó nâng `nativewind` 4.2.6 → 4.2.7, kéo
  `react-native-css-interop` 0.2.7 trong khi mobile ghim 0.2.6 → hai bản css-interop, mọi `className` mất
  style, app chỉ còn thanh tab (bị đẩy lên đầu) trên nền trống. Sửa: ghim `nativewind` đúng `4.2.6` trong
  `package.json`, `pnpm install`, Metro `--clear`. Sau mỗi lần merge/đổi lockfile, kiểm
  `ls node_modules/.pnpm | grep css-interop` chỉ còn một bản.

## 23. Client C (Dịch vụ & luồng tiền) — Phase 7

### 23.1 — Đối chiếu trước khi code: backend ↔ doc 01/02 (17/9)

Đọc theo đúng thứ tự nguồn sự thật. **Không có xung đột nghiệp vụ** — `01-luong-hop-dong-pt-buoi-
tap-tranh-chap.md` và `02-luong-hoi-vien-phong-gym.md` khớp code đang chạy (đúng tên trạng thái,
đúng 7 lý do chấm dứt, đúng `PENDING_ISSUE`, đúng `multiGymWarned`). Ba điểm cần nhớ khi dựng màn:

1. **Hợp đồng PT trả tiền qua CỔNG, không phải ví.** `POST /contracts/:id/pay` gọi
   `paymentClient.checkout(...)` với `provider` + `returnBaseUrl` — giống hệt mua gói hội viên.
   Comment "via wallet" còn sót trong `contract.routes.ts` là comment cũ, code mới đúng.
   ⇒ Phase 7 dừng ở "đã tạo, chờ thanh toán"; mở cổng là Phase 14.
2. **`PENDING_SIGNATURE` không xảy ra trong thực tế**: `REQUIRE_CONTRACT_ESIGN: "false"` ở cả
   user-service lẫn gateway trong `infra/compose/docker-compose.dev.yml` (quyết định sản phẩm đã
   chốt, không phải bypass tạm). PT bấm nhận → đi thẳng `PENDING_REVIEW → PENDING_PAYMENT`.
   ⇒ **không dựng màn ký điện tử**, nhưng UI vẫn phải hiển thị được trạng thái đó nếu gặp.
3. Ba máy trạng thái phải theo backend: hợp đồng 8 trạng thái; buổi tập 8 trạng thái với **chỉ
   `COMPLETED` mới trừ quota**; hội viên 5 trạng thái (kể cả `PENDING_ISSUE`).

### 23.2 — Tìm PT + Chi tiết PT + Yêu cầu hợp đồng (CL-04 một phần, CL-10, CL-11)

**Hai endpoint PT trả hai hình dạng khác nhau** — cái bẫy lớn nhất của cụm này:

| | `GET /profile/pts` (danh sách) | `GET /profile/pts/:id` (chi tiết) |
|---|---|---|
| `ptApplication` (hình thức, giới thiệu, **giá**) | ✅ | ❌ |
| `availableSlotsNext28Days` | ✅ | ❌ |
| `recentReviews`, `ratingDistribution` | ❌ | ✅ |

Web không bao giờ vấp phải vì panel chi tiết của nó giữ nguyên dòng vừa bấm. Màn được PUSH thì
không có dòng đó, nên `mergePtSources()` ghép hai nguồn: chi tiết thắng ở trường nó có, danh sách
lấp phần còn lại. Nếu chỉ đọc chi tiết, PT sẽ tự nhiên bị hạ cấp thành "chưa cho biết hình thức",
không giá, không giới thiệu — đúng cái tại hạ nhìn thấy trên máy trước khi sửa.

**Giá trên thẻ PT** là `min(onlinePricePerSession, offlinePricePerSession, desiredSessionPrice)`
(đúng công thức của web), và 0 **không phải** là giá — PT chưa báo giá thì hiện "Chưa báo giá".

**Yêu cầu hợp đồng gửi `packageId`, không gửi giá**: gói là nguồn sự thật của máy chủ về giá/số
buổi/hình thức. Gym chỉ gắn với gói **OFFLINE**. `409 LOW_AVAILABILITY` **không phải lỗi** mà là
câu hỏi ("PT còn ít khung giờ hơn số buổi, vẫn gửi chứ?") — sheet xác nhận rồi gửi lại với
`acknowledgedLowAvailability: true`; body thiếu một trong hai con số thì coi như **không phải**
cảnh báo đó, thà không cảnh báo còn hơn cảnh báo bằng số đoán.

**`GET /pt/:id/gyms` lồng id**: `{ collaborationId, gym: { id, name, city }, rates }` — đọc
`row.id` là lấy nhầm id của HỢP TÁC và gửi lên một `gymId` máy chủ chưa từng thấy. Danh sách này
còn rộng hơn điều kiện tạo hợp đồng (GAP-11), nên nhánh lỗi phải hiện nguyên văn thông điệp máy
chủ chứ không nuốt.

**Ba lỗi tự gây, bắt trên máy ảo:**
1. `<Badge>{số} chữ</Badge>` → "Text strings must be rendered within a `<Text>` component":
   `Badge` chỉ tự bọc `<Text>` khi con là **một chuỗi**; truyền mảng là chữ lọt ra ngoài. Sửa bằng
   template string.
2. Đọc `gym?.name` ở tầng ngoài → cả 8 dòng đều hiện "Phòng gym" (tên nằm ở `gym.gym.name`).
3. Chụp màn hình sau 8 giây rồi kết luận "bấm không ăn": toast **hiện ở ĐỈNH** màn hình và tự tắt
   sau 2,2 giây. Muốn kiểm nhánh lỗi thì phải chụp trong ~2 giây và cắt đúng phần đỉnh.

**Kiểm thật end-to-end (17/9)**: hợp đồng `021e8614-43aa-4b5a-b0b0-3ee39ee88a35` — PENDING_REVIEW,
"Gói 10 buổi tăng cơ", 3.000.000 đ, `source: GYM`, `ptRate 0.5 / gymRate 0.4` **lấy từ thoả thuận
hợp tác thật** (không phải giá trị mặc định), và tài khoản PT gọi `/contracts/pt` thấy đúng hợp
đồng đó. 27 unit test cho tầng logic của cụm này.

### 23.3 — Phòng gym, gói hội viên, và "Hội viên của tôi" (CL-09, hai tab của CL-04)

**Hai trục trạng thái, không phải một.** Một phòng gym có `status` (duyệt) và `operationalStatus`
(vận hành) độc lập nhau; `membershipService.purchase` chặn ở **cả hai**, và webhook kích hoạt còn
kiểm lại lần nữa (gym đóng cửa giữa lúc thanh toán → hợp đồng rơi vào `PENDING_ISSUE`, không phải
huỷ). Màn hình nào chỉ đọc một trục sẽ vui vẻ bán gói ở một phòng gym đã đóng cửa.

**Gói thuộc THƯƠNG HIỆU, không thuộc chi nhánh** — đúng bất biến one-owner-one-brand. Mua qua một
chi nhánh nhưng dùng được ở mọi chi nhánh cùng thương hiệu, nên màn nói thẳng câu đó thay vì để
người dùng đoán.

**Giá gói về dạng chuỗi.** `price` là Decimal của Prisma, JSON hoá thành `"300000"`. Cộng thẳng là
ra nối chuỗi, nên `normalizePlan` ép `Number()` ngay tại biên.

**Cảnh báo đa gym là CẢNH BÁO.** `GET /gyms/:gymId/membership-warnings` trả danh sách gym khác mà
khách còn gói hiệu lực; nó không bao giờ chặn mua (money-flow §2.6). Xác nhận của khách đi kèm
request thành `multiGymWarned` — **bằng chứng đã được báo**, không phải cái khoá.

**Một khách chỉ có một gói MỞ tại mỗi gym** (unique index ở DB, không chỉ luật ứng dụng). Vì thế
`purchaseBlockedReason` phân biệt rõ hai trường hợp — đang có gói hiệu lực, và đang có gói chờ
thanh toán — và tab Hội viên có nút **Huỷ yêu cầu** cho cái thứ hai, đúng mục đích mà route
`/me/gym-memberships/:id/cancel` sinh ra.

**Dừng ở "chờ thanh toán" một cách có chủ đích.** `purchase` tạo hàng membership TRƯỚC khi thử
thanh toán, nên Phase 7 gọi nó **không kèm `provider`**: gói được giữ ở `PENDING_PAYMENT`, giao diện
nói thật là cổng thanh toán mở ở bản sau, và không mở trình duyệt nào cả (đó là Phase 14).

**Kiểm thật (17/9)**: gói `3df3f15e-23a5-4a78-8d20-197183dd941b` — PENDING_PAYMENT, 300.000 đ,
30 ngày, đúng giá gói; bấm "Huỷ yêu cầu" trên máy → CANCELLED, xác nhận lại ở backend. 19 unit test
cho tầng logic của cụm này.

**Một hạn chế còn lại, đã biết:** hàng membership chỉ có `gymId`, không có tên gym, nên tab Hội viên
ghép tên từ danh sách gym công khai. Gym nào không còn nằm trong danh sách công khai (bị gỡ duyệt,
đóng vĩnh viễn) sẽ hiện nhãn chung "Phòng gym" — thà vậy còn hơn bịa tên.

**Một bài học về công cụ, không phải về code:** `.expo/types/router.d.ts` sinh ra trong lúc đang ghi
file có thể chứa route rác (lần này là `/../src/features/services/gymDirectory`). Khởi động lại
Metro với `--clear` là hết — đừng đi sửa code theo một file sinh tự động đang dở dang.

### 23.4 — Tab Hợp đồng (CL-04 hoàn tất)

**Kết thúc một hợp đồng là HAI endpoint khác nhau, không thể gộp.** Chưa phát sinh tiền
(`PENDING_REVIEW` / `PENDING_SIGNATURE` / `PENDING_PAYMENT`) thì `PATCH /contracts/:id/cancel` —
chỉ lật trạng thái, không có gì để hoàn. Đã `ACTIVE` thì `POST /contracts/:id/terminate` kèm **lý
do**, và lý do chọn công thức hoàn tiền. Giao diện gọi hai cái đó bằng hai nhãn khác nhau ("Rút yêu
cầu" / "Chấm dứt hợp đồng") thay vì một nút chung.

**Khách chỉ được chọn 2 trong 7 lý do**: `CLIENT_CANCELLED` (tự dừng, mất một phần giá trị chưa
dùng) và `PT_REPEATED_NO_SHOW` (quyền của khách sau nhiều lần PT vắng mặt **đã được xác nhận** —
máy chủ tự đếm lại, không tin lời app, và trả 403 kèm câu giải thích nếu chưa đủ). Năm lý do còn
lại thuộc PT/Admin nên **không hiện ra** — chào rồi bị từ chối thì tệ hơn là không chào.

**Số tiền hoàn lấy từ máy chủ, không tự tính.** `GET /contracts/:id/money-breakdown` trả về mọi con
số dưới dạng **chuỗi**, và cố ý để cạnh nhau hai sự thật khác nhau: `released` (công thức nói đã trả
bao nhiêu) và `actuallyReleased` (sổ cái đã chuyển bao nhiêu). Thẻ hợp đồng trích đúng
`refundIfCancelledNow`. Ví dụ thật trên máy: hợp đồng 9.000.000 đ chưa dùng buổi nào →
"Dừng bây giờ được hoàn khoảng 8.100.000 đ" (phần còn lại là tỉ lệ nền tảng).

**Kiểm thật (17/9)**: rút hợp đồng `021e8614…` từ trên máy → backend trả `CANCELLED`, `cancelledBy`
đúng userId của khách, `cancellationReason` được ghi. 15 unit test cho tầng logic hợp đồng.

### 23.5 — Buổi tập: xem, xử lý, đặt (CL-06, CL-07, CL-08)

**Chỉ `COMPLETED` mới trừ buổi trong gói.** Bảy trạng thái còn lại (kể cả `DISPUTED`,
`PT_NO_SHOW_REPORTED`) chưa hề bị tính tiền — đó là lý do con số "còn lại" trên màn hợp đồng đáng
tin. Có test riêng đi qua đủ 8 trạng thái để không ai vô tình đổi luật này.

**Ba mốc thời gian khác nhau, dễ nhầm thành một:**

| Luật | Ngưỡng | Nguồn |
|---|---|---|
| Huỷ buổi | dưới **24 giờ** thì TRỪ 1 buổi + PT vẫn được tính công | `CANCEL_WINDOW_MS` |
| Đổi lịch | phải còn hơn **12 giờ**, và chỉ với buổi đã `CONFIRMED` | `booking.service.ts:1221` |
| Báo PT vắng | chỉ sau giờ bắt đầu **+ 15 phút** ân hạn | `NO_SHOW_GRACE_MINUTES` |

Giao diện nói luật huỷ **trước khi bấm** (sheet hiện đúng một trong hai câu tuỳ còn bao lâu), và
**ẩn** nút đổi lịch khi chưa đủ điều kiện kèm câu giải thích — một cái nút chắc chắn nhận 400 còn tệ
hơn là không có nút.

**Tại hạ tự phát hiện luật 12 giờ bằng cách thử thật, không phải bằng cách đọc:** bản đầu vẫn chào
"Đổi lịch" trên buổi cách 2 giờ, gửi lên nhận `400 "Không thể dời lịch trong vòng 12 giờ trước buổi
tập"`. Sau đó mới truy ra `booking.service.ts` và mô hình hoá đủ **bốn** điều kiện (CONFIRMED, chưa
bắt đầu, còn >12 giờ, bắt buộc có lý do).

**Đổi lịch cần hai mốc ISO, không phải ngày + giờ.** `buildReschedulePayload` dựng `Date` theo múi
giờ **của máy** rồi `toISOString()` — "17:00" nghĩa là 5 giờ chiều nơi khách đang đứng — và giữ
nguyên độ dài buổi tập gốc thay vì mặc định 1 tiếng.

**Lịch sử buổi tập nằm theo hợp đồng.** `/sessions/upcoming` và `/sessions/pending-confirmation`
chỉ trả phần đang mở, nên tab "Đã qua" đọc thêm `/sessions/contract/:id` cho các hợp đồng
ACTIVE/COMPLETED/EXPIRED rồi gộp theo id.

**Kiểm thật (17/9)**: đặt buổi 19/09 17:00 → `7e7fe75a…` **REQUESTED** đúng khung giờ đã chọn; huỷ
từ trên máy khi còn hơn 24 giờ → `CANCELLED` với `sessionDeducted: false`; gửi đề nghị đổi lịch qua
API với đúng payload của màn → tạo `8312d46e…` **PENDING** rồi thu hồi sạch. 26 unit test cho tầng
logic buổi tập.

### 23.6 — Đề nghị đổi lịch chạy hai chiều (bổ sung cho CL-07)

**Chỉ BÊN KIA được trả lời một đề nghị.** `respondToReschedule` kiểm đúng điều đó:
`expectedResponder = requestedBy === "CLIENT" ? "PT" : "CLIENT"`, sai vai thì **403 "You cannot
respond to your own reschedule request"** (đã thử thật, đúng nguyên văn). Nên màn hình phân biệt rõ:

- **PT đề nghị** → buổi đó nhảy vào nhóm **"Cần xử lý"**, thẻ hiện "Huấn luyện viên đề nghị dời
  sang …", sheet có **Đồng ý / Từ chối** kèm ghi chú tuỳ chọn.
- **Khách đề nghị** → chỉ là tin tức: "… — chờ huấn luyện viên trả lời", buổi vẫn nằm ở "Sắp tới".

**Từ chối KHÔNG phải huỷ buổi** — sheet nói trước hậu quả của từng lựa chọn, vì "Từ chối" rất dễ bị
đọc thành "huỷ buổi tập": đồng ý thì buổi chuyển sang giờ mới và vẫn `CONFIRMED`, từ chối thì buổi
giữ nguyên giờ cũ.

**Mỗi buổi chỉ có MỘT đề nghị mở** (luật máy chủ), nên khi đang có đề nghị, nút "Đổi lịch" biến mất
kèm câu giải thích đúng chiều đang chờ ai.

**Một lỗi thật do phép gộp dữ liệu, bắt được trên máy:** `/sessions/upcoming` **có** kèm
`rescheduleRequests`, còn `/sessions/contract/:id` **không**. Bản gộp đầu tiên dùng kiểu "ghi đè sau
cùng thắng", nên dòng từ danh sách theo hợp đồng xoá sạch đề nghị của dòng từ danh sách sắp tới —
giao diện im lặng như chưa từng có đề nghị nào. Đã tách thành `mergeSessionSources()` (nguồn giàu dữ
liệu đi trước, **ghi đầu tiên thắng**) và có test riêng chặn tái phát.

**Kiểm chứng (17/9 phần khách gửi, 18/9 phần khách trả lời — đã chạy đủ hai chiều trên máy thật):**
- Khách gửi đề nghị: thẻ và sheet hiện đúng, nút Đổi lịch bị chặn đúng câu.
- **Khách TỪ CHỐI** đề nghị của PT → đề nghị `REJECTED`, buổi tập **vẫn `CONFIRMED` và giữ nguyên
  giờ cũ** (đúng như câu sheet hứa trước khi bấm).
- **Khách ĐỒNG Ý** → buổi chuyển sang giờ mới, vẫn `CONFIRMED`, `sessionDeducted` vẫn false, đề
  nghị `ACCEPTED`.
Đề nghị phía PT được tạo bằng tài khoản PT thật (Ngài cấp trong phiên làm việc, **không lưu vào
repo**), và lịch đã được trả về đúng chỗ cũ sau khi kiểm.

### 23.7 — E2E tự động cho luồng tiền Phase 7

`frontend/mobile/e2e/phase7-money-flows.e2e.ts`, chạy bằng `pnpm test:e2e` (mặc định gateway
`http://localhost:3000`, tài khoản `john.doe@example.com`; đổi qua `E2E_BASE_URL` / `E2E_EMAIL` /
`E2E_PASSWORD`).

**Điều làm nó đáng chạy, thay vì là bản sao thứ hai của unit test:** mọi body request đều do **chính
các hàm mà màn hình dùng** dựng ra — `buildContractRequestPayload`, `buildBookingPayload`,
`buildReschedulePayload`, các tham số mua gói. Một thay đổi làm hỏng thứ app gửi đi sẽ làm hỏng cả
kịch bản này. Sau mỗi bước, trạng thái được **đọc lại bằng một GET riêng**, không tin phản hồi của
chính lệnh vừa gọi.

Bốn kịch bản:
1. **Yêu cầu hợp đồng** → đọc lại thấy `PENDING_REVIEW`, đúng giá/đúng số buổi, `paid=false` → rút
   yêu cầu → `CANCELLED`.
2. **Mua gói hội viên** → `PENDING_PAYMENT` đúng `priceAtPurchase`/`durationDaysSnapshot`, **chưa có
   `paymentTxnId`, chưa có `startDate`** → huỷ → `CANCELLED`.
3. **Đặt buổi tập** → `REQUESTED`, chưa trừ buổi; thử đổi lịch trên buổi `REQUESTED` → **phải 400**;
   huỷ khi còn hơn 24 giờ → `CANCELLED` với `sessionDeducted=false`, và `usedSessions` của hợp đồng
   **không đổi**.
4. **Đề nghị đổi lịch** trên buổi `CONFIRMED` còn >12 giờ → đề nghị gắn đúng vào buổi trong
   `/sessions/upcoming` với `requestedBy: CLIENT`; khách tự trả lời → **403**; thu hồi → `CANCELLED`.

**Ba tính chất được giữ có chủ đích:**
- **Không nằm trong `pnpm test`** — bộ test thường phải xanh khi không có máy chủ nào cả (vẫn 279
  unit + 55 component/service, không đổi).
- **Không có backend thì bỏ qua, không báo hỏng**: `[e2e] Bỏ qua: không thấy backend ở …`, 4 test
  skipped, 0 fail.
- **Tự dọn**: mọi thứ nó tạo đều được huỷ ở `after` theo thứ tự ngược. Kiểm sau lượt chạy đầu: hợp
  đồng hôm nay `CANCELLED, CANCELLED`, gói hội viên `CANCELLED, CANCELLED`, không còn đề nghị đổi
  lịch nào mở.

Kịch bản cũng **tự bỏ qua một cách trung thực** khi dữ liệu không cho phép (không có PT rảnh có gói
online, không có phòng gym còn gói mở bán, không có hợp đồng ACTIVE còn buổi) — thà `t.skip()` kèm
lý do còn hơn giả vờ đã kiểm.

**Việc duy nhất kịch bản này không tự làm được:** phần khách **trả lời** đề nghị của PT, vì cần một
đề nghị do PT gửi — mà PT của hợp đồng ACTIVE duy nhất trên tài khoản thử lại là tài khoản cá nhân
của Ngài. Kịch bản kiểm tới ranh giới đó (403 "không được tự trả lời đề nghị của mình") rồi dừng.

### 23.8 — Ba luật đổi lịch chỉ lộ ra khi chạy thật (18/9)

Chạy kịch bản hai phía lần đầu làm lộ thêm **ba điều không có trong tài liệu nào**, và cả ba đều
đến từ chính máy chủ trả lời:

1. **Một buổi chỉ được dời tối đa 2 lần** — `booking.service.ts` đếm `countAcceptedReschedules`, lần
   thứ ba nhận `409 "Buổi tập này đã dời 2 lần — chỉ còn cách huỷ"`. Đã mô hình hoá thành
   `RESCHEDULE_MAX_MOVES` + `acceptedMoves()`, và nút Đổi lịch biến mất kèm đúng câu đó.
2. **Giờ đề nghị phải nằm trong khung rảnh của PT** — ngoài khung thì
   `"Thời gian này nằm ngoài khung giờ rảnh của huấn luyện viên"`. Màn hình vốn đã đúng (chỉ chào
   khung rảnh thật lấy từ `/availability/:id/slots`); chính **kịch bản E2E** của tại hạ mới là chỗ
   sai khi tự cộng thêm 1 giờ.
3. **Danh sách buổi tập chỉ đính kèm đề nghị ĐANG CHỜ.** `/sessions/upcoming` trả
   `rescheduleRequests` chỉ gồm cái `PENDING`; những lần đã dời xong **không** có ở đó. Vì vậy số lần
   đã dời chỉ đọc được qua `GET /sessions/:id/reschedule-history` — đã bọc thành
   `sessionService.getRescheduleHistory` và sheet chi tiết gọi nó khi mở một buổi (một request, đúng
   lúc cần), rồi `withRescheduleHistory()` gộp vào.

**Thứ tự ưu tiên của lý do chặn** cũng quan trọng: đang có đề nghị mở thì nói "trả lời đề nghị đó
trước" (việc người dùng làm được ngay), hết trần 2 lần mới nói "chỉ còn cách huỷ".

**Kịch bản E2E hai phía tự đặt buổi của chính nó** thay vì mượn buổi trong dữ liệu seed: giờ gốc của
buổi seed (22:00) nằm ngoài khung rảnh của PT, nên sau khi dời đi thì **không có đường đưa về** — bài
học phải trả giá bằng bốn buổi bị lệch giờ trước khi nhận ra. Kịch bản nay: đặt buổi mới ở khung rảnh
→ PT xác nhận → PT đề nghị đổi → khách từ chối → PT đề nghị lại → khách đồng ý → huỷ buổi của chính
mình. Chạy lại hai lượt liên tiếp đều 5/5 và không để lại gì.

### 23.9 — Vá CL-09 theo web (21/9): chi tiết phòng gym đầy đủ + quyết định thư viện bản đồ

**Vì sao vá một phase đã đóng:** sau khi Phase 7 đóng, trang chi tiết phòng gym của web được làm lại
(commit `304438a`, `e1986e2`). Theo luật "web là sàn tối thiểu" và quyết định của Ngài ngày 21/9
("vá vào Phase 7", cùng dạng WB-14 với Phase 6) — xem `MOBILE_MIGRATION_MANIFEST.md` → "Bổ sung 2026-09-21".

**Đã làm** (`app/client/services/gyms/[id].tsx`, `src/features/services/{gymDirectory.ts,GymPhotoGallery.tsx,BranchMap.tsx}`):
- "Thông tin giới thiệu" đứng đầu, ≤300 ký tự (của chi nhánh, chưa có thì của thương hiệu; dữ liệu cũ
  dài hơn cắt ở khoảng trắng + "…") — `aboutText()`, cùng quy tắc với web.
- Thư viện ảnh: ảnh lớn `contentFit="contain"` (không cắt), nút ‹ › hai bên, dải ảnh nhỏ, chạm để xem
  toàn màn hình (RN `Modal`). Ảnh là link ký tạm — gym-service ký theo đúng địa chỉ app đang gọi
  (`10.0.2.2` của emulator, IP LAN, tunnel) và gateway chuyển tiếp sang kho tệp; không cần header.
- Địa chỉ đủ phường/xã + tỉnh/thành (tên tra từ mã qua `locationService`, cache 24 h), chỉ dẫn đường
  đi, điện thoại / email chạm được (`Linking` tel:/mailto:), logo thương hiệu ở đầu thẻ.
- Mạng xã hội: chỉ mở link `https://` (server đã kiểm tên miền). lucide-react-native 1.45 **không có**
  icon thương hiệu Facebook/Instagram/YouTube/TikTok → nút mang tên mạng + icon liên kết ngoài.
- Chi nhánh cùng thương hiệu: bản đồ nhiều ghim + danh sách (chạm để mở chi nhánh đó) + "Chỉ đường"
  (Google Maps theo toạ độ, mở app Maps nếu có).

**Quyết định thư viện bản đồ (Ngài chọn 21/9): `react-native-webview` 13.16.1 + Leaflet 1.9.4 (cdnjs)
+ tile OpenStreetMap** — giống hệt web, miễn phí, không khoá API; dùng lại cho ghim kéo-thả ở Phase 12.
Đã loại: `react-native-maps` (Android cần khoá Google Maps có thanh toán — trái quyết định "không dịch
vụ trả phí"), bản đồ tĩnh ghép tile (không kéo/zoom, không làm được ghim kéo-thả).
- Cài bằng `npx expo install react-native-webview` → đúng như §21 cảnh báo, pnpm nối lại mọi junction
  về `.pnpm`; đã chạy lại `node scripts/shorten-package-paths.js` và kiểm lại các junction trỏ `D:/.rn*`.
  Lockfile chỉ thêm webview + chuỗi peer của `expo` (không nâng gói nào khác); vẫn đúng một
  `react-native-css-interop@0.2.6`, `nativewind@4.2.6`, `react-native@0.86.3`.
- WebView nhận HTML nội tuyến (`baseUrl: https://gymini.app/`), dữ liệu ghim nhúng dạng JSON đã thoát
  `<`; mọi điều hướng ra ngoài (vd link ghi công OSM) bị chặn trong WebView và mở bằng `Linking`.
- **Bài học từ emulator — WebView nuốt cử chỉ vuốt.** Bản đồ tương tác đặt giữa `ScrollView` làm người dùng
  "kẹt": vuốt bắt đầu trên bản đồ thì kéo bản đồ (bản đồ trôi tận Gò Vấp) thay vì cuộn trang; tắt
  `dragging` của Leaflet vẫn không trả cử chỉ về trang (`nestedScrollEnabled` không đủ). Cách chốt:
  **hai chế độ** — trong trang là ô xem trước `pointerEvents="none"` + lớp phủ "Chạm để mở bản đồ" (vuốt
  qua thì trang cuộn), chạm thì mở `Modal` toàn màn hình với Leaflet tương tác đầy đủ. Phase 12 (ghim
  kéo-thả) dùng đúng chế độ toàn màn hình này.
- Tiện ích (`facilities`) trước đây hiện **mã nội bộ** (`DRINKING_WATER`, `AIR_CONDITIONING`) — lỗi có sẵn
  từ khi đóng Phase 7, lộ ra lúc kiểm. Nay dùng `FACILITY_LABEL` chép từ web (`StepFacilities.tsx`); mã
  chưa có tên thì bỏ qua thay vì lộ enum.
- Native module mới ⇒ **phải build lại dev client** (`npx expo run:android`) — đã build 21/9, không lỗi MAX_PATH.

**Kiểm chứng (21/9):**
- Unit (tsx) 299/299 (thêm 6 cho CL-09 + tên tiện ích); typecheck/lint sạch ở các file đụng tới.
- E2E với backend thật (`e2e/phase7-gym-detail.e2e.ts`) 2/2, chạy cả `localhost:3000` lẫn IP LAN
  `192.168.2.101:3000`: ảnh ký đúng địa chỉ app gọi (không phải `:9000`) và tải được 200 `image/*`; giới
  thiệu ≤300; địa chỉ có phường/tỉnh; chi nhánh nằm trong danh sách của thương hiệu.
- Emulator Pixel_10_Pro_XL (dev client build mới, phòng "Gymini Phú Nhuận"): giới thiệu đứng đầu và cắt ở
  khoảng trắng; ảnh lớn trọn khung, nút › sang ảnh 2/2 "Khu tập chính"; địa chỉ đủ phường/thành phố, chỉ
  dẫn, điện thoại, email, 4 nút mạng xã hội, tên tiện ích tiếng Việt; bản đồ ghim đúng khu Nguyễn Tuân;
  vuốt trên ô bản đồ cuộn được trang; chạm mở toàn màn hình và kéo được; "Chỉ đường" mở app Google Maps
  (`com.google.android.maps.MapsActivity`).

## 24. Client D (Kế hoạch AI + Chợ + Dịch vụ 1-1 + Lộ trình) — Phase 8 (22/9)

Phạm vi: CL-18 (hub "Kế hoạch tập": Kế hoạch AI tập luyện + dinh dưỡng, Chợ kế hoạch), CL-23 (thuật sĩ
giáo án AI), CL-12 (đơn dịch vụ 1-1), WB-11 (lộ trình dài hạn: hành trình + thuật sĩ + tạo nâng cao).
Không sửa một dòng backend nào (quy tắc Phase 0.3). Route: `app/client/plans/{index,wizard,ai/[id],
listing/[id],service/[id],orders/[id]}`, `app/client/roadmap/{index,wizard,create}`; logic thuần ở
`src/features/plans/*.ts`, `src/features/roadmap/roadmap.ts` (có unit test).

### 24.1 — Quyết định thích ứng nền tảng

| Hành vi web | Mobile | Lý do |
|---|---|---|
| Theo dõi job AI bằng store bền `pendingAiTasks` (localStorage) | Không có store: **bản ghi plan là nguồn sự thật**, danh sách tự poll 4s khi còn plan QUEUED/PROCESSING; thuật sĩ poll `GET /plans/job/:id` 3s | Rời màn giữa chừng vẫn thấy tiến độ, không thêm một kho trạng thái thứ hai |
| Giải thích kế hoạch qua SSE stream | `POST /plans/explain` (không stream) — đúng đường web tự rơi về khi stream lỗi | fetch của RN không đọc body dạng stream |
| `<input type=date>` | Dải chip 21 ngày từ hôm nay (`startDateOptions`, YYYY-MM-DD giờ máy) | Không thêm native date picker; kế hoạch bắt đầu trong vài ngày |
| `<input type=number>` | `Stepper` / chip có sẵn giới hạn đúng schema server | Không gõ được giá trị ngoài khoảng |
| Vòng % của thuật sĩ (thiết kế: giả lập 3s) | Theo **trạng thái job thật**: QUEUED → PROCESSING → COMPLETED/FAILED; % tiệm cận 95%, chỉ 100% khi server báo COMPLETED | Server không trả phần trăm; không vẽ tiến độ giả |
| Chips "thời lượng buổi / trình độ / chấn thương" của thiết kế | **Không dựng** | `/plans/workout/generate` không có trường nào nhận chúng (trình độ/chấn thương lấy từ hồ sơ phía server) — thu thập rồi bỏ đi là lừa người dùng |
| Mua dịch vụ 1-1 → mở cổng | Tạo đơn (PENDING_PAYMENT) với cổng người dùng chọn từ `/me/payments/methods`, **không mở cổng** (Phase 14) — y như gói hội viên/hợp đồng Phase 7 | Đơn nói rõ "đang chờ thanh toán", huỷ được |
| Web gộp "Yêu cầu hoàn tiền / Khiếu nại" thành 1 nút (chỉ gọi refund) | **Hai cửa riêng** như thiết kế và API | `openDispute` là endpoint riêng |
| Nhắn PT | Tạo hội thoại thật (`POST /chat/conversations/direct`) rồi mở tab Trò chuyện kèm `conversationId` | Tab Trò chuyện là Phase 9 (PARTIAL tới lúc đó) |
| Ảnh mục tiêu lộ trình (FileReader → base64) | `expo-image-picker` (camera/thư viện) `base64: true` → cùng `POST /ai/agent/goal-image` | Cùng giới hạn JPEG/PNG ≤ 4 MB |
| "Lộ trình" là tab của trang Tập luyện web | Phân đoạn thứ 4 "Lộ trình" trong tab Tập luyện + màn riêng `/client/roadmap` | `?tab=` mở thẳng phân đoạn |
| Tạo lộ trình thủ công 1 giai đoạn | Tối đa 4 giai đoạn nối tiếp (cùng `POST /fitness-roadmaps`), mỗi giai đoạn `objective.maxCycles = ceil(tuần/4)` (= plannedCycleCount server tự tính) | Không có objective thì giai đoạn thủ công không bao giờ tự hoàn thành |
| Lỗi lộ trình tiếng Anh từ fitness-service | Dịch sang tiếng Việt ở `translateRoadmapError` (chỉ trình bày) | Người dùng thường |

### 24.2 — Sửa chung phát hiện khi kiểm trên máy (ảnh hưởng cả Phase 7)

- **BottomSheet cướp cử chỉ cuộn**: cử chỉ kéo-để-đóng gắn cho cả sheet nên ScrollView bên trong không
  cuộn được (phiếu Intake, check-in, form tạo dinh dưỡng; và 2 sheet "Đặt buổi tập"/"Đổi lịch" của Phase 7
  vốn cũng dính mà chưa lộ vì nội dung ngắn). Sửa: chỉ tay nắm + tiêu đề nhận kéo; sheet tối đa 92% màn
  hình; ScrollView trong sheet dùng `flexShrink: 1` thay chiều cao cứng. Component test BottomSheet 5/5.
- **Bàn phím che sheet**: Modal là cửa sổ riêng nên `adjustResize` không tới — bọc `KeyboardAvoidingView`.
- **Header tab Tập luyện**: thêm nút "Kế hoạch" (vị trí theo thiết kế) → 7 nút không vừa 360dp; dãy nút
  công cụ cuộn ngang, nút "+" giữ cố định. Trang chủ: lối tắt "Kế hoạch" giờ mở `/client/plans`.
- **Typed routes**: Metro cập nhật `.expo/types/router.d.ts` tăng dần ghi sai `/client/plans/index`
  cho route mới → `tsc` báo lỗi giả; khởi động lại Metro `--clear` là sinh lại đúng.

### 24.3 — Bằng chứng kiểm (22/9)

- **REAL emulator + DB** — đơn 1-1 `22dcfdaa…` (john.doe ↔ pt@example.com): INTAKE_PENDING →(UI: phiếu
  Intake, tự điền từ hồ sơ, 4 nhóm đồng ý) INTAKE_SUBMITTED →(PT qua API) PT_REVIEWING → DRAFT_DELIVERED →(UI:
  yêu cầu sửa, Độ khó) REVISION_REQUESTED →(PT) REVISION_IN_PROGRESS → DRAFT_DELIVERED v2 →(UI: Chấp nhận)
  ACTIVE (v1 SUPERSEDED / v2 ACCEPTED) → check-in (UI; server gắn `requires_attention` khi đau 7/10) →(UI)
  COMPLETED → đánh giá 4★ (UI). Mỗi bước đối chiếu bằng SELECT.
- **REAL emulator + DB** — lộ trình: thuật sĩ 4 bước (tự điền 71.3 kg / 16.4% từ InBody; BMR 1.672 + các
  dòng = TDEE 2.592 từ `/diagnosis`; bước 4 dùng bản nháp dự phòng của server vì LLM tắt; dự báo từng
  giai đoạn từ `/projection`) → "Bắt đầu lộ trình": roadmap ACTIVE, giai đoạn 1 ACTIVE, TrainingCycle ACTIVE
  gắn đúng giai đoạn.
- **REAL HTTP/API (e2e)**: `e2e/phase8-plans.e2e.ts` 5/5 (danh sách AI, chợ, cổng thanh toán, mua →
  PENDING_PAYMENT → huỷ, không để lại đơn treo); `e2e/phase8-roadmap.e2e.ts` 5/5 (diagnosis cộng đúng TDEE,
  projection, advance khi chu kỳ đang chạy không đổi giai đoạn, archive bị chặn khi có giai đoạn ACTIVE,
  bản nháp nâng cao 2 giai đoạn → activate bị từ chối vì đã có lộ trình chạy → lưu trữ); Phase 7 e2e 2/2.
- **Tự động**: typecheck 0 lỗi; unit 348/348 (mới: `plans.test.ts` 39, `roadmap.test.ts` 10); jest 61/61;
  lint 0 lỗi (19 cảnh báo có sẵn từ trước, 0 mới).

### 24.4 — Chưa kiểm được (nói thẳng)

- **Sinh kế hoạch AI thật (tập luyện/dinh dưỡng, điều chỉnh, giải thích bằng AI)**: máy dev không cài Ollama
  (`llm-health` = unavailable) — màn hiện đúng cảnh báo "AI Coach chưa sẵn sàng" và khoá nút. Luồng đọc/lưu
  vào lịch/ẩn trên kế hoạch có sẵn đã kiểm.
- **Advance lộ trình sang giai đoạn kế**: server chỉ chuyển giai đoạn khi chu kỳ trong giai đoạn đã
  COMPLETED và được đánh giá với đủ dữ liệu thật (số ngày tối thiểu, số buổi đã tập, tuân thủ, InBody so
  sánh được). Lộ trình tạo hôm nay không thể đạt; dựng dữ liệu tập giả nhiều tuần vào DB dev chỉ để test
  qua là trái quy tắc dự án → chỉ kiểm việc server giữ đúng giai đoạn. Logic chuyển giai đoạn có test
  BACKEND INTEGRATION sẵn ở fitness-service (`fitness-roadmap.service.integration.test.ts`).
- **Mở cổng thanh toán dịch vụ 1-1**: Phase 14.

### 24.5 — ⏸ Tạm tắt Hoàn tiền + Khiếu nại (22/9, lệnh Ngài)

Luồng khiếu nại đơn 1-1 ở backend chưa hoàn chỉnh (không chặn theo trạng thái, không có ai xử lý
`DISPUTED`) — chi tiết + danh sách việc cần làm ở `MOBILE_BACKEND_GAPS.md` GAP-13. Hai nút, hai sheet, hai
mutation trong `app/client/plans/orders/[id].tsx` được **comment lại, không xoá** (tìm "TẠM TẮT 22/9"); đã
kiểm trên máy ảo: đơn INTAKE_PENDING chỉ còn "Điền phiếu Intake / Nhắn PT / Huỷ đơn". Chờ Ngài bàn với
partner rồi mới bật lại.

## 25. Client E (Trò chuyện + AI Coach …) — Phase 9 (đang làm, 22/9)

### 25.1 — Trò chuyện người–người (SH-04 / CL-21)

- `app/client/messages/` (danh sách + `[conversationId]`), `src/features/chat/` (hàm thuần + `useRealtimeChat`).
  Gửi qua socket gateway (`chat:message:send`), rơi về REST khi mất kết nối; vào lại phòng mỗi lần
  (re)connect; nạp lại hội thoại đang mở sau khi kết nối lại.
- Token socket: `ensureFreshSocket()` kết nối lại socket khi token lúc bắt tay sắp hết hạn (GAP-14).
- Bằng chứng (REAL emulator + socket gateway thật): PT→khách đẩy tức thì + "Đang soạn tin…"; khách→PT
  (PT thấy typing true/false, nhận tin, DB lưu); app ở nền → mở lại → thấy tin gửi lúc ở nền, đẩy tiếp tục.

### 25.2 — AI Coach (WB-12) — nút nổi theo quyết định Ngài 22/9

- Nút nổi `src/features/coach/AiCoachFab.tsx`: đúng `AICoachFab` của thiết kế (56px, Sparkles, vòng sáng
  nhấp nháy 1,8s, chấm cam, bật vào sau 400ms), chỉ hiện trên 5 màn gốc tab client (màn con có thanh dưới
  riêng — ô chat, nút Tiếp — nên không đè lên).
- Màn `app/client/ai-coach.tsx` (toàn màn hình, ẩn tab): vào thẳng khung chat như thiết kế; "Lịch sử" một
  chạm (danh sách phiên, đổi tên bằng BottomSheet, xoá bằng hộp xác nhận hệ thống). Web dạng panel compact
  một cột — cùng hành vi.
- **Stream**: `coachService.chatStream` đọc SSE qua `expo/fetch` (RN fetch thường không đọc được body theo
  luồng). Luồng chạy trong `src/features/coach/coachStore.ts` (bộ nhớ module, khoá theo userId + phiên) nên
  đóng màn giữa chừng câu trả lời vẫn chạy tiếp và hiện đủ khi mở lại. Phiên nháp `draft:` chuyển sang ID
  thật khi server tạo phiên (như `adoptSessionIfNeeded` của web). Không ghi đĩa (web dùng localStorage để
  khôi phục tab — app không cần).
- Văn bản trả lời: cùng phương ngữ markdown web tự dựng (##, ###, >, -, 1., **đậm**, bảng `|`) —
  `parseCoachText` thuần + unit test, bảng cuộn ngang.
- Khối hành động (`AgentBlocks.tsx`) = `FitnessAgentBlocks.tsx` của web: ứng viên PT/chương trình (chọn gói
  bằng Chip thay `<select>`), xác nhận hành động (huy hiệu rủi ro, 9 loại tóm tắt, hết hạn thì khoá nút),
  mục tiêu từ ảnh, kết quả ảnh, đánh giá chu kỳ, dữ liệu còn thiếu, xác nhận đổi hồ sơ. Link `nextUrl` chỉ
  theo 4 route web cho phép, ánh xạ sang màn mobile tương ứng.
- Ảnh: `pickImage.ts` (camera hoặc thư viện, base64, ≤4 MB như web); "Gửi ảnh & hỏi AI" giữ ảnh chờ câu hỏi,
  "Ảnh hình thể tham khảo" gửi ngay.
- Lời chào: số liệu InBody thật (lần mới nhất so với lần trước) như web, lời tiếng Việt theo thiết kế.
- Lỗi 5xx của `/ai/agent/*` hiện câu tiếng Việt, không hiện câu tiếng Anh thô của server.

### 25.3 — Bằng chứng AI Coach (22/9)

- REAL emulator + REAL HTTP/API (john.doe): nút nổi hiện ở Trang chủ → mở AI Coach; lời chào đúng số InBody
  của tài khoản (71.3 kg, ↓17.4; 35.2 kg; 16.4%); bấm gợi ý "Tôi nên ăn gì?" → câu trả lời stream từng phần,
  bảng + danh sách đánh số hiển thị đúng; DB `chat_sessions` có phiên mới `447de68f…`, màn Lịch sử tô sáng
  đúng phiên đó (nháp → ID thật). Đóng màn giữa chừng stream → mở lại → câu trả lời đã chạy xong đầy đủ.
  Đổi tên → DB `title` = "Tôi nên ăn gì? P9"; xoá → DB `archived_at` có giá trị. Mở phiên cũ 31/08 → nạp đúng
  lịch sử từ server.
- Tự động: `coach.test.ts` 11/11; tsc 0 lỗi; lint 0 lỗi (19 cảnh báo cũ, không thêm).
- Một lần bấm nút nổi không mở (lần thứ 2 trong chuỗi); lặp lại 3 lần sau đó đều mở — ghi nhận, chưa tái hiện.

### 25.4 — Chưa kiểm được (nói thẳng)

- Máy dev không có Ollama → câu trả lời tự do là mẫu dự phòng của server (có đoạn tiếng Anh do backend sinh).
- **Sửa 22/9:** khối hành động KHÔNG cần LLM — ý định do luật so khớp chữ (`fitness-agent-intent.ts`) nhận ra và chạy
  trước bước gọi AI; chỉ đoạn diễn giải dùng AI local (Ollama) có dự phòng. Không dùng API key trả phí.
- Đã kiểm trên máy (REAL emulator + REAL HTTP/API): hỏi "Tìm PT" → khối "còn thiếu thông tin" hỏi lần lượt mục
  tiêu / ngày / ngân sách (phát hiện + sửa: `known` là `{label, value}` làm app sập; enum mục tiêu → "Tăng cơ") →
  tìm PT trả kết quả thật "chưa có lựa chọn phù hợp" + "Nguồn khoa học (4)". Trước đó lỗi 500 do image dev cũ
  (GAP-16, đã build lại user/fitness-service theo lệnh Ngài).
- Chưa kiểm: thẻ ứng viên PT/chương trình + "Chọn" + khối xác nhận (john không có PT nào khớp; nhánh chương trình
  kẹt ở GAP-17). Không bấm xác nhận nào tạo hợp đồng thật.
- Luồng ảnh (Ngài cho phép khoá, GAP-15 (c)): **"Ảnh hình thể tham khảo" ĐẠT** — ảnh thật → khối phân tích mục tiêu
  hiện đủ (cảnh báo ảnh chưa rõ, chọn mục tiêu/mức cơ/diện mạo/nhóm cơ); không bấm "lưu mục tiêu" (ghi hồ sơ thật).
  Sửa mobile: loại ảnh lấy từ byte đầu (picker nén PNG thành JPEG nhưng vẫn báo image/png → server 400) — áp cho
  cả roadmap wizard Phase 8. **"Gửi ảnh & hỏi AI" HỎNG ở backend** (giới hạn body 100 KB — GAP-18).
- Bảng BottomSheet tự đóng khi rời màn AI Coach (màn tab vẫn được giữ, Modal là cửa sổ riêng).
- Nút nổi: 2 lần bấm hụt ngay sau khi app vừa khởi động/chuyển màn; 9 lần bấm khác đều mở — chưa rõ nguyên nhân.

### 25.5 — Cá nhân, Ví, Cài đặt, Thông báo, Xuất dữ liệu, Báo cáo vấn đề (CL-05/13/20, SH-07/08/09)

- Tab "Cá nhân" thành thư mục `app/client/profile/` (Stack): hub theo thiết kế + `edit`, `wallet`, `settings`,
  `equipment`, `notification-prefs`, `export`, `pt-application`. Hub chỉ hiện điều có thật: 3 số liệu tính từ
  heatmap hoạt động + InBody (thay "PR" không có API), thẻ "Vào không gian HLV" chỉ khi là PT (thẻ Chủ gym/Admin
  của thiết kế không áp dụng — 2 vai trò đó không vào được workspace client).
- Ảnh đại diện + tài liệu ứng tuyển PT: **presign → PUT → confirm** như web (bắt buộc trên AWS/Lambda, nơi route
  multipart bị tắt), **rơi về multipart** khi backend báo "USER_UPLOAD_BUCKET is not configured" (stack dev không
  có bucket — web trên dev vì vậy upload hỏng). `uploadViaPresignOrLegacy` trong `services/api.ts`.
- Ví: nhãn giao dịch dịch từ mô tả nội bộ tiếng Anh ("Contract <uuid> … refund (CLIENT_CANCELLED)") sang tiếng Việt,
  không lộ id/enum; không vẽ "số rút được" (server tự chặn, không trả con số). `CountUp` thêm prop `locale` (tiền
  dùng `vi-VN`, định dạng số ở luồng JS).
- Thông báo: link web (`/client/booking`…) ánh xạ sang màn mobile, link lạ → chỉ đánh dấu đã đọc; chuông dashboard
  dùng `unread-count` thật + làm mới khi socket `notification:new`.
- Cài đặt: chỉ các mục có hành vi thật trên mobile; WB-14 (ngân sách/vùng miền dinh dưỡng) về đây qua
  `NutritionPrefsForm` dùng chung với thẻ dinh dưỡng. Không làm (ghi rõ): giao diện/ngôn ngữ, đơn vị, công tắc buổi tập.
- `SelectSheet` (chọn tỉnh/phường có tìm kiếm bỏ dấu) — component mới dùng chung.
- Bằng chứng (REAL emulator + REAL HTTP/API, john.doe): hub/ví/sửa hồ sơ/cài đặt/thiết bị/tuỳ chọn thông báo/xuất
  dữ liệu/thông báo/báo cáo vấn đề đều hiển thị dữ liệu thật; số dư khớp API; bấm thông báo → DB `unread=f` + mở tab
  Tập luyện. Tự động: unit 379 (có `phase9-account.test.ts` 11/11), jest 61/61, tsc 0, lint 0 lỗi / 19 cảnh báo cũ.
- Chưa bấm (thao tác ghi dữ liệu thật trên tài khoản dùng chung): gửi yêu cầu rút tiền, lưu hồ sơ, đổi mật khẩu,
  xoá dữ liệu hồ sơ, gửi báo cáo vấn đề, tải file xuất.

### 25.6 — Ứng tuyển PT (CL-22)

- Wizard 8 bước theo thiết kế, trường + quy tắc theo web PTApplicationPage và `submit()` của server (kiểm từng bước,
  lưu nháp mỗi lần "Tiếp tục", hydrate một lần — không để phản hồi lưu nháp ghi đè thứ đang gõ). Lịch rảnh theo
  ngày có nhiều khung (giờ nghỉ giữa ca), kiểm trùng/ngắn hơn một buổi như web; nơi tập có tỉnh/phường.
- Màn trạng thái: Đang xét / Cần bổ sung (ghi chú admin + "Chỉnh sửa & nộp lại") / Từ chối (lý do; KHÔNG có "Nộp đơn
  mới" vì server không cho lưu nháp khi REJECTED) / Được duyệt (vào không gian HLV).
- Đã kiểm (REAL BROWSER/thiết bị + BACKEND INTEGRATION, 24/9, emulator + backend dev, tài khoản john.doe — Ngài cho
  phép nộp): đi hết 8 bước trên máy, tải 3 ảnh định danh qua thư viện ảnh, nhập giá 400.000 ₫/buổi, thêm 3 khung giờ
  (T2/T4/T6 08:00–09:00), tick 4 cam kết, bấm "Nộp đơn" → màn trạng thái "Đã nộp / Đang xét duyệt". Đối chiếu DB
  `gymcoach_user`: `pt_applications` `9239a313-…` `status = SUBMITTED`, `submitted_at = 2026-09-24 07:05:30`,
  `service_mode = ONLINE`, `online_price_per_session = 400000`, `years_of_experience = 3-5`,
  `main_specialties = {Tăng cơ, Giảm mỡ}`, 3 ảnh định danh đều có URL, `available_days = {Mon,Wed,Fri}`.
- Ghi chú dữ liệu: khung giờ KHÔNG nằm ở cột `pt_applications.availability_blocks` (luôn null) — `saveDraft` đẩy
  chúng sang bảng `pt_availability` theo `pt_user_id` (`pt_application.service.ts:203-206`), và đọc lại bằng
  `availabilityService`. Kiểm bằng cột jsonb sẽ tưởng nhầm là mất dữ liệu.
- Đơn này **không được duyệt** ở đây: duyệt đơn là việc của admin (Phase 13). john.doe từ nay có một đơn PT ở trạng
  thái SUBMITTED — bài test nào cần "client chưa có đơn" phải dùng tài khoản khác.

## 26. Không gian Huấn luyện viên (Tổng quan, Học viên, Lịch dạy, Ví, Hồ sơ) — Phase 10 (24–25/9)

PT-01/02/03/04/05/06. Khung tab PT đã dựng từ Phase 4; phase này thay 5 màn giữ chỗ bằng màn thật.
Lớp thuần: `src/features/pt/pt.ts` (+ `src/features/__tests__/pt.test.ts`, 22 ca).

### 26.1 — Nhãn trạng thái đọc từ ghế huấn luyện viên

`ContractStatus` và `SessionStatus` vẫn chỉ được diễn giải ở `features/services/{contracts,sessions}.ts` —
không nhân bản enum. Nhưng nhãn phụ thuộc phía nhìn: "Chờ PT xác nhận" là câu KHÁCH đọc; PT phải đọc
"Bạn cần xác nhận". Nên `ptContractStatus`/`ptSessionStatus` chỉ ghi đè các mục phụ thuộc phía, còn lại rơi
về bản dùng chung (giữ nguyên tone). Thêm giá trị enum mới thì vẫn chạy, chỉ đọc trung tính cho tới khi được
đặt nhãn PT. Có test khẳng định cả hai chiều: mục bị lật phải KHÁC bản client, mục trung tính phải GIỐNG.

### 26.2 — "Học viên" = hợp đồng, không phải người

Gymini không có model roster riêng: `GET /contracts/pt` là nguồn duy nhất. Một khách có hai gói xuất hiện
hai dòng — đúng nghiệp vụ, nên route chi tiết mang **contractId** (web mang clientUserId rồi phải đoán
"hợp đồng ACTIVE mới nhất"). Web có 5 chip tiếng Anh; mobile gộp còn 4 chip tiếng Việt — Completed và
Expired với PT đều nghĩa là "quan hệ đã kết thúc". Có test: mọi giá trị `ContractStatus` thuộc đúng MỘT chip,
nên không ai biến mất khỏi danh sách.

### 26.3 — Nút hành động buổi tập bám đúng guard của backend

`sessionActions()` chỉ hiện nút mà server chắc chắn nhận: **Đã dạy xong** chỉ khi CONFIRMED và đã qua
`scheduledEndAt` (booking.service.ts P0 cluster B3); **Báo vắng** chỉ khi CONFIRMED và đã qua
`scheduledStartAt` + 15 phút (`NO_SHOW_GRACE_MINUTES`, P0 cluster B4 + Vòng 4/E1). Web hiện cả hai rồi để
lỗi 400 giải thích. Grace window là mặc định của backend (cấu hình được), nên lỗi trả về vẫn được hiển thị
chứ không coi là không thể xảy ra.

### 26.4 — Khung giờ rảnh: dải giờ thật, không phải lưới ô của bản thiết kế

Bản thiết kế vẽ lưới ngày × khung giờ cố định. Backend không có model đó: `pt_availability` lưu dải
start/end tự do, nhiều dải mỗi ngày. Vẽ lưới sẽ bịa model và âm thầm xoá dải thật của PT, nên màn này dùng
lại đúng bộ soạn dải + kiểm trùng/độ dài của thuật sĩ ứng tuyển PT (`features/ptApplication/ptApplication.ts`).

**Hai phương ngữ thứ trong tuần:** `GET /availability/:id` trả enum Prisma (`MONDAY`), còn `PUT
/availability/me` chuẩn hoá mọi dạng (`DAY_NAME_NORMALIZE`, vốn sinh ra cho dạng viết tắt `Mon` của thuật sĩ).
Mobile giữ MỘT dạng nội bộ (`Mon`..`Sun`) và đổi lúc đọc — `normalizeDay`/`availabilityFromServer`.

`PUT` **thay cả tuần**, nên bỏ một ngày rồi lưu là xoá thật — vì vậy có nút Lưu tường minh, không autosave.

### 26.5 — Hai chỗ KHÔNG chép từ web vì là dữ liệu bịa

- **PTProfilePage "Public Profile"**: tên "Sarah Mitchell", tiểu sử, "6 years", 4 chip chuyên môn tiếng Anh —
  toàn bộ là literal cứng với input `defaultValue`; nút Edit chỉ bật/tắt ô nhập và **không lưu đi đâu**.
- **PTProfilePage "Profile Stats"**: rating "4.9", "48 reviews" — cũng là literal cứng.

Chép sang mobile là đặt số bịa trước mặt một huấn luyện viên thật. Mobile dùng nguồn thật thay thế:
`specialties` trên `user_profiles`, và `avgRating`/`ratingCount` thật từ `GET /profile/pts/:userId` (chính là
thứ khách nhìn thấy). Chưa có đánh giá thì ghi "Chưa có đánh giá", không bịa số.

Tương tự ở Tổng quan: web gọi `/contracts/pt/earnings` là "Tổng thu nhập", nhưng `getEarnings` cộng **giá hợp
đồng** (`contract.price`) của các hợp đồng COMPLETED — tức doanh thu **gộp**, chưa trừ phí nền tảng.
Đã kiểm bằng dữ liệu thật: `platform_commissions` với `partner_type='PT'` có `commission_rate = 0.1000`,
ví dụ gross 4.000.000 → phí 400.000 → PT thực nhận 3.600.000 (`wallet.service.ts` `transferWithCommission`:
`netToReceiver = amount − amount × commissionRate`, mặc định `PLATFORM_COMMISSION_RATE = 0.10`).
Nên con số đó cao hơn tiền PT thật sự nhận đúng bằng phần hoa hồng. Ví của payment-service mới là thẩm quyền
tiền, nên ví chiếm vị trí chính, còn con số hợp đồng giữ đúng tên của nó.

**Đính chính bản nháp trước của mục này (25/9):** câu "và trước khi buổi nào được tất toán" chỉ đúng với
`activeRevenue` (hợp đồng đang chạy), KHÔNG đúng với `totalEarned` — hợp đồng đã COMPLETED thì tiền phần lớn
đã về ví rồi, chỉ là đã bị trừ 10%. Giữ lại đính chính này để không ai trích dẫn lại câu sai.
Bản thiết kế có "Thu nhập tháng 9" — không dựng, vì không endpoint nào trả số theo tháng.

### 26.6 — Bằng chứng (REAL emulator + BACKEND INTEGRATION, 24–25/9, tài khoản pt@example.com)

- Chuyển không gian Cá nhân ⇄ Huấn luyện viên: cả hai chiều, đổi accent tím, không trắng màn hình.
- Tổng quan: ví **28.775.000 ₫** khớp `wallets.available_balance`; 4 học viên; "đang chạy 2.000.000 ₫".
- Học viên: **35 hợp đồng · Đang tập 4 · Chờ xử lý 1 · Đã xong 30** — khớp SELECT theo `status`
  (ACTIVE 4, PENDING_PAYMENT 1, CANCELLED 29 + REJECTED 1).
- Lịch dạy: lịch Tháng 9/2026 bắt đầu từ T2, ngày 1 rơi vào T3 (đúng), hôm nay được tô.
  Khung giờ rảnh đọc đúng **T4 08:00–12:00, T6 14:00–18:00** = `pt_availability`.
- **Đường ghi khung giờ kiểm khứ hồi**: thêm T2 08:00–09:00 → Lưu → DB có 3 dòng (MONDAY xuất hiện) →
  xoá → Lưu → DB trở lại đúng 2 dòng ban đầu. Không để lại dấu vết trên tài khoản dùng chung.
- Chi tiết học viên (PT-03): hợp đồng John Doe `3ad55e9a…` — gói, **Đang hiệu lực**, 0 buổi, bắt đầu
  **22/09/2026** (DB `2026-09-21 17:42 UTC` = 22/9 giờ VN), hết hạn **—** (null), giá trị **500.000 ₫**.
- Ví PT: số dư, danh sách yêu cầu rút (Đã chi trả / Từ chối + lý do), lịch sử có
  "Giải phóng tiền tạm giữ" — `ptTransactionLabel` dịch đúng chuỗi nội bộ của payment-service.
- **Yêu cầu rút tiền thật** (tiêu chí tiền của Phase 10): nhập 20.000 ₫ + tài khoản nhận, gửi →
  `withdrawal_requests` có dòng mới **`status = PENDING`**, `payout_info = 0123456789-Vietcombank-PT`,
  `created_at = 2026-09-24 17:23:09`. Màn hình hiện "20.000 ₫ · Chờ duyệt · Đang chờ xử lý — sẽ chuyển khoản
  thủ công". Không có tiền nào dịch chuyển: số dư vẫn 28.775.000 ₫ (đúng thiết kế — admin mới chi trả).
  Yêu cầu này **để nguyên** cho admin xử lý ở Phase 13; nó là dấu vết duy nhất phase này để lại trên
  tài khoản dùng chung.
- Khôi phục phiên: force-stop rồi mở lại app → vào thẳng không gian PT, đúng tài khoản, không trắng màn hình.

### 26.7 — Quan sát dữ liệu (không sửa)

- Ba hợp đồng ACTIVE của pt@example.com trỏ tới `client_user_id` **không còn tồn tại** ở cả `users` lẫn
  `user_profiles` (dữ liệu E2E mồ côi) → hiện "Học viên". Đây là fallback đúng, không phải lỗi hiển thị.
- Một `withdrawal_requests.rejection_reason` chứa ký tự U+FFFD trong CHÍNH DB
  (`hex = 536169207468efbfbd...`), nên hiện "Sai th?ng tin ng?n h?ng". Dữ liệu hỏng sẵn từ trước, web cũng
  hiện y hệt — không sửa dữ liệu để làm đẹp màn hình.

### 26.8 — Chưa làm ở phase này (theo manifest)

PT-07 hợp đồng, PT-08/09/11 chợ & đơn dịch vụ, PT-10 gói dịch vụ, PT-12 duyệt giáo án, PT-13 hợp tác gym,
WB-13 lộ trình học viên — tất cả thuộc **Phase 11**. Các luồng phản hồi đổi lịch và báo cáo vắng mặt của
web cũng để Phase 11 cùng cụm tranh chấp.

### 26.9 — Hai lỗi của bản WEB tìm ra từ phase này, Ngài cho phép sửa luôn (25/9)

Ban đầu mobile chỉ **né** hai chỗ này. Ngài hỏi lại "có phải lỗi không", tại hạ kiểm bằng code + dữ liệu
thật, xác nhận **là lỗi thật của web**, và Ngài chọn phương án **sửa ở web**. Đây là ngoại lệ có phép cho
luật "không đụng `frontend/web`" — chỉ đúng hai tệp dưới đây.

**(1) `pages/pt/PTProfilePage.tsx` — dữ liệu bịa hiện cho huấn luyện viên thật.**
Trước khi sửa, trang này hiển thị: tên `"Sarah Mitchell"`, tiểu sử tiếng Anh, `"6 years"`, 4 chip chuyên môn
`["Fat Loss","Strength Training","HIIT","Nutrition"]`, 3 chứng chỉ `["NASM CPT","Precision Nutrition L1",
"TRX Certified"]`, và "Profile Stats" `4.9 / 48 reviews`, `14 active clients`, `342 sessions done`. Tất cả là
literal cứng. Nút "Edit Profile / Save" chỉ chạy `setEditing(!editing)` — **không có mutation nào**, bấm Save
không gửi gì. `verificationStatus` cũng là `useState` ghim cứng `"approved"`.

Nguyên nhân gốc vì sao nút Save không thể lưu: `profileSchema` (user-service `models/profile.models.ts`)
**không có** khoá `bio`/`specialties`/`yearsOfExperience`/`displayName` — `PATCH /profile/me` không nhận
những trường đó. Nơi thật sự chứa chúng là **hồ sơ ứng tuyển PT** (`pt_applications.professional_bio`,
`years_of_experience`, `main_specialties`, bảng `pt_application_certificates`).

Đã sửa: đọc thật từ `GET /pt-applications/me` + `GET /profile/me` + `GET /profile/pts/:userId` +
`GET /contracts/pt/earnings`; bỏ nút Save chết, đổi thành liên kết sang `/client/pt-application` (nơi các
trường này thật sự sửa được); trạng thái xác minh đọc từ `PTApplicationStatus` thật; "Sessions Done" bỏ hẳn
vì **không endpoint nào** trả số đó — thay bằng "Hợp đồng đã hoàn thành" (`completedContracts`, có thật).

Chênh lệch nguồn phát hiện khi sửa: `UserProfile.specialties` chỉ là **bản sao phục vụ tìm kiếm**, ghi bởi
`pt_application.repository` bước "Sync search fields", và đi lạc khi hồ sơ đổi mà không lưu nháp — số liệu
sống 25/9: hồ sơ giữ `{Powerlifting, Tăng cơ}` còn đơn giữ `{Tăng cơ, Giảm mỡ, Phục hồi chấn thương}`. Trang
này ưu tiên bản của **đơn** (thứ chính HLV nhập). Tên hiển thị thì ngược lại — lấy từ hàng hồ sơ, vì đó đúng
là tên khách nhìn thấy (`enrichProfilesWithAuthNames` chỉ mượn tên tài khoản khi hàng hồ sơ trống).

**(2) `pages/pt/PTDashboard.tsx` — nhãn "Tổng thu nhập" khai khống.**
`getEarnings()` cộng `contract.price` của hợp đồng COMPLETED = doanh thu **gộp**. Nền tảng thu hoa hồng trên
mọi hợp đồng PT — `wallet.service.ts` `transferWithCommission` (`netToReceiver = amount − amount × rate`,
`PLATFORM_COMMISSION_RATE` mặc định `0.10`), kiểm bằng dữ liệu thật: `platform_commissions` `partner_type='PT'`
có `commission_rate = 0.1000`, gross 4.000.000 → phí 400.000 → PT nhận 3.600.000. Gọi đó là "thu nhập" làm
con số cao hơn tiền HLV thật nhận đúng bằng phần phí. Đã đổi nhãn thành **"Doanh thu hợp đồng"** + dòng phụ
**"Trước phí nền tảng"**. Không đổi số, không đổi endpoint — chỉ đổi chữ cho đúng.

**Kiểm chứng (REAL BROWSER + REAL HTTP/API, 25/9, pt@example.com, web dev `localhost:5173`):**
Playwright tải `/pt/dashboard` và `/pt/profile`, quét toàn bộ text: **0/8 chuỗi bịa còn sót**
(`Sarah Mitchell`, `NASM CPT`, `Precision Nutrition`, `TRX Certified`, `48 reviews`, `342`, `Tổng thu nhập`,
`6 years`); **9/9 giá trị thật hiện đúng**; **0 lỗi runtime**. Đối chiếu API: đơn `APPROVED`, kinh nghiệm
`5-10`, 3 chuyên môn, 2 chứng chỉ (`NASM-CPT`, `Sơ cấp cứu`), đánh giá `5.0/1 lượt`, `activeContracts 4`,
`completedContracts 0`. `vite build` xanh.

**Chưa làm:** không thêm cột backend nào, không mở đường sửa tiểu sử/chuyên môn ngay trên trang hồ sơ PT —
muốn vậy phải thêm trường vào `profileSchema`, vượt phạm vi "sửa lỗi".

## 27. Hợp đồng PT và các cụm còn lại của không gian HLV — Phase 11 (25/9, ĐANG LÀM)

### 27.1 — PT-07 "Hợp đồng" (xong)

`app/pt/contracts.tsx`. Bốn nhóm theo thứ tự HLV xử lý (Yêu cầu / Đang chờ / Đang dạy / Kết thúc), nhận —
từ chối kèm lý do, gửi phản hồi, chấm dứt, và danh sách buổi tập bung ra dùng lại đúng `sessionActions`
của màn Lịch dạy. Mở từ Tổng quan chứ **không** thêm tab thứ 6 (IA: năm tab là mức của bản thiết kế).

**Bước "ký hợp đồng" của bản thiết kế KHÔNG dựng.** `REQUIRE_CONTRACT_ESIGN=false` là quyết định đã chốt
(container `gymcoach-user-dev` xác nhận), nên `acceptContract` đi thẳng PENDING_REVIEW → PENDING_PAYMENT.
PENDING_SIGNATURE vẫn được **xếp nhóm** (tab "Đang chờ") để nơi nào bật lại e-sign thì hợp đồng không biến
mất, nhưng không bịa ra giao diện ký cho một bước hiện không xảy ra.

### 27.2 — E2E chéo vai trò đầu tiên (tiêu chí chính của Phase 11) — ĐẠT

REAL emulator + BACKEND INTEGRATION, 25/9, chạy trọn trên máy qua ba lần đổi tài khoản:

1. Khách `testuser001@example.com` → Dịch vụ → tìm PT → chọn "Gói 8 buổi online" → **Gửi yêu cầu**.
   DB: hợp đồng `8deea743-…` **PENDING_REVIEW**, 1.600.000 ₫, 8 buổi.
2. Đăng nhập `pt@example.com` → Tổng quan hiện ô "Hợp đồng · 1 chờ duyệt" → màn Hợp đồng, tab
   "Yêu cầu · 1" hiện thẻ *Minh Nguyễn* với nhãn phía PT **"Bạn cần duyệt"** → bấm **Nhận**.
3. DB: cùng hợp đồng chuyển **PENDING_PAYMENT**. Màn tự nhảy sang "Đang chờ · 2", nhãn đổi thành
   **"Chờ học viên trả — Bạn đã nhận, học viên chưa thanh toán"**; tab Yêu cầu về 0.
4. REAL HTTP/API với tư cách khách: `GET /contracts/client` trả đúng `PENDING_PAYMENT` cho hợp đồng đó —
   tức khách thấy trạng thái mới (màn Hợp đồng của khách đọc chính endpoint này).

Việc lật nhãn theo phía nhìn (§26.1) được chứng minh trên dữ liệu thật: cùng một `ContractStatus`, khách
đọc "Chờ PT duyệt" còn HLV đọc "Bạn cần duyệt".

### 27.3 — Lỗi tìm thấy khi chạy E2E và đã vá

Khách gửi yêu cầu tới PT mình **đã** có hợp đồng → server trả 409 với câu **tiếng Anh** nguyên văn
"You already have an active or pending contract with this PT", và app hiện thẳng câu đó. Toast vẫn chạy
(ảnh chụp sau 3 giây bị trượt nên ban đầu tưởng là lỗi im lặng — đã kiểm lại ở mốc 1 giây).
Đã thêm `contractRequestError()` (`src/features/services/contracts.ts`) ánh xạ sang tiếng Việt và cho qua
nguyên văn những câu vốn đã tiếng Việt — vì hầu hết lỗi của endpoint này đã được dịch, chỉ dòng 392 sót.
Nguồn gốc ghi ở `MOBILE_BACKEND_GAPS.md` GAP-19 (sửa tận gốc là đổi một chuỗi ở user-service).

### 27.4 — PT-12 "Duyệt giáo án" (xong)

`app/pt/plan-review.tsx`. Web bày danh sách cạnh giáo án theo bố cục hai cột; trên điện thoại gộp thành
một màn: hàng chờ ở trên, lịch tập của giáo án đang xem ở dưới, hai quyết định ghim đáy màn hình để
lịch dài bao nhiêu vẫn bấm tới. `weeklySchedule` là JSON do AI sinh nên được làm phẳng ở `planSchedule`,
thiếu tên ngày thì đánh số, thiếu set/rep thì vẫn hiện tên bài — không in "undefined".

### 27.5 — PT-10 "Gói dịch vụ" và PT-13 "Hợp tác phòng gym" (xong)

Web nhét cả hai vào trong `PTProfilePage`; trên điện thoại mỗi thứ là một màn mở từ trang Hồ sơ, đúng
kiểu hub của "Cá nhân" bên khách — nhét hết vào một trang thì trang nào cũng thành cuộn dài vô tận.

**Gói dịch vụ** là thứ khách chọn khi gửi yêu cầu hợp đồng (đầu kia của PT-07), nên hiện giá mỗi buổi
cạnh giá cả gói. Xoá là **lưu trữ mềm** phía server (hợp đồng đã ký còn tham chiếu tới gói), nên hộp xác
nhận nói "ngừng bán", không hứa hẹn xoá hẳn.

**Hợp tác** — ba tỷ lệ phải cộng **đúng 100%** và phần nền tảng không dưới `MIN_PLATFORM_RATE` (0.10);
gym-service từ chối bảng lệch dù chỉ 0,01 (`validateRates`), nên biểu mẫu kiểm cùng luật trước khi gửi.
Tỷ lệ chỉ là **bản mẫu**: schema ghi rõ hợp đồng khi ký sẽ sao chép tỷ lệ lên chính nó, nên thương lượng
lại sau đó không đụng tới hợp đồng đang chạy — màn hình nói thẳng điều đó.
Việc **ai đang tới lượt** lấy từ `proposedBy` chứ không từ `status`: schema định nghĩa `proposedBy` là
"người đang giữ đề nghị trên bàn, tức người KHÔNG phải tới lượt". Đoán theo status sẽ bảo HLV ngồi chờ
trong khi bóng đang ở chân họ.

### 27.6 — PT-09 đơn dịch vụ 1-1 + PT-08 dịch vụ của chính PT (xong)

`app/pt/service-orders/` — hai mục trên một màn. Web tách đôi: đơn ở `/pt/service-orders/:id` (không có
danh sách) còn danh mục dịch vụ của PT lại nằm trong trang **khách** `/client/plans` chặn theo `isPT`.
Trên điện thoại cách chia đó vô lý: một dịch vụ và các đơn nó sinh ra là cùng một việc, mà bắt HLV đổi
không gian để sửa danh mục của chính mình thì càng vô lý.

Mỗi trạng thái chỉ mở đúng **một** hành động server chấp nhận (`sellerOrderAction`); trạng thái đang chờ
khách thì nói thẳng là chưa có việc, thay vì bày nút chắc chắn bị từ chối. Bản nháp AI là **tham khảo**:
`generatePlanDraft` điền danh sách ngày, HLV sửa, và chỉ hành động của HLV mới giao bản nháp — người chịu
trách nhiệm trước khách là HLV chứ không phải mô hình.

**Lỗi bắt được khi kiểm trên máy:** bộ chọn bài tập hiện một danh sách **trắng trơn**. Danh mục bài tập
dùng trường `exerciseName` (kèm `typeOfEquipment`, `muscleGroupsActivated[]`), không phải `name` như tại hạ
giả định. Đã sửa; kiểm lại thì ra đúng tên thật (3/4 Sit-Up · abdominals · BODYWEIGHT…).

### 27.7 — WB-13 lộ trình học viên (xong)

Thẻ "Lộ trình" trong màn chi tiết học viên, chỉ hiện khi hợp đồng ACTIVE. Ranh giới đúng như Phase 0.3 đã
chốt và fitness-service ép: **chỉ khách** kích hoạt / advance / rebuild / archive; HLV chỉ xem và **đề xuất
bản nháp** để khách duyệt. Nên thẻ này có đúng một thao tác ghi, và nói rõ người quyết là khách.
`getClientRoadmap` cố ý trả lộ trình đang chạy và bản nháp đang chờ **tách riêng**, nhờ vậy một bản nháp
đang chờ khách không bị nhầm thành "chưa có lộ trình" rồi mời tạo thêm bản thứ hai.
Hai hàm `getClientRoadmap`/`createRoadmapDraft` được port từ web vào `ptCoachService` (mobile trước đó thiếu).

### 27.8 — PT-11 đã có sẵn từ Phase 8

Đăng kế hoạch lên chợ (`MineSection` trong `features/plans/MarketTab.tsx`): đăng, đăng lại phiên bản mới,
gỡ khỏi chợ, gợi ý cải thiện. Manifest ghi PT-11 "hiện cho MỌI user, không riêng PT" nên nó nằm ở không
gian khách và Phase 8 đã dựng — không làm lại.

### 27.9 — Bằng chứng Phase 11 phần sau (REAL emulator + BACKEND INTEGRATION, 25/9, pt@example.com)

- Tổng quan: 5 ô hành động, ô **Đơn dịch vụ** hiện huy hiệu **3 cần xử lý** — khớp số đơn ở trạng thái
  PT_REVIEWING; ô **Duyệt giáo án** báo "Không có giáo án chờ" (hàng chờ rỗng thật).
- PT-09: danh sách xếp đơn cần xử lý lên đầu với nhãn phía người bán **"Bạn đang phân tích"**, đơn đã huỷ
  ở dưới. Mở chi tiết: phiếu khách (goal MUSCLE_GAIN thật), bộ soạn giáo án, khối AI, bộ chọn bài tập đọc
  đúng danh mục thật sau khi sửa lỗi tên trường.
- PT-10: hai gói đang bán (1.600.000 đ / 8 buổi = 200.000 đ/buổi; 3.000.000 đ / 10 buổi = 300.000 đ/buổi),
  một gói tạm ẩn, các gói đã ngừng bán mờ đi và không còn nút — khớp dữ liệu thật của tài khoản.
- PT-13: danh sách hợp tác thật với tỷ lệ **55% / 35% / 10%** (cộng đúng 100%, nền tảng ở mức sàn),
  trạng thái "Đã chấm dứt", vòng và hạn trả lời.
- **Không thực hiện**: giao bản nháp giáo án, tạo/ngừng bán gói, gửi hay trả lời đề nghị hợp tác, đề xuất
  lộ trình. Đều là thao tác ghi làm dịch chuyển máy trạng thái thật trên tài khoản dùng chung; phần đọc và
  phần kiểm hợp lệ của biểu mẫu đã xác nhận, phần ghi chờ Ngài cho phép nếu muốn chạy thật.

### 27.10 — Đổi lịch và báo PT vắng mặt (xong) — đính chính một sai sót của báo cáo trước

Bản trước của mục này ghi hai luồng đó "đi cùng GAP-13 đang chờ". **Sai.** GAP-13 là khiếu nại
**đơn dịch vụ 1-1** bên ai-service; còn đổi lịch / báo vắng là **buổi tập** bên user-service, không có
gì chặn. Web có đủ cả hai ở `PTSchedulePage`. Đã dựng vào `app/pt/schedule.tsx`:

- **Báo PT vắng mặt**: dải cảnh báo đầu màn đọc `GET /sessions/no-show-reports` (đã quá khứ nên không
  nằm trong danh sách sắp tới), kèm lý do khách nêu; hai lựa chọn **Tôi có vắng** (hộp xác nhận nói rõ
  sẽ bồi thường, không hoàn tác) và **Phản đối** (bắt buộc viết giải trình). Màn hình nói thẳng
  **im lặng được tính là đồng ý** (money-flow 4.3).
- **Đổi lịch hai chiều**: khách xin dời → khối trong thẻ buổi tập với Đồng ý / Từ chối, kèm câu
  "từ chối thì buổi giữ nguyên giờ cũ, không phải huỷ"; HLV xin dời → nút chỉ hiện khi server sẽ nhận
  (chưa có đề nghị nào đang mở — cái thứ hai bị 409 — và còn ≥ 12 giờ trước buổi).

Cả hai dùng lại bộ chuẩn hoá của Phase 7 (`features/services/sessions.ts`); chỉ lật chiều
"incoming/outgoing" cho đúng ghế HLV. Thêm 6 ca kiểm (tổng module PT: 44).

### 27.11 — Các thao tác GHI đã chạy thật (Ngài cho phép, 25/9)

- **Tạo gói dịch vụ**: `Goi-thu-nghiem` 10 buổi / 1.200.000 đ / OFFLINE, hạn dùng để trống → DB
  `validity_days = NULL` (đúng: ô trống gửi `null` chứ không bỏ qua khoá). Sau đó **ngừng bán** →
  `is_active = f`, `archived_at` có giá trị. Khứ hồi trọn vẹn, không để lại gói sống nào.
- **Đề nghị hợp tác**: gửi tới "Chi nhanh W3" với 60/30/10 → DB `gym_pt_collaborations`
  `b4032299…` **PENDING**, `proposed_by = PT`, `0.6000 / 0.3000 / 0.1000`, vòng 1,
  hết hạn 02/10/2026. **Dư lại**: PT không rút lại được — `terminate` chỉ nhận trạng thái ACCEPTED
  (collaboration.service.ts:294) — nên dòng này tự hết hạn sau 7 ngày.
- **Giao bản nháp giáo án**: thêm bài "3/4 Sit-Up" 3×10 nghỉ 90s vào Buổi 1 rồi gửi → đơn
  `66759dbd…` chuyển **PT_REVIEWING → DRAFT_DELIVERED**. Đây là thay đổi trạng thái thật, không hoàn tác.
- **Đề xuất lộ trình — KHÔNG chạy được** (không phải bỏ qua): John Doe đã có lộ trình đang chạy nên
  guard ẩn nút đề xuất (đúng thiết kế — không mời tạo bản nháp thứ hai), ba hợp đồng ACTIVE còn lại
  thuộc về tài khoản khách **đã bị xoá**. Cần một khách có hợp đồng ACTIVE và chưa có lộ trình.

**Lỗi bắt được khi chạy**: thẻ Lộ trình và toàn bộ chữ mới ở màn Lịch dạy hiện **chuỗi escape thô**
(ví dụ `L` + `\u1ed9` thay vì `Lộ`) vì script vá ghi escape nguyên văn vào TSX. Đã giải mã 154 + 268
chuỗi, kiểm lại trên máy ra đúng tiếng Việt. Bài học: vá tệp bằng script thì viết thẳng ký tự Unicode,
đừng dùng escape trong chuỗi thay thế.

## 28. Không gian Chủ phòng gym — Phase 12, cụm A (25–26/9)

Cụm A gồm cổng vào không gian, **GY-01** Tổng quan và **GY-02** Phòng gym. Các cụm còn lại
(WB-04 gói hội viên, GY-04 ví, GY-05 quản lý chi nhánh, GY-06 hợp tác PT, WB-18 hồ sơ chủ gym,
GY-08 nhận tiền, WB-15/16 tự đăng ký + hồ sơ 9 bước, GY-09 giấy tờ, WB-01 đổi mật khẩu bắt buộc)
chưa làm.

### 28.1 Bất biến một-chủ-một-thương-hiệu: đã kiểm ở hai tầng trước khi dựng

Không suy từ tài liệu. Đọc thẳng code:

- `GymBrand` mang `@@unique([ownerId])` (`gym-service/prisma/schema.prisma:888`) — ràng buộc ở
  **tầng CSDL**, không phải quy ước.
- `gym.service.ts createGym` **suy thương hiệu từ quyền sở hữu và bỏ qua `brandId` client gửi**
  (trường này chỉ còn nhận cho tương thích ngược). Không có brand thì ném lỗi
  "Hãy đặt tên thương hiệu của bạn trước khi tạo phòng gym".

Hệ quả bắt buộc cho giao diện, đã tuân: **không có bộ chọn thương hiệu ở bất kỳ đâu**, không có nút
tạo thương hiệu thứ hai, và biểu mẫu thêm chi nhánh **không có trường `brandId`** — chỉ một dòng
chỉ-đọc "Chi nhánh này sẽ thuộc thương hiệu &lt;tên&gt;". Chuyển đổi ở đầu màn Tổng quan là chuyển
**chi nhánh**, không phải chuyển thương hiệu.

### 28.2 Cổng vào: `RequirePartnerAccess`, và vì sao nó đóng khi lỗi

`deriveAccessState` (`gym-service/src/services/partner-application.state.ts:37`) là thẩm quyền điều
hướng, 11 giá trị. `ownerLanding()` ánh xạ vét cạn: ACTIVE/LEGACY → vận hành ·
APPROVED_PAYOUT_PENDING → bước nhận tiền · 5 trạng thái ứng viên → hồ sơ ·
RESTRICTED/SUSPENDED/TERMINATED → chặn. `switch` vét cạn kèm `const never: never` nên **thêm một
giá trị enum mới là lỗi biên dịch**, không phải âm thầm rơi vào "vận hành".

Khác `RequireOnboarding` (Phase 4, **fail-open**): cổng này **fail-closed**. Lý do ghi thẳng trong
tệp: onboarding là tiện ích trải nghiệm, còn đây là ranh giới phân quyền — không đọc được trạng thái
thì không mở. Truy vấn dùng `staleTime: 0` + `refetchOnMount: "always"` để một hồ sơ vừa được duyệt
không bắt chủ gym cài lại app mới thấy.

### 28.3 GY-01 — Tổng quan: bảy lần đọc, và cái bẫy brandId

Cùng bảy lần đọc như web: `listOwnedGyms`, `getOwnedWallet(gymId)`, **`listOwnedPlans(brandId)`**,
`listOwnedMemberships(gymId)`, `listCheckins(gymId)`, `getGymReviews(gymId)`,
`collaborationService.listForOwner()`.

**Gói hội viên thuộc THƯƠNG HIỆU, không thuộc chi nhánh.** Web mang sẵn một chú thích về chính chỗ
này: truyền nhầm `gymId` vào `listOwnedPlans` thì mỗi lần mở Tổng quan là một 404 và ô "Gói hội viên
đang bán" đứng yên ở 0. Bản di động suy `brandId` từ chính chi nhánh đang chọn — không thêm request.
Đã kiểm trên máy: ô này ra **20**, đúng số gói ACTIVE của thương hiệu.

"Cần chú ý" đặt **trên** hàng số liệu (GYM_MANAGEMENT master spec §61/§66), suy từ chính danh sách
chi nhánh đã tải: chi nhánh `PENDING_REVIEW`, và chi nhánh có `changesRequestedAt` (kèm
`pendingNameNote`/`pendingAddressNote` nếu admin có ghi chú).

Khác web một chỗ, có chủ ý: web đặt một danh sách chi nhánh ở cuối Tổng quan. Tài khoản kiểm thử có
54 chi nhánh, và 54 dòng đó chôn mọi thứ phía trên trong khi tab "Phòng gym" đã là nơi của chúng —
nên bản di động bỏ danh sách này, giữ chuyển-chi-nhánh bằng dãy chip ở đầu màn.

Hai biểu đồ của web (tròn + cột, Recharts) vẽ bằng `View` thuần như phần còn lại của dự án
(`react-native-gifted-charts` có trong `package.json` nhưng chưa màn nào dùng): cột check-in 7 ngày
và các thanh tỉ lệ phân bổ hội viên.

`membershipMix` giữ **mọi** trạng thái máy chủ trả về. Web dùng `Record` bốn khoá cứng
(ACTIVE/PENDING_PAYMENT/EXPIRED/CANCELLED) nên `PENDING_ISSUE` — có thật trong enum — sẽ cộng vào
`undefined`. Nhãn dùng lại `membershipStatusLabel` của Phase 7, không chép bảng nhãn thứ hai.

### 28.4 GY-02 — Phòng gym: dialog, không phải wizard

Web có hai đường tạo chi nhánh: wizard 7 bước (`AddBranchWizardPage`, còn nằm sau nút "thử wizard
mới") và dialog trong `MyGymsPage`. **Dialog mới là đường đang chạy thật** nên đó là cái được port:
tên + số nhà/tên đường (hai trường bắt buộc, đúng hai trường `createGym` đòi), tỉnh/phường, thành phố
hiển thị, giới thiệu ≤300, và bản đồ ghim.

Bản nháp (`DRAFT`) của wizard vẫn được liệt kê, nhưng **nói thẳng** là phải hoàn tất trên web —
không dẫn tới một màn app chưa có. Phòng gym độc-lập-không-thương-hiệu (dữ liệu cũ) hiện ở mục riêng,
chỉ đọc.

Đổi tên thương hiệu chỉ ghi `pendingName`; màn nói rõ tên mới chỉ công khai sau khi Gymini duyệt, và
hiện tên đang chờ nếu có. MANAGER không thấy nút đổi tên lẫn nút thêm chi nhánh (ẩn, không phải hiện
rồi 403 — spec §61); phân biệt bằng `getOnboardingStatus().role`, và **mặc định khi chưa tải xong là
OWNER**, giống web, để chủ gym thật không bị giấu mất nút của chính mình.

### 28.5 Adapter mới của phase: bản đồ ghim kéo-thả

`MapPinPicker` là bản kéo-thả của `BranchMap` (Phase 7): WebView + Leaflet + tile OpenStreetMap, giữ
đúng quyết định 21/9 (miễn phí, không khoá API, không thư viện bản đồ native). Hai chế độ vì WebView
nuốt cử chỉ vuốt: ô trong trang chỉ để xem, chạm mới mở toàn màn hình để kéo. Toạ độ chỉ ra ngoài khi
bấm "Dùng vị trí này" — kéo thử rồi đóng bằng X thì ghim cũ còn nguyên. Chưa có ghim thì mở khung
nhìn cả nước và **không** đặt toạ độ mặc định: một ghim giữa nước là toạ độ bịa.

Tự ghim theo địa chỉ: `geocode.ts` port nguyên hợp đồng của web (Nominatim, ba lần thử
địa-chỉ → tên-đường → phường, cách nhau >1 giây, luôn kèm tên phường). Khác web đúng một chỗ:
`DOMException` không có trong Hermes nên huỷ giữa đường ném `Error` mang `name = "AbortError"`.

**Hai lỗi bắt được khi chạy thật, đã sửa:**

1. Ô bản đồ xem trước **trắng trơn** sau khi đóng màn ghim — Android thu hồi bề mặt WebView nằm dưới
   một `Modal`. Sửa: chỉ vẽ ô xem trước khi màn ghim đang đóng, và khoá `key` theo toạ độ.
2. Cùng khoá `key` đó sửa một lỗi thứ hai chưa kịp lộ: `useMemo` của nguồn HTML chỉ phụ thuộc
   `interactive`, nên ghim **tự động** sẽ không bao giờ hiện ở ô xem trước.

### 28.6 Lỗi của Phase 10/11 phát hiện khi làm phase này

`designTokens` chỉ có 5 khoá (`mutedForeground`, `primaryDeep`, `onPrimary`, `warning`, `glass`) và
kiểu của nó là `Record<string, string>` — nên `designTokens.destructive` **qua được typecheck nhưng
là `undefined` lúc chạy**. Bảy icon đỏ ở `pt/profile`, `pt/schedule`, `pt/service-orders/[id]` đang
vẽ bằng màu mặc định. Đã đổi sang `darkColors.destructive`. Bài học: màu ngoài 5 khoá kia lấy từ
`darkColors`, và kiểu `Record<string, string>` không bắt lỗi khoá sai giúp mình.

### 28.7 Đã kiểm gì, và chưa kiểm gì

Tài khoản: `jane.smith@example.com` (GYM_OWNER thật, 1 thương hiệu, 54 chi nhánh — 50 APPROVED,
4 SUSPENDED, 0 PENDING_REVIEW), backend Docker thật, emulator Pixel_10_Pro_XL.

`REAL BROWSER`-tương-đương (**máy thật/emulator + backend thật**):
- Cổng vào mở đúng cho chủ gym ACTIVE; ba tab hiện.
- GY-01: ví 0 đ, 0 hội viên ACTIVE, 0 check-in hôm nay, **20 gói** (chứng minh đường `brandId` đúng,
  không 404), 0.0 đánh giá, cột 7 ngày, phân bổ "Đã huỷ 17 · 100%", 6 dòng hội viên gần đây,
  "Thông tin nhanh" 20 gói / 0 PT hợp tác.
- GY-02: thẻ thương hiệu (1 thương hiệu, 54 chi nhánh), danh sách chi nhánh có trạng thái + trạng
  thái mở cửa, **không có bộ chọn thương hiệu ở bất kỳ đâu**.
- Hộp "Thêm chi nhánh": dòng thương hiệu chỉ-đọc, chọn tỉnh (63 mục, có tìm kiếm), chọn phường
  (tìm không dấu "Cau Kieu" → "Phường Cầu Kiệu"), ghim tay trên bản đồ toàn màn hình
  (15.12203, 108.19336) → ô xem trước hiện đúng ghim + "Đã ghim tay", nút "Tạo chi nhánh" bật/tắt
  đúng theo hai trường bắt buộc.
- Tự ghim theo địa chỉ **có chạy** đúng thời điểm và báo "Không tìm thấy địa chỉ trên bản đồ — hãy
  ghim tay" cho "123 Phan Xich Long, Phường Cầu Kiệu, Thành phố Hồ Chí Minh".

`CODE AUDIT` + `TEST FIXTURE`: 29 test thuần cho cổng trạng thái, chi nhánh, "cần chú ý", số liệu
bảng điều khiển, thương hiệu và cách dựng câu tra Nominatim.

**Chưa chứng minh được:**
- **Nhánh tự-ghim THÀNH CÔNG.** Chỉ thấy nhánh không-tìm-thấy chạy đúng. Chưa rõ OSM có thiếu tên
  phường mới sau sáp nhập 2025 hay không — kiểm bằng `curl` từ Git Bash không kết luận được vì dấu
  tiếng Việt bị hỏng khi qua shell. Web dùng **đúng cùng một tệp** nên hành vi sẽ giống nhau.
- **Mục "Cần chú ý"** không hiện ở dữ liệu sống vì tài khoản không có chi nhánh `PENDING_REVIEW` nào
  và không có `changesRequestedAt` (đã kiểm bằng SELECT) — đúng là phải trống. Nhánh có dữ liệu chỉ
  được phủ bằng test thuần.
- **Chưa chạy thao tác ghi nào** trên tài khoản dùng chung: chưa tạo chi nhánh, chưa đổi tên thương
  hiệu. Tạo chi nhánh để lại một gym `PENDING_REVIEW` **không xoá được**; đổi tên để lại
  `pendingName` chờ admin. Xin lệnh Ngài trước khi chạy.
- **"Dùng vị trí hiện tại"** của web (`GymLocationFields`) chưa port: cần `expo-location`, tức thêm
  native module và dựng lại dev client — với rủi ro junction `D:/.rn*` đã ghi ở phase trước. Tự ghim
  theo địa chỉ + kéo ghim đã phủ phần lớn nhu cầu. Chờ Ngài quyết.

### 28.8 Thao tác ghi thật (26/9, Ngài cho phép) và những gì lộ ra khi chạy

Chạy trên tài khoản dùng chung `jane.smith@example.com`, backend Docker thật, đối chiếu DB sau mỗi
bước.

**Ghi #1 — tạo chi nhánh.** Nhập "Mobile Phase12 Test 26-09" / "88 Nguyen Hue", bấm Tạo.
`SELECT` ngay sau đó:

```
773bba49-… | Mobile Phase12 Test 26-09 | pending_name = Mobile Phase12 Test 26-09
           | 88 Nguyen Hue | PENDING_REVIEW | brand_id = dad58a17-…
```

`brand_id` khớp đúng thương hiệu duy nhất của chủ tài khoản **dù ứng dụng không hề gửi `brandId`** —
`createGym` suy từ quyền sở hữu, đúng như bất biến. Giao diện: danh sách nhảy từ 54 lên 55, thẻ mới
đứng đầu với nhãn "Chờ duyệt" và dòng "Đang chờ Gymini duyệt…", không có hàng số liệu (đúng
`showsBranchStats`).

**Nhờ chi nhánh này mà "Cần chú ý" lần đầu có dữ liệu thật**: màn Tổng quan hiện đúng một thẻ
"Mobile Phase12 Test 26-09 — Đang chờ Gymini xét duyệt lần đầu", nằm **trên** hàng KPI. Trước đó
nhánh này chỉ được phủ bằng test thuần vì tài khoản không có chi nhánh `PENDING_REVIEW` nào.

Một xác nhận ngoài dự tính: chi nhánh mới toanh, 0 hội viên, mà ô "Gói hội viên đang bán" vẫn là
**20** — bằng chứng sống rằng gói thuộc thương hiệu chứ không thuộc chi nhánh.

**Ghi #2 — đổi tên thương hiệu**, rồi hoàn tác. Đổi thành `…_Chain_X_Premium_M12`:

```
name = …_Premium_M12 | approved_name = …_Premium | pending_name = …_Premium_M12
```

Đúng hợp đồng `brand.service.ts`: đổi tên **không bao giờ** chạm `approvedName`. Giao diện cũng
đúng: tiêu đề thẻ vẫn là tên đã duyệt, còn tên mới nằm ở dòng vàng "Tên mới đang chờ Gymini duyệt".
Sau đó lưu lại tên gốc (ô nhập mồi sẵn bằng tên đã duyệt nên chỉ cần bấm Lưu).

**Vết còn lại, nói thẳng:**
- Một chi nhánh `PENDING_REVIEW` tên "Mobile Phase12 Test 26-09" trong hàng chờ duyệt của admin.
  **Không xoá được** — không có API xoá chi nhánh.
- `pending_name` của thương hiệu giờ bằng đúng `approved_name`. `updateBrand` ghi `pendingName` ở
  **mọi** lần lưu, kể cả lưu lại chính tên đang dùng, nên không có cách nào trả nó về `null` từ phía
  ứng dụng. Admin có duyệt thì cũng không đổi gì.

**Sửa theo cái vừa thấy:** dòng "Tên mới đang chờ duyệt" giờ **ẩn khi tên chờ duyệt trùng tên đang
hiển thị** — báo một thay đổi không phải thay đổi là nhiễu. Web không có xử lý này.

**Một điều chỉnh khả năng tiếp cận, KHÔNG phải sửa lỗi:** nút bút chì đổi tên có vùng chạm ~23dp,
dưới chuẩn 44dp, nên đã thêm `hitSlop` (prop mới, tuỳ chọn, của `Tappable`) và nới đệm. Tại hạ từng
tưởng nó là nguyên nhân các cú chạm không ăn, nhưng `uiautomator dump` cho thấy sheet **có** mở —
chỉ là render chậm hơn 3 giây chờ chụp màn hình. Vùng chạm nhỏ vẫn đáng sửa, nhưng nó không phải
thủ phạm.

### 28.9 `expo-location` — "Dùng vị trí hiện tại" (26/9, Ngài cho phép thử)

Cài `expo-location ~57.0.20` bằng `npx expo install`, thêm plugin vào `app.json` kèm câu xin quyền
tiếng Việt, dựng lại dev client.

**Bài học phase trước tái diễn đúng như đã ghi:** `expo install` trả **toàn bộ** junction
(`react-native`, reanimated, worklets, gesture-handler, safe-area-context, screens, svg) về đường
`.pnpm` dài. Phải chạy lại `node scripts/shorten-package-paths.js` trước khi build, và xoá
`android/build/generated/autolinking`. `nativewind` vẫn ở 4.2.6, không bị nâng.

Nút đặt trong `MapPinPicker` chứ không trong cụm tỉnh/phường như web: trên điện thoại, ghim là việc
của bản đồ. Lấy vị trí xong tính là **ghim tay**, nên tra địa chỉ sau đó không ghi đè — chủ gym đang
đứng trong phòng gym thì toạ độ của họ đúng hơn Nominatim.

**Ba thứ lộ ra khi chạy thật, đã sửa:**

1. **Không có hạn chờ.** `Location.getCurrentPositionAsync` không nhận tuỳ chọn timeout và chờ mãi
   khi máy không bắt được định vị — trên emulator nút kẹt ở "Đang lấy vị trí…" không bao giờ thoát.
   Đã cho chạy đua với hạn chờ **10 giây**, đúng bằng `timeout: 10_000` của bản web.
2. **Không có đường lui khi không có định vị mới.** Đúng lúc chủ gym đứng trong phòng gym kín mà bấm
   nút này là lúc máy khó bắt định vị nhất. Thêm `getLastKnownPositionAsync({ maxAge: 10 phút })`,
   nhưng **nói rõ là gần đúng** ("Chỉ lấy được vị trí gần đúng — hãy kiểm lại ghim trên bản đồ")
   thay vì lặng lẽ ghim như thể vừa đo. Bản định vị cũ mà ghim im lặng thì tệ hơn là không ghim.
3. Đặt tên hàm thường là `useCurrentLocation` khiến ESLint coi nó là hook (`rules-of-hooks`, **lỗi**
   chứ không phải cảnh báo). Đổi thành `pickCurrentLocation`.

**Kiểm được tới đâu (emulator Pixel_10_Pro_XL):**
- Hộp xin quyền hệ thống hiện đúng, kèm câu tiếng Việt đã khai trong `app.json`; cấp quyền
  "While using the app" chạy đúng; Android hỏi bật Location Accuracy và nhận.
- Hết 10 giây không có định vị → nút trở lại bình thường, hiện thông báo đỏ "Chưa bắt được định vị —
  ra chỗ thoáng rồi thử lại, hoặc ghim tay". Ghim cũ không bị đụng tới.

**CHƯA kiểm được — nhánh lấy vị trí THÀNH CÔNG.** `adb emu geo fix` trả `OK` nhưng emulator **không**
cập nhật vị trí: `dumpsys location` vẫn đứng ở toạ độ mặc định 37.421998,-122.084000 với `et` không
đổi. GPS của máy ảo này đóng băng từ lúc khởi động, nên không có cách nào tạo ra một định vị mới để
thử. **Cần một máy thật.** Tại hạ không dựng dữ liệu giả để cho nhánh này xanh.

## 29. Không gian Chủ phòng gym — Phase 12, cụm B (26/9)

Cụm B: **WB-04** gói hội viên của thương hiệu, **GY-04** ví chi nhánh, **GY-06** hợp tác huấn luyện
viên nhìn từ ghế chủ gym. Còn lại của Phase 12 (GY-05 quản lý chi nhánh, WB-18 hồ sơ chủ gym, GY-08
nhận tiền, WB-15/16 tự đăng ký + hồ sơ 9 bước, GY-09 giấy tờ, WB-01 đổi mật khẩu) chưa làm.

### 29.1 Hợp tác: tách module dùng chung thay vì chép bảng thứ hai

Phase 11 để bảng trạng thái hợp tác và phép kiểm tỷ lệ trong `features/pt/pt.ts` vì chỉ ghế huấn
luyện viên dùng. Cụm này dựng ghế chủ gym trên **đúng một dữ liệu đó**, nên khối chung chuyển sang
`features/collaboration/collaboration.ts`; `pt.ts` xuất lại nên các màn Phase 11 không phải sửa dòng
nào (44 test của Phase 11 vẫn xanh).

Điểm cốt lõi: nhãn phụ thuộc phía trở thành **tham số**, không phải hằng số nhúng trong hàm —
`collabStatusFor(row, viewer)`. Cùng một dòng, PT thấy "Bạn cần trả lời" thì chủ gym **bắt buộc**
thấy "Chờ huấn luyện viên trả lời". Có test khẳng định hai phía không bao giờ cùng nói "bạn cần trả
lời".

Khác web một chỗ có chủ ý: web bắt chủ gym **gõ tay UUID của huấn luyện viên** để mời. Trên điện
thoại đó là việc không làm nổi, nên ở đây chọn từ danh bạ công khai `GET /profile/pts` — cùng nguồn
màn tìm PT của khách đang dùng.

### 29.2 Ví: trần rút tính đúng như máy chủ, và một lỗi cũ của Phase 9/10

`withdrawal.service.ts` cho rút tối đa `availableBalance − tổng các yêu cầu còn PENDING`. Yêu cầu đã
**APPROVED** thì tiền đã rời `availableBalance` sang `lockedBalance`, trừ nữa là trừ hai lần.

Web không tính con số này: biểu mẫu của web gửi đi rồi mới nhận 400 `EXCEEDS_WITHDRAWABLE_BALANCE`.
Bản di động tính trước nên nút phản ánh đúng thứ máy chủ sẽ chấp nhận.

**Lỗi cũ phát hiện khi làm việc này:** ví huấn luyện viên (Phase 10) và ví khách (Phase 9) — cả hai
đều của tại hạ — truyền thẳng `availableBalance` làm trần, thiếu bước trừ PENDING, dù cả hai màn
**đã tải sẵn** danh sách yêu cầu. Đã đưa `withdrawableCeiling` vào `features/wallet/wallet.ts` và
vá cả ba màn.

Cũng suýt tạo bản trùng: `withdrawFormError` và `withdrawalStatus` đã có sẵn trong module ví từ
Phase 9. Đã bỏ bản thứ hai vừa viết và dùng lại bản gốc — ví khách, ví HLV và ví chi nhánh đọc cùng
một bảng nhãn.

### 29.3 Gói hội viên thuộc THƯƠNG HIỆU

Không có bộ chọn chi nhánh trên màn này, vì không còn gì thuộc riêng một chi nhánh để chọn: mua một
lần, check-in ở chi nhánh nào cũng trừ chung một hạn mức lượt. Nhãn cửa sổ mở bán bám theo
`isPlanOnSale` của gym-service để nhãn khớp với việc khách có thực sự nhìn thấy gói hay không.

Biểu mẫu chặn trước những gì máy chủ sẽ từ chối: giá > 0, thời hạn là số ngày nguyên dương, giới hạn
lượt nguyên dương nếu có, ngày đúng dạng và ngày kết thúc không trước ngày bắt đầu.

### 29.4 Bộ chọn chi nhánh: 55 chip là không dùng được

Tổng quan và Ví ban đầu dùng dải chip ngang như thiết kế. Tài khoản kiểm thử có **55 chi nhánh** —
dải chip thành băng chuyền vô tận, không có cách nào tìm theo tên. `BranchSwitcher` giữ chip khi ≤ 4
chi nhánh và chuyển sang bộ chọn có ô tìm kiếm (`SelectField`, tìm không dấu) khi nhiều hơn. Kiểm
thật: gõ "Titan" ra đúng "Titan Gym" trong 55 chi nhánh.

### 29.5 Ba lỗi bắt được khi chạy trên máy

1. **Tỷ lệ nền tảng hiện "—" trên mọi dòng hợp tác.** Tên trường là `platformRate`, KHÔNG phải
   `proposedPlatformRate` như hai trường kia. Tại hạ đoán theo quy luật đặt tên thay vì đọc phản hồi
   thật. Đã đối chiếu `GET /owner/collaborations` và sửa; ghi chú lý do ngay trên kiểu dữ liệu.
2. **Mọi dòng hợp tác hiện chung một chữ "Huấn luyện viên".** Dòng dữ liệu chỉ có `ptUserId`, không
   có tên, mà tại hạ lại chỉ tải danh bạ khi mở hộp mời. Giờ tải luôn; ai không có trong danh bạ thì
   hiện mã rút gọn chứ không phải một nhãn chung cho tất cả.
3. **`useCurrentLocation`-kiểu đặt tên lặp lại**: một `useMemo` thừa trong màn Ví làm lint vượt
   baseline. Đã bỏ.

### 29.6 Đã kiểm gì (emulator + backend Docker thật, `jane.smith@example.com`)

- **WB-04**: danh sách gói theo thương hiệu; **tạo gói thật** "Mobile P12 Test Plan" 250.000 ₫/30
  ngày → DB `brand_id` đúng thương hiệu duy nhất, `status=ACTIVE`; **ngừng bán** → DB `INACTIVE`,
  nhãn đổi thành "Đã ngừng", nút đổi thành "Mở bán lại". Vết để lại: một gói INACTIVE.
- **GY-04**: chi nhánh 0 đồng → nút rút tắt kèm "Chưa có số dư nào rút được"; đổi sang "Titan Gym"
  (460.353 ₫ thật) → nút bật, hộp rút ghi "Rút được tối đa 460.353 ₫", nhập 900.000 → nút tắt kèm
  "Số tiền vượt quá số dư khả dụng". Lịch sử hiện yêu cầu 200.000 ₫ "Đã chi trả" ngày 24/8.
  **Không gửi yêu cầu rút thật** — nó tạo một dòng tiền mà quản trị viên phải xử lý tay, vết nặng
  hơn hẳn một gói ngừng bán.
- **GY-06**: danh sách gộp mọi chi nhánh, tên huấn luyện viên tra từ danh bạ, tỷ lệ 50/40/10 hiện
  đủ ba phần, "Chấm dứt hợp tác" chỉ hiện ở dòng ACCEPTED. Hộp mời: chọn chi nhánh, chọn huấn luyện
  viên, ba ô tỷ lệ, nút tắt kèm "Chọn huấn luyện viên."
  **Không gửi lời mời thật** — một đề nghị PENDING không rút lại được (đã ghi ở Phase 11).

**Chưa chứng minh được:** nhánh trả lời một đề nghị (đồng ý / từ chối / trả giá lại) — tài khoản
không có đề nghị nào đang chờ chủ gym trả lời, và tạo ra một cái để thử thì phải gửi lời mời thật từ
phía huấn luyện viên. Nhánh này chỉ được phủ bằng test thuần.

**Gotcha môi trường (mới):** bật lại container bằng `docker start` từng cái sau khi Docker Desktop
khởi động lại làm **mất alias DNS** của mạng compose — gateway báo `getaddrinfo ENOTFOUND
auth-service` dù auth-service `healthy`. Phải dùng `docker compose -f infra/compose/docker-compose.dev.yml up -d`.
Lúc đó cổng `RequirePartnerAccess` đóng đúng như thiết kế và nói "Không đọc được trạng thái hồ sơ" —
fail-closed hoạt động thật, chỉ là nguyên nhân nằm ở hạ tầng.

## 30. Không gian Chủ phòng gym — Phase 12, cụm C (27/9)

Cụm C: **GY-08** thiết lập/nhận tiền, **WB-18** hồ sơ chủ gym, **GY-05** người quản lý chi nhánh.
Còn lại của Phase 12: WB-15/16 tự đăng ký + hồ sơ 9 bước, GY-09 giấy tờ, WB-01 đổi mật khẩu bắt buộc.

### 30.1 GY-08 là COMPONENT, không phải route

Trình thiết lập nằm ở `features/gymOwner/PartnerOnboardingWizard.tsx` chứ không phải
`app/gym-owner/onboarding.tsx`, vì hai lý do bắt buộc:

1. Một route dưới `app/gym-owner/` nằm **bên trong** đúng vùng mà `RequirePartnerAccess` đang chặn —
   cổng không cho trẻ con render thì route đó không bao giờ tới được.
2. Nó phải là màn chặn toàn màn hình **không có thanh tab**: rời khỏi thiết lập không phải là hoàn
   tất nó. Chỉ có "Đăng xuất", đúng như web.

Nên `RequirePartnerAccess` giờ **dẫn thẳng** trạng thái `APPROVED_PAYOUT_PENDING` vào trình thiết
lập, thay vì giải thích rồi bảo người dùng sang web như bản cụm A.

Bước đang dở lấy từ `currentStep` của máy chủ, **không giữ bản sao ở client** — đóng app giữa chừng
mở lại rơi đúng chỗ cũ, và điều đó tự đúng khi không có trạng thái nào ở máy để lệch. Quản lý chi
nhánh chỉ thấy bước liên hệ, đúng như `getProgress` chỉ đòi bước đó ở họ.

### 30.2 WB-18: chỉ sửa bốn thứ, và tên thương hiệu là một YÊU CẦU

Sửa được: thương hiệu (tên + giới thiệu + 4 mạng xã hội), số điện thoại, tài khoản nhận tiền, mật
khẩu. **Không** sửa được tên pháp lý / mã số thuế / giấy phép — đã qua Gymini xác minh, cho sửa tự
do thì lần xác minh đó thành vô nghĩa; màn nói thẳng câu đó thay vì im lặng giấu đi.

`brandProfilePayload` chỉ gửi `name` khi tên **thật sự** đổi. Không có bước này thì lưu mỗi một link
Facebook cũng đẻ ra một `pendingName` chờ admin duyệt — đúng cái bẫy đã gặp ở §28.8, lần này chặn
từ đầu và có test riêng.

Link mạng xã hội kiểm cùng luật `socialUrl` của gym-service: bắt buộc `https`, đúng tên miền của
từng mạng (bỏ tiền tố `www/m/vm/vt`, `youtu.be` hợp lệ). Kiểm thật trên máy: `http://facebook.com/…`
ra viền đỏ + câu giải thích ngay dưới ô, và nút Lưu tắt — không phải gửi lên rồi mới nhận 400.

Quản lý chi nhánh không thấy khối tài khoản nhận tiền: **máy chủ thậm chí không trả `payout` cho
họ**, nên vẽ ô rỗng ra là vẽ một thứ không tồn tại.

### 30.3 Tab thứ tư, lệch bản thiết kế có chủ ý

`gymTabs` của Figma có ba tab. WB-18 là màn web mọc thêm **sau** khi Figma vẽ xong, và nó chứa mật
khẩu + tài khoản nhận tiền — không thể chôn sau hai lần bấm. Mọi không gian khác đều có tab hồ sơ,
nên đó là chỗ người dùng sẽ đi tìm. Người quản lý (GY-05) thì nằm sau một dòng trong Hồ sơ: việc
không thường xuyên, và chỉ chủ sở hữu mới thấy.

### 30.4 Bỏ `useEffect` mồi state — dùng đúng mẫu của React

Sáu ô nhập "mồi bằng dữ liệu máy chủ nhưng người dùng sửa được" ban đầu viết bằng
`useEffect` + `setState`, và lint gọi đúng tên: render tầng. `useServerSeededState` (mới, ở
`src/hooks`) dùng mẫu "điều chỉnh state khi prop đổi" của chính React — so sánh khoá ngay trong lúc
render và `setState` tại chỗ, React dựng lại trước khi vẽ nên không nhấp nháy, không vòng render
thừa. Khoá quyết định KHI NÀO mồi lại; giữa hai lần đổi thì chữ người dùng đang gõ là bất khả xâm
phạm.

### 30.5 Một lỗi dùng-được-thật bắt trên máy

Hộp mời người quản lý vẽ **toàn bộ 55 chi nhánh** thành 55 ô tích, đẩy nút "Gửi lời mời" xuống dưới
cùng và không có cách nào tìm theo tên. Đã thêm ô tìm (không dấu) và, khi chưa gõ gì, chỉ bày 8 chi
nhánh kèm dòng "Còn 47 chi nhánh nữa — gõ tên để tìm"; những chi nhánh **đã chọn** luôn hiện để
không ai mất dấu lựa chọn của chính mình. Web không gặp lỗi này vì màn hình rộng, nhưng cùng dữ liệu
đó trên web cũng là một cột 55 dòng.

Cùng họ với lỗi "55 chip" ở §29.4: dữ liệu thật của tài khoản kiểm thử lớn hơn nhiều so với thứ
thiết kế giả định, và chỉ chạy thật mới lộ ra.

### 30.6 Đã kiểm gì (emulator + backend Docker thật, `jane.smith@example.com`)

- **WB-18**: bốn khối hiện đúng, nhãn vai trò "Chủ phòng gym", tên thương hiệu mồi đúng giá trị
  khách đang thấy, ô giới thiệu đếm ký tự, bốn ô mạng xã hội; **kiểm luật link thật** (`http://` →
  viền đỏ + nút Lưu tắt); ô tài khoản nhận tiền, dòng dẫn sang Người quản lý, đổi mật khẩu (tắt khi
  chưa đủ), ghi chú pháp lý, Đăng xuất.
- **GY-05**: trạng thái rỗng; **mời thật** `p12-manager@example.com` gán vào chi nhánh kiểm thử →
  DB `partner_invitations` PENDING/MANAGER với đúng `scoped_gym_ids`; hộp "Đã tạo lời mời" hiện liên
  kết mời thật kèm nút sao chép; **thu hồi** → DB `REVOKED`, danh sách về rỗng.
  **Không để lại vết** — lời mời đã bị thu hồi.

**CHƯA kiểm được trên máy — GY-08.** Trình thiết lập chỉ hiện với chủ gym chưa có
`onboardingCompletedAt`; tài khoản đang dùng đã hoàn tất từ lâu. DB có bốn chủ gym đang dở thiết lập
(`e2e-…@partner-e2e.test`) nhưng không có mật khẩu của họ, và tại hạ **không đổi mật khẩu tài khoản
người khác trong DB để cho một bài kiểm xanh**. Phần này hiện chỉ có: 17 test thuần (gồm cả việc
`currentStep` bị kẹp đúng khoảng và quản lý chi nhánh chỉ có một bước) và `CODE AUDIT` đường dẫn từ
`RequirePartnerAccess`. Muốn kiểm thật thì cần một tài khoản đối tác mới — đúng là thứ WB-15/16 ở
cụm D sẽ dựng.

## 31. Không gian Chủ phòng gym — Phase 12, cụm D (27/9)

Cụm D: **WB-15** tự đăng ký + liên kết xác minh, **WB-16** hồ sơ 9 bước + màn trạng thái,
**GY-09** giấy tờ, **WB-01** đổi mật khẩu bắt buộc. Đây là cụm mở khoá được việc tạo một chủ gym
mới hoàn toàn từ ứng dụng.

### 31.1 Máy chủ quyết định còn thiếu gì — không có bộ kiểm thứ hai

`GET /owner/application` trả `missing[]` theo từng `section`. Mọi câu hỏi của wizard — mở ra đứng ở
bước nào, tiến độ mấy phần trăm, bước nào đã xong, còn gì chặn nộp — đều suy từ đúng mảng đó. Không
có bộ kiểm hợp lệ song song ở máy, vì hai bộ luật song song là hai bộ luật sẽ lệch nhau. Mỗi bước tự
lưu khi bấm "Lưu bước này"; đóng app giữa chừng mở lại là tiếp đúng chỗ, và điều đó tự đúng khi
không có bản sao tiến độ nào ở client.

Kiểm thật: lưu bước Người đại diện → khối cảnh báo biến mất, chip "Người đại diện" mọc dấu tích,
tiến độ 25% → 38%. Không chỗ nào trong ứng dụng tự quyết định điều đó.

### 31.2 Hai component chặn màn, không phải route

`ApplicantHome` (và `ApplicationWizard` bên trong nó) do `RequirePartnerAccess` dựng, cùng lý do với
`PartnerOnboardingWizard` ở §30.1: một route dưới `app/gym-owner/` nằm trong đúng vùng bị chặn.
`ApplicantHome` chia tiếp năm trạng thái ứng viên vì chúng cần năm thứ khác nhau:
`SETUP_INCOMPLETE` → nút `bootstrap` (idempotent, dựng nốt phần saga đăng ký còn dở);
`ONBOARDING`/`CHANGES_REQUESTED` → wizard; `UNDER_REVIEW` → tiến trình từ `PartnerAuditLog`;
`REJECTED` → lý do, **không** có nút "sửa và nộp lại" (chỉ Gymini mở lại được, và máy chủ cũng khoá).

### 31.3 Mã xác minh nằm ở FRAGMENT — và giới hạn App Links

Thư trỏ tới `…/partner/apply/verify#token=…`. Fragment là cố ý: nó không đi lên máy chủ, không vào
log truy cập, không vào Referer. Vì `expo-router` chỉ bóc query, mã phải lấy từ URL thô
(`Linking.getInitialURL()`), xem `extractApplyToken` — hàm này nhận cả `#token=`, `?token=` (một số
ứng dụng thư viết lại liên kết) và cả khi người dùng chỉ dán mỗi mã.

**Giới hạn đã biết:** liên kết trong thư là https trỏ tới trang WEB; để nó mở thẳng ứng dụng cần App
Links đã xác minh tên miền — chưa có ở môi trường phát triển. Nên màn xác minh nhận mã theo ba
đường: deep link `fitnessassistant://partner/verify#token=…`, dán cả liên kết, hoặc dán riêng mã.
Ghi vào `MOBILE_BACKEND_GAPS.md`.

### 31.4 Tải tệp: presign → POST tới đích máy chủ cấp → confirm

`uploadApplicationFile` không biết (và không được biết) đích là S3 hay kho tương thích nào. Hai điều
kiện của biểu mẫu presigned POST, sai là hỏng: mọi `fields` đi TRƯỚC, phần `file` là phần tử CUỐI.
Dùng `fetch` chứ không dùng axios của Gymini — đích là bên thứ ba, gửi kèm JWT sang đó là rò rỉ vô cớ.

`sizeBytes` đọc bằng `expo-file-system` chứ không đoán: máy chủ nhét số đó vào điều kiện
`content-length-range` của biểu mẫu, khai sai thì kho lưu trữ từ chối chính tệp vừa ký.

### 31.5 WB-01 — cờ `mustChangePassword` trước đây KHÔNG có gì đọc

`mustChangePassword` nằm trong kiểu `User` từ Phase 2 mà không một dòng nào đọc nó: một tài khoản
mang mật khẩu tạm dùng được cả ứng dụng như thường. `RequirePasswordChange` bọc ngoài `Slot` ở
`app/_layout.tsx` nên không route nào lọt qua.

Tối thiểu **8** ký tự, đúng `changePasswordSchema` của auth-service. **Web ghi 6** ở màn tương đương,
nên người dùng web gõ 7 ký tự sẽ bị máy chủ trả 400 — đó là chỗ web lệch, không phải chỗ để chép theo.

`changePassword` **xoá mọi refresh token** và không cấp lại, nên phiên hiện tại chết ở lần làm mới kế
tiếp. Màn này vì thế đăng xuất luôn và nói rõ phải đăng nhập lại, thay vì để người dùng bị văng ra
giữa chừng mà không hiểu vì sao.

### 31.6 Ba lỗi thật bắt được khi chạy

1. **`<Link asChild>` bọc `View` không nhận chạm** — `asChild` chỉ chuyền props nhấn xuống con nào
   biết nhận, mà `View` thì không. Nghĩa là link **"Cấu hình máy chủ" ở màn đăng nhập chưa bao giờ
   bấm được, từ Phase 4**; trên điện thoại thật, nơi mặc định `10.0.2.2` vô nghĩa, đó là đường duy
   nhất để sửa địa chỉ máy chủ. Link "Quên mật khẩu?" bọc `Text` nên vẫn chạy (Text nhận `onPress`).
   Đã đổi hai link hỏng sang `Tappable`.
2. **Cổng hất người dùng ra khỏi màn đang làm dở.** `RequirePartnerAccess` coi `isError` là "chặn".
   Fail-closed đúng cho lần hỏi ĐẦU TIÊN, nhưng sau khi đã biết trạng thái thì một lần làm mới chớp
   nhoáng làm cả wizard biến mất — đã xảy ra thật ngay sau khi lưu một bước (dữ liệu đã vào DB, màn
   hình thì mất). Giờ chỉ chặn khi lỗi mà **chưa từng** có câu trả lời nào.
3. **Đọc hồ sơ ngay sau `bootstrap` bị đua** và kẹt ở màn lỗi tới khi người dùng tự bấm "Thử lại",
   vì chính sách chung không thử lại 4xx. Riêng truy vấn này, "chưa có" là tạm thời, nên thử lại vài
   nhịp ngắn với 404/409.

### 31.7 Đã kiểm gì (emulator + backend Docker thật)

**Tạo hẳn một chủ gym mới, từ ứng dụng, đầu đến cuối** — điều mà bốn cụm trước không làm được:

- CTA "Trở thành đối tác phòng gym" ở màn đăng nhập, **dưới** "Cấu hình máy chủ" đúng quyết định sản
  phẩm đã duyệt.
- Nhập email → máy chủ gửi thư → màn đổi sang trạng thái "Đã gửi liên kết" kèm liên kết dev thật.
- Dán liên kết → xác minh → đặt mật khẩu → **DB `users` có `p12-mobile@example.com` với role
  `GYM_OWNER`**; phiên tự vào bằng chính đường đăng nhập sẵn có.
- Cổng đưa thẳng vào `ApplicantHome` ở `SETUP_INCOMPLETE` → bấm "Mở hồ sơ" (`bootstrap`) → wizard.
- Wizard: 9 chip, dấu tích ở bước không bắt buộc, ba mục "còn thiếu" của máy chủ hiện đúng bằng tiếng
  Việt tại bước sửa được chúng; lưu bước Người đại diện → **DB `gym_partners` ghi
  `Tran Van Chu | GYM_OWNER`** → cảnh báo biến mất, tiến độ 25% → 38%.

Cờ `PARTNER_APPLICATION_DEV_ECHO` bật **theo từng lần chạy** đúng như chính tệp compose chỉ dẫn
(`PARTNER_APPLICATION_DEV_ECHO=true docker compose up -d auth-service`) — **không sửa tệp compose**,
và đã tắt lại sau khi kiểm (xác nhận `devVerifyLink` không còn trong phản hồi).

**CHƯA kiểm được:**
- **Tải ảnh/giấy tờ thật (presign → POST → confirm).** Máy chủ từ chối presign ảnh khi chưa có chi
  nhánh (`BRANCH_REQUIRED` — đúng thứ tự wizard đã xếp), nên muốn thử phải khai xong tới bước chi
  nhánh. Còn một câu chưa trả lời: `url` presign trỏ tới MinIO ở host nào, và emulator có với tới
  được không (có thể cần `adb reverse tcp:9000`).
- **Nộp hồ sơ, luồng "Gymini yêu cầu chỉnh sửa", màn `UNDER_REVIEW`/`REJECTED`** — cần khai đủ chín
  bước rồi cần một quản trị viên thao tác; chỉ phủ bằng test thuần.
- **WB-01** — không có tài khoản nào đang mang cờ `mustChangePassword` trong DB, và không đặt cờ đó
  lên tài khoản người khác để tạo ca thử.

## 32. Không gian Quản trị viên — Phase 13 mở màn: WB-17 duyệt hồ sơ đối tác (27/9)

**Phạm vi Phase 13 đã chốt (Ngài quyết 27/9):** AD-01..AD-06 + **WB-17**. Sáu route admin chỉ có
trên web (WB-05..WB-10) **hoãn có ghi nhận** — lý do và hai ứng viên gần nhất nếu mở lại nằm trong
`MOBILE_MIGRATION_MANIFEST.md` ngay dưới bảng WB-05..WB-10.

Làm WB-17 trước phần còn lại của Phase 13 vì hai lẽ: nó là **đường duy nhất** để một chủ phòng gym
tồn tại (luồng admin tự tạo tài khoản đã bị gỡ, `POST /admin/partners` trả 410), và nó là thứ mở
khoá phần kiểm còn thiếu của Phase 12 (duyệt hồ sơ → GY-08 → không gian vận hành).

### 32.1 Máy chủ quyết định có duyệt được hay không

`GET /admin/partners/:id/application` trả `approve.canApprove` và `approve.blockers`, do
`computeApproveBlockers` (gym-service `partner-application.state.ts`) tính và **đã kèm sẵn câu tiếng
Việt**. Màn hình hiển thị đúng những câu đó, không dựng lại luật duyệt lần thứ hai — cùng nguyên tắc
với `missing[]` ở phía ứng viên (§31.1). Dựng luật thứ hai là hứa một nút mà máy chủ sẽ từ chối.

Duyệt là **một transaction** ở máy chủ: bấm đúp hoặc hai quản trị viên cùng bấm thì người sau nhận
409, không có trạng thái nửa vời. Ứng dụng không cần (và không nên) tự chống.

Xem một giấy tờ là mở liên kết ký tạm do máy chủ cấp; **mỗi lần xem đều được ghi nhật ký** — đó là
chủ ý của thiết kế chứ không phải phụ phẩm, nên màn này không cache liên kết lại để xem lại "cho
nhanh".

### 32.2 Chỗ lệch web, có chủ ý

Web gộp mọi thứ vào `AdminPartnersPage` (1163 dòng) với bố cục hai cột và panel duyệt dính. Trên điện
thoại tách thành hàng chờ → chi tiết. Hàng chờ **xếp hồ sơ nộp lâu nhất lên đầu** chứ không theo thứ
tự máy chủ trả: một hàng chờ mà không thấy cái nào để lâu nhất thì không phải hàng chờ.

Màn "Duyệt" (AD-04) thành một hub các hàng chờ. Hàng chờ đơn ứng tuyển huấn luyện viên hiện ở đó
dưới dạng mục mờ kèm câu "sẽ nối vào đây ở phần còn lại của Phase 13" — nói thẳng là chưa có, thay vì
im lặng để người dùng tưởng mình bấm hỏng.

### 32.3 Đã kiểm gì (emulator + backend Docker thật, `admin@example.com`)

- Hub "Duyệt" → hàng chờ; bốn tab theo `PartnerVerificationStatus` kèm bộ đếm thật của máy chủ
  (**30 đã duyệt**, 5 chưa nộp).
- Danh sách thật: tên thương hiệu, email liên hệ, nhãn trạng thái, "5 ngày trước".
- Chi tiết một hồ sơ thật: người đại diện, điện thoại, email, tên pháp lý, thương hiệu, chi nhánh
  đầu, địa chỉ, số ảnh; **sáu loại giấy tờ** với trạng thái đúng (ba loại bắt buộc "Đã xác minh",
  hai loại tuỳ chọn "Chưa nộp") và hàng "Xem tệp" kèm kiểu MIME; mục góp ý cũ với nhãn "Đã đóng".
- **Khối "Chưa duyệt được vì:" hiện nguyên văn ba câu của máy chủ** ("Hồ sơ không ở trạng thái đang
  xét duyệt", "Hồ sơ chưa có chi nhánh đầu tiên", "Ứng viên đã có chi nhánh ngoài hồ sơ ứng tuyển"),
  nút "Duyệt hồ sơ" tắt đúng theo `canApprove`.

**CHƯA kiểm được:**
- **Ba thao tác ghi của quản trị viên** (duyệt / yêu cầu chỉnh sửa / từ chối). Chúng tác động lên
  đối tác thật trong DB dùng chung, và hàng chờ `IN_REVIEW` hiện đang **rỗng** — hồ sơ
  `p12-mobile@example.com` tại hạ tạo ở cụm D mới ở bước 2/9, chưa nộp. Muốn chạy chuỗi
  "nộp → duyệt → GY-08 → vận hành" thì phải khai nốt bảy bước, trong đó có tải ảnh và giấy tờ —
  đúng phần chưa kiểm được ở §31.7.
- **Mở tệp giấy tờ** (liên kết ký tạm trỏ tới MinIO): cùng câu hỏi host với §31.4.

## 33. Chạy trọn chuỗi E2E Phase 12 trên máy thật — đóng các mục "CHƯA kiểm được" của §30–§32 (27–28/9)

**Nhãn bằng chứng:** `REAL BROWSER` nghĩa ở đây là **app RN thật trên emulator** (dev client, Pixel 10
Pro XL), nối **backend Docker thật**; mọi bước quan trọng đối chiếu bằng `SELECT` trên
`gymcoach_gym`. Không đặt cờ, không sửa mật khẩu, không ghi DB tay — mọi thay đổi đi qua đúng API mà
app gọi. Tài khoản thử: `p12-mobile@example.com` (do chính app tạo ở §31, WB-15).

### 33.1 Chuỗi đã chạy — khớp khối E2E 21/9 của kế hoạch Phase 12

| # | Bước | Ai | Bằng chứng |
|---|---|---|---|
| 1 | Khai 9 bước: đại diện → thương hiệu → quy mô (nhiều chi nhánh) → chi nhánh đầu → vị trí (TP.HCM / P. Sài Gòn + ghim) → 1 ảnh → tên pháp lý + 3 giấy tờ bắt buộc (2 PNG + 1 PDF) → đồng ý điều khoản | ứng viên | DB: `province_code 79`, `ward_code 26740`, toạ độ có; 3 giấy tờ `RECEIVED` |
| 2 | Gửi hồ sơ | ứng viên | DB `PROSPECT / IN_REVIEW`, `submitted_at`, `terms_accepted_at` có; màn "Hồ sơ đang được xét duyệt" + tiến trình từ `PartnerAuditLog` |
| 3 | Đang xét → gọi thẳng route vận hành | API | `403 PARTNER_APPLICATION_PENDING` |
| 4 | Admin xem tệp | admin | mở link ký tạm (qua gateway → MinIO); audit `DOCUMENT_VIEWED` |
| 5 | Chấp nhận 2 giấy tờ, **yêu cầu cập nhật** giấy thứ 3 kèm lý do + 1 mục góp ý chung | admin | DB `NEEDS_INFO`; `PREMISES_PROOF REJECTED` + `review_note`; issue `OTHER / OPEN` |
| 6 | Ứng viên thấy đúng mục + đúng giấy tờ "Cần nộp lại"; "Gửi lại hồ sơ" **tắt** | ứng viên | UI |
| 7 | Đánh dấu "Đã cập nhật" → vẫn **tắt** (giấy tờ chưa thay) | ứng viên | issue `RESUBMITTED` |
| 8 | "Thay tệp" → nhảy bước giấy tờ → thêm PDF | ứng viên | DB `PREMISES_PROOF RECEIVED`, `version 2` |
| 9 | Gửi lại hồ sơ | ứng viên | DB `IN_REVIEW`; issue vẫn `RESUBMITTED` (nộp lại **không** tự đóng mục) |
| 10 | Chấp nhận giấy tờ bản 2, đóng mục → nút Duyệt mở theo `canApprove` của máy chủ | admin | khối "Chưa duyệt được vì" rút dần từng dòng theo máy chủ |
| 11 | **Duyệt** (xác nhận) | admin | DB `ACTIVE / VERIFIED`; chi nhánh đầu `APPROVED`; audit `APPLICATION_APPROVED` |
| 12 | Đăng nhập lại → **GY-08** mở thẳng bước 3/4 (nhận tiền) vì liên hệ + thương hiệu đã có từ hồ sơ | chủ gym mới | nhập tài khoản thử → dashboard |
| 13 | Quyền vận hành | API | `accessState ACTIVE`; route vận hành trước 403 nay `200`; account `OWNER / ACTIVE`, `onboarding_completed_at` có |
| 14 | **Chi nhánh #2**: hộp chỉ ghi "Chi nhánh này sẽ thuộc thương hiệu P12 Mobile Fitness", không có bộ chọn; tự ghim bản đồ theo địa chỉ | chủ gym | DB: cả hai chi nhánh cùng `brand_id`; #2 `PENDING_REVIEW` (đi vòng duyệt chi nhánh thường) |

**Dữ liệu để lại trong DB dev dùng chung** (đối tác thử do app tạo, không đụng tài khoản ai khác):
đối tác `9a5f974f…` ACTIVE với thương hiệu "P12 Mobile Fitness", chi nhánh `P12 Mobile Quan 1`
(APPROVED) và `P12 Mobile Quan 3` (PENDING_REVIEW, nằm trong hàng duyệt chi nhánh của admin), tài
khoản nhận tiền giả `9704000012345678 / TRAN VAN CHU`.

### 33.2 Lỗi thật lộ ra khi chạy — đều đã sửa ở mobile, backend không đổi

1. **Tải tệp hỏng hoàn toàn trên Android, ba tầng chồng nhau.**
   - `fetch` của Expo không nhận phần tệp kiểu RN `{uri,name,type}` ("Unsupported FormDataPart").
   - Đổi sang axios/XHR: gửi tệp từ URI với độ dài **không biết trước** → `Transfer-Encoding:
     chunked`, không `Content-Length` → MinIO (qua proxy gateway) trả `EmptyRequestBody`. Biểu mẫu
     POST presigned của S3 bắt buộc có độ dài.
   - Bộ chọn ảnh hệ thống trả **nguyên tệp PNG**, còn app khai `image/jpeg` → máy chủ kiểm magic bytes
     và từ chối ("Nội dung tệp không phải định dạng đã khai báo").
   - **Sửa:** `new File(uri).upload(url, { uploadType: MULTIPART, parameters: fields })` của
     `expo-file-system` (độ dài biết trước, trường ký trước, tệp sau cùng, không gửi JWT);
     `pickFile.ts` khai đúng `mimeType` picker trả, chỉ coi là JPEG khi picker không nói gì.
2. **Nút "Gửi hồ sơ" không bao giờ mở được.** Điều khoản được chấp nhận **bằng chính lệnh gửi**
   (`submit(true)`), nên trước khi gửi máy chủ luôn còn kể mục `TERMS`. Ô "Tôi đồng ý" giờ là câu trả
   lời cho mục đó; mọi mục khác vẫn chặn đúng như máy chủ nói.
3. **Vòng "yêu cầu chỉnh sửa" thiếu nửa.** `canResubmit` chỉ nhìn mục góp ý, bỏ qua giấy tờ bị yêu
   cầu nộp lại → nút "Gửi lại" sẽ mở và máy chủ trả `DOCUMENTS_NOT_REPLACED`. Nay khớp **đúng hai điều
   kiện** của `resubmit` (không mục `OPEN` + không giấy tờ `REJECTED`), hiện thẻ "Cần nộp lại" + lý do
   + "Thay tệp" (nhảy tới bước giấy tờ), và ẩn thẻ "Gửi hồ sơ" lần đầu trong vòng này (máy chủ sẽ từ
   chối `submit` khi `NEEDS_INFO`). Yêu cầu *chỉ* nộp lại giấy tờ (không mục chung) nhận ra bằng
   `accessState CHANGES_REQUESTED`, không bằng dấu vết.
4. **Admin chấp nhận lại tệp vừa bị yêu cầu thay.** Nút "Chấp nhận giấy tờ" hiện với mọi trạng thái
   ≠ VERIFIED, kể cả `REJECTED`. Máy chủ chỉ chấp nhận dòng `RECEIVED` trong hồ sơ `IN_REVIEW` (web cũng
   vậy) → `canReviewDocument` theo đúng luật đó.
5. **Admin không yêu cầu cập nhật được từng giấy tờ.** Hộp "Yêu cầu chỉnh sửa" chỉ có mục chung, dù
   API nhận `documents:[{docType,note}]` và web có. Thêm danh sách giấy tờ đang chờ xét, mỗi cái có ô
   lý do; chọn mà không ghi lý do thì chặn (không lặng lẽ bỏ giấy tờ khỏi yêu cầu).
6. **Màn chi tiết sau khi duyệt vẫn liệt kê "Chưa duyệt được vì…"** kèm nút Duyệt/Yêu cầu/Từ chối.
   Khối quyết định giờ theo trạng thái như web: `IN_REVIEW` mới có hành động; `VERIFIED` báo đã duyệt;
   `REJECTED` hiện lý do + **"Mở lại hồ sơ"** (trước đây mobile không có); `NEEDS_INFO` / `NOT_VERIFIED`
   nói đang chờ ứng viên.
7. **Tự ghim bản đồ không bao giờ chạy trên điện thoại.** Nominatim trả **403** cho User-Agent mặc
   định `okhttp/…` của Android. Thêm UA riêng; và lỗi HTTP giờ ném lỗi ("không tra được") thay vì trả
   `null` ("không có địa chỉ này") — hai câu khác nhau với người dùng. Bước Vị trí của hồ sơ cũng được
   gắn tự ghim (trước chỉ hộp thêm chi nhánh có), không bao giờ đè ghim tay hoặc ghim đã lưu.
8. **Nhãn nút tiếng Việt bị cắt** ("Đã cập nhật" → "Đã cập"): chiến lược ngắt dòng mặc định của
   Android đo hụt chữ có dấu với font tuỳ biến, chữ cuối rơi xuống dòng hai và bị chiều cao cố định
   che. `Button` đặt `textBreakStrategy="simple"` — sửa cho mọi nút, không riêng chỗ này.
9. Nhỏ: một lần tải lại hỏng không còn xoá cả hồ sơ khỏi màn hình (chỉ chặn khi chưa từng có dữ
   liệu); câu của máy chủ không lộ mã enum (`BUSINESS_LICENSE` → "Giấy phép kinh doanh", cả ứng viên
   lẫn admin); ảnh đang là bìa không còn nút "đặt làm bìa".

### 33.3 Bẫy môi trường (không phải lỗi app, ghi để lần sau khỏi mất công)

- **`10.0.2.2` của emulator làm rớt đúng 1 byte** cuối phản hồi (~2,7 KB): tái hiện 3/3 bằng `nc` ngay
  trong emulator, còn `localhost` qua `adb reverse tcp:3000` thì đủ. okhttp báo "unexpected end of
  stream" → axios "Network Error" không có response — trông y như lỗi app ngẫu nhiên. Cách chạy: đặt
  máy chủ trong app là `http://localhost:3000` + `adb reverse`. Có lẽ cùng gốc với
  `ERR_CONTENT_LENGTH_MISMATCH` từng gặp ở bản Capacitor.
- **Hết RAM máy chủ** (Docker + Metro + emulator + ứng dụng khác) làm emulator treo vòng "System UI /
  Settings isn't responding"; khởi động lại emulator không đỡ, phải giải phóng RAM.
- Sau khi máy tắt đột ngột, Postgres chạy khôi phục (fsync ~1 phút) trước khi healthy — `compose up`
  lần đầu báo `dependency failed … unhealthy`, chờ xong chạy lại là được.

### 33.4 Kiểm tự động

465/465 test thuần (`npx tsx --test "src/features/__tests__/*.test.ts"`), thêm test cho:
`readableServerMessage`, `toggleDocumentRequest`/`setDocumentNote` + chặn giấy tờ thiếu lý do,
`canReviewDocument`, `documentsToReplace`/`canResubmit` (cả ca chỉ-giấy-tờ), `isChangesRequested`.
Typecheck + ESLint sạch trên các tệp đã sửa.

### 33.5 Vẫn CHƯA kiểm được

- **Từ chối hồ sơ + Mở lại** (WB-17): làm thì phải từ chối một đối tác thật; hồ sơ thử đã được duyệt.
  Chỉ có `CODE AUDIT` + đối chiếu với web.
- **WB-01** đổi mật khẩu bắt buộc: vẫn không có tài khoản nào mang cờ, và không đặt cờ lên tài khoản
  người khác.
- **Nút "Dùng vị trí hiện tại" thành công**: GPS emulator đứng yên (đã ghi ở §28).
- **Liên kết email thật bằng App Link** (GAP-20): vẫn dùng ô dán liên kết.

## 34. Không gian Quản trị viên — Phase 13 cụm A: AD-01 Tổng quan, AD-06 Rút tiền (28/9)

### 34.1 Chia cụm cho phần còn lại của Phase 13

Manifest (không phải ghi nhớ của tại hạ) là nguồn: AD-01 tổng quan · **AD-02 hub Duyệt** (hồ sơ đối
tác đã xong ở WB-17; còn chi nhánh gym, đơn ứng tuyển PT, chợ giáo án) · **AD-03 roster PT** (BLOCKED,
GAP-1) · **AD-04 Xử lý** (tranh chấp buổi tập, hoàn tiền, khiếu nại, hoàn tiền gói gym ngoại lệ) ·
**AD-05 Người dùng** (PARTIAL, GAP-3/GAP-21) · AD-06 rút tiền.

| Cụm | Nội dung | Trạng thái |
|---|---|---|
| A | AD-01 + AD-06 | **xong, đã kiểm trên máy 28/9** |
| B | AD-02: chi nhánh gym + đơn ứng tuyển PT + chợ giáo án vào hub Duyệt | chưa làm |
| C | AD-04: tranh chấp + hoàn tiền + khiếu nại (+ form hoàn tiền gói gym như web, GAP-2) | chưa làm |
| D | AD-05 danh sách người dùng (đọc) ; AD-03 | chờ Ngài quyết khoá/mở khoá (GAP-3/21) |

### 34.2 AD-06 Rút tiền — luật từ `withdrawal.service.ts`, không từ giao diện

- `approve` chỉ từ PENDING, là **giữ chỗ tuỳ chọn** (tiền chuyển `available` → `locked`); app gọi nó
  là "Giữ chỗ" chứ không phải "Duyệt", vì web đã phải viết cả đoạn giải thích rằng "duyệt" ở đây không
  phải duyệt cho rút.
- `mark-paid` từ PENDING **hoặc** APPROVED, bắt buộc mã tham chiếu; bước DUY NHẤT trừ tiền → app hỏi
  xác nhận lần hai.
- `reject` từ PENDING hoặc APPROVED (nhả khoản giữ chỗ), bắt buộc lý do; câu trong hộp nói đúng hệ quả
  theo trạng thái hiện tại.
- **Khác web:** hiện TÊN người rút (tra `/admin/users` cho PT/khách, tên chi nhánh cho gym), thay cho
  8 ký tự đầu của id; hàng chờ xếp cũ nhất lên đầu; tiêu đề có tổng số tiền đang chờ.

### 34.3 AD-01 Tổng quan

Đủ mọi khối của web (tiền giữ hộ + doanh thu + sổ cân/lệch, 4 KPI, tăng trưởng người dùng, phân bổ vai
trò, quét InBody, cảnh báo hệ thống, đăng ký gần đây) và thêm hàng **"việc đang chờ"** dẫn thẳng vào hồ
sơ đối tác / rút tiền. Hai chỗ lệch có chủ ý:
- **Sức khoẻ hệ thống bằng số đếm** ("6/7 dịch vụ hoạt động", màu cảnh báo) — dữ liệu thật hôm nay có
  `healthScore 100` cùng lúc với `6/7` và một lỗi n8n; web in "All Systems Operational".
- **"Chưa phân loại"** cho phần người dùng gateway không tách vai trò (54/205), kèm một câu giải thích —
  gốc ở gateway, ghi GAP-21. Sổ không có cờ `balanced` thì nói "Chưa có số đối soát", không hiện dấu tích.

Form "Hoàn tiền gói hội viên (ngoại lệ)" của web **không** nằm ở đây: manifest xếp nó vào AD-04 (cụm C).

### 34.4 Đã kiểm gì (`REAL BROWSER` = app RN trên emulator, backend Docker thật, `admin@example.com`)

- AD-01 hiện đúng số thật: 205 người dùng, 8 PT đã duyệt, 292 hợp đồng, 1 buổi hôm nay; 104.857.000 ₫
  giữ hộ, doanh thu 8.882.165 ₫, "Sổ sách cân bằng"; "6/7 dịch vụ hoạt động"; cảnh báo n8n; biểu đồ T4–T9;
  143 / 8 / 54 chưa phân loại; InBody 101/39/62/0; hàng việc chờ "1 yêu cầu rút tiền · 20.000 ₫".
- AD-06 trên yêu cầu rút **do chính tại hạ tạo ở Phase 10** (`pt@example.com`, 20.000 ₫):
  hiện "Professional Trainer · Huấn luyện viên · pt@example.com"; **Giữ chỗ** → DB `APPROVED`, ví PT
  `available 28.775.000 → 28.755.000`, `locked 0 → 20.000`, nút Giữ chỗ biến mất; mở hộp "Đã chi trả" →
  nút tắt khi chưa có mã (không bấm thật); **Từ chối** kèm lý do → DB `REJECTED` + `rejection_reason`,
  ví về đúng `28.775.000 / 0`; màn về trạng thái rỗng.
- **Không bấm "Đã chi trả" thật**: bước đó trừ tiền khỏi ví của tài khoản PT dùng chung cho mọi bộ E2E
  (xem ghi nhớ "E2E wallet pollution"). Nhánh này chỉ có `CODE AUDIT` + test thuần.
- 9 test thuần mới (`adminCluster13A.test.ts`); toàn bộ 474/474.

## 35. Phase 13 — sửa GAP-21 ở gateway, AD-05 khoá/mở khoá, cụm B (AD-02) và cụm C (AD-04) (28/9)

**Ngài quyết 28/9:** "Cho phép sửa gateway (GAP-21) rồi mới làm nút khoá / mở khoá. Sau đó làm tiếp cụm B
và cụm C." — đây là lần thứ hai mobile chạm backend, có lệnh rõ; phạm vi đúng GAP-21, không gì khác.

### 35.1 GAP-21 — sửa ở gateway (`BACKEND INTEGRATION` + `REAL HTTP/API`)

- Hàm thuần mới `backend/gateway/src/utils/adminUserView.ts` (`adminRoleLabel`, `adminUserStatus`,
  `adminRoleBreakdown`) + 3 test; `proxy.routes.ts` dùng nó ở cả `/admin/dashboard` lẫn `/admin/users`
  (30 dòng đổi) — một chỗ duy nhất để hai route không lệch nhau lần nữa.
- `GYM_OWNER` → nhãn **"Gym Owner"** (trước: "Client"); `roleData` thêm lát **"Gym owners"**; trạng thái
  lấy từ `isActive` mà auth-service vốn đã trả (trước: gán cứng "Active"); bỏ "Pending" gán cho mọi PT.
- Web (`UserManagement.tsx`) không vỡ: lọc theo chuỗi, giá trị mới chỉ là thêm lựa chọn; `Inactive` web đã
  khai sẵn trong type.
- Kiểm: gateway `tsx --test` 41/41; gọi thật sau khi khởi động lại container (mount `src` trên Windows
  không kích hoạt hot-reload — phải `docker compose restart api-gateway`): 143 / 8 / **54** chủ gym = 205;
  danh sách **43 Gym Owner Active + 11 Gym Owner Inactive + 1 Client Inactive** — đúng 12 tài khoản
  `zzz-test` đã khoá từ trước giờ mới hiện ra.

### 35.2 AD-05 Người dùng — khoá / mở khoá thật (`REAL BROWSER` + DB)

`app/admin/users.tsx` (vào từ ô "Người dùng" hoặc "Xem tất cả" trên Tổng quan): tìm không dấu, lọc vai
trò/trạng thái, FlatList 205 dòng. Nút web "Suspend account" **không gắn hành động nào**; ở đây gọi thật
`PATCH /admin/users/:id/disable|enable`.

Hệ quả đọc từ code trước khi làm, và hộp xác nhận nói đúng theo vai trò (`lockConsequences`):
- mọi tài khoản: chặn đăng nhập, chặn làm mới phiên → phiên đang mở chết ở lần làm mới kế tiếp;
- **PT:** auth-service relay DEACTIVATE → user-service **huỷ + hoàn tiền mọi hợp đồng đang mở**, huỷ lịch,
  ẩn PT; mở khoá **không khôi phục hợp đồng** (`internal.routes.ts`). Màn hình cảnh báo trước cả khi bấm.

Đã chạy: khoá `p12-mobile` → DB `isActive=f`, đăng nhập trả **403 "Tài khoản đã bị vô hiệu hóa"**, danh
sách "Đã khoá", đếm 12→13; mở khoá → `isActive=t`, đăng nhập 200, đếm về 12. Với PT chỉ mở hộp xác nhận để
kiểm câu chữ rồi bấm **Không** (tài khoản của Ngài) — DB xác nhận không đổi.

### 35.3 Cụm B — AD-02 hub "Duyệt" với bốn hàng chờ

Hub hiện số việc thật từng hàng: Hồ sơ đối tác · **Chi nhánh phòng gym** · **Đơn ứng tuyển PT** ·
**Kế hoạch trên chợ**.

**Chi nhánh** (`app/admin/gyms/`) — năm hàng việc như web + màn chi tiết đủ ảnh/giờ/tiện ích/giấy tờ.
Lệch web có chủ ý:
- "Đổi tên/địa chỉ" chỉ gồm chi nhánh **đã từng được duyệt** và tên/địa chỉ chờ **khác** bản đang hiện
  (`isRenameRequest`). Web gộp cả bản nháp — thấy thật: một bản nháp hiện "đổi tên X → X"; duyệt "đổi tên" ở
  đó là công khai tên một chi nhánh chưa bao giờ được duyệt.
- "Tên thương hiệu" bỏ dòng tên chờ trùng tên đã duyệt (không có gì để duyệt).
- Giờ hoạt động chưa khai thì nói "chưa khai", không nói "đóng cả tuần" (máy chủ trả 7 ngày CLOSED).
- Từ chối: máy chủ không nhận lý do → hộp xác nhận nói thẳng và gợi ý "Yêu cầu chỉnh sửa" thay thế.
- Sửa trực tiếp chỉ gửi trường đã đổi.

Đã chạy trên chi nhánh do chính tại hạ tạo: **sửa SĐT** `P12 Mobile Quan 3` (DB có) → **duyệt** (DB
`APPROVED / OPEN`, hàng chờ 5→4); **yêu cầu sửa mục "Hình ảnh"** trên `Mobile Phase12 Test 26-09` (DB
`DRAFT` + issue `PHOTOS`).

**Đơn ứng tuyển PT** (`app/admin/pt-applications/`) — mobile trước đây chưa có phía admin. Phát hiện:
**máy chủ không kiểm trạng thái hiện tại trước khi xét** (duyệt được cả bản nháp; web hiện đủ 4 nút ở mọi
trạng thái) → app tự chặn theo `ptActions(status)`. Web còn gửi ghi chú **nội bộ** vào `adminNote` — trường
người nộp đọc được; app chỉ có một ô "lời nhắn cho người nộp". Đã chạy trên đơn `john.doe` (tài khoản thử
Phase 9): **Bắt đầu xem xét** → DB `UNDER_REVIEW` + người xét; **Yêu cầu bổ sung** → `NEEDS_MORE_INFO` +
lời nhắn, nút biến mất, màn nói đang chờ người nộp. **Không duyệt** (duyệt đổi vai trò tài khoản thật).

**Kế hoạch trên chợ** (`app/admin/marketplace.tsx`) — bản phân tích tự động (cờ luật, gợi ý AI, kế hoạch
có thể trùng) hiện để tham khảo; lịch tập mở rộng; mục tiêu dịch sang tiếng Việt. Đã **từ chối** "No-rest
plan" (7/7 ngày, gợi ý "nguy cơ cao") kèm lý do → REJECTED 0→1. Không bấm duyệt kế hoạch nào.

### 35.4 Cụm C — AD-04 "Xử lý"

Một tab, bốn mục có đếm: **Tranh chấp buổi tập** (3 kết luận, mỗi cái nói hệ quả tiền, căn cứ bắt buộc) ·
**Hoàn tiền dịch vụ 1-1** (số của máy chủ: đã trả / đã hoàn / trần; mốc giao hàng; số tiền trong trần;
ghi chú bắt buộc; hỏi lại trước khi chuyển tiền) · **Khiếu nại phòng gym** (OPEN → IN_PROGRESS → RESOLVED,
đóng phải có phản hồi, ảnh qua link có xác thực) · **Hoàn tiền gói hội viên ngoại lệ** (nhập mã gói như web —
GAP-2 vẫn mở; mã phải đúng dạng UUID).

Đã chạy: **từ chối** một yêu cầu hoàn tiền 1-1 (dữ liệu E2E) → đơn về `DRAFT_DELIVERED`, đếm 12→11 — không
có tiền nào chuyển; **nhận xử lý** rồi **đóng** một khiếu nại E2E kèm phản hồi → DB `RESOLVED`. Tranh chấp
buổi tập: hàng chờ **rỗng** (chỉ kiểm màn rỗng). **Không** bấm duyệt hoàn tiền hay hoàn gói hội viên nào.

### 35.5 Lỗi/bẫy gặp khi chạy

- Ô KPI dashboard bọc `Tappable` + `flex-1` trong Card → ô cao bất thường, mất 2 ô. Bỏ `flex-1` ở Card.
- Sau `--clear`, dev client xin quyền "Display over other apps"; màn hệ thống đó nuốt thao tác gõ — kiểm DB
  sau đó: không ghi gì.
- Route mới trong thư mục mới lại cần khởi động lại Metro + xoá `router.d.ts` (ghi nhớ cũ vẫn đúng).
- `foldVi` chuyển sang `src/lib/text.ts` (thuần, test được), `SelectSheet` export lại — không có bản thứ hai.

### 35.6 Kiểm tự động

Mobile 504/504 test thuần (+ `adminUsers`, `adminGyms`, `adminModeration`, `adminResolve`); gateway 41/41
(+ `adminUserView`). Typecheck sạch; ESLint không lỗi mới (6 cảnh báo cũ ở `BottomSheet`/`SwipeRow`/
`Tappable`, không đụng).

### 35.7 Còn lại của Phase 13

- **AD-03 roster PT**: vẫn BLOCKED (GAP-1) — nhưng *tạm ngưng/khôi phục* một PT nay làm được ở AD-05.
- Chưa bấm thật: duyệt đơn PT, duyệt kế hoạch, duyệt hoàn tiền 1-1, hoàn gói hội viên, phân xử tranh chấp
  (không có dữ liệu), "Đã chi trả" rút tiền — đều là thao tác chuyển tiền hoặc đổi vai trò trên dữ liệu dùng
  chung; phủ bằng test thuần + `CODE AUDIT`.

## 36. Phase 13 — đóng ba điều kiện "Xong khi" của kế hoạch (28/9)

Kế hoạch: *"1 tranh chấp từ Phase 7/11 giải quyết đúng và phản ánh đúng cả 2 phía; 1 đơn ứng tuyển PT duyệt
đúng theo backend; 1 yêu cầu rút tiền duyệt đúng theo backend — luôn xác nhận trạng thái thật qua API sau hành
động admin."* Ngài cho làm 28/9.

**Cách chuẩn bị dữ liệu (nói thẳng):** phần *của người dùng* (PT báo xong, khách phản đối, ứng viên gửi lại,
chủ gym tạo yêu cầu rút) gọi **đúng API mà app gọi**, bằng tài khoản thử — `REAL HTTP/API`, không phải thao
tác trên màn hình. Phần *của quản trị viên* làm **trên app** (`REAL BROWSER` = app RN trên emulator). Không
ghi DB tay ở bất kỳ bước nào; DB chỉ để đọc đối chiếu.

| # | Điều kiện | Chuẩn bị (`REAL HTTP/API`) | Admin trên app | Đối chiếu sau |
|---|---|---|---|---|
| 1 | Tranh chấp | Buổi `542ac40f…` (hợp đồng ACTIVE `testpt002` ↔ `testuser017`, tài khoản seed `Test@123456`): PT `PATCH /sessions/:id/complete` → `PENDING_CLIENT_CONFIRMATION`; khách `POST /sessions/:id/dispute` → `DISPUTED / DELIVERY_DISPUTE` | Tab Xử lý hiện đúng buổi, gói, lý do của khách; chọn **"Buổi tập không diễn ra"**, hộp nói hệ quả, ghi căn cứ → xác nhận | `GET /sessions/:id` bằng token **PT** và token **khách**: cả hai `CANCELLED` + cùng căn cứ; hợp đồng `used_sessions` giữ nguyên **15/20** (không trừ buổi); hàng chờ về rỗng |
| 2 | Duyệt đơn PT | `john.doe` (tài khoản thử từ Phase 9, đang `NEEDS_MORE_INFO` từ §35.3) `POST /pt-applications/me/submit` → `SUBMITTED` | Đơn lên đầu hàng "Mới nộp"; **Duyệt — trở thành huấn luyện viên**, hộp nói rõ đổi vai trò | Đơn `APPROVED` + `approved_at`; hồ sơ `isPT = true`; auth `role = PT`; đăng nhập lại trả `user.role = PT` |
| 3 | Rút tiền | `jane.smith` `POST /owner/gyms/:id/withdrawals` 10.000 đ cho chi nhánh E2E `Gym_A` (ví 400.243) | Hiện tên chi nhánh; **Giữ chỗ** → **Đã chi trả** kèm mã `E2E-P13-VCB-20260928`, hỏi lại trước khi trừ tiền | Giữ chỗ: ví 400.243 → **390.243 / khoá 10.000**; chi trả: `PAID` + mã + `paid_at`, ví **390.243 / khoá 0**; chủ gym gọi `GET /owner/gyms/:id/withdrawals` thấy `PAID` + mã; hàng chờ về rỗng |

**Sự cố nhỏ, đã xử lý:** vòng lặp tạo yêu cầu rút lỡ tạo thêm một yêu cầu 10.000 đ cho chi nhánh seed "Titan
Gym". Dùng luôn để kiểm nhánh **Từ chối từ PENDING** trên app → `REJECTED` + lý do, ví Titan không đổi (tiền
chưa từng bị giữ). Không để lại yêu cầu treo.

**Dữ liệu dùng chung bị thay đổi (có chủ ý, đều là tài khoản/chi nhánh thử):** buổi `542ac40f…` CANCELLED;
`john.doe` nay là **PT**; ví chi nhánh `E2E_…_Gym_A` giảm 10.000 đ (một yêu cầu PAID); một yêu cầu Titan Gym
REJECTED.

**Kết luận:** ba điều kiện "Xong khi" của Phase 13 **ĐẠT**. Còn mở (ghi nhận, không chặn): AD-03 roster PT
(GAP-1), WB-05..10 (Ngài hoãn), các mục chưa kiểm của §33.5, GAP-2/13/14/19/20.

**Ghi chú:** phía PT hiện "(không có ghi chú)" vì lệnh chuẩn bị của tại hạ gửi `notes`, còn backend đọc
`ptNotes` — lỗi của bước chuẩn bị, **không phải lỗi app**: `pt.completeSession` trong `api.ts` đã gửi đúng
`ptNotes`.

## 37. Phase 14.1 — thanh toán qua cổng thật (SH-06 + 4 lối vào) (28/9)

**Quyết định của Ngài (28/9):** thông báo đẩy được phép sửa backend; chỉ có **1** điện thoại thật cho gọi
video. Thứ tự làm: 14.1 → 14.3 → 14.2 → 14.4.

### 37.1 Đã dựng

| Phần | File | Ghi chú |
|---|---|---|
| Header nhận diện app | `src/services/api.ts` → `MOBILE_CHECKOUT` | Chỉ gắn vào **4 lời gọi tạo giao dịch**. Backend (gym/user/ai) suy `platform = mobile` từ `Origin: http://localhost` — quy ước sẵn có của app Capacitor cũ, app RN dùng chung scheme nên nhận diện y hệt, **không đổi backend**. Không gắn toàn cục vì gateway dựng link email từ Origin tin cậy. |
| Chọn cổng | `src/components/payment/PaymentMethodSheet.tsx` | Danh sách của server (`/me/payments/methods`); cổng chưa cấu hình vẫn hiện, mờ, kèm lý do; chọn sẵn gợi ý của server; nút xác nhận chặn bấm đúp bằng ref (web từng bắt được 2 POST cho 1 lần chạm). |
| Mở cổng | `src/features/payments/openGateway.ts` | `expo-web-browser` `openAuthSessionAsync` → Custom Tab, app vẫn sống phía dưới. Tab đóng (cổng trả deep link hoặc người dùng tự đóng) → luôn sang màn kết quả; không bao giờ tin `status` trên link. |
| Luồng chung | `src/features/payments/useGatewayCheckout.ts` | 1 hook cho mọi nút "Thanh toán": chọn cổng → tạo giao dịch → mở cổng → kết quả. |
| Màn kết quả | `app/client/payments/result.tsx` (+ `_layout.tsx`, ẩn khỏi tab bar) | Chỉ nhận `txnId`; phán quyết luôn là `POST /me/payments/:id/sync`; PAID → làm mới danh sách liên quan + nút tới đúng chỗ (`?tab=memberships` / `?tab=contracts` / đơn 1-1). |
| Deep link | `app/+native-intent.tsx` | Viết lại `fitnessassistant://client/payments/result?txnId&status` → bỏ `status`, để link và app trỏ cùng một route. |
| App bị tắt giữa chừng | `pendingCheckout.ts` + `ResumePendingCheckout.tsx` (gắn trong `app/client/_layout.tsx`) | Ghi `txnId` + `userId` trước khi mở tab; lần mở app sau (đúng người đó, trong 30 phút) tự vào màn kết quả; đọc là xoá. Xem 37.3 vì sao cần. |
| 4 lối vào | Hội viên (trả gói đang chờ) · Hợp đồng (trả hợp đồng PENDING_PAYMENT) · Chi tiết phòng gym (mua gói: cảnh báo đa-gym **trước**, chọn cổng **sau**, như web) · Dịch vụ 1-1 (mua → thay màn bằng đơn → mở cổng) | Đơn 1-1 đang chờ **không** có nút trả lại — web cũng vậy (huỷ rồi mua lại); chỉ sửa câu chữ cho khớp web. |

### 37.2 Kiểm chứng

- **Tự động:** `payments.test.ts` 19/19; toàn bộ unit **573/573**, component **61/61**; `tsc` sạch; lint 0 lỗi, không cảnh báo mới (19 cảnh báo có sẵn).
- **REAL HTTP/API + emulator (tài khoản `hytrongbeou@gmail.com`, VNPay sandbox thật, thẻ test công khai NCB):**

| Ca | Kết quả | Bằng chứng DB |
|---|---|---|
| Mua gói Titan Gym 500.000 đ → chọn VNPay (chọn sẵn) → trả thẻ test + OTP | Giao dịch `33c11e1a…` ghi `platform = mobile`; VNPay trả về → **PAID** | `payment_transactions` PAID; `gym_membership_contracts 63268734…` **ACTIVE** 28/9 → 28/10 |
| Mua gói Gymini Phú Nhuận khi đang có gói Titan | Cảnh báo "đang có gói ở gym khác" hiện trước, rồi mới tới bảng chọn cổng (320.000 đ) | — |
| App **bị Android tắt** khi đang ở VNPay → bấm **Huỷ thanh toán** | App khởi động lại từ đầu, **tự vào màn kết quả** đúng `53f0cf45…` | Giao dịch vẫn PENDING — xem 37.4 |
| Chọn **ZaloPay** | Tab đóng ngay (sandbox cố mở app ZaloPay, máy ảo không có); app **không bị tắt**, promise trả về → màn kết quả đúng `5241c15c…` | PENDING, `platform = mobile` |
| App bị tắt → người dùng **tự bấm ✕** đóng tab (lối "Thanh toán" ở tab Hội viên) | App mở lại vào màn kết quả đúng `30f52af2…` | PENDING |
| `?tab=memberships` | Tab Dịch vụ mở đúng tab Hội viên; gói Titan "Đang hiệu lực – còn 30 ngày" | — |

Dọn dữ liệu thử: 2 gói chờ ở Phú Nhuận đã **huỷ qua giao diện** (CANCELLED). Còn lại có chủ ý: 1 gói Titan ACTIVE (trả thật bằng sandbox).

### 37.3 Phát hiện: máy ảo 4 GB luôn tắt app khi mở trang cổng

`lowmemorykiller` tắt `vn.fitnessassistant.app` (≈960 MB ở chế độ dev) ngay khi Chrome tải VNPay —
thấy trong logcat ở **mọi** lần mở VNPay. Khi cổng trả về, app khởi động lại và **bản dev client làm rơi
deep link** (nó tự mở lại bằng `fitnessassistant://expo-development-client/...`), nên lần đầu người dùng
rơi về Trang chủ dù đã PAID. Đó là lý do có `pendingCheckout` — sửa đúng yêu cầu "quay lại khi app đã bị
kill" của kế hoạch mà không phụ thuộc deep link. Lỗi Fast Refresh `ResumePendingCheckout doesn't exist`
lúc sửa code là nhất thời (tải lại là hết), không phải lỗi code.

### 37.4 Còn mở của 14.1

- **Chưa kiểm được nhánh app còn sống lúc cổng trả deep link** (foreground/background) trên máy ảo — app
  luôn bị tắt. Cần điện thoại thật hoặc bản release (nhẹ hơn nhiều) → làm cùng lúc cài lên máy thật.
- **Hợp đồng PT và dịch vụ 1-1**: dùng chung hook đã kiểm, nhưng chưa bấm thật trên máy (hytrongbeou không có hợp đồng chờ) — `CODE AUDIT` + typecheck.
- **Callback trùng (idempotency)**: do backend (`handleEvent` idempotent, chống cộng hai lần) — `CODE AUDIT`, không kiểm thêm.
- **MoMo** chưa bấm thử.
- Hai quan sát phía backend (không sửa) → `MOBILE_BACKEND_GAPS.md` GAP-22.
