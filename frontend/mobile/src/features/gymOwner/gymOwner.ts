/**
 * Phase 12 — pure parts of the Gym Owner workspace.
 *
 * ONE INVARIANT ABOVE ALL (plan §Phase 12, enforced in gym-service at two levels):
 *
 *     1 TÀI KHOẢN GYM OWNER = ĐÚNG 1 THƯƠNG HIỆU = NHIỀU CHI NHÁNH
 *
 * `GymBrand` carries `@@unique([ownerId])` at the DB level, and `gym.service.ts createGym`
 * resolves the brand from ownership while deliberately IGNORING any `brandId` in the request body.
 * So nothing in this module — and nothing in the screens built on it — may offer a second brand, a
 * brand picker when creating a branch, or a free `brandId` field. The brand is read, never chosen.
 */
import type { PartnerAccessState } from "../../services/api";
import { canRespondAs, collabStatusFor, type CollabRow } from "../collaboration/collaboration";
export { withdrawableCeiling } from "../wallet/wallet";

// ── Access state: who may see the operational workspace ────────────────────────────────────

/**
 * The five applicant states web lists in `APPLICANT_STATES`. Someone in one of these has a
 * partner record but has not been approved, so every operational screen must stay closed — the
 * server refuses them anyway (403/409 from the positive gate), and showing the UI first would
 * just be a lie followed by an error.
 */
export const APPLICANT_STATES: PartnerAccessState[] = [
  "SETUP_INCOMPLETE",
  "ONBOARDING",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "REJECTED",
];

/** Full operational access: only these two, and only ACTIVE has finished the payout step. */
export function canOperate(state: PartnerAccessState | null | undefined): boolean {
  return state === "ACTIVE" || state === "LEGACY";
}

export function isApplicant(state: PartnerAccessState | null | undefined): boolean {
  return !!state && APPLICANT_STATES.includes(state);
}

export type OwnerLanding = "operational" | "payout" | "application" | "blocked";

/**
 * Where a gym owner belongs right now. Mirrors web's `RootRedirect` + `RequireApprovedPartner`:
 * an applicant goes to the application screens, a just-approved owner finishes payout first, a
 * suspended/terminated/restricted partner gets a plain explanation rather than a broken dashboard.
 *
 * `switch` is exhaustive on purpose — a new `AccessState` value becomes a compile error here
 * instead of silently falling into "operational".
 */
export function ownerLanding(state: PartnerAccessState | null | undefined): OwnerLanding {
  switch (state) {
    case "ACTIVE":
    case "LEGACY":
      return "operational";
    case "APPROVED_PAYOUT_PENDING":
      return "payout";
    case "SETUP_INCOMPLETE":
    case "ONBOARDING":
    case "UNDER_REVIEW":
    case "CHANGES_REQUESTED":
    case "REJECTED":
      return "application";
    case "SUSPENDED":
    case "TERMINATED":
    case "RESTRICTED":
      return "blocked";
    case null:
    case undefined:
      return "application";
    default: {
      // Unrecognised state = deny, never "probably fine". Keeps the client in step with the
      // server's own positive-allow gate.
      const never: never = state;
      void never;
      return "blocked";
    }
  }
}

export const ACCESS_STATE_TEXT: Record<PartnerAccessState, { title: string; body: string }> = {
  LEGACY: { title: "Đang hoạt động", body: "Tài khoản đối tác cũ — bạn dùng đầy đủ tính năng." },
  ACTIVE: { title: "Đang hoạt động", body: "Hồ sơ đã được duyệt." },
  APPROVED_PAYOUT_PENDING: {
    title: "Đã duyệt — còn bước nhận tiền",
    body: "Hồ sơ của bạn đã được duyệt. Hoàn tất thông tin nhận tiền để bắt đầu vận hành.",
  },
  SETUP_INCOMPLETE: {
    title: "Chưa tạo xong hồ sơ",
    body: "Tài khoản của bạn chưa gắn với hồ sơ đối tác nào. Hãy mở hồ sơ để tiếp tục.",
  },
  ONBOARDING: { title: "Hồ sơ đang soạn", body: "Hoàn tất các bước rồi gửi hồ sơ để Gymini xét duyệt." },
  UNDER_REVIEW: { title: "Đang xét duyệt", body: "Gymini đang xem hồ sơ của bạn. Bạn sẽ nhận thông báo khi có kết quả." },
  CHANGES_REQUESTED: { title: "Cần bổ sung", body: "Gymini yêu cầu chỉnh sửa vài mục. Sửa xong hãy gửi lại hồ sơ." },
  REJECTED: { title: "Hồ sơ bị từ chối", body: "Hồ sơ chưa được chấp nhận. Liên hệ Gymini nếu bạn cần trao đổi thêm." },
  RESTRICTED: { title: "Tài khoản bị hạn chế", body: "Tài khoản đối tác của bạn đang bị hạn chế. Liên hệ Gymini để được hỗ trợ." },
  SUSPENDED: {
    title: "Đang tạm ngưng",
    body: "Phòng gym của bạn đang tạm ngưng: không nhận khoản tiền mới và không hiện trong tìm kiếm. Hội viên đang tập vẫn hoạt động.",
  },
  TERMINATED: { title: "Đã chấm dứt hợp tác", body: "Hợp tác giữa bạn và Gymini đã kết thúc." },
};

export function accessStateText(state: PartnerAccessState | null | undefined) {
  return (
    (state && ACCESS_STATE_TEXT[state]) ?? {
      title: "Chưa xác định được trạng thái",
      body: "Không đọc được trạng thái hồ sơ. Kéo xuống để thử lại.",
    }
  );
}

/**
 * OWNER vs MANAGER, read from `GET /owner/onboarding/status` exactly as web's MyGymsPage does.
 * A MANAGER runs a branch; they never name the brand, rename it, or add a branch to it — those
 * controls are hidden rather than shown and then 403'd (GYM_MANAGEMENT master spec §61).
 */
export function isBrandOwner(onboardingStatus: unknown): boolean {
  return (onboardingStatus as any)?.role !== "MANAGER";
}

// ── Branches ───────────────────────────────────────────────────────────────────────────────

export type OwnedGym = {
  id: string;
  name?: string | null;
  pendingName?: string | null;
  address?: string | null;
  pendingAddress?: string | null;
  status?: string | null;
  operationalStatus?: string | null;
  brandId?: string | null;
  city?: string | null;
  wizardStep?: number | null;
  activeMemberCount?: number | null;
  averageRating?: number | null;
  reviewCount?: number | null;
  changesRequestedAt?: string | null;
  pendingNameNote?: string | null;
  pendingAddressNote?: string | null;
};

export function ownedGyms(raw: unknown): OwnedGym[] {
  const list = Array.isArray(raw) ? raw : ((raw as any)?.gyms ?? (raw as any)?.data ?? []);
  return (Array.isArray(list) ? list : []).filter((g: any) => g?.id);
}

/**
 * A branch under review shows the name/address the owner SUBMITTED (`pendingName`), not the last
 * approved one — otherwise an owner editing a branch sees their own change vanish until an admin
 * gets round to it.
 */
export function branchName(g: OwnedGym): string {
  return (g.pendingName ?? g.name ?? "").trim() || "Chi nhánh chưa đặt tên";
}

export function branchAddress(g: OwnedGym): string {
  const base = (g.pendingAddress ?? g.address ?? "").trim();
  if (!base) return "Chưa có địa chỉ";
  return g.city?.trim() ? `${base}, ${g.city.trim()}` : base;
}

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

/**
 * `GymStatus` — the approval lifecycle of one branch. These five are the whole enum
 * (gym-service schema.prisma `enum GymStatus`); there is no bare `PENDING`.
 */
export const BRANCH_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Bản nháp", tone: "neutral" },
  PENDING_REVIEW: { label: "Chờ duyệt", tone: "warning" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Bị từ chối", tone: "danger" },
  SUSPENDED: { label: "Tạm ngưng", tone: "danger" },
};

export function branchStatus(status: string | null | undefined) {
  return BRANCH_STATUS[status ?? ""] ?? { label: status || "Không rõ", tone: "neutral" as StatusTone };
}

/** `GymOperationalStatus` — whether an approved branch is open for business today. */
export const OPERATIONAL_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  OPEN: { label: "Đang mở cửa", tone: "success" },
  TEMPORARILY_CLOSED: { label: "Tạm đóng cửa", tone: "warning" },
  PERMANENTLY_CLOSED: { label: "Đã đóng vĩnh viễn", tone: "neutral" },
};

export function operationalStatus(status: string | null | undefined) {
  return OPERATIONAL_STATUS[status ?? ""] ?? null;
}

/**
 * Only a branch the public can already see has had a member or a review; a PENDING_REVIEW or
 * REJECTED one would just render a row of zeros, which reads as failure rather than "not yet".
 */
export function showsBranchStats(g: OwnedGym): boolean {
  return g.status === "APPROVED" || g.status === "SUSPENDED";
}

/** Drafts are not branches yet — they get their own section, never mixed into the brand's list. */
export function draftGyms(gyms: OwnedGym[]): OwnedGym[] {
  return gyms.filter((g) => g.status === "DRAFT");
}

export function branchesOfBrand(gyms: OwnedGym[], brandId: string): OwnedGym[] {
  return gyms.filter((g) => g.brandId === brandId && g.status !== "DRAFT");
}

/**
 * Legacy only: a gym could exist outside any brand before the one-brand rule was enforced.
 * Displayed, never created — no screen may offer a brandless branch.
 */
export function standaloneGyms(gyms: OwnedGym[]): OwnedGym[] {
  return gyms.filter((g) => !g.brandId && g.status !== "DRAFT");
}

// ── "Cần chú ý": what the owner must act on, derived from the branch rows already fetched ───

export type AttentionItem = { gymId: string; title: string; detail: string; kind: "review" | "changes" };

/**
 * GYM_MANAGEMENT master spec §61/§66 — the action centre comes before the numbers. Both cases
 * are read off `listOwnedGyms`, so this costs no extra request.
 */
export function attentionItems(gyms: OwnedGym[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const g of gyms) {
    if (g.status === "PENDING_REVIEW") {
      out.push({ gymId: g.id, title: branchName(g), detail: "Đang chờ Gymini xét duyệt lần đầu", kind: "review" });
    }
  }
  for (const g of gyms) {
    if (!g.changesRequestedAt) continue;
    const n = g.pendingNameNote?.trim();
    const a = g.pendingAddressNote?.trim();
    const detail =
      n && a
        ? "Gymini yêu cầu sửa tên và địa chỉ"
        : n
          ? `Gymini yêu cầu sửa tên: “${n}”`
          : a
            ? `Gymini yêu cầu sửa địa chỉ: “${a}”`
            : "Gymini yêu cầu chỉnh sửa chi nhánh này";
    out.push({ gymId: g.id, title: branchName(g), detail, kind: "changes" });
  }
  return out;
}

// ── Dashboard figures ──────────────────────────────────────────────────────────────────────

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function todayCheckinCount(checkins: { createdAt?: string | null }[], now: Date = new Date()): number {
  return checkins.filter((c) => c?.createdAt && sameDay(new Date(c.createdAt), now)).length;
}

/** Seven days ending today, oldest first — the same window web's bar chart uses. */
export function checkinTrend(
  checkins: { createdAt?: string | null }[],
  now: Date = new Date(),
): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push({
      day: d.toLocaleDateString("vi-VN", { weekday: "short" }),
      count: checkins.filter((c) => c?.createdAt && sameDay(new Date(c.createdAt), d)).length,
    });
  }
  return out;
}

/**
 * Membership mix by status. Unlike web's fixed four-key record this keeps whatever statuses the
 * server actually sent — `PENDING_ISSUE` exists in the real enum, and a hard-coded record would
 * silently drop (web) or mis-count it.
 */
export function membershipMix(
  memberships: { status?: string | null }[],
): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of memberships) {
    const s = m?.status ?? "";
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const order = ["ACTIVE", "PENDING_PAYMENT", "PENDING_ISSUE", "EXPIRED", "CANCELLED"];
  return [...counts.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
    })
    .map(([status, count]) => ({ status, count }));
}

export function countByStatus(rows: { status?: string | null }[], status: string): number {
  return rows.filter((r) => r?.status === status).length;
}

/** PTs actually working at THIS branch — a collaboration is per gym, not per brand. */
export function acceptedCollabCount(collabs: { gymId?: string | null; status?: string | null }[], gymId: string) {
  return collabs.filter((c) => c?.gymId === gymId && c?.status === "ACCEPTED").length;
}

/** Offers waiting on the owner's answer — the turn-taking is the same enum Phase 11 mapped. */
export function pendingCollabCount(collabs: { status?: string | null }[]) {
  return collabs.filter((c) => c?.status === "PENDING" || c?.status === "COUNTERED").length;
}

/** Members are anonymous to the owner beyond their id — never invent a name. */
export function memberLabel(clientId: string | null | undefined): string {
  const id = (clientId ?? "").trim();
  return id ? `Khách #${id.slice(0, 8)}` : "Khách";
}

export function recentMemberships<T extends { createdAt?: string | null }>(rows: T[], limit = 6): T[] {
  return [...rows]
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, limit);
}

// ── Brand ──────────────────────────────────────────────────────────────────────────────────

export type OwnedBrand = {
  id: string;
  name?: string | null;
  approvedName?: string | null;
  pendingName?: string | null;
  description?: string | null;
};

export function ownedBrands(raw: unknown): OwnedBrand[] {
  const list = Array.isArray(raw) ? raw : ((raw as any)?.brands ?? (raw as any)?.data ?? []);
  return (Array.isArray(list) ? list : []).filter((b: any) => b?.id);
}

/**
 * The owner's one brand. Returning only the first is not a shortcut: `GymBrand.@@unique([ownerId])`
 * makes a second one impossible, so a list of two would be a data fault, not a case to support
 * with a picker.
 */
export function theBrand(raw: unknown): OwnedBrand | null {
  return ownedBrands(raw)[0] ?? null;
}

/** A branch cannot be created before the brand is named — gym.service.ts throws otherwise. */
export function needsBrandFirst(raw: unknown): boolean {
  return theBrand(raw) === null;
}

/**
 * What the owner sees as their brand name. `approvedName` is the public one and stays put until an
 * admin approves a rename; `name` is the owner's own working value and is what they just typed, so
 * showing `name` while a rename is pending would hide the fact that the change has not landed yet.
 */
export function brandDisplayName(b: OwnedBrand | null): string {
  if (!b) return "Thương hiệu của bạn";
  return (b.approvedName ?? b.name ?? "").trim() || "Thương hiệu chưa đặt tên";
}

/**
 * Non-null only while a rename that would actually CHANGE the public name is waiting.
 *
 * `updateBrand` writes `pendingName` on every save, including one that re-submits the name already
 * approved — so a brand can sit with a pending rename to its own current name. Announcing that as
 * "tên mới đang chờ duyệt" is noise about a change that is not a change.
 */
export function brandPendingName(b: OwnedBrand | null): string | null {
  const p = b?.pendingName?.trim();
  if (!p) return null;
  return p === brandDisplayName(b) ? null : p;
}

export const ABOUT_MAX = 300;

export function brandNameError(name: string): string | null {
  const v = name.trim();
  if (!v) return "Nhập tên thương hiệu.";
  if (v.length < 2) return "Tên thương hiệu quá ngắn.";
  return null;
}

/**
 * The two fields `createGym` requires. Deliberately not a brand field: the server derives the
 * brand from ownership and ignores anything the client sends.
 */
export function branchFormError(f: { name: string; address: string }): string | null {
  if (!f.name.trim()) return "Nhập tên chi nhánh.";
  if (!f.address.trim()) return "Nhập địa chỉ chi nhánh.";
  return null;
}

export type BranchForm = {
  name: string;
  address: string;
  city: string;
  description: string;
  provinceCode: string;
  wardCode: string;
  latitude: number | null;
  longitude: number | null;
};

export const EMPTY_BRANCH_FORM: BranchForm = {
  name: "",
  address: "",
  city: "",
  description: "",
  provinceCode: "",
  wardCode: "",
  latitude: null,
  longitude: null,
};

/** Only the fields the owner actually filled — an empty string is not a value worth sending. */
export function branchPayload(f: BranchForm) {
  return {
    name: f.name.trim(),
    address: f.address.trim(),
    ...(f.city.trim() ? { city: f.city.trim() } : {}),
    ...(f.description.trim() ? { description: f.description.trim().slice(0, ABOUT_MAX) } : {}),
    ...(f.provinceCode ? { provinceCode: Number(f.provinceCode) } : {}),
    ...(f.wardCode ? { wardCode: Number(f.wardCode) } : {}),
    ...(f.latitude != null && f.longitude != null ? { latitude: f.latitude, longitude: f.longitude } : {}),
  };
}

// ── Gói hội viên của THƯƠNG HIỆU (WB-04) ───────────────────────────────────────────────────

export type OwnedPlan = {
  id: string;
  name?: string | null;
  price?: string | number | null;
  durationDays?: number | null;
  visitLimit?: number | null;
  status?: string | null;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
};

export function ownedPlans(raw: unknown): OwnedPlan[] {
  const list = Array.isArray(raw) ? raw : ((raw as any)?.plans ?? (raw as any)?.data ?? []);
  return (Array.isArray(list) ? list : []).filter((p: any) => p?.id);
}

export const PLAN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: "Đang bán", tone: "success" },
  INACTIVE: { label: "Đã ngừng", tone: "neutral" },
};

export function planStatus(status: string | null | undefined) {
  return PLAN_STATUS[status ?? ""] ?? { label: status || "Không rõ", tone: "neutral" as StatusTone };
}

/**
 * Cửa sổ mở bán, theo đúng `isPlanOnSale` của gym-service — nhãn ở đây phải khớp với việc khách có
 * thực sự nhìn thấy gói hay không, nếu không chủ gym sẽ tưởng gói đang bán trong khi trang tìm kiếm
 * đã ẩn nó.
 */
export function saleWindow(
  plan: OwnedPlan,
  now: Date = new Date(),
): { text: string; tone: StatusTone } | null {
  if (!plan.saleStartAt && !plan.saleEndAt) return null;
  const d = (v: string) => new Date(v).toLocaleDateString("vi-VN");
  if (plan.saleStartAt && now < new Date(plan.saleStartAt)) {
    return { text: `Mở bán từ ${d(plan.saleStartAt)}`, tone: "info" };
  }
  if (plan.saleEndAt && now > new Date(plan.saleEndAt)) {
    return { text: "Đã hết hạn bán", tone: "neutral" };
  }
  return { text: plan.saleEndAt ? `Đang mở bán đến ${d(plan.saleEndAt)}` : "Đang mở bán", tone: "success" };
}

/** Số lượt còn lại dùng CHUNG cho mọi chi nhánh — không phải mỗi chi nhánh một hạn mức. */
export function planLimitText(plan: OwnedPlan): string {
  const days = plan.durationDays ?? 0;
  return plan.visitLimit
    ? `${days} ngày · ${plan.visitLimit} lượt (dùng chung mọi chi nhánh)`
    : `${days} ngày · không giới hạn lượt`;
}

export type PlanForm = {
  name: string;
  price: string;
  durationDays: string;
  visitLimit: string;
  saleStartAt: string;
  saleEndAt: string;
};

export const EMPTY_PLAN_FORM: PlanForm = {
  name: "",
  price: "",
  durationDays: "30",
  visitLimit: "",
  saleStartAt: "",
  saleEndAt: "",
};

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function planFormError(f: PlanForm): string | null {
  if (!f.name.trim()) return "Nhập tên gói.";
  const price = Number(f.price);
  if (!f.price.trim() || !Number.isFinite(price) || price <= 0) return "Giá phải là số lớn hơn 0.";
  const days = Number(f.durationDays);
  if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days)) return "Thời hạn phải là số ngày nguyên, lớn hơn 0.";
  if (f.visitLimit.trim()) {
    const v = Number(f.visitLimit);
    if (!Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) return "Giới hạn lượt phải là số nguyên lớn hơn 0.";
  }
  for (const [v, what] of [
    [f.saleStartAt, "bắt đầu"],
    [f.saleEndAt, "kết thúc"],
  ] as const) {
    if (v.trim() && !isIsoDate(v.trim())) return `Ngày ${what} bán phải theo dạng NĂM-THÁNG-NGÀY.`;
  }
  if (f.saleStartAt.trim() && f.saleEndAt.trim() && f.saleEndAt.trim() < f.saleStartAt.trim()) {
    return "Ngày kết thúc bán phải sau ngày bắt đầu.";
  }
  return null;
}

export function planPayload(f: PlanForm) {
  return {
    name: f.name.trim(),
    price: Number(f.price),
    durationDays: Number(f.durationDays),
    ...(f.visitLimit.trim() ? { visitLimit: Number(f.visitLimit) } : {}),
    ...(f.saleStartAt.trim() ? { saleStartAt: f.saleStartAt.trim() } : {}),
    ...(f.saleEndAt.trim() ? { saleEndAt: f.saleEndAt.trim() } : {}),
  };
}

// ── Ví chi nhánh và rút tiền (GY-04) ───────────────────────────────────────────────────────

export type WithdrawalRow = { id: string; amount?: string | number | null; status?: string | null; createdAt?: string | null };

export function withdrawalRows(raw: unknown): WithdrawalRow[] {
  const list = Array.isArray(raw) ? raw : ((raw as any)?.data ?? []);
  return (Array.isArray(list) ? list : []).filter((w: any) => w?.id);
}

/**
 * Money-flow §16: PENDING/APPROVED **không** phải cổng chặn — tiền đã rút được từ lúc tạo yêu cầu.
 * Hai trạng thái này chỉ nghĩa là "vẫn còn một cú chuyển khoản tay mà quản trị viên phải làm".
 * Nhãn dùng chung `withdrawalStatus` của `features/wallet/wallet.ts` — ví huấn luyện viên, ví khách
 * và ví chi nhánh đọc cùng một bảng, không thể lệch nhau.
 */
export function openWithdrawals(rows: WithdrawalRow[]): WithdrawalRow[] {
  return rows.filter((w) => w.status === "PENDING" || w.status === "APPROVED");
}

/** Tài khoản nhận tiền đã lưu ở bước thiết lập đối tác — điền sẵn để chủ gym khỏi gõ lại. */
export function savedPayoutLine(onboardingStatus: unknown): string {
  const p = (onboardingStatus as any)?.payout;
  if (!p?.accountNumber) return "";
  return [p.bankName, p.accountNumber, p.accountHolder].filter(Boolean).join(" — ");
}

// ── Hợp tác với huấn luyện viên, nhìn từ ghế chủ gym (GY-06) ───────────────────────────────

/** Cùng bảng trạng thái với màn của huấn luyện viên, chỉ đổi phía đang nhìn. */
export function gymCollabStatus(row: { status?: string | null; proposedBy?: string | null } | null | undefined) {
  return collabStatusFor(row, "GYM");
}

export function canRespondAsGym(row: { status?: string | null; proposedBy?: string | null } | null | undefined) {
  return canRespondAs(row, "GYM");
}

/** Đề nghị thuộc về một CHI NHÁNH cụ thể, không phải cả thương hiệu. */
export function collabsForGym(rows: CollabRow[], gymId: string): CollabRow[] {
  return rows.filter((c) => c.gymId === gymId);
}

export function collabRows(raw: unknown): CollabRow[] {
  const list = Array.isArray(raw) ? raw : ((raw as any)?.data ?? []);
  return (Array.isArray(list) ? list : []).filter((c: any) => c?.id);
}

/** Xếp việc cần mình trả lời lên trước, rồi tới hợp tác đang chạy, rồi phần đã đóng. */
export function sortCollabsForOwner(rows: CollabRow[]): CollabRow[] {
  const rank = (c: CollabRow) => {
    if (canRespondAsGym(c)) return 0;
    if (c.status === "PENDING" || c.status === "COUNTERED") return 1;
    if (c.status === "ACCEPTED") return 2;
    return 3;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

// ── Thiết lập lần đầu / bước nhận tiền (GY-08) ─────────────────────────────────────────────

export type OnboardingProgress = {
  role?: string | null;
  completed?: boolean | null;
  currentStep?: number | null;
  contactPhone?: string | null;
  steps?: { contact?: boolean | null; brand?: boolean | null; payout?: boolean | null; terms?: boolean | null } | null;
  payout?: { bankName?: string | null; accountNumber?: string | null; accountHolder?: string | null } | null;
};

export type OnboardingStepKey = "contact" | "brand" | "payout" | "terms";

export const ONBOARDING_STEPS: { key: OnboardingStepKey; label: string }[] = [
  { key: "contact", label: "Xác nhận liên hệ" },
  { key: "brand", label: "Đặt tên thương hiệu" },
  { key: "payout", label: "Thông tin nhận tiền" },
  { key: "terms", label: "Điều khoản đối tác" },
];

/**
 * Quản lý chi nhánh chỉ có bước liên hệ: thương hiệu, tài khoản nhận tiền và điều khoản là việc của
 * chủ sở hữu, và `getProgress` cũng chỉ tính bước `contact` là bắt buộc với họ.
 */
export function visibleOnboardingSteps(progress: OnboardingProgress | null | undefined) {
  return progress?.role === "OWNER" ? ONBOARDING_STEPS : ONBOARDING_STEPS.slice(0, 1);
}

/**
 * Bước đang dở LUÔN tính lại từ dữ liệu đã lưu ở máy chủ (`currentStep`), không giữ ở client — đóng
 * app giữa chừng mở lại phải rơi đúng chỗ cũ. `currentStep` đếm từ 1 cho bước đặt mật khẩu (đã xong
 * trước khi màn này tồn tại), nên bước đầu tiên nhìn thấy được là 2.
 */
export function onboardingStepIndex(progress: OnboardingProgress | null | undefined): number {
  const steps = visibleOnboardingSteps(progress);
  const raw = Number(progress?.currentStep ?? 2) - 2;
  return Math.max(0, Math.min(steps.length - 1, Number.isFinite(raw) ? raw : 0));
}

export function onboardingDone(progress: OnboardingProgress | null | undefined): boolean {
  return progress?.completed === true;
}

/** Cùng biểu thức web dùng — chấp nhận dấu cách, chấm, gạch và tiền tố +. */
export function phoneError(phone: string): string | null {
  const v = phone.trim();
  if (!v) return "Nhập số điện thoại liên hệ.";
  if (!/^\+?[0-9 .-]{8,20}$/.test(v)) return "Số điện thoại không hợp lệ.";
  return null;
}

export type PayoutForm = { bankName: string; accountNumber: string; accountHolder: string };
export const EMPTY_PAYOUT: PayoutForm = { bankName: "", accountNumber: "", accountHolder: "" };

export function payoutError(f: PayoutForm): string | null {
  if (!f.bankName.trim()) return "Nhập tên ngân hàng.";
  if (!f.accountNumber.trim()) return "Nhập số tài khoản.";
  if (!f.accountHolder.trim()) return "Nhập tên chủ tài khoản.";
  return null;
}

export function payoutFrom(progress: OnboardingProgress | null | undefined): PayoutForm {
  return {
    bankName: progress?.payout?.bankName ?? "",
    accountNumber: progress?.payout?.accountNumber ?? "",
    accountHolder: progress?.payout?.accountHolder ?? "",
  };
}

export function payoutDirty(form: PayoutForm, progress: OnboardingProgress | null | undefined): boolean {
  const saved = payoutFrom(progress);
  return (
    form.bankName.trim() !== saved.bankName ||
    form.accountNumber.trim() !== saved.accountNumber ||
    form.accountHolder.trim() !== saved.accountHolder
  );
}

// ── Quản lý chi nhánh (GY-05) ──────────────────────────────────────────────────────────────

export type PartnerAccountRow = {
  id: string;
  role?: string | null;
  status?: string | null;
  scopedGymIds?: string[] | null;
  identity?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
};

export type PartnerInvitationRow = {
  id: string;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  createdAt?: string | null;
};

const rowsOf = (raw: unknown): any[] => {
  const list = Array.isArray(raw) ? raw : ((raw as any)?.data ?? []);
  return Array.isArray(list) ? list : [];
};

/** Chỉ quản lý chi nhánh đang hoạt động — chủ sở hữu không tự liệt kê mình vào danh sách này. */
export function activeManagers(raw: unknown): PartnerAccountRow[] {
  return rowsOf(raw).filter((a) => a?.id && a.role === "MANAGER" && a.status === "ACTIVE");
}

export function pendingManagerInvites(raw: unknown): PartnerInvitationRow[] {
  return rowsOf(raw).filter((i) => i?.id && i.role === "MANAGER" && i.status === "PENDING");
}

export function managerName(a: PartnerAccountRow): string {
  const name = [a.identity?.firstName, a.identity?.lastName].filter(Boolean).join(" ").trim();
  return name || a.identity?.email || "Người quản lý";
}

/**
 * Quản lý được gán theo TỪNG chi nhánh. Không gán chi nhánh nào thì nói thẳng "chưa gán" — để trống
 * dễ bị đọc nhầm thành "quản lý tất cả", trong khi thực tế họ không vận hành được gì.
 */
export function managerScopeLabel(a: PartnerAccountRow, gyms: OwnedGym[]): string {
  const ids = a.scopedGymIds ?? [];
  if (ids.length === 0) return "Chưa gán chi nhánh";
  return ids.map((id) => gyms.find((g) => g.id === id)).map((g, i) => (g ? branchName(g) : `Chi nhánh ${ids[i].slice(0, 6)}`)).join(", ");
}

export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** Web gọi một lời mời quá 7 ngày chưa nhận là đáng chú ý — giữ đúng ngưỡng đó. */
export const STALE_INVITE_DAYS = 7;

export function inviteIsStale(inv: PartnerInvitationRow, now: Date = new Date()): boolean {
  const d = daysSince(inv.createdAt, now);
  return d != null && d > STALE_INVITE_DAYS;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function inviteManagerError(email: string, scopedGymIds: string[]): string | null {
  if (!email.trim()) return "Nhập email người quản lý.";
  if (!EMAIL_RE.test(email.trim())) return "Email không hợp lệ.";
  if (scopedGymIds.length === 0) return "Chọn ít nhất một chi nhánh để họ quản lý.";
  return null;
}

// ── Hồ sơ chủ gym (WB-18) ──────────────────────────────────────────────────────────────────

export type SocialKey = "facebookUrl" | "instagramUrl" | "tiktokUrl" | "youtubeUrl";

export const SOCIAL_FIELDS: { key: SocialKey; label: string; placeholder: string }[] = [
  { key: "facebookUrl", label: "Facebook", placeholder: "https://facebook.com/ten-trang" },
  { key: "instagramUrl", label: "Instagram", placeholder: "https://instagram.com/ten-tai-khoan" },
  { key: "tiktokUrl", label: "TikTok", placeholder: "https://tiktok.com/@ten-tai-khoan" },
  { key: "youtubeUrl", label: "YouTube", placeholder: "https://youtube.com/@ten-kenh" },
];

/** Đúng danh sách tên miền `SOCIAL_HOSTS` của gym-service, kể cả `youtu.be`. */
const SOCIAL_HOSTS: Record<SocialKey, string[]> = {
  facebookUrl: ["facebook.com", "fb.com"],
  instagramUrl: ["instagram.com"],
  tiktokUrl: ["tiktok.com"],
  youtubeUrl: ["youtube.com", "youtu.be"],
};

/**
 * Kiểm cùng luật với `socialUrl` của gym-service: bắt buộc https, và tên miền phải đúng của mạng đó
 * (bỏ tiền tố www/m/vm/vt). Để trống là hợp lệ — nghĩa là không có trang.
 */
export function socialUrlError(key: SocialKey, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > 300) return "Link quá dài.";
  const label = SOCIAL_FIELDS.find((f) => f.key === key)?.label ?? "mạng xã hội";
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase().replace(/^(www|m|vm|vt)\./, "");
    const ok = u.protocol === "https:" && SOCIAL_HOSTS[key].some((h) => host === h || host.endsWith(`.${h}`));
    return ok ? null : `Link ${label} không hợp lệ — dán đường dẫn https://… tới trang ${label} của bạn.`;
  } catch {
    return `Link ${label} không hợp lệ — dán đường dẫn https://… tới trang ${label} của bạn.`;
  }
}

export type BrandProfileForm = { name: string; description: string } & Record<SocialKey, string>;

export const EMPTY_BRAND_PROFILE: BrandProfileForm = {
  name: "",
  description: "",
  facebookUrl: "",
  instagramUrl: "",
  tiktokUrl: "",
  youtubeUrl: "",
};

export function brandProfileFrom(b: (OwnedBrand & Partial<Record<SocialKey, string | null>>) | null): BrandProfileForm {
  if (!b) return EMPTY_BRAND_PROFILE;
  return {
    // Ô nhập mồi bằng tên ĐANG CHỜ nếu có: đó là điều chủ gym vừa gõ lần trước, không phải tên cũ.
    name: (b.pendingName ?? b.approvedName ?? b.name ?? "").trim(),
    description: b.description ?? "",
    facebookUrl: b.facebookUrl ?? "",
    instagramUrl: b.instagramUrl ?? "",
    tiktokUrl: b.tiktokUrl ?? "",
    youtubeUrl: b.youtubeUrl ?? "",
  };
}

export function brandProfileError(f: BrandProfileForm): string | null {
  const nameErr = brandNameError(f.name);
  if (nameErr) return nameErr;
  if (f.description.length > ABOUT_MAX) return `Giới thiệu tối đa ${ABOUT_MAX} ký tự.`;
  for (const s of SOCIAL_FIELDS) {
    const e = socialUrlError(s.key, f[s.key]);
    if (e) return e;
  }
  return null;
}

/**
 * Chỉ gửi `name` khi tên THẬT SỰ đổi: gửi tên là tạo một yêu cầu đổi tên chờ admin duyệt, nên lưu
 * mạng xã hội thôi mà kèm tên cũ sẽ đẻ ra một `pendingName` vô nghĩa (đúng cái bẫy đã gặp ở §28.8).
 */
export function brandProfilePayload(
  f: BrandProfileForm,
  current: (OwnedBrand & Partial<Record<SocialKey, string | null>>) | null,
) {
  const saved = brandProfileFrom(current);
  const nameChanged = f.name.trim() !== saved.name;
  return {
    ...(nameChanged ? { name: f.name.trim() } : {}),
    description: f.description.trim(),
    ...Object.fromEntries(SOCIAL_FIELDS.map((s) => [s.key, f[s.key].trim()])),
  } as Record<string, string>;
}

export const PASSWORD_MIN = 8;

export function passwordChangeError(current: string, next: string, confirm: string): string | null {
  if (!current) return "Nhập mật khẩu hiện tại.";
  if (next.length < PASSWORD_MIN) return `Mật khẩu mới tối thiểu ${PASSWORD_MIN} ký tự.`;
  if (next !== confirm) return "Hai ô mật khẩu mới chưa khớp.";
  if (next === current) return "Mật khẩu mới phải khác mật khẩu hiện tại.";
  return null;
}
