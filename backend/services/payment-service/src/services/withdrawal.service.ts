import { logger } from '@gym-coach/shared';
import { Prisma, WalletOwnerType } from '../generated/prisma';
import { withdrawalRepository } from '../repositories/withdrawal.repository';
import { walletRepository } from '../repositories/wallet.repository';
import { prisma } from '../repositories/prisma';
import { walletService } from './wallet.service';
import { withIdempotentLedgerOp } from './ledger-idempotency';

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * WalletLedgerEntry.transactionId is a hard FK to PaymentTransaction — every other caller of
 * withWallets passes the id of the real gateway transaction the movement traces back to. A
 * withdrawal payout is outbound money with no such origin (unlike a REFUND, which reuses the
 * original purchase's transaction), so it needs a PaymentTransaction row of its own.
 *
 * Created with the SAME business key (`WITHDRAWAL:<id>`) as the idempotency-op below, via the
 * getOrCreateWallet-style catch-P2002-and-refetch pattern already used elsewhere in this file's
 * package — so a concurrent or retried markPaid reuses the one row instead of leaving orphans.
 * Starts PENDING and is flipped to PAID inside the same wallet transaction as the debit, so a
 * failed debit (e.g. InsufficientBalanceError) never leaves a PAID row for money that never
 * moved.
 */
async function getOrCreatePayoutTransaction(request: {
  id: string;
  ownerId: string;
  amount: Prisma.Decimal;
}, adminId: string) {
  const idempotencyKey = `WITHDRAWAL:${request.id}`;
  try {
    return await prisma.paymentTransaction.create({
      data: {
        payerId: request.ownerId,
        purpose: 'WITHDRAWAL',
        amount: request.amount,
        status: 'PENDING',
        idempotencyKey,
        initiatedBy: adminId,
        sourceService: 'payment-service',
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e;
    return prisma.paymentTransaction.findUniqueOrThrow({ where: { idempotencyKey } });
  }
}

/**
 * Money-flow redesign plan 5.3 — "luồng rút tiền bán thủ công".
 *
 * Deliberately minimal, per the plan's explicit scope: no payout-API integration anywhere in
 * this file. `markPaid` is the ONLY place a ledger entry is written, and it runs only after an
 * admin confirms a real bank/e-wallet transfer already happened outside this system — this
 * service tracks that transfer, it never triggers one.
 */
export const withdrawalService = {
  /**
   * `amount` and `payoutInfo` come from the requester; ownerType/ownerId must come from the
   * caller's own verified identity (or, for GYM, from a caller that has already verified gym
   * ownership — see gym-service's /owner/gyms/:gymId/withdrawals) — never from the request
   * body, for the same reason contract prices never do.
   */
  async requestWithdrawal(ownerType: WalletOwnerType, ownerId: string, amount: string, payoutInfo: string) {
    const amountDecimal = new Prisma.Decimal(amount);
    if (!amountDecimal.isFinite() || amountDecimal.lessThanOrEqualTo(0)) {
      throw err('Số tiền rút phải lớn hơn 0', 400, 'INVALID_AMOUNT');
    }
    if (!payoutInfo?.trim()) {
      throw err('Cần thông tin tài khoản nhận tiền', 400, 'PAYOUT_INFO_REQUIRED');
    }

    const wallet = await walletRepository.findByOwner(ownerType, ownerId);
    if (!wallet) throw err('Ví không tồn tại', 404, 'WALLET_NOT_FOUND');
    if (wallet.status !== 'ACTIVE') throw err('Ví hiện không hoạt động', 409, 'WALLET_NOT_ACTIVE');

    // P0 cluster F: two different sums, on purpose. sumPendingAmount (PENDING only) is what
    // is genuinely still sitting in availableBalance and not yet reserved anywhere — approve()
    // now actually moves an APPROVED request's amount out to lockedBalance, so
    // wallet.availableBalance already reflects that reduction on its own. sumOpenAmount
    // (PENDING + APPROVED) stays reserved for the CLIENT branch below, whose formula is
    // ledger-description-based rather than derived from availableBalance and so has no other
    // way to know about an approved-but-unpaid request.
    const pendingReserved = await withdrawalRepository.sumPendingAmount(wallet.id);

    let withdrawable: Prisma.Decimal;
    if (ownerType === 'CLIENT') {
      // Money-flow plan 5.3: a client wallet may only withdraw refund/compensation-sourced
      // money, never money from some other source (there is currently no other legitimate
      // credit source to a client wallet, but this must not silently change if one is added
      // later without this check being revisited).
      const refundSourced = await withdrawalRepository.sumRefundSourcedCredits(wallet.id);
      const alreadyPaidOut = await withdrawalRepository.sumPaidAmount(wallet.id);
      const alreadyOpen = await withdrawalRepository.sumOpenAmount(wallet.id);
      withdrawable = refundSourced.minus(alreadyPaidOut).minus(alreadyOpen);
    } else {
      withdrawable = wallet.availableBalance.minus(pendingReserved);
    }
    // Defensive floor regardless of branch — whatever is genuinely still sitting in
    // availableBalance (net of still-PENDING requests) is the hard ceiling no wallet can ever
    // exceed withdrawing past. An APPROVED request already left availableBalance for real
    // (into lockedBalance), so it must not be subtracted here a second time.
    withdrawable = Prisma.Decimal.min(withdrawable, wallet.availableBalance.minus(pendingReserved));

    if (amountDecimal.greaterThan(withdrawable)) {
      throw err(
        ownerType === 'CLIENT'
          ? 'Số tiền vượt quá phần tiền hoàn trả có thể rút'
          : 'Số tiền vượt quá số dư khả dụng (đã trừ các yêu cầu đang chờ)',
        400,
        'EXCEEDS_WITHDRAWABLE_BALANCE',
      );
    }

    return withdrawalRepository.create({
      walletId: wallet.id,
      ownerType,
      ownerId,
      amount: amountDecimal,
      payoutInfo: payoutInfo.trim(),
    });
  },

  async listMine(ownerType: WalletOwnerType, ownerId: string) {
    const wallet = await walletRepository.findByOwner(ownerType, ownerId);
    if (!wallet) return [];
    return withdrawalRepository.findByWallet(wallet.id);
  },

  async listPending() {
    return withdrawalRepository.listPending();
  },

  /**
   * P0 cluster F — approval now REALLY moves the money, AVAILABLE -> LOCKED, not just a
   * status flip. Locked is a hard reservation: every other money-moving path in this service
   * (a clawback, an admin refund, anything) only ever debits AVAILABLE by default (see
   * wallet.service.ts's Bucket type and applyDebit's default parameter) — it structurally
   * cannot reach LOCKED without explicitly naming that bucket, which nothing outside this
   * file does. That is what makes an approved-for-payout amount actually safe from a later
   * clawback eating into it, instead of the old purely-computed
   * withdrawalRepository.sumOpenAmount reservation, which never moved anything and could be
   * silently outrun by an unrelated debit running in the gap between approval and payout.
   */
  async approve(id: string, adminId: string) {
    const request = await withdrawalRepository.findById(id);
    if (!request) throw err('Yêu cầu không tồn tại', 404, 'NOT_FOUND');
    if (request.status !== 'PENDING') {
      throw err(`Không thể duyệt yêu cầu ở trạng thái ${request.status}`, 400, 'INVALID_STATUS');
    }

    const payoutTxn = await getOrCreatePayoutTransaction(request, adminId);
    return walletService.withWallets([request.walletId], payoutTxn.id, (ops) =>
      withIdempotentLedgerOp(ops, `WITHDRAWAL_LOCK:${request.id}`, async () => {
        await ops.debit(request.walletId, request.amount, `Withdrawal ${request.id} approved — locked for payout`, 'AVAILABLE');
        await ops.credit(request.walletId, request.amount, `Withdrawal ${request.id} approved — locked for payout`, 'LOCKED');
        return ops.tx.withdrawalRequest.update({
          where: { id },
          data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
        });
      }),
    );
  },

  /** P0 cluster F — a request rejected AFTER approval had its money moved to LOCKED; that
   * must come back to AVAILABLE here, or it stays stranded in LOCKED forever. A request
   * rejected while still PENDING never had anything moved (see approve, above) — pure status
   * flip, unchanged from before. */
  async reject(id: string, adminId: string, reason: string) {
    if (!reason?.trim()) throw err('Cần nêu lý do từ chối', 400, 'REASON_REQUIRED');
    const request = await withdrawalRepository.findById(id);
    if (!request) throw err('Yêu cầu không tồn tại', 404, 'NOT_FOUND');
    if (request.status === 'PAID') {
      throw err('Không thể từ chối một yêu cầu đã chi trả', 400, 'ALREADY_PAID');
    }

    if (request.status === 'APPROVED') {
      const payoutTxn = await getOrCreatePayoutTransaction(request, adminId);
      await walletService.withWallets([request.walletId], payoutTxn.id, (ops) =>
        withIdempotentLedgerOp(ops, `WITHDRAWAL_UNLOCK:${request.id}`, async () => {
          await ops.debit(request.walletId, request.amount, `Withdrawal ${request.id} rejected — restored from lock`, 'LOCKED');
          await ops.credit(request.walletId, request.amount, `Withdrawal ${request.id} rejected — restored from lock`, 'AVAILABLE');
          return { unlocked: request.amount.toFixed(2) };
        }),
      );
    }

    return withdrawalRepository.updateStatus(id, 'REJECTED', {
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: reason.trim(),
    });
  },

  /**
   * The ONLY place money actually LEAVES THE PLATFORM in this whole flow. `bankReference` is
   * the paper trail for a transfer the admin ALREADY MADE manually, outside this system —
   * this call records that it happened, it does not cause a payout to be sent.
   *
   * P0 cluster F: an admin may still go straight from PENDING to markPaid, skipping the
   * separate approve() click (kept — this was already a supported, tested shortcut) — in that
   * case the lock-then-pay move happens right here, in the same atomic operation, so the
   * ledger trail ends up identical either way. If the request WAS approved earlier, that move
   * already happened and this only needs to debit LOCKED.
   */
  async markPaid(id: string, adminId: string, bankReference: string) {
    if (!bankReference?.trim()) throw err('Cần mã tham chiếu ngân hàng', 400, 'BANK_REFERENCE_REQUIRED');
    const request = await withdrawalRepository.findById(id);
    if (!request) throw err('Yêu cầu không tồn tại', 404, 'NOT_FOUND');
    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      throw err(`Không thể chi trả một yêu cầu ở trạng thái ${request.status}`, 400, 'INVALID_STATUS');
    }

    const payoutTxn = await getOrCreatePayoutTransaction(request, adminId);
    const escrowWallet = await walletService.getEscrowWallet();

    // withWallets' own applyDebit throws InsufficientBalanceError if the wallet's real
    // available/locked balance has somehow dropped below this amount since the request was
    // made (e.g. an intervening clawback that outran a still-PENDING request that never got
    // locked) — that failure surfaces to the admin rather than silently overdrawing the
    // wallet. withIdempotentLedgerOp guards the debit itself: two concurrent markPaid calls
    // serialize on the wallet's FOR UPDATE lock, and the loser finds this key already claimed
    // and replays instead of debiting a second time.
    return walletService.withWallets([request.walletId, escrowWallet.id], payoutTxn.id, (ops) =>
      withIdempotentLedgerOp(ops, `WITHDRAWAL:${request.id}`, async () => {
        if (request.status === 'PENDING') {
          // Never explicitly approved — lock it now, in the same operation, so a request paid
          // this way leaves the exact same ledger trail (a LOCK move followed by a LOCKED
          // debit) as one that went through approve() first.
          await ops.debit(request.walletId, request.amount, `Withdrawal ${request.id} approved — locked for payout`, 'AVAILABLE');
          await ops.credit(request.walletId, request.amount, `Withdrawal ${request.id} approved — locked for payout`, 'LOCKED');
        }
        await ops.debit(request.walletId, request.amount, `Withdrawal ${request.id} paid — ref ${bankReference.trim()}`, 'LOCKED');
        // ESCROW.available is "every đồng taken in and not yet paid out" (reconcile.service.ts's
        // invariant doc comment) — the partner's own wallet debit above only reallocates a
        // *claim* on that cash between wallets, it never removes money from the platform. A
        // withdrawal is the first flow where money genuinely LEAVES the platform, so it must
        // also debit escrow by the same amount or the invariant permanently drifts by exactly
        // this payout's size (caught live: reconciliation reported drift === withdrawal amount
        // before this line existed).
        await ops.debit(escrowWallet.id, request.amount, `Withdrawal ${request.id} paid out — ref ${bankReference.trim()}`);
        await ops.tx.paymentTransaction.update({ where: { id: payoutTxn.id }, data: { status: 'PAID', paidAt: new Date() } });
        return ops.tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: 'PAID',
            bankReference: bankReference.trim(),
            reviewedBy: request.reviewedBy ?? adminId,
            reviewedAt: request.reviewedAt ?? new Date(),
            paidAt: new Date(),
          },
        });
      }),
    ).catch((e) => {
      logger.error({ error: 'Withdrawal markPaid failed', withdrawalId: id, message: (e as Error).message });
      throw e;
    });
  },
};
