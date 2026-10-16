/**
 * Phase 4.6 — RAG retrieval V2, Phase 4.7R — V2.1 (docs/ai-product/phase4-7r-rag-generalization-remediation.md).
 *
 * Why (measured on the live Qdrant, baseline in the 4.6 doc): the four collections share one embedding model and
 * metric but NOT one score scale — short templated Vietnamese FAQ rows systematically out-score English
 * scientific chunks (relevant-doc median cosine 0.797 vs 0.715), so a global top-k by raw score returned a
 * synthetic row at rank 1 in ~87 % of queries, returned documents for out-of-scope questions (MIN_SCORE 0.35
 * never triggers; observed minimum 0.55) and near-duplicates in ~37 % of slots.
 *
 * Algorithm (deterministic, CPU-only, no reranker model, no extra LLM call):
 *   1. normalise the query to CONCEPTS (fitness-concepts.ts) — what the user MEANS, never what it is associated with
 *   2. retrieve PER COLLECTION; the English evidence is asked in English (the concepts' English phrase embedded ALONE —
 *      V2 concatenated it to the Vietnamese text and the Vietnamese dominated the vector)
 *   3. relevance gates: per-class cosine floor; TOPIC GUARD (curated evidence / reference must be ABOUT a detected concept —
 *      a query that maps to no concept can never be answered by research evidence); OUT-OF-DOMAIN lexical rule for the rest;
 *      safety concepts accept trusted curated evidence only. Term matching is by word boundary, not substring.
 *   4. rank WITHIN each source class (cosine blended with concept/lexical coverage) — raw scores are never compared across classes
 *   5. dedupe (exact + token-Jaccard), keeping the higher-authority class
 *   6. pack by source-class policy into a small context (≤ MAX_TOTAL), labelled with provenance
 *   7. conflict V0 (scope-aware): two curated sources with disjoint ranges for the SAME scope are both kept and flagged
 *
 * Pure except for the injected io (embed / search / toDoc).
 */
import { buildKnowledgeSource, stripEvidenceHeader, type RetrievedKnowledgeSource, type SourceClass } from "./knowledge-source";
import { resolveSafetySignals } from "./safety-signals";
import { detectConcepts, conceptSupport, hasTerm, normalizeText, fold, type Concept, type CatalogCue } from "./fitness-concepts";
import type { RetrievalDocument, RetrievalResult } from "./types";

export { fold };

export type KnowledgeDomain =
  | "PROGRAMMING" | "HYPERTROPHY" | "STRENGTH" | "TECHNIQUE" | "NUTRITION" | "BODY_COMPOSITION"
  | "RECOVERY" | "SUPPLEMENTS" | "SAFETY" | "TERMINOLOGY" | "EXERCISE_CATALOG";

// ── 1. domains ────────────────────────────────────────────────────────────

const DOMAIN_RULES: Array<[KnowledgeDomain, RegExp]> = [
  ["SUPPLEMENTS", /(creatine|caffeine|cafein|whey|bcaa|omega|pre-?workout|bo sung|thuc pham chuc nang|supplement|polyphenol)/],
  ["BODY_COMPOSITION", /(inbody|\bbia\b|body fat|ti le mo|ty le mo|do mo|dexa|\bdxa\b|phase angle|\bbmi\b|ffmi|visceral|thanh phan co the|body composition|can giam nhung)/],
  ["SAFETY", /(\bdau\b|chan thuong|bac si|\bkham\b|mang thai|huyet ap|chong mat|injur|pain|an toan khi|thieu nang luong|red-?s)/],
  ["RECOVERY", /(\bngu\b|giac ngu|sleep|phuc hoi|recover|overtrain|doms|stress|nghi (giua|ngay)|cardio co lam mat co|vận động|van dong|who\b.*phut)/],
  ["NUTRITION", /(protein|\bdam\b|calo|calor|kcal|carb|tinh bot|chat beo|\bfat\b|deficit|surplus|bmr|tdee|keto|bua an|an (bao|gi|moi)|\ban\b.*(ngay|bua)|nuoc|hydrat|casein|thermogenesis|dinh duong)/],
  ["STRENGTH", /(suc manh|strength|1rm|powerlifting|mat can bang|bat doi xung|asymmetr|plyometric|mot chan|hai chan|unilateral)/],
  ["HYPERTROPHY", /(tang co|hypertroph|rep range|tempo|bfr|blood flow|lean bulk|phi dai|co bap phat trien)/],
  ["PROGRAMMING", /(volume|\bset\b|tan suat|may lan|deload|giam tai|periodi|progressive|overload|split|full body|nghi giua|failure|chu ky|tang ta|mev|mrv)/],
  ["TECHNIQUE", /(cach (tap|squat|deadlift|bench)|ky thuat|loi thuong gap|setup|hit tho|thay bai|thay the|tap vai|khong noi thi tap|plank)/],
  ["TERMINOLOGY", /(la gi\b|nghia la|\brir\b|\brpe\b|amrap|superset|dropset|drop set|\bpp\b|compound|isolation)/],
  ["EXERCISE_CATALOG", /(nhom co nao|tac dong (nhom )?co|dung co nao|dung dung cu|dung cu gi|bai tap cho|bai tap (tay|chan|nguc|lung|vai|bung|mong)|khong can may|squat|lunge|push[- ]?up|pull[- ]?up|keo xa)/],
];

/** legacy keyword domains ∪ the domains of the detected concepts */
export function inferDomains(question: string): KnowledgeDomain[] {
  const q = fold(question);
  const out: KnowledgeDomain[] = [];
  for (const [d, re] of DOMAIN_RULES) if (re.test(q) && !out.includes(d)) out.push(d);
  for (const d of detectConcepts(question).domains) if (!out.includes(d)) out.push(d);
  return out;
}

const SCIENCE_DOMAINS = new Set<KnowledgeDomain>(["PROGRAMMING", "HYPERTROPHY", "STRENGTH", "NUTRITION", "BODY_COMPOSITION", "RECOVERY", "SUPPLEMENTS", "SAFETY"]);

// ── 2. English phrase for the English evidence ────────────────────────────

/** the English concept phrase for a question ("" when the question maps to no concept) */
export function englishExpansion(question: string): string {
  return detectConcepts(question).englishQuery;
}

// ── 3. lexical terms ──────────────────────────────────────────────────────

const STOP = new Set(
  ("la co khong nen the nao bao nhieu moi thi va cua cho khi de mot nhung nhat hay duoc can gi tot hon cung roi se dang da " +
   "toi minh ban em anh chi vay sao ma thi neu thanh tren duoi sau truoc trong ngoai nhu qua rat lam tu den voi hoac nay do " +
   "kia ay nhe a oi ha vay chu cac nhieu it cai con nguoi ngay tuan thang lan phai muon biet hoi dung sai nghia thiet lau bao nhieu cach khac nhau dong nhom tac " +
   "buoi sang trua chieu toi khuya hom mai gio phut " +
   "what is the of and for are how does do to in on a an with can you i my me").split(" "),
);
const SHORT_KEEP = new Set(["rir", "rpe", "bia", "bmi", "1rm", "pp", "bcaa", "doms", "who", "tdee", "bmr", "bfr", "mev", "mrv", "cut", "fat", "set", "ffmi"]);

export function contentTerms(text: string): string[] {
  return [...new Set(fold(text).split(/[^a-z0-9]+/).filter((w) => (w.length >= 4 || SHORT_KEEP.has(w)) && !STOP.has(w) && !/^\d+$/.test(w)))];
}

/** accents carry meaning in Vietnamese ("ngân hàng" ≠ "ngắn"): when the QUERY is accented its own terms are matched accent-preserving */
const VI_ACCENT = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const NON_WORD = /[^\p{L}\p{N}]+/gu;
const rawNorm = (t: string): string => ` ${t.toLowerCase().normalize("NFC").replace(NON_WORD, " ").trim()} `;
function rawContentTerms(q: string): string[] {
  const keep = new Set(contentTerms(q));
  return [...new Set(q.toLowerCase().normalize("NFC").split(NON_WORD).filter((w) => w && keep.has(fold(w))))];
}

/** word-boundary overlap (V2 used substring `includes`: "ngan" matched "ngắn", "hang" matched "hàng") */
function overlapStats(terms: string[], normText: string): { ratio: number; hits: number } {
  if (terms.length === 0) return { ratio: 0, hits: 0 };
  let hit = 0;
  for (const t of terms) if (hasTerm(normText, t)) hit++;
  return { ratio: hit / terms.length, hits: hit };
}

function exactOverlap(terms: string[], normText: string): { ratio: number; hits: number } {
  if (terms.length === 0) return { ratio: 0, hits: 0 };
  let hit = 0;
  for (const t of terms) if (normText.includes(` ${t} `) || (t.length >= 5 && normText.includes(` ${t}`))) hit++;
  return { ratio: hit / terms.length, hits: hit };
}

// ── 4–6. candidates, ranking, packing ─────────────────────────────────────

export interface Candidate {
  doc: RetrievalDocument;
  source: RetrievedKnowledgeSource;
  cosine: number;
  lexical: number;
  blended: number;
  text: string; // folded title + content (relevance)
  /** folded passage body without headers/titles/Q-A framing (duplicate detection) */
  body?: string;
  /** ids of the detected concepts this passage is about */
  concepts?: string[];
}

/** per-class cosine floors measured on the live collections (doc §Ranking). Evidence is English + longer, so its floor is lower. */
export const V2_CONFIG = {
  floors: { CURATED_EVIDENCE: 0.55, CURATED_REFERENCE: 0.6, SYNTHETIC_KNOWLEDGE: 0.62, CATALOG: 0.58, OTHER: 0.9 } as Record<SourceClass, number>,
  /** minimum lexical overlap ratio per class (after the ≥ min(2, #terms) shared-terms rule) */
  minLexical: { CURATED_EVIDENCE: 0.15, CURATED_REFERENCE: 0.3, SYNTHETIC_KNOWLEDGE: 0.15, CATALOG: 0.15, OTHER: 1 } as Record<SourceClass, number>,
  perCollectionLimit: 8,
  quotas: { CURATED_EVIDENCE: 3, CURATED_REFERENCE: 1, SYNTHETIC_KNOWLEDGE: 2, CATALOG: 2 } as Record<string, number>,
  maxTotal: 4,
  maxSnippetChars: 520,
  dedupJaccard: 0.82,
  lexicalWeight: 0.35,
  /** V2.1: a query that maps to no concept may still be answered by synthetic/catalog text only through ≥ this many whole-word content-term hits … */
  oodMinTermHits: 2,
  /** … covering at least this share of its content terms */
  oodMinTermShare: 0.6,
};

function jaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter((w) => w.length > 3)), B = new Set(b.split(" ").filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / (A.size + B.size - i);
}

/** the answer/passage text only: drops evidence headers, "Title:/Q:" framing and the question half of a FAQ row */
export function passageBody(raw: string): string {
  let s = stripEvidenceHeader(raw);
  const a = s.lastIndexOf(" A: ");
  const c = s.indexOf("Content: ");
  if (c >= 0) s = s.slice(c + 9);
  else if (a >= 0) s = s.slice(a + 4);
  return fold(s).replace(/\s+/g, " ").trim();
}
const bodyOf = (c: Candidate): string => c.body ?? passageBody(c.doc.pageContent);

const AUTHORITY: Record<SourceClass, number> = { CURATED_EVIDENCE: 4, CURATED_REFERENCE: 3, CATALOG: 2, SYNTHETIC_KNOWLEDGE: 1, OTHER: 0 };

/** Drop exact / near duplicates; on a tie keep the higher-authority class, then the higher blended score. */
export function dedupeCandidates(cands: Candidate[], threshold = V2_CONFIG.dedupJaccard): Candidate[] {
  const ordered = [...cands].sort((a, b) => AUTHORITY[b.source.sourceClass] - AUTHORITY[a.source.sourceClass] || b.blended - a.blended);
  const kept: Candidate[] = [];
  for (const c of ordered) {
    const body = bodyOf(c);
    if (!kept.some((k) => jaccard(body, bodyOf(k)) >= threshold)) kept.push(c);
  }
  return kept;
}

// ── 7. conflict V0 (scope-aware, Phase 4.7R) ──────────────────────────────

const RANGE_G_PER_KG = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*g\s*\/\s*kg/gi;

export type TimeScope = "PER_DAY" | "PER_MEAL" | "UNKNOWN";
export type Denominator = "BODY_WEIGHT" | "FAT_FREE_MASS" | "UNKNOWN";
export type DietContext = "ENERGY_RESTRICTION" | "ENERGY_SURPLUS" | "GENERAL";
export interface RangeScope { time: TimeScope; denominator: Denominator; context: DietContext }

export interface ConflictNote {
  unit: "g/kg";
  sources: Array<{ sourceId: string | null; title: string | null; range: [number, number]; scope?: RangeScope }>;
}

/**
 * Where a g/kg figure applies, read from the words around it. A figure whose scope cannot be read is UNKNOWN —
 * never silently assumed comparable (per-meal 0.25–0.4 g/kg and per-day 1.4–2.0 g/kg are not competing advice).
 */
export function rangeScope(text: string, start: number, end: number): RangeScope {
  const near = fold(text.slice(Math.max(0, start - 90), Math.min(text.length, end + 70)));
  const after = fold(text.slice(end, Math.min(text.length, end + 40)));
  let time: TimeScope = "UNKNOWN";
  if (/(per|each|every|a|\/)\s*(meal|serving|dose|feeding|bua|sitting)\b|\/\s*(meal|bua)|moi bua|tung bua|per-meal|mot bua|single meal/.test(near)) time = "PER_MEAL";
  if (/(per|a|each|\/)\s*(day|d)\b|\/\s*(day|d|ngay)\b|daily|moi ngay|mot ngay|hang ngay|per-day|\bgram\/day|total (protein|intake)/.test(after) || (time === "UNKNOWN" && /(daily|moi ngay|hang ngay|per day|a day|per-day)/.test(near))) time = time === "PER_MEAL" ? "UNKNOWN" : "PER_DAY";
  let denominator: Denominator = "UNKNOWN";
  if (/(fat[- ]?free mass|\bffm\b|lean (body )?mass|\blbm\b|khoi luong nac|khong mo)/.test(near)) denominator = "FAT_FREE_MASS";
  else if (/(body ?weight|\bbw\b|body mass|\bbm\b|can nang|trong luong co the|per kg of body)/.test(near)) denominator = "BODY_WEIGHT";
  let context: DietContext = "GENERAL";
  if (/(energy restriction|calori[ec] restriction|deficit|hypocaloric|weight loss|fat loss|\bcut\b|giam can|giam mo|thieu hut|dieting)/.test(near)) context = "ENERGY_RESTRICTION";
  else if (/(surplus|hypercaloric|\bbulk|weight gain|tang can|du calo)/.test(near)) context = "ENERGY_SURPLUS";
  return { time, denominator, context };
}

/** two figures are directly comparable only when time scope and denominator are KNOWN and equal and the diet context matches */
export function comparableScopes(a: RangeScope, b: RangeScope): boolean {
  return a.time !== "UNKNOWN" && a.time === b.time && a.denominator !== "UNKNOWN" && a.denominator === b.denominator && a.context === b.context;
}

function collectRanges(cands: Candidate[]): ConflictNote["sources"] {
  const found: ConflictNote["sources"] = [];
  for (const c of cands) {
    if (c.source.sourceClass !== "CURATED_EVIDENCE") continue;
    const raw = c.doc.pageContent;
    for (const m of raw.matchAll(RANGE_G_PER_KG)) {
      const lo = Number(m[1]), hi = Number(m[2]);
      if (lo < hi && m.index !== undefined) found.push({ sourceId: c.source.sourceId, title: c.source.title, range: [lo, hi], scope: rangeScope(raw, m.index, m.index + m[0].length) });
    }
  }
  return found;
}

const disjoint = (a: [number, number], b: [number, number]) => a[1] < b[0] || b[1] < a[0];

/**
 * Narrow, deterministic: two DISTINCT curated sources giving disjoint numeric g/kg ranges for the SAME scope
 * (same time scope, same denominator, same diet context). Both are kept and flagged; nothing is chosen.
 * Disjoint ranges whose scope differs or cannot be read are NOT a conflict — see `detectScopeUncertainty`.
 */
export function detectRangeConflict(cands: Candidate[]): ConflictNote | null {
  const found = collectRanges(cands);
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const a = found[i], b = found[j];
      if (a.sourceId && b.sourceId && a.sourceId !== b.sourceId && disjoint(a.range, b.range) && a.scope && b.scope && comparableScopes(a.scope, b.scope)) {
        return { unit: "g/kg", sources: [a, b] };
      }
    }
  }
  return null;
}

/** CONFLICT_SCOPE_UNCERTAIN: disjoint figures from different sources whose scope differs/cannot be determined — informational only. */
export function detectScopeUncertainty(cands: Candidate[]): boolean {
  const found = collectRanges(cands);
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const a = found[i], b = found[j];
      if (a.sourceId && b.sourceId && a.sourceId !== b.sourceId && disjoint(a.range, b.range) && a.scope && b.scope && !comparableScopes(a.scope, b.scope)) return true;
    }
  }
  return false;
}

// ── orchestration ────────────────────────────────────────────────────────

export interface V2Io {
  embed: (text: string) => Promise<number[]>;
  search: (collection: string, vector: number[], limit: number) => Promise<Array<{ id: string; similarity: number; payload: Record<string, unknown> }>>;
  toDoc: (collection: string, payload: Record<string, unknown>, score: number, id: string) => RetrievalDocument;
}

export interface V2Trace {
  domains: KnowledgeDomain[];
  /** ids of the detected concepts (empty ⇒ the query maps to no supported fitness concept) */
  concepts: string[];
  /** Phase 4.7R2 query-concept resolution (scope decision BEFORE any embedding) */
  resolution?: { status: string; reasons: string[] };
  candidates: number;
  afterGate: number;
  afterDedup: number;
  returned: number;
  embeddings: number;
  dropped: { floor: number; noLexical: number; duplicate: number; offTopic: number; safetyClass: number };
  conflict: ConflictNote | null;
  /** CONFLICT_SCOPE_UNCERTAIN: figures differ but their scope (per meal vs per day, body weight vs fat-free mass…) is not comparable */
  scopeUncertain: boolean;
}

/**
 * Non-knowledge intent (shopping / price / release news / booking): a fitness-sounding noun in such a request does not make
 * it a knowledge question. Only applies when no knowledge-seeking cue is present ("… có tốt không", "liều bao nhiêu"…).
 */
const COMMERCIAL_INTENT = /(chon .*(de )?mua|de mua\b|nen mua|\bshop\b|gia si|nhap (hang|si|so luong)|mua [a-z ]{0,14}(nao|loai|hieu|hang|truoc|gia|si|so luong|bulk)|nha thuoc|chinh hang|hang chinh|ban (o dau|gan day)|gan day|mua o dau|mua (loai|hang|cai|may|dong ho)|gia (bao nhieu|ban|tien)|bao nhieu tien|ra mat|khuyen mai|giam gia|dat (ve|hang|lich|phong)|dia chi|cua hang|\bship\b|lich thi dau|tin tuc|thoi tiet|hom nay (the nao|ra sao))/;
const KNOWLEDGE_INTENT = /(co (tot|hai|an toan|hieu qua|tac dung|nen|can|chinh xac|giup|anh huong)|nghien cuu|bang chung|khoa hoc|lieu |bao nhieu (g|mg|set|rep|kg|calo|phut)|la gi|khac nhau|anh huong|vi sao|tai sao|nhu the nao)/;
export function isNonKnowledgeIntent(question: string): boolean {
  const f = fold(question);
  return COMMERCIAL_INTENT.test(f) && !KNOWLEDGE_INTENT.test(f);
}

const COLLECTIONS = ["fitness_evidence", "fitness_knowledge", "fitness_faq", "exercises"] as const;

export function packCandidates(ranked: Candidate[], domains: KnowledgeDomain[], hasScienceCue: boolean): Candidate[] {
  // a science question that merely mentions a body part ("chân trái yếu hơn chân phải") is answered by evidence first
  const catalogFirst = (domains.includes("EXERCISE_CATALOG") || domains.includes("TECHNIQUE")) && !hasScienceCue;
  const order: SourceClass[] = catalogFirst
    ? ["CATALOG", "SYNTHETIC_KNOWLEDGE", "CURATED_EVIDENCE", "CURATED_REFERENCE"]
    : ["CURATED_EVIDENCE", "CURATED_REFERENCE", "SYNTHETIC_KNOWLEDGE", "CATALOG"];
  const out: Candidate[] = [];
  const evidenceStrong = ranked.filter((c) => c.source.sourceClass === "CURATED_EVIDENCE" && c.lexical >= 0.2).length;
  for (const cls of order) {
    // catalog rows are exercise reference, not scientific evidence: only offered for catalog/technique questions
    if (cls === "CATALOG" && !catalogFirst && !domains.includes("TECHNIQUE")) continue;
    let quota = V2_CONFIG.quotas[cls] ?? 0;
    // synthetic is a FALLBACK for science questions: shrink when enough curated evidence already answers the topic
    if (!catalogFirst && cls === "SYNTHETIC_KNOWLEDGE") quota = evidenceStrong >= 2 ? 1 : quota;
    // distinct sources first (two chunks of the same paper must not crowd out a second paper), repeats only to fill the quota
    const inClass = ranked.filter((x) => x.source.sourceClass === cls);
    const seen = new Set<string>();
    const firstPass = inClass.filter((c) => { const k = c.source.sourceId ?? c.source.title ?? ""; if (seen.has(k)) return false; seen.add(k); return true; });
    const repeats = inClass.filter((c) => !firstPass.includes(c));
    for (const c of [...firstPass, ...repeats].slice(0, quota)) {
      if (out.length >= V2_CONFIG.maxTotal) break;
      out.push(c);
    }
  }
  return out;
}

const catalogSupported = (cues: CatalogCue[], normText: string): boolean =>
  cues.some((c) => c.en.split(" ").filter((w) => w.length >= 4).some((w) => hasTerm(normText, w)));

export async function retrieveV2(question: string, io: V2Io): Promise<RetrievalResult & { trace: V2Trace }> {
  const det = detectConcepts(question);
  const domains = inferDomains(question);
  const qTerms = contentTerms(question);
  const accented = VI_ACCENT.test(question);
  const qTermsRaw = accented ? rawContentTerms(question) : [];
  const hasConcepts = det.concepts.length > 0;
  // Phase 4.7R3: SAFETY SIGNAL resolution precedes concept/domain resolution and every embedding. Any safety signal (named condition OR
  // symptom/event/state wording) switches to the fail-closed document rule; with no recognised safety concept nothing can be titled ⇒ abstain.
  const sg = resolveSafetySignals(question);
  const safetyMode = det.safety || sg.level !== "NONE";
  if (safetyMode && !det.safety) {
    const t: V2Trace = { domains: [], concepts: [], resolution: { status: "SAFETY", reasons: [`safety_${sg.level.toLowerCase()}`, ...sg.signals.map((x) => x.cls)] }, candidates: 0, afterGate: 0, afterDedup: 0, returned: 0, embeddings: 0, dropped: { floor: 0, noLexical: 0, duplicate: 0, offTopic: 0, safetyClass: 0 }, conflict: null, scopeUncertain: false };
    return { documents: [], isEmpty: true, reason: "NO_RELEVANT_KNOWLEDGE", trace: t };
  }
  // scope decision precedes every embedding: ambiguous-without-context, incompatible-context and shopping/news requests never reach Qdrant
  const scopeOut = det.status === "AMBIGUOUS" || det.status === "OUT_OF_DOMAIN";
  if (scopeOut || isNonKnowledgeIntent(question)) {
    const trace0: V2Trace = { domains: [], concepts: [], resolution: { status: scopeOut ? det.status : "OUT_OF_DOMAIN", reasons: det.reasons }, candidates: 0, afterGate: 0, afterDedup: 0, returned: 0, embeddings: 0, dropped: { floor: 0, noLexical: 0, duplicate: 0, offTopic: 0, safetyClass: 0 }, conflict: null, scopeUncertain: false };
    return { documents: [], isEmpty: true, reason: "NO_RELEVANT_KNOWLEDGE", trace: trace0 };
  }
  const wantCatalog = domains.includes("EXERCISE_CATALOG") || domains.includes("TECHNIQUE");

  // evidence/reference are only ever asked when the query MEANS a fitness concept (the topic guard needs one anyway)
  const askEvidence = hasConcepts;
  let embeddings = 0;
  const embed = (t: string) => { embeddings++; return io.embed(t); };
  const enPhrases = det.englishQueries.length ? det.englishQueries : [];
  const [vOrig, vEnList, vCatalog] = await Promise.all([
    embed(question),
    Promise.all(enPhrases.map((p) => embed(p))),
    wantCatalog && det.catalog.length ? embed(det.catalog.map((c) => c.en).join(" ")) : Promise.resolve(null),
  ]);

  const searches: Array<Promise<{ collection: string; hits: Array<{ id: string; similarity: number; payload: Record<string, unknown> }> }>> = [];
  for (const col of COLLECTIONS) {
    if (col === "exercises" && !wantCatalog) continue;
    if (col === "fitness_evidence" && !askEvidence) continue;
    const vectors = col === "fitness_evidence" ? [vOrig, ...vEnList] : col === "exercises" && vCatalog ? [vOrig, vCatalog] : [vOrig];
    for (const v of vectors) searches.push(io.search(col, v, V2_CONFIG.perCollectionLimit).then((hits) => ({ collection: col, hits })).catch(() => ({ collection: col, hits: [] })));
  }
  const results = await Promise.all(searches);

  const trace: V2Trace = {
    domains, concepts: det.concepts.map((c) => c.id), resolution: { status: det.status, reasons: det.reasons }, candidates: 0, afterGate: 0, afterDedup: 0, returned: 0, embeddings,
    dropped: { floor: 0, noLexical: 0, duplicate: 0, offTopic: 0, safetyClass: 0 }, conflict: null, scopeUncertain: false,
  };
  const byKey = new Map<string, Candidate>();
  for (const { collection, hits } of results) {
    for (const h of hits) {
      trace.candidates++;
      const source = buildKnowledgeSource(collection, h.payload, String(h.id));
      const cls = source.sourceClass;
      if (h.similarity < V2_CONFIG.floors[cls]) { trace.dropped.floor++; continue; }
      // safety-relevant concepts: only trusted curated evidence may answer (synthetic FAQ / practitioner reference are not authority)
      if (safetyMode && cls !== "CURATED_EVIDENCE") { trace.dropped.safetyClass++; continue; }

      // …and its TITLE must be about the safety concept (a physical-activity guideline that merely mentions "heart disease" is not an answer to a symptom)
      if (safetyMode) {
        const titleNorm = normalizeText(source.title ?? "");
        const titled = (det.concepts as Concept[]).filter((c) => c.safety).some((c) => c.docTerms.some((t) => hasTerm(titleNorm, t)));
        if (!titled) { trace.dropped.safetyClass++; continue; }
      }

      const doc = io.toDoc(collection, h.payload, h.similarity, String(h.id));
      const text = fold(`${source.title ?? ""} ${doc.pageContent}`).replace(/\s+/g, " ");
      const norm = normalizeText(`${source.title ?? ""} ${doc.pageContent}`);
      const isVi = cls === "SYNTHETIC_KNOWLEDGE" || cls === "CURATED_REFERENCE";
      const sup = conceptSupport(norm, det.concepts as Concept[], { vietnamese: isVi, titleNorm: normalizeText(source.title ?? "") });
      // accented query → accent-preserving term match against the raw (not folded) passage
      const qStat = accented ? exactOverlap(qTermsRaw, rawNorm(`${source.title ?? ""} ${doc.pageContent}`)) : overlapStats(qTerms, norm);

      if (cls === "CURATED_EVIDENCE" || cls === "CURATED_REFERENCE") {
        // TOPIC GUARD: research / practitioner text must be about a concept the user actually asked about
        if (!hasConcepts || sup.supported.length === 0) { trace.dropped.offTopic++; continue; }
      } else if (cls === "CATALOG") {
        const ok = (det.catalog.length > 0 && catalogSupported(det.catalog, norm)) || (qStat.hits >= 1 && qTerms.length > 0 && qStat.ratio >= 0.5);
        if (!ok) { trace.dropped.noLexical++; continue; }
      } else {
        // synthetic text: about a detected concept, or (OUT-OF-DOMAIN rule) strong whole-word overlap with the query's own terms
        const titleStat = hasConcepts ? qStat : (accented ? exactOverlap(qTermsRaw, rawNorm(source.title ?? "")) : overlapStats(qTerms, normalizeText(source.title ?? "")));
        const needHits = Math.max(1, Math.ceil((hasConcepts ? 0.5 : V2_CONFIG.oodMinTermShare) * qTerms.length));
        const viaQuery = qTerms.length > 0 && titleStat.hits >= needHits && (hasConcepts || (qTerms.length >= V2_CONFIG.oodMinTermHits && titleStat.hits >= V2_CONFIG.oodMinTermHits));
        const viaCatalogName = det.catalog.length > 0 && catalogSupported(det.catalog, norm);
        if (sup.supported.length === 0 && !viaQuery && !viaCatalogName) { trace.dropped.noLexical++; continue; }
      }
      // a catalog row that names a detected exercise/body-part cue counts as lexically relevant even when the query is Vietnamese
      const catalogHit = cls === "CATALOG" && det.catalog.length > 0 && catalogSupported(det.catalog, norm);
      const lexical = Math.max(qStat.ratio, sup.coverage, catalogHit ? 0.5 : 0);
      if (lexical < V2_CONFIG.minLexical[cls]) { trace.dropped.noLexical++; continue; }
      const blended = h.similarity * (1 - V2_CONFIG.lexicalWeight) + lexical * V2_CONFIG.lexicalWeight;
      const key = `${collection}:${h.id}`;
      const prev = byKey.get(key);
      if (!prev || prev.blended < blended) byKey.set(key, { doc, source, cosine: h.similarity, lexical, blended, text, body: passageBody(doc.pageContent), concepts: sup.supported.map((c) => c.id) });
    }
  }
  const gated = [...byKey.values()];
  trace.afterGate = gated.length;
  const deduped = dedupeCandidates(gated);
  trace.dropped.duplicate = gated.length - deduped.length;
  trace.afterDedup = deduped.length;

  // rank WITHIN class only (raw cosine is never compared across classes)
  const ranked = deduped.sort((a, b) => b.blended - a.blended);
  const hasScienceCue = domains.some((d) => SCIENCE_DOMAINS.has(d));
  let packed = packCandidates(ranked, domains, hasScienceCue);
  // STRUCTURAL SAFETY INVARIANT: under any safety signal the final context can only be trusted curated evidence titled for the condition —
  // generic catalog / training / hypertrophy / FAQ text can never be the supporting evidence of a symptom or condition question.
  if (safetyMode) {
    const safetyConcepts = (det.concepts as Concept[]).filter((c) => c.safety);
    packed = packed.filter((c) => c.source.sourceClass === "CURATED_EVIDENCE" && safetyConcepts.some((k) => k.docTerms.some((t) => hasTerm(normalizeText(c.source.title ?? ""), t))));
  }
  trace.returned = packed.length;

  if (packed.length === 0) return { documents: [], isEmpty: true, reason: "NO_RELEVANT_KNOWLEDGE", trace };
  const conflict = detectRangeConflict(packed);
  trace.conflict = conflict;
  trace.scopeUncertain = !conflict && detectScopeUncertainty(packed);

  const documents = packed.map((c, i) => {
    const doc = c.doc;
    const snippet = doc.pageContent.length > V2_CONFIG.maxSnippetChars ? `${doc.pageContent.slice(0, V2_CONFIG.maxSnippetChars)}…` : doc.pageContent;
    return {
      ...doc,
      pageContent: snippet,
      metadata: {
        ...doc.metadata,
        knowledgeSource: c.source,
        knowledgeRelevance: i < 2 ? "PRIMARY" : "SECONDARY",
        knowledgeDomains: domains,
        ...(conflict ? { conflictNote: conflict } : {}),
        ...(trace.scopeUncertain ? { conflictScopeUncertain: true } : {}),
      },
    } as RetrievalDocument;
  });
  return { documents, isEmpty: false, trace };
}
