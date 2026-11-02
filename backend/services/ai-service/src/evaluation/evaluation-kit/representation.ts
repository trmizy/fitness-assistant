/** One idempotent representation for persistence and integrity checks. No raw secret archive. */
import { digest } from "./identity";
function text(value: string): string {
  return value.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|secret(?:accesskey)?|sessiontoken|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]");
}
export function redact(value: unknown): unknown {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [text(k), /credential|api.?key|secret|password|sessiontoken/i.test(k) ? "[REDACTED]" : redact(v)]));
  return value;
}
export function protect(value: unknown) {
  const safe = redact(value), originalHash = digest(value), storedHash = digest(safe);
  if (digest(redact(safe)) !== storedHash) throw new Error("RedactionNotIdempotent");
  return { value: safe, receipt: { originalHash, storedHash, changed: originalHash !== storedHash } };
}
