import { Router } from "express";
import { memoryController } from "../controllers/memory.controller";

const router = Router();

// Mounted under /ai/memories by ai.routes.ts — inherits requireAuth from there.
router.get("/", memoryController.list);
router.delete("/:memoryId", memoryController.remove);

export default router;
