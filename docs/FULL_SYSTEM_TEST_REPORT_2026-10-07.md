# Báo cáo kiểm thử toàn hệ thống — 06–07/10/2026

Mã được kiểm: nhánh `feature/payment-gateways`, commit `19afc12` (backend partner chạy `aws-deploy` 1008e575, đã gồm 19afc12).
Trong buổi kiểm KHÔNG sửa mã nào; cây làm việc sạch.

## 1. Phạm vi và môi trường

| Giai đoạn | Thời gian | Backend | Máy khách |
|---|---|---|---|
| A | 23:17 06/10 → 02:59 07/10 | Máy partner qua tunnel Cloudflare, AI thật (Ollama qwen3:4b), VNPay sandbox, FCM thật | TECNO SPARK 40 Pro (bản release, Android 15) + web local trên Chromium |
| B | 03:03 → 04:05 07/10 | Laptop này (cùng mã, không có AI) qua tunnel riêng | Cùng điện thoại + web local |

Giai đoạn B bắt buộc vì lúc 02:59 tunnel của partner chết (530 "Cloudflare Tunnel error 1033", sau đó tên miền biến mất hẳn). Mọi mục cần AI hoặc dữ liệu partner chưa kịp chạy đều ghi ở mục 5.

Nhãn bằng chứng: REAL DEVICE (điện thoại thật), REAL BROWSER (Chromium qua Playwright), REAL HTTP/API (gọi API thật), CODE AUDIT (đọc mã), TEST FIXTURE (dựng dữ liệu bằng API).

## 2. Lỗi tìm được (xếp theo mức độ)

| Mã | Mức | Thuộc | Tóm tắt | Bằng chứng |
|---|---|---|---|---|
| LỖI-1 | P1 | gateway | Một yêu cầu HTTP thường tới `/chat-socket.io` làm hỏng mọi WebSocket của `/socket.io` cho tới khi gateway khởi động lại. Không cần đăng nhập để kích hoạt. Khi dính: điện thoại báo "Đang kết nối lại…", web gửi tin chat bị mất âm thầm. Trong buổi này nhiều khả năng chính lần dò kết nối của người kiểm đã kích hoạt nó trên gateway partner. | REAL HTTP/API (tái hiện local) + REAL DEVICE + CODE AUDIT `gateway/src/routes/proxy.routes.ts`, `server.ts` |
| LỖI-2 | P1 | mobile | Còn phiên đăng nhập mà máy chủ đã lưu không tới được → mở app chỉ thấy màn đen, không lối sang "Cấu hình máy chủ"; phải xoá dữ liệu app. | REAL DEVICE + CODE AUDIT `RequireOnboarding.tsx` |
| LỖI-9 | P1 | backend dinh dưỡng + mobile | Món ghi từ 00:00–06:59 giờ VN rơi vào ngày hôm trước: nhật ký "hôm nay" trống, tổng calo sai ngày. | REAL DEVICE + REAL HTTP/API + CODE AUDIT `nutrition.service.ts` |
| LỖI-10 | P1 | backend (AI thật) | Bản nháp lộ trình bằng AI không bao giờ kịp: fitness-service chờ ai-service 90 s rồi trả bản dự phòng; model cần lâu hơn. Tăng timeout không đủ (tunnel cắt ~100 s, app chờ 120 s) → cần chạy nền như sinh giáo án. | REAL DEVICE + REAL HTTP/API (90,3 s) + CODE AUDIT `ai.client.ts:338` |
| LỖI-16 | P1 | backend user + mobile | PT mới được duyệt gần như không thể được tìm thấy: tìm theo tên trả 0 (tên không nằm trong UserProfile), và app chỉ tải 50/107 PT, không có tải thêm. | REAL HTTP/API + CODE AUDIT `profile.repository.ts`, `ptDiscovery.ts` |
| LỖI-20 | P1 | mobile | Không có lối mở cuộc trò chuyện giữa khách và PT trên điện thoại (chi tiết PT, thẻ hợp đồng không có nút; nút "Nhắn tin" của PT chỉ mở danh sách). Web có. | REAL DEVICE + CODE AUDIT |
| LỖI-21 | P1 | web | Gửi tin chat khi socket chưa nối: ô nhập bị xoá, tin không được lưu, không báo lỗi. | REAL BROWSER + REAL HTTP/API |
| LỖI-23 | P1 | mobile | Bản đồ không hiện ô nền trên máy thật (chi tiết phòng gym và bảng ghim vị trí), tra địa chỉ cũng lỗi → chủ gym phải ghim mù. Chưa rõ nguyên nhân. | REAL DEVICE |
| LỖI-3 | P2 | mobile | Đăng ký mới + xác minh OTP xong lại về màn đăng nhập thay vì onboarding. | REAL DEVICE |
| LỖI-4 | P2 | mobile | Onboarding bước 5: chữ gợi ý "25"/"175" trông như đã điền sẵn; tuổi/chiều cao/giới tính lưu null. | REAL DEVICE + REAL HTTP/API |
| LỖI-5 | P2 | mobile | "Kết thúc buổi tập" khi còn bài dở vẫn báo "Đã hoàn thành buổi tập!" dù backend chưa đóng buổi. | REAL DEVICE + REAL HTTP/API + CODE AUDIT `log.tsx` |
| LỖI-6 | P2 | mobile | Trang chủ không cập nhật sau khi buổi tập hoàn thành (vẫn "Bắt đầu buổi tập", 0%) cho tới khi tắt mở app. | REAL DEVICE + CODE AUDIT |
| LỖI-8 | P2 | mobile | Ngày bắt đầu mặc định của "Chương trình mới" / "Giao kế hoạch" lấy theo UTC → 00:00–06:59 ra ngày hôm qua. | REAL DEVICE + CODE AUDIT `PlanDraftBuilder.tsx:24` |
| LỖI-11 | P2 | backend fitness | Chu kỳ tạo lúc 02:02 ngày 07/10 được lưu ngày bắt đầu 06/10 (UTC). | REAL DEVICE + REAL HTTP/API |
| LỖI-12 | P2 | mobile | Ảnh đại diện tải lên xong không hiển thị (đường dẫn tương đối đưa thẳng cho expo-image). | REAL DEVICE + REAL HTTP/API + CODE AUDIT `Avatar.tsx` |
| LỖI-13 | P2 | backend user | Duyệt/từ chối đơn PT không báo cho người nộp, dù màn hình hứa "sẽ nhận thông báo". | REAL HTTP/API + CODE AUDIT |
| LỖI-15 | P2 | mobile | Nút "+ Thêm" gói dịch vụ PT bị đẩy ra mép, chỉ còn "+ Th". | REAL DEVICE |
| LỖI-17 | P2 | backend | Nội dung push hệ thống bằng tiếng Anh ("New coaching request received"). | REAL DEVICE |
| LỖI-18 | P2 | mobile | Danh sách hợp đồng và Tổng quan của PT không tự nạp lại khi có yêu cầu mới; phải kéo để làm mới. | REAL DEVICE |
| LỖI-19 | P2 | mobile + backend | Bảng đặt buổi cho chọn khung giờ trong vòng 24 giờ mà backend luôn từ chối; lỗi hiện tiếng Anh. | REAL DEVICE |
| LỖI-24 | P2 | mobile | "Điện thoại chi nhánh (tuỳ chọn)" ghi tuỳ chọn nhưng bước gửi hồ sơ bắt buộc. | REAL DEVICE |
| LỖI-14 | P3 | mobile | Màn trạng thái đơn ứng tuyển PT không làm mới được, phải tắt app. | REAL DEVICE |

Chi tiết từng lỗi (bước tái hiện, số liệu) nằm ở mục 6.

## 2b. Sửa lỗi — chiều 07/10 (chưa commit)

Nguồn gốc: mọi lỗi dưới đây nằm trong MÃ DÙNG CHUNG (hai máy chạy cùng commit), không phải do cấu hình riêng của máy partner — trừ các dòng ghi rõ. Máy partner chỉ làm lộ một số lỗi mà máy này không lộ: lưu ảnh trên đĩa (LỖI-12), có tài khoản đăng ký thật không qua seed (LỖI-16), có AI thật (LỖI-10).

Nhãn kiểm: MÁY ẢO = máy ảo Android, bản dev, backend laptop này (chưa phải điện thoại thật). Điện thoại TECNO chưa cắm lại nên CHƯA có mục nào được kiểm lại trên máy thật.

| Mã | Sửa ở | Cách sửa | Đã kiểm |
|---|---|---|---|
| LỖI-1 | gateway | Tắt `ws` của proxy `/chat-socket.io` (proxy tự giành mọi upgrade); `server.ts` vẫn chuyển upgrade của chat như cũ | Test hồi quy mới (đỏ khi bỏ sửa); REAL HTTP/API: chuỗi tái hiện cũ nay nối được cả 5 bước, 2 lần |
| LỖI-2 | mobile | Chốt onboarding: lỗi tải hồ sơ thì giữ nguyên màn hình qua các lần thử lại, không thử lại ở chốt, vòng xoay thay màn trống | Test component mới; MÁY ẢO: tắt gateway → hết màn đen, Trang chủ hiện và đứng yên; bật lại → kéo làm mới ra dữ liệu |
| LỖI-3 | mobile | `setUser` của AppContext nay thiết lập luôn phiên đăng nhập | Test component mới. CHƯA kiểm trên máy (cần OTP dev — chờ backend partner) |
| LỖI-4 | mobile | Chữ gợi ý đổi thành "VD: 25", "VD: 175", "VD: 60" | CODE AUDIT |
| LỖI-5 | mobile | Thông báo nói đúng: "Đã lưu tiến độ. Buổi tập còn bài chưa xong…"; chỉ báo hoàn thành khi buổi thật sự đóng | MÁY ẢO |
| LỖI-6 | mobile | Khi buổi đóng (bằng set cuối hoặc "Xong cả bài") làm mới mọi bảng tổng hợp buổi tập | MÁY ẢO: Trang chủ đổi sang "50% · 1/2 buổi" không cần mở lại app |
| LỖI-8 | mobile | Ngày mặc định lấy theo ngày địa phương | CODE AUDIT (hàm dùng chung đã có test) |
| LỖI-9 | mobile | Ghi món kèm mốc ngày địa phương (12:00 UTC của ngày đó — đúng quy ước web đang dùng) | Test mới; MÁY ẢO + REAL HTTP/API: bản ghi lưu `2026-10-07T12:00:00Z`. Backend KHÔNG đổi |
| LỖI-11 | fitness-service | Chu kỳ không truyền ngày thì bắt đầu "hôm nay" theo giờ VN; chu kỳ của giai đoạn lộ trình lấy ngày theo giờ VN | 3 test mới; kiểu + 34/37 test tích hợp chu kỳ trên DB `_test` (3 cái hỏng vì test tự nối DB user-service bị từ chối — có từ trước) |
| LỖI-12 | mobile | Avatar ghép địa chỉ máy chủ cho đường dẫn tương đối; ảnh lỗi thì hiện lại chữ viết tắt | Test mới. CHƯA kiểm trên backend lưu đĩa (chờ partner) |
| LỖI-13 | user-service | Duyệt / từ chối / yêu cầu bổ sung đơn PT nay báo cho người nộp (socket + push), tiếng Việt | Test mới; REAL HTTP/API: người nộp nhận sự kiện; REAL BROWSER: chuông web hiện sau 0,85 s |
| LỖI-15 | mobile | Dòng mô tả co lại, nút "Thêm" không bị đẩy ra ngoài | MÁY ẢO (màn rộng hơn TECNO — cần xem lại trên máy thật) |
| LỖI-16 | user-service + mobile | (a) Khi duyệt PT, chép tên từ auth sang hồ sơ để tìm được; danh sách PT tự vá các hồ sơ cũ thiếu tên. (b) App tải theo trang, có nút "Xem thêm huấn luyện viên" | Test mới (tên, phân trang). REAL HTTP/API: phân trang chạy. CHƯA kiểm phần vá tên (DB máy này không có PT thiếu tên — chờ partner) |
| LỖI-17 | user-service | 6 câu thông báo tiếng Anh → tiếng Việt; link "đã chấp nhận" sửa từ `/client/schedule` (không tồn tại trên web) sang `/client/contracts` | REAL HTTP/API |
| LỖI-18 | mobile | Sự kiện từ máy chủ (socket hoặc push khi app đang mở) làm mới đúng danh sách liên quan; Hợp đồng và Tổng quan PT nạp lại khi quay lại màn | Test mới; MÁY ẢO: "Yêu cầu · 0 → 1" và ngược lại, không kéo |
| LỖI-19 | mobile + user-service | Bảng đặt buổi bắt đầu từ ngày mai và chỉ hiện khung giờ cách ≥ 24 giờ; lỗi máy chủ Việt hoá | Test mới. CHƯA kiểm trên máy (cần hợp đồng đang hiệu lực — chờ partner) |
| LỖI-20 | mobile | Nút "Nhắn tin" ở chi tiết PT; nút "Nhắn tin" của PT mở đúng hội thoại với học viên (tạo nếu chưa có) | Test mới; MÁY ẢO cả hai chiều |
| LỖI-21 | web | Socket chưa nối thì gửi qua REST; REST cũng lỗi thì giữ nguyên chữ và báo lỗi | REAL BROWSER (chặn socket: POST 201, tin hiện; chặn cả REST: chữ còn, có báo lỗi) |
| LỖI-24 | mobile | Bỏ chữ "(tuỳ chọn)" ở ô điện thoại chi nhánh | CODE AUDIT |
| LỖI-25 (mới) | mobile + web | `notification:new` do chat-service phát, nhưng cả hai app chỉ nghe ở socket gateway → chuông không bao giờ cập nhật tức thời. Nay nghe cả hai | REAL HTTP/API (xác nhận kênh); REAL BROWSER; MÁY ẢO |

**Chưa sửa — cần Ngài quyết:**

- **LỖI-10 (nháp lộ trình AI).** Nguyên nhân gồm cả mã chung lẫn máy partner: ai-service cho mỗi lần gọi model 80 s và thử 3 lần (tới 240 s), fitness-service chỉ chờ 90 s, app chờ 120 s, tunnel Cloudflare cắt ở ~100 s; model qwen3:4b trên máy partner không kịp trong 80 s. Tăng timeout không cứu được vì còn tunnel và app. Sửa đúng là chuyển sang chạy nền như sinh giáo án (thêm API + màn chờ ở web và mobile) — thay đổi lớn, thuộc miền AI của partner, và máy này không có AI để kiểm. Chưa làm.
- **LỖI-23 (bản đồ không có nền trên TECNO).** KHÔNG tái hiện trên máy ảo: nền bản đồ hiện bình thường, và từ laptop máy chủ ô bản đồ trả 200 với đúng các header của WebView. Trên TECNO cả ô bản đồ lẫn tra địa chỉ (đều của openstreetmap.org) cùng hỏng trong khi thư viện Leaflet (CDN khác) tải được → nghi mạng 4G của máy hoặc OSM chặn dải IP đó. Cần cắm lại điện thoại để xác nhận (thử Wi-Fi so với 4G).
- **LỖI-14 (P3)** chỉ được cải thiện gián tiếp: màn trạng thái đơn PT nay tự làm mới khi có thông báo duyệt.

**Ghi nhận khi sửa:**

- Thông báo kết quả đơn PT hiện KHÔNG lưu vào danh sách thông báo (chỉ đẩy tức thời + push), vì lưu cần thêm giá trị enum = một migration trên cả hai máy. Cần Ngài quyết có thêm migration không.
- Một lần trên máy ảo (ngay sau khi máy tính khởi động lại) nút "Xong cả bài" kẹt ở "Đang lưu…" và yêu cầu không tới máy chủ; sau khi mở lại app thì chạy bình thường, gọi thẳng API cũng bình thường. Chưa tái hiện lại được — cần để ý khi kiểm trên máy thật.
- Dữ liệu thử thêm vào DB máy này: testuser008 có buổi tập hôm nay đã hoàn thành; đơn PT của testuser009 chuyển sang "cần bổ sung"; 2 yêu cầu hợp đồng testuser011 → pt@example.com đã huỷ; vài tin nhắn thử.

## 3. Phần đã đạt (tóm tắt)

- Điện thoại, vai khách: giới thiệu, kiểm tra địa chỉ máy chủ, đăng ký + OTP, onboarding, quét 38 màn, buổi tập + hướng dẫn bài tập + cảm nhận sau buổi, ghi món ăn, mục tiêu dinh dưỡng, InBody nhập tay, thuật sĩ lộ trình + kích hoạt, sửa hồ sơ, tải ảnh đại diện, thư viện, cài đặt, xuất dữ liệu, báo cáo vấn đề, đánh giá phòng gym.
- AI thật: AI Coach trả lời ~60–69 s; sinh giáo án chạy nền ~317 s; lưu lịch 24 buổi.
- Chéo vai trò: ứng tuyển PT trên máy → admin duyệt trên web → PT tạo gói trên máy → khách yêu cầu trên web → push FCM tới máy PT → PT nhận trên máy → khách trả VNPay sandbox trên máy → đặt buổi → PT xác nhận trên web.
- Thanh toán: quay về app khi app còn sống, khi đóng tab giữa chừng (chờ xác nhận), và khi app bị tắt hẳn.
- Chat realtime 2 chiều và gọi thoại/video điện thoại ↔ web (khi gateway chưa dính LỖI-1).
- Đối tác phòng gym tự đăng ký 9 bước trên máy → admin duyệt trên máy → chủ gym thiết lập nhận tiền, tạo gói, mã QR.
- Cách ly dữ liệu khi đổi tài khoản: không rò.
- Quét web: 31 route khách, 8 route PT, 15 route admin; quét API 98 endpoint × 3 vai.

## 4. Ghi nhận về nội dung AI và dữ liệu (thuộc miền partner)

- Giáo án cho người mới có bài nâng cao/không an toàn (Muscle Up, Handstand Push-Ups, Deadlift with Chains), tên buổi không dấu, mô tả tiếng Anh, nhãn enum thô.
- AI Coach lẫn tiếng Anh, lộ nhãn nguồn nội bộ; macro AI đưa ra khác mục tiêu đang hiển thị.
- Ba con số calo cùng lúc cho một người: mục tiêu mặc định 2.000, mục tiêu đã lưu 2.800, lộ trình 2.624.
- Thư viện thực phẩm toàn tên tiếng Anh; tìm "phở" ra bánh quy.
- Đối soát admin trên dữ liệu partner báo lệch −4,6 triệu.
- Chính sách: huỷ gói hội viên ngay sau khi mua mất trọn tiền.

## 5. Chưa kiểm được

- Trên backend partner (do tunnel chết): chat/gọi qua backend partner sau khi gateway khởi động lại, phòng buổi học, AI Coach có ảnh, PT nhờ AI soạn nháp cho học viên, rút tiền có số dư thật, đơn dịch vụ 1-1, đối tác phòng gym trên dữ liệu partner.
- Cần người cầm máy: quét mã QR check-in, "Dùng vị trí hiện tại", gọi đến khi app tắt hẳn, loa ngoài.
- Không gửi thử thư đặt lại mật khẩu (tránh phát thư thật).

## 6. Nhật ký chi tiết

### Kiểm toàn bộ trên backend partner qua tunnel — 6/10/2026 (bắt đầu 23:17)
Tunnel: https://locate-accommodate-every-stones.trycloudflare.com · backend aws-deploy 1008e575 · AI: Ollama qwen3:4b
Client: web local (REAL BROWSER) + TECNO SPARK 40 Pro bản release 22:37 (REAL DEVICE)

#### P1 — Quét API đọc (REAL HTTP/API), 98 endpoint tĩnh từ api.ts
- client testuser001: 51×200, 40×403 (chặn quyền đúng), 7×404 (3 lộ trình "chưa có", 4 route đã gỡ: /admin/workflows*, /admin/gym-owners)
- pt testpt001: 55×200; /marketplace/orders/selling 403 PERSONALIZED_SERVICE_FORBIDDEN (PT seed chưa duyệt qua đơn)
- admin: 70×200; /admin/payments/reconciliation 409 balanced:false escrow 67.29M vs claims 71.89M drift -4.6M (DỮ LIỆU partner lệch sổ)
- GHI CHÚ: mobile api.ts còn hàm gọi /admin/workflows* và /admin/gym-owners (route đã gỡ) — mã chết cần dọn.

#### LỖI-1 (P1, gateway, có ở CẢ repo mình — tái hiện local 23:40) — WebSocket của socket gateway hỏng sau lần polling đầu tới /chat-socket.io
- Tái hiện (REAL HTTP/API, local http://localhost:3000): /socket.io transport=websocket CONNECTED → 1 lần /chat-socket.io transport=polling → /socket.io websocket: "Invalid WebSocket frame: RSV1 must be clear".
- Trên tunnel partner: /socket.io websocket ERR (cùng lỗi), polling CONNECTED; /chat-socket.io websocket+polling CONNECTED.
- Nguyên nhân (CODE AUDIT): chatSocketProxy (http-proxy-middleware ws:true, gắn qua router.use) tự gắn listener 'upgrade' lên server ở request HTTP đầu tiên và bắt MỌI upgrade (context "/"), nên upgrade của /socket.io bị cả socket.io lẫn proxy xử lý → khung hỏng. Client rơi về polling (vẫn chạy, chậm hơn).
- Web console: "[socket] connect_error: websocket error" lặp lại ở mọi trang.

#### LỖI-2 (P1, mobile) — Màn đen khi mở app nếu máy chủ đã lưu không tới được (REAL DEVICE, TECNO, release 22:37)
- Tái hiện: app còn phiên đăng nhập + địa chỉ máy chủ trỏ tới tunnel đã chết → mở app: màn đen >70 giây, không vòng xoay, không lối vào "Cấu hình máy chủ".
- Nguyên nhân (CODE AUDIT): src/components/guards/RequireOnboarding.tsx `if (profileQuery.isLoading) return null;` — query hồ sơ chạy hết các lần retry (timeout 10s mỗi lần) mới chuyển sang lỗi.
- Đề xuất: hiện vòng xoay thay vì null, không retry ở chốt này, và khi lỗi mạng thì cho lối sang Cấu hình máy chủ.
- Theo dõi thêm: sau 3 phút vẫn đen (không tự hồi phục) → phải xoá dữ liệu app. Mức độ thực tế P0 với người dùng gặp phải.

#### P2 — Quét web (REAL BROWSER, Chromium headless, web local → tunnel partner)
- client testuser001: 31 route — tất cả tải, 0 lỗi API. /client/workout còn khung chờ sau 35s (chậm qua tunnel — cần đo lại). Tải trang 6–35 s/trang.
- pt testpt001: 8 route OK (1 cảnh báo React validateDOMNesting button trong button ở /pt/contracts).
- admin: 15 route OK. /admin/marketplace trả 567.467 ký tự văn bản (danh sách không phân trang → nặng). /admin/workflows: trang trống (route đã gỡ, đúng).
- Mọi trang: console lặp "[socket] connect_error: websocket error" (LỖI-1).

#### P3 — Mobile (REAL DEVICE, TECNO, release 22:37) — thiết lập
- Màn giới thiệu 3 trang → đăng nhập: ĐẠT.
- Cấu hình máy chủ: "lhttps://…" → "Địa chỉ không hợp lệ…" (không lưu) ĐẠT; "http://192.168.40.69:3000" → "Bản phát hành chỉ kết nối được địa chỉ https://" ĐẠT; lưu tunnel partner → ĐANG DÙNG đổi đúng ĐẠT.
- Ghi chú: ô này bật bàn phím bảo mật Transsion (com.transsion.sk) → chụp màn hình đen (hành vi hệ thống, không phải lỗi app).
- Đăng ký mới trên máy (qa.c1006a@example.com): form → OTP (devOtp lấy qua /auth/register/resend) → xác minh thành công → hộp xin quyền thông báo → **về màn ĐĂNG NHẬP thay vì onboarding** (LỖI-3, P2 mobile; code định `router.replace(ONBOARDING_PATH)`; API verify + refresh token hoạt động — REAL HTTP/API với qa.c1006b). Đăng nhập lại thì vào onboarding đúng.
- Ô OTP: gõ nhanh bằng adb rớt số (do công cụ); nhập từng ô thì đúng.
- Bàn phím (root KAV): onboarding bước 5, ô Cân nặng sát đáy → khi bàn phím bật, ô và nút Tiếp tục nằm trên bàn phím (y=1210/1358, bàn phím từ ~1540) — ĐẠT REAL DEVICE.
- Onboarding 6 bước (người mới qa.c1006a) → Trang chủ: ĐẠT. Backend (REAL HTTP/API): hasCompletedOnboarding=true, BEGINNER, MUSCLE_GAIN, LIGHTLY_ACTIVE, 3 ngày, 20 thiết bị, currentWeight 72.
- LỖI-4 (P2 UX, mobile): bước 5 hiện "25" (tuổi) và "175" (chiều cao) trông như đã điền sẵn nhưng chỉ là chữ gợi ý → backend lưu age=null, heightCm=null, gender=null; màn Xem lại chỉ hiện "72kg". Người dùng tưởng đã có tuổi/chiều cao → TDEE không tính được theo người.
- GHI NHẬN (dữ liệu/miền dinh dưỡng): người mới chưa có mục tiêu (active-state NO_ACTIVE_GOAL) nhưng GET /nutrition/goals trả mặc định 2000 kcal/150g "RECOMMENDED" và Trang chủ hiện "0 / 2.000 kcal" như mục tiêu thật.

#### P4 — AI (backend partner, Ollama qwen3:4b) — REAL DEVICE
- AI Coach chat (người mới, câu gợi ý "Tôi nên ăn gì?"): trả lời sau ~60–69s; có trạng thái chờ ("AI đang tạo câu trả lời cá nhân hóa…" → "Model local có thể đang khởi động, vui lòng chờ thêm…"); câu trả lời có cấu trúc + 3 nguồn tham khảo. ĐẠT (không bị tunnel cắt lần này).
- NỘI DUNG (AI/partner): (a) lẫn tiếng Anh trong mục "Giả định": "No dietary preference provided; using a general mixed-food baseline template." và câu lai "Nutrition targets are low-độ tin cậy because key profile metrics are missing."; (b) nguồn tham khảo lộ nhãn nội bộ "curated_summary · body_composition"; (c) macro AI đưa ra (Đạm 140g | Carb 309g | Béo 67g) KHÁC mục tiêu app đang hiển thị (2000 kcal / 150g đạm) → hai nguồn số liệu dinh dưỡng mâu thuẫn; (d) AI hỏi lại chiều cao/tuổi — đúng hệ quả LỖI-4.
- Sinh giáo án AI (Kế hoạch → Tạo giáo án AI: Tăng cơ, 3 buổi, 8 tuần, phòng gym): job bất đồng bộ, tiến độ %, xong sau ~317s (5'17"). ĐẠT về luồng (REAL DEVICE).
- CHẤT LƯỢNG GIÁO ÁN (AI/partner): người MỚI BẮT ĐẦU nhận "Overhead Stretch 4×6-10 nghỉ 120s", "Bench Press with Chains", "Deadlift with Chains", "Reverse Band Deadlift" (biến thể nâng cao, cần xích/dây kháng lực — không chắc có trong 20 thiết bị đã chọn); mô tả tiếng Anh "8-week Tăng cơ program, 3 days/week"; tên buổi không dấu "Nguc + Lung + Core", "Chan + Mong", "Vai + Tay truoc + Tay sau"; nhóm cơ tiếng Anh + enum thô "BARBELL/BODYWEIGHT"; "Nơi tập: Chưa xác định" dù đã chọn Phòng gym; ghi chú "Cardio: Khoi dong nhe 5-10 phut truoc buoi tap." không dấu.
- Lưu giáo án AI vào lịch (hôm nay, T2/T4/T6, 8 tuần): "Đã tạo 24 buổi" — backend có lịch 07/10, 09/10, 12/10… NOT_STARTED. ĐẠT (REAL DEVICE + REAL HTTP/API).
- "Giải thích" giáo án: hiện "Giải thích tự động (AI phản hồi chậm)" — bản dự phòng do AI quá hạn (không lỗi app; AI thật không kịp trả lời).
- (b) Bảng hướng dẫn bài tập khi đang tập: mở sau ≤1s, giữ ổn định 12s, đủ ảnh Demo + nhãn + hướng dẫn — ĐẠT REAL DEVICE (release). (a) Màn Tập luyện mới: đầu màn chỉ còn tiêu đề + nút +, nút mũi tên góc dưới trái — ĐẠT REAL DEVICE.
- Buổi tập thật (qa.c1006a, "Chan + Mong"): bắt đầu → set 1 10kg×6 → tổng 60kg, đồng hồ nghỉ 90s ±15s/Bỏ qua — ĐẠT.
- LỖI-5 (P2, mobile): "Kết thúc buổi tập" khi chưa xong hết set → toast "Đã hoàn thành buổi tập!" + quay ra, nhưng backend vẫn IN_PROGRESS (REAL HTTP/API). Nút không gọi API (CODE AUDIT log.tsx `finish`), buổi chỉ đóng khi mọi bài hoàn thành → thông báo sai sự thật, không có cách kết thúc sớm.
- Hoàn thành buổi (01:23 7/10): "Xong cả bài" cho từng bài → bài chuyển 3/3 (4/4), nút đổi thành "Hoàn tác bài"; bài cuối xong → backend COMPLETED, completedAt có giá trị, màn đổi tiêu đề "Buổi tập hôm nay" + nút "Về Tập luyện" — ĐẠT (REAL DEVICE + REAL HTTP/API). "Xong cả bài" điền 10kg cho các set còn lại của Dumbbell Step Ups (lấy theo set đã ghi) — hợp lý.
- Đính chính: lúc 00:29 backend ghi 2/4 bài là ĐÚNG (2 bài đầu tại hạ chưa bấm xong) — app và backend khớp nhau, không phải lỗi đồng bộ. LỖI-5 vẫn đúng (toast "Đã hoàn thành buổi tập!" khi còn bài dở).
- GHI NHẬN chất lượng giáo án: bài bodyweight (Glute Kickback, Sprint Drill, Standing Long Jump) hiện ô "0 KG" — loggingMode BODYWEIGHT_REPS nhưng màn ghi vẫn hiện cột KG.
- Cảm nhận sau buổi ("Chưa ghi cảm nhận · Thêm ngay"): bảng đủ mục (sao, độ khó, thích, chất lượng, RPE, đau, mệt, tập lại, so với buổi trước, chi tiết từng bài, ghi chú); Lưu → backend có bản ghi sessionRating 4, difficulty just_right, enjoyment high, wouldRepeat yes, perceivedProgress same — ĐẠT (REAL DEVICE + REAL HTTP/API). Tóm tắt buổi: 4 bài / 13 set / 240 kg, tổng thời gian 60:30.

#### P5 — Quét 38 màn client trên máy (REAL DEVICE, release, backend partner, tài khoản qa.c1006a)
- 27 màn đầu (dashboard, inbody, inbody/entry, library + 5 mục con, messages, notifications, plans, plans/wizard, profile + edit/equipment/export/notification-prefs/pt-application/settings/wallet, roadmap + create + wizard, services): tải đúng, không có chữ lỗi.
- LỖI-6 (P2, mobile): Trang chủ KHÔNG cập nhật sau khi buổi tập hoàn thành — 01:25 và 01:37 (2 và 14 phút sau khi backend COMPLETED lúc 01:23) vẫn hiện "Hôm nay · Chan + Mong · Bắt đầu buổi tập", "0% · Tuần này 0/1 buổi đã hoàn thành"; chỉ sau khi tắt hẳn app mở lại mới đúng ("100% · 1/1", buổi kế Th 6 09/10). Nguyên nhân khả nghi (CODE AUDIT log.tsx): bài cuối xong bằng "Xong cả bài" → `refreshSession` chỉ nạp lại lịch hôm nay + workout; các query tuần/heatmap/dashboard chỉ được nạp lại trong `finish()` — mà khi buổi đã COMPLETED thì nút "Kết thúc buổi tập" biến mất nên `finish()` không bao giờ chạy.
- GHI NHẬN: Trang chủ ghi "Tuần này 1/1 buổi" còn tab Tập luyện ghi "Đã hoàn thành 1/2 buổi theo kế hoạch" — hai cách đếm khác nhau cho cùng một tuần.
- NGHI VẤN-7 (hiệu năng, mobile — KHÔNG tái hiện được, xem dòng cập nhật bên dưới): sau khi mở dồn ~27 màn bằng liên kết (các màn xếp chồng trong stack) rồi vào tab Dịch vụ, app ĐỨNG HÌNH ~6 phút (01:30→01:36): không nhận chạm, không nhận liên kết; luồng JS (mqt_v_js) chạy 80% CPU liên tục (đo `top -H` 3 lần cách 4s: 80.6/80.6/80.0%), sau đó tự hồi và xử lý dồn các thao tác đã xếp hàng. Mở app sạch: JS 0–25%, vào Dịch vụ JS 0–23% → không đứng hình. Danh sách PT chỉ 50 dòng/110 KB nên không phải do dữ liệu lớn. Người dùng thật ít khi mở dồn 27 màn, nhưng đây là dấu hiệu màn nằm dưới stack vẫn tiêu tốn JS; khớp phản ánh "ứng dụng lag" của partner.
- GHI NHẬN hiệu năng: RenderThread luôn 40–70% CPU ngay cả khi đứng yên ở Trang chủ (vòng sáng nhấp nháy của nút AI Coach vẽ lại mỗi khung hình) → tốn pin, có thể góp phần gây lag trên máy yếu.
- CẬP NHẬT NGHI VẤN-7 (01:50): thử lại có kiểm soát — mở app sạch, đẩy lần lượt 20 màn bằng liên kết rồi vào Dịch vụ và Đặt lịch, lấy mẫu CPU luồng JS sau mỗi màn: 8–41%, không lần nào treo; Dịch vụ 10–39%. Lần đứng hình 6 phút trùng lúc công cụ `uiautomator dump` của tại hạ chạy liên tục trên màn có hoạt ảnh (lệnh dump không trả kết quả ở cả 11 màn đó) → nhiều khả năng do công cụ đo gây ra, KHÔNG kết luận là lỗi app. Không tính vào danh sách lỗi.
- 12 màn còn lại (report-issue, stats/activity, workout/import, nutrition, nutrition/add, nutrition/goals, nutrition/monthly, programs, programs/new, templates, ai-coach, services/checkin): tải đúng, không lỗi (REAL DEVICE, ảnh sweep/pc2-*.png). Checkin hiện màn xin quyền camera đúng.
- LỖI-8 (P2, mobile): "Chương trình mới" (và màn PT giao giáo án — dùng chung PlanDraftBuilder) điền sẵn ngày bắt đầu 2026-10-06 trong khi máy đang là 01:47 ngày 07/10 — `todayIso = new Date().toISOString().slice(0,10)` lấy ngày theo UTC nên từ 00:00–06:59 giờ VN luôn ra NGÀY HÔM QUA (CODE AUDIT src/features/pt/PlanDraftBuilder.tsx:24 + REAL DEVICE).
- GHI NHẬN (P2 UX, mobile): "Mục tiêu dinh dưỡng" dùng 3 mức cố định cho mọi người (Giảm mỡ 2.000 / Duy trì 2.400 / Tăng cơ 2.800, ghi "thâm hụt/thặng dư 400 kcal") — không tính theo cơ thể; người chọn mục tiêu TĂNG CƠ lúc onboarding lại thấy ô "Giảm mỡ" đang được tick (vì mục tiêu mặc định backend = 2.000 kcal).

#### P6 — Dinh dưỡng (REAL DEVICE + REAL HTTP/API, qa.c1006a)
- Thêm món: tìm "trung" → "Egg, whole, baked…" → 150g → xem trước 278 kcal / 17.4P / 1.4C / 22.5F (đúng 185×1,5) → "Thêm vào bữa sáng" → backend có bản ghi 278 kcal breakfast — ĐẠT phần ghi. Bàn phím số bật: nút "Thêm vào bữa sáng" nằm trên bàn phím, thanh tab ẩn — ĐẠT.
- LỖI-9 (P1, ranh giới ngày — backend dinh dưỡng + mobile): ghi món lúc 01:51 ngày 07/10 (giờ VN) → màn Dinh dưỡng vẫn "Hôm nay chưa ghi món nào", 0/2.000 kcal; món vừa ghi hiện ở cột HÔM QUA của biểu đồ 7 ngày. Xác nhận API: `GET /nutrition?startDate=2026-10-07&endDate=2026-10-07` → `[]`; `…=2026-10-06` → có bản ghi (date lưu 2026-10-06T18:51Z). Nguyên nhân (CODE AUDIT): app không gửi `date` khi ghi (server lấy giờ hiện tại UTC) và backend lọc `new Date("YYYY-MM-DD")` = nửa đêm UTC → mọi món ghi từ 00:00 đến 06:59 giờ VN rơi vào hôm trước. Ảnh hưởng: người ăn khuya/dậy sớm thấy nhật ký trống, tổng calo sai ngày.
- GHI NHẬN (dữ liệu, partner): thư viện 13.000+ món toàn tên tiếng Anh (USDA). Tìm "phở"/"pho" → ra "Archway Home Style Cookies, Peanut Butter", "Bread, cheese"… (không liên quan); "cơm" → Rice (đúng), "trung" → Egg (đúng). Người Việt khó tìm món Việt.
- Mục tiêu dinh dưỡng: chọn "Tăng cơ" → macro tự co giãn 2800 kcal / 212P / 282C / 92F → Lưu → backend NutritionGoal ACTIVE 2800/212/282/92, triggeredBy MANUAL, goalMode RECOMMENDED — ĐẠT (REAL DEVICE + REAL HTTP/API). GHI NHẬN (khoa học thể hình): 212 g đạm cho người 72 kg ≈ 2,9 g/kg (do co giãn tỉ lệ từ mặc định) và được gắn nhãn RECOMMENDED dù không tính theo cơ thể.

#### P7 — InBody (REAL DEVICE + REAL HTTP/API, qa.c1006a)
- Nhập tay: cân nặng 72.5, khối cơ 33.2, % mỡ 18.5 (gợi ý "Tương đương 13.4 kg mỡ"), chiều cao 175 → Lưu → backend có phiếu 2026-10-07 status manual, weight 72.5, bodyFatPct 18.5, bodyFat 13.4, muscleMass 33.2, height 175 — ĐẠT. Ngày đo đúng 07/10 (không bị lệch UTC).
- Kiểm tra nhập sai: % mỡ = 175 → viền đỏ + "Tỉ lệ mỡ phải trong khoảng 1–99 %" — ĐẠT.
- Tổng quan: 4 thẻ chỉ số, "Cân bằng cơ thể" BMI 23.7 Bình thường (đúng 72.5/1.75²), ghi rõ "Chưa đánh giá được % mỡ — cần giới tính trong hồ sơ" (hệ quả LỖI-4, xử lý mềm tốt). So sánh: "Cần ít nhất hai lần đo". Lịch sử: 1 dòng "Mới nhất · Nhập tay" — ĐẠT.
- GHI NHẬN: backend trả `bmi: null` cho phiếu nhập tay dù có cân nặng + chiều cao (app tự tính để hiển thị).

#### P8 — Lộ trình (REAL DEVICE + REAL HTTP/API, qa.c1006a, AI thật)
- Thuật sĩ "Tạo lộ trình cùng Gymini": B1 tự điền cân nặng 72.5 và "18.5% (từ InBody) — dữ liệu đo thật, ưu tiên hơn ước lượng"; nhập chiều cao 175, tuổi 24, Nam. B2 chọn Vận động nhẹ + 8.000 bước → BMR 1.704 kcal (đúng Mifflin-St Jeor: 10×72,5+6,25×175−5×24+5 = 1.703,75). B3 Tăng cơ, mục tiêu 75 kg, 24 tuần. B4 chẩn đoán: 72.5→75 kg, mỡ 18.5%, FFMI 19.6 (đúng), TDEE 2.343 (=1.704×1,375) — ĐẠT.
- Câu chữ mới (commit 8c1fe1c) hiển thị đúng trên backend partner: "Bạn chưa đặt tỷ lệ mỡ mục tiêu nên Gymini chưa so sánh chi tiết — lộ trình dựa trên mục tiêu bạn đã chọn." — ĐẠT.
- LỖI-10 (P1, AI thật — backend): bản nháp lộ trình bằng AI KHÔNG BAO GIỜ kịp trên máy partner. App chờ ~95 s ("Gymini đang soạn lộ trình… có thể mất tới 2 phút") rồi nhận bản dự phòng "Gymini chưa cá nhân hoá được lộ trình bằng AI lúc này…". Gọi thẳng `POST /fitness-roadmaps/ai-draft` (REAL HTTP/API): trả 200 sau đúng 90,3 s, reasoningSummary "Không kết nối được AI service", confidence 0, 1 giai đoạn. Nguyên nhân (CODE AUDIT fitness-service/src/clients/ai.client.ts:338): fitness-service chờ ai-service tối đa `ROADMAP_DRAFT_TIMEOUT_MS` = 90 s, trong khi model qwen3:4b cần lâu hơn (giáo án mất 317 s). Tăng timeout cũng không đủ vì tunnel Cloudflare cắt ở ~100 s và app chờ tối đa 120 s → cần chuyển sang chạy nền (job + hỏi tiến độ) như sinh giáo án.
- GHI NHẬN: yêu cầu 24 tuần nhưng bản dự phòng chỉ có 1 giai đoạn 6 tuần (kết thúc 18/11/2026), ~2.624 kcal/ngày (thặng dư ~12%), 123P/369C/73F — khác mục tiêu dinh dưỡng đang ACTIVE (2.800 kcal / 212P) vừa lưu ở màn Dinh dưỡng → hai con số calo cùng lúc cho một người.
- "Bắt đầu lộ trình" → màn Lộ trình: "Đang thực hiện · Bắt đầu 07/10/2026 · AI đề xuất", giai đoạn hiện tại, chu kỳ 1; backend roadmap ACTIVE, phase ACTIVE, TrainingCycle ACTIVE — ĐẠT (REAL DEVICE + REAL HTTP/API).
- LỖI-11 (P2, ranh giới ngày — backend fitness): chu kỳ tạo lúc 02:02 ngày 07/10 giờ VN được lưu `startDate: 2026-10-06T00:00:00Z` (dù `timezoneAtStart: Asia/Ho_Chi_Minh`) → cùng một màn hiện "Bắt đầu 07/10/2026" (lộ trình) và "Bắt đầu chu kỳ 06/10/2026" (chu kỳ). Cùng họ với LỖI-8, LỖI-9 (lấy ngày theo UTC).
- GHI NHẬN: nhãn "AI đề xuất" hiện trên lộ trình dù đây là bản DỰ PHÒNG (AI không trả lời) — `createdByRole: AI`.
- "Tạo lịch tập bằng AI" (thẻ "Chu kỳ mới đã sẵn sàng — Lịch tập cho chu kỳ mới chưa được tạo") chỉ đưa sang màn Kế hoạch tập, nơi giáo án AI cũ đang "Đang áp dụng" (24 buổi đã lên lịch nhưng không gắn chu kỳ) → người dùng không biết bước tiếp theo là gì (GHI NHẬN UX; 24 buổi cũ có `trainingCycleId: null`).
- CHẤT LƯỢNG GIÁO ÁN (AI/partner, an toàn): ngày 3 của NGƯỜI MỚI có "Muscle Up", "Handstand Push-Ups".

#### P9 — Hồ sơ (REAL DEVICE + REAL HTTP/API, qa.c1006a)
- Chỉnh sửa hồ sơ: ngày sinh 2002-03-15, Nam, chiều cao 175 → Lưu → backend dateOfBirth 2002-03-15, age 24, gender MALE, heightCm 175 — ĐẠT.
- GHI NHẬN (UX, liên quan LỖI-4): tuổi/giới tính/chiều cao đã nhập ở thuật sĩ Lộ trình KHÔNG được lưu về hồ sơ (hồ sơ vẫn trống cho tới khi sửa tay ở đây); "Mục tiêu: Chưa đặt" dù lộ trình đã có mục tiêu 75 kg.
- Đổi ảnh đại diện: bấm nút máy ảnh → trình chọn ảnh hệ thống → chọn ảnh thử → màn cắt ảnh → "CẮT" → backend `photoUrl: /uploads/profile-photos/e300133c…` và tệp tải về qua tunnel là PNG 320×320 đúng ảnh thử — ĐẠT phần tải lên.
- LỖI-12 (P2, mobile): ảnh đại diện tải lên xong KHÔNG hiển thị — vòng tròn trống màu nền ở cả "Chỉnh sửa hồ sơ" và tab "Cá nhân" (đo điểm ảnh: (24,24,27) thay vì màu ảnh (40,160,90)); chữ viết tắt "QH" cũng mất. Nguyên nhân (CODE AUDIT src/components/ui/Avatar.tsx): đưa thẳng đường dẫn tương đối `/uploads/profile-photos/…` cho expo-image, không ghép địa chỉ máy chủ, và không quay về chữ viết tắt khi ảnh lỗi. Ảnh hưởng mọi nơi dùng Avatar với ảnh lưu trên đĩa backend (danh sách PT, chat…). Phụ: backend phục vụ tệp không đuôi với `Content-Type: application/octet-stream`.

#### P10 — Đổi tài khoản / cách ly dữ liệu (REAL DEVICE)
- Đăng xuất qa.c1006a → đăng nhập qa.c1006b (chưa onboarding): vào màn onboarding; bấm "Bỏ qua" → Trang chủ trống đúng (0 ngày, "Chưa có buổi nào được lên lịch", 0/2.000 kcal mặc định).
- 5 màn có dữ liệu riêng (Kế hoạch, InBody, Lộ trình, Dinh dưỡng, Cá nhân): KHÔNG còn dấu vết nào của tài khoản trước (không giáo án AI, không phiếu InBody, không lộ trình, mục tiêu về 2.000 chứ không phải 2.800 của A, tên "QA Hoc Vien Hai", 0 buổi) — ĐẠT.

#### P11 — Ứng tuyển PT (REAL DEVICE + REAL HTTP/API, qa.c1006b)
- 8 bước trên máy: thông tin cá nhân (SĐT, CCCD, địa chỉ, tỉnh/phường qua bảng chọn có tìm kiếm) → 3 ảnh xác thực (chọn từ thư viện, hiện "Xoá tệp" sau khi tải) → kinh nghiệm → chứng chỉ NASM-CPT (ngày cấp 2023-05-10, hết hạn 2027-05-10, kèm ảnh) → chuyên môn → dịch vụ Online 200.000 ₫/buổi, gói 1.800.000 ₫, 60 phút, khung giờ T2/T4/T5 → portfolio (bỏ trống) → xem lại (đủ "✓ Đã tải lên") → 4 cam kết → "Nộp đơn" → màn "Trạng thái đơn ứng tuyển · Đã nộp · Nộp ngày 07/10/2026" — ĐẠT. Backend: status SUBMITTED, chứng chỉ lưu đúng 2 ngày (bản sửa f591670 chạy đúng trên máy thật + backend partner).
- Nháp tự lưu: thoát giữa chừng rồi mở lại vẫn còn dữ liệu bước 1 — ĐẠT.
- GHI NHẬN nhỏ: sau khi chọn Tỉnh/Thành trong bảng chọn, bàn phím vẫn mở che nửa dưới màn hình; khung giờ mới mặc định 08:00–09:00 (chỉ 1 tiếng).
- Duyệt đơn trên WEB admin (REAL BROWSER, web local → backend partner): /admin/pts thấy "QA Hoc Vien Hai · Submitted"; chi tiết hiện đúng dữ liệu nhập từ máy (SĐT, chuyên môn, lịch T2/T4/T5, giá 200.000 ₫ / gói 1.800.000 ₫); "View Documents" hiện đủ 3 ảnh CCCD/chân dung tải từ điện thoại; "Approve" → `POST /pt-applications/admin/…/review/APPROVE` 200, hộp thoại "Action completed successfully."; backend: đơn APPROVED, đăng nhập lại role = PT — ĐẠT (liên thông mobile → web → backend).
- GHI NHẬN (web): trang Quản lý PT của admin toàn tiếng Anh ("Trainer Applications", "Approve/Reject/Need Info/Investigate", alert "Action completed successfully.") trong khi phần còn lại tiếng Việt.
- LỖI-13 (P2, backend user-service): duyệt đơn PT KHÔNG gửi thông báo cho người nộp — `GET /notifications` của qa.c1006b trả rỗng, điện thoại không có push, trong khi màn trạng thái ghi "Bạn sẽ nhận thông báo khi có kết quả". CODE AUDIT pt_application.service.ts: chỉ có thông báo realtime cho admin lúc nộp, không có nhánh báo cho ứng viên khi duyệt/từ chối/yêu cầu bổ sung.
- Phía ứng viên sau khi được duyệt (REAL DEVICE): mở lại màn trạng thái và kéo để làm mới → vẫn "Đã nộp" (LỖI-14, P3 mobile: màn trạng thái đơn không tự cập nhật/không làm mới được, phải tắt hẳn app). Tắt mở app → vào thẳng "Không gian Huấn luyện viên · PT QA" và màn trạng thái hiện "Được duyệt — Chúc mừng, bạn đã là HLV!" + nút "Vào không gian Huấn luyện viên" — ĐẠT.

#### P12 — Không gian PT trên máy (REAL DEVICE, qa.c1006b vừa được duyệt)
- 10 màn PT (Tổng quan, Học viên, Lịch dạy, Ví, Hồ sơ, Hợp đồng, Gói dịch vụ, Duyệt giáo án, Dịch vụ 1-1, Hợp tác phòng gym): tải đúng với trạng thái trống hợp lý; Hồ sơ hiện mã giới thiệu, khung giờ rảnh T2/T4/T5 đúng như đơn; "Dịch vụ 1-1" không còn lỗi 403 với PT đã duyệt.
- LỖI-15 (P2 giao diện, mobile): màn "Gói dịch vụ" — nút "+ Thêm" bị đẩy ra mép phải, chỉ còn thấy "+ Th" (khung nút [997–1080] trên màn rộng 1080 px). Đây là nút duy nhất để tạo gói, mà không có gói thì khách không gửi được yêu cầu hợp đồng.
- Thêm gói: bảng nhập cao hơn màn hình, nút "Thêm gói" nằm dưới mép (phải cuộn trong bảng mới thấy — GHI NHẬN UX). Tạo "Goi QA 4 buoi" · Online · 4 buổi · 60 phút · 400.000 ₫ (hiện "Tương đương 100.000 ₫/buổi") → danh sách có gói "Đang bán"; backend có gói isActive — ĐẠT (REAL DEVICE + REAL HTTP/API).
- LỖI-16 (P1, tìm PT — backend user-service + mobile): PT vừa được duyệt gần như KHÔNG THỂ được khách tìm thấy. (a) Tìm theo tên: `GET /profile/pts?q=QA` / `q=Hai` → 0 kết quả dù PT tên "QA Hoc Vien Hai" — vì `UserProfile.firstName/lastName/…Normalized` của tài khoản này là null (tên chỉ nằm ở auth-service, được ghép lúc đọc), mà tìm kiếm lọc trên cột của UserProfile. (b) Duyệt danh sách: backend có 107 PT, mặc định trả 50; app không gửi `limit/page` và không có tải thêm → PT mới đứng thứ 51/107, không bao giờ hiện. (REAL HTTP/API + CODE AUDIT profile.repository.ts, ptDiscovery.ts `buildListParams`.)

#### P13 — Hợp đồng PT chéo vai trò: khách trên WEB ↔ PT trên ĐIỆN THOẠI (backend partner)
- WEB khách (REAL BROWSER, qa.c1006a): Dịch vụ → Lọc giá 200.000 → thẻ "QA Hoc Vien Hai · Đã xác minh" → tab "Giá gói" hiện đúng gói tạo từ điện thoại ("Goi QA 4 buoi · 4 buổi · 100.000 ₫/buổi · Online · 400.000 ₫") → "Yêu cầu huấn luyện" → lời nhắn → "Gửi yêu cầu" → `POST /contracts/request` 201 — ĐẠT.
- GHI NHẬN (web): danh sách PT có ~20 thẻ KHÔNG TÊN ("Chưa có đánh giá · Coaching online · 5 kinh nghiệm · từ 200.000 ₫ · Strength Training") — dữ liệu PT cũ thiếu tên; chữ "· 0 kinh nghiệm" thiếu đơn vị năm.
- PUSH (REAL DEVICE, FCM qua backend partner, app đang mở ở Tổng quan PT): ~3 giây sau khi khách gửi, điện thoại nhận thông báo hệ thống "Gymini — New coaching request received"; backend có bản ghi thông báo CONTRACT_REQUESTED link /pt/contracts — ĐẠT phần gửi/nhận push.
- LỖI-17 (P2, backend): nội dung thông báo bằng TIẾNG ANH ("New coaching request received").
- GHI NHẬN (P2 UX, mobile): bấm vào thông báo → app chỉ về Tổng quan PT (theo thiết kế pushRouting: PT luôn về trang chủ vai trò), và thẻ "Hợp đồng" ở Tổng quan vẫn ghi "Không có yêu cầu" (không tự cập nhật theo sự kiện); không gian PT cũng không có chuông/hộp thông báo.
- PT trên điện thoại (REAL DEVICE): màn Hợp đồng mở lại vẫn "Yêu cầu · 0" (LỖI-18, P2 mobile: danh sách hợp đồng/Tổng quan PT không tự nạp lại khi có sự kiện mới hoặc khi mở lại màn — phải kéo để làm mới); sau khi kéo: thẻ "QA Hoc Vien Mot · Bạn cần duyệt · Goi QA 4 buoi · 0/4 buổi · 400.000 ₫" → "Nhận" → chuyển sang "Đang chờ · 1 · Chờ học viên trả — Bạn đã nhận, học viên chưa thanh toán" — ĐẠT. Khách nhận thông báo CONTRACT_ACCEPTED (tiếng Anh: "Your coaching request was accepted! You can proceed to payment.", link `/client/schedule` — route này không tồn tại trên web).
- Khách trên ĐIỆN THOẠI thanh toán hợp đồng qua VNPay sandbox THẬT (REAL DEVICE + REAL HTTP/API, backend partner qua tunnel): Dịch vụ → Hợp đồng → thẻ "Goi QA 4 buoi · Chờ thanh toán" → "Thanh toán" → bảng chọn cổng (VNPay / ZaloPay / MoMo, hiện 400.000 ₫) → trang sandbox.vnpayment.vn mở trong tab Chrome → Thẻ nội địa → NCB → số thẻ thử, tên, ngày, điều khoản, OTP 123456 → "Thanh toán" → máy TỰ quay lại app, màn "Thanh toán thành công — Giao dịch của bạn đã được kích hoạt" + mã giao dịch + nút "Xem hợp đồng" (app vẫn sống trong lúc ở cổng) — ĐẠT. Backend: hợp đồng ACTIVE, paid=true, tiền tạm giữ 360.000 ₫ cho PT + 40.000 ₫ nền tảng (10%).
- Sau thanh toán: thẻ hợp đồng "Đang hiệu lực · 0/4 buổi · Dừng bây giờ được hoàn khoảng 360.000 ₫" (khớp backend) — ĐẠT.
- Đặt buổi (REAL DEVICE): "Buổi tập" → "Đặt buổi tập mới" → chọn ngày → khung giờ lấy đúng từ lịch rảnh của PT (T4: 08:00…21:00; T5: 08:00).
- LỖI-19 (P2, mobile + backend): app cho chọn các khung giờ HÔM NAY nhưng backend từ chối mọi buổi trong vòng 24 giờ — bấm "Đặt buổi tập" chỉ hiện thông báo tiếng Anh "Sessions must be booked at least 24 hours in advance" rồi biến mất, bảng vẫn mở. Cần ẩn các khung < 24 giờ và Việt hoá lỗi.
- Đặt T5 08/10 08:00 → backend có buổi REQUESTED, ONLINE, 2026-10-08T01:00Z (= 08:00 giờ VN) — ĐẠT.
- PT trên WEB (REAL BROWSER, qa.c1006b): /pt/schedule thấy yêu cầu "Oct 8 · 08:00 AM · Pending · Online" → "Confirm" → "Confirmed" (có "Đề xuất dời lịch", "Cancel"); backend: buổi CONFIRMED — ĐẠT (liên thông máy khách → web PT).
- GHI NHẬN (web PT): trang Lịch dạy toàn tiếng Anh ("My Schedule", "Manage your coaching sessions and availability", "Pending/Confirm/Decline", "ALL UPCOMING") và hiện học viên bằng mã "5057e2c8..." thay vì tên (cùng gốc với LỖI-16: tên không nằm trong UserProfile).

#### P14 — Trò chuyện / realtime (backend partner)
- LỖI-1 CÓ HẬU QUẢ THẬT TRÊN MÁY (REAL DEVICE): tab Trò chuyện hiện "Đang kết nối lại…" — socket gateway của app không nối được. App dùng `transports: ["websocket","polling"]` (CODE AUDIT src/realtime/socketClient.ts) nên thử WebSocket trước, mà WebSocket của /socket.io ở gateway đang hỏng (LỖI-1) và socket.io không tự hạ xuống polling → realtime (tin nhắn mới, cập nhật trực tiếp) không chạy trên điện thoại. Nâng LỖI-1 lên P1.
- LỖI-20 (P1 thiếu tính năng so với web, mobile): trên điện thoại KHÔNG có lối nào để khách mở cuộc trò chuyện với PT của mình — màn chi tiết PT chỉ có Giới thiệu / Gói dịch vụ / Đánh giá (web có nút "Nhắn tin"), thẻ hợp đồng chỉ có "Buổi tập" / "Chấm dứt hợp đồng"; `createDirectConversation` chỉ được gọi ở màn đơn dịch vụ 1-1 (CODE AUDIT). Tab Trò chuyện trống với lời nhắc "Kết nối với huấn luyện viên ở mục Dịch vụ để bắt đầu trò chuyện" nhưng mục Dịch vụ không có nút nhắn tin.
- Trò chuyện qua backend partner trong trạng thái socket hỏng: WEB PT gõ tin + Enter → ô nhập bị xoá nhưng KHÔNG có tin nào được lưu (không có POST, `lastMessage: null`) → LỖI-21 (P1, web): web gửi tin qua socket; khi socket chưa nối thì tin MẤT ÂM THẦM, không báo lỗi. Điện thoại có phương án dự phòng tốt hơn: tab Trò chuyện ghi "Tin nhắn mới sẽ hiện khi kết nối lại — danh sách vẫn tự làm mới mỗi 10 giây", ô nhập nằm trên bàn phím.
- CHÚ Ý TRUNG THỰC về LỖI-1: lỗi chỉ bị kích hoạt khi có MỘT yêu cầu HTTP thường (polling) tới /chat-socket.io; app web/mobile chỉ dùng websocket cho đường đó nên bình thường không tự kích hoạt. Nhiều khả năng chính lần dò kết nối của tại hạ đầu buổi (thử polling vào /chat-socket.io) đã đẩy gateway partner vào trạng thái hỏng này và nó giữ nguyên tới khi gateway khởi động lại. Lỗi vẫn là lỗi thật (bất kỳ ai gửi 1 GET không cần đăng nhập vào /chat-socket.io là làm hỏng realtime của toàn hệ thống), nhưng các hệ quả "Đang kết nối lại…"/"web mất tin" trong buổi này là do trạng thái đó.

#### SỰ CỐ HẠ TẦNG — 02:59 (07/10): tunnel của partner chết
- Từ 02:59:13 mọi yêu cầu tới https://locate-accommodate-every-stones.trycloudflare.com trả 530 "Cloudflare Tunnel error 1033" (cloudflared phía máy partner mất kết nối — nhiều khả năng máy partner ngủ/tắt lúc 3 giờ sáng). Theo dõi 90 giây vẫn 530. Từ đây các mục chưa test trên backend partner bị CHẶN cho tới khi tunnel sống lại.
- Trên điện thoại lúc server mất: bấm gửi tin → tin vẫn nằm nguyên trong ô nhập (không mất) — hành vi chấp nhận được.

### PHẦN B — Tiếp tục trên BACKEND CỦA LAPTOP NÀY (cùng mã 19afc12, không có AI) trong lúc tunnel partner chết
Điện thoại TECNO (bản release) trỏ sang tunnel của laptop này (https://ranging-probability-isp-von.trycloudflare.com), web local → http://localhost:3000. Gateway local được khởi động lại lúc 03:03 để xoá trạng thái LỖI-1.

#### B1 — Trò chuyện realtime 2 chiều (REAL DEVICE ↔ REAL BROWSER, backend laptop này)
- Đăng xuất khi server partner đã chết vẫn về được màn đăng nhập; đổi địa chỉ máy chủ sang tunnel mới → "ĐANG DÙNG" đổi đúng; đăng nhập testuser011.
- GHI NHẬN: sau khi đăng nhập tài khoản khác, app mở lại đúng màn "Cài đặt" (màn cuối của phiên trước) thay vì Trang chủ.
- Tab Tin nhắn KHÔNG còn "Đang kết nối lại…" (socket nối được khi gateway chưa dính LỖI-1).
- Web PT (pt@example.com) gửi "Chao Linh, PT day. Tin nhan realtime 1" lúc 03:09:17 → điện thoại hiện tin trong ≤ 6 giây, không cần làm mới. Điện thoại trả lời "Da nhan PT oi" lúc 03:09:53 → web PT thấy ngay khi đang mở hội thoại (không tải lại trang). — ĐẠT cả hai chiều.
- Cuộc trò chuyện được tạo bằng API `POST /chat/conversations/direct` (TEST FIXTURE) vì trên điện thoại không có nút mở chat với PT (LỖI-20).

#### B2 — Gọi thoại / gọi video điện thoại ↔ web (REAL DEVICE ↔ REAL BROWSER headless, media giả phía web; backend laptop này qua tunnel)
- Âm lượng máy được hạ về 0 trước khi thử (đang 3 giờ sáng); phía web dùng camera/mic GIẢ của Chromium, không bật webcam thật.
- Điện thoại → web, GỌI THOẠI: bấm biểu tượng gọi trong hội thoại → hộp xin quyền ghi âm → cho phép → web tự nghe máy → `call:connected` sau ~19 s kể từ lúc bấm (gồm cả thời gian trả lời hộp quyền); web nhận âm thanh liên tục 32 s; điện thoại hiện tên + đồng hồ 00:01 → 00:45, nút tắt mic + gác máy — ĐẠT. Khi trình duyệt web đóng đột ngột, điện thoại tự thoát màn gọi về hội thoại trong < 1 phút; hội thoại ghi "Cuộc gọi thoại đã kết thúc (0:47)" — ĐẠT.
- Web → điện thoại, GỌI VIDEO (app đang mở): lớp phủ "Professional Trainer — Đang gọi video cho bạn… · Từ chối / Nghe máy" → Nghe máy → xin quyền camera → cho phép → kết nối; web nhận hình từ điện thoại (360×640 → 540×960, thời gian chạy đều) trong ~20 s — ĐẠT.
- GHI NHẬN: màn gọi thoại trên máy không có nút bật loa ngoài.

#### B3 — Phòng gym & gói hội viên (REAL DEVICE, backend laptop này qua tunnel)
- Chi tiết phòng gym (Gymini Phú Nhuận): giới thiệu, thư viện ảnh (ảnh ký tạm tải được qua tunnel, nút ‹ ›, ảnh nhỏ, 1/2), địa chỉ + chỉ dẫn, điện thoại/email, 4 liên kết mạng xã hội, tiện ích, "Vị trí chi nhánh" + "Chỉ đường", danh sách gói, ô mã giới thiệu, nút "Mua gói hội viên" khoá tới khi chọn gói, phần đánh giá — hiển thị đủ. GHI NHẬN: khung bản đồ chỉ thấy ghim trên nền tối, không thấy ô nền bản đồ lúc chụp (cần xem lại trên máy thật).
- Mua gói (gym thử E2E, 500.000 ₫) — nhánh ĐÓNG TAB GIỮA CHỪNG: chọn gói → "Mua gói hội viên" → bảng chọn cổng → VNPay → bấm X đóng tab → app hiện "Đang chờ xác nhận — Cổng thanh toán chưa xác nhận xong…" + mã giao dịch + "Kiểm tra lại" / "Về Dịch vụ"; tab Hội viên có thẻ "Chờ thanh toán" với "Thanh toán" / "Huỷ yêu cầu" — ĐẠT.
- Nhánh APP BỊ TẮT HẲN khi đang ở cổng: bấm "Thanh toán" lại → sang VNPay → `am force-stop` app (xác nhận không còn tiến trình) → trả tiền xong trên sandbox (NCB, OTP) → hệ thống tự mở lại app từ đầu vào thẳng màn "Thanh toán thành công — Giao dịch của bạn đã được kích hoạt" + "Xem gói hội viên" → tab Hội viên: "Đang hiệu lực · 500.000 ₫ · 30 ngày · Còn 30 ngày" + "Quét mã check-in" / "Huỷ gói hội viên" / "Báo cáo vấn đề" — ĐẠT.
- Báo cáo vấn đề phòng gym (từ thẻ hội viên): chọn "Thiết bị hư hỏng", mô tả, đính 1 ảnh (1/5) → "Gửi báo cáo" → tab "Báo cáo của tôi" có dòng "Thiết bị hư hỏng · Mới gửi · 7/10/2026" — ĐẠT (REAL DEVICE).
- Đánh giá phòng gym (chỉ hội viên): 4 sao + nhận xét → "Gửi đánh giá" → "★ 4.0 · 1 đánh giá", chuyển thành "Chỉnh sửa đánh giá của bạn" với "Cập nhật"/"Xoá" — ĐẠT (REAL DEVICE).
- Huỷ gói hội viên: hộp xác nhận "Gói còn 30/30 ngày. Bạn sẽ không được hoàn lại tiền của phần thời gian chưa dùng." → "XÁC NHẬN HUỶ" → thẻ chuyển "Đã huỷ" — ĐẠT về luồng. GHI NHẬN (chính sách): huỷ ngay sau khi mua, chưa dùng ngày nào, vẫn mất trọn 500.000 ₫ — cần Ngài + partner chốt chính sách hoàn tiền (việc này đang treo từ trước).
- Quét mã check-in: KHÔNG THỬ ĐƯỢC tự động (cần người cầm máy chĩa camera vào mã QR).

#### B4 — Đối tác phòng gym tự đăng ký (REAL DEVICE, backend laptop này; bật cờ dev `PARTNER_APPLICATION_DEV_ECHO=true` cho auth-service theo đúng hướng dẫn trong compose)
- Đăng nhập → "Trở thành đối tác phòng gym" → nhập email đã là tài khoản khách → thông báo đỏ "Email này đã được dùng cho một tài khoản Gymini khác. Hãy dùng email khác cho hồ sơ đối tác, hoặc liên hệ hỗ trợ." (API 409 EMAIL_IN_USE) — ĐẠT. GHI NHẬN: thông báo 2 dòng tự tắt sau ~3 giây, hơi nhanh để đọc.
- Email mới qa.gym1007@example.com → màn "Đã gửi liên kết" (môi trường dev hiện luôn liên kết) → "Tôi đã có liên kết" → dán riêng mã → "Xác minh xong cho …" → đặt mật khẩu → "Tạo tài khoản" → tài khoản GYM_OWNER được tạo — ĐẠT.
- GHI NHẬN (UX): ngay sau khi tạo tài khoản, app hiện màn trung gian "Tài khoản của bạn chưa gắn với hồ sơ đối tác nào. Mở hồ sơ để bắt đầu khai." — phải bấm "Mở hồ sơ" thì hồ sơ đối tác mới được tạo ở gym-service (DB: bản ghi partner tạo sau tài khoản 33 giây). Người dùng mới dễ tưởng là lỗi.
- Thuật sĩ hồ sơ: B1 người đại diện (tên, SĐT, vai trò qua bảng chọn) → B2 thương hiệu → B3 mạng xã hội (bỏ qua) → B4 quy mô (Một chi nhánh) → B5 chi nhánh đầu → B6 vị trí (tỉnh/phường) — lưu từng bước, % hoàn thành tăng dần — ĐẠT.
- LỖI-23 (P1, mobile, máy thật): bản đồ KHÔNG hiện ô nền trên TECNO (bản release, mạng 4G) — cả ở "Vị trí chi nhánh" của chi tiết phòng gym lẫn bảng "Ghim vị trí chi nhánh": chỉ có nền tối + nút +/− + dòng Leaflet/OpenStreetMap; tra địa chỉ tự động cũng báo "Không tra được bản đồ lúc này — bạn vẫn ghim tay được". Hệ quả: chủ gym phải ghim vị trí MÙ (chạm giữa màn ra toạ độ 16.47, 108.18 — giữa nước). Thư viện Leaflet tải được (có nút và ghim), riêng ô bản đồ từ tile.openstreetmap.org và tra cứu địa chỉ thì không. Từ laptop cùng địa chỉ ô bản đồ trả 200 → cần điều tra trên máy (nhà mạng / chính sách OSM với WebView / CSP).
- B7 ảnh cơ sở (chọn khu "Mặt tiền", tải 1 ảnh → "đã có 1", có "Ảnh bìa"/"Xoá ảnh") → B8 xác minh doanh nghiệp (tên pháp lý + 3 giấy tờ bắt buộc, mỗi loại hiện "Chờ duyệt" sau khi tải, có "Thêm tệp") → B9 xem lại — ĐẠT phần tải lên từ máy thật (lưu trên MinIO qua tunnel).
- LỖI-24 (P2, mobile): ở B5 ô "Điện thoại chi nhánh (tuỳ chọn)" ghi là tuỳ chọn, nhưng B9 chặn gửi với "Còn 1 mục cần hoàn thiện: Chưa nhập số điện thoại chi nhánh". Chạm vào dòng đó thì nhảy đúng về B5 (tốt). Cần đổi nhãn hoặc bỏ điều kiện.
- GHI NHẬN: % hoàn thành tụt từ 63% xuống 50% ngay sau khi lưu B5 (do xuất hiện thêm mục vị trí).
- Gửi hồ sơ: tick điều khoản → "Gửi hồ sơ" → màn "Hồ sơ đang được xét duyệt … hồ sơ khoá lại" + Tiến trình lấy từ nhật ký (3 lần "Bạn đã tải giấy tờ lên", "Bạn đã gửi hồ sơ 03:43:11 7/10/2026") — ĐẠT.

#### B5 — Quản trị viên trên điện thoại (REAL DEVICE, backend laptop này)
- Đăng nhập admin → 11 màn (Tổng quan, Người dùng, Đơn ứng tuyển HLV, Duyệt hồ sơ đối tác, Duyệt, Chi nhánh phòng gym, Kế hoạch trên chợ, Đối tác, Xử lý, Rút tiền, Tài chính): tải đúng, có dữ liệu thật, không lỗi. Tổng quan báo "1 hồ sơ đối tác chờ duyệt"; "Duyệt hồ sơ đối tác" có "QA Gym 1007 · Chờ duyệt · Hôm nay" (hồ sơ vừa gửi từ chính máy này).
- GHI NHẬN (cùng họ lỗi ngày UTC): biểu đồ Tài chính xếp giao dịch mua gói lúc 03:22 ngày 07/10 vào cột "06-10".
- Duyệt hồ sơ đối tác trên điện thoại (admin): chi tiết hiện đủ người đại diện/pháp lý/thương hiệu/chi nhánh/ảnh; "Xem tệp 1" mở giấy tờ trong Chrome (ảnh hiển thị đúng); "Chấp nhận giấy tờ" ×3 → cả ba "Đã xác minh"; "Duyệt hồ sơ" → hộp "Đối tác sẽ được kích hoạt và chi nhánh đầu tiên được duyệt cùng lúc. Không hoàn tác được." → DUYỆT → DB: partner ACTIVE + VERIFIED, chi nhánh "QA Gym Quan 3" APPROVED — ĐẠT (REAL DEVICE + truy vấn DB chỉ đọc).
- GHI NHẬN: "Xem tệp" mở bằng trình duyệt Chrome chính của máy (để lại lịch sử/tab với đường dẫn ký tạm) thay vì xem trong app.

#### B6 — Chủ phòng gym sau khi được duyệt (REAL DEVICE, backend laptop này)
- Đăng nhập qa.gym1007 → vào thẳng "Thiết lập tài khoản đối tác · Bước 3/4 · Thông tin nhận tiền" (điều hướng theo trạng thái hồ sơ) → nhập ngân hàng/số TK/chủ TK → "Tiếp tục" → Tổng quan chủ gym (ví chi nhánh 0 ₫, hội viên, check-in, gói đang bán, biểu đồ 7 ngày) — ĐẠT.
- 7 màn chủ gym (Tổng quan, Phòng gym, Gói hội viên, Người quản lý, Ví, Hợp tác huấn luyện viên, Hồ sơ): tải đúng. Phòng gym: thương hiệu "QA Gym 1007", chi nhánh "QA Gym Quan 3 · Đã duyệt · Đang mở cửa".
- Tạo gói hội viên: "Goi thang QA 350" 350.000 ₫ / 30 ngày → "Đang bán"; "Ngừng bán" → "Mở bán lại" hoạt động — ĐẠT. GHI NHẬN: backend nhận cả gói giá 30 ₫ (do tại hạ gõ nhầm ô) — không có giá tối thiểu, trong khi cổng thanh toán có mức tối thiểu.
- Mã QR check-in của chi nhánh: hiện mã, "Mã dùng được đến 07/10/2027", "Phóng to" / "Lưu ảnh để in" / "Tạo lại mã", danh sách check-in gần đây — ĐẠT hiển thị.
- "Thêm chi nhánh": hộp ghi rõ "Chi nhánh này sẽ thuộc thương hiệu QA Gym 1007", KHÔNG có ô chọn thương hiệu — đúng bất biến 1 chủ = 1 thương hiệu (không tạo thêm vì cần ghim bản đồ — LỖI-23).
- Quên mật khẩu: email sai định dạng → thông báo "Email không hợp lệ" — ĐẠT. KHÔNG gửi thử liên kết thật (tránh phát thư thật từ hộp thư của Ngài tới địa chỉ thử).

#### B7 — Cài đặt, thông báo, xuất dữ liệu (REAL DEVICE, backend laptop này, testuser011)
- Cài đặt (đổi tên, đổi mật khẩu, đăng xuất, mục Dinh dưỡng), Cài đặt thông báo (5 công tắc), Xuất dữ liệu, Thông báo, Ví: tải đúng. Danh sách thông báo trong app hiển thị tiếng Việt theo loại sự kiện ("Hợp đồng PT — Huấn luyện viên đã chấp nhận hợp đồng của bạn") → LỖI-17 chỉ ảnh hưởng nội dung PUSH hệ thống (lấy nguyên câu tiếng Anh từ server), không ảnh hưởng danh sách trong app.
- Xuất JSON: "Tải xuống" → bảng chia sẻ của hệ thống với tệp `fitness-assistant-export-2026-10-06.json` — ĐẠT (GHI NHẬN: tên tệp ghi ngày 06/10 trong khi máy là 07/10 — ngày theo UTC).
- Cài đặt thông báo: tắt "Phản hồi từ PT" → backend `ptFeedbackEnabled:false`; bật lại → true — ĐẠT (REAL DEVICE + REAL HTTP/API).
- Trang chi tiết thư viện (bài tập, thực phẩm, bài kiến thức) + Chợ kế hoạch: mở được, đủ ảnh/nội dung; mục "Nguồn" của bài tập hiện "free_exercise_db" (không còn [object Object]). GHI NHẬN: còn lộ nhãn nội bộ/tiếng Anh ("bodyweight", "Kiểu chuyển động: MOBILITY", thẻ "sr_legacy" ở thực phẩm; hướng dẫn bài tập bằng tiếng Anh).

#### B8 — PT với học viên thật (REAL DEVICE, backend laptop này, pt@example.com)
- Học viên → John Doe: thẻ đầu (trạng thái, "Nhắn tin", "Lịch dạy", "Giao kế hoạch") + 4 tab Tổng quan (hợp đồng, lộ trình "chỉ học viên mới đổi được giai đoạn") / Tập luyện (chu kỳ, tuân thủ 0% có cảnh báo, cảm nhận, buổi tập) / Dinh dưỡng (mục tiêu 2000 kcal · 150g đạm "Người dùng tự đặt", "Đề xuất diet break") / Tiến độ (InBody 31/08/2026: 71.3 kg, mỡ 16.4%, cơ 35.2 kg) — tải đúng dữ liệu thật — ĐẠT.
- "Giao kế hoạch": mở trình soạn (tên, mục tiêu, số tuần, ngày bắt đầu, "Gợi ý bằng AI", các buổi) — ngày bắt đầu điền sẵn 2026-10-06 lúc máy là 04:02 ngày 07/10 → xác nhận LỖI-8 ở phía PT.
- Bổ sung LỖI-20: nút "Nhắn tin" ở trang học viên của PT chỉ mở DANH SÁCH tin nhắn (`router.push("/client/messages")`), không tạo/mở hội thoại với học viên đó → nếu chưa từng có hội thoại thì cả PT lẫn khách đều không bắt đầu được cuộc trò chuyện từ điện thoại (trên backend partner, hợp đồng ACTIVE xong danh sách hội thoại vẫn rỗng).
