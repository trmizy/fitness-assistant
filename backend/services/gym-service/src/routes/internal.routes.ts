import { Router } from 'express';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { internalController } from '../controllers/internal.controller';
import { collaborationController } from '../controllers/collaboration.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertRefundNotBypassingCase } from '../services/complaint-case/refund-guard';
import internalMembershipRoutes from './internal-memberships.routes';
import internalStatusRoutes from './internal-status.routes';
import { createInternalDisputeEvidenceRoutes } from './internal-dispute-evidence.routes';
import { internalDisputeEvidenceRepository } from '../repositories/internal-dispute-evidence.repository';
import { withdrawalRecipientsForGym } from '../services/withdrawal-recipients.service';

const router = Router();
router.use(serviceSecretMiddleware);

// Idempotent — the internal.controller verifies the transaction (§1.8) before mutating.
router.post('/gym-memberships/:id/activate', asyncHandler(internalController.activate));
router.post('/gym-memberships/:id/cancel-after-refund', asyncHandler(internalController.cancelAfterRefund));
// E6 / F2 (Ngài, 05/11): payment-service asks this BEFORE POST /admin/payments/:id/refund writes anything. READ-ONLY (a POST only so it can travel the same service-call helper): 200 {allowed:true}, or the
// refund-guard.ts 409 (GYM_CASE_OPEN / GYM_CASE_DECISION_EXISTS). Any other failure is a 5xx that payment-service reads as "refuse" (fail-closed).
router.post(
  '/gym-memberships/:id/refund-guard',
  asyncHandler(async (req, res) => {
    try {
      await assertRefundNotBypassingCase(String(req.params.id));
      res.json({ success: true, data: { allowed: true } });
    } catch (e: any) {
      if (e?.status === 409 && typeof e?.code === 'string') {
        res.status(409).json({ success: false, error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) } });
        return;
      }
      throw e;
    }
  }),
);

// Gym Owner handoff item 3: payment-service asks who to notify (bell) about a GYM withdrawal decision. READ-ONLY (a POST only so it can travel the same
// service-call helper as refund-guard). 200 { userIds, gymName }, 404 when the branch does not exist. userIds = the branch's owner + the partner's ACTIVE OWNER accounts.
router.post(
  '/gyms/:gymId/withdrawal-recipients',
  asyncHandler(async (req, res) => {
    const out = await withdrawalRecipientsForGym(String(req.params.gymId));
    if (!out) {
      res.status(404).json({ success: false, error: { code: 'GYM_NOT_FOUND', message: 'Gym not found' } });
      return;
    }
    res.json({ success: true, data: out });
  }),
);

// user-service resolves a PT-via-gym contract's frozen rate table here at signing time
// (plan §1.4). 404 (NO_ACTIVE_COLLABORATION) means the caller must fall back to its own
// 400 — this endpoint never invents a rate table.
router.get('/collaborations/active', asyncHandler(collaborationController.internalActiveRates));

// Phase 3 / P3.1 - read-only membership lookups (new file, secret-protected by the router.use above).
router.use(internalMembershipRoutes);
// FH-4 - read-only status facts (new file, secret-protected by the router.use above).
router.use(internalStatusRoutes);
// Dispute Case slice 2 / S2.3 - read-only PT / member check-in evidence (secret-protected by the router.use above).
router.use(createInternalDisputeEvidenceRoutes(internalDisputeEvidenceRepository));

export default router;
