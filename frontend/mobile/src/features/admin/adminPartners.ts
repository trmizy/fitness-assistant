/**
 * 14B.8 (PG-D1/D2) — admin "Đối tác" (web AdminPartnersPage → partner list + detail) and "Tài chính"
 * (web AdminFinancePage → overview + reconciliation). Pure, so the screens stay thin and testable.
 * Labels mirror web's `components/gym-management/statusConfig.ts` so both clients name a state the same.
 */

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const list = <T>(raw: unknown): T[] => {
  if (Array.isArray(raw)) return raw as T[];
  const d = (raw as any)?.data;
  return Array.isArray(d) ? (d as T[]) : [];
};

// ── Statuses ──────────────────────────────────────────────────────────────────────────────

export const PARTNER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PROSPECT: { label: "Tiềm năng", tone: "neutral" },
  INVITED: { label: "Đã mời, chờ thiết lập", tone: "info" },
  ACTIVE: { label: "Đang hoạt động", tone: "success" },
  SUSPENDED: { label: "Đang tạm khoá", tone: "danger" },
  TERMINATED: { label: "Đã chấm dứt hợp tác", tone: "neutral" },
};
export const partnerStatus = (s: string) => PARTNER_STATUS[s] ?? { label: s, tone: "neutral" as Tone };

export const VERIFICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  NOT_VERIFIED: { label: "Chưa thẩm định", tone: "neutral" },
  IN_REVIEW: { label: "Đang xem xét", tone: "info" },
  NEEDS_INFO: { label: "Cần bổ sung hồ sơ", tone: "warning" },
  VERIFIED: { label: "Đã thẩm định", tone: "success" },
  REJECTED: { label: "Đã từ chối thẩm định", tone: "danger" },
};

export const BRANCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_REVIEW: { label: "Đang chờ duyệt", tone: "warning" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Đã từ chối", tone: "danger" },
  SUSPENDED: { label: "Đã tạm khoá", tone: "danger" },
  DRAFT: { label: "Bản nháp", tone: "neutral" },
};

export const PARTNER_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  ...["PROSPECT", "INVITED", "ACTIVE", "SUSPENDED", "TERMINATED"].map((s) => ({ value: s, label: PARTNER_STATUS[s].label })),
];

export const DOC_TYPE_LABEL: Record<string, { label: string; required: boolean }> = {
  BUSINESS_LICENSE: { label: "Giấy phép kinh doanh", required: true },
  REPRESENTATIVE_ID: { label: "CCCD người đại diện", required: true },
  PREMISES_PROOF: { label: "Giấy tờ mặt bằng", required: true },
  TAX_CODE_CERTIFICATE: { label: "Mã số thuế", required: false },
  SITE_PHOTOS: { label: "Ảnh thực địa", required: false },
  FIRE_SAFETY_CERTIFICATE: { label: "Giấy chứng nhận PCCC", required: false },
};

export const PARTNER_DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  VERIFIED: { label: "Đã xác minh", tone: "success" },
  REJECTED: { label: "Bị từ chối", tone: "danger" },
  RECEIVED: { label: "Đã nộp", tone: "info" },
  PENDING: { label: "Chưa nộp", tone: "neutral" },
};

export const CONTACT_CHANNELS: { value: string; label: string }[] = [
  { value: "EMAIL", label: "Email" },
  { value: "CALL", label: "Điện thoại" },
  { value: "MEETING", label: "Gặp mặt" },
  { value: "OTHER", label: "Khác" },
];
export const channelLabel = (c: string) => CONTACT_CHANNELS.find((x) => x.value === c)?.label ?? c;

/**
 * Every value of gym-service `PartnerAuditAction`. Web's map stops at VIEWED_AS_PARTNER, so the
 * self-service application events (approve, request changes, document accepted…) print as raw codes
 * there; here each one has a Vietnamese label.
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  PARTNER_CREATED: "Tạo hồ sơ đối tác",
  PARTNER_UPDATED: "Cập nhật hồ sơ",
  ACCOUNT_PROVISIONED: "Cấp tài khoản",
  INVITATION_RESENT: "Gửi lại thư mời",
  INVITATION_REVOKED: "Thu hồi thư mời",
  PASSWORD_RESET_SENT: "Phát hành link đặt lại mật khẩu",
  SESSIONS_REVOKED: "Buộc đăng xuất",
  ACCOUNT_REVOKED: "Thu hồi tài khoản",
  OWNERSHIP_TRANSFERRED: "Chuyển quyền sở hữu",
  PARTNER_SUSPENDED: "Tạm khoá",
  PARTNER_UNSUSPENDED: "Bỏ tạm khoá",
  PARTNER_TERMINATED: "Chấm dứt hợp tác",
  VIEWED_AS_PARTNER: "Xem dưới góc nhìn đối tác",
  APPLICATION_SUBMITTED: "Nộp hồ sơ",
  CHANGES_REQUESTED: "Yêu cầu chỉnh sửa hồ sơ",
  ISSUE_MARKED_UPDATED: "Đối tác báo đã sửa một mục",
  APPLICATION_RESUBMITTED: "Nộp lại hồ sơ",
  ISSUE_RESOLVED: "Đóng một mục cần sửa",
  DOCUMENT_UPLOADED: "Tải giấy tờ lên",
  DOCUMENT_REPLACED: "Thay giấy tờ",
  DOCUMENT_ACCEPTED: "Chấp nhận giấy tờ",
  DOCUMENT_UPDATE_REQUESTED: "Yêu cầu cập nhật giấy tờ",
  APPLICATION_APPROVED: "Duyệt hồ sơ",
  APPLICATION_REJECTED: "Từ chối hồ sơ",
  APPLICATION_REOPENED: "Mở lại hồ sơ",
  DOCUMENT_VIEWED: "Xem giấy tờ",
};
export const auditLabel = (a: string) => AUDIT_ACTION_LABEL[a] ?? a;

// ── Rows ──────────────────────────────────────────────────────────────────────────────────

export type PartnerAccount = {
  id: string;
  userId: string;
  role: "OWNER" | "MANAGER" | string;
  status: string;
  scopedGymIds?: string[];
  contactPhone?: string | null;
  revokedAt?: string | null;
};
export type AdminPartner = Record<string, any> & {
  id: string;
  legalName: string;
  status: string;
  source?: string;
  contactEmail?: string | null;
  accounts?: PartnerAccount[];
};
export type Identity = { accountId: string; id: string; email: string; firstName?: string | null; lastName?: string | null };

export const partnerRows = (raw: unknown) => list<AdminPartner>(raw);

/** Web's search: legal name, contact email or tax code, case-insensitive. */
export function searchPartners(rows: AdminPartner[], q: string): AdminPartner[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(
    (p) => p.legalName?.toLowerCase().includes(s) || p.contactEmail?.toLowerCase().includes(s) || p.taxCode?.toLowerCase().includes(s),
  );
}

/** A self-registered partner still being vetted is opened in the application review, not here (web does the same). */
export const opensApplication = (p: AdminPartner) => p.source === "SELF_SERVICE" && p.status === "PROSPECT";

/**
 * gym-service `blockSelfServicePartner` answers 409 SELF_SERVICE_APPLICATION to the legacy admin edits
 * (edit profile, typed-URL documents + verify, verification status, reject / reopen) for a
 * self-registered partner — its one lifecycle is the application review. Web still shows those
 * controls and they fail; here they are hidden for such a partner.
 */
export const legacyEditsBlocked = (p: AdminPartner) => p.source === "SELF_SERVICE";

/** "Cần bạn xử lý" — web's four queue lines, only those with work in them. */
export function queueItems(raw: unknown): { key: string; count: number; label: string; filter: string | null }[] {
  const q = (raw as any)?.data ?? raw;
  if (!q || typeof q !== "object") return [];
  return [
    { key: "pendingProspects", count: Number(q.pendingProspects) || 0, label: "Hồ sơ chờ thẩm định", filter: "PROSPECT" },
    { key: "pendingGyms", count: Number(q.pendingGyms) || 0, label: "Chi nhánh chờ duyệt", filter: null },
    { key: "pendingBrandRenames", count: Number(q.pendingBrandRenames) || 0, label: "Tên thương hiệu chờ duyệt", filter: null },
    { key: "expiringDocs", count: Number(q.expiringDocs) || 0, label: "Giấy phép sắp hết hạn", filter: null },
  ].filter((i) => i.count > 0);
}

export function relativeOrAbsolute(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days === 0) return "hôm nay";
  if (days > 0 && days < 14) return `${days} ngày trước`;
  return d.toLocaleDateString("vi-VN");
}

/** Second line of a list card: account count and how long the partner has been with us. */
export function partnerCardMeta(p: AdminPartner, now: number = Date.now()): string {
  const accounts = p.accounts ?? [];
  const managers = accounts.filter((a) => a.role === "MANAGER" && a.status === "ACTIVE").length;
  const owner = accounts.find((a) => a.role === "OWNER" && a.status === "ACTIVE");
  const parts: string[] = [];
  if (managers > 0) parts.push(`${managers + 1} tài khoản`);
  if (p.status === "INVITED") parts.push(`mời ${relativeOrAbsolute(p.createdAt, now)}`);
  if (p.status === "ACTIVE" && owner) parts.push(`đối tác từ ${relativeOrAbsolute(p.createdAt, now)}`);
  return parts.join(" · ");
}

export function identityName(identity: Identity | undefined, fallback: string): string {
  if (!identity) return fallback;
  return `${identity.firstName ?? ""} ${identity.lastName ?? ""}`.trim() || identity.email;
}

/** Which actions the detail menu offers, from web's own conditions. */
export function partnerActions(status: string): { viewAs: boolean; suspend: boolean; unsuspend: boolean; terminate: boolean } {
  return {
    viewAs: status === "ACTIVE" || status === "SUSPENDED",
    suspend: status === "ACTIVE",
    unsuspend: status === "SUSPENDED",
    terminate: status !== "TERMINATED" && status !== "PROSPECT",
  };
}

/** Accounts split as web shows them, plus which ones may be revoked (never the last active owner). */
export function accountGroups(accounts: PartnerAccount[] | undefined) {
  const all = accounts ?? [];
  const active = all.filter((a) => a.status !== "REVOKED");
  const revoked = all.filter((a) => a.status === "REVOKED");
  const owners = active.filter((a) => a.role === "OWNER").length;
  const canRevoke = (a: PartnerAccount) => a.role === "MANAGER" || owners > 1;
  return { active, revoked, canRevoke };
}

export const pendingInvitations = (invitations: unknown) =>
  list<{ id: string; email: string; role: string; status: string; createdAt: string }>(invitations).filter((i) => i.status === "PENDING");

export const isOldInvitation = (createdAt: string, now: number = Date.now()) => now - new Date(createdAt).getTime() > 7 * 86_400_000;

// ── Edit form ─────────────────────────────────────────────────────────────────────────────

export type PartnerForm = {
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  taxCode: string;
  businessLicenseNo: string;
  /** Percent as typed (e.g. "8"), stored as a 0–1 fraction. */
  commissionPercent: string;
  expectedBranchCount: string;
  negotiationNotes: string;
};

export function partnerForm(p: AdminPartner): PartnerForm {
  return {
    legalName: p.legalName ?? "",
    contactEmail: p.contactEmail ?? "",
    contactPhone: p.contactPhone ?? "",
    taxCode: p.taxCode ?? "",
    businessLicenseNo: p.businessLicenseNo ?? "",
    commissionPercent: p.commissionRateOverride != null ? String(Math.round(Number(p.commissionRateOverride) * 10000) / 100) : "",
    expectedBranchCount: p.expectedBranchCount != null ? String(p.expectedBranchCount) : "",
    negotiationNotes: p.negotiationNotes ?? "",
  };
}

/**
 * Web takes the override as a raw 0–1 fraction in a free text box ("Chiết khấu riêng (0-1)"), so
 * typing "8" meaning 8 % would store 800 %. The form here asks for a percent and converts.
 */
export function partnerFormError(f: PartnerForm): string | null {
  if (!f.legalName.trim()) return "Nhập tên pháp lý";
  if (!/^\S+@\S+\.\S+$/.test(f.contactEmail.trim())) return "Email liên hệ không hợp lệ";
  if (f.commissionPercent.trim()) {
    const n = Number(f.commissionPercent.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) return "Chiết khấu riêng phải từ 0 đến 100%";
  }
  if (f.expectedBranchCount.trim() && !/^\d+$/.test(f.expectedBranchCount.trim())) return "Số chi nhánh dự kiến phải là số nguyên";
  return null;
}

export function partnerFormPayload(f: PartnerForm) {
  const pct = f.commissionPercent.trim() ? Number(f.commissionPercent.replace(",", ".")) : null;
  return {
    legalName: f.legalName.trim(),
    contactEmail: f.contactEmail.trim(),
    contactPhone: f.contactPhone.trim() || null,
    taxCode: f.taxCode.trim() || null,
    businessLicenseNo: f.businessLicenseNo.trim() || null,
    commissionRateOverride: pct == null ? null : Math.round(pct * 100) / 10000,
    expectedBranchCount: f.expectedBranchCount.trim() ? Number(f.expectedBranchCount.trim()) : null,
    negotiationNotes: f.negotiationNotes.trim() || null,
  };
}

export const percentLabel = (fraction: unknown) =>
  fraction == null || fraction === "" || !Number.isFinite(Number(fraction)) ? null : `${Math.round(Number(fraction) * 1000) / 10}%`;

// ── Termination ───────────────────────────────────────────────────────────────────────────

export type TerminationImpact = {
  activeGyms: number;
  totalGyms: number;
  activeMembers: number;
  unusedValueTotal: number;
  activePtContracts: number;
  walletBalanceTotal: number;
};
export function terminationImpact(raw: unknown): TerminationImpact | null {
  const d = (raw as any)?.data ?? raw;
  if (!d || typeof d !== "object" || !("activeGyms" in d)) return null;
  const n = (k: string) => Number((d as any)[k]) || 0;
  return {
    activeGyms: n("activeGyms"),
    totalGyms: n("totalGyms"),
    activeMembers: n("activeMembers"),
    unusedValueTotal: n("unusedValueTotal"),
    activePtContracts: n("activePtContracts"),
    walletBalanceTotal: n("walletBalanceTotal"),
  };
}

export type MemberPolicy = "SERVE_UNTIL_EXPIRY" | "PRORATED_REFUND";
export const MEMBER_POLICIES: { value: MemberPolicy; label: string }[] = [
  { value: "SERVE_UNTIL_EXPIRY", label: "Phục vụ tới hết hạn, ngừng bán mới ngay" },
  { value: "PRORATED_REFUND", label: "Hoàn tiền theo tỷ lệ phần chưa dùng cho từng hội viên" },
];

/** web SuspendDialog — what suspension stops and what keeps running. */
export const SUSPEND_CONSEQUENCES = {
  stops: ["Chủ sở hữu không đăng nhập được", "Ngừng bán gói hội viên mới", "Ngừng gia hạn gói sắp hết hạn", "Đóng băng rút tiền", "Ẩn khỏi trang tìm kiếm"],
  continues: ["Hội viên còn hạn dùng tới hết hạn", "Check-in bình thường", "Tài khoản quản lý vẫn hoạt động", "Doanh thu vẫn được ghi nhận"],
};

/** Toast after terminate: how many members were refunded and how many refunds failed (need manual work). */
export function terminateResultMessage(raw: unknown): { ok: string; failed: string | null } {
  const d = (raw as any)?.data ?? raw ?? {};
  const refunded = Number(d.refunded) || 0;
  const errors = Array.isArray(d.refundErrors) ? d.refundErrors.length : 0;
  return {
    ok: `Đã chấm dứt hợp tác${refunded > 0 ? ` — đã hoàn tiền ${refunded} hội viên` : ""}`,
    failed: errors > 0 ? `${errors} hội viên hoàn tiền thất bại — cần xử lý tay` : null,
  };
}

// ── Finance ───────────────────────────────────────────────────────────────────────────────

export type GroupBy = "day" | "week" | "month" | "quarter";
export const GROUP_LABEL: Record<GroupBy, string> = { day: "Ngày", week: "Tuần", month: "Tháng", quarter: "Quý" };
/** Web's default span per grouping — enough buckets to see a trend without crowding the chart. */
export const DEFAULT_SPAN_DAYS: Record<GroupBy, number> = { day: 30, week: 12 * 7, month: 12 * 30, quarter: 8 * 91 };

/** `from`/`to` for `GET /admin/payments/finance-overview`, as web sends them: `to` covers the whole last day. */
export function financeRange(groupBy: GroupBy, now: Date = new Date()) {
  const toDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fromDay = new Date(toDay.getTime() - DEFAULT_SPAN_DAYS[groupBy] * 86_400_000);
  return { from: fromDay.toISOString(), to: new Date(toDay.getTime() + 86_400_000).toISOString(), fromDay, toDay };
}

export function bucketLabel(period: string, groupBy: GroupBy): string {
  const d = new Date(period);
  if (groupBy === "day") return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  if (groupBy === "week") return `Tuần ${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}`;
  if (groupBy === "month") return d.toLocaleDateString("vi-VN", { month: "2-digit", year: "numeric" });
  return `Q${Math.floor(d.getMonth() / 3) + 1}/${d.getFullYear()}`;
}

/** "12tr" / "850k" — the chart's short axis labels; the rows keep the full VND figure. */
export function compactVND(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}tr`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

export type FinanceBucket = { period: string; income: number; expense: number; netRevenue: number; transactionCount: number };
export type FinanceReport = { buckets: FinanceBucket[]; totals: Omit<FinanceBucket, "period"> };

/** payment-service sends Decimal columns as strings ("18400000.00"). */
export function financeReport(raw: unknown): FinanceReport | null {
  const d = (raw as any)?.data ?? raw;
  if (!d || !Array.isArray(d.buckets) || !d.totals) return null;
  const row = (b: any) => ({
    income: Number(b.income) || 0,
    expense: Number(b.expense) || 0,
    netRevenue: Number(b.netRevenue) || 0,
    transactionCount: Number(b.transactionCount) || 0,
  });
  return { buckets: d.buckets.map((b: any) => ({ period: String(b.period), ...row(b) })), totals: row(d.totals) };
}

export type Reconciliation = {
  escrow: number;
  claims: number;
  drift: number;
  balanced: boolean;
  breakdown: Record<
    "clientBalances" | "ptPending" | "ptAvailable" | "ptLocked" | "gymPending" | "gymAvailable" | "gymLocked" | "platformRevenuePending" | "platformRevenueAvailable",
    number
  >;
  negativeWallets: { id: string; ownerType: string; ownerId: string; available: number; pending: number }[];
};

const OWNER_TYPE_LABEL: Record<string, string> = { CLIENT: "Khách", PT: "Huấn luyện viên", GYM: "Phòng gym", PLATFORM: "Nền tảng" };
export const ownerTypeLabel = (t: string) => OWNER_TYPE_LABEL[t] ?? t;

export function reconciliation(raw: unknown): Reconciliation | null {
  const d = (raw as any)?.data ?? raw;
  if (!d || typeof d !== "object" || !("escrow" in d)) return null;
  const b = d.breakdown ?? {};
  const keys = ["clientBalances", "ptPending", "ptAvailable", "ptLocked", "gymPending", "gymAvailable", "gymLocked", "platformRevenuePending", "platformRevenueAvailable"] as const;
  return {
    escrow: Number(d.escrow) || 0,
    claims: Number(d.claims) || 0,
    drift: Number(d.drift) || 0,
    balanced: d.balanced === true,
    breakdown: Object.fromEntries(keys.map((k) => [k, Number(b[k]) || 0])) as Reconciliation["breakdown"],
    negativeWallets: (Array.isArray(d.negativeWallets) ? d.negativeWallets : []).map((w: any) => ({
      id: String(w.id),
      ownerType: String(w.ownerType),
      ownerId: String(w.ownerId),
      available: Number(w.available) || 0,
      pending: Number(w.pending) || 0,
    })),
  };
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const toYmd = ymd;

/**
 * A custom range typed as YYYY-MM-DD (web's two date inputs: from ≤ to ≤ today). Returns the query
 * window — `to` is the start of the day AFTER the last chosen day, so that whole day is included —
 * or an error to show.
 */
export function customFinanceRange(fromText: string, toText: string, now: Date = new Date()): { from: string; to: string } | { error: string } {
  const parse = (t: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.trim())) return null;
    const d = new Date(`${t.trim()}T00:00:00`);
    return Number.isNaN(d.getTime()) || ymd(d) !== t.trim() ? null : d;
  };
  const from = parse(fromText);
  const to = parse(toText);
  if (!from || !to) return { error: "Ngày theo dạng YYYY-MM-DD" };
  if (from > to) return { error: "Ngày bắt đầu phải trước ngày kết thúc" };
  if (ymd(to) > ymd(now)) return { error: "Ngày kết thúc không được sau hôm nay" };
  return { from: from.toISOString(), to: new Date(to.getTime() + 86_400_000).toISOString() };
}

/**
 * Chip labels: no break at spaces. At some densities Android measures a label a hair narrower than it
 * draws and wraps "Tổng quan" to "Tổng" + a clipped line (same fix as Badge / Segmented).
 */
export const nb = (label: string) => label.replace(/ /g, "\u00A0");

