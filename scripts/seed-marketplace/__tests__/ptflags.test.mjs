// TEST FIXTURE: the account-lock ("suspended" PT) step against the in-memory fake gateway.
//  (a) the disable flag only runs after that PT's application + listing scenario is complete;
//  (b) a seed-domain PT that is disabled but incomplete (the run-1 bug) is re-enabled through the admin API, completed, disabled again;
//  (c) once everything is complete a rerun sends no write request.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorld } from "../lib/world/index.mjs";
import { makeClient } from "../lib/tierB/client.mjs";
import { makeTierBContext, runTierB } from "../lib/tierB/run.mjs";
import { createFakeGateway } from "./fakeGateway.mjs";

const full = buildWorld();
const suspended = full.pts.filter((p) => p.flags.suspended && p.app.state === "APPROVED");
const world = { ...full, pts: suspended }; // only the locked accounts: their flag step needs no other admin endpoint

function setup() {
  const gw = createFakeGateway({ adminEmail: "admin@fake.test" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => gw.fetch(String(url), init);
  const client = makeClient({ baseUrl: "http://gw.fake", password: "pw" });
  for (const p of world.pts) gw.addUser(p.email, "CUSTOMER", p.userId);
  const mkCtx = () => makeTierBContext({ client: makeClient({ baseUrl: "http://gw.fake", password: "pw" }), world, admin: { email: "admin@fake.test" }, password: "pw" });
  return { gw, client, mkCtx, restore: () => (globalThis.fetch = realFetch) };
}
const active = (gw, pt) => gw.users.get(pt.email).active !== false;

test("fixture: the world has the 3 locked PTs", () => {
  assert.ok(suspended.length >= 3);
});

test("(a) a PT whose application failed is NOT locked; the others are", async () => {
  const { gw, mkCtx, restore } = setup();
  try {
    const broken = suspended[0];
    gw.failUploadFor.add(broken.email);
    const ctx = mkCtx();
    const out = await runTierB(ctx, { only: ["pts"] });
    assert.ok(out.errors.some((e) => e.step.includes(broken.slug)), "the failed upload is reported");
    assert.equal(active(gw, broken), true, "incomplete PT must stay enabled");
    assert.ok(ctx.warnings.some((w) => w.includes(broken.email) && /not complete/.test(w)));
    for (const pt of suspended.slice(1)) assert.equal(active(gw, pt), false, `${pt.slug} locked after completion`);
    assert.ok(!gw.writes.some((w) => w.includes(`/auth/users/${broken.userId}/disable`)));
  } finally {
    restore();
  }
});

test("(b) disabled + incomplete seed PT: re-enabled via admin API, completed, disabled again; then a rerun writes nothing", async () => {
  const { gw, mkCtx, restore } = setup();
  try {
    // the run-1 aftermath: all 3 accounts disabled, but one has no application at all
    await runTierB(mkCtx(), { only: ["pts"] });
    const stuck = suspended[0];
    gw.apps.delete(stuck.userId);
    gw.listings.delete(stuck.userId);
    gw.users.get(stuck.email).role = "CUSTOMER";
    assert.equal(active(gw, stuck), false);

    const before = gw.writes.length;
    const ctx = mkCtx();
    const out = await runTierB(ctx, { only: ["pts"] });
    assert.deepEqual(out.errors, []);
    const writes = gw.writes.slice(before);
    const iEnable = writes.indexOf(`PATCH /auth/users/${stuck.userId}/enable`);
    const iDisable = writes.indexOf(`PATCH /auth/users/${stuck.userId}/disable`);
    assert.ok(iEnable >= 0, "re-enabled through PATCH /auth/users/:id/enable");
    assert.ok(iDisable > iEnable, "disabled again afterwards");
    assert.ok(writes.indexOf("POST /pt-applications/me/submit") > iEnable, "application completed after the enable");
    assert.equal(gw.apps.get(stuck.userId).status, "APPROVED");
    for (const pt of suspended) assert.equal(active(gw, pt), false);
    // untouched accounts were not re-enabled
    for (const pt of suspended.slice(1)) assert.ok(!writes.some((w) => w.includes(`/auth/users/${pt.userId}/`)));

    // (c) everything complete: zero writes
    const mark = gw.writes.length;
    const again = await runTierB(mkCtx(), { only: ["pts"] });
    assert.deepEqual(again.errors, []);
    assert.equal(gw.writes.length, mark, "rerun must not write anything");
  } finally {
    restore();
  }
});

test("a disabled, complete PT is skipped without any login attempt", async () => {
  const { gw, mkCtx, restore } = setup();
  try {
    await runTierB(mkCtx(), { only: ["pts"] });
    const ctx = mkCtx();
    await runTierB(ctx, { only: ["pts"] });
    assert.equal(ctx.disabledPts.size, suspended.length);
    assert.equal(ctx.incompletePts.size, 0);
    assert.ok(!ctx.client.log.some((r) => r.path === "/auth/login" && r.status === 403));
  } finally {
    restore();
  }
});

test("contract request to a PT closed by an earlier run: reopens, retries once, flags step closes it later", async () => {
  const { ensureContract } = await import("../lib/tierB/flows.mjs");
  const pt = { ...full.pts.find((p) => p.flags.notAccepting && p.app.state === "APPROVED"), };
  const calls = [];
  let accepting = false;
  const client = {
    dryRun: false,
    login: async (e) => `tok:${e}`,
    async call(method, path, opts = {}) {
      calls.push(`${method} ${path}`);
      const ok = (json, status = 200) => ({ status, json });
      if (path === "/profile/me/listing") return ok({ published: { packages: [{ id: "pk1", name: "Gói 10 buổi", isActive: true, version: 1, price: 1 }] } });
      if (path === "/contracts/client") return ok([]);
      if (path === "/profile/me/accepting-clients") { accepting = opts.body.isAcceptingClients; return ok({}); }
      if (path === "/contracts/request") return accepting ? ok({ id: "c1" }, 201) : ok({ error: { code: "PT_NOT_ACCEPTING_CLIENTS" } }, 422);
      if (path.endsWith("/accept")) return ok({});
      return ok({ paymentUrl: "x" });
    },
  };
  const ctx = { client, stats: {}, warnings: [], errors: [] };
  await ensureContract(ctx, { pt, client: { profile: { email: "c@seed.gymini.test" } }, packageIndex: 0, want: "PENDING_PAYMENT" });
  assert.equal(calls.filter((c) => c === "POST /contracts/request").length, 2, "request retried exactly once");
  assert.ok(calls.includes("PATCH /profile/me/accepting-clients"));
  assert.equal(ctx.stats["pt.flags.notAccepting.reopenedForContract"], 1);
});
