/**
 * M7-P5A.1 — strict JSON helper: duplicate-key detection. JSON.parse silently keeps the LAST of two equal keys, which would
 * let a hand-edited row hide a conflicting value (e.g. two "final" objects). This is a real, string-aware tokenizer (not a
 * regex): it walks the text, tracks strings with escapes (\" \\ \uXXXX …), nesting of objects / arrays, and the set of keys
 * of EACH object separately (the same key at different levels or in different objects is not a duplicate). Keys are compared
 * after decoding, so "a" and "a" are the same key. Pure: no I/O.
 *
 * It is meant to run on text that JSON.parse already accepted, but it never throws: on a syntax problem it stops and reports
 * what it saw so far (`complete: false`).
 */
export interface DuplicateKey { key: string; path: string }
export interface DuplicateKeyScan { duplicates: DuplicateKey[]; complete: boolean }

const WS = new Set([" ", "\t", "\n", "\r"]);

export function findDuplicateKeys(text: string): DuplicateKeyScan {
  const duplicates: DuplicateKey[] = [];
  let i = 0;
  let broken = false;

  const skipWs = () => { while (i < text.length && WS.has(text[i])) i++; };

  /** Reads a string literal starting at the opening quote; returns the decoded value (null when unterminated / invalid). */
  const readString = (): string | null => {
    const start = i;
    i++; // opening quote
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\") { i += 2; continue; } // skip the escaped char (\" \\ \/ \b \f \n \r \t, or the 'u' of \uXXXX — hex digits are plain chars)
      if (ch === '"') { i++; try { return JSON.parse(text.slice(start, i)) as string; } catch { return null; } }
      i++;
    }
    return null;
  };

  const readScalar = () => { while (i < text.length && !WS.has(text[i]) && !",]}:".includes(text[i])) i++; };

  const parseValue = (path: string): void => {
    skipWs();
    if (broken || i >= text.length) { broken = true; return; }
    const ch = text[i];
    if (ch === "{") parseObject(path);
    else if (ch === "[") parseArray(path);
    else if (ch === '"') { if (readString() === null) broken = true; }
    else readScalar();
  };

  const parseArray = (path: string): void => {
    i++; // [
    skipWs();
    if (text[i] === "]") { i++; return; }
    let idx = 0;
    while (!broken) {
      parseValue(`${path}[${idx++}]`);
      if (broken) return;
      skipWs();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; return; }
      broken = true;
    }
  };

  const parseObject = (path: string): void => {
    i++; // {
    const seen = new Set<string>();
    skipWs();
    if (text[i] === "}") { i++; return; }
    while (!broken) {
      skipWs();
      if (text[i] !== '"') { broken = true; return; }
      const key = readString();
      if (key === null) { broken = true; return; }
      if (seen.has(key)) duplicates.push({ key, path: `${path}.${key}` });
      seen.add(key);
      skipWs();
      if (text[i] !== ":") { broken = true; return; }
      i++;
      parseValue(`${path}.${key}`);
      if (broken) return;
      skipWs();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; return; }
      broken = true;
    }
  };

  parseValue("$");
  if (!broken) { skipWs(); if (i < text.length) broken = true; }
  return { duplicates, complete: !broken };
}
