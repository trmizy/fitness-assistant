/**
 * N09C-04 — authClient.sendEmail must not treat HTTP 200 {delivered:false} (SMTP chưa cấu hình) as "đã gửi".
 * Dùng một auth-service giả qua HTTP thật.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server: http.Server;
let nextBody: unknown = { delivered: true };
let nextStatus = 200;

test.before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(nextStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(nextBody));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
});

const mail = { to: "a@example.com", subject: "s", text: "t" };

test("sendEmail: 200 {delivered:true} -> true", async () => {
  const { authClient } = await import("../clients/auth.client");
  nextStatus = 200; nextBody = { delivered: true };
  assert.equal(await authClient.sendEmail(mail), true);
});

test("sendEmail: 200 {delivered:false} -> false (SMTP unconfigured)", async () => {
  const { authClient } = await import("../clients/auth.client");
  nextStatus = 200; nextBody = { delivered: false };
  assert.equal(await authClient.sendEmail(mail), false);
});

test("sendEmail: 200 with body lacking 'delivered' keeps legacy true", async () => {
  const { authClient } = await import("../clients/auth.client");
  nextStatus = 200; nextBody = { ok: true };
  assert.equal(await authClient.sendEmail(mail), true);
});

test("sendEmail: 500 -> false", async () => {
  const { authClient } = await import("../clients/auth.client");
  nextStatus = 500; nextBody = { error: "x" };
  assert.equal(await authClient.sendEmail(mail), false);
});
