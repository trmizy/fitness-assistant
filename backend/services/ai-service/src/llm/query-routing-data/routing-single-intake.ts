/**
 * Phase 4.7R6A.2 — SINGLE-annotator (A01-only) intake helpers.
 *
 * One real human annotator is NOT inter-annotator evidence. Nothing here computes agreement, kappa, disagreement or
 * adjudication, and the authoritative two-human `human-intake` gate is deliberately left untouched (still fail-closed
 * without A02). These helpers only validate structure and provenance and never modify labels.
 */
import type { Check } from "./routing-provenance";

export const REQUIRED_ATTESTATION_ITEMS: RegExp[] = [
  /i labelled this batch myself/i,
  /did not use .*(chatgpt|claude|qwen|model).*to choose labels/i,
  /did not view the other annotator.?s labels/i,
  /did not see any classifier.*(gold|intended)/i,
  /i used annotation_guidelines_v1/i,
];

export function validateAttestation(md: string, annotatorId: string): Check {
  const errors: string[] = [];
  const id = md.match(/annotator id[^:\n]*:\s*([A-Za-z0-9_-]+)/i)?.[1];
  if (id !== annotatorId) errors.push(`attestation annotator id ${id ?? "missing"} != ${annotatorId}`);
  const lines = md.split(/\r?\n/).filter((l) => /^\s*-\s*\[.\]/.test(l));
  for (const re of REQUIRED_ATTESTATION_ITEMS) {
    const line = lines.find((l) => re.test(l));
    if (!line) errors.push(`attestation item missing: ${re.source}`);
    else if (!/\[\s*[xX]\s*\]/.test(line)) errors.push(`attestation item not affirmed: ${re.source}`);
  }
  return errors.length ? { ok: false, code: "INDEPENDENT_HUMAN_PROVENANCE_REQUIRED", errors } : { ok: true, errors: [] };
}

/** a provenance note that mentions a model / assistant touching the file is acceptable ONLY if it states labels were not changed */
export function checkNormalizationDisclosure(notes: string | undefined): Check {
  if (!notes) return { ok: true, errors: [] };
  if (!/(chatgpt|openai|claude|qwen|assistant|llm|gpt)/i.test(notes)) return { ok: true, errors: [] };
  const statesUnchanged = /no\s+safetylabel\s+or\s+programminglabel\s+values?\s+(were|was)\s+changed/i.test(notes);
  return statesUnchanged
    ? { ok: true, errors: [] }
    : { ok: false, code: "INDEPENDENT_HUMAN_PROVENANCE_REQUIRED", errors: ["provenance notes mention a model/assistant but do not state that no safetyLabel/programmingLabel values were changed"] };
}

const DOMAINS = new Set(["STRENGTH", "HYPERTROPHY", "CATALOG", "RECOVERY", "NUTRITION", "BODY_COMPOSITION", "SUPPLEMENTS", "OOD", "UNKNOWN", ""]);
const TAGS = new Set(["PERSONAL_CURRENT", "RECENT_EVENT", "SYMPTOM", "FUNCTIONAL_LIMITATION", "EXPECTED_TRAINING_RESPONSE", "GENERAL_KNOWLEDGE", "UNCERTAIN"]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** secondary-field checks (domain / tags / uncertain / timestamp); primary labels are never touched here */
export function auditSecondaryFields(rows: Array<Record<string, string>>): Check {
  const errors: string[] = [];
  for (const r of rows) {
    if (!DOMAINS.has(r.domain ?? "")) errors.push(`${r.id}: invalid domain ${r.domain}`);
    for (const t of (r.tags ?? "").split(/[|;,]/).map((x) => x.trim()).filter(Boolean)) if (!TAGS.has(t)) errors.push(`${r.id}: invalid tag ${t}`);
    if (!["true", "false"].includes((r.uncertain ?? "").trim())) errors.push(`${r.id}: uncertain must be true|false (got "${r.uncertain}")`);
    if (r.timestamp && !(ISO.test(r.timestamp) && !Number.isNaN(Date.parse(r.timestamp)))) errors.push(`${r.id}: timestamp not ISO-8601 (${r.timestamp})`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** purely descriptive counts; not a quality measure */
export function descriptiveCounts(rows: Array<Record<string, string>>, column: string): Record<string, number> {
  const c: Record<string, number> = {};
  for (const r of rows) c[r[column]] = (c[r[column]] ?? 0) + 1;
  return c;
}
