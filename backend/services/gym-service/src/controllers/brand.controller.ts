import { Request, Response } from 'express';
import { brandService } from '../services/brand.service';

export const brandController = {
  async create(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const brand = await brandService.createBrand(ownerId, req.body);
      res.status(201).json({ success: true, data: brand });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listOwned(req: Request, res: Response) {
    const ownerId = req.user!.userId;
    const brands = await brandService.listOwned(ownerId);
    res.json({ success: true, data: brands });
  },

  async getOwnedById(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const brand = await brandService.getOwnedBrandWithBranches(req.params.id, ownerId);
      res.json({ success: true, data: brand });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const brand = await brandService.updateBrand(req.params.id, ownerId, req.body);
      res.json({ success: true, data: brand });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  // ── Admin (Vòng 4 / Phase C1) ────────────────────────────────────────
  async listAllForAdmin(_req: Request, res: Response) {
    const brands = await brandService.listAllForAdmin();
    res.json({ success: true, data: brands });
  },

  async approveRename(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const brand = await brandService.approveRename(req.params.id, adminId);
      res.json({ success: true, data: brand });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
