/**
 * CL-10 / CL-11's pure parts: how a trainer row reads, and what a coaching request must carry.
 *
 * Two things here are contracts with the server, not presentation choices, and both were read off
 * the running backend rather than the mock:
 *
 *  - a trainer row carries NO price. The card's "từ X /buổi" is the lowest of the three per-session
 *    prices on the PT's application (online, offline, desired), exactly as web computes it — a PT
 *    who priced neither shows no price rather than a zero;
 *  - `POST /contracts/request` takes a `packageId`, never a price: the package is the server's
 *    source of truth for price, session count and mode. A gym may only be attached to an OFFLINE
 *    package, and only one the trainer has an ACCEPTED collaboration with — the server rejects
 *    anything else instead of quietly falling back to the independent rate.
 */
import { displaySpecialty } from "../../constants/specialties";

export type PtRow = {
  userId: string;
  name: string;
  photoUrl: string | null;
  specialties: string[];
  serviceMode: string | null;
  rating: number | null;
  ratingCount: number;
  area: string | null;
  lowestPrice: number | null;
  /** Free slots the PT has in the next 28 days — the same number the low-availability check uses. */
  slots28: number | null;
  acceptingClients: boolean;
  notAcceptingReason: string | null;
  suspended: boolean;
  gymAffiliation: string | null;
  bio: string | null;
  yearsOfExperience: string | null;
};

const isValidPrice = (p: unknown): p is number => typeof p === "number" && p > 0;

/** Web's `getLowestPerSessionPrice`, same three fields in the same order. */
export function lowestPerSessionPrice(app: any): number | null {
  const prices = [
    app?.onlinePricePerSession,
    app?.offlinePricePerSession,
    app?.desiredSessionPrice,
  ].filter(isValidPrice) as number[];
  return prices.length > 0 ? Math.min(...prices) : null;
}

function fullName(raw: any): string {
  const name = [raw?.firstName, raw?.lastName].filter(Boolean).join(" ").trim();
  return name || raw?.email || "Huấn luyện viên";
}

/** City/ward as the profile stores them — the row has no single "area" field. */
export function areaLabel(raw: any): string | null {
  const parts = [raw?.searchWard, raw?.searchDistrict, raw?.searchCity].filter(
    (p) => typeof p === "string" && p.trim(),
  );
  return parts.length ? parts.join(", ") : null;
}

export function normalizePt(raw: any): PtRow {
  const app = raw?.ptApplication ?? {};
  const specialties = Array.isArray(raw?.specialties)
    ? raw.specialties.map((s: any) => displaySpecialty(String(s)))
    : [];
  return {
    userId: String(raw?.userId ?? raw?.id ?? ""),
    name: fullName(raw),
    photoUrl: raw?.photoUrl ?? null,
    specialties,
    serviceMode: app?.serviceMode ?? null,
    rating: typeof raw?.avgRating === "number" ? raw.avgRating : null,
    ratingCount: Number(raw?.ratingCount) || 0,
    area: areaLabel(raw),
    lowestPrice: lowestPerSessionPrice(app),
    slots28:
      typeof raw?.availableSlotsNext28Days === "number" ? raw.availableSlotsNext28Days : null,
    acceptingClients: raw?.isAcceptingClients !== false,
    notAcceptingReason: raw?.notAcceptingReason ?? null,
    suspended: raw?.ptSuspended === true,
    gymAffiliation: app?.gymAffiliation ?? null,
    bio: app?.professionalBio ?? null,
    yearsOfExperience: app?.yearsOfExperience ?? null,
  };
}

/**
 * The two endpoints answer DIFFERENT shapes, checked against the running gateway on 2026-09-17:
 *
 *  - `GET /profile/pts` (list) carries `ptApplication` (service mode, bio, prices) and
 *    `availableSlotsNext28Days`;
 *  - `GET /profile/pts/:id` (detail) carries NEITHER, and adds `recentReviews` +
 *    `ratingDistribution` instead.
 *
 * Web never notices because its detail panel keeps the row it was opened from. A pushed screen has
 * no such row, so the two are merged here: whatever the detail knows wins, and the list row fills
 * the fields the detail simply does not return. Rendering the detail alone would quietly downgrade
 * a trainer to "chưa cho biết hình thức" with no price and no bio.
 */
export function mergePtSources(detail: any, listRow: PtRow | null): PtRow | null {
  if (!detail && !listRow) return null;
  if (!detail) return listRow;
  const fromDetail = normalizePt(detail);
  if (!listRow) return fromDetail;
  return {
    ...fromDetail,
    serviceMode: fromDetail.serviceMode ?? listRow.serviceMode,
    lowestPrice: fromDetail.lowestPrice ?? listRow.lowestPrice,
    bio: fromDetail.bio ?? listRow.bio,
    yearsOfExperience: fromDetail.yearsOfExperience ?? listRow.yearsOfExperience,
    gymAffiliation: fromDetail.gymAffiliation ?? listRow.gymAffiliation,
    slots28: fromDetail.slots28 ?? listRow.slots28,
    specialties: fromDetail.specialties.length ? fromDetail.specialties : listRow.specialties,
    area: fromDetail.area ?? listRow.area,
    rating: fromDetail.rating ?? listRow.rating,
    ratingCount: fromDetail.ratingCount || listRow.ratingCount,
  };
}

export function normalizePts(raw: any): PtRow[] {
  const list = Array.isArray(raw?.pts) ? raw.pts : Array.isArray(raw) ? raw : [];
  return list.map(normalizePt).filter((pt: PtRow) => pt.userId);
}

/** The chip filter runs on the client, on the same field the server searches. */
export function matchesSpecialty(pt: PtRow, chip: string): boolean {
  if (!chip || chip === "Tất cả") return true;
  return pt.specialties.some((s) => s.toLowerCase().includes(chip.toLowerCase()));
}

export const SESSION_MODES = [
  { value: "ONLINE", label: "Online" },
  { value: "OFFLINE", label: "Offline" },
  { value: "HYBRID", label: "Hybrid" },
];

export function serviceModeLabel(mode?: string | null): string {
  if (mode === "ONLINE") return "Online qua video call";
  if (mode === "OFFLINE") return "Offline tại phòng gym";
  if (mode === "HYBRID") return "Online & Offline";
  return "Chưa cho biết hình thức";
}

export type PtFilters = {
  q: string;
  minPrice: string;
  maxPrice: string;
  sessionMode: string;
  provinceCode: string;
  wardCode: string;
};

export const EMPTY_PT_FILTERS: PtFilters = {
  q: "",
  minPrice: "",
  maxPrice: "",
  sessionMode: "",
  provinceCode: "",
  wardCode: "",
};

/** The badge on the filter button — the free-text query is typed in the open, so it doesn't count. */
export function activeFilterCount(filters: PtFilters): number {
  return (["minPrice", "maxPrice", "sessionMode", "provinceCode", "wardCode"] as const).filter(
    (key) => String(filters[key] ?? "").trim() !== "",
  ).length;
}

/**
 * Query for `GET /profile/pts`. Empty strings are dropped rather than sent: the endpoint validates
 * `minPrice`/`maxPrice` as numbers and answers 400 for an empty one.
 */
export function buildListParams(filters: PtFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  const q = filters.q.trim();
  if (q) params.q = q;
  const min = Number(filters.minPrice);
  const max = Number(filters.maxPrice);
  if (filters.minPrice.trim() && Number.isFinite(min) && min >= 0) params.minPrice = min;
  if (filters.maxPrice.trim() && Number.isFinite(max) && max >= 0) params.maxPrice = max;
  if (filters.sessionMode) params.sessionMode = filters.sessionMode;
  if (filters.provinceCode.trim()) params.provinceCode = Number(filters.provinceCode);
  if (filters.wardCode.trim()) params.wardCode = Number(filters.wardCode);
  return params;
}

/** minPrice > maxPrice is a 400 from the server; catching it here keeps the request from going out. */
export function filterError(filters: PtFilters): string | null {
  const min = Number(filters.minPrice);
  const max = Number(filters.maxPrice);
  if (filters.minPrice.trim() && (!Number.isFinite(min) || min < 0)) {
    return "Giá từ phải là số không âm";
  }
  if (filters.maxPrice.trim() && (!Number.isFinite(max) || max < 0)) {
    return "Giá đến phải là số không âm";
  }
  if (filters.minPrice.trim() && filters.maxPrice.trim() && min > max) {
    return "Giá từ phải nhỏ hơn hoặc bằng giá đến";
  }
  return null;
}

export type ServicePackage = {
  id: string;
  name: string;
  sessionCount: number;
  price: number;
  sessionMode: string;
  description?: string | null;
};

export function normalizePackages(raw: any): ServicePackage[] {
  const list = Array.isArray(raw?.packages) ? raw.packages : Array.isArray(raw) ? raw : [];
  return list
    .filter((p: any) => p?.isActive !== false && !p?.archivedAt)
    .map((p: any) => ({
      id: String(p?.id ?? ""),
      name: String(p?.name ?? "Gói dịch vụ"),
      sessionCount: Number(p?.sessionCount) || 0,
      price: Number(p?.price) || 0,
      sessionMode: String(p?.sessionMode ?? ""),
      description: p?.description ?? null,
    }))
    .filter((p: ServicePackage) => p.id);
}

export type PartnerGym = {
  gymId: string;
  name: string;
  city: string | null;
  /** The agreed split, as the collaboration stores it: 0.55 / 0.35 / 0.10. */
  ptRate: number | null;
  gymRate: number | null;
};

/**
 * `GET /pt/:ptUserId/gyms` answers `{ success, data: [{ collaborationId, gym, rates }] }` — the
 * gym's id is nested, so a reader that takes `row.id` gets the COLLABORATION's id and posts a
 * gymId the server has never heard of.
 */
export function normalizePartnerGyms(raw: any): PartnerGym[] {
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list
    .map((row: any) => ({
      gymId: String(row?.gym?.id ?? row?.gymId ?? ""),
      name: String(row?.gym?.name ?? row?.gymName ?? "Phòng gym"),
      city: row?.gym?.city ?? null,
      ptRate: row?.rates?.ptRate != null ? Number(row.rates.ptRate) : null,
      gymRate: row?.rates?.gymRate != null ? Number(row.rates.gymRate) : null,
    }))
    .filter((gym: PartnerGym) => gym.gymId);
}

/** "PT 55% · Gym 35%" — the share each side agreed to, not a number the app invents. */
export function ratesLabel(gym: PartnerGym): string | null {
  if (gym.ptRate == null && gym.gymRate == null) return null;
  const parts: string[] = [];
  if (gym.ptRate != null) parts.push(`PT ${Math.round(gym.ptRate * 100)}%`);
  if (gym.gymRate != null) parts.push(`gym ${Math.round(gym.gymRate * 100)}%`);
  return parts.join(" · ");
}

export function pricePerSession(pkg: ServicePackage): number | null {
  if (!pkg.sessionCount) return null;
  return Math.round(pkg.price / pkg.sessionCount);
}

/**
 * Body for `POST /contracts/request`. A gym rides along ONLY on an offline package — an online
 * package never carries a gym share, and the server refuses a gymId without an accepted
 * collaboration rather than falling back.
 */
export function buildContractRequestPayload(input: {
  ptUserId: string;
  pkg: ServicePackage;
  gymId?: string | null;
  message?: string;
  acknowledgedLowAvailability?: boolean;
}): Record<string, unknown> {
  const gymId = input.pkg.sessionMode === "OFFLINE" && input.gymId ? input.gymId : undefined;
  const message = input.message?.trim();
  return {
    ptUserId: input.ptUserId,
    packageId: input.pkg.id,
    ...(message ? { clientMessage: message } : {}),
    ...(gymId ? { gymId } : {}),
    acknowledgedLowAvailability: input.acknowledgedLowAvailability === true,
  };
}

export type LowAvailability = {
  availableSlots: number;
  packageSessions: number;
  nearestAvailableSlot: string | null;
};

/**
 * The 409 the server answers when the trainer has fewer free slots than the package has sessions.
 * It is a warning to acknowledge, not a refusal — telling the two numbers apart is the whole point,
 * so a body missing either one is treated as "not that error" instead of guessed at.
 */
export function readLowAvailability(error: any): LowAvailability | null {
  const data = error?.response?.data;
  if (error?.response?.status !== 409 || data?.code !== "LOW_AVAILABILITY") return null;
  const availableSlots = Number(data?.availableSlots);
  const packageSessions = Number(data?.packageSessions);
  if (!Number.isFinite(availableSlots) || !Number.isFinite(packageSessions)) return null;
  return {
    availableSlots,
    packageSessions,
    nearestAvailableSlot: data?.nearestAvailableSlot ?? null,
  };
}

export function lowAvailabilityMessage(info: LowAvailability): string {
  return (
    `Huấn luyện viên chỉ còn ${info.availableSlots} khung giờ trống trong 28 ngày tới, ` +
    `trong khi gói này có ${info.packageSessions} buổi. Bạn vẫn có thể gửi yêu cầu — ` +
    `hai bên sẽ tự xếp lịch cho những buổi còn lại.`
  );
}

/** Why the "Gửi yêu cầu" button is off, in the user's words — null means it is on. */
export function requestBlockedReason(pt: PtRow, pkg: ServicePackage | null): string | null {
  if (pt.suspended) return "Huấn luyện viên này đang bị tạm ngưng.";
  if (!pt.acceptingClients) {
    return pt.notAcceptingReason?.trim()
      ? `Hiện không nhận khách mới: ${pt.notAcceptingReason.trim()}`
      : "Huấn luyện viên hiện không nhận khách mới.";
  }
  if (!pkg) return "Chọn một gói dịch vụ để gửi yêu cầu.";
  return null;
}
