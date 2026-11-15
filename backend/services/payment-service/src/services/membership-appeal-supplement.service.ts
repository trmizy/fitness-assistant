import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { ZERO, splitThreeWays, type RateTable } from './contract-money';
import { walletService } from './wallet.service';
import { pendingRemainingForTxn } from './membership-ledger.service';
import { withIdempotentLedgerOp, type LedgerOpMeta } from './ledger-idempotency';
import { computeFingerprint } from '../utils/idempotency';
import { RequestDoesNotMatchTransactionError } from './contract-request-guard';

/**
 * Q1 (owner decision 15/11/2026) - the SUPPLEMENTARY refund of a gym-complaint appeal won by the member AFTER a refund was already paid.
 *
 * gym-service has already decided WHAT is owed (price - already refunded, rounded DOWN to 1,000) and sends it here, under the key
 * `GYM_CASE_APPEAL_SUPPLEMENT:<approvalId>`. This module only moves the money. It never recomputes the business amount; it re-checks the two things
 * only the ledger can know: that the amount is positive whole dong and that it does not exceed what is STILL refundable for that payment
 * (price - everything already credited to the member's wallet under that payment).
 *
 * WHO FUNDS IT (same split as the original refund, i.e. the membership's FROZEN rates - splitThreeWays on the rate snapshot stored on the payment):
 *   gym share      (gymRate, e.g. 90 %)       debited from the GYM wallet AVAILABLE bucket - the gym already received its release when the membership ended;
 *   platform share (platformRate, e.g. 10 %)  debited from the platform REVENUE wallet AVAILABLE bucket.
 * The member's wallet is credited the FULL amount. Escrow never moves: the cash for the membership has been held since purchase, so the claims on
 * escrow simply shift from the gym/platform to the member (assertInvariant stays exact).
 *
 * WHEN THE GYM IS SHORT (its AVAILABLE is lower than its share): the gym is debited what it has; the member is STILL paid in full - the platform fronts
 * the difference out of REVENUE - and the difference is recorded as a durable, idempotent OPEN obligation of kind GYM_DEBT (party GYM = the debtor,
 * owed = the gym's whole share, paid = what the gym could fund, unpaid = the shortfall) for the admin to collect or waive.
 *
 * !! This is a DELIBERATE, NARROW exception to the D48 "platform never fronts" rule, decided by the owner for THIS flow only (the member won an appeal;
 * they must not wait for the gym's cash). It is NOT the old pending-based fronting: no PartnerReceivable is created (d48-no-fronting-source.test.ts
 * still holds), no automatic recovery exists, and it can only ever draw REVENUE AVAILABLE. If REVENUE cannot cover platform share + fronted part
 * the call is refused (409 PLATFORM_FUNDS_INSUFFICIENT) and NOTHING moves - the case stays blocked and retriable; REVENUE never goes negative.
 *
 * Safety nets: only a GYM_MEMBERSHIP payment that was PAID; the gym / member in the request must be the ones frozen on the payment; the membership's own
 * pending money must already be released (this is a refund of money that has been paid out, never a second way to drain pending); a replay of the same key
 * returns the first answer and moves nothing; the same key with a different request is refused 409.
 */

export class MembershipSupplementError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface MembershipSupplementResult {
  /** What the member's wallet was credited (always the full requested amount on success). */
  refundedToClient: string;
  /** Kept for the gym-service contract: what the MEMBER is still short. Always 0.00 - the member is paid in full. */
  shortfall: string;
  /** The gym's share by the frozen rates, and what the gym wallet really funded. */
  gymShare: string;
  gymDebited: string;
  /** gymShare - gymDebited: what the gym still owes (the GYM_DEBT obligation), fronted by the platform. */
  gymShortfall: string;
  /** The platform's own share by the frozen rates, and the total drawn from REVENUE (own share + fronted gym shortfall). */
  platformShare: string;
  platformDebited: string;
  obligationId?: string;
}

export interface MembershipSupplementParams {
  transactionId: string;
  gymId: string;
  clientId: string;
  amount: Prisma.Decimal;
  label: string;
  /** Business key `GYM_CASE_APPEAL_SUPPLEMENT:<approvalId>`. */
  idempotencyKey: string;
}

export const SUPPLEMENT_KEY_PREFIX = 'GYM_CASE_APPEAL_SUPPLEMENT:';

function ratesOf(metadata: unknown): RateTable {
  const r = ((metadata ?? {}) as { rates?: Record<string, string> }).rates;
  if (!r) throw new MembershipSupplementError(422, 'NO_RATE_SNAPSHOT', 'Giao dịch này không có bảng tỷ lệ chia tiền đã chốt nên không tính được phần hoàn thêm');
  const rates = { platformRate: new Prisma.Decimal(r.platformRate ?? NaN), ptRate: new Prisma.Decimal(r.ptRate ?? NaN), gymRate: new Prisma.Decimal(r.gymRate ?? NaN) };
  if (![rates.platformRate, rates.ptRate, rates.gymRate].every((x) => x.isFinite())) {
    throw new MembershipSupplementError(422, 'NO_RATE_SNAPSHOT', 'Bảng tỷ lệ chia tiền của giao dịch không hợp lệ');
  }
  return rates;
}

export async function refundMembershipAppealSupplement(p: MembershipSupplementParams): Promise<MembershipSupplementResult> {
  const { transactionId, gymId, clientId, amount, label, idempotencyKey } = p;
  if (!idempotencyKey.startsWith(SUPPLEMENT_KEY_PREFIX) || idempotencyKey.length === SUPPLEMENT_KEY_PREFIX.length) {
    throw new MembershipSupplementError(400, 'INVALID_IDEMPOTENCY_KEY', `Khoá thao tác phải có dạng ${SUPPLEMENT_KEY_PREFIX}<mã quyết định>`);
  }
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0) || !amount.isInteger()) {
    throw new MembershipSupplementError(400, 'INVALID_AMOUNT', 'Số tiền hoàn thêm phải là số đồng nguyên và lớn hơn 0');
  }
  const meta: LedgerOpMeta = {
    kind: 'MEMBERSHIP_APPEAL_SUPPLEMENT',
    transactionId,
    fingerprint: computeFingerprint({ kind: 'MEMBERSHIP_APPEAL_SUPPLEMENT', transactionId, gymId, clientId, amount: amount.toFixed(2) }),
  };

  // Read-only checks on the payment itself (frozen at checkout, never rewritten). A replay is allowed through to the idempotent op below.
  const used = await prisma.ledgerOperation.findUnique({ where: { key: idempotencyKey }, select: { requestFingerprint: true } });
  const txn = await prisma.paymentTransaction.findUnique({ where: { id: transactionId }, select: { id: true, purpose: true, status: true, amount: true, metadata: true } });
  if (!txn) throw new MembershipSupplementError(404, 'TRANSACTION_NOT_FOUND', 'Không tìm thấy giao dịch thanh toán của gói hội viên');
  if (!used) {
    if (txn.purpose !== 'GYM_MEMBERSHIP') throw new MembershipSupplementError(422, 'NOT_A_MEMBERSHIP_PAYMENT', 'Giao dịch này không phải là thanh toán gói hội viên phòng gym');
    if (txn.status !== 'PAID' && txn.status !== 'REFUNDED') throw new MembershipSupplementError(409, 'PAYMENT_NOT_PAID', 'Giao dịch của gói hội viên chưa được thanh toán nên không có gì để hoàn thêm');
    const parties = (((txn.metadata ?? {}) as { parties?: { gymId?: string | null; clientUserId?: string } }).parties) ?? null;
    if (!parties || parties.gymId !== gymId || parties.clientUserId !== clientId) {
      throw new RequestDoesNotMatchTransactionError(`gym / member do not match the snapshot frozen on transaction ${transactionId}`);
    }
  }
  const rates = used ? null : ratesOf(txn.metadata);
  if (rates && !rates.ptRate.isZero()) {
    throw new MembershipSupplementError(422, 'UNEXPECTED_PT_SHARE', 'Gói hội viên không có phần chia cho PT nhưng bảng tỷ lệ của giao dịch lại có');
  }

  const [gymWallet, revenueWallet, clientWallet] = await Promise.all([
    walletService.getOrCreateWallet('GYM', gymId),
    walletService.getRevenueWallet(),
    walletService.getOrCreateWallet('CLIENT', clientId),
  ]);

  return walletService.withWallets([gymWallet.id, revenueWallet.id, clientWallet.id], transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, meta, async (): Promise<MembershipSupplementResult> => {
      if (!rates) {
        // The key existed when we looked but is gone now (cannot happen: ledger operations are never deleted). Refuse rather than guess the rates.
        throw new MembershipSupplementError(409, 'RETRY', 'Trạng thái thao tác vừa thay đổi, hãy thử lại');
      }
      // The membership's own pending money must already be released: this refunds money that was PAID OUT, it is not a second way to drain pending.
      const stillPending = (await pendingRemainingForTxn(ops, gymWallet.id, transactionId)).plus(await pendingRemainingForTxn(ops, revenueWallet.id, transactionId));
      if (stillPending.greaterThan(0)) {
        throw new MembershipSupplementError(409, 'MEMBERSHIP_PENDING_NOT_RELEASED', 'Tiền giữ của gói hội viên này chưa được giải ngân nên chưa hoàn thêm được');
      }

      // Remaining refundable = price - everything already credited to the member's wallet under this payment (the original refund, earlier supplements).
      const credited = await ops.tx.walletLedgerEntry.aggregate({ _sum: { amount: true }, where: { walletId: clientWallet.id, transactionId, entryType: 'CREDIT' } });
      const alreadyRefunded = new Prisma.Decimal(credited._sum.amount ?? 0);
      const remaining = new Prisma.Decimal(txn.amount).minus(alreadyRefunded);
      if (amount.greaterThan(remaining)) {
        throw new MembershipSupplementError(
          409,
          'EXCEEDS_REFUNDABLE',
          `Số tiền hoàn thêm ${amount.toFixed(0)} vượt phần còn được hoàn của giao dịch (${(remaining.lessThan(0) ? ZERO : remaining).toFixed(0)})`,
        );
      }

      // Same split as the original refund: the membership's FROZEN rates. gym rounds down, the platform takes the remainder (splitThreeWays).
      const split = splitThreeWays(amount, rates);
      const gymShare = split.gym;
      const platformShare = split.platform.plus(split.pt); // ptRate is 0 (checked above)

      const gymAvailable = ops.balance(gymWallet.id, 'AVAILABLE');
      const gymDebited = gymAvailable.lessThan(gymShare) ? gymAvailable : gymShare;
      const gymShortfall = gymShare.minus(gymDebited);
      const platformDebited = platformShare.plus(gymShortfall); // own share + the part of the gym's share the platform fronts
      if (ops.balance(revenueWallet.id, 'AVAILABLE').lessThan(platformDebited)) {
        throw new MembershipSupplementError(409, 'PLATFORM_FUNDS_INSUFFICIENT', 'Ví doanh thu của nền tảng không đủ để ứng phần hoàn thêm. Chưa có khoản tiền nào được chuyển');
      }

      const note = `${label} - appeal supplement`;
      if (gymDebited.greaterThan(0)) await ops.debit(gymWallet.id, gymDebited, `${note} - gym share`, 'AVAILABLE');
      if (platformDebited.greaterThan(0)) {
        await ops.debit(revenueWallet.id, platformDebited, gymShortfall.greaterThan(0) ? `${note} - platform share + gym shortfall fronted` : `${note} - platform share`, 'AVAILABLE');
      }
      await ops.credit(clientWallet.id, amount, `${note} - refund`);

      let obligationId: string | undefined;
      if (gymShortfall.greaterThan(0)) {
        const row = await ops.tx.contractUnpaidObligation.create({
          data: {
            key: `${idempotencyKey}#GYM_DEBT`,
            transactionId,
            contractRef: label,
            kind: 'GYM_DEBT',
            party: 'GYM',
            owed: gymShare,
            paid: gymDebited,
            unpaid: gymShortfall,
            reason: `Appeal supplement ${amount.toFixed(0)}: gym ${gymId} could fund ${gymDebited.toFixed(0)} of its ${gymShare.toFixed(0)} share from its available balance; the platform fronted ${gymShortfall.toFixed(0)} from REVENUE so the member was paid in full`,
            sourceRef: idempotencyKey,
          },
        });
        obligationId = row.id;
        logger.warn(`[MembershipSupplement] ${label}: gym ${gymId} short by ${gymShortfall.toFixed(2)} - GYM_DEBT obligation ${row.id}; platform fronted it from REVENUE, member paid in full`);
      }

      return {
        refundedToClient: amount.toFixed(2),
        shortfall: '0.00',
        gymShare: gymShare.toFixed(2),
        gymDebited: gymDebited.toFixed(2),
        gymShortfall: gymShortfall.toFixed(2),
        platformShare: platformShare.toFixed(2),
        platformDebited: platformDebited.toFixed(2),
        ...(obligationId ? { obligationId } : {}),
      };
    }),
  );
}
