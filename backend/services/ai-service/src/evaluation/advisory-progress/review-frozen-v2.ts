/** Offline review binding: no LLM imports/calls and no edits to frozen answers. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AnswerSchema, type AdvisoryInput } from "./experiment";
import { answerTextUnits, screenReadonlyAdvice } from "./content-review";

const ReviewItem = z.object({
  judgment: z.string(), supportIds: z.array(z.string()), note: z.string().optional(),
  suggestedText: z.string().optional(), kinds: z.array(z.string()).optional(),
}).strict();
const AnnotationSchema = z.object({
  version: z.string(), sourceResultsSha256: z.string(), reviewedAt: z.string(), reviewer: z.literal("assistant"), authority: z.string(),
  independentHumanExpertReview: z.literal(false), scope: z.string(), observationReviewRule: z.string(),
  judgmentDefinitions: z.record(z.string()),
  entries: z.array(z.object({
    id: z.string(), variant: z.enum(["A", "B", "C", "D"]), observations: z.literal("SUPPORTED_FACTS"),
    hypotheses: z.array(ReviewItem), missing: z.array(z.string()), rationale: ReviewItem,
  }).strict()),
}).strict();
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function main() {
  const args = process.argv.slice(2);
  if (args.length) throw new Error("This frozen V2 review accepts no runtime/provider arguments");
  const root = [process.cwd(), path.resolve(process.cwd(), "../../..")].find((candidate) => fs.existsSync(path.join(candidate, "data/eval/advisory-progress-dev/evidence-claim-map-v2.json")));
  if (!root) throw new Error("RepositoryDataNotFound");
  const dataDir = path.join(root, "data/eval/advisory-progress-dev");
  const runDir = path.join(root, "artifacts/ai-advisory-progress/bedrock-guarded-v2");
  const annotationsBytes = fs.readFileSync(path.join(dataDir, "reviews/guarded-v2-annotations.json"));
  const annotations = AnnotationSchema.parse(JSON.parse(annotationsBytes.toString("utf8")));
  const packBytes = fs.readFileSync(path.join(dataDir, "evidence-pack.json"));
  const pack = JSON.parse(packBytes.toString("utf8")) as { sources: Array<{ id: string; originalExcerpt: string }> };
  const mapBytes = fs.readFileSync(path.join(dataDir, "evidence-claim-map-v2.json"));
  const claimMap = JSON.parse(mapBytes.toString("utf8")) as {
    sources: Array<{ sourceId: string; excerpts: Array<{ id: string; text?: string; basePackPointer?: string }>; claims: Array<{ id: string; supportExcerptIds: string[] }> }>;
    applicationInferences: Array<{ id: string; basedOnClaimIds: string[] }>;
  };
  const mapIds = new Set<string>();
  const supportSources = new Map<string, string[]>();
  const sourceIds = new Set(pack.sources.map((source) => source.id));
  for (const source of claimMap.sources) {
    if (!sourceIds.has(source.sourceId)) throw new Error("UnknownClaimMapSource");
    const excerptIds = new Set<string>();
    for (const excerpt of source.excerpts) {
      if (excerptIds.has(excerpt.id)) throw new Error("DuplicateExcerptId");
      excerptIds.add(excerpt.id);
      if (excerpt.basePackPointer) {
        const match = /^\/sources\/(\d+)\/originalExcerpt$/.exec(excerpt.basePackPointer);
        if (!match || pack.sources[Number(match[1])]?.id !== source.sourceId || !pack.sources[Number(match[1])]?.originalExcerpt) throw new Error("InvalidExcerptPointer");
      } else if (!excerpt.text) throw new Error("MissingExcerpt");
    }
    for (const claim of source.claims) {
      if (mapIds.has(claim.id) || !claim.supportExcerptIds.length || claim.supportExcerptIds.some((id) => !excerptIds.has(id))) throw new Error("InvalidClaimSupportMap");
      mapIds.add(claim.id);
      supportSources.set(claim.id, [source.sourceId]);
    }
  }
  for (const inference of claimMap.applicationInferences) {
    if (mapIds.has(inference.id) || inference.basedOnClaimIds.some((id) => !mapIds.has(id))) throw new Error("InvalidApplicationInferenceMap");
    mapIds.add(inference.id);
    supportSources.set(inference.id, [...new Set(inference.basedOnClaimIds.flatMap((id) => supportSources.get(id) ?? []))]);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
  if (manifest.corpusSha256 !== hash(packBytes)) throw new Error("FrozenCorpusMismatch");
  const requests = JSON.parse(fs.readFileSync(path.join(runDir, "requests.json"), "utf8")) as Array<{ id: string; variant: string; prompt: { user: string } }>;
  if (manifest.requestsSha256 !== hash(JSON.stringify(requests))) throw new Error("FrozenRequestMismatch");
  const inputs = new Map<string, AdvisoryInput>(requests.map((request) => {
    const match = /^<advisory_input trust="untrusted-data">\n([\s\S]*)\n<\/advisory_input>$/.exec(request.prompt.user);
    if (!match) throw new Error("UnexpectedFrozenInputFormat");
    return [`${request.id}:${request.variant}`, JSON.parse(match[1]) as AdvisoryInput] as const;
  }));
  const bytes = fs.readFileSync(path.join(runDir, "results.jsonl"));
  if (annotations.sourceResultsSha256 !== hash(bytes)) throw new Error("ReviewAnnotationsTargetDifferentResults");
  const rows = bytes.toString("utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as { id: string; variant: string; finalCandidate: unknown; contractPass: boolean });
  const annotationsByKey = new Map(annotations.entries.map((entry) => [`${entry.id}:${entry.variant}`, entry]));
  if (rows.length !== 24 || annotationsByKey.size !== 24 || annotations.entries.length !== 24 || inputs.size !== 24) throw new Error("IncompleteOrDuplicateReview");
  const seen = new Set<string>();
  const reviewed = rows.map((row) => {
    const key = `${row.id}:${row.variant}`;
    if (seen.has(key)) throw new Error("DuplicateFrozenResult");
    seen.add(key);
    const annotation = annotationsByKey.get(key), input = inputs.get(key);
    if (!annotation || !input) throw new Error("UnmatchedReview");
    const answer = AnswerSchema.parse(row.finalCandidate);
    if (answer.hypotheses.length !== annotation.hypotheses.length || answer.missingInformation.length !== annotation.missing.length) throw new Error("AnnotationFieldCoverageMismatch");
    const factIds = new Set(input.facts.map((fact) => fact.id));
    const inputSourceIds = new Set(input.sources.map((source) => source.id));
    const validSupport = (id: string) => id.startsWith("FACT:") ? factIds.has(id.slice(5)) : id.startsWith("INPUT_ABSENCE:") ? ["muscle_size_measurement", "other_outcome_measurements", "program_load_history"].includes(id.slice(14)) : mapIds.has(id) && (supportSources.get(id) ?? []).every((sourceId) => inputSourceIds.has(sourceId));
    const claims = answerTextUnits(answer).map((unit) => {
      let judgment: string, kinds: string[], supportIds: string[], note: string | undefined, suggestedText: string | undefined;
      if (unit.path.startsWith("observations.")) {
        const index = Number(unit.path.split(".")[1]);
        const refs = answer.observations[index].factIds;
        if (refs.some((id) => !factIds.has(id))) throw new Error("ObservationReferenceMismatch");
        judgment = annotation.observations; kinds = ["OBSERVATION"]; supportIds = refs.map((id) => `FACT:${id}`);
      } else if (unit.path.startsWith("hypotheses.")) {
        const item = annotation.hypotheses[Number(unit.path.split(".")[1])];
        judgment = item.judgment; kinds = item.kinds ?? []; supportIds = item.supportIds; note = item.note;
      } else if (unit.path.startsWith("missingInformation.")) {
        judgment = annotation.missing[Number(unit.path.split(".")[1])]; kinds = ["REQUEST_INFORMATION"]; supportIds = [];
      } else {
        const item = annotation.rationale;
        judgment = item.judgment; kinds = ["RATIONALE", ...(judgment === "UNSUPPORTED_ADVICE" ? ["PERSONAL_RECOMMENDATION"] : [])]; supportIds = item.supportIds; note = item.note; suggestedText = item.suggestedText;
      }
      if (!Object.prototype.hasOwnProperty.call(annotations.judgmentDefinitions, judgment) || supportIds.some((id) => !validSupport(id))) throw new Error("InvalidAnnotationJudgmentOrSupport");
      return { ...unit, textSha256: hash(unit.text), judgment, kinds, supportIds, note, suggestedText };
    });
    return { id: row.id, variant: row.variant, originalContractPass: row.contractPass,
      sourceCandidateSha256: hash(JSON.stringify(row.finalCandidate)), claims, adviceScreen: screenReadonlyAdvice(answer),
      missingKeyCorrections: answer.missingInformation.flatMap((item, index) => annotation.missing[index] === "KEY_MISMATCH" ? [{ path: `missingInformation.${index}.key`, current: item.key, suggested: "outcome_measurement", reviewOnly: true }] : []) };
  });
  const counts: Record<string, number> = {};
  for (const row of reviewed) for (const claim of row.claims) counts[claim.judgment] = (counts[claim.judgment] ?? 0) + 1;
  const report = {
    version: "frozen-v2-content-review-v1", reviewedAt: annotations.reviewedAt, modelCalls: 0,
    authority: annotations.authority, independentHumanExpertReview: false,
    status: "CONTENT_REVISION_REQUIRED_NOT_ROLLOUT_READY",
    granularity: "Each output text unit reviewed; mixed-block issues described in notes, not a fully atomized independent entailment gold set.",
    sourceResultsSha256: hash(bytes), sourcePackSha256: hash(packBytes), claimMapSha256: hash(mapBytes), annotationsSha256: hash(annotationsBytes),
    reviewCodeHashes: Object.fromEntries(["content-review.ts", "review-frozen-v2.ts"].map((file) => [file, hash(fs.readFileSync(path.join(__dirname, file)))])),
    userSuppliedReviewSha256: hash(fs.readFileSync(path.join(dataDir, "reviews/user-review-2026-10-27.txt"))),
    summary: { answersReviewed: reviewed.length, textUnitsReviewed: reviewed.reduce((sum, row) => sum + row.claims.length, 0), judgments: counts,
      adviceScreenFlaggedAnswers: reviewed.filter((row) => row.adviceScreen.signals.length).length,
      rowsWithUnsupportedPersonalApplication: reviewed.filter((row) => row.claims.some((claim) => claim.judgment === "UNSUPPORTED_PERSONAL_APPLICATION")).length,
      rowsWithMisclassifiedSupportedStatements: reviewed.filter((row) => row.claims.some((claim) => claim.judgment === "SUPPORTED_RECLASSIFY")).length },
    limitations: ["Assistant annotations informed by user-supplied review, not independent human/expert labels.", "Advice screen is narrow and can miss paraphrases; no rule match is not content approval.", "No new generation, source ingestion, production validation changes or scientific signoff."],
    rows: reviewed,
  };
  const output = path.join(dataDir, "reviews/guarded-v2-content-review.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  const escapeCell = (value: string) => value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
  const table = reviewed.map((row) => {
    const issues = [...new Set(row.claims.map((claim) => claim.judgment).filter((judgment) => !["SUPPORTED", "SUPPORTED_FACTS", "RELEVANT"].includes(judgment)))];
    return `| ${row.id} | ${row.variant} | ${row.claims.length} | ${escapeCell(issues.join(", ") || "No issue identified by this assistant rubric; not independent approval")} |`;
  });
  fs.writeFileSync(path.join(dataDir, "reviews/guarded-v2-content-review.md"), [
    "# Guarded V2 — content review of 24 frozen answers", "", `Review date: ${annotations.reviewedAt}. Authority: **${annotations.authority}**.`,
    "No Bedrock/model calls. This is an assistant audit informed by the supplied review, not independent human/expert validation.", "",
    `Reviewed ${report.summary.textUnitsReviewed} text units across ${report.summary.answersReviewed} answers. Original candidates and contractPass are unchanged.`,
    "Mixed text blocks are classified/qualified in notes; this is not a fully atomized scientific entailment gold dataset.", "",
    "- 1 unsupported plan recommendation in rationaleSummary; narrow advice screen detects it despite proposedAction=null.",
    `- ${report.summary.rowsWithUnsupportedPersonalApplication} answers contain unsupported personal application.`,
    `- ${counts.SUPPORTED_RECLASSIFY ?? 0} hypothesis text blocks in ${report.summary.rowsWithMisclassifiedSupportedStatements} answers are better classified as principles/observations/limitations.`,
    "- Unknown muscle-size outcome must not be phrased as evidence of no muscle-size change.",
    "- Missing-information questions may be unnecessary or have the wrong key; this is reviewed separately from numerical correctness.", "",
    "| Case | Variant | Text units reviewed | Review findings (may overlap) |", "| --- | --- | --- | --- |", ...table, "",
    "## Full traceability", "",
    "- [JSON review with original text, field path, support IDs, notes and hashes](guarded-v2-content-review.json)",
    "- [Authored review annotations](guarded-v2-annotations.json)",
    "- [User-supplied review, preserved verbatim](user-review-2026-10-27.txt)",
    "- [Excerpt-to-claim supplement](../evidence-claim-map-v2.json)", "",
    "Do not interpret SUPPORTED as a scientific signoff. Rule-screen absence is not a content pass. Review priority P1 is an experiment-adoption blocker here, not a claim that this isolated prototype is a deployed production incident.", "",
  ].join("\n"));
  console.log(JSON.stringify({ output, status: report.status, summary: report.summary, modelCalls: 0 }, null, 2));
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "ContentReviewError"); process.exitCode = 1; }
