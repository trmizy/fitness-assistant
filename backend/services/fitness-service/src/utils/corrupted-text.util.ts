/**
 * Detects text that was mangled by a bad encoding round-trip (mojibake) or by a lossy "?" substitution.
 *
 * IMPORTANT: this pattern must stay CASE-SENSITIVE and must never match genuine Vietnamese. The old version carried the `i` flag, so the
 * Latin-1 lead bytes "Ã"/"Â"/"Ó"/"È" also matched the real letters "ã"/"â"/"ó"/"è" and "Chân + Mông" / "Thân dưới" were treated as corrupted
 * and silently replaced by a fallback day title. Mojibake is recognised by a SHAPE (a UTF-8 lead byte rendered as a Latin letter followed by a
 * continuation byte rendered as a symbol), not by a lone letter that is also a Vietnamese letter.
 *
 * Mojibake = UTF-8 bytes decoded as Latin-1 / Windows-1252:
 *  - 2-byte sequences "Ã¢" (â), "Ä‘" (đ), "Æ°" (ư), "Ã " (à): lead U+00C2-U+00C7 + a continuation byte (U+0080-U+00BF or its cp1252 glyph).
 *  - 3-byte sequences "áº¡" / "á»±" (Latin Extended Additional ạ ự ...): "á"/"Á" + "º"/"»".
 *  - "â€™"-style punctuation and "ï¿½" (an already-encoded U+FFFD).
 */
export const CORRUPTED_TEXT_PATTERN = new RegExp(
  [
    // control characters, replacement character, lossy "?" substitution
    String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F]|�|\?`,
    // lead byte (Ã Â Ä Å Æ Ç) + continuation byte, as Latin-1 (U+0080-U+00BF) or as its Windows-1252 glyph
    String.raw`[Â-Ç][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]`,
    // "áº" / "á»" (Latin Extended Additional), "â€" (punctuation), "ï¿" (encoded U+FFFD)
    String.raw`[áÁ][º»]|[âÂ]€|ï¿`,
    // letters that never occur in Vietnamese (Ä Æ Ç ä æ ç) and a lone "»"
    String.raw`[ÄÆÇäæç]|»`,
  ].join("|"),
);

export function isCorruptedText(value: string): boolean {
  return CORRUPTED_TEXT_PATTERN.test(value);
}
