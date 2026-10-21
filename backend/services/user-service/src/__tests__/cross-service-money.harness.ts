/**
 * Harness for cross-service-money.e2e.test.ts - REAL user-service <-> REAL payment-service money paths.
 *
 * Evidence label: BACKEND INTEGRATION. What is real and what is a fixture:
 *   REAL    payment-service runs as its own OS process (`node --import tsx src/server.ts`, its real Express app,
 *           real ledger code) on an ephemeral port against the isolated gymcoach_payment_test database;
 *           user-service's real Express app + real services run in this process against gymcoach_user_test;
 *           every user-service -> payment-service call is a real HTTP request carrying the shared internal
 *           secret; payment-service -> user-service (activate-after-payment) is a real HTTP request too.
 *   FIXTURE the contract row is inserted directly in PENDING_PAYMENT (instead of request/accept/sign); the VNPay
 *           gateway's IPN is simulated by this harness, signed with the same HMAC-SHA512 + test secret the
 *           payment-service child is configured with (the gateway is the one party that cannot run here);
 *           session rows are inserted at the state the scenario starts from (e.g. CONFIRMED in the past);
 *           auth-service is replaced by a token -> identity table (as in every sibling suite).
 *   NOT in the loop: the API gateway, any browser, a real payment gateway, mobile, auth-service, chat-service,
 *           gym-service, any dev database.
 *
 * Nothing in here may be imported statically by a test file before startHarness() has run: user-service's
 * payment.client.ts captures PAYMENT_SERVICE_URL / INTERNAL_SERVICE_SECRET when it is first loaded, so every
 * user-service module is loaded with a dynamic import() AFTER those variables are set.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { PrismaClient } from "../generated/prisma";
import { isTestDatabaseUrl } from "./test-db-guard";

export const PAYMENT_DB_URL =
  process.env.E2E_PAYMENT_DATABASE_URL ??
  "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public";

/** Both databases must be isolated test databases, and not the same one. */
export const usable =
  process.env.RUN_CROSS_SERVICE_MONEY === "1" &&
  isTestDatabaseUrl(process.env.DATABASE_URL) &&
  isTestDatabaseUrl(PAYMENT_DB_URL) &&
  (process.env.DATABASE_URL ?? "").split("?")[0] !== PAYMENT_DB_URL.split("?")[0];
export const skip = usable
  ? false
  : "Opt-in suite: set RUN_CROSS_SERVICE_MONEY=1 and DATABASE_URL (user-service) / E2E_PAYMENT_DATABASE_URL pointing at *_test databases. It spawns payment-service and TRUNCATEs its ledger tables - run it alone.";

const SECRET = `e2e-internal-secret-${crypto.randomBytes(8).toString("hex")}`;
const VNPAY_TMN = "E2ETEST";
const VNPAY_HASH_SECRET = `e2e-vnpay-hash-${crypto.randomBytes(8).toString("hex")}`;
const DEAD = "http://127.0.0.1:9"; // discard port: nothing listens, connections are refused at once
const PAYMENT_DIR = path.resolve(__dirname, "../../../payment-service");
const GYM_DIR = path.resolve(__dirname, "../../../gym-service");

export const DAY = 24 * 3600 * 1000;
export const HOUR = 3600 * 1000;

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
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

export interface Wallet {
  a: number; // available
  p: number; // pending
  l: number; // locked
}
const ZERO_WALLET: Wallet = { a: 0, p: 0, l: 0 };

/** A gym-tied contract's snapshot (decimal strings, platform + PT + gym = 1). */
export interface GymTerms {
  gymId: string;
  platformRate: string;
  ptRate: string;
  gymRate: string;
}

export interface HarnessOptions {
  /**
   * Phase 3 / P3.7: also spawn a REAL gym-service (`node --import tsx src/server.ts`, its real Express app and real
   * Prisma queries) on `databaseUrl` (must be a `*_test` database) and point user-service's GYM_SERVICE_URL at it.
   * Without it GYM_SERVICE_URL stays at the dead port, exactly as before.
   */
  gym?: {
    databaseUrl: string;
    /**
     * Phase 2 / P2.4: let the gym-service child talk to the REAL user-service of this process (USER_SERVICE_URL -> the
     * user app, which then listens on a port reserved up front) and verify bearer tokens against a small auth-service
     * FIXTURE server that answers from the same token table as `tokenFor`. Off by default: both stay the dead port.
     */
    bridge?: boolean;
  };
  /** Override the payment test database (default: PAYMENT_DB_URL). Must still be a `*_test` database. */
  paymentDatabaseUrl?: string;
  /**
   * D77 follow-up: point the payment-service child's AUTH_SERVICE_URL at the small token-table fixture (the same one the gym bridge
   * uses) so a test can call payment-service's ADMIN routes over real HTTP (`adminCall`). Off by default: the child keeps the dead port.
   */
  paymentAuth?: boolean;
}

export async function startHarness(opts: HarnessOptions = {}) {
  const paymentDbUrl = opts.paymentDatabaseUrl ?? PAYMENT_DB_URL;
  if (opts.gym && !isTestDatabaseUrl(opts.gym.databaseUrl)) throw new Error("gym database must be a *_test database");
  if (!isTestDatabaseUrl(paymentDbUrl)) throw new Error("payment database must be a *_test database");
  // ── configuration, BEFORE any user-service module is loaded ──
  const payPort = await freePort();
  const payUrl = `http://127.0.0.1:${payPort}`;
  let gymUrl = DEAD;
  let gymChild: ChildProcess | null = null;
  const gymLog: string[] = [];
  // token -> identity table (the auth-service fixture of every sibling suite)
  const identities = new Map<string, { id: string; email: string; role: string }>();
  let userPort = 0; // 0 = ephemeral (the default); reserved up front only when the gym child must reach us
  let authFixture: http.Server | null = null;
  let authFixtureUrl = DEAD;
  if (opts.gym?.bridge) userPort = await freePort();
  if (opts.gym?.bridge || opts.paymentAuth) {
    authFixture = http.createServer((req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = req.url ?? "";
      if (req.method === "POST" && url === "/auth/verify") {
        const user = identities.get(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
        return user ? send(200, { user }) : send(401, { error: "Invalid or expired token" });
      }
      const m = /^\/auth\/internal\/users\/([^/?]+)/.exec(url);
      if (req.method === "GET" && m) return send(200, { user: { id: decodeURIComponent(m[1]), firstName: "Test", lastName: "Coach" } });
      return send(404, { error: "not found" });
    });
    await new Promise<void>((r) => authFixture!.listen(0, "127.0.0.1", () => r()));
    authFixtureUrl = `http://127.0.0.1:${(authFixture.address() as net.AddressInfo).port}`;
  }
  if (opts.gym) {
    const gymPort = await freePort();
    gymUrl = `http://127.0.0.1:${gymPort}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(gymPort),
      DATABASE_URL: opts.gym.databaseUrl,
      INTERNAL_SERVICE_SECRET: SECRET,
      INTERNAL_API_SECRET: SECRET,
      // no background sweep may run during a test (they would call payment-service); no outbound dependency is reachable
      MEMBERSHIP_PAYOUT_SWEEP_INTERVAL_MS: "2147483647",
      REFERRAL_SETTLEMENT_SWEEP_INTERVAL_MS: "2147483647",
      PAYMENT_SERVICE_URL: DEAD,
      USER_SERVICE_URL: opts.gym.bridge ? `http://127.0.0.1:${userPort}` : DEAD,
      AUTH_SERVICE_URL: authFixtureUrl,
      AI_SERVICE_URL: DEAD,
      CHAT_SERVICE_URL: DEAD,
      USER_LAMBDA_NAME: "",
      PAYMENT_LAMBDA_NAME: "",
      AUTH_LAMBDA_NAME: "",
    };
    gymChild = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: GYM_DIR, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const keep = (b: Buffer) => {
      gymLog.push(b.toString());
      if (gymLog.length > 400) gymLog.shift();
    };
    gymChild.stdout!.on("data", keep);
    gymChild.stderr!.on("data", keep);
    const t0 = Date.now();
    for (;;) {
      if (gymChild.exitCode !== null) throw new Error(`gym-service exited early (${gymChild.exitCode}):
${gymLog.slice(-30).join("")}`);
      try {
        if ((await fetch(`${gymUrl}/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() - t0 > 60_000) throw new Error(`gym-service not healthy after 60s:
${gymLog.slice(-30).join("")}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const onGymExit = () => killTree(gymChild);
  process.on("exit", onGymExit);
  process.env.PAYMENT_SERVICE_URL = payUrl;
  process.env.INTERNAL_SERVICE_SECRET = SECRET;
  process.env.INTERNAL_API_SECRET = SECRET;
  process.env.AUTH_SERVICE_URL = DEAD; // never reach a developer's auth-service on :3001
  process.env.GYM_SERVICE_URL = gymUrl;
  process.env.CHAT_SERVICE_URL = DEAD;
  process.env.FITNESS_DISABLE_REDIS = "true";
  delete process.env.AUTH_LAMBDA_NAME;
  delete process.env.PAYMENT_LAMBDA_NAME;

  const m = {
    prisma: (await import("../repositories/profile.repository")).prisma,
    authServiceClient: (await import("../clients/auth-service.client")).authServiceClient,
    paymentClient: (await import("../clients/payment.client")).paymentClient,
    notificationService: (await import("../services/notification.service")).notificationService,
    contractService: (await import("../services/contract.service")).contractService,
    bookingService: (await import("../services/booking.service")).bookingService,
    ptRestrictionService: (await import("../services/pt-restriction.service")).ptRestrictionService,
    ptDeactivationService: (await import("../services/pt-deactivation.service")).ptDeactivationService,
    payout: await import("../services/contract-payout.service"),
    base: await import("./pt-restriction.test-helpers"),
    scope: await import("./pt-contract-scope.test-helpers"),
  };

  // The payment client must really be pointed at the child (a stale module-level default would silently hit :3007).
  const probe = (m.paymentClient as any).getTransaction;
  if (typeof probe !== "function") throw new Error("paymentClient.getTransaction missing");

  // ── user-service app in this process, behind a token table (auth-service fixture) ──
  const restoreAuth = m.base.patch(m.authServiceClient, "verifyToken", async (header: string) => {
    const user = identities.get(String(header).replace(/^Bearer /, ""));
    if (!user) throw Object.assign(new Error("bad token"), { response: { status: 401, data: { error: "Invalid or expired token" } } });
    return { status: 200, data: { user } };
  });
  // the realtime push goes to chat-service, which is not running; rows are still stored for real
  const restorePublish = m.base.patch(m.notificationService, "publish", () => undefined);
  const { default: userApp } = await import("../app");
  let userServer: http.Server = userApp.listen(userPort, "127.0.0.1");
  await new Promise((r) => userServer.once("listening", r));
  const userUrl = `http://127.0.0.1:${(userServer.address() as net.AddressInfo).port}`;
  /** Phase 2 / P2.4: really stop / restart the user-service HTTP listener (same port) - peers then get connection refused. */
  async function stopUser() {
    if (!userServer.listening) return;
    (userServer as any).closeAllConnections?.();
    await new Promise((r) => userServer.close(r));
  }
  async function startUser() {
    if (userServer.listening) return;
    userServer = userApp.listen(Number(new URL(userUrl).port), "127.0.0.1");
    await new Promise((r) => userServer.once("listening", r));
  }

  // ── payment-service child process ──
  let child: ChildProcess | null = null;
  let log: string[] = [];
  const onExit = () => killTree(child);
  process.on("exit", onExit);

  async function waitHealthy(timeoutMs = 60_000) {
    const t0 = Date.now();
    for (;;) {
      if (child && child.exitCode !== null) throw new Error(`payment-service exited early (${child.exitCode}):\n${log.slice(-30).join("")}`);
      try {
        const r = await fetch(`${payUrl}/health`);
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`payment-service not healthy after ${timeoutMs}ms:\n${log.slice(-30).join("")}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function startPayment() {
    if (child && child.exitCode === null) return;
    log = [];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(payPort),
      DATABASE_URL: paymentDbUrl,
      INTERNAL_SERVICE_SECRET: SECRET,
      INTERNAL_API_SECRET: SECRET,
      USER_SERVICE_URL: userUrl,
      GYM_SERVICE_URL: DEAD,
      AI_SERVICE_URL: DEAD,
      AUTH_SERVICE_URL: opts.paymentAuth ? authFixtureUrl : DEAD,
      USER_LAMBDA_NAME: "",
      GYM_LAMBDA_NAME: "",
      AI_LAMBDA_NAME: "",
      PAYMENT_PROVIDER: "VNPAY",
      // The smallest override that lets the gateway-facing code boot: a gateway credential pair that is only ever
      // used to sign/verify with HMAC inside this test. No money check is weakened: signatures are still verified.
      VNPAY_TMN_CODE: VNPAY_TMN,
      VNPAY_HASH_SECRET: VNPAY_HASH_SECRET,
      VNPAY_SIMULATE: "false",
      FITNESS_DISABLE_REDIS: "true",
    };
    delete env.CONTRACT_CLIENT_CANCEL_REFUND_RATE;
    child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: PAYMENT_DIR, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const keep = (b: Buffer) => {
      log.push(b.toString());
      if (log.length > 400) log.shift();
    };
    child.stdout!.on("data", keep);
    child.stderr!.on("data", keep);
    await waitHealthy();
  }

  async function stopPayment() {
    const c = child;
    if (!c || c.exitCode !== null) return;
    const exited = new Promise<void>((r) => c.once("exit", () => r()));
    killTree(c);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  }

  await startPayment();

  // ── raw SQL view of the payment ledger (an independent reader of the isolated payment test DB) ──
  const payDb = new PrismaClient({ datasourceUrl: paymentDbUrl });
  const num = (v: unknown) => Number(v ?? 0);

  async function resetPayment() {
    await payDb.$executeRawUnsafe(
      "TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE",
    );
  }

  async function wallet(ownerType: string, ownerId: string): Promise<Wallet> {
    const rows: any[] = await payDb.$queryRawUnsafe(
      "SELECT available_balance::text AS a, pending_balance::text AS p, locked_balance::text AS l FROM wallets WHERE owner_type = $1::\"WalletOwnerType\" AND owner_id = $2",
      ownerType,
      ownerId,
    );
    return rows[0] ? { a: num(rows[0].a), p: num(rows[0].p), l: num(rows[0].l) } : { ...ZERO_WALLET };
  }
  const revenue = () => wallet("PLATFORM", "REVENUE");
  const escrow = () => wallet("PLATFORM", "ESCROW");

  /** Every ledger row of one payment transaction: who, which bucket, which direction, how much. */
  async function entries(txnId: string) {
    const rows: any[] = await payDb.$queryRawUnsafe(
      `SELECT w.owner_type::text AS owner_type, w.owner_id, e.bucket::text AS bucket, e.entry_type::text AS entry_type,
              e.amount::text AS amount, COALESCE(e.description,'') AS description
         FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
        WHERE e.transaction_id = $1 ORDER BY e.created_at, e.id`,
      txnId,
    );
    return rows.map((r) => ({ ownerType: r.owner_type as string, ownerId: r.owner_id as string, bucket: r.bucket as string, type: r.entry_type as string, amount: num(r.amount), description: r.description as string }));
  }
  /** Net movement of one owner type in one bucket attributable to ONE contract's transaction (credits - debits). */
  async function net(txnId: string, ownerType: string, bucket: "PENDING" | "AVAILABLE" | "LOCKED", ownerId?: string) {
    return (await entries(txnId))
      .filter((e) => e.ownerType === ownerType && e.bucket === bucket && (ownerId === undefined || e.ownerId === ownerId))
      .reduce((s, e) => s + (e.type === "CREDIT" ? e.amount : -e.amount), 0);
  }

  /** The system-wide reconciliation invariant (same maths as payment-service's buildReconciliationReport). */
  async function invariant(context = "") {
    const rows: any[] = await payDb.$queryRawUnsafe(
      `SELECT owner_type::text AS owner_type, CASE WHEN owner_type = 'PLATFORM' THEN owner_id ELSE '' END AS owner_id,
              SUM(pending_balance)::text AS p, SUM(available_balance)::text AS a, SUM(locked_balance)::text AS l
         FROM wallets GROUP BY 1, 2`,
    );
    let claims = 0;
    let escrowAvail = 0;
    for (const r of rows) {
      if (r.owner_type === "PLATFORM" && r.owner_id === "ESCROW") {
        escrowAvail = num(r.a);
        continue;
      }
      claims += num(r.a) + num(r.p) + num(r.l);
    }
    const negative: any[] = await payDb.$queryRawUnsafe(
      "SELECT owner_type::text, owner_id FROM wallets WHERE available_balance < 0 OR pending_balance < 0 OR locked_balance < 0",
    );
    const drift = Math.round((escrowAvail - claims) * 100) / 100;
    if (drift !== 0 || negative.length > 0) {
      throw new Error(`Money invariant violated${context ? ` (${context})` : ""}: escrow=${escrowAvail} claims=${claims} drift=${drift} negative=${JSON.stringify(negative)}`);
    }
    return { escrow: escrowAvail, claims };
  }

  /** Everything that proves "nothing moved": non-zero wallet balances + row counts. */
  async function snapshot() {
    const w: any[] = await payDb.$queryRawUnsafe(
      `SELECT owner_type::text AS t, owner_id AS id, available_balance::text AS a, pending_balance::text AS p, locked_balance::text AS l
         FROM wallets WHERE available_balance <> 0 OR pending_balance <> 0 OR locked_balance <> 0 ORDER BY 1, 2`,
    );
    const c = async (sql: string) => num(((await payDb.$queryRawUnsafe(sql)) as any[])[0].n);
    return {
      wallets: w.map((r) => `${r.t}:${r.id}:${r.a}/${r.p}/${r.l}`),
      entries: await c("SELECT count(*)::text AS n FROM wallet_ledger_entries"),
      operations: await c("SELECT count(*)::text AS n FROM ledger_operations"),
      receivables: await c("SELECT count(*)::text AS n FROM partner_receivables"),
    };
  }

  // ── the gateway (simulated, signed) ──
  function signedVnpayQuery(txnRef: string, amountVnd: number, ok = true): string {
    const params: Record<string, string> = {
      vnp_Amount: String(Math.round(amountVnd) * 100),
      vnp_BankCode: "NCB",
      vnp_ResponseCode: ok ? "00" : "24",
      vnp_TmnCode: VNPAY_TMN,
      vnp_TransactionNo: String(Math.floor(10_000_000 + Math.random() * 89_999_999)),
      vnp_TransactionStatus: ok ? "00" : "02",
      vnp_TxnRef: txnRef,
    };
    const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
    const query = Object.keys(params)
      .sort()
      .map((k) => `${enc(k)}=${enc(params[k])}`)
      .join("&");
    const sig = crypto.createHmac("sha512", VNPAY_HASH_SECRET).update(Buffer.from(query, "utf-8")).digest("hex");
    return `${query}&vnp_SecureHash=${sig}`;
  }

  /** TEST FIXTURE: the gateway tells payment-service, through its real IPN route, that the payer paid. */
  async function gatewayIpn(txnId: string, amountVnd: number, ok = true) {
    const res = await fetch(`${payUrl}/payments/webhook/vnpay?${signedVnpayQuery(txnId, amountVnd, ok)}`);
    return (await res.json()) as { RspCode: string; Message: string };
  }

  /** Phase 3 / P3.7: one payment transaction exactly as payment-service stored it (independent raw read of its test DB). */
  async function payTxn(txnId: string) {
    const rows: any[] = await payDb.$queryRawUnsafe(
      `SELECT id, amount::text AS amount, status::text AS status, activation_status::text AS activation_status, purpose::text AS purpose,
              gym_id, pt_id, payer_id, pt_contract_id, related_entity_id, related_entity_type::text AS related_entity_type, metadata
         FROM payment_transactions WHERE id = $1`,
      txnId,
    );
    return rows[0]
      ? {
          id: rows[0].id as string,
          amount: num(rows[0].amount),
          status: rows[0].status as string,
          activationStatus: rows[0].activation_status as string,
          purpose: rows[0].purpose as string,
          gymId: rows[0].gym_id as string | null,
          ptId: rows[0].pt_id as string | null,
          payerId: rows[0].payer_id as string,
          relatedEntityId: rows[0].related_entity_id as string | null,
          relatedEntityType: rows[0].related_entity_type as string | null,
          metadata: rows[0].metadata as any,
        }
      : null;
  }
  /** Every payment transaction (any status) payment-service holds for one related entity (a contract id). */
  async function payTxnsFor(relatedEntityId: string) {
    const rows: any[] = await payDb.$queryRawUnsafe(
      "SELECT id, amount::text AS amount, status::text AS status FROM payment_transactions WHERE related_entity_id = $1 ORDER BY created_at",
      relatedEntityId,
    );
    return rows.map((r) => ({ id: r.id as string, amount: num(r.amount), status: r.status as string }));
  }

  // ── user-service over HTTP (real app) ──
  function tokenFor(id: string, role: string) {
    const token = `tok-${id}`;
    identities.set(token, { id, email: `${id}@test.local`, role });
    return token;
  }
  async function call(method: string, p: string, token: string | null, body?: unknown) {
    const res = await fetch(userUrl + p, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

  /** D77 follow-up (opt-in `paymentAuth`): a request to payment-service's gateway-facing routes as an ADMIN, over real HTTP. */
  async function adminCall(method: string, p: string) {
    const token = tokenFor(`admin-${crypto.randomUUID()}`, "ADMIN");
    const res = await fetch(payUrl + p, { method, headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  // ── fixtures ──
  const { prisma } = m;
  const created = { contracts: [] as string[], pts: [] as string[], extraUsers: [] as string[] };

  async function makePt() {
    const id = await m.base.makePt();
    await m.base.acceptCurrentPtTerms(id); // TEST FIXTURE: a PT who confirmed the current terms (D25) - the e2e flows accept contracts
    created.pts.push(id);
    return id;
  }

  /**
   * A contract the client really PAYS for: a PENDING_PAYMENT row (TEST FIXTURE) -> contractService.pay (real
   * user-service -> payment-service /internal/payments/checkout) -> the gateway IPN (TEST FIXTURE) -> payment-service
   * settles the ledger and calls user-service /internal/contracts/:id/activate-after-payment, which calls payment-service
   * back to verify the transaction (all real HTTP). Afterwards the contract is ACTIVE and carries the transaction id.
   */
  async function startCheckout(ptUserId: string, over: { price?: number; totalSessions?: number; packageName?: string; clientUserId?: string; gym?: GymTerms } = {}) {
    const price = over.price ?? 5_000_000;
    const row = await prisma.contract.create({
      data: {
        id: crypto.randomUUID(),
        ptUserId,
        clientUserId: over.clientUserId ?? crypto.randomUUID(),
        packageName: over.packageName ?? "Gói 10 buổi",
        totalSessions: over.totalSessions ?? 10,
        price,
        status: "PENDING_PAYMENT",
        paymentDueAt: new Date(Date.now() + 6 * HOUR),
        sessionDurationMinutes: 60,
        startDate: new Date(Date.now() - 10 * DAY),
        endDate: new Date(Date.now() + 60 * DAY),
        // rates are the schema defaults (platform 0.10 / PT 0.90 / gym 0; holdback 0 = off) unless `over.gym` makes it a gym contract
        // (TEST FIXTURE: the caller must also make gymClient.getActiveCollaboration answer these same rates - pay() re-checks them).
        ...(over.gym ? { gymId: over.gym.gymId, platformRate: over.gym.platformRate, ptRate: over.gym.ptRate, gymRate: over.gym.gymRate } : {}),
      },
    });
    created.contracts.push(row.id);
    const paid = await m.contractService.pay(row.id, row.clientUserId, "VNPAY", "web");
    return { row, price, txnId: paid.payment.transactionId as string };
  }

  async function paidContract(ptUserId: string, over: { price?: number; totalSessions?: number; packageName?: string; clientUserId?: string; gym?: GymTerms } = {}) {
    const { row, price, txnId } = await startCheckout(ptUserId, over);
    const ipn = await gatewayIpn(txnId, price);
    if (ipn.RspCode !== "00") throw new Error(`gateway IPN refused: ${JSON.stringify(ipn)}`);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: row.id } });
    if (after.status !== "ACTIVE" || after.paymentTransactionId !== txnId) {
      throw new Error(`contract ${row.id} not activated by its payment (status ${after.status}, txn ${after.paymentTransactionId} vs ${txnId}); payment-service log:
${log.slice(-15).join("")}`);
    }
    return { ...after, txnId, ptToken: tokenFor(ptUserId, "PT"), clientToken: tokenFor(after.clientUserId, "CUSTOMER") };
  }
  type Paid = Awaited<ReturnType<typeof paidContract>>;

  let sessionSeq = 0;
  /**
   * `n` sessions delivered and confirmed through the real endpoints: the session row is born CONFIRMED and already
   * over (TEST FIXTURE: there is no way to book in the past), then the PT reports it (PATCH /sessions/:id/complete)
   * and the client confirms (POST /sessions/:id/confirm) - the second call is what releases money.
   */
  async function deliver(c: Paid, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = await m.base.addSession(c, "CONFIRMED", new Date(Date.now() - (2 + ++sessionSeq) * DAY));
      const done = await call("PATCH", `/sessions/${s.id}/complete`, c.ptToken, { ptNotes: "ok" });
      if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${JSON.stringify(done.body)}`);
      const conf = await call("POST", `/sessions/${s.id}/confirm`, c.clientToken);
      if (conf.status !== 200) throw new Error(`client confirm failed: ${conf.status} ${JSON.stringify(conf.body)}`);
      ids.push(s.id);
    }
    return ids;
  }

  async function cleanup() {
    await prisma.pTAvailability.deleteMany({ where: { ptUserId: { in: created.pts } } }).catch(() => {});
    const sessionIds = (await prisma.session.findMany({ where: { contractId: { in: created.contracts } }, select: { id: true } })).map((s) => s.id);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: sessionIds } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: created.pts } } }).catch(() => {});
    const clients = (await prisma.contract.findMany({ where: { id: { in: created.contracts } }, select: { clientUserId: true } })).map((c) => c.clientUserId);
    await prisma.notification.deleteMany({ where: { userId: { in: clients } } }).catch(() => {});
    await m.base.cleanup(created.pts, created.contracts);
    created.contracts = [];
    created.pts = [];
  }

  async function close() {
    await stopPayment();
    process.off("exit", onExit);
    if (gymChild && gymChild.exitCode === null) {
      const g = gymChild;
      const exited = new Promise<void>((r) => g.once("exit", () => r()));
      killTree(g);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    }
    process.off("exit", onGymExit);
    restorePublish();
    restoreAuth();
    await stopUser();
    if (authFixture) await new Promise((r) => authFixture!.close(r));
    await payDb.$disconnect();
    await prisma.$disconnect();
  }

  return {
    m,
    payUrl,
    userUrl,
    /** URL of the real gym-service child (only when started with { gym }); otherwise the dead port. */
    gymUrl,
    gymLog: () => gymLog.join(""),
    secret: SECRET,
    stopUser,
    startUser,
    /** Independent raw reader of the isolated payment test DB (Phase 2 / P2.4 hashes ledger tables with it). */
    payDb,
    startPayment,
    stopPayment,
    paymentLog: () => log.join(""),
    resetPayment,
    wallet,
    revenue,
    escrow,
    entries,
    net,
    invariant,
    snapshot,
    gatewayIpn,
    payTxn,
    payTxnsFor,
    tokenFor,
    call,
    adminCall,
    makePt,
    startCheckout,
    paidContract,
    deliver,
    cleanup,
    close,
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;
export type PaidContract = Awaited<ReturnType<Harness["paidContract"]>>;
