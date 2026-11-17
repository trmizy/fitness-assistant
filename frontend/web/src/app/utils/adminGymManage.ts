/**
 * FIX2-ADMIN (15/11/2026) - pure rules of the admin "Tất cả chi nhánh" tab.
 *
 *  1. N14A-01: the edit form used to send EVERY field, `description` included, and the server (gym.controller updateAsAdmin) demands a reason of
 *     at least 10 characters whenever `description` is present - so every save failed. Now only changed fields are sent, and the reason box
 *     (with its own validation) exists only while the public introduction text really changed.
 *  2. Q5: the actions an admin may run on one branch (tạm khoá / bỏ tạm khoá / tạm đóng cửa / mở cửa lại) with the Vietnamese effect of each.
 *     The state rules mirror gym-service gym-admin-lifecycle.service.ts, which stays the authority.
 *
 * Pure (no React): runs under `npx tsx --test`.
 */

export const MIN_ADMIN_REASON = 10;
export const MAX_ADMIN_REASON = 500;

export interface GymEditForm {
  name: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  description: string;
}

export interface GymEditSource {
  name: string;
  approvedName?: string | null;
  address: string;
  approvedAddress?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
}

/** The values the form starts from (the approved name / address are what the public sees). */
export function gymEditFormFrom(g: GymEditSource): GymEditForm {
  return {
    name: g.approvedName ?? g.name,
    address: g.approvedAddress ?? g.address,
    city: g.city ?? "",
    phone: g.phone ?? "",
    email: g.email ?? "",
    description: g.description ?? "",
  };
}

export interface GymEditPatch {
  patch: Partial<GymEditForm>;
  /** the public introduction text changed: the server then needs a reason */
  descriptionChanged: boolean;
}

const same = (a: string, b: string) => a.trim() === b.trim();

/** Only the fields whose trimmed value differs from the start. Name / address are never sent empty (the save button already requires them). */
export function buildGymEditPatch(initial: GymEditForm, now: GymEditForm): GymEditPatch {
  const patch: Partial<GymEditForm> = {};
  (Object.keys(initial) as Array<keyof GymEditForm>).forEach((k) => {
    if (!same(initial[k], now[k])) patch[k] = now[k].trim();
  });
  return { patch, descriptionChanged: "description" in patch };
}

/** null = fine. Same wording as the server so the two never disagree. */
export function adminReasonError(reason: string, required = true): string | null {
  const n = reason.trim().length;
  if (n === 0 && !required) return null;
  if (n < MIN_ADMIN_REASON) return `Cần nhập lý do (tối thiểu ${MIN_ADMIN_REASON} ký tự).`;
  if (n > MAX_ADMIN_REASON) return `Lý do không được vượt quá ${MAX_ADMIN_REASON} ký tự.`;
  return null;
}

export type GymEditValidity = { ok: true; body: Record<string, unknown> } | { ok: false; reasonError: string | null; nothingChanged: boolean };

/** Whether the form can be saved and the exact request body. `reason` rides along only with a changed description. */
export function validateGymEdit(initial: GymEditForm, now: GymEditForm, reason: string): GymEditValidity {
  if (!now.name.trim() || !now.address.trim()) return { ok: false, reasonError: null, nothingChanged: false };
  const { patch, descriptionChanged } = buildGymEditPatch(initial, now);
  if (Object.keys(patch).length === 0) return { ok: false, reasonError: null, nothingChanged: true };
  if (descriptionChanged) {
    const reasonError = adminReasonError(reason);
    if (reasonError) return { ok: false, reasonError, nothingChanged: false };
    return { ok: true, body: { ...patch, reason: reason.trim() } };
  }
  return { ok: true, body: { ...patch } };
}

// ── Q5: branch lifecycle actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LifecycleAction = "SUSPEND" | "LIFT_SUSPENSION" | "CLOSE_TEMPORARILY" | "REOPEN";

export interface LifecycleMeta {
  action: LifecycleAction;
  /** menu item / dialog title */
  label: string;
  confirmLabel: string;
  /** what happens, in words for an admin who is not a developer */
  effect: string;
  reasonRequired: boolean;
  reasonLabel: string;
  danger: boolean;
  /** only CLOSE_TEMPORARILY: an optional "expected to reopen on" date */
  askReopenDate: boolean;
}

export const LIFECYCLE: Record<LifecycleAction, LifecycleMeta> = {
  SUSPEND: {
    action: "SUSPEND",
    label: "Tạm khoá chi nhánh",
    confirmLabel: "Tạm khoá",
    effect:
      "Hội viên đang có gói vẫn check-in bình thường tới hết hạn. Chi nhánh bị ẩn khỏi tìm kiếm và không bán gói mới. Gói đang có không bị huỷ và không tự hoàn tiền — nếu cần hoàn tiền, xử lý riêng bằng hành động Hoàn tiền. Chủ gym vẫn sửa được tin giới thiệu. Có thể bỏ tạm khoá bất cứ lúc nào.",
    reasonRequired: true,
    reasonLabel: "Lý do tạm khoá",
    danger: true,
    askReopenDate: false,
  },
  LIFT_SUSPENSION: {
    action: "LIFT_SUSPENSION",
    label: "Bỏ tạm khoá",
    confirmLabel: "Bỏ tạm khoá",
    effect: "Chi nhánh được hiện lại trong tìm kiếm và bán gói mới trở lại. Hội viên vẫn check-in bình thường.",
    reasonRequired: false,
    reasonLabel: "Ghi chú (không bắt buộc)",
    danger: false,
    askReopenDate: false,
  },
  CLOSE_TEMPORARILY: {
    action: "CLOSE_TEMPORARILY",
    label: "Tạm đóng cửa",
    confirmLabel: "Tạm đóng cửa",
    effect:
      "Chi nhánh không còn trong danh sách tìm kiếm; ai mở đường dẫn trực tiếp sẽ thấy thông báo tạm đóng cửa kèm lý do và ngày dự kiến mở lại. Không bán được gói mới và không check-in được; gói đang có giữ nguyên. Chủ gym cũng thấy lý do này.",
    reasonRequired: true,
    reasonLabel: "Lý do tạm đóng cửa",
    danger: true,
    askReopenDate: true,
  },
  REOPEN: {
    action: "REOPEN",
    label: "Mở cửa lại",
    confirmLabel: "Mở cửa lại",
    effect: "Chi nhánh hoạt động trở lại: bán gói mới và nhận check-in như bình thường.",
    reasonRequired: false,
    reasonLabel: "Ghi chú (không bắt buộc)",
    danger: false,
    askReopenDate: false,
  },
};

export interface LifecycleState {
  status?: string | null;
  operationalStatus?: string | null;
}

/** Actions that make sense for the branch's CURRENT state, in menu order. A branch closed for good has none (owner's one-way decision). */
export function lifecycleActionsFor(g: LifecycleState): LifecycleMeta[] {
  const op = g.operationalStatus ?? "OPEN";
  if (op === "PERMANENTLY_CLOSED") return [];
  const out: LifecycleMeta[] = [];
  if (g.status === "APPROVED") out.push(LIFECYCLE.SUSPEND);
  if (g.status === "SUSPENDED") out.push(LIFECYCLE.LIFT_SUSPENSION);
  if ((g.status === "APPROVED" || g.status === "SUSPENDED") && op === "OPEN") out.push(LIFECYCLE.CLOSE_TEMPORARILY);
  if (op === "TEMPORARILY_CLOSED") out.push(LIFECYCLE.REOPEN);
  return out;
}

/** Body of PATCH /admin/gyms/:id/lifecycle. `reopenDate` is a yyyy-mm-dd value from a date input (the end of that day, local time). */
export function buildLifecycleBody(meta: LifecycleMeta, reason: string, reopenDate = ""): Record<string, unknown> {
  const body: Record<string, unknown> = { action: meta.action };
  if (reason.trim()) body.reason = reason.trim();
  if (meta.askReopenDate && reopenDate) {
    const [y, m, d] = reopenDate.split("-").map(Number);
    if (y && m && d) body.expectedReopenAt = new Date(y, m - 1, d, 23, 59, 0).toISOString();
  }
  return body;
}

/** null = fine. The date, when given, must be after today. */
export function lifecycleError(meta: LifecycleMeta, reason: string, reopenDate = "", now: Date = new Date()): { reason: string | null; date: string | null } {
  const reasonErr = adminReasonError(reason, meta.reasonRequired);
  let dateErr: string | null = null;
  if (meta.askReopenDate && reopenDate) {
    const [y, m, d] = reopenDate.split("-").map(Number);
    const end = y && m && d ? new Date(y, m - 1, d, 23, 59, 0) : null;
    if (!end || Number.isNaN(end.getTime())) dateErr = "Ngày mở cửa lại không hợp lệ.";
    else if (end.getTime() <= now.getTime()) dateErr = "Ngày mở cửa lại phải ở tương lai.";
  }
  return { reason: reasonErr, date: dateErr };
}
