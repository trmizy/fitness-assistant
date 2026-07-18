import { Router } from "express";
import { marketplaceController } from "../controllers/marketplace.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth);

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.get("/plans/mine", marketplaceController.listMine);
router.get("/plans", marketplaceController.browse);
router.post("/plans", marketplaceController.publish);
router.get("/plans/:id", marketplaceController.getDetail);
router.delete("/plans/:id", marketplaceController.withdraw);
router.post("/plans/:id/reviews", marketplaceController.submitReview);

export default router;
