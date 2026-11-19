/**
 * The sentence the server put in an error response, whichever shape it used: `{ error: "…" }`
 * (auth-service), `{ error: { message } }` (gateway / gym-service) or `{ message }`. Returns "" when
 * there is none, so callers keep their own Vietnamese fallback. Never returns an object — a toast
 * given `data.error` as an object would render nothing useful.
 */
export function serverMessage(error: unknown): string {
  const data = (error as { response?: { data?: any } } | null)?.response?.data;
  const candidates = [data?.error, data?.error?.message, data?.message];
  for (const c of candidates) if (typeof c === "string" && c.trim()) return c.trim();
  return "";
}
