/**
 * Name matching for the internal member-search route (internal-user-search.controller.ts).
 *
 * Done in application code, inside the (bounded) set of ids the caller supplied - no DB extension (unaccent / pg_trgm) and no migration.
 * Supported: case-insensitive SUBSTRING match of the query inside the display name ("firstName lastName", the same string gym-service shows),
 * accent-insensitive in both directions ("Nguyễn" finds "nguyen" and "nguyen" finds "Nguyễn"), with đ/Đ folded to d, NFC/NFD input treated alike
 * and runs of whitespace collapsed. NOT supported: typo tolerance, word-order independence, searching e-mail / phone.
 * There is no SQL LIKE here, so `%` and `_` are ordinary characters.
 */
export function foldVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function displayNameOf(u: { firstName: string | null; lastName: string | null }): string {
  return [u.firstName, u.lastName].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim();
}

/** True when the folded query occurs in the folded display name. Users without any name never match. */
export function nameMatchesQuery(u: { firstName: string | null; lastName: string | null }, foldedQuery: string): boolean {
  const name = displayNameOf(u);
  if (!name || !foldedQuery) return false;
  return foldVietnamese(name).includes(foldedQuery);
}
