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

**Kiểm chứng đến đâu (17/9):** phần khách gửi đề nghị — kiểm **end-to-end thật** trên máy (thẻ và
sheet hiện đúng, nút Đổi lịch bị chặn đúng câu). Phần **khách trả lời đề nghị của PT** mới kiểm
được hợp đồng endpoint (URL + payload đúng handler, 403 đúng luật) và unit test, **chưa chạy vòng
tròn đầy đủ**: hợp đồng ACTIVE của tài khoản thử `john.doe` có PT chính là tài khoản cá nhân của
Ngài (`huytronh4@gmail.com`), và tại hạ không đăng nhập vào tài khoản của Ngài để tạo đề nghị từ
phía PT. Chốt được ngay khi Ngài gửi một đề nghị đổi lịch từ phía PT, hoặc khi Phase 10/11 dựng
xong giao diện PT.
