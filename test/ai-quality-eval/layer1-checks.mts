// Layer 1 — deterministic, OFFLINE checks on stored answers (no model, no network, no DB).
// They reuse the production modules (ai-service/src/llm/*), so a check and the runtime guard can never disagree.
//
//   node node_modules/tsx/dist/cli.mjs test/ai-quality-eval/layer1-checks.mts [--label selfjudge] [--rater-md <cc-rater scores.md>]
//
// Output: results/layer1-<label>.json (per case) + a console summary. With --rater-md, Layer-1 flags are compared to the
// CC-rater labels of the SAME answers (paired by id within one run; never across runs).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "backend/services/ai-service/src/llm");
const imp = async (f: string) => { const m: any = await import(pathToFileURL(path.join(SRC, f)).href); return m.default ?? m; };
const N = await imp("exercise_name_normalizer.ts");
const CR = await imp("claim_rules.ts");
const TF = await imp("turn_facts.ts");
const EG = await imp("exercise_constraint_guard.ts");
const FG = await imp("context_fidelity_guard.ts");
const IR = await imp("intent_router.ts");
const MP = await imp("memory_policy.ts");

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LABEL = opt("--label", "selfjudge")!;
const RESULTS = path.join(ROOT, "test/ai-quality-eval/results");

const ENUM_LEAK = /\b(FEMALE|MALE|BEGINNER|INTERMEDIATE|ADVANCED|WEIGHT_LOSS|MUSCLE_GAIN|MAINTENANCE|MODERATELY_ACTIVE|SEDENTARY|vertical_pull|vertical_push|horizontal_pull|horizontal_push|hip_hinge|squat_pattern|knee_dominant|core_anti_extension)\b/;
const NAME_ARTIFACT = /\b(Seated|Rollout|Dumbbell|Cable|Barbell|Machine|Smith)\s+\1\b|Romanian Deadlift \(Romanian Deadlift\)|Seated Smith Machine Overhead Press/;
const LLM_INTENTS = new Set(["general_fitness_knowledge", "schedule_specific_day_request", "body_recomposition_request", "meal_plan_request", "combined_plan_request", "nutrient_timing_request"]);

export type Layer1 = { id: string; flags: string[]; details: Record<string, unknown> };

export function layer1(row: { id: string; message: string; previousTurns?: string[]; answer: string; responseSource?: string }): Layer1 {
  const flags: string[] = [], details: Record<string, unknown> = {};
  const a = String(row.answer ?? "");
  if (NAME_ARTIFACT.test(a)) flags.push("exercise_name_artifact");
  const once = N.normalizeExerciseNames(a);
  if (N.normalizeExerciseNames(once) !== once) flags.push("normalizer_not_idempotent");
  if (ENUM_LEAK.test(a)) { flags.push("internal_enum_leak"); details.enum = a.match(ENUM_LEAK)?.[0]; }
  const myths = CR.detectMythClaims(a);
  if (myths.length) { flags.push("known_myth"); details.myths = myths.map((m: any) => m.id); }
  const facts = TF.extractTurnFacts(row.message, { sessionUserMessages: [...(row.previousTurns ?? [])].reverse() });
  const v = EG.findExerciseViolations(a, facts);
  if (v.length) { flags.push(...new Set(v.map((x: any) => `constraint_${x.reason}`))); details.violations = v.map((x: any) => `${x.name}:${x.reason}`); }
  const fid = FG.removeUnsupportedUserClaims(a, { question: row.message, sessionUserMessages: row.previousTurns ?? [] });
  if (fid.removed.length) { flags.push("unsupported_user_claim"); details.unsupported = fid.removed.map((s: string) => s.slice(0, 80)); }
  // guard kept the text because removal would empty it — still an unsupported claim in the answer
  if (fid.suppressed?.length) { flags.push("unsupported_user_claim"); details.unsupportedKept = fid.suppressed.map((s: string) => s.slice(0, 80)); }
  const route = IR.intentRouter.route(row.message, {});
  details.routeNow = route.intent;
  if (row.responseSource === "deterministic_fallback" && LLM_INTENTS.has(route.intent) && route.abstainedFrom) flags.push("template_for_advice_question(old_run)");
  for (const s of [row.message, ...(row.previousTurns ?? [])]) {
    const sentences = s.split(/[.!?\n]+/).map((x) => x.trim()).filter(Boolean);
    if (sentences.some((x) => MP.classifyMemoryFact(x).decision === "ALLOW" && /\?\s*$|\b(khong|chua)\s*$/.test(x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()))) flags.push("question_would_be_saved_as_memory");
  }
  return { id: row.id, flags, details };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const rows: any[] = [];
  for (const b of ["b1", "b2", "b3", "b4"]) {
    const f = fs.readdirSync(RESULTS).filter((x) => new RegExp(`^nutrition-coach-${b}-${LABEL}-.*json$`).test(x)).sort().pop();
    if (!f) continue;
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, `test/ai-quality-eval/coach-cases-${b}.json`), "utf8"));
    const prev = new Map(spec.cases.map((c: any) => [c.id, c.previousTurns ?? []]));
    for (const r of JSON.parse(fs.readFileSync(path.join(RESULTS, f), "utf8")).results) rows.push({ ...r, previousTurns: r.previousTurns ?? prev.get(r.id) ?? [], _file: f });
  }
  const out = rows.map((r) => ({ ...layer1(r), file: r._file, answerSha1: createHash("sha1").update(String(r.answer ?? "")).digest("hex").slice(0, 12), checkerPass: !!r.casePass }));
  const count: Record<string, number> = {};
  for (const o of out) for (const f of o.flags) count[f] = (count[f] ?? 0) + 1;
  const flagged = out.filter((o) => o.flags.length).length;
  console.log(`Layer 1 on ${out.length} stored answers (run label "${LABEL}"): ${flagged} flagged`);
  console.log(count);

  const md = opt("--rater-md");
  if (md && fs.existsSync(md)) {
    const cc: Record<string, number> = {};
    for (const m of fs.readFileSync(md, "utf8").matchAll(/^\| (B\d-\d\d) \| ([\d.]+) \|/gm)) cc[m[1]] = +m[2];
    let failFlag = 0, failNoFlag = 0, passFlag = 0, passNoFlag = 0;
    const passFlagged: string[] = [];
    for (const o of out) {
      if (cc[o.id] === undefined) continue;
      const fail = cc[o.id] < 3, f = o.flags.length > 0;
      if (fail && f) failFlag++; else if (fail) failNoFlag++; else if (f) { passFlag++; passFlagged.push(`${o.id}:${o.flags.join("+")}`); } else passNoFlag++;
    }
    console.log(`vs CC-rater (LLM rater, NOT human; same answers): CC-fail & flagged ${failFlag}, CC-fail & not flagged ${failNoFlag}, CC-pass & flagged ${passFlag}, CC-pass & clean ${passNoFlag}`);
    console.log(`  → Layer 1 explains ${failFlag}/${failFlag + failNoFlag} CC-rater failures deterministically; the rest need Layer 2/3.`);
    if (passFlagged.length) console.log("  CC-pass but flagged (review):", passFlagged.join(" | "));
  }
  const file = path.join(RESULTS, `layer1-${LABEL}.json`);
  fs.writeFileSync(file, JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), counts: count, cases: out }, null, 2));
  console.log("written", path.relative(ROOT, file));
}
