import { Request, Response } from 'express';
import { collaborationService } from '../services/collaboration.service';

/**
 * Both sides of a negotiation share this one controller. Which side is acting is never taken
 * from the request body — it is fixed by which route the request arrived on (pt.routes.ts
 * mounts the PT-actor handlers, owner.routes.ts mounts the GYM-actor ones under `/owner`).
 * Trusting a body field for this would let a caller claim to be "the gym" on a PT's own
 * proposal.
 */

export const collaborationController = {
  // PT proposes to a gym — POST /gyms/:gymId/collaborations
  async proposeAsPt(req: Request, res: Response) {
    try {
      const ptUserId = req.user!.userId;
      const { ptRate, gymRate, platformRate, note } = req.body;
      const row = await collaborationService.propose({
        gymId: req.params.gymId,
        ptUserId,
        proposedBy: 'PT',
        ptRate,
        gymRate,
        platformRate,
        note,
      });
      res.status(201).json({ success: true, data: row });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  // Gym owner invites a PT — POST /owner/gyms/:gymId/collaborations
  async proposeAsGym(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const { ptUserId, ptRate, gymRate, platformRate, note } = req.body;
      if (!ptUserId) {
        res.status(400).json({ success: false, error: { message: 'ptUserId is required' } });
        return;
      }
      // Same authorization gate propose() itself would apply to a response — verified up
      // front here since propose() does not otherwise check gym ownership for the GYM actor.
      await collaborationService.assertParty({ gymId: req.params.gymId, ptUserId }, 'GYM', ownerId);
      const row = await collaborationService.propose({
        gymId: req.params.gymId,
        ptUserId,
        proposedBy: 'GYM',
        ptRate,
        gymRate,
        platformRate,
        note,
      });
      res.status(201).json({ success: true, data: row });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async respondAsPt(req: Request, res: Response) {
    try {
      const ptUserId = req.user!.userId;
      const { action, ptRate, gymRate, platformRate, note } = req.body;
      const row = await collaborationService.respond({
        collaborationId: req.params.id,
        actor: 'PT',
        actorUserId: ptUserId,
        action,
        ptRate,
        gymRate,
        platformRate,
        note,
      });
      res.json({ success: true, data: row });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async respondAsGym(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const { action, ptRate, gymRate, platformRate, note } = req.body;
      const row = await collaborationService.respond({
        collaborationId: req.params.id,
        actor: 'GYM',
        actorUserId: ownerId,
        action,
        ptRate,
        gymRate,
        platformRate,
        note,
      });
      res.json({ success: true, data: row });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async terminateAsPt(req: Request, res: Response) {
    try {
      const row = await collaborationService.terminate(req.params.id, 'PT', req.user!.userId);
      res.json({ success: true, data: row });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async terminateAsGym(req: Request, res: Response) {
    try {
      const row = await collaborationService.terminate(req.params.id, 'GYM', req.user!.userId);
      res.json({ success: true, data: row });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  // Shared by both roles (route allows PT and GYM_OWNER) — dispatches on who is actually
  // calling rather than on which URL prefix was hit, so both land on GET /me/collaborations.
  async listMine(req: Request, res: Response) {
    const list =
      req.user!.role === 'GYM_OWNER'
        ? await collaborationService.listFor({ ownerId: req.user!.userId })
        : await collaborationService.listFor({ ptUserId: req.user!.userId });
    res.json({ success: true, data: list });
  },

  // GET /pt/:ptUserId/gyms — public: which gyms this trainer has an accepted partnership
  // with, for the client-side "where do you train?" picker.
  async listAcceptedGymsForPt(req: Request, res: Response) {
    const list = await collaborationService.listAcceptedGymsForPt(req.params.ptUserId);
    res.json({ success: true, data: list });
  },

  // GET /internal/collaborations/active — user-service resolves a contract's rate table here.
  async internalActiveRates(req: Request, res: Response) {
    const { gymId, ptUserId } = req.query;
    if (typeof gymId !== 'string' || typeof ptUserId !== 'string') {
      res.status(400).json({ success: false, error: { message: 'gymId and ptUserId are required' } });
      return;
    }
    const rates = await collaborationService.activeRates(gymId, ptUserId);
    if (!rates) {
      res.status(404).json({ success: false, error: { code: 'NO_ACTIVE_COLLABORATION' } });
      return;
    }
    res.json({ success: true, data: rates });
  },
};
