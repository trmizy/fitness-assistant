import axios from "axios";

/**
 * Dispute Case slice 2 / S2.3 - READ-ONLY clients for the evidence sources that live in other services (chat-service call sessions, gym-service PT /
 * member check-ins). Internal routes only, shared service secrets, 3 s timeout, NO retry, no write. The answers are validated here: a malformed answer is
 * an error (the collector turns every error into UNAVAILABLE) - it is never read as "0 rows" or "false".
 *
 * The URLs and secrets are read when a call is made (not at import), like the other internal callers.
 */
const TIMEOUT_MS = 3000;
const chatUrl = () => process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
const gymUrl = () => process.env.GYM_SERVICE_URL || "http://localhost:3006";
const chatHeaders = () => ({ "x-internal-secret": process.env.INTERNAL_API_SECRET || "" });
const gymHeaders = () => ({ "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production" });

export interface CallSessionEvidence {
  id: string;
  status: string;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  callerId: string;
  calleeId: string;
  origin: string;
}
export interface PtCheckinEvidence {
  firstScanAt: string;
  lastScanAt: string;
  scanCount: number;
  qualifyingSessionIds: string[];
}
export interface MemberCheckinEvidence {
  createdAt: string;
  /** QR = the member scanned themselves; ASSISTED = a staff member checked them in. */
  source: string;
  gymId: string;
  /** who performed the scan: the member (QR) or the staff member (ASSISTED) */
  checkedInBy: string;
  /** ASSISTED only: how the staff member verified the identity (MEMBER_OTP / PHOTO_MATCH / MANAGER_EXCEPTION), their role and when. null for QR. */
  assisted: { method: string | null; staffRole: string | null; eventAt: string } | null;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const bad = (what: string) => Object.assign(new Error(`EVIDENCE_SOURCE_BAD_ANSWER: ${what}`), { code: "EVIDENCE_SOURCE_BAD_ANSWER" });

export function parseCallSessions(body: unknown): CallSessionEvidence[] {
  const data = (body as any)?.data;
  if (!Array.isArray(data)) throw bad("call-sessions data is not a list");
  return data.map((r: any) => {
    if (!r || !isStr(r.id) || !isStr(r.status) || !isStr(r.callerId) || !isStr(r.calleeId) || !isStr(r.origin) || !isStrOrNull(r.startedAt) || !isStrOrNull(r.answeredAt) || !isStrOrNull(r.endedAt) || !isStrOrNull(r.endReason)) {
      throw bad("call-sessions row");
    }
    return { id: r.id, status: r.status, startedAt: r.startedAt, answeredAt: r.answeredAt, endedAt: r.endedAt, endReason: r.endReason, callerId: r.callerId, calleeId: r.calleeId, origin: r.origin };
  });
}
export function parsePtCheckin(body: unknown): PtCheckinEvidence | null {
  if (!body || typeof body !== "object" || !("data" in (body as object))) throw bad("pt-checkins has no data field");
  const d = (body as any).data;
  if (d === null) return null;
  if (!d || !isStr(d.firstScanAt) || !isStr(d.lastScanAt) || !Number.isInteger(d.scanCount) || !Array.isArray(d.qualifyingSessionIds) || !d.qualifyingSessionIds.every(isStr)) throw bad("pt-checkins record");
  return { firstScanAt: d.firstScanAt, lastScanAt: d.lastScanAt, scanCount: d.scanCount, qualifyingSessionIds: d.qualifyingSessionIds };
}
export function parseMemberCheckins(body: unknown): MemberCheckinEvidence[] {
  const data = (body as any)?.data;
  if (!Array.isArray(data)) throw bad("member-checkins data is not a list");
  return data.map((r: any) => {
    if (!r || !isStr(r.createdAt) || !isStr(r.source) || !isStr(r.gymId) || !isStr(r.checkedInBy)) throw bad("member-checkins row");
    const a = r.assisted;
    if (a !== null && (typeof a !== "object" || !isStr(a.eventAt) || !isStrOrNull(a.method) || !isStrOrNull(a.staffRole))) throw bad("member-checkins assisted block");
    return { createdAt: r.createdAt, source: r.source, gymId: r.gymId, checkedInBy: r.checkedInBy, assisted: a === null ? null : { method: a.method, staffRole: a.staffRole, eventAt: a.eventAt } };
  });
}

export const disputeEvidenceClient = {
  async getCallSessions(coachingSessionId: string): Promise<CallSessionEvidence[]> {
    const { data } = await axios.get(`${chatUrl()}/internal/call-sessions`, { params: { coachingSessionId }, headers: chatHeaders(), timeout: TIMEOUT_MS });
    return parseCallSessions(data);
  },
  async getPtCheckin(q: { ptUserId: string; gymId: string; date: string }): Promise<PtCheckinEvidence | null> {
    const { data } = await axios.get(`${gymUrl()}/internal/pt-checkins`, { params: q, headers: gymHeaders(), timeout: TIMEOUT_MS });
    return parsePtCheckin(data);
  },
  async getMemberCheckins(q: { membershipId: string; from: string; to: string }): Promise<MemberCheckinEvidence[]> {
    const { data } = await axios.get(`${gymUrl()}/internal/member-checkins`, { params: q, headers: gymHeaders(), timeout: TIMEOUT_MS });
    return parseMemberCheckins(data);
  },
};
