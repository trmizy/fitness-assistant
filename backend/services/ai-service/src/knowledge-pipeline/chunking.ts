export type TextChunk = {
  text: string;
  tokenCount: number;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.25);
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
    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}
