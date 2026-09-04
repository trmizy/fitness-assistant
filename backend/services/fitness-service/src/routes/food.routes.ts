import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { foodController } from "../controllers/food.controller";

const router = Router();

router.get("/search", authMiddleware, foodController.search as any);
router.get("/filter-options", authMiddleware, foodController.filterOptions as any);
// Product Completeness pass — Food Library. "/search" is a literal path so
// it's unambiguous ahead of "/:id" here (unlike exercise.routes.ts's
// "/muscles", nothing named literally "search" can collide with a food id).
router.get("/", authMiddleware, foodController.list as any);
router.get("/:id", authMiddleware, foodController.getById as any);

export default router;
