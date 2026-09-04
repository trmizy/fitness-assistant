import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import axios from 'axios';
import { transactionRepository } from '../repositories/transaction.repository';
import { walletService } from '../services/wallet.service';
import { computeFingerprint, checkIdempotency } from '../utils/idempotency';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { Prisma } from '../generated/prisma';
import { buildReconciliationReport } from '../services/reconcile.service';
import { withdrawalService } from '../services/withdrawal.service';

const GYM_SERVICE_URL = process.env.GYM_SERVICE_URL || 'http://localhost:3006';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const router = Router();
// This router previously had NO auth of its own, relying entirely on the
// gateway's requireRoles('ADMIN') gate for /admin/payments/*. Since
// payment-service's port is published directly on the host in
// docker-compose.dev.yml, that meant a caller who reached this service
// directly — bypassing the gateway — could hit /admin/payments/:id/refund
// (a REAL fund-reversing endpoint) with no authentication at all. Every
// route in this file now requires a verified ADMIN token independently.
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

// GET /admin/payments — real transaction list (was a hardcoded empty array
// regardless of what data actually existed).
router.get('/', async (_req: Request, res: Response) => {
  const transactions = await transactionRepository.findRecent(200);
  res.json({ success: true, data: transactions });
});

// GET /admin/payments/commissions — real commission list (was a hardcoded
// empty array).
/**
 * GET /admin/payments/reconciliation — does the money add up?
 *
 * Reports escrow against the sum of every claim on it. `balanced: false` means the ledger has
 * created or destroyed money somewhere and needs investigating before anything else is
 * trusted; `negativeWallets` should always be empty.
 */
router.get('/reconciliation', async (_req: Request, res: Response) => {
  const report = await buildReconciliationReport();
  return res.status(report.balanced ? 200 : 409).json({ success: report.balanced, data: report });
});

router.get('/commissions', async (_req: Request, res: Response) => {
  const commissions = await transactionRepository.findRecentCommissions(200);
  res.json({ success: true, data: commissions });
});

// PATCH /admin/payments/commissions/:id/settle — retired (money-flow plan 5.3). This route
// predates the withdrawal flow below and was never wired to any real settlement logic (no
// state machine, no payout-transfer integration, no audit trail) — grep confirmed no live
// caller ever POSTs/PATCHes this path. Commission money already lives in each partner's
// AVAILABLE bucket the moment it is earned (see wallet.service.ts); "settling" it is just
// requesting it out via GET/POST /admin/withdrawals below, which is the real, tested flow.
// Kept as a 410 rather than deleted outright so a stale cached bundle gets an explanation
// instead of a bare 404.
router.patch('/commissions/:id/settle', (_req, res) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'ENDPOINT_RETIRED',
      message: 'Commission settlement now goes through the withdrawal flow — see /admin/withdrawals.',
    },
  });
});

// Money-flow plan 5.3 — admin side of the manual withdrawal flow. approve/reject are optional
// review steps before the money actually moves; markPaid is the only one that touches the
// ledger, and only after an admin confirms a real bank/e-wallet transfer already happened.
router.get('/withdrawals', async (_req: Request, res: Response) => {
  const list = await withdrawalService.listPending();
  res.json({ success: true, data: list });
});

const reviewSchema = z.object({ reason: z.string().min(1).optional() });
const markPaidSchema = z.object({ bankReference: z.string().min(1) });

router.post('/withdrawals/:id/approve', async (req: Request, res: Response) => {
  try {
    const updated = await withdrawalService.approve(req.params.id, req.user!.userId);
    res.json({ success: true, data: updated });
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    res.status(err.status ?? 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/withdrawals/:id/reject', async (req: Request, res: Response) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.reason) {
    return res.status(400).json({ success: false, error: { code: 'REASON_REQUIRED' } });
  }
  try {
    const updated = await withdrawalService.reject(req.params.id, req.user!.userId, parsed.data.reason);
    return res.json({ success: true, data: updated });
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    return res.status(err.status ?? 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/withdrawals/:id/mark-paid', async (req: Request, res: Response) => {
  const parsed = markPaidSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  try {
    const updated = await withdrawalService.markPaid(req.params.id, req.user!.userId, parsed.data.bankReference);
    return res.json({ success: true, data: updated });
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    return res.status(err.status ?? 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message } });
  }
});

const refundSchema = z.object({
  adminId: z.string().min(1),
  reason: z.string().min(1),
});

// POST /admin/payments/:id/refund — payment-service is the single source of truth for
// refund/ledger/commission logic; gym-service and user-service never reimplement this,
// they only call this endpoint (see plan §5, §2.2).
router.post('/:id/refund', async (req: Request, res: Response) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const { adminId, reason } = parsed.data;
  const originalTransactionId = req.params.id;

  const original = await transactionRepository.findById(originalTransactionId);
  if (!original) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  }

  // Only a PAID original can ever be refunded — blocks double-refunding an already-REFUNDED
  // transaction, and blocks refunding anything that never actually completed.
  if (original.status !== 'PAID') {
    const code = original.status === 'REFUNDED' ? 'ALREADY_REFUNDED' : 'NOT_REFUNDABLE';
    return res.status(409).json({ success: false, error: { code } });
  }

  if (!original.payerWalletId || !original.receiverWalletId) {
    return res.status(400).json({ success: false, error: { code: 'NOT_REFUNDABLE', message: 'Original transaction has no wallet references (likely a top-up, not a purchase)' } });
  }

  const commission = await transactionRepository.findCommissionByTransactionId(original.id);
  if (!commission) {
    return res.status(500).json({ success: false, error: { code: 'MISSING_COMMISSION_RECORD' } });
  }

  const refundRequestId = randomUUID();
  const idempotencyKey = `refund:${refundRequestId}`;
  const fingerprint = computeFingerprint({
    originalTransactionId: original.id,
    amount: original.amount.toString(),
    adminId,
  });
  const check = await checkIdempotency(idempotencyKey, fingerprint);
  if (check.kind === 'CONFLICT') {
    return res.status(409).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  }

  // Balance check before touching anything — a wallet is never allowed to go negative,
  // including for refunds. This system has no debt/negative-balance concept.
  const affordable = await walletService.checkRefundAffordable(
    original.receiverWalletId,
    commission.partnerPayoutAmount,
    commission.platformFeeAmount,
  );

  const refundTxn = await transactionRepository.create({
    payerId: original.payerId,
    purpose: 'REFUND',
    gymId: original.gymId,
    ptId: original.ptId,
    membershipId: original.membershipId,
    ptContractId: original.ptContractId,
    amount: original.amount,
    currency: original.currency,
    status: 'PROCESSING',
    idempotencyKey,
    requestFingerprint: fingerprint,
    payerWalletId: original.payerWalletId,
    receiverWalletId: original.receiverWalletId,
    relatedEntityType: original.relatedEntityType,
    relatedEntityId: original.relatedEntityId,
    activationStatus: 'PENDING',
    initiatedBy: adminId,
    sourceService: 'payment-service',
    refundOfTransactionId: original.id,
    metadata: { reason },
  });

  if (!affordable) {
    await transactionRepository.markFailed(refundTxn.id);
    return res.status(409).json({
      success: false,
      error: { code: 'INSUFFICIENT_REFUND_FUNDS' },
      data: { transactionId: refundTxn.id, status: 'FAILED' },
    });
  }

  try {
    await walletService.reverseTransfer({
      payerWalletId: original.payerWalletId,
      receiverWalletId: original.receiverWalletId,
      amount: new Prisma.Decimal(original.amount),
      commissionAmount: commission.platformFeeAmount,
      refundTransactionId: refundTxn.id,
      originalTransactionId: original.id,
      platformCommissionId: commission.id,
    });
  } catch (err) {
    logger.error({ error: 'Refund reversal failed', transactionId: refundTxn.id, message: (err as Error).message });
    await transactionRepository.markFailed(refundTxn.id);
    return res.status(500).json({ success: false, error: { code: 'REFUND_FAILED' }, data: { transactionId: refundTxn.id, status: 'FAILED' } });
  }

  // Ledger reversal succeeded and both transactions have flipped (PAID / REFUNDED) — now
  // synchronously call the matching cancel-after-refund endpoint. If this call fails, the
  // money side is already correct and final; the refund-cancellation reconciliation poll
  // (§1.4) will retry until the entity is actually cancelled.
  try {
    const body = { originalTransactionId: original.id, refundTransactionId: refundTxn.id };
    const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };
    const url = original.relatedEntityType === 'GYM_MEMBERSHIP'
      ? `${GYM_SERVICE_URL}/internal/gym-memberships/${original.relatedEntityId}/cancel-after-refund`
      : `${USER_SERVICE_URL}/internal/contracts/${original.relatedEntityId}/cancel-after-refund`;
    await axios.post(url, body, { headers, timeout: 10_000 });
    await transactionRepository.markActivated(refundTxn.id);
  } catch (err) {
    logger.warn({ error: 'cancel-after-refund call failed, reconciliation will retry', transactionId: refundTxn.id, message: (err as Error).message });
  }

  return res.json({ success: true, data: { transactionId: refundTxn.id, status: 'PAID' } });
});

// POST /admin/payments/:transactionId/retry-activation — manual retry for a transaction
// that exceeded the reconciliation job's automatic retry cap (§1.4). Reuses the same
// idempotent activate / cancel-after-refund endpoints the reconciliation job itself calls.
router.post('/:transactionId/retry-activation', async (req: Request, res: Response) => {
  const txn = await transactionRepository.findById(req.params.transactionId);
  if (!txn) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (txn.status !== 'PAID' || txn.activationStatus === 'ACTIVATED') {
    return res.status(400).json({ success: false, error: { code: 'NOTHING_TO_RETRY' } });
  }

  const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };
  try {
    if (txn.purpose === 'REFUND') {
      const body = { originalTransactionId: txn.refundOfTransactionId, refundTransactionId: txn.id };
      const url = txn.relatedEntityType === 'GYM_MEMBERSHIP'
        ? `${GYM_SERVICE_URL}/internal/gym-memberships/${txn.relatedEntityId}/cancel-after-refund`
        : `${USER_SERVICE_URL}/internal/contracts/${txn.relatedEntityId}/cancel-after-refund`;
      await axios.post(url, body, { headers, timeout: 10_000 });
    } else {
      const body = { transactionId: txn.id };
      const url = txn.relatedEntityType === 'GYM_MEMBERSHIP'
        ? `${GYM_SERVICE_URL}/internal/gym-memberships/${txn.relatedEntityId}/activate`
        : `${USER_SERVICE_URL}/internal/contracts/${txn.relatedEntityId}/activate-after-payment`;
      await axios.post(url, body, { headers, timeout: 10_000 });
    }
    await transactionRepository.markActivated(txn.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error({ error: 'Manual retry-activation failed', transactionId: txn.id, message: (err as Error).message });
    return res.status(502).json({ success: false, error: { code: 'RETRY_FAILED', message: (err as Error).message } });
  }
});

export default router;
