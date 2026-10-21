# Checklist cho người vận hành — QR trên điện thoại thật & kiểm kê thông báo cũ

Hai việc dưới đây Claude không tự làm được trong phiên (cần thiết bị thật / quyền DB thật). Trạng thái hiện tại: **REAL DEVICE NOT VERIFIED**, **LEGACY INVENTORY NOT RUN**.

## A. Smoke test QR check-in của PT trên điện thoại Android thật

Đã đạt trên Android emulator với camera ảo (5 tình huống, 22/10/2026). Phần dưới chỉ để xác nhận trên máy thật.

Chuẩn bị
- Bản app release (APK) trỏ tới môi trường test/staging — không dùng môi trường tiền thật.
- Một chi nhánh X có buổi PT **trực tiếp đã xác nhận hôm nay** cho tài khoản PT test; một chi nhánh Y cùng thương hiệu không có buổi; một tài khoản PT không có buổi hôm nay.
- Mã QR chi nhánh lấy từ trang chủ gym (`Check-in` của chi nhánh), in ra giấy hoặc mở trên màn hình khác.

| # | Bước | Kết quả đúng | Đạt? |
|---|---|---|---|
| 1 | Mở màn quét QR lần đầu | App xin quyền camera một lần; từ chối → có hướng dẫn mở lại quyền, không treo | |
| 2 | Cho quyền, quét QR chi nhánh X (PT có buổi) | Thẻ "Đã check-in" + tên chi nhánh + giờ | |
| 3 | Quét lại X ngay | Vẫn báo đã check-in, không lỗi, không tạo thêm lượt riêng | |
| 4 | Quét QR chi nhánh Y | "Hôm nay bạn không có buổi dạy đã xác nhận tại chi nhánh này." | |
| 5 | Đăng nhập PT không có buổi, quét X | Thông báo như bước 4 | |
| 6 | Quét một QR bất kỳ không phải của Gymini (ví dụ QR link web) | Không gửi yêu cầu, không báo lỗi lạ | |
| 7 | Quét ảnh QR bị sửa (nếu có bản mẫu) | "Mã QR không hợp lệ hoặc đã hết hạn." | |
| 8 | Thoát màn quét → vào lại; khóa máy → mở lại | Camera bật lại bình thường, không màn đen, không crash | |
| 9 | Ánh sáng yếu / QR nghiêng ~30° | Vẫn quét được trong vài giây | |

Ghi lại: model máy, phiên bản Android, bản app, giờ chạy, ảnh chụp bước 2/4/7. Bên quản trị kiểm trang `PT check-in` của chi nhánh X thấy đúng 1 dòng cho PT đó trong ngày.

## B. Chạy kiểm kê thông báo cũ "hoàn tiền + buổi không bị trừ"

Script: `backend/services/user-service/src/scripts/legacy-refund-notice-inventory.ts` (chỉ đọc, mọi truy vấn trong `READ ONLY` transaction, chỉ in số tổng hợp, không in id/tên/nội dung).

1. Dùng **bản sao hoặc replica** của DB user-service và payment-service, với **tài khoản chỉ đọc** (role chỉ có `SELECT`). Không chạy trên DB đang phục vụ khách nếu có bản sao.
2. Trên máy có mã nguồn (thư mục `backend/services/user-service`), đặt hai biến môi trường trong phiên shell (không ghi vào tệp, không dán vào chat):
   - `USER_DATABASE_URL` — chuỗi kết nối DB user-service (bản sao)
   - `PAYMENT_DATABASE_URL` — chuỗi kết nối DB payment-service (bản sao)
3. Chạy: `npx tsx src/scripts/legacy-refund-notice-inventory.ts --confirm-read-only`
   - Thiếu cờ → script từ chối (thoát mã 2). Script chỉ in tên DB, không in chuỗi kết nối.
4. Gửi lại cho Claude **chỉ phần số liệu in ra** (số thông báo, buổi còn/mất, đã trừ buổi hay chưa, đã trả, còn thiếu, các nhóm "lời hứa khác kết quả").
5. Nếu chưa có môi trường thật nào từng chạy bản cũ: ghi "không kiểm kê được" — **không** coi là 0.

Không sửa số buổi, bút toán hay gửi thông báo đính chính trước khi chủ dự án quyết theo từng nhóm.
