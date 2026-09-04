import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

export const trainingLocationRepository = {
  findByPtUserId: (ptUserId: string) =>
    prisma.pTTrainingLocation.findMany({
      where: { ptUserId },
      include: {
        province: { select: { name: true } },
        ward: { select: { name: true } },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),

  findByIdAndOwner: (id: string, ptUserId: string) =>
    prisma.pTTrainingLocation.findFirst({
      where: { id, ptUserId },
    }),

  create: async (
    ptUserId: string,
    data: {
      provinceCode: number;
      wardCode?: number | null;
      gymName?: string | null;
      addressLine?: string | null;
      legacyDistrictName?: string | null;
      isPrimary?: boolean;
      note?: string | null;
    },
  ) => {
    return prisma.$transaction(async (tx) => {
      if (data.isPrimary) {
        await tx.pTTrainingLocation.updateMany({
          where: { ptUserId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.pTTrainingLocation.create({
        data: {
          ptUserId,
          provinceCode: data.provinceCode,
          wardCode: data.wardCode ?? null,
          gymName: data.gymName ?? null,
          addressLine: data.addressLine ?? null,
          legacyDistrictName: data.legacyDistrictName ?? null,
          isPrimary: data.isPrimary ?? false,
          note: data.note ?? null,
        },
        include: {
          province: { select: { name: true } },
          ward: { select: { name: true } },
        },
      });
    });
  },

  update: async (
    id: string,
    ptUserId: string,
    data: {
      provinceCode?: number;
      wardCode?: number | null;
      gymName?: string | null;
      addressLine?: string | null;
      legacyDistrictName?: string | null;
      isPrimary?: boolean;
      isActive?: boolean;
      note?: string | null;
    },
  ) => {
    return prisma.$transaction(async (tx) => {
      if (data.isPrimary === true) {
        await tx.pTTrainingLocation.updateMany({
          where: { ptUserId, isPrimary: true, id: { not: id } },
          data: { isPrimary: false },
        });
      }
      return tx.pTTrainingLocation.update({
        where: { id },
        data,
        include: {
          province: { select: { name: true } },
          ward: { select: { name: true } },
        },
      });
    });
  },

  softDelete: (id: string) =>
    prisma.pTTrainingLocation.update({
      where: { id },
      data: { isActive: false },
    }),
};
