import { Request, Response } from 'express';
import { principalId } from '../middleware/partner-context.middleware';
import { hasPermission } from '../services/partner-permissions';
import { gymAnalyticsService } from '../services/gym-analytics.service';

export const gymAnalyticsController = {
  /**
   * GET /owner/gyms/:gymId/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD - chart data for the owner dashboard (see gym-analytics.service.ts).
   * The route gate is any-of (checkin.list | membership.full | membership.sales | finance.wallet.view); each section is then included only
   * if the role holds the permission of the neighbouring endpoint that exposes the same data, else it is null (fail closed):
   *   heatmap -> checkin.list; sales + renewal -> membership.full | membership.sales; netIncome -> finance.wallet.view.
   */
  async get(req: Request, res: Response) {
    try {
      const role = req.partner!.role;
      const visibility = {
        heatmap: hasPermission(role, 'checkin.list'),
        memberships: hasPermission(role, 'membership.full') || hasPermission(role, 'membership.sales'),
        netIncome: hasPermission(role, 'finance.wallet.view'),
      };
      const data = await gymAnalyticsService.getAnalytics(req.params.gymId, principalId(req), { from: req.query.from, to: req.query.to }, visibility);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { ...(e.code ? { code: e.code } : {}), message: e.message } });
    }
  },
};
