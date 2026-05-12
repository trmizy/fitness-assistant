import { Request, Response } from 'express';
import { foodService } from '../services/food.service';

export const foodController = {
  async search(req: Request, res: Response) {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'query param q is required' });
    const foods = await foodService.search(q);
    res.json(foods);
  },
};
