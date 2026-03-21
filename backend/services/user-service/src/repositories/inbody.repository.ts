import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

export const inbodyRepository = {
  async create(userId: string, data: any) {
    return prisma.inBodyEntry.create({
      data: {
        ...data,
        userId,
      },
    });
  },

  async findByUserId(userId: string) {
    return prisma.inBodyEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  },

  async findLatestByUserId(userId: string) {
    return prisma.inBodyEntry.findFirst({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  },

  async findById(id: string) {
    return prisma.inBodyEntry.findUnique({
      where: { id },
    });
  },

  async update(id: string, data: any) {
    return prisma.inBodyEntry.update({
      where: { id },
      data,
    });
  },

  async delete(id: string) {
    return prisma.inBodyEntry.delete({
      where: { id },
    });
  },
};
