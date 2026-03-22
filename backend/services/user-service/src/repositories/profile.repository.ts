import { PrismaClient } from '../generated/prisma';

export const prisma = new PrismaClient();

export const profileRepository = {
  findByUserId: (userId: string) =>
    prisma.userProfile.findUnique({ where: { userId } }),

  findByUserIds: (userIds: string[]) =>
    prisma.userProfile.findMany({ where: { userId: { in: userIds } } }),

  upsert: (userId: string, data: Record<string, any>) =>
    prisma.userProfile.upsert({
      where: { userId },
      update: { ...data, updatedAt: new Date() },
      create: { userId, ...data },
    }),

  setIsPT: (userId: string, isPT: boolean) =>
    prisma.userProfile.upsert({
      where: { userId },
      update: { isPT },
      create: { userId, isPT },
    }),

  setIsPTByUserId: (userId: string, isPT: boolean) =>
    prisma.userProfile.upsert({
      where: { userId },
      update: { isPT, updatedAt: new Date() },
      create: { userId, isPT },
    }),

  /** List users where isPT = true, for chat "find a PT" feature */
  findPTs: () =>
    prisma.userProfile.findMany({ where: { isPT: true } }),

  deleteByUserId: (userId: string) =>
    prisma.userProfile.delete({ where: { userId } }),
};
