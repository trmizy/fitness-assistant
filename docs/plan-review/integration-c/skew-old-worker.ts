// STEP 2 (OLD code = git HEAD worktree): the previous worker receives the message produced by the NEW API. Run from the worktree's ai-service dir.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const WT = process.env.OLD_AI_SRC!; const IN = process.env.SKEW_IN!;
const HERE = process.env.C_DIR!;
(async () => {
  process.env.LLM_PROVIDER = "mock"; process.env.DISABLE_AI_PLAN_EVIDENCE = "true";
  const common = await import(pathToFileURL(path.join(HERE, "skew-common.ts")).href);
  const srv = await common.startFakeFitness();
  const llm = await import(pathToFileURL(path.join(WT, "services/llm.service.ts")).href);
  (llm.llmService as any).callLLM = async (prompt: string) => ({ answer: common.fullPlanAnswer(prompt), promptTokens: 1, completionTokens: 1 });
  const repo = await import(pathToFileURL(path.join(WT, "repositories/conversation.repository.ts")).href);
  const worker = await import(pathToFileURL(path.join(WT, "workers/ai.worker.ts")).href);
  const cap = JSON.parse(fs.readFileSync(IN, "utf8"));
  const snap = async () => { const p: any = await repo.prisma.workoutPlan.findUnique({ where: { id: cap.planId } }); const o: any = await repo.prisma.aiGenerationOperation.findUnique({ where: { id: cap.queued.revisionJobId } });
    return { plan: p ? { status: p.status, version: p.version, perDay: p.plan?.weeklySchedule?.map((d: any) => d.exercises?.length), firstId: p.plan?.weeklySchedule?.[0]?.exercises?.[0]?.exerciseId } : null, operation: o ? { status: o.status, lastError: o.lastError, targetType: o.targetType } : null, revisionRowsTable: await repo.prisma.$queryRawUnsafe(`select count(*)::int c from workout_plan_revisions where plan_id='${cap.planId}'`) }; };
  console.log("BEFORE", JSON.stringify(await snap()));
  let thrown = null as string | null;
  try { await worker.processAiTaskJob({ id: cap.message.opts.jobId, name: "generate-plan", data: cap.message.data, attemptsMade: 0 } as any); } catch (e) { thrown = String(e).slice(0, 200); }
  console.log("AFTER ", JSON.stringify(await snap()), thrown ? `THROWN ${thrown}` : "");
  srv.close(); await repo.prisma.$disconnect(); process.exit(0);
})();
