import { Request, Response } from "express";
import { ptServicePackageService } from "../services/pt_service_package.service";
import { clientHeaderOf, recordClientCompatEvent } from "../services/client-compat.service";

interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

function err(res: Response, status: number, message: string, code?: string) {
  res.status(status).json({ error: message, ...(code ? { code } : {}) });
}

export const LISTING_REVIEW_REQUIRED_MESSAGE =
  "Thay đổi này cần gửi duyệt. Hãy cập nhật ứng dụng để dùng mục Tin đăng.";

/**
 * The answer every PT package WRITE route gives now (POST / PATCH / DELETE, on both /profile/me/service-packages
 * and /me/service-packages). A package is part of the PT's public listing, and the listing changes only through a
 * reviewed revision; the old direct-edit path let an already-approved trainer reprice or add packages with no
 * review at all. Body shape is the shared one old mobile builds already know how to read (`message`, and
 * `error.message`), with a Vietnamese sentence for the person.
 *
 * Telemetry: one client_compat_events row per call (best-effort, never affects the response).
 */
async function listingReviewRequired(req: AuthRequest, res: Response): Promise<void> {
  await recordClientCompatEvent({
    route: `${req.method} ${req.baseUrl}${req.route?.path ?? ""}`,
    actorUserId: req.user?.id ?? null,
    clientHeader: clientHeaderOf(req),
    outcome: "REVIEW_REQUIRED_409",
  });
  res.status(409).json({
    success: false,
    error: { code: "LISTING_REVIEW_REQUIRED", message: LISTING_REVIEW_REQUIRED_MESSAGE },
    message: LISTING_REVIEW_REQUIRED_MESSAGE,
  });
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

  /** GET /pts/:ptUserId/service-packages — Client's view (active, non-archived only; visible trainers only) */
  async getPackagesForPT(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { ptUserId } = req.params;
      const result = await ptServicePackageService.getActivePackagesForPT(ptUserId);
      res.json(result);
    } catch (e: any) {
      err(res, e.status || 500, e.message || "Internal server error");
    }
  },

  /** POST /me/service-packages — locked: packages change only through an approved listing revision */
  createPackage: listingReviewRequired,

  /** PATCH /me/service-packages/:id — locked, see listingReviewRequired */
  updatePackage: listingReviewRequired,

  /** DELETE /me/service-packages/:id — locked, see listingReviewRequired (archiving is a change too) */
  archivePackage: listingReviewRequired,
};
