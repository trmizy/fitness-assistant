/**
 * N-A-06 — `GET /admin/users` used to ignore `search`, `status`, `page` and `limit` and always return
 * every account (1250 rows, ~270 KB). This is the query handling, kept pure so it can be tested
 * without HTTP.
 *
 * Backward compatible by construction: with none of those parameters the whole list comes back
 * exactly as before (the web UserManagement page and the mobile admin app both call it bare and
 * filter client-side). Any parameter that IS sent is validated — a bad value is a 400, never silently
 * ignored.
 */

export const ADMIN_USERS_MAX_PAGE_SIZE = 200;
export const ADMIN_USERS_DEFAULT_PAGE_SIZE = 20;

export type AdminUsersQuery = {
  search: string | null;
  /** Lower-case, diacritics-free form of `search`, compared against name + email. */
  searchKey: string | null;
  status: "ACTIVE" | "INACTIVE" | null;
  paging: { page: number; limit: number } | null;
};

export type AdminUsersQueryError = { code: string; message: string };

/** Lower-case + strip Vietnamese diacritics so "nguyen" finds "Nguyễn". */
export function foldAdminSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function single(raw: unknown): string | undefined | "multi" {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return "multi";
  return raw;
}

export function parseAdminUsersQuery(query: Record<string, unknown>): AdminUsersQuery | AdminUsersQueryError {
  const rawSearch = single(query.search);
  if (rawSearch === "multi") {
    return { code: "INVALID_SEARCH", message: "Từ khoá tìm kiếm không hợp lệ" };
  }
  const search = rawSearch !== undefined && rawSearch.trim() !== "" ? rawSearch.trim() : null;
  if (search !== null && search.length > 100) {
    return { code: "INVALID_SEARCH", message: "Từ khoá tìm kiếm tối đa 100 ký tự" };
  }

  const rawStatus = single(query.status);
  let status: AdminUsersQuery["status"] = null;
  if (rawStatus === "multi") {
    return { code: "INVALID_STATUS_FILTER", message: "Bộ lọc trạng thái không hợp lệ (chấp nhận: ACTIVE, INACTIVE)" };
  }
  if (rawStatus !== undefined && rawStatus.trim() !== "") {
    const up = rawStatus.trim().toUpperCase();
    if (up !== "ACTIVE" && up !== "INACTIVE") {
      return { code: "INVALID_STATUS_FILTER", message: "Bộ lọc trạng thái không hợp lệ (chấp nhận: ACTIVE, INACTIVE)" };
    }
    status = up;
  }

  const rawPage = single(query.page);
  const rawLimit = single(query.limit);
  let paging: AdminUsersQuery["paging"] = null;
  if (rawPage !== undefined || rawLimit !== undefined) {
    const toInt = (raw: string | undefined | "multi", fallback: number): number | null => {
      if (raw === undefined) return fallback;
      if (raw === "multi" || !/^\d{1,9}$/.test(raw)) return null;
      return Number(raw);
    };
    const page = toInt(rawPage, 1);
    const limit = toInt(rawLimit, ADMIN_USERS_DEFAULT_PAGE_SIZE);
    if (page === null || limit === null || page < 1 || limit < 1 || limit > ADMIN_USERS_MAX_PAGE_SIZE) {
      return {
        code: "INVALID_PAGINATION",
        message: `Phân trang không hợp lệ: page là số nguyên từ 1, limit là số nguyên từ 1 đến ${ADMIN_USERS_MAX_PAGE_SIZE}.`,
      };
    }
    paging = { page, limit };
  }

  return { search, searchKey: search === null ? null : foldAdminSearch(search), status, paging };
}

export function isAdminUsersQueryError(v: AdminUsersQuery | AdminUsersQueryError): v is AdminUsersQueryError {
  return "code" in v;
}

type Row = { name: string; email: string; statusCode: "ACTIVE" | "INACTIVE" };

/** Apply search + status, then the page slice. `total` is the number of rows matching the filters. */
export function selectAdminUsersPage<T extends Row>(
  rows: T[],
  q: AdminUsersQuery,
): { total: number; rows: T[]; page: number | null; limit: number | null; totalPages: number | null } {
  const matching = rows.filter(
    (r) =>
      (q.status === null || r.statusCode === q.status) &&
      (q.searchKey === null ||
        foldAdminSearch(r.name).includes(q.searchKey) ||
        foldAdminSearch(r.email).includes(q.searchKey)),
  );
  if (!q.paging) return { total: matching.length, rows: matching, page: null, limit: null, totalPages: null };
  const { page, limit } = q.paging;
  return {
    total: matching.length,
    rows: matching.slice((page - 1) * limit, page * limit),
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(matching.length / limit)),
  };
}
