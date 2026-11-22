/**
 * Đối tác PT (batch G4) - pure model, no React. `/gym-owner/collaborations` keeps its path; with VITE_GYM_OWNER_V2 on it renders
 * three different screens by role (05 sections 3, 4, 9):
 *  - OWNER   : the PT agreements of the BRAND ("Áp dụng toàn thương hiệu"): four segments, a table, a drawer with the actions.
 *  - MANAGER : only "PT check-in tại chi nhánh" (`GET /owner/gyms/:id/pt-checkins`, latest 50, scope = branch). Never calls
 *              `GET /owner/collaborations` (owner-only on the server).
 *  - ACCOUNTANT: only "Hoa hồng PT" (`GET /owner/brands/:id/pt-commission`, totals + by month, never a PT name).
 *  - RECEPTIONIST: no such entry.
 *
 * All negotiation rules (whose turn, which actions, the notice period, legacy per-branch rows, the rate sentences) come from
 * `utils/brandPartnership.ts` (`buildPartnershipSections`, copy functions) and are NOT rewritten here. This module only
 *  - groups the cards the panel already builds into the four segments of the prototype,
 *  - shows the stored fractions exactly (a rate of 0.3255 is "32,55%", never rounded to 33%),
 *  - reads the dates the rows really carry (acceptedAt, expiresAt, terminatedAt, termination date),
 *  - mirrors the one check the old panel made in its rate form (the three percentages must add up to 100 with the fixed platform
 *    share), nothing else: the server stays the authority for sums, floor and turns.
 *
 * Honesty rules the page keeps:
 *  - The API sends NO proposal history and NO maximum number of rounds, so the drawer draws neither (no invented rows, no "n/5").
 *  - The money-flow of a PT contract (client <-> PT) is not shown here, and a PT is an independent practitioner (said on the page).
 */
import type { PartnerRole } from "../../../utils/gymStaffRole";
import {
  buildPartnershipSections,
  type BrandAgreementView,
  type LegacyGroupView,
  type PartnershipCard,
  type Tone,
} from "../../../utils/brandPartnership";
import { normalizeOwnerPtCheckins, ownerPtCheckinWhen, type OwnerPtCheckin } from "../../../utils/ptGymCheckin";
import type { CommissionBucket, PtCommissionSummary } from "../../../utils/ptCommission";
import type { TagTone } from "../scope/scopeModel";
import { formatDay } from "../members/membersModel";

// ---------------------------------------------------------------------------------------------------------------------
// Role -> which screen
// ---------------------------------------------------------------------------------------------------------------------

export type PartnersView = "agreements" | "checkins" | "commission" | "none";

export function partnersViewFor(role: PartnerRole | undefined): PartnersView {
  switch (role) {
    case "OWNER":
      return "agreements";
    case "MANAGER":
      return "checkins";
    case "ACCOUNTANT":
      return "commission";
    default:
      return "none"; // receptionist and an unknown role (fail closed)
  }
}

export const PARTNERS_TITLE: Record<Exclude<PartnersView, "none">, string> = {
  agreements: "Đối tác PT",
  checkins: "PT check-in tại chi nhánh",
  commission: "Hoa hồng PT",
};

export const PARTNERS_SUB: Record<Exclude<PartnersView, "none">, string> = {
  agreements: "Thỏa thuận chia doanh thu với huấn luyện viên. Mỗi PT một bộ tỷ lệ cho cả thương hiệu.",
  checkins: "Lượt huấn luyện viên quét mã QR tại chi nhánh bạn phụ trách.",
  commission: "Hoa hồng giới thiệu PT theo tháng, chỉ tổng.",
};

export const PT_INDEPENDENT_NOTE = "PT là người hành nghề độc lập; hợp đồng giữa khách và PT, và ví của PT, không hiển thị ở đây.";

/** What the scope strip must offer: the owner works on the brand, the manager on one branch, the accountant on brand or one branch. */
export function partnersScopeKind(role: PartnerRole | undefined): "brand" | "branch" | "brand-or-branch" | "none" {
  switch (partnersViewFor(role)) {
    case "agreements":
      return "brand";
    case "checkins":
      return "branch";
    case "commission":
      return "brand-or-branch";
    default:
      return "none";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// URL: ?seg=active|mine|theirs|ended&agreement=<id>
// ---------------------------------------------------------------------------------------------------------------------

export const SEGMENT_IDS = ["active", "mine", "theirs", "ended"] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];

export const SEGMENT_LABEL: Record<SegmentId, string> = {
  active: "Đang hợp tác",
  mine: "Chờ bạn phản hồi",
  theirs: "Chờ PT phản hồi",
  ended: "Đã kết thúc",
};

export function parseSegment(raw: string | null | undefined): SegmentId {
  return (SEGMENT_IDS as readonly string[]).includes(raw ?? "") ? (raw as SegmentId) : "active";
}

export function partnersSearch(p: { seg?: SegmentId; agreementId?: string | null }): string {
  const sp = new URLSearchParams();
  if (p.seg && p.seg !== "active") sp.set("seg", p.seg);
  if (p.agreementId) sp.set("agreement", p.agreementId);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------------------------------------------------
// Rates: shown exactly as stored
// ---------------------------------------------------------------------------------------------------------------------

/** "55%" / "32,55%" from a stored fraction ("0.5500"); "—" when absent. Two decimals are the storage precision (Decimal(6,4)). */
export function ratePercent(fraction: unknown): string {
  if (fraction == null || fraction === "") return "—";
  const n = Number(fraction);
  if (!Number.isFinite(n)) return "—";
  return `${String(Number((n * 100).toFixed(2))).replace(".", ",")}%`;
}

/** Percent text for a form field from a stored fraction, exact (never Math.round to a whole number). */
export function percentFieldFrom(fraction: string | null | undefined, fallback: string): string {
  if (fraction == null || fraction === "") return fallback;
  const n = Number(fraction);
  return Number.isFinite(n) ? String(Number((n * 100).toFixed(2))) : fallback;
}

/** The platform share the old panel fixed in its form (the server owns the floor and may refuse any other number). */
export const PLATFORM_PCT = 10;

export interface RatesState {
  /** The three percentages, platform included. NaN when a field is empty or not a number. */
  sum: number;
  /** Mirrors the old panel: the three must add up to exactly 100. Empty / non-numeric fields are never ok. */
  ok: boolean;
  /** Request body in the shape `collaborationService.respond / propose*` takes (fractions, four decimals). */
  body: { ptRate: string; gymRate: string; platformRate: string } | null;
}

const cents = (v: string) => (v.trim() === "" ? NaN : Math.round(Number(v) * 100));

export function ratesState(ptPct: string, gymPct: string): RatesState {
  const pt = cents(ptPct);
  const gym = cents(gymPct);
  const sumCents = pt + gym + PLATFORM_PCT * 100;
  const ok = Number.isFinite(sumCents) && sumCents === 10000;
  return {
    sum: Number.isFinite(sumCents) ? sumCents / 100 : Number.NaN,
    ok,
    body: ok
      ? {
          ptRate: (Number(ptPct) / 100).toFixed(4),
          gymRate: (Number(gymPct) / 100).toFixed(4),
          platformRate: (PLATFORM_PCT / 100).toFixed(4),
        }
      : null,
  };
}

export const RATES_SERVER_NOTE = "Máy chủ kiểm tra lại tổng ba tỷ lệ và mức tối thiểu của nền tảng khi gửi.";

// ---------------------------------------------------------------------------------------------------------------------
// Rows of the agreements table
// ---------------------------------------------------------------------------------------------------------------------

export const toTagTone = (t: Tone): TagTone => (t === "success" ? "ok" : t === "warning" ? "warn" : t === "danger" ? "risk" : t === "info" ? "info" : "neutral");

export interface RateCells {
  pt: string;
  gym: string;
  platform: string;
}

export interface PartnerRow {
  /** Brand agreement id, or the legacy group key. Used for the row and the `?agreement=` deep link. */
  key: string;
  kind: "BRAND" | "LEGACY";
  segment: SegmentId;
  ptUserId: string;
  /** Thương hiệu name (BRAND) or branch name (legacy brandless). Shown under the PT name. */
  scopeLine: string;
  tag: { text: string; tone: TagTone };
  /** null when the live legacy rows carry different rates (no single table to show). */
  rates: RateCells | null;
  roundText: string;
  effectText: string;
  card: PartnershipCard;
}

const cellsOf = (raw: { pt: string | null; gym: string | null; platform: string | null }): RateCells => ({
  pt: ratePercent(raw.pt),
  gym: ratePercent(raw.gym),
  platform: ratePercent(raw.platform),
});

export function segmentOfCard(c: PartnershipCard): SegmentId {
  if (c.kind === "LEGACY") {
    if (c.rows.some((r) => r.stage === "MY_TURN")) return "mine";
    if (c.rows.length > 0 && c.rows.every((r) => r.stage === "THEIR_TURN")) return "theirs";
    return "active";
  }
  switch (c.stage) {
    case "MY_TURN":
      return "mine";
    case "THEIR_TURN":
      return "theirs";
    case "ACTIVE":
    case "TERMINATING":
      return "active";
    default:
      return "ended";
  }
}

type RawRow = Record<string, unknown> | undefined;

function brandEffect(c: BrandAgreementView, raw: RawRow): string {
  switch (c.stage) {
    case "ACTIVE": {
      const from = formatDay(typeof raw?.acceptedAt === "string" ? raw.acceptedAt : null);
      return from ? `Từ ${from}` : "Đang hiệu lực";
    }
    case "TERMINATING":
      return c.effectiveDate ? `Chấm dứt ngày ${c.effectiveDate}` : "Đang chấm dứt";
    case "MY_TURN":
    case "THEIR_TURN": {
      const until = formatDay(c.expiresAt);
      return until ? `Hạn trả lời ${until}` : "Chờ phản hồi";
    }
    case "TERMINATED":
      return c.terminatedDate ? `Chấm dứt ${c.terminatedDate}` : "Đã chấm dứt";
    case "REJECTED":
      return "Đã từ chối";
    default:
      return "Đã hết hạn";
  }
}

function legacySummary(g: LegacyGroupView): { rates: RateCells | null; round: number } {
  const keys = new Set(g.rows.map((r) => `${r.raw.pt}|${r.raw.gym}|${r.raw.platform}`));
  const pending = g.rows.filter((r) => r.stage === "MY_TURN" || r.stage === "THEIR_TURN");
  return { rates: keys.size === 1 && g.rows[0] ? cellsOf(g.rows[0].raw) : null, round: pending.reduce((m, r) => Math.max(m, r.round), 0) };
}

/** Every card of the owner's list as a table row, in the order the panel already sorts them (needs reply, current, ended). */
export function buildPartnerRows(rawRows: unknown): PartnerRow[] {
  const sections = buildPartnershipSections(rawRows, "GYM");
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : []) if (r && typeof r.id === "string") byId.set(r.id, r);
  const all = [...sections.needsReply, ...sections.current, ...sections.ended];
  return all.map<PartnerRow>((c) => {
    if (c.kind === "BRAND") {
      return {
        key: c.id,
        kind: "BRAND",
        segment: segmentOfCard(c),
        ptUserId: c.ptUserId,
        scopeLine: `Thương hiệu ${c.brandName}`,
        tag: { text: c.label, tone: toTagTone(c.tone) },
        rates: cellsOf(c.raw),
        roundText: c.stage === "MY_TURN" || c.stage === "THEIR_TURN" ? `Vòng ${c.round}` : "—",
        effectText: brandEffect(c, byId.get(c.id)),
        card: c,
      };
    }
    const s = legacySummary(c);
    const seg = segmentOfCard(c);
    return {
      key: c.key,
      kind: "LEGACY",
      segment: seg,
      ptUserId: c.ptUserId,
      scopeLine: c.branded ? `Điều khoản cũ theo chi nhánh, thương hiệu ${c.brandName}` : `Chi nhánh ${c.brandName}, chưa có thương hiệu`,
      tag: seg === "mine" ? { text: "Bạn cần trả lời", tone: "warn" } : seg === "theirs" ? { text: "Chờ huấn luyện viên trả lời", tone: "info" } : { text: c.branded ? "Điều khoản cũ" : "Theo chi nhánh", tone: "warn" },
      rates: s.rates,
      roundText: s.round > 0 ? `Vòng ${s.round}` : "—",
      effectText: "Theo từng chi nhánh",
      card: c,
    };
  });
}

export function segmentCounts(rows: readonly PartnerRow[]): Record<SegmentId, number> {
  const out: Record<SegmentId, number> = { active: 0, mine: 0, theirs: 0, ended: 0 };
  for (const r of rows) out[r.segment] += 1;
  return out;
}

export function findPartnerRow(rows: readonly PartnerRow[], key: string | null | undefined): PartnerRow | null {
  return key ? (rows.find((r) => r.key === key) ?? null) : null;
}

/** The segment an agreement sits in, so a deep link `?agreement=` shows the row behind the drawer. */
export function segmentForKey(rows: readonly PartnerRow[], key: string | null | undefined, fallback: SegmentId): SegmentId {
  return findPartnerRow(rows, key)?.segment ?? fallback;
}

// ---------------------------------------------------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------------------------------------------------

export const SEGMENT_EMPTY: Record<SegmentId, { title: string; body: string }> = {
  active: { title: "Chưa có PT nào đang hợp tác", body: 'Chọn "Mời huấn luyện viên" để gửi đề xuất, hoặc chờ đề xuất từ PT.' },
  mine: { title: "Không có đề xuất nào chờ bạn", body: "Khi PT gửi đề xuất hoặc đề xuất lại, nó hiện ở đây để bạn trả lời." },
  theirs: { title: "Không có đề xuất nào đang chờ PT", body: "Đề xuất bạn đã gửi và PT chưa trả lời sẽ hiện ở đây." },
  ended: { title: "Chưa có thỏa thuận nào kết thúc", body: "Thỏa thuận đã chấm dứt, bị từ chối hoặc hết hạn sẽ hiện ở đây." },
};

export const NO_BRAND_PROPOSAL_NOTE = "Chưa có chi nhánh nào được duyệt, nên chưa gửi được đề xuất. Hoàn tất chi nhánh đầu tiên trước.";

// ---------------------------------------------------------------------------------------------------------------------
// Errors in plain Vietnamese
// ---------------------------------------------------------------------------------------------------------------------

const STATUS_WORD: Record<string, string> = {
  PENDING: "đang chờ phản hồi",
  COUNTERED: "đang đề xuất lại",
  ACCEPTED: "đang hợp tác",
  REJECTED: "đã từ chối",
  EXPIRED: "đã hết hạn",
  TERMINATED: "đã chấm dứt",
};

/** The server's own sentence (gym-service writes them in Vietnamese), with an enum word turned into plain text; never a code. */
export function collabErrorMessage(err: unknown, fallback = "Thao tác chưa thực hiện được. Thử lại sau ít phút."): string {
  const e = err as { response?: { status?: number; data?: { error?: { message?: unknown } | string } } } | null;
  const raw = typeof e?.response?.data?.error === "string" ? e.response.data.error : e?.response?.data?.error?.message;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().replace(/\b(PENDING|COUNTERED|ACCEPTED|REJECTED|EXPIRED|TERMINATED)\b/g, (w) => STATUS_WORD[w] ?? w);
  }
  switch (e?.response?.status) {
    case 403:
      return "Chỉ chủ phòng tập mới thực hiện được thao tác này.";
    case 409:
      return "Thỏa thuận vừa thay đổi ở phía bên kia. Tải lại để xem trạng thái mới nhất.";
    case 404:
      return "Không tìm thấy thỏa thuận này. Có thể nó đã được xử lý.";
    default:
      return fallback;
  }
}

/** Whether a failed action only makes sense after reloading the list (someone else moved first). */
export function collabErrorNeedsReload(err: unknown): boolean {
  const s = (err as { response?: { status?: number } } | null)?.response?.status;
  return s === 409 || s === 404;
}

// ---------------------------------------------------------------------------------------------------------------------
// Manager: PT check-ins of one branch
// ---------------------------------------------------------------------------------------------------------------------

export const PT_CHECKIN_WINDOW = 50;

export interface PtCheckinRow extends OwnerPtCheckin {
  when: string;
}

/** Latest first (by the first scan of the day); the server already caps the list at 50. */
export function ptCheckinRows(raw: unknown): PtCheckinRow[] {
  return normalizeOwnerPtCheckins(raw)
    .map((c) => ({ ...c, when: ownerPtCheckinWhen(c) }))
    .sort((a, b) => String(b.firstScanAt ?? b.localDate ?? "").localeCompare(String(a.firstScanAt ?? a.localDate ?? "")));
}

/** Always states the limit; says "may be cut" only when the list is exactly as long as the cap. */
export function ptCheckinNote(count: number): string {
  if (count >= PT_CHECKIN_WINDOW) return `Máy chủ chỉ trả ${PT_CHECKIN_WINDOW} lượt gần nhất của chi nhánh và chưa phân trang, nên lượt cũ hơn không hiện ở đây.`;
  return `Hiển thị toàn bộ ${count} lượt máy chủ trả về (giới hạn ${PT_CHECKIN_WINDOW} lượt gần nhất của chi nhánh).`;
}

export const PT_CHECKIN_SCAN_LABEL = (n: number) => `${n} lần quét`;

// ---------------------------------------------------------------------------------------------------------------------
// Accountant: commission of PT referrals
// ---------------------------------------------------------------------------------------------------------------------

export interface CommissionField {
  key: keyof Pick<CommissionBucket, "expected" | "recorded" | "paid" | "clawedBack">;
  label: string;
  hint: string;
}

/** Labels follow audit/03 row 13: "paid" is money moved to the PT's available balance, NOT a bank transfer. */
export const COMMISSION_FIELDS: readonly CommissionField[] = [
  { key: "expected", label: "Dự kiến", hint: "Chưa chuyển cho PT" },
  { key: "recorded", label: "Đã ghi nhận", hint: "Đã vào số dư chờ của PT, chờ gói kết thúc" },
  { key: "paid", label: "Đã giải phóng cho PT", hint: "Sang số dư khả dụng của PT, chưa phải đã chuyển vào ngân hàng" },
  { key: "clawedBack", label: "Đã thu hồi", hint: "Hoàn tiền thẻ nên hoa hồng bị thu lại" },
];

export const COMMISSION_NOTE = "Chỉ tổng theo tháng, không theo từng PT và không có tỷ lệ. Giá trị do máy chủ tính.";

export function isEmptyCommission(s: Pick<PtCommissionSummary, "totals" | "byMonth">): boolean {
  const t = s.totals;
  return s.byMonth.length === 0 && t.expected === 0 && t.recorded === 0 && t.paid === 0 && t.clawedBack === 0 && t.referralCount === 0;
}
