/**
 * Event-scoped classifier for the BARE-verb induced-vomiting disclosure (V1 safety, M7-P5A.3d redesign).
 *
 * "Ăn xong mình ói để giảm cân" names no explicit act (no "móc họng", no "ép / tự / cố tình"): a bare vomit verb is also an involuntary symptom.
 * It is a disclosure only when ONE vomiting EVENT carries a weight / shape / calorie-control PURPOSE and no benign CAUSE. Three earlier rounds decided
 * this with global regex exclusions and each created boundary regressions; this module decides it STRUCTURALLY (no keyword search over the whole text):
 *
 *   question -> sentences ([.!?;…\n\r]) -> parentheses resolved -> clauses (, ， : – — " - ") -> tokens
 *   EVENT   = in one clause: a FIRST-person subject (not possessed by a relation head) + <= 4 tokens + a vomit verb (ói / nôn / mửa) + a meal anchor
 *             (ăn xong | ăn rồi | sau khi ăn | sau [mỗi] bữa [ăn]) in the shapes "[anchor] .. subject .. verb" or "subject .. verb [ra|hết|ngay] anchor".
 *   NEGATED verb (không | chưa | chẳng | chả | đừng right before it), a gap that holds a request / modal / symptom word (muốn, biết, cách, nên, bị, buồn …)
 *             and every non-first-person actor => not an event.
 *   PURPOSE / BENIGN CAUSE phrases are OWNED by an event: own clause (the nearest preceding vomit verb; "ói để giữ dáng tôi đi bộ" stays the event's,
 *             "… nên/thì + subject" belongs to the other action), or an ADJACENT clause of the same sentence that STARTS with a purpose (resp. cause)
 *             marker and does not continue with its own subject. Another sentence / a non-adjacent clause / another actor never counts.
 *   OUTCOME = DISCLOSURE iff an event owns >= 1 purpose and no benign cause (same-event cause wins). Any DISCLOSURE event refuses the question.
 *   Ambiguous ownership => no refusal from this path. Never a refusal on a bare vomit verb alone.
 *
 * Relation heads (con tôi, cô mình, chị mình, bé nhà mình …) are decided from the ORIGINAL tokens: text with any Vietnamese diacritic uses only the
 * properly accented heads (so "chỉ / có / cố / còn / chứ" are not heads); wholly unaccented text uses the unambiguous plain heads and NOT co / chi / chu
 * (accepted trade-off: favour detection). Classification only — the user's text is never rewritten. Linear time, no backtracking-prone regex.
 * This file must not import safety_guard.ts (safety_guard imports it).
 */

// ── public types ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type InducedVomitingActor = "FIRST" | "THIRD" | "NONE";
export type InducedVomitingOutcome = "DISCLOSURE" | "SYMPTOM" | "NO_EVENT";
export type PhraseOwner = "EVENT" | "OTHER_ACTION" | "OTHER_VERB" | "NOT_ADOPTED";
export interface OwnedPhrase {
  text: string;
  where: "OWN_CLAUSE" | "ADJACENT_CLAUSE";
  owner: PhraseOwner;
}
export interface VomitEvent {
  sentenceIdx: number;
  clauseIdx: number;
  actor: InducedVomitingActor;
  verb: string;
  anchor: boolean;
  negated: boolean;
  purposes: OwnedPhrase[];
  causes: OwnedPhrase[];
  outcome: InducedVomitingOutcome;
}
export interface InducedVomitingAnalysis {
  hasDiacritics: boolean;
  relationHeads: "accented" | "plain";
  sentenceCount: number;
  clauseCount: number;
  events: VomitEvent[];
  disclosure: boolean;
}

// ── lexicon (copied from the former bare path of safety_guard.ts; "fold" = diacritics removed, đ -> d) ───────────────────────────
const IV_PURPOSE_BODY = String.raw`(?:gon|thon|om|gay|nhe\s+can|manh|eo)(?:\s+(?:nguoi|eo))?`;
// Purge PURPOSE vocabulary (folded text). Every entry is a purpose PHRASE (body / shape / weight / calorie control) — never a bare "dang", "nhe", "om",
// "gay", "map", "beo". The fold marks the accented "ôm" (hug) as "oxm", so "om" below is "ốm" or unaccented input.
const PURPOSE_SOURCE =
  String.raw`\b(?:` +
  [
    String.raw`ep|co\s+tinh|co\s+y|tu\s+lam|chu\s+dong`,
    String.raw`(?:de|cho)\s+(?:do|bot|khoi|dep)\s+(?:beo|map|mo|tang\s+can)`,
    String.raw`(?:de\s+)?giam\s+(?:can|beo|mo|calo|calories)`,
    String.raw`(?:de\s+)?khoi\s+(?:tang|beo|map)`,
    String.raw`(?:khong|dung|khoi)\s+(?:muon\s+)?(?:bi\s+)?(?:len\s+can|tang\s+can|beo|map)`,
    String.raw`do\s+(?:beo|map)`,
    String.raw`dep\s+(?:beo|mo)`,
    String.raw`so\s+(?:len\s+can|tang\s+can|beo|map)`,
    String.raw`(?:giu|duy\s+tri)\s+(?:dang|eo|voc\s+dang|form|can\s+nang|can(?!\s+bang)|vong\s+eo|body)`,
    String.raw`(?:cho|de)\s+${IV_PURPOSE_BODY}`,
    String.raw`kiem\s+soat\s+(?:can\s+nang|can(?!\s+bang)|calo|calories)`,
    String.raw`(?:dot|bot|thai|loai\s+bo|loai|tieu)\s+(?:bot\s+)?(?:calo|calories|mo)`,
    String.raw`keo\s+(?:beo|map|tang\s+can|len\s+can)`,
    String.raw`tranh\s+(?:beo|map|tang\s+can|len\s+can)`,
  ].join("|") +
  String.raw`)\b`;
const CAUSE_SOURCE = String.raw`\b(?:vi|do|boi|tai)\s+(?:bi\s+)?(?:say\s+(?:xe|song|nang)|ngo\s+doc|trao\s+nguoc|da\s+day|om|cam|benh|sot|thai\s+nghen|thai|thuoc|di\s+ung|an\s+phai|an\s+do\s+hong|do\s+an\s+hong)\b`;
const PURPOSE_RE = new RegExp(PURPOSE_SOURCE, "g");
const CAUSE_RE = new RegExp(CAUSE_SOURCE, "g");

const nfc = (s: string): string => s.normalize("NFC");
const setOf = (words: string[]): Set<string> => new Set(words.map(nfc));

/** First-person subject words as WRITTEN (accented or plain). "tối / tới" are never "tôi"; "tớ / tô" omitted ("to" also means big). */
const FIRST_PERSON = setOf(["mình", "minh", "tôi", "toi", "tui", "em", "tao"]);
const FIRST_PERSON_FOLDED = new Set(["minh", "toi", "tui", "em", "tao"]);
/** A subject that may follow a purpose / cause phrase and take it for ITS action (the former IV_OWN_SUBJECT_AFTER_PURPOSE list). */
const SUBJECT_AFTER = new Set<string>([...FIRST_PERSON, "anh"]);
// Relation / possessive heads that make a following first-person word a THIRD person ("con tôi", "cô mình", "bé nhà mình", "của tôi").
// Accented text (any diacritic anywhere in the question): only the properly accented spelling counts, plus the heads that are ordinary ASCII words
// (con / ba / anh / trai / cha). Wholly unaccented text: every unambiguous head counts, but NOT the ambiguous co / chi / chu (favour detection).
const HEADS_ACCENTED = setOf(["bạn", "vợ", "chồng", "chị", "mẹ", "bố", "bà", "chú", "cô", "cậu", "bé", "nhà", "của", "gái", "ông", "bác", "dì", "cháu", "đứa", "thằng", "người", "con", "ba", "anh", "trai", "cha"]);
const HEADS_PLAIN = setOf(["con", "vo", "chong", "me", "bo", "ba", "chau", "be", "nguoi", "trai", "gai", "ong", "bac", "dua", "thang", "nha", "anh", "ban", "cua"]);
// Words that make the following first-person word a non-singular / non-speaker reading ("em nó ói", "bọn mình ói"): not a first-person event.
const THIRD_MARK_ACCENTED = setOf(["nó", "ấy", "hắn", "họ", "bọn", "chúng"]);
const THIRD_MARK_PLAIN = setOf(["no", "ay", "han", "bon", "chung"]);
// Words (folded) that, between the subject and the verb or between the meal anchor and the subject, turn the sentence into a request / modal /
// hypothetical / symptom reading instead of "I do it": "mình muốn biết cách ói …", "mình bị ói …", "mình buồn nôn …", "mình nên ói …".
const IRREALIS = new Set(["muon", "biet", "cach", "nen", "can", "dinh", "se", "sap", "duoc", "phai", "thu", "suyt", "mong", "thay", "bi", "buon", "hoi", "tinh", "the", "lo", "giup", "huong"]);
const NEGATION = new Set(["khong", "chua", "chang", "cha", "dung"]);
const PURPOSE_START = new Set(["de", "cho", "nham", "muon", "so", "keo", "tranh"]);
const CAUSE_START = new Set(["vi", "do", "boi", "tai"]);
const ASIDE_MARKERS = new Set(["de", "cho", "nham", "muon", "so", "keo", "tranh", "vi", "do", "boi", "tai"]);
const ANCHOR_FILLER = new Set(["ra", "het", "ngay"]);

const SENTENCE_SPLIT = /[.!?;…\n\r]+/;
const BREAK = "\u0001"; // clause break written around an independent parenthetical aside
// Clause separators: comma, full-width comma, colon, an unspaced / spaced en or em dash, a spaced hyphen, and the break marker above.
const CLAUSE_SPLIT = /[,，:\u0001–—]|\s-+\s/;
const TOKEN_RE = /[\p{L}\p{M}\p{N}]+/gu;
const HAS_DIACRITIC = /[À-ɏḀ-ỿ]/;
const QUICK_VERB = /non|nôn|oi|ói|mửa/;
/** Hard ceiling on the scanned text (head + tail kept so a disclosure at either end is still seen). Work is linear anyway. */
const MAX_SCAN_CHARS = 200_000;

// ── tokens ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Tok { o: string; f: string }
interface Span { s: number; e: number }
interface Ctx { heads: Set<string>; third: Set<string> }
interface Clause {
  toks: Tok[];
  verbs: number[];
  startAt: Uint8Array;
  lastEnd: Int32Array;
  covered: Int32Array;
  purposes: Span[];
  causes: Span[];
  firstSubject: number;
}

function foldWord(w: string): string {
  return w.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}
/** Fold one lower-cased NFC word. The accented words mửa / ói / ôm and the interjections ôi / ơi / ối are MARKED so the fold cannot turn them into
 *  "mua" (buy) / "oi" (vomit?) / "om" (ốm). */
function markedFold(o: string): string {
  if (o === "ói") return "oiz";
  if (o === "mửa") return "mxuaz";
  if (o === "ôm") return "oxm";
  if (/^[ôơốồổỗộớờởỡợ]i$/u.test(o)) return "oxi";
  return foldWord(o);
}
function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN_RE)) out.push({ o: m[0], f: markedFold(m[0]) });
  return out;
}
const isVomitWord = (f: string): boolean => f === "non" || f === "oiz" || f === "mxuaz" || f === "oi";

const isPronoun = (t: Tok | undefined): boolean => !!t && FIRST_PERSON.has(t.o);
const isHead = (ctx: Ctx, t: Tok | undefined): boolean => !!t && ctx.heads.has(t.o);
const isThirdMark = (ctx: Ctx, t: Tok | undefined): boolean => !!t && ctx.third.has(t.o);

// ── clause construction ───────────────────────────────────────────────────────────────────────────────────────────────────────
function lastLess(arr: number[], x: number): number {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) { ans = arr[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
function firstAtLeast(arr: number[], x: number): number {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] >= x) { ans = arr[mid]; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}
/** Index of the last element <= x (token containing a character offset). */
function indexAtMost(arr: number[], x: number): number {
  let lo = 0, hi = arr.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
function phraseSpans(re: RegExp, joined: string, starts: number[]): Span[] {
  const spans: Span[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    spans.push({ s: indexAtMost(starts, m.index), e: indexAtMost(starts, m.index + m[0].length - 1) + 1 });
  }
  return spans;
}
function isSubjectAt(ctx: Ctx, toks: Tok[], k: number): boolean {
  const t = toks[k];
  if (!t) return false;
  if (SUBJECT_AFTER.has(t.o)) return true;
  return isHead(ctx, t) && isPronoun(toks[k + 1]);
}
/** Does the text starting at `from` begin with its own subject (optionally / necessarily after nên / nên là / thì)? */
function startsWithSubject(ctx: Ctx, toks: Tok[], from: number, connector: "required" | "optional"): boolean {
  let k = from;
  let hadConnector = false;
  if (toks[k]?.f === "nen") { k++; if (toks[k]?.f === "la") k++; hadConnector = true; }
  else if (toks[k]?.f === "thi") { k++; hadConnector = true; }
  if (connector === "required" && !hadConnector) return false;
  return isSubjectAt(ctx, toks, k);
}
function buildClause(text: string, ctx: Ctx): Clause {
  const toks = tokenize(text);
  const n = toks.length;
  const verbs: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = toks[i].f;
    if (!isVomitWord(f)) continue;
    // an unaccented bare "oi" directly after a first-person word is the vocative "em ơi / mình ơi"; "nôn nóng" / "nôn nao" are not vomiting
    if (f === "oi" && i > 0 && FIRST_PERSON_FOLDED.has(toks[i - 1].f)) continue;
    const next = toks[i + 1]?.f;
    if (next === "nong" || next === "nao") continue;
    verbs.push(i);
  }
  // meal anchors (token spans): ăn xong | ăn rồi | sau khi ăn | sau [mỗi] bữa [ăn]
  const startAt = new Uint8Array(n + 2);
  const endsAt = new Uint8Array(n + 2);
  const covered = new Int32Array(n + 1);
  const mark = (s: number, e: number): void => {
    startAt[s] = 1;
    endsAt[e] = 1;
    for (let k = s; k < e; k++) covered[k + 1] = 1;
  };
  for (let i = 0; i < n; i++) {
    const a = toks[i].f, b = toks[i + 1]?.f, c = toks[i + 2]?.f, d = toks[i + 3]?.f;
    if (a === "an" && (b === "xong" || b === "roi")) mark(i, i + 2);
    else if (a === "sau") {
      if (b === "khi" && c === "an") mark(i, i + 3);
      else if (b === "bua") { mark(i, i + 2); if (c === "an") mark(i, i + 3); }
      else if (b === "moi" && c === "bua") { mark(i, i + 3); if (d === "an") mark(i, i + 4); }
    }
  }
  for (let k = 1; k <= n; k++) covered[k] += covered[k - 1]; // prefix counts of anchor-covered tokens
  const lastEnd = new Int32Array(n + 1);
  let cur = -1;
  for (let i = 0; i <= n; i++) { if (endsAt[i]) cur = i; lastEnd[i] = cur; }
  // purpose / cause phrases (folded, marked text)
  let purposes: Span[] = [];
  let causes: Span[] = [];
  if (n > 0) {
    const starts: number[] = [];
    let pos = 0;
    const parts: string[] = [];
    for (const t of toks) { starts.push(pos); parts.push(t.f); pos += t.f.length + 1; }
    const joined = parts.join(" ");
    purposes = phraseSpans(PURPOSE_RE, joined, starts);
    causes = phraseSpans(CAUSE_RE, joined, starts);
  }
  let firstSubject = n;
  for (let k = 0; k < n; k++) { if (isSubjectAt(ctx, toks, k)) { firstSubject = k; break; } }
  return { toks, verbs, startAt, lastEnd, covered, purposes, causes, firstSubject };
}
const anchorCoveredBetween = (c: Clause, from: number, to: number): boolean => to > from && c.covered[to] - c.covered[from] > 0; // tokens [from, to)
const hasIrrealis = (c: Clause, from: number, to: number): boolean => {
  for (let k = from; k < to; k++) if (IRREALIS.has(c.toks[k].f)) return true;
  return false;
};

// ── parentheses ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type AsideKind = "TRANSPARENT" | "INLINE" | "INDEPENDENT";
/** Pure modifier ("(hằng ngày)", "(3 lần/tuần)") -> TRANSPARENT; carries a purpose / cause marker but no subject / verb -> INLINE; own subject / verb -> INDEPENDENT. */
function classifyAside(content: string, ctx: Ctx): AsideKind {
  if (content.includes(BREAK)) return "INDEPENDENT";
  const toks = tokenize(content);
  if (toks.some((t) => isVomitWord(t.f))) return "INDEPENDENT";
  if (toks.some((t, k) => isPronoun(t) || isHead(ctx, t) || isThirdMark(ctx, t) || isSubjectAt(ctx, toks, k))) return "INDEPENDENT";
  if (toks.some((t) => ASIDE_MARKERS.has(t.f))) return "INLINE";
  const joined = toks.map((t) => t.f).join(" ");
  PURPOSE_RE.lastIndex = 0;
  CAUSE_RE.lastIndex = 0;
  if (PURPOSE_RE.test(joined) || CAUSE_RE.test(joined)) return "INLINE";
  return "TRANSPARENT";
}
/** Resolve "(…)" groups of one sentence. Nested and UNBALANCED parentheses are safe: a stray ")" is dropped, an unclosed "(" just loses the character. */
function resolveParens(sentence: string, ctx: Ctx): string {
  if (!sentence.includes("(") && !sentence.includes(")")) return sentence;
  const stack: string[] = [""];
  for (const ch of sentence) {
    if (ch === "(") stack.push("");
    else if (ch === ")") {
      if (stack.length > 1) {
        const content = stack.pop() as string;
        const kind = classifyAside(content, ctx);
        const top = stack.length - 1;
        if (kind === "INLINE") stack[top] += ` ${content} `;
        else if (kind === "INDEPENDENT") stack[top] += `${BREAK}${content}${BREAK}`;
        else stack[top] += " ";
      }
    } else stack[stack.length - 1] += ch;
  }
  while (stack.length > 1) {
    const content = stack.pop() as string;
    stack[stack.length - 1] += content;
  }
  return stack[0];
}

// ── event analysis ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const phraseText = (c: Clause, sp: Span): string => c.toks.slice(sp.s, sp.e).map((t) => t.o).join(" ");
const startsWithPurposeMarker = (c: Clause): boolean => {
  const t0 = c.toks[0]?.f, t1 = c.toks[1]?.f, t2 = c.toks[2]?.f;
  if (t0 === undefined) return false;
  if (PURPOSE_START.has(t0)) return true;
  return t0 === "vi" && (t1 === "muon" || t1 === "so" || t1 === "de" || t1 === "nham" || (t1 === "khong" && t2 === "muon"));
};
const startsWithCauseMarker = (c: Clause): boolean => c.toks[0] !== undefined && CAUSE_START.has(c.toks[0].f);

function resolveActor(ctx: Ctx, c: Clause, v: number): { actor: InducedVomitingActor; subject: number } {
  for (let k = v - 1; k >= 0 && k >= v - 5; k--) {
    const t = c.toks[k];
    if (isPronoun(t)) {
      const prev = c.toks[k - 1];
      const possessed = isHead(ctx, prev) || isThirdMark(ctx, prev);
      return { actor: possessed ? "THIRD" : "FIRST", subject: k };
    }
    if (isHead(ctx, t) || isThirdMark(ctx, t)) return { actor: "THIRD", subject: k };
  }
  return { actor: "NONE", subject: -1 };
}
function isNegated(c: Clause, v: number): boolean {
  const f = (k: number): string | undefined => c.toks[k]?.f;
  if (NEGATION.has(f(v - 1) ?? "") || NEGATION.has(f(v - 2) ?? "")) return true;
  return NEGATION.has(f(v - 3) ?? "") && f(v - 2) === "bao" && f(v - 1) === "gio"; // "không bao giờ ói"
}
/** Meal anchor of an event: "[anchor] .. subject .. verb" (anchor before the subject, <= 4 tokens) or "subject .. verb [ra|hết|ngay] anchor". */
function hasAnchor(c: Clause, subject: number, v: number): boolean {
  const aEnd = c.lastEnd[subject];
  if (aEnd >= 0 && subject - aEnd <= 4 && !hasIrrealis(c, aEnd, subject)) return true;
  let k = v + 1;
  while (k < c.toks.length && ANCHOR_FILLER.has(c.toks[k].f)) k++;
  return k < c.toks.length && c.startAt[k] === 1;
}

interface Own { purposes: OwnedPhrase[]; causes: OwnedPhrase[] }
function ownClausePhrases(ctx: Ctx, c: Clause): Map<number, Own> {
  const map = new Map<number, Own>();
  const slot = (v: number): Own => {
    let o = map.get(v);
    if (!o) { o = { purposes: [], causes: [] }; map.set(v, o); }
    return o;
  };
  const place = (sp: Span, kind: "purposes" | "causes"): void => {
    const prev = lastLess(c.verbs, sp.s);
    const following = prev < 0;
    const verb = following ? firstAtLeast(c.verbs, sp.e) : prev;
    if (verb < 0) return;
    // fronted phrase (its verb lies in the tail) belongs to that verb; otherwise a "nên / thì + subject" tail hands it to the other action
    const otherAction = !following && startsWithSubject(ctx, c.toks, sp.e, "required");
    slot(verb)[kind].push({ text: phraseText(c, sp), where: "OWN_CLAUSE", owner: otherAction ? "OTHER_ACTION" : "EVENT" });
  };
  for (const sp of c.purposes) place(sp, "purposes");
  for (const sp of c.causes) place(sp, "causes");
  return map;
}
function adjacentPhrases(ctx: Ctx, clauses: Clause[], i: number): Own {
  const out: Own = { purposes: [], causes: [] };
  for (const j of [i - 1, i + 1]) {
    const c2 = clauses[j];
    if (!c2) continue;
    const lastVerb = c2.verbs.length ? c2.verbs[c2.verbs.length - 1] : -1;
    const adopt = (sp: Span): boolean => !(lastVerb >= sp.e) && sp.s < c2.firstSubject && !startsWithSubject(ctx, c2.toks, sp.e, "optional");
    if (startsWithPurposeMarker(c2)) {
      for (const sp of c2.purposes) out.purposes.push({ text: phraseText(c2, sp), where: "ADJACENT_CLAUSE", owner: adopt(sp) ? "EVENT" : "NOT_ADOPTED" });
    }
    if (startsWithCauseMarker(c2)) {
      for (const sp of c2.causes) out.causes.push({ text: phraseText(c2, sp), where: "ADJACENT_CLAUSE", owner: adopt(sp) ? "EVENT" : "NOT_ADOPTED" });
    }
  }
  return out;
}

function analyze(question: string, collect: boolean): InducedVomitingAnalysis {
  let raw = nfc(String(question ?? "")).toLowerCase();
  const hasDiacritics = HAS_DIACRITIC.test(raw);
  const result: InducedVomitingAnalysis = {
    hasDiacritics,
    relationHeads: hasDiacritics ? "accented" : "plain",
    sentenceCount: 0,
    clauseCount: 0,
    events: [],
    disclosure: false,
  };
  if (!QUICK_VERB.test(raw)) return result;
  if (raw.length > MAX_SCAN_CHARS) raw = `${raw.slice(0, MAX_SCAN_CHARS / 2)}\n${raw.slice(raw.length - MAX_SCAN_CHARS / 2)}`;
  raw = raw.replaceAll(BREAK, " ");
  const ctx: Ctx = hasDiacritics ? { heads: HEADS_ACCENTED, third: THIRD_MARK_ACCENTED } : { heads: HEADS_PLAIN, third: THIRD_MARK_PLAIN };
  const sentences = raw.split(SENTENCE_SPLIT);
  for (let si = 0; si < sentences.length; si++) {
    if (!sentences[si].trim()) continue;
    result.sentenceCount++;
    const clauses = resolveParens(sentences[si], ctx)
      .split(CLAUSE_SPLIT)
      .map((part) => buildClause(part, ctx))
      .filter((c) => c.toks.length > 0);
    result.clauseCount += clauses.length;
    for (let ci = 0; ci < clauses.length; ci++) {
      const c = clauses[ci];
      if (c.verbs.length === 0) continue;
      let own: Map<number, Own> | undefined;
      let adjacent: Own | undefined;
      for (const v of c.verbs) {
        const { actor, subject } = resolveActor(ctx, c, v);
        const ev: VomitEvent = { sentenceIdx: si, clauseIdx: ci, actor, verb: c.toks[v].o, anchor: false, negated: false, purposes: [], causes: [], outcome: "NO_EVENT" };
        if (actor === "FIRST") {
          ev.negated = isNegated(c, v);
          const cleanGap = !hasIrrealis(c, subject + 1, v) && !anchorCoveredBetween(c, subject + 1, v);
          ev.anchor = cleanGap && hasAnchor(c, subject, v);
          if (ev.anchor && !ev.negated) {
            own ??= ownClausePhrases(ctx, c);
            adjacent ??= adjacentPhrases(ctx, clauses, ci);
            const mine = own.get(v);
            ev.purposes = [...(mine?.purposes ?? []), ...adjacent.purposes];
            ev.causes = [...(mine?.causes ?? []), ...adjacent.causes];
            const hasPurpose = ev.purposes.some((p) => p.owner === "EVENT");
            const hasCause = ev.causes.some((p) => p.owner === "EVENT");
            ev.outcome = hasPurpose && !hasCause ? "DISCLOSURE" : "SYMPTOM";
          }
        }
        if (ev.outcome === "DISCLOSURE") {
          result.disclosure = true;
          if (!collect) return result;
        }
        if (collect) result.events.push(ev);
      }
    }
  }
  return result;
}

/** Structured classification (tests / inspection): every vomit verb with its actor, anchor, negation, owned phrases and outcome. */
export function analyzeInducedVomiting(question: string): InducedVomitingAnalysis {
  return analyze(question, true);
}
/** True iff the question contains a first-person bare-verb vomiting EVENT with an owned weight / shape purpose and no owned benign cause. */
export function detectBareVomitingDisclosure(question: string): boolean {
  return analyze(question, false).disclosure;
}
