/**
 * B05 (gateway half) — the dev-only MinIO pass-through now also covers the PT media bucket
 * (PT_MEDIA_S3_BUCKET), not just the partner documents bucket, so a presigned
 * `/<bucket>/<key>?X-Amz-…` link signed for the caller's own address works through a tunnel.
 *
 * Real gateway app + a stub standing in for MinIO (REAL HTTP/API for the gateway half, TEST FIXTURE for MinIO).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.MINIO_PROXY_TARGET = "http://127.0.0.1:4051";
process.env.PARTNER_S3_PRIVATE_BUCKET = "partner-private-bucket";
process.env.PT_MEDIA_S3_BUCKET = "pt-media-bucket";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-pt-media-proxy-test";

let gatewayServer: http.Server;
let minio: http.Server;
let gatewayPort = 0;
let seen: { url?: string; host?: string; auth?: string }[] = [];

test.before(async () => {
  const { default: app } = await import("../app");
  minio = http.createServer((req, res) => {
    seen.push({ url: req.url, host: String(req.headers.host), auth: req.headers.authorization as string | undefined });
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end("jpeg-bytes");
  });
  await new Promise<void>((resolve) => minio.listen(4051, "127.0.0.1", resolve));
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  gatewayPort = (gatewayServer.address() as any).port;
});

test.after(async () => {
  await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
  await new Promise<void>((resolve) => minio.close(() => resolve()));
});

function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: gatewayPort, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() }));
      })
      .on("error", reject);
  });
}

test("PT media bucket links are forwarded to MinIO with the caller's public host (what SigV4 signed)", async () => {
  seen = [];
  const r = await get("/pt-media-bucket/pt-listings/u1/photo.jpg?X-Amz-Signature=abc", {
    "x-forwarded-host": "demo.trycloudflare.com",
    authorization: "Bearer should-not-leak",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body, "jpeg-bytes");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/pt-media-bucket/pt-listings/u1/photo.jpg?X-Amz-Signature=abc");
  assert.equal(seen[0].host, "demo.trycloudflare.com");
  assert.equal(seen[0].auth, undefined, "no gateway/user credentials leak to MinIO");
});

test("the partner bucket keeps working alongside it", async () => {
  seen = [];
  const r = await get("/partner-private-bucket/docs/a.pdf?X-Amz-Signature=abc");
  assert.equal(r.status, 200);
  assert.equal(seen[0].url, "/partner-private-bucket/docs/a.pdf?X-Amz-Signature=abc");
});

test("an unrelated bucket name is NOT proxied", async () => {
  seen = [];
  const r = await get("/some-other-bucket/x.jpg");
  assert.notEqual(r.body, "jpeg-bytes");
  assert.equal(seen.length, 0);
});
