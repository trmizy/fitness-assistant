import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { PtRestrictionScope } from "../generated/prisma";
import { PtRestrictionError, ptRestrictionService, toAdminView } from "../services/pt-restriction.service";

/**
 * Admin endpoints for temporary PT suspension (mounted under /admin/pts by admin.routes.ts, which
 * already requires an authenticated ADMIN) plus the PT's own read of their restriction.
 *
 * The acting admin is ALWAYS `req.user.id` — the identity auth-service verified for the bearer token.
 * Nothing about "who" is read from the body, and the PT in the URL is only the subject.
 */
function fail(res: Response, error: any, fallback: string) {
  if (error instanceof PtRestrictionError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  logger.error(error, fallback);
  res.status(error?.status || 500).json({ error: fallback });
}

export const ptRestrictionController = {
  /** POST /admin/pts/:ptUserId/suspend  { category, reason, publicReason? } */
  async suspend(req: any, res: Response) {
    try {
      const { category, reason, publicReason } = req.body ?? {};
      const result = await ptRestrictionService.suspend({
        ptUserId: req.params.ptUserId,
        adminId: req.user.id,
        reasonCategory: category,
        reasonText: reason,
        publicReason,
      });
      res.json({
        changed: result.changed,
        restriction: toAdminView(result.restriction),
        sessionsCancelled: result.cancelled.length,
        notified: result.notified,
      });
    } catch (error: any) {
      fail(res, error, "Không thể tạm đình chỉ huấn luyện viên");
    }
  },

  /** POST /admin/pts/:ptUserId/lift-suspension  { reason } */
  async lift(req: any, res: Response) {
    try {
      const result = await ptRestrictionService.lift({
        ptUserId: req.params.ptUserId,
        adminId: req.user.id,
        reason: req.body?.reason,
      });
      if (!result.changed) {
        res.json({ changed: false });
        return;
      }
      res.json({
        changed: true,
        restriction: toAdminView(result.restriction),
        contractsExtended: result.summary.extendedContracts.map((e) => ({
          contractId: e.contractId,
          blockedMs: e.blockedMs,
          previousEndDate: e.previousEndDate,
          newEndDate: e.newEndDate,
        })),
        confirmationDeadlinesExtended: result.summary.confirmationDeadlinesExtended.length,
        notified: result.notified,
      });
    } catch (error: any) {
      fail(res, error, "Không thể mở lại huấn luyện viên");
    }
  },

  /** POST /admin/pts/:ptUserId/contracts/:contractId/restrict  { category, reason, publicReason? } — CONTRACT scope. */
  async restrictContract(req: any, res: Response) {
    try {
      const { category, reason, publicReason } = req.body ?? {};
      const result = await ptRestrictionService.restrictContract({
        ptUserId: req.params.ptUserId,
        contractId: req.params.contractId,
        adminId: req.user.id,
        reasonCategory: category,
        reasonText: reason,
        publicReason,
      });
      res.json({
        changed: result.changed,
        restriction: toAdminView(result.restriction),
        sessionsCancelled: result.cancelled.length,
        notified: result.notified,
      });
    } catch (error: any) {
      fail(res, error, "Không thể hạn chế hợp đồng");
    }
  },

  /** POST /admin/pts/:ptUserId/contracts/:contractId/lift-restriction  { reason } */
  async liftContract(req: any, res: Response) {
    try {
      const result = await ptRestrictionService.liftContractRestriction({
        ptUserId: req.params.ptUserId,
        contractId: req.params.contractId,
        adminId: req.user.id,
        reason: req.body?.reason,
      });
      if (!result.changed) {
        res.json({ changed: false });
        return;
      }
      res.json({
        changed: true,
        restriction: toAdminView(result.restriction),
        // True when the PT's account restriction still holds the contract: it stays paused, nobody is told it resumed.
        stillPausedByAccount: result.stillPausedByAccount,
        contractsExtended: result.summary.extendedContracts.map((e) => ({
          contractId: e.contractId,
          blockedMs: e.blockedMs,
          previousEndDate: e.previousEndDate,
          newEndDate: e.newEndDate,
        })),
        confirmationDeadlinesExtended: result.summary.confirmationDeadlinesExtended.length,
        notified: result.notified,
      });
    } catch (error: any) {
      fail(res, error, "Không thể mở lại hợp đồng");
    }
  },

  /**
   * POST /admin/pts/:ptUserId/restrictions/change-scope
   *   { to: "ACCOUNT", contractId, reason, category?, publicReason? }          raise one contract's restriction to the PT
   *   { to: "CONTRACT", contractIds: [..], reason, category?, publicReason? }  narrow the PT's suspension to those contracts
   */
  async changeScope(req: any, res: Response) {
    try {
      const { to, contractId, contractIds, reason, category, publicReason } = req.body ?? {};
      const result = await ptRestrictionService.changeScope({
        ptUserId: req.params.ptUserId,
        adminId: req.user.id,
        to,
        contractId,
        contractIds,
        reason,
        reasonCategory: category,
        publicReason,
      });
      if (!result.changed) {
        res.json({ changed: false });
        return;
      }
      const closed = "contractEpisode" in result ? result.contractEpisode : result.closed;
      const opened = "contractEpisode" in result ? (result.account ? [result.account] : []) : result.opened;
      res.json({
        changed: true,
        to,
        closedRestriction: closed ? await ptRestrictionService.view(closed.id) : null,
        openedRestrictions: await Promise.all(opened.map((o) => ptRestrictionService.view(o.id))),
        contractsExtended: (result.summary?.extendedContracts ?? []).map((e) => ({
          contractId: e.contractId,
          blockedMs: e.blockedMs,
          previousEndDate: e.previousEndDate,
          newEndDate: e.newEndDate,
        })),
        notified: result.notified,
      });
    } catch (error: any) {
      fail(res, error, "Không thể đổi phạm vi hạn chế");
    }
  },

  /** POST /admin/pts/:ptUserId/restrictions/justify  { reason, contractId? } — keep an overdue suspension, on the record. */
  async justify(req: any, res: Response) {
    try {
      const result = await ptRestrictionService.justifyContinuing({
        ptUserId: req.params.ptUserId,
        adminId: req.user.id,
        reason: req.body?.reason,
        contractId: req.body?.contractId,
      });
      res.json({ restriction: toAdminView(result.restriction), overdue: result.overdue, reviewDueAt: result.reviewDueAt });
    } catch (error: any) {
      fail(res, error, "Không thể ghi nhận lý do tiếp tục đình chỉ");
    }
  },

  /** GET /admin/pts/:ptUserId/restrictions — every episode of this PT, newest first. */
  async history(req: any, res: Response) {
    try {
      res.json({ ptUserId: req.params.ptUserId, restrictions: await ptRestrictionService.history(req.params.ptUserId) });
    } catch (error: any) {
      fail(res, error, "Không tải được lịch sử hạn chế");
    }
  },

  /** GET /admin/pts/suspended[?overdue=true][&includePermanent=true][&scope=ACCOUNT|CONTRACT] — contract episodes included. */
  async listSuspended(req: any, res: Response) {
    try {
      res.json(
        await ptRestrictionService.listActive({
          overdueOnly: req.query.overdue === "true",
          includePermanent: req.query.includePermanent === "true",
          scope: req.query.scope === "ACCOUNT" || req.query.scope === "CONTRACT" ? (req.query.scope as PtRestrictionScope) : undefined,
        }),
      );
    } catch (error: any) {
      fail(res, error, "Không tải được danh sách huấn luyện viên bị đình chỉ");
    }
  },

  /** GET /profile/me/restriction — the PT's OWN status (identity from the token; there is no id to pass). */
  async ownStatus(req: any, res: Response) {
    try {
      res.json(await ptRestrictionService.ownStatus(req.user.id));
    } catch (error: any) {
      fail(res, error, "Không tải được trạng thái tài khoản");
    }
  },
};
