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

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.get("/packages/mine", marketplaceController.listMyPackages);
router.get("/packages/purchases/mine", marketplaceController.listMyPurchases);
router.get("/packages", marketplaceController.browsePackages);
router.post("/packages", marketplaceController.createPackage);
router.post("/packages/:id/archive", marketplaceController.archivePackage);
router.post("/packages/:id/purchase", marketplaceController.purchasePackage);

export default router;
