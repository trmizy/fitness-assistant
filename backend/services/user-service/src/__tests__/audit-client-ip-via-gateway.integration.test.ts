import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { PT_TERMS_VERSION } from "../services/pt-terms";
import { clientIpFrom } from "../middleware/client-ip.middleware";

/**
 * D25 IP/UA - the client IP written by auditMeta() (PT terms acceptance, contract audit rows, ...).
 *
 * Before: user-service had no `trust proxy`, so req.ip was the socket peer = the GATEWAY's address on every request. The gateway
 * forwards the incoming X-Forwarded-For untouched (http-proxy-middleware, no `xfwd`), so the real client address is the RIGHTMOST
 * entry of that header exactly when the gateway sat behind ONE trusted front proxy (same assumption as the gateway's own
 * `app.set("trust proxy", 1)`), and GATEWAY_FRONT_PROXY_HOPS (default 1) says how many.
 *
 * Rule now (src/middleware/client-ip.middleware.ts): X-Forwarded-For is read ONLY when the request carries the gateway's shared
 * secret (x-gateway-secret, stamped by the gateway on every request and stripped from client input there); the entry used is the
 * HOPS-th from the right and must be a valid IP. Anything else (no / wrong secret, no header, garbage) falls back to the socket
 * peer, exactly what req.ip gave before. A client-supplied header is therefore never trusted on a request that did not come through
 * the gateway.
 *
 * Evidence: REAL HTTP against the real Express app on a random port and an isolated *_test database; the row that is read back is
 * the PtTermsAcceptance the real route wrote. TEST FIXTURE: auth-service (token table at the authServiceClient boundary). NOT in the
 * loop: the real gateway and any front proxy (their behaviour is a CODE AUDIT, see the report).
 */

const DEV_SECRET = "dev_internal_service_secret_change_in_production";
const identities = new Map<string, string>();
const orig = authServiceClient.verifyToken;
let server: http.Server;
let base = "";
const users: string[] = [];

dbTest.before(async () => {
  if (skip) return;
  authServiceClient.verifyToken = (async (header: string) => {
    const id = identities.get(String(header).replace(/^Bearer /, ""));
    if (!id) throw Object.assign(new Error("bad"), { response: { status: 401, data: {} } });
    return { status: 200, data: { user: { id, email: `${id}@test.local`, role: "CUSTOMER" } } };
  }) as typeof authServiceClient.verifyToken;
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
dbTest.after(async () => {
  authServiceClient.verifyToken = orig;
  if (server) {
    (server as any).closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  await prisma.ptTermsAcceptance.deleteMany({ where: { userId: { in: users } } });
  await prisma.$disconnect();
});

/** one real POST /pt-applications/terms/accept with the given extra headers; returns the IP/UA the route stored */
async function recordedIp(headers: Record<string, string>) {
  const userId = randomUUID();
  users.push(userId);
  const token = `tok-${userId}`;
  identities.set(token, userId);
  const res = await fetch(`${base}/pt-applications/terms/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": "g2-test-agent", ...headers },
    body: JSON.stringify({ version: PT_TERMS_VERSION }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const row = await prisma.ptTermsAcceptance.findFirstOrThrow({ where: { userId } });
  return { ip: row.ipAddress, ua: row.userAgent };
}

const viaGateway = { "x-gateway-secret": DEV_SECRET };
const isLoopback = (ip: string | null) => /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(ip ?? "");

dbTest("REAL HTTP: through the gateway, the client IP is the rightmost X-Forwarded-For entry (the front proxy's view), not the gateway's address", async () => {
  const r = await recordedIp({ ...viaGateway, "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
  assert.equal(r.ip, "203.0.113.7");
  assert.equal(r.ua, "g2-test-agent", "user agent is recorded as before");
  assert.equal((await recordedIp({ ...viaGateway, "x-forwarded-for": "198.51.100.9" })).ip, "198.51.100.9");
  assert.equal((await recordedIp({ ...viaGateway, "x-forwarded-for": "2001:db8::1" })).ip, "2001:db8::1");
  assert.equal((await recordedIp({ ...viaGateway, "x-forwarded-for": "::ffff:192.0.2.44" })).ip, "192.0.2.44", "IPv4-mapped form is normalised");
});

dbTest("REAL HTTP: a request that did NOT come through the gateway can never choose its IP (no secret, wrong secret)", async () => {
  const forged = "6.6.6.6, 7.7.7.7";
  const attempts: Record<string, string>[] = [
    { "x-forwarded-for": forged },
    { "x-forwarded-for": forged, "x-gateway-secret": "not-the-secret" },
    { "x-forwarded-for": forged, "x-gateway-secret": "" },
    { "x-forwarded-for": forged, "x-real-ip": "6.6.6.6", forwarded: "for=6.6.6.6" },
  ];
  for (const headers of attempts) {
    const r = await recordedIp(headers);
    assert.ok(isLoopback(r.ip), `socket peer expected, got ${r.ip} for ${JSON.stringify(headers)}`);
  }
});

dbTest("REAL HTTP: through the gateway but without a usable header (absent, garbage, empty entries) -> falls back to the socket peer", async () => {
  for (const xff of [undefined, "", "not-an-ip", "6.6.6.6, not-an-ip", " , "]) {
    const r = await recordedIp({ ...viaGateway, ...(xff === undefined ? {} : { "x-forwarded-for": xff }) });
    assert.ok(isLoopback(r.ip), `socket peer expected, got ${r.ip} for ${JSON.stringify(xff)}`);
  }
});

dbTest("GATEWAY_FRONT_PROXY_HOPS: 0 ignores the header; 2 takes the second entry from the right; read on every request", async () => {
  const prev = process.env.GATEWAY_FRONT_PROXY_HOPS;
  try {
    process.env.GATEWAY_FRONT_PROXY_HOPS = "0";
    assert.ok(isLoopback((await recordedIp({ ...viaGateway, "x-forwarded-for": "203.0.113.7" })).ip));
    process.env.GATEWAY_FRONT_PROXY_HOPS = "2";
    assert.equal((await recordedIp({ ...viaGateway, "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" })).ip, "203.0.113.7");
    assert.ok(isLoopback((await recordedIp({ ...viaGateway, "x-forwarded-for": "10.0.0.2" })).ip), "fewer entries than hops -> peer, never a guess");
    process.env.GATEWAY_FRONT_PROXY_HOPS = "banana";
    assert.equal((await recordedIp({ ...viaGateway, "x-forwarded-for": "6.6.6.6, 203.0.113.7" })).ip, "203.0.113.7", "unparsable -> default 1");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_FRONT_PROXY_HOPS;
    else process.env.GATEWAY_FRONT_PROXY_HOPS = prev;
  }
});

dbTest("clientIpFrom: pure decision table", () => {
  const peer = "10.1.2.3";
  assert.equal(clientIpFrom({ viaGateway: true, forwardedFor: "1.1.1.1, 2.2.2.2", hops: 1, peer }), "2.2.2.2");
  assert.equal(clientIpFrom({ viaGateway: true, forwardedFor: ["9.9.9.9", "1.1.1.1, 2.2.2.2"], hops: 1, peer }), "2.2.2.2", "repeated header lines are one list");
  assert.equal(clientIpFrom({ viaGateway: false, forwardedFor: "1.1.1.1", hops: 1, peer }), peer);
  assert.equal(clientIpFrom({ viaGateway: true, forwardedFor: undefined, hops: 1, peer }), peer);
  assert.equal(clientIpFrom({ viaGateway: true, forwardedFor: "1.1.1.1", hops: 0, peer }), peer);
  assert.equal(clientIpFrom({ viaGateway: true, forwardedFor: "1.1.1.1", hops: 3, peer }), peer);
  assert.equal(clientIpFrom({ viaGateway: true, forwardedFor: "evil<script>", hops: 1, peer }), peer);
  assert.equal(clientIpFrom({ viaGateway: true, forwardedFor: "1.1.1.1", hops: 1, peer: undefined }), "1.1.1.1");
  assert.equal(clientIpFrom({ viaGateway: false, forwardedFor: "1.1.1.1", hops: 1, peer: undefined }), null);
});
