import { logger } from "@gym-coach/shared";
import { PROFILE_READ_ORIGIN } from "../../services/fitness-agent-tools";

/**
 * How a failed profile read (`getUserFitnessContext` → user-service `/profile/agent/context`) is understood at the conversation boundary.
 *
 * ORIGIN FIRST: only an error that the profile read itself raised (`origin === "profile-read"`, set by fitnessAgentTools.getUserFitnessContext)
 * is ever classified as a profile condition. A status code alone proves nothing — a 503 from the food-substitution, PT-search or workout
 * tools is NOT a profile outage and must stay the real error it is. Within a profile-read error the status decides:
 *
 *   PROFILE_MISSING       422 "Complete your profile first" — the user has no profile row. A known, expected condition: answer with guidance.
 *   UPSTREAM_UNAVAILABLE  502/503/504 — the profile service cannot be reached right now: a transient, honest "try again" (still logged).
 *   AUTHORIZATION         401/403 — never turned into a successful answer; rethrown so the caller/gateway sees a real auth failure.
 *   UNEXPECTED            everything else, and EVERY error that did not come from the profile read — rethrown, so genuine defects stay visible.
 */
export type ProfileReadFailure = "PROFILE_MISSING" | "UPSTREAM_UNAVAILABLE" | "AUTHORIZATION" | "UNEXPECTED";

export function isProfileReadError(err: unknown): boolean {
  return Boolean(err) && typeof err === "object" && (err as { origin?: unknown }).origin === PROFILE_READ_ORIGIN;
}

export function classifyProfileReadError(err: unknown): ProfileReadFailure {
  if (!isProfileReadError(err)) return "UNEXPECTED";
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
  const message = err instanceof Error ? err.message : "";
  if (status === 422 && /complete your profile/i.test(message)) return "PROFILE_MISSING";
  if (status === 401 || status === 403) return "AUTHORIZATION";
  if (status === 502 || status === 503 || status === 504) return "UPSTREAM_UNAVAILABLE";
  return "UNEXPECTED";
}

export const MISSING_PROFILE_ANSWER =
  "Mình chưa có hồ sơ của bạn nên chưa thể trả lời chính xác câu này — và mình sẽ không đoán số liệu của bạn. " +
  "Bạn vào phần Hồ sơ (hoặc hoàn tất bước giới thiệu ban đầu) để bổ sung: chiều cao, cân nặng hiện tại, tuổi, giới tính và mục tiêu tập luyện. " +
  "Xong bạn hỏi lại mình nhé.";

export const PROFILE_UNAVAILABLE_ANSWER =
  "Mình chưa đọc được hồ sơ của bạn lúc này (dịch vụ hồ sơ đang gián đoạn). Bạn thử lại sau ít phút nhé — mình chưa thay đổi gì.";

/**
 * The guided answer for a KNOWN profile condition, or null when the error must stay an error (authorization / unexpected / not from the
 * profile read). Never writes, never creates a profile, never starts a workflow: it only returns text. Structured diagnostics keep the distinction.
 */
export function profileFailureAnswer(err: unknown, meta: { correlationId?: string; userId: string; sessionId?: string }): string | null {
  const kind = classifyProfileReadError(err);
  const status = (err as { status?: number })?.status;
  if (kind === "PROFILE_MISSING") { logger.info({ ...meta, kind, status }, "ci_profile_missing"); return MISSING_PROFILE_ANSWER; }
  if (kind === "UPSTREAM_UNAVAILABLE") { logger.warn({ ...meta, kind, status }, "ci_profile_upstream_unavailable"); return PROFILE_UNAVAILABLE_ANSWER; }
  return null;
}

/** for best-effort sub-steps that used to swallow every error: a CLASSIFIED profile-read failure (missing, unavailable, authorization) must reach the boundary; anything else keeps the old best-effort behaviour */
export function rethrowProfileFailures(err: unknown): void {
  if (classifyProfileReadError(err) !== "UNEXPECTED") throw err;
}
