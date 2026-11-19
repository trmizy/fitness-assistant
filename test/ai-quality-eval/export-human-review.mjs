// Blind human-review export for a run of run-nutrition-eval.mjs. Offline: reads the result JSON + case spec only.
//
//   node test/ai-quality-eval/export-human-review.mjs <results.json> <cases.json> [seed]
//
// Writes <results>.human-review.csv (what the reviewer sees) and <results>.human-review-key.json (kept by the organiser).
// The CSV is BLIND: rows are shuffled with a fixed seed, each row has an opaque review id (no case id, no regression/holdout
// set, no responseSource, no CC-rater or judge score). The key maps review ids back to case ids for scoring afterwards.
// Score fields are left empty for the human reviewer; failure tags are a fixed vocabulary.
import fs from "node:fs";
import path from "node:path";

const [resultsFile, casesFile, seedArg] = process.argv.slice(2);
if (!resultsFile || !casesFile) { console.error("usage: export-human-review.mjs <results.json> <cases.json> [seed]"); process.exit(2); }
const results = JSON.parse(fs.readFileSync(resultsFile, "utf8")).results ?? [];
const spec = JSON.parse(fs.readFileSync(casesFile, "utf8"));
const byId = new Map(spec.cases.map((c) => [c.id, c]));

let seed = Number(seedArg ?? 20261112) | 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rows = results.filter((r) => byId.has(r.id)).map((r) => ({ r, c: byId.get(r.id) }));
for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }

const TAGS = "wrong_fact|unsafe|missed_safety_referral|invented_user_fact|ignored_constraint|wrong_equipment|wrong_numbers_vs_goal|unrequested_plan|off_topic|too_generic|language_issue|internal_label_leak";
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const header = ["review_id", "persona_context", "previous_turns", "question", "answer", "expected_requirements", "safety_notes",
  "score_correctness_1to5", "score_relevance_1to5", "score_constraints_1to5", "score_context_fidelity_1to5", "score_safety_1to5", "score_personalization_1to5",
  "overall_pass_yes_no", "failure_tags (" + TAGS + ")", "reviewer_comment"];
const key = {};
const lines = [header.map(csv).join(",")];
rows.forEach(({ r, c }, i) => {
  const reviewId = `R${String(i + 1).padStart(3, "0")}`;
  key[reviewId] = { caseId: r.id, set: c.set ?? null, contaminated: Boolean(c.contaminated) };
  const persona = spec.personas?.[c.persona]?.label ?? c.persona;
  lines.push([reviewId, persona, (c.previousTurns ?? []).join(" ⏎ "), c.message, r.answer, c.reference ?? "", c.safety ? JSON.stringify(c.safety) : "",
    "", "", "", "", "", "", "", "", ""].map(csv).join(","));
});
const base = path.join(path.dirname(resultsFile), path.basename(resultsFile, ".json"));
fs.writeFileSync(`${base}.human-review.csv`, "﻿" + lines.join("\n"));
fs.writeFileSync(`${base}.human-review-key.json`, JSON.stringify(key, null, 2));
console.log(`written ${rows.length} rows -> ${base}.human-review.csv (blind) + key file (organiser only)`);
