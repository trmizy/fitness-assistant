/**
 * assessEmergency — the pure core (M9.5-T1B). Contract: M9-B03-SAFETY-ARCHITECTURE.md §3 (PROPOSED).
 *   • pure and deterministic: no I/O, no model, no module-level mutable state (the lexicon is built once and never written);
 *   • never silently drops a signal: every match is examined and recorded with a disposition; there is NO event cap;
 *   • never reads "nothing matched" as "safe": the best outcome is NO_EMERGENCY_DETECTED, and an unfinished / impossible scan is UNABLE_TO_ASSESS;
 *   • over-limit input: the engine scans it COMPLETELY up to `hardCeilingUnits` (so a dangerous final span is found), reports `withinLimit:false`, and returns
 *     UNABLE_TO_ASSESS when it found no evidence (the boundary — zod / checkInputSafety — is what rejects over-limit input; the engine never claims it is clear);
 *     beyond the ceiling it does not scan at all (UNABLE_TO_ASSESS / INPUT_LIMIT).
 * Both normalization views are evaluated on every call; with accented text the accent-aware view decides for a span both views see, the accent-less view only adds
 * spans the accent-aware one could not read (partially accented writing).
 */
import { DEFAULT_HARD_CEILING_UNITS, DEFAULT_MAX_UNITS, type AssessOptions, type EmergencyAssessment, type Evidence, type Uncertainty } from "./types";
import { normalizeForEmergency } from "./normalize";
import { extractEvidence, type RawEvidence } from "./evidence";
import { decideRisk } from "./policy";

const unable = (uncertainty: Uncertainty, units: number, withinLimit: boolean, scanned: boolean, evidence: Evidence[] = []): EmergencyAssessment =>
  ({ riskClass: "UNABLE_TO_ASSESS", domain: null, subject: null, evidence, risks: [], uncertainty, inputUnits: units, withinLimit, scanned });

export function assessEmergency(rawText: unknown, options: AssessOptions = {}): EmergencyAssessment {
  const maxUnits = options.maxUnits ?? DEFAULT_MAX_UNITS, ceiling = options.hardCeilingUnits ?? DEFAULT_HARD_CEILING_UNITS;
  try {
    if (typeof rawText !== "string") return unable("INTERNAL_ERROR", 0, false, false);
    const units = rawText.length; const withinLimit = units <= maxUnits;
    if (units > ceiling) return unable("INPUT_LIMIT", units, false, false);
    const nv = normalizeForEmergency(rawText);
    const toEvidence = (r: RawEvidence, view: { start: Int32Array; end: Int32Array }): Evidence => ({
      domain: r.domain, subject: r.subject, subjectKey: r.subjectKey, referenceAmbiguous: r.referenceAmbiguous, tense: r.tense, negated: r.negated, clause: r.clause, lexicon: r.lexicon, disposition: r.disposition,
      span: { start: view.start[r.start] ?? 0, end: view.end[Math.max(0, r.end - 1)] ?? 0 },
    });
    const ascii = extractEvidence(nv.ascii, true, nv.hasMarks).map((r) => toEvidence(r, nv.ascii));
    let evidence: Evidence[];
    if (!nv.hasMarks) evidence = ascii; // no diacritics anywhere: both views are the same text
    else {
      const accented = extractEvidence(nv.nfc, false, true).map((r) => toEvidence(r, nv.nfc));
      const seen = new Set(accented.map((e) => `${e.domain}:${e.span.start}`));
      evidence = [...accented, ...ascii.filter((e) => !seen.has(`${e.domain}:${e.span.start}`))];
    }
    const decision = decideRisk(evidence);
    if (!withinLimit && decision.riskClass !== "IMMEDIATE_EMERGENCY" && decision.riskClass !== "POSSIBLE_HIGH_RISK") return unable("INPUT_LIMIT", units, false, true, evidence);
    return { ...decision, evidence, inputUnits: units, withinLimit, scanned: true };
  } catch {
    return unable("INTERNAL_ERROR", typeof rawText === "string" ? rawText.length : 0, false, false); // fail closed: an engine fault is never "no emergency"
  }
}
export { DOMAIN_RANK } from "./policy";
export type { EmergencyAssessment, Evidence, RiskClass, Domain, Subject } from "./types";
