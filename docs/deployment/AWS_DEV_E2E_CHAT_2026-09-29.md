# AWS DEV E2E — Chat (REST + Socket.IO)

**Phạm vi:** Phase 4. Không gửi tin nhắn thật, không tạo conversation mới, không đổi `desiredCount` ECS, không đổi `VITE_ENABLE_CHAT`/`VITE_ENABLE_CHAT_WS`, không tạo TLS listener mới.

## 1. Trạng thái hạ tầng (VERIFIED_INFRA) — BLOCKED cho toàn bộ live test

| Hạng mục | Kết quả |
|---|---|
| ECS service `fitness-assistant-dev-chat-service` | `status: ACTIVE`, **`desiredCount: 0`, `runningCount: 0`** |
| Thời điểm scale về 0 | 2026-09-29T16:48:38+07 (theo `describe-services` events + CloudTrail `UpdateService` cùng timestamp, caller = IAM user `vmimport-admin`, **cùng identity dùng cho session audit này** — nhiều khả năng là một lần chạy trước đó của script sleep/wake, **không phải hành động của tôi trong phiên audit hiện tại**, và **đã xảy ra từ hôm qua**, không phải do tôi vừa test) |
| Target Group `fitness-assistant-dev-chat-tg` | 0 target đăng ký (rỗng) |
| ALB `fitness-assistant-dev-chat-alb` | `state: active`, nhưng trả **503 Service Temporarily Unavailable** cho mọi request (không có target phía sau) |
| API Gateway `GET /chat/{proxy+}` → ALB (HTTP_PROXY) | Proxy hoạt động đúng, nhưng nhận 503 từ ALB vì lý do trên |

**Kết luận:** Chat REST và Chat Socket.IO **BLOCKED hoàn toàn cho live E2E** vì không có task ECS nào đang chạy. Theo hard safety rule của audit này, **không được tự ý sửa `desiredCount`** — chỉ ghi nhận và báo cáo.

| Test ID | Endpoint | Expected | Actual | Evidence Type | Status |
|---|---|---|---|---|---|
| C01 | GET {chat-alb}/health | 200 | 503 (không có target) | VERIFIED_HTTP | BLOCKED |
| C02 | GET /chat/health (qua API Gateway) | 200 | 503 | VERIFIED_HTTP | BLOCKED |
| C03 | Socket.IO handshake tới chat ALB | Kết nối thành công | Không thể — ALB không có target | VERIFIED_INFRA | BLOCKED |

## 2. Route REST thật (VERIFIED_SOURCE — không thể test live do BLOCKED ở trên)

`backend/services/chat-service/src/app.ts`: `app.use("/chat", chatRoutes)`, `app.use("/chat/calls", callRoutes)`. API Gateway integration URI `http://...chat-alb.../chat/{proxy}` khớp 1:1 với path gốc `/chat/...` mà client gọi — không có double-prefix bug.

## 3. Socket.IO — 2 kênh riêng biệt, không được nhầm lẫn (VERIFIED_SOURCE, kế thừa từ audit trước)

- **Gateway's own Socket.IO** (`realtime/socketClient.ts`, biến `VITE_SOCKET_URL`) — dùng cho `chat:message:new` push (tin nhắn realtime), điều khiển bởi `VITE_ENABLE_REALTIME`.
- **Chat-service's own Socket.IO** (`services/socket.ts`, biến `VITE_CHAT_WS_URL`) — dùng **CHỈ** cho WebRTC call signaling (`call:*` events), điều khiển bởi `isChatWsEnabled()` trong `frontend/web/src/app/config/serverUrl.ts:110-114`, tiêu thụ tại `CallContext.tsx:193`.

## 4. Flag pair `VITE_ENABLE_CHAT=false` / `VITE_ENABLE_CHAT_WS=true` — xác nhận có tác động thật (VERIFIED_SOURCE)

`frontend/web/.env.production`:
```
VITE_ENABLE_REALTIME=false
VITE_ENABLE_CHAT=false
VITE_ENABLE_CHAT_WS=true
VITE_CHAT_WS_URL=http://fitness-assistant-dev-chat-alb-1556383256.ap-southeast-1.elb.amazonaws.com
```

`isChatWsEnabled()` (serverUrl.ts:110-114) đọc `VITE_ENABLE_CHAT_WS` **trước**, chỉ fallback về `VITE_ENABLE_CHAT` nếu biến kia không được set. Vì `VITE_ENABLE_CHAT_WS` được set tường minh = `true`, hàm này **luôn trả về `true`**, bất kể `VITE_ENABLE_CHAT=false`.

**Kết quả thực tế:** `VITE_ENABLE_CHAT=false` chỉ ẩn UI/route của tính năng Chat (danh sách hội thoại, tin nhắn) khỏi người dùng — **nhưng `CallContext.tsx` vẫn cố mở kết nối Socket.IO tới chat ALB ở mọi trang** (vì `CallContext` là context toàn app, dùng để nhận thông báo cuộc gọi đến). Đây không phải lý thuyết — đây là hệ quả trực tiếp, xác nhận qua đọc code, của việc set 2 flag mâu thuẫn nhau.

## 5. Mixed-content — điều kiện thật, đã kiểm chứng cả 2 phía (VERIFIED_INFRA + VERIFIED_SOURCE)

`aws elbv2 describe-listeners` trên `fitness-assistant-dev-chat-alb`: **chỉ có 1 listener, port 80, protocol HTTP. Không có listener HTTPS/443 nào.**

**Quan trọng — đã kiểm tra lại phía frontend, không giả định:** `aws cloudfront list-distributions` → **rỗng, không có CloudFront distribution nào trong account**. `aws route53 list-hosted-zones` → không có hosted zone nào cho domain của app (chỉ có 2 zone OpenSearch không liên quan). Bucket frontend (`fitness-assistant-frontend-dev-191798898985`) có `get-bucket-website` config (`IndexDocument`/`ErrorDocument` đều là `index.html` — cấu hình chuẩn cho SPA routing) — **cấu hình này chỉ có hiệu lực qua S3 website-hosting endpoint (`*.s3-website-<region>.amazonaws.com`), và endpoint đó CHỈ hỗ trợ HTTP, không hỗ trợ HTTPS.** Endpoint REST S3 (`*.s3.<region>.amazonaws.com`) có HTTPS nhưng **không áp dụng ErrorDocument fallback** nên client-side routing (refresh ở route con như `/workouts`) sẽ vỡ nếu dùng endpoint này.

**Kết luận 2 vế, không đơn giản là "confirmed bug":**
1. **Nếu người dùng thật đang truy cập qua S3 website-hosting endpoint (HTTP)** — đây là cách duy nhất SPA routing hoạt động đúng hiện tại — thì **không có mixed-content** với `VITE_CHAT_WS_URL=http://...` (cả hai đều HTTP), Socket.IO call-signaling có thể kết nối được **về mặt protocol** (vẫn phụ thuộc BUG-C1 ECS đang 0).
2. **Nếu sau này thêm CloudFront/custom domain (HTTPS)** — bước gần như bắt buộc cho một sản phẩm thật ra production — thì `VITE_CHAT_WS_URL=http://` và ALB chỉ-HTTP sẽ **ngay lập tức gây mixed-content**, chặn hoàn toàn WebRTC call signaling. Đây là **rủi ro kiến trúc thật, chưa xảy ra hôm nay nhưng sẽ xảy ra ngay khi hạ tầng frontend được nâng cấp lên HTTPS** nếu không sửa đồng thời ALB + biến này.
- **Không tìm thấy bằng chứng frontend hiện tại được phục vụ qua HTTPS thật (không có CloudFront, không có Route53, không có custom domain)** — do đó tôi **rút lại** kết luận "mixed-content đang xảy ra ngay bây giờ" và thay bằng kết luận chính xác hơn ở trên. Đây là một điều chỉnh minh bạch so với suy luận ban đầu của tôi trong quá trình audit.

### BUG-C1 (P1) — Chat ECS bị scale về 0, chưa được khôi phục (không do audit này gây ra)
- Root cause category: Infrastructure (vận hành/cost-control) — không phải lỗi code.
- Đề xuất: xác nhận với chủ sở hữu account xem đây là chủ đích (cost-saving) hay bị bỏ quên; nếu cần Chat hoạt động cho demo/test, cần lệnh `update-service --desired-count 1` (không tự thực hiện — nằm ngoài phạm vi read-only audit).

### BUG-C2 (P2 hiện tại / sẽ thành P1 khi thêm HTTPS cho frontend) — ALB Chat chỉ có HTTP, không có đường nâng cấp an toàn lên HTTPS
- Root cause category: Infrastructure (thiếu HTTPS listener trên ALB, thiếu CloudFront/custom domain cho toàn bộ frontend).
- Hiện tại **chưa gây lỗi sống** vì frontend cũng đang chỉ chạy HTTP (S3 website endpoint) — nhưng đây là một "time bomb" kiến trúc: bất kỳ ai thêm CloudFront/HTTPS cho frontend mà quên đổi đồng thời ALB + `VITE_CHAT_WS_URL` sẽ làm WebRTC call signaling chết âm thầm (không lỗi rõ ràng, chỉ là kết nối bị trình duyệt chặn im lặng).
- Đề xuất: khi lên kế hoạch thêm HTTPS cho frontend (CloudFront/custom domain), phải làm đồng thời: thêm HTTPS listener (cần ACM certificate) cho `fitness-assistant-dev-chat-alb`, đổi `VITE_CHAT_WS_URL` sang `wss://`. Đây là thay đổi networking/chứng chỉ, cần approval riêng.

### BUG-C3 (P2) — Flag pair `VITE_ENABLE_CHAT`/`VITE_ENABLE_CHAT_WS` gây kết nối "mồ côi"
- Ngay cả sau khi fix BUG-C1/C2, cấu hình hiện tại vẫn khiến app mở kết nối Socket.IO nền cho một tính năng (Chat) đã bị ẩn khỏi UI — lãng phí kết nối, có thể gây log lỗi console cho mọi user dù họ không dùng Chat.
- Đề xuất: làm rõ ý định sản phẩm — nếu Chat thật sự đang tắt, nên set cả `VITE_ENABLE_CHAT_WS=false`; nếu WebRTC call signaling cần hoạt động độc lập với Chat UI, nên tách thành 2 flag rõ nghĩa hơn (đã tồn tại, chỉ cần set đúng giá trị).

## Tổng kết Phase 4

| Hạng mục | Kết quả |
|---|---|
| Chat REST live E2E | BLOCKED (ECS desiredCount=0) |
| Chat Socket.IO live E2E | BLOCKED (cùng lý do) |
| Root cause hạ tầng | Xác nhận đầy đủ qua VERIFIED_INFRA (ECS, CloudTrail, ALB listener) |
| Bug thật tìm được (không cần chạy được Chat mới thấy) | BUG-C1 (ECS=0, P1), BUG-C2 (HTTP-only ALB, rủi ro kiến trúc, P2 hiện tại), BUG-C3 (flag mâu thuẫn, P2) |
| Cần làm trước khi test lại Chat | Khôi phục ECS desiredCount (quyết định của chủ account); nếu/khi thêm HTTPS cho frontend, phải làm đồng thời HTTPS listener cho ALB |
