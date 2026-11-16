/**
 * Input normalization for the emergency engine (M9.5-T1B). One pass, linear in the input, producing TWO parallel views of the same text with a map back to the RAW offsets:
 *   nfc   — NFC, lower-case, whitespace collapsed (accent-aware patterns)
 *   ascii — the same with diacritics removed and đ→d (accent-less / partially accented writing)
 * Both views are evaluated on EVERY call, by V1 and V2 alike (no "V2 retries folded, V1 does not").
 *
 * Whitespace: every `\s` code point (space, tab, NBSP, line breaks, U+FEFF …) collapses to ONE space and runs are trimmed — the same `\s` the legacy `foldSafetyText`
 * uses. Nothing else is touched: invisible characters (U+200B…) and full-width forms are NOT handled here — B-01 / B-02 plug in HERE as additional views / a stripping step
 * (see M9-B03-SAFETY-ARCHITECTURE.md §4); this file does not claim them.
 * Cost: one iteration over the code points; two arrays of at most `raw.length`×(1 + expansion) entries per view (no string copies per span).
 */
export interface NormView { text: string; start: Int32Array; end: Int32Array }
export interface Normalized { units: number; hasMarks: boolean; nfc: NormView; ascii: NormView }

const WS = /\s/u;
const MARK = /\p{M}/u;
const DIACRITIC = /[̀-ͯ]/g;

function finish(parts: string[], start: number[], end: number[]): NormView {
  let text = parts.join("");
  // trim one trailing collapsed space (leading ones are never emitted)
  if (text.endsWith(" ")) { text = text.slice(0, -1); start.pop(); end.pop(); }
  return { text, start: Int32Array.from(start), end: Int32Array.from(end) };
}

export function normalizeForEmergency(raw: string): Normalized {
  const nParts: string[] = [], nS: number[] = [], nE: number[] = [];
  const aParts: string[] = [], aS: number[] = [], aE: number[] = [];
  let nOut = 0, aOut = 0, lastSpaceN = true, lastSpaceA = true, hasMarks = false;
  const push = (parts: string[], s: number[], e: number[], part: string, rs: number, re: number) => { parts.push(part); for (let k = 0; k < part.length; k++) { s.push(rs); e.push(re); } };
  for (let i = 0; i < raw.length;) {
    const cp = raw.codePointAt(i) as number; const baseLen = cp > 0xffff ? 2 : 1; let j = i + baseLen;
    while (j < raw.length) { const c2 = raw.codePointAt(j) as number; if (c2 < 0x300 || !MARK.test(String.fromCodePoint(c2))) break; j += c2 > 0xffff ? 2 : 1; } // base + its combining marks = one cluster
    const cluster = raw.slice(i, j);
    if (j === i + baseLen && WS.test(cluster)) { // a whitespace character on its own
      if (!lastSpaceN) { push(nParts, nS, nE, " ", i, j); nOut++; lastSpaceN = true; } else if (nE.length) nE[nE.length - 1] = j;
      if (!lastSpaceA) { push(aParts, aS, aE, " ", i, j); aOut++; lastSpaceA = true; } else if (aE.length) aE[aE.length - 1] = j;
    } else {
      const nfc = cluster.normalize("NFC").toLowerCase();
      const ascii = cluster.normalize("NFD").replace(DIACRITIC, "").replace(/đ/gi, "d").toLowerCase();
      if (nfc !== ascii) hasMarks = true;
      if (nfc) { push(nParts, nS, nE, nfc, i, j); nOut++; lastSpaceN = false; }
      if (ascii) { push(aParts, aS, aE, ascii, i, j); aOut++; lastSpaceA = false; }
    }
    i = j;
  }
  void nOut; void aOut;
  return { units: raw.length, hasMarks, nfc: finish(nParts, nS, nE), ascii: finish(aParts, aS, aE) };
}

/** Folded form of a short literal (lexicon sources are written once, with accents, and folded for the ascii view). */
export function foldLiteral(s: string): string { return s.normalize("NFD").replace(DIACRITIC, "").replace(/đ/gi, "d").toLowerCase(); }
