-- D15 — thêm hai vai trò nội bộ cố định (lễ tân, kế toán). Chỉ THÊM giá trị enum: không đổi dữ liệu cũ.
-- Giá trị mới chưa được dùng trong chính migration này (Postgres cấm dùng ngay trong cùng giao dịch);
-- CHECK constraint dùng chúng nằm ở migration kế tiếp.
ALTER TYPE "PartnerAccountRole" ADD VALUE IF NOT EXISTS 'RECEPTIONIST';
ALTER TYPE "PartnerAccountRole" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
