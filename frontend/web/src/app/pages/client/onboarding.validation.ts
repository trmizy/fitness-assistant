/**
 * N13A-13 - the onboarding "session duration" answer must satisfy the same rule the backend enforces
 * (user-service profileSchema: sessionDurationMinutes is an integer 10-240), so the user hears it in Vietnamese
 * on the step itself instead of getting a generic save error at the end.
 */
export const SESSION_DURATION_MIN = 10;
export const SESSION_DURATION_MAX = 240;

/** Returns a Vietnamese error message, or null when the answer is valid. */
export function validateSessionDuration(raw: string): string | null {
  const text = raw.trim();
  const range = `${SESSION_DURATION_MIN}–${SESSION_DURATION_MAX} phút`;
  if (text === "") return `Vui lòng nhập thời lượng mỗi buổi tập, từ ${range}.`;
  if (!/^\d+$/.test(text)) return `Thời lượng mỗi buổi phải là số nguyên phút, từ ${range}.`;
  const minutes = Number(text);
  if (minutes < SESSION_DURATION_MIN || minutes > SESSION_DURATION_MAX) {
    return `Thời lượng mỗi buổi phải từ ${range}.`;
  }
  return null;
}
