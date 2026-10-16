import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { getProvider } from '../services/payment.service';
import { handleEvent, type HandleEventOutcome } from '../services/webhook.service';
import { handleVnpayCallback } from '../services/vnpay-callback.service';
import { webhookRepository } from '../repositories/webhook.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import type { Prisma } from '../generated/prisma';

const router = Router();

// GET /payments/webhook/vnpay — VNPay's IPN is a GET whose query string is the payload.
// Verified synchronously so we can answer VNPay's expected {RspCode} contract. ALL validation (signature,
// merchant, currency, order exists, EXACT amount, not already confirmed) lives in handleVnpayCallback so the
// browser-return route is held to the identical rules — see vnpay-callback.service.ts for the code table:
// 00 confirmed · 01 order/merchant unknown · 02 already confirmed · 04 invalid amount · 97 bad signature ·
// 99 unexpected failure (VNPay retries, which is what we want when settlement itself could not complete).
router.get('/vnpay', async (req: Request, res: Response) => {
  try {
    const rawQuery = req.originalUrl.split('?')[1] ?? '';
    const result = await handleVnpayCallback(rawQuery, 'IPN');
    return res.json({ RspCode: result.rspCode, Message: result.message });
  } catch (err) {
    logger.error({ error: '[Webhook] VNPay IPN processing failed', message: (err as Error).message });
    return res.json({ RspCode: '99', Message: 'Unknown error' });
  }
});

/**
 * What a non-VNPay callback came to, in terms each gateway's own acknowledgement format is built from.
 *
 *   SETTLED / DUPLICATE   the callback was authentic and is fully dealt with (booked now, or booked before)
 *   REFUSED_*             authentic enough to read, but nothing was booked: bad signature, someone else's merchant
 *                         id, an order we do not know, an amount that is not the price, a gateway that may not
 *                         settle real money here, a processing error
 */
type WebhookResult =
  | { kind: 'SETTLED' }
  | { kind: 'DUPLICATE' }
  | { kind: 'IGNORED' } // authentic progress notice (MoMo 9000) or a failure notice: acknowledged, nothing to book
  | { kind: 'REFUSED'; reason: 'BAD_SIGNATURE' | 'MERCHANT_MISMATCH' | 'MISSING_REFERENCE' | 'ORDER_NOT_FOUND' | 'AMOUNT_MISMATCH' | 'REFERENCE_MISMATCH' | 'GATEWAY_DISABLED' | 'ERROR' };

const ZALOPAY_MESSAGES: Record<string, string> = {
  BAD_SIGNATURE: 'mac not equal',
  MERCHANT_MISMATCH: 'app_id not equal',
  MISSING_REFERENCE: 'app_trans_id missing',
  ORDER_NOT_FOUND: 'order not found',
  AMOUNT_MISMATCH: 'invalid amount',
  REFERENCE_MISMATCH: 'order reference mismatch',
  GATEWAY_DISABLED: 'gateway not enabled',
  ERROR: 'internal error',
};

// POST /payments/webhook/:provider  (ZaloPay, PayOS, MoMo)
// Mounted with express.raw() in app.ts — rawBody available as Buffer.
// VNPay is deliberately NOT served here: its IPN is the GET above, and its verification yields a query string, not a
// JSON body. Any other name (MOCK was removed, STRIPE / MANUAL_BANK_TRANSFER have no verifier) is not a gateway door.
const POST_GATEWAYS = new Set(['ZALOPAY', 'PAYOS', 'MOMO']);

router.post('/:provider', async (req: Request, res: Response) => {
  const providerName = req.params.provider.toUpperCase();
  const rawBody = req.body as Buffer;

  if (!POST_GATEWAYS.has(providerName)) {
    return res.status(404).json({ success: false, error: { code: 'UNKNOWN_WEBHOOK_PROVIDER' } });
  }

  // MoMo: fire-and-forget with the immediate 204 it requires.
  if (providerName === 'MOMO') {
    // Security review 2026-09-03 (C2) — used to ack 204 first and only THEN persist (inside
    // the fired-and-forgotten processWebhook, below). A crash/restart between those two steps
    // meant the event was gone forever: MoMo already saw 204 and never redelivers. Persisting
    // the identifying fields synchronously first, before acking, closes that window — this is
    // the exact same idempotent upsert() handleEvent() itself calls first (unique on
    // (provider, providerEventId)), just done once more here, so processWebhook below still
    // runs unchanged and safely re-upserts the same row rather than duplicating it.
    let verified: ReturnType<ReturnType<typeof getProvider>['verifyWebhookSignature']>;
    try {
      verified = getProvider('MOMO').verifyWebhookSignature(rawBody);
    } catch (err) {
      logger.error({ error: '[Webhook] MoMo verification failed', message: (err as Error).message });
      return res.status(500).send();
    }
    // Not from MoMo (bad signature) or not for us (another partner code): there is nothing to acknowledge. MoMo itself
    // always sends a well-formed, correctly signed IPN, so a non-204 here only ever reaches a forger.
    if (!verified.valid) {
      logger.warn(`[Webhook] MoMo IPN refused: ${verified.reason ?? 'invalid'}`);
      return res.status(400).send();
    }
    if (verified.normalized) {
      try {
        await webhookRepository.upsert({
          provider: 'MOMO',
          providerEventId: verified.normalized.providerEventId,
          providerTransactionId: verified.normalized.providerTransactionId,
          payload: (verified.normalized.raw ?? {}) as Prisma.InputJsonValue,
        });
      } catch (err) {
        // Never let the pre-persist step itself block MoMo's required fast 204 — worst case
        // here is falling back to the old fire-and-forget behavior for this one delivery.
        logger.error({ error: '[Webhook] MoMo pre-persist failed', message: (err as Error).message });
      }
    }
    res.status(204).send();
    void processWebhook(providerName, rawBody);
    return;
  }

  // ZaloPay / PayOS expect a specific acknowledgement body → process synchronously.
  const result = await processWebhook(providerName, rawBody);
  if (providerName === 'ZALOPAY') {
    // ZaloPay: return_code 1 = success, 2 = already processed (neither is retried); anything else is retried.
    // A callback we refused is answered -1 with the reason, so the gateway keeps it visible and retries a little
    // (duplicates are harmless: one discrepancy record, one alert — see recordGatewayDiscrepancy).
    if (result.kind === 'SETTLED' || result.kind === 'IGNORED') return res.json({ return_code: 1, return_message: 'success' });
    if (result.kind === 'DUPLICATE') return res.json({ return_code: 2, return_message: 'order already processed' });
    return res.json({ return_code: -1, return_message: ZALOPAY_MESSAGES[result.reason] ?? 'refused' });
  }
  // PayOS: HTTP 200 stops its retries and any other status triggers them. A refusal is therefore also a 200 — retrying a
  // wrong amount or a forged body can never make it right — with success:false and the reason, and the case is in the
  // discrepancy list for an admin when it is an amount.
  if (result.kind === 'SETTLED' || result.kind === 'DUPLICATE' || result.kind === 'IGNORED') return res.json({ success: true });
  return res.json({ success: false, code: result.reason });
});

function fromOutcome(outcome: HandleEventOutcome): WebhookResult {
  switch (outcome) {
    case 'SETTLED':
      return { kind: 'SETTLED' };
    case 'ALREADY_PAID':
    case 'DUPLICATE_EVENT':
    case 'NOT_PAYABLE': // REFUNDED / retired flow: handled, nothing for the gateway to retry
      return { kind: 'DUPLICATE' };
    case 'NOT_PAID_EVENT':
      return { kind: 'IGNORED' };
    case 'NOT_FOUND':
    case 'PROVIDER_MISMATCH':
      return { kind: 'REFUSED', reason: 'ORDER_NOT_FOUND' };
    case 'AMOUNT_MISMATCH':
      return { kind: 'REFUSED', reason: 'AMOUNT_MISMATCH' };
    case 'REFERENCE_MISMATCH':
      return { kind: 'REFUSED', reason: 'REFERENCE_MISMATCH' };
    case 'GATEWAY_DISABLED':
      return { kind: 'REFUSED', reason: 'GATEWAY_DISABLED' };
  }
}

async function processWebhook(providerName: string, rawBody: Buffer): Promise<WebhookResult> {
  try {
    const provider = getProvider(providerName);
    const { valid, reason, pending, normalized } = provider.verifyWebhookSignature(rawBody);

    if (!valid) {
      logger.warn(`[Webhook] Refused ${providerName} callback: ${reason ?? 'invalid signature'}`);
      return { kind: 'REFUSED', reason: reason === 'MERCHANT_MISMATCH' || reason === 'MISSING_REFERENCE' ? reason : 'BAD_SIGNATURE' };
    }

    // An authentic progress notice with nothing to book yet (MoMo resultCode 9000: authorised, not captured).
    if (pending) {
      logger.info(`[Webhook] ${providerName} progress notice (authorised, not captured) — waiting for the capture`);
      return { kind: 'IGNORED' };
    }

    // A provider that verifies but hands back no normalized event is a bug, not a payment — do not invent an event
    // from the unverified request body.
    if (!normalized) {
      logger.warn(`[Webhook] ${providerName} verified but returned no event — ignoring`);
      return { kind: 'REFUSED', reason: 'ERROR' };
    }

    const outcome = await handleEvent({
      provider: providerName,
      providerEventId: normalized.providerEventId,
      providerTransactionId: normalized.providerTransactionId,
      payload: normalized.raw ?? {},
      status: normalized.status,
      paidAmountVnd: normalized.paidAmountVnd,
      source: 'IPN',
    });
    // The very same callback was handled before. If that handling REFUSED it over the amount, say so again: a retry of a
    // wrong-amount callback must hear the same thing the first delivery did (and must not be told "already processed",
    // which reads as success). Mirrors VNPay's IPN, where a retry of a 04 is answered 04 (D50 V1).
    if (outcome === 'DUPLICATE_EVENT') {
      const txn = await transactionRepository.findByProviderTransactionId(normalized.providerTransactionId, providerName as never);
      const flagged = (txn?.metadata as Record<string, unknown> | null)?.gatewayDiscrepancy;
      if (txn && flagged && txn.status !== 'PAID') return { kind: 'REFUSED', reason: 'AMOUNT_MISMATCH' };
    }
    return fromOutcome(outcome);
  } catch (err) {
    logger.error({ error: `[Webhook] Processing failed for ${providerName}`, message: (err as Error).message });
    return { kind: 'REFUSED', reason: 'ERROR' };
  }
}

export default router;
