-- Giữ lại một phần thu nhập đầu tiên của PT trên mỗi hợp đồng (holdback). Chỉ thêm cột.
--
-- pt_holdback_rate: tỷ lệ holdback chụp lúc tạo hợp đồng (0 = không giữ lại). Mọi hợp đồng đang
-- có nhận 0 từ giá trị mặc định — quy tắc này KHÔNG áp ngược; nó chỉ có hiệu lực với hợp đồng mới
-- khi resolvePtHoldbackRate() trả về giá trị > 0 (hiện luôn trả 0).
-- holdback_released_at: thời điểm khoản giữ lại được trả cho PT vì hợp đồng không có buổi tập nào
-- trong PT_HOLDBACK_IDLE_DAYS ngày (NULL = chưa trả / không áp dụng).
ALTER TABLE "contracts" ADD COLUMN "pt_holdback_rate" DECIMAL(6,4) NOT NULL DEFAULT 0;
ALTER TABLE "contracts" ADD COLUMN "holdback_released_at" TIMESTAMP(3);
