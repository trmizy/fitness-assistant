// STEP 1 (NEW code): create a COMPLETED 4x4 plan, queue an adjustment with the NEW API, and capture the exact queue message instead of running it.
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
  const userId = `skew-${randomUUID().slice(0, 8)}`;
  const plan = await repo.prisma.workoutPlan.create({ data: { userId, name: "Skew plan", goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 4, plan: common.planContent(4), status: "COMPLETED", version: 1 } });
  const q = await conversationService.queuePlanAdjustment({ originalPlanId: plan.id, userId, adjustments: "Mỗi buổi 8 bài", expectedVersion: 1 });
  fs.writeFileSync(OUT, JSON.stringify({ userId, planId: plan.id, queued: q, message: captured[0] }, null, 1));
  console.log("captured message for plan", plan.id, "op", q.revisionJobId);
  await repo.prisma.$disconnect(); process.exit(0);
})();
