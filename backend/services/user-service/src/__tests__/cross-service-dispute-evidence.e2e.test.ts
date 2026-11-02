/**
 * DISPUTE CASE slice 2 / S2.3 - the Case COLLECTOR of user-service reading the REAL internal routes of chat-service and gym-service over HTTP.
 *
 * Evidence labels: REAL HTTP + BACKEND INTEGRATION (cross-service). REAL: a gym-service process and a chat-service process (their real Express apps, real
 * Prisma, real service-secret checks) each on its own ephemeral port and its own isolated *_test database; user-service's collector and the real
 * dispute-evidence client in this process (their own *_test database). TEST FIXTURE: every row (synthetic: ids made up for the run, no real person) and the
 * contract/session rows of user-service. Both child URLs are REGISTERED with the outbound guard of the test preload (the list is printed); nothing else is reachable.
 *
 * Opt-in; run ALONE:
 *   RUN_CROSS_SERVICE_EVIDENCE=1 TEST_DATABASE_URL="...gymcoach_user_<x>_test?schema=public" \
 *   E2E_GYM_DATABASE_URL="...gymcoach_gym_<x>_test?schema=public" E2E_CHAT_DATABASE_URL="...gymcoach_chat_<x>_test?schema=public" \
 *   npx tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-dispute-evidence.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { validateTestDatabaseUrl } from "./setup/db-isolation-validator";
import { registerTestService, registeredTestServices } from "./setup/outbound-guard";
import { isIsolatedTestDatabaseUrl } from "./test-db-guard";

const GYM_URL_DB = process.env.E2E_GYM_DATABASE_URL;
const CHAT_URL_DB = process.env.E2E_CHAT_DATABASE_URL;
const usable =
  process.env.RUN_CROSS_SERVICE_EVIDENCE === "1" &&
  process.env.DB_ISOLATION === "accepted" &&
  isIsolatedTestDatabaseUrl(process.env.DATABASE_URL) &&
  validateTestDatabaseUrl(GYM_URL_DB).ok &&
  validateTestDatabaseUrl(CHAT_URL_DB).ok &&
  new Set([process.env.DATABASE_URL?.split("?")[0], GYM_URL_DB?.split("?")[0], CHAT_URL_DB?.split("?")[0]]).size === 3;
const skip = usable ? false : "Opt-in: RUN_CROSS_SERVICE_EVIDENCE=1 plus the preload-accepted TEST_DATABASE_URL and E2E_GYM_DATABASE_URL / E2E_CHAT_DATABASE_URL (three DIFFERENT isolated *_test databases).";

const GYM_SECRET = `e2e-gym-secret-${randomUUID()}`;
const CHAT_SECRET = `e2e-chat-secret-${randomUUID()}`;
const DEAD = "http://127.0.0.1:9";
const SERVICES = path.resolve(__dirname, "../../..");
const children: ChildProcess[] = [];
let gymUrl = "";
let chatUrl = "";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}
async function startChild(dir: string, env: Record<string, string>, port: number, name: string): Promise<string> {
  const log: string[] = [];
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: path.join(SERVICES, dir), env: { ...process.env, NODE_ENV: "test", ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  children.push(child);
  child.stdout!.on("data", (b: Buffer) => log.push(b.toString()));
  child.stderr!.on("data", (b: Buffer) => log.push(b.toString()));
  const url = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${name} exited early: ${log.slice(-15).join("")}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return url;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > 60_000) throw new Error(`${name} not healthy after 60s: ${log.slice(-15).join("")}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
function killTree(c: ChildProcess) {
  if (c.pid == null || c.exitCode !== null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGKILL");
  } catch {
    /* gone */
  }
}

// seeding clients (the generated clients of the other two services, pointed at THEIR test databases)
let gymDb: any;
let chatDb: any;
let userDb: typeof import("../repositories/profile.repository").prisma;
let collectSources: typeof import("../services/dispute-case/collector").collectSources;

const ids = { gym: randomUUID(), brandOwner: randomUUID(), pt: randomUUID(), otherPt: randomUUID(), member: randomUUID(), staff: randomUUID(), membership: "", plan: "" };
const made = { contracts: [] as string[], pts: [] as string[], gymCheckIns: [] as string[], gymPt: [] as string[], calls: [] as string[], convs: [] as string[], memberships: [] as string[], gyms: [] as string[], brands: [] as string[], plans: [] as string[] };
const PRIVATE = "PRIVATE-CHAT-TEXT-never-in-evidence";

test.before(async () => {
  if (skip) return;
  const gymPort = await freePort();
  const chatPort = await freePort();
  gymUrl = await startChild(
    "gym-service",
    { PORT: String(gymPort), DATABASE_URL: GYM_URL_DB!, INTERNAL_SERVICE_SECRET: GYM_SECRET, INTERNAL_API_SECRET: GYM_SECRET, PAYMENT_SERVICE_URL: DEAD, USER_SERVICE_URL: DEAD, AUTH_SERVICE_URL: DEAD, AI_SERVICE_URL: DEAD, CHAT_SERVICE_URL: DEAD, USER_LAMBDA_NAME: "", PAYMENT_LAMBDA_NAME: "", AUTH_LAMBDA_NAME: "", MEMBERSHIP_PAYOUT_SWEEP_INTERVAL_MS: "2147483647", REFERRAL_SETTLEMENT_SWEEP_INTERVAL_MS: "2147483647" },
    gymPort,
    "gym-service",
  );
  chatUrl = await startChild(
    "chat-service",
    { CHAT_SERVICE_PORT: String(chatPort), CHAT_DATABASE_URL: CHAT_URL_DB!, DATABASE_URL: CHAT_URL_DB!, INTERNAL_API_SECRET: CHAT_SECRET, AUTH_SERVICE_URL: DEAD, USER_SERVICE_URL: DEAD, USER_LAMBDA_NAME: "", AUTH_LAMBDA_NAME: "" },
    chatPort,
    "chat-service",
  );
  registerTestService(gymUrl);
  registerTestService(chatUrl);
  console.log(`[outbound-guard] test services registered for this run: ${registeredTestServices().join(", ")}`);
  process.env.GYM_SERVICE_URL = gymUrl;
  process.env.CHAT_SERVICE_URL = chatUrl;
  process.env.INTERNAL_SERVICE_SECRET = GYM_SECRET;
  process.env.INTERNAL_API_SECRET = CHAT_SECRET;
  delete process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED;

  userDb = (await import("../repositories/profile.repository")).prisma;
  collectSources = (await import("../services/dispute-case/collector")).collectSources;
  const { PrismaClient: GymClient } = require(path.join(SERVICES, "gym-service/src/generated/prisma"));
  gymDb = new GymClient({ datasourceUrl: GYM_URL_DB });
  const chatRequire = require("node:module").createRequire(path.join(SERVICES, "chat-service/package.json"));
  const { PrismaClient: ChatClient } = chatRequire("@prisma/client");
  chatDb = new ChatClient({ datasourceUrl: CHAT_URL_DB });

  // ── gym fixtures (synthetic) ──
  const brand = await gymDb.gymBrand.create({ data: { id: randomUUID(), ownerId: ids.brandOwner, name: "E2E Evidence Brand" } });
  made.brands.push(brand.id);
  const g = await gymDb.gym.create({ data: { id: ids.gym, ownerId: ids.brandOwner, brandId: brand.id, name: "E2E Evidence Gym", address: "1 Test St", status: "APPROVED" } });
  made.gyms.push(g.id);
  const plan = await gymDb.gymMembershipPlan.create({ data: { id: randomUUID(), brandId: brand.id, name: "E2E Plan", price: 500_000, durationDays: 30 } });
  made.plans.push(plan.id);
  ids.plan = plan.id;
  const mem = await gymDb.gymMembershipContract.create({ data: { id: randomUUID(), gymId: ids.gym, planId: plan.id, clientId: ids.member, status: "ACTIVE", priceAtPurchase: 500_000, durationDaysSnapshot: 30, startDate: new Date("2026-09-25T00:00:00Z"), endDate: new Date("2026-10-25T00:00:00Z") } });
  made.memberships.push(mem.id);
  ids.membership = mem.id;
});

test.after(async () => {
  for (const c of children) killTree(c);
  if (skip) return;
  const del = async (_db: any, fn: () => Promise<unknown>) => fn().catch(() => {});
  await del(gymDb, () => gymDb.gymCheckIn.deleteMany({ where: { id: { in: made.gymCheckIns } } }));
  await del(gymDb, () => gymDb.gymPtCheckIn.deleteMany({ where: { id: { in: made.gymPt } } }));
  await del(gymDb, () => gymDb.gymMembershipContract.deleteMany({ where: { id: { in: made.memberships } } }));
  await del(gymDb, () => gymDb.gymMembershipPlan.deleteMany({ where: { id: { in: made.plans } } }));
  await del(gymDb, () => gymDb.gym.deleteMany({ where: { id: { in: made.gyms } } }));
  await del(gymDb, () => gymDb.gymBrand.deleteMany({ where: { id: { in: made.brands } } }));
  await del(chatDb, () => chatDb.callSession.deleteMany({ where: { id: { in: made.calls } } }));
  await del(chatDb, () => chatDb.message.deleteMany({ where: { conversationId: { in: made.convs } } }));
  await del(chatDb, () => chatDb.conversationParticipant.deleteMany({ where: { conversationId: { in: made.convs } } }));
  await del(chatDb, () => chatDb.conversation.deleteMany({ where: { id: { in: made.convs } } }));
  await del(userDb, () => userDb.session.deleteMany({ where: { contractId: { in: made.contracts } } }));
  await del(userDb, () => userDb.contract.deleteMany({ where: { id: { in: made.contracts } } }));
  await del(userDb, () => userDb.userProfile.deleteMany({ where: { userId: { in: made.pts } } }));
  await gymDb?.$disconnect();
  await chatDb?.$disconnect();
  await userDb?.$disconnect();
});

async function mkSession(mode: "ONLINE" | "OFFLINE") {
  const { makeContract, addSession } = await import("./pt-restriction.test-helpers");
  const pt = mode === "OFFLINE" ? ids.pt : randomUUID();
  const contract = await makeContract(pt, { sessionMode: mode, gymId: mode === "OFFLINE" ? ids.gym : null, gymMembershipId: mode === "OFFLINE" ? ids.membership : null });
  made.contracts.push(contract.id);
  made.pts.push(pt);
  const start = new Date("2026-10-01T18:30:00Z"); // 2026-10-02 01:30 in Asia/Ho_Chi_Minh
  const session = await addSession(contract, "DISPUTED", start, { sessionMode: mode, disputeType: "DELIVERY_DISPUTE", disputedAt: new Date() });
  return { contract, session, pt };
}
const slot = (out: Awaited<ReturnType<typeof collectSources>>, subject: string) => out!.evidence.find((e) => e.subject === subject)!;

test("ONLINE session: the collector reads chat-service /internal/call-sessions over real HTTP - SERVER_OBSERVED, exactly that session's rows, no message text", { skip }, async () => {
  const s = await mkSession("ONLINE");
  const other = randomUUID();
  const conv = await chatDb.conversation.create({ data: { participants: { create: [{ userId: s.pt }, { userId: "client-x" }] }, messages: { create: [{ senderId: "client-x", content: PRIVATE }] } } });
  made.convs.push(conv.id);
  const mk = async (data: Record<string, unknown>) => made.calls.push((await chatDb.callSession.create({ data: { callType: "VIDEO", ...data } })).id);
  await mk({ conversationId: conv.id, callerId: s.pt, calleeId: "client-x", origin: "SESSION", coachingSessionId: s.session.id, status: "ENDED", startedAt: new Date("2026-10-01T18:46:00Z"), answeredAt: new Date("2026-10-01T18:45:58Z"), endedAt: new Date("2026-10-01T19:30:00Z"), endReason: "hangup" });
  await mk({ callerId: "pt-other", calleeId: "client-y", origin: "SESSION", coachingSessionId: other, status: "ENDED" });
  const out = await collectSources(userDb as any, s.session.id);
  const c = slot(out, "CALL_SESSIONS");
  assert.deepEqual([c.provenanceType, c.captureStatus, c.source], ["SERVER_OBSERVED", "OK", "chat-service.call_sessions"]);
  const rows = (c.payload as any).rows;
  assert.equal(rows.length, 1, "only this coaching session's row");
  assert.deepEqual([rows[0].callerId, rows[0].status, rows[0].endReason, rows[0].origin], [s.pt, "ENDED", "hangup", "SESSION"]);
  assert.match((c.payload as any).notProven, /Không chứng minh nội dung hay chất lượng buổi/);
  assert.equal(JSON.stringify(out).includes(PRIVATE), false, "no message text anywhere in the collected evidence");
  assert.equal(JSON.stringify(c.payload).includes(conv.id), false, "no conversation id");
  for (const subject of ["GYM_PT_CHECK_INS", "GYM_CHECK_INS_SELF_REPORTED", "GYM_CHECK_INS_STAFF_ATTESTED"]) assert.equal(slot(out, subject).captureStatus, "NOT_APPLICABLE", subject);
});

test("OFFLINE session at a gym: PT check-in (SELF_REPORTED_SERVER_RECORDED + DERIVED link) and member check-ins (self / staff-attested) come from the real gym-service routes", { skip }, async () => {
  const s = await mkSession("OFFLINE");
  const day = new Date("2026-10-02T00:00:00.000Z"); // local day of the session in Asia/Ho_Chi_Minh
  const mkPt = async (gymId: string, ptUserId: string, localDate: Date, scanCount: number, q: string[]) =>
    made.gymPt.push((await gymDb.gymPtCheckIn.create({ data: { gymId, ptUserId, localDate, firstScanAt: new Date("2026-10-01T17:10:00Z"), lastScanAt: new Date("2026-10-01T20:40:00Z"), scanCount, qualifyingSessionIds: q, contractIds: ["c-secret"] } })).id);
  await mkPt(ids.gym, ids.pt, day, 2, [s.session.id, "other-session"]);
  await mkPt(ids.gym, ids.pt, new Date("2026-10-01T00:00:00.000Z"), 9, []); // same PT, the day before
  await mkPt(ids.gym, ids.otherPt, day, 8, []); // another PT, same day
  const ev = await gymDb.gymAssistedCheckInEvent.create({ data: { id: randomUUID(), eventType: "CHECKIN_SUCCEEDED", gymId: ids.gym, staffUserId: ids.staff, staffRole: "OWNER", membershipId: ids.membership, clientId: ids.member, method: "MEMBER_OTP", outcome: "OK", reason: "secret reason" } });
  const ci = async (at: string, source: "QR" | "ASSISTED", by: string, eventId?: string) =>
    made.gymCheckIns.push((await gymDb.gymCheckIn.create({ data: { id: randomUUID(), membershipId: ids.membership, gymId: ids.gym, clientId: ids.member, checkedInBy: by, source, assistedEventId: eventId ?? null, createdAt: new Date(at) } })).id);
  await ci("2026-10-01T18:20:00Z", "QR", ids.member);
  await ci("2026-10-01T19:00:00Z", "ASSISTED", ids.staff, ev.id);
  await ci("2026-10-03T18:20:00Z", "QR", ids.member); // outside the window

  const out = await collectSources(userDb as any, s.session.id);
  const scan = slot(out, "GYM_PT_CHECK_INS");
  const link = slot(out, "GYM_PT_CHECK_INS_QUALIFYING_LINK");
  assert.deepEqual([scan.provenanceType, scan.captureStatus], ["SELF_REPORTED_SERVER_RECORDED", "OK"]);
  assert.equal((scan.payload as any).record.scanCount, 2, "this PT, this gym, this local day - not the 9 or the 8");
  assert.equal((scan.payload as any).localDate, "2026-10-02");
  assert.match((scan.payload as any).note, /Check-in gym không chứng minh buổi dạy PT đã diễn ra/);
  assert.deepEqual([link.provenanceType, (link.payload as any).includesThisSession], ["DERIVED", true]);
  const self = slot(out, "GYM_CHECK_INS_SELF_REPORTED");
  const staff = slot(out, "GYM_CHECK_INS_STAFF_ATTESTED");
  assert.deepEqual([self.provenanceType, self.captureStatus], ["SELF_REPORTED_SERVER_RECORDED", "OK"]);
  assert.deepEqual([staff.provenanceType, staff.captureStatus], ["STAFF_ATTESTED_SERVER_RECORDED", "OK"]);
  const sr = (self.payload as any).rows;
  const st = (staff.payload as any).rows;
  assert.deepEqual([sr.length, st.length], [1, 1], "the check-in outside the window is not returned");
  assert.deepEqual(sr[0].actor, { userId: ids.member, kind: "MEMBER_SELF" });
  assert.deepEqual([st[0].actor, st[0].identityVerification.method, st[0].identityVerification.staffRole], [{ userId: ids.staff, kind: "GYM_STAFF" }, "MEMBER_OTP", "OWNER"]);
  const text = JSON.stringify(out);
  for (const leak of ["c-secret", "secret reason", ids.otherPt]) assert.equal(text.includes(leak), false, `leaked ${leak}`);
  assert.equal(slot(out, "CALL_SESSIONS").captureStatus, "NOT_APPLICABLE");
});

test("a source that is down turns into UNAVAILABLE, never into 'no check-in' / 'no call': the address is not a registered test service (an unreachable service looks the same), the collector still answers", { skip }, async () => {
  const s = await mkSession("ONLINE");
  const keep = process.env.CHAT_SERVICE_URL;
  process.env.CHAT_SERVICE_URL = DEAD; // 127.0.0.1:9 is not registered with the guard: the call is refused, exactly as an unreachable service would be
  try {
    const out = await collectSources(userDb as any, s.session.id);
    assert.deepEqual([slot(out, "CALL_SESSIONS").provenanceType, slot(out, "CALL_SESSIONS").captureStatus], ["TECH_GAP", "UNAVAILABLE"]);
    assert.equal("rows" in slot(out, "CALL_SESSIONS").payload, false);
  } finally {
    process.env.CHAT_SERVICE_URL = keep;
  }
  // a wrong service secret is also UNAVAILABLE (401), not an empty list
  const keepSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "wrong";
  try {
    assert.equal(slot(await collectSources(userDb as any, s.session.id), "CALL_SESSIONS").captureStatus, "UNAVAILABLE");
  } finally {
    process.env.INTERNAL_API_SECRET = keepSecret;
  }
});
