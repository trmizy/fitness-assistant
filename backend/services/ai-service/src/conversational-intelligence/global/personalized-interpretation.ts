/**
 * Phase 4.7 — evidence-grounded PERSONALIZED INTERPRETATION
 * (docs/ai-product/phase4-7-evidence-grounded-coach.md).
 *
 *   FACT            ← CoachState slices (via the Phase 4.5 evidence builder) — rendered by code, never by the model
 *   KNOWLEDGE       ← RAG V2 packed context (source classes + provenance) — rendered by code with its sources
 *   INTERPRETATION  ← one bounded sentence block: model-written only when curated/synthetic support exists,
 *                     validated against both layers, otherwise a deterministic template
 *
 * Read-only. No causal claims, no prescriptions, no new semantic ontology (TypeScript-only ReadTopic).
 * User-facing activation requires CONVERSATIONAL_INTELLIGENCE_V2 + GYMINI_UNIFIED_AI_COACH + RAG_RETRIEVAL_V2 all "on".
 */
import { logger } from "@gym-coach/shared";
import { z } from "zod";
import type { AgentIdentity } from "../../services/fitness-agent-tools";
import { normalizeAgentText } from "../../services/fitness-agent-intent";
import { readCoachStateSlices } from "../../services/coach-state/coach-state";
import { callLlmJson, NARRATION_BUDGET } from "../../llm/json_llm_call.util";
import { retriever } from "../../llm/retriever";
import { resolveSafetySignals } from "../../llm/safety-signals";
import { buildKnowledgeContext, type KnowledgeContextItem } from "../../llm/knowledge-source";
import type { RetrievalResult } from "../../llm/types";
import { unifiedCoachMode } from "../index";
import {
  CAUSAL_RAW, NEG, ON_TRACK_CLAIM, PRESCRIPTIVE, bodyLines, buildProgressReviewV0, domainUnavailableLine, evidenceSnapshot,
  limitationLines, nutritionLines, toSlice, trainingLines, fmt, type Domain, type ProgressReviewV0,
} from "./progress-review";

// ── recognition ──────────────────────────────────────────────────────────

export type InterpretationTopic = "PROTEIN" | "CALORIES" | "BODY_FAT" | "WEIGHT" | "RPE_RIR" | "VOLUME" | "CONSISTENCY";
export type PersonalDomain = "NUTRITION" | "BODY" | "TRAINING";

interface TopicSpec { re: RegExp; domains: PersonalDomain[]; knowledgeQuery: string }
const TOPICS: Record<InterpretationTopic, TopicSpec> = {
  PROTEIN: { re: /(protein|\bdam\b)/, domains: ["NUTRITION"], knowledgeQuery: "protein intake g/kg resistance training muscle" },
  CALORIES: { re: /(\bcalo|kcal|nang luong)/, domains: ["NUTRITION"], knowledgeQuery: "energy balance calorie deficit weight loss body composition" },
  BODY_FAT: { re: /(body fat|ty le mo|ti le mo|inbody|\bbia\b|do mo)/, domains: ["BODY"], knowledgeQuery: "bioelectrical impedance body composition measurement accuracy limitations" },
  WEIGHT: { re: /(can nang|giam can|\bkg\b)/, domains: ["BODY"], knowledgeQuery: "rate of weight loss body weight fluctuation body composition" },
  RPE_RIR: { re: /(\brpe\b|\brir\b|cuong do|cang suc)/, domains: ["TRAINING"], knowledgeQuery: "rating of perceived exertion repetitions in reserve resistance training intensity" },
  VOLUME: { re: /(volume|so set|khoi luong tap)/, domains: ["TRAINING"], knowledgeQuery: "resistance training volume sets per week hypertrophy" },
  CONSISTENCY: { re: /(\bdeu\b|\bbuoi\b|tan suat|consistency|tuan thu|tien bo|bench)/, domains: ["TRAINING"], knowledgeQuery: "training frequency consistency progressive overload resistance training" },
};
const INTERPRET_CUE = /(y nghia|hieu (the nao|sao|ra sao)|nen hieu|noi len|dang chu y|co sao khong|co on khong|co binh thuong|co van de|nghia la gi|danh gia the nao|co nghia)/;
const PERSONAL_CUE = /(cua (toi|minh)\b|\b(toi|minh)\b|hien tai|gan day|dao nay)/;
const SAFETY_CUE = /(\bdau\b|chan thuong|chong mat|tim dap|ngat|bac si|khoi benh|thuoc|thoat vi|mang thai|huyet ap)/;
const ACTION_CUE = /((chinh|doi|sua|dieu chinh|cap nhat|lap lai|tao lai|len lai|thay)\s+(lai\s+)?(giup|lich|chuong trinh|plan|buoi|thuc don|calo|target|muc tieu)|giup (toi|minh)|\bgiam (calo|them)\b|\btang (calo|them|protein len)\b|nen (giam|tang|an|tap|bo|them|doi))/;
const DEFINITION_ONLY = /(\bla gi\b|what is|la the nao)/;

export interface InterpretationClass { topics: InterpretationTopic[]; domains: PersonalDomain[] }

export function classifyInterpretationQuestion(text: string): InterpretationClass | null {
  const s = normalizeAgentText(text);
  if (!PERSONAL_CUE.test(s) || !/\b(toi|minh)\b|cua (toi|minh)/.test(s)) return null;
  if (!INTERPRET_CUE.test(s)) return null;
  if (SAFETY_CUE.test(s)) return null;
  // Phase 4.7R3: symptom / event / post-surgical / pregnancy wording ⇒ safety handling first, never progress interpretation
  if (resolveSafetySignals(text).level !== "NONE") return null;            // safety/red-flag stays with the existing conservative path
  if (ACTION_CUE.test(s)) return null;            // mutation/proposal stays with the existing HITL path
  if (DEFINITION_ONLY.test(s) && !/cua (toi|minh)/.test(s)) return null;
  const topics = (Object.keys(TOPICS) as InterpretationTopic[]).filter((t) => TOPICS[t].re.test(s));
  if (topics.length === 0) return null;           // no specific personal metric ⇒ not interpretation (Phase 4.5 owns holistic)
  const domains = [...new Set(topics.flatMap((t) => TOPICS[t].domains))];
  return { topics, domains };
}

// ── knowledge coverage ───────────────────────────────────────────────────

export type KnowledgeCoverage = "CURATED_SUFFICIENT" | "CURATED_PARTIAL" | "SYNTHETIC_ONLY" | "NO_RELEVANT_KNOWLEDGE" | "CONFLICTING_EVIDENCE";

export function knowledgeCoverage(result: RetrievalResult, items: KnowledgeContextItem[]): KnowledgeCoverage {
  if (result.isEmpty || items.length === 0) return "NO_RELEVANT_KNOWLEDGE";
  if (result.documents.some((d) => (d.metadata as Record<string, unknown>).conflictNote)) return "CONFLICTING_EVIDENCE";
  const evidence = items.filter((i) => i.source.sourceClass === "CURATED_EVIDENCE").length;
  const reference = items.filter((i) => i.source.sourceClass === "CURATED_REFERENCE").length;
  if (evidence >= 2) return "CURATED_SUFFICIENT";
  if (evidence === 1 || reference >= 1) return "CURATED_PARTIAL";
  return "SYNTHETIC_ONLY";
}

export interface PersonalizedInterpretationContext {
  questionTopics: InterpretationTopic[];
  personalEvidence: ProgressReviewV0["evidence"];
  limitations: ProgressReviewV0["limitations"];
  domains: ProgressReviewV0["domains"];
  knowledge: { items: KnowledgeContextItem[]; coverage: KnowledgeCoverage; conflict: { unit: string; sources: Array<{ title: string | null; range: [number, number] }> } | null };
}

// ── deterministic rendering ───────────────────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);
const citeOf = (i: KnowledgeContextItem) => {
  const s = i.source;
  const who = [s.title, [s.publisher, s.year].filter(Boolean).join(", ")].filter((x) => x && String(x).length).join(" — ");
  return `${who}${s.url ? ` [nguồn: ${s.url}]` : s.sourceId ? ` [mã nguồn: ${s.sourceId}]` : ""}`;
};

export function renderKnowledgeBlock(ctx: PersonalizedInterpretationContext): string {
  const { coverage, items, conflict } = ctx.knowledge;
  if (coverage === "NO_RELEVANT_KNOWLEDGE") return "Về mặt khoa học: mình chưa tìm thấy tài liệu phù hợp trong kho kiến thức hiện tại để giải thích khía cạnh này, nên mình không diễn giải thêm.";
  const evidence = items.filter((i) => i.source.sourceClass === "CURATED_EVIDENCE").slice(0, 2);
  const reference = items.filter((i) => i.source.sourceClass === "CURATED_REFERENCE").slice(0, 1);
  const synthetic = items.filter((i) => i.source.sourceClass === "SYNTHETIC_KNOWLEDGE").slice(0, 1);
  const lines: string[] = [];
  if (evidence.length) {
    lines.push("Theo các nguồn khoa học đã truy xuất:");
    for (const i of evidence) lines.push(`- ${citeOf(i)}: ${clip(i.claimSupportText, 260)}`);
  }
  if (conflict) {
    lines.push(`Lưu ý: các nguồn nêu số liệu khác nhau (${conflict.sources.map((s) => `${s.title ?? "nguồn"}: ${s.range[0]}–${s.range[1]} ${conflict.unit}`).join("; ")}). Mình không chọn một con số; mức phù hợp còn tùy bối cảnh (mục tiêu, giai đoạn, đối tượng).`);
  }
  if (reference.length) lines.push(`Tài liệu tham khảo chuyên môn (không phải kết quả nghiên cứu): ${clip(reference[0].claimSupportText, 200)}`);
  if (coverage === "SYNTHETIC_ONLY" || (!evidence.length && synthetic.length)) {
    lines.push(`Trong kho kiến thức nội bộ của Gymini (không phải nghiên cứu khoa học): ${clip((synthetic[0] ?? items[0]).claimSupportText, 220)}`);
  }
  if (coverage === "CURATED_PARTIAL") lines.push("Bằng chứng truy xuất được còn hạn chế (một phần), nên phần diễn giải khoa học chỉ ở mức thận trọng.");
  return lines.join("\n");
}

const TOPIC_NOTE: Record<InterpretationTopic, (r: ProgressReviewV0) => string | null> = {
  PROTEIN: (r) => {
    const p = r.evidence.find((e) => e.kind === "AVERAGE_LOGGED_PROTEIN");
    if (!p || p.value.averageDeltaG == null) return null;
    const d = p.value.averageDeltaG as number;
    return `Về protein: trong các ngày có dữ liệu, mức ghi nhận ${d < 0 ? "thấp hơn" : d > 0 ? "cao hơn" : "bằng"} mục tiêu hiện tại ${d === 0 ? "" : `khoảng ${fmt(Math.abs(d))} g`}. Mình chỉ mô tả chênh lệch này, không đánh giá mục tiêu có tối ưu hay không.`.replace("  ", " ");
  },
  CALORIES: (r) => {
    const c = r.evidence.find((e) => e.kind === "AVERAGE_LOGGED_CALORIES");
    if (!c || c.value.averageDeltaKcal == null) return null;
    return `Về calo: mức ghi nhận trung bình lệch ${fmt(c.value.averageDeltaKcal as number)} kcal so với mục tiêu hiện tại trong các ngày có dữ liệu; đây là mô tả, không phải đánh giá đúng/sai.`;
  },
  BODY_FAT: (r) => (r.evidence.some((e) => e.kind === "BODY_FAT_TREND")
    ? "Về tỷ lệ mỡ: đã có xu hướng đo được; kết quả đo bằng BIA có thể dao động theo điều kiện đo."
    : "Về tỷ lệ mỡ: hiện chưa có xu hướng tỷ lệ mỡ đủ tin cậy, nên mình không kết luận về việc giảm mỡ dù cân nặng có thay đổi."),
  WEIGHT: (r) => (r.evidence.some((e) => e.kind === "BODY_FAT_TREND")
    ? null
    : "Cân nặng chỉ phản ánh tổng khối lượng cơ thể; không có xu hướng tỷ lệ mỡ thì chưa thể nói thay đổi đó là mỡ hay cơ."),
  RPE_RIR: (r) => (r.domains.TRAINING.state === "OK" ? "Về cường độ: mức RPE/RIR chỉ phản ánh các set có nhập; thiếu dữ liệu không được hiểu là bằng 0." : null),
  VOLUME: () => "Về volume: đây là tổng khối lượng tạ × số lần của các set hoàn thành; mình mô tả con số, không xếp mức này là nhiều hay ít.",
  CONSISTENCY: (r) => (r.evidence.some((e) => e.kind === "SCHEDULED_ADHERENCE")
    ? "Về độ đều: các buổi hoàn thành cho phép quan sát xu hướng tập luyện theo thời gian; hai quan sát này cùng xuất hiện chứ không chứng minh cái này gây ra cái kia."
    : null),
};
export const CAUSAL_BOUNDARY = "Đây là các quan sát cùng xuất hiện; dữ liệu hiện tại không chứng minh quan hệ nhân quả, và mình không thay đổi mục tiêu hay kế hoạch của bạn.";

function personalFactLines(r: ProgressReviewV0, domains: PersonalDomain[], days: number): string[] {
  const out: string[] = [];
  if (domains.includes("BODY")) out.push(...bodyLines(r));
  if (domains.includes("TRAINING")) out.push(...trainingLines(r, days));
  if (domains.includes("NUTRITION")) out.push(...nutritionLines(r, days));
  return out;
}

export function renderDeterministicInterpretation(ctx: PersonalizedInterpretationContext, review: ProgressReviewV0, domains: PersonalDomain[], narrated: string | null): string {
  const facts = personalFactLines(review, domains, 28);
  const notes = ctx.questionTopics.map((t) => TOPIC_NOTE[t](review)).filter((x): x is string => !!x);
  const parts: string[] = [];
  parts.push(`Dữ liệu của bạn: ${facts.join(" ")}`);
  parts.push(renderKnowledgeBlock(ctx));
  parts.push(narrated ? narrated.trim() : notes.join(" "));
  parts.push([...limitationLines(review).filter((l) => !/hạn chót/.test(l)), CAUSAL_BOUNDARY].join(" "));
  return parts.filter((p) => p && p.trim().length > 0).join("\n\n");
}

// ── narration (one bounded call) + validation ────────────────────────────

const NarrationSchema = z.object({ interpretation: z.string().min(10).max(700) });
const OPTIMALITY = /(toi uu|ly tuong|hoan hao|xuat sac|chuan nhat|du roi|khong can lo|hoan toan on)/;
const AUTHORITY_CUE = /(nghien cuu (cho thay|chi ra|khuyen)|bang chung khoa hoc|khuyen nghi (cua|tu)|theo (nghien cuu|huong dan|khuyen nghi)|research (shows|says)|guideline)/;
const ORG = /\b(ACSM|ISSN|WHO|IOC|ESPEN|HHS|NSCA|NATA|IOM|AHA|CDC|NIH|Cochrane|PubMed|USDA|AND)\b/g;

function numbersIn(s: string): number[] {
  return (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")));
}
function collect(o: unknown, out: Set<number>): void {
  if (typeof o === "number" && Number.isFinite(o)) { out.add(o); out.add(Math.abs(o)); out.add(Math.round(o)); out.add(Math.round(Math.abs(o))); out.add(Math.round(o * 10) / 10); }
  else if (typeof o === "string") numbersIn(o).forEach((n) => out.add(n));
  else if (Array.isArray(o)) o.forEach((x) => collect(x, out));
  else if (o && typeof o === "object") Object.values(o as Record<string, unknown>).forEach((x) => collect(x, out));
}

export function validateInterpretationNarration(text: string, ctx: PersonalizedInterpretationContext, review: ProgressReviewV0): { ok: boolean; reason?: string } {
  const norm = normalizeAgentText(text);
  if (/\[\d+\]/.test(text)) return { ok: false, reason: "numbered_citation" };
  if (/(plateau|chung lai)/.test(norm)) return { ok: false, reason: "plateau_claim" };
  if (/(giac ngu|\bngu\b|hrv|nhip tim|phuc hoi|stress|cang thang)/.test(norm)) return { ok: false, reason: "unsupported_domain" };
  if (/(skeletal|\bsmm\b|khoi luong co|co xuong|co bap|lean mass|nac)/.test(norm)) return { ok: false, reason: "muscle_mass_claim" };
  if (CAUSAL_RAW.test(text.toLowerCase())) return { ok: false, reason: "causal_claim" };
  if (PRESCRIPTIVE.test(norm)) return { ok: false, reason: "prescriptive_claim" };
  if (OPTIMALITY.test(norm)) return { ok: false, reason: "optimality_claim" };
  for (const sentence of norm.split(/[.!?\n]+/)) if (ON_TRACK_CLAIM.test(sentence) && !NEG.test(sentence)) return { ok: false, reason: "on_track_claim" };
  const cov = ctx.knowledge.coverage;
  if (AUTHORITY_CUE.test(norm) && !(cov === "CURATED_SUFFICIENT" || cov === "CURATED_PARTIAL" || cov === "CONFLICTING_EVIDENCE")) return { ok: false, reason: "scientific_authority_without_curated_support" };
  const sourceText = ctx.knowledge.items.map((i) => `${i.source.title ?? ""} ${i.source.publisher ?? ""} ${i.source.url ?? ""} ${i.source.sourceId ?? ""}`).join(" ").toUpperCase();
  for (const m of text.matchAll(ORG)) if (!sourceText.includes(m[1].toUpperCase())) return { ok: false, reason: "source_not_retrieved" };
  const allowed = new Set<number>();
  collect(evidenceSnapshot(review), allowed);
  collect(review.limitations, allowed);
  collect(ctx.knowledge.items.map((i) => i.claimSupportText), allowed);
  collect(ctx.knowledge.items.map((i) => i.source.year), allowed);
  collect(ctx.knowledge.conflict, allowed);
  for (const n of numbersIn(norm)) if (!allowed.has(n) && !allowed.has(Math.round(n))) return { ok: false, reason: "number_not_in_evidence" };
  return { ok: true };
}

export function buildInterpretationPrompt(ctx: PersonalizedInterpretationContext, review: ProgressReviewV0): string {
  return [
      "Bạn là huấn luyện viên. Viết 2–3 câu tiếng Việt DIỄN GIẢI ý nghĩa của dữ liệu cá nhân dưới đây, dựa trên các đoạn kiến thức đi kèm.",
      "Chỉ dùng số trong JSON. Chỉ nhắc tên tổ chức/nguồn nếu nó có trong 'kienThuc'. Không đánh số trích dẫn.",
      "Không nêu nguyên nhân (không dùng 'vì', 'nhờ', 'khiến'); không khuyên đổi calo/protein/lịch/volume; không nói 'tối ưu'; không nói về cơ bắp/giấc ngủ/plateau.",
      "Nếu phần kiến thức là 'noi_bo' (không phải nghiên cứu) thì không được viết như thể có nghiên cứu khẳng định.",
      'Trả về JSON: {"interpretation":"..."}',
      JSON.stringify({
        duLieuCaNhan: evidenceSnapshot(review),
        phamViKienThuc: ctx.knowledge.coverage,
        kienThuc: ctx.knowledge.items.slice(0, 3).map((i) => ({
          loai: i.source.sourceClass === "CURATED_EVIDENCE" ? "nghien_cuu" : i.source.sourceClass === "CURATED_REFERENCE" ? "tham_khao_chuyen_mon" : "noi_bo",
          nguon: [i.source.title, i.source.publisher, i.source.year].filter(Boolean).join(" — "),
          noiDung: clip(i.claimSupportText, 300),
        })),
        xungDot: ctx.knowledge.conflict,
      }),
  ].join("\n");
}

export const interpretationDeps = {
  narrate: async (ctx: PersonalizedInterpretationContext, review: ProgressReviewV0, userId: string): Promise<string | null> => {
    const prompt = buildInterpretationPrompt(ctx, review);
    const out = await callLlmJson(prompt, NarrationSchema, {
      userId, phase: "personalized-interpretation", numPredict: 260, attempts: NARRATION_BUDGET.attempts,
      timeoutMs: NARRATION_BUDGET.timeoutMs, purpose: "GENERAL_QA", redactErrorDetail: true, logPrefix: "[personal-interpretation]",
    });
    return out?.interpretation ?? null;
  },
};

// ── entry point used by readState("PERSONAL_INTERPRETATION") ─────────────

export interface InterpretationAnswer { text: string; source: string; facts: Record<string, unknown> }

export async function answerPersonalizedInterpretation(identity: AgentIdentity, question: string): Promise<InterpretationAnswer> {
  const cls = classifyInterpretationQuestion(question) ?? { topics: ["CONSISTENCY"] as InterpretationTopic[], domains: ["TRAINING"] as PersonalDomain[] };

  // personal facts (only the slices these topics need) and knowledge (one RAG V2 retrieval) are independent reads
  const kq = [...new Set(cls.topics.slice(0, 2).map((t) => TOPICS[t].knowledgeQuery))].join(" ");
  const tFact = Date.now();
  const [reads, retrieval] = await Promise.all([
    readCoachStateSlices(identity, {
      includeTraining: cls.domains.includes("TRAINING"), includeNutrition: cls.domains.includes("NUTRITION"), includeBodyGoal: cls.domains.includes("BODY"),
    }),
    retriever.retrieveForChat(kq).catch((): RetrievalResult => ({ documents: [], isEmpty: true, reason: "RETRIEVAL_ERROR" })),
  ]);
  const factMs = Date.now() - tFact;
  const review = buildProgressReviewV0({ asOf: new Date(), training: toSlice(reads.training), nutrition: toSlice(reads.nutrition), bodyGoal: toSlice(reads.bodyGoal) });

  const items = buildKnowledgeContext(retrieval.documents as never);
  const conflictRaw = (retrieval.documents.find((d) => (d.metadata as Record<string, unknown>).conflictNote)?.metadata as Record<string, unknown> | undefined)?.conflictNote as
    | { unit: string; sources: Array<{ title: string | null; range: [number, number] }> } | undefined;
  const ctx: PersonalizedInterpretationContext = {
    questionTopics: cls.topics, personalEvidence: review.evidence, limitations: review.limitations, domains: review.domains,
    knowledge: { items, coverage: knowledgeCoverage(retrieval, items), conflict: conflictRaw ?? null },
  };

  const needed = cls.domains.map((d): Domain => (d === "BODY" ? "BODY" : d));
  const anyPersonal = needed.some((d) => review.domains[d].state === "OK" && ["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY"].includes(String(review.domains[d].quality)));
  let narrated: string | null = null;
  let llmCalls = 0;
  let fallbackUsed = false;
  const canNarrate = unifiedCoachMode() === "on" && anyPersonal && ctx.knowledge.coverage !== "NO_RELEVANT_KNOWLEDGE";
  const tGen = Date.now();
  if (canNarrate) {
    llmCalls = 1;
    const raw = await interpretationDeps.narrate(ctx, review, identity.userId).catch(() => null);
    if (raw && validateInterpretationNarration(raw, ctx, review).ok) narrated = raw;
    else fallbackUsed = true;
  }
  const genMs = Date.now() - tGen;

  const unavailable = needed.map((d) => (review.domains[d].state === "ERROR" || review.domains[d].state === "ABSENT"
    ? domainUnavailableLine(review, d, d === "BODY" ? "Cân nặng/đo lường" : d === "TRAINING" ? "Tập luyện" : "Ăn uống") : null)).filter(Boolean);
  const nothing = !anyPersonal;
  const text = nothing
    ? `${unavailable.length ? unavailable.join(" ") : "Mình chưa có đủ dữ liệu cá nhân phù hợp để diễn giải điều này."}\n\n${renderKnowledgeBlock(ctx)}`
    : renderDeterministicInterpretation(ctx, review, cls.domains, narrated);

  logger.info({
    event: "personalized_interpretation_answer", questionTopics: cls.topics, personalDomainsUsed: cls.domains,
    knowledgeCoverageState: ctx.knowledge.coverage,
    curatedSourceCount: items.filter((i) => i.source.sourceClass === "CURATED_EVIDENCE" || i.source.sourceClass === "CURATED_REFERENCE").length,
    syntheticSourceCount: items.filter((i) => i.source.synthetic).length, conflictCount: ctx.knowledge.conflict ? 1 : 0,
    usedNarration: narrated != null, fallbackUsed, llmCalls, retrievalAndFactsLatencyMs: factMs, generationLatencyMs: genMs,
    domainStates: Object.fromEntries(needed.map((d) => [d, review.domains[d].state])),
  }, "personalized_interpretation_answer");

  return {
    text, source: "coach-state-slices+rag-v2",
    facts: {
      answerClass: "PERSONALIZED_INTERPRETATION", llmCalls, usedNarration: narrated != null, fallbackUsed,
      knowledgeCoverage: ctx.knowledge.coverage, conflict: ctx.knowledge.conflict != null,
      sources: items.map((i) => ({ sourceClass: i.source.sourceClass, sourceId: i.source.sourceId, title: i.source.title, publisher: i.source.publisher, year: i.source.year, url: i.source.url, synthetic: i.source.synthetic })),
      domains: review.domains,
    },
  };
}
