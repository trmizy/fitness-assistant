import { classifySpeechAct, foldVi, type SpeechAct } from "./speech_act";

/**
 * Deterministic post-LLM guard against claims about the user that nothing in THIS conversation supports.
 *
 * Observed (REAL HTTP/API eval, 2026-11-11):
 *  - B3-47: the user only stated a goal ("Mục tiêu của tôi là giảm từ 85 xuống 78kg") → answer opened with "**Chúc mừng! Bạn
 *    đã đạt được mục tiêu giảm xuống 78kg.**".
 *  - B4-49: a glute question opened with "Chúc mừng bạn đã quyết định bắt đầu tập luyện sau khi sinh con!", the birth coming
 *    from an unrelated earlier question saved as a memory.
 * Independent review P1-04 (2026-11-12): "Tôi tập để tăng cơ mông." counted as evidence of a birth because the old evidence
 * regex held the folded token `de` ("đẻ") and "để" (in order to) folds to the same `de`.
 *
 * The prompt forbids both; this guard enforces it when the model does it anyway. It only REMOVES sentences, never rewrites
 * advice.
 *
 * ── Design decisions (documented, not accidental) ──────────────────────────────────────────────────────────────────────
 * 1. ONE text form, accent-aware. Text is lower-cased, NFC-normalised, then the few diacritic-only distinctions that matter are
 *    protected by explicit markers BEFORE folding: "đẻ" → `__de_birth__`, "mổ" → `__mo_surg__`, "đạt" → `__dat__`, "vợ" →
 *    `__wife__`. After folding, an unaccented "de" / "mo" / "dat" / "vo" can therefore never equal those words. Evidence for a
 *    sensitive state is only an explicit phrase ("sinh con", "vừa sinh", "sau sinh", "mang thai", "có bầu", "phẫu thuật",
 *    "pregnant" …) or an ACCENTED single word (đẻ, mổ). Unaccented input is accepted only for multi-word unambiguous phrases.
 * 2. Evidence must be an ASSERTION by the user (this message or earlier messages of the same session), judged per CLAUSE (a
 *    sentence is split at , ; : and at "giờ/vậy/nhưng"): a clause classified by `classifySpeechAct` as QUESTION, HYPOTHETICAL
 *    or COMMAND is not evidence. So "Tôi vừa sinh con được 6 tuần, giờ tập bụng được chưa?" IS evidence (first clause is a
 *    statement) while "Sau sinh bao lâu được tập bụng?" and "Nếu tôi vừa sinh con thì tập được không?" are not.
 *    A cue is also NOT evidence when it is negated or planned (the two tokens before it contain không/chưa/muốn/định/sẽ/sắp/
 *    để/nếu …) or when the clause is about somebody else (vợ, bạn gái, phụ nữ, người ta …).
 * 3. Talking about a topic the user raised is legitimate. If the user mentioned the topic in ANY form (question, hypothetical,
 *    negation, third person) but did not assert it, only a STRICT attribution is removed: a congratulation, "bạn đã/đang/vừa …
 *    <state>", "vì bạn <state>", "<state> của bạn", "bạn <state>" directly. Generic advice ("Phụ nữ sau sinh nên…", "Bạn nên
 *    chờ 6 tuần sau sinh") stays. If the user never mentioned the topic at all, any sentence addressed to "bạn" that names the
 *    state is removed (the B4-49 shape).
 * 4. Conditional safety notes ("Nếu bạn đang mang thai, hãy hỏi bác sĩ"), questions put to the user ("Bạn có đang mang thai
 *    không?") and bullet items under a conditional header are never removed. ("hoặc" is NOT a conditional marker.)
 * 5. Achievement: a goal/intention is not a result. Evidence is a perfective statement ("đã/vừa/mới giảm|tăng|đạt", "giảm
 *    được", "đạt được", "hoàn thành", "PR", "I lost …") that is not negated/planned. "đặt mục tiêu" (set a goal) is not "đạt
 *    mục tiêu" (reached) — separated by the `__dat__` marker. An achievement claim is only acted on inside a congratulation.
 * 6. Removal is sentence level. A bare "**Chúc mừng!**" plus the sentence right after it is one unit (the model often splits
 *    the congratulation from its claim). Bullet prefixes are kept, a trailing emoji goes with its sentence, an orphan `**` is
 *    cleaned. Lines that are not touched are returned byte-identical.
 * 7. Never an empty / meaningless answer: if the cleaned answer would have < 3 words or < 15% of the original's letters+digits,
 *    the ORIGINAL is returned with `removed: []`, a `warnings` entry and the would-be removals in `suppressed`; the caller
 *    decides. (The 40% ratio suggested in the review brief cannot hold for the legitimate case "Chúc mừng … sau sinh! Hãy tập
 *    Hip Thrust." where the advice is 34% of the text.)
 * 8. Optional `verifiedProfileFacts` (profile-verified state) counts as evidence. Memories are NEVER evidence — callers must
 *    not pass them.
 */

// ───────────────────────────── text normalisation ─────────────────────────────

function fold2(text: string): string {
  const marked = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/(?<!\p{L})đẻ(?!\p{L})/gu, " __de_birth__ ")
    .replace(/(?<!\p{L})mổ(?!\p{L})/gu, " __mo_surg__ ")
    .replace(/(?<!\p{L})đạt(?!\p{L})/gu, " __dat__ ")
    .replace(/(?<!\p{L})vợ(?!\p{L})/gu, " __wife__ ")
    // "đầu gối" (the knee, a body part) folds to the same "dau goi" as "đau gối" (knee PAIN)
    .replace(/(?<!\p{L})đầu\s+gối(?!\p{L})/gu, " __knee__ ");
  return foldVi(marked);
}

// ───────────────────────────── life events ─────────────────────────────

type RuleId = "postpartum" | "pregnancy" | "surgery" | "injury";

const NOT_A_BIRTH = String.raw`(?! (?:nhat|vien|hoat|ly|hoc|thai|trac|ton|nhan)\b)`; // sinh nhật / sinh viên / sinh hoạt …

// Only multi-word phrases or accent-protected markers. The same pattern is used to recognise the STATE in the user's text
// (evidence / topic) and in the answer (claim).
const STATE_CUES: Record<RuleId, RegExp> = {
  postpartum: new RegExp(
    String.raw`\b(?:sinh (?:con|em be|be|mo|non)\b|(?:sau|vua|moi)(?: khi)? sinh${NOT_A_BIRTH}\b|hau san\b|cho con bu\b|__de_birth__|postpartum|post-partum|gave birth|giving birth|childbirth|just had a (?:baby|child)|had a baby|c-section|cesarean)`,
  ),
  pregnancy: new RegExp(
    String.raw`\b(?:mang thai|mang bau|co bau|co thai(?! do)|dang bau|thai ky|thai nghen|pregnan\w*|expecting (?:a|my|our)(?: \w+)? (?:baby|child)|weeks? pregnant)\b`,
  ),
  surgery: new RegExp(String.raw`\b(?:phau thuat|__mo_surg__|surgery|surgical|operated on|post-?op|had an operation)\b`),
  // V1 stabilization 2026-11-12 (B3-41 "Bạn đã báo cáo đau gói", B2-21/B3-19 "Với tình trạng đau gối"): a body-part-specific
  // pain/injury. Bare "chấn thương" is NOT a cue — "để tránh chấn thương" is ordinary advice. "gói" is the model's misspelling.
  injury: new RegExp(String.raw`\b(?:dau|chan thuong|bong gan|thoai hoa|thoat vi|viem)\s+(?:goi|lung(?: duoi)?|vai|co tay|co chan|khop|hong|got(?: chan)?|mat ca(?: chan)?|cot song|dia dem|khuyu(?: tay)?)\b|\b(?:knee|back|shoulder|wrist|ankle|hip) (?:pain|injury)\b`),
};

const VERIFIED_KEY: Record<RuleId, keyof VerifiedProfileFacts> = { postpartum: "postpartum", pregnancy: "pregnant", surgery: "recentSurgery", injury: "injury" };

// Second-person pronoun / aspect markers, used to tell "you ARE in this state" from generic advice. Folded text.
const PRON = String.raw`(?:ban|anh|chi|em|you)`;
const ASPECT = String.raw`(?:da|dang|vua|moi|hien|van|con|are|were|just|have|had)`;
const MODAL = String.raw`(?:nen|can|co the|phai|hay|dung|muon|dinh|se|should|could|can|may|might|must)`;

function strictAttributions(state: RegExp): RegExp[] {
  const s = state.source;
  return [
    new RegExp(String.raw`\b${PRON}\s+(?:\w+\s+){0,2}?${ASPECT}\s+(?:\w+\s+){0,2}?(?:${s})`), // bạn đã / đang / vừa … <state>
    new RegExp(String.raw`\b(?:vi|do|boi vi|because|since)\s+${PRON}\b.{0,40}?(?:${s})`), // vì bạn … <state>
    new RegExp(String.raw`(?:${s})\s+cua\s+(?:ban|you)\b|\byour\s+(?:\w+\s+)?(?:${s})`), // <state> của bạn / your …
    new RegExp(String.raw`\b(?:ban|you)\s+(?!${MODAL}\b)(?:${s})`), // bạn <state> (directly adjacent)
  ];
}
const INJ = STATE_CUES.injury.source;
const STRICT: Record<RuleId, RegExp[]> = {
  postpartum: strictAttributions(STATE_CUES.postpartum),
  pregnancy: strictAttributions(STATE_CUES.pregnancy),
  surgery: strictAttributions(STATE_CUES.surgery),
  injury: [
    ...strictAttributions(STATE_CUES.injury), // "bạn đã báo cáo đau gối", "đau gối của bạn", "vì bạn đau lưng"
    new RegExp(String.raw`\b${PRON}\s+(?:(?:da|dang|van|hay|hien)\s+)?bi\s+(?:${INJ})`), // "bạn bị đau gối"
    new RegExp(String.raw`\b(?:voi|do|vi|theo|xet)\s+tinh trang\s+(?:${INJ})`), // "với tình trạng đau gối"
    new RegExp(String.raw`\btinh trang\s+(?:${INJ})\s+(?:cua ban|hien tai)`),
  ],
};
// The broad "never mentioned + addressed to bạn" rule is NOT used for injuries: "Bạn hãy tránh bài gây đau gối" is advice.
const BROAD_RULES = new Set<RuleId>(["postpartum", "pregnancy", "surgery"]);
const BROAD_ATTRIBUTION = /\b(?:ban|you|your)\b/;

// A CONDITIONAL mention is not an attribution: "Nếu bạn đang mang thai, hãy hỏi bác sĩ" is a safety note and must stay
// (offline Layer-1 run on the 200 stored answers, 2026-11-12: B2-29 / B3-26 would otherwise lose their safety disclaimer).
const CONDITIONAL = /\b(?:neu|gia su|gia du|truong hop|tru khi|if|unless|in case|even if|whether)\b/;

// ───────────────────────────── achievements ─────────────────────────────

const CONGRATS = /\b(?:chuc mung|congratulations?|congrats)\b/;

// Asserted about the user in the ANSWER
const ACHIEVEMENT_CLAIM = new RegExp(
  String.raw`\b(?:(?:da|vua|moi) (?:__dat__|giam|tang|xuong|len|hoan thanh|vuot)|(?:__dat__|giam|tang) duoc|__dat__ (?:duoc )?muc tieu|hoan thanh muc tieu|vuot muc tieu|(?:reached|achieved|hit|smashed|crushed) (?:your|the) (?:goal|target)|you(?:'ve| have)? (?:lost|gained|dropped|reached|achieved))\b`,
);
// …and what the USER must have ASSERTED for such a claim to be supported
const ACHIEVEMENT_CUE = new RegExp(
  String.raw`\b(?:(?:da|vua|moi) (?:giam|tang|ha|__dat__)|(?:da|vua|moi) (?:xuong|len) \d|(?:giam|tang) duoc|__dat__ (?:duoc|muc tieu)|hoan thanh|pr|ky luc|vuot muc tieu|i(?:'ve| have)? (?:lost|gained|dropped|reached|hit|achieved))\b`,
);

// ───────────────────────────── user evidence ─────────────────────────────

// Tokens that, within the two words BEFORE a cue, turn it into a non-assertion (negation, wish, plan, purpose, condition).
const BLOCK_TOKENS = new Set(["khong", "chua", "chang", "never", "not", "no", "dont", "don't", "didnt", "didn't", "havent", "haven't", "muon", "dinh", "sap", "se", "mong", "hope", "want", "wanna", "planning", "plan", "trying", "de", "neu", "if", "gia", "suppose"]);
const BLOCK_BIGRAM = /(?:chuan bi|ke hoach|hy vong|going to|plan to|trying to|want to)$/;
// Somebody else (or people in general), not the user.
const THIRD_PARTY = /\b(?:__wife__|vo (?:toi|minh|em)|ban gai|nguoi yeu|chi gai|em gai|anh trai|me toi|ban toi|ban minh|co ay|chi ay|ba ay|phu nu|nguoi ta|nhung nguoi|moi nguoi|nguoi khac|khach hang|hoc vien|dong nghiep|cac me|me bau|ai do|wife|girlfriend|my friend|my sister|my mother|my mom|she|her|women|woman|people|someone|clients?)\b/;

const CLAUSE_SPLIT = /[,;:]|(?<!\d)\s(?:giờ|gio|bây giờ|bay gio|vậy|vay|nhưng|nhung)\s/iu;

interface UserClause {
  f: string;
  act: SpeechAct;
}

function userClauses(messages: string[]): UserClause[] {
  const out: UserClause[] = [];
  for (const message of messages) {
    for (const sentence of String(message ?? "").split(/(?<=[.!?…])\s+|\n+/u)) {
      for (const part of sentence.split(CLAUSE_SPLIT)) {
        const text = part.trim();
        if (!text) continue;
        out.push({ f: fold2(text), act: classifySpeechAct(text) });
      }
    }
  }
  return out;
}

function cueIsBlocked(f: string, index: number): boolean {
  const before = f.slice(0, index).trim().split(" ").filter(Boolean).slice(-2).map((t) => t.replace(/[^a-z0-9_']/g, ""));
  return before.some((t) => BLOCK_TOKENS.has(t)) || BLOCK_BIGRAM.test(before.join(" "));
}

/** True when `clause` ASSERTS a state matched by `cue` (statement, not negated/planned, not about somebody else). */
function assertsCue(clause: UserClause, cue: RegExp): boolean {
  if (clause.act !== "STATEMENT" || THIRD_PARTY.test(clause.f)) return false;
  const global = new RegExp(cue.source, "g");
  for (const m of clause.f.matchAll(global)) if (!cueIsBlocked(clause.f, m.index ?? 0)) return true;
  return false;
}

// ───────────────────────────── answer segmentation ─────────────────────────────

const EMOJI_ONLY = /^[\p{Extended_Pictographic}️‍\s*_]+$/u;
const LINE_PREFIX = /^(\s*(?:[-*•+]|\d{1,2}[.)])\s+)/;

function splitSegments(text: string): string[] {
  const raw = text.split(/(?<=[.!?…][*_"'”’)\]]*(?:\s*[\p{Extended_Pictographic}️]+)*)\s+/u).filter((s) => s.length);
  const merged: string[] = [];
  for (const seg of raw) {
    if (merged.length && EMOJI_ONLY.test(seg)) merged[merged.length - 1] += ` ${seg}`;
    else merged.push(seg);
  }
  return merged;
}

const isQuestionToUser = (s: string) => /\?[\s*_"')\]\p{Extended_Pictographic}️]*$/u.test(s.trim());
const isBareCongrats = (f: string) => CONGRATS.test(f) && f.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).length <= 4;
const substantive = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").length;

// ───────────────────────────── public API ─────────────────────────────

export interface VerifiedProfileFacts {
  postpartum?: boolean;
  pregnant?: boolean;
  recentSurgery?: boolean;
  /** Saved profile injuries, or an injury the user ASSERTED this session (TurnFacts) — never a hypothetical one, never memory. */
  injury?: boolean;
}

export interface FidelityContext {
  question: string;
  /** Earlier user messages of THIS session only (never memories, never other sessions). */
  sessionUserMessages?: string[];
  /** Facts verified in the user's profile (not memories). `true` counts as evidence for the matching state. */
  verifiedProfileFacts?: VerifiedProfileFacts;
  /** The assistant's own earlier answers in THIS session (provenance: suggestions, never facts about the user). */
  assistantTurns?: string[];
  /** Figures on record for the user (profile weights, InBody values …) — a claim using one of them is supported. */
  verifiedNumbers?: number[];
}

// "bạn đã giảm tạ xuống 55kg" — a COMPLETED action with a figure (B4-46, V1 RC 2026-11-12). Folded text.
const PAST_ACTION_WITH_FIGURE = /\b(?:ban|you)\s+(?:da|vua|moi)\s+(?:giam|ha|tang|nang|xuong|len|dat|cat|bo|chuyen|doi)\b[^.!?\n]{0,40}?(\d+(?:[.,]\d+)?)\s*(?:kg|ky|kcal|calo|buoi|rep|reps|hiep|set|phut|%)/;
const figuresIn = (texts: string[]) => new Set(texts.flatMap((t) => [...String(t ?? "").matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")))));

export interface FidelityResult {
  answer: string;
  /** Sentences actually removed from `answer`. */
  removed: string[];
  /** Why nothing was removed although something was flagged (answer would have become empty / meaningless). */
  warnings?: string[];
  /** Flagged units that were NOT removed because of a warning — the caller may act on them. */
  suppressed?: string[];
}

export function removeUnsupportedUserClaims(answer: string, ctx: FidelityContext): FidelityResult {
  const clauses = userClauses([ctx.question, ...(ctx.sessionUserMessages ?? [])]);
  const verified = ctx.verifiedProfileFacts ?? {};

  const evidence = {} as Record<RuleId, boolean>;
  const topicMentioned = {} as Record<RuleId, boolean>;
  for (const id of Object.keys(STATE_CUES) as RuleId[]) {
    evidence[id] = verified[VERIFIED_KEY[id]] === true || clauses.some((c) => assertsCue(c, STATE_CUES[id]))
      // a pain the user names is reported even inside a question ("Tôi đau gối thì tập gì?") — but not in a hypothetical
      || (id === "injury" && clauses.some((c) => c.act !== "HYPOTHETICAL" && assertsCue({ ...c, act: "STATEMENT" }, STATE_CUES.injury)));
    topicMentioned[id] = clauses.some((c) => STATE_CUES[id].test(c.f));
  }
  const achievementSupported = clauses.some((c) => assertsCue(c, ACHIEVEMENT_CUE));
  // Provenance: a figure the assistant SUGGESTED earlier, that the user never stated and that is not on record.
  const userFigures = figuresIn([ctx.question, ...(ctx.sessionUserMessages ?? [])]);
  const suggestedFigures = figuresIn(ctx.assistantTurns ?? []);
  const verifiedFigures = new Set(ctx.verifiedNumbers ?? []);
  const isSuggestionAsserted = (f: string): boolean => {
    const m = PAST_ACTION_WITH_FIGURE.exec(f.replace(/\*/g, ""));
    if (!m) return false;
    const n = Number(m[1].replace(",", "."));
    return suggestedFigures.has(n) && !userFigures.has(n) && !verifiedFigures.has(n);
  };

  /** Is this unit (one sentence, or a bare congratulation + the sentence after it) an unsupported claim about the user? */
  const isUnsupported = (unit: string, inheritedConditional: boolean): boolean => {
    const f = fold2(unit);
    if (!f || inheritedConditional || CONDITIONAL.test(f) || isQuestionToUser(unit)) return false;
    const congrats = CONGRATS.test(f);
    if (congrats && ACHIEVEMENT_CLAIM.test(f) && !achievementSupported) return true;
    if (isSuggestionAsserted(f)) return true;
    for (const id of Object.keys(STATE_CUES) as RuleId[]) {
      if (!STATE_CUES[id].test(f) || evidence[id]) continue;
      const strict = congrats || STRICT[id].some((re) => re.test(f));
      const broad = BROAD_RULES.has(id) && !topicMentioned[id] && BROAD_ATTRIBUTION.test(f);
      if (strict || broad) return true;
    }
    return false;
  };

  const removed: string[] = [];
  let listConditional = false; // bullets under "Nếu bạn thuộc nhóm sau:" inherit the condition

  const lines = answer.split("\n").map((line) => {
    if (!line.trim()) return line;
    const prefix = LINE_PREFIX.exec(line)?.[1] ?? "";
    if (!prefix) listConditional = false;
    const inherited = listConditional;
    const header = /:[\s*_]*$/.test(line.trim()) && CONDITIONAL.test(fold2(line));
    if (header) listConditional = true;

    const segments = splitSegments(line.slice(prefix.length));
    const kept: string[] = [];
    let changed = false;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (isBareCongrats(fold2(seg)) && i + 1 < segments.length) {
        const unit = `${seg} ${segments[i + 1]}`;
        if (isUnsupported(unit, inherited)) {
          removed.push(unit.trim());
          changed = true;
          i++;
          continue;
        }
      }
      if (isUnsupported(seg, inherited)) {
        removed.push(seg.trim());
        changed = true;
        continue;
      }
      kept.push(seg);
    }
    if (!changed) return line;
    if (!kept.length) return null;
    let rebuilt = kept.join(" ");
    if ((rebuilt.match(/\*\*/g) ?? []).length % 2 === 1) rebuilt = rebuilt.replace(/\*\*/g, "");
    return `${prefix}${rebuilt}`;
  });

  if (!removed.length) return { answer, removed, warnings: [] };

  const cleaned = lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/^\s*(?:[🎉💪✨👏]\s*)+$/gmu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const words = cleaned.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (words < 3 || substantive(cleaned) < 0.15 * substantive(answer)) {
    return {
      answer,
      removed: [],
      warnings: [`fidelity guard flagged ${removed.length} unsupported claim(s) but removing them would leave no substantive answer; original kept`],
      suppressed: removed,
    };
  }
  return { answer: cleaned, removed, warnings: [] };
}
