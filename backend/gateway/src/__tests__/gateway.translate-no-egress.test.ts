/**
 * POST /translate must not reach out to any third-party service unless the operator configured
 * TRANSLATE_API_URL. Without it the route returns the source text in the legacy fallback shape
 * ({ translatedText, fallback: true }); with it, behaviour is unchanged (provider is called).
 * Evidence label: BACKEND INTEGRATION (real gateway app; outbound HTTP spied, local stub provider only).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import axios from "axios";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-translate-no-egress-test";

let server: http.Server;
let base = "";
let stub: http.Server;
let stubBase = "";
const stubHits: Array<{ url: string; body: any }> = [];
const outbound: string[] = [];

const realHttpRequest = http.request;
const realHttpsRequest = https.request;
const realAxiosPost = axios.post;

function isLoopback(host: unknown): boolean {
  return typeof host === "string" && (host === "127.0.0.1" || host === "localhost" || host === "::1");
}

test.before(async () => {
  stub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      stubHits.push({ url: req.url || "", body: raw ? JSON.parse(raw) : null });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ translatedText: "STUB-TRANSLATED" }));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  stubBase = `http://127.0.0.1:${(stub.address() as any).port}`;

  const { default: app } = await import("../app");
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;

  // Record every outbound request that leaves loopback (http/https modules + axios).
  const wrap = (orig: typeof http.request) =>
    ((...args: any[]) => {
      const a0 = args[0];
      const host = typeof a0 === "string" ? new URL(a0).hostname : a0?.hostname ?? a0?.host ?? a0?.href;
      if (!isLoopback(host)) outbound.push(String(host));
      return (orig as any)(...args);
    }) as typeof http.request;
  (http as any).request = wrap(realHttpRequest);
  (https as any).request = wrap(realHttpsRequest as any);
  (axios as any).post = async (url: string, ...rest: any[]) => {
    try {
      if (!isLoopback(new URL(url).hostname)) outbound.push(url);
    } catch {
      outbound.push(String(url));
    }
    return (realAxiosPost as any).call(axios, url, ...rest);
  };
});

test.after(async () => {
  (http as any).request = realHttpRequest;
  (https as any).request = realHttpsRequest;
  (axios as any).post = realAxiosPost;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

test.beforeEach(() => {
  outbound.length = 0;
  stubHits.length = 0;
  delete process.env.TRANSLATE_API_URL;
  delete process.env.TRANSLATE_API_KEY;
  delete process.env.TRANSLATE_PROVIDER;
});

async function post(body: unknown) {
  const res = await fetch(`${base}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

test("TRANSLATE_API_URL unset: source text returned, no outbound request (default provider)", async () => {
  const res = await post({ text: "Xin chào đồng đội", sourceLang: "vi", targetLang: "en" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { translatedText: "Xin chào đồng đội", fallback: true });
  assert.deepEqual(outbound, []);
});

test("TRANSLATE_API_URL blank/whitespace counts as unset", async () => {
  process.env.TRANSLATE_API_URL = "   ";
  const res = await post({ text: "Tập luyện", sourceLang: "vi", targetLang: "en" });
  assert.deepEqual(res.body, { translatedText: "Tập luyện", fallback: true });
  assert.deepEqual(outbound, []);
});

test("TRANSLATE_PROVIDER=libretranslate with no URL never contacts libretranslate.com", async () => {
  process.env.TRANSLATE_PROVIDER = "libretranslate";
  for (let i = 0; i < 5; i++) {
    const res = await post({ text: `Chuỗi ${i}`, sourceLang: "vi", targetLang: "en" });
    assert.equal(res.status, 200);
    assert.equal(res.body.translatedText, `Chuỗi ${i}`);
  }
  assert.deepEqual(outbound, []);
});

test("same source/target language returns plain { translatedText } with no outbound request", async () => {
  const res = await post({ text: "Hello", sourceLang: "en", targetLang: "en" });
  assert.deepEqual(res.body, { translatedText: "Hello" });
  assert.deepEqual(outbound, []);
});

test("validation errors unchanged (400 INVALID_TEXT)", async () => {
  const res = await post({ text: "", targetLang: "vi" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "INVALID_TEXT");
});

test("TRANSLATE_API_URL configured: provider is called exactly as before and its text returned", async () => {
  process.env.TRANSLATE_API_URL = `${stubBase}/translate`;
  process.env.TRANSLATE_API_KEY = "stub-key";
  const res = await post({ text: "Xin chào", sourceLang: "vi", targetLang: "en" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { translatedText: "STUB-TRANSLATED" });
  assert.equal(stubHits.length, 1);
  assert.equal(stubHits[0].url, "/translate");
  assert.deepEqual(stubHits[0].body, {
    q: "Xin chào",
    source: "vi",
    target: "en",
    format: "text",
    api_key: "stub-key",
  });
  assert.deepEqual(outbound, []);
});
