import { Router } from "express";
import { marketplaceController } from "../controllers/marketplace.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth);

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.get("/plans/mine", marketplaceController.listMine);
router.post("/plans", marketplaceController.publish);
router.delete("/plans/:id", marketplaceController.withdraw);

export default router;
