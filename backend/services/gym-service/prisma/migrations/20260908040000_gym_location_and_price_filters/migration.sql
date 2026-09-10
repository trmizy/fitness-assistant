-- Trang tìm phòng gym: lọc theo tỉnh/thành phố (province/ward, denormalized từ
-- user-service — không FK xuyên service) + toạ độ (lat/lng, chủ gym tự lấy vị trí hiện
-- tại khi tạo/sửa chi nhánh, phục vụ sắp xếp gần nhất theo yêu cầu khách hàng).

ALTER TABLE "gyms" ADD COLUMN "province_code" INTEGER;
ALTER TABLE "gyms" ADD COLUMN "ward_code" INTEGER;
ALTER TABLE "gyms" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "gyms" ADD COLUMN "longitude" DOUBLE PRECISION;

CREATE INDEX "gyms_province_code_idx" ON "gyms"("province_code");
