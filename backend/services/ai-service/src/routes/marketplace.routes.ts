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

// Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — versioning + adopt
router.post("/plans/:id/republish", marketplaceController.republish);
router.get("/plans/:id/versions", marketplaceController.getVersionHistory);
router.post("/plans/:id/adopt", marketplaceController.adopt);
router.post("/plans/:id/improvement-suggestions", marketplaceController.generateImprovementSuggestions);
router.get("/plans/:id/improvement-suggestions", marketplaceController.listImprovementSuggestions);

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.get("/packages/mine", marketplaceController.listMyPackages);
router.get("/packages/purchases/mine", marketplaceController.listMyPurchases);
router.get("/packages", marketplaceController.browsePackages);
router.post("/packages", marketplaceController.createPackage);
router.post("/packages/:id/archive", marketplaceController.archivePackage);
router.post("/packages/:id/purchase", marketplaceController.purchasePackage);

export default router;
