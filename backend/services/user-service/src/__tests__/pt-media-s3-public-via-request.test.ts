/**
 * B05 - PT physique-photo presigned links are signed for the address the caller used (tunnel / LAN), but only when
 * PT_MEDIA_S3_PUBLIC_VIA_REQUEST=true, NODE_ENV is not production, and the request really came through the gateway.
 * TEST FIXTURE: no MinIO; signing is local (credentials are fake), nothing is sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { requestContextMiddleware, currentPublicBaseUrl } from "../middleware/request-context.middleware";
import { s3PtMediaStorage } from "../services/pt-media-s3.service";

const DEV_SECRET = "dev_internal_service_secret_change_in_production";
const TUNNEL = "https://abc-def.trycloudflare.com";
const ENV_KEYS = [
  "PT_MEDIA_S3_BUCKET", "PT_MEDIA_S3_ENDPOINT", "PT_MEDIA_S3_PUBLIC_ENDPOINT", "PT_MEDIA_S3_FORCE_PATH_STYLE",
  "PT_MEDIA_S3_ACCESS_KEY_ID", "PT_MEDIA_S3_SECRET_ACCESS_KEY", "PT_MEDIA_S3_PUBLIC_VIA_REQUEST", "NODE_ENV",
];

function withEnv(over: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const base: Record<string, string | undefined> = {
    PT_MEDIA_S3_BUCKET: "gymini-user-media",
    PT_MEDIA_S3_ENDPOINT: "http://minio:9000",
    PT_MEDIA_S3_PUBLIC_ENDPOINT: "http://localhost:9000",
    PT_MEDIA_S3_FORCE_PATH_STYLE: "true",
    PT_MEDIA_S3_ACCESS_KEY_ID: "k",
    PT_MEDIA_S3_SECRET_ACCESS_KEY: "s",
    PT_MEDIA_S3_PUBLIC_VIA_REQUEST: "true",
    NODE_ENV: "test",
  };
  Object.assign(process.env, base);
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

/** Runs `fn` inside the request context the middleware would build for these headers. */
function inRequest<T>(headers: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requestContextMiddleware({ headers } as any, {} as any, () => {
      fn().then(resolve, reject);
    });
  });
}

const viaGateway = { "x-gateway-secret": DEV_SECRET, "x-public-base-url": TUNNEL };

test("through the gateway with the flag on: read link and upload target are signed for the tunnel (path style)", async () => {
  await withEnv({}, async () => {
    const { url, link, upload } = await inRequest(viaGateway, async () => ({
      url: "",
      link: await s3PtMediaStorage.presignGet({ key: "pt/a.png", contentType: "image/png" }),
      upload: await s3PtMediaStorage.presignUpload({ key: "pt/a.png", contentType: "image/png", maxBytes: 1000 }),
    }));
    void url;
    assert.ok(link.startsWith(`${TUNNEL}/gymini-user-media/pt/a.png?`), link);
    assert.equal(upload.url, `${TUNNEL}/gymini-user-media`);
  });
});

test("flag on but NO gateway secret (or a wrong one): the header is ignored, the fixed public endpoint is used", async () => {
  await withEnv({}, async () => {
    for (const headers of [{ "x-public-base-url": TUNNEL } as Record<string, string>, { "x-gateway-secret": "nope", "x-public-base-url": TUNNEL }]) {
      const link = await inRequest(headers, () => s3PtMediaStorage.presignGet({ key: "pt/a.png" }));
      assert.ok(link.startsWith("http://localhost:9000/gymini-user-media/pt/a.png?"), link);
    }
  });
});

test("flag off: always the fixed public endpoint, even through the gateway", async () => {
  await withEnv({ PT_MEDIA_S3_PUBLIC_VIA_REQUEST: undefined }, async () => {
    const link = await inRequest(viaGateway, () => s3PtMediaStorage.presignGet({ key: "pt/a.png" }));
    assert.ok(link.startsWith("http://localhost:9000/gymini-user-media/pt/a.png?"), link);
  });
});

test("production ignores the flag", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const link = await inRequest(viaGateway, () => s3PtMediaStorage.presignGet({ key: "pt/a.png" }));
    assert.ok(link.startsWith("http://localhost:9000/gymini-user-media/pt/a.png?"), link);
  });
});

test("no request context (a job, a test): the fixed public endpoint", async () => {
  await withEnv({}, async () => {
    assert.equal(currentPublicBaseUrl(), undefined);
    const link = await s3PtMediaStorage.presignGet({ key: "pt/a.png" });
    assert.ok(link.startsWith("http://localhost:9000/gymini-user-media/pt/a.png?"), link);
  });
});

test("a malformed x-public-base-url (path, spaces) is dropped even from the gateway", async () => {
  await withEnv({}, async () => {
    for (const bad of ["https://evil.example/path", "javascript:alert(1)", "https://a b"]) {
      const seen = await inRequest({ "x-gateway-secret": DEV_SECRET, "x-public-base-url": bad }, async () => currentPublicBaseUrl());
      assert.equal(seen, undefined, bad);
    }
  });
});
