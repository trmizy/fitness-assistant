/**
 * N13A-01/02/03: Vietnamese messages for register / OTP / change-password failures. The web matches on the stable `code`
 * (or status 409), never on the sentence — the backend used to answer "Email already registered" while the page compared
 * against "Email đã đăng ký" (so the "Đăng nhập ngay" action never showed), and weak passwords showed "Validation failed".
 */
import { passwordPolicyError } from "./passwordPolicy";

const PASSWORD_POLICY_MESSAGE = passwordPolicyError("") as string;

type ApiErrorBody = { error?: unknown; message?: unknown; code?: unknown; details?: unknown };
type ApiError = { response?: { status?: number; data?: ApiErrorBody }; message?: unknown };

const VIETNAMESE_LETTER = /[ăâđêôơưÀ-ỹ]/;

const CODE_MESSAGE_VI: Record<string, string> = {
  EMAIL_ALREADY_REGISTERED: "Email này đã được đăng ký.",
  WEAK_PASSWORD: PASSWORD_POLICY_MESSAGE,
  INVALID_EMAIL: "Email không hợp lệ.",
  OTP_FORMAT_INVALID: "Mã xác nhận gồm 6 chữ số.",
  OTP_INVALID: "Mã xác nhận không đúng.",
  OTP_EXPIRED: "Mã xác nhận đã hết hạn. Hãy gửi lại mã mới.",
  OTP_NOT_FOUND: "Không tìm thấy mã xác nhận. Hãy gửi lại mã mới.",
  OTP_ATTEMPTS_EXCEEDED: "Bạn đã nhập sai quá nhiều lần. Hãy gửi lại mã mới.",
  CURRENT_PASSWORD_INCORRECT: "Mật khẩu hiện tại không đúng.",
  NEW_PASSWORD_SAME_AS_CURRENT: "Mật khẩu mới phải khác mật khẩu hiện tại.",
  VALIDATION_FAILED: "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại thông tin đã nhập.",
};

/** Older auth-service builds answered these in English with no code; keep mapping them so a half-deployed stack still reads Vietnamese. */
const LEGACY_TEXT_VI: Array<[RegExp, string]> = [
  [/^email already registered$/i, CODE_MESSAGE_VI.EMAIL_ALREADY_REGISTERED],
  [/^invalid otp$/i, CODE_MESSAGE_VI.OTP_INVALID],
  [/^otp expired$/i, CODE_MESSAGE_VI.OTP_EXPIRED],
  [/^otp not found$/i, CODE_MESSAGE_VI.OTP_NOT_FOUND],
  [/^otp attempts exceeded$/i, CODE_MESSAGE_VI.OTP_ATTEMPTS_EXCEEDED],
  [/^current password is incorrect$/i, CODE_MESSAGE_VI.CURRENT_PASSWORD_INCORRECT],
  [/^new password must be different$/i, CODE_MESSAGE_VI.NEW_PASSWORD_SAME_AS_CURRENT],
];

export function apiErrorCode(error: unknown): string | null {
  const code = (error as ApiError)?.response?.data?.code;
  return typeof code === "string" ? code : null;
}

/** register(): the e-mail is already taken (409 or the stable code). */
export function isEmailAlreadyRegistered(error: unknown): boolean {
  return apiErrorCode(error) === "EMAIL_ALREADY_REGISTERED" || (error as ApiError)?.response?.status === 409;
}

function validationIssueMessage(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const paths = details.map((d) => (Array.isArray((d as { path?: unknown })?.path) ? String((d as { path: unknown[] }).path[0]) : ""));
  if (paths.includes("password") || paths.includes("newPassword")) return CODE_MESSAGE_VI.WEAK_PASSWORD;
  if (paths.includes("email")) return CODE_MESSAGE_VI.INVALID_EMAIL;
  if (paths.includes("otp")) return CODE_MESSAGE_VI.OTP_FORMAT_INVALID;
  return null;
}

export function authErrorMessage(error: unknown, fallback: string): string {
  const e = error as ApiError | null;
  const res = e?.response;
  if (!res) return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  const code = apiErrorCode(error);
  if (code && CODE_MESSAGE_VI[code]) return CODE_MESSAGE_VI[code];
  const raw = typeof res.data?.error === "string" ? res.data.error : typeof res.data?.message === "string" ? res.data.message : "";
  for (const [re, vi] of LEGACY_TEXT_VI) if (re.test(raw.trim())) return vi;
  if (/^validation failed$/i.test(raw.trim())) return validationIssueMessage(res.data?.details) ?? CODE_MESSAGE_VI.VALIDATION_FAILED;
  if (res.status === 429 && !VIETNAMESE_LETTER.test(raw)) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  if (raw && VIETNAMESE_LETTER.test(raw)) return raw;
  return fallback;
}
