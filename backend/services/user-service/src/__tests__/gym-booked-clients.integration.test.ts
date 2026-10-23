/**
 * D15b - GET /internal/gyms/:gymId/booked-clients (front desk: who has a face-to-face PT session booked at THIS branch).
 * READ-ONLY, ids only. Proves: status / mode / gym / window / contract-status scoping, one row per client, exact response keys
 * (no PT id, contract id, notes, money), service-secret 401, query validation 400, and that the call writes nothing.
 *
 * Evidence label: BACKEND INTEGRATION (real Express app, real SQL, isolated *_test database; rows are TEST FIXTURE). Run:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_d15b_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/gym-booked-clients.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { parseBookedClientsQuery } from "../routes/internal-gym-booked-clients.routes";
import { HOUR, addSession, cleanup, makeContract, makePt, skip } from "./pt-restriction.test-helpers";
import { SERVICE_SECRET, startApp, type App } from "./pt-contract-scope.test-helpers";

let app: App;
test.before(async () => {
  if (!skip) app = await startApp();
});
test.after(async () => {
  await app?.close();
});

const GYM = "gym-d15b-main";
const OTHER_GYM = "gym-d15b-other";
const DAY_FROM = new Date("2031-03-09T17:00:00.000Z");
const DAY_TO = new Date("2031-03-10T17:00:00.000Z");
const NOON = new Date("2031-03-10T05:00:00.000Z");

async function get(gymId: string, from: string | null, to: string | null, headers: Record<string, string> = SERVICE_SECRET) {
  const qs = new URLSearchParams();
  if (from !== null) qs.set("from", from);
  if (to !== null) qs.set("to", to);
  return app.call("GET", `/internal/gyms/${gymId}/booked-clients?${qs}`, null, undefined, headers);
}

test("query validation (pure): ISO with zone required, from < to, window <= 48h", () => {
  assert.equal(parseBookedClientsQuery({ from: DAY_FROM.toISOString(), to: DAY_TO.toISOString() }).ok, true);
  for (const bad of [{}, { from: "2031-03-10", to: "2031-03-11" }, { from: DAY_TO.toISOString(), to: DAY_FROM.toISOString() }, { from: "2031-03-01T00:00:00Z", to: "2031-03-10T00:00:00Z" }]) {
    assert.equal(parseBookedClientsQuery(bad as any).ok, false, JSON.stringify(bad));
  }
});

test("returns one row per client for booked OFFLINE sessions at this gym only; nothing else about the session or PT", { skip }, async () => {
  const pt = await makePt();
  const here = await makeContract(pt, { gymId: GYM });
  const here2 = await makeContract(pt, { gymId: GYM }); // a second client
  const elsewhere = await makeContract(pt, { gymId: OTHER_GYM });
  const cancelledContract = await makeContract(pt, { gymId: GYM, status: "CANCELLED" });
  try {
    await addSession(here, "CONFIRMED", NOON, { notes: "ghi chú riêng", location: "Phòng 3" });
    await addSession(here, "COMPLETED", new Date(NOON.getTime() + 3 * HOUR)); // same client again → still one row
    await addSession(here2, "PENDING_CLIENT_CONFIRMATION", new Date(NOON.getTime() + 5 * HOUR));
    await addSession(here, "REQUESTED", new Date(NOON.getTime() + 6 * HOUR), {}); // not a booking yet
    await addSession(here, "CANCELLED", new Date(NOON.getTime() + 7 * HOUR));
    await addSession(here, "CONFIRMED", new Date(NOON.getTime() + 8 * HOUR), { sessionMode: "ONLINE" });
    await addSession(elsewhere, "CONFIRMED", NOON);
    await addSession(cancelledContract, "CONFIRMED", NOON);
    await addSession(here, "CONFIRMED", new Date("2031-03-12T05:00:00.000Z")); // other day

    const before = await prisma.session.count();
    const { status, body } = await get(GYM, DAY_FROM.toISOString(), DAY_TO.toISOString());
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(Object.keys(body).sort(), ["clients", "gymId"]);
    assert.deepEqual(
      body.clients.map((c: any) => c.clientUserId).sort(),
      [here.clientUserId, here2.clientUserId].sort(),
    );
    for (const c of body.clients) assert.deepEqual(Object.keys(c).sort(), ["clientUserId", "startAt"]);
    const first = body.clients.find((c: any) => c.clientUserId === here.clientUserId);
    assert.equal(first.startAt, NOON.toISOString(), "earliest booked start of the day");
    const text = JSON.stringify(body);
    for (const leak of [pt, here.id, "ghi chú riêng", "Phòng 3", "5000000", "Gói 10 buổi"]) assert.equal(text.includes(leak), false, `leaked ${leak}`);
    assert.equal(await prisma.session.count(), before, "read-only");

    const empty = await get("gym-d15b-nobody", DAY_FROM.toISOString(), DAY_TO.toISOString());
    assert.deepEqual(empty.body.clients, []);
  } finally {
    await cleanup([pt], [here.id, here2.id, elsewhere.id, cancelledContract.id]);
  }
});

test("service secret required; bad window -> 400", { skip }, async () => {
  assert.equal((await get(GYM, DAY_FROM.toISOString(), DAY_TO.toISOString(), {})).status, 401);
  const bad = await get(GYM, "nope", DAY_TO.toISOString());
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_QUERY");
  assert.equal((await get(GYM, DAY_FROM.toISOString(), "2031-03-20T00:00:00.000Z")).status, 400);
});
