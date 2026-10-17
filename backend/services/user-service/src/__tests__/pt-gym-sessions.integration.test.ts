/**
 * Phase 2 / P2.1 - GET /internal/pt/:ptUserId/gym-sessions (PT QR check-in, read-only; D16 / D17 / D38 / D59 / D70).
 *
 * Proves: every session status in/out (Q14), another gym, ONLINE/HYBRID out, window overlap incl. a session across midnight (Q18),
 * the D38 example (An-Binh restricted, An-Chi fine -> only Chi's session, ptActive=true), account suspension and ban ->
 * ptActive=false, a recorded-but-unconfirmed contract ending (D59 / Q-E) out, CANCELLED / EXPIRED / other contract statuses out,
 * validation 400s, service-secret 401, no client identity in the answer, and that the call WRITES NOTHING.
 *
 * Evidence label: BACKEND INTEGRATION (real Express app on a random port, real SQL, the isolated *_test database). The restriction
 * episodes of the "real service" tests are made by the real ptRestrictionService (payment-service / push stubbed at the client
 * boundary = TEST FIXTURE); the others are inserted rows (TEST FIXTURE). Run:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_p21_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/pt-gym-sessions.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { ptRestrictionService } from "../services/pt-restriction.service";
import { PT_CHECKIN_SESSION_STATUSES, parsePtGymSessionsQuery } from "../services/pt-gym-sessions.service";
import { HOUR, addSession, cleanup, makeContract, makePt, skip, stubs } from "./pt-restriction.test-helpers";
import { SERVICE_SECRET, makeAn, startApp, type App } from "./pt-contract-scope.test-helpers";

let app: App;
test.before(async () => {
  if (!skip) app = await startApp();
});
test.after(async () => {
  await app?.close();
});

const GYM = "gym-p21-main";
const OTHER_GYM = "gym-p21-other";
// The local day 2031-03-10 in Asia/Ho_Chi_Minh (UTC+7) as UTC instants - exactly what gym-service sends.
const DAY_FROM = new Date("2031-03-09T17:00:00.000Z");
const DAY_TO = new Date("2031-03-10T17:00:00.000Z");
const NEXT_FROM = DAY_TO;
const NEXT_TO = new Date("2031-03-11T17:00:00.000Z");
const at = (iso: string) => new Date(iso);
const NOON = at("2031-03-10T05:00:00.000Z"); // 12:00 local

async function get(pt: string, gymId: string | null, from: Date | string | null, to: Date | string | null, headers: Record<string, string> = SERVICE_SECRET) {
  const qs = new URLSearchParams();
  if (gymId !== null) qs.set("gymId", gymId);
  if (from !== null) qs.set("from", from instanceof Date ? from.toISOString() : from);
  if (to !== null) qs.set("to", to instanceof Date ? to.toISOString() : to);
  return app.call("GET", `/internal/pt/${pt}/gym-sessions?${qs}`, null, undefined, headers);
}
const ids = (body: any) => (body.sessions as any[]).map((s) => s.sessionId);

test("every session status: only CONFIRMED, PENDING_CLIENT_CONFIRMATION, COMPLETED are returned (Q14)", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { gymId: GYM });
  try {
    const all = ["REQUESTED", "CONFIRMED", "PENDING_CLIENT_CONFIRMATION", "DISPUTED", "PT_NO_SHOW_REPORTED", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"];
    const created: Record<string, string> = {};
    let i = 0;
    for (const st of all) {
      try {
        created[st] = (await addSession(c, st, new Date(NOON.getTime() + i++ * 2 * HOUR))).id;
      } catch {
        /* a status this schema version does not have */
      }
    }
    const { status, body } = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.ptActive, true);
    assert.equal(body.ptBlockedReason, null);
    assert.deepEqual(
      new Set(ids(body)),
      new Set(["CONFIRMED", "PENDING_CLIENT_CONFIRMATION", "COMPLETED"].map((s) => created[s])),
    );
    assert.deepEqual([...PT_CHECKIN_SESSION_STATUSES].sort(), ["COMPLETED", "CONFIRMED", "PENDING_CLIENT_CONFIRMATION"]);
    assert.ok(Object.keys(created).length >= 8, "the excluded statuses were really created and really left out");
  } finally {
    await cleanup([pt], [c.id]);
  }
});

test("response shape: exact keys, sorted by scheduledStartAt, no client identity or money field", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { gymId: GYM });
  try {
    const late = await addSession(c, "CONFIRMED", at("2031-03-10T09:00:00.000Z"), { notes: "ghi chú riêng", location: "Phòng 3" });
    const early = await addSession(c, "COMPLETED", at("2031-03-10T01:00:00.000Z"));
    const mid = await addSession(c, "PENDING_CLIENT_CONFIRMATION", at("2031-03-10T05:00:00.000Z"));
    const { status, body } = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body).sort(), ["gymId", "ptActive", "ptBlockedReason", "ptUserId", "sessions"]);
    assert.equal(body.ptUserId, pt);
    assert.equal(body.gymId, GYM);
    assert.deepEqual(ids(body), [early.id, mid.id, late.id], "sorted by scheduledStartAt");
    for (const s of body.sessions) {
      assert.deepEqual(Object.keys(s).sort(), ["contractId", "scheduledEndAt", "scheduledStartAt", "sessionId", "status"]);
      assert.equal(s.contractId, c.id);
    }
    assert.equal(body.sessions[0].scheduledStartAt, "2031-03-10T01:00:00.000Z");
    assert.equal(body.sessions[0].scheduledEndAt, "2031-03-10T02:00:00.000Z");
    const text = JSON.stringify(body);
    assert.ok(!text.includes(c.clientUserId), "the client's id is never returned");
    const withoutStatusValues = text.replace(/PENDING_CLIENT_CONFIRMATION/g, "");
    assert.ok(!/client|notes|location|price|ghi chú|Phòng 3/i.test(withoutStatusValues), "no client / notes / location / money field");
  } finally {
    await cleanup([pt], [c.id]);
  }
});

test("scope: another gym's contract, ONLINE and HYBRID sessions, another PT's sessions are not returned", { skip }, async () => {
  const pt = await makePt();
  const other = await makePt();
  const here = await makeContract(pt, { gymId: GYM });
  const elsewhere = await makeContract(pt, { gymId: OTHER_GYM });
  const noGym = await makeContract(pt, { gymId: null });
  const theirs = await makeContract(other, { gymId: GYM });
  try {
    const ok = await addSession(here, "CONFIRMED", NOON);
    await addSession(here, "CONFIRMED", new Date(NOON.getTime() + 2 * HOUR), { sessionMode: "ONLINE" });
    await addSession(here, "CONFIRMED", new Date(NOON.getTime() + 4 * HOUR), { sessionMode: "HYBRID" });
    await addSession(elsewhere, "CONFIRMED", NOON);
    await addSession(noGym, "CONFIRMED", NOON);
    await addSession(theirs, "CONFIRMED", NOON);
    const r = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.deepEqual(ids(r.body), [ok.id]);
    const r2 = await get(pt, OTHER_GYM, DAY_FROM, DAY_TO);
    assert.equal(r2.body.sessions.length, 1);
    assert.equal(r2.body.sessions[0].contractId, elsewhere.id);
    assert.deepEqual((await get(pt, "gym-that-does-not-exist", DAY_FROM, DAY_TO)).body.sessions, []);
  } finally {
    await cleanup([pt, other], [here.id, elsewhere.id, noGym.id, theirs.id]);
  }
});

test("window [from, to): overlap rule, boundaries, and a session across midnight counts for BOTH days (Q18)", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { gymId: GYM });
  try {
    const inDay = await addSession(c, "CONFIRMED", NOON);
    // 23:30 -> 00:30 local: starts on the 10th, ends on the 11th
    const across = await addSession(c, "CONFIRMED", at("2031-03-10T16:30:00.000Z"), { scheduledEndAt: at("2031-03-10T17:30:00.000Z") });
    // ends EXACTLY at `from` of the day (previous day's 23:00-00:00 local) - touches, does not overlap
    const endsAtFrom = await addSession(c, "CONFIRMED", at("2031-03-09T16:00:00.000Z"), { scheduledEndAt: DAY_FROM });
    // starts EXACTLY at `to` (00:00 local the next day) - touches, does not overlap
    const startsAtTo = await addSession(c, "CONFIRMED", DAY_TO);
    // crosses `from`: 22:30 -> 23:30 UTC-day-before, i.e. 05:30..07:30 local... make it straddle from
    const straddlesFrom = await addSession(c, "CONFIRMED", at("2031-03-09T16:30:00.000Z"), { scheduledEndAt: at("2031-03-09T17:30:00.000Z") });
    const farBefore = await addSession(c, "CONFIRMED", at("2031-03-05T05:00:00.000Z"));

    const d10 = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.deepEqual(new Set(ids(d10.body)), new Set([inDay.id, across.id, straddlesFrom.id]));
    assert.ok(!ids(d10.body).includes(endsAtFrom.id), "ends exactly at from: no overlap");
    assert.ok(!ids(d10.body).includes(startsAtTo.id), "starts exactly at to: no overlap");
    assert.ok(!ids(d10.body).includes(farBefore.id));

    const d11 = await get(pt, GYM, NEXT_FROM, NEXT_TO);
    assert.deepEqual(new Set(ids(d11.body)), new Set([across.id, startsAtTo.id]), "the midnight-crossing session is returned for the next day too");
    const d09 = await get(pt, GYM, new Date(DAY_FROM.getTime() - 24 * HOUR), DAY_FROM);
    assert.ok(ids(d09.body).includes(straddlesFrom.id) && ids(d09.body).includes(endsAtFrom.id));
    assert.ok(!ids(d09.body).includes(inDay.id));
  } finally {
    await cleanup([pt], [c.id]);
  }
});

test("a window given with an explicit +07:00 offset means the same instants (no server-TZ dependence)", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { gymId: GYM });
  try {
    const s = await addSession(c, "CONFIRMED", at("2031-03-09T17:30:00.000Z")); // 00:30 local on the 10th
    const q = new URLSearchParams({ gymId: GYM, from: "2031-03-10T00:00:00+07:00", to: "2031-03-11T00:00:00+07:00" });
    const r = await app.call("GET", `/internal/pt/${pt}/gym-sessions?${q}`, null, undefined, SERVICE_SECRET);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(ids(r.body), [s.id]);
  } finally {
    await cleanup([pt], [c.id]);
  }
});

test("contract status: ACTIVE and COMPLETED count; CANCELLED, EXPIRED, REJECTED and unpaid contracts do not", { skip }, async () => {
  const pt = await makePt();
  const mk = (status: string, extra: Record<string, unknown> = {}) => makeContract(pt, { gymId: GYM, status, ...extra });
  const cs = {
    ACTIVE: await mk("ACTIVE"),
    COMPLETED: await mk("COMPLETED"),
    CANCELLED: await mk("CANCELLED"),
    EXPIRED: await mk("EXPIRED"),
    REJECTED: await mk("REJECTED"),
    PENDING_PAYMENT: await mk("PENDING_PAYMENT", { paymentTransactionId: null }),
    PENDING_REVIEW: await mk("PENDING_REVIEW", { paymentTransactionId: null }),
  };
  try {
    const made: Record<string, string> = {};
    for (const [name, c] of Object.entries(cs)) made[name] = (await addSession(c, "CONFIRMED", NOON)).id;
    const r = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.deepEqual(new Set(ids(r.body)), new Set([made.ACTIVE, made.COMPLETED]));
    assert.equal(r.body.ptActive, true);
  } finally {
    await cleanup([pt], Object.values(cs).map((c) => c.id));
  }
});

test("D38 example: An-Binh restricted at CONTRACT scope, An-Chi fine -> only Chi's session, ptActive=true (inserted restriction row)", { skip }, async () => {
  const gym = GYM;
  const { pt, contracts, ids: cids } = await makeAn({ gymId: gym });
  try {
    const binh = await addSession(contracts.binh, "CONFIRMED", NOON);
    const chi = await addSession(contracts.chi, "CONFIRMED", new Date(NOON.getTime() + 2 * HOUR));
    const before = await get(pt, gym, DAY_FROM, DAY_TO);
    assert.deepEqual(new Set(ids(before.body)), new Set([binh.id, chi.id]));

    await prisma.ptRestriction.create({
      data: { ptUserId: pt, type: "TEMPORARY_SUSPENSION", imposedBy: "admin-1", scope: "CONTRACT", contractId: contracts.binh.id },
    });
    const r = await get(pt, gym, DAY_FROM, DAY_TO);
    assert.equal(r.status, 200);
    assert.equal(r.body.ptActive, true, "a contract-scope restriction does not make the PT inactive");
    assert.equal(r.body.ptBlockedReason, null);
    assert.deepEqual(ids(r.body), [chi.id], "only Chi's session");

    // lifting it brings Binh back
    await prisma.ptRestriction.updateMany({ where: { ptUserId: pt }, data: { endedAt: new Date(), endKind: "LIFTED" as any } });
    assert.deepEqual(new Set(ids((await get(pt, gym, DAY_FROM, DAY_TO)).body)), new Set([binh.id, chi.id]));
  } finally {
    await cleanup([pt], cids);
  }
});

test("D38 example through the REAL ptRestrictionService.restrictContract: Binh's awaiting-confirmation session is out, Chi's stays", { skip }, async () => {
  const { pt, contracts, ids: cids } = await makeAn({ gymId: GYM });
  const s = stubs();
  try {
    // Sessions that a contract restriction does NOT cancel: waiting for the client's confirmation.
    const binh = await addSession(contracts.binh, "PENDING_CLIENT_CONFIRMATION", NOON);
    const chi = await addSession(contracts.chi, "PENDING_CLIENT_CONFIRMATION", new Date(NOON.getTime() + 2 * HOUR));
    await ptRestrictionService.restrictContract({
      ptUserId: pt,
      contractId: contracts.binh.id,
      adminId: "admin-1",
      reasonCategory: "COMPLAINT_REVIEW" as any,
      reasonText: "khiếu nại riêng lẻ",
      publicReason: "Đang xem xét",
    });
    const r = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.equal(r.body.ptActive, true);
    assert.deepEqual(ids(r.body), [chi.id]);
    assert.ok(!ids(r.body).includes(binh.id));
  } finally {
    s.restore();
    await cleanup([pt], cids);
  }
});

test("account suspension (real service) -> ptActive=false PT_ACCOUNT_RESTRICTED, no sessions", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { gymId: GYM });
  const s = stubs();
  try {
    await addSession(c, "PENDING_CLIENT_CONFIRMATION", NOON);
    const before = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.equal(before.body.sessions.length, 1);
    await ptRestrictionService.suspend({
      ptUserId: pt,
      adminId: "admin-1",
      reasonCategory: "COMPLAINT_REVIEW" as any,
      reasonText: "tạm dừng",
      publicReason: "Đang xem xét",
    });
    const r = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.equal(r.status, 200);
    assert.deepEqual(
      { ptUserId: r.body.ptUserId, gymId: r.body.gymId, ptActive: r.body.ptActive, ptBlockedReason: r.body.ptBlockedReason, sessions: r.body.sessions },
      { ptUserId: pt, gymId: GYM, ptActive: false, ptBlockedReason: "PT_ACCOUNT_RESTRICTED", sessions: [] },
    );
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("permanent ban row -> PT_BANNED; the fail-closed legacy flag (no row) -> PT_BANNED too; both with sessions=[]", { skip }, async () => {
  const banned = await makePt();
  const flagged = await makePt({ ptSuspended: true });
  const cb = await makeContract(banned, { gymId: GYM });
  const cf = await makeContract(flagged, { gymId: GYM });
  try {
    await addSession(cb, "CONFIRMED", NOON);
    await addSession(cf, "CONFIRMED", NOON);
    await prisma.ptRestriction.create({ data: { ptUserId: banned, type: "PERMANENT_BAN", imposedBy: "admin-1", scope: "ACCOUNT" } });
    await prisma.userProfile.update({ where: { userId: banned }, data: { ptSuspended: true } });
    for (const pt of [banned, flagged]) {
      const r = await get(pt, GYM, DAY_FROM, DAY_TO);
      assert.equal(r.status, 200);
      assert.equal(r.body.ptActive, false);
      assert.equal(r.body.ptBlockedReason, "PT_BANNED");
      assert.deepEqual(r.body.sessions, []);
    }
  } finally {
    await cleanup([banned, flagged], [cb.id, cf.id]);
  }
});

test("PT_NOT_FOUND (no profile) and NOT_A_PT (profile is not a PT), both 200 with sessions=[]", { skip }, async () => {
  const customer = randomUUID();
  await prisma.userProfile.create({ data: { userId: customer, isPT: false } });
  const c = await makeContract(await makePt(), { gymId: GYM });
  try {
    const ghost = await get(randomUUID(), GYM, DAY_FROM, DAY_TO);
    assert.equal(ghost.status, 200);
    assert.deepEqual([ghost.body.ptActive, ghost.body.ptBlockedReason, ghost.body.sessions], [false, "PT_NOT_FOUND", []]);
    const notPt = await get(customer, GYM, DAY_FROM, DAY_TO);
    assert.deepEqual([notPt.status, notPt.body.ptActive, notPt.body.ptBlockedReason, notPt.body.sessions], [200, false, "NOT_A_PT", []]);
  } finally {
    await cleanup([customer, c.ptUserId], [c.id]);
  }
});

test("CONTRACT_ENDING (D59 / Q-E): a recorded-but-unconfirmed termination excludes only that contract; SETTLED does not", { skip }, async () => {
  const pt = await makePt();
  const ending = await makeContract(pt, { gymId: GYM });
  const endingFailed = await makeContract(pt, { gymId: GYM });
  const ended = await makeContract(pt, { gymId: GYM });
  const fine = await makeContract(pt, { gymId: GYM });
  try {
    const sEnding = await addSession(ending, "CONFIRMED", NOON);
    const sFailed = await addSession(endingFailed, "PENDING_CLIENT_CONFIRMATION", NOON);
    const sEnded = await addSession(ended, "COMPLETED", NOON);
    const sFine = await addSession(fine, "CONFIRMED", NOON);
    const row = (c: { id: string }, status: string) =>
      prisma.sessionSettlement.create({
        data: { kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${c.id}`, contractId: c.id, reason: "CLIENT_CANCELLED", status: status as any },
      });
    await row(ending, "PENDING");
    await row(endingFailed, "FAILED");
    await row(ended, "SETTLED");

    const r = await get(pt, GYM, DAY_FROM, DAY_TO);
    assert.deepEqual(new Set(ids(r.body)), new Set([sEnded.id, sFine.id]));
    assert.ok(!ids(r.body).includes(sEnding.id) && !ids(r.body).includes(sFailed.id));
    assert.equal(r.body.ptActive, true);

    // the confirmation arrives: the ending is no longer "unconfirmed" -> the same predicate lets the contract through again
    await prisma.sessionSettlement.update({ where: { idempotencyKey: `CONTRACT_TERMINATE:${ending.id}` }, data: { status: "SETTLED" } });
    assert.ok(ids((await get(pt, GYM, DAY_FROM, DAY_TO)).body).includes(sEnding.id));
  } finally {
    await cleanup([pt], [ending.id, endingFailed.id, ended.id, fine.id]);
  }
});

test("a settlement row of another kind (SESSION_RELEASE) does not count as an ending", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { gymId: GYM });
  try {
    const sess = await addSession(c, "COMPLETED", NOON);
    await prisma.sessionSettlement.create({
      data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sess.id}`, contractId: c.id, sessionId: sess.id, status: "PENDING" },
    });
    assert.deepEqual(ids((await get(pt, GYM, DAY_FROM, DAY_TO)).body), [sess.id]);
  } finally {
    await cleanup([pt], [c.id]);
  }
});

// Prisma query counter (middleware is process-wide and cannot be removed, so it only counts while `counting` is set).
let counting: string[] | null = null;
prisma.$use(async (params, next) => {
  counting?.push(`${params.model}.${params.action}`);
  return next(params);
});

test("no N+1: the number of queries does not grow with the number of contracts / sessions", { skip }, async () => {
  const pt = await makePt();
  const contracts = [] as Awaited<ReturnType<typeof makeContract>>[];
  const measure = async () => {
    counting = [];
    try {
      const r = await get(pt, GYM, DAY_FROM, DAY_TO);
      assert.equal(r.status, 200);
      return { queries: counting.slice(), body: r.body };
    } finally {
      counting = null;
    }
  };
  try {
    contracts.push(await makeContract(pt, { gymId: GYM }));
    await addSession(contracts[0], "CONFIRMED", NOON);
    const one = await measure();
    assert.equal(one.body.sessions.length, 1);

    for (let i = 1; i < 12; i++) contracts.push(await makeContract(pt, { gymId: GYM }));
    for (const [i, c] of contracts.entries()) if (i > 0) await addSession(c, "CONFIRMED", new Date(NOON.getTime() + i * 1800_000));
    await prisma.ptRestriction.create({
      data: { ptUserId: pt, type: "TEMPORARY_SUSPENSION", imposedBy: "admin-1", scope: "CONTRACT", contractId: contracts[3].id },
    });
    const many = await measure();
    assert.equal(many.body.sessions.length, 11, "12 sessions, one restricted contract's session left out");
    assert.equal(many.queries.length, one.queries.length, `same number of queries for 1 and 12 contracts: ${many.queries.join(", ")}`);
    assert.ok(many.queries.length <= 8, many.queries.join(", "));
    assert.ok(!many.queries.some((q) => /.(create|update|upsert|delete)/.test(q)), "no write query at all");
  } finally {
    await cleanup([pt], contracts.map((c) => c.id));
  }
});

test("validation: missing / malformed / reversed / over-48h window and missing gymId -> 400 INVALID_QUERY", { skip }, async () => {
  const pt = await makePt();
  try {
    const bad: Array<[string, string | null, Date | string | null, Date | string | null]> = [
      ["no gymId", null, DAY_FROM, DAY_TO],
      ["empty gymId", "  ", DAY_FROM, DAY_TO],
      ["no from", GYM, null, DAY_TO],
      ["no to", GYM, DAY_FROM, null],
      ["from not a date", GYM, "yesterday", DAY_TO],
      ["to not a date", GYM, DAY_FROM, "2031-13-45T00:00:00Z"],
      ["number", GYM, "1899999999", DAY_TO],
      ["date only", GYM, "2031-03-10", "2031-03-11"],
      ["no zone (would depend on the server TZ)", GYM, "2031-03-10T00:00:00", "2031-03-11T00:00:00"],
      ["from == to", GYM, DAY_FROM, DAY_FROM],
      ["from > to", GYM, DAY_TO, DAY_FROM],
      ["49h window", GYM, DAY_FROM, new Date(DAY_FROM.getTime() + 49 * HOUR)],
      ["a week", GYM, DAY_FROM, new Date(DAY_FROM.getTime() + 168 * HOUR)],
    ];
    for (const [name, g, f, t] of bad) {
      const r = await get(pt, g, f, t);
      assert.equal(r.status, 400, name);
      assert.equal(r.body.code, "INVALID_QUERY", name);
      assert.ok(r.body.error, name);
    }
    // exactly 48h is allowed
    assert.equal((await get(pt, GYM, DAY_FROM, new Date(DAY_FROM.getTime() + 48 * HOUR))).status, 200);
    // repeated query params are refused, not guessed
    const dup = await app.call("GET", `/internal/pt/${pt}/gym-sessions?gymId=a&gymId=b&from=${DAY_FROM.toISOString()}&to=${DAY_TO.toISOString()}`, null, undefined, SERVICE_SECRET);
    assert.equal(dup.status, 400);
  } finally {
    await cleanup([pt], []);
  }
});

test("parsePtGymSessionsQuery: pure rules", () => {
  const ok = parsePtGymSessionsQuery({ gymId: " g ", from: "2031-03-10T00:00:00Z", to: "2031-03-12T00:00:00Z" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.gymId, "g");
  assert.equal(parsePtGymSessionsQuery({ gymId: "g", from: "2031-03-10T00:00:00Z", to: "2031-03-12T00:00:00.001Z" }).ok, false);
  assert.equal(parsePtGymSessionsQuery({ gymId: ["g"], from: "2031-03-10T00:00:00Z", to: "2031-03-10T01:00:00Z" }).ok, false);
});

test("service secret: no header / wrong secret -> 401 and nothing is read", { skip }, async () => {
  const pt = await makePt();
  try {
    const none = await get(pt, GYM, DAY_FROM, DAY_TO, {});
    assert.equal(none.status, 401);
    assert.equal(none.body.sessions, undefined);
    const wrong = await get(pt, GYM, DAY_FROM, DAY_TO, { "x-service-secret": "not-the-secret" });
    assert.equal(wrong.status, 401);
    // a user bearer token is not a service secret
    const bearer = await app.call("GET", `/internal/pt/${pt}/gym-sessions?gymId=${GYM}&from=${DAY_FROM.toISOString()}&to=${DAY_TO.toISOString()}`, "tok-whatever");
    assert.equal(bearer.status, 401);
    // and validation never runs ahead of the secret check
    assert.equal((await get(pt, null, null, null, {})).status, 401);
  } finally {
    await cleanup([pt], []);
  }
});

test("the call WRITES NOTHING: row counts and updatedAt of sessions / contracts / session_settlements / restrictions / profiles / notifications / audit are unchanged", { skip }, async () => {
  const { pt, contracts, ids: cids } = await makeAn({ gymId: GYM });
  const banned = await makePt();
  try {
    const s1 = await addSession(contracts.binh, "PENDING_CLIENT_CONFIRMATION", NOON);
    await addSession(contracts.chi, "CONFIRMED", NOON);
    await addSession(contracts.dung, "COMPLETED", at("2031-03-10T16:30:00.000Z"), { scheduledEndAt: at("2031-03-10T17:30:00.000Z") });
    await prisma.ptRestriction.create({
      data: { ptUserId: pt, type: "TEMPORARY_SUSPENSION", imposedBy: "admin-1", scope: "CONTRACT", contractId: contracts.em.id },
    });
    await prisma.sessionSettlement.create({
      data: { kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${contracts.em.id}`, contractId: contracts.em.id, status: "PENDING" },
    });
    await prisma.ptRestriction.create({ data: { ptUserId: banned, type: "PERMANENT_BAN", imposedBy: "admin-1", scope: "ACCOUNT" } });

    const snapshot = async () => ({
      sessions: await prisma.session.findMany({ orderBy: { id: "asc" } }),
      contracts: await prisma.contract.findMany({ orderBy: { id: "asc" } }),
      settlements: await prisma.sessionSettlement.findMany({ orderBy: { id: "asc" } }),
      restrictions: await prisma.ptRestriction.findMany({ orderBy: { id: "asc" } }),
      profiles: await prisma.userProfile.findMany({ orderBy: { userId: "asc" }, select: { userId: true, ptSuspended: true, updatedAt: true } }),
      notifications: await prisma.notification.count(),
      audit: await prisma.auditLog.count(),
    });
    const before = await snapshot();
    assert.ok(before.sessions.length >= 3 && before.settlements.length >= 1);

    for (const p of [pt, banned, randomUUID()]) {
      for (const [f, t] of [[DAY_FROM, DAY_TO], [NEXT_FROM, NEXT_TO]] as const) assert.equal((await get(p, GYM, f, t)).status, 200);
    }
    assert.equal((await get(pt, GYM, DAY_TO, DAY_FROM)).status, 400);

    const after = await snapshot();
    assert.deepEqual(after, before, "every row, including updatedAt, is byte-identical");
    assert.equal(
      (await prisma.session.findUniqueOrThrow({ where: { id: s1.id } })).status,
      "PENDING_CLIENT_CONFIRMATION",
      "the session is still waiting for the client: check-in data never completes it",
    );
  } finally {
    await cleanup([pt, banned], cids);
  }
});
