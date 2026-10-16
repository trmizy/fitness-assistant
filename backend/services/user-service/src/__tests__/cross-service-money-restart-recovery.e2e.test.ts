/**
 * D57 item 6 - RESTART / CRASH RECOVERY of user-service while money is moving, with the REAL payment-service ledger.
 *
 * Evidence label: BACKEND INTEGRATION - real OS processes, real HTTP, real ledger code, isolated Postgres TEST databases.
 *   REAL     payment-service runs as its own process (see cross-service-money.harness.ts); a SECOND user-service runs as its
 *            own OS process (`node --import tsx src/server.ts`, its real boot path incl. the sweeps' timers) and is killed
 *            with SIGKILL (taskkill /F on Windows) in the middle of a money operation, then started again on the same DB.
 *   FIXTURE  a HOLDING PROXY between the killed user-service and payment-service: it forwards the request, lets payment-service
 *            finish and COMMIT its ledger transaction, then withholds the answer until the test has killed the caller - the
 *            exact window "payment-service recorded the money, user-service died before it wrote its own state". Also:
 *            the contract row (born PENDING_PAYMENT), the simulated signed gateway IPN, a fake auth-service that turns
 *            a "Bearer tok|<id>|<role>" token into an identity, session rows inserted at the state a scenario starts from.
 *   NOT in the loop: API gateway, browser, real payment gateway, auth-service, chat-service, any dev database.
 * This is NOT the timeout study (another auditor owns it); it asks only "what is the state after a restart, and what do the
 * sweeps / a retry do about it".
 *
 * Opt-in, ALONE (it TRUNCATEs the payment ledger tables of the database it is given):
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_crash_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_crash_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/cross-service-money-restart-recovery.e2e.test.ts
 *
 * Money maths (by hand): price 5,000,000 / 10 sessions => one session = 500,000 = PT 450,000 + platform 50,000.
 * After 2 delivered sessions a client cancellation refunds 90% of 4,000,000 = 3,600,000 (the 10% fee is shared 90/10).
 * A PT ban refunds 100% of the unused value (8 x 500,000 = 4,000,000 for 2 used sessions).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { HOUR, DAY, skip, startHarness, type Harness } from "./cross-service-money.harness";
import { isTestDatabaseUrl } from "./test-db-guard";

const USER_DIR = path.resolve(__dirname, "../..");
const SERVICE_SECRET_HEADER = "x-service-secret";

let H: Harness;
let auth: http.Server;
let authUrl = "";
let proxy: Proxy;

// ── a fake auth-service: "Bearer tok|<id>|<role>" -> identity (the same fixture every sibling suite uses) ──
async function startFakeAuth() {
  auth = http.createServer((req, res) => {
    const m = /^Bearer tok\|([^|]+)\|(.+)$/.exec(String(req.headers.authorization ?? ""));
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/auth/verify") && m) {
      res.end(JSON.stringify({ user: { id: m[1], email: `${m[1]}@test.local`, role: m[2] } }));
    } else if (req.url?.startsWith("/auth/verify")) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Invalid or expired token" }));
    } else {
      res.end("{}");
    }
  });
  await new Promise<void>((r) => auth.listen(0, "127.0.0.1", () => r()));
  authUrl = `http://127.0.0.1:${(auth.address() as net.AddressInfo).port}`;
}

// ── the holding proxy ──
interface Held {
  path: string;
  status: number;
  release: () => void;
}
class Proxy {
  server: http.Server;
  port = 0;
  /** (path, nth call of that path since reset) -> hold this response? */
  rule: ((p: string, n: number) => boolean) | null = null;
  private counts = new Map<string, number>();
  private waiters: Array<(h: Held) => void> = [];
  held: Held[] = [];
  forwarded: string[] = [];
  constructor(private target: string) {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const p = req.url ?? "";
        const n = (this.counts.get(p) ?? 0) + 1;
        this.counts.set(p, n);
        this.forwarded.push(`${req.method} ${p}`);
        const u = new URL(this.target);
        const up = http.request({ host: u.hostname, port: u.port, path: p, method: req.method, headers: req.headers }, (ur) => {
          const out: Buffer[] = [];
          ur.on("data", (c) => out.push(c));
          ur.on("end", () => {
            const send = () => {
              try {
                res.writeHead(ur.statusCode ?? 502, ur.headers);
                res.end(Buffer.concat(out));
              } catch {
                /* the caller is dead: nobody to answer */
              }
            };
            if (this.rule && this.rule(p, n)) {
              const held: Held = { path: p, status: ur.statusCode ?? 0, release: send };
              this.held.push(held);
              const w = this.waiters.shift();
              if (w) w(held);
            } else send();
          });
        });
        up.on("error", () => {
          try {
            res.writeHead(502).end();
          } catch {
            /* ignore */
          }
        });
        up.end(Buffer.concat(chunks));
      });
    });
  }
  async start() {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", () => r()));
    this.port = (this.server.address() as net.AddressInfo).port;
  }
  get url() {
    return `http://127.0.0.1:${this.port}`;
  }
  reset() {
    this.rule = null;
    this.counts.clear();
    this.held = [];
    this.forwarded = [];
    this.waiters = [];
  }
  /** Resolves when payment-service has ANSWERED a request the rule holds back (its ledger transaction is committed by then). */
  nextHeld(timeoutMs = 30_000): Promise<Held> {
    const ready = this.held.find((h) => !(h as any).taken);
    if (ready) {
      (ready as any).taken = true;
      return Promise.resolve(ready);
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("proxy: no held response within timeout")), timeoutMs);
      this.waiters.push((h) => {
        clearTimeout(t);
        (h as any).taken = true;
        resolve(h);
      });
    });
  }
  async close() {
    (this.server as any).closeAllConnections?.();
    await new Promise((r) => this.server.close(r));
  }
}

// ── the killable user-service process ──
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}
function killTree(child: ChildProcess | null) {
  if (!child || child.pid == null || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}
class UserProc {
  child: ChildProcess | null = null;
  port = 0;
  log: string[] = [];
  async start(extraEnv: Record<string, string> = {}) {
    const dbUrl = process.env.DATABASE_URL ?? "";
    if (!isTestDatabaseUrl(dbUrl)) throw new Error("refusing to start a user-service process on a non-test database");
    this.port = await freePort();
    this.log = [];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(this.port),
      DATABASE_URL: dbUrl,
      PAYMENT_SERVICE_URL: proxy.url,
      INTERNAL_SERVICE_SECRET: H.secret,
      INTERNAL_API_SECRET: H.secret,
      AUTH_SERVICE_URL: authUrl,
      GYM_SERVICE_URL: "http://127.0.0.1:9",
      CHAT_SERVICE_URL: "http://127.0.0.1:9",
      FITNESS_DISABLE_REDIS: "true",
      // every timer off by default: a scenario turns on only the one it studies (the boot path still starts them all)
      SESSION_SETTLEMENT_SWEEP_INTERVAL_MS: "3600000",
      CONTRACT_EXPIRY_SWEEP_INTERVAL_MS: "3600000",
      CONTRACT_PAYMENT_DEADLINE_SWEEP_INTERVAL_MS: "3600000",
      CONTRACT_HOLDBACK_SWEEP_INTERVAL_MS: "3600000",
      ...extraEnv,
    };
    delete env.AUTH_LAMBDA_NAME;
    delete env.PAYMENT_LAMBDA_NAME;
    this.child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: USER_DIR, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const keep = (b: Buffer) => {
      this.log.push(b.toString());
      if (this.log.length > 300) this.log.shift();
    };
    this.child.stdout!.on("data", keep);
    this.child.stderr!.on("data", keep);
    const t0 = Date.now();
    for (;;) {
      if (this.child.exitCode !== null) throw new Error(`user-service child exited early (${this.child.exitCode}):\n${this.log.slice(-20).join("")}`);
      try {
        if ((await fetch(`${this.url}/health`)).ok) return;
      } catch {
        /* not up yet */
      }
      if (Date.now() - t0 > 90_000) throw new Error(`user-service child not healthy:\n${this.log.slice(-20).join("")}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  get url() {
    return `http://127.0.0.1:${this.port}`;
  }
  async kill() {
    const c = this.child;
    if (!c || c.exitCode !== null) return;
    const exited = new Promise<void>((r) => c.once("exit", () => r()));
    killTree(c);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  }
  async call(method: string, p: string, token: string | null, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(this.url + p, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }
}
const tokenOf = (id: string, role: string) => `tok|${id}|${role}`;

// ── plumbing ──
test.before(async () => {
  if (skip) return;
  H = await startHarness();
  await startFakeAuth();
  proxy = new Proxy(H.payUrl);
  await proxy.start();
});
test.after(async () => {
  if (proxy) await proxy.close();
  if (auth) await new Promise((r) => auth.close(r));
  if (H) await H.close();
});

const UNIT = 500_000;
const PT_UNIT = 450_000;
const PLAT_UNIT = 50_000;
const w = (a: number, p = 0, l = 0) => ({ a, p, l });
const show = (label: string, o: Record<string, unknown>) => console.log(`[CRASH-RECOVERY] ${label} ${JSON.stringify(o)}`);
const contractRow = (id: string) => H.m.prisma.contract.findUniqueOrThrow({ where: { id } });
const procs: UserProc[] = [];
async function userProc(extraEnv: Record<string, string> = {}) {
  const u = new UserProc();
  procs.push(u);
  await u.start(extraEnv);
  return u;
}
async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  proxy.reset();
  try {
    await fn();
    await H.invariant("end of scenario");
  } finally {
    for (const u of procs.splice(0)) await u.kill();
    for (const h of proxy.held) h.release();
    proxy.reset();
    await H.startPayment().catch(() => {});
    await H.m.prisma.sessionSettlement.deleteMany({}).catch(() => {});
    await H.cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// R1. killed AFTER payment-service committed the refund, BEFORE user-service wrote the contract status (client cancel)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("R1. [REGRESSION D58, was a defect] client cancels; user-service is SIGKILLed after the refund is committed in the ledger and before the contract is written: the ending was RECORDED before the money call, so after the restart the settlement sweep completes it ALONE (no client retry needed, no second refund); a late client retry is a no-op", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 2);
    const clientTok = tokenOf(c.clientUserId, "CUSTOMER");

    const u1 = await userProc();
    proxy.rule = (p) => p.endsWith("/internal/contracts/terminate");
    const inflight = u1.call("POST", `/contracts/${c.id}/terminate`, clientTok, { reason: "CLIENT_CANCELLED" }).catch((e) => ({ status: -1, body: String(e) }));
    const held = await proxy.nextHeld();
    assert.equal(held.status, 200, "payment-service answered 200: its ledger transaction is committed");
    await u1.kill(); // <- the crash
    held.release(); // the answer goes nowhere
    const lost = await inflight;
    assert.ok(lost.status === -1 || lost.status >= 500, `the caller never got an answer (${JSON.stringify(lost)})`);

    // ── state right after the crash ──
    assert.deepEqual(await H.wallet("CLIENT", c.clientUserId), w(3_600_000), "the ledger refunded 90% of the unused value");
    const afterCrash = await contractRow(c.id);
    show("R1 after crash", { contractStatus: afterCrash.status, terminationReason: afterCrash.terminationReason, clientWallet: 3_600_000 });
    assert.equal(afterCrash.status, "ACTIVE", "the crash window: the contract is still ACTIVE although its escrow is already refunded - but it is NOT forgotten:");
    assert.equal(afterCrash.terminationReason, null);
    const intent = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
    assert.deepEqual([intent.kind, intent.reason], ["CONTRACT_TERMINATION", "CLIENT_CANCELLED"], "the accepted ending (reason) was recorded durably BEFORE the money call");
    assert.notEqual(intent.status, "SETTLED");
    const snap = await H.snapshot();
    await H.invariant("after crash");

    // ── restart: the settlement sweep finds the recorded ending (PROCESSING, stale once the dead process's lease is old) and completes it ──
    proxy.reset();
    const u2 = await userProc({ SESSION_SETTLEMENT_SWEEP_INTERVAL_MS: "700", SESSION_SETTLEMENT_STALE_PROCESSING_MS: "1500" });
    const t0 = Date.now();
    let healed = await contractRow(c.id);
    while (healed.status === "ACTIVE" && Date.now() - t0 < 30_000) {
      await new Promise((r) => setTimeout(r, 400));
      healed = await contractRow(c.id);
    }
    show("R1 after restart, no retry", { contractStatus: healed.status, terminationReason: healed.terminationReason });
    assert.deepEqual([healed.status, healed.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"], "completed by the sweep alone, with the RECORDED reason");
    assert.deepEqual(await H.snapshot(), snap, "the sweep moved no money: the ledger answered from its stored result");
    assert.equal((await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: intent.id } })).status, "SETTLED");

    // ── the client's late retry (the app retries on a dropped connection) is a no-op ──
    const retry = await u2.call("POST", `/contracts/${c.id}/terminate`, clientTok, { reason: "CLIENT_CANCELLED" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(Number(retry.body.settlement.refund), 3_600_000, "the replayed answer is the first one");
    const done = await contractRow(c.id);
    assert.deepEqual([done.status, done.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"]);
    assert.deepEqual(await H.snapshot(), snap, "the retry moved no money at all");
    assert.equal((await H.entries(c.txnId)).filter((e) => e.ownerType === "CLIENT" && e.type === "CREDIT").length, 1, "exactly one refund credit");
    assert.deepEqual(await H.wallet("PT", pt), w(2 * PT_UNIT + 360_000, 0));
    show("R1 after retry", { contractStatus: done.status, clientWallet: 3_600_000, ptAvailable: 2 * PT_UNIT + 360_000 });
  });
});

test("R1c. [REGRESSION D58/D59, was a defect] same crash, NO client retry: when the contract-expiry sweep (asking for EXPIRED) reaches it, it completes the RECORDED ending as CLIENT_CANCELLED - it cannot re-label or re-price it - with no second refund", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 2);
    const clientTok = tokenOf(c.clientUserId, "CUSTOMER");

    const u1 = await userProc();
    proxy.rule = (p) => p.endsWith("/internal/contracts/terminate");
    const inflight = u1.call("POST", `/contracts/${c.id}/terminate`, clientTok, { reason: "CLIENT_CANCELLED" }).catch(() => null);
    const held = await proxy.nextHeld();
    await u1.kill();
    held.release();
    await inflight;
    const snap = await H.snapshot();
    assert.equal((await contractRow(c.id)).status, "ACTIVE");

    proxy.reset();
    // the end date passes (TEST FIXTURE: moved into the past)
    await H.m.prisma.contract.update({ where: { id: c.id }, data: { endDate: new Date(Date.now() - DAY) } });
    await userProc({ CONTRACT_EXPIRY_SWEEP_INTERVAL_MS: "700" });
    const t0 = Date.now();
    let row = await contractRow(c.id);
    while (row.status === "ACTIVE" && Date.now() - t0 < 20_000) {
      await new Promise((r) => setTimeout(r, 400));
      row = await contractRow(c.id);
    }
    show("R1c after expiry sweep", { contractStatus: row.status, terminationReason: row.terminationReason });
    assert.deepEqual([row.status, row.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"], "the sweep ended it with the reason that was recorded, not the one it asked for");
    assert.deepEqual(await H.snapshot(), snap, "the ledger answered from its stored result: no second refund, no extra movement");
    assert.equal((await H.entries(c.txnId)).filter((e) => e.ownerType === "CLIENT" && e.type === "CREDIT").length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// R2. killed in the MIDDLE OF THE SETTLEMENT SWEEP (row PROCESSING): stale-PROCESSING recovery
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("R2. the settlement sweep is killed with a CONTRACT_TERMINATION row PROCESSING and the money already committed: the row is invisible until it is stale, then the sweep finishes it with no second refund", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 2);
    // a termination that failed earlier (payment-service had been down): the tracked row waits as FAILED (TEST FIXTURE: inserted)
    await H.m.prisma.sessionSettlement.create({
      data: { kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${c.id}`, contractId: c.id, reason: "CLIENT_CANCELLED", status: "FAILED", attempts: 1, lastError: "payment-service unreachable" },
    });

    proxy.rule = (p) => p.endsWith("/internal/contracts/terminate");
    const u1 = await userProc({ SESSION_SETTLEMENT_SWEEP_INTERVAL_MS: "600", SESSION_SETTLEMENT_STALE_PROCESSING_MS: "30000" });
    const held = await proxy.nextHeld();
    await u1.kill(); // killed mid-sweep, the row is PROCESSING
    held.release();
    assert.equal(await H.wallet("CLIENT", c.clientUserId).then((x) => x.a), 3_600_000, "the sweep's call did reach the ledger and committed");
    const stuck = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
    assert.equal(stuck.status, "PROCESSING");
    assert.equal((await contractRow(c.id)).status, "ACTIVE");
    const snap = await H.snapshot();
    show("R2 after crash", { settlementStatus: stuck.status, attempts: stuck.attempts, contractStatus: "ACTIVE", clientWallet: 3_600_000 });

    // restart at once: the row is PROCESSING and younger than the staleness limit => the sweep must NOT touch it yet
    proxy.reset();
    await userProc({ SESSION_SETTLEMENT_SWEEP_INTERVAL_MS: "600", SESSION_SETTLEMENT_STALE_PROCESSING_MS: "30000" });
    await new Promise((r) => setTimeout(r, 2500));
    const early = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
    assert.equal(early.status, "PROCESSING", "not stale yet: left alone (the contract stays ACTIVE for up to STALE_PROCESSING_MS = 10 min by default)");
    assert.equal(proxy.forwarded.filter((x) => x.includes("/terminate")).length, 0, "no payment call during the stale window");

    // after the staleness limit the sweep retries the SAME key and finishes
    const t0 = Date.now();
    let row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
    while (row.status !== "SETTLED" && Date.now() - t0 < 60_000) {
      await new Promise((r) => setTimeout(r, 500));
      row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
    }
    assert.equal(row.status, "SETTLED");
    const done = await contractRow(c.id);
    show("R2 after stale recovery", { settlementStatus: row.status, attempts: row.attempts, contractStatus: done.status, terminationReason: done.terminationReason });
    assert.deepEqual([done.status, done.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"]);
    assert.deepEqual(await H.snapshot(), snap, "the retry moved no money");
    assert.equal((await H.entries(c.txnId)).filter((e) => e.ownerType === "CLIENT" && e.type === "CREDIT").length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// R3. killed in the MIDDLE OF A BULK ENDING (PT ban, 3 contracts): the relay re-sends the same command
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("R3. PT ban unwinding 3 contracts; user-service killed after the 2nd refund was committed: after the restart the SAME command finishes the other two, each client refunded exactly once at 100% of the unused value", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const cs = [await H.paidContract(pt, { packageName: "R3-1" }), await H.paidContract(pt, { packageName: "R3-2" }), await H.paidContract(pt, { packageName: "R3-3" })];
    const used = [2, 2, 2];
    for (let i = 0; i < 3; i++) await H.deliver(cs[i], used[i]);
    const cmdBody = { adminId: "admin-e2e", reason: "khoá vĩnh viễn", seq: "1" };

    const u1 = await userProc();
    proxy.rule = (p, n) => p.endsWith("/internal/contracts/terminate") && n === 2;
    const inflight = u1.call("POST", `/internal/pt/${pt}/deactivate`, null, cmdBody, { [SERVICE_SECRET_HEADER]: H.secret }).catch((e) => ({ status: -1, body: String(e) }));
    const held = await proxy.nextHeld();
    await u1.kill(); // <- the crash, after contract 2's refund is committed
    held.release();
    await inflight;

    const rows = await Promise.all(cs.map((c) => contractRow(c.id)));
    const refunded = await Promise.all(cs.map((c) => H.wallet("CLIENT", c.clientUserId).then((x) => x.a)));
    const statuses = rows.map((r) => r.status);
    show("R3 after crash", { statuses, clientWallets: refunded });
    const ended = statuses.filter((s) => s !== "ACTIVE").length;
    const money = refunded.filter((a) => a > 0).length;
    assert.ok(money >= 2, `at least two refunds are committed in the ledger (got ${money})`);
    assert.ok(ended < 3, "the unwind is incomplete (otherwise the crash window was missed)");
    const crashSnap = await H.snapshot();
    await H.invariant("after crash");

    // restart + the relay sends the SAME command again (auth-service's relay sweep does this every 5 minutes while it is not SETTLED)
    proxy.reset();
    const u2 = await userProc();
    const again = await u2.call("POST", `/internal/pt/${pt}/deactivate`, null, cmdBody, { [SERVICE_SECRET_HEADER]: H.secret });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.complete, true);
    for (let i = 0; i < 3; i++) {
      const expected = (10 - used[i]) * UNIT; // 100% of the unused value
      const row = await contractRow(cs[i].id);
      assert.deepEqual([row.status, row.terminationReason], ["CANCELLED", "PT_BANNED"], `contract ${i + 1} ended`);
      assert.deepEqual(await H.wallet("CLIENT", cs[i].clientUserId), w(expected), `contract ${i + 1}: refunded exactly once, 100% of the unused value`);
      assert.equal((await H.entries(cs[i].txnId)).filter((e) => e.ownerType === "CLIENT" && e.type === "CREDIT").length, 1);
      assert.equal(await H.net(cs[i].txnId, "PT", "PENDING"), 0);
    }
    assert.deepEqual(await H.wallet("PT", pt), w(6 * PT_UNIT, 0), "the PT keeps only the 6 delivered sessions");
    assert.deepEqual(await H.revenue(), w(6 * PLAT_UNIT, 0));
    assert.equal((await H.snapshot()).receivables, 0);
    // contracts already refunded before the crash moved no further money
    for (let i = 0; i < 3; i++) if (refunded[i] > 0) assert.equal(refunded[i], (10 - used[i]) * UNIT);
    show("R3 after replay", { crashOps: crashSnap.operations, finalOps: (await H.snapshot()).operations });
    // and one more replay is a no-op
    const snap = await H.snapshot();
    const third = await u2.call("POST", `/internal/pt/${pt}/deactivate`, null, cmdBody, { [SERVICE_SECRET_HEADER]: H.secret });
    assert.equal(third.status, 200);
    assert.deepEqual(await H.snapshot(), snap, "a further replay moves nothing");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// R4. the crash window is not harmless: what a delivered session does while the contract is "ACTIVE but refunded"
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("R4. [REGRESSION D58/D59, was a defect] in the R1 crash window a delivered session can no longer be counted: the PT's completion report is REFUSED 409 CONTRACT_ENDING, no 'SETTLED with 0' release row exists, nobody is paid from the already-refunded escrow", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 2);
    const clientTok = tokenOf(c.clientUserId, "CUSTOMER");

    const u1 = await userProc();
    proxy.rule = (p) => p.endsWith("/internal/contracts/terminate");
    const inflight = u1.call("POST", `/contracts/${c.id}/terminate`, clientTok, { reason: "CLIENT_CANCELLED" }).catch(() => null);
    const held = await proxy.nextHeld();
    await u1.kill();
    held.release();
    await inflight;
    assert.equal((await contractRow(c.id)).status, "ACTIVE");
    const ptBefore = await H.wallet("PT", pt);
    const revBefore = await H.revenue();

    // the window: the contract is ACTIVE in user-service, its escrow is gone in the ledger. A session the PT delivers now:
    proxy.reset();
    const u2 = await userProc();
    const ptTok = tokenOf(pt, "PT");
    const session = await H.m.base.addSession(c, "CONFIRMED", new Date(Date.now() - 3 * DAY));
    const done = await u2.call("PATCH", `/sessions/${session.id}/complete`, ptTok, { ptNotes: "ok" });
    assert.equal(done.status, 409, JSON.stringify(done.body));
    assert.equal(done.body.code, "CONTRACT_ENDING");
    const conf = await u2.call("POST", `/sessions/${session.id}/confirm`, clientTok);
    assert.ok(conf.status === 400 || conf.status === 409, `nothing to confirm: ${conf.status}`);
    const ptAfter = await H.wallet("PT", pt);
    const revAfter = await H.revenue();
    const rel = await H.m.prisma.sessionSettlement.findUnique({ where: { idempotencyKey: `SESSION_RELEASE:${session.id}` } });
    const sessAfter = await H.m.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    show("R4 confirm inside the window", {
      completeStatus: done.status,
      confirmStatus: conf.status,
      ptAvailableBefore: ptBefore.a,
      ptAvailableAfter: ptAfter.a,
      ptPendingAfter: ptAfter.p,
      platformAvailableBefore: revBefore.a,
      platformAvailableAfter: revAfter.a,
      sessionStatus: sessAfter.status,
      releaseSettlement: rel ? { status: rel.status, attempts: rel.attempts, lastError: (rel.lastError ?? "").slice(0, 80) } : null,
    });
    assert.equal(rel, null, "no release row was ever created for the refused session (it used to be recorded SETTLED with 0 paid)");
    assert.equal((await contractRow(c.id)).usedSessions, 2, "the session was not counted");
    // The assertion that matters: nobody is paid from the (already refunded) escrow of this contract.
    assert.equal(ptAfter.a, ptBefore.a, `the PT's available balance must not grow for a session delivered on a contract whose escrow was refunded (before ${ptBefore.a}, after ${ptAfter.a})`);
    assert.equal(revAfter.a, revBefore.a, "nor the platform's");
    await H.invariant("after the window confirm");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// R5. the operator's post-deploy check (src/scripts/post-deploy-state-check.ts) SEES the crash window and the stuck rows
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("R5. post-deploy-state-check flags the R1 crash window (X-01), a PT_NO_SHOW_REPORTED on an ended contract (U-06) and a settlement stuck PROCESSING (U-07a) - and goes quiet once the window is healed", { skip }, async () => {
  const { runChecks } = await import("../scripts/post-deploy-state-check");
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt);
    await H.deliver(c, 2);
    const clientTok = tokenOf(c.clientUserId, "CUSTOMER");
    const u1 = await userProc();
    proxy.rule = (p) => p.endsWith("/internal/contracts/terminate");
    const inflight = u1.call("POST", `/contracts/${c.id}/terminate`, clientTok, { reason: "CLIENT_CANCELLED" }).catch(() => null);
    const held = await proxy.nextHeld();
    await u1.kill();
    held.release();
    await inflight;
    proxy.reset();

    // anomalies on top (TEST FIXTURE): an ended contract carrying a PT_NO_SHOW_REPORTED session, and a settlement row stuck PROCESSING for 2 h
    const ended = await H.m.base.makeContract(pt, { status: "CANCELLED", terminatedAt: new Date() });
    const bad = await H.m.base.addSession(ended, "PT_NO_SHOW_REPORTED", new Date(Date.now() - 2 * DAY));
    const stuckRow = await H.m.prisma.sessionSettlement.create({
      data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${bad.id}`, contractId: c.id, sessionId: bad.id, status: "PROCESSING", attempts: 1 },
    });
    await H.m.prisma.$executeRawUnsafe(`UPDATE session_settlements SET updated_at = now() - interval '2 hours' WHERE id = $1`, stuckRow.id);

    const env = { USER_DATABASE_URL: process.env.DATABASE_URL, PAYMENT_DATABASE_URL: process.env.E2E_PAYMENT_DATABASE_URL } as NodeJS.ProcessEnv;
    const opts = { deployedAt: new Date(Date.now() - HOUR), legacyOpenSessions: 0, knownNegativeSubledgers: 0, staleMinutes: 30, json: null };
    const before = await runChecks(env, opts);
    const get = (id: string) => before.find((f) => f.id === id)!;
    show("R5 findings with the window open", { X01: get("X-01").level, U06: get("U-06").level, U07a: get("U-07a").level, P01: get("P-01").level, P02: get("P-02").level });
    assert.equal(get("X-01").level, "FAIL");
    assert.match(get("X-01").detail ?? "", new RegExp(c.id.slice(0, 8)));
    assert.equal(get("U-06").level, "FAIL");
    assert.equal(get("U-07a").level, "FAIL");
    assert.equal(get("P-01").level, "PASS", "the ledger itself is consistent: the damage is a state mismatch, not a money drift");

    // heal: the client's retry
    await H.m.prisma.sessionSettlement.delete({ where: { id: stuckRow.id } });
    await H.m.prisma.session.deleteMany({ where: { id: bad.id } });
    const u2 = await userProc();
    const retry = await u2.call("POST", `/contracts/${c.id}/terminate`, clientTok, { reason: "CLIENT_CANCELLED" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const after = await runChecks(env, opts);
    const getA = (id: string) => after.find((f) => f.id === id)!;
    assert.notEqual(getA("X-01").level, "FAIL", "the window is closed after the retry");
    assert.equal(getA("U-07a").level, "PASS");
    await H.m.prisma.contract.deleteMany({ where: { id: ended.id } }).catch(() => {});
  });
});
