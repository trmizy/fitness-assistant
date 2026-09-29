import { Request, Response } from 'express';
import { brandLogoUrl } from '../services/gym-photo-url';
import { brandService } from '../services/brand.service';
import { principalId } from '../middleware/partner-context.middleware';

export const brandController = {
  async create(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const brand = await brandService.createBrand(ownerId, req.body);
      res.status(201).json({ success: true, data: brand });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listOwned(req: Request, res: Response) {
    const ownerId = principalId(req);
    const brands = await brandService.listOwned(ownerId);
    // Logo nằm trong bucket riêng tư → link ký tạm, để trang hồ sơ chủ gym hiện được logo hiện tại.
    const withLogo = await Promise.all(brands.map(async (b: any) => ({ ...b, logoUrl: await brandLogoUrl(b.logoKey) })));
    res.json({ success: true, data: withLogo });
  },

  async getOwnedById(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const brand = await brandService.getOwnedBrandWithBranches(req.params.id, ownerId);
      res.json({ success: true, data: brand });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
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
