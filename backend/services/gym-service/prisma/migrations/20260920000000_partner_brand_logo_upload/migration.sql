-- Logo thương hiệu của đối tác: tuỳ chọn, chủ gym tự thêm, không bắt buộc để nộp hồ sơ.
-- Cột GymBrand.logo_key đã có từ migration 20260919000000; ở đây chỉ mở thêm một loại tải lên.
ALTER TYPE "PartnerUploadKind" ADD VALUE 'LOGO';
