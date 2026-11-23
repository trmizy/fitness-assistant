/** Vietnamese-friendly search key: lower-case, no diacritics, đ→d, single spaces ("Dinh dưỡng" ≈ "dinh duong"). */
export function searchKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type SearchEntry = { label: string; to: string; keywords?: string[] };

/**
 * Rank entries for a query. Every query word must be the START of some word in the label or a keyword
 * ("ai" finds "Kế hoạch AI", not "b-ai tập"). Order: label starts with the query > a keyword equals it >
 * label word starts with it > a keyword starts with it > words matched separately; ties keep list order.
 * Empty query → entries unchanged.
 */
export function rankEntries<T extends SearchEntry>(entries: T[], query: string): T[] {
  const q = searchKey(query);
  if (!q) return entries;
  const words = q.split(" ");
  const scored: Array<{ e: T; s: number; i: number }> = [];
  entries.forEach((e, i) => {
    const label = searchKey(e.label);
    const kws = (e.keywords ?? []).map(searchKey);
    const tokens = [label, ...kws].flatMap((t) => t.split(" "));
    if (!words.every((w) => tokens.some((t) => t.startsWith(w)))) return;
    const startsAt = (t: string) => t.startsWith(q) || t.includes(" " + q);
    const s = label.startsWith(q) ? 0 : kws.includes(q) ? 1 : startsAt(label) ? 2 : kws.some(startsAt) ? 3 : 4;
    scored.push({ e, s, i });
  });
  return scored.sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.e);
}
