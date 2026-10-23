// TEST FIXTURE: the Tier B PT flows run against an in-memory fake gateway. Proves (a) every scenario state is reached, (b) a second and
// third run send NO write request (idempotent), (c) dryRun mode of the whole Tier B orchestrator completes and records requests.
// It does not prove the real services accept these calls (Tier B is NOT RUN live).
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorld } from "../lib/world/index.mjs";
import { makeClient } from "../lib/tierB/client.mjs";
import { makeTierBContext, runTierB } from "../lib/tierB/run.mjs";
import { ensurePtApplication, ensurePtListing, ensureMembership, observeListing, roundSlice, settleViaSimulator } from "../lib/tierB/flows.mjs";
import { createFakeGateway } from "./fakeGateway.mjs";

const world = buildWorld();

function setup() {
  const gw = createFakeGateway({ adminEmail: "admin@fake.test" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => gw.fetch(String(url), init);
  const client = makeClient({ baseUrl: "http://gw.fake", password: "pw" });
  for (const p of world.pts) gw.addUser(p.email, "CUSTOMER", p.userId);
  const ctx = makeTierBContext({ client, world, admin: { email: "admin@fake.test" }, password: "pw" });
  return { gw, ctx, restore: () => (globalThis.fetch = realFetch) };
}

async function runPts(ctx) {
  for (const pt of world.pts) await ensurePtApplication(ctx, pt);
  for (const pt of world.pts) await ensurePtListing(ctx, pt);
}

test("PT flows reach every scenario state, then a 2nd and 3rd run write nothing", async () => {
  const { gw, ctx, restore } = setup();
  try {
    await runPts(ctx);
    assert.deepEqual(ctx.errors, []);
    const first = gw.writeCount();
    assert.ok(first > 500);

    for (const pt of world.pts) {
      const app = gw.apps.get(pt.userId);
      if (!app) assert.fail(`${pt.slug}: no application`);
      assert.equal(app.status, pt.app.state, `${pt.slug} application`);
      if (pt.app.state !== "APPROVED") continue;
      assert.equal(gw.users.get(pt.email).role, "PT");
      const st = gw.listings.get(pt.userId);
      const obs = observeListing({ history: st?.history ?? [], openRevision: st?.open ?? null });
      const k = pt.listing.kind;
      if (k === "NONE") assert.ok(!st || (!st.open && st.history.length === 0), pt.slug);
      if (k === "DRAFT") assert.equal(obs.open, "DRAFT");
      if (k === "PENDING") assert.equal(obs.open, "PENDING");
      if (k === "CHANGES_REQUESTED") assert.ok(obs.closed.CHANGES_REQUESTED === 1 && obs.open === "DRAFT");
      if (k === "REJECTED") assert.ok(obs.closed.REJECTED === 1 && obs.open === null);
      if (k === "STALE") assert.ok(obs.closed.STALE === 1 && obs.closed.APPROVED_ADMIN === 1 && obs.open === "DRAFT");
      if (k === "APPROVED") assert.equal(obs.open, null);
      if (pt.listing.rounds) assert.equal(obs.approvedByOwner, pt.listing.rounds, `${pt.slug} rounds`);
      if (!pt.listing.firstListing && pt.listing.rounds) {
        assert.equal(st.packages.length, pt.packages.length, `${pt.slug} published packages`);
        assert.equal(st.photos.length, pt.photoFiles.length, `${pt.slug} published photos`);
        assert.equal(st.photos.filter((p) => p.isCover).length, pt.photoFiles.length ? 1 : 0);
      }
    }

    for (let run = 2; run <= 3; run++) {
      const before = gw.writeCount();
      await runPts(ctx);
      assert.equal(gw.writeCount(), before, `run ${run} must not write anything`);
      assert.deepEqual(ctx.errors, []);
      assert.deepEqual(ctx.warnings, []);
    }
  } finally {
    restore();
  }
});

test("the 'price bump' PT keeps the published price and holds the raised price only in the open revision", async () => {
  const { gw, ctx, restore } = setup();
  try {
    const nam = world.pts.find((p) => p.person.full === "Lê Hoàng Nam");
    await ensurePtApplication(ctx, nam);
    await ensurePtListing(ctx, nam);
    const st = gw.listings.get(nam.userId);
    assert.equal(st.packages.find((p) => p.sessionCount === 10).price, 2000000);
    assert.equal(st.open.status, "PENDING");
    assert.equal(st.open.payload.packages.find((p) => p.sessionCount === 10).price, 2500000);
    assert.ok(st.open.payload.packages.every((p) => p.id), "existing packages are edited in place (ids kept)");
  } finally {
    restore();
  }
});

test("a state past the scenario is reported as a warning, never rolled back", async () => {
  const { gw, ctx, restore } = setup();
  try {
    const pt = world.pts.find((p) => p.app.state === "DRAFT");
    await ensurePtApplication(ctx, pt);
    gw.apps.get(pt.userId).status = "APPROVED";
    const before = gw.writeCount();
    await ensurePtApplication(ctx, pt);
    assert.equal(gw.writeCount(), before);
    assert.equal(ctx.warnings.length, 1);
  } finally {
    restore();
  }
});

test("dry-run of the whole Tier B orchestrator completes without errors and sends nothing", async () => {
  const client = makeClient({ dryRun: true, password: "x" });
  const ctx = makeTierBContext({ client, world, admin: { email: "admin@seed.invalid" }, password: "x" });
  const out = await runTierB(ctx);
  assert.deepEqual(out.errors, []);
  assert.ok(out.requests > 3000);
  assert.ok(client.log.every((r) => r.status === undefined), "dry-run records requests only");
  const paths = new Set(client.log.map((r) => `${r.method} ${r.path.replace(/[0-9a-f-]{8,}|dry-[a-z0-9-]+/gi, ":id")}`));
  assert.ok([...paths].some((p) => p.startsWith("POST /owner/application/submit")));
  assert.ok([...paths].some((p) => p.startsWith("POST /admin/partners/:id/application/approve")));
  assert.ok([...paths].some((p) => p.includes("/admin/listings/gyms/revisions/:id/approve")));
  assert.ok([...paths].some((p) => p.includes("/admin/amenities/proposals/merge")));
});

test("helpers: roundSlice grows monotonically and ends with everything; settleViaSimulator parses the simulator pages", async () => {
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual(roundSlice(items, 1, 3), [1, 2]);
  assert.deepEqual(roundSlice(items, 2, 3), [1, 2, 3, 4]);
  assert.deepEqual(roundSlice(items, 3, 3), items);
  assert.deepEqual(roundSlice(items, 1, 1), items);

  const calls = [];
  const fakeCtx = {
    client: {
      dryRun: false,
      async call(method, path) {
        calls.push(`${method} ${path}`);
        if (path.startsWith("/payments/vnpay/sim")) return { status: 200, json: { raw: '<a class="btn pay" href="/payments/vnpay/return?vnp_Amount=1&amp;vnp_SecureHash=ab">ok</a>' } };
        return { status: 302, json: null };
      },
    },
  };
  const status = await settleViaSimulator(fakeCtx, { data: { payment: { redirectUrl: "http://localhost:3000/payments/vnpay/sim?txnId=123e4567-e89b-12d3-a456-426614174000" } } }, "t");
  assert.equal(status, 302);
  assert.deepEqual(calls, ["GET /payments/vnpay/sim?txnId=123e4567-e89b-12d3-a456-426614174000", "GET /payments/vnpay/return?vnp_Amount=1&vnp_SecureHash=ab"]);
  await assert.rejects(settleViaSimulator(fakeCtx, { redirectUrl: "https://sandbox.vnpayment.vn/x" }, "t"), /VNPAY_SIMULATE/);
});

test("real HTTP client preserves simulator success links after a long stylesheet", async () => {
  const client = makeClient({ baseUrl: "http://fixture.local", fetchImpl: async () => new Response(' '.repeat(3000) + '<a href="/payments/vnpay/return?ok=1">success</a>') });
  const page = await client.call("GET", "/payments/vnpay/sim?txnId=fixture");
  assert.ok(page.json.raw.includes('/payments/vnpay/return?ok=1'));
  assert.equal(client.log[0].path, '/payments/vnpay/sim');
  assert.equal(client.log[0].response, undefined, "successful HTML and signed URLs must not be persisted in evidence");
});

test("membership settles the checkout returned by purchase without creating a second payment attempt", async () => {
  const calls = [];
  const ctx = {stats:{}, client:{dryRun:false, login:async()=>"fixture-token", call:async(method,path)=>{
    calls.push(`${method} ${path}`);
    if(path === '/me/gym-memberships') return {status:200,json:{data:[]}};
    if(path === '/gyms/gym/memberships') return {status:201,json:{data:{membership:{id:'membership'},payment:{redirectUrl:'http://localhost:3000/payments/vnpay/sim?txnId=123e4567-e89b-12d3-a456-426614174000'}}}};
    if(path.startsWith('/payments/vnpay/sim')) return {status:200,json:{raw:'<a href="/payments/vnpay/return?ok=1">ok</a>'}};
    if(path.startsWith('/payments/vnpay/return')) return {status:302,json:null};
    throw new Error(`Unexpected ${method} ${path}`);
  }}};
  await ensureMembership(ctx,{client:world.clients[0],gymId:'gym',planId:'plan',want:'ACTIVE'});
  assert.equal(calls.filter(x=>x.startsWith('POST')).length,1);
  assert.ok(!calls.some(x=>x.includes('/membership/pay')));
});
