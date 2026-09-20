-- GYM_PARTNER_SELF_ONBOARDING_SPEC.md — mỗi lần admin xem một giấy tờ pháp lý của hồ sơ tự đăng ký
-- phải để lại dấu vết (giấy tờ là dữ liệu nhạy cảm; xem mà không ghi nhật ký thì là một cửa hậu,
-- cùng lập luận với VIEWED_AS_PARTNER). Giá trị enum cộng thêm — không đụng dữ liệu cũ.
ALTER TYPE "PartnerAuditAction" ADD VALUE 'DOCUMENT_VIEWED';
