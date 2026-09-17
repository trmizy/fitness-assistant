/**
 * CL-09's pure parts: the gym directory, a brand's membership plans, and what the client already
 * holds.
 *
 * The rules here are the ones `02-luong-hoi-vien-phong-gym.md` and gym-service agree on, and they
 * are not presentation choices:
 *
 *  - a gym has TWO independent status axes — approval (`status`) and operation
 *    (`operationalStatus`). Both must pass before anything may be sold, and the webhook re-checks
 *    them again at activation (a gym that closes mid-checkout lands the membership in
 *    PENDING_ISSUE). A screen that reads only one axis will happily sell a membership at a gym
 *    that is closed;
 *  - plans belong to the BRAND, not the branch — the one-owner-one-brand invariant. Buying is still
 *    done at a branch, which is why the purchase call takes both;
 *  - a plan is only purchasable while ACTIVE **and** inside its sale window; both dates null (the
 *    common case) means always on sale.
 */

export type GymRow = {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  city: string | null;
  address: string | null;
  description: string | null;
  facilities: string[];
  rating: number | null;
  reviewCount: number;
  fromPrice: number | null;
  status: string;
  operationalStatus: string;
  closureReason: string | null;
  expectedReopenAt: string | null;
  phone: string | null;
};

function text(value: any): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeGym(raw: any): GymRow {
  return {
    id: String(raw?.id ?? ""),
    brandId: String(raw?.brandId ?? raw?.brand?.id ?? ""),
    // `approvedName` is what the public may see; `name` can hold an edit still awaiting approval.
    brandName: String(raw?.brand?.approvedName ?? raw?.brand?.name ?? "Thương hiệu"),
    name: String(raw?.approvedName ?? raw?.name ?? "Phòng gym"),
    city: text(raw?.city),
    address: text(raw?.approvedAddress ?? raw?.address),
    description: text(raw?.description),
    facilities: Array.isArray(raw?.facilities) ? raw.facilities.map((f: any) => String(f)) : [],
    rating: typeof raw?.averageRating === "number" && raw.averageRating > 0 ? raw.averageRating : null,
    reviewCount: Number(raw?.reviewCount) || 0,
    fromPrice: raw?.fromPrice != null ? Number(raw.fromPrice) : null,
    status: String(raw?.status ?? ""),
    operationalStatus: String(raw?.operationalStatus ?? ""),
    closureReason: text(raw?.closureReason),
    expectedReopenAt: raw?.expectedReopenAt ?? null,
    phone: text(raw?.phone),
  };
}

export function normalizeGyms(raw: any): GymRow[] {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list.map(normalizeGym).filter((gym: GymRow) => gym.id);
}

/** Both axes, in the user's words. `null` means the gym is open for business. */
export function gymBlockedReason(gym: GymRow): string | null {
  if (gym.status !== "APPROVED") return "Phòng gym này chưa được duyệt.";
  if (gym.operationalStatus === "TEMPORARILY_CLOSED") {
    return gym.closureReason
      ? `Đang tạm đóng cửa: ${gym.closureReason}`
      : "Phòng gym đang tạm đóng cửa.";
  }
  if (gym.operationalStatus === "PERMANENTLY_CLOSED") return "Phòng gym đã đóng cửa vĩnh viễn.";
  if (gym.operationalStatus !== "OPEN") return "Phòng gym hiện không nhận hội viên mới.";
  return null;
}

export type BrandGroup = { brandId: string; brandName: string; branches: GymRow[] };

/**
 * The design groups branches under their brand — which is also the truth of the data model, not a
 * layout flourish: one owner, one brand, many branches.
 */
export function groupByBrand(gyms: GymRow[]): BrandGroup[] {
  const groups = new Map<string, BrandGroup>();
  for (const gym of gyms) {
    const key = gym.brandId || gym.brandName;
    const existing = groups.get(key);
    if (existing) existing.branches.push(gym);
    else groups.set(key, { brandId: gym.brandId, brandName: gym.brandName, branches: [gym] });
  }
  return [...groups.values()].sort((a, b) => a.brandName.localeCompare(b.brandName, "vi"));
}

/** Name, brand or city — the three things someone types when looking for a gym. */
export function searchGyms(gyms: GymRow[], query: string): GymRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return gyms;
  return gyms.filter((gym) =>
    [gym.name, gym.brandName, gym.city ?? ""].some((field) => field.toLowerCase().includes(q)),
  );
}

export type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationDays: number;
  visitLimit: number | null;
  status: string;
  saleStartAt: string | null;
  saleEndAt: string | null;
};

export function normalizePlan(raw: any): PlanRow {
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? "Gói hội viên"),
    description: text(raw?.description),
    // The API sends a Decimal as a STRING ("300000"); Number() here, never string concatenation.
    price: Number(raw?.price) || 0,
    durationDays: Number(raw?.durationDays) || 0,
    visitLimit: raw?.visitLimit != null ? Number(raw.visitLimit) : null,
    status: String(raw?.status ?? ""),
    saleStartAt: raw?.saleStartAt ?? null,
    saleEndAt: raw?.saleEndAt ?? null,
  };
}

export function normalizePlans(raw: any): PlanRow[] {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list.map(normalizePlan).filter((plan: PlanRow) => plan.id);
}

/**
 * On sale right now? The sale window is about BUYING, not about how long a membership lasts — a
 * window closing never shortens a membership already sold.
 */
export function planOnSale(plan: PlanRow, now: Date = new Date()): boolean {
  if (plan.status !== "ACTIVE") return false;
  const at = now.getTime();
  if (plan.saleStartAt && Date.parse(plan.saleStartAt) > at) return false;
  if (plan.saleEndAt && Date.parse(plan.saleEndAt) < at) return false;
  return true;
}

export function planDurationLabel(plan: PlanRow): string {
  if (plan.durationDays % 30 === 0 && plan.durationDays >= 30) {
    return `${plan.durationDays / 30} tháng`;
  }
  return `${plan.durationDays} ngày`;
}

export function planVisitsLabel(plan: PlanRow): string {
  return plan.visitLimit == null ? "Không giới hạn lượt tập" : `${plan.visitLimit} lượt tập`;
}

export type MembershipRow = {
  id: string;
  gymId: string;
  planId: string;
  status: string;
  price: number;
  durationDays: number;
  totalVisits: number | null;
  usedVisits: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
};

export function normalizeMembership(raw: any): MembershipRow {
  return {
    id: String(raw?.id ?? ""),
    gymId: String(raw?.gymId ?? ""),
    planId: String(raw?.planId ?? ""),
    status: String(raw?.status ?? ""),
    price: Number(raw?.priceAtPurchase) || 0,
    durationDays: Number(raw?.durationDaysSnapshot) || 0,
    totalVisits: raw?.totalVisits != null ? Number(raw.totalVisits) : null,
    usedVisits: Number(raw?.usedVisits) || 0,
    startDate: raw?.startDate ?? null,
    endDate: raw?.endDate ?? null,
    createdAt: raw?.createdAt ?? null,
  };
}

export function normalizeMemberships(raw: any): MembershipRow[] {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list
    .map(normalizeMembership)
    .filter((m: MembershipRow) => m.id)
    .sort((a: MembershipRow, b: MembershipRow) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

export const MEMBERSHIP_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  PENDING_PAYMENT: { label: "Chờ thanh toán", tone: "warning" },
  ACTIVE: { label: "Đang hiệu lực", tone: "success" },
  EXPIRED: { label: "Đã hết hạn", tone: "neutral" },
  CANCELLED: { label: "Đã huỷ", tone: "neutral" },
  // The gym was suspended or closed between checkout and the payment webhook: money moved, the
  // membership never activated, and an admin has to resolve it. Saying "đã huỷ" here would be a lie.
  PENDING_ISSUE: { label: "Đang chờ xử lý", tone: "danger" },
};

export function membershipStatusLabel(status: string) {
  return MEMBERSHIP_STATUS[status] ?? { label: status || "Không rõ", tone: "neutral" as const };
}

/** Days left on an active membership — null when it has no end date yet (never activated). */
export function daysRemaining(membership: MembershipRow, now: Date = new Date()): number | null {
  if (!membership.endDate) return null;
  const end = Date.parse(membership.endDate);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

export type MultiGymWarning = { gymId: string; gymName: string; endDate: string };

export function normalizeWarnings(raw: any): MultiGymWarning[] {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list
    .map((row: any) => ({
      gymId: String(row?.gymId ?? ""),
      gymName: String(row?.gymName ?? "phòng gym khác"),
      endDate: String(row?.endDate ?? ""),
    }))
    .filter((w: MultiGymWarning) => w.gymId);
}

/**
 * The warning WARNS, it never blocks (money-flow §2.6) — the client may well want two gyms. The
 * confirmation is recorded on the purchase as `multiGymWarned`, which is the evidence that they
 * were told.
 */
export function multiGymWarningText(warnings: MultiGymWarning[]): string {
  const names = warnings.map((w) => w.gymName).join(", ");
  return warnings.length === 1
    ? `Bạn đang có gói hội viên còn hiệu lực tại ${names}. Mua thêm ở đây vẫn được — chỉ là hai gói sẽ chạy song song.`
    : `Bạn đang có gói hội viên còn hiệu lực tại ${warnings.length} phòng gym khác (${names}). Mua thêm ở đây vẫn được — các gói sẽ chạy song song.`;
}

/** Why "Mua gói" is off. null means it is on. */
export function purchaseBlockedReason(
  gym: GymRow,
  plan: PlanRow | null,
  memberships: MembershipRow[],
): string | null {
  const gymReason = gymBlockedReason(gym);
  if (gymReason) return gymReason;
  // The DB's own unique index: one OPEN membership per client per gym. A second purchase while one
  // is still PENDING_PAYMENT is refused server-side, so the screen says so first.
  const open = memberships.find(
    (m) => m.gymId === gym.id && (m.status === "ACTIVE" || m.status === "PENDING_PAYMENT"),
  );
  if (open) {
    return open.status === "ACTIVE"
      ? "Bạn đang có gói còn hiệu lực tại phòng gym này."
      : "Bạn đang có một gói chờ thanh toán tại phòng gym này.";
  }
  if (!plan) return "Chọn một gói hội viên để tiếp tục.";
  if (!planOnSale(plan)) return "Gói này hiện không mở bán.";
  return null;
}
