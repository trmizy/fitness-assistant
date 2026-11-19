import type { Response, NextFunction } from "express";
import { logger } from "@gym-coach/shared";
import { profileRepository } from "../repositories/profile.repository";
import type { AuthRequest } from "./auth.middleware";

/**
 * N13A-10: PATCH /profile/me/accepting-clients is a trainer-only switch. A plain client used to get 200 and an
 * audit row claiming "PT_ACCEPTING_CLIENTS_OFF". The check is on the caller's own profile (verified token
 * identity), and the body must be well-formed so a bad payload is a 400, not a Prisma 500.
 */
export async function requirePtForAcceptingClients(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const profile = await profileRepository.findByUserId(req.user!.id);
    if (!profile?.isPT) {
      res.status(403).json({
        error: "Chỉ huấn luyện viên mới thay đổi được trạng thái nhận khách",
        code: "PT_ONLY",
      });
      return;
    }
    const { isAcceptingClients, notAcceptingReason } = req.body ?? {};
    if (typeof isAcceptingClients !== "boolean") {
      res.status(400).json({ error: "isAcceptingClients phải là true hoặc false", code: "INVALID_BODY" });
      return;
    }
    if (
      notAcceptingReason !== undefined &&
      notAcceptingReason !== null &&
      (typeof notAcceptingReason !== "string" || notAcceptingReason.length > 500)
    ) {
      res.status(400).json({ error: "Lý do không hợp lệ (tối đa 500 ký tự)", code: "INVALID_BODY" });
      return;
    }
    next();
  } catch (error) {
    logger.error(error, "requirePtForAcceptingClients error");
    res.status(500).json({ error: "Internal server error" });
  }
}
