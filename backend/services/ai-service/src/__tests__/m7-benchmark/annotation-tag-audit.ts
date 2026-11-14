/**
 * M7-P5A2 — TAG AUDIT TRAIL (owner decision Q3, 2026-11-15). The curator owns tags; annotators never see them (the files
 * given to annotators carry id, question, accented only) and the curator never sees router predictions. After the curator
 * prepared `questions.jsonl`, the ONLY way to change a tag is an entry in `tag-audit.jsonl` (append-only, numbered):
 *
 *   {"schemaVersion":"m7-p5a2","seq":1,"id":"Q-0001","from":["minor"],"to":["minor","review"],"reason":"…","curatorId":"C01","confirmedBy":"J03"}
 *
 *   - `from` must equal the tags the case has at that point (original tags, then earlier entries applied in seq order);
 *   - a change that adds / removes a GOVERNED tag (safety consistency, the Q5 identification, scoring / quotas) needs
 *     `confirmedBy` = the adjudicator, before freeze;
 *   - the curator edits TAGS ONLY: any label / rationale / adjudication key in an entry is refused;
 *   - the curator is a separate role (never annotator A / B, never the adjudicator).
 *
 * Pure: no I/O, no network; never mutates its inputs; it never invents a tag. A file with any error yields `tags: null`
 * (the merge refuses). It proves CONSISTENCY of declared ids, not who a person is.
 */
import { GOVERNED_TAGS, LABEL_KEYS, SCHEMA_VERSION, TAGS, isValidLabelerId, labelerRoleKey, type Finding } from "./annotation-schema";
import { findDuplicateKeys } from "./annotation-json";
import { humanTextProblem } from "./annotation-validator";

export const TAG_AUDIT_KEYS = ["schemaVersion", "seq", "id", "from", "to", "reason", "curatorId", "confirmedBy"] as const;
/** Keys that would mean the curator touches a LABEL (refused with TAG_AUDIT_LABEL_EDIT_FORBIDDEN). */
export const LABEL_EDIT_KEYS = [...LABEL_KEYS, "annotatorA", "annotatorB", "adjudication", "final", "rationale", "rationaleBy", "routingScored", "annotatorId", "decision"] as const;

export interface TagAuditRoles {
  /** Role keys (or raw ids) of annotator A and B. */
  annotators: readonly string[];
  /** The adjudicator id (confirms governed changes); null = unknown → a governed change cannot be confirmed. */
  adjudicator: string | null;
}
export interface TagAuditResult {
  ok: boolean;
  errors: Finding[];
  /** The tags after replaying every entry (ids without entries keep their original tags); null when ok is false. */
  tags: Map<string, string[]> | null;
  entries: number;
  curatorId: string | null;
  /** ids whose tags changed, with the governed tags added / removed. */
  changes: Array<{ id: string; seq: number; added: string[]; removed: string[]; governed: boolean; confirmedBy: string | null }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

function tagList(v: unknown, where: string, err: (code: string, d: string) => void): string[] | null {
  if (!Array.isArray(v)) { err("TAG_AUDIT_INVALID_TAGS", `${where} must be an array of tags`); return null; }
  let ok = true;
  for (const t of v) if (typeof t !== "string" || !(TAGS as readonly string[]).includes(t)) { err("TAG_AUDIT_INVALID_TAGS", `${where}: ${JSON.stringify(t)} is not one of ${TAGS.join("|")}`); ok = false; }
  if (new Set(v).size !== v.length) { err("TAG_AUDIT_INVALID_TAGS", `${where} contains a duplicate`); ok = false; }
  return ok ? (v as string[]) : null;
}

/**
 * Replays `auditText` (JSONL; empty text = no change) over `original` (id → tags from questions.jsonl).
 */
export function replayTagAudit(original: ReadonlyMap<string, readonly string[]>, auditText: string, roles: TagAuditRoles): TagAuditResult {
  const errors: Finding[] = [];
  const current = new Map<string, string[]>([...original].map(([k, v]) => [k, [...v]]));
  const changes: TagAuditResult["changes"] = [];
  const annotatorKeys = roles.annotators.map(labelerRoleKey);
  const adjKey = roles.adjudicator ? labelerRoleKey(roles.adjudicator) : null;
  let curator: { raw: string; line: number } | null = null;
  let expectedSeq = 1;
  let entries = 0;

  auditText.split(/\r?\n/).forEach((text, idx) => {
    if (!text.trim()) return;
    const line = idx + 1;
    let row: unknown;
    try { row = JSON.parse(text); } catch (e) { errors.push({ line, id: null, code: "MALFORMED_JSON", detail: (e as Error).message }); return; }
    if (!isObj(row)) { errors.push({ line, id: null, code: "NOT_OBJECT", detail: "line is not a JSON object" }); return; }
    const id = typeof row.id === "string" && row.id.length ? row.id : null;
    const err = (code: string, detail: string) => errors.push({ line, id, code, detail });
    const dup = findDuplicateKeys(text);
    if (dup.tooDeep || dup.duplicates.length) { err("DUPLICATE_JSON_KEY", "duplicate key or nesting too deep; entry not applied"); return; }
    entries++;

    for (const k of Object.keys(row)) {
      if ((TAG_AUDIT_KEYS as readonly string[]).includes(k)) continue;
      if ((LABEL_EDIT_KEYS as readonly string[]).includes(k)) err("TAG_AUDIT_LABEL_EDIT_FORBIDDEN", `key '${k}': the curator edits tags only, never labels, rationales or adjudications (Q3)`);
      else err("UNEXPECTED_KEY", `unexpected key '${k}'`);
    }
    if (row.schemaVersion !== SCHEMA_VERSION) err("SCHEMA_VERSION", `schemaVersion must be "${SCHEMA_VERSION}", got ${JSON.stringify(row.schemaVersion)}`);
    if (row.seq !== expectedSeq) err("TAG_AUDIT_SEQ", `seq must be ${expectedSeq} (entries are numbered 1, 2, 3 … in file order; nothing may be removed or reordered), got ${JSON.stringify(row.seq)}`);
    expectedSeq = (typeof row.seq === "number" && Number.isInteger(row.seq) ? row.seq : expectedSeq) + 1;

    // curator
    if (!isValidLabelerId(row.curatorId)) err("TAG_AUDIT_CURATOR", `curatorId ${JSON.stringify(row.curatorId)} missing or not a valid human pseudonym`);
    else {
      if (!curator) curator = { raw: row.curatorId, line };
      else if (labelerRoleKey(row.curatorId) !== labelerRoleKey(curator.raw)) err("ROLE_ID_INCONSISTENT", `curatorId ${row.curatorId} differs from ${curator.raw} (line ${curator.line}); one curator id across the audit`);
      if (annotatorKeys.includes(labelerRoleKey(row.curatorId))) err("ROLE_CONFLICT", `curatorId ${row.curatorId} is also an annotator; annotators must never see tags (Q3)`);
      if (adjKey && labelerRoleKey(row.curatorId) === adjKey) err("ROLE_CONFLICT", `curatorId ${row.curatorId} is also the adjudicator; a governed change needs a second person's confirmation`);
    }
    if (typeof row.reason !== "string" || !row.reason.trim()) err("TAG_AUDIT_REASON", "reason missing or empty");
    else { const p = humanTextProblem(row.reason); if (p) err("TAG_AUDIT_REASON", `reason ${p}`); }

    const from = tagList(row.from, "from", err);
    const to = tagList(row.to, "to", err);
    if (!id) { err("TAG_AUDIT_UNKNOWN_ID", "id missing"); return; }
    const cur = current.get(id);
    if (!cur) { err("TAG_AUDIT_UNKNOWN_ID", `id ${id} is not in the curated question file`); return; }
    if (!from || !to) return;
    if (!sameSet(from, cur)) { err("TAG_AUDIT_STALE_FROM", `from ${JSON.stringify(from)} does not match the current tags ${JSON.stringify(cur)} of ${id}`); return; }
    if (sameSet(from, to)) { err("TAG_AUDIT_NO_CHANGE", "from and to are the same set"); return; }
    const added = to.filter((t) => !from.includes(t)), removed = from.filter((t) => !to.includes(t));
    const governed = [...added, ...removed].some((t) => (GOVERNED_TAGS as readonly string[]).includes(t));
    let confirmedBy: string | null = null;
    if (row.confirmedBy !== undefined) {
      if (!isValidLabelerId(row.confirmedBy)) err("TAG_AUDIT_CONFIRMATION_INVALID", `confirmedBy ${JSON.stringify(row.confirmedBy)} is not a valid human pseudonym`);
      else if (!adjKey) err("TAG_AUDIT_CONFIRMATION_INVALID", "confirmedBy is given but the adjudicator id is unknown, so it cannot be checked");
      else if (labelerRoleKey(row.confirmedBy) !== adjKey) err("TAG_AUDIT_CONFIRMATION_INVALID", `confirmedBy ${row.confirmedBy} is not the adjudicator (${roles.adjudicator})`);
      else confirmedBy = row.confirmedBy;
    } else if (governed) err("TAG_AUDIT_CONFIRMATION_MISSING", `change of governed tag(s) ${[...added, ...removed].filter((t) => (GOVERNED_TAGS as readonly string[]).includes(t)).join(", ")} needs confirmedBy = the adjudicator before freeze (Q3)`);
    current.set(id, [...to]);
    changes.push({ id, seq: row.seq as number, added, removed, governed, confirmedBy });
  });

  return { ok: errors.length === 0, errors, tags: errors.length === 0 ? current : null, entries, curatorId: curator ? (curator as { raw: string }).raw : null, changes };
}
