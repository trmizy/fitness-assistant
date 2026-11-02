/**
 * DISPUTE CASE slice 1 hardening - the same gateway security checks with the REAL auth-service.
 *
 * Evidence labels:
 *   REAL AUTH        the real auth-service (child process, `tsx src/server.ts`) on its OWN isolated *_test database (AUTH_TEST_DATABASE_URL, same
 *                    allowlist validator as the user DB), real bcrypt login (POST /auth/login), real JWTs verified by the real POST /auth/verify.
 *   REAL HTTP        real gateway app (in-process) -> real user-service app (in-process) over real sockets.
 *   MOCKED DEPENDENCY paymentClient (read-only ledger lookup only).
 *   BACKEND INTEGRATION the user DB is the isolated TEST_DATABASE_URL.
 * Nothing here is a browser test. Skipped (not faked) unless BOTH TEST_DATABASE_URL and AUTH_TEST_DATABASE_URL pass the validator.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { validateTestDatabaseUrl, identityOf } from "./setup/db-isolation-validator";
import { usable } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
// Slice 2 / S2.3: this suite must not open sockets to chat-service / gym-service; the collector keeps its Slice 1 placeholders here.
process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED ??= "true";

const AUTH_URL_DB = process.env.AUTH_TEST_DATABASE_URL;
const authVerdict = validateTestDatabaseUrl(AUTH_URL_DB);
const sameDb = !!AUTH_URL_DB && identityOf(AUTH_URL_DB) === identityOf(process.env.DATABASE_URL ?? "");
const skip: string | false = usable && authVerdict.ok && !sameDb ? false : "needs TEST_DATABASE_URL and a different, valid AUTH_TEST_DATABASE_URL (localhost:55433, user gymcoach_test, name ending _test)";

const AUTH_ROOT = join(__dirname, "..", "..", "..", "auth-service");
const JWT_SECRET = "real-auth-test-jwt-secret-0123456789abcdef";
const INTERNAL = "real-auth-test-internal-secret-0123456789abcdef";
const PASSWORD = "Test@123456";
process.env.NODE_ENV = "test";
process.env.INTERNAL_SERVICE_SECRET = INTERNAL;
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";

let authChild: ChildProcess | null = null;
let userServer: http.Server;
let gwServer: http.Server;
let gw = "";
let direct = "";
const seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
const createdContracts: string[] = [];
const users: Record<string, { id: string; email: string; token: string }> = {};
const T = (k: string) => users[k].token;

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
const run = (cmd: string, args: string[], env: Record<string, string>, cwd = AUTH_ROOT) =>
  spawnSync(cmd, args, { cwd, env: { ...process.env, ...env } as NodeJS.ProcessEnv, encoding: "utf8", shell: cmd === "npx" && process.platform === "win32", timeout: 180_000 });

test.before(async () => {
  if (skip) return;
  const dbEnv = { DATABASE_URL: AUTH_URL_DB! };
  const mig = run("npx", ["prisma", "migrate", "deploy"], dbEnv);
  assert.equal(mig.status, 0, `auth migrate deploy: ${mig.stdout?.slice(-300)} ${mig.stderr?.slice(-300)}`);

  // Seed users through the auth DB (bcryptjs hash, same as the real register path).
  const seedUsers = ["ADMIN:admin", "ADMIN:admin2", "CUSTOMER:clientA", "PT:ptA", "CUSTOMER:clientB", "PT:ptB", "CUSTOMER:stranger"].map((s) => {
    const [role, key] = s.split(":");
    return { key, role, id: randomUUID(), email: `${key}.${randomUUID().slice(0, 6)}@real-auth.test` };
  });
  const seedScript = `
    const bcrypt = require("bcryptjs");
    const { PrismaClient } = require("./src/generated/prisma");
    (async () => {
      const p = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      const hash = await bcrypt.hash(${JSON.stringify(PASSWORD)}, 4);
      for (const u of ${JSON.stringify(seedUsers)}) await p.user.create({ data: { id: u.id, email: u.email, password: hash, role: u.role, firstName: u.key } });
      await p.$disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });`;
  const seed = run(process.execPath, ["-e", seedScript], dbEnv);
  assert.equal(seed.status, 0, `seed: ${seed.stderr?.slice(-400)}`);

  // Real auth-service as a child process.
  const port = 20000 + Math.floor(Math.random() * 20000);
  authChild = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: AUTH_ROOT,
    env: { ...process.env, DATABASE_URL: AUTH_URL_DB!, PORT: String(port), JWT_SECRET, JWT_REFRESH_SECRET: JWT_SECRET + "-refresh", INTERNAL_SERVICE_SECRET: INTERNAL, NODE_ENV: "test", USER_SERVICE_URL: "http://127.0.0.1:1" } as NodeJS.ProcessEnv,
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.env.AUTH_SERVICE_URL = base;
  for (const u of seedUsers) {
    const res = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, password: PASSWORD }) });
    const j: any = await res.json();
    const token = j.accessToken ?? j.data?.accessToken;
    assert.ok(res.status === 200 && token, `real login of ${u.key}: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
    users[u.key] = { id: u.id, email: u.email, token };
  }

  for (const name of Object.keys(paymentClient)) {
    (paymentClient as any)[name] = name === "lookupLedgerOperation" ? async () => null : async () => { throw new Error(`MONEY WRITE FROM CASE CODE: ${name}`); };
  }
  const { default: userApp } = await import("../app");
  userServer = http.createServer((req, res) => {
    seen.push({ url: String(req.url), headers: { ...req.headers } });
    userApp(req, res);
  });
  direct = `http://127.0.0.1:${await listen(userServer)}`;
  process.env.USER_SERVICE_URL = direct;
  const mod: any = await import(pathToFileURL(join(__dirname, "..", "..", "..", "..", "gateway", "src", "app.ts")).href);
  gwServer = http.createServer(mod.default?.default ?? mod.default);
  gw = `http://127.0.0.1:${await listen(gwServer)}`;
});

test.after(async () => {
  if (authChild) authChild.kill();
  for (const s of [gwServer, userServer]) await new Promise((r) => s?.close(r));
  if (!skip) {
    const { prisma } = await import("../repositories/profile.repository");
    if (createdContracts.length) {
      await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } });
    }
    await prisma.$disconnect();
  }
});

async function call(base: string, method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  return { status: res.status, json, text };
}

test("REAL AUTH: tokens come from the real auth-service; unauthenticated, tampered and spoofed requests are refused; roles are enforced", { skip }, async () => {
  const spoof = { "x-user-id": users.admin.id, "x-user-role": "ADMIN", "x-gateway-secret": "guess" };
  for (const base of [gw, direct]) {
    assert.equal((await call(base, "GET", "/admin/dispute-cases", null)).status, 401);
    assert.equal((await call(base, "GET", "/admin/dispute-cases", null, undefined, spoof)).status, 401);
    assert.equal((await call(base, "GET", "/dispute-cases", "not.a.jwt", undefined, spoof)).status, 401);
    const [h, p, s] = T("clientA").split(".");
    assert.equal((await call(base, "GET", "/dispute-cases", `${h}.${p}.${s.slice(0, -2)}xx`)).status, 401, "tampered real token");
  }
  // a real CUSTOMER / PT token on an admin route: 403 (gateway); with spoofed ADMIN headers: still 403; straight at user-service: still 403
  for (const k of ["clientA", "ptA"]) {
    assert.equal((await call(gw, "GET", "/admin/dispute-cases", T(k), undefined, spoof)).status, 403);
    assert.equal((await call(direct, "GET", "/admin/dispute-cases", T(k), undefined, spoof)).status, 403);
    assert.equal((await call(gw, "POST", "/admin/dispute-cases", T(k), { sessionId: "x" })).status, 403);
  }
  // identity the gateway hands to user-service is rebuilt from the REAL verification, not from the request
  seen.length = 0;
  await call(gw, "GET", "/dispute-cases", T("clientA"), undefined, spoof);
  const hit = seen.find((s) => s.url.startsWith("/dispute-cases"))!;
  assert.equal(hit.headers["x-user-id"], users.clientA.id);
  assert.equal(hit.headers["x-user-role"], "CUSTOMER");
  assert.equal(hit.headers["x-gateway-secret"], INTERNAL);
});

test("REAL AUTH + DB: a real client / PT of case A cannot reach case B and vice versa; the other side never sees a self-submitted document; admin sees it labelled", { skip }, async () => {
  const { addSession, makeContract } = await import("./pt-restriction.test-helpers");
  const { prisma } = await import("../repositories/profile.repository");
  const { disputeCaseService: svc } = await import("../services/dispute-case/dispute-case.service");
  const mk = async (client: string, pt: string) => {
    const contract = await makeContract(users[pt].id, { clientUserId: users[client].id, sessionMode: "ONLINE" });
    createdContracts.push(contract.id);
    const session = await addSession(contract, "DISPUTED", new Date(Date.now() - 3 * 3600_000), { sessionMode: "ONLINE", disputeType: "DELIVERY_DISPUTE", disputedAt: new Date(), disputeReason: "RA-LY-DO-A", ptNotes: "RA-GHI-CHU-PT" });
    return svc.openCase({ id: users.admin.id, role: "ADMIN" }, session.id);
  };
  const caseA = (await mk("clientA", "ptA")).result.case.id;
  const caseB = (await mk("clientB", "ptB")).result.case.id;
  const adm = { id: users.admin.id, role: "ADMIN" };
  await svc.assign(adm, caseA, undefined);
  await svc.transition(adm, caseA, "COLLECTING", {});

  for (const k of ["clientB", "ptB", "stranger"]) {
    assert.equal((await call(gw, "GET", `/dispute-cases/${caseA}`, T(k))).status, 404, k);
    assert.equal((await call(gw, "POST", `/dispute-cases/${caseA}/statements`, T(k), { text: "x" })).status, 404, k);
    assert.ok(!(await call(gw, "GET", "/dispute-cases", T(k))).text.includes(caseA), k);
  }
  assert.equal((await call(gw, "GET", `/dispute-cases/${caseB}`, T("clientA"))).status, 404);
  assert.equal((await call(gw, "GET", `/dispute-cases/${caseB}`, T("ptA"))).status, 404);

  const c = await call(gw, "POST", `/dispute-cases/${caseA}/evidence`, T("clientA"), { description: "REAL-BI-MAT-KHACH", sha256: "ab".repeat(32) });
  const p = await call(gw, "POST", `/dispute-cases/${caseA}/evidence`, T("ptA"), { description: "REAL-BI-MAT-PT", sha256: "cd".repeat(32) });
  assert.equal(c.status, 201);
  assert.equal(p.status, 201);
  const cv = await call(gw, "GET", `/dispute-cases/${caseA}`, T("clientA"));
  const pv = await call(gw, "GET", `/dispute-cases/${caseA}`, T("ptA"));
  assert.ok(cv.text.includes("REAL-BI-MAT-KHACH") && !cv.text.includes("REAL-BI-MAT-PT") && !cv.text.includes("cd".repeat(32)));
  assert.ok(pv.text.includes("REAL-BI-MAT-PT") && !pv.text.includes("REAL-BI-MAT-KHACH") && !pv.text.includes("ab".repeat(32)));
  assert.equal((await call(gw, "POST", `/admin/dispute-cases/${caseA}/shares`, T("admin"), { evidenceId: c.json.id, sharedWithRole: "PT", reason: "thử" })).json.code, "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED");
  const admin = await call(gw, "GET", `/admin/dispute-cases/${caseA}`, T("admin"));
  assert.equal(admin.status, 200);
  assert.equal(admin.json.evidence.filter((e: any) => e.verificationStatus === "CLIENT_CLAIMED_UNVERIFIED").length, 2);
  const logs = await prisma.disputeCaseAccessLog.findMany({ where: { caseId: caseA, viewerUserId: users.clientA.id } });
  assert.ok(logs.length > 0 && logs.every((l) => l.viewerRole === "CUSTOMER"));
});
