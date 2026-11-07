/**
 * DISPUTE CASE slice 2 / S2.3 - the collector's cross-service evidence (chat call sessions, gym PT check-ins, gym member check-ins).
 * Evidence label: BACKEND INTEGRATION for the collector against the isolated *_test user database (real session / contract rows); the three external
 * sources are an in-memory fake (MOCKED DEPENDENCY) that records the keys it was asked with. The HTTP client + parsers are exercised against a local
 * HTTP server that speaks the internal routes' answers (REAL HTTP, TEST FIXTURE server). The routes themselves are proved in chat-service /
 * gym-service (internal-evidence-call-sessions.test.ts, internal-dispute-evidence.test.ts).
 *
 * Run ALONE (reads/writes dispute_case* only through the service; the collector tests write nothing).
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { collectSources } from "../services/dispute-case/collector";
import { externalEvidenceDrafts, httpExternalSources, localDateVN, MEMBER_WINDOW_PAD_MS, type ExternalSources } from "../services/dispute-case/external-evidence";
import { parseCallSessions, parseMemberCheckins, parsePtCheckin } from "../clients/dispute-evidence.client";
import { draftHash } from "../services/dispute-case/collector";
import { addSession, makeContract } from "./pt-restriction.test-helpers";

const contracts: string[] = [];
const pts: string[] = [];
test.after(async () => {
  await prisma.session.deleteMany({ where: { contractId: { in: contracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: contracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: pts } } }).catch(() => {});
  await prisma.$disconnect();
});

const calls: Array<[string, any]> = [];
let behaviour: { calls?: any; pt?: any; member?: any } = {};
const fake: ExternalSources = {
  callSessions: async (id) => {
    calls.push(["calls", id]);
    if (behaviour.calls instanceof Error) throw behaviour.calls;
    return behaviour.calls ?? [];
  },
  ptCheckin: async (q) => {
    calls.push(["pt", q]);
    if (behaviour.pt instanceof Error) throw behaviour.pt;
    return behaviour.pt ?? null;
  },
  memberCheckins: async (q) => {
    calls.push(["member", q]);
    if (behaviour.member instanceof Error) throw behaviour.member;
    return behaviour.member ?? [];
  },
};
test.beforeEach(() => {
  calls.length = 0;
  behaviour = {};
});

async function mk(o: { mode: "ONLINE" | "OFFLINE"; gymId?: string | null; membershipId?: string | null; start?: Date }) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: o.mode, gymId: o.gymId ?? null, gymMembershipId: o.membershipId ?? null });
  contracts.push(contract.id);
  pts.push(ptUserId);
  const start = o.start ?? new Date("2026-10-01T18:30:00Z"); // 2026-10-02 01:30 in Asia/Ho_Chi_Minh
  const session = await addSession(contract, "DISPUTED", start, { sessionMode: o.mode, disputeType: "DELIVERY_DISPUTE", disputedAt: new Date() });
  return { contract, session, ptUserId };
}
const slot = (ev: Awaited<ReturnType<typeof collectSources>>, subject: string) => ev!.evidence.find((e) => e.subject === subject)!;

test("ONLINE session: call_sessions are SERVER_OBSERVED (OK) with exactly the rows the source returned; gym sources are NOT_APPLICABLE and are not called", async () => {
  const s = await mk({ mode: "ONLINE", gymId: "gym-1", membershipId: "mem-1" });
  behaviour.calls = [{ id: "c1", status: "ENDED", startedAt: "2026-10-01T18:31:00Z", answeredAt: "2026-10-01T18:31:02Z", endedAt: "2026-10-01T19:20:00Z", endReason: "hangup", callerId: s.ptUserId, calleeId: "x", origin: "OPEN_ROOM" }];
  const out = await collectSources(prisma as any, s.session.id, fake);
  const c = slot(out, "CALL_SESSIONS");
  assert.deepEqual([c.provenanceType, c.captureStatus, c.source], ["SERVER_OBSERVED", "OK", "chat-service.call_sessions"]);
  assert.deepEqual((c.payload as any).rows, behaviour.calls);
  assert.match((c.payload as any).note, /không chứng minh buổi đã diễn ra/);
  for (const subject of ["GYM_PT_CHECK_INS", "GYM_PT_CHECK_INS_QUALIFYING_LINK", "GYM_CHECK_INS_SELF_REPORTED", "GYM_CHECK_INS_STAFF_ATTESTED"]) assert.equal(slot(out, subject).captureStatus, "NOT_APPLICABLE", subject);
  assert.deepEqual(calls, [["calls", s.session.id]], "only chat was asked, with the session id");
});

test("a source that answers with NO rows is a fact (OK, empty list), a source that FAILS is UNAVAILABLE with no number in it - never 0 rows / false", async () => {
  const s = await mk({ mode: "ONLINE" });
  const empty = await collectSources(prisma as any, s.session.id, fake);
  assert.deepEqual([slot(empty, "CALL_SESSIONS").captureStatus, (slot(empty, "CALL_SESSIONS").payload as any).rows], ["OK", []]);
  behaviour.calls = new Error("connect ECONNREFUSED 10.0.0.1:3005 (details that must not leak into a hash)");
  const down = await collectSources(prisma as any, s.session.id, fake);
  const c = slot(down, "CALL_SESSIONS");
  assert.deepEqual([c.provenanceType, c.captureStatus], ["TECH_GAP", "UNAVAILABLE"]);
  assert.equal("rows" in c.payload, false, "no rows field: 'we could not read' is not 'there were none'");
  assert.equal(JSON.stringify(c.payload).includes("ECONNREFUSED"), false);
  // another failure reason gives the SAME payload, so 'still unavailable' is not a change of evidence
  const first = draftHash(c);
  behaviour.calls = Object.assign(new Error("timeout of 3000ms exceeded"), { code: "ECONNABORTED" });
  assert.equal(draftHash(slot(await collectSources(prisma as any, s.session.id, fake), "CALL_SESSIONS")), first);
});

test("OFFLINE session at a gym: the PT check-in is SELF_REPORTED_SERVER_RECORDED (never SERVER_OBSERVED), its qualifying link is DERIVED (and says whether it includes THIS session); asked with the contract's gym id and the Vietnam local day", async () => {
  const s = await mk({ mode: "OFFLINE", gymId: "gym-7", membershipId: null });
  behaviour.pt = { firstScanAt: "2026-10-01T17:00:00Z", lastScanAt: "2026-10-01T19:30:00Z", scanCount: 2, qualifyingSessionIds: [s.session.id, "other"] };
  const out = await collectSources(prisma as any, s.session.id, fake);
  const scan = slot(out, "GYM_PT_CHECK_INS");
  const link = slot(out, "GYM_PT_CHECK_INS_QUALIFYING_LINK");
  assert.deepEqual([scan.provenanceType, scan.captureStatus], ["SELF_REPORTED_SERVER_RECORDED", "OK"]);
  assert.deepEqual((scan.payload as any).actor, { userId: s.ptUserId, kind: "PT_SELF" });
  assert.deepEqual((scan.payload as any).identityVerification, { method: "QR" });
  assert.match((scan.payload as any).note, /Check-in gym không chứng minh buổi dạy PT đã diễn ra/);
  assert.match((scan.payload as any).notProven, /không chứng minh buổi dạy PT đã diễn ra/);
  assert.deepEqual([link.provenanceType, link.captureStatus], ["DERIVED", "OK"]);
  assert.equal((link.payload as any).includesThisSession, true);
  assert.equal((scan.payload as any).found, true);
  assert.match((scan.payload as any).note, /Check-in gym không chứng minh buổi dạy PT đã diễn ra/);
  assert.deepEqual(calls, [["pt", { ptUserId: s.ptUserId, gymId: "gym-7", date: "2026-10-02" }]], "key = PT + the CONTRACT's gym + the local day (UTC 18:30 is already the next day in Asia/Ho_Chi_Minh)");
  assert.equal(localDateVN(new Date("2026-10-01T16:59:59Z")), "2026-10-01");
  assert.equal(localDateVN(new Date("2026-10-01T17:00:00Z")), "2026-10-02");
  assert.equal(slot(out, "CALL_SESSIONS").captureStatus, "NOT_APPLICABLE");
  assert.equal(slot(out, "GYM_CHECK_INS_SELF_REPORTED").captureStatus, "NOT_APPLICABLE", "no membership on the contract: not asked");
});

test("no PT scan on that day is OK + found:false (never 'absent'); the derived link is then NOT_APPLICABLE", async () => {
  const s = await mk({ mode: "OFFLINE", gymId: "gym-7" });
  behaviour.pt = null;
  const out = await collectSources(prisma as any, s.session.id, fake);
  assert.deepEqual([slot(out, "GYM_PT_CHECK_INS").captureStatus, (slot(out, "GYM_PT_CHECK_INS").payload as any).found, (slot(out, "GYM_PT_CHECK_INS").payload as any).record], ["OK", false, null]);
  assert.match((slot(out, "GYM_PT_CHECK_INS").payload as any).note, /không chứng minh PT vắng mặt/);
  assert.equal(slot(out, "GYM_PT_CHECK_INS_QUALIFYING_LINK").captureStatus, "NOT_APPLICABLE");
});

test("an OFFLINE session with no gym on the contract: nothing is guessed and the gym is not called; a membership on the contract is asked with a window of the session +/- 1 h", async () => {
  const none = await mk({ mode: "OFFLINE", gymId: null, membershipId: null });
  const out = await collectSources(prisma as any, none.session.id, fake);
  assert.deepEqual(calls, [], "no key -> no call");
  assert.match((slot(out, "GYM_PT_CHECK_INS").payload as any).note, /thiếu gymId/);
  assert.match((slot(out, "GYM_CHECK_INS_SELF_REPORTED").payload as any).note, /thiếu membershipId/);
  assert.match((slot(out, "GYM_CHECK_INS_STAFF_ATTESTED").payload as any).note, /thiếu membershipId/);

  const s = await mk({ mode: "OFFLINE", gymId: "gym-7", membershipId: "mem-9" });
  behaviour.member = [
    { createdAt: "2026-10-01T18:20:00Z", source: "QR", gymId: "gym-7", checkedInBy: "member-1", assisted: null },
    { createdAt: "2026-10-01T18:25:00Z", source: "ASSISTED", gymId: "gym-7", checkedInBy: "staff-1", assisted: { method: "PHOTO_MATCH", staffRole: "OWNER", eventAt: "2026-10-01T18:25:00Z" } },
  ];
  const out2 = await collectSources(prisma as any, s.session.id, fake);
  const self = slot(out2, "GYM_CHECK_INS_SELF_REPORTED");
  const staff = slot(out2, "GYM_CHECK_INS_STAFF_ATTESTED");
  assert.deepEqual([self.provenanceType, self.captureStatus], ["SELF_REPORTED_SERVER_RECORDED", "OK"]);
  assert.deepEqual([staff.provenanceType, staff.captureStatus], ["STAFF_ATTESTED_SERVER_RECORDED", "OK"]);
  const selfRows = (self.payload as any).rows;
  const staffRows = (staff.payload as any).rows;
  assert.equal(selfRows.length, 1);
  assert.equal(staffRows.length, 1);
  assert.deepEqual(selfRows[0].actor, { userId: "member-1", kind: "MEMBER_SELF" });
  assert.deepEqual(selfRows[0].identityVerification, { method: "QR" });
  assert.deepEqual(staffRows[0].actor, { userId: "staff-1", kind: "GYM_STAFF" });
  assert.deepEqual(staffRows[0].identityVerification, { method: "PHOTO_MATCH", staffRole: "OWNER", verifiedAt: "2026-10-01T18:25:00Z" });
  for (const x of [self, staff]) assert.match((x.payload as any).note, /Check-in gym không chứng minh buổi dạy PT đã diễn ra/);
  assert.notEqual(self.provenanceType, "SERVER_OBSERVED");
  assert.notEqual(staff.provenanceType, "SERVER_OBSERVED");
  const q: any = calls.find((c) => c[0] === "member")![1];
  assert.equal(q.membershipId, "mem-9");
  assert.equal(Date.parse(q.from), s.session.scheduledStartAt.getTime() - MEMBER_WINDOW_PAD_MS);
  assert.equal(Date.parse(q.to), s.session.scheduledEndAt.getTime() + MEMBER_WINDOW_PAD_MS);
  assert.ok(Date.parse(q.to) - Date.parse(q.from) <= 48 * 3600_000);
  // only an ASSISTED row: the self slot is empty, never SERVER_OBSERVED
  behaviour.member = [{ createdAt: "2026-10-01T18:20:00Z", source: "ASSISTED", gymId: "gym-7", checkedInBy: "staff-1", assisted: { method: "MEMBER_OTP", staffRole: "MANAGER", eventAt: "2026-10-01T18:20:00Z" } }];
  const only = await collectSources(prisma as any, s.session.id, fake);
  assert.deepEqual((slot(only, "GYM_CHECK_INS_SELF_REPORTED").payload as any).rows, []);
  assert.equal((slot(only, "GYM_CHECK_INS_STAFF_ATTESTED").payload as any).rows[0].identityVerification.method, "MEMBER_OTP");
});

test("every source failing: all three slots UNAVAILABLE (TECH_GAP), the rest of the case evidence is still collected", async () => {
  const s = await mk({ mode: "OFFLINE", gymId: "gym-7", membershipId: "mem-9" });
  behaviour = { pt: new Error("boom"), member: new Error("boom") };
  const out = await collectSources(prisma as any, s.session.id, fake);
  for (const subject of ["GYM_PT_CHECK_INS", "GYM_PT_CHECK_INS_QUALIFYING_LINK", "GYM_CHECK_INS_SELF_REPORTED", "GYM_CHECK_INS_STAFF_ATTESTED"]) assert.deepEqual([slot(out, subject).provenanceType, slot(out, subject).captureStatus], ["TECH_GAP", "UNAVAILABLE"], subject);
  assert.ok(slot(out, "SESSION_ROW").captureStatus === "OK");
});

test("external sources null (the placeholder mode of the Slice 1 suites): the three Slice 1 UNAVAILABLE rows, no call", async () => {
  const s = await mk({ mode: "ONLINE" });
  const out = await collectSources(prisma as any, s.session.id, null);
  assert.deepEqual(["CALL_SESSIONS", "GYM_PT_CHECK_INS", "GYM_CHECK_INS"].map((x) => slot(out, x).captureStatus), ["UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"]);
  assert.equal(calls.length, 0);
});

// ── the HTTP client against a local server speaking the internal routes ─────────────────────────────────────────────

test("REAL HTTP client: a wrong secret (401), a 500, a malformed answer and a dead port all become UNAVAILABLE; a good answer is parsed; secrets and keys are sent as the routes expect", async () => {
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
  let mode: "ok" | "401" | "500" | "garbage" = "ok";
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (mode === "401") return send(401, { error: "Unauthorized" });
    if (mode === "500") return send(500, { error: "boom" });
    if (mode === "garbage") return send(200, { rows: "nope" });
    if (req.url?.startsWith("/internal/call-sessions")) return send(200, { data: [{ id: "c1", status: "ENDED", startedAt: null, answeredAt: null, endedAt: null, endReason: null, callerId: "a", calleeId: "b", origin: "CHAT" }] });
    if (req.url?.startsWith("/internal/pt-checkins")) return send(200, { data: null });
    return send(200, { data: [{ createdAt: "2026-10-01T18:20:00Z", source: "QR", gymId: "g", checkedInBy: "m", assisted: null }] });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const keep = { c: process.env.CHAT_SERVICE_URL, g: process.env.GYM_SERVICE_URL, a: process.env.INTERNAL_API_SECRET, s: process.env.INTERNAL_SERVICE_SECRET };
  process.env.CHAT_SERVICE_URL = url;
  process.env.GYM_SERVICE_URL = url;
  process.env.INTERNAL_API_SECRET = "chat-secret";
  process.env.INTERNAL_SERVICE_SECRET = "gym-secret";
  try {
    const s = await mk({ mode: "OFFLINE", gymId: "gym-7", membershipId: "mem-9" });
    const keys = { id: s.session.id, sessionMode: "OFFLINE", ptUserId: s.ptUserId, scheduledStartAt: s.session.scheduledStartAt, scheduledEndAt: s.session.scheduledEndAt, contractGymId: "gym-7", contractGymMembershipId: "mem-9" };
    const ok = await externalEvidenceDrafts(keys, httpExternalSources);
    assert.deepEqual(ok.map((e) => [e.subject, e.captureStatus]), [["CALL_SESSIONS", "NOT_APPLICABLE"], ["GYM_PT_CHECK_INS", "OK"], ["GYM_PT_CHECK_INS_QUALIFYING_LINK", "NOT_APPLICABLE"], ["GYM_CHECK_INS_SELF_REPORTED", "OK"], ["GYM_CHECK_INS_STAFF_ATTESTED", "OK"]]);
    const gymCall = seen.find((x) => x.url.startsWith("/internal/pt-checkins"))!;
    assert.equal(gymCall.headers["x-service-secret"], "gym-secret");
    assert.match(gymCall.url, /ptUserId=.*&gymId=gym-7&date=2026-10-02/);
    const online = await externalEvidenceDrafts({ ...keys, sessionMode: "ONLINE" }, httpExternalSources);
    assert.equal(online[0].captureStatus, "OK");
    assert.equal(seen.find((x) => x.url.startsWith("/internal/call-sessions"))!.headers["x-internal-secret"], "chat-secret");

    for (const m of ["401", "500", "garbage"] as const) {
      mode = m;
      const bad = await externalEvidenceDrafts({ ...keys, sessionMode: m === "garbage" ? "ONLINE" : "OFFLINE" }, httpExternalSources);
      const statuses = bad.filter((e) => e.captureStatus !== "NOT_APPLICABLE").map((e) => e.captureStatus);
      assert.ok(statuses.length > 0 && statuses.every((x) => x === "UNAVAILABLE"), `${m}: ${JSON.stringify(bad.map((e) => [e.subject, e.captureStatus]))}`);
    }
    await new Promise((r) => server.close(r));
    process.env.CHAT_SERVICE_URL = "http://127.0.0.1:9";
    process.env.GYM_SERVICE_URL = "http://127.0.0.1:9";
    const dead = await externalEvidenceDrafts(keys, httpExternalSources);
    assert.ok(dead.filter((e) => e.captureStatus !== "NOT_APPLICABLE").every((e) => e.captureStatus === "UNAVAILABLE"));
  } finally {
    for (const [k, v] of Object.entries({ CHAT_SERVICE_URL: keep.c, GYM_SERVICE_URL: keep.g, INTERNAL_API_SECRET: keep.a, INTERNAL_SERVICE_SECRET: keep.s })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    server.close();
  }
});

test("the answer parsers refuse anything that is not exactly the documented shape", () => {
  assert.throws(() => parseCallSessions({}), /BAD_ANSWER/);
  assert.throws(() => parseCallSessions({ data: [{ id: 1 }] }), /BAD_ANSWER/);
  assert.throws(() => parsePtCheckin({}), /BAD_ANSWER/);
  assert.throws(() => parsePtCheckin({ data: { firstScanAt: "x" } }), /BAD_ANSWER/);
  assert.throws(() => parseMemberCheckins({ data: "x" }), /BAD_ANSWER/);
  assert.equal(parsePtCheckin({ data: null }), null);
  assert.deepEqual(parseMemberCheckins({ data: [] }), []);
});
