import { Router } from "express";
import { trainingLocationController } from "../controllers/training_location.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";

const router = Router();

// All routes require auth
router.use(authMiddleware);

// GET /pt/training-locations/me — PT only (view own locations)
router.get(
  "/me",
  roleMiddleware(["PT"]),
  trainingLocationController.getMyLocations,
);

// POST /pt/training-locations/me — PT approved only
router.post(
  "/me",
  roleMiddleware(["PT"]),
  trainingLocationController.createLocation,
);

// PATCH /pt/training-locations/me/:id — PT approved only
router.patch(
  "/me/:id",
  roleMiddleware(["PT"]),
  trainingLocationController.updateLocation,
);

// DELETE /pt/training-locations/me/:id — soft delete, PT only
router.delete(
  "/me/:id",
  roleMiddleware(["PT"]),
  trainingLocationController.deleteLocation,
);

export default router;
