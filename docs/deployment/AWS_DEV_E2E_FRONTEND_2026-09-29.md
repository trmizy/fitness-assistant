# AWS DEV E2E — Frontend Integration

**Phạm vi:** Phase 5. **Không có browser-testing tool nào được dùng trong phiên audit này** — mọi kết luận dưới đây là **VERIFIED_HTTP** (gọi trực tiếp bằng curl) hoặc **VERIFIED_SOURCE/VERIFIED_INFRA** (đọc code + AWS CLI), **không phải REAL BROWSER**. Ghi rõ minh bạch: đây là giới hạn thật của phiên audit, không phải Frontend E2E đầy đủ.

## 1. Hạ tầng phục vụ frontend (VERIFIED_INFRA)

- Bucket: `fitness-assistant-frontend-dev-191798898985`, public-read qua bucket policy (`s3:GetObject`, `Principal: *`).
- **Không có CloudFront distribution nào** trong account (`aws cloudfront list-distributions` rỗng).
- **Không có Route53 hosted zone** cho domain của app (chỉ có 2 zone OpenSearch không liên quan).
- Bucket có website-hosting config (`IndexDocument`/`ErrorDocument` = `index.html`, chuẩn SPA fallback) → cách truy cập đúng cho client-side routing là **S3 website endpoint, chỉ hỗ trợ HTTP**, không có HTTPS.
- Test trực tiếp: `http://<bucket>.s3-website-ap-southeast-1.amazonaws.com/` → 200. `https://<bucket>.s3.ap-southeast-1.amazonaws.com/index.html` → 200 (nhưng endpoint này không áp dụng SPA fallback cho route con).

### BUG-FE1 (P2) — Không có cách nào phục vụ frontend qua HTTPS với client-side routing hoạt động đúng trong cấu hình hiện tại
- Root cause category: Infrastructure (thiếu CloudFront/custom domain).
- Đây không chặn phát hành DEV nhưng là gap kiến trúc cần giải quyết trước khi ra production thật (không có HTTPS cho một app xử lý JWT/thanh toán là vấn đề bảo mật, không chỉ tiện dụng).

## 2. Đối chiếu cấu hình API base URL (VERIFIED_SOURCE + VERIFIED_HTTP)

`frontend/web/.env.production`:
```
VITE_API_URL=https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com
```
`apiBaseUrl()` (`serverUrl.ts:97-99`) dùng đúng biến này làm `axios.baseURL`. Đã verify **chính API Gateway ID này** (`id1iz7upbl`) là API Gateway thật đang chạy toàn bộ backend (dùng suốt audit này) → **cấu hình khớp 100%, không lệch endpoint**.

## 3. Test HTTP trực tiếp các luồng chính qua đúng base URL frontend dùng

| Test ID | Luồng | Endpoint thật | Evidence Type | Status |
|---|---|---|---|---|
| FE01 | Login | POST /auth/login | VERIFIED_HTTP | PASS (dùng lại kết quả Phase 2 — 200, token hợp lệ) |
| FE02 | Xem hồ sơ | GET /profile/me | VERIFIED_HTTP | PASS |
| FE03 | Exercise catalog | GET /exercises | VERIFIED_HTTP | PASS |
| FE04 | Gym/PT data | GET /gyms | VERIFIED_HTTP | PASS |
| FE05 | Membership/payment (read-only) | GET /me/payments/methods | VERIFIED_HTTP | PASS (các endpoint payment khác đang FAIL — xem báo cáo Fitness/Gym/Payment, BUG-P1) |
| FE06 | AI feature availability | GET /plans/llm-health | VERIFIED_HTTP | PASS |
| FE07 | Chat feature | GET /chat/health (qua gateway) | VERIFIED_HTTP | BLOCKED (Chat ECS = 0, xem báo cáo Chat) |

**Không dùng Playwright/browser thật** — do đó **không thể xác nhận**: React Router hoạt động đúng trên trình duyệt thật, CORS thực tế từ origin trình duyệt (chỉ test OPTIONS preflight thô, xem mục 4), lỗi console JS, trạng thái loading/error UI thật, hay layout responsive. Đây là giới hạn cần nêu rõ, không suy diễn "PASS" cho các phần này.

## 4. CORS (VERIFIED_HTTP, một phần)

`OPTIONS /exercises` với header `Origin` giả định trả về `200 OK` nhưng **không có bất kỳ header `Access-Control-*` nào trong response** khi test với origin tuỳ ý. Điều này khớp với comment đã thấy trong `user-service/src/app.ts:31-35`: *"No CORS middleware here on purpose... this service is only ever reached via the gateway's proxy"* — nghĩa là CORS được xử lý ở tầng API Gateway/auth-service, không phải mỗi service tự thêm header. **Không đủ thời gian trong audit này để xác nhận API Gateway có đúng CORS config cho origin thật của frontend** (S3 website endpoint domain) — cần test riêng bằng browser thật hoặc kiểm tra `apigatewayv2 get-api` CORS config, **để BLOCKED/NOT_TESTED chứ không giả định PASS**.

## 5. Feature flags ảnh hưởng frontend (VERIFIED_SOURCE, tổng hợp lại từ Phase 4)

| Flag | Giá trị | Tác động |
|---|---|---|
| `VITE_ENABLE_REALTIME` | false | Gateway Socket.IO (chat message push) tắt trên production |
| `VITE_ENABLE_CHAT` | false | Ẩn UI Chat |
| `VITE_ENABLE_CHAT_WS` | true | Vẫn mở kết nối Socket.IO nền cho WebRTC call signaling — xem BUG-C3 |

## Tổng kết Phase 5

| Hạng mục | Trạng thái | Evidence Type |
|---|---|---|
| API base URL config khớp backend thật | PASS | VERIFIED_SOURCE + VERIFIED_HTTP |
| Auth/profile/exercise/gym data qua đúng URL frontend dùng | PASS | VERIFIED_HTTP |
| Payment/Chat qua frontend | FAIL/BLOCKED (do bug đã ghi ở báo cáo khác, không phải do frontend) | VERIFIED_HTTP |
| React Router / console errors / responsive layout / CORS-từ-browser-thật | **NOT_TESTED — không có browser tool trong phiên này** | — |
| HTTPS cho frontend | Không tồn tại (BUG-FE1) | VERIFIED_INFRA |

**Không tuyên bố Frontend E2E hoàn tất** — chỉ hoàn tất phần đối chiếu cấu hình + HTTP trực tiếp. Phần trải nghiệm trình duyệt thật cần một phiên riêng có browser tool.
