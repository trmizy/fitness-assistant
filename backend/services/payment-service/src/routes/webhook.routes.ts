import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { getProvider } from '../services/payment.service';
import { handleEvent, type HandleEventOutcome } from '../services/webhook.service';
import { handleVnpayCallback } from '../services/vnpay-callback.service';
import { transactionRepository } from '../repositories/transaction.repository';

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
  | { kind: 'IGNORED' } // authentic failure notice: acknowledged, nothing to book
  | { kind: 'REFUSED'; reason: 'BAD_SIGNATURE' | 'MERCHANT_MISMATCH' | 'MISSING_REFERENCE' | 'ORDER_NOT_FOUND' | 'AMOUNT_MISMATCH' | 'GATEWAY_DISABLED' | 'ERROR' };

const ZALOPAY_MESSAGES: Record<string, string> = {
  BAD_SIGNATURE: 'mac not equal',
  MERCHANT_MISMATCH: 'app_id not equal',
  MISSING_REFERENCE: 'app_trans_id missing',
  ORDER_NOT_FOUND: 'order not found',
  AMOUNT_MISMATCH: 'invalid amount',
  GATEWAY_DISABLED: 'gateway not enabled',
  ERROR: 'internal error',
};

// POST /payments/webhook/:provider  (ZaloPay only)
// Mounted with express.raw() in app.ts — rawBody available as Buffer.
// VNPay is deliberately NOT served here: its IPN is the GET above, and its verification yields a query string, not a
// JSON body. Any other name is not a gateway door: MOCK, MOMO and PAYOS were retired (their DB rows stay readable, but
// nothing verifies or books a callback for them), STRIPE / MANUAL_BANK_TRANSFER never had a verifier.
const POST_GATEWAYS = new Set(['ZALOPAY']);
const RETIRED_GATEWAYS = new Set(['MOCK', 'MOMO', 'PAYOS']);

router.post('/:provider', async (req: Request, res: Response) => {
  const providerName = req.params.provider.toUpperCase();
  const rawBody = req.body as Buffer;

  if (!POST_GATEWAYS.has(providerName)) {
    // Refused before any verification or DB access, with the answer every unknown name gets. A retired gateway is only
    // named in the log, so a stray late delivery is visible to an operator.
    if (RETIRED_GATEWAYS.has(providerName)) {
      logger.warn(`[Webhook] Callback for retired gateway ${providerName} refused — nothing processed`);
    }
    return res.status(404).json({ success: false, error: { code: 'UNKNOWN_WEBHOOK_PROVIDER' } });
  }

  // ZaloPay expects a specific acknowledgement body → process synchronously.
  const result = await processWebhook(providerName, rawBody);
  // ZaloPay: return_code 1 = success, 2 = already processed (neither is retried); anything else is retried.
  // A callback we refused is answered -1 with the reason, so the gateway keeps it visible and retries a little
  // (duplicates are harmless: one discrepancy record, one alert — see recordGatewayDiscrepancy).
  if (result.kind === 'SETTLED' || result.kind === 'IGNORED') return res.json({ return_code: 1, return_message: 'success' });
  if (result.kind === 'DUPLICATE') return res.json({ return_code: 2, return_message: 'order already processed' });
  return res.json({ return_code: -1, return_message: ZALOPAY_MESSAGES[result.reason] ?? 'refused' });
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
    case 'GATEWAY_DISABLED':
      return { kind: 'REFUSED', reason: 'GATEWAY_DISABLED' };
  }
}

async function processWebhook(providerName: string, rawBody: Buffer): Promise<WebhookResult> {
  try {
    const provider = getProvider(providerName);
    const { valid, reason, normalized } = provider.verifyWebhookSignature(rawBody);

    if (!valid) {
      logger.warn(`[Webhook] Refused ${providerName} callback: ${reason ?? 'invalid signature'}`);
      return { kind: 'REFUSED', reason: reason === 'MERCHANT_MISMATCH' || reason === 'MISSING_REFERENCE' ? reason : 'BAD_SIGNATURE' };
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
