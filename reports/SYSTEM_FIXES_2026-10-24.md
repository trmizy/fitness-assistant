# Sửa các lỗi được tái hiện trong review — 24/10/2026

Phạm vi: bốn nhóm lỗi trong `SYSTEM_REVIEW_2026-10-23.md`. Công việc seed đã dừng theo yêu cầu; không sửa tiếp seed hoặc cấu hình tunnel. Không commit và không dùng tài khoản cá nhân để kiểm thử.

## Thay đổi

1. **Refresh của tài khoản A ghi đè tài khoản B (web/mobile).** Mỗi phiên có generation; login/logout thay generation, mọi refresh/request/response kiểm tra lại generation. Các ghi native storage được tuần tự hóa để ghi chậm của phiên A không chạy sau dữ liệu B. Refresh đang chạy được chia theo generation; finally của A không giải phóng refresh đang chạy của B. Bootstrap/resume và ghi cached user cũng tuân thủ kiểm tra này.
2. **Link reset mật khẩu bị dùng đồng thời nhiều lần.** `authRepository.consumePasswordReset` claim token với điều kiện chưa dùng/chưa hết hạn, đổi password và thu hồi refresh token trong cùng transaction. Chỉ một yêu cầu thắng. Nếu ghi password thất bại, claim cũng rollback; không vô hiệu hóa nhầm phiên cũ.
3. **Duyệt/từ chối/chi trả rút tiền ghi đè trạng thái đã thay đổi.** Mọi chuyển trạng thái đọc lại withdrawal sau khi lấy khóa ví. Từ chối yêu cầu đã duyệt trả tiền từ LOCKED về AVAILABLE và cập nhật REJECTED trong cùng transaction. markPaid dùng trạng thái mới đọc dưới khóa để chọn đúng bucket và không ghi đè REJECTED/PAID.
4. **Refresh 429 hoặc lỗi tạm thời bị coi là phiên bị thu hồi.** Chỉ 401/403 từ refresh mới được coi là thu hồi. 400/408/429/5xx, lỗi mạng và response thiếu token giữ phiên, báo lỗi tạm thời; không xóa token hoặc tự đăng xuất.

Luồng AI streaming dùng fetch riêng cũng được sửa: kiểm tra generation sau response, refresh và mỗi lần đọc chunk; callback của phiên cũ bị bỏ qua. Hủy stream không phát thông báo timeout sau khi màn hình đã đóng. Không retry request của A bằng token của B. Lỗi TypeScript thiếu import `cancelAnimation` và `useReducedMotion` trong Skeleton mobile được sửa bằng hai import, giữ nguyên logic giao diện hiện có.

## Kiểm chứng

**TEST FIXTURE:**

```powershell
node --import tsx --test scripts/testing/session-races.test.ts scripts/testing/stream-session-races.test.ts
```

38/38 pass. Harness chọn các hàm/interceptor/method thật từ source bằng TypeScript AST, chạy với HTTP/storage có thể trì hoãn. Bao gồm response đến muộn, đổi tài khoản khi refresh, ghi native chậm, phân loại lỗi refresh và stream riêng. Đây không phải bằng chứng thao tác trên trình duyệt hay thiết bị thật. Lệnh đã được nối vào `test:session` ở root, chạy trước recursive tests của CI.

**BACKEND INTEGRATION — PostgreSQL thật, DB riêng kết thúc bằng `_test`:**

- Auth: `gymcoach_auth_review_fix_test`, 3/3 pass: hai reset đồng thời chỉ một thắng; lỗi ghi rollback; token hết hạn giữa preflight và claim bị từ chối.
- Payment: `gymcoach_payment_review_fix_test`, 31/31 pass: 9 test concurrency/rollback bổ sung và 22 test withdrawal/locking/minimum hiện có. Test cố ý giữ thao tác thứ nhất trước khóa, cho thao tác thứ hai commit rồi mới chạy tiếp để tái hiện snapshot cũ; kiểm tra trạng thái, số dư và ledger thực tế.
- Không chạy các test này lên DB dev hoặc DB seed. Không xóa các DB của phiên khác.

Lệnh chạy trong thư mục từng service, `NODE_ENV=test`, `DATABASE_URL` trỏ DB tương ứng trên test Postgres localhost:55433:

```powershell
# backend/services/auth-service
node --import tsx --test src/__tests__/password-reset-concurrency.integration.test.ts
# backend/services/payment-service
node --import tsx --test --test-concurrency=1 src/__tests__/withdrawal-concurrency.integration.test.ts src/__tests__/withdrawal-locking.integration.test.ts src/__tests__/withdrawal.integration.test.ts src/__tests__/withdrawal-minimum.integration.test.ts
```

Auth, payment và mobile TypeScript `--noEmit`: PASS. Web production build bằng Vite: PASS (6.219 modules, khoảng 1 phút 53 giây); còn cảnh báo bundle lớn hơn 500 kB, không phải lỗi build. Web chưa có tsconfig riêng nên không coi build Vite là kiểm tra type toàn bộ web. `git diff --check` trên các file sửa: PASS. Tổng các test chạy lại cho bản sửa: 72/72 PASS.

## Giới hạn

Không khẳng định đã test toàn bộ hệ thống. Chưa chạy E2E đổi hai tài khoản trên thiết bị thật, chưa kiểm tra lại Gmail → Cloudflare → điện thoại. Test component mobile ở lượt trước bị chặn do thiếu `babel-preset-expo`; các test fixture phiên đăng nhập trên đây không phụ thuộc Jest/Babel. Script `system-review-reproductions.ts` là bằng chứng lịch sử trước bản sửa; assertions của nó yêu cầu lỗi cũ nên không dùng làm regression gate cho code mới.

Các thay đổi admin account guard và các thay đổi UI đồng thời của phiên khác được giữ nguyên; không nhận chúng là phần sửa của lượt này.
