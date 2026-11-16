/**
 * Priority policy (M9.5-T1B) — emergency precedence as DATA, not as the order of regexes or `if` statements. PROPOSED: the ranks and the class mapping are a design
 * proposal pending the owner's approval of the domain set (OVERDOSE_POISONING and NEUROLOGICAL especially: POLICY GAP).
 * Rule: any COUNTED_IMMEDIATE evidence makes the message IMMEDIATE_EMERGENCY and beats every non-emergency rule (weight loss, minors' nutrition, off-topic, injection,
 * diagnosis). Among emergencies the lower rank decides the response; within SELF_HARM a SELF subject decides before OTHER.
 */
import type { Domain, EmergencyAssessment, Evidence, RiskClass, Subject, Uncertainty } from "./types";

export const DOMAIN_RANK: Readonly<Record<Domain, number>> = Object.freeze({ SELF_HARM: 1, OVERDOSE_POISONING: 2, SEIZURE: 3, NEUROLOGICAL: 4, HEAT_ILLNESS: 5 });

const pick = (list: Evidence[]): { domain: Domain; subject: Subject } | null => {
  if (!list.length) return null;
  const best = Math.min(...list.map((e) => DOMAIN_RANK[e.domain]));
  const top = list.filter((e) => DOMAIN_RANK[e.domain] === best);
  const domain = top[0].domain;
  // a SELF subject decides before another person within the same domain
  const subject = top.some((e) => e.subject === "SELF") ? "SELF" : top[0].subject;
  return { domain, subject };
};

/** Aggregates the per-event evidence into one assessment (evidence of different subjects is never merged: pairing already happened per subject upstream). */
export function decideRisk(evidence: Evidence[]): Pick<EmergencyAssessment, "riskClass" | "domain" | "subject" | "uncertainty"> {
  const immediate = evidence.filter((e) => e.disposition === "COUNTED_IMMEDIATE");
  const possible = evidence.filter((e) => e.disposition === "COUNTED_POSSIBLE");
  let riskClass: RiskClass = "NO_EMERGENCY_DETECTED"; let uncertainty: Uncertainty = "NONE"; let chosen: ReturnType<typeof pick> = null;
  if (immediate.length) { riskClass = "IMMEDIATE_EMERGENCY"; chosen = pick(immediate); }
  else if (possible.length) { riskClass = "POSSIBLE_HIGH_RISK"; uncertainty = "AMBIGUOUS_WORDING"; chosen = pick(possible); }
  else if (evidence.some((e) => e.disposition === "PAST")) riskClass = "HISTORICAL_OR_THIRD_PARTY_CONCERN";
  else if (evidence.some((e) => ["EDUCATION", "HYPOTHETICAL_OTHER", "GENERIC_SUBJECT", "FICTION", "BENIGN_HYPERBOLE"].includes(e.disposition))) riskClass = "GENERAL_EDUCATION_OR_HYPOTHETICAL";
  return { riskClass, domain: chosen?.domain ?? null, subject: chosen?.subject ?? null, uncertainty };
}
