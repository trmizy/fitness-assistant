/**
 * B1-MONEY — pure client-side guards for the admin money actions. These only stop an obviously wrong
 * submit earlier; the backend stays authoritative (every one of these is re-checked server-side).
 * Pure: runs under `npx tsx --test`.
 */
import { formatVND } from "../../../utils/currency";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_RE.test(value.trim());

/** VND for display. Never "0" or "Liên hệ" for a missing/invalid number — "—" instead. */
export function moneyText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? formatVND(n) : "—";
}

export type RefundAmountProblem = "EMPTY" | "INVALID" | "NOT_POSITIVE" | "NO_CEILING" | "OVER_CEILING";

export type RefundAmountCheck =
  | { ok: true; amount: number; problem: null; message: null }
  | { ok: false; amount: number | null; problem: RefundAmountProblem; message: string | null };

/** Same tolerance the ai-service uses (`refundAmount > ceiling + 0.01` is rejected), tightened for float noise. */
const CEILING_EPSILON = 0.005;

/**
 * Checks a typed refund amount against `refundableCeiling`. `EMPTY` has no message (the field is just not filled
 * yet — do not shout at the admin); every other problem carries a Vietnamese sentence.
 */
export function checkRefundAmount(raw: string, ceiling: number | null | undefined): RefundAmountCheck {
  const text = raw.trim();
  if (text === "") return { ok: false, amount: null, problem: "EMPTY", message: null };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, amount: null, problem: "INVALID", message: "Nhập số tiền hợp lệ: số dương, tối đa 2 chữ số thập phân." };
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, amount: Number.isFinite(amount) ? amount : null, problem: "NOT_POSITIVE", message: "Số tiền hoàn phải lớn hơn 0." };
  }
  if (typeof ceiling !== "number" || !Number.isFinite(ceiling) || ceiling <= 0) {
    return { ok: false, amount, problem: "NO_CEILING", message: "Đơn này không còn số tiền nào có thể hoàn." };
  }
  if (amount - ceiling > CEILING_EPSILON) {
    return {
      ok: false,
      amount,
      problem: "OVER_CEILING",
      message: `Số tiền hoàn vượt mức còn có thể hoàn (${moneyText(ceiling)}).`,
    };
  }
  return { ok: true, amount, problem: null, message: null };
}

/** A required free-text field (bank reference, decision note, reject reason): non-empty after trimming. */
export const hasText = (raw: string): boolean => raw.trim().length > 0;

export interface MembershipIdCheck { ok: boolean; id: string; message: string | null }

/** Membership id pasted by the admin: blank = nothing to say yet, anything else must be a full UUID. */
export function checkMembershipId(raw: string): MembershipIdCheck {
  const id = raw.trim();
  if (id === "") return { ok: false, id, message: null };
  if (!isUuid(id)) return { ok: false, id, message: "Mã gói hội viên phải đúng định dạng UUID (36 ký tự, ví dụ 123e4567-e89b-12d3-a456-426614174000)." };
  return { ok: true, id, message: null };
}
