import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { exerciseController } from "../controllers/exercise.controller";
import { exerciseReviewController } from "../controllers/exercise-review.controller";
import { catalogQualityController } from "../controllers/catalog-quality.controller";

const router = Router();

router.get("/", exerciseController.listExercises);
router.get("/filter-options", exerciseController.getFilterOptions);
// Gate 6 — must be registered BEFORE "/:id" or Express would treat
// "muscles" as an :id value.
router.get("/muscles", exerciseController.listMuscles);
// Roadmap P1.5 "Custom exercises" — named routes, must stay before "/:id"
// for the same reason as /muscles above.
router.post("/custom", authMiddleware, exerciseController.createCustom as any);
router.get("/custom", authMiddleware, exerciseController.listMyCustom as any);
router.delete("/custom/:id", authMiddleware, exerciseController.archiveCustom as any);
// Gate 7 — human review queue for duplicate/variant candidates. Also
// registered before "/:id" for the same reason (":externalRef" would
// otherwise be swallowed as an exercise id). Every handler enforces
// ADMIN role itself (see exercise-review.controller.ts's requireAdmin).
router.get("/admin/review/summary", authMiddleware, exerciseReviewController.getSummary as any);
router.get("/admin/review", authMiddleware, exerciseReviewController.listCandidates as any);
router.get("/admin/review/:externalRef/history", authMiddleware, exerciseReviewController.getHistory as any);
router.get("/admin/review/:externalRef", authMiddleware, exerciseReviewController.getCandidateDetail as any);
router.post("/admin/review/:externalRef/decision", authMiddleware, exerciseReviewController.submitDecision as any);
// Roadmap P1.8 "Logging-mode catalog discoverability" — read-only quality
// matrix (loggingMode/publicationStatus/equipment/muscles/media-license/
// reviewStatus) so a publish decision is never made blind. Registered
// before "/:id" for the same reason as the routes above.
router.get("/admin/catalog-quality-matrix", authMiddleware, catalogQualityController.getMatrix as any);
router.get("/:id/substitute", authMiddleware, exerciseController.getSubstitute as any);
router.get("/:id/muscle-map", exerciseController.getMuscleMap);
router.get("/:id", exerciseController.getExercise);
// BUG-027: admin can create exercises (admin role enforced inside controller).
router.post("/", authMiddleware, exerciseController.create as any);

export default router;
