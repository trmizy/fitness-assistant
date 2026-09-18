import { z } from "zod";
import { logger } from "@gym-coach/shared";
import type { PTCandidate, AgentEvidence, CompatibilityScore, HistoricalSummary } from "@gym-coach/shared";
import type { RecommendationNarration } from "@gym-coach/shared";
import { callLlmJson } from "./json_llm_call.util";
import { buildClaimCatalog, buildDefaultSelection, renderNarrationFromClaims, type GroundedClaim } from "./recommendation_claims";

/**
 * Recommendation Narrator — the ONE new LLM capability this
 * implementation adds (docs/ai-agent-system-target-architecture.md §3/§6,
 * docs/ai-agent-system-migration-plan.md Phase 6, feasibility audit §7/
 * §16). It never decides WHAT to recommend or in what order — `scorePT`
 * (backend/shared/src/fitness-agent-scoring.ts) remains the sole ranking
 * authority. This module only explains an ALREADY-COMPUTED ranking using
 * real evidence, and every sentence it produces is checked against the
 * underlying numbers before being shown to a user.
 *
 * Hard rule (see feasibility audit §29, "DO NOT let LLM invent match
 * percentages"): if the narrator's text contains a percentage that isn't
 * the candidate's real `compatibility.total`, or claims historical/
 * scientific evidence that wasn't actually supplied, or uses a causal/
 * guarantee phrase, that candidate's narration is dropped and the caller
 * falls back to the existing template `why[]` strings — never partially
 * trusted.
 */

export const ENABLE_RECOMMENDATION_NARRATION = process.env.ENABLE_RECOMMENDATION_NARRATION !== "false";

const NarrationItemSchema = z.object({
  candidateId: z.string().min(1),
  summary: z.string().min(1).max(500),
  strengths: z.array(z.string().min(1).max(200)).max(5),
  tradeoffs: z.array(z.string().min(1).max(200)).max(5),
  historicalEvidenceSummary: z.string().max(300).nullable().optional(),
  scientificEvidenceSummary: z.string().max(300).nullable().optional(),
  uncertainty: z.array(z.string().min(1).max(200)).max(5),
  evidenceRefs: z.array(z.string()).max(10),
});
// Kept exported (Phase 4): no longer used by narrateRecommendations()
// (which now uses ClaimSelectionBatchSchema below), but this is the legacy
// free-form batch shape Codex's evaluator constructs `NarrationItemSchema`
// objects to match when calling validateNarration() directly.
export const NarrationBatchSchema = z.object({ narrations: z.array(NarrationItemSchema).max(10) });

export type NarrationInputCandidate = {
  candidate: PTCandidate;
  compatibility: CompatibilityScore;
  history: HistoricalSummary;
};

// ── Structured-claim grounding validator ────────────────────────────────
//
// HARDENING PASS #2 (2026-09-14, ADV-001/ADV-005 —
// docs/codex-ai-agent-regression-2-report.md): Regression #1's fix (a
// flat, growing regex blacklist) closed the original 50 adversarial
// fixtures but Codex's independent Regression #2 immediately found 24/30
// NEW semantic paraphrases that bypassed it (e.g. "PT nay duoc dao tao
// chuan quoc te" instead of "co chung chi") — proving that patching
// literal strings does not generalize. Regression #2 also found 4/8
// false positives (safe negated disclaimers like "khong the dam bao ket
// qua" wrongly rejected, and a genuine collision: "tinh tu" (tính từ,
// "calculated from") and "tinh" (tỉnh, "province") normalize to the
// identical ASCII string once diacritics are stripped, so the old
// blanket location regex matched inside "duoc TINH TU muc tieu").
//
// This is a structural rewrite, not more patches:
//
//  1. Claims are checked by SEMANTIC CATEGORY (CERTIFICATION, SCHEDULE,
//     BUDGET, FEEDBACK, LOCATION, HISTORICAL_OUTCOME, CAUSAL, MEDICAL_PED,
//     SUPERIORITY, SCORE_CONTRADICTION, SYNTHETIC_AS_REAL, ACTION,
//     GOAL_ASSERTION) via a wide, synonym-rich vocabulary per category —
//     not one string per known attack. A category's whole PURPOSE is to
//     catch phrasings never seen before, because it matches the
//     underlying semantic pattern (any construction implying the PT is
//     vetted/qualified beyond what's supplied, any construction implying
//     a past client outcome, any causal-attribution construction, etc.),
//     not a literal sentence.
//  2. Two categories (FEEDBACK/rating and CERTIFICATION) are validated as
//     an ALLOWLIST against real grounding (`candidate.averageRating`/
//     `reviewCount`, `candidate.certificates`) rather than a blanket ban
//     — a genuine "claim must be backed by supplied structured data"
//     check. The remaining categories (schedule-fit guarantee,
//     comparative budget, location, action, causal, medical/PED,
//     superiority, score contradiction) stay unconditional bans:
//     `NarrationInputCandidate` has no per-call grounding channel for
//     them at all (no user preferences/schedule/location are passed in),
//     and several of them (comparative "cheapest in the list", "no
//     conflict ever") are inherently stronger claims than anything a
//     single-candidate, fractional compatibility score could support
//     even if grounding existed.
//  3. Every category check is NEGATION-AWARE at the sentence level
//     (`hasUnnegatedMatch`) — a trigger phrase preceded by a negation
//     marker ("khong", "chua", "chang") within the same sentence is
//     treated as a safe disclaimer, not a violation. This is what makes
//     "Khong the dam bao ket qua ca nhan." pass while "PT nay chac chan
//     dat ket qua." still fail.
//  4. LOCATION detection runs against the RAW (diacritic-PRESERVED) text
//     specifically, not the normalized one — "tỉnh" (hook-above ỉ,
//     U+1EC9) and "tính" (acute í, U+00ED) are genuinely different
//     Unicode characters before normalization; stripping diacritics is
//     exactly what made them collide. This fixes the false positive at
//     its root cause instead of special-casing the one known phrase.
//
// Design test this module must keep passing: "Could a completely new
// semantic paraphrase invent a fact without representing that fact in a
// validated structured claim?" — for every category below the answer
// must stay NO, because the category is defined by the underlying
// semantic pattern, not a fixed string.
const PERCENT_RE = /(\d{1,3})\s*%/g;
const RATING_STAR_RE = /(\d+(?:[.,]\d+)?)\s*sao/;
const RATING_REVIEW_RE = /(\d+)\s*(?:danh gia|review)/;

// Sentence-level negation markers (checked against ASCII-normalized text).
// Deliberately broad: "khong"/"chua" alone cover "không", "không thể",
// "không phải", "chưa", "chẳng", etc. once diacritics are stripped.
const NEGATION_MARKERS = ["khong", "chua", "chang"];

type ClaimCategory = { name: string; pattern: RegExp };

// Each pattern is a semantic FAMILY of phrasings, not a single known
// attack string — every entry below was designed to cover the
// Regression #2 paraphrase plus plausible siblings, not just the exact
// fixture text.
const CERTIFICATION_CATEGORY: ClaimCategory = {
  name: "unverifiable certification/credential claim",
  pattern: /(chung chi|certificat|certified|dao tao chuan|duoc dao tao|bang cap|chuyen mon.{0,20}chung nhan|credentials?|qualifications?)/,
};
const FEEDBACK_CATEGORY: ClaimCategory = {
  name: "unverifiable qualitative feedback claim",
  pattern: /(danh gia (rat )?cao|phan hoi (xuat sac|tot|tich cuc)|khach hang hai long|well.?reviewed|highly rated|outstanding reviews?|great reviews?|positive reviews?)/,
};
const UNCONDITIONAL_CATEGORIES: ClaimCategory[] = [
  {
    name: "guarantee/causal-promise",
    pattern: /(chac chan|dam bao|cam ket|guarantee[d]?|100%\s*(thanh cong|hieu qua))/,
  },
  {
    name: "causal outcome attribution",
    // Covers: "giup/khien khach/ban [dat/giam/tang]", "mang lai", "dan
    // den", "nguyen nhan", "chiu trach nhiem", "gay ra", and the English
    // causal family (responsible for / will lead to / leads to / causes /
    // results in).
    pattern: /((khien|giup)\s+(khach|ban)|mang lai|dan den|nho .{0,15}\bma\b|nguyen nhan (cua|dan|giup)|chiu trach nhiem|gay ra|responsible for|will lead to|leads? to|\bcauses?\b|results? in)/,
  },
  {
    name: "medical/PED/hormonal speculation",
    pattern: /(dieu tri|benh ly|\by te\b|steroid|\bped\b|doping|chan doan|hormone|noi tiet to|testosterone|performance.?enhancing|(toi uu|toi u).{0,20}chuyen hoa|chuyen hoa.{0,20}toi uu)/,
  },
  {
    name: "unsupported superiority/superlative",
    pattern: /(tot nhat|so 1\b|vuot troi|duy nhat|khong doi thu|number one|best (option|choice|pt)|unparalleled)/,
  },
  {
    name: "score/rank self-contradiction",
    pattern: /(thap|kem|yeu|\blow\b).{0,60}(dung dau|hang dau|top\b|cao nhat|lua chon hang dau|top (recommendation|choice|pick))|(dung dau|hang dau|cao nhat|lua chon hang dau|top (recommendation|choice|pick)).{0,60}(thap|kem|yeu|\blow\b)/,
  },
  // NOTE: "synthetic data framed as real-world evidence" is intentionally
  // NOT in this generic list — it is a two-part (origin-marker ... claim-
  // marker) pattern where a negation marker can legitimately sit BETWEEN
  // the two parts ("dữ liệu demo, KHÔNG PHẢI hiệu quả thực tế" — an honest
  // disclaimer, must be ACCEPTED). `hasUnnegatedMatch` only checks for a
  // negation marker BEFORE the whole match, so it cannot see a negation
  // sitting inside a wide `.{0,40}` gap between two keyword groups. See
  // `hasSyntheticFramedAsReal` below, which checks between-parts negation
  // specifically.
  {
    name: "unverifiable schedule-fit guarantee",
    // "phu hop lich cua ban", "khong co xung dot lich", "dong hanh du N
    // buoi/tuan" — assertions STRONGER than a 0-1 fractional schedule
    // score can support (the score never proves "no conflict, ever").
    pattern: /(khong (co |gap )?xung dot.{0,20}lich|khong (co |gap )?tro ngai.{0,25}(lich|thoi gian)|phu hop lich (cua )?ban|dong hanh du \d|\d+\s*buoi\s*(moi|\/)\s*tuan)/,
  },
  {
    name: "unverifiable comparative budget claim",
    // Cross-candidate comparisons ("cheapest in the list") can never be
    // verified from a single candidate's grounding — this validator only
    // ever sees one candidate at a time.
    pattern: /(khong vuot chi phi|tiet kiem nhat|re nhat|trong tam gia|tui tien|cost.?effective|cheapest|most affordable)/,
  },
  {
    name: "unverifiable location/proximity convenience",
    // "quan \d"/"phuong \d"/district/ward are safe to check on
    // diacritic-STRIPPED text — they don't collide with any other
    // Vietnamese word once normalized. "tỉnh" (province) DOES collide
    // with "tính" (as in "tính từ", "calculated from") once diacritics
    // are stripped, so that one token is deliberately excluded here and
    // checked separately on diacritic-preserved text — see
    // LOCATION_RAW_RE below.
    pattern: /(quan \d|phuong \d|district \d|ward \d|thuan tien di chuyen|de den\b|khong mat.{0,20}di chuyen|gan khu vuc|cung khu vuc|gan ban\b|convenient location|near you|easy to (reach|get to))/,
  },
  {
    name: "unverifiable specific price",
    pattern: /(\d+\s*k\b|\d+\s*(nghin|trieu|dong|vnd))/,
  },
  {
    name: "unverifiable specific package/session count",
    pattern: /\d+\s*(buoi|sessions?)\b/,
  },
  {
    name: "unverifiable specific weekday availability",
    pattern: /(thu hai|thu ba|thu tu|thu nam|thu sau|thu bay|chu nhat|\bt[2-8]\b|\bcn\b|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/,
  },
  {
    name: "unverifiable/contradictory session-mode claim",
    pattern: /(truc tuyen|truc tiep|\bonline\b|\boffline\b)/,
  },
  {
    name: "unauthorized action-execution language",
    // Covers first-person future/past claims of having acted, AND
    // passive-voice action-completed framing ("goi da duoc chon", "hop
    // dong dang duoc xu ly") that implies an action without any
    // first-person verb.
    pattern: /(toi (da|se) (tu dong )?(tao|kich hoat|dang ky|thanh toan|xu ly)|da (duoc|dang duoc) (chon|xu ly|kich hoat|thanh toan)|hop dong (dang duoc xu ly|da duoc tao|da kich hoat)|yeu cau.{0,15}da duoc xu ly|i (have|will|already) (register|activate|create|pay|process)|(already )?(registered|activated|processed|created) (for|on behalf)|has (already )?been (finalized|completed|activated|processed))/,
  },
  {
    name: "ungrounded specific user-goal/preference assertion",
    pattern: /(ban (dang|muon)|nguoi dung (dang|muon))\s*[^.]{0,15}(tang co|giam mo|giam can|duy tri|hieu suat|suc ben|the thao thanh tich)/,
  },
];

// Historical/cohort outcome claims — a WIDE semantic family (trend
// language, "similar clients", "prior cases", "real-world experience",
// "historical data shows effectiveness") rather than a narrow keyword
// list. Gated on `history.count === 0` below, not unconditional, since a
// real, sufficient cohort genuinely licenses this category.
const HISTORICAL_OUTCOME_PATTERN =
  /(\bcohort\b|xu huong (mang lai|dat)|khach hang tuong tu|nguoi (co )?hoan canh giong|nhom khach hang|tien bo (ro|thuc te|ro ret)|cai thien ro ret|case truoc|cac case|ket qua tich cuc|du lieu lich su|khach hang truoc day|kinh nghiem thuc te|chung minh hieu qua|hieu qua ngoai doi|cong dong|khach hang cu)/;

/** Strips Vietnamese diacritics and lowercases — same discipline as
 * fitness-agent-intent.ts::normalizeAgentText, applied here so every
 * regex check below is diacritic-insensitive by construction rather than
 * needing two spellings per keyword. NOT used for the location check —
 * see LOCATION_RAW_RE below and the module doc comment §4. */
function normalizeForValidation(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

/** Only "tỉnh" itself needs the diacritic-PRESERVED check — every other
 * location token (quận/phường/district/ward) is handled safely in the
 * normalized UNCONDITIONAL_CATEGORIES list above. "tỉnh" (ỉ, U+1EC9) and
 * "tính" (í, U+00ED) are distinct characters only before normalization,
 * so this can never repeat the "được tính từ" false positive that the
 * old diacritic-stripped blanket regex produced (see module doc comment
 * §4). */
const LOCATION_RAW_RE = /\btỉnh\b/i;

function splitSentences(text: string): string[] {
  return text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
}

/** Two-part "origin marker ... claim marker" check (e.g. "dữ liệu demo"
 * ... "hiệu quả thực tế") where a negation marker legitimately sits
 * BETWEEN the two parts ("dữ liệu demo, KHÔNG PHẢI hiệu quả thực tế" — a
 * safe, required disclaimer). `hasUnnegatedMatch`'s before-the-whole-
 * match negation check cannot see a negation inside a wide `.{0,N}` gap
 * between two keyword groups, so this checks the gap specifically. */
function hasSyntheticFramedAsReal(text: string): boolean {
  const originRe = /(du lieu demo|demo data|synthetic)/g;
  const claimRe = /(hieu qua thuc te|real.?world|chung minh|ngoai doi)/;
  for (const sentence of splitSentences(text)) {
    originRe.lastIndex = 0;
    let om: RegExpExecArray | null;
    while ((om = originRe.exec(sentence))) {
      const after = sentence.slice(om.index + om[0].length);
      const claimMatch = claimRe.exec(after);
      if (!claimMatch) continue;
      const between = after.slice(0, claimMatch.index);
      const negated = NEGATION_MARKERS.some((marker) => between.includes(marker));
      if (!negated) return true;
    }
  }
  return false;
}

/** True if `pattern` matches somewhere in `sentence` at a position NOT
 * preceded by a negation marker earlier in the same sentence — the
 * sentence-level, position-aware negation handling that fixes ADV-005
 * (see module doc comment §3). A plain `.test()` cannot distinguish
 * "PT nay chac chan dat ket qua" (reject) from "Khong the dam bao ket
 * qua" (accept) — this can, by checking word order within the sentence. */
function hasUnnegatedMatch(text: string, pattern: RegExp): boolean {
  for (const sentence of splitSentences(text)) {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const re = new RegExp(pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence))) {
      const before = sentence.slice(0, m.index);
      const negated = NEGATION_MARKERS.some((marker) => before.includes(marker));
      if (!negated) return true;
      if (m.index === re.lastIndex) re.lastIndex++; // avoid infinite loop on zero-width matches
    }
  }
  return false;
}

function textOf(n: z.infer<typeof NarrationItemSchema>): string {
  return [n.summary, ...n.strengths, ...n.tradeoffs, n.historicalEvidenceSummary ?? "", n.scientificEvidenceSummary ?? ""].join(" \n ");
}

/**
 * PHASE 4 STATUS (2026-09-14, ADV-001/ADV-005 —
 * docs/codex-ai-agent-regression-3-report.md): Regression #3 proved this
 * category/negation validator — however wide its vocabulary — cannot be the
 * primary defense against free-form LLM prose: 48/50 fresh fourth-generation
 * paraphrases ("formally vetted", "booking should be straightforward",
 * "financially comfortable", "short commute", "observed track record",
 * "pharmacological assistance may explain...") were accepted, because no
 * regex vocabulary generalizes to every future paraphrase of "assert a fact
 * this call has no data for" — that is a category error in the trust
 * boundary, not a coverage gap this function can patch its way out of (see
 * this task's own explicit instruction: do not add the 48 strings, do not
 * grow this into a bigger blacklist).
 *
 * The real fix is `recommendation_claims.ts` + `narrateRecommendations()`
 * below: the LLM no longer writes free-form factual sentences at all — it
 * only selects claim IDs from a deterministic, per-call catalog, and a
 * deterministic renderer (`renderClaim`/`renderNarrationFromClaims`) is the
 * only code that ever produces the text shown to the user. A category with
 * no real per-call grounding field (schedule guarantee, price, location,
 * medical/PED, completed-action, comparative ranking, implied
 * credentials...) has no `ClaimType` and therefore no possible catalog
 * entry — a new paraphrase of an already-closed category has nothing to
 * select, regardless of how it's worded. See that module's own doc comment
 * for the full design.
 *
 * This function itself is KEPT UNCHANGED and still exported — Codex's own
 * evaluator (`run_agentic_evaluation.ts::runNarratorEval` /
 * `runSecondGenerationNarratorEval` / `runFourthGenerationNarratorEval`)
 * calls it directly with hand-built free-form `NarrationItemSchema` objects,
 * and per this task's own §25 instruction ("preserve backward compatibility
 * OR clearly prove why its tested path is no longer reachable") this
 * function must keep behaving exactly as it did for Regression #1/#2's
 * fixtures — it still does (255/255 unchanged). It is intentionally NOT
 * patched for Regression #3's 48 new strings, because doing so would be the
 * exact regex arms race this pass was told to stop, and because the fix
 * that actually matters (production can no longer emit free-form prose at
 * all) makes patching this function irrelevant to real user-facing safety.
 *
 * `narrateRecommendations()` below deliberately does NOT call this function
 * on its own rendered output. It was tried during this pass and rejected:
 * `renderClaim`'s CERTIFICATION sentence ("...có chứng chỉ đã xác minh...")
 * is real, server-owned, fully-grounded text (verified data only, see
 * recommendation_claims.ts), but `CERTIFICATION_CATEGORY`'s unconditional
 * ban below matches the word "chứng chỉ" unconditionally regardless of
 * origin — wiring this validator into the new pipeline would have silently
 * rejected a legitimate, safe, newly-added feature, for a threat model
 * (LLM-invented certificate names) that no longer exists once the renderer
 * is the only thing that ever prints a certificate name. This is the "prove
 * the tested path is no longer reachable" branch of §25, not an oversight:
 * production's user-facing narration text is 100% deterministic-template
 * output from `renderClaim`, never LLM-authored prose, so there is nothing
 * left for a prose validator to usefully check.
 *
 * Pure, deterministic validator — intentionally NOT an LLM (see feasibility
 * audit §69, "Validator should preferentially be deterministic"). Returns
 * the narration unchanged if it passes every check, or null if it must be
 * dropped in favor of the deterministic fallback.
 */
export function validateNarration(
  narration: z.infer<typeof NarrationItemSchema>,
  input: NarrationInputCandidate,
  knownEvidenceIds: Set<string>,
): RecommendationNarration | null {
  const rawText = textOf(narration);
  const text = normalizeForValidation(rawText);
  const reject = (reason: string, extra?: Record<string, unknown>) => {
    logger.warn({ candidateId: narration.candidateId, ...extra }, `[narration-validator] rejected: ${reason}`);
    return null;
  };

  // 1. Certification/credential claims — unconditional reject (negation-
  // aware). Unlike qualitative feedback (below), a certification claim
  // usually names a SPECIFIC credential; the fact that `candidate.
  // certificates` is non-empty does not mean an invented name in the
  // narration matches a real one (regex cannot reliably verify an
  // arbitrary proper-noun match), so an allowlist keyed only on
  // "does any certificate exist" would let a fabricated name through
  // for a candidate that happens to have a real, different certificate —
  // exactly the Regression #1 nar-adv-003 case. Real certificate data is
  // already rendered separately in the UI card.
  if (hasUnnegatedMatch(text, CERTIFICATION_CATEGORY.pattern)) {
    return reject("unverifiable certification claim");
  }

  // 2. Qualitative feedback claims — ALLOWLIST against real grounding:
  // permitted only when this candidate has a real, substantive rating
  // (mirrors scorePT's own reputation-component threshold: reviewCount>=5
  // and a real averageRating). Otherwise unconditional reject.
  const hasFeedbackGrounding = input.candidate.reviewCount >= 5 && input.candidate.averageRating !== null;
  if (!hasFeedbackGrounding && hasUnnegatedMatch(text, FEEDBACK_CATEGORY.pattern)) {
    return reject("unverifiable qualitative feedback claim (no substantive rating on file for this candidate)");
  }

  // 3. Every other unconditional category (negation-aware).
  for (const category of UNCONDITIONAL_CATEGORIES) {
    if (hasUnnegatedMatch(text, category.pattern)) {
      return reject(`unsupported claim: ${category.name}`);
    }
  }

  // 3b. Synthetic-as-real framing — separate function, not the generic
  // loop, because its negation must be checked BETWEEN two keyword parts
  // rather than before the whole match (see hasSyntheticFramedAsReal's
  // own doc comment).
  if (hasSyntheticFramedAsReal(text)) {
    return reject("synthetic data framed as real-world evidence");
  }

  // 4. Location — "tỉnh" checked on diacritic-preserved raw text (see
  // module doc comment §4 for why normalized text caused a real false
  // positive here); every other location token already ran through the
  // normalized UNCONDITIONAL_CATEGORIES loop above.
  if (hasUnnegatedMatch(rawText.toLowerCase(), LOCATION_RAW_RE)) {
    return reject("unverifiable location claim");
  }

  // 5. Historical/cohort outcome claims — wide semantic family, gated on
  // the real cohort being empty (a real, sufficient cohort genuinely
  // licenses this category; see feasibility audit §7). Negation-aware, so
  // "Chua co du du lieu lich su de danh gia." is correctly accepted.
  if (input.history.count === 0 && hasUnnegatedMatch(text, HISTORICAL_OUTCOME_PATTERN)) {
    return reject("historical/cohort outcome claim with zero-count cohort");
  }
  const historicalEvidenceSummary = input.history.count > 0 ? (narration.historicalEvidenceSummary ?? undefined) : undefined;
  if (input.history.count === 0 && narration.historicalEvidenceSummary) {
    return reject("historical evidence claimed with zero-count cohort (dedicated field)");
  }

  // 6. Any percentage mentioned must equal the real compatibility.total —
  // a small local model paraphrasing "72% phù hợp" as "70%" or inventing
  // a number entirely both fail this check. (Numeric identity checks are
  // not negation-sensitive — a wrong number is wrong regardless of
  // surrounding phrasing, and no accept-case in either adversarial suite
  // negates a percentage claim.)
  const realTotal = String(input.compatibility.total);
  let match: RegExpExecArray | null;
  PERCENT_RE.lastIndex = 0;
  while ((match = PERCENT_RE.exec(text))) {
    if (match[1] !== realTotal) {
      return reject("fabricated/mismatched percentage", { claimed: match[1], real: realTotal });
    }
  }

  // 7. Rating/review-count NUMBER claims must match the real candidate
  // data exactly — distinct from the qualitative-feedback-language check
  // in step 2: this catches a fabricated/wrong *number* even when
  // grounding for qualitative feedback exists.
  const starMatch = RATING_STAR_RE.exec(text);
  if (starMatch) {
    const claimed = Number(starMatch[1].replace(",", "."));
    if (input.candidate.averageRating === null || Math.abs(claimed - input.candidate.averageRating) > 0.05) {
      return reject("fabricated/mismatched rating", { claimed, real: input.candidate.averageRating });
    }
  }
  const reviewMatch = RATING_REVIEW_RE.exec(text);
  if (reviewMatch && Number(reviewMatch[1]) !== input.candidate.reviewCount) {
    return reject("fabricated/mismatched review count", { claimed: reviewMatch[1], real: input.candidate.reviewCount });
  }

  // 8. Every cited evidenceRef must be a real, supplied evidence id — an
  // LLM inventing a plausible-looking citation id fails closed.
  const evidenceRefs = narration.evidenceRefs.filter((id) => knownEvidenceIds.has(id));
  if (narration.evidenceRefs.length > 0 && evidenceRefs.length === 0) {
    return reject("no cited evidenceRef matched a real supplied evidence id");
  }
  // scientificEvidenceSummary without any surviving real ref is treated the
  // same as an unsupported claim — drop the field rather than the whole
  // narration, since the summary/strengths/tradeoffs may still be valid.
  const scientificEvidenceSummary = evidenceRefs.length > 0 ? (narration.scientificEvidenceSummary ?? undefined) : undefined;

  return {
    candidateId: narration.candidateId,
    summary: narration.summary,
    strengths: narration.strengths,
    tradeoffs: narration.tradeoffs,
    historicalEvidenceSummary,
    scientificEvidenceSummary,
    uncertainty: narration.uncertainty,
    evidenceRefs,
  };
}

/** Only the categorical, non-numeric fields a confirmed GoalIntent can
 * safely carry (docs/ai-agent-implementation-report.md, "Image ->
 * GoalContext -> Recommendation" — closed 2026-09-14). Extracted
 * defensively (no schema trust) from the loose record `getUserFitnessContext`
 * now passes through — see fitness-agent-tools.ts's contextSchema comment.
 * Never includes anything numeric/measurement-like, matching
 * fitness-goal-vision.service.ts's own safety boundary. */
export type GoalIntentGrounding = {
  primaryGoal?: string;
  muscularity?: string;
  relativeLeanness?: string;
  focusMuscles?: string[];
};

export function extractGoalIntentGrounding(raw: unknown): GoalIntentGrounding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const grounding: GoalIntentGrounding = {};
  if (typeof r.primaryGoal === "string") grounding.primaryGoal = r.primaryGoal;
  if (typeof r.muscularity === "string") grounding.muscularity = r.muscularity;
  if (typeof r.relativeLeanness === "string") grounding.relativeLeanness = r.relativeLeanness;
  if (Array.isArray(r.focusMuscles)) grounding.focusMuscles = r.focusMuscles.filter((m): m is string => typeof m === "string");
  return Object.keys(grounding).length > 0 ? grounding : undefined;
}

// ── Claim selection — the new LLM contract ──────────────────────────────
//
// The LLM's ONLY output is which real, server-built claim ids to show and
// how to order/frame them. `.strict()` on both schemas means any extra
// field an LLM tries to smuggle in (e.g. a free-form "summary" string
// alongside selectedClaimIds — see this task's own §28 free-form-injection
// test) fails the whole batch's Zod parse rather than being silently
// stripped-and-trusted; `callLlmJson` catches that and this module falls
// back to the deterministic default selection for the affected
// candidate(s), never rendering an untrusted field.
const ClaimSelectionSchema = z.object({
  candidateId: z.string().min(1),
  selectedClaimIds: z.array(z.string()).max(12),
  ordering: z.array(z.string()).max(12).optional(),
  emphasis: z.enum(["BALANCED", "GOAL_FIT", "SCHEDULE", "EVIDENCE"]).optional(),
  tone: z.enum(["CONCISE", "SUPPORTIVE"]).optional(),
}).strict();
const ClaimSelectionBatchSchema = z.object({ selections: z.array(ClaimSelectionSchema).max(10) }).strict();

function buildClaimSelectionPrompt(
  candidates: NarrationInputCandidate[],
  catalogsByCandidate: Map<string, GroundedClaim[]>,
  goalIntent?: GoalIntentGrounding,
): string {
  const blocks = candidates.map((c) => ({
    candidateId: c.candidate.id,
    availableClaims: catalogsByCandidate.get(c.candidate.id) ?? [],
  }));
  return [
    "Bạn là bộ phận LỰA CHỌN (selection) của hệ thống khuyến nghị PT của Gymini.",
    "Bạn KHÔNG được viết bất kỳ câu văn giải thích nào. Nhiệm vụ DUY NHẤT: với mỗi PT, chọn ra những claim (theo đúng trường \"id\" đã cho sẵn) thực sự liên quan và đáng nói nhất để giải thích tại sao PT này được xếp hạng như vậy. Toàn bộ câu chữ hiển thị cho người dùng sẽ do hệ thống tự tạo ra từ claim bạn chọn — bạn không viết câu nào cả.",
    "",
    "QUY TẮC BẮT BUỘC:",
    "1. Chỉ được chọn \"id\" xuất hiện trong đúng availableClaims của CHÍNH candidateId đó — không dùng id của PT khác, không tự bịa ra id mới không có trong danh sách.",
    "2. TUYỆT ĐỐI không thêm bất kỳ trường nào khác ngoài: candidateId, selectedClaimIds, ordering (tuỳ chọn), emphasis (tuỳ chọn), tone (tuỳ chọn). Không thêm summary, không thêm description, không thêm câu văn dưới bất kỳ hình thức nào.",
    "3. Chọn khoảng 3-6 claim phù hợp nhất; nếu availableClaims có claim loại INSUFFICIENT_HISTORY, việc chọn hay không chọn nó không quan trọng — hệ thống luôn tự hiển thị nó.",
    "",
    `Danh sách PT và các claim khả dụng cho từng PT (KHÔNG được đổi thứ hạng PT, chỉ chọn claim): ${JSON.stringify(blocks)}`,
    goalIntent
      ? `Mục tiêu hình thể người dùng đã xác nhận (chỉ tham khảo định tính khi chọn emphasis, KHÔNG tạo claim mới): ${JSON.stringify(goalIntent)}`
      : "",
    "",
    'Trả về JSON đúng schema: { "selections": [ { "candidateId": string, "selectedClaimIds": string[], "ordering"?: string[], "emphasis"?: "BALANCED"|"GOAL_FIT"|"SCHEDULE"|"EVIDENCE", "tone"?: "CONCISE"|"SUPPORTIVE" } ] } — một phần tử cho mỗi PT trong danh sách trên, không thêm PT nào khác, không thêm trường nào khác ngoài các trường đã liệt kê.',
  ].filter(Boolean).join("\n");
}

/**
 * Runs claim SELECTION (never prose generation) + deterministically renders
 * the result. Never throws. Every candidate always gets a real,
 * claim-grounded narration — via the live LLM's selection when it succeeds
 * and validates, via `buildDefaultSelection` (no LLM required) otherwise —
 * so this is strictly better than the old "drop the candidate's narration
 * entirely on any failure" behavior, per this task's own §23 instruction.
 * `usedFallback` means "at least one candidate used the deterministic
 * default selection instead of a live, validated LLM selection" — same
 * external meaning as before, callers (fitness-agent.service.ts) are
 * unchanged.
 */
export async function narrateRecommendations(
  candidates: NarrationInputCandidate[],
  evidence: AgentEvidence[],
  opts: { userId: string; goalIntent?: GoalIntentGrounding },
): Promise<{ narrations: RecommendationNarration[]; usedFallback: boolean }> {
  if (!ENABLE_RECOMMENDATION_NARRATION || candidates.length === 0) {
    return { narrations: [], usedFallback: candidates.length > 0 };
  }

  const catalogsByCandidate = new Map(candidates.map((c) => [c.candidate.id, buildClaimCatalog(c, evidence)]));
  const prompt = buildClaimSelectionPrompt(candidates, catalogsByCandidate, opts.goalIntent);
  const result = await callLlmJson(prompt, ClaimSelectionBatchSchema, {
    userId: opts.userId,
    phase: "recommendation_claim_selection",
    numPredict: 800,
    attempts: 2,
    logPrefix: "[recommendation-narrator]",
  });
  const selectionByCandidate = new Map((result?.selections ?? []).map((s) => [s.candidateId, s]));

  const narrations: RecommendationNarration[] = [];
  let usedFallback = false;
  for (const c of candidates) {
    const catalog = catalogsByCandidate.get(c.candidate.id) ?? [];
    const catalogIds = new Set(catalog.map((claim) => claim.id));
    const llmSelection = selectionByCandidate.get(c.candidate.id);
    // Candidate-scoped validation (this task's own §29 cross-candidate
    // attack test): an id that isn't in THIS candidate's own catalog —
    // whether hallucinated or copied from another candidate's block — is
    // dropped here, never rendered.
    const validSelectedIds = (llmSelection?.selectedClaimIds ?? []).filter((id) => catalogIds.has(id));
    const usedDefault = !llmSelection || validSelectedIds.length === 0;
    if (usedDefault) usedFallback = true;
    const finalSelectedIds = usedDefault ? buildDefaultSelection(catalog) : validSelectedIds;

    const rendered = renderNarrationFromClaims(c.candidate.id, catalog, finalSelectedIds, {
      ordering: llmSelection?.ordering,
      tone: llmSelection?.tone,
    });
    narrations.push(rendered);
  }
  return { narrations, usedFallback };
}
