import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Phase 4 (PT Copilot) — GET /internal/contracts/active-clients?ptUserId=: the PT's authoritative roster for fitness-service's roster
 * adherence view. REAL HTTP against the real Express app + the isolated user test DB (skipped, not failed, when none is configured).
 * Only ACTIVE contracts in the PT -> client direction count (the same condition as /contracts/active-relationship); the endpoint needs the
 * service secret.
 */
const url = process.env.USER_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseDb = /(_test|postgres-test)/i.test(url);
if (process.env.USER_DATABASE_URL) process.env.DATABASE_URL = process.env.USER_DATABASE_URL;
process.env.INTERNAL_SERVICE_SECRET = "roster-test-secret-0123456789abcdef";
const skipOpts = { skip: canUseDb ? false : "Requires USER_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 60_000 };

const RUN = randomUUID().slice(0, 8);
const PT = `pt-${RUN}`, OTHER_PT = `pt2-${RUN}`;
const ids: string[] = [];
let prisma: (typeof import("../repositories/profile.repository"))["prisma"];
let server: import("node:http").Server | undefined;
let base = "";

const mk = (ptUserId: string, clientUserId: string, status: string) =>
  prisma.contract.create({ data: { id: randomUUID(), ptUserId, clientUserId, packageName: "t", totalSessions: 4, status: status as any } }).then((c) => { ids.push(c.id); return c; });

test.before(async () => {
  if (!canUseDb) return;
  prisma = (await import("../repositories/profile.repository")).prisma;
  await mk(PT, `c1-${RUN}`, "ACTIVE");
  await mk(PT, `c1-${RUN}`, "ACTIVE");          // same client twice -> listed once
  await mk(PT, `c2-${RUN}`, "ACTIVE");
  for (const s of ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT", "COMPLETED", "EXPIRED", "CANCELLED", "REJECTED"]) await mk(PT, `x-${s}-${RUN}`, s);
  await mk(OTHER_PT, `c3-${RUN}`, "ACTIVE");    // another PT's client
  await mk(`c1-${RUN}`, PT, "ACTIVE");          // reverse direction (the client acting as PT of the PT): must NOT make anyone PT's client
  const app = (await import("../app")).default;
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});
test.after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((r) => server!.close(() => r(undefined))); }
  if (!canUseDb) return;
  await prisma.contract.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});
const call = (query: string, secret: string | null = process.env.INTERNAL_SERVICE_SECRET!) =>
  fetch(`${base}/internal/contracts/active-clients${query}`, { headers: secret ? { "x-service-secret": secret } : {} });

test("returns exactly the PT's distinct ACTIVE clients: no pending/ended/rejected contracts, nobody else's clients, no reverse direction", skipOpts, async () => {
  const r = await call(`?ptUserId=${PT}`);
  assert.equal(r.status, 200);
  const body: any = await r.json();
  assert.deepEqual([...body.clientUserIds].sort(), [`c1-${RUN}`, `c2-${RUN}`].sort());
  const other: any = await (await call(`?ptUserId=${OTHER_PT}`)).json();
  assert.deepEqual(other.clientUserIds, [`c3-${RUN}`]);
});

test("a PT with no contracts has an empty roster (not an error); a contract that ends drops out on the next call", skipOpts, async () => {
  assert.deepEqual(((await (await call(`?ptUserId=nobody-${RUN}`)).json()) as any).clientUserIds, []);
  const extra = await mk(PT, `c9-${RUN}`, "ACTIVE");
  assert.ok(((await (await call(`?ptUserId=${PT}`)).json()) as any).clientUserIds.includes(`c9-${RUN}`));
  await prisma.contract.update({ where: { id: extra.id }, data: { status: "CANCELLED" } });
  assert.ok(!((await (await call(`?ptUserId=${PT}`)).json()) as any).clientUserIds.includes(`c9-${RUN}`));
});

test("security: no / wrong service secret is 401; a missing ptUserId is 400", skipOpts, async () => {
  assert.equal((await call(`?ptUserId=${PT}`, null)).status, 401);
  assert.equal((await call(`?ptUserId=${PT}`, "wrong")).status, 401);
  assert.equal((await call("")).status, 400);
  assert.equal((await call("?ptUserId=%20")).status, 400);
});
