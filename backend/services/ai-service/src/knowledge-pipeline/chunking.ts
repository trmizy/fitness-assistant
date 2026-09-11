export type TextChunk = {
  text: string;
  tokenCount: number;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.25);
}

/** Real bug found live in the `fitness_evidence` Qdrant collection: the
 * overlap rollback below (`end - overlapChars`) is a raw character offset,
 * not word-boundary-aware, so a chunk after the first could start mid-word
 * (confirmed: a real chunk started "e RT program..." — the tail of
 * "describe" got split off). The end-of-chunk sentence-boundary search
 * already handles chunk *endings* correctly; this only needed to also
 * apply to where the *next* chunk's overlap window starts. */
function snapForwardToWordBoundary(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  if (text[index - 1] === " ") return index; // already at a boundary
  const nextSpace = text.indexOf(" ", index);
  return nextSpace === -1 ? text.length : nextSpace + 1;
}

export function chunkText(
  text: string,
  chunkChars = 1200,
  overlapChars = 160,
): TextChunk[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < normalized.length) {
    const targetEnd = Math.min(start + chunkChars, normalized.length);
    let end = targetEnd;

    if (targetEnd < normalized.length) {
      const window = normalized.slice(start, targetEnd);
      const sentenceEnd = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("; "),
        window.lastIndexOf(": "),
      );
      if (sentenceEnd > chunkChars * 0.55) {
        end = start + sentenceEnd + 1;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 80) {
      chunks.push({ text: chunk, tokenCount: estimateTokens(chunk) });
    }

    if (end >= normalized.length) break;
    start = snapForwardToWordBoundary(normalized, Math.max(0, end - overlapChars));
  }

  return chunks;
}
