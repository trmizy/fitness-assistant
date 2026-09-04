import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { getProvider } from '../services/payment.service';
import { handleEvent } from '../services/webhook.service';
import { webhookRepository } from '../repositories/webhook.repository';
import type { Prisma } from '../generated/prisma';

const router = Router();

// GET /payments/webhook/vnpay — VNPay's IPN is a GET whose query string is the payload.
// Verified synchronously so we can answer VNPay's expected {RspCode} contract.
router.get('/vnpay', async (req: Request, res: Response) => {
  try {
    const rawQuery = req.originalUrl.split('?')[1] ?? '';
    const { valid, normalized } = getProvider('VNPAY').verifyWebhookSignature(Buffer.from(rawQuery, 'utf-8'));
    if (!valid || !normalized) {
      return res.json({ RspCode: '97', Message: 'Invalid signature' });
    }
    await handleEvent({
      provider: 'VNPAY',
      providerEventId: `vnpay_ipn_${normalized.providerTransactionId}`,
      providerTransactionId: normalized.providerTransactionId,
      payload: normalized.raw ?? {},
      status: normalized.status,
    });
    return res.json({ RspCode: '00', Message: 'Confirm Success' });
  } catch (err) {
    logger.error({ error: '[Webhook] VNPay IPN processing failed', message: (err as Error).message });
    return res.json({ RspCode: '99', Message: 'Unknown error' });
  }
});

// POST /payments/webhook/:provider
// Mounted with express.raw() in app.ts — rawBody available as Buffer
router.post('/:provider', async (req: Request, res: Response) => {
  const providerName = req.params.provider.toUpperCase();
  const rawBody = req.body as Buffer;

  // MoMo: fire-and-forget with the immediate 204 it requires.
  if (providerName === 'MOMO') {
    // Security review 2026-09-03 (C2) — used to ack 204 first and only THEN persist (inside
    // the fired-and-forgotten processWebhook, below). A crash/restart between those two steps
    // meant the event was gone forever: MoMo already saw 204 and never redelivers. Persisting
    // the identifying fields synchronously first, before acking, closes that window — this is
    // the exact same idempotent upsert() handleEvent() itself calls first (unique on
    // (provider, providerEventId)), just done once more here, so processWebhook below still
    // runs unchanged and safely re-upserts the same row rather than duplicating it.
    try {
      const { valid, payload } = getProvider('MOMO').verifyWebhookSignature(rawBody);
      if (valid && payload) {
        await webhookRepository.upsert({
          provider: 'MOMO',
          providerEventId: String(payload.transId ?? payload.orderId),
          providerTransactionId: String(payload.orderId),
          payload: payload as unknown as Prisma.InputJsonValue,
        });
      }
    } catch (err) {
      // Never let the pre-persist step itself block MoMo's required fast 204 — worst case
      // here is falling back to the old fire-and-forget behavior for this one delivery.
      logger.error({ error: '[Webhook] MoMo pre-persist failed', message: (err as Error).message });
    }
    res.status(204).send();
    void processWebhook(providerName, rawBody);
    return;
  }

  // ZaloPay / PayOS expect a specific acknowledgement body → process synchronously.
  const ok = await processWebhook(providerName, rawBody);
  if (providerName === 'ZALOPAY') {
    return res.json(ok ? { return_code: 1, return_message: 'success' } : { return_code: -1, return_message: 'mac not equal' });
  }
  if (providerName === 'PAYOS') {
    return res.json({ success: ok });
  }
  return res.status(ok ? 200 : 400).send();
});

/** Returns true when the webhook was valid and processed (credit is idempotent downstream). */
async function processWebhook(providerName: string, rawBody: Buffer): Promise<boolean> {
  try {
    const provider = getProvider(providerName);
    const { valid, payload, normalized } = provider.verifyWebhookSignature(rawBody);

    if (!valid) {
      logger.warn(`[Webhook] Invalid signature from provider ${providerName}`);
      return false;
    }

    // Providers implementing the provider-agnostic contract (VNPay, ZaloPay, PayOS, ...)
    if (normalized) {
      await handleEvent({
        provider: providerName,
        providerEventId: normalized.providerEventId,
        providerTransactionId: normalized.providerTransactionId,
        payload: normalized.raw ?? {},
        status: normalized.status,
      });
      return true;
    }

    // Only MoMo still reports through `payload`; everything else fills `normalized` above.
    // A provider that verifies but hands back neither is a bug, not a payment — do not
    // invent an event from the unverified request body.
    if (!payload) {
      logger.warn(`[Webhook] ${providerName} verified but returned no payload — ignoring`);
      return false;
    }

    // MoMo IPN: resultCode=0 = PAID, resultCode=9000 = authorized (pending capture) — skip
    if (payload.resultCode === 9000) {
      logger.info(`[Webhook] MoMo resultCode=9000 (authorized, not captured) — waiting for next IPN`);
      return true;
    }

    // Look up by MoMo's own orderId, not transId: providerTransactionId was stored at
    // checkout time as the orderId we generated (see momo.provider.ts#createPaymentIntent —
    // providerTransactionId: orderId). transId is MoMo's own transaction number, minted only
    // once the payment settles, and was never written to our row — matching on it here would
    // never find the transaction, silently dropping every real MoMo IPN. providerEventId can
    // still use transId (or fall back to orderId): it only needs to be unique per delivery,
    // not resolvable to a row.
    await handleEvent({
      provider: providerName,
      providerEventId: String(payload.transId ?? payload.orderId),
      providerTransactionId: String(payload.orderId),
      payload: payload as unknown as Record<string, unknown>,
      status: payload.resultCode === 0 ? 'PAID' : 'FAILED',
    });
    return true;
  } catch (err) {
    logger.error({ error: `[Webhook] Processing failed for ${providerName}`, message: (err as Error).message });
    return false;
  }
}

export default router;
