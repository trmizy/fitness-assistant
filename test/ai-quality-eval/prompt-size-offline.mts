// Offline prompt-size comparison on the 200 coach questions: LEGACY prompt assembly (everything always) vs the new
// context plan, built with the SAME production builders and the same persona fixtures. No model / network / DB.
//
//   node node_modules/tsx/dist/cli.mjs test/ai-quality-eval/prompt-size-offline.mts [--with-history]
//
// Limits (stated in the output): RAG documents cannot be fetched offline (embeddings are a Bedrock call), so both variants
// get an empty retrieval and the legacy variant also misses its always-on body-comp evidence docs → the legacy size is an
// UNDER-estimate. Token counts are chars/3.5 estimates, calibrated against the real promptTokens of the stored run.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const imp = async (p: string) => { const m: any = await import(pathToFileURL(path.join(ROOT, "backend/services/ai-service/src", p)).href); return m.default ?? m; };
const PB = await imp("llm/prompt_builder.ts"), IR = await imp("llm/intent_router.ts"), IP = await imp("llm/input_parser.ts");
const RE = await imp("llm/recommendation_engine.ts"), CP = await imp("llm/context_plan.ts"), TF = await imp("llm/turn_facts.ts");
const CR = await imp("llm/claim_rules.ts"), NA = await imp("llm/nutrition_answer_mode.ts"), BC = await imp("llm/body_composition_rules.ts");
const CC = await imp("coach/coach_context_builder.ts");
const WITH_HISTORY = process.argv.includes("--with-history");

const LLM = new Set(["general_fitness_knowledge", "schedule_specific_day_request", "body_recomposition_request", "meal_plan_request", "combined_plan_request", "nutrient_timing_request"]);
const toProfile = (p: any) => ({
  age: p.age, gender: p.gender, heightCm: p.heightCm, currentWeightKg: p.currentWeight, targetWeightKg: p.targetWeight, goal: p.goal,
  activityLevel: p.activityLevel, experienceLevel: p.experienceLevel,
  training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] },
});
// Optional synthetic history (what an active user has): 5 InBody, 7 workouts, 14 nutrition logs — same for both variants.
const history = WITH_HISTORY ? {
  inBodyHistory: Array.from({ length: 5 }, (_, i) => ({ date: `2026-1${i}-01`, weight: 70 - i, bodyFatPct: 25 - i, bodyFat: 18, muscleMass: 30, rightArmMuscle: 3, leftArmMuscle: 3, trunkMuscle: 24, rightLegMuscle: 9, leftLegMuscle: 9 })),
  workoutHistory: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, duration: 55, exercises: Array.from({ length: 6 }, (_, j) => ({ name: `Exercise ${j}`, sets: 3, reps: 10, weight: 30 })) })),
  nutritionHistory: Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${10 + (i % 7)}`, calories: 600, protein: 35, carbs: 60, fats: 18, foodName: `Món ${i}`, quantity: 150 })),
} : { inBodyHistory: [], workoutHistory: [], nutritionHistory: [] };

const legacy: number[] = [], lean: number[] = [], realLegacy: number[] = [];
const skippedBlocks: Record<string, number> = {};
const R = path.join(ROOT, "test/ai-quality-eval/results");
for (const b of ["b1", "b2", "b3", "b4"]) {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, `test/ai-quality-eval/coach-cases-${b}.json`), "utf8"));
  const f = fs.readdirSync(R).filter((x) => new RegExp(`^nutrition-coach-${b}-selfjudge-.*json$`).test(x)).sort().pop()!;
  const real = new Map<string, any>(JSON.parse(fs.readFileSync(path.join(R, f), "utf8")).results.map((r: any) => [r.id, r]));
  for (const c of spec.cases) {
    const profile = toProfile(spec.personas[c.persona].profile);
    const ctx: any = { profile, ...history, memories: [] };
    const route = IR.intentRouter.route(c.message, profile);
    if (!LLM.has(route.intent)) continue;
    const parsed = { ...IP.inputParser.parse(c.message, profile), routeIntent: route.intent };
    const rec = RE.recommendationEngine.recommend(profile, parsed, "vi");
    const chat = (c.previousTurns ?? []).map((q: string) => ({ question: q, answer: "Câu trả lời trước của coach (mô phỏng, 400 ký tự). ".repeat(8) })).reverse();
    const bodyComp = BC.formatBodyCompAnalysis(BC.analyzeBodyComposition(profile));
    const coachJson = `CoachContext JSON (sanitized, no user identity):\n${JSON.stringify(CC.sanitizeCoachContextForPrompt(CC.buildCoachContext(ctx)))}`;
    const empty = { documents: [], isEmpty: true, reason: "offline" };
    const old = PB.promptBuilder.build(c.message, parsed, ctx, empty, rec, "vi", chat, [bodyComp, coachJson].filter(Boolean).join("\n\n"));
    const plan = CP.planContext({ intent: route.intent, question: c.message, personalQuestion: NA.isPersonalQuestion(c.message), bodyCompositionQuestion: /inbody|body fat|thanh phan co the/i.test(c.message), mentionsInjury: !!parsed.mentionsInjury, hasSessionHistory: chat.length > 0 });
    const facts = TF.formatTurnFactsForPrompt(TF.extractTurnFacts(c.message, { sessionUserMessages: c.previousTurns ?? [], profile }));
    const notes = [plan.blocks.has("body_composition") ? bodyComp : "", plan.blocks.has("coach_context") ? coachJson : ""].filter(Boolean).join("\n\n");
    let manifest: any;
    const neu = PB.promptBuilder.build(c.message, parsed, ctx, empty, rec, "vi", chat, notes || undefined, { contextPlan: plan, turnFactsText: facts || undefined, knowledgeRulesText: CR.formatClaimRulesForPrompt(c.message) || undefined, onManifest: (m: any) => (manifest = m) });
    for (const s of manifest?.skipped ?? []) skippedBlocks[s] = (skippedBlocks[s] ?? 0) + 1;
    legacy.push(CP.estimateTokens(old)); lean.push(CP.estimateTokens(neu));
    const r = real.get(c.id); if (r?.responseSource === "llm" && r.promptTokens) realLegacy.push(r.promptTokens);
  }
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
console.log(`LLM-path questions: ${legacy.length}   (history fixture: ${WITH_HISTORY ? "active user" : "none — same as the eval personas"})`);
console.log(`legacy prompt (est.)   p50 ${q(legacy, .5)}  p90 ${q(legacy, .9)}  max ${Math.max(...legacy)}`);
console.log(`new context plan (est.) p50 ${q(lean, .5)}  p90 ${q(lean, .9)}  max ${Math.max(...lean)}`);
console.log(`real promptTokens of the stored run (legacy, incl. RAG docs) p50 ${q(realLegacy, .5)}  → offline legacy estimate covers ${(q(legacy, .5) / q(realLegacy, .5) * 100).toFixed(0)}% of it (rest ≈ RAG + evidence docs + tokenizer difference)`);
console.log("blocks skipped by the plan (count of prompts):", skippedBlocks);
