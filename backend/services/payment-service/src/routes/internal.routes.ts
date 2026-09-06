import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { transactionRepository } from '../repositories/transaction.repository';
import { walletService, InsufficientBalanceError, WalletNotActiveError } from '../services/wallet.service';
import { getProvider, providerConfigStatus, DEFAULT_PROVIDER } from '../services/payment.service';
import { assertRatesValid, buildMoneyBreakdown, type RateTable } from '../services/contract-money';
import { compensateLateArrival, compensateNoShow, releaseSession, terminateContract } from '../services/contract-ledger.service';
import {
  settleMembershipReferral,
  clawbackMembershipReferral,
  releaseMembershipPending,
} from '../services/membership-ledger.service';
import { releaseOrder, refundOrder } from '../services/personalized-service-ledger.service';
import { computeFingerprint, checkIdempotency } from '../utils/idempotency';
import { withdrawalService } from '../services/withdrawal.service';
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
  // Cụm C2: Personalized Service purchase used a wallet-to-wallet transfer even though wallet
  // top-up is disabled — a client with a genuinely empty (post-topup-removal) wallet could
  // never buy. Added here so it goes through the SAME gateway-checkout pipeline PT_CONTRACT /
  // GYM_MEMBERSHIP already use — the client pays the gateway directly, nothing needs a
  // pre-funded wallet balance.
  purpose: z.enum(['PT_CONTRACT', 'GYM_MEMBERSHIP', 'TRAINING_PACKAGE_PURCHASE', 'PERSONALIZED_SERVICE_PURCHASE']),
  relatedEntityType: z.enum(['PT_CONTRACT', 'GYM_MEMBERSHIP', 'TRAINING_PACKAGE_PURCHASE', 'PERSONALIZED_SERVICE_PURCHASE']),
  relatedEntityId: z.string().min(1),
  amount: z.number().positive(),
  rates: rateSchema,
  parties: partiesSchema,
  idempotencyKey: z.string().min(1),
  initiatedBy: z.string().min(1),
  sourceService: z.string().min(1),
  provider: z.enum(['VNPAY', 'MOMO', 'ZALOPAY', 'PAYOS']).optional(),
  orderInfo: z.string().optional(),
  // Which return-URL the gateway's own return handler should send the payer's browser to
  // once it has settled the transaction — 'mobile' → the app's `fitnessassistant://` deep
  // link (already has a listener, see AppContext.tsx's appUrlOpen), 'web' (default) → the
  // existing FRONTEND_URL web result page. Persisted on the transaction now because by the
  // time the gateway calls back, the original request (and its Origin header) is long gone.
  platform: z.enum(['web', 'mobile']).optional(),
  // The gateway's own x-public-base-url, forwarded all the way down (see app.ts in the
  // gateway) — whatever host:port the payer's app/browser actually dialed to start this
  // checkout. Only VNPay reads it (its own return handler lives on THIS service, behind
  // whatever door the request came through — LAN IP, 10.0.2.2, or a cloudflared tunnel);
  // ZaloPay/PayOS redirect straight to `platform`'s destination without a hop back here.
  returnBaseUrl: z.string().url().optional(),
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
      platform: d.platform,
      returnBaseUrl: d.returnBaseUrl,
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
        platform: d.platform ?? 'web',
        // BUG FIX (2026-09-06): only ever read transiently, to build VNPay's FIRST-hop
        // effectiveReturnUrl (see vnpay.provider.ts), then discarded — VNPay's OWN return
        // handler (vnpay-return.routes.ts, on this service) does a SECOND redirect once it
        // has verified the callback, and that one fell back to the static .env FRONTEND_URL
        // unconditionally, since by then the original request (and this value) was long
        // gone. Same failure shape as the gateway/api-gateway "api-gateway:3000" redirect
        // bug this session already fixed, just one hop further down the VNPay-only chain.
        // Persisted here so the return handler can read the payer's REAL origin back,
        // exactly like it already does for `platform` above.
        returnBaseUrl: d.returnBaseUrl ?? null,
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
  // Money-flow redesign plan 1.1: SESSION_RELEASE:<sessionId> on /release-session,
  // PT_NO_SHOW:<sessionId> on /no-show — a retry with the same key replays instead of
  // moving money twice.
  idempotencyKey: z.string().min(1),
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
      idempotencyKey: d.idempotencyKey,
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
      idempotencyKey: d.idempotencyKey,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'no-show compensation failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'COMPENSATION_FAILED', message: (err as Error).message } });
  }
});

// POST /internal/contracts/late-arrival — open-room online session, PT joined after the
// grace window: half a no-show's compensation, client's entitlement untouched.
router.post('/contracts/late-arrival', async (req: Request, res: Response) => {
  const parsed = releaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await compensateLateArrival({
      transactionId: d.transactionId,
      price: new Prisma.Decimal(d.price),
      totalSessions: d.totalSessions,
      rates: toRates(d.rates),
      parties: d.parties,
      label: d.label,
      idempotencyKey: d.idempotencyKey,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'late-arrival compensation failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'COMPENSATION_FAILED', message: (err as Error).message } });
  }
});

const terminateSchema = releaseSchema.extend({
  usedSessions: z.number().int().min(0),
  // Cụm A1 — optional/defaulted so a caller that predates this field (there should be none
  // left, but defensive) does not 400.
  compensatedSessions: z.number().int().min(0).optional(),
  reason: z.enum(['CLIENT_CANCELLED', 'PT_BANNED', 'PT_CANCELLED', 'MUTUAL', 'EXPIRED', 'COMPLETED', 'PT_REPEATED_NO_SHOW']),
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
      compensatedSessions: d.compensatedSessions,
      rates: toRates(d.rates),
      reason: d.reason,
      alreadyReleased: {
        pt: new Prisma.Decimal(d.alreadyReleased.pt),
        gym: new Prisma.Decimal(d.alreadyReleased.gym),
        platform: new Prisma.Decimal(d.alreadyReleased.platform),
      },
      parties: d.parties,
      label: d.label,
      idempotencyKey: d.idempotencyKey,
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
    // Cụm A1 — without this, the preview shown before a cancel/refund never reflects sessions
    // already paid out as no-show compensation, disagreeing with what termination actually pays.
    compensatedSessions: z.number().int().min(0).optional(),
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
        compensatedSessions: parsed.data.compensatedSessions,
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
  // Money-flow redesign plan 1.1: MEMBERSHIP_REFERRAL:<membershipId> on /referral,
  // REFERRAL_CLAWBACK:<membershipId> on /referral/clawback.
  idempotencyKey: z.string().min(1),
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
      idempotencyKey: d.idempotencyKey,
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
      idempotencyKey: d.idempotencyKey,
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
  // P0 cluster E2: PENDING_ISSUE added — a membership whose gym was no longer APPROVED at
  // activation time never activates at all; this is the third terminal state that justifies
  // draining its pending straight back to the client.
  membershipStatus: z.enum(['CANCELLED', 'EXPIRED', 'PENDING_ISSUE']),
  label: z.string().min(1),
  // Money-flow redesign plan 1.1: MEMBERSHIP_RELEASE:<membershipId> — shared by both
  // /membership-release and /membership-cancel-forfeit, since a membership only ever
  // reaches one of those two terminal release paths, never both.
  idempotencyKey: z.string().min(1),
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
      idempotencyKey: d.idempotencyKey,
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

// Money-flow plan 5.3 — gym-service has no ledger logic of its own; it verifies gym
// ownership itself (see /owner/gyms/:gymId/withdrawals) and then calls straight through here,
// mirroring the existing /internal/wallets/GYM/:ownerId pattern above.
const internalWithdrawalRequestSchema = z.object({
  amount: z.string().min(1),
  payoutInfo: z.string().min(1),
});

router.post('/withdrawals/gym/:gymId', async (req: Request, res: Response) => {
  const parsed = internalWithdrawalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  try {
    const request = await withdrawalService.requestWithdrawal('GYM', req.params.gymId, parsed.data.amount, parsed.data.payoutInfo);
    return res.status(201).json({ success: true, data: request });
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    return res.status(err.status ?? 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/withdrawals/gym/:gymId', async (req: Request, res: Response) => {
  const list = await withdrawalService.listMine('GYM', req.params.gymId);
  return res.json({ success: true, data: list });
});

// ── Personalized PT Service escrow (P0 cluster C3) ──────────────────────────────────────
//
// No /hold endpoint: "hold" is exactly what the generic checkout + webhook pipeline already
// does for every purpose (settleContractPayment, called from webhook.service.ts's
// settlePurchase) — see personalized-service-ledger.service.ts's header comment. Only
// release (buyer accepted) and refund (cancelled before work started, or an admin-approved
// refund at any point after) need dedicated logic, since neither fits contract-ledger.
// service.ts's per-session-release / termination-reason-driven formulas.

const orderRateSchema = z.object({
  platformRate: z.string().min(1),
  ptRate: z.string().min(1),
});
const orderPartiesSchema = z.object({
  ptUserId: z.string().min(1),
  clientUserId: z.string().min(1),
});
function toOrderRates(r: z.infer<typeof orderRateSchema>) {
  return { platformRate: new Prisma.Decimal(r.platformRate), ptRate: new Prisma.Decimal(r.ptRate) };
}

const personalizedReleaseSchema = z.object({
  transactionId: z.string().min(1),
  price: z.string().min(1),
  rates: orderRateSchema,
  parties: orderPartiesSchema,
  label: z.string().min(1),
  // Business key `PERSONALIZED_RELEASE:<orderId>` — an order is only ever accepted once.
  idempotencyKey: z.string().min(1),
});

// POST /internal/personalized-service/release — the buyer accepted (or auto-accept did): the
// PT and platform's full pending share for this order becomes withdrawable.
router.post('/personalized-service/release', async (req: Request, res: Response) => {
  const parsed = personalizedReleaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await releaseOrder({
      transactionId: d.transactionId,
      price: new Prisma.Decimal(d.price),
      rates: toOrderRates(d.rates),
      parties: d.parties,
      label: d.label,
      idempotencyKey: d.idempotencyKey,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'personalized-service release failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'RELEASE_FAILED', message: (err as Error).message } });
  }
});

const personalizedRefundSchema = z.object({
  transactionId: z.string().min(1),
  refundAmount: z.string().min(1),
  rates: orderRateSchema,
  parties: orderPartiesSchema,
  label: z.string().min(1),
  // Business key `PERSONALIZED_REFUND:<orderId>:<refundAmount>` — amount-scoped because an
  // order can be legitimately refunded more than once (partial-refund-ceiling admin flow).
  idempotencyKey: z.string().min(1),
});

// POST /internal/personalized-service/refund — hands the client back refundAmount, pulling
// from whatever is still PENDING first, then clawing back from AVAILABLE, then (only for the
// PT's share) falling back to a PartnerReceivable if even that comes up short.
router.post('/personalized-service/refund', async (req: Request, res: Response) => {
  const parsed = personalizedRefundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const d = parsed.data;
  try {
    const result = await refundOrder({
      transactionId: d.transactionId,
      refundAmount: new Prisma.Decimal(d.refundAmount),
      rates: toOrderRates(d.rates),
      parties: d.parties,
      label: d.label,
      idempotencyKey: d.idempotencyKey,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ error: 'personalized-service refund failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'REFUND_FAILED', message: (err as Error).message } });
  }
});

export default router;
