// BullMQ worker-kill recovery for a real nutrition generation job.
// REAL: Redis (test), BullMQ queue + TWO worker processes, processor, fitness test server (foods), real LLM HTTP call
// (local small model :11434 — provider stand-in), AI test DB. Run: npx tsx test/ai-coach-production-readiness/bullmq-recovery.ts
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
const SECRET = "test_internal_service_secret_32_chars_minimum";
const PG = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433";
const ENV = {
  NODE_ENV: "test", DATABASE_URL: `${PG}/gymcoach_ai_test?schema=public`, REDIS_HOST: "localhost", REDIS_PORT: "56379",
  USER_SERVICE_URL: "http://localhost:4304", FITNESS_SERVICE_URL: "http://localhost:4302", INTERNAL_SERVICE_SECRET: SECRET,
  LLM_PROVIDER: "ollama", LLM_MODEL: "qwen2.5:1.5b", OLLAMA_BASE_URL: "http://127.0.0.1:11434", LLM_BASE_URL: "http://127.0.0.1:11434", LLM_TIMEOUT_MS: "170000",
};
Object.assign(process.env, ENV);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = process.cwd();
const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
function worker(): ChildProcess {
  return spawn(process.execPath, [tsx, "-e", 'import("./backend/services/ai-service/src/workers/ai.worker").then(()=>console.log("worker up"))'], { cwd: root, env: { ...process.env }, stdio: "ignore" });
}
async function main() {
  const fit = spawn(process.execPath, [tsx, "src/scripts/startTestHttpServer.ts"], {
    cwd: path.join(root, "backend/services/fitness-service"), env: { ...process.env, PORT: "4302", DATABASE_URL: `${PG}/gymcoach_fitness_test?schema=public`, FITNESS_DISABLE_REDIS: "true" }, stdio: "ignore",
  });
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch("http://localhost:4302/health")).ok) break; } catch { /* wait */ } await sleep(500); }
  const { prisma } = await import("../../backend/services/ai-service/src/repositories/conversation.repository");
  const { conversationService } = await import("../../backend/services/ai-service/src/services/conversation.service");
  const { getAiQueue } = await import("../../backend/services/ai-service/src/workers/ai.queue");
  const userId = `bullmq-${randomUUID()}`;
  const W1 = worker();
  let W2: ChildProcess | undefined;
  const report: Record<string, unknown> = {};
  try {
    await sleep(6000);
    const queued = await conversationService.queueNutritionPlanGeneration({ userId, goal: "WEIGHT_LOSS", durationWeeks: 1, mealsPerDay: 4, dailyCaloriesTarget: 1992, proteinTargetG: 128, carbTargetG: 246, fatTargetG: 55, excludedFoodKeys: ["fish", "beef"] } as any);
    report.queued = { planId: queued.planId, jobId: queued.jobId };
    for (let i = 0; i < 60; i += 1) { const p = await prisma.nutritionPlan.findUnique({ where: { id: queued.planId } }); if (p?.status === "PROCESSING") break; await sleep(500); }
    const mid = await prisma.nutritionPlan.findUnique({ where: { id: queued.planId } });
    const job = await getAiQueue().getJob(queued.jobId);
    report.beforeKill = { planStatus: mid?.status, bullmq: job ? await job.getState() : null };
    W1.kill("SIGKILL"); // worker dies mid-job
    const tKill = Date.now();
    await sleep(2000);
    W2 = worker();
    let final = "";
    for (let i = 0; i < 100; i += 1) {
      await sleep(5000);
      const p = await prisma.nutritionPlan.findUnique({ where: { id: queued.planId } });
      const j = await getAiQueue().getJob(queued.jobId);
      const st = j ? await j.getState() : "gone";
      if ((p?.status === "COMPLETED" || p?.status === "FAILED") && (st === "completed" || st === "failed")) { final = `${p.status}/${st}`; break; }
    }
    const j = await getAiQueue().getJob(queued.jobId);
    const p = await prisma.nutritionPlan.findUnique({ where: { id: queued.planId } });
    report.afterRecovery = {
      recoveredAfterMs: Date.now() - tKill, final, planStatus: p?.status, failReason: p?.failReason, bullmqState: j ? await j.getState() : null,
      attemptsMade: j?.attemptsMade, stalledCounter: (j as any)?.stalledCounter,
      nutritionPlanRowsForUser: await prisma.nutritionPlan.count({ where: { userId } }),
    };
    console.log(JSON.stringify(report, null, 1));
  } finally {
    W1.kill(); W2?.kill(); fit.kill();
    await prisma.nutritionPlan.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
