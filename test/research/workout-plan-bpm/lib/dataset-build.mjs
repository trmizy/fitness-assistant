// Builds, validates, and (optionally) freezes the 150-case workout-BPM dataset.
// Pre-freeze QA is applied ONLY through the explicit, logged EDITS list below. It runs before any benchmark result exists.
// Usage: node test/research/workout-plan-bpm/lib/dataset-build.mjs --run-dir <dir> [--freeze]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const datasetDir = path.resolve(here, "../dataset");
const args = process.argv.slice(2);
const runDir = args[args.indexOf("--run-dir") + 1];
const freeze = args.includes("--freeze");

const EVAL_CATEGORIES = [
  "Explicit complete requests", "Missing-slot requests", "Multi-turn slot filling", "Correction", "Negation",
  "No-diacritic Vietnamese", "Typo/slang", "Reference/anaphora", "Equipment constraints", "Availability",
  "Interruptions", "Resume", "Conflicting information", "Adversarial write requests", "Out-of-scope requests",
];
// Route vocabulary (from route-vocabulary.json, derived from production source). route -> family.
const ROUTE_FAMILY = {
  READ_STATE: "READ", RECOMMEND: "RECOMMEND", WRITE_ACTION: "PROPOSAL", EXPLAIN_AND_PROPOSE: "PROPOSAL",
  START_WORKFLOW: "WORKFLOW", SLOT_ANSWER: "WORKFLOW", SWITCH_WORKFLOW: "WORKFLOW", CANCEL: "WORKFLOW",
  CORRECTION: "CORRECTION_FAMILY", REFERENCE: "CORRECTION_FAMILY", NEGATE_ACTION: "CORRECTION_FAMILY",
  KNOWLEDGE_QA: "KNOWLEDGE", MULTI: "MULTI", UNKNOWN: "UNKNOWN", CONFIRM: "CONFIRMATION_BOUNDARY", STATUS: "CONFIRMATION_BOUNDARY",
};
const WRITE = new Set(["NO_WRITE", "PENDING_ONLY", "AUTHORIZED_WRITE"]);
const ACTION = new Set(["TEXT", "CONFIRM_LAST_ACTION", "DISMISS_LAST_ACTION"]);
const END = new Set([null, "IN_PROGRESS", "END_A", "END_B", "END_C"]);

// 1. Parse parts. Each source line may carry a trailing comma (a formatting defect in authoring); that is normalised, not a label change.
const parts = ["part1-categories-1-5.jsonl", "part2-categories-6-10.jsonl", "part3-categories-11-15.jsonl"];
const normalisationLog = [];
let cases = [];
for (const f of parts) {
  const lines = fs.readFileSync(path.join(datasetDir, f), "utf8").split("\n").filter((l) => l.trim());
  lines.forEach((raw, i) => {
    const cleaned = raw.trim().replace(/,$/, "");
    if (cleaned !== raw.trim()) normalisationLog.push({ file: f, line: i + 1, action: "stripped trailing comma (JSONL syntax)" });
    cases.push(JSON.parse(cleaned));
  });
}

// 2. Pre-freeze annotation QA edits. Every edit is recorded. No edit depends on any model output.
const edits = [];
const byId = Object.fromEntries(cases.map((c) => [c.case_id, c]));
const addTurn = (id, t) => { byId[id].turns.push(t); edits.push({ case_id: id, edit: `appended ${t.turn_id} (${t.action}) to exercise real endpoint confirmation`, reason: "dataset had no CONFIRM_LAST_ACTION cases, so exactly_once_persistence could not be measured" }); };
addTurn("W001", { turn_id: "T2", text: "[HTTP confirm of the pending workout draft]", action: "CONFIRM_LAST_ACTION", gold: { route_family: "CONFIRMATION_BOUNDARY", route: "CONFIRM", workflow: "CREATE_WORKOUT_PLAN", intent: "CONFIRM", write: "AUTHORIZED_WRITE", slots: { daysPerWeek: 4, sessionMinutes: 60 }, missing_slots: [], correction: null, reference: null, constraints: { equipment: ["DUMBBELL"] }, end_state: "END_A" } });
byId.W001.turns[0].gold.end_state = "IN_PROGRESS";
addTurn("W134", { turn_id: "T3", text: "[HTTP confirm of the pending workout draft]", action: "CONFIRM_LAST_ACTION", gold: { route_family: "CONFIRMATION_BOUNDARY", route: "CONFIRM", workflow: "CREATE_WORKOUT_PLAN", intent: "CONFIRM", write: "AUTHORIZED_WRITE", slots: { daysPerWeek: 4, sessionMinutes: 60 }, missing_slots: [], correction: null, reference: null, constraints: {}, end_state: "END_A" } });
addTurn("W137", { turn_id: "T3", text: "[HTTP confirm of the pending workout draft]", action: "CONFIRM_LAST_ACTION", gold: { route_family: "CONFIRMATION_BOUNDARY", route: "CONFIRM", workflow: "CREATE_WORKOUT_PLAN", intent: "CONFIRM", write: "AUTHORIZED_WRITE", slots: { daysPerWeek: 4, sessionMinutes: 60 }, missing_slots: [], correction: null, reference: null, constraints: {}, end_state: "END_A" } });
addTurn("W137", { turn_id: "T4", text: "[HTTP confirm of the same, already-completed draft again]", action: "CONFIRM_LAST_ACTION", gold: { route_family: "CONFIRMATION_BOUNDARY", route: "CONFIRM", workflow: "CREATE_WORKOUT_PLAN", intent: "CONFIRM", write: "NO_WRITE", slots: { daysPerWeek: 4, sessionMinutes: 60 }, missing_slots: [], correction: null, reference: null, constraints: {}, end_state: "END_A" } });
// W047: the dismissal turn was mislabelled as route CONFIRM. A dismissal is the CANCEL route (END_B), per annotation guideline section 4.
byId.W047.turns[1].gold = { route_family: "WORKFLOW", route: "CANCEL", workflow: "CREATE_WORKOUT_PLAN", intent: "DISMISS", write: "NO_WRITE", slots: { daysPerWeek: 3, sessionMinutes: 60 }, missing_slots: [], correction: null, reference: null, constraints: {}, end_state: "END_B" };
edits.push({ case_id: "W047", edit: "T2 route CONFIRM -> CANCEL (family WORKFLOW)", reason: "dismissal is a cancellation outcome, not a confirmation (annotation guideline section 4)" });
// Route-family consistency: family is determined by the vocabulary, never free text. Mismatches are corrected and logged.
for (const c of cases) for (const t of c.turns) {
  const expected = ROUTE_FAMILY[t.gold.route];
  if (expected && t.gold.route_family !== expected) {
    edits.push({ case_id: c.case_id, turn_id: t.turn_id, edit: `route_family ${t.gold.route_family} -> ${expected}`, reason: `route ${t.gold.route} belongs to family ${expected} in route-vocabulary.json` });
    t.gold.route_family = expected;
  }
}

// 3. Validation.
const errors = [];
const ids = new Set();
for (const c of cases) {
  if (ids.has(c.case_id)) errors.push(`duplicate ${c.case_id}`);
  ids.add(c.case_id);
  if (!EVAL_CATEGORIES.includes(c.category)) errors.push(`${c.case_id}: category not in evaluation-plan taxonomy: ${c.category}`);
  if (!c.turns.length || c.turns.length > 4) errors.push(`${c.case_id}: turn count ${c.turns.length} outside 1..4`);
  c.turns.forEach((t, ti) => {
    if (t.turn_id !== `T${ti + 1}`) errors.push(`${c.case_id}: turn ids not sequential`);
    if (!t.text || !t.text.trim()) errors.push(`${c.case_id}/${t.turn_id}: empty text`);
    if (!ACTION.has(t.action)) errors.push(`${c.case_id}/${t.turn_id}: bad action ${t.action}`);
    const g = t.gold;
    if (!(g.route in ROUTE_FAMILY)) errors.push(`${c.case_id}/${t.turn_id}: route ${g.route} not in route vocabulary`);
    if (!WRITE.has(g.write)) errors.push(`${c.case_id}/${t.turn_id}: bad write label ${g.write}`);
    if (!END.has(g.end_state)) errors.push(`${c.case_id}/${t.turn_id}: bad end_state ${g.end_state}`);
    // Invariant from the guideline: AUTHORIZED_WRITE needs an explicit valid confirmation. A TEXT confirmation may
    // authorize only a profile-change proposal (intent GOAL_CHANGE); a workout draft needs CONFIRM_LAST_ACTION.
    if (g.write === "AUTHORIZED_WRITE" && t.action === "TEXT" && g.intent !== "GOAL_CHANGE") errors.push(`${c.case_id}/${t.turn_id}: AUTHORIZED_WRITE via text for a non-profile proposal`);
    if (g.write === "AUTHORIZED_WRITE" && t.action === "TEXT" && g.route !== "CONFIRM") errors.push(`${c.case_id}/${t.turn_id}: AUTHORIZED_WRITE requires CONFIRM route`);
    if (t.action === "CONFIRM_LAST_ACTION" && g.write === "AUTHORIZED_WRITE" && t.turn_id === "T1") errors.push(`${c.case_id}: confirmation on the first turn with no prior proposal`);
  });
}
if (cases.length !== 150) errors.push(`case count ${cases.length} != 150`);
for (const cat of EVAL_CATEGORIES) {
  const n = cases.filter((c) => c.category === cat).length;
  if (n !== 10) errors.push(`category "${cat}" has ${n} cases, required 10`);
}
if (errors.length) {
  console.error("VALIDATION FAILED:\n" + errors.join("\n"));
  process.exit(4);
}

// 4. Distribution tables (printed before freeze).
cases.sort((a, b) => a.case_id.localeCompare(b.case_id));
const catRows = EVAL_CATEGORIES.map((cat) => {
  const cs = cases.filter((c) => c.category === cat);
  const single = cs.filter((c) => c.turns.length === 1).length;
  const dist = {};
  cs.flatMap((c) => c.turns).forEach((t) => { dist[t.gold.route] = (dist[t.gold.route] || 0) + 1; });
  return { category: cat, case_count: cs.length, single_turn_count: single, multi_turn_count: cs.length - single, expected_route_distribution: dist };
});
const writeDist = {}; cases.flatMap((c) => c.turns).forEach((t) => { writeDist[t.gold.write] = (writeDist[t.gold.write] || 0) + 1; });
const turnCount = cases.reduce((a, c) => a + c.turns.length, 0);
const routeDist = {}; cases.flatMap((c) => c.turns).forEach((t) => { routeDist[t.gold.route] = (routeDist[t.gold.route] || 0) + 1; });

console.log("| category | case_count | single_turn | multi_turn | expected_route_distribution |");
console.log("|---|---|---|---|---|");
for (const r of catRows) console.log(`| ${r.category} | ${r.case_count} | ${r.single_turn_count} | ${r.multi_turn_count} | ${JSON.stringify(r.expected_route_distribution)} |`);
console.log(`TOTAL cases=${cases.length} turns=${turnCount}`);
console.log("gold write labels:", JSON.stringify(writeDist));
console.log("gold routes:", JSON.stringify(routeDist));
console.log(`QA edits applied: ${edits.length}; JSONL normalisations: ${normalisationLog.length}`);

if (!freeze) { console.log("dry run (no --freeze): nothing written as frozen."); process.exit(0); }

// 5. Freeze. Write canonical dataset and manifest, then compute SHA-256 over the exact bytes.
const datasetJsonl = cases.map((c) => JSON.stringify(c)).join("\n") + "\n";
const datasetPath = path.join(datasetDir, "frozen-150.v1.jsonl");
fs.writeFileSync(datasetPath, datasetJsonl);
const sha = crypto.createHash("sha256").update(datasetJsonl).digest("hex");
fs.writeFileSync(path.join(datasetDir, "frozen-150.v1.sha256"), `${sha}  frozen-150.v1.jsonl\n`);
const srcManifestSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(runDir, "source-manifest.json"))).digest("hex");
const manifest = {
  dataset_version: "1.0", created_at: new Date().toISOString(), case_count: cases.length, turn_count: turnCount,
  category_counts: Object.fromEntries(catRows.map((r) => [r.category, r.case_count])),
  write_label_counts: writeDist, route_counts: routeDist,
  sha256: sha, file: "test/research/workout-plan-bpm/dataset/frozen-150.v1.jsonl",
  annotation_version: "1.0", annotation_guideline: "results/research/workout-plan-bpm/<RUN_ID>/annotation-guideline.md",
  route_vocabulary: "results/research/workout-plan-bpm/<RUN_ID>/route-vocabulary.json",
  git_head: process.env.GIT_HEAD ?? "", source_manifest_sha256: srcManifestSha,
  pre_freeze_qa_edits: edits, jsonl_normalisations: normalisationLog.length,
};
fs.writeFileSync(path.join(datasetDir, "frozen-150.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(runDir, "dataset-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(runDir, "dataset.sha256"), `${sha}  dataset.jsonl\n`);
fs.copyFileSync(datasetPath, path.join(runDir, "dataset.jsonl"));
console.log(`FROZEN sha256=${sha} bytes=${Buffer.byteLength(datasetJsonl)}`);
