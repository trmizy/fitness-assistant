/**
 * quotaCorrectionModel.ts
 * Pure functions and labels for Quota Correction (A48, A49).
 */
import type { QuotaCorrection } from "../disputeCaseTypes";
import { formatDateTime } from "./format";

export type QuotaDirection = "give_back" | "charge";

export const PROPOSE_QUOTA_CONFIRM =
  "Đề xuất thay đổi số buổi tập đã dùng. Đề xuất cần một quản trị viên khác duyệt trước khi có hiệu lực.";

export const APPROVE_QUOTA_CONFIRM =
  "Hiệu chỉnh số buổi đã dùng của hợp đồng. Quyết định có hiệu lực ngay lập tức và khép lại hệ quả này.";

/**
 * P2-FIX-2: Pure function to compute delta from direction and positive count.
 * - give_back (Trả lại buổi cho khách): delta = -count
 * - charge (Tính thêm buổi đã dùng): delta = +count
 * - count must be integer 1..100
 */
export function quotaDelta(
  direction: string | undefined,
  count: number | string,
): { ok: boolean; delta?: number; error?: string } {
  if (!direction || (direction !== "give_back" && direction !== "charge")) {
    return { ok: false, error: "Vui lòng chọn hướng hiệu chỉnh buổi." };
  }
  const n = typeof count === "string" ? Number(count.trim()) : count;
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: "Số buổi phải là số nguyên dương từ 1 đến 100." };
  }
  if (n < 1 || n > 100) {
    return { ok: false, error: "Số buổi hiệu chỉnh phải nằm trong khoảng từ 1 đến 100." };
  }
  const delta = direction === "give_back" ? -n : n;
  return { ok: true, delta };
}

/**
 * P2-FIX-2: Pending row and dialog description in words, never a signed number.
 */
export function quotaSentence(delta: number): string {
  if (delta < 0) {
    return `Trả lại ${Math.abs(delta)} buổi cho khách`;
  }
  if (delta > 0) {
    return `Tính thêm ${delta} buổi đã dùng`;
  }
  return "Không thay đổi số buổi";
}

/**
 * P2-FIX-2: History line for applied corrections.
 */
export function quotaHistoryLine(q: QuotaCorrection): string {
  const at = q.appliedAt ? formatDateTime(q.appliedAt) : "trước đây";
  const before = typeof q.usedBefore === "number" ? q.usedBefore : "?";
  const after = typeof q.usedAfter === "number" ? q.usedAfter : "?";
  return `Đã áp dụng ${at}: số buổi đã dùng ${before} → ${after}`;
}

