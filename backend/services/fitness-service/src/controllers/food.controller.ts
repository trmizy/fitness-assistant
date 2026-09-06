import { Request, Response } from "express";
import { foodService } from "../services/food.service";

export const foodController = {
  async search(req: Request, res: Response): Promise<void> {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.status(400).json({ error: "query param q is required" });
      return;
    }
    const foods = await foodService.search(q);
    res.json(foods);
    return;
  },

  // Product Completeness pass — Food Library browse/list page.
  async list(req: Request, res: Response): Promise<void> {
    const { page, limit, sortBy, source, foodForm, isSupplement, hasImage } =
      req.query as Record<string, string>;
    const result = await foodService.listFoods({
      page,
      limit,
      sortBy,
      source,
      foodForm,
      isSupplement,
      hasImage,
    });
    res.json(result);
  },

  async filterOptions(_req: Request, res: Response): Promise<void> {
    const result = await foodService.getFilterOptions();
    res.json(result);
  },

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const food = await foodService.getFood(req.params.id);
      res.json(food);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Failed to fetch food" });
    }
  },
};
