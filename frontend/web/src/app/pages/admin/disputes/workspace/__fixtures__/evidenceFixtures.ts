/**
 * TEST FIXTURE - evidence rows shaped like what `collector.ts`, `external-evidence.ts` and `submitEvidence(File)` write (commit fd199953).
 * Not answers from a running server. Used by the D2 unit tests and by the mock-browser scripts.
 */
import type { DisputeCaseDetail, DisputeEvidence } from "../../disputeCaseTypes";
import { IDS, detailFixture, financialItem, financialViewFixture } from "../../__fixtures__/disputeCaseFixtures";

let n = 0;
const uid = () => `e0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

export const STORAGE_KEY_SECRET = "cases/11111111/secret-storage-key-abc123.bin";

export function evidenceRow(subject: string, over: Partial<DisputeEvidence> & { payload?: unknown } = {}): DisputeEvidence {
  return {
    id: uid(),
    caseId: IDS.case,
    provenanceType: "SERVER_OBSERVED",
    source: "user-service.sessions",
    subject,
    scopeSessionId: IDS.session,
    scopeContractId: IDS.contract,
    eventAt: null,
    capturedAt: "2026-11-01T03:00:01.000Z",
    submittedBy: null,
    submittedRole: null,
    captureStatus: "OK",
    snapshotVersion: 1,
    contentHash: "a".repeat(64),
    payload: {},
    sensitivity: "NORMAL",
    verificationStatus: "NOT_APPLICABLE",
    supersedesId: null,
    createdAt: "2026-11-01T03:00:01.000Z",
    partySubmitted: false,
    provenanceLabel: "Máy chủ chứng kiến / đọc trực tiếp từ hệ thống",
    ...over,
  } as DisputeEvidence;
}

const NOT_PROVEN = "Check-in gym không chứng minh buổi dạy PT đã diễn ra.";
const UNAVAILABLE_NOTE = "UNAVAILABLE — không đọc được nguồn này lúc thu thập; đây không phải bằng chứng vắng mặt và không phải 'không có bản ghi'";

/** One row per known kind of evidence. */
export function allEvidenceKinds(): DisputeEvidence[] {
  return [
    evidenceRow("SESSION_ROW", {
      eventAt: "2026-11-01T02:00:00.000Z",
      payload: {
        id: IDS.session, contractId: IDS.contract, status: "DISPUTED", sessionMode: "OFFLINE", scheduledStartAt: "2026-10-30T01:00:00.000Z", scheduledEndAt: "2026-10-30T02:00:00.000Z",
        disputeType: "PT_NO_SHOW_CLAIM", disputedAt: "2026-11-01T02:00:00.000Z", completedAt: null, sessionDeducted: false, ptAtFault: null, clientConfirmDeadline: null, autoConfirmed: false, cancelledBy: null, resolvedBy: null, resolvedAt: null,
      },
    }),
    evidenceRow("ROOM_PT_JOINED_AT", { captureStatus: "NOT_APPLICABLE", provenanceType: "NOT_APPLICABLE", provenanceLabel: "Không áp dụng", payload: { value: null, note: "Buổi tập trực tiếp (OFFLINE) không có phòng trực tuyến" } }),
    evidenceRow("ROOM_CLIENT_JOINED_AT", { payload: { value: null, note: "NULL không phải bằng chứng vắng mặt" } }),
    evidenceRow("CONTRACT_SNAPSHOT", {
      source: "user-service.contracts",
      payload: { id: IDS.contract, status: "ACTIVE", packageType: "PACKAGE", packageName: "Gói 12 buổi", sessionMode: "OFFLINE", price: "3000000", totalSessions: 12, usedSessions: 3, compensatedSessions: 0, extraSessions: 0, sessionDurationMinutes: 60, startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-12-31T00:00:00.000Z", terminationReason: null, terminatedAt: null },
    }),
    evidenceRow("CONTRACT_FINANCIAL_SNAPSHOT", {
      source: "user-service.contracts", sensitivity: "SENSITIVE",
      payload: { id: IDS.contract, pricePerSession: "250000", platformRate: "0.2", ptRate: "0.8", gymRate: "0", ptHoldbackRate: "0.1", ptHoldbackPolicyVersion: 1, holdbackReleasedAt: null, releasedToPt: "0", releasedToGym: "0", releasedToPlatform: "0" },
    }),
    evidenceRow("PT_TERMS_ACCEPTANCES", { source: "user-service.pt_terms_acceptances", payload: { ptUserId: "pt-1", rows: [{ id: "r1", version: 2, source: "WEB", acceptedAt: "2026-09-01T00:00:00.000Z" }] } }),
    evidenceRow("RESCHEDULE_REQUESTS", {
      source: "user-service.session_reschedule_requests",
      payload: { rows: [{ id: "q1", requestedBy: "CLIENT", originalStartAt: "2026-10-30T01:00:00.000Z", originalEndAt: "2026-10-30T02:00:00.000Z", proposedStartAt: "2026-10-31T01:00:00.000Z", proposedEndAt: "2026-10-31T02:00:00.000Z", reason: "Bận việc đột xuất", status: "REJECTED", respondedAt: "2026-10-29T03:00:00.000Z", createdAt: "2026-10-29T01:00:00.000Z" }] },
    }),
    evidenceRow("AUDIT_LOG:SESSION", { source: "user-service.audit_logs", sensitivity: "SENSITIVE", payload: { entityType: "SESSION", entityId: IDS.session, rows: [{ id: "a1", actorUserId: "client-1", action: "SESSION_DISPUTED", metadata: { reason: "x" }, createdAt: "2026-11-01T02:00:00.000Z" }] } }),
    evidenceRow("SETTLEMENTS", {
      source: "user-service.session_settlements", sensitivity: "SENSITIVE",
      payload: { rows: [{ id: "s1", kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: "PT_NO_SHOW:abc", reason: "NOT_DELIVERED", status: "SETTLED", createdAt: "2026-11-01T05:00:00.000Z", settledAt: "2026-11-01T05:00:05.000Z" }] },
    }),
    evidenceRow("CALL_SESSIONS", {
      source: "chat-service.call_sessions",
      payload: { rows: [{ id: "c1", status: "ENDED", startedAt: "2026-10-30T01:01:00.000Z", answeredAt: "2026-10-30T01:01:10.000Z", endedAt: "2026-10-30T01:30:00.000Z", endReason: "HANGUP", callerId: "client-1", calleeId: "pt-1", origin: "WEB" }], notProven: "Không chứng minh nội dung hay chất lượng buổi.", note: "Bản ghi kết nối do máy chủ chứng kiến (SERVER_OBSERVED)..." },
    }),
    evidenceRow("GYM_PT_CHECK_INS", {
      source: "gym-service.gym_pt_check_ins", provenanceType: "SELF_REPORTED_SERVER_RECORDED", eventAt: "2026-10-30T00:50:00.000Z", provenanceLabel: "Người dùng tự quét/khai, máy chủ chỉ ghi lại — check-in gym không chứng minh buổi dạy PT đã diễn ra",
      payload: { gymId: "gym-1", localDate: "2026-10-30", found: true, record: { firstScanAt: "2026-10-30T00:50:00.000Z", lastScanAt: "2026-10-30T02:10:00.000Z", scanCount: 2 }, actor: { userId: "pt-1", kind: "PT_SELF" }, identityVerification: { method: "QR" }, notProven: NOT_PROVEN, note: "PT tự quét QR theo ngày (E2)" },
    }),
    evidenceRow("GYM_PT_CHECK_INS_QUALIFYING_LINK", {
      source: "gym-service.gym_pt_check_ins", provenanceType: "DERIVED", provenanceLabel: "Dữ liệu dẫn xuất (không phải nguồn độc lập)",
      payload: { qualifyingSessionIds: [IDS.session, "sess-0002"], includesThisSession: true, note: "Liên kết dẫn xuất từ lần quét (E3)" },
    }),
    evidenceRow("GYM_CHECK_INS_SELF_REPORTED", {
      source: "gym-service.gym_check_ins", provenanceType: "SELF_REPORTED_SERVER_RECORDED", provenanceLabel: "Người dùng tự quét/khai, máy chủ chỉ ghi lại — check-in gym không chứng minh buổi dạy PT đã diễn ra",
      payload: { membershipId: "m1", window: { from: "2026-10-30T00:00:00.000Z", to: "2026-10-30T03:00:00.000Z" }, rows: [], notProven: NOT_PROVEN, note: "Hội viên tự quét QR" },
    }),
    evidenceRow("GYM_CHECK_INS_STAFF_ATTESTED", {
      source: "gym-service.gym_check_ins", provenanceType: "STAFF_ATTESTED_SERVER_RECORDED", provenanceLabel: "Nhân viên phòng tập check-in hộ và tự xác nhận danh tính — check-in gym không chứng minh buổi dạy PT đã diễn ra",
      payload: { membershipId: "m1", window: { from: "2026-10-30T00:00:00.000Z", to: "2026-10-30T03:00:00.000Z" }, rows: [{ at: "2026-10-30T00:55:00.000Z", source: "ASSISTED", gymId: "gym-1", actor: { userId: "staff-1", kind: "GYM_STAFF" }, identityVerification: { method: "MEMBER_OTP", staffRole: "RECEPTION", verifiedAt: "2026-10-30T00:55:00.000Z" } }], notProven: NOT_PROVEN, note: "Nhân viên check-in hộ" },
    }),
    evidenceRow("PARTY_DOC:11", {
      source: "party.external_document", provenanceType: "EXTERNAL_DOCUMENT", submittedBy: "client-1", submittedRole: "CLIENT", sensitivity: "RESTRICTED", verificationStatus: "CLIENT_CLAIMED_UNVERIFIED", partySubmitted: true, provenanceLabel: "Tài liệu ngoài hệ thống do bên liên quan nộp",
      payload: { description: "Ảnh chụp màn hình tin nhắn", declaredSha256: "d".repeat(64), hashStatus: "CLIENT_CLAIMED_UNVERIFIED", fileStored: false, title: "Tin nhắn", fileName: "tin-nhan.png", fileStorage: "DESIGN_REQUIRED", declaredBy: "CLIENT" },
    }),
    evidenceRow("PARTY_FILE:22", {
      source: "party.external_document_file", provenanceType: "EXTERNAL_DOCUMENT", submittedBy: "pt-1", submittedRole: "PT", sensitivity: "RESTRICTED", verificationStatus: "SERVER_VERIFIED", partySubmitted: true, provenanceLabel: "Tài liệu ngoài hệ thống do bên liên quan nộp",
      payload: { description: "Bảng điểm danh", title: null, fileName: "diem-danh.pdf", declaredBy: "PT", storedFile: { key: STORAGE_KEY_SECRET, sha256: "f".repeat(64), sizeBytes: 20480, mime: "application/pdf", serverVerified: true, scope: "FILE_BYTES_ONLY" }, note: "Máy chủ đã lưu tệp và tự tính sha256 của chính tệp này." },
    }),
  ];
}

/** A source that could not be read (TECH_GAP / UNAVAILABLE). */
export const unavailableRow = () =>
  evidenceRow("GYM_PT_CHECK_INS", { source: "gym-service.gym_pt_check_ins", provenanceType: "TECH_GAP", captureStatus: "UNAVAILABLE", provenanceLabel: "Không đọc được nguồn (không phải bằng chứng vắng mặt)", payload: { note: UNAVAILABLE_NOTE } });

export function evidenceDetail(evidence: DisputeEvidence[]): DisputeCaseDetail {
  return { ...detailFixture(), evidence };
}

/** A GYM_PT_CHECK_INS row whose scan was not found (found:false). */
export const noScanRow = () =>
  evidenceRow("GYM_PT_CHECK_INS", {
    source: "gym-service.gym_pt_check_ins", provenanceType: "SELF_REPORTED_SERVER_RECORDED", provenanceLabel: "Người dùng tự quét/khai, máy chủ chỉ ghi lại",
    payload: { gymId: "gym-1", localDate: "2026-10-30", found: false, record: null, actor: { userId: "pt-1", kind: "PT_SELF" }, identityVerification: { method: "QR" }, notProven: NOT_PROVEN, note: "..." },
  });

export { financialItem, financialViewFixture };
