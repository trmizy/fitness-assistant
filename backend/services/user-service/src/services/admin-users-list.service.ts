/**
 * Admin user list on AWS (GET /admin/users) - port of the gateway's aggregation
 * (backend/gateway/src/routes/proxy.routes.ts + utils/adminUsersQuery.ts + utils/adminUserView.ts).
 *
 * Why: on AWS there is no gateway; user-service answers /admin/*. Its first version pulled EVERY account from auth-service and mapped
 * them all in one response (1.3k rows ~270 KB; 37k accounts would be ~30 s and megabytes). The gateway already solved this: the
 * answer is ALWAYS one page, filtering (role, status, search, partnerRole, id, ids) and slicing happen in the database (auth-service),
 * and only the page's rows are enriched and mapped. This is the same behaviour and the same response shape, so the web and mobile
 * admin clients need no change. Keep it in step with the gateway originals.
 */

export const ADMIN_USERS_MAX_PAGE_SIZE = 200;
export const ADMIN_USERS_DEFAULT_PAGE_SIZE = 20;
/** Page size when the caller sent neither `page` nor `limit`. */
export const ADMIN_USERS_BARE_PAGE_SIZE = 50;

export const ADMIN_PARTNER_ROLES = ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as const;
export type AdminPartnerRole = (typeof ADMIN_PARTNER_ROLES)[number];

export type AdminUsersQuery = {
  search: string | null;
  status: "ACTIVE" | "INACTIVE" | null;
  partnerRole: AdminPartnerRole | null;
  id: string | null;
  ids: string[] | null;
  paging: { page: number; limit: number };
};
export type AdminUsersQueryError = { code: string; message: string };

function single(raw: unknown): string | undefined | "multi" {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return "multi";
  return raw;
}

export function parseAdminUsersQuery(query: Record<string, unknown>): AdminUsersQuery | AdminUsersQueryError {
  const rawSearch = single(query.search);
  if (rawSearch === "multi") return { code: "INVALID_SEARCH", message: "Từ khoá tìm kiếm không hợp lệ" };
  const search = rawSearch !== undefined && rawSearch.trim() !== "" ? rawSearch.trim() : null;
  if (search !== null && search.length > 100) return { code: "INVALID_SEARCH", message: "Từ khoá tìm kiếm tối đa 100 ký tự" };

  const statusError = { code: "INVALID_STATUS_FILTER", message: "Bộ lọc trạng thái không hợp lệ (chấp nhận: ACTIVE, INACTIVE)" };
  const rawStatus = single(query.status);
  let status: AdminUsersQuery["status"] = null;
  if (rawStatus === "multi") return statusError;
  if (rawStatus !== undefined && rawStatus.trim() !== "") {
    const up = rawStatus.trim().toUpperCase();
    if (up !== "ACTIVE" && up !== "INACTIVE") return statusError;
    status = up;
  }

  const rawPartner = single(query.partnerRole);
  let partnerRole: AdminPartnerRole | null = null;
  if (rawPartner === "multi") return { code: "INVALID_PARTNER_ROLE_FILTER", message: "Bộ lọc vai trò đối tác không hợp lệ" };
  if (rawPartner !== undefined && rawPartner.trim() !== "") {
    const up = rawPartner.trim().toUpperCase();
    if (!(ADMIN_PARTNER_ROLES as readonly string[]).includes(up)) {
      return { code: "INVALID_PARTNER_ROLE_FILTER", message: `Bộ lọc vai trò đối tác không hợp lệ (chấp nhận: ${ADMIN_PARTNER_ROLES.join(", ")})` };
    }
    const rawRole = single(query.role);
    if (typeof rawRole === "string" && rawRole.trim() !== "" && rawRole.trim().toUpperCase() !== "GYM_OWNER") {
      return { code: "INVALID_PARTNER_ROLE_FILTER", message: "Vai trò đối tác chỉ dùng được với vai trò GYM_OWNER" };
    }
    partnerRole = up as AdminPartnerRole;
  }

  const rawId = single(query.id);
  if (rawId === "multi" || (rawId !== undefined && rawId.trim().length > 64)) return { code: "INVALID_ID_FILTER", message: "Mã người dùng không hợp lệ" };
  const id = rawId !== undefined && rawId.trim() !== "" ? rawId.trim() : null;

  const rawIds = single(query.ids);
  let ids: string[] | null = null;
  if (rawIds === "multi") return { code: "INVALID_IDS_FILTER", message: "Danh sách mã người dùng không hợp lệ" };
  if (rawIds !== undefined && rawIds.trim() !== "") {
    const list = [...new Set(rawIds.split(",").map((x) => x.trim()).filter(Boolean))];
    if (list.length === 0 || list.length > 200 || list.some((x) => x.length > 64)) {
      return { code: "INVALID_IDS_FILTER", message: "Cần từ 1 đến 200 mã người dùng, cách nhau bằng dấu phẩy" };
    }
    ids = list;
  }

  const rawPage = single(query.page);
  const rawLimit = single(query.limit);
  let paging: AdminUsersQuery["paging"] = { page: 1, limit: ADMIN_USERS_BARE_PAGE_SIZE };
  if (rawPage !== undefined || rawLimit !== undefined) {
    const toInt = (raw: string | undefined | "multi", fallback: number): number | null => {
      if (raw === undefined) return fallback;
      if (raw === "multi" || !/^\d{1,9}$/.test(raw)) return null;
      return Number(raw);
    };
    const page = toInt(rawPage, 1);
    const limit = toInt(rawLimit, ADMIN_USERS_DEFAULT_PAGE_SIZE);
    if (page === null || limit === null || page < 1 || limit < 1 || limit > ADMIN_USERS_MAX_PAGE_SIZE) {
      return { code: "INVALID_PAGINATION", message: `Phân trang không hợp lệ: page là số nguyên từ 1, limit là số nguyên từ 1 đến ${ADMIN_USERS_MAX_PAGE_SIZE}.` };
    }
    paging = { page, limit };
  }

  return { search, status, partnerRole, id, ids, paging };
}

export const isAdminUsersQueryError = (v: AdminUsersQuery | AdminUsersQueryError): v is AdminUsersQueryError => "code" in v;

// ── labels (same codes and Vietnamese texts as the gateway's adminUserView) ───────────────────────────────────────────────────────

export const adminRoleLabel = (role: string | null | undefined): "Admin" | "PT" | "Gym Owner" | "Client" =>
  role === "ADMIN" ? "Admin" : role === "PT" ? "PT" : role === "GYM_OWNER" ? "Gym Owner" : "Client";
export const adminRoleCode = (role: string | null | undefined): "ADMIN" | "CUSTOMER" | "PT" | "GYM_OWNER" =>
  role === "ADMIN" || role === "PT" || role === "GYM_OWNER" ? role : "CUSTOMER";
export const adminRoleLabelVi = (role: string | null | undefined): string =>
  ({ ADMIN: "Quản trị viên", PT: "Huấn luyện viên", GYM_OWNER: "Chủ phòng gym", CUSTOMER: "Khách hàng" })[adminRoleCode(role)];
export const adminUserStatus = (isActive: boolean | null | undefined): "Active" | "Inactive" => (isActive === false ? "Inactive" : "Active");
export const adminStatusCode = (isActive: boolean | null | undefined): "ACTIVE" | "INACTIVE" => (isActive === false ? "INACTIVE" : "ACTIVE");
export const adminStatusLabelVi = (isActive: boolean | null | undefined): string => (isActive === false ? "Đã khoá" : "Đang hoạt động");

/** "09/11/2026" - fixed format, independent of the server's ICU/locale (the Lambda runs with TZ=Asia/Ho_Chi_Minh). */
export function adminDateVi(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export type AuthUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  isActive?: boolean | null;
  createdAt: string;
  updatedAt: string;
};

const DATE_LONG = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const DATE_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function mapAdminUserRow(u: AuthUser, contractSummary: Record<string, number>) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email.split("@")[0];
  return {
    id: u.id,
    name,
    email: u.email,
    // Legacy shape the web and mobile admin clients key on / parse; the *Code, *Label and ISO fields are what to read.
    role: adminRoleLabel(u.role),
    roleCode: adminRoleCode(u.role),
    roleLabel: adminRoleLabelVi(u.role),
    status: adminUserStatus(u.isActive),
    statusCode: adminStatusCode(u.isActive),
    statusLabel: adminStatusLabelVi(u.isActive),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    joinedLabel: adminDateVi(u.createdAt),
    lastActiveLabel: adminDateVi(u.updatedAt),
    joined: DATE_LONG.format(new Date(u.createdAt)),
    lastActive: DATE_SHORT.format(new Date(u.updatedAt)),
    sessions: 0,
    contracts: contractSummary[u.id] ?? 0,
  };
}

// ── orchestration ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AdminUsersDeps {
  /** GET /auth/users with these query params. A non-2xx must throw an error carrying `response.status` / `response.data` (axios shape). */
  listAuthUsers(params: Record<string, string>): Promise<{ users?: AuthUser[]; total?: number }>;
  /** gym-service: the user ids of every STAFF partner role (MANAGER / RECEPTIONIST / ACCOUNTANT), one call. A GYM_OWNER in none of them is an OWNER. */
  partnerRoleIndex(): Promise<Record<string, string[]>>;
  /** Contract counts for just these ids. */
  contractCounts(ids: string[]): Promise<Record<string, number>>;
}

export type AdminUsersAnswer =
  | {
      status: 200;
      headers: Record<string, string>;
      body: { success: true; data: { total: number; users: ReturnType<typeof mapAdminUserRow>[]; page: number; limit: number; totalPages: number } };
    }
  | { status: number; headers?: undefined; body: { success: false; error: { code: string; message: string } } };

const fail = (status: number, code: string, message: string): AdminUsersAnswer => ({ status, body: { success: false, error: { code, message } } });

export async function listAdminUsers(rawQuery: Record<string, unknown>, deps: AdminUsersDeps): Promise<AdminUsersAnswer> {
  const q = parseAdminUsersQuery(rawQuery);
  if (isAdminUsersQueryError(q)) return fail(400, q.code, q.message);

  const { page, limit } = q.paging;
  const common: Record<string, string> = {
    ...(q.ids ? { ids: q.ids.join(",") } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.search ? { search: q.search } : {}),
    ...(q.id ? { id: q.id } : {}),
  };

  let rows: AuthUser[] = [];
  let total = 0;
  try {
    if (q.partnerRole) {
      // Partner roles live in gym-service, not on the auth account: read the (small) GYM_OWNER set and the staff-role index (ONE call, in
      // parallel with it), page in memory. Resolving the role of every owner 200 ids at a time took 5+ sequential calls (~3.6 s).
      const [ownersAnswer, roleIndex] = await Promise.all([deps.listAuthUsers({ role: "GYM_OWNER", ...common }), deps.partnerRoleIndex()]);
      const owners = (ownersAnswer.users ?? []) as AuthUser[];
      const roleById = new Map<string, string>();
      for (const [role, userIds] of Object.entries(roleIndex)) for (const id of userIds) roleById.set(id, role);
      // A GYM_OWNER login in no staff list is an OWNER: a real OWNER account, or a legacy owner with no partner account.
      const matching = owners.filter((u) => (roleById.get(u.id) ?? "OWNER") === q.partnerRole);
      total = matching.length;
      rows = matching.slice((page - 1) * limit, page * limit);
    } else {
      const params: Record<string, string> = { page: String(page), limit: String(limit), ...common };
      if (typeof rawQuery.role === "string" && rawQuery.role !== "") params.role = rawQuery.role;
      const r = await deps.listAuthUsers(params);
      rows = (r.users ?? []) as AuthUser[];
      total = typeof r.total === "number" ? r.total : rows.length;
    }
  } catch (err: any) {
    // A filter auth-service rejected (400) is the caller's mistake, not an outage.
    if (err?.response?.status === 400) {
      return fail(400, err.response.data?.code || "INVALID_FILTER", err.response.data?.error || "Bộ lọc không hợp lệ");
    }
    throw err;
  }

  // Contract counts for just this page (<= 200 ids). A failure here degrades to 0, as before.
  let summary: Record<string, number> = {};
  if (rows.length > 0) {
    try {
      summary = await deps.contractCounts(rows.map((u) => u.id));
    } catch {
      summary = {};
    }
  }

  return {
    status: 200,
    headers: { "X-Total-Count": String(total), "X-Page": String(page), "X-Limit": String(limit) },
    body: {
      success: true,
      data: { total, users: rows.map((u) => mapAdminUserRow(u, summary)), page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    },
  };
}
