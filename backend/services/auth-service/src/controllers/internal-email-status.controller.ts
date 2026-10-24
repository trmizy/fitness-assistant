import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/auth.repository";

/**
 * B10 - gym-service asks, at invite time, whether an email already belongs to an account
 * (and with which role) so it can tell the inviter before sending an invitation.
 *
 * POST /auth/internal/partner-auth/email-status   header x-service-secret, body { email }
 *   -> 200 { exists: boolean, role: "CUSTOMER" | "PT" | "ADMIN" | "GYM_OWNER" | null }
 * Only existence + role are returned - never an id, name or any other profile data.
 * Same service-secret check as the other /auth/internal/partner-auth routes (401 when wrong).
 */
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";

const bodySchema = z.object({ email: z.string().trim().min(3).max(320).email() });

function sameSecret(given: string | undefined): boolean {
  if (!given) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(given), digest(INTERNAL_SERVICE_SECRET));
}

export const internalEmailStatusController = {
  async emailStatus(req: Request, res: Response): Promise<void> {
    try {
      const header = req.headers["x-service-secret"];
      if (!sameSecret(Array.isArray(header) ? header[0] : header)) {
        res.status(401).json({ error: "Invalid service secret" });
        return;
      }
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "email hợp lệ là bắt buộc" });
        return;
      }
      // Same normalisation as invited-account creation (trim + lowercase); the lookup is
      // case-insensitive so an account stored with mixed case still matches.
      const email = parsed.data.email.toLowerCase();
      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { role: true },
      });
      res.json({ exists: Boolean(user), role: user?.role ?? null });
    } catch (error) {
      logger.error(error as Error, "email-status error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
};
