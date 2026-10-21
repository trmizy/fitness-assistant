import type { PartnerAccountRole } from '../generated/prisma';

/**
 * D15 — danh mục quyền của vai trò nội bộ trong một đối tác gym. ĐÂY LÀ NƠI DUY NHẤT trả lời
 * "vai trò X làm được việc Y không"; mọi route /owner đều đi qua `requirePermission(...)`
 * (partner-context.middleware.ts) hoặc `requirePartnerOwner` — không route nào tự so sánh `role`.
 *
 * Nguyên tắc:
 *   • Mặc định TỪ CHỐI. Một quyền không có trong GRANTS của vai trò thì vai trò đó không có.
 *   • `Record<PartnerAccountRole, ...>` vét cạn enum: thêm một vai trò mới vào schema làm file này không biên
 *     dịch được cho tới khi có người quyết định vai trò đó được làm gì (cùng tinh thần partner-access.policy.ts).
 *   • Phạm vi (chi nhánh) là trục RIÊNG, xem `canAccessGym`. Vai trò chỉ trả lời "được làm loại việc gì".
 *
 * Ma trận (✅ = có; ranh giới một câu: **tiền và người thì chỉ chủ sở hữu**):
 *
 *   quyền                          OWNER  MANAGER  RECEPTIONIST  ACCOUNTANT
 *   branch.view  (xem chi nhánh)     ✅      ✅        ✅ (rút gọn)   ✅ (rút gọn)
 *   brand.view                       ✅      ✅        —              ✅ (lọc theo phạm vi)
 *   plan.view    (gói + giá)         ✅      ✅        —              ✅
 *   membership.full                  ✅      ✅        —              —
 *   membership.sales  (doanh số)     ✅      —         —              ✅ (không có clientId)
 *   checkin.qr / checkin.list        ✅      ✅        ✅ (chỉ tên)    —
 *   ptCheckin.list                   ✅      ✅        —              —
 *   ptCheckin.today (PT hôm nay)     ✅      ✅        ✅ (chi nhánh được gán) —
 *   frontDesk.clients (khách hôm nay) ✅     ✅        ✅ (chỉ tên hiển thị)   —
 *   finance.ptCommission.view        ✅      —         —              ✅ (CHỈ tổng, không theo PT)
 *   branch.status.temporary          ✅      ✅        —              —
 *   finance.wallet.view              ✅      —         —              ✅
 *   finance.withdrawals.view         ✅      —         —              ✅ (che số tài khoản)
 *   finance.export                   ✅      —         —              ✅ (xuất từ dữ liệu đã đọc được)
 *
 * Quyết định của chủ sở hữu (D15b, đã chốt): kế toán KHÔNG có danh tính hội viên (chỉ mã giao dịch / gói / giá /
 * số tiền / ngày / trạng thái / hoàn tiền) và chỉ thấy TỔNG hoa hồng PT theo kỳ, không điều khoản cộng tác hay tỷ lệ
 * từng PT; lễ tân KHÔNG check-in hộ (không có route ghi), KHÔNG có danh sách hội viên đầy đủ — chỉ tên hiển thị của
 * khách có lịch hẹn/check-in tại chi nhánh hôm nay và danh sách PT đã check-in hôm nay tại chi nhánh được gán.
 *   mọi quyền GHI / người / hợp tác PT / đóng cửa vĩnh viễn → OWNER_ONLY, chỉ OWNER.
 */
export const OWNER_ONLY_PERMISSIONS = [
  'staff.manage',
  'brand.write',
  'branch.write',
  'branch.status.permanent',
  'plan.write',
  'collaboration.manage',
  'finance.withdraw',
  'listing.manage',
] as const;

export const SHARED_PERMISSIONS = [
  'branch.view',
  'brand.view',
  'plan.view',
  'membership.full',
  'membership.sales',
  'checkin.qr',
  'checkin.list',
  'ptCheckin.list',
  'ptCheckin.today',
  'frontDesk.clients',
  'branch.status.temporary',
  'finance.wallet.view',
  'finance.withdrawals.view',
  'finance.export',
  'finance.ptCommission.view',
] as const;

export type OwnerOnlyPermission = (typeof OWNER_ONLY_PERMISSIONS)[number];
export type SharedPermission = (typeof SHARED_PERMISSIONS)[number];
export type PartnerPermission = OwnerOnlyPermission | SharedPermission;

export const ALL_PERMISSIONS: readonly PartnerPermission[] = [...OWNER_ONLY_PERMISSIONS, ...SHARED_PERMISSIONS];

const GRANTS: Record<PartnerAccountRole, ReadonlySet<PartnerPermission>> = {
  OWNER: new Set<PartnerPermission>(ALL_PERMISSIONS),
  MANAGER: new Set<PartnerPermission>([
    'branch.view',
    'brand.view',
    'plan.view',
    'membership.full',
    'checkin.qr',
    'checkin.list',
    'ptCheckin.list',
    'ptCheckin.today',
    'frontDesk.clients',
    'branch.status.temporary',
  ]),
  RECEPTIONIST: new Set<PartnerPermission>([
    'branch.view',
    'checkin.qr',
    'checkin.list',
    'ptCheckin.today',
    'frontDesk.clients',
  ]),
  ACCOUNTANT: new Set<PartnerPermission>([
    'branch.view',
    'brand.view',
    'plan.view',
    'membership.sales',
    'finance.wallet.view',
    'finance.withdrawals.view',
    'finance.export',
    'finance.ptCommission.view',
  ]),
};

export function hasPermission(role: PartnerAccountRole, permission: PartnerPermission): boolean {
  return GRANTS[role]?.has(permission) ?? false;
}

export function permissionsOf(role: PartnerAccountRole): PartnerPermission[] {
  return ALL_PERMISSIONS.filter((p) => hasPermission(role, p));
}

export function hasAnyPermission(role: PartnerAccountRole, permissions: readonly PartnerPermission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/** Vai trò nào có thể được MỜI bởi chủ sở hữu (OWNER không mời được — chỉ chuyển quyền, do admin). */
export const INVITABLE_STAFF_ROLES = ['MANAGER', 'RECEPTIONIST', 'ACCOUNTANT'] as const satisfies readonly PartnerAccountRole[];
export type InvitableStaffRole = (typeof INVITABLE_STAFF_ROLES)[number];

export function isInvitableStaffRole(value: unknown): value is InvitableStaffRole {
  return typeof value === 'string' && (INVITABLE_STAFF_ROLES as readonly string[]).includes(value);
}

/** Vai trò bắt buộc có ít nhất một chi nhánh (ACCOUNTANT không: rỗng = kế toán cả thương hiệu). */
export function roleRequiresBranchScope(role: PartnerAccountRole): boolean {
  return role === 'MANAGER' || role === 'RECEPTIONIST';
}

export interface ScopeSubject {
  role: PartnerAccountRole;
  scopedGymIds: readonly string[];
}

/**
 * Chi nhánh `gymId` có nằm trong phạm vi của tài khoản không. CHỈ trả lời câu hỏi phạm vi — "chi nhánh này có
 * thuộc đối tác này không" vẫn do gymService.getOwnedGym trả lời (cần cả hai, xem requireGymScope).
 *   OWNER      : mọi chi nhánh.
 *   ACCOUNTANT : rỗng = mọi chi nhánh của đối tác (phạm vi thương hiệu); có phần tử = chỉ các chi nhánh đó.
 *   còn lại    : chỉ chi nhánh được gán.
 */
export function canAccessGym(subject: ScopeSubject, gymId: string): boolean {
  if (subject.role === 'OWNER') return true;
  if (subject.role === 'ACCOUNTANT' && subject.scopedGymIds.length === 0) return true;
  return subject.scopedGymIds.includes(gymId);
}

/** Lọc một danh sách có `id` theo phạm vi (dùng cho danh sách chi nhánh / chi nhánh của thương hiệu). */
export function filterByScope<T extends { id: string }>(subject: ScopeSubject, rows: readonly T[]): T[] {
  if (subject.role === 'OWNER') return [...rows];
  return rows.filter((r) => canAccessGym(subject, r.id));
}
