/**
 * N-A-07 — the account password rule, mirrored from auth-service (`passwordPolicySchema` in
 * auth.models.ts, the one the backend enforces for registration, change, reset and invite-accept):
 * at least 8 characters with an uppercase letter, a lowercase letter and a digit.
 * The server stays the authority; this only keeps the forms from sending an obviously weak password.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Shown under / next to every "new password" field. */
export const PASSWORD_POLICY_HINT = "Ít nhất 8 ký tự, gồm chữ hoa, chữ thường và chữ số";

export function isPasswordPolicyMet(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

/** Vietnamese sentence when the password is too weak, otherwise null. */
export function passwordPolicyError(password: string): string | null {
  return isPasswordPolicyMet(password) ? null : `Mật khẩu cần có ${PASSWORD_POLICY_HINT.charAt(0).toLowerCase()}${PASSWORD_POLICY_HINT.slice(1)}.`;
}
