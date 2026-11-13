/**
 * Gymini V2 (EXPERIMENTAL) — minor (<18) safety gate for the Training Agent (P4 prerequisite, Gate 1).
 *
 * Runs in the controller BEFORE any model round and BEFORE any tool is offered; the model never sees or decides the age.
 * Reuses the V1 policy, no copies of its rules:
 *   - who is a minor: V1 TurnFacts semantics (llm/turn_facts.ts) — profile age, an age stated in this turn, an age stated
 *     earlier in this conversation; the MINOR reading wins whenever any source says < 18 (profile 16 + "tôi 20" → minor,
 *     profile 20 + "tôi 15" → minor). A HYPOTHETICAL minor age ("giả sử em 16 tuổi") also counts (conservative, as V1's
 *     minor_safety_policy). NEGATED / UNKNOWN ages never count.
 *   - what kind of request: classifyMinorRequest (llm/minor_safety_policy.ts) — GENERAL_KNOWLEDGE / PERSONAL_ADVICE /
 *     PLAN_REQUEST / HIGH_RISK.
 *   - the answers: safetyGuard.minorAgeResult() (minors' triage) and minorGeneralInfoPromptNote / appendMinorSupervisionNote
 *     (llm/medical-referral.ts) for a general question.
 *
 * Age sources and their trust:
 *   PROFILE       the user's saved profile, read server-side with the caller's OWN Authorization header (user-service
 *                 GET /profile/me via V1 profileExtractor; see readVerifiedProfileAge). The only verified source.
 *   CURRENT_TURN / HISTORY   what the user typed. Self-reported: it can only make the gate STRICTER (a stated minor age), never
 *                 lift a minor profile age.
 *   MODEL         never read. The verdict is fixed before the first model round; tool results carry no age.
 *
 * Decision (pure, `decideMinorGate`):
 *   MINOR       + GENERAL_KNOWLEDGE that needs none of the user's own data → general answer: non-personal tools only, the V1
 *                 minor prompt note, supervision line appended to the answer.
 *   MINOR       + anything else (PERSONAL_ADVICE / PLAN_REQUEST / HIGH_RISK, or a question about their own plan/schedule)
 *                 → minorAgeResult(), no model call, no tool call.
 *   UNVERIFIED  (profile read failed / not permitted / malformed, and no stated minor age)
 *                 + GENERAL_KNOWLEDGE without own-data needs → general answer with non-personal tools only.
 *                 + anything else → refuse personal advice until the profile can be read (fail closed — stricter than V1,
 *                   which keeps the question-only result when the lookup fails).
 *   ADULT / UNKNOWN (profile read OK; profile age ≥ 18 or not set, no stated minor age) → normal agent (V1 parity: V1 also
 *                 treats a user without any age as not-a-minor).
 */
import { profileExtractor } from "../llm/profile_extractor";
import { safetyGuard } from "../llm/safety_guard";
import { classifyMinorRequest, type MinorRequestCategory } from "../llm/minor_safety_policy";
import { extractFactsFromText } from "../llm/turn_facts";
import { findAgeMentions } from "./vietnamese-age";

export type ProfileAgeRead =
  | { status: "OK"; age: number | null }
  | { status: "FAILED"; reason: string };

/** Reads the age from the authenticated user's own profile. Must never throw (a throw is treated as FAILED anyway). */
export type VerifiedProfileAgeReader = (ctx: { userId: string; authorizationHeader?: string }) => Promise<ProfileAgeRead>;

const validAge = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 120 ? v : null);

/**
 * Default reader: the EXISTING V1 read V1's own minor policy uses (orchestrator `resolveProfileAwareSafety` →
 * `profileExtractor.extract(userId, authHeader).profile.age` = user-service GET /profile/me with the caller's own token).
 * agent-v2 has no HTTP of its own (static isolation rule), so it goes through that V1 function.
 * KNOWN LIMIT (stated, not hidden): profileExtractor swallows a failed /profile/me (allSettled) and returns no age, so with this
 * default a 401/403/outage reads as "no age set" (UNKNOWN → V1 parity), not as UNVERIFIED. Missing credentials and a thrown
 * extractor ARE reported as FAILED. A reader that reports the failure (FAILED → fail closed) is injected via
 * `TrainingAgentDeps.getVerifiedProfileAge`; a V1-side failure-reporting read is a P4 wiring item (V1 change, needs approval).
 */
export const readVerifiedProfileAge: VerifiedProfileAgeReader = async (ctx) => {
  if (typeof ctx.authorizationHeader !== "string" || !ctx.authorizationHeader) return { status: "FAILED", reason: "no_credentials" };
  try {
    const personal = await profileExtractor.extract(ctx.userId, ctx.authorizationHeader);
    if (!personal || typeof personal !== "object" || !personal.profile || typeof personal.profile !== "object") return { status: "FAILED", reason: "malformed_profile" };
    return { status: "OK", age: validAge(personal.profile.age) };
  } catch {
    return { status: "FAILED", reason: "unavailable" };
  }
};

export type AgeGateStatus = "MINOR" | "ADULT" | "UNKNOWN" | "UNVERIFIED";
export type AgeSource = "PROFILE" | "CURRENT_TURN" | "HISTORY";

export interface AgeVerdict {
  status: AgeGateStatus;
  /** Which sources said < 18 (empty unless MINOR). */
  minorBy: AgeSource[];
  /** The profile and a stated age disagree across the 18 boundary. */
  conflict: boolean;
  profileRead: "OK" | "FAILED";
  /**
   * M7-P5A.2.3: an AMBIGUOUS age expression (e.g. "Chào anh em mười lăm tuổi") exists in the question or the history user texts,
   * no explicit under-18 age exists anywhere and the status is not MINOR. It never persists a restriction and never changes
   * `status`; the supervisor keeps the turn unresolved (no routing-model call, no personalised recommendation).
   * Defined NON-ENUMERABLE (readable as `verdict.ambiguous`, ignored by deepEqual / JSON / spread) so that consumers and tests
   * written before this field existed keep their exact-shape expectations. Read it explicitly; do not rely on `{ ...verdict }`.
   * Always set by `resolveAgeVerdict`; typed optional ONLY so that hand-built AgeVerdict literals (decideMinorGate tests) still compile.
   */
  readonly ambiguous?: boolean;
}

/** What a text says about an age (M7-P5A.2.3). Exposed for tests; the verdict below uses the same classification. */
export interface StatedAgeClass {
  /** Ages the user states about THEMSELVES (first person; V1 rules: negated / unknown ages excluded; hypothetical counted). */
  explicit: number[];
  /** An ambiguous expression with a potential minor age (< 18) exists and there is NO explicit under-18 age in the text. */
  ambiguous: boolean;
  /** An age was stated about a third party ("Con tôi 15 tuổi", "học sinh 15 tuổi") — never the user's age. */
  thirdParty: boolean;
}

/**
 * Sentence by sentence: every age expression of the text (digits, words, "mới 13") is located and its owner decided
 * (vietnamese-age.ts: FIRST / THIRD / AMBIGUOUS); each supported one is read by the SAME V1 extraction on a copy of its sentence
 * in which the other age expressions are blanked, so negation / hypothetical / approximation rules apply unchanged. THIRD
 * mentions are never read (V1 alone would read "Con tôi 15 tuổi" as the user's age) and AMBIGUOUS ones are counted separately.
 * `residual` = V1 on the text with all recognised expressions blanked: an age shape this module does not locate keeps V1 parity.
 */
export function classifyStatedAge(text: string): StatedAgeClass {
  const usable = (f: { status?: string; value: number } | undefined): number | null => (!f || f.status === "NEGATED" || f.status === "UNKNOWN" ? null : f.value);
  try {
    const { mentions, residual } = findAgeMentions(text);
    const explicit: number[] = [];
    const ambiguousAges: number[] = [];
    let thirdParty = false;
    for (const m of mentions) {
      const raw = usable(extractFactsFromText(m.text).ageYears);
      if (raw === null) continue;
      const value = m.sentinel ? raw - 60 : raw; // digit ages below 10 were written as value+60 (V1 ignores them)
      if (value < 1 || value > 99) continue;
      if (m.subject === "THIRD") thirdParty = true;
      else if (m.subject === "AMBIGUOUS") ambiguousAges.push(value);
      else explicit.push(value);
    }
    const rest = usable(extractFactsFromText(residual).ageYears);
    if (rest !== null) explicit.push(rest);
    return { explicit, ambiguous: ambiguousAges.some((a) => a < 18) && !explicit.some((a) => a < 18), thirdParty };
  } catch {
    // never fail open: the V1 reading of the whole text is the previous behaviour
    try {
      const v = usable(extractFactsFromText(String(text ?? "")).ageYears);
      return { explicit: v === null ? [] : [v], ambiguous: false, thirdParty: false };
    } catch {
      return { explicit: [], ambiguous: false, thirdParty: false };
    }
  }
}

/** ONLY explicit first-person ages (session persistence stays strict: ambiguous and third-party ages are never in this list). */
function statedAges(text: string): number[] {
  return classifyStatedAge(text).explicit;
}

/** M7-P3: the user stated (or hypothesised) an age under 18 about themselves in this text. Same parser and rules as the verdict below. */
export function statesMinorAge(text: string): boolean {
  return statedAges(text).some((a) => a < 18);
}

/** M7-P5A.2.3: the text holds an AMBIGUOUS age expression (potential minor) and NO explicit under-18 age. Never persists anything. */
export function statesAmbiguousAge(text: string): boolean {
  return classifyStatedAge(text).ambiguous;
}

/**
 * Pure. `historyUserTexts` = earlier USER turns of this conversation only (assistant text is never an age source).
 * M7-P3: `sessionMinorStatement` = the persisted session holds the user's own earlier statement of an age under 18
 * (a USER_REPORTED entry, written by the supervisor — never a profile age). Counted as HISTORY: it can only make the
 * verdict stricter, never lift a minor profile age, and a later adult claim does not cancel it.
 */
export function resolveAgeVerdict(profile: ProfileAgeRead, question: string, historyUserTexts: readonly string[] = [], sessionMinorStatement = false): AgeVerdict {
  const profileAge = profile.status === "OK" ? profile.age : null;
  const currentClass = classifyStatedAge(question);
  const historyClasses = historyUserTexts.map(classifyStatedAge);
  const current = currentClass.explicit;
  const history = historyClasses.flatMap((c) => c.explicit);
  const minorBy: AgeSource[] = [];
  if (profileAge !== null && profileAge < 18) minorBy.push("PROFILE");
  if (current.some((a) => a < 18)) minorBy.push("CURRENT_TURN");
  if (history.some((a) => a < 18) || sessionMinorStatement) minorBy.push("HISTORY");
  const stated = [...current, ...history];
  const conflict = profileAge !== null && (stated.some((a) => (a < 18) !== (profileAge < 18)) || (sessionMinorStatement && profileAge >= 18));
  const status: AgeGateStatus = minorBy.length ? "MINOR" : profile.status === "FAILED" ? "UNVERIFIED" : profileAge === null ? "UNKNOWN" : "ADULT";
  const verdict = { status, minorBy, conflict, profileRead: profile.status } as AgeVerdict;
  const ambiguous = status !== "MINOR" && (currentClass.ambiguous || historyClasses.some((c) => c.ambiguous));
  Object.defineProperty(verdict, "ambiguous", { value: ambiguous, enumerable: false, writable: false });
  return verdict;
}

export type MinorGateDecision =
  | { action: "PROCEED" }
  | { action: "GENERAL_ONLY"; addMinorNote: boolean }
  | { action: "BLOCK"; status: "MINOR_PROTECTED" | "PROFILE_UNVERIFIED"; message: string };

export const PROFILE_UNVERIFIED_MESSAGE =
  "Mình chưa xác minh được hồ sơ của bạn nên chưa thể tư vấn cá nhân về tập luyện lúc này. Bạn có thể hỏi kiến thức tập luyện chung, hoặc thử lại sau ít phút nhé.";

/** Tools a general-information answer may use: catalog / evidence only — nothing about the user. */
export const NON_PERSONAL_TOOL_IDS: ReadonlySet<string> = new Set([
  "training.search_exercise", "training.list_exercises", "training.get_exercise_muscle_profiles", "training.get_scientific_evidence",
]);

/** Pure. `needsOwnData` = the question asks about the user's own plan / schedule / cycle / equipment. */
export function decideMinorGate(verdict: AgeVerdict, category: MinorRequestCategory, needsOwnData: boolean): MinorGateDecision {
  const general = category === "GENERAL_KNOWLEDGE" && !needsOwnData;
  if (verdict.status === "MINOR") {
    return general
      ? { action: "GENERAL_ONLY", addMinorNote: true }
      : { action: "BLOCK", status: "MINOR_PROTECTED", message: (safetyGuard.minorAgeResult() as { messageVi: string }).messageVi };
  }
  if (verdict.status === "UNVERIFIED") {
    return general ? { action: "GENERAL_ONLY", addMinorNote: false } : { action: "BLOCK", status: "PROFILE_UNVERIFIED", message: PROFILE_UNVERIFIED_MESSAGE };
  }
  return { action: "PROCEED" };
}

export { classifyMinorRequest };
