import { randomUUID } from 'crypto';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { verifyGymCheckinToken } from '../utils/checkinToken';
import { localDayWindow, windowOfLocalDate } from '../utils/local-day';
import { assertGymOpenForCheckin } from './checkin-gym-guard';
import { gymService } from './gym.service';
import { userClient, PtGymSessionsResponse } from '../clients/user.client';
import { authServiceClient } from '../clients/auth-service.client';

/**
 * Phase 2 / P2.2 - PT QR check-in (decisions D16, D17, D70).
 *
 * The PT scans the BRANCH's QR (the same signed token members use); the server decides. Entry is
 * allowed on a local day only when user-service reports at least one qualifying in-person session
 * of this PT at this branch overlapping that day.
 *
 * Owner rule D70: check-in is attendance only. It does NOT complete a session and does NOT touch
 * money - gym-service makes exactly one READ call to user-service, never a write, and this path
 * never reads or writes gym_membership_contracts / gym_check_ins (Q15: a PT who is also a member
 * uses this path and no visit is deducted).
 */

const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

function err(code: string, status: number) {
  return Object.assign(new Error(code), { status });
}

/** ptBlockedReason (user-service) -> the code the app shows. */
const BLOCKED_REASON_CODE: Record<string, string> = {
  PT_NOT_FOUND: 'PT_NOT_FOUND',
  NOT_A_PT: 'NOT_A_PT',
  PT_ACCOUNT_RESTRICTED: 'PT_RESTRICTED',
  PT_BANNED: 'PT_BANNED',
};

interface Session {
  sessionId: string;
  contractId: string;
  start: Date;
  end: Date;
}

/**
 * Validates user-service's payload. Anything that does not match the contract is treated as
 * "could not verify" (503), never as "no sessions" - a malformed answer must not become a refusal
 * the PT is told is final, nor an entry.
 */
function parseSessionsResponse(raw: unknown): { ptActive: boolean; blockedReason: string | null; sessions: Session[] } {
  let body: any = raw;
  if (body && typeof body === 'object' && body.ptActive === undefined && body.data && typeof body.data === 'object') {
    body = body.data; // tolerate a {success, data} envelope
  }
  if (!body || typeof body !== 'object' || typeof body.ptActive !== 'boolean' || !Array.isArray(body.sessions)) {
    throw new Error('malformed gym-sessions response');
  }
  const sessions: Session[] = body.sessions.map((s: any) => {
    const start = new Date(s?.scheduledStartAt);
    const end = new Date(s?.scheduledEndAt);
    if (
      typeof s?.sessionId !== 'string' || !s.sessionId ||
      typeof s?.contractId !== 'string' || !s.contractId ||
      Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    ) {
      throw new Error('malformed gym-sessions session entry');
    }
    return { sessionId: s.sessionId, contractId: s.contractId, start, end };
  });
  return {
    ptActive: body.ptActive,
    blockedReason: typeof body.ptBlockedReason === 'string' ? body.ptBlockedReason : null,
    sessions,
  };
}

const overlaps = (s: Session, from: Date, to: Date) => s.start < to && s.end > from;

interface PtCheckInRow {
  id: string;
  gym_id: string;
  brand_id: string | null;
  pt_user_id: string;
  local_date: string;
  first_scan_at: Date;
  last_scan_at: Date;
  scan_count: number;
  qualifying_session_ids: string[];
  contract_ids: string[];
}

/** Best-effort display name (auth-service owns names). Never throws; never returns the e-mail. */
async function fetchPtName(userId: string): Promise<string | null> {
  try {
    const data = await authServiceClient.getInternalUser(userId, INTERNAL_SERVICE_SECRET);
    const u = data?.user ?? data;
    const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
    return name || null;
  } catch {
    return null;
  }
}

export const ptCheckinService = {
  /**
   * @param now the instant the server received the scan (injectable for tests; default = now).
   */
  async checkInByGymToken(ptUserId: string, token: string, now: Date = new Date()) {
    const { gymId } = verifyGymCheckinToken(token); // INVALID_TOKEN / TOKEN_EXPIRED (400)

    const gym = await prisma.gym.findUnique({
      where: { id: gymId },
      select: { id: true, name: true, brandId: true, status: true, operationalStatus: true },
    });
    if (!gym) throw err('GYM_NOT_FOUND', 404);
    assertGymOpenForCheckin(gym.status, gym.operationalStatus); // GYM_NOT_ACTIVE (409) - same rule as members

    const { localDate, start: dayStart, end: dayEnd } = localDayWindow(now);

    // The only cross-service call: READ. Any failure to get a valid answer is "unavailable",
    // not "no session today" (Q16) - and nothing has been written yet.
    let verdict: ReturnType<typeof parseSessionsResponse>;
    try {
      const raw: PtGymSessionsResponse = await userClient.getPtGymSessions({
        ptUserId,
        gymId,
        from: dayStart,
        to: dayEnd,
      });
      verdict = parseSessionsResponse(raw);
    } catch (e: any) {
      logger.error({ err: e?.message, status: e?.response?.status, gymId, ptUserId }, '[PtCheckin] session lookup unavailable');
      throw err('PT_SESSION_CHECK_UNAVAILABLE', 503);
    }

    if (!verdict.ptActive) {
      throw err(BLOCKED_REASON_CODE[verdict.blockedReason ?? ''] ?? 'PT_RESTRICTED', 403);
    }

    // Defence in depth: only sessions that really overlap the day (user-service already filters).
    let qualifying = verdict.sessions.filter((s) => overlaps(s, dayStart, dayEnd));

    // Q-B - a session already recorded as basis for a DIFFERENT local day of this PT does not
    // qualify again once it has been moved off that day (one session must not buy entry on
    // several days via reschedules). A session that still overlaps the other day's window (it
    // spans midnight, Q18) was never moved and legitimately counts on both days.
    if (qualifying.length > 0) {
      const used = await prisma.$queryRaw<Array<{ local_date: string; qualifying_session_ids: string[] }>>`
        SELECT to_char(local_date, 'YYYY-MM-DD') AS local_date, qualifying_session_ids
        FROM gym_pt_check_ins
        WHERE pt_user_id = ${ptUserId}
          AND local_date <> ${localDate}::date
          AND qualifying_session_ids && ${qualifying.map((s) => s.sessionId)}::text[]`;
      if (used.length > 0) {
        qualifying = qualifying.filter((s) =>
          used.every((u) => {
            if (!u.qualifying_session_ids.includes(s.sessionId)) return true;
            const w = windowOfLocalDate(u.local_date);
            return overlaps(s, w.start, w.end); // still on that day => not moved
          }),
        );
      }
    }

    if (qualifying.length === 0) throw err('PT_NO_QUALIFYING_SESSION', 403);

    const sessionIds = qualifying.map((s) => s.sessionId);
    const contractIds = [...new Set(qualifying.map((s) => s.contractId))];
    const scanAt = now.toISOString();

    // ONE atomic statement: first scan inserts, every later/concurrent scan of the same
    // (branch, PT, local day) lands on the same row. No read-then-write window to race in.
    const rows = await prisma.$queryRaw<PtCheckInRow[]>`
      INSERT INTO gym_pt_check_ins
        (id, gym_id, brand_id, pt_user_id, local_date, first_scan_at, last_scan_at, scan_count,
         qualifying_session_ids, contract_ids)
      VALUES
        (${randomUUID()}, ${gym.id}, ${gym.brandId}, ${ptUserId}, ${localDate}::date,
         (${scanAt}::timestamptz AT TIME ZONE 'UTC'), (${scanAt}::timestamptz AT TIME ZONE 'UTC'), 1,
         ${sessionIds}::text[], ${contractIds}::text[])
      ON CONFLICT (gym_id, pt_user_id, local_date) DO UPDATE SET
        last_scan_at = GREATEST(gym_pt_check_ins.last_scan_at, EXCLUDED.last_scan_at),
        scan_count = gym_pt_check_ins.scan_count + 1,
        qualifying_session_ids = ARRAY(
          SELECT DISTINCT u FROM unnest(gym_pt_check_ins.qualifying_session_ids || EXCLUDED.qualifying_session_ids) AS u ORDER BY u),
        contract_ids = ARRAY(
          SELECT DISTINCT u FROM unnest(gym_pt_check_ins.contract_ids || EXCLUDED.contract_ids) AS u ORDER BY u)
      RETURNING id, gym_id, brand_id, pt_user_id, to_char(local_date, 'YYYY-MM-DD') AS local_date,
                first_scan_at, last_scan_at, scan_count, qualifying_session_ids, contract_ids`;
    const row = rows[0];

    logger.info(`[PtCheckin] gym=${gym.id} pt=${ptUserId} date=${localDate} scans=${row.scan_count}`);
    // No client identity, no visit counts: the PT sees only their own entry.
    return {
      ok: true,
      kind: 'PT' as const,
      checkinId: row.id,
      gymId: row.gym_id,
      gymName: gym.name,
      localDate: row.local_date,
      firstScanAt: row.first_scan_at,
      lastScanAt: row.last_scan_at,
      scanCount: row.scan_count,
      qualifyingSessionCount: row.qualifying_session_ids.length,
    };
  },

  /** Owner/manager list of PT entries at one branch (Q19). Never exposes client identity. */
  async listForGym(gymId: string, ownerId: string, limit = 50) {
    await gymService.getOwnedGym(gymId, ownerId);
    const rows = await prisma.gymPtCheckIn.findMany({
      where: { gymId },
      orderBy: [{ localDate: 'desc' }, { lastScanAt: 'desc' }],
      take: limit,
    });
    const ptIds = [...new Set(rows.map((r) => r.ptUserId))];
    const names = new Map<string, string | null>(
      await Promise.all(ptIds.map(async (id) => [id, await fetchPtName(id)] as const)),
    );
    return rows.map((r) => ({
      id: r.id,
      ptUserId: r.ptUserId,
      ptName: names.get(r.ptUserId) ?? null,
      localDate: r.localDate.toISOString().slice(0, 10), // DATE column: UTC midnight == the stored day
      firstScanAt: r.firstScanAt,
      lastScanAt: r.lastScanAt,
      scanCount: r.scanCount,
      qualifyingSessionCount: r.qualifyingSessionIds.length,
    }));
  },
};
