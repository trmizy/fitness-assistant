/**
 * Mã phiên bản điều khoản PT (vd "2026-10-pt-draft-6") là mã nội bộ — người đọc chỉ cần biết tháng và số bản.
 * N13J-05(e): tab Bằng chứng/tranh chấp từng hiện nguyên mã.
 */
const VERSION_RE = /^(\d{4})-(\d{1,2})-pt(-draft)?-?(\d+)?$/i;

export function ptTermsVersionLabel(raw: string | null | undefined): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return "Không rõ phiên bản";
  const m = VERSION_RE.exec(v);
  if (!m) return "Bản điều khoản PT";
  const [, year, month, draft, n] = m;
  const monthNo = Number(month);
  const base = `Điều khoản PT tháng ${monthNo}/${year}`;
  const suffix = `${draft ? "bản nháp" : "bản"}${n ? ` ${Number(n)}` : ""}`;
  return `${base} (${suffix})`;
}
