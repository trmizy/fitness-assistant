import { disputeEvidenceClient, type CallSessionEvidence, type MemberCheckinEvidence, type PtCheckinEvidence } from "../../clients/dispute-evidence.client";
import type { EvidenceDraft } from "./collector";
import { SOURCE_NOT_INTEGRATED } from "./rules";

/**
 * DISPUTE CASE slice 2 / S2.3 - the evidence that lives in OTHER services, as collector drafts (design 1.4.2). Read-only; every failure is UNAVAILABLE.
 *
 *   chat-service.call_sessions        SERVER_OBSERVED (E1)         what the server saw of a connection. Proves a connection existed; not that anyone
 *                                                                  taught; an empty list proves nothing about absence.
 *   gym-service.gym_pt_check_ins      SELF_REPORTED_SERVER_RECORDED (E2)  the PT scanned the gym QR themselves; the server only recorded it. Proves the PT
 *                                                                  scanned at that gym that day (first / last scan); NOT that they taught this session.
 *   gym-service.gym_pt_check_ins      DERIVED (E3)                 qualifyingSessionIds is a link computed from the scan. NOT an independent source of the
 *     (qualifying link)                                            scan it was derived from.
 *   gym-service.gym_check_ins         TWO slots, never SERVER_OBSERVED (the server did not witness the person):
 *                                       SELF_REPORTED_SERVER_RECORDED   the member scanned the QR themselves (actor = the member, identity method QR)
 *                                       STAFF_ATTESTED_SERVER_RECORDED  a staff member checked the member in (actor = the staff member, identity method MEMBER_OTP /
 *                                                                       PHOTO_MATCH / MANAGER_EXCEPTION from gym_assisted_checkin_events)
 *                                    Every payload says: a gym check-in does not prove that the PT teaching session took place.
 *
 * A source is asked ONLY with its full key: chat needs the session id (ONLINE sessions); the PT check-in needs the gym id of the CONTRACT and the
 * session's local day; the member check-ins need the membership id of the CONTRACT. A key that is not on the contract is not guessed: the slot is
 * NOT_APPLICABLE and says what is missing. The payload of an UNAVAILABLE slot is a fixed sentence (no error text) so that "still unavailable" does not look
 * like a change of evidence on the next read.
 */
export interface ExternalSources {
  callSessions: (coachingSessionId: string) => Promise<CallSessionEvidence[]>;
  ptCheckin: (q: { ptUserId: string; gymId: string; date: string }) => Promise<PtCheckinEvidence | null>;
  memberCheckins: (q: { membershipId: string; from: string; to: string }) => Promise<MemberCheckinEvidence[]>;
}

export const httpExternalSources: ExternalSources = {
  callSessions: (id) => disputeEvidenceClient.getCallSessions(id),
  ptCheckin: (q) => disputeEvidenceClient.getPtCheckin(q),
  memberCheckins: (q) => disputeEvidenceClient.getMemberCheckins(q),
};

/** The real clients, unless DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED=true (test processes that must not open sockets). null => the Slice 1 placeholders. */
export function defaultExternalSources(env: NodeJS.ProcessEnv = process.env): ExternalSources | null {
  return env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED === "true" ? null : httpExternalSources;
}

export const SRC_CALLS = "chat-service.call_sessions";
export const SRC_PT = "gym-service.gym_pt_check_ins";
export const SRC_MEMBER = "gym-service.gym_check_ins";

export interface SessionKeys {
  id: string;
  sessionMode: string | null;
  ptUserId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  contractGymId: string | null;
  contractGymMembershipId: string | null;
}

/** 'YYYY-MM-DD' of an instant in Asia/Ho_Chi_Minh - the same rule gym-service uses for the local day of a PT scan. */
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });
export function localDateVN(instant: Date): string {
  const p = dayFmt.formatToParts(instant);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

const HOUR = 3600_000;
export const MEMBER_WINDOW_PAD_MS = HOUR;

const unavailable = (source: string, subject: string): EvidenceDraft => ({
  provenanceType: "TECH_GAP",
  source,
  subject,
  eventAt: null,
  captureStatus: "UNAVAILABLE",
  sensitivity: "NORMAL",
  payload: { note: "UNAVAILABLE — không đọc được nguồn này lúc thu thập; đây không phải bằng chứng vắng mặt và không phải 'không có bản ghi'" },
});
const notApplicable = (source: string, subject: string, why: string): EvidenceDraft => ({
  provenanceType: "NOT_APPLICABLE",
  source,
  subject,
  eventAt: null,
  captureStatus: "NOT_APPLICABLE",
  sensitivity: "NORMAL",
  payload: { note: why },
});

export function legacyUnavailableDrafts(): EvidenceDraft[] {
  return [
    [SRC_CALLS, "CALL_SESSIONS"],
    [SRC_PT, "GYM_PT_CHECK_INS"],
    [SRC_MEMBER, "GYM_CHECK_INS"],
  ].map(([source, subject]) => ({
    provenanceType: "TECH_GAP" as const,
    source,
    subject,
    eventAt: null,
    captureStatus: "UNAVAILABLE" as const,
    sensitivity: "NORMAL" as const,
    payload: { note: SOURCE_NOT_INTEGRATED },
  }));
}

export async function externalEvidenceDrafts(s: SessionKeys, ext: ExternalSources): Promise<EvidenceDraft[]> {
  const online = s.sessionMode === "ONLINE";
  const out: EvidenceDraft[] = [];

  // ── chat-service call sessions (ONLINE sessions only) ──
  const calls = (async (): Promise<EvidenceDraft> => {
    if (!online) return notApplicable(SRC_CALLS, "CALL_SESSIONS", "Buổi tập trực tiếp (OFFLINE) không có phòng gọi trực tuyến");
    try {
      const rows = await ext.callSessions(s.id);
      return {
        provenanceType: "SERVER_OBSERVED",
        source: SRC_CALLS,
        subject: "CALL_SESSIONS",
        eventAt: null,
        captureStatus: "OK",
        sensitivity: "NORMAL",
        payload: { rows, notProven: "Không chứng minh nội dung hay chất lượng buổi.", note: "Bản ghi kết nối do máy chủ chứng kiến (SERVER_OBSERVED): chứng minh có một kết nối. Không chứng minh nội dung hay chất lượng buổi, không chứng minh buổi đã diễn ra; không có bản ghi không chứng minh PT vắng mặt. Không có nội dung tin nhắn." },
      };
    } catch {
      return unavailable(SRC_CALLS, "CALL_SESSIONS");
    }
  })();

  // ── gym-service PT check-in (+ the derived qualifying link) ──
  const pt = (async (): Promise<EvidenceDraft[]> => {
    const na = (why: string) => [notApplicable(SRC_PT, "GYM_PT_CHECK_INS", why), notApplicable(SRC_PT, "GYM_PT_CHECK_INS_QUALIFYING_LINK", why)];
    if (online) return na("Buổi tập trực tuyến (ONLINE): không áp dụng quét QR tại phòng tập");
    if (!s.contractGymId) return na("Hợp đồng không gắn phòng tập (thiếu gymId): không suy đoán phòng tập, không gọi nguồn");
    const date = localDateVN(s.scheduledStartAt);
    try {
      const rec = await ext.ptCheckin({ ptUserId: s.ptUserId, gymId: s.contractGymId, date });
      const scan: EvidenceDraft = {
        provenanceType: "SELF_REPORTED_SERVER_RECORDED",
        source: SRC_PT,
        subject: "GYM_PT_CHECK_INS",
        eventAt: rec ? new Date(rec.firstScanAt) : null,
        captureStatus: "OK",
        sensitivity: "NORMAL",
        payload: {
          gymId: s.contractGymId,
          localDate: date,
          found: rec !== null,
          record: rec ? { firstScanAt: rec.firstScanAt, lastScanAt: rec.lastScanAt, scanCount: rec.scanCount } : null,
          actor: { userId: s.ptUserId, kind: "PT_SELF" },
          identityVerification: { method: "QR" },
          notProven: "Check-in gym không chứng minh buổi dạy PT đã diễn ra.",
          note: "PT tự quét QR theo ngày, máy chủ chỉ ghi lại (E2): ghi nhận PT đã quét tại phòng tập đó trong ngày. Check-in gym không chứng minh buổi dạy PT đã diễn ra, không chứng minh đúng khung giờ. Không có bản ghi không chứng minh PT vắng mặt.",
        },
      };
      const link: EvidenceDraft = rec
        ? {
            provenanceType: "DERIVED",
            source: SRC_PT,
            subject: "GYM_PT_CHECK_INS_QUALIFYING_LINK",
            eventAt: null,
            captureStatus: "OK",
            sensitivity: "NORMAL",
            payload: { qualifyingSessionIds: rec.qualifyingSessionIds, includesThisSession: rec.qualifyingSessionIds.includes(s.id), note: "Liên kết dẫn xuất từ lần quét (E3): không phải nguồn độc lập với lần quét mà nó được suy ra." },
          }
        : notApplicable(SRC_PT, "GYM_PT_CHECK_INS_QUALIFYING_LINK", "Không có bản ghi quét trong ngày nên không có liên kết dẫn xuất");
      return [scan, link];
    } catch {
      return [unavailable(SRC_PT, "GYM_PT_CHECK_INS"), unavailable(SRC_PT, "GYM_PT_CHECK_INS_QUALIFYING_LINK")];
    }
  })();

  // ── gym-service member check-ins (the client's membership): TWO slots by who vouches for the person being there ──
  const SELF = "GYM_CHECK_INS_SELF_REPORTED";
  const STAFF = "GYM_CHECK_INS_STAFF_ATTESTED";
  const member = (async (): Promise<EvidenceDraft[]> => {
    const both = (f: (subject: string) => EvidenceDraft) => [f(SELF), f(STAFF)];
    if (online) return both((sub) => notApplicable(SRC_MEMBER, sub, "Buổi tập trực tuyến (ONLINE): không áp dụng check-in tại phòng tập"));
    if (!s.contractGymMembershipId) return both((sub) => notApplicable(SRC_MEMBER, sub, "Hợp đồng không ghi thẻ hội viên (thiếu membershipId): không suy đoán thẻ, không gọi nguồn"));
    const from = new Date(s.scheduledStartAt.getTime() - MEMBER_WINDOW_PAD_MS);
    const to = new Date(s.scheduledEndAt.getTime() + MEMBER_WINDOW_PAD_MS);
    try {
      const rows = await ext.memberCheckins({ membershipId: s.contractGymMembershipId, from: from.toISOString(), to: to.toISOString() });
      const NOT_PROVEN = "Check-in gym không chứng minh buổi dạy PT đã diễn ra.";
      const shape = (r: MemberCheckinEvidence) => ({
        at: r.createdAt,
        source: r.source,
        gymId: r.gymId,
        actor: { userId: r.checkedInBy, kind: r.source === "ASSISTED" ? "GYM_STAFF" : "MEMBER_SELF" },
        identityVerification: r.assisted ? { method: r.assisted.method, staffRole: r.assisted.staffRole, verifiedAt: r.assisted.eventAt } : { method: "QR" },
      });
      const win = { from: from.toISOString(), to: to.toISOString() };
      return [
        {
          provenanceType: "SELF_REPORTED_SERVER_RECORDED",
          source: SRC_MEMBER,
          subject: SELF,
          eventAt: null,
          captureStatus: "OK",
          sensitivity: "NORMAL",
          payload: { membershipId: s.contractGymMembershipId, window: win, rows: rows.filter((r) => r.source !== "ASSISTED").map(shape), notProven: NOT_PROVEN, note: "Hội viên tự quét QR, máy chủ chỉ ghi lại. " + NOT_PROVEN },
        },
        {
          provenanceType: "STAFF_ATTESTED_SERVER_RECORDED",
          source: SRC_MEMBER,
          subject: STAFF,
          eventAt: null,
          captureStatus: "OK",
          sensitivity: "NORMAL",
          payload: { membershipId: s.contractGymMembershipId, window: win, rows: rows.filter((r) => r.source === "ASSISTED").map(shape), notProven: NOT_PROVEN, note: "Nhân viên phòng tập check-in hộ và tự xác nhận danh tính (phương thức ghi từng dòng). " + NOT_PROVEN },
        },
      ];
    } catch {
      return both((sub) => unavailable(SRC_MEMBER, sub));
    }
  })();

  const [c, p, m] = await Promise.all([calls, pt, member]);
  out.push(c, ...p, ...m);
  return out;
}
