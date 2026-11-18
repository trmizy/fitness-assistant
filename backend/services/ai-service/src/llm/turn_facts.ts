import type { UserProfile } from "./types";

/**
 * TurnFacts — constraints the user STATED, extracted deterministically (no LLM call) from the current message and the earlier
 * user messages of THIS session, with provenance and an explicit precedence over the saved profile.
 *
 * Why (eval 2026-11-11, REAL HTTP/API): only the weight had a precedence rule (resolveWeightForCalculation). "Em 17 tuổi…" was
 * answered as 16 (profile), "Tôi sắp 60 tuổi" as 52, "ở nhà, không có tạ" (previous turn) got Goblet Squat, and "52 tuổi, chưa
 * tập bao giờ" got Nordic Ham Curl. The profile is the default; what the user says now wins for THIS answer only — nothing is
 * written back to UserProfile.
 *
 * Precedence: current message > earlier user message in this session (most recent first) > saved profile.
 * Safety: an age that disagrees with the profile across the 18-year line is resolved CONSERVATIVELY (the minor reading wins)
 * and flagged, so the answer can ask to confirm. Never inferred: a value the user did not state stays undefined.
 *
 * Fact STATUS (independent review 2026-11-12, P1-02): a fact inside a hypothetical clause ("Nếu tôi 16 tuổi…", "Giả sử ở nhà
 * không có tạ…", "If I were 16…") is returned with status HYPOTHETICAL — the answer must still address that scenario — but it is
 * labelled as a scenario in the prompt and is never carried into a LATER turn (only ASSERTED facts are taken from earlier session
 * messages). A negated age ("Tôi không phải 16 tuổi") is dropped, never asserted. A hypothetical age can never weaken minor
 * protection (applyTurnFacts). A fact with NO `status` is ASSERTED (backward compatible).
 *
 * Equipment (independent review 2026-11-12, P1-01): detected on the ORIGINAL accented text, not on the diacritic-folded copy,
 * because "tạ đơn" (dumbbell) and "tạ đòn" (barbell) fold to the same "ta don". Unaccented "ta don" is genuinely ambiguous: it
 * is NEVER guessed — it yields no token (status UNKNOWN / `ambiguous`) unless an English word ("dumbbell"/"barbell") in the same
 * sentence disambiguates.
 */

export type FactSource = "message" | "session" | "profile";
/** Absent status = ASSERTED. NEGATED / UNKNOWN facts constrain nothing. */
export type FactStatus = "ASSERTED" | "HYPOTHETICAL" | "NEGATED" | "UNKNOWN";
export interface Fact<T> {
  value: T;
  source: FactSource;
  approximate?: boolean;
  status?: FactStatus;
  /** equipment only: the user named "ta don" without diacritics (dumbbell vs barbell) — not guessed, ask the user. */
  ambiguous?: boolean;
  /**
   * equipment only (V1 stabilization 2026-11-12). EXHAUSTIVE = the stated list is the user's whole kit ("chỉ có", "ở nhà với",
   * "không có dụng cụ gì"). INCLUSIVE = what the user says they HAVE (`value`) and do NOT have (`excluded`); everything else is
   * UNKNOWN, never absent ("Tôi có tạ đơn" ≠ "Tôi chỉ có tạ đơn"). Absent = EXHAUSTIVE (the behaviour before this field existed).
   */
  scope?: "EXHAUSTIVE" | "INCLUSIVE";
  /** equipment only: catalog tokens the user said they do NOT have ("không có máy" → machine, smith_machine, cable). */
  excluded?: string[];
}

/** Same vocabulary recommendation_engine.ts's filterExercisesByEquipment and the catalog CSV (column `equipment`) already use. */
export type EquipmentToken = "bodyweight" | "resistance_band" | "dumbbell" | "kettlebell" | "barbell" | "machine" | "cable" | "pullup_bar" | "gym" | "bench";
export type ExperienceLevel = "never" | "beginner" | "intermediate" | "advanced";

export interface TurnFacts {
  ageYears?: Fact<number>;
  equipment?: Fact<EquipmentToken[]>;
  location?: Fact<"home" | "gym">;
  experience?: Fact<ExperienceLevel>;
  minutesPerSession?: Fact<number>;
  injuries?: Fact<string[]>;
  conflicts: Array<{ field: "age" | "experience" | "equipment"; stated: string; profile: string; safetyRelevant: boolean }>;
  /** Only when ageYears is HYPOTHETICAL: the real age underneath it (earlier ASSERTED session age, else the profile age). */
  baselineAgeYears?: Fact<number>;
  /** True when the user's REAL age (asserted / profile / baseline) is under 18 — minor-safe handling must stay on. */
  minorProtected?: boolean;
}

type Partial_ = Omit<TurnFacts, "conflicts" | "baselineAgeYears" | "minorProtected">;

// ───────────────────────── text analysis ─────────────────────────

interface Sent {
  /** sentence, lower-cased, NFC (accents intact) */
  raw: string;
  /** diacritic-folded copy (đ→d, whitespace collapsed) — the same folding speech_act.foldVi does */
  f: string;
  /** f index → raw index */
  map: number[];
  /** f index where a hypothetical clause starts (Infinity = none) */
  hypoAt: number;
}

function foldMap(raw: string): { f: string; map: number[] } {
  let f = "";
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (f && !f.endsWith(" ")) { f += " "; map.push(i); }
      continue;
    }
    const base = ch === "đ" ? "d" : ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const c of base) for (let k = 0; k < c.length; k++) { f += c[k]; map.push(i); }
  }
  if (f.endsWith(" ")) { f = f.slice(0, -1); map.pop(); }
  return { f, map };
}

// Hypothetical markers (clause scope = from the marker to the end of its sentence). "giả sử" folds to the same "gia su" as
// "gia sư" (a tutor) — checked against the accented text below. "gia đình" (family) is deliberately NOT a marker.
const HYP_MARKER = /(?<![a-z0-9])(?:neu|gia su|gia du|lo nhu|trong truong hop|truong hop ma|truong hop (?:toi|em|minh)|what if|suppose|supposing|assuming|imagine|if|in case)(?![a-z0-9])/g;

function analyse(text: string): Sent[] {
  const lower = text.normalize("NFC").toLowerCase();
  const out: Sent[] = [];
  for (const piece of lower.split(/(?<=[.!?;…])\s+|\n+/)) {
    const raw = piece.trim();
    if (!raw) continue;
    const { f, map } = foldMap(raw);
    let hypoAt = Infinity;
    for (const m of f.matchAll(HYP_MARKER)) {
      if (m[0] === "gia su" && /sư/.test(raw.slice(map[m.index!], map[m.index! + 5] + 1))) continue; // "gia sư" (no tone mark) = tutor; "giả sử" has the hook
      hypoAt = m.index!;
      break;
    }
    out.push({ raw, f, map, hypoAt });
  }
  return out;
}

const statusAt = (s: Sent, idx: number): "ASSERTED" | "HYPOTHETICAL" => (idx >= s.hypoAt ? "HYPOTHETICAL" : "ASSERTED");
const rawSlice = (s: Sent, a: number, b: number) => s.raw.slice(s.map[a], s.map[b - 1] + 1);
/** ASSERTED beats HYPOTHETICAL for the same field; within a status the first mention wins (as before). */
function choose<T>(c: Array<Fact<T>>): Fact<T> | undefined {
  return c.find((x) => x.status === "ASSERTED") ?? c[0];
}

// ───────────────────────── age ─────────────────────────

// Directly before the number: "không phải 16 tuổi", "I am not 16 years old" ⇒ the user DENIES that age.
const AGE_DENIAL = /(?:khong phai|chua phai|dau phai|chang phai|khong con|khong|am not|isn'?t|aren'?t|not)\s*(?:la\s*)?$/;
// "Tôi chưa 18 tuổi" = not yet 18 = YOUNGER than 18 — kept as the minor reading (17, approximate), never as adult 18.
const AGE_NOT_YET = /\b(?:chua du|chua)\s*$/;

function ageCandidates(s: Sent): Array<Fact<number>> {
  const hits: Array<{ idx: number; end: number; v: number; approx: boolean }> = [];
  for (const m of s.f.matchAll(/\b(sap|gan|ngoai|hon|tam|khoang)\s+(\d{2})\s*tuoi\b/g)) hits.push({ idx: m.index!, end: m.index! + m[0].length, v: Number(m[2]), approx: true });
  const overlaps = (i: number) => hits.some((h) => i >= h.idx && i < h.end);
  for (const m of s.f.matchAll(/(?<![\d.,])(\d{1,2})\s*(?:tuoi|years? ?old|yo)\b/g)) if (!overlaps(m.index!)) hits.push({ idx: m.index!, end: m.index! + m[0].length, v: Number(m[1]), approx: false });
  for (const m of s.f.matchAll(/\btuoi\s*(?:la\s*|cua\s*\S+\s*)?(\d{1,2})(?!\d)/g)) if (!overlaps(m.index!)) hits.push({ idx: m.index!, end: m.index! + m[0].length, v: Number(m[1]), approx: false });
  hits.sort((a, b) => a.idx - b.idx);
  const out: Array<Fact<number>> = [];
  for (const h of hits) {
    if (h.v < 10 || h.v > 99) continue;
    const before = s.f.slice(Math.max(0, h.idx - 25), h.idx);
    if (AGE_DENIAL.test(before)) continue; // NEGATED — never an asserted age
    const notYet = AGE_NOT_YET.test(before);
    out.push({ value: notYet ? h.v - 1 : h.v, source: "message", ...(h.approx || notYet ? { approximate: true } : {}), status: statusAt(s, h.idx) });
  }
  return out;
}

// ───────────────────────── equipment ─────────────────────────

// Equipment is a RESTRICTION only when the user states a limitation ("chỉ có", "ở nhà với", "không có") or a first-person
// possession ("Tôi có dây kháng lực và xà đơn"). Merely naming an exercise or a piece of kit ("Chưa kéo xà đơn nổi thì tập gì?",
// "bài tạ đơn nào tốt?", "Em có tập tạ đơn được không?") restricts nothing (Layer-1 run on stored answers, 2026-11-12: B3-15
// would otherwise have lost its band / lat-pulldown progressions).
// DECISION (documented): a plain "Tôi có cả tạ đòn và tạ đơn" with no "chỉ" IS read as the user's available kit (named items +
// bodyweight): a person stating what they own is describing their setup. A user who also trains at a gym says so ("phòng gym").
const LIMITATION = /\b(chi co|chi tap voi|chi dung|o nha|tai nha|khong co|chua co|khong can|khong dung|only have|at home|without|(?:do not|don'?t|dont) have|no equipment)\b|\b(gio|bay gio|da|vua|moi) (co|mua)\b|\bco\b.{1,25}\broi\b/;
// SUPERSEDES the decision above for the RESTRICTION question (2026-11-12, Priority 3): only these make the list exhaustive. A plain
// "Tôi có X" still records X as owned, but other kit stays unknown (Fact.scope = "INCLUSIVE").
const ONLY = /\b(chi co|chi tap voi|chi dung|only have|only got|o nha|tai nha|at home)\b/;
// What a denied generic word rules out ("không có máy" / "không có tạ"); "không có dụng cụ/thiết bị" rules out everything.
const DENIED_GENERIC: Array<[RegExp, string[] | "all"]> = [
  [/^(?:dung cu|thiet bi|equipment|no equipment|without (?:any )?equipment)$/, "all"],
  [/^may(?: moc)?$/, ["machine", "smith_machine", "cable"]],
  [/^ta$/, ["dumbbell", "barbell", "kettlebell"]],
];

type MentionKind = "dumbbell" | "barbell" | "kettlebell" | "resistance_band" | "pullup_bar" | "bench" | "gym" | "bodyweight" | "generic" | "nogeneric" | "ambig" | "xa" | "cap";
interface Mention { kind: MentionKind; idx: number; end: number }

const EQ_PATTERNS: Array<[RegExp, MentionKind]> = [
  [/\bta don\b/g, "ambig"], // tạ đơn (dumbbell) or tạ đòn (barbell) — resolved from the accented text
  [/\bta (?:tay|cam tay)\b|\bdumb ?bells?\b/g, "dumbbell"],
  [/\bthanh don\b|\bta thanh\b|\bbar ?bells?\b|\bolympic bar\b/g, "barbell"],
  [/\bta am\b|\bkettle ?bells?\b/g, "kettlebell"],
  [/\bday (?:khang luc|dan hoi|cao su)\b|\b(?:resistance|mini|loop) bands?\b/g, "resistance_band"],
  [/\bxa (?:don|ngang)\b|\bpull[ -]?up bars?\b|\bchin[ -]?up bars?\b/g, "pullup_bar"],
  [/\bxa\b(?! (?:phong|bong|lach))/g, "xa"], // bare "xà" — only with the grave accent (not "xa" = far)
  [/\b(?:may )?cap\b|\bcables?\b/g, "cap"], // "cáp" only with the acute accent ("trung cấp" also folds to "cap")
  [/\bbang ghe\b|\bghe (?:tap|phang|day)\b|\bbench\b(?! press)/g, "bench"],
  [/\b(?:phong gym|phong tap|o gym|tai gym|day du may|full gym)\b/g, "gym"],
  [/\btay khong\b|\bbodyweight\b|\btrong luong co the\b/g, "bodyweight"],
  [/\bno equipment\b|\bwithout (?:any )?equipment\b/g, "nogeneric"],
  [/\bdung cu\b|\bthiet bi\b|\bmay moc\b|\bequipment\b|\bmay\b|(?<!chung )\bta\b(?! (?:don|tay|am|thanh|cam))/g, "generic"],
];

function mentionsOf(s: Sent): Mention[] {
  const all: Mention[] = [];
  for (const [re, kind] of EQ_PATTERNS) for (const m of s.f.matchAll(re)) all.push({ kind, idx: m.index!, end: m.index! + m[0].length });
  all.sort((a, b) => a.idx - b.idx || b.end - b.idx - (a.end - a.idx));
  const out: Mention[] = [];
  for (const m of all) if (!out.length || m.idx >= out[out.length - 1].end) out.push(m);
  return out;
}

const BOUNDARY = /\b(?:nhung|ma|but|however|tuy nhien)\b/g;
const NEG_MARK = /\b(?:khong co|khong can|khong dung|khong su dung|khong ranh|chua co|chang co|without|(?:do not|don'?t|dont|doesn'?t) have|lack)\b/g;
const POS_MARK = /\b(?:chi co|chi tap voi|chi dung|co|tap voi|voi|su dung|bang|have|has|got|with|using|use)\b/g;
const FILLER = new Set(["va", "and", "hay", "hoac", "or", "ca", "them", "nhung", "cung", "nao", "gi", "mot", "1", "2", "3", "vai", "moi", "loai", "cai", "chiec", "bo", "cac", "nhu", "san", "thi"]);
const SUBJECT_BEFORE_HAVE = /\b(?:toi|em|minh|i|we|nha toi|nha em|gia dinh)\s+(?:hien |dang |van |cung |chi |moi |da |gio |bay gio )?$/;

/** Polarity of one mention from the nearest preceding "có"/"không có"-type marker in the same clause (per-item negation scope). */
function polarity(s: Sent, mentions: Mention[], k: number): { neg: boolean; possessed: boolean } {
  const m = mentions[k];
  let prefix = s.f.slice(0, m.idx);
  // earlier mentions are transparent list members ("không có A, B" — B stays negated)
  for (let j = k - 1; j >= 0; j--) prefix = prefix.slice(0, mentions[j].idx) + " ".repeat(mentions[j].end - mentions[j].idx) + prefix.slice(mentions[j].end);
  // "tạ đơn thì không có" / "tạ đòn thì có" — postpositive answer
  const after = s.f.slice(m.end, m.end + 14);
  const post = /^\s*thi\s+(khong|chua|co)\b/.exec(after);
  if (post) return { neg: post[1] !== "co", possessed: false };
  let cut = 0;
  for (const b of prefix.matchAll(BOUNDARY)) cut = b.index! + b[0].length;
  const seg = prefix.slice(cut);
  let best: { end: number; start: number; neg: boolean; text: string } | undefined;
  for (const x of seg.matchAll(NEG_MARK)) { const e = x.index! + x[0].length; if (!best || e >= best.end) best = { end: e, start: x.index!, neg: true, text: x[0] }; }
  for (const x of seg.matchAll(POS_MARK)) { const e = x.index! + x[0].length; if (!best || e > best.end) best = { end: e, start: x.index!, neg: false, text: x[0] }; }
  if (!best) return { neg: false, possessed: false };
  const gap = seg.slice(best.end).split(/[^a-z0-9']+/).filter((t) => t && !FILLER.has(t));
  if (gap.length > (best.neg ? 2 : 1)) return { neg: false, possessed: false };
  const possessed = !best.neg && gap.length === 0 && /^(?:chi co|co|have|has|got)$/.test(best.text) && SUBJECT_BEFORE_HAVE.test(seg.slice(0, best.start));
  return { neg: best.neg, possessed };
}

interface EqBucket { tokens: Set<EquipmentToken>; negated: boolean; ambiguous: boolean; any: boolean; excluded: Set<string>; allDenied: boolean }
const newBucket = (): EqBucket => ({ tokens: new Set(), negated: false, ambiguous: false, any: false, excluded: new Set(), allDenied: false });

// The user denies being at that place / having that experience: "không ở nhà", "đâu phải người mới".
const NEGATOR_JUST_BEFORE = /\b(?:khong phai|chua phai|dau phai|chang phai|khong|chua|chang|dau)\s*(?:o\s*|tap\s*|dang\s*|con\s*|co\s*|la\s*)?$/;

function extractEquipment(sents: Sent[], whole: string): Fact<EquipmentToken[]> | undefined {
  const limitation = LIMITATION.test(whole);
  const A = newBucket();
  const H = newBucket();
  for (const s of sents) {
    const ms = mentionsOf(s);
    const hasEnglishDisambiguator = ms.some((m) => m.kind === "dumbbell" || m.kind === "barbell");
    ms.forEach((m, k) => {
      const bucket = statusAt(s, m.idx) === "HYPOTHETICAL" ? H : A;
      const { neg: negPol, possessed } = polarity(s, ms, k);
      let neg = negPol;
      let kind = m.kind;
      if (kind === "nogeneric") { kind = "generic"; neg = true; }
      if (kind === "gym" && NEGATOR_JUST_BEFORE.test(s.f.slice(0, m.idx))) neg = true;
      if (kind !== "gym" && !limitation && !possessed && !(neg && negPol)) return; // naming kit is not a restriction
      let token: EquipmentToken | undefined;
      switch (kind) {
        case "ambig": {
          const r = rawSlice(s, m.idx, m.end);
          if (/đòn/.test(r)) token = "barbell";
          else if (/đ?[ơờớởỡợ]n/.test(r)) token = "dumbbell";
          else if (neg || hasEnglishDisambiguator) return; // unclear which one and negated / English already names it: nothing to record
          else { bucket.ambiguous = true; bucket.any = true; return; }
          break;
        }
        case "xa":
          if (!/^xà$/.test(rawSlice(s, m.idx, m.end))) return;
          token = "pullup_bar";
          break;
        case "cap":
          if (!/cáp|cable/.test(rawSlice(s, m.idx, m.end))) return;
          token = "cable";
          break;
        case "generic":
          if (neg) {
            bucket.negated = true; bucket.any = true;
            const word = s.f.slice(m.idx, m.end);
            const denied = DENIED_GENERIC.find(([re]) => re.test(word))?.[1] ?? "all";
            if (denied === "all") bucket.allDenied = true;
            else denied.forEach((t) => bucket.excluded.add(t));
          }
          return; // "tôi có dụng cụ" tells nothing
        case "gym":
          if (neg) { bucket.negated = true; bucket.allDenied = true; bucket.any = true; return; } // "không tập ở gym" — unchanged reading
          token = "gym";
          break;
        case "bodyweight":
          if (!neg) { bucket.tokens.add("bodyweight"); bucket.any = true; }
          return;
        default:
          token = kind as EquipmentToken;
      }
      bucket.any = true;
      if (neg) { bucket.negated = true; bucket.excluded.add(token!); }
      else bucket.tokens.add(token!);
    });
  }
  const only = ONLY.test(whole);
  const build = (b: EqBucket, status: "ASSERTED" | "HYPOTHETICAL"): Fact<EquipmentToken[]> | undefined => {
    if (!b.any) return undefined;
    const specific = [...b.tokens].filter((t) => t !== "gym" && t !== "bodyweight");
    const value: EquipmentToken[] = [...b.tokens].filter((t) => t !== "bodyweight");
    if (b.negated || specific.length || b.tokens.has("bodyweight")) value.push("bodyweight");
    if (!value.length) return b.ambiguous ? { value: [], source: "message", status: "UNKNOWN", ambiguous: true } : undefined;
    const excluded = [...b.excluded].filter((t) => !b.tokens.has(t as EquipmentToken)).sort();
    return {
      value, source: "message", status,
      scope: only || b.allDenied ? "EXHAUSTIVE" : "INCLUSIVE",
      ...(excluded.length ? { excluded } : {}),
      ...(b.ambiguous ? { ambiguous: true } : {}),
    };
  };
  return build(A, "ASSERTED") ?? build(H, "HYPOTHETICAL");
}

// ───────────────────────── location / experience / minutes / injuries ─────────────────────────

function extractLocation(sents: Sent[]): Fact<"home" | "gym"> | undefined {
  const c: Array<Fact<"home" | "gym">> = [];
  for (const s of sents) {
    for (const [re, v] of [[/\b(?:o nha|tai nha|at home|trong phong(?! gym| tap)|phong ngu)\b/g, "home"], [/\b(?:phong gym|phong tap|o gym|tai gym|at the gym)\b/g, "gym"]] as const) {
      for (const m of s.f.matchAll(re)) {
        if (NEGATOR_JUST_BEFORE.test(s.f.slice(0, m.index!))) continue;
        c.push({ value: v, source: "message", status: statusAt(s, m.index!) });
        break;
      }
    }
  }
  return choose(c);
}

const NEVER = /\bchua (?:tung )?(?:bao gio )?tap\b|\bchua bao gio tap\b|\bchua tap (?:the duc|gym|ta)?\s*(?:bao gio|lan nao)\b|\bchua tap the duc bao gio\b|\bnever (?:trained|worked out|exercised)\b/;
const BEGINNER = /\b(?:moi tap|moi bat dau|nguoi moi|newbie|beginner|moi di tap|lan dau)\b/;
const INTERMEDIATE = /\btap (?:duoc )?(\d+) nam\b|\bda tap lau\b|\bco kinh nghiem\b/;

function extractExperience(sents: Sent[]): Fact<ExperienceLevel> | undefined {
  const c: Array<Fact<ExperienceLevel>> = [];
  for (const s of sents) {
    const add = (value: ExperienceLevel, idx: number) => c.push({ value, source: "message", status: statusAt(s, idx) });
    const never = NEVER.exec(s.f);
    if (never) { add("never", never.index); continue; }
    const beg = BEGINNER.exec(s.f);
    if (beg && !NEGATOR_JUST_BEFORE.test(s.f.slice(0, beg.index))) { add("beginner", beg.index); continue; }
    const mid = INTERMEDIATE.exec(s.f);
    if (mid) {
      // "không có kinh nghiệm" / "chưa có kinh nghiệm" = NO experience, not "experienced"
      if (/\b(?:khong|chua) co kinh nghiem\b/.test(s.f)) add("beginner", mid.index);
      else add("intermediate", mid.index);
    }
  }
  return choose(c);
}

function extractMinutes(sents: Sent[], whole: string): Fact<number> | undefined {
  if (!/\b(buoi|moi lan|tap|session|workout)\b/.test(whole)) return undefined;
  const c: Array<Fact<number>> = [];
  for (const s of sents) {
    const m = /(?<!\d)(\d{2,3})\s*(?:phut|minutes?|min)\b/.exec(s.f);
    if (!m) continue;
    const v = Number(m[1]);
    if (v >= 5 && v <= 240) c.push({ value: v, source: "message", status: statusAt(s, m.index) });
  }
  return choose(c);
}

const INJURY_DENIAL = /\b(?:khong bi|chua bi|khong con|khong he|khong|chua|het|chang|no|without)\s*(?:bi\s*|con\s*)?$/;

function extractInjuries(sents: Sent[]): Fact<string[]> | undefined {
  const A = new Set<string>();
  const H = new Set<string>();
  for (const s of sents) {
    const re = [/\b(?:dau|chan thuong|bong gan|thoai hoa|thoat vi)\s+(?:goi|lung|vai|co tay|co chan|khop|hong|co|dia dem|cot song)\b/g, /\b(?:knee|back|shoulder|wrist|ankle|hip) (?:pain|injury)\b/g];
    for (const r of re) for (const m of s.f.matchAll(r)) {
      if (INJURY_DENIAL.test(s.f.slice(0, m.index!))) continue;
      // "đầu gối" (knee, body part) and "đau gối" (knee PAIN) both fold to "dau goi" (Nova Pro recheck 2026-11-12: technique
      // questions became ASSERTED knee injuries). Check the ACCENTED word: "đau" = pain; "đầu" = body part → skip; unaccented
      // "dau" is ambiguous → accepted only after "bị" ("bi dau goi" — "bị đầu gối" is not Vietnamese).
      const rawStart = s.map[m.index!] ?? 0;
      const rawSpan = s.raw.slice(rawStart, (s.map[m.index! + m[0].length - 1] ?? rawStart) + 1);
      if (/^dau\s/.test(m[0])) {
        const firstWord = rawSpan.split(/\s+/)[0];
        const accentedPain = firstWord === "đau";
        const unaccentedAfterBi = firstWord === "dau" && /\bbi\s+$/.test(s.f.slice(0, m.index!));
        if (!accentedPain && !unaccentedAfterBi) continue;
      }
      (statusAt(s, m.index!) === "HYPOTHETICAL" ? H : A).add(m[0]); // value format unchanged (folded), only detection fixed
    }
  }
  if (A.size) return { value: [...A], source: "message", status: "ASSERTED" };
  if (H.size) return { value: [...H], source: "message", status: "HYPOTHETICAL" };
  return undefined;
}

export function extractFactsFromText(text: string): Partial_ {
  const sents = analyse(text);
  const whole = sents.map((s) => s.f).join(" ");
  const out: Partial_ = {};
  const age = choose(sents.flatMap(ageCandidates)); if (age) out.ageYears = age;
  const equipment = extractEquipment(sents, whole); if (equipment) out.equipment = equipment;
  const location = extractLocation(sents); if (location) out.location = location;
  const experience = extractExperience(sents); if (experience) out.experience = experience;
  const minutes = extractMinutes(sents, whole); if (minutes) out.minutesPerSession = minutes;
  const injuries = extractInjuries(sents); if (injuries) out.injuries = injuries;
  return out;
}

// ───────────────────────── precedence / profile ─────────────────────────

const PROFILE_EXPERIENCE: Record<string, ExperienceLevel> = { BEGINNER: "beginner", INTERMEDIATE: "intermediate", ADVANCED: "advanced" };
const KEYS: Array<keyof Partial_> = ["ageYears", "equipment", "location", "experience", "minutesPerSession", "injuries"];

/** Earlier session messages contribute ASSERTED facts only — a hypothetical / negated / unclear earlier statement never carries over. */
function onlyAsserted(p: Partial_): Partial_ {
  const out: Partial_ = {};
  for (const k of KEYS) {
    const v = p[k] as Fact<any> | undefined;
    if (v && (v.status === undefined || v.status === "ASSERTED")) (out as any)[k] = v;
  }
  return out;
}

const isAsserted = (f?: Fact<unknown>) => !!f && (f.status === undefined || f.status === "ASSERTED");

export function extractTurnFacts(question: string, opts: { sessionUserMessages?: string[]; profile?: UserProfile } = {}): TurnFacts {
  const facts: TurnFacts = { conflicts: [] };
  const current = extractFactsFromText(question);
  const layers: Array<[FactSource, Partial_]> = [["message", current]];
  for (const earlier of opts.sessionUserMessages ?? []) layers.push(["session", onlyAsserted(extractFactsFromText(earlier))]);
  for (const key of KEYS) {
    for (const [source, layer] of layers) {
      const v = layer[key] as Fact<any> | undefined;
      if (v && !(source === "message" && v.status === "UNKNOWN" && layers.slice(1).some(([, l]) => l[key]))) { (facts as any)[key] = { ...v, source }; break; }
    }
  }
  // an unclear unaccented "ta don" in the current message must not hide an earlier clear statement — keep that one, flagged
  if (current.equipment?.status === "UNKNOWN" && facts.equipment && facts.equipment.source !== "message") facts.equipment = { ...facts.equipment, ambiguous: true };

  const p = opts.profile;
  if (p) {
    // profile is the fallback only for fields the user did not state
    if (!facts.ageYears && typeof p.age === "number") facts.ageYears = { value: p.age, source: "profile" };
    if (!facts.experience && p.experienceLevel && PROFILE_EXPERIENCE[p.experienceLevel]) facts.experience = { value: PROFILE_EXPERIENCE[p.experienceLevel], source: "profile" };
    if (!facts.injuries && p.training?.injuries?.length) facts.injuries = { value: [...p.training.injuries], source: "profile" };
  }

  // A hypothetical age sits on top of the real one — remember the real one (safety decisions use it, never the scenario).
  if (facts.ageYears?.status === "HYPOTHETICAL") {
    const earlier = layers.slice(1).map(([source, l]) => (l.ageYears ? { ...l.ageYears, source } : undefined)).find(Boolean);
    const base = earlier ?? (typeof p?.age === "number" ? { value: p.age, source: "profile" as FactSource } : undefined);
    if (base) facts.baselineAgeYears = base;
  }

  if (p) {
    // Conflicts are recorded for ASSERTED facts only — a scenario ("Giả sử tôi 25 tuổi") is not a claim about the user.
    if (facts.ageYears && facts.ageYears.source !== "profile" && isAsserted(facts.ageYears) && typeof p.age === "number" && Math.abs(p.age - facts.ageYears.value) >= 1) {
      const crossesAdult = (p.age < 18) !== (facts.ageYears.value < 18);
      facts.conflicts.push({ field: "age", stated: String(facts.ageYears.value), profile: String(p.age), safetyRelevant: crossesAdult });
      // conservative: if either reading is a minor, the minor reading is the one used
      if (crossesAdult && p.age < 18) facts.ageYears = { value: p.age, source: "profile" };
    }
    if (facts.experience && facts.experience.source !== "profile" && isAsserted(facts.experience) && p.experienceLevel) {
      const prof = PROFILE_EXPERIENCE[p.experienceLevel];
      const same = prof === facts.experience.value || (prof === "beginner" && facts.experience.value === "never");
      if (prof && !same) facts.conflicts.push({ field: "experience", stated: facts.experience.value, profile: prof, safetyRelevant: false });
    }
    const profEq = p.training?.availableEquipment ?? [];
    // Only an EXHAUSTIVE statement can contradict the saved list; "Tôi có tạ đơn" adds to it (applyTurnFacts).
    if (facts.equipment && isAsserted(facts.equipment) && facts.equipment.scope !== "INCLUSIVE" && facts.equipment.value.length && profEq.length && profEq.join(",") !== facts.equipment.value.join(",")) {
      facts.conflicts.push({ field: "equipment", stated: facts.equipment.value.join(","), profile: profEq.join(","), safetyRelevant: false });
    }
  }

  const realAge = facts.ageYears?.status === "HYPOTHETICAL" ? facts.baselineAgeYears?.value : facts.ageYears?.value;
  if ((typeof realAge === "number" && realAge < 18) || (typeof p?.age === "number" && p.age < 18)) facts.minorProtected = true;
  return facts;
}

const EXPERIENCE_TO_PROFILE: Record<ExperienceLevel, string> = { never: "BEGINNER", beginner: "BEGINNER", intermediate: "INTERMEDIATE", advanced: "ADVANCED" };

/**
 * The profile used for THIS answer: stated facts override the saved values in memory only (never persisted).
 * HYPOTHETICAL facts are applied too (the answer must address the scenario) — except that they can never weaken minor
 * protection: a hypothetical adult age never replaces a real minor age, and a hypothetical minor age is always applied.
 * NEGATED / UNKNOWN facts are never applied.
 */
export function applyTurnFacts(profile: UserProfile, facts: TurnFacts): UserProfile {
  const usable = (f?: Fact<unknown>) => !!f && f.source !== "profile" && f.status !== "NEGATED" && f.status !== "UNKNOWN";
  const next: UserProfile = { ...profile, training: { ...profile.training } };
  if (usable(facts.ageYears)) {
    const v = facts.ageYears!.value;
    const profileMinor = typeof profile.age === "number" && profile.age < 18;
    if (facts.ageYears!.status === "HYPOTHETICAL") {
      const baseMinor = !!facts.baselineAgeYears && facts.baselineAgeYears.value < 18;
      if (v < 18) next.age = v;
      else if (baseMinor) next.age = facts.baselineAgeYears!.value;
      else if (profileMinor) next.age = profile.age;
      else next.age = v;
    } else if (!(v >= 18 && profileMinor)) {
      next.age = v;
    }
  }
  if (usable(facts.experience)) next.experienceLevel = EXPERIENCE_TO_PROFILE[facts.experience!.value] as any;
  if (usable(facts.equipment)) {
    const e = facts.equipment!;
    if (e.scope !== "INCLUSIVE") {
      if (e.value.length) next.training.availableEquipment = [...e.value];
    } else {
      // owned items are added to the saved kit, denied items removed; with no saved kit, "unknown" stays unknown (an empty
      // list) — an inclusive statement never invents a complete list
      const saved = profile.training.availableEquipment ?? [];
      if (saved.length) {
        const denied = new Set(e.excluded ?? []);
        next.training.availableEquipment = [...new Set([...saved, ...e.value])].filter((x) => !denied.has(x)) as any;
      }
    }
  }
  if (usable(facts.injuries)) next.training.injuries = [...new Set([...(profile.training.injuries ?? []), ...facts.injuries!.value])];
  return next;
}

// ───────────────────────── prompt block ─────────────────────────

const EQUIPMENT_VI: Record<EquipmentToken, string> = {
  bodyweight: "trọng lượng cơ thể", resistance_band: "dây kháng lực", dumbbell: "tạ đơn", kettlebell: "tạ ấm", barbell: "tạ đòn",
  machine: "máy", cable: "cáp", pullup_bar: "xà đơn", gym: "phòng gym đầy đủ", bench: "ghế tập",
};
const EXPERIENCE_VI: Record<ExperienceLevel, string> = { never: "chưa từng tập", beginner: "mới tập", intermediate: "đã có kinh nghiệm", advanced: "nâng cao" };
const SRC_VI: Record<FactSource, string> = { message: "user vừa nói", session: "user nói trước đó trong cuộc trò chuyện này", profile: "hồ sơ" };
const HYP_VI = "giả định trong câu hỏi, không phải thông tin thật của user";

/** Prompt block: only stated facts + conflicts. Empty string when the user stated nothing. */
export function formatTurnFactsForPrompt(facts: TurnFacts): string {
  const lines: string[] = [];
  const s = (f?: Fact<unknown>) => !!f && f.source !== "profile" && f.status !== "NEGATED" && f.status !== "UNKNOWN";
  const hyp = (f?: Fact<unknown>) => f?.status === "HYPOTHETICAL";
  const tag = (f: Fact<unknown>) => (hyp(f) ? HYP_VI : SRC_VI[f.source]);
  let anyHyp = false;
  const note = (f: Fact<unknown> | undefined) => { if (hyp(f)) anyHyp = true; };

  if (s(facts.ageYears)) {
    const a = facts.ageYears!;
    note(a);
    let safety = "";
    if (hyp(a) && a.value < 18) safety = " — kịch bản dưới 18 tuổi: trả lời theo hướng an toàn cho người dưới 18 tuổi";
    else if (hyp(a) && facts.minorProtected) safety = " — người dùng thật dưới 18 tuổi (theo hồ sơ/lời user): vẫn áp dụng hướng dẫn an toàn cho người dưới 18 tuổi, không coi user là người lớn";
    lines.push(`- Tuổi: ${a.approximate ? "khoảng " : ""}${a.value} (${tag(a)})${safety}`);
  }
  if (s(facts.experience)) { note(facts.experience); lines.push(`- Kinh nghiệm: ${EXPERIENCE_VI[facts.experience!.value]} (${tag(facts.experience!)}) — ${hyp(facts.experience) ? "chỉ trong kịch bản này" : "chỉ chọn bài phù hợp mức này"}`); }
  if (s(facts.equipment) && facts.equipment!.value.length && facts.equipment!.scope !== "INCLUSIVE") {
    const e = facts.equipment!;
    note(e);
    const eq = e.value;
    const only = eq.includes("gym") ? "phòng gym" : eq.map((x) => EQUIPMENT_VI[x]).join(", ");
    const rule = eq.includes("gym") ? "" : hyp(e) ? " — trong kịch bản này không đề xuất bài cần dụng cụ khác" : " — TUYỆT ĐỐI không đề xuất bài cần dụng cụ khác (máy, cáp, tạ đòn…)";
    lines.push(`- Dụng cụ: ${only} (${tag(e)})${rule}`);
  }
  if (s(facts.equipment) && facts.equipment!.scope === "INCLUSIVE") {
    const e = facts.equipment!;
    note(e);
    const owned = e.value.filter((x) => x !== "bodyweight");
    if (owned.length) {
      lines.push(`- Dụng cụ user nói là CÓ: ${owned.includes("gym") ? "phòng gym" : owned.map((x) => EQUIPMENT_VI[x]).join(", ")} (${tag(e)}) — KHÔNG có nghĩa là CHỈ có; dụng cụ khác chưa rõ, đừng mặc định là không có`);
    }
    const denied = [...new Set((e.excluded ?? []).map((x) => EQUIPMENT_VI[x as EquipmentToken] ?? (x === "smith_machine" ? "máy" : x)))];
    if (denied.length) lines.push(`- User nói KHÔNG có: ${denied.join(", ")} (${tag(e)}) — không đề xuất bài bắt buộc cần các dụng cụ này`);
  }
  if (facts.equipment?.ambiguous) lines.push("- Dụng cụ: user nhắc \"tạ đơn/tạ đòn\" nhưng gõ không dấu nên chưa rõ là tạ đơn (dumbbell) hay tạ đòn (barbell) — đừng đoán; hỏi lại user hoặc chọn bài không phụ thuộc loại tạ này");
  if (s(facts.location)) { note(facts.location); lines.push(`- Nơi tập: ${facts.location!.value === "home" ? "ở nhà" : "phòng gym"} (${tag(facts.location!)})`); }
  if (s(facts.minutesPerSession)) { note(facts.minutesPerSession); lines.push(`- Thời gian mỗi buổi: ${facts.minutesPerSession!.value} phút (${tag(facts.minutesPerSession!)})`); }
  if (s(facts.injuries)) { note(facts.injuries); lines.push(`- Đau/chấn thương user nêu: ${facts.injuries!.value.join(", ")}${hyp(facts.injuries) ? ` (${HYP_VI})` : ""} — tránh bài gây tải lên vùng này`); }
  for (const c of facts.conflicts) {
    lines.push(c.safetyRelevant
      ? `- ⚠ Mâu thuẫn ${c.field}: user nói ${c.stated}, hồ sơ ghi ${c.profile}. Áp dụng hướng dẫn an toàn cho người dưới 18 tuổi và nhờ user xác nhận lại tuổi.`
      : `- Mâu thuẫn ${c.field}: user nói "${c.stated}", hồ sơ ghi "${c.profile}" — dùng điều user vừa nói cho câu trả lời này.`);
  }
  if (anyHyp) lines.push("- Các mục ghi \"giả định\" chỉ là kịch bản user đang hỏi: hãy trả lời cho kịch bản đó, KHÔNG coi là dữ liệu thật của user và không dùng để cập nhật hồ sơ.");
  return lines.length ? ["Ràng buộc user đã nêu (ƯU TIÊN hơn hồ sơ đã lưu):", ...lines].join("\n") : "";
}
