/**
 * Hồ sơ của tôi (batch G6) - pure functions, no React. Same data and rules as the legacy `GymOwnerProfilePage`: contact phone
 * (`submitOnboardingContact`), payout account (`submitOnboardingPayout`, owner only; the ONLY source the withdrawal dialog of
 * Tài chính sends money to), password (`authService.changePassword`) and the branch shortcuts. What a person may see or change comes
 * from the server's permissions[] (fail-closed); nothing here reads a role name to decide.
 */
import type { CanFn } from "../../../utils/gymStaffRole";
import { isValidPhoneNumber } from "../../../utils/phone";

export const PROFILE_ROOT = "/gym-owner/profile";

// ----------------------------------------------------------------------------------------------------------------------- sections
export type ProfileSectionId = "phone" | "payout" | "password" | "links";
export const SECTION_DOM_ID: Record<ProfileSectionId, string> = {
  phone: "profile-phone",
  payout: "profile-payout",
  password: "profile-password",
  links: "profile-branches",
};
/** `?section=payout` is what the withdrawal dialog of Tài chính links to; anything else just opens the page at the top. */
export function parseSection(raw: string | null | undefined): ProfileSectionId | null {
  return raw === "phone" || raw === "payout" || raw === "password" || raw === "links" ? raw : null;
}
export const profileHref = (section?: ProfileSectionId): string => (section ? `${PROFILE_ROOT}?section=${section}` : PROFILE_ROOT);

/** The payout account is the owner's: `finance.withdraw` is the owner-only permission of the withdrawal that uses it, and the server sends `payout` to the owner only. */
export const showPayout = (can: CanFn, payout: unknown): boolean => can("finance.withdraw") && !!payout && typeof payout === "object";
export const showBrandLink = (can: CanFn): boolean => can("brand.view");

// ----------------------------------------------------------------------------------------------------------------------- phone
export interface PhoneState {
  dirty: boolean;
  valid: boolean;
  /** Said under the box only when something is typed and wrong. */
  problem: string | null;
}
export function phoneState(value: string, saved: string | null | undefined): PhoneState {
  const v = value.trim();
  const valid = isValidPhoneNumber(value);
  return { dirty: v !== (saved ?? ""), valid, problem: v && !valid ? "Số điện thoại chưa hợp lệ. Chỉ nhập chữ số, ví dụ 0901 234 567 hoặc +84 901 234 567." : null };
}

// ----------------------------------------------------------------------------------------------------------------------- payout
export interface PayoutForm {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}
export type SavedPayout = { bankName?: string | null; accountNumber?: string | null; accountHolder?: string | null } | null | undefined;
export const EMPTY_PAYOUT: PayoutForm = { bankName: "", accountNumber: "", accountHolder: "" };
export const payoutFrom = (p: SavedPayout): PayoutForm => ({ bankName: p?.bankName ?? "", accountNumber: p?.accountNumber ?? "", accountHolder: p?.accountHolder ?? "" });
export const hasPayoutOnFile = (p: SavedPayout): boolean => !!(p?.accountNumber && p.accountNumber.trim());
export function payoutDirty(saved: SavedPayout, f: PayoutForm): boolean {
  const b = payoutFrom(saved);
  return f.bankName.trim() !== b.bankName || f.accountNumber.trim() !== b.accountNumber || f.accountHolder.trim() !== b.accountHolder;
}
export const payoutValid = (f: PayoutForm): boolean => !!f.bankName.trim() && !!f.accountNumber.trim() && !!f.accountHolder.trim();
/** Exactly the body of the legacy page. */
export const payoutPayload = (f: PayoutForm): PayoutForm => ({ bankName: f.bankName.trim(), accountNumber: f.accountNumber.trim(), accountHolder: f.accountHolder.trim() });
export function payoutMissingField(f: PayoutForm): string | null {
  if (!f.bankName.trim()) return "Nhập tên ngân hàng.";
  if (!f.accountNumber.trim()) return "Nhập số tài khoản.";
  if (!f.accountHolder.trim()) return "Nhập tên chủ tài khoản.";
  return null;
}
export const PAYOUT_SOURCE_NOTE = "Đây là tài khoản duy nhất mà lệnh rút tiền của mọi chi nhánh được chuyển về. Màn Tài chính không cho nhập số tài khoản khác khi rút.";
export const PAYOUT_EMPTY_NOTE = "Chưa có tài khoản nhận tiền. Cho tới khi bạn khai báo, chưa tạo được lệnh rút tiền cho chi nhánh nào.";
export const payoutAuditNote = (email: string | undefined): string =>
  `Mỗi lần đổi, Gymini ghi nhật ký và gửi email báo tới ${email ?? "email của bạn"} để bảo vệ bạn.`;

// ----------------------------------------------------------------------------------------------------------------------- password
export const PASSWORD_MIN = 8;
export interface PasswordState {
  tooShort: boolean;
  mismatch: boolean;
  canSubmit: boolean;
  anyTyped: boolean;
}
export function passwordState(current: string, next: string, confirm: string): PasswordState {
  const tooShort = next.length > 0 && next.length < PASSWORD_MIN;
  const mismatch = confirm.length > 0 && next !== confirm;
  return { tooShort, mismatch, canSubmit: current.length > 0 && next.length >= PASSWORD_MIN && next === confirm, anyTyped: current !== "" || next !== "" || confirm !== "" };
}

// ----------------------------------------------------------------------------------------------------------------------- server answers
type ErrLike = { response?: { status?: number; data?: { error?: { message?: unknown } | string; message?: unknown } } } | null | undefined;
const VI = /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i;
function serverText(e: ErrLike): string | null {
  const err = e?.response?.data?.error;
  const m = typeof err === "string" ? err : typeof err?.message === "string" ? err.message : typeof e?.response?.data?.message === "string" ? e.response.data.message : null;
  return m && VI.test(m) ? m.trim() : null;
}
export type ProfileWrite = "phone" | "payout";
export interface ProfileFailure {
  text: string;
  /** A 5xx / no answer: the new value may already be saved. */
  unclear: boolean;
}
/** One Vietnamese sentence per answer for the two saves (the password uses the shared `authErrorMessage`). The server's own Vietnamese sentence wins on 400 / 409. */
export function profileFailure(error: unknown, what: ProfileWrite): ProfileFailure {
  const e = error as ErrLike;
  const status = e?.response?.status;
  const own = serverText(e);
  const noun = what === "phone" ? "số điện thoại" : "tài khoản nhận tiền";
  if (!e?.response) return { text: `Chưa kết nối được máy chủ nên chưa rõ ${noun} đã được lưu chưa. Tải lại trang để kiểm tra.`, unclear: true };
  if (status === 401) return { text: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", unclear: false };
  if (status === 403) return { text: what === "payout" ? "Chỉ chủ phòng tập đổi được tài khoản nhận tiền." : "Tài khoản này chưa được phép đổi số điện thoại liên hệ.", unclear: false };
  if (status === 404) return { text: "Không tìm thấy hồ sơ đối tác của tài khoản này. Liên hệ Gymini nếu cần cập nhật.", unclear: false };
  if (status === 409) return { text: own ?? `Hồ sơ đối tác đang ở trạng thái chưa cho đổi ${noun}. Tải lại trang rồi thử lại.`, unclear: false };
  if (status === 400 || status === 422) return { text: own ?? (what === "phone" ? "Số điện thoại chưa hợp lệ." : "Thông tin tài khoản nhận tiền chưa hợp lệ. Kiểm tra lại ngân hàng, số tài khoản và tên chủ tài khoản."), unclear: false };
  return { text: `Máy chủ gặp lỗi nên chưa rõ ${noun} đã được lưu chưa. Tải lại trang để kiểm tra.`, unclear: true };
}

// ----------------------------------------------------------------------------------------------------------------------- leaving
/** Something typed and not saved (a phone, a payout account, a password) asks before another page takes the screen. */
export function shouldAskBeforeLeaving(p: { dirty: boolean; from: { pathname: string }; to: { pathname: string } }): boolean {
  return p.dirty && p.from.pathname.replace(/\/$/, "") !== p.to.pathname.replace(/\/$/, "");
}

export const BRANCH_STATUS_WORD: Record<string, string> = {
  APPROVED: "Đang hiển thị",
  PENDING: "Chờ duyệt",
  PENDING_REVIEW: "Chờ duyệt",
  DRAFT: "Bản nháp",
  REJECTED: "Bị từ chối",
  SUSPENDED: "Tạm khoá",
};
export const branchStatusWord = (status: string | undefined): string => (status && BRANCH_STATUS_WORD[status]) || "Chưa rõ";
