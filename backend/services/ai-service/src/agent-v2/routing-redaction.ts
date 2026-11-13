/**
 * Gymini V2 (EXPERIMENTAL, NOT ACTIVATED) — M7-P5A.2 privacy control A: best-effort redaction of direct contact identifiers
 * (e-mail addresses and phone numbers) from the question text BEFORE it is placed in a routing-model request.
 *
 * This is a pattern-based MINIMIZATION control, NOT an anonymization guarantee: it does not detect names, addresses, ids,
 * obfuscated or spelled-out identifiers (see the bypass list in the test file). Pure and deterministic; it never logs, throws
 * the original text, or returns a span of the original (only placeholders and counts leave this module).
 *
 * Phone numbers are deliberately STRUCTURAL rather than "any 9+ digits with separators", because the same digits appear in
 * intent numbers a router must keep (calorie ranges "1800-2000-2200", dates "03.11.2026 18:30", set ramps "100-120-140"):
 *  - a contiguous run of >= 9 digits (any prefix) is a phone/long identifier -> [PHONE];
 *  - "+" / "(+cc)" international: country code (1-3 digits) + groups, 9-15 digits in total;
 *  - national numbers starting with 0 (Vietnamese mobile 10 digits / landline 11 digits) and "84 ..." without "+";
 *  - "(area) ..." forms;
 *  - un-prefixed separated groups ONLY in the 3-3-4 / 3-4-3 shapes, and 3-3-3 when not hyphen-separated.
 * Anything else (e.g. "2400 kcal", "8-12 reps", "0.5 kg", "13/11/2026", "18:30", "120/80", "5000-10000 bước") is left untouched.
 */
export const EMAIL_PLACEHOLDER = "[EMAIL]";
export const PHONE_PLACEHOLDER = "[PHONE]";
export const REDACTION_MAX_INPUT_CHARS = 2000;

export type RedactionResult =
  | { ok: true; text: string; counts: { email: number; phone: number } }
  | { ok: false; reason: "INVALID_INPUT" };

/** Practical ASCII local@domain.tld. A trailing "." (sentence end) is never part of the match (the TLD must end in letters). */
const EMAIL_RE = /[A-Za-z0-9._%+\-]{1,254}@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}/g;

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isSep = (c: string | undefined) => c === " " || c === "." || c === "-";

interface Group { start: number; end: number; len: number }

/** Reads a digit run starting at i. */
function readDigits(s: string, i: number): Group {
  let j = i;
  while (j < s.length && isDigit(s[j])) j++;
  return { start: i, end: j, len: j - i };
}

/** Subsequent-group shape of a national number: groups of 3-4 digits, or only 2-digit groups (09 12 34 56 78). Mixed → not a phone. */
function nationalShapeOk(rest: Group[]): boolean {
  if (!rest.length) return false;
  if (rest.every((g) => g.len === 2)) return true;
  return rest.every((g) => g.len === 3 || g.len === 4);
}

/**
 * Tries to read a phone number starting at s[i] (a digit, "+", or "(" ). Returns the exclusive end index, or -1.
 * `i` is always at the start of a digit run (the caller skips mid-run positions).
 */
function phoneEndAt(s: string, i: number): number {
  let j = i;
  let plus = false;
  let parenCc = false;
  let parenArea = false;
  if (s[j] === "(") {
    if (s[j + 1] === "+" && isDigit(s[j + 2])) { parenCc = true; plus = true; j += 2; }
    else if (isDigit(s[j + 1])) { parenArea = true; j += 1; }
    else return -1;
  } else if (s[j] === "+") {
    if (!isDigit(s[j + 1])) return -1;
    plus = true; j += 1;
  }
  const first = readDigits(s, j);
  if (!first.len) return -1;
  j = first.end;
  let firstSep: string | null = null;

  // a contiguous run of >= 9 digits is a phone / long identifier by itself ("+84912345678", "0912345678", "84912345678")
  if (first.len >= 9 && !parenCc && !parenArea) return first.end;

  // optional ")" after the country code / area code, then the groups, each separated by exactly ONE of " " "." "-"
  if (parenCc || parenArea) {
    if (s[j] !== ")") return -1;
    j += 1;
    if (isSep(s[j]) && isDigit(s[j + 1])) j += 1;
    else if (!isDigit(s[j])) return -1;
  } else if (isSep(s[j]) && isDigit(s[j + 1])) { firstSep = s[j]; j += 1; }
  else return -1;
  const groups: Group[] = [first];
  const seps: string[] = [];
  const ends: number[] = [first.end]; // ends[k] = end index of group k
  for (let guard = 0; guard < 8 && isDigit(s[j]); guard++) {
    const g = readDigits(s, j);
    groups.push(g); ends.push(g.end);
    j = g.end;
    if (isSep(s[j]) && isDigit(s[j + 1])) { seps.push(s[j]); j += 1; } else break;
  }
  const total = (k: number) => groups.slice(0, k).reduce((a, g) => a + g.len, 0);

  const f = s.slice(first.start, first.end);
  // M7-P5A.2 remediation (QA PC-A14): "00" is an international prefix like "+" ("0084 912 345 678")
  const intlZeroZero = !plus && !parenArea && f.startsWith("00") && first.len >= 3;
  if (plus || intlZeroZero) {
    // international: country code (+ possibly the start of the subscriber number, "+84912 345 678") then groups of up to
    // 12 digits ("+49 151 23456789"); 9-15 digits in total. A 1-2 digit group is accepted only while fewer than 10 digits
    // are consumed, so a number followed by "60 phút" does not swallow the "60".
    const lead = intlZeroZero ? first.len - 2 : first.len;
    if (lead > 15) return -1;
    let best = -1; let sum = lead;
    for (let k = 1; k < groups.length; k++) {
      const g = groups[k];
      if (g.len > 12 || (g.len <= 2 && sum >= 10) || sum + g.len > 15) break;
      sum += g.len;
      if (sum >= 9) best = ends[k];
    }
    return best;
  }
  if (parenArea) {
    if (first.len < 2 || first.len > 4) return -1;
    for (const want of [10, 11]) {
      for (let k = 2; k <= groups.length; k++) {
        if (!nationalShapeOk(groups.slice(1, k))) break;
        if (total(k) === want) return ends[k - 1];
      }
    }
    return -1;
  }
  if (f[0] === "0" && first.len <= 4) {
    // Vietnamese national: 10 digits (mobile) or 11 (landline / legacy); the first prefix reaching 10 wins, then 11
    for (const want of [10, 11]) {
      for (let k = 2; k <= groups.length; k++) {
        if (!nationalShapeOk(groups.slice(1, k))) break;
        if (total(k) === want) return ends[k - 1];
      }
    }
    // M7-P5A.2 remediation (QA PC-A14): a mixed grouping of a mobile ("0912 3456 78") — only with SPACE separators and a
    // 0[35789]x prefix, so dates (dots / hyphens) and time ranges are never touched
    if (first.len === 4 && /^0[35789]/.test(f) && firstSep === " " && seps.every((x) => x === " ")) {
      for (let k = 2; k <= groups.length; k++) {
        if (groups.slice(1, k).some((g) => g.len < 2 || g.len > 4)) break;
        if (total(k) === 10) return ends[k - 1];
      }
    }
    return -1;
  }
  if (f === "84") {
    for (const want of [11, 12]) {
      for (let k = 2; k <= groups.length; k++) {
        const rest = groups.slice(1, k);
        if (!nationalShapeOk(rest) || !rest.some((g) => g.len >= 3)) break;
        if (total(k) === want) return ends[k - 1];
      }
    }
    return -1;
  }
  // un-prefixed separated groups: only phone-like shapes
  if (groups.length >= 3) {
    const shape = groups.slice(0, 3).map((g) => g.len).join("-");
    if (shape === "3-3-4" || shape === "3-4-3") return ends[2];
    if (shape === "3-3-3" && !seps.slice(0, 2).includes("-")) return ends[2];
  }
  return -1;
}

function redactPhones(text: string): { text: string; count: number } {
  let out = "";
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const startsHere = isDigit(c) ? !isDigit(text[i - 1]) : (c === "+" || c === "(");
    if (startsHere) {
      // a "+" / "(" start must be followed (after the sign / paren) by the digit run the parser expects
      const end = phoneEndAt(text, i);
      if (end > i) { out += PHONE_PLACEHOLDER; count++; i = end; continue; }
    }
    if (isDigit(c)) {
      // no match at this run start: copy the whole digit run so a later position never starts mid-run
      let j = i; while (j < text.length && isDigit(text[j])) j++;
      out += text.slice(i, j); i = j; continue;
    }
    out += c; i++;
  }
  return { text: out, count };
}

/**
 * Redacts e-mail addresses and phone numbers. Non-string input, or text longer than REDACTION_MAX_INPUT_CHARS, is refused
 * (`ok:false`) — the caller must then NOT send the text anywhere.
 */
export function redactForRouting(question: unknown): RedactionResult {
  if (typeof question !== "string" || question.length > REDACTION_MAX_INPUT_CHARS) return { ok: false, reason: "INVALID_INPUT" };
  let emailCount = 0;
  const afterEmail = question.replace(EMAIL_RE, () => { emailCount++; return EMAIL_PLACEHOLDER; });
  const ph = redactPhones(afterEmail);
  return { ok: true, text: ph.text, counts: { email: emailCount, phone: ph.count } };
}
