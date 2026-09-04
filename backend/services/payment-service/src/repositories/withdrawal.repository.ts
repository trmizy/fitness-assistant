import { Prisma, WalletOwnerType, WithdrawalRequestStatus } from '../generated/prisma';
import { prisma } from './prisma';

const ZERO = new Prisma.Decimal(0);

export const withdrawalRepository = {
  create: (data: {
    walletId: string;
    ownerType: WalletOwnerType;
    ownerId: string;
    amount: Prisma.Decimal;
    payoutInfo: string;
  }) => prisma.withdrawalRequest.create({ data: { ...data, status: 'PENDING' } }),

  findById: (id: string) => prisma.withdrawalRequest.findUnique({ where: { id } }),

  findByWallet: (walletId: string) =>
    prisma.withdrawalRequest.findMany({ where: { walletId }, orderBy: { createdAt: 'desc' } }),

  /**
   * Backs the admin resolution queue (GET /admin/payments/withdrawals) — everything still
   * awaiting a real bank transfer. APPROVED must stay included: "Duyệt" is an optional
   * lock-it-for-later step (see withdrawal.service.ts#approve), not a terminal state, and an
   * admin who approves now to pay later needs to be able to find the request again afterward.
   * Originally PENDING-only, which silently dropped every approved-but-unpaid request from the
   * admin's own queue the moment they clicked "Duyệt" — found live via TC-WD-007 in the E2E
   * suite: an admin could approve a request and then never see it again to mark it paid.
   */
  listPending: (limit = 100) =>
    prisma.withdrawalRequest.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),

  listByStatus: (status: WithdrawalRequestStatus, limit = 100) =>
    prisma.withdrawalRequest.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: limit }),

  /**
   * Money-flow plan 5.3 — "số dư khả dụng trừ đi các yêu cầu đang chờ". Still needed for the
   * CLIENT branch of requestWithdrawal, whose withdrawable amount is computed from summed
   * ledger credits (refund/compensation-sourced), not from wallet.availableBalance directly —
   * that formula has no other way to know about an APPROVED-but-unpaid request.
   *
   * P0 cluster F: everywhere else, use sumPendingAmount instead. Since approve() now actually
   * moves an APPROVED request's amount out of availableBalance into lockedBalance,
   * wallet.availableBalance already reflects that reduction on its own — subtracting it again
   * here would double-count it. Only a still-PENDING request (nothing moved yet) needs
   * subtracting from a raw availableBalance read.
   */
  async sumOpenAmount(walletId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.withdrawalRequest.aggregate({
      where: { walletId, status: { in: ['PENDING', 'APPROVED'] } },
      _sum: { amount: true },
    });
    return rows._sum.amount ?? ZERO;
  },

  /** P0 cluster F — see sumOpenAmount's comment for why this is the one to use against
   * wallet.availableBalance directly (the non-CLIENT branch of requestWithdrawal). */
  async sumPendingAmount(walletId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.withdrawalRequest.aggregate({
      where: { walletId, status: 'PENDING' },
      _sum: { amount: true },
    });
    return rows._sum.amount ?? ZERO;
  },

  /** Money already paid out via this flow — subtracted from a CLIENT wallet's
   * refund-sourced-credits total so the same refund đồng cannot be withdrawn twice. */
  async sumPaidAmount(walletId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.withdrawalRequest.aggregate({
      where: { walletId, status: 'PAID' },
      _sum: { amount: true },
    });
    return rows._sum.amount ?? ZERO;
  },

  updateStatus: (
    id: string,
    status: WithdrawalRequestStatus,
    extra?: Prisma.WithdrawalRequestUpdateInput,
  ) => prisma.withdrawalRequest.update({ where: { id }, data: { status, ...extra } }),

  /**
   * Money-flow plan 5.3 — "Ví khách chỉ rút được phần tiền có nguồn gốc hoàn trả". No
   * structured "reason" field exists on WalletLedgerEntry (a bigger schema change than this
   * minimal flow's scope), so this matches on the description every refund/compensation
   * credit call site already writes (contract-ledger.service.ts, membership-ledger.service.ts)
   * — "refund" or "compensation". Documented as a known limitation: a future free-text
   * description that happens not to contain either word would under-count, never over-count
   * (the client loses withdrawable balance, never gains money they should not have) — the
   * safer direction for a limitation to fail in.
   */
  async sumRefundSourcedCredits(walletId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.walletLedgerEntry.findMany({
      where: {
        walletId,
        entryType: 'CREDIT',
        bucket: 'AVAILABLE',
        OR: [
          { description: { contains: 'refund', mode: 'insensitive' } },
          { description: { contains: 'compensation', mode: 'insensitive' } },
        ],
      },
      select: { amount: true },
    });
    return rows.reduce((sum, r) => sum.plus(r.amount), ZERO);
  },
};
