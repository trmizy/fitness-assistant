import type { AgentEvidence, CompatibilityScore, RecommendationNarration, TrainingProgramCandidate } from "@gym-coach/shared";

/**
 * v2 (Codex Independent Evaluation #1,
 * docs/codex-training-program-recommendation-evaluation-1.md, MEDIUM finding
 * #2): claims are now split into two kinds, matching
 * `scoreTrainingProgramV2`'s split of `eligibilityReasons` (confirmatory,
 * never weighted) from `components` (real ranking signals).
 *
 *  - Eligibility claims (`GOAL_ELIGIBLE`, `EXPERIENCE_ELIGIBLE`,
 *    `SCHEDULE_ELIGIBLE`, `EQUIPMENT_ELIGIBLE`) describe facts that are
 *    ALREADY guaranteed true for every candidate this catalog is built for
 *    — fitness-service's hard filters already require them. They explain
 *    "why this program is even in the list," not "why it ranks above
 *    another eligible one."
 *  - Ranking claims (`SESSION_DURATION`, `FOCUS_MATCH`, `DURATION_WEEKS`)
 *    are the only ones that can actually differ between two eligible
 *    candidates, and are the only ones that feed `compatibility.total`.
 *
 * This mirrors the Recommendation (PT) Narrator's Structured Claim
 * Grounding design (docs/recommendation-claim-catalog-design.md): the LLM
 * still only ever selects claim IDs from this server-built catalog, never
 * writes prose, and a category with no real grounding field (price,
 * guaranteed outcome, medical/PED, superiority, hidden schedule promises,
 * real-world outcome cohorts) simply has no claim type — see
 * `docs/training-program-recommendation-v2-score-design.md`.
 */

export type ProgramNarrationInputCandidate = {
  program: TrainingProgramCandidate;
  compatibility: CompatibilityScore;
};

export type ProgramClaim =
  | { id: string; candidateId: string; type: "COMPATIBILITY"; score: number }
  | { id: string; candidateId: string; type: "GOAL_ELIGIBLE" }
  | { id: string; candidateId: string; type: "EXPERIENCE_ELIGIBLE" }
  | { id: string; candidateId: string; type: "SCHEDULE_ELIGIBLE"; daysPerWeek: number }
  | { id: string; candidateId: string; type: "EQUIPMENT_ELIGIBLE" }
  | { id: string; candidateId: string; type: "SESSION_DURATION"; estimatedMinutes: number }
  | { id: string; candidateId: string; type: "FOCUS_MATCH"; focusMuscles: string[] }
  | { id: string; candidateId: string; type: "DURATION_WEEKS"; durationWeeks: number }
  | { id: string; candidateId: string; type: "SCIENTIFIC_EVIDENCE"; evidenceId: string; finding: string; title: string; evidenceLevel: string }
  | { id: string; candidateId: string; type: "NO_OUTCOME_HISTORY" }
  | { id: string; candidateId: string; type: "ZERO_RANKING_SIGNAL" };

function claimId(candidateId: string, suffix: string): string {
  return `${candidateId}::${suffix}`;
}

export function buildProgramClaimCatalog(input: ProgramNarrationInputCandidate, evidence: AgentEvidence[]): ProgramClaim[] {
  const cid = input.program.id;
  const claims: ProgramClaim[] = [
    { id: claimId(cid, "COMPATIBILITY"), candidateId: cid, type: "COMPATIBILITY", score: input.compatibility.total },
  ];

  // Eligibility claims — sourced from `eligibilityReasons` (v2), falling
  // back to the old `components` check (v1) so this catalog builder keeps
  // working unchanged if it's ever called against a v1 CompatibilityScore
  // (e.g. a historical FitnessRecommendation row re-narrated).
  const eligibility = new Set(input.compatibility.eligibilityReasons ?? []);
  const hasV1Components = !input.compatibility.eligibilityReasons;
  if (eligibility.has("PROGRAM_GOAL_ELIGIBLE") || (hasV1Components && (input.compatibility.components.goal ?? 0) >= 1)) {
    claims.push({ id: claimId(cid, "GOAL"), candidateId: cid, type: "GOAL_ELIGIBLE" });
  }
  if (eligibility.has("PROGRAM_EXPERIENCE_ELIGIBLE") || (hasV1Components && (input.compatibility.components.experience ?? 0) >= 1)) {
    claims.push({ id: claimId(cid, "EXPERIENCE"), candidateId: cid, type: "EXPERIENCE_ELIGIBLE" });
  }
  if (eligibility.has("PROGRAM_SCHEDULE_ELIGIBLE") || (hasV1Components && (input.compatibility.components.schedule ?? 0) >= 1)) {
    claims.push({ id: claimId(cid, "SCHEDULE"), candidateId: cid, type: "SCHEDULE_ELIGIBLE", daysPerWeek: input.program.daysPerWeek });
  }
  if (eligibility.has("PROGRAM_EQUIPMENT_ELIGIBLE") || (hasV1Components && (input.compatibility.components.equipment ?? 0) >= 1)) {
    claims.push({ id: claimId(cid, "EQUIPMENT"), candidateId: cid, type: "EQUIPMENT_ELIGIBLE" });
  }

  // Ranking claims — the only ones sourced from `components` (real,
  // per-candidate varying signals in both v1 and v2).
  if ("sessionDuration" in input.compatibility.components) claims.push({ id: claimId(cid, "SESSION"), candidateId: cid, type: "SESSION_DURATION", estimatedMinutes: input.program.estimatedMinutes });
  if ((input.compatibility.components.focusMuscle ?? 0) > 0 && input.program.focusMuscles.length) {
    claims.push({ id: claimId(cid, "FOCUS"), candidateId: cid, type: "FOCUS_MATCH", focusMuscles: input.program.focusMuscles.slice(0, 6) });
  }
  if ("durationWeeks" in input.compatibility.components) claims.push({ id: claimId(cid, "WEEKS"), candidateId: cid, type: "DURATION_WEEKS", durationWeeks: input.program.durationWeeks });

  for (const e of evidence) {
    claims.push({ id: claimId(cid, `EVIDENCE:${e.id}`), candidateId: cid, type: "SCIENTIFIC_EVIDENCE", evidenceId: e.id, finding: e.finding, title: e.title, evidenceLevel: e.evidenceLevel });
  }

  claims.push({ id: claimId(cid, "NO_HISTORY"), candidateId: cid, type: "NO_OUTCOME_HISTORY" });

  // v2 mandatory disclosure — see scoreTrainingProgramV2's own doc comment.
  // Not model-selectable in spirit (rendered unconditionally, same as
  // NO_OUTCOME_HISTORY, regardless of whether the LLM picks it — see
  // renderProgramNarrationFromClaims below), included in the catalog only
  // so a claim id exists for it.
  if (input.compatibility.signalCount === 0) {
    claims.push({ id: claimId(cid, "ZERO_SIGNAL"), candidateId: cid, type: "ZERO_RANKING_SIGNAL" });
  }

  return claims;
}

export function renderProgramClaim(claim: ProgramClaim): string {
  switch (claim.type) {
    case "COMPATIBILITY":
      return `Mức phù hợp tổng thể theo hệ thống tính là ${claim.score}%.`;
    case "GOAL_ELIGIBLE":
      return "Mục tiêu của chương trình khớp với mục tiêu bạn đã chọn.";
    case "EXPERIENCE_ELIGIBLE":
      return "Mức kinh nghiệm của chương trình khớp với hồ sơ hiện tại của bạn.";
    case "SCHEDULE_ELIGIBLE":
      return `Tần suất chương trình là ${claim.daysPerWeek} buổi mỗi tuần, khớp số ngày bạn muốn tập.`;
    case "EQUIPMENT_ELIGIBLE":
      return "Chương trình đã qua bộ lọc thiết bị và chỉ dùng bài tập mà hệ thống xác nhận bạn có thể thực hiện.";
    case "SESSION_DURATION":
      return `Thời lượng ước tính khoảng ${claim.estimatedMinutes} phút mỗi buổi, nằm trong giới hạn thời gian bạn đưa ra.`;
    case "FOCUS_MATCH":
      return `Nhóm cơ trong chương trình có giao với ưu tiên của bạn: ${claim.focusMuscles.join(", ")}.`;
    case "DURATION_WEEKS":
      return `Thời lượng chương trình là ${claim.durationWeeks} tuần.`;
    case "SCIENTIFIC_EVIDENCE":
      return claim.finding;
    case "NO_OUTCOME_HISTORY":
      return "Hiện chưa có cohort kết quả đủ tin cậy cho từng template chương trình; điểm này là điểm phù hợp điều kiện, không phải dự đoán kết quả cá nhân.";
    case "ZERO_RANKING_SIGNAL":
      return "Các chương trình này đều đáp ứng các ràng buộc hiện tại như nhau — hiện chưa có đủ thông tin sở thích (thời lượng buổi tập, nhóm cơ ưu tiên, hoặc số tuần mong muốn) để xếp hạng khác biệt giữa chúng.";
    default: {
      const exhaustive: never = claim;
      return String(exhaustive);
    }
  }
}

/** Which rendered bucket a claim belongs in. Eligibility claims are
 * "why this is in the list at all," kept out of `strengths` (which is
 * reserved for what actually differentiated this candidate from another
 * eligible one) — this is the UI-facing counterpart of the
 * eligibility/ranking split described above. */
type ProgramClaimBucket = "ELIGIBILITY" | "RANKING_STRENGTH" | "SCIENTIFIC" | "MANDATORY_UNCERTAINTY";

function bucketOf(claim: ProgramClaim): ProgramClaimBucket {
  switch (claim.type) {
    case "GOAL_ELIGIBLE":
    case "EXPERIENCE_ELIGIBLE":
    case "SCHEDULE_ELIGIBLE":
    case "EQUIPMENT_ELIGIBLE":
      return "ELIGIBILITY";
    case "SCIENTIFIC_EVIDENCE":
      return "SCIENTIFIC";
    case "NO_OUTCOME_HISTORY":
    case "ZERO_RANKING_SIGNAL":
      return "MANDATORY_UNCERTAINTY";
    default:
      return "RANKING_STRENGTH";
  }
}

export function buildDefaultProgramSelection(catalog: ProgramClaim[]): string[] {
  const priority: ProgramClaim["type"][] = [
    "COMPATIBILITY", "SESSION_DURATION", "FOCUS_MATCH", "DURATION_WEEKS",
    "GOAL_ELIGIBLE", "EXPERIENCE_ELIGIBLE", "SCHEDULE_ELIGIBLE", "EQUIPMENT_ELIGIBLE",
    "NO_OUTCOME_HISTORY", "ZERO_RANKING_SIGNAL",
  ];
  const selected: string[] = [];
  for (const type of priority) {
    const match = catalog.find(c => c.type === type);
    if (match) selected.push(match.id);
  }
  const evidence = catalog.find(c => c.type === "SCIENTIFIC_EVIDENCE");
  if (evidence) selected.push(evidence.id);
  return selected;
}

export function renderProgramNarrationFromClaims(candidateId: string, catalog: ProgramClaim[], selectedClaimIds: string[]): RecommendationNarration {
  const byId = new Map(catalog.map(c => [c.id, c]));
  const selectedSet = new Set(selectedClaimIds);
  // Mandatory disclosures render regardless of LLM selection — same
  // principle as the PT Narrator's INSUFFICIENT_HISTORY/synthetic-origin
  // claims (docs/recommendation-claim-catalog-design.md).
  for (const c of catalog) {
    if (bucketOf(c) === "MANDATORY_UNCERTAINTY") selectedSet.add(c.id);
  }
  const selected = [...selectedSet].flatMap(id => byId.get(id) ? [byId.get(id)!] : []);

  const eligibility: string[] = [];
  const strengths: string[] = [];
  const uncertainty: string[] = [];
  let scientificEvidenceSummary: string | undefined;
  const evidenceRefs: string[] = [];
  let compatibilityText: string | undefined;

  for (const claim of selected) {
    const bucket = bucketOf(claim);
    const text = renderProgramClaim(claim);
    if (claim.type === "COMPATIBILITY") { compatibilityText = text; continue; }
    if (bucket === "MANDATORY_UNCERTAINTY") uncertainty.push(text);
    else if (bucket === "SCIENTIFIC") {
      scientificEvidenceSummary = text;
      if (claim.type === "SCIENTIFIC_EVIDENCE") evidenceRefs.push(claim.evidenceId);
    } else if (bucket === "ELIGIBILITY") eligibility.push(text);
    else strengths.push(text);
  }

  return {
    candidateId,
    summary: compatibilityText ?? eligibility[0] ?? strengths[0] ?? "Chương trình này đã qua bộ lọc phù hợp cơ bản.",
    // Eligibility facts precede real ranking strengths — "why it's in the
    // list" before "why it ranks where it does" — capped at 5 total to
    // match the PT Narrator's card-size discipline.
    strengths: [...eligibility, ...strengths].slice(0, 5),
    tradeoffs: [],
    scientificEvidenceSummary,
    uncertainty,
    evidenceRefs,
  };
}
