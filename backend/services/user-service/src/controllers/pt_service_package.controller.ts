import { Request, Response } from "express";
import { ptServicePackageService } from "../services/pt_service_package.service";

interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

function err(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

export const ptServicePackageController = {
  /** GET /me/service-packages — PT's own view (all packages, including archived) */
  async getMyPackages(req: AuthRequest, res: Response): Promise<void> {
    try {
      const ptUserId = req.user!.id;
      const result = await ptServicePackageService.getMyPackages(ptUserId);
      res.json(result);
    } catch (e: any) {
      err(res, e.status || 500, e.message || "Internal server error");
    }
  },

  /** GET /pts/:ptUserId/service-packages — Client's view (active, non-archived only) */
  async getPackagesForPT(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { ptUserId } = req.params;
      const result = await ptServicePackageService.getActivePackagesForPT(ptUserId);
      res.json(result);
    } catch (e: any) {
      err(res, e.status || 500, e.message || "Internal server error");
    }
  },

  /** POST /me/service-packages — PT creates a package */
  async createPackage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const ptUserId = req.user!.id;
      const result = await ptServicePackageService.createPackage(ptUserId, req.body);
      res.status(201).json(result);
    } catch (e: any) {
      err(res, e.status || 500, e.message || "Internal server error");
    }
  },

  /** PATCH /me/service-packages/:id — PT updates a package */
  async updatePackage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const ptUserId = req.user!.id;
      const { id } = req.params;
      const result = await ptServicePackageService.updatePackage(ptUserId, id, req.body);
      res.json(result);
    } catch (e: any) {
      err(res, e.status || 500, e.message || "Internal server error");
    }
  },

  /** DELETE /me/service-packages/:id — Soft-archive (never hard-delete) */
  async archivePackage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const ptUserId = req.user!.id;
      const { id } = req.params;
      const result = await ptServicePackageService.archivePackage(ptUserId, id);
      res.json(result);
    } catch (e: any) {
      err(res, e.status || 500, e.message || "Internal server error");
    }
  },
};
