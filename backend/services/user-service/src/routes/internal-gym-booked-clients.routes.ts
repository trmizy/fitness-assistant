import { Router } from "express";
import { logger } from "@gym-coach/shared";
import { ContractStatus, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";

/**
 * D15 (lễ tân) - READ-ONLY, mounted under /internal (service-secret already enforced by internal.routes.ts).
 *
 * gym-service asks "which clients have a face-to-face PT session booked at THIS branch in [from, to)" so the front desk can
 * see who is expected today. The answer carries ONLY client user ids (gym-service resolves display names itself) and the
 * earliest start time: no PT, no contract, no price, no notes, no phone/e-mail/health data. Nothing is written.
 *
 * "Booked" = OFFLINE session of a contract at this gym, status CONFIRMED / PENDING_CLIENT_CONFIRMATION / COMPLETED (the
 * same set a PT may enter on, see pt-gym-sessions.service.ts), whose contract is ACTIVE or COMPLETED.
 */
const router = Router();

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
const MAX_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_CLIENTS = 200;

const BOOKED_STATUSES: SessionStatus[] = [
  SessionStatus.CONFIRMED,
  SessionStatus.PENDING_CLIENT_CONFIRMATION,
  SessionStatus.COMPLETED,
];
const CONTRACT_STATUSES: ContractStatus[] = [ContractStatus.ACTIVE, ContractStatus.COMPLETED];

export function parseBookedClientsQuery(query: Record<string, unknown>): { ok: true; from: Date; to: Date } | { ok: false; error: string } {
  const parse = (v: unknown, name: string): Date | string => {
    if (typeof v !== "string" || !ISO_INSTANT.test(v)) return `${name} phải là thời điểm ISO-8601 có múi giờ`;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? `${name} không hợp lệ` : d;
  };
  const f = parse(query.from, "from");
  if (typeof f === "string") return { ok: false, error: f };
  const t = parse(query.to, "to");
  if (typeof t === "string") return { ok: false, error: t };
  if (f.getTime() >= t.getTime()) return { ok: false, error: "from phải nhỏ hơn to" };
  if (t.getTime() - f.getTime() > MAX_WINDOW_MS) return { ok: false, error: "Khoảng thời gian tối đa là 48 giờ" };
  return { ok: true, from: f, to: t };
}

router.get("/:gymId/booked-clients", async (req, res) => {
  const gymId = (req.params.gymId ?? "").trim();
  if (!gymId || gymId.length > 128) {
    res.status(400).json({ error: "gymId là bắt buộc", code: "INVALID_QUERY" });
    return;
  }
  const q = parseBookedClientsQuery(req.query);
  if (!q.ok) {
    res.status(400).json({ error: q.error, code: "INVALID_QUERY" });
    return;
  }
  try {
    const rows = await prisma.session.findMany({
      where: {
        sessionMode: "OFFLINE",
        status: { in: BOOKED_STATUSES },
        scheduledStartAt: { lt: q.to },
        scheduledEndAt: { gt: q.from },
        contract: { gymId, status: { in: CONTRACT_STATUSES } },
      },
      select: { clientUserId: true, scheduledStartAt: true },
      orderBy: [{ scheduledStartAt: "asc" }, { id: "asc" }],
      take: 1000,
    });
    const first = new Map<string, Date>();
    for (const r of rows) if (!first.has(r.clientUserId)) first.set(r.clientUserId, r.scheduledStartAt);
    const clients = [...first.entries()]
      .slice(0, MAX_CLIENTS)
      .map(([clientUserId, startAt]) => ({ clientUserId, startAt: startAt.toISOString() }));
    res.json({ gymId, clients });
  } catch (error: any) {
    logger.error(error, "gym booked-clients read failed");
    res.status(500).json({ error: error.message });
  }
});

export default router;
