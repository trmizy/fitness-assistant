import { Router, Request, Response } from 'express';
import { z } from 'zod';

/**
 * Dispute Case slice 2 / S2.3 - READ-ONLY evidence for user-service's Case collector. Mounted from internal.routes.ts AFTER its serviceSecretMiddleware
 * (x-service-secret), so every route here requires the service secret; the gateway does not proxy /internal.
 *
 *   GET /internal/pt-checkins?ptUserId=&gymId=&date=YYYY-MM-DD
 *     -> { data: null | { firstScanAt, lastScanAt, scanCount, qualifyingSessionIds } }   exactly the one record (gym, PT, local day), or null
 *   GET /internal/member-checkins?membershipId=&from=&to=
 *     -> { data: [{ createdAt, source, gymId, checkedInBy, assisted: null | { method, staffRole, eventAt } }] }   the check-ins of ONE membership inside a window of at most 48 hours, at most MAX_ROWS
 *
 * Every key is mandatory (no listing, no "all"), unknown / repeated query parameters are refused, nothing else is returned. What the rows prove is
 * for the Case to say (design 1.4.2): a PT scan is the PT's own claim stored by the server (E2) and does not prove teaching; `qualifyingSessionIds` is
 * DERIVED (E3); an absent record proves nothing about absence.
 */
export const MAX_ROWS = 100;
export const MAX_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface PtCheckinEvidence {
  firstScanAt: Date;
  lastScanAt: Date;
  scanCount: number;
  qualifyingSessionIds: string[];
}
export interface MemberCheckinEvidence {
  createdAt: Date;
  /** QR = the member scanned the gym QR themselves; ASSISTED = a staff member checked them in. */
  source: string;
  gymId: string;
  /** Who performed the scan: the member (QR) or the staff member (ASSISTED). */
  checkedInBy: string;
  /** ASSISTED only: how the staff member verified the member's identity (gym_assisted_checkin_events). null for QR. */
  assisted: { method: string | null; staffRole: string | null; eventAt: Date } | null;
}
export interface DisputeEvidenceDeps {
  findPtCheckin: (q: { ptUserId: string; gymId: string; localDate: string }) => Promise<PtCheckinEvidence | null>;
  findMemberCheckins: (q: { membershipId: string; from: Date; to: Date; take: number }) => Promise<MemberCheckinEvidence[]>;
}

const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/);
const realDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'not a calendar date');
const ptQuery = z.object({ ptUserId: id, gymId: id, date: realDate }).strict();
const memberQuery = z
  .object({ membershipId: id, from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) })
  .strict()
  .superRefine((q, ctx) => {
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (!(from < to)) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
    else if (to - from > MAX_WINDOW_MS) ctx.addIssue({ code: 'custom', path: ['to'], message: 'window longer than 48 hours' });
  });

function bad(res: Response, err: z.ZodError) {
  res.status(400).json({ error: 'Invalid query: every key is required, nothing else is accepted', fields: err.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`) });
}

export function createInternalDisputeEvidenceRoutes(deps: DisputeEvidenceDeps): Router {
  const router = Router();

  router.get('/pt-checkins', async (req: Request, res: Response) => {
    const q = ptQuery.safeParse(req.query);
    if (!q.success) return bad(res, q.error);
    const row = await deps.findPtCheckin({ ptUserId: q.data.ptUserId, gymId: q.data.gymId, localDate: q.data.date });
    res.set('Cache-Control', 'no-store').json({
      data: row ? { firstScanAt: row.firstScanAt, lastScanAt: row.lastScanAt, scanCount: row.scanCount, qualifyingSessionIds: [...row.qualifyingSessionIds] } : null,
    });
  });

  router.get('/member-checkins', async (req: Request, res: Response) => {
    const q = memberQuery.safeParse(req.query);
    if (!q.success) return bad(res, q.error);
    const rows = await deps.findMemberCheckins({ membershipId: q.data.membershipId, from: new Date(q.data.from), to: new Date(q.data.to), take: MAX_ROWS });
    res.set('Cache-Control', 'no-store').json({ data: rows.slice(0, MAX_ROWS).map((r) => ({
        createdAt: r.createdAt,
        source: r.source,
        gymId: r.gymId,
        checkedInBy: r.checkedInBy,
        assisted: r.assisted ? { method: r.assisted.method, staffRole: r.assisted.staffRole, eventAt: r.assisted.eventAt } : null,
      })) });
  });

  return router;
}
