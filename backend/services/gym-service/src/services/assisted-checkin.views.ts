/**
 * D15c — hình dạng dữ liệu mà QUẦY LỄ TÂN nhận được khi tra cứu hội viên / check-in hộ. Danh sách trường CHO PHÉP
 * (allow-list): trường mới thêm vào model KHÔNG tự lộ ra. Không có: giá, mã giao dịch, lịch sử thanh toán, InBody /
 * sức khoẻ, SĐT, e-mail, địa chỉ, clientId, userId.
 */

type Row = Record<string, any>;

function pick(row: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

export type MemberDisplayStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

export const MEMBER_SEARCH_RESULT_FIELDS = [
  'membershipId', 'displayName', 'memberCode', 'planName', 'planType', 'status', 'expiresAt', 'branchScope',
  'coversThisBranch', 'remainingVisits', 'photoUrl', 'hasPhoto', 'canCheckIn', 'blockedReason',
] as const;

export interface MemberSearchResult {
  membershipId: string;
  displayName: string;
  /** XXXX-XXXX */
  memberCode: string;
  planName: string;
  /** VISIT_BASED = gói theo số buổi, TIME_BASED = gói theo thời hạn. */
  planType: 'VISIT_BASED' | 'TIME_BASED';
  status: MemberDisplayStatus;
  expiresAt: string | null;
  /** Gói thuộc THƯƠNG HIỆU: dùng được ở mọi chi nhánh của thương hiệu. */
  branchScope: 'BRAND';
  coversThisBranch: boolean;
  remainingVisits: number | null;
  photoUrl: string | null;
  hasPhoto: boolean;
  canCheckIn: boolean;
  blockedReason: string | null;
}

export function memberSearchResultView(row: Row): MemberSearchResult {
  return pick(row, MEMBER_SEARCH_RESULT_FIELDS) as unknown as MemberSearchResult;
}

export const ASSISTED_CHECKIN_RESULT_FIELDS = [
  'checkinId', 'checkedInAt', 'source', 'method', 'displayName', 'memberCode', 'planName', 'usedVisits', 'totalVisits',
  'remainingVisits', 'endDate', 'replayed',
] as const;

export function assistedCheckinResultView(row: Row): Row {
  return pick(row, ASSISTED_CHECKIN_RESULT_FIELDS);
}

export const EXCEPTION_VIEW_FIELDS = [
  'id', 'membershipId', 'status', 'displayName', 'memberCode', 'planName', 'requestReason', 'requestedByName',
  'createdAt', 'expiresAt', 'decisionReason', 'decidedByName', 'decidedAt', 'mine',
] as const;

export function exceptionView(row: Row): Row {
  return pick(row, EXCEPTION_VIEW_FIELDS);
}

/** 'a1b2c3d4' -> 'A1B2-C3D4'. */
export function formatMemberCode(code: string | null | undefined): string {
  const c = String(code ?? '').toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Bỏ mọi ký tự không phải chữ/số, IN HOA - để so khớp mã người dùng gõ (có/không dấu gạch, chữ thường). */
export function normalizeMemberCode(input: unknown): string {
  return String(input ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** Chữ thường, bỏ dấu tiếng Việt, đ -> d - để tìm theo tiền tố tên không phân biệt dấu. */
export function normalizeNameForSearch(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Tên khớp khi `query` là tiền tố của cả tên hoặc của MỘT từ trong tên (đều đã chuẩn hoá). */
export function nameMatchesPrefix(displayName: string, query: string): boolean {
  const name = normalizeNameForSearch(displayName);
  const q = normalizeNameForSearch(query);
  if (!q) return false;
  return name.startsWith(q) || name.split(' ').some((w) => w.startsWith(q));
}
