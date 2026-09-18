import type { RecommendationNarration } from "@gym-coach/shared";
import type { NarrationInputCandidate } from "./recommendation_narrator";
import type { AgentEvidence } from "@gym-coach/shared";

/**
 * Structured Claim Grounding — the core of the ADV-001/ADV-005 architectural
 * fix (docs/codex-ai-agent-regression-3-report.md: "48/50 new material
 * unsupported factual claims were accepted... the architecture is still a
 * regex category recognizer... Can an unseen paraphrase still assert
 * ungrounded facts? YES.").
 *
 * Regression #1/#2/#3 all failed the same way: the LLM wrote free-form
 * factual prose, and a regex/negation validator tried to GUESS after the
 * fact whether that prose was true. No vocabulary list generalizes to every
 * future paraphrase of "invent a fact this candidate has no data for" —
 * that is a category error, not a coverage gap.
 *
 * This module removes the LLM's ability to author factual sentences at all.
 * For each candidate, `buildClaimCatalog()` deterministically enumerates
 * every fact the server can actually prove from real, already-fetched data
 * (`NarrationInputCandidate` + the real supplied `AgentEvidence[]`). The LLM
 * (see recommendation_narrator.ts's `ClaimSelectionSchema`) may only pick
 * IDs out of this catalog — it never writes the sentence. `renderClaim()` is
 * the ONLY code that turns a claim into user-facing text, from a fixed
 * per-type Vietnamese template, so the server owns every word that reaches
 * the user.
 *
 * The reason a *new* paraphrase can't reopen this hole: there is no field
 * anywhere in this module for "schedule guarantee", "price", "location",
 * "medical/PED", "action-completed", etc. — categories with no per-call
 * grounding channel simply have no ClaimType and therefore no possible
 * catalog entry, regardless of how an attacker's prompt is worded. A
 * paraphrase can only ever select among IDs that already exist; it cannot
 * conjure a new one.
 */

export type ClaimType =
  | "COMPATIBILITY"
  | "GOAL_MATCH"
  | "SCHEDULE_MATCH"
  | "BUDGET_MATCH"
  | "REPUTATION"
  | "HISTORICAL_EVIDENCE"
  | "INSUFFICIENT_HISTORY"
  | "SCIENTIFIC_EVIDENCE"
  | "EXPERIENCE"
  | "CERTIFICATION";

export type GroundedClaim =
  | { id: string; candidateId: string; type: "COMPATIBILITY"; score: number }
  | { id: string; candidateId: string; type: "GOAL_MATCH" }
  | { id: string; candidateId: string; type: "SCHEDULE_MATCH"; coverage: number }
  | { id: string; candidateId: string; type: "BUDGET_MATCH" }
  | { id: string; candidateId: string; type: "REPUTATION"; rating: number; reviewCount: number }
  | {
      id: string; candidateId: string; type: "HISTORICAL_EVIDENCE";
      cohortCount: number; origin: "REAL" | "SYNTHETIC";
      medianTrainingAdherence: number | null; completionRate: number | null;
    }
  | { id: string; candidateId: string; type: "INSUFFICIENT_HISTORY" }
  | { id: string; candidateId: string; type: "SCIENTIFIC_EVIDENCE"; evidenceId: string; title: string; finding: string; evidenceLevel: string }
  | { id: string; candidateId: string; type: "EXPERIENCE"; years: string }
  | { id: string; candidateId: string; type: "CERTIFICATION"; name: string; issuer: string };

/** Claim ids are candidate-scoped by construction (`${candidateId}::${type}...`)
 * — a selection naming a claim id that doesn't appear in THIS candidate's own
 * catalog is rejected, so candidate A's rating can never be rendered under
 * candidate B (see recommendation_narrator.ts's cross-candidate-scoping
 * check, and its test). */
function claimId(candidateId: string, suffix: string): string {
  return `${candidateId}::${suffix}`;
}

/**
 * Deterministic, pure. Every field on every claim is copied directly from
 * `input`/`evidence` — nothing here is inferred, guessed, or LLM-authored.
 * A fact category with no corresponding real field (price, schedule
 * guarantee, location, medical/PED, completed-action, comparative ranking,
 * etc.) has no case below and therefore can never produce a claim — this is
 * the actual mechanism that makes new paraphrase attacks structurally
 * irrelevant, not a wording judgment call.
 */
export function buildClaimCatalog(input: NarrationInputCandidate, evidence: AgentEvidence[]): GroundedClaim[] {
  const cid = input.candidate.id;
  const claims: GroundedClaim[] = [];

  claims.push({ id: claimId(cid, "COMPATIBILITY"), candidateId: cid, type: "COMPATIBILITY", score: input.compatibility.total });

  if ((input.compatibility.components.goal ?? 0) >= 1) {
    claims.push({ id: claimId(cid, "GOAL_MATCH"), candidateId: cid, type: "GOAL_MATCH" });
  }

  const scheduleCoverage = input.compatibility.components.schedule ?? 0;
  if (scheduleCoverage > 0) {
    claims.push({ id: claimId(cid, "SCHEDULE_MATCH"), candidateId: cid, type: "SCHEDULE_MATCH", coverage: scheduleCoverage });
  }

  if ((input.compatibility.components.budget ?? 0) >= 1) {
    claims.push({ id: claimId(cid, "BUDGET_MATCH"), candidateId: cid, type: "BUDGET_MATCH" });
  }

  // Same threshold scorePT() itself uses for the reputation component
  // (reviewCount >= 5 && averageRating !== null) — a claim only exists when
  // the underlying score already treats the reputation as real evidence.
  if (input.candidate.reviewCount >= 5 && input.candidate.averageRating !== null) {
    claims.push({
      id: claimId(cid, "REPUTATION"), candidateId: cid, type: "REPUTATION",
      rating: input.candidate.averageRating, reviewCount: input.candidate.reviewCount,
    });
  }

  if (input.history.count > 0) {
    claims.push({
      id: claimId(cid, "HISTORICAL_EVIDENCE"), candidateId: cid, type: "HISTORICAL_EVIDENCE",
      cohortCount: input.history.count, origin: input.history.dataOrigin,
      medianTrainingAdherence: input.history.medianTrainingAdherence, completionRate: input.history.completionRate,
    });
  } else {
    // Mandatory-disclosure claim — see renderNarrationFromClaims(): this one
    // is always rendered into `uncertainty` when present in the catalog,
    // regardless of whether the LLM selected it. ADV-005 (Regression #3:
    // safe disclaimers wrongly rejected by the old free-form validator)
    // disappears structurally here — the disclaimer is fixed server text,
    // never LLM prose a regex has to classify.
    claims.push({ id: claimId(cid, "INSUFFICIENT_HISTORY"), candidateId: cid, type: "INSUFFICIENT_HISTORY" });
  }

  for (const e of evidence) {
    claims.push({
      id: claimId(cid, `EVIDENCE:${e.id}`), candidateId: cid, type: "SCIENTIFIC_EVIDENCE",
      evidenceId: e.id, title: e.title, finding: e.finding, evidenceLevel: e.evidenceLevel,
    });
  }

  if (input.candidate.yearsExperience && input.candidate.yearsExperience.trim()) {
    claims.push({ id: claimId(cid, "EXPERIENCE"), candidateId: cid, type: "EXPERIENCE", years: input.candidate.yearsExperience });
  }

  // Only VERIFIED certificates become claims — see recommendation_narrator.ts
  // §CERTIFICATION for why an unverified/pending entry is deliberately
  // excluded even though it exists on `candidate.certificates`. The claim
  // carries the real stored name/issuer; the LLM can select it but the
  // renderer is the only thing that ever prints the name, so an invented
  // credential name (Regression #1's nar-adv-003, Regression #3's "formally
  // vetted" paraphrase) has no way to reach the user — there is no field to
  // put it in.
  input.candidate.certificates
    .filter((c) => c.verificationStatus === "VERIFIED")
    .forEach((c, i) => {
      claims.push({ id: claimId(cid, `CERT:${i}`), candidateId: cid, type: "CERTIFICATION", name: c.name, issuer: c.issuer });
    });

  return claims;
}

/** Renders exactly one claim to a fixed Vietnamese sentence. This is the
 * ONLY place user-facing factual wording is produced — the LLM never writes
 * or rewrites this text (see recommendation_narrator.ts §10, "final factual
 * prose must be rendered after all LLM operations"). */
export function renderClaim(claim: GroundedClaim): string {
  switch (claim.type) {
    case "COMPATIBILITY":
      return `Mức phù hợp tổng thể theo hệ thống tính là ${claim.score}%.`;
    case "GOAL_MATCH":
      return "Chuyên môn của PT này khớp với mục tiêu bạn đã chọn.";
    case "SCHEDULE_MATCH":
      return claim.coverage >= 1
        ? "PT này có lịch trống khớp toàn bộ các ngày bạn chọn."
        : `PT này có lịch trống khớp khoảng ${Math.round(claim.coverage * 100)}% số ngày bạn chọn.`;
    case "BUDGET_MATCH":
      return "PT này có ít nhất một gói dịch vụ nằm trong ngân sách bạn đã nêu.";
    case "REPUTATION":
      return `PT hiện có điểm đánh giá ${claim.rating}/5 từ ${claim.reviewCount} lượt đánh giá.`;
    case "HISTORICAL_EVIDENCE": {
      const base = `Trong dữ liệu quan sát của ${claim.cohortCount} khách hàng có hồ sơ tương tự${
        claim.completionRate !== null ? `, tỷ lệ hoàn thành lộ trình là khoảng ${Math.round(claim.completionRate * 100)}%` : ""
      }${
        claim.medianTrainingAdherence !== null ? `, mức tuân thủ lịch tập trung vị là khoảng ${Math.round(claim.medianTrainingAdherence * 100)}%` : ""
      }. Đây là dữ liệu quan sát, không phải cam kết hay bảo đảm kết quả cho riêng bạn.`;
      // Synthetic-origin disclosure is part of the claim's own fixed
      // rendering — never a model decision (Regression #3 nar3-031..035:
      // synthetic history implicitly framed as a real track record via
      // unseen phrasing). There is no code path that can render a
      // HISTORICAL_EVIDENCE claim without this sentence when origin is
      // SYNTHETIC.
      return claim.origin === "SYNTHETIC"
        ? `${base} Đây là dữ liệu demo tổng hợp (synthetic) dùng cho mục đích minh hoạ, không phải bằng chứng về hiệu quả huấn luyện thực tế.`
        : base;
    }
    case "INSUFFICIENT_HISTORY":
      return "Hiện chưa có đủ dữ liệu lịch sử (số khách hàng quan sát được còn dưới ngưỡng tối thiểu) để đánh giá kết quả huấn luyện của PT này — đây là PT mới hoặc chưa đủ dữ liệu, không phải PT có kết quả kém.";
    case "SCIENTIFIC_EVIDENCE":
      return claim.finding;
    case "EXPERIENCE":
      return `PT này có ${claim.years} năm kinh nghiệm huấn luyện theo hồ sơ đã xác minh.`;
    case "CERTIFICATION":
      return `PT này có chứng chỉ đã xác minh: ${claim.name} (${claim.issuer}).`;
    default: {
      const exhaustive: never = claim;
      return String(exhaustive);
    }
  }
}

type ClaimBucket = "STRENGTH" | "TRADEOFF" | "SCIENTIFIC" | "MANDATORY_UNCERTAINTY";

function bucketOf(claim: GroundedClaim): ClaimBucket {
  switch (claim.type) {
    case "INSUFFICIENT_HISTORY":
      return "MANDATORY_UNCERTAINTY";
    case "SCIENTIFIC_EVIDENCE":
      return "SCIENTIFIC";
    case "SCHEDULE_MATCH":
      return claim.coverage < 0.5 ? "TRADEOFF" : "STRENGTH";
    default:
      return "STRENGTH";
  }
}

/** Deterministic fallback selection — used whenever the LLM call fails,
 * times out, or returns an invalid/empty selection for a candidate (see
 * recommendation_narrator.ts §Failure/timeout). Picks a small, fixed,
 * sensible default so the user still gets a full, claim-grounded
 * explanation with zero dependency on model availability — this is
 * strictly an upgrade over the old behavior of silently dropping the
 * candidate's narration entirely. */
export function buildDefaultSelection(catalog: GroundedClaim[]): string[] {
  const priority: ClaimType[] = [
    "COMPATIBILITY", "GOAL_MATCH", "SCHEDULE_MATCH", "BUDGET_MATCH",
    "REPUTATION", "HISTORICAL_EVIDENCE", "INSUFFICIENT_HISTORY", "EXPERIENCE", "CERTIFICATION",
  ];
  const selected: string[] = [];
  for (const type of priority) {
    const match = catalog.find((c) => c.type === type);
    if (match) selected.push(match.id);
  }
  // At most one scientific-evidence claim by default — the LLM may select
  // more when it actually runs; the deterministic fallback stays minimal.
  const firstEvidence = catalog.find((c) => c.type === "SCIENTIFIC_EVIDENCE");
  if (firstEvidence) selected.push(firstEvidence.id);
  return selected;
}

/**
 * Deterministically renders a validated set of claim ids into the exact
 * `RecommendationNarration` shape `fitness-agent.service.ts` already
 * consumes (`narration.summary` / `.strengths` / `.tradeoffs` / ...) — the
 * external contract is unchanged; only how those strings are produced
 * changed. `selectedClaimIds` must already be filtered to real ids that
 * belong to `catalog` (candidate-scoped validation happens in
 * recommendation_narrator.ts, not here).
 */
export function renderNarrationFromClaims(
  candidateId: string,
  catalog: GroundedClaim[],
  selectedClaimIds: string[],
  opts: { ordering?: string[]; tone?: "CONCISE" | "SUPPORTIVE" } = {},
): RecommendationNarration {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const selectedSet = new Set(selectedClaimIds);
  // Mandatory disclosures render regardless of LLM selection (§16/§31).
  for (const c of catalog) {
    if (bucketOf(c) === "MANDATORY_UNCERTAINTY") selectedSet.add(c.id);
  }
  const orderingIndex = new Map((opts.ordering ?? []).filter((id) => selectedSet.has(id)).map((id, i) => [id, i]));
  const ordered = [...selectedSet]
    .map((id) => byId.get(id))
    .filter((c): c is GroundedClaim => Boolean(c))
    .sort((a, b) => (orderingIndex.get(a.id) ?? 999) - (orderingIndex.get(b.id) ?? 999));

  const strengths: string[] = [];
  const tradeoffs: string[] = [];
  const uncertainty: string[] = [];
  let scientificEvidenceSummary: string | undefined;
  let historicalEvidenceSummary: string | undefined;
  const evidenceRefs: string[] = [];

  for (const claim of ordered) {
    const bucket = bucketOf(claim);
    const text = renderClaim(claim);
    if (bucket === "MANDATORY_UNCERTAINTY") {
      uncertainty.push(text);
    } else if (bucket === "SCIENTIFIC") {
      scientificEvidenceSummary = scientificEvidenceSummary ? `${scientificEvidenceSummary} ${text}` : text;
      if (claim.type === "SCIENTIFIC_EVIDENCE") evidenceRefs.push(claim.evidenceId);
    } else if (bucket === "TRADEOFF") {
      tradeoffs.push(text);
    } else {
      strengths.push(text);
      if (claim.type === "HISTORICAL_EVIDENCE") historicalEvidenceSummary = text;
    }
  }

  const tonePrefix = opts.tone === "SUPPORTIVE" ? "Đây là một lựa chọn đáng cân nhắc. " : "";
  const summary = strengths.length > 0
    ? `${tonePrefix}${strengths[0]}`
    : `${tonePrefix}Chưa có đủ dữ liệu nổi bật để làm điểm mạnh chính cho PT này.`;

  return {
    candidateId,
    summary,
    strengths: strengths.slice(0, 5),
    tradeoffs: tradeoffs.slice(0, 5),
    historicalEvidenceSummary,
    scientificEvidenceSummary,
    uncertainty: uncertainty.length > 0 ? uncertainty : ["Compatibility Score là điểm phù hợp ước tính, không phải cam kết kết quả."],
    evidenceRefs,
  };
}
