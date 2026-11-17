/**
 * FIX5-ADMIN-PERF — query handling of `GET /auth/users` (admin). Pure, so it is testable without HTTP.
 *
 * Backward compatible by construction: with no parameter at all the endpoint answers exactly as before
 * (every non-admin account). Any parameter that IS sent is validated — a bad value is a 400, never
 * silently ignored. `page` / `limit` switch the answer to one page and add `total`.
 */

export const LISTABLE_ROLES = ["CUSTOMER", "PT", "GYM_OWNER"] as const;
export type ListableRole = (typeof LISTABLE_ROLES)[number];

export const USER_LIST_MAX_LIMIT = 200;
export const USER_LIST_DEFAULT_LIMIT = 20;

export type UserListQuery = {
  role?: ListableRole;
  isActive?: boolean;
  /** Lower-case, diacritics-free form of the search text (what the repository compares against). */
  searchKey?: string;
  id?: string;
  /** Look up these accounts (1..200 ids), e.g. the names behind a withdrawal list. */
  ids?: string[];
  paging?: { page: number; limit: number };
};
export type UserListQueryError = { status: 400; code: string; message: string };

/** Lower-case + strip Vietnamese diacritics so "nguyen" finds "Nguyễn". Mirrors the gateway's foldAdminSearch. */
export function foldSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function one(raw: unknown): string | undefined | null {
  if (raw === undefined) return undefined;
  return typeof raw === "string" ? raw : null; // null = repeated / non-string
}

export function parseUserListQuery(query: Record<string, unknown>): UserListQuery | UserListQueryError {
  const bad = (code: string, message: string): UserListQueryError => ({ status: 400, code, message });
  const out: UserListQuery = {};

  const role = one(query.role);
  if (role === null) return bad("INVALID_ROLE_FILTER", "Bộ lọc role không hợp lệ");
  if (role !== undefined && role.trim() !== "") {
    const up = role.trim().toUpperCase();
    if (!(LISTABLE_ROLES as readonly string[]).includes(up)) {
      return bad("INVALID_ROLE_FILTER", `Bộ lọc role không hợp lệ (chấp nhận: ${LISTABLE_ROLES.join(", ")})`);
    }
    out.role = up as ListableRole;
  }

  const status = one(query.status);
  if (status === null) return bad("INVALID_STATUS_FILTER", "Bộ lọc trạng thái không hợp lệ (chấp nhận: ACTIVE, INACTIVE)");
  if (status !== undefined && status.trim() !== "") {
    const up = status.trim().toUpperCase();
    if (up !== "ACTIVE" && up !== "INACTIVE") {
      return bad("INVALID_STATUS_FILTER", "Bộ lọc trạng thái không hợp lệ (chấp nhận: ACTIVE, INACTIVE)");
    }
    out.isActive = up === "ACTIVE";
  }

  const search = one(query.search);
  if (search === null) return bad("INVALID_SEARCH", "Từ khoá tìm kiếm không hợp lệ");
  if (search !== undefined && search.trim() !== "") {
    if (search.trim().length > 100) return bad("INVALID_SEARCH", "Từ khoá tìm kiếm tối đa 100 ký tự");
    out.searchKey = foldSearch(search.trim());
  }

  const id = one(query.id);
  if (id === null) return bad("INVALID_ID_FILTER", "Mã người dùng không hợp lệ");
  if (id !== undefined && id.trim() !== "") {
    if (id.trim().length > 64) return bad("INVALID_ID_FILTER", "Mã người dùng không hợp lệ");
    out.id = id.trim();
  }

  const rawIds = one(query.ids);
  if (rawIds === null) return bad("INVALID_IDS_FILTER", "Danh sách mã người dùng không hợp lệ");
  if (rawIds !== undefined && rawIds.trim() !== "") {
    const list = [...new Set(rawIds.split(",").map((x) => x.trim()).filter(Boolean))];
    if (list.length === 0 || list.length > 200 || list.some((x) => x.length > 64)) {
      return bad("INVALID_IDS_FILTER", "Cần từ 1 đến 200 mã người dùng, cách nhau bằng dấu phẩy");
    }
    out.ids = list;
  }

  const rawPage = one(query.page);
  const rawLimit = one(query.limit);
  if (rawPage !== undefined || rawLimit !== undefined) {
    const toInt = (raw: string | undefined | null, fallback: number): number | null => {
      if (raw === undefined) return fallback;
      if (raw === null || !/^\d{1,9}$/.test(raw)) return null;
      return Number(raw);
    };
    const page = toInt(rawPage, 1);
    const limit = toInt(rawLimit, USER_LIST_DEFAULT_LIMIT);
    if (page === null || limit === null || page < 1 || limit < 1 || limit > USER_LIST_MAX_LIMIT) {
      return bad(
        "INVALID_PAGINATION",
        `Phân trang không hợp lệ: page là số nguyên từ 1, limit là số nguyên từ 1 đến ${USER_LIST_MAX_LIMIT}.`,
      );
    }
    out.paging = { page, limit };
  }
  return out;
}

export function isUserListQueryError(v: UserListQuery | UserListQueryError): v is UserListQueryError {
  return "code" in v;
}
