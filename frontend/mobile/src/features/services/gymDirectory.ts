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
  // ── Chi tiết (GET /gyms/:id) — thêm 21/9, CL-09 vá theo web (xem MOBILE_MIGRATION_MANIFEST.md) ──
  email: string | null;
  locationNote: string | null;
  provinceCode: number | null;
  wardCode: number | null;
  latitude: number | null;
  longitude: number | null;
  brandDescription: string | null;
  brandLogoUrl: string | null;
  socials: Partial<Record<SocialKey, string>>;
  /** Ảnh cơ sở đã duyệt (link ký tạm, bìa trước) — chỉ có ở chi tiết. */
  photos: GymPhoto[];
  /** Mọi chi nhánh đang mở của cùng thương hiệu (kể cả chi nhánh này) — cho bản đồ/danh sách chi nhánh. */
  brandBranches: BranchPin[];
};

export type SocialKey = "facebookUrl" | "instagramUrl" | "tiktokUrl" | "youtubeUrl";
export type GymPhoto = { id: string; url: string; category: string | null };
export type BranchPin = { id: string; name: string; address: string; latitude: number | null; longitude: number | null };

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
    email: text(raw?.email),
    locationNote: text(raw?.locationNote),
    provinceCode: num(raw?.provinceCode),
    wardCode: num(raw?.wardCode),
    latitude: num(raw?.latitude),
    longitude: num(raw?.longitude),
    brandDescription: text(raw?.brand?.description),
    brandLogoUrl: text(raw?.brand?.logoUrl),
    socials: Object.fromEntries(
      SOCIALS.map((s) => [s.key, text(raw?.brand?.[s.key])]).filter(([, v]) => v),
    ) as Partial<Record<SocialKey, string>>,
    photos: Array.isArray(raw?.photos)
      ? raw.photos
          .filter((p: any) => text(p?.url))
          .map((p: any) => ({ id: String(p.id), url: String(p.url), category: text(p.category) }))
      : [],
    brandBranches: Array.isArray(raw?.brandBranches)
      ? raw.brandBranches.map((b: any) => ({
          id: String(b.id),
          name: String(b.name ?? ""),
          address: String(b.address ?? ""),
          latitude: num(b.latitude),
          longitude: num(b.longitude),
        }))
      : [],
  };
}

function num(value: any): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Giới hạn "Thông tin giới thiệu" — trùng ABOUT_MAX của web và giới hạn ở gym-service. */
export const ABOUT_MAX = 300;

/**
 * "Thông tin giới thiệu": của chi nhánh, chưa có thì của thương hiệu. Dữ liệu cũ dài hơn giới hạn
 * (trước khi có giới hạn) được cắt ở khoảng trắng gần nhất + "…" — cùng quy tắc với web.
 */
export function aboutText(gym: Pick<GymRow, "description" | "brandDescription">): string | null {
  const raw = (gym.description || gym.brandDescription || "").trim();
  if (!raw) return null;
  if (raw.length <= ABOUT_MAX) return raw;
  const cut = raw.slice(0, ABOUT_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > ABOUT_MAX - 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Số nhà/đường + phường/xã + tỉnh/thành (tên tra từ mã; thiếu tên tỉnh thì dùng `city` cũ). */
export function fullAddress(
  gym: Pick<GymRow, "address" | "city">,
  names: { ward?: string | null; province?: string | null },
): string {
  return [gym.address, names.ward, names.province ?? gym.city].filter(Boolean).join(", ");
}

/** Mở Google Maps chỉ đường tới toạ độ chi nhánh (app Maps nếu có, không thì trình duyệt). */
export function directionsUrl(gym: Pick<GymRow, "latitude" | "longitude">): string | null {
  return gym.latitude != null && gym.longitude != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${gym.latitude},${gym.longitude}`
    : null;
}

export const SOCIALS: { key: SocialKey; label: string }[] = [
  { key: "facebookUrl", label: "Facebook" },
  { key: "instagramUrl", label: "Instagram" },
  { key: "tiktokUrl", label: "TikTok" },
  { key: "youtubeUrl", label: "YouTube" },
];

/** Chỉ link https — server đã kiểm tên miền từng mạng, đây là chốt cuối trước khi mở link ngoài. */
export function socialLinks(gym: Pick<GymRow, "socials">): { key: SocialKey; label: string; url: string }[] {
  return SOCIALS.filter((s) => gym.socials[s.key]?.startsWith("https://")).map((s) => ({
    ...s,
    url: gym.socials[s.key]!,
  }));
}

export const PHOTO_CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Mặt tiền",
  MAIN_TRAINING_AREA: "Khu tập chính",
  EQUIPMENT: "Trang thiết bị",
  CARDIO: "Khu cardio",
  CHANGING_ROOM: "Phòng thay đồ",
  AMENITIES: "Tiện ích",
  OTHER: "Khác",
};

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

/**
 * Tên tiện ích cho người dùng — cùng bảng với web (`AddBranchWizard/StepFacilities.tsx` FACILITY_LABEL).
 * Không bao giờ hiện mã nội bộ (DRINKING_WATER…): mã lạ chưa có tên thì bỏ qua thay vì lộ enum.
 */
export const FACILITY_LABEL: Record<string, string> = {
  FREE_WEIGHTS: "Tạ tự do",
  CARDIO_MACHINES: "Máy cardio",
  FUNCTIONAL_TRAINING_AREA: "Khu tập functional",
  GROUP_CLASSES: "Lớp tập nhóm",
  YOGA_STUDIO: "Phòng Yoga",
  SWIMMING_POOL: "Hồ bơi",
  PERSONAL_TRAINER: "Huấn luyện viên cá nhân",
  INBODY_SCAN: "Máy đo InBody",
  LOCKER_ROOM: "Phòng thay đồ / tủ khoá",
  SHOWER: "Phòng tắm",
  SAUNA: "Xông hơi",
  TOWEL_SERVICE: "Dịch vụ khăn tắm",
  PARKING: "Bãi đỗ xe",
  WIFI: "Wifi miễn phí",
  AIR_CONDITIONING: "Máy lạnh",
  DRINKING_WATER: "Nước uống miễn phí",
  KIDS_AREA: "Khu vui chơi trẻ em",
  VENDING_MACHINE: "Máy bán hàng tự động",
};

export function facilityLabels(codes: string[]): string[] {
  return codes.map((c) => FACILITY_LABEL[c]).filter((l): l is string => !!l);
}
