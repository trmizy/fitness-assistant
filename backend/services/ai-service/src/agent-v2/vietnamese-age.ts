/**
 * Gymini V2 (EXPERIMENTAL) — Vietnamese WRITTEN-age phrases for the Minor Gate ("Em mười lăm tuổi", "muoi lam tuoi").
 *
 * Pure, deterministic, offline. NOT an NL parser and NOT a second age model: it only REWRITES a supported written phrase into
 * the digit form V1 already understands ("em mười lăm tuổi" → "em 15 tuoi") inside a COPY of the sentence, so that the SAME V1
 * `extractFactsFromText` (llm/turn_facts.ts — negation "không phải 16 tuổi", "chưa đủ 18 tuổi", hypothetical "giả sử/nếu",
 * approximations "khoảng/sắp/gần …") applies to it unchanged. minor-gate.ts `statedAges` = V1(original text) ∪ V1(each
 * rewritten sentence). A written age is only ever USER_REPORTED (CURRENT_TURN / HISTORY) — nothing here marks anything verified.
 *
 * SUPPORTED (accented or unaccented, any letter case; text scanned = first 4000 chars):
 *   F1  PRON [ADV]{0,3} NUM "tuổi"      "Em mười lăm tuổi", "Mình mới mười bốn tuổi", "Tôi năm nay mười sáu tuổi",
 *                                       "em đã tròn mười bảy tuổi", "em khoảng mười lăm tuổi", "tôi chưa đủ mười tám tuổi"
 *   F2  PRON MARKER NUM  (no "tuổi")    "Em mới mười ba.", "Tôi đang mười lăm", "Mình hiện mười bốn", "Năm nay em mười lăm"
 *                                       — only with a marker (mới | đang | hiện | hiện tại | hiện nay | năm nay | bây giờ),
 *                                       only 10–99, and only when the number ENDS the clause (end / , . ; ! ? : newline /
 *                                       "rồi nên và nhưng mà thì nhé ạ nha đây đó thôi nè") — so "em mới mười lăm phút / kg / năm" is NOT an age.
 *   F3  "tuổi của" PRON ["là"] NUM       "Tuổi của em là mười lăm"
 *   PRON = tôi | tui | em | mình ("minh" without accent is accepted only when the WHOLE text has no Vietnamese diacritics —
 *   in a text that has accents, "Minh mười lăm tuổi" is a personal name, not "mình").
 *   ADV  = mới đã đang vừa hiện hiện tại hiện nay năm nay tròn đúng được chỉ chưa chưa đủ sắp gần ngoài hơn tầm khoảng.
 *   NUM  = 5–99 in words: năm sáu bảy|bẩy tám chín | mười, mười một … mười chín (5 = lăm|nhăm after mười) |
 *          hai … chín mươi [+ một|mốt, hai, ba, bốn|tư, lăm|nhăm, sáu, bảy, tám, chín]. ("mười năm" is NOT 15 — it is "ten years".)
 *          Words 5–9 need "tuổi" (F1/F3). V1 itself ignores digit ages below 10 ("Em 8 tuổi" is not an age in V1) — inherited.
 *
 * Third person is rejected on purpose (the owner decision: never the authenticated user's age): the pronoun must NOT directly
 * follow a kinship / relation / plural-address word (con, cháu, bạn, anh, chị, em, bé, gái, trai, vợ, chồng, mẹ, bố, ba, bà, cha,
 * thằng, đứa, người, các, của, sinh, yêu) — "Con tôi mười lăm tuổi", "con em mười ba tuổi", "bạn mình mười sáu tuổi", "em gái
 * tôi mười lăm tuổi" are not matched; neither are phrases without a pronoun ("người mười sáu tuổi", "học sinh mười lăm tuổi").
 *
 * NOT SUPPORTED (documented, not guessed): "em mười lăm" with no marker and no "tuổi"; "em 15 rồi" / "em mới 13" with DIGITS and no
 * "tuổi" (V1 digit gap — not changed here); "rưỡi"; "mười năm tuổi"; hai-lăm / hai-nhăm style colloquial forms; "đang tuổi mười
 * lăm"; "tuổi mười lăm" alone; roman / mixed forms ("1 lăm"); "cháu"/"anh"/"chị"/"con" used as the SPEAKER's own pronoun;
 * "chúng em/bọn mình mười lăm tuổi" is matched as the speaker's own age (conservative); "các em mười lăm tuổi" is not;
 * ages stated in a past tense ("hồi em mười lăm tuổi") are treated like V1 treats the digit twin (the age is taken at face value —
 * V1 has no tense logic, so this is the same conservative false-positive V1 already has).
 *
 * Bounded: input sliced to 4000 chars, at most 8 written phrases, linear regexes with bounded repetition, never throws.
 */

const MAX_SCAN_CHARS = 4000;
const MAX_PHRASES = 8;

const DIACRITIC = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/;

/** Same length as the (lower-cased NFC) input: one folded char per char (accents and đ removed). */
function fold(lower: string): string {
  let f = "";
  for (const ch of lower) {
    const base = ch === "đ" ? "d" : ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    f += base.length === ch.length ? base : ch;
  }
  return f.length === lower.length ? f : lower; // defensive: never let indices drift
}

const UNIT_AFTER_MUOI = "mot|hai|ba|bon|lam|nham|sau|bay|tam|chin";
const UNIT_AFTER_TENS = "mot|hai|ba|bon|tu|lam|nham|sau|bay|tam|chin";
const TENS = "hai|ba|bon|nam|sau|bay|tam|chin";
const NUM_SRC = `(?:(?:${TENS})\\s+muoi(?:\\s+(?:${UNIT_AFTER_TENS}))?|muoi(?:\\s+(?:${UNIT_AFTER_MUOI}))?|nam|sau|bay|tam|chin)`;
const ADV_SRC = "hien tai|hien nay|nam nay|chua du|bay gio|moi|da|dang|vua|hien|tron|dung|duoc|chi|chua|sap|gan|ngoai|hon|tam|khoang";
const PRON_SRC = "toi|tui|em|minh";
const MARKER = /(?:^|\s)(?:moi|dang|hien|hien tai|hien nay|nam nay|bay gio)(?=\s|$)/;
const LEAD_MARKER = /(?:nam nay|hien tai|hien nay|bay gio)\s*,?\s*$/;
const TERMINATOR = /^[ \t]*(?:$|[\r\n,.;!?:…)"']|(?:roi|nen|va|nhung|ma|thi|nhe|a|nha|day|do|thoi|ne)(?![a-z0-9]))/;
const KIN_BEFORE = new Set([
  "con", "chau", "cháu", "ban", "bạn", "anh", "chi", "chị", "em", "be", "bé", "gai", "gái", "trai", "vo", "vợ", "chong", "chồng",
  "me", "mẹ", "bo", "bố", "ba", "bà", "cha", "thang", "thằng", "dua", "đứa", "nguoi", "người", "cac", "các", "cua", "của",
  "sinh", "yeu", "yêu",
]);

const F1 = new RegExp(`(?<![a-z0-9])(${PRON_SRC})((?:\\s+(?:${ADV_SRC})){0,3})(\\s+)(${NUM_SRC})(?![a-z0-9])(\\s*tuoi(?![a-z0-9]))?`, "g");
const F3 = new RegExp(`(?<![a-z0-9])(tuoi\\s+cua\\s+)(${PRON_SRC})\\s+(?:la\\s+)?(${NUM_SRC})(?![a-z0-9])`, "g");

const ONES: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5, nham: 5, sau: 6, bay: 7, tam: 8, chin: 9 };

/** Folded words ("muoi lam", "hai muoi mot", "nam") → 5..99, or null when it is not a standard number phrase. */
export function parseVietnameseNumberWords(folded: string): number | null {
  const w = String(folded ?? "").trim().split(/\s+/).filter(Boolean);
  if (!w.length || w.length > 3) return null;
  if (w.length === 1) return w[0] !== "muoi" ? (["nam", "sau", "bay", "tam", "chin"].includes(w[0]) ? ONES[w[0]] : null) : 10;
  if (w[0] === "muoi") {
    if (w.length !== 2 || !(w[1] in ONES) || w[1] === "tu" || w[1] === "nam") return null;
    return 10 + ONES[w[1]];
  }
  if (w[1] !== "muoi" || !(w[0] in ONES) || w[0] === "tu" || w[0] === "lam" || w[0] === "nham" || w[0] === "mot") return null;
  const tens = ONES[w[0]] * 10;
  if (w.length === 2) return tens;
  if (!(w[2] in ONES) || w[2] === "nam") return null;
  return tens + ONES[w[2]];
}

interface Phrase { start: number; end: number; replacement: string }

const prevWord = (lower: string, at: number): string | null => {
  const m = /([\p{L}]+)[ \t]+$/u.exec(lower.slice(Math.max(0, at - 40), at));
  return m ? m[1] : null;
};

function sentenceBounds(lower: string, start: number, end: number): [number, number] {
  let a = start;
  while (a > 0) { const c = lower[a - 1]; if (c === "\n" || (/\s/.test(c) && /[.!?;…]/.test(lower[a - 2] ?? ""))) break; a--; }
  let b = end;
  while (b < lower.length) { const c = lower[b]; if (c === "\n") break; if (/[.!?;…]/.test(c) && /\s/.test(lower[b + 1] ?? " ")) { b++; break; } b++; }
  return [a, b];
}

function findPhrases(lower: string, f: string): Phrase[] {
  const out: Phrase[] = [];
  const accented = DIACRITIC.test(lower);
  const pronOk = (rawPron: string, foldedPron: string): boolean => (!accented ? true : foldedPron === "minh" ? rawPron === "mình" : foldedPron === "toi" ? rawPron === "tôi" : true);
  const thirdPerson = (pronStart: number): boolean => { const w = prevWord(lower, pronStart); return w !== null && KIN_BEFORE.has(w); };

  for (const m of f.matchAll(F1)) {
    if (out.length >= MAX_PHRASES) break;
    const pron = m[1]; const adv = m[2] ?? ""; const gap = m[3]; const num = m[4]; const hasTuoi = m[5] !== undefined;
    const at = m.index!;
    if (!pronOk(lower.slice(at, at + pron.length), pron) || thirdPerson(at)) continue;
    const value = parseVietnameseNumberWords(num);
    if (value === null) continue;
    const numStart = at + pron.length + adv.length + gap.length;
    const numEnd = numStart + num.length;
    if (hasTuoi) { out.push({ start: numStart, end: at + m[0].length, replacement: `${value} tuoi` }); continue; }
    // no "tuổi": only a marked, clause-final 10–99 number
    if (value < 10 || !(MARKER.test(adv) || LEAD_MARKER.test(f.slice(Math.max(0, at - 14), at)))) continue;
    if (!TERMINATOR.test(f.slice(numEnd, numEnd + 12))) continue;
    out.push({ start: numStart, end: numEnd, replacement: `${value} tuoi` });
  }
  for (const m of f.matchAll(F3)) {
    if (out.length >= MAX_PHRASES) break;
    const pron = m[2]; const pronStart = m.index! + m[1].length;
    if (!pronOk(lower.slice(pronStart, pronStart + pron.length), pron)) continue;
    const value = parseVietnameseNumberWords(m[3]);
    if (value === null) continue;
    out.push({ start: pronStart + pron.length, end: m.index! + m[0].length, replacement: ` ${value}` });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Each supported written-age phrase, rewritten to its digit form INSIDE its own sentence (the rest of the sentence — negation,
 * hypothetical markers, approximations — is kept verbatim). One entry per phrase, so the caller can run V1 on each separately.
 * Empty when there is none. Never throws.
 */
export function rewriteWrittenAgeSentences(text: string): string[] {
  try {
    const lower = String(text ?? "").slice(0, MAX_SCAN_CHARS).normalize("NFC").toLowerCase();
    if (lower.length < 6) return [];
    const f = fold(lower);
    const phrases = findPhrases(lower, f);
    const out: string[] = [];
    for (const p of phrases) {
      const [a, b] = sentenceBounds(lower, p.start, p.end);
      out.push(lower.slice(a, p.start) + p.replacement + lower.slice(p.end, b));
    }
    return out;
  } catch {
    return [];
  }
}
