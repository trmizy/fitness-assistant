/**
 * B45 - what a public review shows about its author: a short label, never a user id. "Phạm Thu" -> "Phạm T." (first word
 * in full, every other word reduced to its initial); one word stays as is; no name at all -> "Hội viên".
 */
export const ANONYMOUS_REVIEWER_LABEL = 'Hội viên';

export function reviewerLabel(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ANONYMOUS_REVIEWER_LABEL;
  if (words.length === 1) return words[0];
  return `${words[0]} ${words
    .slice(1)
    .map((w) => `${Array.from(w)[0].toUpperCase()}.`)
    .join(' ')}`;
}
