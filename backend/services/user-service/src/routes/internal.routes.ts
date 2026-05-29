import { Router } from 'express';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { contractController } from '../controllers/contract.controller';

const router = Router();

// All routes under /internal are protected by service-secret. Not exposed to public via the gateway.
router.use(serviceSecretMiddleware);

// Chat-service calls this to decide whether a (from, to) pair can chat.
// Implements BR-29 (loosened): client → APPROVED PT discovery chat is allowed even without contract.
router.get('/chat-eligibility', contractController.chatEligibility as any);

// ai-service calls this to verify that a contractId belongs to the given client and is ACTIVE.
// Returns { ptUserId, contractId } or { ptUserId: null }.
router.get('/contracts/active-pt', contractController.getActivePTForClient as any);

export default router;
