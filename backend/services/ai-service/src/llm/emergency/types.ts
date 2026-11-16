/**
 * Bounded emergency-risk engine — public types (M9.5-T1B). PROPOSED contract (M9-B03-SAFETY-ARCHITECTURE.md §3); NOT an approved API.
 * The engine is a PURE, deterministic function of the text: no model, DB, Redis, network, session, profile or other user's data, no mutable state between calls.
 */
export type RiskClass =
  | "IMMEDIATE_EMERGENCY"
  | "POSSIBLE_HIGH_RISK"
  | "HISTORICAL_OR_THIRD_PARTY_CONCERN" // a finished past episode / history; a CURRENT risk of another named person is IMMEDIATE, not this
  | "GENERAL_EDUCATION_OR_HYPOTHETICAL"
  | "NO_EMERGENCY_DETECTED" // the scan COMPLETED and found nothing — not a statement that the message is safe
  | "UNABLE_TO_ASSESS"; // the scan could not be completed (input beyond what the engine accepts, internal error): never read as safe

/** Domains the engine can evidence. The SET is a proposal: OVERDOSE_POISONING and NEUROLOGICAL have no approved response template yet (RESPONSE_POLICY_PENDING). */
export type Domain = "SELF_HARM" | "SEIZURE" | "HEAT_ILLNESS" | "OVERDOSE_POISONING" | "NEUROLOGICAL";
export type Subject = "SELF" | "OTHER" | "GENERIC" | "UNKNOWN";
export type Tense = "PRESENT_OR_RECENT" | "PAST_FINISHED" | "HYPOTHETICAL" | "UNKNOWN";
/** What happened to a piece of evidence. Only COUNTED_* evidence can raise the risk class; everything else is kept for audit (never silently dropped). */
export type Disposition =
  | "COUNTED_IMMEDIATE" | "COUNTED_POSSIBLE"
  | "NEGATED" | "PAST" | "HYPOTHETICAL_OTHER" | "EDUCATION" | "FICTION" | "GENERIC_SUBJECT" | "BENIGN_HYPERBOLE" | "MUSCLE_TWITCH" | "NO_SUBJECT" | "UNPAIRED";

export interface Evidence {
  domain: Domain;
  subject: Subject;
  /** the person the evidence is about, as written in the text ("bạn tôi", "my friend"); "" for SELF / UNKNOWN. Two different persons are never merged. */
  subjectKey: string;
  tense: Tense;
  negated: boolean;
  /** offsets into the RAW input (UTF-16 code units), end exclusive */
  span: { start: number; end: number };
  clause: number;
  lexicon: string;
  disposition: Disposition;
}

export type Uncertainty = "NONE" | "AMBIGUOUS_WORDING" | "INPUT_LIMIT" | "INTERNAL_ERROR";

export interface EmergencyAssessment {
  riskClass: RiskClass;
  /** the domain that decides the response (highest policy rank among COUNTED evidence), null when nothing is counted */
  domain: Domain | null;
  subject: Subject | null;
  evidence: Evidence[];
  uncertainty: Uncertainty;
  inputUnits: number;
  /** false when the text is longer than `maxUnits` (the engine still scanned it completely when it was within `hardCeilingUnits`) */
  withinLimit: boolean;
  /** true when a complete scan was performed (always false for UNABLE_TO_ASSESS) */
  scanned: boolean;
}

export interface AssessOptions {
  /** the HTTP boundary limit (UTF-16 code units); default 2000 */
  maxUnits?: number;
  /** the largest input the engine will scan at all; default 200 000. Beyond it the result is UNABLE_TO_ASSESS (never safe). */
  hardCeilingUnits?: number;
}

export const DEFAULT_MAX_UNITS = 2000;
export const DEFAULT_HARD_CEILING_UNITS = 200_000;
