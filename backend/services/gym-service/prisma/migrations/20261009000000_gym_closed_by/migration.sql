-- Ai đã đóng cửa chi nhánh. `closed_at` + `closure_reason` đã có từ Vòng 4 / Phase C3 nhưng thiếu
-- NGƯỜI thực hiện: `owner_id` là chủ sở hữu của chi nhánh, còn người bấm có thể là một tài khoản
-- quản lý (MANAGER) của cùng đối tác — hai userId khác nhau. Lưu userId của tài khoản đang đăng nhập.
--
-- Viết tay, chỉ cộng thêm một cột nullable: dòng cũ để NULL (không suy ngược được ai đã đóng).
ALTER TABLE "gyms" ADD COLUMN "closed_by" TEXT;
