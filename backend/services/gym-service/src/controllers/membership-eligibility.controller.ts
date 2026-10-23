import { Request, Response } from 'express';
import { membershipEligibilityService } from '../services/membership-eligibility.service';

const bad = (res: Response, message: string): void => {
  res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message } });
};

export const membershipEligibilityController = {
  async activeMemberships(req: Request, res: Response): Promise<void> {
    const { gymId, brandId } = req.query;
    if ((gymId !== undefined && typeof gymId !== 'string') || (brandId !== undefined && typeof brandId !== 'string')) {
      bad(res, 'gymId and brandId must be single string values');
      return;
    }
    // A present-but-empty value is a caller bug (e.g. an undefined id interpolated), not "no filter".
    if (gymId === '' || brandId === '') {
      bad(res, 'gymId and brandId must not be empty');
      return;
    }
    if (gymId && brandId) {
      bad(res, 'Pass either gymId or brandId, not both');
      return;
    }
    try {
      const data = await membershipEligibilityService.lookup(req.params.clientId, {
        gymId: gymId || undefined,
        brandId: brandId || undefined,
      });
      res.json({ success: true, data });
    } catch (e: any) {
      if (e?.status === 404) {
        res.status(404).json({ success: false, error: { code: 'GYM_NOT_FOUND' } });
        return;
      }
      throw e;
    }
  },

  async activeGyms(req: Request, res: Response) {
    const gymIds = await membershipEligibilityService.activeGymIds(req.params.clientId);
    res.json({ success: true, data: { gymIds } });
  },
};
