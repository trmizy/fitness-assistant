import { Router } from "express";
import { marketplaceController } from "../controllers/marketplace.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// Mounted under /admin/ai/marketplace — reuses the API gateway's existing
// ADMIN-only "/admin/ai" proxy gate, so no separate gateway route is needed.
router.use(requireAuth);

router.get("/plans", marketplaceController.listForModeration);
router.post("/plans/:id/review/:action", marketplaceController.reviewAction);

export default router;
