/**
 * Risk-evidence extraction (M9.5-T1B). Per VIEW (nfc / ascii) it:
 *   1. splits the text into CLAUSES (punctuation and "nhưng / mà / thì / but / however / then"), SEGMENTS (clauses further split at "và / and / rồi / nên / so" — the scope of
 *      tense / hypothesis) and SENTENCES (.!?);
 *   2. finds the situation CORES of each domain (lexicon below, data, compiled once at module load — immutable, no per-request state);
 *   3. reads for every event the SUBJECT (nearest subject word before it in its clause), TENSE and HYPOTHESIS (in its own segment), NEGATION (3 words before it) and
 *      CONTEXT (education / fiction / hyperbole / muscle twitch), and records a DISPOSITION — evidence that does not count is KEPT with the reason, never dropped;
 *   4. pairs multi-part conditions (heat + confusion, seizure + severe sign, stroke-like signs) ONLY for the same PERSON: a pronoun is linked to its antecedent only when exactly
 *      one candidate (same / previous sentence, gender-compatible) exists, otherwise it is flagged ambiguous ("?he") and combined with nothing (M9.5-T1B-F1).
 * No result cap: every match is examined (their number is bounded by the input length, itself bounded by the engine ceiling). Subject resolution is a sorted sweep +
 * binary search (no pairwise span comparison). Observed cost: see M9-B03-SAFETY-ARCHITECTURE.md §4 (measured, not asserted).
 * Wording is lexicon DATA: it is a backstop, not a proof of absence — a message the lexicon does not describe is NO_EMERGENCY_DETECTED, never "safe".
 */
import type { Disposition, Domain, Subject } from "./types";
import type { NormView } from "./normalize";
import { foldLiteral } from "./normalize";

const L = "@@"; // placeholder for \p{L}: it must survive the fold
function compile(src: string, ascii: boolean, flags: string): RegExp {
  let s = ascii ? foldLiteral(src.replace(/@@/g, "§§")).replace(/§§/g, "@@") : src;
  if (ascii) s = s.replace(/\btu tu\b/g, "tu tu(?=(?: vi| boi vi| nhung| ma| thi)\\b|\\s*(?:$|[.!?,;]))"); // "tu tu" is also "từ từ" (slowly): only at the end of a clause
  return new RegExp(s.replace(/ /g, "\\s+").replace(/@@/g, "\\p{L}"), flags);
}
interface Lex { g: RegExp; t: RegExp }
const mk = (src: string, ascii: boolean): Lex => ({ g: compile(src, ascii, "gu"), t: compile(src, ascii, "u") });

const SRC = {
  // ── subjects ──
  FIRST: String.raw`(?<![${L}'])(?:tôi|mình|em|tui|tao|i|me|my|myself)(?![${L}])`,
  THIRD: String.raw`(?<![${L}])(?:(?:bạn|anh|chị|em|cô|chú|bác|dì|mẹ|ba|bố|cha|con|cháu|ông|bà|vợ|chồng|người yêu|người thân|đồng nghiệp|học viên|khách|huấn luyện viên|hlv|pt|thầy|(?:anh|chị|em|con) (?:trai|gái)) (?:tôi|mình|của tôi|của mình|ấy|đó|kia|này)|họ|hắn|ai đó|he|she|they|someone|somebody|(?:my|his|her|their) (?:friend|mother|father|mom|dad|brother|sister|wife|husband|partner|son|daughter|colleague|client|girlfriend|boyfriend|coach|trainer|teacher|teammate|classmate|roommate|boss|cousin|uncle|aunt|grandmother|grandfather|grandma|grandpa|neighbou?r|child|kid|baby)|(?:his|her|their) (?:whole )?(?:body|arms?|legs?|face|head|hands?|eyes?|mouth|limbs?|speech|breathing))(?![${L}])`,
  GENERIC: String.raw`(?<![${L}])(?:một người|người ta|những người|mọi người|nhiều người|người(?= (?:muốn|định|đang|sắp|có|bị|mà|nào))|ai(?= (?:mà|có|bị))|someone who|somebody who|people who|a person who|anyone who|those who)(?![${L}])`,
  // ── markers ──
  PAST: String.raw`(?<![${L}])(?:từng|đã từng|hồi (?:nhỏ|trước|cấp|đó|còn|năm|bé)|năm ngoái|trước đây|ngày xưa|ngày trước|từ nhỏ|\d+ (?:năm|tháng) (?:trước|rồi)|(?:mười|vài|nhiều|mấy) (?:năm|tháng) (?:trước|rồi)|(?:years?|months?) ago|last year|used to|in the past|back then|when i was|as a (?:child|kid|teen|teenager)|tiền sử|history of|(?:năm|in|vào năm|back in) (?:19\d\d|20[01]\d|202[0-4]))(?![${L}])`,
  RECENT: String.raw`(?<![${L}])(?:vừa mới|vừa|hôm nay|hôm qua|lúc nãy|tối qua|sáng nay|đêm qua|tuần này|bây giờ|giờ|đang|right now|just|now|today|tonight|this morning|last night|yesterday|minutes? ago|hours? ago|an hour ago)(?![${L}])`,
  AGAIN: String.raw`(?<![${L}])(?:again|lại|một lần nữa|still|vẫn|tonight|đêm nay|bây giờ|giờ|now)(?![${L}])`,
  DESIRE: String.raw`(?<![${L}])(?:want|wanna|going to|gonna|muốn|định|sẽ)(?![${L}])`,
  HYPO: String.raw`(?<![${L}])(?:nếu|giả sử|giả dụ|giả định|ví dụ|trường hợp|if|suppose|what if|imagine)(?![${L}])`,
  ONGOING: String.raw`(?<![${L}])(?:đang|vừa|ngay bây giờ|bây giờ|right now|just)(?![${L}])`,
  EDU: String.raw`(?<![${L}])(?:là gì|nghĩa là|có nghĩa|dấu hiệu|triệu chứng|nguyên nhân|what is|what are|what does|how does|signs of|symptoms of|what causes|causes of|can be a sign|a sign of|signs? and symptoms|how (?:do i|can i|do you|can you|to) (?:recognize|recognise|spot|identify)|nhận biết|nhận diện|biểu hiện)(?![${L}])`,
  FICTION: String.raw`(?<![${L}])(?:phim|truyện|tiểu thuyết|nhân vật|diễn viên|bài hát|movie|film|novel|character|song)(?![${L}])`,
  // hyperbole / distress classification of "want to die" (T1A: distress words are NOT exertion words)
  DISTRESS: String.raw`(?<![${L}])(?:tired of (?:everything|life|living|it all|this|being)|sick of (?:everything|life|living)|hopeless|worthless|no point|can't take (?:it|this) anymore|cannot take (?:it|this) anymore|can't go on|don't see the point|tuyệt vọng|vô vọng|vô giá trị|chán (?:sống|đời|nản|chán|tất cả|mọi thứ)|khổ quá|khổ sở|không chịu nổi nữa|không còn ý nghĩa|mệt mỏi với (?:cuộc sống|mọi thứ|tất cả|đời)|everything|mọi thứ|tất cả|cuộc sống|cuộc đời)(?![${L}])`,
  SENSATION: String.raw`(?<![${L}])(?:mệt|đau|nhức|mỏi|đói|buồn ngủ|nóng|lạnh|ngại|xấu hổ|nực|ê ẩm|tired(?! of)|sore|exhausted|hurt|hurts|sweaty|hungry|sleepy)(?![${L}])`,
  LAUGH: String.raw`(?<![${L}])(?:lol|haha|hihi|lmao|jk|kkk)(?![${L}])`,
  EXERTION: String.raw`(?<![${L}])(?:tập|gym|squat|squats|deadlift|workout|leg day|bench|cardio|chạy bộ|running|hiit|bài tập|buổi tập|exercise)(?![${L}])`,
  // ── self-harm cores ──
  ACT: String.raw`(?:tự tử|tự sát|tự vẫn|tự kết liễu(?: cuộc đời| bản thân| mình)?|kết thúc (?:cuộc đời|cuộc sống|mạng sống)(?! (?:độc thân|tập|ế)))`,
  INTENT: String.raw`(?:muốn|định|sắp|nghĩ (?:đến|tới|về)(?: chuyện| việc)?|có ý định|quyết định|chuẩn bị|toan|cố gắng|đang|vừa|để|thử|đã (?:định|thử|quyết định)|sẽ)`,
  SH_ACTONLY: String.raw`(?<![${L}])(?:tự làm hại|tự gây thương tích|tự tổn thương|self[- ]?harm(?:ing)?|(?:hurt|harm|cut) myself|cutting myself)(?![${L}])`,
  SH_B: String.raw`(?<![${L}])(?:không|chẳng|chả) (?:còn )?muốn (?:tiếp tục )?sống(?: nữa)?(?![${L}])`,
  SH_C: String.raw`(?<![${L}])(?:(?:muốn|định|quyết định) chết(?! (?:đói|mệt|cười|ngượng|thèm|lạnh|nóng|vì mệt|vì đói))|chết đi(?! (?:sống lại|được))|chết quách)(?![${L}])`,
  EN_STRONG: String.raw`(?<![a-z])(?:kill (?:myself|himself|herself|themselves)|end (?:my|his|her|their) (?:own )?life|take (?:my|his|her|their) (?:own )?life|end it all|commit(?:ting|ted)? suicide|wish (?:i|he|she) (?:was|were) dead)(?![a-z])`,
  EN_DIE: String.raw`(?<![a-z])(?:want(?:s|ed)? to|wanna|going to|gonna) die(?![a-z])`,
  EN_NOLIVE: String.raw`(?<![a-z])(?:(?:don't|doesn't|do not|does not|dont|didn't) (?:want to|wanna)|no longer (?:want to|wanna)) (?:live|be alive|go on)(?![a-z])`,
  EN_WEAK: String.raw`(?<![a-z])suicid(?:e|al)(?![a-z])`,
  EN_INTENT: String.raw`(?<![a-z])(?:thinking|considering|planning|contemplating|attempt(?:ing)?|about to|feel(?:ing)?)(?![a-z])`,
  // ── seizure ──
  SZ_VI: String.raw`(?:(?:lên|vừa lên|đang lên|bị lên) cơn (?:động kinh|co giật)|cơn (?:động kinh|co giật) (?:đang|vừa|xảy ra)|(?:đang|vừa|vừa mới|đang bị|vừa bị|vừa lại bị|lại bị|bị) co giật|co giật toàn thân|sùi bọt mép)`,
  SZ_NOW: String.raw`(?<![a-z])(?:(?:having|has) (?:a |an |another )?(?:seizure|convulsion)s?(?! (?:disorders?|conditions?|history|medications?|meds|disease|syndrome|diagnosis))|seizing|convulsing)(?![a-z])`,
  SZ_HAD: String.raw`(?<![a-z])had (?:a |an |another )?(?:seizure|convulsion)s?(?! (?:disorders?|conditions?|history|medications?|meds|disease|syndrome|diagnosis))(?![a-z])`,
  SZ_BARE: String.raw`(?<![${L}])co giật(?![${L}])`,
  JERK: String.raw`(?<![${L}])(?:jerking|jerks|jerked|giật liên hồi|giật liên tục|giật cả người|giật toàn thân|giật giật|trợn ngược|sùi bọt|co cứng toàn thân|cứng đờ)(?![${L}])`,
  LOC: String.raw`(?<![${L}])(?:bất tỉnh|mất ý thức|unconscious|unresponsive|passed out|không phản ứng|không đáp lại|ngất xỉu|ngất|(?:won't|will not|doesn't|does not|isn't|is not|not|can't|cannot) (?:respond(?:ing)?|wake up|waking up|be woken)|không (?:chịu )?(?:tỉnh|dậy|trả lời|phản hồi)|không thể đánh thức)(?![${L}])`,
  SEVERE: String.raw`(?<![${L}])(?:không nói được|nói không được|không thể nói|nói không rõ|nói ngọng|nói lắp|méo miệng|lệch miệng|liệt|không cử động được|mất ý thức|bất tỉnh|sùi bọt mép|không nhớ gì|cannot speak|can't speak|unable to speak|unresponsive|passed out)(?![${L}])`,
  MUSCLE: String.raw`(?<![${L}])(?:cơ|bắp|mí|mắt|đùi|chân|tay|vai|lưng|bụng|cẳng|hàm|nhẹ)(?![${L}])`,
  // ── overdose / poisoning (no approved class: POLICY GAP, evidence is PROPOSED) ──
  OD_VI: String.raw`(?<![${L}])(?:(?:uống|nuốt|dùng) quá liều(?! (?:whey|creatine|caffeine|vitamin|protein|bcaa|cà phê))|(?:uống|nuốt) (?:cả|hết|nguyên) (?:một |1 )?(?:vỉ|lọ|chai|hộp) thuốc(?! (?:bổ|vitamin|bcaa|creatine|whey|collagen|canxi)))`,
  OD_EN: String.raw`(?<![a-z])(?:overdos(?:e|ed|ing)|(?:took|taken|swallowed|downed) too many (?:[a-z]+ )?(?:pills|tablets|capsules)|(?:took|taken|swallowed|downed) (?:all|every one of) (?:the|my|his|her|their) (?:[a-z]+ )?(?:pills|tablets|capsules|meds|medication)|(?:took|taken|swallowed|downed) (?:a |the )?(?:whole|entire|full) (?:bottle|pack|packet|strip|box) of (?:[a-z]+ )?(?:pills|tablets|capsules|meds|medication|medicine|painkillers))(?![a-z])`,
  // ── neurological (stroke-like) ──
  NEU_FACE: String.raw`(?<![${L}])(?:méo miệng|lệch miệng|mặt méo|mặt lệch|face drooping|facial droop|drooping face)(?![${L}])`,
  NEU_SIDE: String.raw`(?<![${L}])(?:liệt (?:nửa người|một bên)|yếu (?:liệt )?một bên|một bên (?:tay|chân|mặt) (?:yếu|tê|liệt)|không (?:nhấc|cử động) được (?:tay|chân)|arm weakness|weakness on one side|can't (?:move|lift) (?:my|his|her) (?:arm|leg))`,
  NEU_SPEECH: String.raw`(?<![${L}])(?:nói ngọng|nói khó|nói không rõ|nói lắp|không nói được|nói không được|không thể nói|slurred speech|can't speak clearly|cannot speak clearly|trouble speaking|unable to speak)(?![${L}])`,
  NEU_CONF: String.raw`(?<![${L}])(?:(?:đột nhiên|bất ngờ|suddenly) (?:${L}+ ){0,2}(?:lú lẫn|confused|không tỉnh táo)|(?:lú lẫn|confused) (?:đột ngột|suddenly))`,
  // ── heat illness ──
  HT_CONF: String.raw`(?<![${L}])(?:(?:can't|cannot|can not|couldn't|don't|do not|doesn't) (?:tell|know|say|remember) (?:where|what day|who) (?:i am|i'm|he is|she is|they are|we are|it is)|không (?:biết|nhớ) (?:mình |tôi )?(?:đang )?(?:ở đâu|là ai|đây là đâu)|lú lẫn|mê sảng|nói lảm nhảm|nói nhảm|nói lung tung|không tỉnh táo|mất định hướng|lơ mơ|confus(?:ed|ion)|disorient(?:ed|ation)|delirious|incoherent)(?![${L}])`,
  // "confused about / by / with …" names a topic, it does not describe the person's state of mind: kept as evidence (NON_CLINICAL_USE), never counted
  HT_CONF_TOPIC: String.raw`(?<![${L}])confus(?:ed|ion) (?:about|by|with|over|on|regarding|as to|between)(?! (?:where|what day|who|what (?:is|was) happening|what happened))(?![${L}])`,
  HT_HEAT: String.raw`(?<![${L}])(?:nóng ran|nóng người|nóng bừng|sốc nhiệt|say nóng|say nắng|kiệt sức do nhiệt|(?:không|ngừng|hết) (?:còn )?(?:đổ|ra) mồ hôi|(?:trời|ngoài trời|ngoài nắng|dưới nắng) nóng|heat ?stroke|heat exhaustion|overheat(?:ed|ing)|too hot)(?![${L}])`,
  HT_ASKS: String.raw`(?<![${L}])(?:muốn biết|có làm|có gây|có phải|là gì|nghĩa là|vì sao|tại sao|nguyên nhân|triệu chứng|dấu hiệu|cách|làm sao|làm thế nào|nên làm gì|có thể|nếu|giả sử)(?![${L}])`,
  HT_ACUTE: String.raw`(?<![${L}])(?:đang|vừa|bị|i feel|i'm feeling|right now)(?![${L}])`,
  // ── structure ──
  CLAUSE_DELIM: String.raw`[.!?;,]+| (?:nhưng|mà|thì|tuy nhiên|but|however|then) `,
  SEG_DELIM: String.raw`[.!?;,]+| (?:nhưng|mà|thì|tuy nhiên|but|however|then|và|and|rồi|nên|so) `,
  SENT_DELIM: String.raw`[.!?]+`,
} as const;
const NEG_WORDS = ["không", "chưa", "chẳng", "chả", "đâu", "hề", "đừng", "khỏi", "not", "never", "no", "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't", "won't", "can't", "cannot", "dont", "without"];

const FOLD_COLLISION = new Set(["hề", "đâu", "chả"]);
type SrcKey = keyof typeof SRC;
interface Lexicon { x: Record<SrcKey, Lex>; neg: Set<string> }
const build = (ascii: boolean): Lexicon => {
  const x = {} as Record<SrcKey, Lex>;
  for (const k of Object.keys(SRC) as SrcKey[]) x[k] = mk(SRC[k], ascii);
  // self-harm "A" = intent + act (built from two parts so the ACT list stays one piece of data)
  x.ACT = mk(String.raw`(?<![${L}])(?:${SRC.INTENT} ){1,2}(?:(?:thật sự|thực sự|chỉ|rất) )?${SRC.ACT}(?![${L}])`, ascii);
  // in the accent-less view some Vietnamese negators fold onto ordinary words — "hề" → "he" (the English pronoun!), "đâu" → "dau" (pain), "chả" → "cha" (father): a
  // negator that is also a subject / symptom word would silently negate "my friend says he wants to die". They are negators in the ACCENTED view only.
  return { x, neg: new Set(NEG_WORDS.filter((w) => !ascii || !FOLD_COLLISION.has(w)).map((w) => (ascii ? foldLiteral(w) : w))) };
};
const LEX = { nfc: build(false), ascii: build(true) } as const;
const MUSCLE_ASCII = /(?:^| )(?:bap|mi|mat|dui|chan|tay|vai|lung|bung|cang|ham|nhe)(?: |$)/;

export interface RawEvidence {
  domain: Domain; subject: Subject; subjectKey: string; referenceAmbiguous: boolean; tense: "PRESENT_OR_RECENT" | "PAST_FINISHED" | "HYPOTHETICAL" | "UNKNOWN"; negated: boolean;
  start: number; end: number; clause: number; lexicon: string; disposition: Disposition;
}
interface Span { s: number; e: number }
interface Cand { s: number; e: number; k: Subject; key: string }

// person keys are "<SUBJECT>:<key>": "SELF:", "OTHER:my brother", "OTHER:?he" (pronoun with several possible antecedents), "UNKNOWN:"
const isUnknownKey = (k: string) => k.startsWith("UNKNOWN");
const isAmbiguousKey = (k: string) => k.includes(":?");
// two signs may be combined only when they belong to the same person: an unknown subject (none written) is compatible with any, an ambiguous pronoun with nothing (PairIndex)
interface SentEntry { byKey: Map<string, Span>; unknown?: Span; any?: Span }
/**
 * Index of signs by sentence and person, built in ONE pass over the (position-sorted) spans. A lookup is O(1): "is there a sign of the same person in this sentence?" no longer
 * scans every other sign (the previous find / some loops were O(signs x signs) on adversarial input).
 */
class PairIndex {
  private bySent = new Map<number, SentEntry>(); private global = new Map<string, Span>();
  constructor(list: Span[], keyAt: (p: number) => string, sentAt: (p: number) => number) {
    for (const sp of list) {
      const k = keyAt(sp.s); if (isAmbiguousKey(k)) continue;
      const si = sentAt(sp.s); let e = this.bySent.get(si); if (!e) { e = { byKey: new Map() }; this.bySent.set(si, e); }
      if (!e.any) e.any = sp;
      if (isUnknownKey(k)) { if (!e.unknown) e.unknown = sp; } else { if (!e.byKey.has(k)) e.byKey.set(k, sp); if (!this.global.has(k)) this.global.set(k, sp); }
    }
  }
  /** first sign of the same sentence that belongs to a person compatible with `key` */
  inSentence(si: number, key: string): Span | null { if (isAmbiguousKey(key)) return null; const e = this.bySent.get(si); if (!e) return null; return isUnknownKey(key) ? (e.any ?? null) : (e.byKey.get(key) ?? e.unknown ?? null); }
  /** first sign anywhere of exactly this KNOWN person (an unknown / ambiguous person never matches) */
  sameKnownKey(key: string): Span | null { return isUnknownKey(key) || isAmbiguousKey(key) ? null : (this.global.get(key) ?? null); }
}

// pronoun resolution helpers
const PRONOUN_HEAD = /^(?:(?:he|she|they|họ|ho|hắn|han)|(?:his|her|their) (?:whole )?(?:body|arms?|legs?|face|head|hands?|eyes?|mouth|limbs?|speech|breathing))$/;
const PRONOUN_TAIL = / (?:ấy|ay|đó|do|kia|này|nay)$/;
const isPronounKey = (k: string) => PRONOUN_HEAD.test(k) || PRONOUN_TAIL.test(k);
const MALE = /^(?:he\b|his\b|(?:my |his |her |their )?(?:brother|father|dad|husband|son|boyfriend|uncle|grandfather|grandpa)\b|(?:anh|chồng|chong|bố|bo|chú|chu|ông|ong|con trai|con trai|em trai)(?: |$))/;
const FEMALE = /^(?:she\b|her\b|(?:my |his |her |their )?(?:sister|mother|mom|wife|daughter|girlfriend|aunt|grandmother|grandma)\b|(?:chị|chi|vợ|vo|mẹ|me|dì|di|cô|co|con gái|con gai|em gái|em gai)(?: |$))/;
const genderOf = (k: string): "M" | "F" | "" => (MALE.test(k) ? "M" : FEMALE.test(k) ? "F" : "");

const spans = (lex: Lex, t: string): Span[] => { const o: Span[] = []; for (const m of t.matchAll(lex.g)) { const s = m.index ?? 0; o.push({ s, e: s + m[0].length }); } return o; };
const bounds = (lex: Lex, t: string): { s: number[]; e: number[] } => {
  const s: number[] = [0], e: number[] = [];
  for (const m of t.matchAll(lex.g)) { const a = m.index ?? 0; if (m[0].length === 0) continue; e.push(a); s.push(a + m[0].length); }
  e.push(t.length); return { s, e };
};
/** index of the last element of the sorted array `a` that is <= x, or -1 */
const lastLE = (a: ArrayLike<number>, x: number): number => { let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (a[mid] <= x) { r = mid; lo = mid + 1; } else hi = mid - 1; } return r; };

export function extractEvidence(nv: NormView, ascii: boolean, hasMarks: boolean): RawEvidence[] {
  const t = nv.text; if (!t) return [];
  const lx = ascii ? LEX.ascii : LEX.nfc; const X = lx.x;
  const clause = bounds(X.CLAUSE_DELIM, t), seg = bounds(X.SEG_DELIM, t), sent = bounds(X.SENT_DELIM, t);
  const clauseAt = (p: number) => Math.max(0, lastLE(clause.s, p)), segAt = (p: number) => Math.max(0, lastLE(seg.s, p)), sentAt = (p: number) => Math.max(0, lastLE(sent.s, p));

  // ── subjects: sorted sweep removes spans contained in a longer one ("bạn tôi" ⊃ "tôi"), then binary search by end ──
  const raw: Cand[] = [];
  for (const sp of spans(X.GENERIC, t)) raw.push({ ...sp, k: "GENERIC", key: "generic" });
  for (const sp of spans(X.THIRD, t)) raw.push({ ...sp, k: "OTHER", key: t.slice(sp.s, sp.e) });
  for (const sp of spans(X.FIRST, t)) raw.push({ ...sp, k: "SELF", key: "" });
  raw.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s) || (a.k === "GENERIC" ? -1 : 1));
  const kept: Cand[] = []; let maxEnd = -1;
  for (const c of raw) { if (c.e <= maxEnd) continue; kept.push(c); if (c.e > maxEnd) maxEnd = c.e; }
  // pronoun → antecedent, left to right, O(subjects): the nouns seen in the previous and the current sentence are kept in two small sets (the noun vocabulary is a fixed list).
  // Exactly one gender-compatible noun → the pronoun takes its key; none → the pronoun stays its own person ("he"); several → "?he": never combined with anything.
  {
    let curSent = -1; let prevKeys: string[] = [], curKeys: string[] = [];
    for (const c of kept) {
      const si = sentAt(c.s); if (si !== curSent) { prevKeys = si === curSent + 1 ? curKeys : []; curKeys = []; curSent = si; }
      if (c.k !== "OTHER") continue;
      if (!isPronounKey(c.key)) { if (!curKeys.includes(c.key)) curKeys.push(c.key); continue; }
      const g = genderOf(c.key); const cands: string[] = [];
      for (const k of prevKeys.concat(curKeys)) { const n = genderOf(k); if ((!g || !n || g === n) && !cands.includes(k)) cands.push(k); }
      if (cands.length === 1) c.key = cands[0]; else if (cands.length > 1) c.key = "?" + c.key; else c.key = c.key.replace(/^(?:he|his) .*$/, "he").replace(/^(?:she|her) .*$/, "she").replace(/^(?:they|their) .*$/, "they"); // no antecedent: the pronoun is its own person
    }
  }
  const byEnd = [...kept].sort((a, b) => a.e - b.e); const ends = byEnd.map((c) => c.e);
  const subjectAt = (pos: number, withinClause: boolean): Cand | null => { const i = lastLE(ends, pos); if (i < 0) return null; const c = byEnd[i]; return !withinClause || c.s >= clause.s[clauseAt(pos)] ? c : null; };

  // ── memoised marker tests per range (each range is scanned at most once per marker: linear overall) ──
  const memo = new Map<string, boolean>();
  const test = (name: SrcKey, a: number, b: number): boolean => { const key = `${name}:${a}:${b}`; let v = memo.get(key); if (v === undefined) { v = X[name].t.test(t.slice(a, b)); memo.set(key, v); } return v; };
  const inClause = (name: SrcKey, p: number) => { const i = clauseAt(p); return test(name, clause.s[i], clause.e[i]); };
  const inSeg = (name: SrcKey, p: number) => { const i = segAt(p); return test(name, seg.s[i], seg.e[i]); };
  // negation reaches 3 words back but NEVER across a segment boundary ("I am not hurt and want to die": the "not" belongs to "hurt", not to "want to die")
  const negatedBefore = (pos: number) => t.slice(Math.max(seg.s[segAt(pos)], pos - 60), pos).trim().split(" ").slice(-3).some((w) => lx.neg.has(w));
  // a body-sensation word excuses a hyperbolic "want to die" only when it is NOT negated and sits in the SAME segment (memoised per segment: linear)
  const sensMemo = new Map<number, boolean>();
  const sensationLive = (p: number): boolean => {
    const i = segAt(p); let v = sensMemo.get(i);
    if (v === undefined) { v = false; const a = seg.s[i]; for (const m of t.slice(a, seg.e[i]).matchAll(X.SENSATION.g)) if (!negatedBefore(a + (m.index ?? 0))) { v = true; break; } sensMemo.set(i, v); }
    return v;
  };

  const out: RawEvidence[] = [];
  const emit = (domain: Domain, lexicon: string, s: number, e: number, disposition: Disposition, o: { subject?: Subject; key?: string; tense?: RawEvidence["tense"]; negated?: boolean } = {}) =>
    out.push({ domain, subject: o.subject ?? "UNKNOWN", subjectKey: o.key ?? "", referenceAmbiguous: (o.key ?? "").startsWith("?"), tense: o.tense ?? "UNKNOWN", negated: o.negated ?? false, start: s, end: e, clause: clauseAt(s), lexicon, disposition });
  const COUNT_I: Disposition = "COUNTED_IMMEDIATE", COUNT_P: Disposition = "COUNTED_POSSIBLE";

  // ═══ SELF-HARM ═══
  const selfHarm = (lexName: SrcKey, label: string, o: { inherentNeg?: boolean; hyper?: boolean; needsSubject?: boolean; actOnly?: boolean }) => {
    for (const sp of spans(X[lexName], t)) {
      if (ascii && hasMarks && /(^| )tu\s+tu($| )/.test(t.slice(sp.s, sp.e))) continue; // accented original: "tu tu" there is "từ từ"
      const negated = !o.inherentNeg && negatedBefore(sp.s);
      const pastSeg = inSeg("PAST", sp.s) && !inSeg("RECENT", sp.s);
      const cand = subjectAt(sp.s, true); const subj: Subject = cand ? cand.k : "UNKNOWN"; const key = cand?.k === "OTHER" ? cand.key : "";
      const base = { subject: subj === "UNKNOWN" ? ("SELF" as Subject) : subj, key, tense: (pastSeg ? "PAST_FINISHED" : "PRESENT_OR_RECENT") as RawEvidence["tense"], negated };
      if (negated) { emit("SELF_HARM", label, sp.s, sp.e, "NEGATED", base); continue; }
      if (pastSeg) {
        // a finished past episode — unless a LATER segment of the same clause says it is back ("…last year and I want to again tonight")
        const ce = clause.e[clauseAt(sp.s)]; const later = sp.e < ce && test("AGAIN", sp.e, ce) && test("DESIRE", sp.e, ce);
        emit("SELF_HARM", label, sp.s, sp.e, later ? COUNT_P : "PAST", base); continue;
      }
      if (subj === "GENERIC") { emit("SELF_HARM", label, sp.s, sp.e, "GENERIC_SUBJECT", base); continue; }
      const hypo = inClause("HYPO", sp.s) && !inClause("ONGOING", sp.s);
      if ((o.needsSubject || o.actOnly) && subj === "UNKNOWN" && !inClause("EN_INTENT", sp.s)) { emit("SELF_HARM", label, sp.s, sp.e, inClause("EDU", sp.s) ? "EDUCATION" : (o.actOnly ? COUNT_P : "NO_SUBJECT"), base); continue; }
      if (subj !== "SELF") {
        if (hypo) { emit("SELF_HARM", label, sp.s, sp.e, "HYPOTHETICAL_OTHER", base); continue; }
        if (inClause("FICTION", sp.s)) { emit("SELF_HARM", label, sp.s, sp.e, "FICTION", base); continue; }
        if (subj === "UNKNOWN" && inClause("EDU", sp.s)) { emit("SELF_HARM", label, sp.s, sp.e, "EDUCATION", base); continue; }
      }
      if (o.hyper) { // "I want to die" / "muốn chết": distress is never excused by exertion words; body-sensation / laughter hyperbole is benign; exertion words alone are AMBIGUOUS
        if (inClause("DISTRESS", sp.s)) { emit("SELF_HARM", label, sp.s, sp.e, COUNT_I, base); continue; }
        if (sensationLive(sp.s) || inClause("LAUGH", sp.s)) { emit("SELF_HARM", label, sp.s, sp.e, "BENIGN_HYPERBOLE", base); continue; }
        if (inClause("EXERTION", sp.s)) { emit("SELF_HARM", label, sp.s, sp.e, COUNT_P, base); continue; }
      }
      emit("SELF_HARM", label, sp.s, sp.e, COUNT_I, base);
    }
  };
  selfHarm("ACT", "SH_INTENT_ACT", {}); selfHarm("SH_B", "SH_NOLONGER", { inherentNeg: true }); selfHarm("SH_C", "SH_WANT_DIE_VI", { hyper: true });
  selfHarm("SH_ACTONLY", "SH_ACT", { actOnly: true });
  selfHarm("EN_STRONG", "SH_EN_STRONG", {}); selfHarm("EN_DIE", "SH_EN_DIE", { hyper: true }); selfHarm("EN_NOLIVE", "SH_EN_NOLIVE", { inherentNeg: true }); selfHarm("EN_WEAK", "SH_EN_SUICIDE", { needsSubject: true });

  // ═══ SEIZURE ═══
  // person key of a position: the nearest preceding subject ("SELF:", "OTHER:my brother", "OTHER:?he" = unresolved pronoun, "UNKNOWN:")
  const keyOf = (p: number) => { const c = subjectAt(p, false); return c ? c.k + ":" + c.key : "UNKNOWN:"; };
  // same, but the subject must be in the same SENTENCE (a sign cannot borrow a subject from an earlier sentence)
  const sentSubject = (p: number): Cand | null => { const c = subjectAt(p, false); return c && c.s >= sent.s[sentAt(p)] ? c : null; };
  const keyOfCand = (c: Cand | null) => (c ? c.k + ":" + c.key : "UNKNOWN:");
  const severeIdx = new PairIndex(spans(X.SEVERE, t).filter((sp) => !negatedBefore(sp.s)), keyOf, sentAt);
  const seizure = (lexName: SrcKey, label: string, kind: "NOW" | "HAD" | "BARE") => {
    for (const sp of spans(X[lexName], t)) {
      const negated = negatedBefore(sp.s); const cand = subjectAt(sp.s, true); const subj: Subject = cand ? cand.k : "UNKNOWN"; const key = cand?.k === "OTHER" ? cand.key : "";
      const recent = inSeg("RECENT", sp.s); const pastSeg = inSeg("PAST", sp.s) && !recent;
      const base = { subject: subj, key, tense: (pastSeg ? "PAST_FINISHED" : "PRESENT_OR_RECENT") as RawEvidence["tense"], negated };
      if (negated) { emit("SEIZURE", label, sp.s, sp.e, "NEGATED", base); continue; }
      if (pastSeg) { emit("SEIZURE", label, sp.s, sp.e, "PAST", base); continue; }
      if (inSeg("HYPO", sp.s) && !inSeg("ONGOING", sp.s)) { emit("SEIZURE", label, sp.s, sp.e, "HYPOTHETICAL_OTHER", base); continue; }
      if (subj === "GENERIC") { emit("SEIZURE", label, sp.s, sp.e, "GENERIC_SUBJECT", base); continue; }
      if ((lexName === "SZ_NOW" || lexName === "SZ_HAD") && subj === "UNKNOWN" && !recent) { emit("SEIZURE", label, sp.s, sp.e, inClause("EDU", sp.s) ? "EDUCATION" : "NO_SUBJECT", base); continue; } // "What does having a seizure feel like?"
      const severe = severeIdx.inSentence(sentAt(sp.s), subj + ":" + key) !== null; // same sentence, same person — never another person's sign
      if (!severe) {
        // a twitch / cramp of a named muscle is not a seizure; a bare "co giật" without a severe sign of the same person is kept as UNPAIRED (never silently dropped)
        const around = t.slice(Math.max(0, sp.s - 22), sp.e + 30);
        if (ascii ? MUSCLE_ASCII.test(around) : X.MUSCLE.t.test(around)) { emit("SEIZURE", label, sp.s, sp.e, "MUSCLE_TWITCH", base); continue; }
        if (kind === "BARE") { emit("SEIZURE", label, sp.s, sp.e, "UNPAIRED", base); continue; }
      }
      emit("SEIZURE", label, sp.s, sp.e, kind === "HAD" && !recent ? COUNT_P : COUNT_I, base);
    }
  };
  seizure("SZ_VI", "SZ_ACUTE_VI", "NOW"); seizure("SZ_NOW", "SZ_EN_NOW", "NOW"); seizure("SZ_HAD", "SZ_EN_HAD", "HAD"); seizure("SZ_BARE", "SZ_BARE_SEVERE", "BARE");
  // convulsive signs + loss of consciousness of ONE person in ONE sentence — "unconscious and jerking", "He fell and won't respond; his body keeps jerking".
  // Two people never combine ("my brother is unconscious and my sister is jerking"); a loss of consciousness that pairs with nothing is a risk of its own, for another person.
  {
    const jerks = spans(X.JERK, t); const liveLocs: Span[] = [];
    const sBase = (c: Cand | null, negated = false) => ({ subject: (c ? c.k : "UNKNOWN") as Subject, key: c?.k === "OTHER" ? c.key : "", tense: "PRESENT_OR_RECENT" as const, negated });
    for (const l of spans(X.LOC, t)) { if (negatedBefore(l.s)) emit("NEUROLOGICAL", "LOC_ALONE", l.s, l.e, "NEGATED", sBase(sentSubject(l.s), true)); else liveLocs.push(l); }
    const locIdx = new PairIndex(liveLocs, (p) => keyOfCand(sentSubject(p)), sentAt); const used = new Set<number>();
    for (const j of jerks) {
      const cand = sentSubject(j.s); const subj: Subject = cand ? cand.k : "UNKNOWN"; const base = sBase(cand);
      if (negatedBefore(j.s)) { emit("SEIZURE", "SZ_JERK_LOC", j.s, j.e, "NEGATED", { ...base, negated: true }); continue; }
      if (subj === "GENERIC") { emit("SEIZURE", "SZ_JERK_LOC", j.s, j.e, "GENERIC_SUBJECT", base); continue; }
      if (inSeg("PAST", j.s) && !inSeg("RECENT", j.s)) { emit("SEIZURE", "SZ_JERK_LOC", j.s, j.e, "PAST", { ...base, tense: "PAST_FINISHED" }); continue; }
      if (inSeg("HYPO", j.s) && !inSeg("ONGOING", j.s)) { emit("SEIZURE", "SZ_JERK_LOC", j.s, j.e, "HYPOTHETICAL_OTHER", base); continue; }
      if (subj === "UNKNOWN" && inClause("EDU", j.s)) { emit("SEIZURE", "SZ_JERK_LOC", j.s, j.e, "EDUCATION", base); continue; }
      const loc = locIdx.inSentence(sentAt(j.s), keyOfCand(cand));
      if (loc) { used.add(loc.s); emit("SEIZURE", "SZ_JERK_LOC", j.s, j.e, COUNT_I, base); } else emit("SEIZURE", "SZ_JERK_LOC", j.s, j.e, "UNPAIRED", base);
    }
    for (const l of liveLocs) {
      if (used.has(l.s)) continue; // already the second half of a seizure pair
      const cand = sentSubject(l.s); const subj: Subject = cand ? cand.k : "UNKNOWN"; const base = sBase(cand); const recent = inSeg("RECENT", l.s) || inSeg("ONGOING", l.s);
      if (subj === "GENERIC") emit("NEUROLOGICAL", "LOC_ALONE", l.s, l.e, "GENERIC_SUBJECT", base);
      else if (inSeg("PAST", l.s) && !inSeg("RECENT", l.s)) emit("NEUROLOGICAL", "LOC_ALONE", l.s, l.e, "PAST", { ...base, tense: "PAST_FINISHED" });
      else if (inSeg("HYPO", l.s) && !inSeg("ONGOING", l.s)) emit("NEUROLOGICAL", "LOC_ALONE", l.s, l.e, "HYPOTHETICAL_OTHER", base);
      else if (subj === "UNKNOWN" && inClause("EDU", l.s)) emit("NEUROLOGICAL", "LOC_ALONE", l.s, l.e, "EDUCATION", base);
      // POLICY_PENDING: "unconscious / unresponsive" has no approved class of its own; it is carried under NEUROLOGICAL (response policy pending). Another person only: one's own faint
      // and an unattributed sign stay with the legacy medical detector in the guard (F2), recorded here as OUT_OF_SCOPE, never dropped.
      else if (subj === "OTHER") emit("NEUROLOGICAL", "LOC_ALONE", l.s, l.e, recent ? COUNT_I : COUNT_P, base);
      else emit("NEUROLOGICAL", "LOC_ALONE", l.s, l.e, "OUT_OF_SCOPE", base);
    }
  }

  // ═══ OVERDOSE / POISONING (POLICY GAP: the owner has not approved this class; evidence is PROPOSED) ═══
  for (const [lexName, label] of [["OD_VI", "OD_VI"], ["OD_EN", "OD_EN"]] as const) for (const sp of spans(X[lexName], t)) {
    const cand = subjectAt(sp.s, true); const subj: Subject = cand ? cand.k : "UNKNOWN"; const key = cand?.k === "OTHER" ? cand.key : ""; const negated = negatedBefore(sp.s);
    const pastSeg = inSeg("PAST", sp.s) && !inSeg("RECENT", sp.s); const base = { subject: subj, key, tense: (pastSeg ? "PAST_FINISHED" : "PRESENT_OR_RECENT") as RawEvidence["tense"], negated };
    if (negated) emit("OVERDOSE_POISONING", label, sp.s, sp.e, "NEGATED", base);
    else if (pastSeg) emit("OVERDOSE_POISONING", label, sp.s, sp.e, "PAST", base);
    // "What if my brother overdosed at a party?" is a hypothesis about someone else. "What if I took too many pills?" about oneself can disguise real intent (the self-harm rule keeps
    // a SELF hypothesis counted for the same reason): it stays POSSIBLE — a false negative here would be worse than one extra check.
    else if (inSeg("HYPO", sp.s) && !inSeg("ONGOING", sp.s)) emit("OVERDOSE_POISONING", label, sp.s, sp.e, subj === "SELF" ? COUNT_P : "HYPOTHETICAL_OTHER", base);
    else if (subj === "GENERIC") emit("OVERDOSE_POISONING", label, sp.s, sp.e, "GENERIC_SUBJECT", base);
    else if (subj === "UNKNOWN") emit("OVERDOSE_POISONING", label, sp.s, sp.e, inClause("EDU", sp.s) ? "EDUCATION" : "NO_SUBJECT", base);
    else emit("OVERDOSE_POISONING", label, sp.s, sp.e, COUNT_I, base);
  }

  // ═══ NEUROLOGICAL (stroke-like signs) — a facial droop / one-sided weakness counts alone; speech difficulty counts with sudden confusion or another sign, SAME person ═══
  {
    const live = (l: Span[]) => l.filter((sp) => !negatedBefore(sp.s));
    const face = spans(X.NEU_FACE, t), side = spans(X.NEU_SIDE, t), speech = spans(X.NEU_SPEECH, t), conf = spans(X.NEU_CONF, t);
    const partners = new PairIndex([...live(conf), ...live(face), ...live(side)], keyOf, sentAt); // indexed once: no per-sign scan of the other signs
    const decide = (sp: Span, label: string, counted: boolean) => {
      const cand = subjectAt(sp.s, false); const subj: Subject = cand ? cand.k : "UNKNOWN"; const key = cand?.k === "OTHER" ? cand.key : ""; const negated = negatedBefore(sp.s);
      const base = { subject: subj, key, tense: "PRESENT_OR_RECENT" as const, negated };
      if (negated) emit("NEUROLOGICAL", label, sp.s, sp.e, "NEGATED", base);
      else if (subj === "GENERIC" || (subj === "UNKNOWN" && inClause("EDU", sp.s))) emit("NEUROLOGICAL", label, sp.s, sp.e, subj === "GENERIC" ? "GENERIC_SUBJECT" : "EDUCATION", base);
      else if (inSeg("PAST", sp.s) && !inSeg("RECENT", sp.s)) emit("NEUROLOGICAL", label, sp.s, sp.e, "PAST", { ...base, tense: "PAST_FINISHED" });
      else if (inSeg("HYPO", sp.s) && !inSeg("ONGOING", sp.s)) emit("NEUROLOGICAL", label, sp.s, sp.e, "HYPOTHETICAL_OTHER", base);
      else emit("NEUROLOGICAL", label, sp.s, sp.e, counted ? COUNT_I : "UNPAIRED", base);
    };
    for (const f of face) decide(f, "NEU_FACE", true);
    for (const f of side) decide(f, "NEU_SIDE", true);
    for (const sp of speech) decide(sp, "NEU_SPEECH", partners.inSentence(sentAt(sp.s), keyOf(sp.s)) !== null);
  }

  // ═══ HEAT ILLNESS — heat sign + confusion of the SAME person (never two people; a topic "confused about the plan" is not a sign) ═══
  {
    const topicAt = new Set<number>(spans(X.HT_CONF_TOPIC, t).map((sp) => sp.s));
    const hBase = (p: number, negated = false) => { const c = subjectAt(p, false); return { subject: (c ? c.k : "UNKNOWN") as Subject, key: c?.k === "OTHER" ? c.key : "", tense: "PRESENT_OR_RECENT" as const, negated }; };
    const clinical: Span[] = [];
    for (const c of spans(X.HT_CONF, t)) {
      if (negatedBefore(c.s)) emit("HEAT_ILLNESS", "HT_CONF", c.s, c.e, "NEGATED", hBase(c.s, true));
      else if (topicAt.has(c.s)) emit("HEAT_ILLNESS", "HT_CONF", c.s, c.e, "NON_CLINICAL_USE", hBase(c.s));
      else if (inSeg("PAST", c.s) && !inSeg("RECENT", c.s)) emit("HEAT_ILLNESS", "HT_CONF", c.s, c.e, "PAST", { ...hBase(c.s), tense: "PAST_FINISHED" });
      else if (inSeg("HYPO", c.s) && !inSeg("ONGOING", c.s)) emit("HEAT_ILLNESS", "HT_CONF", c.s, c.e, "HYPOTHETICAL_OTHER", hBase(c.s));
      else clinical.push(c);
    }
    const confIdx = new PairIndex(clinical, keyOf, sentAt);
    for (const h of spans(X.HT_HEAT, t)) {
      const base = hBase(h.s);
      if (negatedBefore(h.s)) { emit("HEAT_ILLNESS", "HT_HEAT", h.s, h.e, "NEGATED", { ...base, negated: true }); continue; }
      if (inSeg("PAST", h.s) && !inSeg("RECENT", h.s)) { emit("HEAT_ILLNESS", "HT_HEAT", h.s, h.e, "PAST", { ...base, tense: "PAST_FINISHED" }); continue; }
      if (inSeg("HYPO", h.s) && !inSeg("ONGOING", h.s)) { emit("HEAT_ILLNESS", "HT_HEAT", h.s, h.e, "HYPOTHETICAL_OTHER", base); continue; }
      const hk = keyOf(h.s);
      const partner = confIdx.inSentence(sentAt(h.s), hk) ?? confIdx.sameKnownKey(hk);
      if (!partner) { emit("HEAT_ILLNESS", "HT_HEAT", h.s, h.e, "UNPAIRED", base); continue; }
      const sA = sent.s[sentAt(h.s)], sB = sent.e[sentAt(h.s)];
      const acute = test("HT_ACUTE", sA, sB) || test("HT_ACUTE", sent.s[sentAt(partner.s)], sent.e[sentAt(partner.s)]);
      const asks = inClause("HT_ASKS", h.s) || inClause("HT_ASKS", partner.s); // a question in ANOTHER clause does not turn a statement into a question
      emit("HEAT_ILLNESS", "HT_HEAT_CONF", h.s, h.e, acute || ((base.subject === "SELF" || base.subject === "OTHER") && !asks) ? COUNT_I : (asks ? "EDUCATION" : "NO_SUBJECT"), base);
    }
  }
  return out;
}
