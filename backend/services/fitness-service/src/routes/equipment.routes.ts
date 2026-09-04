import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { equipmentController } from "../controllers/equipment.controller";

const router = Router();

// Public catalog — browsing the list of known equipment needs no auth,
// matching /exercises' existing "public browse" convention.
router.get("/", equipmentController.getCatalog);

// A user may only ever read/write their OWN equipment — userId always comes
// from the authenticated request (req.user.id), never a client-supplied id.
router.get("/me", authMiddleware, equipmentController.getMyEquipment);
router.put("/me", authMiddleware, equipmentController.setMyEquipment);

export default router;
