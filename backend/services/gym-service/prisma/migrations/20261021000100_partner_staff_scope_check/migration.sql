-- D15 — bất biến phạm vi theo vai trò.
--   MANAGER, RECEPTIONIST : bắt buộc ít nhất một chi nhánh (không gán chi nhánh = đăng nhập được mà vô dụng).
--   ACCOUNTANT            : scoped_gym_ids rỗng = kế toán cả thương hiệu; có phần tử = chỉ các chi nhánh đó.
-- Thay đúng CHECK cũ (chỉ nói về MANAGER) bằng bản mở rộng; mọi dòng hiện có (OWNER/MANAGER) vẫn thoả.
ALTER TABLE "gym_partner_accounts" DROP CONSTRAINT IF EXISTS "gym_partner_accounts_manager_needs_scope";
ALTER TABLE "gym_partner_accounts" ADD CONSTRAINT "gym_partner_accounts_manager_needs_scope"
    CHECK ("role" NOT IN ('MANAGER', 'RECEPTIONIST') OR COALESCE(array_length("scoped_gym_ids", 1), 0) >= 1);
