import { z } from "zod";

// Security review 2026-09-03 (L3) — min(8) alone accepted "password"/"12345678". This is the
// schema actually enforced on registration (registerStartSchema below is an alias of it) —
// @gym-coach/shared also exports a same-named registerSchema, now carrying the identical rule,
// but nothing currently imports that one for the real registration route; this file is the one
// that matters. loginSchema below stays a bare non-empty string on purpose — tightening login
// would reject existing users' real passwords that predate this rule.
const PASSWORD_COMPLEXITY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

/**
 * N-A-07 — THE password policy: >= 8 chars with an uppercase letter, a lowercase letter and a digit.
 * Registration, self-service change, reset-by-token and invite-accept all use this one definition
 * (reset/change/invite used to check only `length >= 8`, so "alllowercase1" got in through them).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_POLICY_MESSAGE_VI =
  "Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường và chữ số";
export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .regex(PASSWORD_COMPLEXITY, "Password must contain an uppercase letter, a lowercase letter, and a number");

/** Vietnamese message when `password` breaks the policy, otherwise null. */
export function passwordPolicyViolation(password: unknown): string | null {
  return passwordPolicySchema.safeParse(password).success ? null : PASSWORD_POLICY_MESSAGE_VI;
}

// C4-01 / C1-01 — emails are case-insensitive in practice (phone keyboards capitalise the first
// letter), so every new write/lookup path normalises trim + lowercase, the same way
// partnerApplicationStartSchema does. Registration used to keep the typed case, which let
// "Foo@x.com" create a second account next to "foo@x.com".
const normalizedEmail = z.string().trim().toLowerCase().email().max(254);

// N13A-06: names are capped (the profile update already caps them at 100).
// N13A-14: older web builds send "." as the last name of a one-word full name. A last name that is empty or only dots is "no last name": it is dropped
// here, so it is never stored (it would be shown as "Nguyễn ." everywhere).
const optionalLastName = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => (v === undefined || /^\.*$/.test(v) ? undefined : v));

export const registerSchema = z.object({
  email: normalizedEmail,
  password: passwordPolicySchema,
  firstName: z.string().trim().max(100).optional(),
  lastName: optionalLastName,
});

export const registerStartSchema = registerSchema;

export const registerVerifySchema = z.object({
  email: normalizedEmail,
  otp: z.string().min(6).max(6),
});

// GAP-5 (MOBILE_BACKEND_GAPS.md) — re-issue the code for a sign-up still waiting on email
// verification. Only the email: the pending row already holds the hashed password and name from
// the original POST /auth/register, so a resend can never change what account gets created.
export const registerResendSchema = z.object({
  email: normalizedEmail,
});

// GAP-4 — self-service "forgot password". Deliberately email-only: nothing the caller sends may
// influence where the emailed link points (see authController.requestPasswordReset).
export const passwordResetRequestSchema = z.object({
  email: normalizedEmail,
});

// Login keeps the typed case (trim only): authRepository.findUserByEmail tries the exact spelling
// first so a legacy pair of accounts that differ only by case can still be told apart; otherwise
// it matches case-insensitively.
export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string(),
});

export const refreshSchema = z.object({
  refreshToken: z.string(),
});

export const updateMeSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordPolicySchema,
});

// Money-flow plan 5.1: GYM_STAFF removed — see schema.prisma's Role enum comment.
export const roleSchema = z.enum(["ADMIN", "CUSTOMER", "PT", "GYM_OWNER"]);

export const updateUserRoleSchema = z.object({
  role: roleSchema,
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type RegisterStartDto = z.infer<typeof registerStartSchema>;
export type RegisterVerifyDto = z.infer<typeof registerVerifySchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type UpdateMeDto = z.infer<typeof updateMeSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
export type UpdateUserRoleDto = z.infer<typeof updateUserRoleSchema>;

/**
 * N13A-01: registration / OTP validation failures used to answer a bare English "Validation failed" that the web showed verbatim.
 * Turn the first Zod issue into a Vietnamese sentence + a stable code (the raw `details` stay for clients that want them).
 */
export function describeValidationError(error: z.ZodError): { error: string; code: string } {
  const paths = error.errors.map((e) => String(e.path[0] ?? ""));
  if (paths.includes("password") || paths.includes("newPassword")) {
    return { error: PASSWORD_POLICY_MESSAGE_VI, code: "WEAK_PASSWORD" };
  }
  if (paths.includes("email")) return { error: "Email không hợp lệ", code: "INVALID_EMAIL" };
  if (paths.includes("firstName") || paths.includes("lastName")) return { error: "Họ và tên không hợp lệ (tối đa 100 ký tự)", code: "NAME_TOO_LONG" };
  if (paths.includes("otp")) return { error: "Mã xác nhận gồm 6 chữ số", code: "OTP_FORMAT_INVALID" };
  return { error: "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại thông tin đã nhập.", code: "VALIDATION_FAILED" };
}
