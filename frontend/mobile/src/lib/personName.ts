/**
 * B21 — name convention: `firstName` = họ (the first word), `lastName` = the rest, full name =
 * `${firstName} ${lastName}`. Registration splits that way, and a single-word name is stored with a "." as the
 * lastName (the API rejects an empty one), so a lone "." never counts as a word.
 */
type NameParts = { firstName?: string | null; lastName?: string | null } | null | undefined;

const words = (u: NameParts) =>
  `${u?.firstName ?? ""} ${u?.lastName ?? ""}`
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && w !== ".");

export function fullName(u: NameParts, fallback = ""): string {
  return words(u).join(" ") || fallback;
}

/** The name people greet each other by in Vietnamese: the LAST word of the full name ("Nguyễn Thị Uyên" -> "Uyên"). */
export function givenName(u: NameParts, fallback = ""): string {
  const w = words(u);
  return w.length ? w[w.length - 1] : fallback;
}
