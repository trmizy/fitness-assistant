import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { ptServicePackageController } from "../controllers/pt_service_package.controller";

const router = Router();

// PT's own package management — authenticated
router.get("/", authMiddleware, ptServicePackageController.getMyPackages as any);
router.post("/", authMiddleware, ptServicePackageController.createPackage as any);
router.patch("/:id", authMiddleware, ptServicePackageController.updatePackage as any);
router.delete("/:id", authMiddleware, ptServicePackageController.archivePackage as any);

export default router;
