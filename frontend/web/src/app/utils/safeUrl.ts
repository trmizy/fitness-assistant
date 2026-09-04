/**
 * Security review 2026-09-03 (C1/M1) — `new URL(x)` alone is NOT a safe href guard: it
 * happily parses `javascript:alert(1)` as a valid URL (protocol `javascript:`), and a browser
 * executes that script the moment someone clicks the resulting `<a href>`. Every place that
 * renders a user- or AI-supplied string as a link href must go through this instead — PT
 * application LinkedIn/website links (a malicious applicant's own input) and AI-cited source
 * URLs (an LLM can hallucinate or be prompt-injected into emitting one) are exactly the two
 * classes of untrusted-string-becomes-href this guards.
 */
export function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
