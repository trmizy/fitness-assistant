import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { getProvider } from '../services/payment.service';
import { handleEvent } from '../services/webhook.service';

const router = Router();

// POST /payments/webhook/:provider
// Mounted with express.raw() in app.ts — rawBody available as Buffer
router.post('/:provider', (req: Request, res: Response) => {
  const providerName = req.params.provider.toUpperCase();

  // MoMo requires exactly HTTP 204 within 15s; respond immediately, process async
  res.status(204).send();

  void processWebhook(providerName, req.body as Buffer);
});

async function processWebhook(providerName: string, rawBody: Buffer): Promise<void> {
  try {
    const provider = getProvider(providerName);
    const { valid, payload } = provider.verifyWebhookSignature(rawBody);

    if (!valid) {
      logger.warn(`[Webhook] Invalid signature from provider ${providerName}`);
      return;
    }

    if (!payload) {
      // MockProvider: payload not in verifyWebhookSignature result — parse separately
      const parsed = JSON.parse(rawBody.toString('utf-8'));
      await handleEvent({
        provider: providerName,
        providerEventId: parsed.providerEventId ?? `evt_${Date.now()}`,
        providerTransactionId: parsed.providerTransactionId,
        payload: parsed,
        status: parsed.status === 'PAID' ? 'PAID' : 'FAILED',
      });
      return;
    }

    // MoMo IPN: resultCode=0 = PAID, resultCode=9000 = authorized (pending capture) — skip
    if (payload.resultCode === 9000) {
      logger.info(`[Webhook] MoMo resultCode=9000 (authorized, not captured) — waiting for next IPN`);
      return;
    }

    await handleEvent({
      provider: providerName,
      providerEventId: String(payload.transId),
      providerTransactionId: String(payload.transId),
      payload: payload as unknown as Record<string, unknown>,
      status: payload.resultCode === 0 ? 'PAID' : 'FAILED',
    });
  } catch (err) {
    logger.error({ error: `[Webhook] Processing failed for ${providerName}`, message: (err as Error).message });
  }
}

export default router;
