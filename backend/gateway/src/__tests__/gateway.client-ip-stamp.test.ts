/**
 * The gateway stamps the client's IP itself (app.ts, next to the x-gateway-secret stamp): `x-client-ip` = `req.ip`, computed with the
 * gateway's own `trust proxy` (1) setting, after deleting whatever the client sent under that name. user-service's client-ip middleware
 * prefers that stamp on requests that carry the gateway secret (audit rows, PT terms acceptance evidence).
 *
 *   - a client-supplied `x-client-ip` NEVER reaches the downstream service (it is overwritten, in every case below);
 *   - a client-supplied X-Forwarded-For cannot choose the stamp beyond the one trusted hop: with `trust proxy` = 1 the stamp is the
 *     rightmost entry (what the one front proxy saw), so a spoofed LEFT-hand entry is ignored;
 *   - with no X-Forwarded-For the stamp is the socket peer;
 *   - X-Forwarded-For itself is still forwarded unchanged (documented: http-proxy does not touch it) - the stamp, not the header, is
 *     what the downstream service should read.
 *
 * Same real-app + fake-downstream convention as gateway.listing-compat-headers.test.ts.
 * Evidence label: BACKEND INTEGRATION (gateway real; auth-service and user-service are TEST FIXTURES). The deployment's front proxy
 * (nginx / CloudFront / ALB) is not in the loop: that it appends exactly one trusted hop is the deployment assumption `trust proxy` = 1 encodes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4821";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4822";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-client-ip-stamp-test";

let app: any;
let gatewayServer: http.Server;
let userServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let hits: Array<{ clientIp: string | string[] | undefined; xff: string | string[] | undefined; secret: string | string[] | undefined }> = [];

test.before(async () => {
  ({ default: app } = await import("../app"));
  authServer = http.createServer((req, res) => {
    req.resume();
    if (req.method === "POST" && req.url === "/auth/verify") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: "pt-1", email: "pt@example.com", role: "CUSTOMER" } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  userServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits.push({ clientIp: req.headers["x-client-ip"], xff: req.headers["x-forwarded-for"], secret: req.headers["x-gateway-secret"] });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => authServer.listen(4821, "127.0.0.1", r));
  await new Promise<void>((r) => userServer.listen(4822, "127.0.0.1", r));
  gatewayServer = http.createServer(app);
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));
  const address = gatewayServer.address();
  if (!address || typeof address === "string") throw new Error("Failed to start gateway test server");
  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  hits = [];
});

test.after(async () => {
  for (const s of [gatewayServer, userServer, authServer]) {
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }
});

async function viaGateway(headers: Record<string, string>) {
  const res = await fetch(`${gatewayBaseUrl}/pt-applications/terms`, {
    headers: { Authorization: "Bearer pt-token", ...headers },
  });
  assert.equal(res.status, 200);
  assert.equal(hits.length, 1, "the request reached the user-service fixture exactly once");
  return hits[0];
}

const isPeer = (v: unknown) => typeof v === "string" && /^(::ffff:)?127\.0\.0\.1$/.test(v);

test("no X-Forwarded-For: the stamp is the socket peer, and a spoofed x-client-ip from the client is overwritten", async () => {
  const hit = await viaGateway({ "X-Client-IP": "6.6.6.6" });
  assert.ok(isPeer(hit.clientIp), `stamp is the peer, not the spoof (got ${JSON.stringify(hit.clientIp)})`);
  assert.equal(hit.secret, "gateway-secret-client-ip-stamp-test", "the gateway secret is stamped as before");
});

test("a spoofed x-client-ip AND a spoofed left-hand X-Forwarded-For entry: the stamp is the one trusted hop (rightmost entry), never the spoof", async () => {
  const hit = await viaGateway({ "X-Client-IP": "6.6.6.6", "X-Forwarded-For": "6.6.6.6, 203.0.113.7" });
  assert.equal(hit.clientIp, "203.0.113.7");
  // documented: X-Forwarded-For is forwarded unchanged - it is NOT what the downstream service should trust any more
  assert.equal(hit.xff, "6.6.6.6, 203.0.113.7");
});

test("a spoofed x-client-ip repeated as several header lines is still entirely replaced by one stamp", async () => {
  const res = await fetch(`${gatewayBaseUrl}/pt-applications/terms`, {
    headers: new Headers([
      ["Authorization", "Bearer pt-token"],
      ["X-Client-IP", "6.6.6.6"],
      ["X-Client-IP", "7.7.7.7"],
      ["X-Forwarded-For", "198.51.100.9"],
    ]),
  });
  assert.equal(res.status, 200);
  assert.equal(hits[0].clientIp, "198.51.100.9", "one value, the gateway's, not the list the client sent");
});

test("a request that carries no spoof gets the same stamp as one that does (the stamp does not depend on x-client-ip at all)", async () => {
  const clean = await viaGateway({ "X-Forwarded-For": "198.51.100.9" });
  hits = [];
  const spoofed = await viaGateway({ "X-Forwarded-For": "198.51.100.9", "X-Client-IP": "10.0.0.1" });
  assert.equal(clean.clientIp, "198.51.100.9");
  assert.equal(spoofed.clientIp, clean.clientIp);
});
