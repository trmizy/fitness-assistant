/**
 * PT listing management, phase C1 - packages are locked behind the listing review, and a contract buys a package
 * ATOMICALLY (plan §1 B3, §12.5, §12.13 items 4 and 10).
 *
 * Evidence label: BACKEND INTEGRATION (real Express app + isolated `*_test` database; auth-service and the
 * notification push are TEST FIXTURES; payment-service is not involved - a contract request moves no money).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_lm_test?schema=public" \
 *     npx tsx --test src/__tests__/pt-listing-package-lock.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { ptServicePackageService } from "../services/pt_service_package.service";
import { notificationService } from "../services/notification.service";
import { patch } from "./pt-restriction.test-helpers";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";
import { cleanupListingPts, makePackage, makePublicPt } from "./pt-listing.test-helpers";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
installAccountsActive(); // Codex #4: requestContract asks auth-service, fail-closed

const MESSAGE = "Thay đổi này cần gửi duyệt. Hãy cập nhật ứng dụng để dùng mục Tin đăng.";

let app: App;
let restoreNotify: () => void;
const created: string[] = [];
const contracts: string[] = [];
const clients: string[] = [];

test.before(async () => {
  // a contract request notifies the PT through chat-service's push: not under test here
  restoreNotify = patch(notificationService, "create", async () => ({}) as any);
  app = await startApp();
});

test.after(async () => {
  restoreNotify();
  await app.close();
  await prisma.contract.deleteMany({ where: { id: { in: contracts } } }).catch(() => {});
  await cleanupListingPts(created, contracts, clients);
});

const newClient = () => {
  const id = randomUUID();
  clients.push(id);
  return { id, tok: tokenFor(id, "CUSTOMER") };
};

const eventsFor = (actor: string) => prisma.clientCompatEvent.findMany({ where: { actorUserId: actor }, orderBy: { createdAt: "asc" } });

// ── 1. all six write routes are locked ───────────────────────────────────────────────────────

test("all six PT package write routes answer 409 LISTING_REVIEW_REQUIRED, change nothing, and leave a client_compat_events row", async () => {
  const pt = await makePublicPt();
  created.push(pt.userId);
  const pkg = await makePackage(pt.userId, { name: "Gói gốc", price: 2_000_000, sessionCount: 10 });
  const ptTok = tokenFor(pt.userId, "PT");
  const before = await prisma.pTServicePackage.findMany({ where: { ptUserId: pt.userId } });

  const routes: Array<[string, string, unknown]> = [
    ["POST", "/profile/me/service-packages", { name: "Mới", sessionCount: 5, price: 500_000, sessionMode: "OFFLINE" }],
    ["PATCH", `/profile/me/service-packages/${pkg.id}`, { price: 1, name: "Đổi tên" }],
    ["DELETE", `/profile/me/service-packages/${pkg.id}`, undefined],
    ["POST", "/me/service-packages", { name: "Mới", sessionCount: 5, price: 500_000, sessionMode: "OFFLINE" }],
    ["PATCH", `/me/service-packages/${pkg.id}`, { price: 1, name: "Đổi tên" }],
    ["DELETE", `/me/service-packages/${pkg.id}`, undefined],
  ];
  for (const [method, path, body] of routes) {
    const r = await app.call(method, path, ptTok, body, { "x-gymini-client": "mobile/1.0.0/42" });
    assert.equal(r.status, 409, `${method} ${path}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body, {
      success: false,
      error: { code: "LISTING_REVIEW_REQUIRED", message: MESSAGE },
      message: MESSAGE,
    });
  }
  // anybody else gets the same answer (the old "any customer can create a package" path is gone too)
  const stranger = newClient();
  assert.equal((await app.call("POST", "/me/service-packages", stranger.tok, { name: "X", sessionCount: 1, price: 1, sessionMode: "ONLINE" })).status, 409);
  assert.equal((await app.call("PATCH", `/me/service-packages/${pkg.id}`, stranger.tok, { price: 1 })).status, 409);

  // nothing changed
  const after = await prisma.pTServicePackage.findMany({ where: { ptUserId: pt.userId } });
  assert.deepEqual(after, before, "packages are byte-for-byte unchanged");
  assert.equal(await prisma.pTServicePackage.count({ where: { name: "Mới" } }), 0);
  assert.equal(await prisma.pTServicePackage.count({ where: { id: pkg.id, ptUserId: pt.userId, price: 2_000_000, archivedAt: null, isActive: true, version: 1 } }), 1);

  // telemetry: one row per call, with the actor and the client header
  const ev = await eventsFor(pt.userId);
  assert.equal(ev.length, 6);
  assert.ok(ev.every((e) => e.outcome === "REVIEW_REQUIRED_409" && e.clientHeader === "mobile/1.0.0/42"));
  assert.deepEqual(new Set(ev.map((e) => e.route)).size, 6, "six distinct routes recorded");
  const strangerEv = await eventsFor(stranger.id);
  assert.equal(strangerEv.length, 2);
  assert.equal(strangerEv[0].clientHeader, null, "no header sent -> null");

  // the reads are still open
  assert.equal((await app.call("GET", "/me/service-packages", ptTok)).status, 200);
});

// ── 2. the internal write functions: no mass assignment, version rule ────────────────────────

test("internal updatePackage writes an explicit allowlist: ptUserId / archivedAt / version / id in the input change nothing; version moves only on a commercial change", async () => {
  const pt = await makePublicPt();
  const other = await makePublicPt();
  created.push(pt.userId, other.userId);
  const pkg = await makePackage(pt.userId, { name: "Gói A", price: 1_000_000, sessionCount: 10 });

  const hostile = {
    name: "Gói A+",
    ptUserId: other.userId,
    archivedAt: new Date(),
    version: 99,
    id: randomUUID(),
    createdAt: new Date(0),
    isActive: true,
  } as any;
  const res = await ptServicePackageService.updatePackage(pt.userId, pkg.id, hostile);
  const row = await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: pkg.id } });
  assert.equal(res.package.id, pkg.id);
  assert.equal(row.ptUserId, pt.userId, "owner not reassignable");
  assert.equal(row.archivedAt, null, "not archivable through the update");
  assert.equal(row.version, 2, "version moved by exactly one (name changed), not to the attacker's 99");
  assert.equal(row.createdAt.getTime(), pkg.createdAt.getTime());
  assert.equal(row.name, "Gói A+");

  // an edit that changes nothing leaves the version alone (price compared as a Decimal, name after trim)
  await ptServicePackageService.updatePackage(pt.userId, pkg.id, { name: "  Gói A+ ", price: 1_000_000 });
  assert.equal((await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: pkg.id } })).version, 2);
  // each commercial field bumps it
  await ptServicePackageService.updatePackage(pt.userId, pkg.id, { price: 1_100_000 });
  assert.equal((await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: pkg.id } })).version, 3);
  await ptServicePackageService.updatePackage(pt.userId, pkg.id, { sessionDurationMinutes: 45, validityDays: null });
  assert.equal((await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: pkg.id } })).version, 4);

  // somebody else's package is not reachable
  await assert.rejects(() => ptServicePackageService.updatePackage(other.userId, pkg.id, { name: "steal" }), (e: any) => e.status === 404);

  // archive: soft, version++
  const arch = await ptServicePackageService.archivePackage(pt.userId, pkg.id);
  assert.equal(arch.archived, true);
  const archived = await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: pkg.id } });
  assert.ok(archived.archivedAt);
  assert.equal(archived.isActive, false);
  assert.equal(archived.version, 5);
});

// ── 3. contracts keep their snapshot; expectedPackageVersion ─────────────────────────────────

const requestBody = (pt: string, pkgId: string, extra: Record<string, unknown> = {}) => ({
  ptUserId: pt,
  packageId: pkgId,
  acknowledgedLowAvailability: true, // the test PT has no availability rows
  ...extra,
});

test("a contract keeps price / sessions / name / mode / duration after the package changes; a stale expectedPackageVersion is 409 PACKAGE_CHANGED with the current package; a missing one is counted", async () => {
  const pt = await makePublicPt();
  created.push(pt.userId);
  const pkg = await makePackage(pt.userId, { name: "Gói 10 buổi", sessionCount: 10, price: 2_000_000, sessionDurationMinutes: 60, validityDays: 90, sessionMode: "OFFLINE" });

  const c1 = newClient();
  const first = await app.call("POST", "/contracts/request", c1.tok, requestBody(pt.userId, pkg.id, { expectedPackageVersion: 1 }));
  assert.equal(first.status, 201, JSON.stringify(first.body));
  contracts.push(first.body.id);
  const snap = (c: any) => ({
    price: Number(c.price), totalSessions: c.totalSessions, packageName: c.packageName, packageSourceName: c.packageSourceName,
    sessionMode: c.sessionMode, sessionDurationMinutes: c.sessionDurationMinutes, validityDays: c.validityDays, packageId: c.packageId,
  });
  const expected = {
    price: 2_000_000, totalSessions: 10, packageName: "Gói 10 buổi", packageSourceName: "Gói 10 buổi",
    sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 90, packageId: pkg.id,
  };
  assert.deepEqual(snap(await prisma.contract.findUniqueOrThrow({ where: { id: first.body.id } })), expected);
  assert.equal((await eventsFor(c1.id)).length, 0, "a client that sent the version is not counted as legacy");

  // the package is repriced / renamed / reshaped (what the listing-apply transaction will do) and its version bumped
  await prisma.pTServicePackage.update({
    where: { id: pkg.id },
    data: { price: 2_500_000, name: "Gói 10 buổi PRO", sessionCount: 12, sessionMode: "ONLINE", sessionDurationMinutes: 90, validityDays: 30, version: 2 },
  });
  assert.deepEqual(snap(await prisma.contract.findUniqueOrThrow({ where: { id: first.body.id } })), expected, "the signed-up contract is untouched");
  assert.deepEqual(snap((await app.call("GET", `/contracts/${first.body.id}`, c1.tok)).body?.contract ?? (await prisma.contract.findUniqueOrThrow({ where: { id: first.body.id } }))), expected);

  // a client still showing version 1 is told, with the package as it is now
  const c2 = newClient();
  const stale = await app.call("POST", "/contracts/request", c2.tok, requestBody(pt.userId, pkg.id, { expectedPackageVersion: 1 }));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "PACKAGE_CHANGED");
  assert.equal(stale.body.package.id, pkg.id);
  assert.equal(stale.body.package.version, 2);
  assert.equal(Number(stale.body.package.price), 2_500_000);
  assert.equal(stale.body.package.name, "Gói 10 buổi PRO");
  assert.equal(await prisma.contract.count({ where: { clientUserId: c2.id } }), 0, "no contract was created");

  // the same client re-confirms with the new version -> contract at the new terms
  const fresh = await app.call("POST", "/contracts/request", c2.tok, requestBody(pt.userId, pkg.id, { expectedPackageVersion: 2 }));
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
  contracts.push(fresh.body.id);
  const fc = await prisma.contract.findUniqueOrThrow({ where: { id: fresh.body.id } });
  assert.deepEqual(snap(fc), {
    price: 2_500_000, totalSessions: 12, packageName: "Gói 10 buổi PRO", packageSourceName: "Gói 10 buổi PRO",
    sessionMode: "ONLINE", sessionDurationMinutes: 90, validityDays: 30, packageId: pkg.id,
  });

  // an old app sends no version: it still gets a contract (at the current terms) and is counted, with its client header
  const c3 = newClient();
  const legacy = await app.call("POST", "/contracts/request", c3.tok, requestBody(pt.userId, pkg.id), { "x-gymini-client": "mobile/0.9/7" });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  contracts.push(legacy.body.id);
  assert.equal(Number((await prisma.contract.findUniqueOrThrow({ where: { id: legacy.body.id } })).price), 2_500_000);
  const ev = await eventsFor(c3.id);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].outcome, ev[0].route, ev[0].clientHeader], ["PACKAGE_VERSION_MISSING", "POST /contracts/request", "mobile/0.9/7"]);

  // malformed versions are a 400, not a silent pass
  const c4 = newClient();
  for (const bad of ["abc", 0, -1, 1.5]) {
    const r = await app.call("POST", "/contracts/request", c4.tok, requestBody(pt.userId, pkg.id, { expectedPackageVersion: bad }));
    assert.equal(r.status, 400, `expectedPackageVersion=${JSON.stringify(bad)} -> ${r.status}`);
  }
  assert.equal(await prisma.contract.count({ where: { clientUserId: c4.id } }), 0);
});

// ── 4. atomicity ─────────────────────────────────────────────────────────────────────────────

test("atomic: a request that arrives while the package row is being changed waits for it - it never snapshots new terms under an old version, nor old terms under a new one", async () => {
  const pt = await makePublicPt();
  created.push(pt.userId);
  const pkg = await makePackage(pt.userId, { name: "Atomic", sessionCount: 10, price: 1_000_000 });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // A "listing apply": locks the package row FOR UPDATE, holds it, then changes price + version and commits.
  let locked!: () => void;
  const lockedP = new Promise<void>((r) => (locked = r));
  const applier = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM pt_service_packages WHERE id = ${pkg.id} FOR UPDATE`;
    locked();
    await sleep(700); // the buyers below are now blocked on their FOR SHARE read
    await tx.pTServicePackage.update({ where: { id: pkg.id }, data: { price: 1_500_000, version: 2 } });
  });
  await lockedP;

  const withVersion = newClient();
  const legacyClient = newClient();
  const t0 = Date.now();
  const [a, b] = await Promise.all([
    app.call("POST", "/contracts/request", withVersion.tok, requestBody(pt.userId, pkg.id, { expectedPackageVersion: 1 })),
    app.call("POST", "/contracts/request", legacyClient.tok, requestBody(pt.userId, pkg.id)),
    applier,
  ]);
  assert.ok(Date.now() - t0 >= 600, "the requests really waited for the row lock");
  // the buyer who showed version 1 is refused, with version 2 and the new price...
  assert.equal(a.status, 409, JSON.stringify(a.body));
  assert.equal(a.body.code, "PACKAGE_CHANGED");
  assert.equal(a.body.package.version, 2);
  assert.equal(Number(a.body.package.price), 1_500_000);
  assert.equal(await prisma.contract.count({ where: { clientUserId: withVersion.id } }), 0);
  // ...and the one who sent nothing is sold the package as it is AFTER the change (the snapshot came from the locked row,
  // not from the pre-lock read that still said 1,000,000)
  assert.equal(b.status, 201, JSON.stringify(b.body));
  contracts.push(b.body.id);
  assert.equal(Number((await prisma.contract.findUniqueOrThrow({ where: { id: b.body.id } })).price), 1_500_000);
});

test("concurrent: 20 contract requests racing a package that keeps changing - every contract created carries the price of the version the buyer read", async () => {
  const pt = await makePublicPt();
  created.push(pt.userId);
  const pkg = await makePackage(pt.userId, { name: "Race", sessionCount: 10, price: 1_000_000 });
  const buyers = Array.from({ length: 20 }, () => newClient());
  const priceOf = (v: number) => 1_000_000 + 100_000 * (v - 1);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // What a client "last read": bumped only AFTER the change committed, like a client refreshing the package list.
  let knownVersion = 1;
  const updater = (async () => {
    // start once the first buyer has a contract, then change the package every ~25ms
    for (let t = 0; t < 3000 && (await prisma.contract.count({ where: { ptUserId: pt.userId } })) < 1; t++) await sleep(2);
    for (let v = 2; v <= 6; v++) {
      await sleep(25);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM pt_service_packages WHERE id = ${pkg.id} FOR UPDATE`;
        await tx.pTServicePackage.update({ where: { id: pkg.id }, data: { price: priceOf(v), version: v } });
      });
      knownVersion = v;
    }
  })();
  // buyers press "buy" staggered over the window in which the package changes; each sends the version it read at that moment
  const buyerRuns = buyers.map(async (c, i) => {
    await sleep(i * 8);
    const sent = knownVersion;
    const r = await app.call("POST", "/contracts/request", c.tok, requestBody(pt.userId, pkg.id, { expectedPackageVersion: sent }));
    return { i, sent, r };
  });
  const [runs] = await Promise.all([Promise.all(buyerRuns), updater]);

  let ok = 0;
  let stale = 0;
  for (const { i, sent, r } of runs) {
    if (r.status === 201) {
      ok++;
      contracts.push(r.body.id);
      const price = Number((await prisma.contract.findUniqueOrThrow({ where: { id: r.body.id } })).price);
      assert.equal(price, priceOf(sent), `buyer ${i} read version ${sent} (${priceOf(sent)}) but got a contract at ${price}`);
    } else {
      stale++;
      assert.equal(r.status, 409, `buyer ${i}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, "PACKAGE_CHANGED");
      assert.ok(r.body.package.version > sent, "the package in the 409 is newer than what the buyer showed");
    }
  }
  assert.equal(ok + stale, 20);
  assert.ok(ok >= 1, "requests that matched the live version succeeded");
  // no contract exists at a price that no version ever had, and each contract's price is one of the six versions
  const prices = (await prisma.contract.findMany({ where: { ptUserId: pt.userId }, select: { price: true } })).map((c) => Number(c.price));
  assert.ok(prices.every((p) => [1, 2, 3, 4, 5, 6].map(priceOf).includes(p)));

  // settled: version 6 is the only one that sells
  const late1 = newClient();
  const late2 = newClient();
  assert.equal((await app.call("POST", "/contracts/request", late1.tok, requestBody(pt.userId, pkg.id, { expectedPackageVersion: 5 }))).status, 409);
  const fresh = await app.call("POST", "/contracts/request", late2.tok, requestBody(pt.userId, pkg.id, { expectedPackageVersion: 6 }));
  assert.equal(fresh.status, 201);
  contracts.push(fresh.body.id);
  assert.equal(Number((await prisma.contract.findUniqueOrThrow({ where: { id: fresh.body.id } })).price), priceOf(6));
});
