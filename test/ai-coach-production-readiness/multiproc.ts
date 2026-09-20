// Multi-process (multi-replica) verification of the FitnessAgentAction finalization arbiter. Run from repo root:
//   npx tsx test/ai-coach-production-readiness/multiproc.ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test?schema=public";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Ev = { pid: number; ev: string; [k: string]: any };
function child(): { p: ChildProcessWithoutNullStreams; events: Ev[]; send: (o: unknown) => void } {
  const p = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "test/ai-coach-production-readiness/multiproc-child.ts"], { stdio: ["pipe", "pipe", "ignore"] });
  const events: Ev[] = [];
  readline.createInterface({ input: p.stdout }).on("line", (l) => { try { events.push(JSON.parse(l)); } catch { /* log noise */ } });
  return { p, events, send: (o) => p.stdin.write(JSON.stringify(o) + "\n") };
}
async function waitFor(pred: () => boolean, ms = 30000) { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) throw new Error("timeout"); await sleep(25); } }
const staleJson = () => JSON.stringify({ executingSince: new Date(Date.now() - 10 * 60_000).toISOString() });
async function main() {
  const { prisma } = await import("../../backend/services/ai-service/src/repositories/conversation.repository");
  await prisma.$executeRawUnsafe("create table if not exists race_business_calls(action_id text, pid int, ts timestamptz default now())");
  await prisma.$executeRawUnsafe("create table if not exists race_business_objects(action_id text primary key)");
  const userId = `multiproc-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "multiproc" } });
  const mk = async () => (await prisma.fitnessAgentAction.create({ data: { userId, sessionId: session.id, recommendationId: null, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", expiresAt: new Date(Date.now() + 3600_000),
    payload: { goal: "MUSCLE_GAIN", sessionMinutes: 60, selectedWeekdays: [1], exclusions: [], weeklySchedule: [{ day: "Thu 2 A", goal: "g", exercises: [{ exerciseId: "e1", name: "Bench", order: 1, sets: 3, reps: "10", restSeconds: 60 }] }] } } })).id;
  const calls = async (id: string) => Number((await prisma.$queryRawUnsafe<any[]>(`select count(*)::int c from race_business_calls where action_id='${id}'`))[0].c);
  const objects = async (id: string) => Number((await prisma.$queryRawUnsafe<any[]>(`select count(*)::int c from race_business_objects where action_id='${id}'`))[0].c);
  const status = async (id: string) => (await prisma.fitnessAgentAction.findUnique({ where: { id } }))!.status;
  const backdate = (id: string) => prisma.$executeRawUnsafe(`update fitness_agent_actions set result=$1::jsonb where id=$2`, staleJson(), id);
  const A = child(), B = child();
  const report: Record<string, unknown> = { processes: 2 };
  try {
    await waitFor(() => A.events.some((e) => e.ev === "ready") && B.events.some((e) => e.ev === "ready"));
    report.pids = [A.events[0].pid, B.events[0].pid];
    const results = (c: typeof A, id: string, cmd: string) => c.events.filter((e) => e.ev === "result" && e.id === id && e.cmd === cmd);

    // 1. confirm || dismiss across processes, 30 rounds, alternating which replica confirms
    let confirmWins = 0, dismissWins = 0;
    for (let i = 0; i < 30; i += 1) {
      const id = await mk(); const at = Date.now() + 400;
      const [c, d] = i % 2 ? [B, A] : [A, B];
      c.send({ cmd: "confirm", id, userId, at }); d.send({ cmd: "dismiss", id, userId, at });
      await waitFor(() => results(c, id, "confirm").length === 1 && results(d, id, "dismiss").length === 1);
      const cr = results(c, id, "confirm")[0], dr = results(d, id, "dismiss")[0];
      const st = await status(id);
      if (st === "COMPLETED") {
        confirmWins += 1;
        assert.ok(cr.ok && /lưu/.test(cr.message)); assert.ok(!/chưa lưu gì/.test(dr.message ?? ""), `round ${i}: dismiss lied: ${dr.message}`);
        assert.equal(await calls(id), 1); assert.equal(await objects(id), 1);
      } else {
        dismissWins += 1; assert.equal(st, "CANCELLED"); assert.equal(cr.ok, false); assert.match(dr.message, /chưa lưu gì/); assert.equal(await calls(id), 0);
      }
    }
    report.confirmVsDismiss = { rounds: 30, confirmWins, dismissWins, contradictions: 0 };

    // 2. double confirm across two processes
    let dbl = 0;
    for (let i = 0; i < 15; i += 1) {
      const id = await mk(); const at = Date.now() + 400;
      A.send({ cmd: "confirm", id, userId, at }); B.send({ cmd: "confirm", id, userId, at });
      await waitFor(() => results(A, id, "confirm").length === 1 && results(B, id, "confirm").length === 1);
      assert.ok((await calls(id)) <= 1, "business invoked more than once"); assert.equal(await status(id), "COMPLETED"); dbl += 1;
    }
    report.doubleConfirm = { rounds: dbl, maxBusinessCallsPerAction: 1 };

    // 3. stale EXECUTING reclaim: A claims then HANGS in the business call and is KILLED; time passes (claim back-dated); C reclaims.
    const id3 = await mk(); A.send({ cmd: "hold", id: id3 }); A.send({ cmd: "confirm", id: id3, userId, at: Date.now() });
    await waitFor(() => A.events.some((e) => e.ev === "business-entered" && e.id === id3));
    const C = child(); await waitFor(() => C.events.some((e) => e.ev === "ready"));
    C.send({ cmd: "confirm", id: id3, userId, at: Date.now() }); await waitFor(() => C.events.some((e) => e.ev === "result" && e.id === id3));
    const fresh = C.events.find((e) => e.ev === "result" && e.id === id3)!;
    report.freshClaimNotReclaimable = { ok: fresh.ok, error: fresh.error, status: await status(id3) };
    assert.equal(fresh.ok, false); assert.equal(await status(id3), "EXECUTING");
    A.p.kill("SIGKILL");
    await backdate(id3);
    C.send({ cmd: "confirm", id: id3, userId, at: Date.now() }); await waitFor(() => C.events.filter((e) => e.ev === "result" && e.id === id3).length === 2);
    report.staleReclaimAfterKill = { finalStatus: await status(id3), businessCallsAttempted: await calls(id3), businessObjects: await objects(id3), reclaimResult: C.events.filter((e) => e.ev === "result")[1].message };
    assert.equal(await status(id3), "COMPLETED"); assert.equal(await objects(id3), 1);

    // 4. LATE ORIGINAL OWNER: A2 claims and pauses; claim goes stale; B reclaims+completes; A2 resumes.
    const A2 = child(); await waitFor(() => A2.events.some((e) => e.ev === "ready"));
    const id4 = await mk(); A2.send({ cmd: "hold", id: id4 }); A2.send({ cmd: "confirm", id: id4, userId, at: Date.now() });
    await waitFor(() => A2.events.some((e) => e.ev === "business-entered" && e.id === id4));
    await backdate(id4);
    B.send({ cmd: "confirm", id: id4, userId, at: Date.now() }); await waitFor(() => results(B, id4, "confirm").length === 1);
    const bRes = results(B, id4, "confirm")[0]; const mid = await status(id4); const midResult = await prisma.fitnessAgentAction.findUnique({ where: { id: id4 }, select: { result: true } });
    A2.send({ cmd: "release", id: id4 }); await waitFor(() => A2.events.some((e) => e.ev === "result" && e.id === id4));
    const aRes = A2.events.find((e) => e.ev === "result" && e.id === id4)!;
    const fin = await prisma.fitnessAgentAction.findUnique({ where: { id: id4 } });
    report.lateOriginalOwner = { reclaimerOk: bRes.ok, statusAfterReclaim: mid, lateOwnerReportedOk: aRes.ok, lateOwnerMessage: aRes.message, finalStatus: fin!.status, finalResultIsReclaimersBlock: JSON.stringify(fin!.result) === JSON.stringify(midResult!.result), businessCallsAttempted: await calls(id4), businessObjects: await objects(id4) };
    assert.equal(await objects(id4), 1, "downstream identity must keep the business object single");
    assert.equal(fin!.status, "COMPLETED");
    A2.p.kill(); C.p.kill();
    console.log(JSON.stringify(report, null, 1));
    console.log("MULTIPROC VERIFY: PASS");
  } finally {
    for (const c of [A, B]) c.p.kill();
    await prisma.$executeRawUnsafe(`delete from race_business_calls where action_id in (select id from fitness_agent_actions where user_id='${userId}')`);
    await prisma.$executeRawUnsafe(`delete from race_business_objects where action_id in (select id from fitness_agent_actions where user_id='${userId}')`);
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
