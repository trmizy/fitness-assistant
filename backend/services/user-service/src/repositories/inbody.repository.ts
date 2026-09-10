import { PrismaClient } from "../generated/prisma";

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
      // Sort by measurement date (dateOnly) — one record per day, ascending for charts
      orderBy: { dateOnly: "desc" },
    });
  },

  async findLatestByUserId(userId: string) {
    return prisma.inBodyEntry.findFirst({
      where: { userId },
      orderBy: { dateOnly: "desc" },
    });
  },

  // Gymini Adaptive Roadmap Production Closure — a single bounded,
  // server-side "latest measurement on/before a cutoff" query, for
  // callers (fitness-service's fetchLatestInBodyOnOrBefore) that only
  // ever need ONE row and previously had to download this user's ENTIRE
  // InBody history over HTTP just to filter it client-side. Filters on
  // the full `date` timestamp (not the day-only `dateOnly`) to stay
  // byte-for-byte equivalent to the client-side filter it replaces
  // (`new Date(e.date).getTime() <= cutoff.getTime()`).
  async findLatestByUserIdOnOrBefore(userId: string, cutoff: Date) {
    return prisma.inBodyEntry.findFirst({
      where: { userId, date: { lte: cutoff } },
      orderBy: { date: "desc" },
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

  async upsertByUserAndDate(
    userId: string,
    dateOnly: Date,
    createData: any,
    updateData: any,
  ) {
    return prisma.inBodyEntry.upsert({
      where: { inbody_entries_user_id_date_only_key: { userId, dateOnly } },
      create: { ...createData, userId },
      update: updateData,
    });
  },

  async delete(id: string) {
    return prisma.inBodyEntry.delete({
      where: { id },
    });
  },
};
