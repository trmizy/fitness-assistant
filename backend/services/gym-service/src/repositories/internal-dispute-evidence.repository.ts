import { prisma } from './prisma';
import type { DisputeEvidenceDeps } from '../routes/internal-dispute-evidence.routes';

/** Read-only queries for the Dispute Case collector. Each selects exactly the evidence fields. */
export const internalDisputeEvidenceRepository: DisputeEvidenceDeps = {
  findPtCheckin: async ({ ptUserId, gymId, localDate }) => {
    const row = await prisma.gymPtCheckIn.findUnique({
      where: { gymId_ptUserId_localDate: { gymId, ptUserId, localDate: new Date(`${localDate}T00:00:00.000Z`) } },
      select: { firstScanAt: true, lastScanAt: true, scanCount: true, qualifyingSessionIds: true },
    });
    return row;
  },
  findMemberCheckins: async ({ membershipId, from, to, take }) => {
    const rows = await prisma.gymCheckIn.findMany({
      where: { membershipId, createdAt: { gte: from, lt: to } },
      select: { createdAt: true, source: true, gymId: true, checkedInBy: true, assistedEventId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
    });
    const eventIds = rows.map((r) => r.assistedEventId).filter((x): x is string => !!x);
    const events = eventIds.length
      ? await prisma.gymAssistedCheckInEvent.findMany({ where: { id: { in: eventIds } }, select: { id: true, method: true, staffRole: true, createdAt: true } })
      : [];
    const byId = new Map(events.map((e) => [e.id, e]));
    return rows.map((r) => {
      const e = r.assistedEventId ? byId.get(r.assistedEventId) : undefined;
      return {
        createdAt: r.createdAt,
        source: r.source,
        gymId: r.gymId,
        checkedInBy: r.checkedInBy,
        assisted: r.source === 'ASSISTED' ? { method: e?.method ?? null, staffRole: e?.staffRole ?? null, eventAt: e?.createdAt ?? r.createdAt } : null,
      };
    });
  },
};
