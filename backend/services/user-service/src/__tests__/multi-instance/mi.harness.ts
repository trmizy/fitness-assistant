/**
 * TEST HARNESS (audit D57-1) - N real user-service OS processes + the REAL payment-service ledger, one shared Postgres.
 *
 * Evidence label of every suite built on this: BACKEND INTEGRATION (real ledger). What is real / fixture:
 *   REAL     N user-service processes (src/__tests__/multi-instance/instance-entry.ts -> the unchanged src/app.ts), each with
 *            its OWN PrismaClient pool, lock queue, holder semaphore and sweep `running` flags (separate Node processes);
 *            payment-service as its own process (real Express app, real ledger code); both on isolated *_mi_test databases;
 *            every user-service -> payment-service call is real HTTP, carried through a per-instance TCP-level proxy.
 *   FIXTURE  the proxy (records every money call and can hold a response / SIGKILL the instance once payment-service has
 *            answered); the contract row (inserted PENDING_PAYMENT, then really paid through POST /contracts/:id/pay + a
 *            signed gateway IPN); session rows inserted at the state a scenario starts from; auth-service replaced by a
 *            token table served over HTTP (so the instances still make a real verify call per request).
 *   NOT in the loop: the API gateway, browsers, a real payment gateway, auth/gym/chat services, any dev database.
 *
 * Kill on Windows: `taskkill /F` is TerminateProcess - no signal handler, no finally{}, sockets closed by the OS. That is
 * what SIGKILL does on Linux. The process dies exactly where it is.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { PrismaClient } from "../../generated/prisma";
import { databaseNameOf } from "../test-db-guard";

const PG = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433";
export const USER_DB_BASE = process.env.MI_USER_DATABASE_URL ?? `${PG}/gymcoach_user_mi_test?schema=public`;
export const PAY_DB_URL = process.env.MI_PAYMENT_DATABASE_URL ?? `${PG}/gymcoach_payment_mi_test?schema=public`;
export const usable = process.env.RUN_MULTI_INSTANCE === "1" && /_mi_test$/.test(databaseNameOf(USER_DB_BASE)) && /_mi_test$/.test(databaseNameOf(PAY_DB_URL));
export const skip = usable ? false : "Opt-in: RUN_MULTI_INSTANCE=1, and the databases must be the isolated *_mi_test ones. It TRUNCATEs both.";

const SECRET = `mi-internal-secret-${crypto.randomBytes(8).toString("hex")}`;
const VNPAY_TMN = "MITEST";
const VNPAY_HASH_SECRET = `mi-vnpay-hash-${crypto.randomBytes(8).toString("hex")}`;
const DEAD = "http://127.0.0.1:9";
const USER_DIR = path.resolve(__dirname, "../../..");
const PAYMENT_DIR = path.resolve(USER_DIR, "../payment-service");
export const DAY = 24 * 3600 * 1000;
export const HOUR = 3600 * 1000;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

export function killTree(child: ChildProcess | null) {
  if (!child || child.pid == null || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {
    try {
      child.kill();
    } catch {
      /* gone */
    }
  }
}

// ── the per-instance payment proxy ─────────────────────────────────────────────────────────────────────────────────

export interface PayCall {
  inst: number;
  method: string;
  path: string;
  key: string | null;
  status: number;
  at: number;
}
export interface Arm {
  /** which payment-service request this arm applies to (first match fires, once) */
  when: (path: string, body: any) => boolean;
  /** hold the request BEFORE forwarding it until this promise settles */
  holdBefore?: Promise<unknown>;
  /** runs after payment-service has answered (the ledger is already committed) and BEFORE the answer is returned */
  afterPayment?: () => void | Promise<void>;
  /** destroy the socket instead of returning the answer */
  dropResponse?: boolean;
}

class PayProxy {
  server!: http.Server;
  port = 0;
  calls: PayCall[] = [];
  private arms: Array<{ arm: Arm; fired: () => void }> = [];
  constructor(private readonly inst: number, private readonly target: () => string) {}
  async listen() {
    this.port = await freePort();
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(this.port, "127.0.0.1", () => r()));
  }
  url() {
    return `http://127.0.0.1:${this.port}`;
  }
  arm(arm: Arm): Promise<void> {
    let fired!: () => void;
    const p = new Promise<void>((r) => (fired = r));
    this.arms.push({ arm, fired });
    return p;
  }
  clearArms() {
    this.arms = [];
  }
  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    let body: any = null;
    try {
      body = raw.length ? JSON.parse(raw.toString("utf8")) : null;
    } catch {
      /* not json */
    }
    const url = req.url ?? "/";
    const idx = this.arms.findIndex((a) => a.arm.when(url, body));
    const armed = idx >= 0 ? this.arms.splice(idx, 1)[0] : null;
    if (armed?.arm.holdBefore) await armed.arm.holdBefore;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && !["host", "connection", "content-length"].includes(k)) headers[k] = v;
    let status = 502;
    let text = "";
    let ctype = "application/json";
    try {
      const r = await fetch(this.target() + url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : raw });
      status = r.status;
      text = await r.text();
      ctype = r.headers.get("content-type") ?? ctype;
    } catch (e) {
      text = JSON.stringify({ error: String((e as Error).message) });
    }
    this.calls.push({ inst: this.inst, method: req.method ?? "", path: url, key: body?.idempotencyKey ?? null, status, at: Date.now() });
    if (armed) {
      armed.fired();
      if (armed.arm.afterPayment) await armed.arm.afterPayment();
      if (armed.arm.dropResponse) return void req.socket.destroy();
    }
    res.writeHead(status, { "content-type": ctype });
    res.end(text);
  }
  async close() {
    (this.server as any)?.closeAllConnections?.();
    await new Promise((r) => this.server?.close(r));
  }
}

// ── an instance ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Instance {
  id: number;
  url: string;
  ctlUrl: string;
  proxy: PayProxy;
  pid: () => number | undefined;
  alive: () => boolean;
  log: () => string;
  start: (env?: Record<string, string>) => Promise<void>;
  kill: () => Promise<void>;
}

export async function startMi(opts: { instances: number; instanceEnv?: Record<string, string>; connectionLimit?: number }) {
  const payPort = await freePort();
  const payUrl = `http://127.0.0.1:${payPort}`;
  const connectionLimit = opts.connectionLimit ?? 8;
  const userDbUrl = `${USER_DB_BASE}&connection_limit=${connectionLimit}&pool_timeout=10`;

  // fake auth-service: token -> identity table, over HTTP
  const identities = new Map<string, { id: string; email: string; role: string }>();
  const authPort = await freePort();
  const authServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/auth/verify") {
      const tok = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
      const user = identities.get(tok);
      if (!user) {
        res.statusCode = 401;
        return void res.end(JSON.stringify({ error: "Invalid or expired token" }));
      }
      return void res.end(JSON.stringify({ user }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => authServer.listen(authPort, "127.0.0.1", () => r()));

  const prisma = new PrismaClient({ datasourceUrl: userDbUrl });
  const payDb = new PrismaClient({ datasourceUrl: PAY_DB_URL });

  // payment-service child
  let payChild: ChildProcess | null = null;
  let payLog: string[] = [];
  const instances: Instance[] = [];
  const onExit = () => {
    killTree(payChild);
    for (const i of instances) void i.kill();
  };
  process.on("exit", onExit);

  async function waitHealthy(url: string, getChild: () => ChildProcess | null, getLog: () => string[], timeoutMs = 90_000) {
    const t0 = Date.now();
    for (;;) {
      const c = getChild();
      if (c && c.exitCode !== null) throw new Error(`process exited early (${c.exitCode}):\n${getLog().slice(-30).join("")}`);
      try {
        const r = await fetch(url);
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`not healthy after ${timeoutMs}ms: ${url}\n${getLog().slice(-30).join("")}`);
      await sleep(250);
    }
  }

  async function startPayment() {
    if (payChild && payChild.exitCode === null) return;
    payLog = [];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(payPort),
      DATABASE_URL: PAY_DB_URL,
      INTERNAL_SERVICE_SECRET: SECRET,
      INTERNAL_API_SECRET: SECRET,
      USER_SERVICE_URL: instances[0]?.url ?? DEAD,
      GYM_SERVICE_URL: DEAD,
      AI_SERVICE_URL: DEAD,
      AUTH_SERVICE_URL: DEAD,
      USER_LAMBDA_NAME: "",
      GYM_LAMBDA_NAME: "",
      AI_LAMBDA_NAME: "",
      PAYMENT_PROVIDER: "VNPAY",
      VNPAY_TMN_CODE: VNPAY_TMN,
      VNPAY_HASH_SECRET: VNPAY_HASH_SECRET,
      VNPAY_SIMULATE: "false",
      FITNESS_DISABLE_REDIS: "true",
    };
    delete env.CONTRACT_CLIENT_CANCEL_REFUND_RATE;
    payChild = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: PAYMENT_DIR, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const keep = (b: Buffer) => {
      payLog.push(b.toString());
      if (payLog.length > 400) payLog.shift();
    };
    payChild.stdout!.on("data", keep);
    payChild.stderr!.on("data", keep);
    await waitHealthy(`${payUrl}/health`, () => payChild, () => payLog);
  }
  async function stopPayment() {
    const c = payChild;
    if (!c || c.exitCode !== null) return;
    const exited = new Promise<void>((r) => c.once("exit", () => r()));
    killTree(c);
    await Promise.race([exited, sleep(10_000)]);
  }

  // user-service instances
  for (let n = 0; n < opts.instances; n++) {
    const port = await freePort();
    const ctl = await freePort();
    const proxy = new PayProxy(n, () => payUrl);
    await proxy.listen();
    let child: ChildProcess | null = null;
    let log: string[] = [];
    const inst: Instance = {
      id: n,
      url: `http://127.0.0.1:${port}`,
      ctlUrl: `http://127.0.0.1:${ctl}`,
      proxy,
      pid: () => child?.pid,
      alive: () => !!child && child.exitCode === null,
      log: () => log.join(""),
      async start(extra = {}) {
        if (child && child.exitCode === null) return;
        log = [];
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          NODE_ENV: "test",
          PORT: String(port),
          CTL_PORT: String(ctl),
          DATABASE_URL: userDbUrl,
          PAYMENT_SERVICE_URL: proxy.url(),
          INTERNAL_SERVICE_SECRET: SECRET,
          INTERNAL_API_SECRET: SECRET,
          AUTH_SERVICE_URL: `http://127.0.0.1:${authPort}`,
          GYM_SERVICE_URL: DEAD,
          CHAT_SERVICE_URL: DEAD,
          AI_SERVICE_URL: DEAD,
          FITNESS_DISABLE_REDIS: "true",
          LOG_LEVEL: "warn",
          ...opts.instanceEnv,
          ...extra,
        };
        delete env.AUTH_LAMBDA_NAME;
        delete env.PAYMENT_LAMBDA_NAME;
        const entry = extra.MI_REAL_SERVER === "1" ? "src/server.ts" : "src/__tests__/multi-instance/instance-entry.ts";
        child = spawn(process.execPath, ["--import", "tsx", entry], { cwd: USER_DIR, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        const keep = (b: Buffer) => {
          log.push(b.toString());
          if (log.length > 600) log.shift();
        };
        child.stdout!.on("data", keep);
        child.stderr!.on("data", keep);
        const probe = extra.MI_REAL_SERVER === "1" ? `http://127.0.0.1:${port}/health` : `${inst.ctlUrl}/ctl/ping`;
        await waitHealthy(probe, () => child, () => log);
      },
      async kill() {
        const c = child;
        if (!c || c.exitCode !== null) return;
        const exited = new Promise<void>((r) => c.once("exit", () => r()));
        killTree(c);
        await Promise.race([exited, sleep(10_000)]);
      },
    };
    instances.push(inst);
  }
  await Promise.all(instances.map((i) => i.start()));
  await startPayment();

  const num = (v: unknown) => Number(v ?? 0);

  async function resetAll() {
    // DELETE (not TRUNCATE): TRUNCATE costs an fsync per table, which is slow on the shared, busy test container.
    // FK triggers are switched off for the transaction (the test role is a superuser) so row order does not matter.
    await payDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      for (const t of ["wallet_ledger_entries", "platform_commissions", "partner_receivables", "payment_transactions", "wallets", "ledger_operations"]) await tx.$executeRawUnsafe(`DELETE FROM ${t}`);
    });
    const t: any[] = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'");
    const probe = t.map((r) => `SELECT '${r.tablename}' AS t WHERE EXISTS (SELECT 1 FROM "${r.tablename}")`).join(" UNION ALL ");
    const filled: any[] = await prisma.$queryRawUnsafe(probe);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      for (const r of filled) await tx.$executeRawUnsafe(`DELETE FROM "${r.t}"`);
    });
    for (const i of instances) i.proxy.calls.length = 0;
  }

  type Wallet = { a: number; p: number; l: number };
  async function wallet(ownerType: string, ownerId: string): Promise<Wallet> {
    const rows: any[] = await payDb.$queryRawUnsafe(
      "SELECT available_balance::text AS a, pending_balance::text AS p, locked_balance::text AS l FROM wallets WHERE owner_type = $1::\"WalletOwnerType\" AND owner_id = $2",
      ownerType,
      ownerId,
    );
    return rows[0] ? { a: num(rows[0].a), p: num(rows[0].p), l: num(rows[0].l) } : { a: 0, p: 0, l: 0 };
  }
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
  async function net(txnId: string, ownerType: string, bucket: "PENDING" | "AVAILABLE" | "LOCKED", ownerId?: string) {
    return (await entries(txnId))
      .filter((e) => e.ownerType === ownerType && e.bucket === bucket && (ownerId === undefined || e.ownerId === ownerId))
      .reduce((s, e) => s + (e.type === "CREDIT" ? e.amount : -e.amount), 0);
  }
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
    const negative: any[] = await payDb.$queryRawUnsafe("SELECT owner_type::text, owner_id FROM wallets WHERE available_balance < 0 OR pending_balance < 0 OR locked_balance < 0");
    const drift = Math.round((escrowAvail - claims) * 100) / 100;
    if (drift !== 0 || negative.length > 0) {
      throw new Error(`Money invariant violated${context ? ` (${context})` : ""}: escrow=${escrowAvail} claims=${claims} drift=${drift} negative=${JSON.stringify(negative)}`);
    }
    return { escrow: escrowAvail, claims };
  }
  /** Count of ledger operations whose idempotency key matches (one row per executed business operation). */
  async function opCount(keyLike: string): Promise<number> {
    const r: any[] = await payDb.$queryRawUnsafe(`SELECT count(*)::text AS n FROM ledger_operations WHERE key LIKE $1`, keyLike);
    return num(r[0].n);
  }
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
    };
  }

  function signedVnpayQuery(txnRef: string, amountVnd: number): string {
    const params: Record<string, string> = {
      vnp_Amount: String(Math.round(amountVnd) * 100),
      vnp_BankCode: "NCB",
      vnp_ResponseCode: "00",
      vnp_TmnCode: VNPAY_TMN,
      vnp_TransactionNo: String(Math.floor(10_000_000 + Math.random() * 89_999_999)),
      vnp_TransactionStatus: "00",
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
  async function gatewayIpn(txnId: string, amountVnd: number) {
    const res = await fetch(`${payUrl}/payments/webhook/vnpay?${signedVnpayQuery(txnId, amountVnd)}`);
    return (await res.json()) as { RspCode: string; Message: string };
  }

  function tokenFor(id: string, role: string) {
    const token = `tok-${id}`;
    identities.set(token, { id, email: `${id}@test.local`, role });
    return token;
  }
  /** One business request against ONE specific instance. */
  async function call(inst: number, method: string, p: string, token: string | null, body?: unknown) {
    const t0 = Date.now();
    try {
      const res = await fetch(instances[inst].url + p, {
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
      return { status: res.status, body: json, ms: Date.now() - t0 };
    } catch (e) {
      return { status: 0, body: { error: String((e as Error).message) }, ms: Date.now() - t0 };
    }
  }
  /** Run a sweep on an instance at a given instant (barrier). */
  async function job(inst: number, name: string, at = 0) {
    const res = await fetch(`${instances[inst].ctlUrl}/ctl/job?name=${name}&at=${at}`, { method: "POST" });
    return (await res.json()) as { pid: number; startedAt: number; endedAt: number; result: any; error?: string };
  }

  // ── fixtures ──
  async function makePt() {
    const userId = crypto.randomUUID();
    await prisma.userProfile.create({ data: { userId, isPT: true } });
    return userId;
  }
  async function paidContract(ptUserId: string, over: { price?: number; totalSessions?: number; packageName?: string; endDate?: Date } = {}) {
    const price = over.price ?? 5_000_000;
    const row = await prisma.contract.create({
      data: {
        id: crypto.randomUUID(),
        ptUserId,
        clientUserId: crypto.randomUUID(),
        packageName: over.packageName ?? "Gói 10 buổi",
        totalSessions: over.totalSessions ?? 10,
        price,
        status: "PENDING_PAYMENT",
        paymentDueAt: new Date(Date.now() + 6 * HOUR),
        sessionDurationMinutes: 60,
        startDate: new Date(Date.now() - 10 * DAY),
        endDate: over.endDate ?? new Date(Date.now() + 60 * DAY),
      },
    });
    const clientToken = tokenFor(row.clientUserId, "CUSTOMER");
    const paid = await call(0, "POST", `/contracts/${row.id}/pay`, clientToken, { provider: "VNPAY" });
    if (paid.status !== 200) throw new Error(`pay failed ${paid.status} ${JSON.stringify(paid.body)}`);
    const txnId = paid.body.payment.transactionId as string;
    const ipn = await gatewayIpn(txnId, price);
    if (ipn.RspCode !== "00") throw new Error(`IPN refused ${JSON.stringify(ipn)}`);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: row.id } });
    if (after.status !== "ACTIVE" || after.paymentTransactionId !== txnId) throw new Error(`not activated: ${after.status} ${after.paymentTransactionId} vs ${txnId}\n${payLog.slice(-10).join("")}`);
    return { ...after, txnId, ptToken: tokenFor(ptUserId, "PT"), clientToken };
  }
  type Paid = Awaited<ReturnType<typeof paidContract>>;
  async function addSession(c: { id: string; ptUserId: string; clientUserId: string }, status: string, start: Date, extra: Record<string, unknown> = {}) {
    return prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        contractId: c.id,
        ptUserId: c.ptUserId,
        clientUserId: c.clientUserId,
        status: status as any,
        scheduledStartAt: start,
        scheduledEndAt: new Date(start.getTime() + HOUR),
        ...extra,
      },
    });
  }
  let seq = 0;
  /** n sessions delivered through the real endpoints, each step on a DIFFERENT instance (round robin). */
  async function deliver(c: Paid, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = await addSession(c, "CONFIRMED", new Date(Date.now() - (2 + ++seq) * DAY));
      const done = await call(seq % instances.length, "PATCH", `/sessions/${s.id}/complete`, c.ptToken, { ptNotes: "ok" });
      if (done.status !== 200) throw new Error(`complete failed ${done.status} ${JSON.stringify(done.body)}`);
      const conf = await call((seq + 1) % instances.length, "POST", `/sessions/${s.id}/confirm`, c.clientToken);
      if (conf.status !== 200) throw new Error(`confirm failed ${conf.status} ${JSON.stringify(conf.body)}`);
      ids.push(s.id);
    }
    return ids;
  }
  const sessionRow = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
  const contractRow = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id } });

  /** Postgres advisory locks currently held, as pg_locks sees them (objid = hashtext key). */
  async function advisoryLocks(): Promise<number[]> {
    const rows: any[] = await prisma.$queryRawUnsafe("SELECT objid::bigint::text AS k FROM pg_locks WHERE locktype='advisory' AND granted");
    return rows.map((r) => Number(r.k));
  }
  async function hashOf(s: string): Promise<number> {
    const rows: any[] = await prisma.$queryRawUnsafe("SELECT (hashtext($1))::bigint::text AS h", s);
    return Number(rows[0].h);
  }

  async function close() {
    process.off("exit", onExit);
    for (const i of instances) {
      await i.kill();
      await i.proxy.close();
    }
    await stopPayment();
    authServer.closeAllConnections?.();
    await new Promise((r) => authServer.close(r));
    await payDb.$disconnect();
    await prisma.$disconnect();
  }

  return {
    instances,
    prisma,
    payDb,
    payUrl,
    userDbUrl,
    startPayment,
    stopPayment,
    paymentLog: () => payLog.join(""),
    resetAll,
    wallet,
    entries,
    net,
    invariant,
    opCount,
    snapshot,
    gatewayIpn,
    tokenFor,
    call,
    job,
    makePt,
    paidContract,
    addSession,
    deliver,
    sessionRow,
    contractRow,
    advisoryLocks,
    hashOf,
    close,
  };
}

export type Mi = Awaited<ReturnType<typeof startMi>>;
export type PaidContract = Awaited<ReturnType<Mi["paidContract"]>>;
