import type { Request } from "express";
import { logger } from "@gym-coach/shared";
import { AuditEntityType, Prisma } from "../generated/prisma";
import { auditRepository } from "../repositories/audit.repository";

/**
 * Who changed what, kept for dispute resolution.
 *
 * The actions worth recording are the ones two people can later disagree about: a
 * contract changing status, a session moving to a different time, a PT altering the
 * price or availability of what they sell. Reads are not audited — the table would fill
 * with noise and the signal ("this time was changed, by that person, then") would be
 * buried.
 */

/**
 * Actor for changes no person made — the background sweeps that expire proposals or
 * auto-confirm sessions. A sentinel rather than a null column: "nobody" and "the system"
 * are different answers to "who did this", and only one of them is true here.
 */
export const SYSTEM_ACTOR = "SYSTEM";

/** IP and user-agent, pulled the same way auth-service's auditMeta does. */
export function auditMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get("user-agent") || null,
  };
}

export const auditService = {
  /**
   * Record an action. Never throws.
   *
   * A failed audit write must not roll back the thing being audited: refusing to
   * reschedule a session because a log row could not be written would turn a
   * bookkeeping problem into an outage. But it is not swallowed either — a trail that
   * disappears silently is worse than no trail, because it is trusted while being
   * incomplete. Failures land in the error log with the payload that was lost.
   */
  async record(entry: {
    actorUserId: string;
    action: string;
    entityType: AuditEntityType;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    try {
      await auditRepository.create(entry);
    } catch (err) {
      logger.error(
        { err, entry },
        "[Audit] failed to write audit entry — the audited action still went through",
      );
    }
  },

  async getEntityHistory(
    entityType: AuditEntityType,
    entityId: string,
    page = 1,
    limit = 50,
  ) {
    return auditRepository.findByEntity(
      entityType,
      entityId,
      (page - 1) * limit,
      limit,
    );
  },
};
