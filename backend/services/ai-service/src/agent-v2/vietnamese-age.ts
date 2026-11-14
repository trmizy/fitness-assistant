/**
 * Gymini V2 (EXPERIMENTAL) — Vietnamese age MENTIONS for the Minor Gate (M7-P5A.2.3 "AGE SEMANTICS", owner policy).
 *
 * Pure, deterministic, offline. NOT an NL parser and NOT a second age model: it LOCATES the age expressions of a text
 * (digit / written / "mới 13"), decides WHOSE age each one is from the few words directly before it (FIRST person, THIRD
 * party, or AMBIGUOUS), and hands the supported ones to the SAME V1 `extractFactsFromText` (llm/turn_facts.ts — negation
 * "không phải 16 tuổi", "chưa đủ 18 tuổi", hypothetical "giả sử/nếu", approximations "khoảng/sắp/gần …" apply unchanged) as a
 * COPY of the sentence in which every OTHER age expression is blanked and this one is written as digits ("em 15 tuoi").
 * minor-gate.ts evaluates the mentions (classifyStatedAge). A stated age is only ever USER_REPORTED — nothing here marks
 * anything verified.
 *
 * AGE EXPRESSIONS LOCATED (accented or unaccented, any letter case; text scanned = first 4000 chars, sentence by sentence):
 *   D1  DIGITS "tuổi"            "15 tuổi" "15 years old" "15yo" (V1's own pattern, mirrored) — 10..99 as V1; 5..9 ONLY with a
 *                                first/third/ambiguous subject word (V1 ignores digit ages below 10: V2 deliberately does not,
 *                                "Em 8 tuổi"); below 5 never.
 *   D2  "tuổi [là] 15" / "tuổi của em [là] 15"   (V1's pattern 2, mirrored; "của X" names the subject)
 *   D3  MARKER DIGITS            "Em mới 13." "Mình hiện 14" "Năm nay em 15" — marker (mới | đang | hiện | hiện tại | hiện nay |
 *                                năm nay | bây giờ) + 10..99, only when the number ENDS the clause (end / , . ; ! ? : newline /
 *                                "rồi nên và nhưng mà thì nhé ạ nha đây đó thôi nè") — "em mới 15 phút / kg / năm" is NOT an age.
 *                                V1 does not read these at all; V2 does (owner policy).
 *   W1  WORDS "tuổi"             "Em mười lăm tuổi", "em tám tuổi", "Tôi năm nay mười sáu tuổi", "em khoảng mười lăm tuổi"
 *   W2  MARKER WORDS             "Em mới mười ba.", "Tôi đang mười lăm" (same marker + clause-end rule as D3)
 *   W3  "tuổi của em [là] mười lăm"
 *   NUM = 5–99 in words: năm sáu bảy|bẩy tám chín | mười, mười một … mười chín (5 = lăm|nhăm after mười) | hai … chín mươi [+ một|
 *         mốt, hai, ba, bốn|tư, lăm|nhăm, sáu, bảy, tám, chín]. ("mười năm" is NOT 15 — it is "ten years".) Words 5–9 need "tuổi".
 *
 * WHOSE AGE (the subject = the last word before the expression, after skipping up to 3 adverbs
 * mới đã đang vừa hiện hiện tại hiện nay năm nay tròn đúng được chỉ chưa chưa đủ sắp gần ngoài hơn tầm khoảng bây giờ):
 *   FIRST     the head is a speaker pronoun tôi | tui | em | mình | cháu AND the word before it is not a relation word:
 *             "Em mười lăm tuổi" "Cháu mười lăm tuổi" "Chào anh, em mười lăm tuổi" (a comma ends the address) "Dạ cháu 15 tuổi"
 *             "Tôi là học sinh 15 tuổi" (pronoun + "là" + [một] [học] sinh|người|bé … is the speaker). "cháu" is the speaker's
 *             pronoun only when it is the subject (clause start / after a greeting word); "Cháu tôi …" is a third party.
 *             "minh/toi" without accents count only when the WHOLE text has no Vietnamese diacritics (otherwise "Minh" is a name).
 *   THIRD     the pronoun directly follows a relation / possessive word (con, cháu, gái, trai, vợ, chồng, mẹ, bố, ba, bà, cha,
 *             thằng, đứa, người, các, của, sinh, yêu, bé, em [before tôi/mình]) — "Con tôi 15 tuổi", "Cháu tôi mười lăm tuổi",
 *             "Em trai tôi 13 tuổi", "Em gái mình mười hai tuổi", "con em 9 tuổi", "Các em mười lăm tuổi", "mỡ của tôi đang 15";
 *             an address word (anh | chị | bạn) directly before tôi/mình ("Bạn tôi 16 tuổi", "Anh mình 17 tuổi");
 *             or the head itself is a third-party noun (học sinh, sinh viên, người, bé, trẻ, thằng, đứa, gái, trai, vợ, chồng):
 *             "học sinh 15 tuổi", "người 16 tuổi có được tập gym không?", "Em gái 12 tuổi".
 *             An appositive after a comma keeps the previous clause's subject: "Con tôi, 15 tuổi, thích tập" is third.
 *   AMBIGUOUS (documented, short list — see AMBIGUOUS_PATTERNS):
 *     A1  address compound + age:   "anh em | chị em | anh chị em" + age    "Chào anh em mười lăm tuổi" ("anh em" the greeting and an
 *                                   age without subject, OR "anh," + the speaker "em") — also with digits, also "chào bạn em 15 tuổi"
 *     A2  "bạn | các bạn" + age, no pronoun:   "Chào bạn mười lăm tuổi", "Bạn 16 tuổi nên tập gì?" (the addressee's age, a generic
 *                                   statement, or a greeting followed by an age?)
 *     A3  "con" + age, no possessor:   "Con 15 tuổi nên tập gì?" (a child speaking OR a parent: "con 15 tuổi nhà mình")
 *   OTHER     no recognised subject word: DIGITS keep V1 parity (the age is read as the user's own: "Tập gym 15 tuổi có sao không",
 *             "15 tuổi tập được không?", "Minh 15 tuổi …"), WORDS are not an age ("mười lăm tuổi" alone, "tập mười lăm tuổi").
 *
 * M7-P5A.3 (owner decision, remediation R-B):
 *   - "có" directly before a WORDS/DIGITS-"tuổi" age is skipped when it leads to a FIRST or THIRD owner ("Em mới có mười lăm tuổi" = FIRST 15,
 *     "Con tôi mới có mười lăm tuổi" = THIRD); the "có" is removed from the V1 copy so V1's negation / not-yet rules still see the words before it.
 *   - a DIRECTIONAL approximation (sắp | gần [tròn] | chưa tới|đến|đủ|tròn|được | dưới) + N with N in 6..18 and a FIRST subject is read as N-1
 *     ("Em sắp 18 tuổi" = 17): V1 would read an approximate adult 18. N >= 19, khoảng/tầm/hơn/trên/ngoài/đã/đủ keep V1's reading.
 *
 * NOT AN AGE: experience ("tập 15 năm", "15 năm kinh nghiệm"), weights/reps/sets/durations/dates/money (a unit follows the number), "năm"
 * as a unit, "em 15" / "em mười lăm" with no marker and no "tuổi", "em 15 rồi" (documented gap, stays no-evidence).
 *
 * Not handled (documented): English third person ("my son is 15 years old" is read by V1's digit rule as before); "rưỡi"; "mười năm
 * tuổi"; colloquial "hai-lăm"; "đang tuổi mười lăm"; past tense ("hồi em mười lăm tuổi" is taken at face value, as V1 does).
 *
 * Bounded: input sliced to 4000 chars, at most 8 age expressions (V1 reads whatever is beyond, as before), at most 100 characters looked back per expression, linear regexes
 * with bounded repetition, never throws.
 */

const MAX_SCAN_CHARS = 4000;
const MAX_MENTIONS = 8;
const LOOKBACK_CHARS = 100;

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
const CHAIN_SRC = `(?:${ADV_SRC})(?:\\s+(?:${ADV_SRC})){0,2}`;
const MARKER_RE = /(?:^|\s)(?:moi|dang|hien|nam nay|bay gio)(?=\s|$)/;
const LEAD_MARKER = /(?:nam nay|hien tai|hien nay|bay gio)\s*,?\s*$/;
const TERMINATOR = /^[ \t]*(?:$|[\r\n,.;!?:…)"']|(?:roi|nen|va|nhung|ma|thi|nhe|a|nha|day|do|thoi|ne)(?![a-z0-9]))/;
const ADV1 = new Set(["moi", "da", "dang", "vua", "hien", "tron", "dung", "duoc", "chi", "chua", "sap", "gan", "ngoai", "hon", "tam", "khoang", "duoi"]);
const ADV2 = new Set(["hien tai", "hien nay", "nam nay", "chua du", "bay gio", "chua toi", "chua den"]);
/**
 * M7-P5A.3 (item 2): a DIRECTIONAL approximation right before the number means "below that number": "sắp 18" / "gần 18" / "sắp tròn 18" /
 * "chưa tới|đến|đủ|tròn|được 18" / "dưới 18". V1 reads "sắp 18" as an approximate 18 (adult) — an unsafe oracle for this direction; V2
 * rewrites the located mention to N-1 (see `detect`). "khoảng / tầm / hơn / trên / ngoài / đã / đủ N" are NOT directional (V1 behaviour kept).
 */
const DIRECTIONAL_RE = /(?:^|[^a-z0-9])((?:(?:sap|gan)(?:\s+(?:tron|dung|du))?|duoi|chua\s+(?:du|toi|den|tron|duoc)))\s*$/;
const DIRECTIONAL_LOOKBACK = 24;
/** Under-N reading only for a plausible minor threshold: N in 6..18 (N-1 stays in the 5..17 range this module reads at all). */
const directionalMax = (v: number): boolean => v >= 6 && v <= 18;

// regexes over the FOLDED sentence (same indices as the raw lower-cased one)
const D1_RE = /(?<![\d.,])(\d{1,2})\s*(?:tuoi|years? ?old|yo)\b/g; // V1's pattern, verbatim
const D2_PLAIN_RE = /\btuoi\s*(?:la\s*)?(\d{1,2})(?!\d)/g;
const TUOI_X_RE = new RegExp(`(?<![a-z0-9])tuoi\\s+cua\\s+([a-z]+)\\s+(?:la\\s+)?(\\d{1,2}(?!\\d)|${NUM_SRC}(?![a-z0-9]))`, "g");
const W_RE = new RegExp(`(?<![a-z0-9])(?:(${CHAIN_SRC})\\s+)?(${NUM_SRC})(?![a-z0-9])(\\s*tuoi(?![a-z0-9]))?`, "g");
const D3_RE = new RegExp(`(?<![a-z0-9.,])(?:(${CHAIN_SRC})\\s+)?(\\d{2})(?![a-z0-9])(?![.,]\\d)`, "g");

// ── subject words (RAW lower-case NFC forms, accented and unaccented — "còn" (still) is not "con" (child)) ───────────────────
/** A relation / possessive word directly before the pronoun makes it a third party ("con tôi", "em trai tôi", "mỡ của tôi"). */
const THIRD_PREV = new Set([
  "con", "chau", "cháu", "em", "be", "bé", "gai", "gái", "trai", "vo", "vợ", "chong", "chồng", "me", "mẹ", "bo", "bố", "ba", "bà",
  "cha", "thang", "thằng", "dua", "đứa", "nguoi", "người", "cac", "các", "cua", "của", "sinh", "yeu", "yêu",
]);
/** An address word directly before "tôi/mình" = possessive ("bạn tôi"); directly before "em" = AMBIGUOUS ("anh em", "chị em"). */
const ADDRESS = new Set(["anh", "chi", "chị", "ban", "bạn"]);
/** The head itself names a third party ("học sinh 15 tuổi", "người 16 tuổi"). */
const THIRD_NOUN = new Set([
  "sinh", "vien", "viên", "nguoi", "người", "be", "bé", "tre", "trẻ", "thang", "thằng", "dua", "đứa", "gai", "gái", "trai", "vo", "vợ", "chong", "chồng",
]);
const AMBIGUOUS_NOUN = new Set(["ban", "bạn", "con"]);
const COPULA_NOUN = new Set(["sinh", "nguoi", "người", "be", "bé", "tre", "trẻ", "vien", "viên", "gai", "gái", "trai"]); // "tôi là (một) (học) sinh 15 tuổi"
const COPULA_FILL = new Set(["hoc", "học", "mot", "một", "con", "nam", "nu", "nữ"]);
const COPULA_ADV = new Set(["moi", "mới", "dang", "đang", "van", "vẫn", "cung", "cũng", "gio", "giờ", "da", "đã", "vua", "vừa", "chi", "chỉ"]);

/** The documented ambiguous shapes (see header): exported so tests and reports quote the same list. */
export const AMBIGUOUS_PATTERNS: readonly string[] = [
  "A1 anh em | chị em | anh chị em | bạn em (+ age) — greeting compound OR address + the speaker 'em'",
  "A2 bạn | các bạn (+ age, no pronoun) — addressee / generic / greeting",
  "A3 con (+ age, no possessor) — child speaking OR parent",
];

export type AgeSubject = "FIRST" | "THIRD" | "AMBIGUOUS";
export type AgeMentionKind = "DIGITS" | "MARKER_DIGITS" | "WORDS";

export interface AgeMention {
  kind: AgeMentionKind;
  subject: AgeSubject;
  /** The ONE thing V1's extractFactsFromText is run on: the sentence, every other age expression blanked, this one in digit form. */
  text: string;
  /** The age was below 10 and was written as value+60 (V1 ignores digit ages below 10): subtract 60 from V1's value. */
  sentinel: boolean;
  /** The text carries ONLY digits V1 itself would read (no rewrite besides the blanking). */
  native: boolean;
}

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

interface Tok { f: string; raw: string; end: boolean; start: number }
interface Subject { cls: AgeSubject | "OTHER"; marker: boolean; /** start of a skipped "có" directly before the expression (item 1) */ coAt?: number }
interface Expr { start: number; end: number; value: number; kind: AgeMentionKind; render: string; subject: AgeSubject; native: boolean; sentinel: boolean }

const pronounOk = (t: Tok, accented: boolean): boolean => {
  if (t.f !== "toi" && t.f !== "tui" && t.f !== "em" && t.f !== "minh" && t.f !== "chau") return false;
  if (!accented) return true;
  return t.f === "toi" ? t.raw === "tôi" : t.f === "minh" ? t.raw === "mình" : t.f === "chau" ? t.raw === "cháu" : t.f === "em" ? t.raw === "em" : t.raw === "tui";
};

function tokensBefore(lower: string, f: string, pos: number): Tok[] {
  const from = Math.max(0, pos - LOOKBACK_CHARS);
  const seg = f.slice(from, pos);
  const toks: Tok[] = [];
  for (const m of seg.matchAll(/\S+/g)) {
    const a = from + m.index!;
    const b = a + m[0].length;
    toks.push({ f: m[0].replace(/[^a-z0-9]/g, ""), raw: lower.slice(a, b).replace(/[^\p{L}\p{N}]/gu, ""), end: /[,;:()"“”]$/.test(m[0]), start: a });
  }
  if (from > 0 && toks.length) toks.shift(); // the first token may be cut in half
  return toks;
}

/** Class of ONE head word given the tokens before it (t = the tokens up to and including the head). */
function classifyHead(t: Tok[], accented: boolean): AgeSubject | "OTHER" {
  const head = t[t.length - 1];
  const prev = t.length > 1 && !t[t.length - 2].end ? t[t.length - 2] : undefined;
  if (pronounOk(head, accented)) {
    if (!prev) return "FIRST";
    if (THIRD_PREV.has(prev.raw)) return "THIRD";
    if (ADDRESS.has(prev.raw)) return head.f === "em" ? "AMBIGUOUS" : "THIRD";
    return "FIRST";
  }
  if (THIRD_NOUN.has(head.raw)) {
    if (COPULA_NOUN.has(head.raw)) {
      // pronoun + "là" + [một] [học] NOUN ⇒ the speaker describes herself: "Tôi là học sinh 15 tuổi"
      let i = t.length - 2;
      while (i >= 0 && !t[i].end && COPULA_FILL.has(t[i].raw)) i--;
      if (i >= 0 && !t[i].end && t[i].f === "la") {
        i--;
        while (i >= 0 && !t[i].end && COPULA_ADV.has(t[i].raw)) i--;
        if (i >= 0 && !t[i].end && pronounOk(t[i], accented) && !(i > 0 && !t[i - 1].end && THIRD_PREV.has(t[i - 1].raw))) return "FIRST";
      }
    }
    return "THIRD";
  }
  if (AMBIGUOUS_NOUN.has(head.raw)) return "AMBIGUOUS";
  return "OTHER";
}

/** Who owns the age expression that starts at `pos`? (the tokens before it, adverbs skipped) */
function subjectBefore(lower: string, f: string, pos: number, accented: boolean, chain: string, skipCo = false): Subject {
  const t = tokensBefore(lower, f, pos);
  let coAt: number | undefined;
  if (skipCo && t.length) {
    // M7-P5A.3: "em mới CÓ mười lăm tuổi" — "có" directly before the age is neither a subject nor a modifier: skip it (accented text: only "có", never "cô"/"cơ")
    const c = t[t.length - 1];
    if (!c.end && (accented ? c.raw === "có" : c.raw === "co")) { coAt = c.start; t.length -= 1; }
  }
  const stripped: string[] = [];
  for (let i = 0; i < 3 && t.length; i++) {
    const l = t[t.length - 1];
    if (l.end) break;
    const l2 = t[t.length - 2];
    if (l2 && !l2.end && ADV2.has(`${l2.f} ${l.f}`)) { stripped.unshift(`${l2.f} ${l.f}`); t.length -= 2; continue; }
    if (ADV1.has(l.f) && l.raw !== "chị") { stripped.unshift(l.f); t.length -= 1; continue; }
    break;
  }
  const advText = [...stripped, chain].join(" ");
  const hasMarker = (head?: Tok): boolean => MARKER_RE.test(advText) || (head !== undefined && LEAD_MARKER.test(f.slice(Math.max(0, head.start - 14), head.start)));
  if (!t.length) return { cls: "OTHER", marker: hasMarker(), coAt };
  const head = t[t.length - 1];
  if (head.end) {
    // the expression opens a new clause right after "X," — only a THIRD party carries over (appositive "Con tôi, 15 tuổi,")
    const c = classifyHead(t, accented);
    return { cls: c === "THIRD" ? "THIRD" : "OTHER", marker: hasMarker(), coAt };
  }
  return { cls: classifyHead(t, accented), marker: hasMarker(head), coAt };
}

/**
 * Subject with the optional "có" skip (item 1). The skip is only accepted when it yields a FIRST or THIRD owner — an AMBIGUOUS / OTHER
 * result ("Con có 15 tuổi", "Bạn có 15 tuổi") keeps the previous reading, so the skip can only ADD a located speaker/third-party age.
 */
function subjectBeforeAge(lower: string, f: string, pos: number, accented: boolean, chain: string): Subject {
  const plain = subjectBefore(lower, f, pos, accented, chain, false);
  const withCo = subjectBefore(lower, f, pos, accented, chain, true);
  return withCo.coAt !== undefined && (withCo.cls === "FIRST" || withCo.cls === "THIRD") ? withCo : plain;
}

/** Start index of a directional approximation word directly before `numStart` ("sắp", "gần tròn", "chưa tới", "dưới"), or -1. */
function directionalStart(f: string, numStart: number): number {
  const from = Math.max(0, numStart - DIRECTIONAL_LOOKBACK);
  const m = DIRECTIONAL_RE.exec(f.slice(from, numStart));
  return m ? from + m.index + m[0].indexOf(m[1]) : -1;
}

/** Subject of "tuổi của X …": X alone decides. */
function subjectOfX(x: string, rawX: string, accented: boolean): AgeSubject | "OTHER" {
  const tok: Tok = { f: x, raw: rawX, end: false, start: 0 };
  if (pronounOk(tok, accented)) return "FIRST";
  if (THIRD_NOUN.has(rawX) || THIRD_PREV.has(rawX)) return "THIRD";
  if (AMBIGUOUS_NOUN.has(rawX)) return "AMBIGUOUS";
  return "OTHER";
}

const rangeOverlaps = (a: Expr, b: { start: number; end: number }): boolean => a.start < b.end && b.start < a.end;

function detect(lower: string, f: string, accented: boolean, budget: number): Expr[] {
  const out: Expr[] = [];
  const add = (e: Expr): boolean => {
    if (out.length >= budget || out.some((o) => rangeOverlaps(o, e))) return false;
    out.push(e);
    return true;
  };
  const sentinelOf = (v: number): number => (v < 10 ? v + 60 : v);

  // D1 — digits + tuổi (V1 pattern)
  for (const m of f.matchAll(D1_RE)) {
    const v = Number(m[1]);
    if (v < 5) continue;
    const start = m.index!;
    const s = subjectBeforeAge(lower, f, start, accented, "");
    if (s.cls === "OTHER" && v < 10) continue; // V1 parity: no subject word ⇒ a digit age below 10 is not read
    const subject: AgeSubject = s.cls === "OTHER" ? "FIRST" : s.cls;
    const tail = lower.slice(start + m[1].length, start + m[0].length);
    // item 2: "em sắp 18 tuổi" / "dưới 18 tuổi" → the first-person age is UNDER 18 (N-1), not V1's approximate 18
    const dir = s.cls === "FIRST" && directionalMax(v) ? directionalStart(f, start) : -1;
    if (dir >= 0) {
      add({ start: dir, end: start + m[0].length, value: v - 1, kind: "DIGITS", subject, native: false, sentinel: v - 1 < 10, render: String(sentinelOf(v - 1)) + tail });
      continue;
    }
    const sentinel = v < 10;
    add({ start: s.coAt ?? start, end: start + m[0].length, value: v, kind: "DIGITS", subject, native: !sentinel && s.coAt === undefined, sentinel,
      render: String(sentinelOf(v)) + tail });
  }
  // D2 — "tuổi của X 15" / "tuổi [là] 15" / written "tuổi của em là mười lăm"
  for (const m of f.matchAll(TUOI_X_RE)) {
    const start = m.index!;
    const x = m[1];
    const xStart = start + m[0].indexOf(x, 4 + 3);
    const cls = subjectOfX(x, lower.slice(xStart, xStart + x.length), accented);
    if (cls === "OTHER") continue;
    const numPart = m[2];
    const numEnd = start + m[0].length;
    const v = /^\d/.test(numPart) ? Number(numPart) : parseVietnameseNumberWords(numPart);
    if (v === null || v < 5 || v > 99) continue;
    const written = !/^\d/.test(numPart);
    add({ start: xStart + x.length, end: numEnd, value: v, kind: written ? "WORDS" : "DIGITS", subject: cls, native: false, sentinel: v < 10,
      render: ` ${sentinelOf(v)}` });
  }
  for (const m of f.matchAll(D2_PLAIN_RE)) {
    const v = Number(m[1]);
    if (v < 10) continue; // no subject word ⇒ V1 parity (below 10 ignored)
    const start = m.index!;
    add({ start, end: start + m[0].length, value: v, kind: "DIGITS", subject: "FIRST", native: true, sentinel: false, render: lower.slice(start, start + m[0].length) });
  }
  // W1 / W2 — written numbers
  for (const m of f.matchAll(W_RE)) {
    if (out.length >= budget) break;
    const chain = m[1] ?? "";
    const numFolded = m[2];
    const hasTuoi = m[3] !== undefined;
    const at = m.index!;
    const numStart = at + m[0].indexOf(numFolded, chain.length);
    const numEnd = numStart + numFolded.length;
    const v = parseVietnameseNumberWords(numFolded);
    if (v === null) continue;
    if (!hasTuoi && v < 10) continue;
    const s = hasTuoi ? subjectBeforeAge(lower, f, at, accented, chain) : subjectBefore(lower, f, at, accented, chain);
    if (s.cls === "OTHER") continue;
    if (!hasTuoi && (!s.marker || !TERMINATOR.test(f.slice(numEnd, numEnd + 12)))) continue;
    const end = hasTuoi ? at + m[0].length : numEnd;
    const dir = hasTuoi && s.cls === "FIRST" && directionalMax(v) ? directionalStart(f, numStart) : -1;
    if (dir >= 0) {
      add({ start: dir, end, value: v - 1, kind: "WORDS", subject: s.cls, native: false, sentinel: v - 1 < 10, render: `${sentinelOf(v - 1)} tuoi` });
      continue;
    }
    add({ start: s.coAt ?? numStart, end, value: v, kind: "WORDS", subject: s.cls, native: false, sentinel: v < 10, render: `${sentinelOf(v)} tuoi` });
  }
  // D3 — marker + two digits at the end of the clause
  for (const m of f.matchAll(D3_RE)) {
    if (out.length >= budget) break;
    const v = Number(m[2]);
    if (v < 10) continue;
    const at = m.index!;
    const chain = m[1] ?? "";
    const numStart = at + m[0].length - m[2].length;
    const numEnd = at + m[0].length;
    if (/^\s*tuoi/.test(f.slice(numEnd, numEnd + 8))) continue; // D1 owns "15 tuổi"
    if (!TERMINATOR.test(f.slice(numEnd, numEnd + 12))) continue;
    const s = subjectBefore(lower, f, at, accented, chain);
    if (s.cls === "OTHER" || !s.marker) continue;
    add({ start: numStart, end: numEnd, value: v, kind: "MARKER_DIGITS", subject: s.cls, native: false, sentinel: false, render: `${v} tuoi` });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The sentence with every expression blanked, except `keep` which is replaced by its digit form. */
function compose(sentence: string, exprs: Expr[], keep: number): string {
  let out = "";
  let at = 0;
  exprs.forEach((e, j) => {
    out += sentence.slice(at, e.start);
    out += j === keep ? e.render : " ".repeat(Math.max(1, e.end - e.start));
    at = e.end;
  });
  return out + sentence.slice(at);
}

/**
 * Every age mention of `text` (≤ 8), each with its subject class and the V1 input text. `residual` = the whole text with all
 * recognised expressions blanked: V1 run on it can only find an age shape this module does not locate (V1 parity for those).
 * Never throws.
 */
export function findAgeMentions(text: string): { mentions: AgeMention[]; residual: string } {
  try {
    const lower = String(text ?? "").slice(0, MAX_SCAN_CHARS).normalize("NFC").toLowerCase();
    if (lower.length < 3) return { mentions: [], residual: lower };
    const accented = DIACRITIC.test(lower);
    const mentions: AgeMention[] = [];
    let residual = "";
    let base = 0;
    for (const piece of lower.split(/(?<=[.!?;…])\s+|\n+/)) {
      const at = lower.indexOf(piece, base);
      residual += lower.slice(base, at < 0 ? base : at);
      base = at < 0 ? base : at + piece.length;
      const f = fold(piece);
      const exprs = MAX_MENTIONS - mentions.length > 0 ? detect(piece, f, accented, MAX_MENTIONS - mentions.length) : [];
      exprs.forEach((e, i) => mentions.push({ kind: e.kind, subject: e.subject, text: compose(piece, exprs, i), sentinel: e.sentinel, native: e.native }));
      residual += compose(piece, exprs, -1);
    }
    return { mentions, residual };
  } catch {
    return { mentions: [], residual: "" };
  }
}

/**
 * Each supported written-age phrase (WORDS, speaker subject) as the sentence copy V1 understands. One entry per phrase. Empty when
 * there is none (third-party and ambiguous phrases are NOT listed). Never throws.
 */
export function rewriteWrittenAgeSentences(text: string): string[] {
  return findAgeMentions(text).mentions.filter((m) => m.kind === "WORDS" && m.subject === "FIRST").map((m) => m.text);
}
