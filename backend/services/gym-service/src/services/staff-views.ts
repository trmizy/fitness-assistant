import type { PartnerAccountRole } from '../generated/prisma';
import { hasPermission } from './partner-permissions';

/**
 * D15 — cách HIỂN THỊ cùng một dữ liệu cho từng vai trò. Cổng quyền (requirePermission) trả lời "có được đọc
 * không"; file này trả lời "đọc được TRƯỜNG nào". Cách làm là danh sách trường cho phép (allow-list): trường mới
 * thêm vào model sẽ KHÔNG tự lộ ra cho lễ tân/kế toán.
 */

type Row = Record<string, any>;

function pick(row: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

/** Thông tin chi nhánh dành cho vai trò chỉ-xem (lễ tân, kế toán): không có chủ sở hữu, ghi chú duyệt, userId nội bộ. */
const BRANCH_INFO_FIELDS = [
  'id', 'brandId', 'name', 'address', 'city', 'phone', 'email', 'description', 'locationNote',
  'latitude', 'longitude', 'facilities', 'status', 'operationalStatus', 'closureReason', 'expectedReopenAt',
  'closedAt', 'reopenedAt', 'averageRating', 'reviewCount', 'activeMemberCount', 'brand',
] as const;

const BRAND_BRIEF_FIELDS = ['id', 'name', 'approvedName', 'logoUrl'] as const;

export function branchInfoFor(role: PartnerAccountRole, gym: Row): Row {
  if (role === 'OWNER' || role === 'MANAGER') return gym; // OWNER, MANAGER: nguyên trạng như trước
  const view = pick(gym, BRANCH_INFO_FIELDS);
  if (view.brand && typeof view.brand === 'object') view.brand = pick(view.brand, BRAND_BRIEF_FIELDS);
  return view;
}

/** Lễ tân: chỉ thứ cần để biết "thẻ này còn dùng được không" — KHÔNG giá, mã giao dịch, chia tiền, hoàn tiền. */
const FRONT_DESK_MEMBERSHIP_FIELDS = [
  'id', 'gymId', 'planId', 'clientId', 'status', 'startDate', 'endDate', 'totalVisits', 'usedVisits', 'createdAt',
] as const;

/** Kế toán: dữ liệu bán hàng/đối soát — KHÔNG có clientId (danh tính hội viên), không có lượt tập. */
const SALES_MEMBERSHIP_FIELDS = [
  'id', 'gymId', 'planId', 'status', 'paymentTxnId', 'priceAtPurchase', 'durationDaysSnapshot',
  'startDate', 'endDate', 'payoutReleasedAt', 'createdAt', 'updatedAt',
] as const;

export type MembershipView = 'FULL' | 'SALES' | 'FRONT_DESK';

/** Mức xem cao nhất vai trò có; null = không có quyền nào (route đã chặn trước, đây chỉ là lớp phòng thủ). */
export function membershipViewFor(role: PartnerAccountRole): MembershipView | null {
  if (hasPermission(role, 'membership.full')) return 'FULL';
  if (hasPermission(role, 'membership.sales')) return 'SALES';
  if (hasPermission(role, 'membership.validity')) return 'FRONT_DESK';
  return null;
}

export function membershipsFor(role: PartnerAccountRole, rows: Row[]): Row[] {
  const view = membershipViewFor(role);
  if (view === 'FULL') return rows;
  if (view === 'SALES') return rows.map((r) => pick(r, SALES_MEMBERSHIP_FIELDS));
  if (view === 'FRONT_DESK') return rows.map((r) => pick(r, FRONT_DESK_MEMBERSHIP_FIELDS));
  return [];
}

/** Lịch sử check-in tại quầy: lễ tân không cần biết ai là người quét mã nội bộ. */
export function checkinsFor(role: PartnerAccountRole, rows: Row[]): Row[] {
  if (role === 'OWNER' || role === 'MANAGER') return rows;
  return rows.map((r) => pick(r, ['id', 'membershipId', 'gymId', 'clientId', 'createdAt']));
}

/**
 * Yêu cầu rút tiền cho kế toán: giữ nguyên số tiền/trạng thái/mã tham chiếu (để đối soát) nhưng CHE số tài khoản
 * ngân hàng trong `payoutInfo` (văn bản tự do) — chỉ còn 4 số cuối. Kế toán đối soát được, không lấy được thông
 * tin nhận tiền của chủ.
 */
export function maskPayoutInfo(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  return text.replace(/\d{5,}/g, (m) => `${'•'.repeat(m.length - 4)}${m.slice(-4)}`);
}

export function withdrawalsFor(role: PartnerAccountRole, rows: Row[]): Row[] {
  if (role === 'OWNER') return rows;
  return rows.map((r) => ({ ...r, payoutInfo: maskPayoutInfo(r.payoutInfo) }));
}
