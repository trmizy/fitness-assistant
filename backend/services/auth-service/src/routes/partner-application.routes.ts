import { Router } from "express";
import { partnerApplicationController } from "../controllers/partner-application.controller";

// Công khai, không cần đăng nhập (mounted dưới /auth/partner-applications). Giới hạn tần suất:
// theo email ở DB (partnerApplicationService.start), theo IP ở gateway — xem
// GYM_PARTNER_SECURITY_MODEL.md §5. Cố ý KHÔNG dùng createEmailActionRateLimit (in-memory).
const router = Router();

router.post("/start", partnerApplicationController.start);
router.post("/verify", partnerApplicationController.verify);
router.post("/set-password", partnerApplicationController.setPassword);

export default router;
