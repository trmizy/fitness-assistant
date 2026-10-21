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

/** Kế toán: dữ liệu bán hàng/đối soát — KHÔNG có clientId (danh tính hội viên), không có lượt tập. */
const SALES_MEMBERSHIP_FIELDS = [
  'id', 'gymId', 'planId', 'status', 'paymentTxnId', 'priceAtPurchase', 'durationDaysSnapshot',
  'startDate', 'endDate', 'payoutReleasedAt', 'createdAt', 'updatedAt',
] as const;

export type MembershipView = 'FULL' | 'SALES';

/** Mức xem cao nhất vai trò có; null = không có quyền nào (route đã chặn trước, đây chỉ là lớp phòng thủ). */
export function membershipViewFor(role: PartnerAccountRole): MembershipView | null {
  if (hasPermission(role, 'membership.full')) return 'FULL';
  if (hasPermission(role, 'membership.sales')) return 'SALES';
  return null;
}

export function membershipsFor(role: PartnerAccountRole, rows: Row[]): Row[] {
  const view = membershipViewFor(role);
  if (view === 'FULL') return rows;
  if (view === 'SALES') return rows.map((r) => pick(r, SALES_MEMBERSHIP_FIELDS));
  return [];
}

/**
 * Lịch sử check-in tại quầy. Chủ/quản lý: nguyên trạng. Lễ tân (D15b): CHỈ tên hiển thị + giờ vào — không clientId,
 * membershipId hay người quét; `clientName` do controller điền từ auth-service (xem client-display-name.service.ts).
 * Mọi vai trò khác (kể cả kế toán) không có route này; ở đây trả [] làm lớp phòng thủ.
 */
export function checkinsFor(role: PartnerAccountRole, rows: Row[], names: ReadonlyMap<string, string> = new Map()): Row[] {
  if (role === 'OWNER' || role === 'MANAGER') return rows;
  if (role !== 'RECEPTIONIST') return [];
  return rows.map((r) => ({
    id: r.id,
    gymId: r.gymId,
    createdAt: r.createdAt,
    clientName: names.get(r.clientId) ?? FALLBACK_CLIENT_NAME,
  }));
}

export const FALLBACK_CLIENT_NAME = 'Hội viên';
export const FALLBACK_PT_NAME = 'Huấn luyện viên';

/** Một dòng "khách hôm nay" của lễ tân: tên hiển thị + lý do có mặt trong danh sách — KHÔNG id, SĐT, email, thẻ, sức khoẻ. */
export interface FrontDeskClientRow {
  displayName: string;
  checkedInAt: string | null;
  bookedAt: string | null;
}
export const FRONT_DESK_CLIENT_FIELDS = ['displayName', 'checkedInAt', 'bookedAt'] as const;

export function frontDeskClientView(row: Row): FrontDeskClientRow {
  return pick(row, FRONT_DESK_CLIENT_FIELDS) as unknown as FrontDeskClientRow;
}

/** Một dòng "PT đã check-in hôm nay" của lễ tân: tên + giờ — không ptUserId, số buổi, hợp đồng, khách. */
export interface PtTodayRow {
  id: string;
  ptName: string;
  firstScanAt: string | Date;
  lastScanAt: string | Date;
}
export const PT_TODAY_FIELDS = ['id', 'ptName', 'firstScanAt', 'lastScanAt'] as const;

export function ptTodayView(row: Row): PtTodayRow {
  return pick(row, PT_TODAY_FIELDS) as unknown as PtTodayRow;
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

const ACCOUNTANT_WITHDRAWAL_FIELDS = [
  'id', 'amount', 'status', 'payoutInfo', 'bankReference', 'rejectionReason', 'paidAt', 'createdAt', 'updatedAt',
] as const;

export function withdrawalsFor(role: PartnerAccountRole, rows: Row[]): Row[] {
  if (role === 'OWNER') return rows;
  // Allow-list: không walletId / reviewedBy (id quản trị) / trường mới tự lộ ra cho kế toán.
  return rows.map((r) => ({ ...pick(r, ACCOUNTANT_WITHDRAWAL_FIELDS), payoutInfo: maskPayoutInfo(r.payoutInfo) }));
}
