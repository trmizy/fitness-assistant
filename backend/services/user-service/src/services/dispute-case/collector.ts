import { Prisma } from "../../generated/prisma";
import { contentHashOf } from "./canonical";
import { defaultExternalSources, externalEvidenceDrafts, legacyUnavailableDrafts, type ExternalSources } from "./external-evidence";

/**
 * DISPUTE CASE slice 1 - READ-ONLY evidence collection from the user-service database (§1.7, intake). Nothing here writes, nothing calls
 * another service. The cross-service sources (chat call_sessions, gym PT check-ins, gym check-ins) are recorded as UNAVAILABLE rows saying
 * the source is not integrated: they are never read, and never guessed.
 *
 * Personal data kept OUT of the payloads: audit_logs.ip_address / user_agent and pt_terms_acceptances.ip_address / user_agent (12-month
 * retention, admin tooling only).
 */
export type Db = Prisma.TransactionClient;

export interface EvidenceDraft {
  provenanceType: "SERVER_OBSERVED" | "TECH_GAP" | "NOT_APPLICABLE" | "USER_REPORTED_STORED" | "DERIVED" | "SELF_REPORTED_SERVER_RECORDED" | "STAFF_ATTESTED_SERVER_RECORDED";
  /** where it was read from, e.g. "user-service.sessions" */
  source: string;
  /** the slot inside that source; (source, subject) is what recollect matches on */
  subject: string;
  eventAt: Date | null;
  captureStatus: "OK" | "UNAVAILABLE" | "NOT_APPLICABLE";
  sensitivity: "NORMAL" | "SENSITIVE" | "RESTRICTED";
  /** system-collected rows are NOT_APPLICABLE; a Client/PT submission is CLIENT_CLAIMED_UNVERIFIED (set by submitEvidence) */
  verificationStatus?: "CLIENT_CLAIMED_UNVERIFIED" | "SERVER_VERIFIED" | "NOT_APPLICABLE";
  payload: Record<string, unknown>;
}

export interface StatementDraft {
  partyRole: "CLIENT" | "PT";
  authorUserId: string;
  text: string;
}

export interface CollectedSession {
  session: {
    id: string;
    contractId: string;
    clientUserId: string;
    ptUserId: string;
    status: string;
    disputeType: string | null;
  };
  evidence: EvidenceDraft[];
  statements: StatementDraft[];
}

const NULL_NOT_ABSENCE = "NULL không phải bằng chứng vắng mặt";

/**
 * F5 (backend completion): the calls to OTHER services (chat, gym) made WITHOUT a transaction, so that no case row lock is held while the network is
 * waited on. The result is handed to {@link collectSources} as `prefetched`. Returns null when the session does not exist. Every failure is an
 * UNAVAILABLE draft (externalEvidenceDrafts never throws); with no external sources configured it is the Slice 1 placeholders.
 */
export async function collectExternal(db: Db, sessionId: string, external: ExternalSources | null | undefined = defaultExternalSources()): Promise<EvidenceDraft[] | null> {
  const session = await db.session.findUnique({ where: { id: sessionId }, include: { contract: true } });
  if (!session) return null;
  return externalDraftsFor(session, external);
}

function externalDraftsFor(session: any, external: ExternalSources | null | undefined): Promise<EvidenceDraft[]> | EvidenceDraft[] {
  return external
    ? externalEvidenceDrafts(
        {
          id: session.id,
          sessionMode: session.sessionMode,
          ptUserId: session.ptUserId,
          scheduledStartAt: session.scheduledStartAt,
          scheduledEndAt: session.scheduledEndAt,
          contractGymId: session.contract.gymId ?? null,
          contractGymMembershipId: session.contract.gymMembershipId ?? null,
        },
        external,
      )
    : legacyUnavailableDrafts();
}

/**
 * Reads every source for one session. Returns null when the session does not exist. `prefetched` = the cross-service drafts already read by
 * {@link collectExternal} (no network call is made here then; use it inside a transaction).
 */
export async function collectSources(
  db: Db,
  sessionId: string,
  external: ExternalSources | null | undefined = defaultExternalSources(),
  prefetched?: EvidenceDraft[] | null,
): Promise<CollectedSession | null> {
  const session = await db.session.findUnique({ where: { id: sessionId }, include: { contract: true } });
  if (!session) return null;
  const contract = session.contract;
  const src = (table: string) => `user-service.${table}`;
  const evidence: EvidenceDraft[] = [];

  evidence.push({
    provenanceType: "SERVER_OBSERVED",
    source: src("sessions"),
    subject: "SESSION_ROW",
    eventAt: session.disputedAt,
    captureStatus: "OK",
    sensitivity: "NORMAL",
    payload: {
      id: session.id,
      contractId: session.contractId,
      status: session.status,
      sessionMode: session.sessionMode,
      scheduledStartAt: session.scheduledStartAt,
      scheduledEndAt: session.scheduledEndAt,
      disputeType: session.disputeType,
      disputedAt: session.disputedAt,
      completedAt: session.completedAt,
      sessionDeducted: session.sessionDeducted,
      ptAtFault: session.ptAtFault,
      clientConfirmDeadline: session.clientConfirmDeadline,
      autoConfirmed: session.autoConfirmed,
      cancelledBy: session.cancelledBy,
      resolvedBy: session.resolvedBy,
      resolvedAt: session.resolvedAt,
    },
  });

  // Room join timestamps: NULL means "not recorded", NEVER "absent" (§1.4.2). An OFFLINE session has no room at all.
  const offline = session.sessionMode === "OFFLINE";
  for (const [subject, value] of [
    ["ROOM_PT_JOINED_AT", session.roomPtJoinedAt],
    ["ROOM_CLIENT_JOINED_AT", session.roomClientJoinedAt],
  ] as const) {
    if (offline) {
      evidence.push({
        provenanceType: "NOT_APPLICABLE",
        source: src("sessions"),
        subject,
        eventAt: null,
        captureStatus: "NOT_APPLICABLE",
        sensitivity: "NORMAL",
        payload: { value: null, note: "Buổi tập trực tiếp (OFFLINE) không có phòng trực tuyến" },
      });
    } else {
      evidence.push({
        provenanceType: "SERVER_OBSERVED",
        source: src("sessions"),
        subject,
        eventAt: value,
        captureStatus: "OK",
        sensitivity: "NORMAL",
        payload: value ? { value } : { value: null, note: NULL_NOT_ABSENCE },
      });
    }
  }

  evidence.push({
    provenanceType: "SERVER_OBSERVED",
    source: src("contracts"),
    subject: "CONTRACT_SNAPSHOT",
    eventAt: null,
    captureStatus: "OK",
    sensitivity: "NORMAL",
    payload: {
      id: contract.id,
      status: contract.status,
      packageType: contract.packageType,
      packageName: contract.packageName,
      sessionMode: contract.sessionMode,
      price: contract.price,
      totalSessions: contract.totalSessions,
      usedSessions: contract.usedSessions,
      compensatedSessions: contract.compensatedSessions,
      extraSessions: contract.extraSessions,
      sessionDurationMinutes: contract.sessionDurationMinutes,
      startDate: contract.startDate,
      endDate: contract.endDate,
      terminationReason: contract.terminationReason,
      terminatedAt: contract.terminatedAt,
    },
  });
  // The revenue split and holdback are the financial part of the snapshot: for the investigator, never for a party.
  evidence.push({
    provenanceType: "SERVER_OBSERVED",
    source: src("contracts"),
    subject: "CONTRACT_FINANCIAL_SNAPSHOT",
    eventAt: null,
    captureStatus: "OK",
    sensitivity: "SENSITIVE",
    payload: {
      id: contract.id,
      pricePerSession: contract.pricePerSession,
      platformRate: contract.platformRate,
      ptRate: contract.ptRate,
      gymRate: contract.gymRate,
      ptHoldbackRate: contract.ptHoldbackRate,
      ptHoldbackPolicyVersion: contract.ptHoldbackPolicyVersion,
      holdbackReleasedAt: contract.holdbackReleasedAt,
      releasedToPt: contract.releasedToPt,
      releasedToGym: contract.releasedToGym,
      releasedToPlatform: contract.releasedToPlatform,
    },
  });

  const acceptances = await db.ptTermsAcceptance.findMany({ where: { userId: session.ptUserId }, orderBy: [{ version: "asc" }] });
  evidence.push({
    provenanceType: "SERVER_OBSERVED",
    source: src("pt_terms_acceptances"),
    subject: "PT_TERMS_ACCEPTANCES",
    eventAt: null,
    captureStatus: "OK",
    sensitivity: "NORMAL",
    payload: { ptUserId: session.ptUserId, rows: acceptances.map((a) => ({ id: a.id, version: a.version, source: a.source, acceptedAt: a.acceptedAt })) },
  });

  const reschedules = await db.sessionRescheduleRequest.findMany({ where: { sessionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  evidence.push({
    provenanceType: "SERVER_OBSERVED",
    source: src("session_reschedule_requests"),
    subject: "RESCHEDULE_REQUESTS",
    eventAt: null,
    captureStatus: "OK",
    sensitivity: "NORMAL",
    payload: {
      rows: reschedules.map((r) => ({
        id: r.id,
        requestedBy: r.requestedBy,
        originalStartAt: r.originalStartAt,
        originalEndAt: r.originalEndAt,
        proposedStartAt: r.proposedStartAt,
        proposedEndAt: r.proposedEndAt,
        reason: r.reason,
        status: r.status,
        respondedAt: r.respondedAt,
        createdAt: r.createdAt,
      })),
    },
  });

  for (const [entityType, entityId] of [
    ["SESSION", session.id],
    ["CONTRACT", session.contractId],
  ] as const) {
    const rows = await db.auditLog.findMany({ where: { entityType, entityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500 });
    evidence.push({
      provenanceType: "SERVER_OBSERVED",
      source: src("audit_logs"),
      subject: `AUDIT_LOG:${entityType}`,
      eventAt: null,
      captureStatus: "OK",
      sensitivity: "SENSITIVE",
      payload: {
        entityType,
        entityId,
        // ip_address / user_agent are deliberately NOT copied (personal data on a retention clock)
        rows: rows.map((a) => ({ id: a.id, actorUserId: a.actorUserId, action: a.action, metadata: a.metadata, createdAt: a.createdAt })),
      },
    });
  }

  // Only the stable fields: attempts / next_attempt_at / last_error change on every retry and would make every recollect "a change".
  const settlements = await db.sessionSettlement.findMany({ where: { sessionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  evidence.push({
    provenanceType: "SERVER_OBSERVED",
    source: src("session_settlements"),
    subject: "SETTLEMENTS",
    eventAt: null,
    captureStatus: "OK",
    sensitivity: "SENSITIVE",
    payload: {
      rows: settlements.map((s) => ({
        id: s.id,
        kind: s.kind,
        idempotencyKey: s.idempotencyKey,
        reason: s.reason,
        status: s.status,
        createdAt: s.createdAt,
        settledAt: s.settledAt,
      })),
    },
  });

  // Slice 2 / S2.3: the sources that live in other services. Read-only, one bounded call each, every failure is UNAVAILABLE (never 0 / false);
  // with no external sources configured (null) the Slice 1 placeholders stay.
  evidence.push(...(prefetched ?? (await externalDraftsFor(session, external))));

  // The two free-text legacy fields become statement v1 (their author is known from the session, their wording is the party's own).
  const statements: StatementDraft[] = [];
  if (session.disputeReason && session.disputeReason.trim()) {
    statements.push({ partyRole: "CLIENT", authorUserId: session.clientUserId, text: session.disputeReason.trim() });
  }
  if (session.ptNotes && session.ptNotes.trim()) {
    statements.push({ partyRole: "PT", authorUserId: session.ptUserId, text: session.ptNotes.trim() });
  }

  return {
    session: {
      id: session.id,
      contractId: session.contractId,
      clientUserId: session.clientUserId,
      ptUserId: session.ptUserId,
      status: session.status,
      disputeType: session.disputeType,
    },
    evidence,
    statements,
  };
}

/** The stored form of a draft (what the hash is taken over): the payload after a JSON round trip, exactly as jsonb returns it. */
export function draftHash(d: EvidenceDraft): string {
  return contentHashOf(d.payload);
}
