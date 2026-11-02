/**
 * DISPUTE CASE slice 1 hardening - SECURITY over real HTTP through the REAL gateway app into the REAL user-service app (both in-process, on
 * ephemeral local ports; the gateway proxies to a thin recording wrapper around the user-service app, so what user-service RECEIVES from the
 * gateway can be asserted).
 *
 * Evidence labels (kept apart):
 *   REAL HTTP        gateway (express + http-proxy-middleware) -> user-service (express), real sockets.
 *   AUTH FIXTURE     auth-service is a small HTTP fixture that verifies HS256 JWTs signed with a test secret (POST /auth/verify).
 *                    It is NOT the real auth-service: this is not "REAL AUTH". (A REAL AUTH run, with the real auth-service on its own *_test
 *                    database, is the separate suite dispute-case-real-auth.test.ts.)
 *   MOCKED DEPENDENCY paymentClient (only the read-only ledger lookup is answered; every other method throws).
 *   BACKEND INTEGRATION  the DB part (cases, evidence, access logs) runs on the isolated *_test database; the no-DB part (first block) never
 *                    reaches a database.
 *
 * DB part: TEST_DATABASE_URL (see setup/db-isolation.ts); skipped otherwise.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { guardedTest, usable } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
// Slice 2 / S2.3: this suite must not open sockets to chat-service / gym-service; the collector keeps its Slice 1 placeholders here.
process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED ??= "true";

const SECRET = "dispute-security-test-jwt-secret-0123456789";
const INTERNAL = "dispute-security-test-internal-secret-0123456789";
process.env.NODE_ENV = "test";
process.env.INTERNAL_SERVICE_SECRET = INTERNAL;
process.env.RATE_LIMIT_MAX_REQUESTS = "100000"; // the gateway limiter (100/min) would answer 429 to this suite, which sends several hundred requests

// ── AUTH FIXTURE: real HS256 verification, no database ────────────────────────────────────────────────────────────────
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(payload: Record<string, unknown>, secret = SECRET, alg = "HS256") {
  const head = b64({ alg, typ: "JWT" });
  const body = b64(payload);
  const sig = alg === "none" ? "" : createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const tokenFor = (role: string, id: string, extra: Record<string, unknown> = {}) =>
  sign({ id, email: `${id}@t.test`, role, exp: Math.floor(Date.now() / 1000) + 600, ...extra });

function verifyJwt(token: string): { id: string; email: string; role: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let head: any;
  let payload: any;
  try {
    head = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return null;
  }
  if (head.alg !== "HS256") return null;
  const expected = createHmac("sha256", SECRET).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (expected !== parts[2]) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  if (!payload.id) return null;
  return { id: payload.id, email: payload.email ?? "", role: payload.role ?? "CUSTOMER" };
}

type Seen = { url: string; method: string; headers: http.IncomingHttpHeaders };
const seenByUserService: Seen[] = [];
let authServer: http.Server;
let userServer: http.Server;
let gwServer: http.Server;
let gw = "";
let direct = "";
let userApp: any;
const createdContracts: string[] = [];

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const u = verifyJwt(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!u) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Invalid token" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ user: u }));
      return;
    }
    res.writeHead(404).end();
  });
  const authPort = await listen(authServer);
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${authPort}`;

  // MOCKED DEPENDENCY: only the read-only ledger lookup answers; any other payment method is a failure.
  for (const name of Object.keys(paymentClient)) {
    (paymentClient as any)[name] =
      name === "lookupLedgerOperation"
        ? async () => null
        : async () => {
            throw new Error(`MONEY WRITE FROM CASE CODE: ${name}`);
          };
  }

  ({ default: userApp } = await import("../app"));
  userServer = http.createServer((req, res) => {
    seenByUserService.push({ url: String(req.url), method: String(req.method), headers: { ...req.headers } });
    userApp(req, res);
  });
  const userPort = await listen(userServer);
  direct = `http://127.0.0.1:${userPort}`;
  process.env.USER_SERVICE_URL = direct;

  // The REAL gateway app (path computed at run time: it lives in another package, outside user-service's tsc rootDir).
  const gatewayApp = join(__dirname, "..", "..", "..", "..", "gateway", "src", "app.ts");
  const mod: any = await import(pathToFileURL(gatewayApp).href);
  const app = mod.default?.default ?? mod.default;
  gwServer = http.createServer(app);
  gw = `http://127.0.0.1:${await listen(gwServer)}`;
});

test.after(async () => {
  for (const s of [gwServer, userServer, authServer]) await new Promise((r) => s?.close(r));
  try {
    const { prisma } = await import("../repositories/profile.repository");
    if (createdContracts.length) {
      await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } });
    }
    await prisma.$disconnect();
  } catch {
    /* not connected */
  }
});

async function call(base: string, method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

const FAKE_ID = randomUUID();
const SPOOF = { "x-user-id": FAKE_ID, "x-user-role": "ADMIN", "x-gateway-secret": "attacker-guess", "x-internal-token": "attacker-guess", "x-service-secret": "attacker-guess" };
const ADMIN_ROUTES: Array<[string, string, unknown?]> = [
  ["GET", "/admin/dispute-cases"],
  ["GET", `/admin/dispute-cases/${randomUUID()}`],
  ["POST", "/admin/dispute-cases", { sessionId: "x" }],
  ["POST", `/admin/dispute-cases/${randomUUID()}/assign`, {}],
  ["POST", `/admin/dispute-cases/${randomUUID()}/approvals`, { result: "APPROVED", reason: "x", conflictOfInterestDeclaredNone: true }],
  ["POST", `/admin/dispute-cases/${randomUUID()}/shares`, { evidenceId: randomUUID(), sharedWithRole: "PT", reason: "x" }],
];
const PARTY_ROUTES: Array<[string, string, unknown?]> = [
  ["GET", "/dispute-cases"],
  ["GET", `/dispute-cases/${randomUUID()}`],
  ["POST", `/dispute-cases/${randomUUID()}/statements`, { text: "x" }],
  ["POST", `/dispute-cases/${randomUUID()}/evidence`, { description: "x", sha256: "a".repeat(64) }],
];

// ═══ Part 1 - no database ═════════════════════════════════════════════════════════════════════════════════════════════

test("1. no token -> 401 on every admin and party route, through the gateway AND straight at user-service", async () => {
  for (const base of [gw, direct]) {
    for (const [m, p, b] of [...ADMIN_ROUTES, ...PARTY_ROUTES]) {
      assert.equal((await call(base, m, p, null, b)).status, 401, `${base === gw ? "gw" : "direct"} ${m} ${p}`);
    }
  }
});

test("2. invalid tokens (garbage, tampered signature, wrong secret, alg=none, expired, no subject) -> 401", async () => {
  const good = tokenFor("ADMIN", randomUUID());
  const [h, b] = good.split(".");
  const bad = [
    "garbage",
    `${h}.${b}.AAAA`,
    sign({ id: randomUUID(), role: "ADMIN", exp: Math.floor(Date.now() / 1000) + 600 }, "some-other-secret"),
    sign({ id: randomUUID(), role: "ADMIN", exp: Math.floor(Date.now() / 1000) + 600 }, SECRET, "none"),
    sign({ id: randomUUID(), role: "ADMIN", exp: Math.floor(Date.now() / 1000) - 60 }),
    sign({ role: "ADMIN", exp: Math.floor(Date.now() / 1000) + 600 }),
    // payload swapped for an ADMIN one while keeping the signature of a CUSTOMER token
    `${h}.${b64({ id: randomUUID(), role: "ADMIN", exp: Math.floor(Date.now() / 1000) + 600 })}.${tokenFor("CUSTOMER", randomUUID()).split(".")[2]}`,
  ];
  for (const t of bad) {
    for (const base of [gw, direct]) {
      for (const [m, p, body] of [ADMIN_ROUTES[0], PARTY_ROUTES[0], ADMIN_ROUTES[2]]) assert.equal((await call(base, m, p, t, body)).status, 401, `${base === gw ? "gw" : "direct"} ${p} ${t.slice(0, 18)}`);
    }
  }
});

test("3. spoofed x-user-id / x-user-role / x-gateway-secret without a token -> 401, never an identity", async () => {
  for (const base of [gw, direct]) {
    for (const [m, p, b] of [...ADMIN_ROUTES, ...PARTY_ROUTES]) assert.equal((await call(base, m, p, null, b, SPOOF)).status, 401, `${base === gw ? "gw" : "direct"} ${m} ${p}`);
  }
  // the real internal secret in the header does not help either (user-service re-verifies the token itself)
  assert.equal((await call(direct, "GET", "/admin/dispute-cases", null, undefined, { ...SPOOF, "x-gateway-secret": INTERNAL, "x-service-secret": INTERNAL })).status, 401);
});

test("6. a CUSTOMER / PT / GYM_OWNER token on any /admin/dispute-cases route -> 403 at the gateway (the request never reaches user-service); spoofed ADMIN headers change nothing", async () => {
  const before = seenByUserService.length;
  for (const role of ["CUSTOMER", "PT", "GYM_OWNER"]) {
    const tok = tokenFor(role, randomUUID());
    for (const [m, p, b] of ADMIN_ROUTES) {
      assert.equal((await call(gw, m, p, tok, b)).status, 403, `${role} ${m} ${p}`);
      assert.equal((await call(gw, m, p, tok, b, SPOOF)).status, 403, `${role} ${m} ${p} + spoofed ADMIN headers`);
    }
  }
  assert.equal(seenByUserService.length, before, "403 came from the gateway: user-service saw nothing");
});

test("7. straight at user-service (gateway bypassed): fake headers without a valid token -> 401; a valid CUSTOMER token plus a fake ADMIN role header -> still 403 (identity comes from the verified token)", async () => {
  assert.equal((await call(direct, "GET", "/admin/dispute-cases", null, undefined, SPOOF)).status, 401);
  assert.equal((await call(direct, "GET", "/admin/dispute-cases", "garbage", undefined, SPOOF)).status, 401);
  const cust = tokenFor("CUSTOMER", randomUUID());
  for (const [m, p, b] of ADMIN_ROUTES) {
    const r = await call(direct, m, p, cust, b, SPOOF);
    assert.equal(r.status, 403, `${m} ${p}`);
  }
});

test("9. the gateway deletes client-supplied identity headers and rebuilds them from the verified token (what user-service actually received)", async () => {
  const id = randomUUID();
  seenByUserService.length = 0;
  const r = await call(gw, "GET", "/dispute-cases", tokenFor("CUSTOMER", id), undefined, { ...SPOOF, "x-user-email": "evil@t.test", "x-client-ip": "6.6.6.6", "x-public-base-url": "https://evil.test" });
  assert.ok(usable ? r.status === 200 : r.status >= 200, r.text.slice(0, 200)); // 200 on the test DB; with no DB the request still reached user-service
  const seen = seenByUserService.find((s) => s.url.startsWith("/dispute-cases"))!;
  assert.ok(seen, "user-service received the proxied request");
  assert.equal(seen.headers["x-user-id"], id, "x-user-id is the token's id, not the spoofed one");
  assert.equal(seen.headers["x-user-role"], "CUSTOMER", "x-user-role is the token's role, not the spoofed ADMIN");
  assert.equal(seen.headers["x-user-email"], `${id}@t.test`);
  assert.equal(seen.headers["x-gateway-secret"], INTERNAL, "x-gateway-secret is the gateway's own, not the attacker's");
  // OBSERVATION (not a Slice 1 defect): the gateway does NOT strip a client-supplied x-internal-token / x-service-secret on /dispute-cases; it is only
  // the attacker's own value, user-service's authMiddleware deletes both before any handler, and test 3 shows they grant nothing.
  assert.notEqual(seen.headers["x-client-ip"], "6.6.6.6");
  assert.notEqual(seen.headers["x-public-base-url"], "https://evil.test");
  for (const [k, v] of Object.entries(seen.headers)) if (!["x-internal-token", "x-service-secret"].includes(k)) assert.ok(!String(v).includes("attacker-guess"), k);
});

// ═══ Part 2 - isolated *_test database ═══════════════════════════════════════════════════════════════════════════════

guardedTest("DB part: cases of other parties are invisible; party views leak nothing of the other side; access is logged under the TOKEN identity; admin routes work for a real ADMIN", async () => {
  const { prisma } = await import("../repositories/profile.repository");
  const { addSession, makeContract } = await import("./pt-restriction.test-helpers");
  const { disputeCaseService: svc } = await import("../services/dispute-case/dispute-case.service");

  const mk = async () => {
    const ptUserId = randomUUID();
    const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
    createdContracts.push(contract.id);
    const session = await addSession(contract, "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
      sessionMode: "ONLINE",
      disputeType: "DELIVERY_DISPUTE",
      disputedAt: new Date(),
      disputeReason: `LY-DO-KHACH-${randomUUID().slice(0, 8)}`,
      ptNotes: `GHI-CHU-PT-${randomUUID().slice(0, 8)}`,
    });
    return { ptUserId, clientUserId: contract.clientUserId, contract, session };
  };
  const adminId = randomUUID();
  const admin2 = randomUUID();
  const A = await mk();
  const B = await mk();
  const caseA = (await svc.openCase({ id: adminId, role: "ADMIN" }, A.session.id)).result.case.id;
  const caseB = (await svc.openCase({ id: adminId, role: "ADMIN" }, B.session.id)).result.case.id;
  await svc.assign({ id: adminId, role: "ADMIN" }, caseA, undefined);
  await svc.transition({ id: adminId, role: "ADMIN" }, caseA, "COLLECTING", {});
  const tClientA = tokenFor("CUSTOMER", A.clientUserId);
  const tPtA = tokenFor("PT", A.ptUserId);
  const tClientB = tokenFor("CUSTOMER", B.clientUserId);
  const tPtB = tokenFor("PT", B.ptUserId);
  const tStranger = tokenFor("CUSTOMER", randomUUID());
  const tAdmin = tokenFor("ADMIN", adminId);

  try {
    // 4. a client cannot see another client's case; 5. a PT outside the case cannot either (404, not 403: existence is not disclosed)
    for (const [who, tok] of [["client of B", tClientB], ["PT of B", tPtB], ["stranger", tStranger]] as const) {
      assert.equal((await call(gw, "GET", `/dispute-cases/${caseA}`, tok)).status, 404, `${who} GET`);
      assert.equal((await call(gw, "POST", `/dispute-cases/${caseA}/statements`, tok, { text: "xâm nhập" })).status, 404, `${who} POST statement`);
      assert.equal((await call(gw, "POST", `/dispute-cases/${caseA}/evidence`, tok, { description: "xâm nhập", sha256: "a".repeat(64) })).status, 404, `${who} POST evidence`);
      const list = await call(gw, "GET", "/dispute-cases", tok);
      assert.equal(list.status, 200);
      assert.ok(!list.json.items.some((i: any) => i.id === caseA), `${who} list`);
    }
    assert.equal((await call(gw, "GET", `/dispute-cases/${caseB}`, tClientA)).status, 404);
    assert.equal((await call(gw, "GET", `/dispute-cases/${caseB}`, tPtA)).status, 404);
    // a spoofed x-user-id of the real client does not turn a stranger into a party
    assert.equal((await call(gw, "GET", `/dispute-cases/${caseA}`, tStranger, undefined, { "x-user-id": A.clientUserId, "x-user-role": "CUSTOMER" })).status, 404);
    assert.equal((await call(direct, "GET", `/dispute-cases/${caseA}`, tStranger, undefined, { "x-user-id": A.clientUserId })).status, 404);

    // parties of A each post a restricted document and a statement
    const cDoc = await call(gw, "POST", `/dispute-cases/${caseA}/evidence`, tClientA, { description: "BI-MAT-KHACH", sha256: "c1".repeat(32) });
    const pDoc = await call(gw, "POST", `/dispute-cases/${caseA}/evidence`, tPtA, { description: "BI-MAT-PT", sha256: "d2".repeat(32) });
    assert.equal(cDoc.status, 201);
    assert.equal(pDoc.status, 201);
    const cStmt = await call(gw, "POST", `/dispute-cases/${caseA}/statements`, tClientA, { text: "LOI-KHAI-KHACH-MOI", supplementReason: "bổ sung" });
    assert.equal(cStmt.status, 201);

    // 8. what a party can read: own items only, no financial split, no access logs, no event payloads, no investigator internals
    const clientView = await call(gw, "GET", `/dispute-cases/${caseA}`, tClientA);
    const ptView = await call(gw, "GET", `/dispute-cases/${caseA}`, tPtA);
    assert.equal(clientView.status, 200);
    assert.equal(ptView.status, 200);
    const forbiddenKeys = ["accessLogs", "access_logs", "events", "assessments", "findings", "proposals", "approvals", "shares", "issues", "investigatorId", "createdBy", "platformRate", "ptRate", "gymRate", "ptHoldbackRate", "releasedToPt", "idempotencyKey", "contentHash"];
    for (const v of [clientView, ptView]) {
      for (const k of forbiddenKeys) assert.ok(!v.text.includes(`"${k}"`), `party view leaked key ${k}`);
      assert.deepEqual(Object.keys(v.json.financial).sort(), ["group", "groupLabel"]);
    }
    assert.ok(clientView.text.includes("BI-MAT-KHACH") && !clientView.text.includes("BI-MAT-PT") && !clientView.text.includes("d2".repeat(32)), "client sees own doc only");
    assert.ok(ptView.text.includes("BI-MAT-PT") && !ptView.text.includes("BI-MAT-KHACH") && !ptView.text.includes("c1".repeat(32)), "PT sees own doc only");
    assert.ok(!ptView.text.includes("LOI-KHAI-KHACH-MOI") && !ptView.text.includes(A.session.disputeReason!), "PT never sees the client's statements");
    assert.ok(!clientView.text.includes(A.session.ptNotes!), "client never sees the PT's legacy note");
    for (const hidden of ["CONTRACT_FINANCIAL_SNAPSHOT", "SETTLEMENTS", "AUDIT_LOG:SESSION", "AUDIT_LOG:CONTRACT"]) {
      assert.ok(!clientView.text.includes(hidden) && !ptView.text.includes(hidden), `${hidden} is admin-only`);
    }
    // parties have no route to the access log, the events or the admin detail
    for (const p of [`/dispute-cases/${caseA}/access-logs`, `/dispute-cases/${caseA}/events`, `/dispute-cases/${caseA}/evidence/${randomUUID()}`]) {
      { const rr = await call(gw, "GET", p, tClientA); assert.ok(rr.status === 404, `${p} -> ${rr.status} ${rr.text.slice(0, 120)}`); }
    }
    assert.equal((await call(gw, "GET", `/admin/dispute-cases/${caseA}`, tClientA)).status, 403);

    // access log carries the TOKEN identity, not a spoofed header
    const spoofedViewer = randomUUID();
    await call(gw, "GET", `/dispute-cases/${caseA}`, tClientA, undefined, { "x-user-id": spoofedViewer, "x-user-role": "ADMIN" });
    const logs = await prisma.disputeCaseAccessLog.findMany({ where: { caseId: caseA } });
    assert.ok(logs.some((l) => l.viewerUserId === A.clientUserId && l.viewerRole === "CUSTOMER"));
    assert.ok(!logs.some((l) => l.viewerUserId === spoofedViewer));
    assert.ok(!logs.some((l) => l.viewerUserId === A.clientUserId && l.evidenceId && l.evidenceId === (pDoc.json as any).id), "the client never read the PT's document");

    // a real ADMIN through the gateway: sees everything, labelled; the same case cannot be reached by id as another case's party
    const adminView = await call(gw, "GET", `/admin/dispute-cases/${caseA}`, tAdmin);
    assert.equal(adminView.status, 200);
    const docs = adminView.json.evidence.filter((e: any) => e.partySubmitted);
    assert.equal(docs.length, 2);
    for (const d of docs) {
      assert.equal(d.verificationStatus, "CLIENT_CLAIMED_UNVERIFIED");
      assert.equal(d.sensitivity, "RESTRICTED");
    }
    // sharing a self-submitted document is refused even for the investigator (and an admin who is not the investigator is refused earlier)
    const share = await call(gw, "POST", `/admin/dispute-cases/${caseA}/shares`, tAdmin, { evidenceId: cDoc.json.id, sharedWithRole: "PT", reason: "thử" });
    assert.equal(share.status, 409);
    assert.equal(share.json.code, "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED");
    const other = await call(gw, "POST", `/admin/dispute-cases/${caseA}/shares`, tokenFor("ADMIN", admin2), { evidenceId: cDoc.json.id, sharedWithRole: "PT", reason: "thử" });
    assert.equal(other.status, 403);
    // after the refused share the PT still cannot see the client's document
    assert.ok(!(await call(gw, "GET", `/dispute-cases/${caseA}`, tPtA)).text.includes("BI-MAT-KHACH"));
  } finally {
    // rows are left for the isolated *_test database to be recreated; nothing to clean in dev
  }
});

test("3b. even the REAL internal secret in x-service-secret / x-internal-token / x-gateway-secret grants nothing through the gateway: /internal/* is not proxied (404) and the dispute routes still need a token (401)", async () => {
  const withSecret = { "x-service-secret": INTERNAL, "x-internal-token": INTERNAL, "x-gateway-secret": INTERNAL, "x-user-id": randomUUID(), "x-user-role": "ADMIN" };
  for (const p of ["/internal/admin/sessions/today-count", "/internal/gyms/1/booked-clients", "/auth/internal/users/x"]) {
    const r = await call(gw, "GET", p, null, undefined, withSecret);
    assert.ok(r.status === 404 || r.status === 401, `${p} -> ${r.status}`);
    assert.notEqual(r.status, 200, p);
  }
  seenByUserService.length = 0;
  await call(gw, "GET", "/internal/admin/sessions/today-count", null, undefined, withSecret);
  assert.ok(!seenByUserService.some((s) => s.url.startsWith("/internal")), "no /internal request ever reached user-service through the gateway");
  for (const [m, p, b] of [...ADMIN_ROUTES, ...PARTY_ROUTES]) assert.equal((await call(gw, m, p, null, b, withSecret)).status, 401, `${m} ${p}`);
});
