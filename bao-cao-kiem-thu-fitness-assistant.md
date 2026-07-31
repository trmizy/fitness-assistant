# Báo cáo kiểm thử Fitness Assistant

**Ngày báo cáo:** 30/07/2026  
**Repository:** `trmizy/fitness-assistant`  
**Phạm vi:** Các chức năng ngoài `/client/workout`

## 1. Kết luận tổng quan

Hệ thống **chưa sẵn sàng để triển khai production**, chủ yếu do các lỗ hổng liên quan đến:

- Phân quyền và xác thực giữa các microservice.
- Tính toàn vẹn của luồng thanh toán.
- Bảo vệ giấy tờ định danh của PT.
- Kiểm soát quyền truy cập các API quản trị.
- Xác minh người tham gia trong WebRTC.
- Cấu hình an toàn cho webhook chữ ký điện tử.
- Thiếu test cho các module Payment, Gym và Chat.

Mức độ hoàn thiện tạm đánh giá cho các chức năng ngoài Workout: **40/100**.

Phần biên dịch và logic đơn vị hiện tại tương đối ổn, nhưng bảo mật và tính toàn vẹn tài chính vẫn ở mức rất thấp.

## 2. P0 — Lỗi nghiêm trọng

### 2.1. Có khả năng tạo số dư ví miễn phí

#### Hiện trạng

- Backend chấp nhận payment provider `MOCK`.
- Mock provider tự chuyển giao dịch sang trạng thái `PAID`.
- Webhook `MOCK` không kiểm tra chữ ký.
- Luồng webhook không xác nhận provider của sự kiện có trùng với provider của giao dịch hay không.

#### Rủi ro

Theo logic code hiện tại, một webhook mock có thể được dùng để hoàn tất giao dịch thuộc provider thật nếu kẻ tấn công biết được `providerTransactionId`.

Điều này có thể dẫn đến:

- Ghi nhận thanh toán giả.
- Tăng số dư ví không có tiền thật.
- Sai lệch lịch sử giao dịch.
- Thiệt hại tài chính và khó đối soát.

#### Yêu cầu sửa

- Không cho phép provider `MOCK` hoạt động ngoài môi trường test/development.
- Bắt buộc xác minh chữ ký webhook.
- Đối chiếu provider trong webhook với provider đã lưu trên giao dịch.
- Đảm bảo chuyển trạng thái thanh toán có tính idempotent.
- Ghi audit log cho mọi lần cập nhật trạng thái giao dịch.
- Thêm integration test cho webhook giả, webhook trùng và provider không khớp.

### 2.2. Giấy tờ định danh của PT được phục vụ công khai

#### Hiện trạng

Các tài liệu sau đang được lưu dưới `/uploads/pt-applications/...`:

- CCCD hoặc giấy tờ định danh mặt trước.
- CCCD hoặc giấy tờ định danh mặt sau.
- Ảnh chân dung.
- Chứng chỉ chuyên môn.

Toàn bộ `/uploads` đang được public qua user-service và gateway.

#### Rủi ro

Người không đăng nhập có thể tải tài liệu nếu biết hoặc đoán được URL, hoặc nếu URL xuất hiện trong log, lịch sử trình duyệt hay được chia sẻ ngoài ý muốn.

#### Yêu cầu sửa

- Không public thư mục chứa giấy tờ định danh.
- Chỉ phục vụ file qua endpoint có xác thực và kiểm tra quyền.
- Kiểm tra ownership và role trước khi trả file.
- Dùng URL ký có thời hạn nếu kiến trúc lưu trữ hỗ trợ.
- Không để tên file hoặc đường dẫn có thể đoán dễ dàng.
- Kiểm tra lại log để tránh ghi URL hoặc thông tin nhạy cảm.
- Thêm test truy cập khi chưa đăng nhập, sai người dùng và sai role.

### 2.3. API thống kê admin thiếu kiểm tra vai trò

#### Endpoint bị ảnh hưởng

- `/profile/admin/contracts/summary`
- `/profile/admin/stats`

#### Hiện trạng

Hai endpoint chỉ yêu cầu người dùng đã đăng nhập, nhưng không bắt buộc role `ADMIN`.

#### Rủi ro

Tài khoản Client hoặc role không phù hợp có thể truy cập số liệu quản trị tổng hợp.

#### Yêu cầu sửa

- Bắt buộc kiểm tra role `ADMIN` ở backend.
- Không chỉ dựa vào việc ẩn route hoặc nút trên frontend.
- Thêm test cho `CLIENT`, `PT`, `GYM_OWNER`, `ADMIN` và người chưa đăng nhập.

### 2.4. Có thể giả mạo danh tính khi gọi trực tiếp microservice

#### Hiện trạng

- Gym service và Payment service tin trực tiếp các header `x-user-id` và `x-user-role`.
- Các port nội bộ của microservice đang được publish ra ngoài.
- Khi thử gửi header giả với role `GYM_OWNER`, request đã vượt qua lớp auth/role và đi tới tầng database.

#### Rủi ro

Kẻ tấn công có thể bỏ qua gateway, tự đặt header danh tính và truy cập trực tiếp microservice.

#### Yêu cầu sửa

- Không publish các port microservice nội bộ ra Internet.
- Chỉ cho phép truy cập qua gateway hoặc mạng nội bộ được kiểm soát.
- Không tin header danh tính từ client.
- Dùng chữ ký nội bộ, service token hoặc cơ chế xác thực service-to-service phù hợp.
- Chặn hoặc loại bỏ các header giả từ request bên ngoài.
- Mỗi service vẫn phải kiểm tra authorization và ownership cho hành động nhạy cảm.
- Thêm test gọi trực tiếp service bằng header giả.

### 2.5. WebRTC cho phép người ngoài cuộc gọi gửi sự kiện

#### Sự kiện bị ảnh hưởng

- `call:ice_candidate`
- `call:media_toggle`

#### Hiện trạng

Server không xác minh người gửi có phải caller hoặc callee của `callSessionId` hay không.

#### Rủi ro

Một người dùng đã đăng nhập và biết `callSessionId` có thể gửi sự kiện làm ảnh hưởng đến cuộc gọi của người khác.

#### Yêu cầu sửa

- Xác minh người gửi thuộc cuộc gọi trước khi chuyển tiếp mọi sự kiện.
- Kiểm tra trạng thái phiên gọi.
- Không tin `userId` do client gửi nếu đã có danh tính từ socket/session.
- Thêm test cho người ngoài cuộc gọi, phiên gọi đã kết thúc và `callSessionId` không hợp lệ.

### 2.6. Webhook Dropbox Sign có thể fail-open

#### Hiện trạng

Khi thiếu `DROPBOX_SIGN_API_KEY`, code bỏ qua bước xác minh chữ ký.

#### Rủi ro

Nếu production bị cấu hình thiếu biến môi trường, webhook giả có thể được chấp nhận và làm thay đổi trạng thái chữ ký hoặc hợp đồng.

#### Yêu cầu sửa

- Production phải fail-closed khi thiếu API key hoặc secret.
- Từ chối webhook không xác minh được.
- Có kiểm tra cấu hình bắt buộc khi service khởi động.
- Ghi log cảnh báo an toàn nhưng không ghi secret.
- Thêm test cho thiếu key, chữ ký sai, payload bị sửa và sự kiện gửi lại.

## 3. P1 — Chức năng và phân quyền

### 3.1. Frontend không chặn route theo role

Frontend hiện chỉ kiểm tra người dùng đã đăng nhập, chưa kiểm tra role cho route.

Tài khoản Client có thể mở trực tiếp:

- `/admin/*`
- `/pt/*`
- `/gym-owner/*`

Backend có chặn một số API nhạy cảm, nhưng UI vẫn có thể:

- Hiển thị màn hình không thuộc quyền.
- Làm lộ metadata hoặc cấu trúc chức năng.
- Phát sinh hàng loạt lỗi `403`.
- Tạo trải nghiệm không nhất quán.

Frontend cần route guard theo role, nhưng backend vẫn phải là lớp thực thi quyền cuối cùng.

### 3.2. Payment API trực tiếp không yêu cầu xác thực

Khi truy cập trực tiếp Payment Service, các endpoint sau trả `200` mà không cần token:

- `/admin/payments`
- `/admin/payments/commissions`
- `/me/payments`

Đây là vấn đề đặc biệt nghiêm trọng khi port `3007` đang được publish.

### 3.3. Một số chức năng Payment chưa được triển khai

- Danh sách payment trả mảng rỗng hard-code.
- Danh sách commission trả mảng rỗng hard-code.
- API settle commission trả `501 NOT_IMPLEMENTED`.

UI không nên thể hiện các chức năng này như đã sẵn sàng nếu backend chưa triển khai.

### 3.4. Gym service có thể crash khi database lỗi

Một số async route chưa xử lý lỗi đầy đủ. Khi database lỗi, exception có thể thoát ra ngoài và làm process không ổn định hoặc crash.

### 3.5. WebSocket Chat không áp dụng cùng validation với REST

REST API giới hạn nội dung tin nhắn ở 5.000 ký tự, nhưng WebSocket chưa áp dụng giới hạn tương đương.

Mọi kênh ghi cùng một loại dữ liệu phải dùng chung validation.

### 3.6. Thiếu ma trận kiểm thử ownership và IDOR

Chưa có bộ test đầy đủ cho:

- Hợp đồng.
- Booking.
- Membership.
- Ví.
- Thanh toán.
- Chat.
- Hồ sơ PT.
- Tài liệu ký điện tử.

Cần kiểm tra ít nhất:

- Người dùng chưa đăng nhập.
- Đúng chủ sở hữu.
- Người dùng khác cùng role.
- Người dùng khác role.
- Admin.
- ID không tồn tại.
- ID hợp lệ nhưng không thuộc quyền.

### 3.7. Thiếu test ở các service rủi ro cao

- Payment service: chưa có test thực tế.
- Gym service: chưa có test thực tế.
- Chat service: chưa có test đáng kể cho socket và call.

## 4. P2 — Trải nghiệm và hiệu năng

### 4.1. Bundle frontend lớn

- JavaScript bundle: khoảng **1,82 MB**.
- Kích thước gzip: khoảng **467 KB**.

Các route đang được tải chung và chưa chia chunk hiệu quả.

### 4.2. Ảnh nền quá nặng

Ảnh nền gym có kích thước khoảng **6,33 MB**, ảnh hưởng đáng kể đến:

- Thời gian tải trên mobile.
- Dữ liệu di động.
- Largest Contentful Paint.
- Trải nghiệm trên thiết bị yếu hoặc mạng chậm.

### 4.3. Title trình duyệt chưa đúng

Title hiện tại vẫn là:

`Make interface mobile responsive`

Cần đổi sang tên chính thức của ứng dụng.

### 4.4. Ngôn ngữ chưa nhất quán

Wallet và một số màn hình còn trộn tiếng Anh với tiếng Việt.

### 4.5. Logout xóa quá nhiều dữ liệu

Logout đang dùng `localStorage.clear()`, làm mất cả:

- Theme.
- Ngôn ngữ.
- Tùy chọn giao diện.
- Dữ liệu cục bộ không liên quan đến phiên đăng nhập.

Chỉ nên xóa token và các key thuộc phiên đăng nhập.

### 4.6. Chưa chia tải route hiệu quả

Các route và module lớn nên được lazy-load theo khu vực quyền và chức năng để giảm tải ban đầu.

## 5. Kết quả kiểm thử tự động

| Phạm vi | Kết quả |
|---|---:|
| Gateway | 10/10 pass |
| Fitness service | 38 pass, 2 skip do thiếu test database |
| AI service | 140/140 pass |
| Frontend refresh-token | 4/4 pass |
| InBody validation | 10/10 pass |
| Build frontend và các service | Pass |
| **Tổng** | **202 pass, 2 skip** |

### Module chưa có test đầy đủ

- Payment.
- Gym.
- Chat socket/call.

Hai integration test cần database đã bị skip do môi trường kiểm thử hiện tại không có Docker/PostgreSQL.

## 6. Kết quả build và kiểm tra tĩnh

- Frontend compile thành công.
- Gateway compile thành công.
- Auth service compile thành công.
- User service compile thành công.
- Fitness service compile thành công.
- AI service compile thành công.
- Gym service compile thành công.
- Payment service compile thành công.

Build thành công không đồng nghĩa hệ thống đã an toàn hoặc sẵn sàng production. Các lỗi P0 nêu trên vẫn cần được xử lý trước khi triển khai.

## 7. Giới hạn của đợt kiểm thử

Chưa thể chạy full browser E2E vì:

- Môi trường hiện tại không có Docker.
- Không có PostgreSQL hoạt động cho toàn bộ microservice.
- Trình duyệt cloud không thể truy cập `localhost`.
- Chưa có URL staging/public phù hợp.

Do đó, các luồng sau chưa được kiểm tra đầy đủ trên giao diện thật:

- Booking.
- Hợp đồng.
- Membership.
- Wallet.
- Thanh toán.
- Chat.
- Cuộc gọi WebRTC.
- Phân quyền toàn bộ theo từng role.
- Reload, tab mới và đa thiết bị.
- Responsive trên mobile và desktop.
- Console và Network trong luồng E2E hoàn chỉnh.

## 8. Điều kiện cần để tiếp tục kiểm thử E2E

Cần một trong hai môi trường:

1. URL staging/public đã triển khai đầy đủ frontend, gateway, service và database; hoặc
2. Môi trường Docker Compose hoạt động, có PostgreSQL và có cách để browser kiểm thử truy cập được ứng dụng.

Cần chuẩn bị tài khoản test cho các role:

- Client.
- PT.
- Gym Owner.
- Admin.

Không dùng dữ liệu production hoặc giấy tờ định danh thật trong quá trình test.

## 9. Thứ tự ưu tiên khắc phục

### P0 — Sửa trước khi triển khai

1. Khóa luồng thanh toán mock và xác minh webhook.
2. Bảo vệ tài liệu định danh PT.
3. Bổ sung role check cho API admin.
4. Đóng port microservice và loại bỏ việc tin header từ client.
5. Xác minh participant cho mọi sự kiện WebRTC.
6. Chuyển Dropbox Sign webhook sang fail-closed.

### P1 — Hoàn thiện chức năng và tính toàn vẹn

1. Thêm route guard theo role ở frontend.
2. Thêm xác thực trực tiếp tại Payment service.
3. Triển khai thực tế payment history, commission và settlement.
4. Chuẩn hóa error handling ở Gym service.
5. Dùng chung validation cho REST và WebSocket Chat.
6. Bổ sung test ownership/IDOR.
7. Xây dựng test suite cho Payment, Gym và Chat.

### P2 — Tối ưu trải nghiệm

1. Chia route bundle và lazy-load.
2. Nén hoặc thay ảnh nền 6,33 MB.
3. Sửa title trình duyệt.
4. Đồng nhất ngôn ngữ.
5. Chỉ xóa key đăng nhập khi logout.
6. Chạy kiểm tra responsive và accessibility trên browser thật.

## 10. Tiêu chí sẵn sàng production

Không được đánh dấu hệ thống là sẵn sàng production nếu còn một trong các điều kiện sau:

- Provider mock có thể tạo giao dịch `PAID`.
- Webhook không xác minh chữ ký hoặc không đối chiếu provider.
- Tài liệu định danh PT còn truy cập công khai.
- API admin chưa kiểm tra role.
- Microservice còn tin header danh tính từ client.
- Port microservice nội bộ còn mở công khai.
- Người ngoài cuộc gọi có thể gửi sự kiện WebRTC.
- Webhook chữ ký điện tử fail-open.
- Payment API có thể truy cập khi chưa đăng nhập.
- Payment, Gym và Chat chưa có test cho luồng chính và phân quyền.
- Chưa có test ownership/IDOR.
- Chưa chạy full browser E2E trên staging hoặc môi trường tương đương production.

