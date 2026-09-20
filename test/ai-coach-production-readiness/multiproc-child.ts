// One AI-service PROCESS (replica). Real fitnessAgent + real AI test DB; only the business boundary is replaced by an
// idempotent-object recorder in the same DB so writes can be counted ACROSS processes.
import readline from "node:readline";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test?schema=public";
process.env.FITNESS_DISABLE_REDIS = "true";
const send = (o: unknown) => process.stdout.write(JSON.stringify({ pid: process.pid, ...(o as object) }) + "\n");
(async () => {
  const { prisma } = await import("../../backend/services/ai-service/src/repositories/conversation.repository");
  const { fitnessAgent, fitnessAgentDeps } = await import("../../backend/services/ai-service/src/services/fitness-agent.service");
  const holds = new Map<string, () => void>();
  const holdIds = new Set<string>();
  fitnessAgentDeps.tools.importAiPlanToSchedule = (async (_i: any, payload: any) => {
    const id = payload.sourcePlanId as string;
    await prisma.$executeRawUnsafe(`insert into race_business_calls(action_id,pid) values ('${id}', ${process.pid})`);
    send({ ev: "business-entered", id });
    if (holdIds.has(id)) await new Promise<void>((r) => holds.set(id, r));
    // downstream idempotency identity = sourcePlanId (real DB: UNIQUE(user_id, source_plan_id))
    await prisma.$executeRawUnsafe(`insert into race_business_objects(action_id) values ('${id}') on conflict do nothing`);
    return { message: "đã lưu" };
  }) as any;
  send({ ev: "ready" });
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const c = JSON.parse(line);
    if (c.cmd === "hold") { holdIds.add(c.id); return; }
    if (c.cmd === "release") { holds.get(c.id)?.(); return; }
    if (c.cmd === "quit") { await prisma.$disconnect(); process.exit(0); }
    const identity = { userId: c.userId } as any;
    while (Date.now() < c.at) { /* spin to align start across processes */ }
    try {
      const r = c.cmd === "confirm" ? await fitnessAgent.execute(identity, c.id, true) : await fitnessAgent.dismissDraft(identity, c.id);
      send({ ev: "result", cmd: c.cmd, id: c.id, ok: true, message: (r as any).message });
    } catch (e: any) { send({ ev: "result", cmd: c.cmd, id: c.id, ok: false, error: String(e.message).slice(0, 100) }); }
  });
})();
