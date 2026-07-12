import { Router } from 'express';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { contractController } from '../controllers/contract.controller';
import { profileService } from '../services/profile.service';
import { inbodyService } from '../services/inbody.service';

const router = Router();

// All routes under /internal are protected by service-secret. Not exposed to public via the gateway.
router.use(serviceSecretMiddleware);

// Chat-service calls this to decide whether a (from, to) pair can chat.
// Implements BR-29 (loosened): client → APPROVED PT discovery chat is allowed even without contract.
router.get('/chat-eligibility', contractController.chatEligibility as any);

// ai-service calls this to verify that a contractId belongs to the given client and is ACTIVE.
// Returns { ptUserId, contractId } or { ptUserId: null }.
router.get('/contracts/active-pt', contractController.getActivePTForClient as any);

// payment-service calls these after a wallet-transfer PAID / a successful refund reversal —
// both are idempotent and verify the transaction against payment-service before mutating
// (§1.8 in the plan): never trust the caller blindly, even behind the service secret.
router.post('/contracts/:id/activate-after-payment', contractController.activateAfterPayment as any);
router.post('/contracts/:id/cancel-after-refund', contractController.cancelAfterRefund as any);

// ai-service workers run without an end-user bearer token. These read-only
// endpoints expose the same user-owned context after service-secret validation.
router.get('/profile/:userId', async (req, res) => {
  const result = await profileService.getProfile(req.params.userId);
  res.json(result);
});

router.get('/inbody/:userId', async (req, res) => {
  const history = await inbodyService.getHistory(req.params.userId);
  res.json(history);
});

export default router;
