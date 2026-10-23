-- Hạn thanh toán 12 giờ kể từ lúc hợp đồng vào PENDING_PAYMENT (PT chấp nhận / ký xong /
-- admin bỏ qua e-sign). Quá hạn mà chưa trả thì contract-expiry-sweep tự huỷ.
ALTER TABLE "contracts" ADD COLUMN "payment_due_at" TIMESTAMP(3);

-- Hợp đồng ĐANG ở PENDING_PAYMENT lúc migration chạy: cho đủ 12 giờ kể từ bây giờ, để không
-- ai bị huỷ ngay lúc bản này ra mắt (không có mốc "PT chấp nhận lúc nào" đáng tin để tính ngược).
UPDATE "contracts"
SET "payment_due_at" = now() + interval '12 hours'
WHERE "status" = 'PENDING_PAYMENT' AND "payment_due_at" IS NULL;
