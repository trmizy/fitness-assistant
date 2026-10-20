/**
 * V-T001.1 — runtime log hygiene. A child Node process loads the REAL @gym-coach/shared singleton
 * (compiled dist), the REAL user-service and auth-service apps, the installed pino-http and a
 * real axios.AxiosError, drives them with SYNTHETIC credentials only, and the parent inspects the
 * child's actual stdout. No AWS, no DB, no real secrets or documents.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SERVICE_DIR = path.resolve(__dirname, "..", "..");
const TSX_CJS = require.resolve("tsx/cjs");

const PROBE = `
const http = require("http");
const express = require("express");
const pino = require("pino");
const pinoHttp = require("pino-http");
const axios = require("axios");
const { logger, httpLogSerializers } = require("@gym-coach/shared");
const userApp = require("./src/app.ts").default;
const authApp = require("../auth-service/src/app.ts").default;
const { toSignedPtDocumentUrl } = require("./src/utils/ptDocumentUrl.util.ts");
const listen = (app) => new Promise((r) => { const s = http.createServer(app); s.listen(0, "127.0.0.1", () => r(s)); });
const close = (s) => new Promise((r) => s.close(r));
(async () => {
  const out = {};
  const user = await listen(userApp);
  const auth = await listen(authApp);
  const U = "http://127.0.0.1:" + user.address().port;
  const A = "http://127.0.0.1:" + auth.address().port;
  const H = { Authorization: "Bearer SYN_AUTH", Cookie: "SYN_COOKIE", "X-Service-Secret": "SYN_SERVICE_SECRET", "x-internal-token": "SYN_INTERNAL_TOKEN", "x-internal-secret": "SYN_INTERNAL_SECRET", "x-gateway-secret": "SYN_GATEWAY", "x-api-key": "SYN_APIKEY" };
  out.authStatus = (await fetch(A + "/health", { headers: H })).status;
  out.userStatus = (await fetch(U + "/health", { headers: H })).status;
  const signed = toSignedPtDocumentUrl("/uploads/pt-applications/SYN_NONEXISTENT.png");
  out.signedSig = new URL(signed, "http://x").searchParams.get("sig");
  out.documentStatus = (await fetch(U + signed)).status;

  const mk = (log) => { const a = express(); a.use(pinoHttp(log)); a.get("/r", (_q, res) => { res.setHeader("Set-Cookie", "s=SYN_SET_COOKIE"); res.redirect(302, "https://synthetic.invalid/document?sig=SYN_SIGNED_LOCATION"); }); a.get("/p", (_q, res) => res.json({ ok: 1 })); return a; };
  const probe = await listen(mk({ logger, serializers: httpLogSerializers }));
  const P = "http://127.0.0.1:" + probe.address().port;
  const r = await fetch(P + "/r?sig=SYN_REQ_QUERY&exp=1", { redirect: "manual" });
  out.locationSent = r.headers.get("location");
  await fetch(P + "/p", { headers: { "X-Api-Key": "SYN_MIXED_CASE_APIKEY" } });

  const cfg = (tag) => ({ headers: { Authorization: "SYN_" + tag + "_AUTH", Cookie: "SYN_" + tag + "_COOKIE", "Set-Cookie": "SYN_" + tag + "_SETCOOKIE", "x-gateway-secret": "SYN_" + tag + "_GW", "x-api-key": "SYN_" + tag + "_KEY", "x-service-secret": "SYN_" + tag + "_SVC", "x-internal-token": "SYN_" + tag + "_INT" }, data: "SYN_" + tag + "_BODY_PASSWORD", url: "/x?token=SYN_" + tag + "_URLTOKEN" });
  const plain = new Error("downstream failed"); plain.config = cfg("PLAIN_CFG"); plain.response = { status: 502, config: cfg("PLAIN_RESP") };
  logger.error(plain, "bare plain");
  logger.error({ err: plain }, "wrapped plain");
  const real = new axios.AxiosError("real axios failure", "ERR_BAD_RESPONSE", cfg("REAL_CFG"), { _header: "SYN_REAL_REQUEST_HEADER" }, { status: 503, statusText: "Service Unavailable", data: "SYN_RESPONSE_DATA", config: cfg("REAL_RESP") });
  logger.error(real, "bare real axios");
  logger.error({ err: real }, "wrapped real axios");
  logger.info({ request: { headers: { Authorization: "SYN_EXPLICIT_AUTH", "X-Service-Secret": "SYN_EXPLICIT_SVC" } } }, "explicit request-shaped");

  const bare = pino({ base: { neg: true } }); // NEGATIVE CONTROL: no redaction, default pino-http serializers
  const neg = await listen(mk({ logger: bare }));
  await fetch("http://127.0.0.1:" + neg.address().port + "/r?sig=SYN_NEG_QUERY", { redirect: "manual", headers: { "x-service-secret": "SYN_NEG_SERVICE" } });
  bare.error(real, "negative control");

  await Promise.all([close(user), close(auth), close(probe), close(neg)]);
  await new Promise((r) => setTimeout(r, 300));
  console.log("PROBE_SUMMARY " + JSON.stringify(out));
})().catch((e) => { console.log("PROBE_ERROR " + e.stack); process.exitCode = 1; });
`;

function runProbe() {
  const res = spawnSync(process.execPath, ["-r", TSX_CJS, "-e", PROBE], {
    cwd: SERVICE_DIR,
    encoding: "utf8",
    timeout: 90_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      INTERNAL_SERVICE_SECRET: "SYN_INTERNAL_SERVICE_SECRET",
      PT_DOCUMENT_URL_SECRET: "SYN_DOC_SIGNING_KEY_0123456789abcdef0123456789",
      JWT_SECRET: "SYN_JWT",
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/none?connect_timeout=1",
      AWS_LAMBDA_FUNCTION_NAME: "SYN_LOCAL_NO_AWS",
      AWS_EC2_METADATA_DISABLED: "true",
    },
  });
  assert.equal(res.status, 0, `probe exited ${res.status}: ${res.stderr}\n${res.stdout.slice(-2000)}`);
  const lines = res.stdout.split("\n").filter(Boolean);
  const summaryLine = lines.find((l) => l.startsWith("PROBE_SUMMARY "));
  assert.ok(summaryLine, "probe summary missing: " + res.stdout.slice(-1500));
  const summary = JSON.parse(summaryLine!.slice("PROBE_SUMMARY ".length));
  const logLines = lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  // The negative-control logger is the only producer of its marker; everything else is protected.
  const protectedRaw = lines.filter((l) => l.startsWith("{") && !l.includes('"neg":true')).join("\n");
  return { summary, logLines, protectedRaw, allRaw: res.stdout + res.stderr };
}

const probe = runProbe();

test("TEST A — x-service-secret (any casing) and other internal credential headers never reach the real singleton's output; auth behaviour unchanged", () => {
  for (const marker of ["SYN_SERVICE_SECRET", "SYN_INTERNAL_SERVICE_SECRET", "SYN_INTERNAL_TOKEN", "SYN_INTERNAL_SECRET", "SYN_GATEWAY", "SYN_APIKEY", "SYN_AUTH", "SYN_COOKIE", "SYN_MIXED_CASE_APIKEY"]) {
    assert.ok(!probe.protectedRaw.includes(marker), `${marker} leaked`);
  }
  assert.equal(probe.summary.authStatus, 200);
  assert.equal(probe.summary.userStatus, 200);
});

test("TEST B — a real signed PT document URL's signature is absent from logs; request still handled as before", () => {
  assert.ok(probe.summary.signedSig && probe.summary.signedSig.length > 10);
  assert.ok(!probe.protectedRaw.includes(probe.summary.signedSig), "document signature leaked");
  assert.equal(probe.summary.documentStatus, 404, "nonexistent synthetic document keeps its normal 404");
  const line = probe.logLines.find((l: any) => l.req?.url?.startsWith("/pt-applications/documents/"));
  assert.ok(line, "request still logged");
  assert.match(line.req.url, /\?exp=\[REDACTED\]&sig=\[REDACTED\]$/);
});

test("TEST C — logged Location is sanitized while the Location actually sent is unchanged", () => {
  assert.equal(probe.summary.locationSent, "https://synthetic.invalid/document?sig=SYN_SIGNED_LOCATION");
  assert.ok(!probe.protectedRaw.includes("SYN_SIGNED_LOCATION"));
  assert.ok(!probe.protectedRaw.includes("SYN_REQ_QUERY"));
  const line = probe.logLines.find((l: any) => l.req?.url?.startsWith("/r"));
  assert.ok(line);
  assert.equal(line.res.statusCode, 302);
  assert.equal(line.res.headers.location, "https://synthetic.invalid/document?sig=[REDACTED]");
  assert.equal(line.res.headers["set-cookie"], "[REDACTED]");
});

test("TEST D/E — err.config.headers and err.response.config.headers (plain and real AxiosError, bare and wrapped) leak nothing", () => {
  for (const tag of ["PLAIN_CFG", "PLAIN_RESP", "REAL_CFG", "REAL_RESP"]) {
    assert.ok(!probe.protectedRaw.includes(`SYN_${tag}_`), `${tag} credential/body/url token leaked`);
  }
  for (const marker of ["SYN_REAL_REQUEST_HEADER", "SYN_RESPONSE_DATA"]) {
    assert.ok(!probe.protectedRaw.includes(marker), `${marker} leaked`);
  }
  const real = probe.logLines.filter((l: any) => l.msg === "bare real axios" || l.msg === "wrapped real axios");
  assert.equal(real.length, 2);
  for (const l of real) {
    assert.equal(l.err.name ?? l.err.type, "AxiosError");
    assert.equal(l.err.code, "ERR_BAD_RESPONSE");
    assert.equal(l.err.response?.status ?? l.err.status, 503);
    assert.equal(l.err.config.headers.Authorization, "[REDACTED]");
    assert.equal(l.err.config.headers["x-service-secret"], "[REDACTED]");
  }
});

test("TEST F — explicit request-shaped objects with mixed-case headers are redacted", () => {
  assert.ok(!probe.protectedRaw.includes("SYN_EXPLICIT_"));
});

test("TEST G — operational metadata stays usable", () => {
  const line = probe.logLines.find((l: any) => l.req?.url === "/p");
  assert.ok(line);
  assert.equal(line.req.method, "GET");
  assert.ok(line.req.id !== undefined);
  assert.equal(line.res.statusCode, 200);
  assert.equal(typeof line.responseTime, "number");
  assert.equal(line.req.headers["x-api-key"], "[REDACTED]");
  const err = probe.logLines.find((l: any) => l.msg === "bare plain");
  assert.equal(err.err.message, "downstream failed");
  assert.equal(err.err.type, "Error");
  assert.equal(err.err.response.status, 502);
});

test("TEST H — negative control: the same probe with an unprotected logger DOES leak, so the assertions above can fail", () => {
  assert.ok(probe.allRaw.includes("SYN_NEG_SERVICE"), "unprotected pino-http leaks the service header");
  assert.ok(probe.allRaw.includes("SYN_NEG_QUERY"), "unprotected pino-http leaks the query");
  assert.ok(probe.allRaw.includes("SYN_REAL_CFG_AUTH") || probe.allRaw.includes("SYN_REAL_REQUEST_HEADER"), "unprotected pino leaks axios metadata");
});
