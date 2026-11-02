/** One idempotent representation for persistence and integrity checks. No raw secret archive. */
import { digest } from "./identity";
function text(value: string): string {
  return value.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/\bBasic\s+([A-Za-z0-9+/]+={0,2})/gi, (match, encoded: string) => Buffer.from(encoded, "base64").includes(58) ? "Basic [REDACTED]" : match)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,})\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|(?:aws[_-]?)?secret(?:[_-]?access[_-]?key)?|(?:session[_-]?)?token|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]");
}
export function redact(value: unknown): unknown {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [text(k), /credential|api.?key|secret|password|sessiontoken/i.test(k) || /^(?:(?:session|access|refresh|auth|id)[_-]?)?token$/i.test(k) ? "[REDACTED]" : redact(v)]));
  return value;
}
export function protect(value: unknown) {
  const safe = redact(value), originalHash = digest(value), storedHash = digest(safe);
  if (digest(redact(safe)) !== storedHash) throw new Error("RedactionNotIdempotent");
  return { value: safe, receipt: { originalHash, storedHash, changed: originalHash !== storedHash } };
}
