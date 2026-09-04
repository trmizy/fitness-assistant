import { Request, Response } from 'express';
import { affiliationService } from '../services/affiliation.service';

export const affiliationController = {
  async listPublic(req: Request, res: Response) {
    const list = await affiliationService.listPublicByGym(req.params.gymId);
    res.json({ success: true, data: list });
  },

  async invite(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const { ptId, ...rest } = req.body;
      const affiliation = await affiliationService.invite(req.params.gymId, ownerId, ptId, rest);
      res.status(201).json({ success: true, data: affiliation });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
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
      const { accept } = req.body;
      const affiliation = await affiliationService.respond(req.params.id, ptId, !!accept);
      res.json({ success: true, data: affiliation });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
