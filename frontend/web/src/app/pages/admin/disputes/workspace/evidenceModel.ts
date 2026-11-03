/**
 * D2 / M4 - pure model of the "Bằng chứng" tab: grouping by source, version chains (`supersedesId`), the badges each row must carry,
 * and a readable key/value form of the opaque `payload`. No React, no I/O.
 *
 * Rules (handoff M4, kept here so a test can pin them):
 *  - TECH_GAP / UNAVAILABLE = "Không đọc được nguồn", never "vắng mặt"; `found:false` = "Không có bản ghi quét trong ngày".
 *  - NULL / empty list is never turned into "PT vắng mặt".
 *  - DERIVED rows say they are not an independent source; party-submitted rows say "Bên liên quan tự khai - chưa xác minh".
 *  - `payload.storedFile.key` (internal storage key, R-15) is stripped everywhere, including the technical block.
 *  - Free-text `note` fields of the server may contain internal codes (SERVER_OBSERVED, E2, OFFLINE ...): they are mapped to our own sentences, never echoed.
 *  - Unknown payload keys go to a collapsed technical block.
 */
import { formatMoneyString, parseCents } from "../../adminFinanceOverview.utils";
import { PROVENANCE_LABEL } from "../disputeCaseLabels";
import type { DisputeEvidence } from "../disputeCaseTypes";
import { sessionTypeLabel } from "../queue/queueModel";
import { asArray, asRecord, formatDateTime, proseOrNull, shortRef } from "./format";

// ───────────────────────────────────────────────────────────── titles ──
export const SOURCE_ORDER = [
  "user-service.sessions",
  "user-service.contracts",
  "user-service.session_settlements",
  "user-service.session_reschedule_requests",
  "user-service.pt_terms_acceptances",
  "user-service.audit_logs",
  "chat-service.call_sessions",
  "gym-service.gym_pt_check_ins",
  "gym-service.gym_check_ins",
  "party.external_document",
  "party.external_document_file",
] as const;

export const SOURCE_TITLE: Record<string, string> = {
  "user-service.sessions": "Buổi tập",
  "user-service.contracts": "Hợp đồng",
  "user-service.session_settlements": "Quyết toán tiền của buổi",
  "user-service.session_reschedule_requests": "Đổi giờ",
  "user-service.pt_terms_acceptances": "Điều khoản PT đã chấp nhận",
  "user-service.audit_logs": "Nhật ký thao tác",
  "chat-service.call_sessions": "Cuộc gọi trực tuyến",
  "gym-service.gym_pt_check_ins": "PT quét mã tại phòng tập",
  "gym-service.gym_check_ins": "Khách check-in tại phòng tập",
  "party.external_document": "Tài liệu do bên liên quan nộp (mô tả)",
  "party.external_document_file": "Tệp do bên liên quan nộp",
};
export const SOURCE_FALLBACK_TITLE = "Nguồn khác";

export const SUBJECT_TITLE: Record<string, string> = {
  SESSION_ROW: "Thông tin buổi tập",
  ROOM_PT_JOINED_AT: "PT vào phòng trực tuyến",
  ROOM_CLIENT_JOINED_AT: "Khách vào phòng trực tuyến",
  CONTRACT_SNAPSHOT: "Hợp đồng (bản chụp)",
  CONTRACT_FINANCIAL_SNAPSHOT: "Tài chính hợp đồng (bản chụp)",
  PT_TERMS_ACCEPTANCES: "PT chấp nhận điều khoản",
  RESCHEDULE_REQUESTS: "Yêu cầu đổi giờ",
  "AUDIT_LOG:SESSION": "Nhật ký thao tác của buổi",
  "AUDIT_LOG:CONTRACT": "Nhật ký thao tác của hợp đồng",
  SETTLEMENTS: "Các bước quyết toán tiền",
  CALL_SESSIONS: "Kết nối cuộc gọi",
  GYM_PT_CHECK_INS: "PT quét mã tại phòng tập trong ngày",
  GYM_PT_CHECK_INS_QUALIFYING_LINK: "Buổi liên kết với lần quét (dẫn xuất)",
  GYM_CHECK_INS_SELF_REPORTED: "Khách tự quét mã tại phòng tập",
  GYM_CHECK_INS_STAFF_ATTESTED: "Nhân viên check-in hộ khách",
};
export function subjectTitle(subject: string): string {
  if (subject in SUBJECT_TITLE) return SUBJECT_TITLE[subject];
  if (subject.startsWith("PARTY_DOC:")) return "Tài liệu do bên liên quan nộp";
  if (subject.startsWith("PARTY_FILE:")) return "Tệp do bên liên quan nộp";
  return "Dữ liệu khác";
}
export const sourceTitle = (source: string) => SOURCE_TITLE[source] ?? SOURCE_FALLBACK_TITLE;

// ───────────────────────────────────────────────────────────── pills ──
export type BadgeTone = "success" | "pending" | "danger" | "warning" | "info" | "neutral";
export interface Badge {
  label: string;
  tone: BadgeTone;
}

export const GYM_CHECKIN_SUBJECTS = ["GYM_PT_CHECK_INS", "GYM_CHECK_INS_SELF_REPORTED", "GYM_CHECK_INS_STAFF_ATTESTED"];
export const UNREADABLE_SOURCE_LABEL = "Không đọc được nguồn";
export const PARTY_CLAIM_LABEL = "Bên liên quan tự khai - chưa xác minh";
export const DERIVED_LABEL = "Dữ liệu dẫn xuất, không phải nguồn độc lập";
export const NO_SCAN_LABEL = "Không có bản ghi quét trong ngày";
export const NO_SCAN_HELP = "Không có bản ghi không chứng minh PT vắng mặt.";
export const VIEW_LOGGED_NOTE = "Mỗi lần xem được ghi lại.";
export const FILE_NOT_OPENABLE_NOTE = "Chưa mở xem tệp được ở màn này.";

/** True when the source could not be read (so the row proves nothing either way). */
export function isUnreadable(e: Pick<DisputeEvidence, "provenanceType" | "captureStatus">): boolean {
  return e.provenanceType === "TECH_GAP" || e.captureStatus === "UNAVAILABLE" || e.captureStatus === "TECH_GAP_SUSPECTED";
}

/** The server's Vietnamese sentence, unless it is missing or a raw enum (then our own wording of the type). */
export function provenanceText(e: Pick<DisputeEvidence, "provenanceLabel" | "provenanceType">): string {
  const s = typeof e.provenanceLabel === "string" ? e.provenanceLabel.trim() : "";
  if (s && !/^[A-Z0-9_]+$/.test(s)) return s;
  return PROVENANCE_LABEL[e.provenanceType as keyof typeof PROVENANCE_LABEL] ?? "Nguồn chưa rõ";
}

export function evidenceBadges(e: DisputeEvidence): Badge[] {
  const out: Badge[] = [];
  if (isUnreadable(e)) out.push({ label: UNREADABLE_SOURCE_LABEL, tone: "danger" });
  else if (e.captureStatus === "NOT_APPLICABLE" || e.provenanceType === "NOT_APPLICABLE") out.push({ label: "Không áp dụng", tone: "neutral" });
  if (e.provenanceType === "DERIVED") out.push({ label: DERIVED_LABEL, tone: "info" });
  if (e.partySubmitted) {
    // a stored file: the bytes are verified, what the party says about them is not
    out.push({ label: PARTY_CLAIM_LABEL, tone: "warning" });
    if (e.verificationStatus === "SERVER_VERIFIED") out.push({ label: "Máy chủ đã xác minh (chỉ phần tệp)", tone: "success" });
  } else if (e.verificationStatus === "SERVER_VERIFIED") {
    out.push({ label: "Máy chủ đã xác minh (chỉ phần tệp)", tone: "success" });
  } else if (e.verificationStatus === "CLIENT_CLAIMED_UNVERIFIED") {
    out.push({ label: PARTY_CLAIM_LABEL, tone: "warning" });
  }
  if (e.sensitivity === "SENSITIVE") out.push({ label: "Nhạy cảm", tone: "pending" });
  if (e.sensitivity === "RESTRICTED") out.push({ label: "Hạn chế (chỉ người nộp và quản trị viên xem)", tone: "pending" });
  return out;
}

// ───────────────────────────────────────────────────────── grouping ──
export interface EvidenceItem {
  slotKey: string;
  title: string;
  current: DisputeEvidence;
  /** older versions, newest first */
  older: DisputeEvidence[];
}
export interface EvidenceGroup {
  source: string;
  title: string;
  items: EvidenceItem[];
}

const slotOf = (e: DisputeEvidence) => `${e.source}\u0000${e.subject}`;

/** current = the row nobody supersedes; broken chain -> highest snapshotVersion. */
export function currentOf(rows: DisputeEvidence[]): DisputeEvidence {
  const superseded = new Set(rows.map((r) => r.supersedesId).filter((x): x is string => !!x));
  const live = rows.filter((r) => !superseded.has(r.id));
  const pool = live.length > 0 ? live : rows;
  return [...pool].sort((a, b) => b.snapshotVersion - a.snapshotVersion || Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
}

export function buildEvidenceGroups(evidence: DisputeEvidence[] | null | undefined): EvidenceGroup[] {
  const bySlot = new Map<string, DisputeEvidence[]>();
  for (const e of evidence ?? []) {
    if (!e || typeof e.id !== "string") continue;
    const k = slotOf(e);
    bySlot.set(k, [...(bySlot.get(k) ?? []), e]);
  }
  const bySource = new Map<string, EvidenceItem[]>();
  for (const [slotKey, rows] of bySlot) {
    const current = currentOf(rows);
    const older = rows.filter((r) => r.id !== current.id).sort((a, b) => b.snapshotVersion - a.snapshotVersion || Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    const item: EvidenceItem = { slotKey, title: subjectTitle(current.subject), current, older };
    bySource.set(current.source, [...(bySource.get(current.source) ?? []), item]);
  }
  const rank = (s: string) => {
    const i = (SOURCE_ORDER as readonly string[]).indexOf(s);
    return i === -1 ? SOURCE_ORDER.length : i;
  };
  return [...bySource.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([source, items]) => ({
      source,
      title: sourceTitle(source),
      items: items.sort((a, b) => a.title.localeCompare(b.title, "vi")),
    }));
}

/** Evidence title for a reference from an assessment/proposal: our wording + short ref, never the raw uuid alone. */
export function evidenceRefText(id: string, evidence: DisputeEvidence[] | null | undefined): string {
  const e = (evidence ?? []).find((x) => x.id === id);
  return e ? `${subjectTitle(e.subject)} (mã ${shortRef(e.id)})` : `Bằng chứng không còn trong hồ sơ (mã ${shortRef(id)})`;
}

// ─────────────────────────────────────────────────────────── payload ──
export interface PayloadField {
  label: string;
  value: string;
}
export interface PayloadGroup {
  title: string;
  records: PayloadField[][];
  emptyText?: string;
}
export interface PayloadView {
  fields: PayloadField[];
  groups: PayloadGroup[];
  /** our own sentences (never server `note`) */
  notes: string[];
  /** `payload.notProven` of a gym check-in or a call (server Vietnamese sentence) */
  notProven: string | null;
  technical: PayloadField[];
}

const SESSION_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Khách đã đặt, chờ PT xác nhận",
  CONFIRMED: "PT đã xác nhận",
  PENDING_CLIENT_CONFIRMATION: "Chờ khách xác nhận",
  DISPUTED: "Đang khiếu nại",
  PT_NO_SHOW_REPORTED: "Khách báo PT vắng, chờ PT phản hồi",
  COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã huỷ",
  NO_SHOW: "Có người vắng mặt",
};
const CONTRACT_STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: "Chờ PT quyết định",
  PENDING_SIGNATURE: "Chờ ký",
  PENDING_PAYMENT: "Chờ thanh toán",
  ACTIVE: "Đang hiệu lực",
  COMPLETED: "Đã dùng hết số buổi",
  EXPIRED: "Đã hết hạn",
  CANCELLED: "Đã kết thúc sớm",
  REJECTED: "PT đã từ chối",
};
const PACKAGE_TYPE_LABEL: Record<string, string> = { PER_SESSION: "Trả theo buổi", PACKAGE: "Gói nhiều buổi" };
const SESSION_MODE_LABEL: Record<string, string> = { ONLINE: "Trực tuyến", OFFLINE: "Trực tiếp", HYBRID: "Kết hợp" };
const RESCHEDULE_STATUS_LABEL: Record<string, string> = { PENDING: "Đang chờ", ACCEPTED: "Đã đồng ý", REJECTED: "Bị từ chối", EXPIRED: "Hết hạn", CANCELLED: "Đã huỷ" };
const PARTY_LABEL: Record<string, string> = { CLIENT: "Khách", PT: "PT" };
const SETTLEMENT_KIND_LABEL: Record<string, string> = {
  PT_NO_SHOW_COMPENSATION: "Hoàn tiền do PT vắng",
  SESSION_RELEASE: "Nhả tiền buổi tập",
  CONTRACT_TERMINATION: "Tất toán khi kết thúc hợp đồng",
  PT_LATE_ARRIVAL_COMPENSATION: "Đền do PT đến muộn",
  UNRESOLVED_SESSION_RESOLUTION: "Giải quyết buổi bị giữ",
};
const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Chờ xử lý",
  PROCESSING: "Đang xử lý",
  SETTLED: "Bước đã chạy xong (chưa có nghĩa tiền đã về, xem tab Tiền)",
  FAILED: "Bị lỗi",
  UNCONFIRMED: "Chưa xác nhận được kết quả",
  NEEDS_HUMAN: "Cần người xem xét",
  CONFLICT: "Dữ liệu mâu thuẫn, cần người xem xét",
};
const SETTLEMENT_REASON_LABEL: Record<string, string> = { DELIVERED: "Buổi đã diễn ra", NOT_DELIVERED: "Buổi không diễn ra" };
const CHECKIN_ACTOR_LABEL: Record<string, string> = { MEMBER_SELF: "Khách tự quét", GYM_STAFF: "Nhân viên phòng tập check-in hộ", PT_SELF: "PT tự quét" };
const IDENTITY_METHOD_LABEL: Record<string, string> = {
  QR: "Quét mã QR",
  MEMBER_OTP: "Mã OTP của khách",
  PHOTO_MATCH: "Đối chiếu ảnh",
  MANAGER_EXCEPTION: "Quản lý cho phép ngoại lệ",
};
const MIME_LABEL: Record<string, string> = { "image/jpeg": "Ảnh JPG", "image/png": "Ảnh PNG", "image/webp": "Ảnh WEBP", "application/pdf": "Tệp PDF" };

const yesNo = (v: unknown): string | null => (v === true ? "Có" : v === false ? "Không" : null);
const dateOrNull = (v: unknown): string | null => (typeof v === "string" && v && !Number.isNaN(Date.parse(v)) ? formatDateTime(v) : null);
const moneyOrNull = (v: unknown): string | null => (parseCents(v) === null ? null : formatMoneyString(v));
const plain = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const ref = (v: unknown): string | null => (typeof v === "string" && v ? `mã ${shortRef(v)}` : null);
const fromTable = (table: Record<string, string>, v: unknown): string | null => (typeof v === "string" && v in table ? table[v] : null);

/** Map the known Vietnamese-with-codes notes of the collector to our own sentences. Unknown note -> null (never echoed). */
export function sanitizeNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const n = note;
  if (/NULL không phải bằng chứng vắng mặt/.test(n)) return "Không ghi nhận được thời điểm vào phòng. Việc không có ghi nhận không chứng minh người đó vắng mặt.";
  if (/không có phòng (gọi )?trực tuyến/.test(n)) return "Buổi tập trực tiếp nên không có phòng trực tuyến.";
  if (/trực tuyến.*(quét QR|check-in)/.test(n)) return "Buổi tập trực tuyến nên không áp dụng nguồn này.";
  if (/thiếu gymId/.test(n)) return "Hợp đồng không gắn phòng tập nên không tra cứu check-in.";
  if (/thiếu membershipId/.test(n)) return "Hợp đồng không ghi thẻ hội viên nên không tra cứu check-in.";
  if (/Không có bản ghi quét trong ngày/.test(n)) return "Không có bản ghi quét trong ngày nên không có liên kết dẫn xuất.";
  return null;
}

/** Deep copy without the internal storage key (R-15) and other storage internals. */
export function stripInternal(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.map((v) => stripInternal(v, depth + 1));
  const o = asRecord(value);
  if (!o) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (depth >= 1 && k === "key" && "serverVerified" in o) continue; // storedFile.key
    if (k === "storagePath" || k === "storageKey") continue;
    out[k] = stripInternal(v, depth + 1);
  }
  return out;
}

const techValue = (v: unknown): string => {
  let s: string;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
};

type Mapper = (v: unknown, payload: Record<string, unknown>) => string | null;
interface Spec {
  label: string;
  map: Mapper;
}
function applySpecs(payload: Record<string, unknown>, specs: Record<string, Spec>, hidden: readonly string[] = []): { fields: PayloadField[]; leftover: string[] } {
  const fields: PayloadField[] = [];
  for (const [key, spec] of Object.entries(specs)) {
    if (!(key in payload)) continue;
    const text = spec.map(payload[key], payload);
    fields.push({ label: spec.label, value: text ?? "Chưa có" });
  }
  const known = new Set([...Object.keys(specs), ...hidden]);
  return { fields, leftover: Object.keys(payload).filter((k) => !known.has(k)) };
}
const techFor = (payload: Record<string, unknown>, keys: string[], prefix = ""): PayloadField[] =>
  keys.map((k) => ({ label: `${prefix}${k}`, value: techValue(payload[k]) }));

/** Rows of a list payload as records + leftover keys of the rows as technical entries. */
function recordsFrom(
  rows: unknown,
  specs: Record<string, Spec>,
  hidden: readonly string[],
): { records: PayloadField[][]; technical: PayloadField[] } {
  const records: PayloadField[][] = [];
  const technical: PayloadField[] = [];
  asArray(rows).forEach((r, i) => {
    const o = asRecord(r);
    if (!o) return;
    const { fields, leftover } = applySpecs(o, specs, hidden);
    records.push(fields);
    technical.push(...techFor(o, leftover, `dòng ${i + 1}: `));
  });
  return { records, technical };
}

const t = (label: string, map: Mapper): Spec => ({ label, map });
const text = (label: string): Spec => t(label, (v) => proseOrNull(v) ?? plain(v));

const SESSION_ROW_SPECS: Record<string, Spec> = {
  status: t("Trạng thái buổi", (v) => fromTable(SESSION_STATUS_LABEL, v)),
  sessionMode: t("Hình thức", (v) => fromTable(SESSION_MODE_LABEL, v)),
  scheduledStartAt: t("Giờ bắt đầu theo lịch", dateOrNull),
  scheduledEndAt: t("Giờ kết thúc theo lịch", dateOrNull),
  disputeType: t("Loại khiếu nại ghi trên buổi", (v) => (typeof v === "string" ? sessionTypeLabel(v) : null)),
  disputedAt: t("Thời điểm khiếu nại", dateOrNull),
  completedAt: t("Hoàn thành lúc", dateOrNull),
  sessionDeducted: t("Đã trừ quyền buổi", (v) => yesNo(v)),
  ptAtFault: t("PT bị ghi nhận có lỗi", (v) => yesNo(v)),
  clientConfirmDeadline: t("Hạn khách xác nhận", dateOrNull),
  autoConfirmed: t("Tự động xác nhận", (v) => yesNo(v)),
  cancelledBy: t("Người huỷ", ref),
  resolvedBy: t("Người phân xử", ref),
  resolvedAt: t("Phân xử lúc", dateOrNull),
};
const CONTRACT_SPECS: Record<string, Spec> = {
  status: t("Trạng thái hợp đồng", (v) => fromTable(CONTRACT_STATUS_LABEL, v)),
  packageType: t("Loại gói", (v) => fromTable(PACKAGE_TYPE_LABEL, v)),
  packageName: text("Tên gói"),
  sessionMode: t("Hình thức", (v) => fromTable(SESSION_MODE_LABEL, v)),
  price: t("Giá hợp đồng", moneyOrNull),
  totalSessions: t("Tổng số buổi", plain),
  usedSessions: t("Đã dùng", plain),
  compensatedSessions: t("Buổi bù", plain),
  extraSessions: t("Buổi tặng thêm", plain),
  sessionDurationMinutes: t("Thời lượng mỗi buổi (phút)", plain),
  startDate: t("Bắt đầu", dateOrNull),
  endDate: t("Kết thúc", dateOrNull),
  terminationReason: t("Lý do kết thúc", (v) => proseOrNull(v)),
  terminatedAt: t("Kết thúc lúc", dateOrNull),
};
const CONTRACT_FIN_SPECS: Record<string, Spec> = {
  pricePerSession: t("Giá mỗi buổi", moneyOrNull),
  platformRate: t("Tỷ lệ nền tảng (số thập phân)", plain),
  ptRate: t("Tỷ lệ PT (số thập phân)", plain),
  gymRate: t("Tỷ lệ phòng gym (số thập phân)", plain),
  ptHoldbackRate: t("Tỷ lệ tạm giữ của PT (số thập phân)", plain),
  ptHoldbackPolicyVersion: t("Phiên bản chính sách tạm giữ", plain),
  holdbackReleasedAt: t("Thả tạm giữ lúc", dateOrNull),
  releasedToPt: t("Đã nhả cho PT", moneyOrNull),
  releasedToGym: t("Đã nhả cho phòng gym", moneyOrNull),
  releasedToPlatform: t("Đã nhả cho nền tảng", moneyOrNull),
};

const empty = (): PayloadView => ({ fields: [], groups: [], notes: [], notProven: null, technical: [] });

function withNotProven(view: PayloadView, p: Record<string, unknown>): PayloadView {
  view.notProven = proseOrNull(p.notProven);
  return view;
}

/** One evidence row -> readable fields. Always total: a payload of any shape returns a view. */
export function describePayload(e: Pick<DisputeEvidence, "subject" | "payload" | "captureStatus" | "provenanceType">): PayloadView {
  const view = empty();
  const clean = stripInternal(e.payload);
  const p = asRecord(clean) ?? {};
  const subject = e.subject ?? "";

  // A source that could not be read: one sentence, whatever the payload says.
  if (e.provenanceType === "TECH_GAP" || e.captureStatus === "UNAVAILABLE") {
    view.notes.push("Không đọc được nguồn này lúc thu thập. Đây không phải bằng chứng vắng mặt và cũng không phải «không có bản ghi».");
    return view;
  }
  if (e.captureStatus === "NOT_APPLICABLE" || e.provenanceType === "NOT_APPLICABLE") {
    view.notes.push(sanitizeNote(p.note) ?? "Nguồn này không áp dụng cho buổi này.");
    return view;
  }

  const finish = (specs: Record<string, Spec>, hidden: string[] = []) => {
    const r = applySpecs(p, specs, [...hidden, "note", "notProven"]);
    view.fields.push(...r.fields);
    view.technical.push(...techFor(p, r.leftover));
  };

  if (subject === "SESSION_ROW") {
    finish(SESSION_ROW_SPECS, ["id", "contractId"]);
  } else if (subject === "ROOM_PT_JOINED_AT" || subject === "ROOM_CLIENT_JOINED_AT") {
    const when = dateOrNull(p.value);
    view.fields.push({ label: "Thời điểm vào phòng", value: when ?? "Không ghi nhận" });
    if (!when) view.notes.push(sanitizeNote("NULL không phải bằng chứng vắng mặt")!);
    view.technical.push(...techFor(p, Object.keys(p).filter((k) => !["value", "note"].includes(k))));
  } else if (subject === "CONTRACT_SNAPSHOT") {
    finish(CONTRACT_SPECS, ["id"]);
  } else if (subject === "CONTRACT_FINANCIAL_SNAPSHOT") {
    finish(CONTRACT_FIN_SPECS, ["id"]);
  } else if (subject === "PT_TERMS_ACCEPTANCES") {
    const { records, technical } = recordsFrom(p.rows, {
      version: t("Phiên bản điều khoản", plain),
      acceptedAt: t("Chấp nhận lúc", dateOrNull),
    }, ["id", "source"]);
    view.groups.push({ title: "Các lần chấp nhận", records, emptyText: "PT chưa có bản ghi chấp nhận điều khoản." });
    view.technical.push(...technical, ...techFor(p, Object.keys(p).filter((k) => !["rows", "ptUserId"].includes(k))));
  } else if (subject === "RESCHEDULE_REQUESTS") {
    const { records, technical } = recordsFrom(p.rows, {
      requestedBy: t("Người yêu cầu", (v) => fromTable(PARTY_LABEL, v)),
      originalStartAt: t("Giờ cũ", dateOrNull),
      proposedStartAt: t("Giờ đề nghị", dateOrNull),
      reason: text("Lý do"),
      status: t("Kết quả", (v) => fromTable(RESCHEDULE_STATUS_LABEL, v)),
      respondedAt: t("Phản hồi lúc", dateOrNull),
      createdAt: t("Tạo lúc", dateOrNull),
    }, ["id", "originalEndAt", "proposedEndAt"]);
    view.groups.push({ title: "Các yêu cầu đổi giờ", records, emptyText: "Không có yêu cầu đổi giờ nào." });
    view.technical.push(...technical, ...techFor(p, Object.keys(p).filter((k) => k !== "rows")));
  } else if (subject.startsWith("AUDIT_LOG:")) {
    const rows = asArray(p.rows).map((r) => asRecord(r)).filter((r): r is Record<string, unknown> => !!r);
    const times = rows.map((r) => Date.parse(String(r.createdAt))).filter(Number.isFinite);
    view.fields.push({ label: "Số dòng nhật ký", value: String(rows.length) });
    if (times.length) {
      view.fields.push({ label: "Dòng đầu tiên", value: formatDateTime(new Date(Math.min(...times)).toISOString()) });
      view.fields.push({ label: "Dòng gần nhất", value: formatDateTime(new Date(Math.max(...times)).toISOString()) });
    }
    view.notes.push("Nội dung từng dòng nhật ký nằm trong phần chi tiết kỹ thuật.");
    view.technical.push(...rows.map((r, i) => ({ label: `dòng ${i + 1}`, value: techValue({ createdAt: r.createdAt, actorUserId: r.actorUserId, action: r.action, metadata: r.metadata }) })));
    view.technical.push(...techFor(p, Object.keys(p).filter((k) => !["rows", "entityType", "entityId"].includes(k))));
  } else if (subject === "SETTLEMENTS") {
    const { records, technical } = recordsFrom(p.rows, {
      kind: t("Bước", (v) => fromTable(SETTLEMENT_KIND_LABEL, v)),
      status: t("Tình trạng", (v) => fromTable(SETTLEMENT_STATUS_LABEL, v)),
      reason: t("Căn cứ", (v) => fromTable(SETTLEMENT_REASON_LABEL, v)),
      createdAt: t("Tạo lúc", dateOrNull),
      settledAt: t("Chạy xong lúc", dateOrNull),
    }, ["id", "idempotencyKey"]);
    view.groups.push({ title: "Các bước quyết toán", records, emptyText: "Buổi này chưa có bước quyết toán nào." });
    view.technical.push(...technical, ...techFor(p, Object.keys(p).filter((k) => k !== "rows")));
  } else if (subject === "CALL_SESSIONS") {
    const { records, technical } = recordsFrom(p.rows, {
      startedAt: t("Bắt đầu gọi", dateOrNull),
      answeredAt: t("Được nhấc máy", dateOrNull),
      endedAt: t("Kết thúc", dateOrNull),
      callerId: t("Người gọi", ref),
      calleeId: t("Người nhận", ref),
    }, ["id"]);
    view.groups.push({ title: "Các kết nối", records, emptyText: "Không có bản ghi kết nối. Điều này không chứng minh PT vắng mặt." });
    view.notes.push("Bản ghi kết nối chỉ chứng minh có một kết nối, không chứng minh nội dung hay chất lượng buổi. Không có nội dung tin nhắn.");
    view.technical.push(...technical, ...techFor(p, Object.keys(p).filter((k) => !["rows", "note", "notProven"].includes(k))));
    withNotProven(view, p);
  } else if (subject === "GYM_PT_CHECK_INS") {
    const found = p.found === true;
    view.fields.push({ label: "Ngày tra cứu (giờ Việt Nam)", value: plain(p.localDate) ?? "Chưa có" });
    if (!found) {
      view.fields.push({ label: "Kết quả", value: NO_SCAN_LABEL });
      view.notes.push(NO_SCAN_HELP);
    } else {
      const rec = asRecord(p.record);
      view.fields.push({ label: "Lần quét đầu", value: dateOrNull(rec?.firstScanAt) ?? "Chưa có" });
      view.fields.push({ label: "Lần quét gần nhất", value: dateOrNull(rec?.lastScanAt) ?? "Chưa có" });
      view.fields.push({ label: "Số lần quét", value: plain(rec?.scanCount) ?? "Chưa có" });
    }
    const idv = asRecord(p.identityVerification);
    const method = fromTable(IDENTITY_METHOD_LABEL, idv?.method);
    if (method) view.fields.push({ label: "Cách xác thực", value: method });
    view.technical.push(...techFor(p, Object.keys(p).filter((k) => !["gymId", "localDate", "found", "record", "actor", "identityVerification", "note", "notProven"].includes(k))));
    withNotProven(view, p);
  } else if (subject === "GYM_PT_CHECK_INS_QUALIFYING_LINK") {
    view.fields.push({ label: "Số buổi gắn với lần quét", value: String(asArray(p.qualifyingSessionIds).length) });
    view.fields.push({ label: "Có gồm buổi này", value: yesNo(p.includesThisSession) ?? "Chưa có" });
    view.notes.push("Liên kết này được suy ra từ lần quét, không phải một nguồn độc lập với lần quét đó.");
    view.technical.push(...techFor(p, Object.keys(p).filter((k) => !["qualifyingSessionIds", "includesThisSession", "note"].includes(k))));
  } else if (subject === "GYM_CHECK_INS_SELF_REPORTED" || subject === "GYM_CHECK_INS_STAFF_ATTESTED") {
    const win = asRecord(p.window);
    view.fields.push({ label: "Khung giờ tra cứu", value: `${dateOrNull(win?.from) ?? "?"} – ${dateOrNull(win?.to) ?? "?"}` });
    const { records, technical } = recordsFrom(p.rows, {
      at: t("Lúc", dateOrNull),
      actor: t("Ai thực hiện", (v) => fromTable(CHECKIN_ACTOR_LABEL, asRecord(v)?.kind)),
      identityVerification: t("Cách xác thực", (v) => fromTable(IDENTITY_METHOD_LABEL, asRecord(v)?.method)),
    }, ["source", "gymId"]);
    view.groups.push({ title: "Các lượt check-in", records, emptyText: "Không có lượt check-in nào trong khung giờ này. Điều này không chứng minh khách vắng mặt." });
    view.technical.push(...technical, ...techFor(p, Object.keys(p).filter((k) => !["membershipId", "window", "rows", "note", "notProven"].includes(k))));
    withNotProven(view, p);
  } else if (subject.startsWith("PARTY_DOC:")) {
    const r = applySpecs(
      p,
      {
        title: text("Tiêu đề"),
        description: text("Mô tả của bên nộp"),
        fileName: text("Tên tệp bên nộp khai"),
        declaredSha256: t("Mã băm do bên nộp tự khai (chưa xác minh)", plain),
        declaredBy: t("Bên nộp", (v) => fromTable(PARTY_LABEL, v)),
      },
      ["hashStatus", "fileStored", "fileStorage"],
    );
    view.fields.push(...r.fields);
    view.notes.push("Chỉ có mô tả và mã băm do bên nộp tự khai. Chưa có tệp nào được lưu trên hệ thống.");
    view.technical.push(...techFor(p, r.leftover));
  } else if (subject.startsWith("PARTY_FILE:")) {
    const stored = asRecord(p.storedFile);
    const r = applySpecs(p, { title: text("Tiêu đề"), description: text("Mô tả của bên nộp"), fileName: text("Tên tệp"), declaredBy: t("Bên nộp", (v) => fromTable(PARTY_LABEL, v)) }, ["storedFile", "note"]);
    view.fields.push(...r.fields);
    if (stored) {
      view.fields.push({ label: "Loại tệp", value: fromTable(MIME_LABEL, stored.mime) ?? "Chưa rõ" });
      view.fields.push({ label: "Dung lượng", value: typeof stored.sizeBytes === "number" ? formatBytes(stored.sizeBytes) : "Chưa có" });
      view.fields.push({ label: "Mã băm do máy chủ tính (chỉ cho nội dung tệp)", value: plain(stored.sha256) ?? "Chưa có" });
    }
    view.notes.push("Máy chủ đã lưu tệp và tự tính mã băm của chính tệp. Mô tả của bên nộp vẫn là lời khai, chưa được xác minh.");
    view.notes.push(FILE_NOT_OPENABLE_NOTE);
    view.technical.push(...techFor(p, r.leftover));
    if (stored) view.technical.push(...techFor(stored, Object.keys(stored).filter((k) => !["mime", "sizeBytes", "sha256", "serverVerified", "scope"].includes(k)), "tệp: "));
  } else {
    // unknown subject: nothing is guessed, every key is technical
    view.technical.push(...techFor(p, Object.keys(p).filter((k) => k !== "notProven")));
    withNotProven(view, p);
  }
  return view;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "Chưa có";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
