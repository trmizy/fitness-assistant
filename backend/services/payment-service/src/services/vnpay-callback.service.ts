import { logger } from '@gym-coach/shared';
import { transactionRepository } from '../repositories/transaction.repository';
import { isDefinitiveVnpayFailure } from '../providers/vnpay.provider';
import { getProvider } from './payment.service';
import { compareGatewayAmount, recordGatewayDiscrepancy } from './gateway-amount';
import { failFromSignedGatewayResult, handleEvent } from './webhook.service';

/**
 * The single entry point for a VNPay callback that arrives over HTTP — the server-to-server IPN
 * (GET /payments/webhook/vnpay) and the payer's browser coming back (GET /payments/vnpay/return).
 *
 * Both carry the same signed query string and must be held to exactly the same rules, because the
 * browser return is not a weaker door: anyone can replay or hand-build one if a check is missing.
 * So both go through here, and the only thing that differs is how the caller presents the result
 * (IPN: a {RspCode, Message} JSON body; return: a redirect to the result page).
 *
 * Checks, in the order VNPay's integration guide prescribes, each fail-closed:
 *   1. signature (HMAC-SHA512 over the sorted params, our secret)            -> 97
 *   2. the callback names a reference, our merchant code, and VND            -> 01 / 04
 *   3. the reference is a VNPay transaction that exists here                 -> 01
 *   4. a PAID callback carries exactly the transaction's price               -> 04 (recorded, nothing moves)
 *   5. the transaction is not already settled                                -> 02
 *   6. only now, settle through handleEvent (compare-and-swap on PAID).
 * A failed payment (response code or transaction status not "00") moves no money and is answered 00,
 * as VNPay expects an acknowledgement for those too; definitive failures close the checkout.
 *
 * RspCodes are VNPay's own: 00 confirmed, 01 order not found, 02 already confirmed, 04 invalid
 * amount, 97 invalid signature, 99 unknown error (the route returns 99 if anything here throws, so
 * VNPay retries a settlement that could not be completed).
 */
export type VnpayCallbackOutcome =
  | 'BAD_SIGNATURE'
  | 'ORDER_NOT_FOUND'
  | 'MERCHANT_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'ALREADY_CONFIRMED'
  | 'SETTLED'
  | 'PAYMENT_NOT_SUCCESSFUL';

export interface VnpayCallbackResult {
  outcome: VnpayCallbackOutcome;
  rspCode: '00' | '01' | '02' | '04' | '97';
  message: string;
  /** Display-only status for the return redirect; never trusted by the UI, which re-asks the server. */
  uiStatus: 'success' | 'failed' | 'invalid';
  /** Our transaction id (vnp_TxnRef) when the callback named one that exists. */
  transactionId?: string;
}

// Purposes that are paid through a gateway checkout. Anything else with provider VNPAY (there is none today)
// must never be settled by a callback.
const GATEWAY_PURPOSES = new Set([
  'WALLET_TOPUP',
  'PT_CONTRACT',
  'GYM_MEMBERSHIP',
  'TRAINING_PACKAGE_PURCHASE',
  'PERSONALIZED_SERVICE_PURCHASE',
]);

export async function handleVnpayCallback(rawQuery: string, source: 'IPN' | 'RETURN'): Promise<VnpayCallbackResult> {
  const verified = getProvider('VNPAY').verifyWebhookSignature(Buffer.from(rawQuery, 'utf-8'));

  if (!verified.valid || !verified.normalized) {
    switch (verified.reason) {
      case 'MERCHANT_MISMATCH':
        return { outcome: 'MERCHANT_MISMATCH', rspCode: '01', message: 'Order not found', uiStatus: 'invalid' };
      case 'MISSING_REFERENCE':
        return { outcome: 'ORDER_NOT_FOUND', rspCode: '01', message: 'Order not found', uiStatus: 'invalid' };
      case 'CURRENCY_MISMATCH':
        return { outcome: 'AMOUNT_MISMATCH', rspCode: '04', message: 'Invalid amount', uiStatus: 'invalid' };
      default:
        return { outcome: 'BAD_SIGNATURE', rspCode: '97', message: 'Invalid signature', uiStatus: 'invalid' };
    }
  }
  const event = verified.normalized;
  const raw = (event.raw ?? {}) as Record<string, string>;

  const txn = await transactionRepository.findByProviderTransactionId(event.providerTransactionId, 'VNPAY');
  if (!txn || txn.provider !== 'VNPAY' || !GATEWAY_PURPOSES.has(txn.purpose)) {
    logger.warn(`[VNPayCallback] ${source}: no payable VNPay transaction for vnp_TxnRef=${event.providerTransactionId}`);
    return { outcome: 'ORDER_NOT_FOUND', rspCode: '01', message: 'Order not found', uiStatus: 'invalid' };
  }

  // ── The payment did not go through. No money moves. ───────────────────────────────────────────
  if (event.status !== 'PAID') {
    // Bookkeeping + (for definitive failures: payer cancelled, window expired, card declined, ...) close the
    // checkout now instead of leaving it PENDING until the stale sweep. Both only ever act on an OPEN
    // transaction, so a failure notice can never downgrade a PAID one. A later genuine, exact-amount PAID
    // callback still settles a FAILED purchase.
    await handleEvent({
      provider: 'VNPAY',
      providerEventId: `vnpay_${source.toLowerCase()}:${event.providerEventId}`,
      providerTransactionId: event.providerTransactionId,
      payload: raw,
      status: 'FAILED',
      source,
    });
    if (isDefinitiveVnpayFailure(raw.vnp_ResponseCode)) {
      await failFromSignedGatewayResult({ provider: 'VNPAY', providerTransactionId: event.providerTransactionId });
    }
    if (txn.status === 'PAID') {
      return { outcome: 'ALREADY_CONFIRMED', rspCode: '02', message: 'Order already confirmed', uiStatus: 'success', transactionId: txn.id };
    }
    return { outcome: 'PAYMENT_NOT_SUCCESSFUL', rspCode: '00', message: 'Confirm Success', uiStatus: 'failed', transactionId: txn.id };
  }

  // ── The gateway says it collected money. It must be exactly the price. ───────────────────────
  // Checked here (to answer 04 precisely, and before the "already confirmed" shortcut) and again inside
  // handleEvent, which is what actually guards settlement for every caller.
  const verdict = compareGatewayAmount(txn.amount, event.paidAmountVnd);
  if (!verdict.ok) {
    await recordGatewayDiscrepancy({
      transactionId: txn.id,
      verdict,
      source,
      gatewayTransactionNo: raw.vnp_TransactionNo ?? null,
      reportedMinorUnits: raw.vnp_Amount ?? null,
    });
    return { outcome: 'AMOUNT_MISMATCH', rspCode: '04', message: 'Invalid amount', uiStatus: 'failed', transactionId: txn.id };
  }

  // Exact amount from here on.
  if (txn.status === 'PAID' || txn.status === 'REFUNDED') {
    return { outcome: 'ALREADY_CONFIRMED', rspCode: '02', message: 'Order already confirmed', uiStatus: 'success', transactionId: txn.id };
  }

  const outcome = await handleEvent({
    provider: 'VNPAY',
    // Per source AND per VNPay transaction number: an IPN and a return for the same payment are distinct
    // deliveries (the second finds the transaction PAID and moves nothing), while a retry of the SAME IPN
    // is the same event. A shared key per reference would let an earlier FAILED notice for this reference
    // shadow the later genuine PAID one.
    providerEventId: `vnpay_${source.toLowerCase()}:${event.providerEventId}`,
    providerTransactionId: event.providerTransactionId,
    payload: raw,
    status: 'PAID',
    paidAmountVnd: event.paidAmountVnd,
    source,
  });

  switch (outcome) {
    case 'AMOUNT_MISMATCH':
      return { outcome: 'AMOUNT_MISMATCH', rspCode: '04', message: 'Invalid amount', uiStatus: 'failed', transactionId: txn.id };
    case 'NOT_FOUND':
    case 'PROVIDER_MISMATCH':
      return { outcome: 'ORDER_NOT_FOUND', rspCode: '01', message: 'Order not found', uiStatus: 'invalid' };
    case 'ALREADY_PAID':
    case 'NOT_PAYABLE':
      return { outcome: 'ALREADY_CONFIRMED', rspCode: '02', message: 'Order already confirmed', uiStatus: 'success', transactionId: txn.id };
    case 'DUPLICATE_EVENT': {
      // The very same callback was processed before (a VNPay retry). Say what its result was.
      const fresh = await transactionRepository.findById(txn.id);
      return fresh?.status === 'PAID'
        ? { outcome: 'ALREADY_CONFIRMED', rspCode: '02', message: 'Order already confirmed', uiStatus: 'success', transactionId: txn.id }
        : { outcome: 'PAYMENT_NOT_SUCCESSFUL', rspCode: '00', message: 'Confirm Success', uiStatus: 'failed', transactionId: txn.id };
    }
    default:
      return { outcome: 'SETTLED', rspCode: '00', message: 'Confirm Success', uiStatus: 'success', transactionId: txn.id };
  }
}
