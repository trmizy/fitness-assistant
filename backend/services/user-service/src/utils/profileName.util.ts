/**
 * The name columns a UserProfile needs to be FOUND by name. Names live in auth-service; a profile
 * row is created by whichever service touches the user first and usually has none, and read
 * paths paper over that by fetching names at display time. Search cannot: `GET /profile/pts?q=`
 * filters on these columns, so a trainer approved from a real sign-up (not a seed) was invisible
 * to a name search (7/10). Accent-insensitive twins use the same folding as upsertProfile.
 */
export function foldSearchName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type ProfileNameFields = {
  firstName: string | null;
  lastName: string | null;
  firstNameNormalized: string | null;
  lastNameNormalized: string | null;
};

/** null when auth-service has no usable name either — nothing worth writing. */
export function profileNameFields(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): ProfileNameFields | null {
  const first = firstName?.trim() || null;
  const last = lastName?.trim() || null;
  if (!first && !last) return null;
  return {
    firstName: first,
    lastName: last,
    firstNameNormalized: first ? foldSearchName(first) : null,
    lastNameNormalized: last ? foldSearchName(last) : null,
  };
}
