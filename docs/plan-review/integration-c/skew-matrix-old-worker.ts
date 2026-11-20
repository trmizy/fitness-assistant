// STEP 2 (OLD code = git HEAD worktree): for every scenario, run the PREVIOUS worker/recovery against the message produced by the NEW API and prove the plan is not corrupted.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const WT = process.env.OLD_AI_SRC!; const IN = process.env.SKEW_IN!; const HERE = process.env.C_DIR!;
(async () => {
  process.env.LLM_PROVIDER = "mock"; process.env.DISABLE_AI_PLAN_EVIDENCE = "true";
  const common = await import(pathToFileURL(path.join(HERE, "skew-common.ts")).href);
  const srv = await common.startFakeFitness();
  const llm = await import(pathToFileURL(path.join(WT, "services/llm.service.ts")).href);
  let modelCalls = 0;
  (llm.llmService as any).callLLM = async (prompt: string) => { modelCalls++; return { answer: common.fullPlanAnswer(prompt), promptTokens: 1, completionTokens: 1 }; };
  const repo = await import(pathToFileURL(path.join(WT, "repositories/conversation.repository.ts")).href);
  const worker = await import(pathToFileURL(path.join(WT, "workers/ai.worker.ts")).href);
  const gops = await import(pathToFileURL(path.join(WT, "services/generation-operations.ts")).href);
  const p = repo.prisma;
  const items = JSON.parse(fs.readFileSync(IN, "utf8"));
  const snap = async (it: any) => { const pl: any = await p.workoutPlan.findUnique({ where: { id: it.planId } }); const o: any = await p.aiGenerationOperation.findUnique({ where: { id: it.opId } });
    const rows: any = await p.$queryRawUnsafe(`select count(*)::int c from workout_plans where user_id='${it.userId}'`);
    return { plan: pl ? { status: pl.status, version: pl.version, perDay: pl.plan?.weeklySchedule?.map((d: any) => d.exercises?.length), failReason: pl.failReason ?? null } : null, planRows: rows[0].c, op: o ? { status: o.status, epoch: o.epoch, lastError: o.lastError } : null }; };
  const results: any[] = [];
  for (const it of items) {
    const before = await snap(it); modelCalls = 0; let thrown: string | null = null; let how = "processAiTaskJob";
    try {
      if (it.scenario.startsWith("S2")) { how = "recoverPendingGenerations (old)"; await gops.recoverPendingGenerations({ limit: 50 }); }
      else if (it.scenario.startsWith("S4")) { how = "store.repairFailedTarget (old)"; await gops.generationOpsDeps.store.repairFailedTarget(it.opId, 1); }
      else await worker.processAiTaskJob({ id: it.message.opts.jobId, name: "generate-plan", data: it.message.data, attemptsMade: 0 } as any);
    } catch (e) { thrown = String(e).slice(0, 160); }
    const after = await snap(it);
    const planIntact = JSON.stringify(before.plan) === JSON.stringify(after.plan) && before.planRows === after.planRows;
    results.push({ scenario: it.scenario, how, modelCalls, planIntact, before, after, thrown });
    console.log(JSON.stringify(results[results.length - 1]));
  }
  fs.writeFileSync(IN.replace(/\.json$/, ".result.json"), JSON.stringify(results, null, 1));
  srv.close(); await p.$disconnect(); process.exit(0);
})();
