import { Request, Response } from 'express';
import { principalId } from '../middleware/partner-context.middleware';
import { hasPermission } from '../services/partner-permissions';
import { gymStatsService } from '../services/gym-stats.service';

export const gymStatsController = {
  /**
   * GET /owner/gyms/:gymId/stats?from=YYYY-MM-DD&to=YYYY-MM-DD - KPI counts for the owner dashboard (see gym-stats.service.ts).
   * The route gate is any-of (checkin.list | membership.full | membership.sales); each block of the answer is then included
   * only if the role holds the permission of the neighbouring endpoint that exposes the same data, else it is null.
   */
  async get(req: Request, res: Response) {
    try {
      const role = req.partner!.role;
      const visibility = {
        checkins: hasPermission(role, 'checkin.list'),
        memberships: hasPermission(role, 'membership.full') || hasPermission(role, 'membership.sales'),
      };
      const data = await gymStatsService.getStats(req.params.gymId, principalId(req), { from: req.query.from, to: req.query.to }, visibility);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { ...(e.code ? { code: e.code } : {}), message: e.message } });
    }
  },
};
