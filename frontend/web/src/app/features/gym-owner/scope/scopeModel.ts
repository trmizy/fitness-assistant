/**
 * Gym Owner scope model - pure functions, no React (docs/gym-owner-redesign/05_IA_SCOPE_MODEL.md sections 5-7).
 * The backend already filters `/owner/gyms` to the caller's scope (canAccessGym); a gymId that is not in that list is
 * therefore out of scope for this account and is never "fixed" silently.
 */
import type { PartnerRole } from "../../../utils/gymStaffRole";

export type ScopeKind = "brand" | "branch" | "brand-or-branch" | "none";
export type GymScopeValue = string;
export const ALL_BRANCHES = "ALL";

export interface ScopeGym {
  id: string;
  name: string;
  status?: string;
  brandId?: string | null;
  operationalStatus?: string | null;
  city?: string | null;
  address?: string | null;
}

/** Branches a person can pick: DRAFT rows are not branches yet (they live in the wizard). */
export function pickableGyms<T extends ScopeGym>(gyms: readonly T[]): T[] {
  return gyms.filter((g) => g.status !== "DRAFT");
}

export type ScopeResolution =
  | { kind: "ok"; gymId: GymScopeValue; writeUrl: string | null }
  | { kind: "out-of-scope"; requested: string }
  | { kind: "no-branch" };

/**
 * Rules (05 section 5):
 *  - `?gymId=` present and in scope: it wins. Present but not in scope: out-of-scope (no silent switch).
 *  - brand-wide / none screens: "ALL" (nothing is written to the URL).
 *  - brand-or-branch without gymId: "ALL" when there are 2+ branches, otherwise the single branch.
 *  - branch-required without gymId: last used branch of this session if still in scope, else the first; written to the URL.
 */
export function resolveScope(input: {
  kind: ScopeKind;
  gyms: readonly ScopeGym[];
  requestedGymId: string | null;
  lastGymId?: string | null;
}): ScopeResolution {
  const gyms = pickableGyms(input.gyms);
  const { kind, requestedGymId } = input;
  if (kind === "brand" || kind === "none") {
    // A brand-wide screen ignores gymId, but a foreign gymId is still reported so the user is not silently misled.
    if (requestedGymId && !gyms.some((g) => g.id === requestedGymId)) return { kind: "out-of-scope", requested: requestedGymId };
    return { kind: "ok", gymId: ALL_BRANCHES, writeUrl: null };
  }
  if (gyms.length === 0) return { kind: "no-branch" };
  if (requestedGymId) {
    if (gyms.some((g) => g.id === requestedGymId)) return { kind: "ok", gymId: requestedGymId, writeUrl: null };
    return { kind: "out-of-scope", requested: requestedGymId };
  }
  if (kind === "brand-or-branch") {
    if (gyms.length >= 2) return { kind: "ok", gymId: ALL_BRANCHES, writeUrl: null };
    return { kind: "ok", gymId: gyms[0].id, writeUrl: null };
  }
  // branch-required
  const last = input.lastGymId && gyms.some((g) => g.id === input.lastGymId) ? input.lastGymId : null;
  const chosen = last ?? gyms[0].id;
  return { kind: "ok", gymId: chosen, writeUrl: chosen };
}

/**
 * Branch detail path `/gym-owner/gyms/:id` (G2): the branch is in the PATH, not in `?gymId=`. Returns the id, or null for
 * every other path (the list, the wizard `/gym-owner/gyms/wizard/...`, anything deeper).
 */
export function detailGymIdFromPath(pathname: string): string | null {
  const m = /^\/gym-owner\/gyms\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  let id = m[1];
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep the raw segment: it will simply not match any branch */
  }
  return id === "wizard" ? null : id;
}

/** "Tat ca" is only offered where the screen allows it AND there are 2+ branches in scope (05 section 6). */
export function canOfferAllBranches(kind: ScopeKind, gymCount: number): boolean {
  return kind === "brand-or-branch" && gymCount >= 2;
}

export interface ScopeIdentity {
  userId: string;
  role: PartnerRole | undefined;
  brandId: string | null;
  gymId: GymScopeValue;
}

/** One value that identifies the scope a piece of data belongs to (05 section 6.1 / 6.7). */
export function makeScopeKey(p: ScopeIdentity): string {
  return [p.userId, p.role ?? "?", p.brandId ?? "-", p.gymId].join(":");
}

/** React Query key for gym-owner data: ['gym-owner', userId, role, brandId, gymId, resource, params] (05 section 6.2). */
export function goKey(scope: ScopeIdentity, resource: string, params?: unknown): readonly unknown[] {
  return ["gym-owner", scope.userId, scope.role ?? "?", scope.brandId ?? "-", scope.gymId, resource, params ?? null];
}

/**
 * Branch code shown as a chip (2-3 chars). The backend has NO code field on Gym (gym-service schema.prisma `model Gym`),
 * so this is a DISPLAY-ONLY value derived from the name: never sent to the API, never used as an identifier.
 * Trailing number wins ("Gymini Quan 1" gives "Q1"); otherwise the initials of the last two meaningful words ("Viet Power Gym Cau Giay" gives "CG", "Fit Zone" gives "FZ").
 */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}
const FILLER = new Set(["chi", "nhanh", "cn", "phong", "gym", "fitness", "club", "center", "centre", "the", "va", "and"]);
export function branchCode(name: string): string {
  const words = stripDiacritics(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return "--";
  const meaningful = words.filter((w) => !FILLER.has(w.toLowerCase()));
  const pool = meaningful.length ? meaningful : words;
  if (pool.length === 1) return pool[0].slice(0, 3).toUpperCase().padEnd(2, "-");
  const last = pool[pool.length - 1];
  if (/\d/.test(last) && pool[pool.length - 2]) return (pool[pool.length - 2][0] + last).slice(0, 3).toUpperCase();
  if (/\d/.test(last)) return last.slice(0, 3).toUpperCase();
  // Last two words: Vietnamese branch names end in the district ("Cau Giay" gives "CG").
  return pool.slice(-2).map((w) => w[0]).join("").toUpperCase().padEnd(2, "-");
}

/** Codes for a list of branches; collisions get a numeric suffix so each chip stays unique inside one menu. */
export function branchCodes(gyms: readonly { id: string; name: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Map<string, number>();
  for (const g of gyms) {
    const base = branchCode(g.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out[g.id] = n === 1 ? base : `${base.slice(0, 2)}${n}`;
  }
  return out;
}

export type ApiErrorKind = "forbidden" | "out-of-scope" | "suspended" | "session" | "not-found" | "network" | "other";

/** Classify a gym-service / gateway error into one of the permission states of 05 section 7. */
export function classifyApiError(error: unknown): ApiErrorKind {
  const e = error as { response?: { status?: number; data?: { error?: { code?: string } } }; code?: string } | null;
  if (!e) return "other";
  const status = e.response?.status;
  const code = e.response?.data?.error?.code;
  if (code === "PARTNER_SUSPENDED") return "suspended";
  if (code === "GYM_OUT_OF_SCOPE") return "out-of-scope";
  if (status === 403 || code === "PERMISSION_DENIED" || code === "OWNER_ROLE_REQUIRED") return "forbidden";
  if (status === 401) return "session";
  if (status === 404) return "not-found";
  if (!e.response && (e.code === "ERR_NETWORK" || e.code === "ECONNABORTED")) return "network";
  return "other";
}

/** Suspended partner: OWNER/ACCOUNTANT are locked out of the workspace, MANAGER/RECEPTIONIST only see a banner (05 sections 1.5, 7). */
export function suspensionMode(role: PartnerRole | undefined): "lock" | "banner" | "none" {
  if (role === "OWNER" || role === "ACCOUNTANT") return "lock";
  if (role === "MANAGER" || role === "RECEPTIONIST") return "banner";
  return "none";
}

export type PermissionState = "loading" | "allowed" | "forbidden";
/** Never falls back to OWNER: no role yet is "loading" (or "forbidden" once the role query finished without one). */
export function permissionState(role: PartnerRole | undefined, roleLoading: boolean, allow: readonly PartnerRole[]): PermissionState {
  if (!role) return roleLoading ? "loading" : "forbidden";
  return allow.includes(role) ? "allowed" : "forbidden";
}

/** Only an explicit OWNER is an owner: undefined / loading is NOT (audit Finding B). */
export function isOwnerRole(role: unknown): boolean {
  return role === "OWNER";
}

export type TagTone = "ok" | "warn" | "risk" | "info" | "neutral";
/** Branch state as words (never colour only) for the branch menu and strip. */
export function branchStatusText(g: Pick<ScopeGym, "status" | "operationalStatus">): { text: string; tone: TagTone } {
  if (g.status === "PENDING_REVIEW") return { text: "Chờ duyệt hồ sơ", tone: "info" };
  if (g.status === "REJECTED") return { text: "Bị từ chối", tone: "risk" };
  if (g.status === "SUSPENDED") return { text: "Bị đình chỉ", tone: "risk" };
  if (g.operationalStatus === "PERMANENTLY_CLOSED") return { text: "Đã đóng cửa vĩnh viễn", tone: "neutral" };
  if (g.operationalStatus === "TEMPORARILY_CLOSED") return { text: "Tạm đóng", tone: "warn" };
  return { text: "Đang mở cửa", tone: "ok" };
}

export const ROLE_LABEL: Record<PartnerRole, string> = {
  OWNER: "Chủ phòng tập",
  MANAGER: "Quản lý",
  RECEPTIONIST: "Lễ tân",
  ACCOUNTANT: "Kế toán",
};

/** Right side of the scope strip, as separate parts (the UI separates them with a rule, never a dot). */
export function roleLineParts(role: PartnerRole | undefined, branchCount: number): string[] {
  if (!role) return [];
  const head = `Bạn là ${ROLE_LABEL[role]}`;
  if (role === "OWNER") return [head, `${branchCount} chi nhánh`];
  if (role === "ACCOUNTANT") return [head, `${branchCount} chi nhánh trong phạm vi`];
  return [head, `${branchCount} chi nhánh được giao`];
}

const LAST_KEY = "gymini.gymOwner.lastGym";
export function readLastGymId(userId: string): string | null {
  try {
    return sessionStorage.getItem(`${LAST_KEY}.${userId}`);
  } catch {
    return null;
  }
}
export function writeLastGymId(userId: string, gymId: string): void {
  try {
    sessionStorage.setItem(`${LAST_KEY}.${userId}`, gymId);
  } catch {
    /* storage blocked: the default simply falls back to the first branch */
  }
}
