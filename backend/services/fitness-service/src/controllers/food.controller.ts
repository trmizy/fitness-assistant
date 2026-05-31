import { Request, Response } from 'express';
import { foodService } from '../services/food.service';

export const foodController = {
  async search(req: Request, res: Response): Promise<void> {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.status(400).json({ error: 'query param q is required' });
      return;
    }
    const foods = await foodService.search(q);
    res.json(foods);
    return;
  },
};
