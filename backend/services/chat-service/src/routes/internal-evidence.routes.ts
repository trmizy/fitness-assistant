import { Router, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { logger } from "@gym-coach/shared";

/**
 * Dispute Case slice 2 / S2.3 - READ-ONLY evidence for user-service's Case collector. Internal only: authenticated with the same shared secret as the
 * other /internal routes (x-internal-secret = INTERNAL_API_SECRET, compared in constant time), and NOT proxied by the gateway.
 *
 *   GET /internal/call-sessions?coachingSessionId=<uuid>
 *     -> { data: [{ id, status, startedAt, answeredAt, endedAt, endReason, callerId, calleeId, origin }] }
 *
 * Scope rules: the key is mandatory (no listing, no "all"), unknown query parameters are refused, at most MAX_ROWS rows come back, and ONLY these
 * fields are returned. Message content, the conversation id, the call type and the row timestamps are never returned (D-NEW-8: chat is not evidence yet).
 * A call row is what the SERVER observed of a connection (E1): it proves a connection existed, not that training happened.
 */
export const MAX_ROWS = 50;

export interface CallSessionEvidenceRow {
  id: string;
  status: string;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  callerId: string;
  calleeId: string;
  origin: string;
}

export interface InternalEvidenceDeps {
  findCallSessionsByCoachingSession: (coachingSessionId: string, take: number) => Promise<CallSessionEvidenceRow[]>;
}

const callSessionsQuery = z.object({ coachingSessionId: z.string().uuid() }).strict();

function secretOk(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    res.status(503).json({ error: "Internal endpoint disabled: no internal secret configured" });
    return;
  }
  if (!secretOk(req.headers["x-internal-secret"], expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function createInternalEvidenceRoutes(deps: InternalEvidenceDeps): Router {
  const router = Router();
  router.get("/call-sessions", requireSecret, async (req: Request, res: Response): Promise<void> => {
    const parsed = callSessionsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query: coachingSessionId (uuid) is required and nothing else is accepted", fields: parsed.error.issues.map((i) => i.path.join(".") || "query") });
      return;
    }
    try {
      const rows = await deps.findCallSessionsByCoachingSession(parsed.data.coachingSessionId, MAX_ROWS);
      // Whitelist again here, so a repository that returns more can never leak more.
      res.set("Cache-Control", "no-store").json({
        data: rows.slice(0, MAX_ROWS).map((r) => ({
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          answeredAt: r.answeredAt,
          endedAt: r.endedAt,
          endReason: r.endReason,
          callerId: r.callerId,
          calleeId: r.calleeId,
          origin: r.origin,
        })),
      });
    } catch (err: any) {
      logger.error({ error: err?.message }, "internal call-sessions evidence read failed");
      res.status(500).json({ error: "Failed to read call sessions" });
    }
  });
  return router;
}
