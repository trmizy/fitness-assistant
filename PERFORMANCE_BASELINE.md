# Performance Baseline — frontend/mobile (React Native/Expo)

> Khung đo hiệu năng thật cho dự án viết lại app mobile bằng React Native — theo Phase 0.5 của kế
> hoạch di trú. Lý do dự án này tồn tại là để đạt trải nghiệm native thật (không phải cảm giác
> "mượt hơn WebView chút"), nên mọi phase liên quan phải điền số liệu THẬT vào bảng dưới, đo trên
> thiết bị Android tầm trung thật — không được duyệt một phase chỉ vì "thấy mượt".

## Thiết bị đo chuẩn (điền khi có thiết bị thật ở Phase 5)

> ⚠️ **Lần đo Phase 5 (2026-09-15) chạy trên EMULATOR, không phải điện thoại Android tầm trung thật.**
> Số theo thời gian khởi động dùng được làm mốc tương đối; số độ giật khung hình KHÔNG đại diện cho
> thiết bị thật (GPU của emulator là lớp dịch OpenGL ES chạy trên GPU máy chủ). Cần đo lại trên máy
> thật trước khi dùng các ngưỡng bên dưới để duyệt phase.

- Model: Android Emulator — AVD `Pixel_10_Pro_XL` (`sdk_gphone16k_x86_64`), 1344×2992 @ 480 dpi
- Chip/RAM: x86_64, 4 vCPU (`hw.cpu.ncore=4`); GPU: host-GPU qua *Android Emulator OpenGL ES Translator*
  trên NVIDIA GeForce GTX 1650 (HWUI `skiagl`). Máy chủ: Intel Core i5-10300H 4 nhân/8 luồng, 15,8 GB RAM
- Phiên bản Android: 17
- Ghi chú mạng lúc đo: backend Docker chạy trên chính máy chủ, app gọi `http://10.0.2.2:3000` (loopback của
  emulator) — không có độ trễ mạng thật
- Bản build đo: **release** `app-release.apk` (bundle nhúng sẵn, Hermes, không Metro), ABI x86_64

## Bảng chỉ số theo từng phase

| Chỉ số | Cách đo | Ngưỡng chấp nhận (đề xuất, điều chỉnh khi có số liệu thật đầu tiên) | Phase 5 | Phase 6 | Phase 7 | Phase 8 | Phase 9 | Phase 10 | Phase 11 | Phase 12 | Phase 13 | Phase 14 | Phase 15 (cuối) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Cold start (mở app từ trạng thái tắt hẳn) | thời gian tới màn hình tương tác được đầu tiên | < 2.5s | ⚠️ **VƯỢT** — khung hình đầu (splash) trung vị **804 ms**; Trang chủ hiện chữ **~5,0–7,7 s** (emulator, xem ghi chú) | | | | | | | | | | |
| Warm start (mở lại sau khi đã ở nền) | thời gian tới màn hình tương tác được | < 1s | ✅ **223 ms** trung vị (HOT, 3 lần: 223/178/229) | | | | | | | | | | |
| Độ trễ điều hướng (chuyển màn/tab) | thời gian từ nhấn tới màn mới render xong | < 150ms | ❌ **Chưa đo được** — phương pháp chụp cây UI có độ phân giải ~2,4 s | | | | | | | | | | |
| Cuộn danh sách dài (vd thư viện bài tập, lịch sử giao dịch) | frame drop quan sát được / công cụ profiler | 0 giật rõ rệt ở tốc độ cuộn thường | ⚠️ FlashList thư viện bài tập: 46,5% khung giật, p50 48 / p90 81 / p99 150 ms — mốc ScrollView cũng 47,0% → chủ yếu do emulator | | | | | | | | | | |
| Frame drop JS thread | React DevTools Profiler / Flipper | < 5% frame > 16ms trong thao tác thường | ❌ Chưa đo (cần profiler trên thiết bị thật) | | | | | | | | | | |
| Frame drop UI thread | Perfetto/systrace hoặc Flipper | tương tự trên | ⚠️ gfxinfo: 140/342 khung "Slow UI thread" (FlashList), 51/151 (ScrollView) — emulator | | | | | | | | | | |
| Thời gian render dashboard (nhiều card/API song song) | thời gian tới khi mọi card hiện dữ liệu thật | < 1.5s trên mạng WiFi thường | ⚠️ **VƯỢT** — chỉ số cơ thể hiện ở cận trên **~10,0–10,5 s** (emulator, backend loopback) | | | | | | | | | | |
| Màn hình nhiều ảnh (thư viện ảnh gym, gallery) | frame drop lúc cuộn + thời gian ảnh hiện đầy đủ | không giật khi cuộn nhanh | — Không áp dụng (Phase 5 chưa có màn nhiều ảnh) | | | | | | | | | | |
| Bộ nhớ (RAM) sau 10 phút dùng liên tục | Android Studio Profiler | không tăng dần không giới hạn (rò rỉ) | ❌ Chưa chạy bài 10 phút — chỉ có mẫu đơn: PSS ~158–187 MB (Trang chủ), ~237 MB sau khi cuộn thư viện | | | | | | | | | | |
| Background → resume (thời gian phục hồi trạng thái + socket) | quan sát thủ công + log | < 1s cho UI, xác nhận socket reconnect trong `MOBILE_PLATFORM_ADAPTERS.md` mục 8 | ✅ UI **223 ms** (trùng warm start); socket (thêm 15/9): nền + mất mạng 75 s → mở lại → nối lại **~3 s** (emulator, xem ADAPTERS §8) | | | | | | | | | | |

## Ghi chú lần đo Phase 5 (2026-09-15, release build trên emulator)

**Cách đo và độ tin cậy của từng số:**
- *Khung hình đầu* = `am start -W` `TotalTime` (ActivityManager, chính xác cỡ mili giây). Với app React Native đây vẫn là màn splash, **không** phải lúc tương tác được. Hai lượt độc lập: trung vị 793 ms và 804 ms (5 lần mỗi lượt, `force-stop` giữa các lần).
- *Trang chủ hiện chữ* = lần đầu `uiautomator dump` thấy nhãn "Chuỗi ngày tập". Mỗi lần chụp + đọc cây UI tốn **2.360–2.581 ms** (đo riêng), nên số đọc được (7.393 / 7.455 / 7.660 / 7.709 / 7.852 ms) là **cận trên**, giá trị thật nằm khoảng 2,4 s bên dưới → **~5,0–7,7 s**. Cận dưới vẫn vượt ngưỡng 2,5 s.
- *Chỉ số cơ thể hiện* = lần đầu thấy "kg so với lần trước": 9.995–10.511 ms (cận trên, cùng độ phân giải).
- *Độ giật khi cuộn* = `dumpsys gfxinfo` sau `reset`, 12 lần vuốt giống hệt nhau. Đã xác nhận đúng màn "Thư viện bài tập" bằng cây UI và ảnh chụp trước khi đo.

**Vì sao số độ giật không dùng để duyệt được:** cùng 12 lần vuốt trên Trang chủ (một ScrollView thường, không ảo hoá) cũng giật **47,0%** — gần như bằng FlashList (**46,5%**). GPU của emulator là lớp dịch OpenGL ES chạy trên GPU máy chủ, nên phần lớn độ giật là của môi trường. Tín hiệu *tương đối* vẫn đáng ghi: các phân vị của FlashList tệ hơn rõ so với ScrollView (p50 48 vs 31 ms, p90 81 vs 57 ms, p99 150 vs 81 ms) và có 7 lần upload bitmap chậm.

**Vượt ngưỡng — báo cáo, không nới ngưỡng (theo nguyên tắc cuối tài liệu):**
1. *Cold start tới Trang chủ ~5,0–7,7 s* (ngưỡng 2,5 s). Nhãn "Chuỗi ngày tập" hiện ngay khi component Trang chủ mount (thẻ dùng skeleton trong lúc chờ dữ liệu), nên phần lớn thời gian nằm **trước** khi màn hình mount: nạp bundle Hermes, `bootstrapSession` (xác thực/làm mới token) và các guard `RequireRole` → `RequireOnboarding` (chờ tải hồ sơ). Hướng điều tra: đặt mốc thời gian (performance marks) ở từng bước khởi động để biết bước nào chiếm thời gian, xem có render được khung Trang chủ trong lúc guard onboarding còn chờ không.
2. *Trang chủ đầy đủ dữ liệu ~10 s* (ngưỡng 1,5 s): 5 truy vấn song song qua gateway. Cần tách phần do emulator/khởi động khỏi phần do API trước khi kết luận.

**Chưa đo, cần làm trên điện thoại thật:** độ trễ điều hướng (phương pháp chụp cây UI quá thô — cần Perfetto hoặc mốc thời gian trong app), frame drop luồng JS, bài bộ nhớ 10 phút. Toàn bộ bảng phải đo lại trên thiết bị Android tầm trung thật trước khi dùng để duyệt phase.

## Chiến lược danh sách dài / ảnh (audit trước khi code, không đợi chậm mới sửa)

- Danh sách dài (thư viện bài tập/thực phẩm, lịch sử giao dịch, danh sách học viên/chi nhánh):
  dùng `FlatList`/`FlashList` (ưu tiên `@shopify/flash-list` nếu tương thích New Architecture tại
  thời điểm Phase 5 — xác nhận lại lúc thực thi, đây là quyết định của Phase 5, không cứng ở đây)
  với `keyExtractor` ổn định, tránh `ListItem` re-render không cần thiết (memo hoá).
- Ảnh: `expo-image` (có cache đĩa/bộ nhớ sẵn, hỗ trợ placeholder/blurhash) thay vì `Image` gốc —
  đặc biệt quan trọng cho thư viện ảnh gym, ảnh bài tập, avatar danh sách dài.
- Không tải ảnh full-size cho thumbnail danh sách — dùng kích thước ảnh phù hợp nếu backend hỗ trợ
  resize theo query param, hoặc resize client-side trước khi hiển thị nếu không.

## Nguyên tắc dùng bảng này

- Mỗi phase (5 trở đi) đo và điền số liệu thật trước khi báo cáo "Xong khi" — không để trống rồi
  qua phase sau mới bù.
- Nếu 1 chỉ số vượt ngưỡng đề xuất, không tự ý nới ngưỡng để "cho qua" — báo cáo cụ thể, đề xuất
  hướng khắc phục (thường là 1 trong: danh sách chưa ảo hoá đúng, ảnh chưa cache, quá nhiều
  re-render, quá nhiều API gọi song song không cần thiết).
- Phase 15 chạy lại toàn bộ bảng 1 lần cuối trên thiết bị thật trước khi coi là "ổn định và mượt
  mà" đủ điều kiện cutover — đây là bằng chứng thay cho cảm giác chủ quan.
