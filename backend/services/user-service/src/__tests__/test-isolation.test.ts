/**
 * Test isolation PROOF (Slice 2 safety round) - DB variables, Prisma CLI wrapper, outbound guard. REAL child processes (node + tsx + the real preload + the
 * real clients). The "dev" a refused action would have reached is a FAKE listener on a random loopback port that this test opens and counts connections on:
 * the real dev stack (3000-3010, 5432, 5433, 6379, 9000) is never contacted. Targets that are dev ports are proved with a spy in place of the socket
 * connect, so a broken guard would be seen as a spy call, not as a request to the dev stack.
 *
 * This file is the same in user-service, chat-service and gym-service except the CONFIG block.
 */
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { plan, dbVarsOfSchema, EXIT_REFUSED } from "./setup/db-cli-plan";
import { REFUSED_SENTINEL_URL, readDotenvDbUrls } from "./setup/db-isolation-validator";
import { BLOCKED_PORTS, checkOutbound, registerTestService } from "./setup/outbound-guard";

// ═══ CONFIG (the only part that differs between services) ══════════════════════════════════════════════════════════════
const SERVICE = "user-service";
const EXPECTED_DB_VARS = ["DATABASE_URL"];
/** Real default clients: each call must be refused by the guard (the call's own outcome does not matter). */
const PROBES: Array<{ name: string; code: string }> = [
  { name: "paymentClient.lookupLedgerOperation", code: `await require("./src/clients/payment.client").paymentClient.lookupLedgerOperation("k")` },
  { name: "authServiceClient.verifyToken", code: `await require("./src/clients/auth-service.client").authServiceClient.verifyToken("Bearer x")` },
  { name: "gymClient.getActiveCollaboration", code: `await require("./src/clients/gym.client").gymClient.getActiveCollaboration("g", "p")` },
  { name: "disputeEvidenceClient.getCallSessions", code: `await require("./src/clients/dispute-evidence.client").disputeEvidenceClient.getCallSessions("11111111-1111-4111-8111-111111111111")` },
  { name: "endOpenRoomCall (chat push)", code: `require("./src/services/open-room-call.service").endOpenRoomCall("s", "r"); await new Promise((r) => setTimeout(r, 300))` },
];
/** Env var the FIRST probe's client reads, used to point it at the fake listener. */
const FIRST_PROBE_URL_VAR = "PAYMENT_SERVICE_URL";
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const ROOT = join(__dirname, "..", "..");
const PRELOAD = pathToFileURL(join(__dirname, "setup", "db-isolation.ts")).href;
const GOOD = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_isolation_proof_test?schema=public";
const DEV = "postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_user?schema=public";
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");

function run(code: string, env: Record<string, string | undefined>, opts: { preload?: boolean; timeoutMs?: number } = {}) {
  const base: Record<string, string | undefined> = { ...process.env, DB_ISOLATION_QUIET: "1" };
  for (const k of ["DATABASE_URL", "CHAT_DATABASE_URL", "TEST_DATABASE_URL", "DB_ISOLATION", "TEST_ALLOWED_SERVICE_URLS", "AUTH_SERVICE_URL", "USER_SERVICE_URL", "CHAT_SERVICE_URL", "GYM_SERVICE_URL", "PAYMENT_SERVICE_URL", "AI_SERVICE_URL"]) delete base[k];
  const merged: Record<string, string | undefined> = { ...base, ...env };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  const args = ["--import", "tsx", ...(opts.preload === false ? [] : ["--import", PRELOAD]), "--eval", code];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env: merged as NodeJS.ProcessEnv, encoding: "utf8", timeout: opts.timeoutMs ?? 90_000 });
  return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
const lastJson = (out: string) => JSON.parse(out.split(/\r?\n/).reverse().find((l) => l.startsWith("{") || l.startsWith("["))!);

/** A fake "dev service": accepts TCP connections, counts them, answers nothing. */
async function fakeDev() {
  let connections = 0;
  const server = net.createServer((s) => {
    connections++;
    s.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return { port, url: `http://127.0.0.1:${port}`, count: () => connections, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// ── 1. DB variables ─────────────────────────────────────────────────────────────────────────────────────────────────────
test(`[${SERVICE}] the preload covers EVERY DB variable the Prisma schema names`, () => {
  const preload = readFileSync(join(__dirname, "setup", "db-isolation.ts"), "utf8");
  const listed = /DB_ENV_VARS: readonly string\[\] = \[([^\]]*)\]/.exec(preload)![1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
  assert.deepEqual([...listed].sort(), [...EXPECTED_DB_VARS].sort());
  for (const v of dbVarsOfSchema(SCHEMA)) assert.ok(listed.includes(v), `schema variable ${v} is not covered by the preload`);
});

test(`[${SERVICE}] every DB variable is the sentinel when TEST_DATABASE_URL is unset / dev / wrong / the .env URL - and a DB variable set by hand is ignored`, () => {
  const report = `console.log(JSON.stringify({ iso: process.env.DB_ISOLATION, vars: ${JSON.stringify(EXPECTED_DB_VARS)}.map((n) => process.env[n]) }));`;
  const envUrls = readDotenvDbUrls();
  const bad: Array<[string, Record<string, string | undefined>]> = [
    ["unset", {}],
    ["dev :5433", { TEST_DATABASE_URL: DEV }],
    ["dev role on 55433", { TEST_DATABASE_URL: "postgresql://gymcoach:gymcoach_password@localhost:55433/x_test" }],
    ["foreign host", { TEST_DATABASE_URL: "postgresql://gymcoach_test:p@db.example.com:55433/x_test" }],
    ["wrong port", { TEST_DATABASE_URL: "postgresql://gymcoach_test:p@localhost:5432/x_test" }],
    ["name without _test", { TEST_DATABASE_URL: "postgresql://gymcoach_test:p@localhost:55433/gymcoach_user" }],
    ["only the schema variable set by hand to dev", { [EXPECTED_DB_VARS[0]]: DEV }],
    ["only a DB variable set by hand to a good-looking URL", { [EXPECTED_DB_VARS[0]]: GOOD }],
    ...envUrls.map((u): [string, Record<string, string | undefined>] => [".env URL", { TEST_DATABASE_URL: u }]),
  ];
  for (const [label, env] of bad) {
    const info = lastJson(run(report, env).out);
    assert.equal(info.iso, "refused", label);
    for (const v of info.vars) assert.equal(v, REFUSED_SENTINEL_URL, `${label}: a DB variable is not the sentinel`);
  }
  const ok = lastJson(run(report, { TEST_DATABASE_URL: GOOD }).out);
  assert.equal(ok.iso, "accepted");
  for (const v of ok.vars) assert.equal(v, GOOD, "all DB variables carry the validated URL");
});

// ── 2. Prisma CLI wrapper ───────────────────────────────────────────────────────────────────────────────────────────────
test(`[${SERVICE}] Prisma CLI wrapper: dev / wrong / missing URL, a dev value in ANY schema variable, a forbidden subcommand -> exit ${EXIT_REFUSED}, prisma is NOT started, 0 connections to the fake dev listener`, async () => {
  const dev = await fakeDev();
  try {
    const fakeUrl = `postgresql://gymcoach_test:x@127.0.0.1:${dev.port}/proof_test?schema=public`; // right role + _test name, but not port 55433
    const cases: Array<[string, string[], Record<string, string | undefined>]> = [
      ["no URL at all", ["migrate", "deploy"], {}],
      ["URL pointing at the fake dev listener (wrong port)", ["migrate", "deploy"], { TEST_DATABASE_URL: fakeUrl }],
      ["real dev URL shape", ["db", "push"], { TEST_DATABASE_URL: DEV }],
      ["a schema variable set to dev while TEST_DATABASE_URL is good", ["migrate", "status"], { TEST_DATABASE_URL: GOOD, [EXPECTED_DB_VARS[EXPECTED_DB_VARS.length - 1]]: fakeUrl }],
      ["migrate dev is not allowed", ["migrate", "dev"], { TEST_DATABASE_URL: GOOD }],
      ["migrate reset is not allowed", ["migrate", "reset"], { TEST_DATABASE_URL: GOOD }],
      ["db execute is not allowed", ["db", "execute"], { TEST_DATABASE_URL: GOOD }],
      ["studio is not allowed", ["studio"], { TEST_DATABASE_URL: GOOD }],
      ["db push --force-reset is not allowed", ["db", "push", "--force-reset"], { TEST_DATABASE_URL: GOOD }],
      ["diff with a dev --from-url", ["migrate", "diff", "--from-url", fakeUrl, "--to-schema-datamodel", "prisma/schema.prisma"], { TEST_DATABASE_URL: GOOD }],
      ["a bare URL argument", ["migrate", "diff", DEV], { TEST_DATABASE_URL: GOOD }],
    ];
    for (const [label, args, env] of cases) {
      const base: Record<string, string | undefined> = { ...process.env };
      for (const k of ["DATABASE_URL", "CHAT_DATABASE_URL", "TEST_DATABASE_URL"]) delete base[k];
      const merged = { ...base, ...env } as NodeJS.ProcessEnv;
      const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/test-db-cli.ts", ...args], { cwd: ROOT, env: merged, encoding: "utf8", timeout: 90_000 });
      assert.equal(r.status, EXIT_REFUSED, `${label}: exit ${r.status} ${r.stderr.slice(0, 200)}`);
      assert.match(r.stderr, /REFUSED \(prisma not started\)/, label);
      assert.equal(r.stderr.includes("gymcoach_password") || r.stderr.includes(":x@"), false, `${label}: no credentials in the output`);
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(dev.count(), 0, "not one connection reached the fake dev listener");
  } finally {
    await dev.close();
  }
});

test(`[${SERVICE}] Prisma CLI wrapper plan(): a valid test URL becomes EVERY schema variable and nothing else survives; generate carries no DB variable`, () => {
  const vars = dbVarsOfSchema(SCHEMA);
  assert.ok(vars.length >= 1);
  const p = plan(["migrate", "deploy"], { TEST_DATABASE_URL: GOOD, PATH: "x" }, SCHEMA, []);
  assert.equal(p.ok, true);
  if (p.ok) {
    for (const v of vars) assert.equal(p.childEnv[v], GOOD);
    for (const v of ["DATABASE_URL", "CHAT_DATABASE_URL"]) assert.equal(p.childEnv[v], GOOD, `${v} carries the validated URL too, never a dev value`);
    assert.deepEqual(p.prismaArgs, ["migrate", "deploy"]);
  }
  const g = plan(["generate"], { DATABASE_URL: DEV, CHAT_DATABASE_URL: DEV }, SCHEMA, []);
  assert.equal(g.ok, true);
  if (g.ok) for (const v of ["DATABASE_URL", "CHAT_DATABASE_URL", ...vars]) assert.equal(g.childEnv[v], undefined);
  const d = plan(["migrate", "diff", "--from-url", GOOD, "--to-schema-datamodel", "prisma/schema.prisma"], { TEST_DATABASE_URL: GOOD }, SCHEMA, []);
  assert.equal(d.ok, true);
  assert.equal(plan(["migrate", "deploy"], { TEST_DATABASE_URL: GOOD, [vars[0]]: DEV }, SCHEMA, []).ok, false, "a dev value in a schema variable is refused even if TEST_DATABASE_URL is good");
});

// ── 3. outbound guard ────────────────────────────────────────────────────────────────────────────────────────────────────
test(`[${SERVICE}] outbound rules (pure): dev ports and non-loopback hosts are refused even when registered; an unregistered loopback port is refused; a registered one passes`, () => {
  for (const port of BLOCKED_PORTS) {
    assert.ok(checkOutbound("localhost", port), `localhost:${port}`);
    assert.ok(checkOutbound("127.0.0.1", port));
  }
  assert.equal(checkOutbound("localhost", 55433), null, "the isolated test postgres is reachable from a test (pg client); 5432 / 5433 are not");
  assert.ok(checkOutbound("localhost", 5433) && checkOutbound("localhost", 5432));
  assert.deepEqual([...BLOCKED_PORTS].sort((a, b) => a - b), [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 5432, 5433, 6379, 9000, 9001]);
  for (const host of ["example.com", "10.0.0.5", "api.vnpay.vn", "s3.amazonaws.com", "gymini-prod.internal", "postgres", "chat-service"]) assert.ok(checkOutbound(host, 8080), host);
  assert.throws(() => registerTestService("http://localhost:3007"), /dev-stack port/);
  assert.throws(() => registerTestService("http://example.com:8080"), /not a loopback/);
  assert.ok(checkOutbound("127.0.0.1", 45871), "unregistered");
  registerTestService("http://127.0.0.1:45871");
  assert.equal(checkOutbound("localhost", 45871), null, "registered (loopback aliases are the same host)");
  assert.ok(checkOutbound("127.0.0.1", 45872));
  process.env.TEST_ALLOWED_SERVICE_URLS = "http://127.0.0.1:45873, http://localhost:3007";
  try {
    assert.equal(checkOutbound("127.0.0.1", 45873), null, "env list");
    assert.ok(checkOutbound("localhost", 3007), "a dev port in the env list is still refused");
  } finally {
    delete process.env.TEST_ALLOWED_SERVICE_URLS;
  }
});

test(`[${SERVICE}] the guard really sits under fetch, http.get, axios and net.connect: dev ports / foreign hosts / unregistered ports -> OUTBOUND_BLOCKED_IN_TEST and the underlying connect is NEVER called`, () => {
  const probe = `
const guard = require("./src/__tests__/setup/outbound-guard");
const net = require("node:net"); const http = require("node:http");
const underlyingPorts = [];
guard.__setUnderlyingConnect(function (...a) { let o = Array.isArray(a[0]) ? a[0][0] : a[0]; underlyingPorts.push(Number(o && typeof o === "object" ? o.port : o)); throw new Error("UNDERLYING CONNECT REACHED"); });
const axios = require("axios");
const targets = [];
for (const p of ${JSON.stringify([3000, 3004, 3007, 3010, 5432, 5433, 6379, 9000, 9001])}) targets.push("http://localhost:" + p + "/x", "http://127.0.0.1:" + p + "/x");
targets.push("https://api.vnpay.vn/x", "http://10.1.2.3:8080/x", "http://chat-service:3005/x", "http://127.0.0.1:9/x", "http://127.0.0.1:45999/x");
(async () => {
  const res = [];
  for (const t of targets) {
    const row = { t, fetch: null, http: null, axios: null, net: null };
    try { await fetch(t); row.fetch = "NO ERROR"; } catch (e) { row.fetch = e.code || String(e.cause && e.cause.code) || e.message.slice(0, 60); }
    try { await new Promise((ok, no) => { const r = http.get(t, ok); r.on("error", no); }); row.http = "NO ERROR"; } catch (e) { row.http = e.code || e.message.slice(0, 60); }
    try { await axios.get(t, { timeout: 2000 }); row.axios = "NO ERROR"; } catch (e) { row.axios = e.code === "OUTBOUND_BLOCKED_IN_TEST" || /OUTBOUND_BLOCKED_IN_TEST/.test(e.message) ? "OUTBOUND_BLOCKED_IN_TEST" : (e.code || e.message.slice(0, 60)); }
    try { const u = new URL(t); await new Promise((ok, no) => { const s = net.connect(Number(u.port), u.hostname); s.on("connect", ok); s.on("error", no); }); row.net = "NO ERROR"; } catch (e) { row.net = e.code || e.message.slice(0, 60); }
    res.push(row);
  }
  console.log(JSON.stringify({ underlyingPorts, blocked: guard.blockedAttempts().length, res }));
})();
`;
  // every dev port is even WHITELISTED in the env list: it must still be refused
  const allowAll = [3000, 3004, 3007, 3010, 5432, 5433, 6379, 9000, 9001].map((p) => `http://127.0.0.1:${p}`).join(",") + ",http://127.0.0.1:9,http://127.0.0.1:45999";
  const r = run(probe, { TEST_ALLOWED_SERVICE_URLS: allowAll });
  const info = lastJson(r.out);
  assert.ok(info.underlyingPorts.every((p: number) => p === 9 || p === 45999), `the real socket connect was reached only for the two registered non-dev ports, got ${info.underlyingPorts}`);
  assert.ok(info.underlyingPorts.length >= 1, "sanity: a registered target does reach the underlying connect");
  for (const row of info.res) {
    const devOrForeign = !/127\.0\.0\.1:(9|45999)\//.test(row.t);
    if (devOrForeign) for (const via of ["fetch", "http", "axios", "net"]) assert.match(String(row[via]), /OUTBOUND_BLOCKED_IN_TEST/, `${row.t} via ${via}: ${row[via]}`);
  }
  // 127.0.0.1:9 and :45999 are registered in the list above and are not dev ports: they go through to the (spied) connect, which refuses them in the test itself
  for (const row of info.res.filter((x: any) => /127\.0\.0\.1:(9|45999)\//.test(x.t))) assert.doesNotMatch(String(row.net), /OUTBOUND_BLOCKED_IN_TEST/, "a registered port is not blocked by the guard");
});

test(`[${SERVICE}] DEFAULT clients go through the guard: with no URL configured they hit the blocked sentinel, with an unregistered fake-dev URL they are refused (0 connections), with the URL registered they reach it`, async () => {
  const dev = await fakeDev();
  try {
    const probeCode = (list: typeof PROBES) => `
const guard = require("./src/__tests__/setup/outbound-guard");
(async () => {
  const out = [];
  for (const p of ${JSON.stringify(list.map((x) => x.name))}.map((n, i) => i)) void p;
  const probes = [${list.map((p) => `[${JSON.stringify(p.name)}, async () => { ${p.code} }]`).join(",")}];
  for (const [name, fn] of probes) {
    const before = guard.blockedAttempts().length;
    let error = null;
    try { await fn(); } catch (e) { error = (e && (e.code || e.message) || String(e)).toString().slice(0, 160); }
    out.push({ name, blockedByGuard: guard.blockedAttempts().length > before, error });
  }
  console.log(JSON.stringify({ out, targets: guard.blockedAttempts().map((b) => b.target) }));
})();
`;
    // (a) nothing configured: every URL variable is the sentinel -> every probe is blocked by the guard
    const a = lastJson(run(probeCode(PROBES), {}).out);
    for (const o of a.out) assert.equal(o.blockedByGuard, true, `${o.name} was not stopped by the guard (error: ${o.error})`);
    assert.ok(a.targets.every((t: string) => t === "127.0.0.1:9"), `default calls went to the sentinel only: ${a.targets}`);
    // (b) pointed at an UNREGISTERED fake dev service: refused, nothing connects
    const first = PROBES[0];
    const b = lastJson(run(probeCode([first]), { [FIRST_PROBE_URL_VAR]: dev.url }).out);
    assert.equal(b.out[0].blockedByGuard, true, JSON.stringify(b));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(dev.count(), 0, "0 connections to the unregistered fake dev service");
    // (c) the same URL registered through TEST_ALLOWED_SERVICE_URLS: the call reaches it
    const c = lastJson(run(probeCode([first]), { [FIRST_PROBE_URL_VAR]: dev.url, TEST_ALLOWED_SERVICE_URLS: dev.url }).out);
    assert.equal(c.out[0].blockedByGuard, false, JSON.stringify(c));
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(dev.count() >= 1, "a registered test service is reachable");
  } finally {
    await dev.close();
  }
});

test(`[${SERVICE}] a server the test starts itself is a test service (auto-registered); without the preload the guard is simply absent (the DB guard still skips)`, () => {
  const code = `
const http = require("node:http");
const s = http.createServer((q, r) => r.end("ok")).listen(0, "127.0.0.1", async () => {
  const port = s.address().port;
  const res = await fetch("http://127.0.0.1:" + port + "/").then((x) => x.text(), (e) => "ERR " + e.code);
  console.log(JSON.stringify({ res })); s.close();
});`;
  assert.equal(lastJson(run(code, {}).out).res, "ok");
  const noPreload = run(`console.log(JSON.stringify({ guard: Boolean(globalThis.__GYMINI_TEST_OUTBOUND__) }))`, {}, { preload: false });
  assert.equal(lastJson(noPreload.out).guard, false);
});

void spawn;
