// AI Coach production-readiness — LIVE nutrition journey.
// REAL: AI-service tryTurn/execute, BullMQ + Redis (test), ai worker, nutrition processor, real LLM HTTP call,
//       fitness-service (test HTTP server + isolated test DB incl. 13k foods), AI test DB.
// STUBBED (labelled): user-service stand-in (profile/context routes only — the real one needs auth-service JWT).
// PROVIDER: NOT the configured qwen3:30b (tunnel unavailable) — a small LOCAL model on :11434 (LLM_MODEL env override,
//           process-local; no config file changed). Quality is not representative; the plumbing is.
// Run from repo root: npx tsx test/ai-coach-production-readiness/live-nutrition.ts [--dead-provider]
import http from "node:http";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEAD = process.argv.includes("--dead-provider");
const SECRET = "test_internal_service_secret_32_chars_minimum";
const PG = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433";
const AI_DB = `${PG}/gymcoach_ai_test?schema=public`;
const FIT_DB = `${PG}/gymcoach_fitness_test?schema=public`;
const FIT_PORT = 4302, USER_PORT = 4304;
Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: AI_DB, FITNESS_DATABASE_URL: FIT_DB, REDIS_HOST: "localhost", REDIS_PORT: "56379",
  USER_SERVICE_URL: `http://localhost:${USER_PORT}`, FITNESS_SERVICE_URL: `http://localhost:${FIT_PORT}`,
  INTERNAL_SERVICE_SECRET: SECRET, LLM_PROVIDER: "ollama", LLM_MODEL: "qwen2.5:1.5b", LLM_TIMEOUT_MS: "170000",
  OLLAMA_BASE_URL: DEAD ? "http://127.0.0.1:11999" : "http://127.0.0.1:11434", LLM_BASE_URL: DEAD ? "http://127.0.0.1:11999" : "http://127.0.0.1:11434",
});
const out: Record<string, unknown>[] = [];
const emit = (id: string, observed: unknown) => { const r = { id, observed }; out.push(r); console.log(JSON.stringify(r)); };
const psql = (db: string, sql: string) => execSync(`docker exec gymcoach-test-postgres-test-1 psql -U gymcoach_test -d ${db} -Atc "${sql.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// user-service stand-in (routes only)
const userId = `readiness-${randomUUID()}`;
const profile = { goal: "WEIGHT_LOSS", age: 28, gender: "FEMALE", heightCm: 170, currentWeight: 75, startingWeight: 75, targetWeight: 68, experienceLevel: "BEGINNER", activityLevel: "MODERATELY_ACTIVE", competesInSport: false, injuries: [], hasCompletedOnboarding: true, preferredTrainingDays: [1, 3, 5] };
const userStub = http.createServer((req, res) => {
  const url = req.url ?? "";
  const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.startsWith("/profile/agent/context")) return send(200, { goal: "WEIGHT_LOSS", experience: "BEGINNER", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [], goalIntent: null });
  if (url.startsWith("/profile/me")) return send(200, { profile, ...profile });
  if (url.startsWith("/internal/profile/")) return send(200, { profile });
  if (url.startsWith("/inbody")) return send(200, []);
  if (url.startsWith("/internal/inbody/")) return send(404, {});
  return send(404, { error: "stub" });
});

async function main() {
  await new Promise<void>((r) => userStub.listen(USER_PORT, r));
  const root = process.cwd();
  const fit: ChildProcess = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/scripts/startTestHttpServer.ts"], {
    cwd: path.join(root, "backend/services/fitness-service"),
    env: { ...process.env, PORT: String(FIT_PORT), DATABASE_URL: FIT_DB, FITNESS_DISABLE_REDIS: "true" }, stdio: "ignore",
  });
  for (let i = 0; i < 60; i += 1) { try { const r = await fetch(`http://localhost:${FIT_PORT}/health`); if (r.ok) break; } catch { /* wait */ } await sleep(500); }

  const { prisma, PlanStatus } = await import("../../backend/services/ai-service/src/repositories/conversation.repository");
  const { fitnessAgent } = await import("../../backend/services/ai-service/src/services/fitness-agent.service");
  const { aiWorker } = await import("../../backend/services/ai-service/src/workers/ai.worker");
  const { getAiQueue } = await import("../../backend/services/ai-service/src/workers/ai.queue");
  const { llmService } = await import("../../backend/services/ai-service/src/services/llm.service");
  void PlanStatus;
  const identity = { userId } as any;
  const session = await prisma.chatSession.create({ data: { userId, title: "readiness live" } });
  const t0 = Date.now();
  const lat: Record<string, number> = {};
  try {
    const health = await llmService.getHealthStatus(3000);
    emit("provider-health", { available: health.llmAvailable, provider: health.llmProvider, model: health.model, error: health.error, note: DEAD ? "deliberately dead endpoint" : "local small model, NOT the configured provider" });

    if (process.argv.includes("--unsupported")) {
      const before = await getAiQueue().getJobCounts();
      const first = await fitnessAgent.tryTurn("Tạo thực đơn, tôi không ăn cá và không ăn cay", identity, session.id);
      const answer = await fitnessAgent.tryTurn("4 bữa", identity, session.id);
      const after = await getAiQueue().getJobCounts();
      emit("unsupported", { firstAnswer: first?.answer, answer: answer?.answer, before, after, planRows: await prisma.nutritionPlan.count({where:{userId}}), actions: await prisma.fitnessAgentAction.count({where:{userId,kind:"CREATE_NUTRITION_PLAN"}}) });
      return;
    }
    if (DEAD) {
      await fitnessAgent.tryTurn("Tạo thực đơn cho tôi", identity, session.id);
      const r = await fitnessAgent.tryTurn("4 bữa", identity, session.id);
      const actions = await prisma.fitnessAgentAction.count({ where: { userId, kind: "CREATE_NUTRITION_PLAN" } });
      const plans = await prisma.nutritionPlan.count({ where: { userId } });
      emit("provider-unavailable", { answer: r?.answer, blocks: r?.blocks.length, nutritionActions: actions, nutritionPlanRows: plans });
      return;
    }

    // Turn 1-3: accumulation
    const r1 = await fitnessAgent.tryTurn("Tạo thực đơn, tôi không ăn cá.", identity, session.id);
    const r2 = await fitnessAgent.tryTurn("À tôi cũng không ăn thịt bò.", identity, session.id);
    const tq = Date.now();
    const r3 = await fitnessAgent.tryTurn("4 bữa", identity, session.id);
    lat.queueMs = Date.now() - tq;
    const action = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_NUTRITION_PLAN" }, orderBy: { createdAt: "desc" } });
    const payload = action?.payload as any;
    const plan0 = await prisma.nutritionPlan.findUnique({ where: { id: payload.planId } });
    const job = await getAiQueue().getJob(payload.jobId);
    emit("turns-1-3", { t1Missing: (r1?.blocks[0] as any)?.missing, t2: r2?.answer?.slice(0, 60), t3: r3?.answer?.slice(0, 80), constraints: payload.constraints.exclusions.map((e: any) => e.key), target: payload.target, planId: payload.planId, jobId: payload.jobId, initialPlanStatus: plan0?.status, bullmqState: job ? await job.getState() : null });

    // poll for real completion
    let preview: any = null; let lastAnswer = "";
    const tg = Date.now();
    for (let i = 0; i < 40; i += 1) {
      await sleep(8000);
      const r = await fitnessAgent.tryTurn("xong chưa", identity, session.id);
      lastAnswer = r?.answer ?? "";
      if (r?.blocks[0]?.type === "NUTRITION_PLAN_PREVIEW") { preview = r.blocks[0]; break; }
      const a = await prisma.fitnessAgentAction.findUnique({ where: { id: action!.id } });
      if (a?.status === "CANCELLED") break;
    }
    lat.generationMs = Date.now() - tg;
    const finalJob = await getAiQueue().getJob(payload.jobId);
    const planRow = await prisma.nutritionPlan.findUnique({ where: { id: payload.planId } });
    emit("generation", { previewShown: !!preview, planStatus: planRow?.status, failReason: planRow?.failReason, lastAnswer: lastAnswer.slice(0, 120), job: { id: payload.jobId, state: finalJob ? await finalJob.getState() : null, attemptsMade: finalJob?.attemptsMade } });

    if (preview) {
      const content = planRow!.plan as any;
      const names: string[] = content.weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => String(i.name))));
      const excluded = names.filter((n) => /fish|salmon|tuna|cod|tilapia|beef|steak|veal|sardine|trout/i.test(n));
      emit("live-exclusion", { itemCount: names.length, excludedFoundCount: excluded.length, excludedSample: excluded.slice(0, 3), dailyCaloriesTarget: content.dailyCaloriesTarget, macros: [content.proteinTargetGrams, content.carbTargetGrams, content.fatTargetGrams], previewTargetNote: preview.targetNote });
      const bad = await fitnessAgent.tryTurn("Tôi không ăn cá và không ăn cay", identity, session.id);
      const queuedAfter = await prisma.nutritionPlan.count({ where: { userId } });
      emit("live-unsupported-refusal", { answer: bad?.answer?.slice(0, 90), nutritionPlanRows: queuedAfter });
      // supported revision -> a REAL second generation job
      const rev = await fitnessAgent.tryTurn("Ít bữa hơn.", identity, session.id);
      const revAction = await prisma.fitnessAgentAction.findUnique({ where: { id: action!.id } });
      const revPayload = revAction!.payload as any;
      let revPreview: any = null;
      for (let i = 0; i < 40; i += 1) { await sleep(8000); const r = await fitnessAgent.tryTurn("xong chưa", identity, session.id); if (r?.blocks[0]?.type === "NUTRITION_PLAN_PREVIEW") { revPreview = r.blocks[0]; break; } if ((await prisma.fitnessAgentAction.findUnique({ where: { id: action!.id } }))!.status === "CANCELLED") break; }
      const revPlan = await prisma.nutritionPlan.findUnique({ where: { id: revPayload.planId } });
      const revJob = await getAiQueue().getJob(revPayload.jobId);
      const revNames: string[] = revPlan?.status === "COMPLETED" ? (revPlan.plan as any).weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => String(i.name)))) : [];
      emit("live-revision", { answer: rev?.answer?.slice(0, 70), newJobId: revPayload.jobId, sameAction: true, phaseAfter: revPayload.phase, mealsPerDay: revPayload.mealsPerDay, previewShown: !!revPreview, planStatus: revPlan?.status, failReason: revPlan?.failReason, job: revJob ? { state: await revJob.getState(), attemptsMade: revJob.attemptsMade } : null, mealsInPreview: revPreview?.mealsPerDay, excludedFound: revNames.filter((n) => /fish|salmon|tuna|cod|beef|steak|veal|sardine|trout/i.test(n)).length, totalPlanRows: await prisma.nutritionPlan.count({ where: { userId } }) });
      const tc = Date.now();
      const confirmed = await fitnessAgent.execute(identity, action!.id, true);
      lat.saveMs = Date.now() - tc;
      const program = psql("gymcoach_fitness_test", `select id||'|'||source_plan_id||'|'||coalesce(source_goal_id,'null') from nutrition_programs where user_id='${userId}'`);
      const items = psql("gymcoach_fitness_test", `select count(*) from nutrition_program_meal_items i join nutrition_program_meals m on i.meal_id=m.id join nutrition_program_days d on m.day_id=d.id join nutrition_programs p on d.program_id=p.id where p.user_id='${userId}'`);
      emit("live-confirm-persist", { result: (confirmed as any).message, program, itemRows: items, actionStatus: (await prisma.fitnessAgentAction.findUnique({ where: { id: action!.id } }))!.status });
      const again = await fitnessAgent.execute(identity, action!.id, true);
      emit("live-idempotent-replay", { sameResult: JSON.stringify(again) === JSON.stringify(confirmed), programs: psql("gymcoach_fitness_test", `select count(*) from nutrition_programs where user_id='${userId}'`) });
    }
    emit("latency-ms", { ...lat, totalMs: Date.now() - t0 });
    await aiWorker.close();
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.nutritionPlan.deleteMany({ where: { userId } });
    await prisma.chatSession.deleteMany({ where: { userId } });
    try { psql("gymcoach_fitness_test", `delete from nutrition_programs where user_id='${userId}'`); } catch { /* ignore */ }
    await prisma.$disconnect();
    fit.kill(); userStub.close();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

