import { AuditEntityType, Prisma } from "../generated/prisma";
import { prisma } from "./profile.repository";

export const auditRepository = {
  create: (data: {
    actorUserId: string;
    action: string;
    entityType: AuditEntityType;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) => prisma.auditLog.create({ data }),

  /** History of one entity, newest first — what a dispute investigation reads. */
  findByEntity: (
    entityType: AuditEntityType,
    entityId: string,
    skip = 0,
    take = 50,
  ) =>
    prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
};
