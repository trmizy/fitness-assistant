/**
 * Initials of a display name: first letter of the first two words, upper case ("Trần Hà" -> "TH").
 * The one helper every avatar uses (chat header, lists, call screen) so the same person never shows
 * "T" on one screen and "TH" on another (N15M-13).
 */
export function initialsOf(name: string | null | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => Array.from(word)[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
