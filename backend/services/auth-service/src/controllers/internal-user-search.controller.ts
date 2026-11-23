import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/auth.repository";
import { foldVietnamese, nameMatchesQuery } from "../utils/vi-search";

/**
 * gym-service owner member search (GET /owner/gyms/:gymId/memberships?q=): which of THESE users have a display name matching q.
 *
 * POST /auth/internal/users/search-by-name   header x-service-secret, body { userIds: string[1..500], q: string(2..64 after trim) }
 *   -> 200 { matchedIds: string[] }   (a subset of the supplied userIds - nothing else is ever returned: no name, e-mail or other user)
 *
 * The lookup is restricted to the supplied ids (`id IN (...)`), so this is a filter over a list the caller already holds, never a directory search.
 * Matching rules: utils/vi-search.ts. Same x-service-secret check as the other /auth/internal routes (401 when wrong, constant-time compare).
 */
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";

export const USER_NAME_SEARCH_MAX_IDS = 500;

const bodySchema = z.object({
  userIds: z.array(z.string().min(1).max(64)).min(1).max(USER_NAME_SEARCH_MAX_IDS),
  q: z.string().trim().min(2).max(64),
});

function sameSecret(given: string | undefined): boolean {
  if (!given) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(given), digest(INTERNAL_SERVICE_SECRET));
}

export const internalUserSearchController = {
  async searchByName(req: Request, res: Response): Promise<void> {
    try {
      const header = req.headers["x-service-secret"];
      if (!sameSecret(Array.isArray(header) ? header[0] : header)) {
        res.status(401).json({ error: "Invalid service secret" });
        return;
      }
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: `userIds (1-${USER_NAME_SEARCH_MAX_IDS}) và q (2-64 ký tự) là bắt buộc` });
        return;
      }
      const ids = [...new Set(parsed.data.userIds)];
      const folded = foldVietnamese(parsed.data.q);
      if (folded.length < 2) {
        res.status(400).json({ error: "q quá ngắn" });
        return;
      }
      // Only the supplied ids are read, and only the two name columns.
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      });
      res.json({ matchedIds: users.filter((u) => nameMatchesQuery(u, folded)).map((u) => u.id) });
    } catch (error) {
      logger.error(error as Error, "search-by-name error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
};
