import { ContractStatus, PtRestrictionType, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { sessionRepository } from "../repositories/session.repository";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { getActiveRestriction, getEffectiveContractStatuses } from "./pt-restriction.service";

/**
 * PT QR check-in (Phase 2 / P2.1, decisions D16 / D17 / D38 / D59 / D70) - the ONE read gym-service asks before letting a PT in:
 * "which face-to-face sessions of this PT, at this gym, touch this time window, and may count as a reason to enter?".
 *
 * READ-ONLY by construction: nothing here writes, locks, or calls another service. It does not change a session, a contract
 * counter or a settlement row, and it never decides anything about money - check-in is presence, not session completion (D70).
 *
 * Rules (each one is pinned by pt-gym-sessions.integration.test.ts):
 *  - PT unusable as a whole -> ptActive=false + a reason, sessions=[]: no profile (PT_NOT_FOUND), not a PT (NOT_A_PT), an
 *    ACCOUNT-scope suspension (PT_ACCOUNT_RESTRICTED), a permanent ban or the fail-closed legacy flag (PT_BANNED). Answered by
 *    the existing getActiveRestriction - nothing is re-implemented.
 *  - otherwise the sessions are OFFLINE, of a contract at `gymId`, in {CONFIRMED, PENDING_CLIENT_CONFIRMATION, COMPLETED} (Q14),
 *    whose interval overlaps [from, to) (Q18: a session across midnight counts for both days), and whose contract
 *      . is ACTIVE or COMPLETED (not cancelled / expired / rejected / pending...),
 *      . is not paused by a CONTRACT-scope (or account-scope) restriction - getEffectiveContractStatuses (D38: restricting
 *        An-Binh drops only Binh's sessions; An-Chi still counts),
 *      . has no recorded-but-unconfirmed ending (D59 CONTRACT_ENDING: Q-E, an ending contract gives no new reason to enter) -
 *        the SAME predicate withRunningContract uses (a CONTRACT_TERMINATION settlement row that is not SETTLED).
 *  - no client identity field is ever returned.
 * Queries: 2 (profile + account restriction) + 1 sessions + 3 batched restriction reads + 1 batched ending read; no per-session or
 * per-contract query.
 */

export type PtBlockedReason = "PT_NOT_FOUND" | "NOT_A_PT" | "PT_ACCOUNT_RESTRICTED" | "PT_BANNED";

export interface PtGymSession {
  sessionId: string;
  contractId: string;
  status: SessionStatus;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}

export interface PtGymSessionsResult {
  ptUserId: string;
  gymId: string;
  ptActive: boolean;
  ptBlockedReason: PtBlockedReason | null;
  sessions: PtGymSession[];
}

/** Q14: the sessions that may be a reason to enter. Excludes REQUESTED, DISPUTED, PT_NO_SHOW_REPORTED, NO_SHOW, CANCELLED... */
export const PT_CHECKIN_SESSION_STATUSES: SessionStatus[] = [
  SessionStatus.CONFIRMED,
  SessionStatus.PENDING_CLIENT_CONFIRMATION,
  SessionStatus.COMPLETED,
];

/** A contract that is running or finished normally may back a session; every other status may not. */
const CHECKIN_CONTRACT_STATUSES: ReadonlySet<string> = new Set([ContractStatus.ACTIVE, ContractStatus.COMPLETED]);

export const PT_GYM_SESSIONS_MAX_WINDOW_MS = 48 * 60 * 60 * 1000;

export const ptGymSessionsService = {
  async list(ptUserId: string, gymId: string, from: Date, to: Date): Promise<PtGymSessionsResult> {
    const blocked = (reason: PtBlockedReason): PtGymSessionsResult => ({
      ptUserId,
      gymId,
      ptActive: false,
      ptBlockedReason: reason,
      sessions: [],
    });

    const profile = await prisma.userProfile.findUnique({ where: { userId: ptUserId }, select: { isPT: true } });
    if (!profile) return blocked("PT_NOT_FOUND");
    if (!profile.isPT) return blocked("NOT_A_PT");
    const restriction = await getActiveRestriction(ptUserId);
    if (restriction) {
      return blocked(restriction.type === PtRestrictionType.TEMPORARY_SUSPENSION ? "PT_ACCOUNT_RESTRICTED" : "PT_BANNED");
    }

    const rows = await sessionRepository.findOfflineForPtAtGymOverlapping(ptUserId, gymId, PT_CHECKIN_SESSION_STATUSES, from, to);
    const contracts = [...new Map(rows.map((r) => [r.contract.id, r.contract])).values()].filter((c) => CHECKIN_CONTRACT_STATUSES.has(c.status));
    if (contracts.length === 0) return { ptUserId, gymId, ptActive: true, ptBlockedReason: null, sessions: [] };

    const [effective, ending] = await Promise.all([
      getEffectiveContractStatuses(contracts),
      sessionSettlementRepository.findContractIdsWithUnconfirmedTermination(contracts.map((c) => c.id)),
    ]);
    const countable = new Set(
      effective.filter((c) => CHECKIN_CONTRACT_STATUSES.has(c.effectiveStatus) && !ending.has(c.id)).map((c) => c.id),
    );

    return {
      ptUserId,
      gymId,
      ptActive: true,
      ptBlockedReason: null,
      sessions: rows
        .filter((r) => countable.has(r.contractId))
        .map((r) => ({
          sessionId: r.id,
          contractId: r.contractId,
          status: r.status,
          scheduledStartAt: r.scheduledStartAt,
          scheduledEndAt: r.scheduledEndAt,
        })),
    };
  },
};

// ── query validation (HTTP layer helper, pure) ────────────────────────────────────────────────────────────────────

/**
 * An ISO-8601 instant WITH an explicit zone (`Z` or `+hh:mm`). A bare local date-time ("2026-10-18T00:00:00") would be read in the
 * process's own time zone by `new Date()` - the window would silently shift with the server's TZ - so it is refused, not guessed.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

export type ParsedQuery = { ok: true; gymId: string; from: Date; to: Date } | { ok: false; error: string };

export function parsePtGymSessionsQuery(query: Record<string, unknown>): ParsedQuery {
  const { gymId, from, to } = query;
  if (typeof gymId !== "string" || !gymId.trim() || gymId.length > 128) return { ok: false, error: "gymId là bắt buộc" };
  const parse = (v: unknown, name: string): Date | string => {
    if (typeof v !== "string" || !ISO_INSTANT.test(v)) return `${name} phải là thời điểm ISO-8601 có múi giờ (ví dụ 2026-10-18T00:00:00.000Z)`;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? `${name} không hợp lệ` : d;
  };
  const f = parse(from, "from");
  if (typeof f === "string") return { ok: false, error: f };
  const t = parse(to, "to");
  if (typeof t === "string") return { ok: false, error: t };
  if (f.getTime() >= t.getTime()) return { ok: false, error: "from phải nhỏ hơn to" };
  if (t.getTime() - f.getTime() > PT_GYM_SESSIONS_MAX_WINDOW_MS) return { ok: false, error: "Khoảng thời gian tối đa là 48 giờ" };
  return { ok: true, gymId: gymId.trim(), from: f, to: t };
}
