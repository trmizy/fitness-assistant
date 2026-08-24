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

  listPending: (limit = 100) =>
    prisma.withdrawalRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),

  listByStatus: (status: WithdrawalRequestStatus, limit = 100) =>
    prisma.withdrawalRequest.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: limit }),

  /** Money-flow plan 5.3: "số dư khả dụng trừ đi các yêu cầu đang chờ" — PENDING and
   * APPROVED both still owe this amount out of availableBalance; only PAID has actually
   * left the wallet (that debit is a real ledger entry, already reflected in
   * wallet.availableBalance itself). REJECTED never counted. */
  async sumOpenAmount(walletId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.withdrawalRequest.aggregate({
      where: { walletId, status: { in: ['PENDING', 'APPROVED'] } },
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
