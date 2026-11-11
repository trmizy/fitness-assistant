import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { transactionRepository } from '../repositories/transaction.repository';
import { walletService } from '../services/wallet.service';
import { computeFingerprint, checkIdempotency } from '../utils/idempotency';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { Prisma } from '../generated/prisma';
import { buildReconciliationReport, runAndRecordAdminReconciliation, ReconciliationTooSoonError, listReconciliationRuns, reconciliationRunsQuerySchema } from '../services/reconcile.service';
import { buildFinanceOverview, isFinanceGroupBy } from '../services/finance-report.service';
import { parseWithdrawalStatusFilter } from '../utils/withdrawal-status-filter';
import { withdrawalService } from '../services/withdrawal.service';
import { postServiceJson } from '../clients/service-lambda.client';
import adminObligationsRoutes from './admin-obligations.routes';
import { assertRefundNotBypassingCase, RefundGuardError } from '../services/refund-case-guard';
import { sendAdminWriteError } from '../utils/admin-error';
import { adminTransactionsQuerySchema, adminTransactionsService, isUuid } from '../services/admin-transactions.service';

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

// FH-4 part 2 - read-only obligations report (must stay above the '/:id/...' routes below).
router.use('/obligations', adminObligationsRoutes);

// BE-1 (G-04 / G-05 / G-14) - read-only finance transaction list + detail (whitelisted DTOs, see admin-transactions.service.ts).
// Registered before every '/:id/...' route below so these static paths can never be shadowed. Error body: { error, code }.
router.get('/transactions', async (req: Request, res: Response) => {
  const parsed = adminTransactionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Tham số truy vấn không hợp lệ.', code: 'INVALID_QUERY' });
  }
  try {
    return res.json(await adminTransactionsService.list(parsed.data));
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] admin transactions list failed');
    return res.status(500).json({ error: 'Không tải được danh sách giao dịch.', code: 'TRANSACTIONS_LIST_FAILED' });
  }
});

router.get('/transactions/:id', async (req: Request, res: Response) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Mã giao dịch không hợp lệ.', code: 'INVALID_ID' });
  }
  try {
    const detail = await adminTransactionsService.detail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Không tìm thấy giao dịch.', code: 'TRANSACTION_NOT_FOUND' });
    return res.json(detail);
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] admin transaction detail failed');
    return res.status(500).json({ error: 'Không tải được chi tiết giao dịch.', code: 'TRANSACTION_DETAIL_FAILED' });
  }
});

// GET /admin/payments — real transaction list (was a hardcoded empty array
// regardless of what data actually existed).
router.get('/', async (_req: Request, res: Response) => {
  const transactions = await transactionRepository.findRecent(200);
  res.json({ success: true, data: transactions });
});

// GET /admin/payments/gateway-discrepancies — gateway callbacks whose amount did not match the transaction's
// price. Nothing was settled for these (no escrow credit, no activation); each needs a manual decision (refund the
// payer at the gateway, or reconcile). metadata.gatewayDiscrepancy holds expected vs reported amount, the source
// (IPN / RETURN / POLL), VNPay's transaction number and an occurrence count.
router.get('/gateway-discrepancies', async (_req: Request, res: Response) => {
  const transactions = await transactionRepository.findWithGatewayDiscrepancy(200);
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
 * READ ONLY and contract-stable (the gateway dashboard, mobile and the E2E suite read `body.data`): 200 when balanced,
 * 409 when not, body { success, data: report }. It writes nothing; recording a run is POST /reconciliation/runs below.
 */
router.get('/reconciliation', async (_req: Request, res: Response) => {
  const report = await buildReconciliationReport();
  return res.status(report.balanced ? 200 : 409).json({ success: report.balanced, data: report });
});

/**
 * GET /admin/payments/reconciliation/runs?limit&offset&status — history of the recorded checks (newest first).
 * Registered before every '/:id/...' route. Read-only; amounts are decimal strings.
 */
router.get('/reconciliation/runs', async (req: Request, res: Response) => {
  const parsed = reconciliationRunsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Tham số truy vấn không hợp lệ.', code: 'INVALID_QUERY' });
  }
  try {
    return res.json(await listReconciliationRuns(parsed.data));
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] admin reconciliation runs failed');
    return res.status(500).json({ error: 'Không tải được lịch sử đối soát.', code: 'RECONCILIATION_RUNS_FAILED' });
  }
});

/**
 * POST /admin/payments/reconciliation/runs — "run the check and save it" (the only write of the reconciliation screen; it never
 * touches money). No body. Records ONE run, trigger ADMIN, triggeredBy = the verified token's user.
 * 201 { run } | 400 INVALID_BODY | 429 RECONCILIATION_RUN_TOO_SOON (same admin, < 30 s since their last run; nothing is run)
 * | 500 RECONCILIATION_FAILED (an ERROR run is recorded when possible).
 */
router.post('/reconciliation/runs', async (req: Request, res: Response) => {
  const body = req.body as unknown;
  const bodyKeys = body && typeof body === 'object' ? Object.keys(body as object).length : 0;
  const rawLen = Number(req.headers['content-length'] ?? 0);
  if (bodyKeys > 0 || (body !== undefined && body !== null && typeof body !== 'object') || rawLen > 2) {
    return res.status(400).json({ error: 'Yêu cầu này không nhận nội dung kèm theo.', code: 'INVALID_BODY' });
  }
  try {
    const run = await runAndRecordAdminReconciliation(req.user!.userId);
    return res.status(201).json({ run });
  } catch (err) {
    if (err instanceof ReconciliationTooSoonError) {
      return res.status(429).json({ error: 'Vừa chạy đối soát xong, thử lại sau ít giây.', code: 'RECONCILIATION_RUN_TOO_SOON' });
    }
    logger.error({ err: (err as Error).message }, '[payment-service] admin reconciliation run failed');
    return res.status(500).json({ error: 'Không chạy được đối soát sổ ví.', code: 'RECONCILIATION_FAILED' });
  }
});

/**
 * GET /admin/payments/finance-overview?groupBy=day|week|month|quarter|year&from=ISO&to=ISO
 *
 * Admin "Tài chính" → tab Tổng quan: thu/chi/doanh thu ròng theo khoảng thời gian, gộp theo
 * ngày/tuần/tháng/quý. `from`/`to` default to the last 30 days when omitted so the tab has a
 * sensible chart on first load.
 */
router.get('/finance-overview', async (req: Request, res: Response) => {
  const rawGroupBy = req.query.groupBy;
  if (rawGroupBy !== undefined && !isFinanceGroupBy(rawGroupBy)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_GROUP_BY', message: 'groupBy không hợp lệ — chỉ nhận day, week, month, quarter hoặc year' } });
  }
  const groupBy = rawGroupBy === undefined ? 'day' : rawGroupBy;
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_RANGE', message: 'from phải trước to và cả hai phải là ngày hợp lệ' } });
  }

  const report = await buildFinanceOverview({ from, to, groupBy });
  return res.json({ success: true, data: report });
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
router.get('/withdrawals', async (req: Request, res: Response) => {
  const parsed = parseWithdrawalStatusFilter(req.query.status);
  if (!parsed.ok) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS_FILTER', message: 'Trạng thái lọc không hợp lệ — chỉ nhận PENDING, APPROVED, PAID hoặc REJECTED' } });
  }
  // No status param keeps the original queue (PENDING + APPROVED).
  const list = parsed.status ? await withdrawalService.listByStatus(parsed.status) : await withdrawalService.listPending();
  return res.json({ success: true, data: list });
});

const reviewSchema = z.object({ reason: z.string().min(1).optional() });
const markPaidSchema = z.object({ bankReference: z.string().min(1) });

router.post('/withdrawals/:id/approve', async (req: Request, res: Response) => {
  try {
    const updated = await withdrawalService.approve(req.params.id, req.user!.userId);
    res.json({ success: true, data: updated });
  } catch (e) {
    sendAdminWriteError(res, e, 'withdrawal.approve');
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
    return sendAdminWriteError(res, e, 'withdrawal.reject');
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
    return sendAdminWriteError(res, e, 'withdrawal.mark-paid');
  }
});

// E6 / F1: the acting admin is the VERIFIED TOKEN's user (req.user.userId), never a body field: a body `adminId` (or any other extra field) is refused 400.
const refundSchema = z
  .object({
    reason: z.string().min(1),
  })
  .strict();

// POST /admin/payments/:id/refund — payment-service is the single source of truth for
// refund/ledger/commission logic; gym-service and user-service never reimplement this,
// they only call this endpoint (see plan §5, §2.2).
router.post('/:id/refund', async (req: Request, res: Response) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const { reason } = parsed.data;
  const adminId = req.user!.userId; // requireAuth + requireRoles('ADMIN') ran above: this is the verified identity
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

  // E6 / F2: a refund must not bypass a dispute Case. The owning service is asked (read-only) BEFORE anything is written; its 409 is returned as is, and an owner that does not answer REFUSES the refund.
  try {
    await assertRefundNotBypassingCase(original);
  } catch (e) {
    if (e instanceof RefundGuardError) {
      return res.status(e.status).json({ success: false, error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) } });
    }
    throw e;
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
    if (original.relatedEntityType === 'GYM_MEMBERSHIP') {
      await postServiceJson({
        service: 'gym',
        path: `/internal/gym-memberships/${original.relatedEntityId}/cancel-after-refund`,
        body,
        headers,
      });
    } else {
      await postServiceJson({
        service: 'user',
        path: `/internal/contracts/${original.relatedEntityId}/cancel-after-refund`,
        body,
        headers,
      });
    }
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
      if (txn.relatedEntityType === 'GYM_MEMBERSHIP') {
        await postServiceJson({
          service: 'gym',
          path: `/internal/gym-memberships/${txn.relatedEntityId}/cancel-after-refund`,
          body,
          headers,
        });
      } else {
        await postServiceJson({
          service: 'user',
          path: `/internal/contracts/${txn.relatedEntityId}/cancel-after-refund`,
          body,
          headers,
        });
      }
    } else {
      const body = { transactionId: txn.id };
      if (txn.relatedEntityType === 'GYM_MEMBERSHIP') {
        await postServiceJson({
          service: 'gym',
          path: `/internal/gym-memberships/${txn.relatedEntityId}/activate`,
          body,
          headers,
        });
      } else if (txn.relatedEntityType === 'PT_CONTRACT') {
        // Same handling as the webhook and the reconcile sweep — user-service's definite
        // "cannot be activated" answer refunds the client instead of being marked activated
        // (activateOrRefund marks the transaction itself, in both outcomes).
        const { activateOrRefund } = await import('../services/reconciliation.service');
        const outcome = await activateOrRefund(txn);
        return res.json({ success: true, data: { outcome } });
      } else {
        await postServiceJson({
          service: 'user',
          path: `/internal/contracts/${txn.relatedEntityId}/activate-after-payment`,
          body,
          headers,
        });
      }
    }
    await transactionRepository.markActivated(txn.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error({ error: 'Manual retry-activation failed', transactionId: txn.id, message: (err as Error).message });
    return res.status(502).json({ success: false, error: { code: 'RETRY_FAILED', message: (err as Error).message } });
  }
});

export default router;
