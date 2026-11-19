/**
 * Concurrent-login rule: one account may be signed in on at most TWO devices at once — one web
 * (computer) and one mobile (phone app). A new login on a platform signs out the previous session of
 * THAT platform only; the other platform is never touched.
 *
 * The platform comes from the `X-Gymini-Client` header the mobile app attaches to every gateway request
 * (`mobile/<version>/<build>`; the web app sends none or `web/<version>`). Absent or unknown = web.
 * The header is client-controlled, which is fine: it only decides which of the caller's OWN two slots a
 * session occupies, never anyone else's.
 */
export type SessionPlatform = "web" | "mobile";

export const SESSION_REPLACED_CODE = "SESSION_REPLACED";
export const SESSION_REPLACED_MESSAGE =
  "Tài khoản đã đăng nhập trên thiết bị khác. Bạn đã được đăng xuất khỏi thiết bị này.";

export function resolveSessionPlatform(header: string | string[] | undefined | null): SessionPlatform {
  const raw = Array.isArray(header) ? header[0] : header;
  const kind = String(raw ?? "").trim().toLowerCase().split("/")[0];
  return kind === "mobile" ? "mobile" : "web";
}
