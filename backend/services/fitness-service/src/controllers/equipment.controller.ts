import { Request, Response } from "express";
import { logger } from "@gym-coach/shared";
import { equipmentService } from "../services/equipment.service";
import type { AuthRequest } from "../middleware/auth.middleware";

export const equipmentController = {
  async getCatalog(_req: Request, res: Response): Promise<void> {
    try {
      const equipment = await equipmentService.getCatalog();
      res.json({ equipment });
    } catch (error: any) {
      logger.error({ message: error?.message }, "Error fetching equipment catalog");
      res.status(500).json({ error: "Failed to fetch equipment catalog" });
    }
  },

  async getMyEquipment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const equipmentIds = await equipmentService.getUserEquipment(userId);
      res.json({ equipmentIds });
    } catch (error: any) {
      logger.error({ message: error?.message }, "Error fetching user equipment");
      res.status(500).json({ error: "Failed to fetch your equipment" });
    }
  },

  async setMyEquipment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { equipmentIds } = req.body as { equipmentIds?: unknown };
      if (!Array.isArray(equipmentIds) || !equipmentIds.every((id) => typeof id === "string")) {
        res.status(400).json({ error: "equipmentIds must be an array of strings" });
        return;
      }
      const saved = await equipmentService.setUserEquipment(userId, equipmentIds);
      res.json({ equipmentIds: saved });
    } catch (error: any) {
      if (error?.status === 400) {
        res.status(400).json({ error: error.message });
        return;
      }
      logger.error({ message: error?.message }, "Error saving user equipment");
      res.status(500).json({ error: "Failed to save your equipment" });
    }
  },
};
