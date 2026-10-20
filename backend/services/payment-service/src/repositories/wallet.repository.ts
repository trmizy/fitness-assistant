import { prisma } from './prisma';
import { WalletOwnerType } from '../generated/prisma';

export const walletRepository = {
  async findByOwner(ownerType: WalletOwnerType, ownerId: string) {
    return prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType, ownerId } } });
  },

  async findLedgerEntries(walletId: string, limit = 50) {
    return prisma.walletLedgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  /**
   * The history the apps show: the same rows, newest first, each with the one fact its description cannot
   * state structurally — what the owning transaction was for. Selected narrowly (purpose / related entity
   * type only) and used by the route solely to derive `category`; the transaction itself is not returned.
   */
  async findLedgerEntriesWithPurpose(walletId: string, limit = 50) {
    return prisma.walletLedgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { transaction: { select: { purpose: true, relatedEntityType: true } } },
    });
  },
};
