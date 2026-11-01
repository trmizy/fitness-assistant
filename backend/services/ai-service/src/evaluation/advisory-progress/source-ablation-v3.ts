/** Offline preparation only. Never calls a model or alters a scientific quote. */
import { z } from "zod";
import { EvidencePackSchema, type AdvisoryInput } from "./experiment";
import { assertReferenceIdentity } from "./guarded";

const CaseId = z.enum(["full-excerpt-support", "remove-hypertrophy-result", "remove-context-excerpt", "unrelated-excerpt", "no-source", "mixed-supported-and-unsupported-claim"]);
export const AblationProtocolSchema = z.object({
  version: z.literal("source-ablation-review-protocol-v1"), status: z.literal("DESIGN_ONLY_NOT_RUN"), modelCalls: z.literal(0), scope: z.string(),
  principles: z.array(z.string()).min(1),
  cases: z.array(z.object({ id: CaseId, change: z.string(), reviewCriterion: z.string() }).strict()).length(6),
  controlledMultiDocumentReasoning: z.object({
    status: z.literal("DESIGN_ONLY_NOT_RUN"), sourceClass: z.literal("SYNTHETIC_TEST_RULES_NOT_FITNESS_GUIDANCE"), question: z.string(),
    personalFact: z.object({ initialValue: z.number().finite() }).strict(),
    documents: z.array(z.object({ id: z.enum(["SYNTH_RULE", "SYNTH_EVENTS"]), content: z.string().min(1) }).strict()).length(2),
    expectedFull: z.number().finite(), ablation: z.string(),
    counterfactual: z.object({ change: z.string(), expected: z.number().finite() }).strict(), contradiction: z.string(), limitation: z.string(),
  }).strict(),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.cases.map((c) => c.id)).size !== 6) ctx.addIssue({ code: "custom", path: ["cases"], message: "duplicate_or_missing_ablation_case" });
  if (new Set(p.controlledMultiDocumentReasoning.documents.map((d) => d.id)).size !== 2) ctx.addIssue({ code: "custom", path: ["controlledMultiDocumentReasoning", "documents"], message: "duplicate_document" });
});
const MapSchema = z.object({
  version: z.literal("advisory-evidence-claim-map-v2"), scope: z.string(), authority: z.string(), humanExpertReviewed: z.literal(false), checkedAt: z.string(), basePack: z.literal("evidence-pack.json"),
  sources: z.array(z.object({
    sourceId: z.string(), url: z.string().url(),
    excerpts: z.array(z.object({ id: z.string(), text: z.string().min(1).optional(), basePackPointer: z.string().optional(), locator: z.string().min(1) }).strict()),
    claims: z.array(z.object({ id: z.string(), kind: z.literal("SOURCE_FINDING"), supportExcerptIds: z.array(z.string()).min(1), textVi: z.string() }).strict()),
    doesNotSupport: z.array(z.string()), currency: z.record(z.union([z.string(), z.number()])).optional(),
  }).strict()),
  applicationInferences: z.array(z.object({ id: z.string(), kind: z.literal("APPLICATION_INFERENCE_NOT_AUTHOR_QUOTE"), basedOnClaimIds: z.array(z.string()).min(1), requiresPersonalFacts: z.string(), textVi: z.string() }).strict()),
  limitations: z.array(z.string()),
}).strict();
export const ExcerptSourceSchema = z.object({
  id: z.string().min(1), sourceClass: z.enum(["CURATED_EVIDENCE", "SYNTHETIC_TEST_EXCERPT"]),
  title: z.string(), doi: z.string().nullable(), url: z.string().url().nullable(),
  excerpts: z.array(z.object({ id: z.string().min(1), text: z.string().min(1), locator: z.string() }).strict()).min(1),
  findings: z.array(z.object({ id: z.string().min(1), excerptIds: z.array(z.string()).min(1), text: z.string() }).strict()),
}).strict().superRefine((s, ctx) => {
  const ids = s.excerpts.map((e) => e.id);
  if (new Set(ids).size !== ids.length || new Set(s.findings.map((f) => f.id)).size !== s.findings.length) ctx.addIssue({ code: "custom", message: "duplicate_excerpt_or_finding" });
  if (s.findings.some((f) => f.excerptIds.some((id) => !ids.includes(id)))) ctx.addIssue({ code: "custom", message: "finding_requires_present_excerpt" });
  if (s.sourceClass === "SYNTHETIC_TEST_EXCERPT" && (s.doi !== null || s.url !== null || !s.id.startsWith("SYNTH_"))) ctx.addIssue({ code: "custom", message: "synthetic_source_cannot_impersonate_science" });
});
export type ExcerptSource = z.infer<typeof ExcerptSourceSchema>;
export const AblationModelSourceSchema = z.object({
  id: z.string().regex(/^S\d+$/), sourceClass: z.enum(["CURATED_EVIDENCE", "SYNTHETIC_TEST_EXCERPT"]),
  excerpts: z.array(z.object({ id: z.string().regex(/^S\d+_E\d+$/), text: z.string().min(1) }).strict()).min(1),
  findings: z.array(z.object({ id: z.string().regex(/^S\d+_C\d+$/), excerptIds: z.array(z.string()).min(1), text: z.string() }).strict()),
}).strict().superRefine((s, ctx) => {
  if (s.findings.some((f) => f.excerptIds.some((id) => !s.excerpts.some((e) => e.id === id)))) ctx.addIssue({ code: "custom", message: "dangling_model_finding" });
});

export function resolveExcerptSources(packValue: unknown, mapValue: unknown): ExcerptSource[] {
  const pack = EvidencePackSchema.parse(packValue), map = MapSchema.parse(mapValue);
  const ids = new Set<string>();
  const reserve = (id: string) => { if (ids.has(id)) throw new Error("DuplicateExcerptMapIdentity"); ids.add(id); };
  const resolved = map.sources.map((s) => {
    reserve(s.sourceId);
    const source = pack.sources.find((p) => p.id === s.sourceId);
    if (!source || source.url !== s.url) throw new Error("UnknownOrMismatchedMapSource");
    const excerpts = s.excerpts.map((e) => {
      reserve(e.id);
      if (!!e.text === !!e.basePackPointer) throw new Error("ExactlyOneExcerptRepresentationRequired");
      let text = e.text;
      if (e.basePackPointer) {
        const m = /^\/sources\/(\d+)\/originalExcerpt$/.exec(e.basePackPointer);
        if (!m || pack.sources[Number(m[1])]?.id !== s.sourceId) throw new Error("InvalidExcerptPointer");
        text = pack.sources[Number(m[1])].originalExcerpt;
      }
      return { id: e.id, text: text!, locator: e.locator };
    });
    return ExcerptSourceSchema.parse({ id: s.sourceId, sourceClass: "CURATED_EVIDENCE", title: source.title, doi: source.doi, url: source.url, excerpts,
      findings: s.claims.map((c) => { reserve(c.id); return { id: c.id, excerptIds: c.supportExcerptIds, text: c.textVi }; }) });
  });
  const findingIds = new Set(map.sources.flatMap((s) => s.claims.map((c) => c.id)));
  for (const inference of map.applicationInferences) {
    reserve(inference.id);
    if (inference.basedOnClaimIds.some((id) => !findingIds.has(id))) throw new Error("InvalidApplicationInferenceDependency");
  }
  return resolved;
}

/** Whitelist output fields. Frozen summaries, applicability and application
 * inferences are intentionally absent, so removed excerpts cannot leak back. */
export function prepareSourceAblations(protocolValue: unknown, input: AdvisoryInput, pack: unknown, map: unknown) {
  assertReferenceIdentity(input);
  const protocol = AblationProtocolSchema.parse(protocolValue);
  const full = resolveExcerptSources(pack, map);
  const sourceIds = new Set(input.sources.map((s) => s.id));
  if (full.some((s) => !sourceIds.has(s.id)) || sourceIds.size !== full.length) throw new Error("AblationRequiresMatchingFullSourceInput");
  const allExcerpts = new Set(full.flatMap((s) => s.excerpts.map((e) => e.id)));
  for (const id of ["LOAD_HYPERTROPHY_RESULT", "ACSM_CONTEXT"]) if (!allExcerpts.has(id)) throw new Error("RequiredAblationTargetAbsent");
  return protocol.cases.map((c) => {
    let sources: ExcerptSource[] = JSON.parse(JSON.stringify(full));
    const removed = c.id === "remove-hypertrophy-result" ? "LOAD_HYPERTROPHY_RESULT" : c.id === "remove-context-excerpt" ? "ACSM_CONTEXT" : null;
    if (removed) sources = sources.map((s) => ({ ...s, excerpts: s.excerpts.filter((e) => e.id !== removed), findings: s.findings.filter((f) => !f.excerptIds.includes(removed)) })).filter((s) => s.excerpts.length);
    if (c.id === "no-source") sources = [];
    if (c.id === "unrelated-excerpt") sources = [{ id: "SYNTH_UNRELATED", sourceClass: "SYNTHETIC_TEST_EXCERPT", title: "Fictional unrelated test excerpt", doi: null, url: null,
      excerpts: [{ id: "SYNTH_MUSEUM", text: "This fictional museum opens on Thursdays.", locator: "Assistant-authored fixture, not science" }], findings: [] }];
    sources.forEach((s) => ExcerptSourceSchema.parse(s));
    // All bibliographic/semantic metadata stays outside the model payload,
    // including titles, locators, URLs, DOIs and suggestive original IDs.
    // Stable opaque aliases preserve identity across paired ablations.
    const modelSources = sources.map((s) => {
      const original = full.find((f) => f.id === s.id) ?? s;
      const alias = `S${full.findIndex((f) => f.id === s.id) < 0 ? full.length + 1 : full.findIndex((f) => f.id === s.id) + 1}`;
      const excerptId = (id: string) => `${alias}_E${original.excerpts.findIndex((e) => e.id === id) + 1}`;
      return AblationModelSourceSchema.parse({ id: alias, sourceClass: s.sourceClass,
        excerpts: s.excerpts.map((e) => ({ id: excerptId(e.id), text: e.text })),
        findings: s.findings.map((f) => ({ id: `${alias}_C${original.findings.findIndex((c) => c.id === f.id) + 1}`, excerptIds: f.excerptIds.map(excerptId), text: f.text })) });
    });
    return { id: c.id, status: "PREPARED_NOT_INFERRED" as const, modelCalls: 0,
      input: { question: c.id === "mixed-supported-and-unsupported-claim" ? "Dữ liệu cho thấy sức mạnh thay đổi thế nào, kích thước cơ đã thay đổi chưa, và có đủ căn cứ để kết luận phải đổi lịch không?" : input.question,
        facts: JSON.parse(JSON.stringify(input.facts)) as AdvisoryInput["facts"], sources: modelSources },
      // Evaluation metadata is separate from model input.
      evaluationOnly: { criterion: c.reviewCriterion, provenance: sources },
    };
  });
}

/** Known protocol version, not natural-language execution of arbitrary changes.
 * Counterfactual is synthetic and never attached to a real DOI. Gold stays out. */
export function prepareSyntheticDependencies(protocolValue: unknown) {
  const p = AblationProtocolSchema.parse(protocolValue).controlledMultiDocumentReasoning;
  const change = /^SYNTH_RULE adds (\d+(?:\.\d+)?) units instead$/.exec(p.counterfactual.change);
  if (!change || !Number.isFinite(Number(change[1]))) throw new Error("UnsupportedSyntheticCounterfactualGrammar");
  const alteredRule = `For each qualifying event, add ${change[1]} units to the current value.`;
  const base = () => ({ question: p.question, personalFact: { ...p.personalFact }, sourceClass: p.sourceClass, documents: p.documents.map((d) => ({ ...d })) });
  const definitions = ["full", "without-rule", "without-events", "counterfactual", "contradiction"] as const;
  return definitions.map((id) => {
    const input = base();
    if (id === "without-rule") input.documents = input.documents.filter((d) => d.id !== "SYNTH_RULE");
    if (id === "without-events") input.documents = input.documents.filter((d) => d.id !== "SYNTH_EVENTS");
    if (id === "counterfactual") input.documents = input.documents.map((d) => d.id === "SYNTH_RULE" ? { ...d, content: alteredRule } : d);
    // Separate conflicting rule, no precedence. Distinct identity is intentional.
    const documents: Array<{ id: string; content: string }> = [...input.documents];
    if (id === "contradiction") documents.push({ id: "SYNTH_CONFLICTING_RULE", content: `${alteredRule} No rule has precedence.` });
    return { id, status: "PREPARED_NOT_INFERRED" as const, modelCalls: 0, input: { ...input, documents } };
  });
}
