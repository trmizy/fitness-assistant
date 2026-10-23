/**
 * Magic link đăng ký đối tác: gateway quyết định host cho link trong email.
 *
 * Gateway thật + auth-service giả (ghi lại header nhận được) cho POST /auth/partner-applications/start:
 *   - Origin LAN / localhost của trình duyệt → `x-trusted-web-origin` = chính Origin đó;
 *   - tunnel web đang mở (tệp PUBLIC_WEB_ORIGIN_FILE còn "sống") → `x-trusted-web-origin` = địa chỉ tunnel, và
 *     CORS cho đúng địa chỉ ấy đi qua;
 *   - Origin *.trycloudflare.com / evil lạ (không phải tunnel trong tệp) → KHÔNG được gắn header (CORS còn từ chối);
 *   - header x-trusted-web-origin do client tự gửi luôn bị xoá trước khi proxy, kể cả khi không có Origin nào;
 *   - x-public-base-url (host lấy từ X-Forwarded-Host, giả được) không bao giờ thành host của link.
 *
 * Evidence label: BACKEND INTEGRATION (gateway thật; auth-service là TEST FIXTURE). Việc auth-service dựng link từ header
 * được kiểm ở auth-service/src/__tests__/partner-application-link-origin.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4831";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-partner-link-origin-test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-partner-link-"));
const originFile = path.join(dir, "public-web-origin");
process.env.PUBLIC_WEB_ORIGIN_FILE = originFile;
const TUNNEL = "https://quiet-river-1234.trycloudflare.com";

let app: any;
let gatewayServer: http.Server;
let authServer: http.Server;
let gatewayPort = 0;
let seen: Array<{ trusted: string | string[] | undefined; secret: string | string[] | undefined }> = [];
let resetCache: () => void;

test.before(async () => {
  ({ default: app } = await import("../app"));
  ({ _resetPublicWebOriginCache: resetCache } = await import("../utils/publicWebOrigin"));
  authServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url === "/auth/partner-applications/start") {
        seen.push({ trusted: req.headers["x-trusted-web-origin"], secret: req.headers["x-gateway-secret"] });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "SENT" }));
    });
  });
  await new Promise<void>((r) => authServer.listen(4831, "127.0.0.1", r));
  gatewayServer = http.createServer(app);
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));
  gatewayPort = (gatewayServer.address() as any).port;
});

test.beforeEach(() => {
  seen = [];
  fs.rmSync(originFile, { force: true });
  resetCache();
});

test.after(async () => {
  for (const s of [gatewayServer, authServer]) {
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
/** Gọi qua gateway bằng http.request (không bị fetch lọc header). Trả về HTTP status. */
function start(headers: Record<string, string>): Promise<number> {
  const body = JSON.stringify({ email: `owner${++n}@gym.test` });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: gatewayPort,
        path: "/auth/partner-applications/start",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode || 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("Origin LAN của trình duyệt → auth-service nhận x-trusted-web-origin = Origin đó, kèm secret nội bộ", async () => {
  assert.equal(await start({ Origin: "http://192.168.1.7:5173" }), 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].trusted, "http://192.168.1.7:5173");
  assert.equal(seen[0].secret, "gateway-secret-partner-link-origin-test");
});

test("tunnel web đang mở (tệp còn sống) → link theo địa chỉ tunnel, kể cả khi Origin là tunnel hay localhost", async () => {
  fs.writeFileSync(originFile, TUNNEL);
  resetCache();
  assert.equal(await start({ Origin: TUNNEL }), 200, "CORS cho đúng địa chỉ tunnel trong tệp");
  assert.equal(seen[0].trusted, TUNNEL);
  seen = [];
  assert.equal(await start({ Origin: "http://localhost:5173" }), 200);
  assert.equal(seen[0].trusted, TUNNEL);
});

test("Origin *.trycloudflare.com KHÔNG phải tunnel trong tệp → không bao giờ thành host của link", async () => {
  // Chưa có tệp (tunnel web chưa mở qua Khoi-dong-Tunnel-Web.bat): CORS từ chối, request không tới auth-service.
  const status = await start({ Origin: "https://attacker-1234.trycloudflare.com" });
  assert.notEqual(status, 200);
  assert.equal(seen.length, 0);
  // Có tunnel thật trong tệp, kẻ lạ vẫn đặt Origin trycloudflare khác: không được lấy làm host.
  fs.writeFileSync(originFile, TUNNEL);
  resetCache();
  await start({ Origin: "https://attacker-1234.trycloudflare.com" });
  for (const s of seen) assert.notEqual(s.trusted, "https://attacker-1234.trycloudflare.com");
});

test("x-trusted-web-origin do client tự gửi bị xoá — không Origin (app mobile) thì không có header", async () => {
  assert.equal(await start({ "x-trusted-web-origin": "https://evil.example" }), 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].trusted, undefined, "không còn bản giả; auth-service sẽ rơi về FRONTEND_URL");
});

test("x-trusted-web-origin giả + Origin LAN thật → header là Origin thật, không phải bản giả", async () => {
  assert.equal(await start({ Origin: "http://192.168.1.7:5173", "x-trusted-web-origin": "https://evil.example" }), 200);
  assert.equal(seen[0].trusted, "http://192.168.1.7:5173");
});

test("X-Forwarded-Host giả không ảnh hưởng host của link (khác x-public-base-url)", async () => {
  assert.equal(await start({ "X-Forwarded-Host": "evil.example" }), 200);
  assert.equal(seen[0].trusted, undefined);
});
