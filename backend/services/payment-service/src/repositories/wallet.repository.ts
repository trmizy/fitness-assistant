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
};
