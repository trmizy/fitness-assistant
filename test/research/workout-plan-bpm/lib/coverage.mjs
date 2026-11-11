// FR / EX / AC coverage matrix. Derived from the FROZEN dataset tags and the design-doc ID lists. No model output is used,
// so coverage status cannot depend on whether a case passed.
//
// Status rules (declared):
//   UNTESTED          no dataset case carries the ID in its fr[] / ac[] tags.
//   COVERED           at least one tagged case is FULLY SCORABLE: every gold turn uses only fields the evaluator scores
//                     (route, route_family, intent, write, slots, end_state) — i.e. missing_slots, correction, reference
//                     and constraints are all empty/null for that case.
//   PARTIALLY_COVERED tagged, but every tagged case carries a gold field the evaluator does NOT score automatically.
//
// Measured outcome per ID (pass rate over tagged cases) is reported next to the status, never folded into it.
import fs from "node:fs";
import path from "node:path";

export function idsFromDocs(repoRoot) {
  const dir = path.join(repoRoot, "docs", "research", "workout-plan-bpm");
  const grab = (file, re) => [...new Set((fs.readFileSync(path.join(dir, file), "utf8").match(re) ?? []))].sort();
  return {
    FR: grab("04-functional-requirements.md", /\bFR\d{2}\b/g),
    EX: grab("05-exception-catalogue.md", /\bEX\d{2}\b/g),
    AC: grab("06-acceptance-criteria.md", /\bAC\d{2}\b/g),
  };
}

const NOT_SCORED = (turn) => {
  const g = turn.gold;
  const constraintsSet = g.constraints && Object.values(g.constraints).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined));
  return (Array.isArray(g.missing_slots) && g.missing_slots.length > 0) || g.correction !== null || g.reference !== null || constraintsSet;
};
export const fullyScorable = (c) => c.turns.every((t) => !NOT_SCORED(t));

export function coverage({ dataset, docIds, outcomesByCase }) {
  const rows = {};
  for (const kind of ["FR", "EX", "AC"]) {
    for (const id of docIds[kind]) {
      const tagged = dataset.filter((c) => (kind === "AC" ? c.ac : c.fr).includes(id) || (kind === "EX" && c.ex?.includes(id)));
      let status;
      if (tagged.length === 0) status = "UNTESTED";
      else if (tagged.some(fullyScorable)) status = "COVERED";
      else status = "PARTIALLY_COVERED";
      const correct = tagged.filter((c) => outcomesByCase?.[c.case_id] === true).length;
      const measured = outcomesByCase ? tagged.filter((c) => outcomesByCase[c.case_id] !== undefined).length : 0;
      rows[id] = { kind, status, taggedCases: tagged.map((c) => c.case_id), taggedCount: tagged.length, measuredCount: measured, correctCount: correct, passRate: measured ? correct / measured : null };
    }
  }
  return rows;
}
