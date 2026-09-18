import { Router } from "express";
import { marketplaceController } from "../controllers/marketplace.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/requireRole.middleware";

const router = Router();

// Mounted under /admin/ai/marketplace — reuses the API gateway's existing
// ADMIN-only "/admin/ai" proxy gate, so no separate gateway route is needed.
// requireRole is defense-in-depth, not a replacement — see admin.routes.ts's
// identical comment (AWS deployment audit, section 17).
router.use(requireAuth);
router.use(requireRole(["ADMIN"]));

router.get("/plans", marketplaceController.listForModeration);
router.post("/plans/:id/review/:action", marketplaceController.reviewAction);

export default router;
