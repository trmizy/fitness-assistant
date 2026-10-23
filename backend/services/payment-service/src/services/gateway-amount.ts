import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

/**
 * The gateway-reported amount must equal the price of the transaction it claims to pay for.
 *
 * Why this exists. A signed "paid" callback only proves the gateway said SOMETHING about this
 * reference; it does not prove the payer handed over the price of the order. Settlement used to
 * allocate `txn.amount` — the amount WE asked for — and never looked at the amount the gateway
 * reported, so a signed IPN for 1,000 VND against a 5,000,000 VND contract credited the full
 * 5,000,000 into escrow and activated the contract (cross-service test H1). An underpayment
 * therefore turned into free money for the client, and an overpayment into money the ledger
 * never received.
 *
 * Only an EXACT match settles. Everything else is recorded durably on the transaction and left
 * for a human, because neither direction can be resolved automatically: an underpayment is cash
 * we hold that belongs to nobody's order, an overpayment needs a partial refund at the gateway.
 *
 * Integer arithmetic only: the expected price is converted to a BigInt of whole VND (and refused
 * if it is not a whole number), the reported figure arrives already as a digit string.
 */
export type GatewayDiscrepancyKind =
  | 'AMOUNT_MISMATCH'
  | 'AMOUNT_MISSING'
  | 'PRICE_NOT_WHOLE_VND'
  // A signed "paid" callback for a purchase this deployment will not book (a retired flow). The money was taken at the
  // gateway but no ledger entry exists for it, so an admin has to give it back there.
  | 'PURPOSE_NOT_SETTLEABLE';

export type GatewayAmountVerdict =
  | { ok: true }
  | { ok: false; kind: GatewayDiscrepancyKind; expectedAmountVnd: string; reportedAmountVnd: string | null };

export { parseGatewayAmountVnd } from '../providers/amount-util';

export function compareGatewayAmount(
  price: Prisma.Decimal | string | number,
  reportedAmountVnd: string | null | undefined,
): GatewayAmountVerdict {
  const dec = new Prisma.Decimal(price);
  if (!dec.isInteger()) {
    // Our checkout only ever sends a gateway a whole-VND integer; a fractional price cannot have been paid exactly.
    return { ok: false, kind: 'PRICE_NOT_WHOLE_VND', expectedAmountVnd: dec.toFixed(2), reportedAmountVnd: reportedAmountVnd ?? null };
  }
  const expected = BigInt(dec.toFixed(0));
  if (reportedAmountVnd === null || reportedAmountVnd === undefined || !/^\d{1,18}$/.test(reportedAmountVnd)) {
    return { ok: false, kind: 'AMOUNT_MISSING', expectedAmountVnd: expected.toString(), reportedAmountVnd: null };
  }
  if (BigInt(reportedAmountVnd) !== expected) {
    return { ok: false, kind: 'AMOUNT_MISMATCH', expectedAmountVnd: expected.toString(), reportedAmountVnd: BigInt(reportedAmountVnd).toString() };
  }
  return { ok: true };
}

/**
 * Durably flags a transaction whose gateway callback disagreed with its price, in
 * `metadata.gatewayDiscrepancy`, and closes the checkout (PENDING/PROCESSING -> FAILED) so nothing
 * keeps polling or settling it. One atomic UPDATE:
 *
 *  - the first detection wins for the descriptive fields, later deliveries of the same callback
 *    (VNPay retries an IPN it does not get 00/02 for; ZaloPay retries a callback it is not answered 1)
 *    only bump `occurrences` / `lastSeenAt` - there is exactly ONE discrepancy record per transaction;
 *  - the admin alert (an error-level log line, the only alert channel this service has) fires on the FIRST
 *    detection only (`firstDetection` in the result). A repeat logs at warn level, so a gateway hammering the
 *    same callback cannot flood the alert channel;
 *  - the status is touched ONLY from an open state, so a transaction that is already PAID (e.g. a
 *    second, wrong-amount callback arriving after the right one settled) keeps its PAID status and
 *    its ledger — the discrepancy is recorded next to it and nothing moves;
 *  - metadata is merged with jsonb `||`, so the frozen `rates` / `parties` snapshot is preserved.
 *
 * This is an existing column (no schema change). Admins list these through
 * GET /admin/payments/gateway-discrepancies (and the rows also appear, with metadata, in GET /admin/payments).
 * `provider` in the record is the transaction's own provider column.
 */
export async function recordGatewayDiscrepancy(input: {
  transactionId: string;
  verdict: Extract<GatewayAmountVerdict, { ok: false }>;
  source: string;
  gatewayTransactionNo?: string | null;
  /** The figure exactly as the gateway sent it (VNPay: the x100 vnp_Amount; the others: the plain amount). */
  reportedMinorUnits?: string | null;
}): Promise<{ firstDetection: boolean; occurrences: number }> {
  const { transactionId, verdict, source } = input;
  const now = new Date().toISOString();
  const detail = JSON.stringify({
    kind: verdict.kind,
    source,
    expectedAmountVnd: verdict.expectedAmountVnd,
    reportedAmountVnd: verdict.reportedAmountVnd,
    reportedMinorUnits: input.reportedMinorUnits ?? null,
    gatewayTransactionNo: input.gatewayTransactionNo ?? null,
    firstDetectedAt: now,
    resolved: false,
  });

  const rows = await prisma.$queryRaw<Array<{ occurrences: number | null; provider: string }>>(Prisma.sql`
    UPDATE payment_transactions SET
      metadata = COALESCE(NULLIF(metadata, 'null'::jsonb), '{}'::jsonb) || jsonb_build_object(
        'gatewayDiscrepancy',
        (${detail}::jsonb || jsonb_build_object('provider', provider::text) || COALESCE(metadata->'gatewayDiscrepancy', '{}'::jsonb))
          || jsonb_build_object(
               'occurrences', COALESCE((metadata->'gatewayDiscrepancy'->>'occurrences')::int, 0) + 1,
               'lastSeenAt', ${now}::text
             )
      ),
      status = CASE WHEN status IN ('PENDING', 'PROCESSING') THEN 'FAILED'::"PaymentStatus" ELSE status END,
      failed_at = CASE WHEN status IN ('PENDING', 'PROCESSING') THEN NOW() ELSE failed_at END,
      updated_at = NOW()
    WHERE id = ${transactionId}
    RETURNING (metadata->'gatewayDiscrepancy'->>'occurrences')::int AS occurrences, provider::text AS provider
  `);
  const occurrences = rows[0]?.occurrences ?? 0;
  const firstDetection = occurrences === 1;

  const fields = {
    transactionId,
    provider: rows[0]?.provider ?? null,
    kind: verdict.kind,
    source,
    expectedAmountVnd: verdict.expectedAmountVnd,
    reportedAmountVnd: verdict.reportedAmountVnd,
    gatewayTransactionNo: input.gatewayTransactionNo ?? null,
    occurrences,
  };
  if (firstDetection) {
    logger.error({
      error: '[GatewayAmount] gateway callback does not match the transaction — NOT settling; needs manual handling (admin: GET /admin/payments/gateway-discrepancies)',
      ...fields,
    });
  } else {
    logger.warn({ error: '[GatewayAmount] repeat delivery of an already-recorded gateway discrepancy (no new alert)', ...fields });
  }
  return { firstDetection, occurrences };
}
