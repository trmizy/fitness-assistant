/**
 * Dispute Case slice 2 / S2.3 - gym-service GET /internal/pt-checkins and GET /internal/member-checkins (read-only evidence).
 * Evidence label: REAL HTTP on a local ephemeral port. Part 1 runs the REAL mounted internal router (serviceSecretMiddleware included) but only for
 * requests that are refused BEFORE any database access (wrong secret -> 401, invalid query -> 400), so no database is touched. Part 2 runs the route
 * factory with an in-memory fake repository (TEST FIXTURE) that records its arguments. The Prisma queries are CODE AUDIT
 * (internal-dispute-evidence.repository.ts: unique key (gymId, ptUserId, localDate); membershipId + createdAt window + take).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.INTERNAL_SERVICE_SECRET = "test-only-gym-internal-secret-0123456789";
process.env.INTERNAL_API_SECRET ??= process.env.INTERNAL_SERVICE_SECRET;

import { createInternalDisputeEvidenceRoutes, MAX_ROWS, MAX_WINDOW_MS } from "../routes/internal-dispute-evidence.routes";

const SECRET = process.env.INTERNAL_SERVICE_SECRET!;
const listen = (app: express.Express) => {
  const server = app.listen(0, "127.0.0.1");
  return new Promise<{ base: string; close: () => Promise<void> }>((resolve) =>
    server.once("listening", () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(() => r())) })),
  );
};
const hdr = (secret: string | null): Record<string, string> => (secret === null ? {} : { "x-service-secret": secret });

// ── Part 1: the real mounted router, requests refused before any database access ──────────────────────────────────
test("REAL internal router: wrong / missing secret -> 401 on both routes; with the secret an invalid query -> 400 (no database reached)", async () => {
  const { default: internalRoutes } = await import("../routes/internal.routes");
  const app = express();
  app.use("/internal", internalRoutes);
  const s = await listen(app);
  try {
    for (const path of ["/internal/pt-checkins?ptUserId=p&gymId=g&date=2026-10-01", "/internal/member-checkins?membershipId=m&from=2026-10-01T00:00:00Z&to=2026-10-01T05:00:00Z"]) {
      for (const secret of [null, "", "wrong", SECRET + "x"]) assert.equal((await fetch(s.base + path, { headers: hdr(secret) })).status, 401, `${path} secret=${secret}`);
    }
    for (const path of ["/internal/pt-checkins", "/internal/pt-checkins?ptUserId=p&gymId=g", "/internal/member-checkins?membershipId=m", "/internal/member-checkins"]) {
      assert.equal((await fetch(s.base + path, { headers: hdr(SECRET) })).status, 400, path);
    }
  } finally {
    await s.close();
  }
});

// ── Part 2: the route factory with a recording fake ───────────────────────────────────────────────────────────────
const ptCalls: any[] = [];
const memberCalls: any[] = [];
let ptRow: any = null;
let memberRows: any[] = [];
let app2: Awaited<ReturnType<typeof listen>>;
test.before(async () => {
  const app = express();
  app.use(
    "/internal",
    createInternalDisputeEvidenceRoutes({
      findPtCheckin: async (q) => (ptCalls.push(q), ptRow),
      findMemberCheckins: async (q) => (memberCalls.push(q), memberRows),
    }),
  );
  app2 = await listen(app);
});
test.after(() => app2?.close());
test.beforeEach(() => {
  ptCalls.length = 0;
  memberCalls.length = 0;
  ptRow = null;
  memberRows = [];
});
const get = (qs: string) => fetch(`${app2.base}/internal${qs}`);

test("pt-checkins: a full key returns exactly that record's four fields; no record is {data:null}, never a zero-filled object", async () => {
  ptRow = { firstScanAt: new Date("2026-10-01T01:00:00Z"), lastScanAt: new Date("2026-10-01T09:00:00Z"), scanCount: 3, qualifyingSessionIds: ["s1", "s2"], contractIds: ["c1"], brandId: "secret-brand", id: "row-id" };
  const r = await get("/pt-checkins?ptUserId=pt1&gymId=gym1&date=2026-10-01");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const body: any = await r.json();
  assert.deepEqual(ptCalls, [{ ptUserId: "pt1", gymId: "gym1", localDate: "2026-10-01" }]);
  assert.deepEqual(Object.keys(body.data).sort(), ["firstScanAt", "lastScanAt", "qualifyingSessionIds", "scanCount"]);
  assert.deepEqual(body.data.qualifyingSessionIds, ["s1", "s2"]);
  assert.equal(JSON.stringify(body).includes("secret-brand") || JSON.stringify(body).includes("row-id"), false);
  ptRow = null;
  assert.deepEqual(await (await get("/pt-checkins?ptUserId=pt1&gymId=gym1&date=2026-10-02")).json(), { data: null });
});

test("pt-checkins: missing key / bad date / impossible date / extra or repeated parameter / injection-looking value -> 400, repository never asked", async () => {
  const bad = [
    "",
    "?ptUserId=a&gymId=b",
    "?ptUserId=a&date=2026-10-01",
    "?gymId=b&date=2026-10-01",
    "?ptUserId=a&gymId=b&date=2026-13-01",
    "?ptUserId=a&gymId=b&date=2026-02-30",
    "?ptUserId=a&gymId=b&date=1/10/2026",
    "?ptUserId=a&gymId=b&date=2026-10-01&all=1",
    "?ptUserId=a&ptUserId=c&gymId=b&date=2026-10-01",
    "?ptUserId=a%27%3B--&gymId=b&date=2026-10-01",
    "?ptUserId=&gymId=b&date=2026-10-01",
  ];
  for (const qs of bad) assert.equal((await get(`/pt-checkins${qs}`)).status, 400, qs);
  assert.equal(ptCalls.length, 0);
});

test("member-checkins: the window is bounded (from < to, at most 48 h), the key is mandatory, rows are capped and carry only createdAt / source / gymId", async () => {
  const from = "2026-10-01T00:00:00Z";
  const ok = new Date(Date.parse(from) + MAX_WINDOW_MS).toISOString();
  const tooWide = new Date(Date.parse(from) + MAX_WINDOW_MS + 1000).toISOString();
  const bad = [
    `?membershipId=m&from=${from}&to=${tooWide}`,
    `?membershipId=m&from=${ok}&to=${from}`,
    `?membershipId=m&from=${from}&to=${from}`,
    `?membershipId=m&from=${from}`,
    `?membershipId=m&to=${ok}`,
    `?from=${from}&to=${ok}`,
    `?membershipId=m&from=yesterday&to=today`,
    `?membershipId=m&from=${from}&to=${ok}&limit=9999`,
    `?gymId=g&from=${from}&to=${ok}`,
  ];
  for (const qs of bad) assert.equal((await get(`/member-checkins${qs}`)).status, 400, qs);
  assert.equal(memberCalls.length, 0);
  memberRows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ createdAt: new Date(Date.parse(from) + i * 1000), source: "QR", gymId: "gym1", checkedInBy: "member-1", assisted: null, clientId: "leak", id: `x${i}` }));
  const r = await get(`/member-checkins?membershipId=mem1&from=${from}&to=${ok}`);
  assert.equal(r.status, 200);
  const body: any = await r.json();
  assert.equal(body.data.length, MAX_ROWS);
  assert.deepEqual(Object.keys(body.data[0]).sort(), ["assisted", "checkedInBy", "createdAt", "gymId", "source"]);
  assert.equal(JSON.stringify(body).includes("leak"), false);
  assert.deepEqual(memberCalls[0], { membershipId: "mem1", from: new Date(from), to: new Date(ok), take: MAX_ROWS });
  memberRows = [];
  assert.deepEqual(await (await get(`/member-checkins?membershipId=mem1&from=${from}&to=${ok}`)).json(), { data: [] });
});

test("only GET exists on both routes", async () => {
  for (const p of ["/pt-checkins?ptUserId=a&gymId=b&date=2026-10-01", "/member-checkins?membershipId=m&from=2026-10-01T00:00:00Z&to=2026-10-01T05:00:00Z"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await fetch(`${app2.base}/internal${p}`, { method });
      assert.ok(r.status === 404 || r.status === 405, `${method} ${p} -> ${r.status}`);
    }
  }
  assert.equal(ptCalls.length + memberCalls.length, 0);
});
