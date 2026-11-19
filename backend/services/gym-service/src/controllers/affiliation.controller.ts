import { Request, Response } from 'express';
import { affiliationService } from '../services/affiliation.service';
import { principalId } from '../middleware/partner-context.middleware';
import { requirePubliclyVisibleGym } from '../services/gym-public';

export const affiliationController = {
  async listPublic(req: Request, res: Response) {
    if (!(await requirePubliclyVisibleGym(req, res))) return;
    const list = await affiliationService.listPublicByGym(req.params.gymId);
    res.json({ success: true, data: list });
  },

  async invite(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const { ptId, ...rest } = req.body;
      const affiliation = await affiliationService.invite(req.params.gymId, ownerId, ptId, rest);
      res.status(201).json({ success: true, data: affiliation });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { ...(e.status && typeof e.code === 'string' ? { code: e.code } : {}), message: e.message } });
    }
  },

  async listInvitations(req: Request, res: Response) {
    const ptId = req.user!.userId;
    const list = await affiliationService.listPendingForPT(ptId);
    res.json({ success: true, data: list });
  },

  async listAffiliations(req: Request, res: Response) {
    const ptId = req.user!.userId;
    const list = await affiliationService.listForPT(ptId);
    res.json({ success: true, data: list });
  },

  async respond(req: Request, res: Response) {
    try {
      const ptId = req.user!.userId;
      // N13E-07 (14/11/2026): the answer must be explicit. `accept: true|false` (the web contract) or `action: "ACCEPT"|"REJECT"`; anything else used to read as accept=undefined and
      // silently REJECT the invitation.
      const { accept, action } = req.body ?? {};
      let decision: boolean | null = null;
      if (typeof accept === 'boolean') decision = accept;
      else if (typeof action === 'string' && ['ACCEPT', 'REJECT'].includes(action.trim().toUpperCase())) decision = action.trim().toUpperCase() === 'ACCEPT';
      if (decision === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_RESPONSE', message: 'Phản hồi lời mời không hợp lệ — gửi accept: true/false hoặc action: ACCEPT/REJECT' } });
        return;
      }
      const affiliation = await affiliationService.respond(req.params.id, ptId, decision);
      res.json({ success: true, data: affiliation });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
