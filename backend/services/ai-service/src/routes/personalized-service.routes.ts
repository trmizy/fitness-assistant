import { Router } from "express";
import { personalizedServiceController as c } from "../controllers/personalized-service.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth);

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
// (same convention as marketplace.routes.ts).
router.get("/services/mine", c.listMyServices);
router.get("/services", c.browseServices);
router.post("/services", c.createService);
router.get("/services/:id", c.getServiceDetail);
router.post("/services/:id/archive", c.archiveService);
router.post("/services/:id/purchase", c.purchaseService);
router.get("/services/seller/:sellerId/reviews", c.getSellerReviewSummary);

router.get("/orders/mine", c.listMyOrders);
router.get("/orders/selling", c.listOrdersForSeller);
router.get("/orders/refund-requests", c.listRefundRequests);
router.get("/orders/:id", c.getOrder);
router.post("/orders/:id/intake", c.submitIntake);
router.post("/orders/:id/start-review", c.startReview);
router.post("/orders/:id/draft", c.deliverDraft);
router.get("/orders/:id/versions", c.listPlanVersions);
router.post("/orders/:id/revision", c.requestRevision);
router.post("/orders/:id/start-revision", c.startRevisionWork);
router.post("/orders/:id/accept", c.acceptOrder);
router.post("/orders/:id/complete", c.completeOrder);
router.post("/orders/:id/cancel", c.cancelOrder);
router.post("/orders/:id/refund-request", c.requestRefund);
router.get("/orders/:id/refund-calculation", c.getRefundCalculation);
router.post("/orders/:id/refund-resolve", c.adminResolveRefund);
router.post("/orders/:id/dispute", c.openDispute);
router.post("/orders/:id/checkin", c.submitCheckIn);
router.get("/orders/:id/checkins", c.listCheckIns);
router.post("/orders/:id/review", c.submitReview);

export default router;
