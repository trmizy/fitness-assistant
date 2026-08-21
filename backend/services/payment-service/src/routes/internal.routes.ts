import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { transactionRepository } from '../repositories/transaction.repository';
import { walletService, InsufficientBalanceError, WalletNotActiveError } from '../services/wallet.service';
import { getProvider, providerConfigStatus, DEFAULT_PROVIDER } from '../services/payment.service';
import { assertRatesValid, buildMoneyBreakdown, type RateTable } from '../services/contract-money';
import { compensateNoShow, releaseSession, terminateContract } from '../services/contract-ledger.service';
import {
  settleMembershipReferral,
  clawbackMembershipReferral,
  releaseMembershipPending,
} from '../services/membership-ledger.service';
import { computeFingerprint, checkIdempotency } from '../utils/idempotency';
import { WalletOwnerType, PartnerType, PaymentProviderType, Prisma } from '../generated/prisma';

const router = Router();
router.use(serviceSecretMiddleware);

const DEFAULT_COMMISSION_RATE = Number(process.env.PLATFORM_COMMISSION_RATE ?? '0.10');

const walletTransferSchema = z.object({
  payerOwnerType: z.nativeEnum(WalletOwnerType),
  payerOwnerId: z.string().min(1),
  receiverOwnerType: z.nativeEnum(WalletOwnerType),
  receiverOwnerId: z.string().min(1),
  amount: z.number().positive(),
  commissionRate: z.number().min(0).max(1).optional(),
  purpose: z.enum(['GYM_MEMBERSHIP', 'PT_CONTRACT', 'TRAINING_PACKAGE_PURCHASE', 'PERSONALIZED_SERVICE_PURCHASE']),
  relatedEntityType: z.enum(['GYM_MEMBERSHIP', 'PT_CONTRACT', 'TRAINING_PACKAGE_PURCHASE', 'PERSONALIZED_SERVICE_PURCHASE']),
  relatedEntityId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  initiatedBy: z.string().min(1),
  sourceService: z.string().min(1),
  gymId: z.string().optional(),
  ptId: z.string().optional(),
  membershipId: z.string().optional(),
  ptContractId: z.string().optional(),
});

function statusResponse(txn: { id: string; status: string; failedAt?: Date | null }) {
  return {
    status: txn.status === 'PAID' ? 'PAID' as const : 'FAILED' as const,
    transactionId: txn.id,
  };
}

// POST /internal/payments/wallet-transfer
router.post('/payments/wallet-transfer', async (req: Request, res: Response) => {
  const parsed = walletTransferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const data = parsed.data;

  const fingerprint = computeFingerprint({
    amount: data.amount,
    currency: 'VND',
    purpose: data.purpose,
    payerOwnerType: data.payerOwnerType,
    payerOwnerId: data.payerOwnerId,
    receiverOwnerType: data.receiverOwnerType,
    receiverOwnerId: data.receiverOwnerId,
    relatedEntityType: data.relatedEntityType,
    relatedEntityId: data.relatedEntityId,
  });

  // Everything up to and including transactionRepository.create() previously ran
  // outside any try/catch — a DB-level error there (e.g. an enum value the running
  // process's Prisma client didn't yet know about) became an unhandled rejection
  // that crashed the whole service instead of returning a 500. Wrapping the full
  // handler body closes that gap.
  let txn: Awaited<ReturnType<typeof transactionRepository.create>>;
  try {
    const check = await checkIdempotency(data.idempotencyKey, fingerprint);
    if (check.kind === 'CONFLICT') {
      return res.status(409).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    }
    if (check.kind === 'REPLAY') {
      return res.json({ success: true, data: statusResponse(check.transaction) });
    }

    const payerWallet = await walletService.getOrCreateWallet(data.payerOwnerType, data.payerOwnerId);
    const receiverWallet = await walletService.getOrCreateWallet(data.receiverOwnerType, data.receiverOwnerId);

    txn = await transactionRepository.create({
      payerId: data.payerOwnerId,
      purpose: data.purpose,
      gymId: data.gymId,
      ptId: data.ptId,
      membershipId: data.membershipId,
      ptContractId: data.ptContractId,
      amount: data.amount,
      currency: 'VND',
      status: 'PROCESSING',
      idempotencyKey: data.idempotencyKey,
      requestFingerprint: fingerprint,
      payerWalletId: payerWallet.id,
      receiverWalletId: receiverWallet.id,
      relatedEntityType: data.relatedEntityType,
      relatedEntityId: data.relatedEntityId,
      activationStatus: 'PENDING',
      initiatedBy: data.initiatedBy,
      sourceService: data.sourceService,
    });

    const commissionRate = new Prisma.Decimal(data.commissionRate ?? DEFAULT_COMMISSION_RATE);
    const partnerType: PartnerType =
      data.receiverOwnerType === 'GYM' ? 'GYM' : data.receiverOwnerType === 'PT' ? 'PT' : 'CLIENT';

    await walletService.transferInternal({
      payerWalletId: payerWallet.id,
      receiverWalletId: receiverWallet.id,
      amount: new Prisma.Decimal(data.amount),
      commissionRate,
      transactionId: txn.id,
      partnerType,
      partnerId: data.receiverOwnerId,
    });
    const updated = await transactionRepository.findById(txn.id);
    return res.json({ success: true, data: statusResponse(updated!) });
  } catch (err) {
    if (!txn!) {
      logger.error({ error: 'wallet-transfer failed before transaction row was created', message: (err as Error).message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
    }
    const isBusinessError = err instanceof InsufficientBalanceError || err instanceof WalletNotActiveError;
    if (!isBusinessError) {
      logger.error({ error: 'wallet-transfer failed', message: (err as Error).message, transactionId: txn.id });
    }
    await transactionRepository.markFailed(txn.id);
    return res.json({
      success: true,
      data: { status: 'FAILED' as const, transactionId: txn.id, failureReason: (err as Error).message },
    });
  }
});

const round2 = (n: number) => Math.round(n * 100) / 100;

const refundSchema = z.object({
  refundAmount: z.number().positive(),
  initiatedBy: z.string().min(1),
  reason: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

// POST /internal/payments/:id/refund — partial (prorated) refund initiated by a service on the
// user's behalf (e.g. gym-service when a client cancels a membership early). Same ledger-reversal
// engine as the admin full-refund, but the caller passes the exact gross amount to return; the
// commission portion is prorated at the original transaction's commission rate. reverseTransfer
// runs the whole reversal (credit payer, debit receiver + platform, flip original → REFUNDED) in
// one DB transaction with the wallets locked FOR UPDATE.
router.post('/payments/:id/refund', async (req: Request, res: Response) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const { refundAmount, initiatedBy, reason, idempotencyKey } = parsed.data;

  const original = await transactionRepository.findById(req.params.id);
  if (!original) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (original.status !== 'PAID') {
    const code = original.status === 'REFUNDED' ? 'ALREADY_REFUNDED' : 'NOT_REFUNDABLE';
    return res.status(409).json({ success: false, error: { code } });
  }
  if (!original.payerWalletId || !original.receiverWalletId) {
    return res.status(400).json({ success: false, error: { code: 'NOT_REFUNDABLE', message: 'Original has no wallet references' } });
  }
  if (refundAmount > Number(original.amount) + 0.001) {
    return res.status(400).json({ success: false, error: { code: 'REFUND_EXCEEDS_ORIGINAL' } });
  }

  const commission = await transactionRepository.findCommissionByTransactionId(original.id);
  if (!commission) return res.status(500).json({ success: false, error: { code: 'MISSING_COMMISSION_RECORD' } });

  const rate = Number(commission.commissionRate);
  const commissionAmount = round2(refundAmount * rate);
  const netToReceiver = round2(refundAmount - commissionAmount);

  const fingerprint = computeFingerprint({ originalTransactionId: original.id, refundAmount, initiatedBy });
  const check = await checkIdempotency(idempotencyKey, fingerprint);
  if (check.kind === 'CONFLICT') return res.status(409).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  if (check.kind === 'REPLAY') {
    return res.json({ success: true, data: { transactionId: check.transaction.id, status: check.transaction.status, refundAmount } });
  }

  const affordable = await walletService.checkRefundAffordable(
    original.receiverWalletId,
    new Prisma.Decimal(netToReceiver),
    new Prisma.Decimal(commissionAmount),
  );

  const refundTxn = await transactionRepository.create({
    payerId: original.payerId,
    purpose: 'REFUND',
    gymId: original.gymId,
    ptId: original.ptId,
    membershipId: original.membershipId,
    ptContractId: original.ptContractId,
    amount: refundAmount,
    currency: original.currency,
    status: 'PROCESSING',
    idempotencyKey,
    requestFingerprint: fingerprint,
    payerWalletId: original.payerWalletId,
    receiverWalletId: original.receiverWalletId,
    relatedEntityType: original.relatedEntityType,
    relatedEntityId: original.relatedEntityId,
    activationStatus: 'PENDING',
    initiatedBy,
    sourceService: 'payment-service',
    refundOfTransactionId: original.id,
    metadata: { reason, partialRefund: true, originalAmount: Number(original.amount) },
  });

  if (!affordable) {
    await transactionRepository.markFailed(refundTxn.id);
    return res.status(409).json({ success: false, error: { code: 'INSUFFICIENT_REFUND_FUNDS' }, data: { transactionId: refundTxn.id, status: 'FAILED' } });
  }

  try {
    await walletService.reverseTransfer({
      payerWalletId: original.payerWalletId,
      receiverWalletId: original.receiverWalletId,
      amount: new Prisma.Decimal(refundAmount),
      commissionAmount: new Prisma.Decimal(commissionAmount),
      refundTransactionId: refundTxn.id,
      originalTransactionId: original.id,
      platformCommissionId: commission.id,
    });
  } catch (err) {
    logger.error({ error: 'Partial refund reversal failed', transactionId: refundTxn.id, message: (err as Error).message });
    await transactionRepository.markFailed(refundTxn.id);
    return res.status(500).json({ success: false, error: { code: 'REFUND_FAILED' }, data: { transactionId: refundTxn.id, status: 'FAILED' } });
  }

  // The initiating service (gym-service) cancels the membership itself, so no cancel-after-refund
  // callback is needed here.
  await transactionRepository.markActivated(refundTxn.id);
  return res.json({ success: true, data: { transactionId: refundTxn.id, status: 'PAID', refundAmount, commissionAmount, netToReceiver } });
});

// ── Direct-to-gateway contract money (money-flow redesign) ───────────────────

const rateSchema = z.object({
  platformRate: z.string().min(1),
  ptRate: z.string().min(1),
  gymRate: z.string().min(1),
});

const partiesSchema = z.object({
  ptUserId: z.string().min(1),
  gymId: z.string().nullish(),
  clientUserId: z.string().min(1),
});

function toRates(r: z.infer<typeof rateSchema>): RateTable {
  const rates = {
    platformRate: new Prisma.Decimal(r.platformRate),
    ptRate: new Prisma.Decimal(r.ptRate),
    gymRate: new Prisma.Decimal(r.gymRate),
  };
  assertRatesValid(rates);
  return rates;
}

function ratesFromMetadata(metadata: unknown): RateTable {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const r = m.rates as Record<string, string> | undefined;
  if (!r) throw new Error('transaction carries no rate snapshot');
  return toRates(rateSchema.parse(r));
}

const checkoutSchema = z.object({
  purpose: z.enum(['PT_CONTRACT', 'GYM_MEMBERSHIP', 'TRAINING_PACKAGE_PURCHASE']),
  relatedEntityType: z.enum(['PT_CONTRACT', 'GYM_MEMBERSHIP', 'TRAINING_PACKAGE_PURCHASE']),
  relatedEntityId: z.string().min(1),
  amount: z.number().positive(),
  rates: rateSchema,
  parties: partiesSchema,
  idempotencyKey: z.string().min(1),
  initiatedBy: z.string().min(1),
  sourceService: z.string().min(1),
  provider: z.enum(['VNPAY', 'MOMO', 'ZALOPAY', 'PAYOS']).optional(),
  orderInfo: z.string().optional(),
});

/**
 * POST /internal/payments/checkout — start a purchase at a payment gateway.
 *
 * Replaces the old wallet-to-wallet transfer. The client pays the gateway directly; nothing
 * moves in the ledger until the signed webhook confirms it (see handleContractSettlement).
 *
 * The rate table and the parties are frozen into the transaction's metadata here rather than
 * looked up at settlement time. Settlement can arrive minutes later — or be replayed days
 * later during reconciliation — and it must split the money on the terms that were in force
 * when the client agreed to pay, not whatever the collaboration says by then.
 */
router.post('/payments/checkout', async (req: Request, res: Response) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;

  let rates: RateTable;
  try {
    rates = toRates(d.rates);
  } catch (e) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_RATE_TABLE', message: (e as Error).message } });
  }
  if (rates.gymRate.greaterThan(0) && !d.parties.gymId) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_RATE_TABLE', message: 'gymRate > 0 but no gymId was supplied' },
    });
  }

  const providerName = (d.provider ?? process.env.PAYMENT_PROVIDER ?? DEFAULT_PROVIDER).toUpperCase();
  const providerConfig = providerConfigStatus(providerName);
  if (!providerConfig.configured) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `Payment provider ${providerName} is not configured — missing env: ${providerConfig.missing.join(', ')}`,
      },
    });
  }

  const fingerprint = computeFingerprint({
    amount: d.amount, currency: 'VND', purpose: d.purpose,
    relatedEntityType: d.relatedEntityType, relatedEntityId: d.relatedEntityId,
    payerId: d.parties.clientUserId,
  });
  const check = await checkIdempotency(d.idempotencyKey, fingerprint);
  if (check.kind === 'CONFLICT') return res.status(409).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  if (check.kind === 'REPLAY') {
    const t = check.transaction as { id: string; status: string; metadata?: unknown };
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    return res.json({
      success: true,
      data: { transactionId: t.id, status: t.status, redirectUrl: meta.redirectUrl ?? null, qrCodeUrl: meta.qrCodeUrl ?? null },
    });
  }

  const txnId = randomUUID();
  try {
    const provider = getProvider(providerName);
    const intent = await provider.createPaymentIntent({
      transactionId: txnId,
      amount: Math.round(d.amount),
      orderInfo: d.orderInfo ?? `${d.purpose} ${d.relatedEntityId}`,
    });

    const txn = await transactionRepository.create({
      id: txnId,
      payerId: d.parties.clientUserId,
      purpose: d.purpose,
      gymId: d.parties.gymId ?? undefined,
      ptId: d.parties.ptUserId,
      ptContractId: d.purpose === 'PT_CONTRACT' ? d.relatedEntityId : undefined,
      membershipId: d.purpose === 'GYM_MEMBERSHIP' ? d.relatedEntityId : undefined,
      amount: d.amount,
      currency: 'VND',
      status: 'PENDING',
      provider: providerName as PaymentProviderType,
      providerTransactionId: intent.providerTransactionId,
      idempotencyKey: d.idempotencyKey,
      requestFingerprint: fingerprint,
      relatedEntityType: d.relatedEntityType,
      relatedEntityId: d.relatedEntityId,
      activationStatus: 'PENDING',
      initiatedBy: d.initiatedBy,
      sourceService: d.sourceService,
      metadata: {
        ...(intent.metadata ?? {}),
        rates: { platformRate: rates.platformRate.toString(), ptRate: rates.ptRate.toString(), gymRate: rates.gymRate.toString() },
        parties: { ptUserId: d.parties.ptUserId, gymId: d.parties.gymId ?? null, clientUserId: d.parties.clientUserId },
        redirectUrl: intent.redirectUrl,
        qrCodeUrl: intent.qrCodeUrl,
      } as Prisma.InputJsonValue,
    });

    return res.status(201).json({
      success: true,
      data: { transactionId: txn.id, status: txn.status, redirectUrl: intent.redirectUrl, qrCodeUrl: intent.qrCodeUrl, provider: providerName },
    });
  } catch (err) {
    logger.error({ error: 'checkout failed', relatedEntityId: d.relatedEntityId, message: (err as Error).message });
    return res.status(502).json({ success: false, error: { code: 'GATEWAY_ERROR', message: (err as Error).message } });
  }
});

const releaseSchema = z.object({
  transactionId: z.string().min(1),
  price: z.string().min(1),
  totalSessions: z.number().int().positive(),
  rates: rateSchema,
  parties: partiesSchema,
  label: z.string().min(1),
});

// POST /internal/contracts/release-session — one confirmed session's worth of money moves
// from every party's pending bucket to their available bucket.
router.post('/contracts/release-session', async (req: Request, res: Response) => {
  const parsed = releaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await releaseSession({
      transactionId: d.transactionId,
      price: new Prisma.Decimal(d.price),
      totalSessions: d.totalSessions,
      rates: toRates(d.rates),
      parties: d.parties,
      label: d.label,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'release-session failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'RELEASE_FAILED', message: (err as Error).message } });
  }
});

// POST /internal/contracts/no-show — the PT missed a session; compensate the client one
// session's value, charged to the three parties in proportion.
router.post('/contracts/no-show', async (req: Request, res: Response) => {
  const parsed = releaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await compensateNoShow({
      transactionId: d.transactionId,
      price: new Prisma.Decimal(d.price),
      totalSessions: d.totalSessions,
      rates: toRates(d.rates),
      parties: d.parties,
      label: d.label,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'no-show compensation failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'COMPENSATION_FAILED', message: (err as Error).message } });
  }
});

const terminateSchema = releaseSchema.extend({
  usedSessions: z.number().int().min(0),
  reason: z.enum(['CLIENT_CANCELLED', 'PT_BANNED', 'PT_CANCELLED', 'MUTUAL', 'EXPIRED', 'COMPLETED']),
  alreadyReleased: z.object({ pt: z.string(), gym: z.string(), platform: z.string() }),
});

// POST /internal/contracts/terminate — settle everyone to their final entitlement and refund
// the client per the reason's formula.
router.post('/contracts/terminate', async (req: Request, res: Response) => {
  const parsed = terminateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await terminateContract({
      transactionId: d.transactionId,
      price: new Prisma.Decimal(d.price),
      totalSessions: d.totalSessions,
      usedSessions: d.usedSessions,
      rates: toRates(d.rates),
      reason: d.reason,
      alreadyReleased: {
        pt: new Prisma.Decimal(d.alreadyReleased.pt),
        gym: new Prisma.Decimal(d.alreadyReleased.gym),
        platform: new Prisma.Decimal(d.alreadyReleased.platform),
      },
      parties: d.parties,
      label: d.label,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'termination failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'TERMINATION_FAILED', message: (err as Error).message } });
  }
});

// POST /internal/contracts/money-breakdown — pure calculation, no side effects. Lets a caller
// preview what a cancellation would cost before committing to it.
router.post('/contracts/money-breakdown', async (req: Request, res: Response) => {
  const schema = z.object({
    price: z.string().min(1),
    totalSessions: z.number().int().positive(),
    usedSessions: z.number().int().min(0),
    rates: rateSchema,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  try {
    return res.json({
      success: true,
      data: buildMoneyBreakdown({
        price: new Prisma.Decimal(parsed.data.price),
        totalSessions: parsed.data.totalSessions,
        usedSessions: parsed.data.usedSessions,
        rates: toRates(parsed.data.rates),
      }),
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: (err as Error).message } });
  }
});

export { ratesFromMetadata };

// ── Gym membership referral commission (money-flow plan §2.2) ────────────────

const referralSettleSchema = z.object({
  transactionId: z.string().min(1),
  gymId: z.string().min(1),
  ptUserId: z.string().min(1),
  amount: z.string().min(1),
  label: z.string().min(1),
});

// POST /internal/contracts/referral — ① move a referral commission from the gym's pending
// bucket to the referring PT's pending bucket. Called once, at membership activation.
router.post('/contracts/referral', async (req: Request, res: Response) => {
  const parsed = referralSettleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await settleMembershipReferral({
      transactionId: d.transactionId,
      gymId: d.gymId,
      ptUserId: d.ptUserId,
      amount: new Prisma.Decimal(d.amount),
      label: d.label,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'referral settlement failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'REFERRAL_SETTLE_FAILED', message: (err as Error).message } });
  }
});

// POST /internal/contracts/referral/clawback — ② an admin refund is reversing part of a
// membership; reclaim the matching share of referral commission from the PT.
router.post('/contracts/referral/clawback', async (req: Request, res: Response) => {
  const parsed = referralSettleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await clawbackMembershipReferral({
      transactionId: d.transactionId,
      gymId: d.gymId,
      ptUserId: d.ptUserId,
      amount: new Prisma.Decimal(d.amount),
      label: d.label,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'referral clawback failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'REFERRAL_CLAWBACK_FAILED', message: (err as Error).message } });
  }
});

const membershipReleaseSchema = z.object({
  transactionId: z.string().min(1),
  gymId: z.string().min(1),
  clientId: z.string().min(1),
  ptUserId: z.string().nullish(),
  refundToClient: z.string().default('0'),
  // F4: the caller must explicitly state which terminal state justifies this release. Both
  // endpoints below fix their own literal value — a gym-service bug that calls this while a
  // membership is still ACTIVE would have to lie about the state to get past this, which is
  // the backstop the plan's F4 asked for (payment-service cannot see gym-service's own DB).
  membershipStatus: z.enum(['CANCELLED', 'EXPIRED']),
  label: z.string().min(1),
});

async function handleMembershipRelease(req: Request, res: Response) {
  const parsed = membershipReleaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await releaseMembershipPending({
      transactionId: d.transactionId,
      gymId: d.gymId,
      clientId: d.clientId,
      ptUserId: d.ptUserId,
      refundToClient: new Prisma.Decimal(d.refundToClient),
      label: d.label,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'membership release failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'MEMBERSHIP_RELEASE_FAILED', message: (err as Error).message } });
  }
}

// POST /internal/contracts/membership-release — ③ natural expiry (refundToClient=0) or the
// tail end of an admin refund (called after ② clawback, refundToClient = the admin's
// proration). Only CANCELLED/EXPIRED memberships may reach here (F4).
router.post('/contracts/membership-release', handleMembershipRelease);

// POST /internal/contracts/membership-cancel-forfeit — ④ the client cancelled their own
// membership. Same underlying release, always refundToClient=0 (money-flow plan §2.4: no
// money moves to the client on a self-cancel), and no referral clawback ever precedes it.
router.post('/contracts/membership-cancel-forfeit', handleMembershipRelease);

// POST /internal/payments/:transactionId/mark-activated
router.post('/payments/:transactionId/mark-activated', async (req: Request, res: Response) => {
  const txn = await transactionRepository.findById(req.params.transactionId);
  if (!txn) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  await transactionRepository.markActivated(txn.id);
  return res.json({ success: true });
});

// GET /internal/payments/:transactionId — lookup used by gym-service/user-service to
// verify a transaction before activating/cancelling (never trust the caller blindly).
router.get('/payments/:transactionId', async (req: Request, res: Response) => {
  const txn = await transactionRepository.findById(req.params.transactionId);
  if (!txn) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  return res.json({ success: true, data: txn });
});

// GET /internal/wallets/:ownerType/:ownerId
router.get('/wallets/:ownerType/:ownerId', async (req: Request, res: Response) => {
  const ownerType = req.params.ownerType as WalletOwnerType;
  if (!Object.values(WalletOwnerType).includes(ownerType)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_OWNER_TYPE' } });
  }
  const wallet = await walletService.getOrCreateWallet(ownerType, req.params.ownerId);
  return res.json({ success: true, data: wallet });
});

export default router;
