// STEP 1 (NEW code): creates one COMPLETED 4x4 plan + revision operation per scenario, applies the scenario's DB state, captures the queue message.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const AI = path.resolve(__dirname, "../../../backend/services/ai-service/src");
const OUT = process.env.SKEW_OUT!;
(async () => {
  process.env.LLM_PROVIDER = "mock";
  const common = await import(pathToFileURL(path.join(__dirname, "skew-common.ts")).href);
  const ops = await import(pathToFileURL(path.join(AI, "services/generation-operations.ts")).href);
  const repo = await import(pathToFileURL(path.join(AI, "repositories/conversation.repository.ts")).href);
  const { conversationService } = await import(pathToFileURL(path.join(AI, "services/conversation.service.ts")).href);
  const captured: any[] = [];
  ops.generationOpsDeps.enqueue = async (_n: string, data: any, opts: any) => { captured.push({ data, opts }); return { id: opts?.jobId ?? "m" }; };
  ops.generationOpsDeps.admit = async () => undefined;
  const p = repo.prisma;
  const out: any[] = [];
  for (const scenario of ["S1_fresh_published", "S2_running_expired_lease", "S3_attempts_exhausted", "S4_failed_op", "S5_plan_not_completed_UNREACHABLE"]) {
    const userId = `skewm-${randomUUID().slice(0, 8)}`;
    const plan = await p.workoutPlan.create({ data: { userId, name: `Skew ${scenario}`, goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 4, plan: common.planContent(4), status: scenario.startsWith("S5") ? "PROCESSING" : "COMPLETED", version: 1 } });
    captured.length = 0;
    let q: any;
    if (scenario.startsWith("S5")) {
      // the NEW API refuses this state (PLAN_NOT_COMPLETED); build the operation by flipping the status AFTER queueing, to measure the OLD worker's exposure
      await p.workoutPlan.update({ where: { id: plan.id }, data: { status: "COMPLETED" } });
      q = await conversationService.queuePlanAdjustment({ originalPlanId: plan.id, userId, adjustments: "Mỗi buổi 8 bài", expectedVersion: 1 });
      await p.workoutPlan.update({ where: { id: plan.id }, data: { status: "PROCESSING" } });
    } else q = await conversationService.queuePlanAdjustment({ originalPlanId: plan.id, userId, adjustments: "Mỗi buổi 8 bài", expectedVersion: 1 });
    const opId = q.revisionJobId;
    if (scenario.startsWith("S2")) await p.aiGenerationOperation.update({ where: { id: opId }, data: { status: "RUNNING", attempt: 1, leaseOwner: "dead-worker", leaseExpiresAt: new Date(Date.now() - 600_000) } });
    if (scenario.startsWith("S3")) await p.aiGenerationOperation.update({ where: { id: opId }, data: { attempt: 99 } });
    if (scenario.startsWith("S4")) await p.aiGenerationOperation.update({ where: { id: opId }, data: { status: "FAILED", lastError: "boom", completedAt: new Date() } });
    out.push({ scenario, userId, planId: plan.id, opId, message: captured[0] });
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log("captured", out.map((o) => o.scenario).join(","));
  await p.$disconnect(); process.exit(0);
})();
