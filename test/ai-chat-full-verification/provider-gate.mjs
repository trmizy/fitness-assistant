// Provider admission gate for the isolated evaluation stack (V1 RC1 incident follow-up, 2026-11-12).
//
// Incident (rc-verify-v2): the owner authorised 40 provider calls; the stack made 56–57. The old guard read the ai-service's
// own completion telemetry AFTER the fact: it could not stop a call before the network, missed SDK retries (one llm_call line
// per logical call, up to BEDROCK_MAX_ATTEMPTS=3 HTTP attempts), missed calls still in flight, and did not count embeddings.
//
// The gate is the only process that holds real AWS credentials. stack.mjs points the ai-service's Bedrock Runtime client at it
// (AWS_ENDPOINT_URL_BEDROCK_RUNTIME) and gives the ai-service FAKE credentials, so a paid call can only happen through here:
//   1. every HTTP attempt (chat, plan generation, auxiliary, embedding, every SDK retry) is classified and RESERVED
//      synchronously before anything is sent upstream — one process, one counter, so concurrent workers cannot race past it;
//   2. once the call cap or the USD cap (actual + reserved, conservative per-call estimate) would be crossed, or the gate was
//      closed, the request is refused locally with a NON-retryable 403 — it never reaches the network;
//   3. a request the client abandons (timeout / process stop) is NOT aborted upstream: the gate waits for the provider's answer
//      so its usage is still recorded; if the provider never answers in upstreamTimeoutMs it is recorded as UNKNOWN (possibly
//      billed) — never silently dropped;
//   4. settled ⇔ closed and nothing in flight. Quiet logs are not evidence of completion.
// Accounting kept apart: attempts (sent upstream) / refused (never sent) / completed / failed / unknown, provider-reported token
// usage, and a USD ESTIMATE from list prices. None of it is AWS Billing.
//
// LIMIT (stated): this caps calls made through the Bedrock Runtime endpoint of processes started by stack.mjs. A process that
// obtains real credentials some other way is outside it — stack.mjs strips AWS credentials from every child it starts.
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import https from "node:https";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PRICES = { llmIn: 0.0008, llmOut: 0.0032, embedding: 0.0001, charsPerToken: 3, defaultMaxOutTokens: 4096 };

/** Which provider operation a request is. Anything not recognised is refused (fail closed). */
export function classify(method, url) {
  const m = /^\/model\/([^/]+)\/(converse|invoke)$/.exec(String(url).split("?")[0]);
  if (method !== "POST" || !m) return null;
  const modelId = decodeURIComponent(m[1]);
  if (m[2] === "converse") return { kind: "llm", op: "converse", modelId };
  return { kind: /embed/i.test(modelId) ? "embedding" : "llm", op: "invoke", modelId };
}

/** Conservative upper estimate of what one attempt can cost — reserved before sending, replaced by actual usage after. */
export function estimateUsd(cls, body, p = DEFAULT_PRICES) {
  const chars = body ? body.length : 0;
  if (cls.kind === "embedding") return (Math.ceil(chars / p.charsPerToken) / 1000) * p.embedding;
  let maxOut = p.defaultMaxOutTokens;
  try { maxOut = JSON.parse(body.toString("utf8"))?.inferenceConfig?.maxTokens ?? maxOut; } catch { /* keep default */ }
  return (Math.ceil(chars / p.charsPerToken) / 1000) * p.llmIn + (maxOut / 1000) * p.llmOut;
}

/** Provider-reported usage: Bedrock token-count headers first, then the Converse body's `usage`. null = not reported. */
export function readUsage(cls, status, headers, body) {
  if (status < 200 || status >= 300) return null;
  const h = (k) => { const v = headers[k] ?? headers[k.toLowerCase()]; return v == null ? null : Number(v); };
  let inT = h("x-amzn-bedrock-input-token-count"), outT = h("x-amzn-bedrock-output-token-count");
  if (inT == null && cls.op === "converse") {
    try { const u = JSON.parse(body.toString("utf8")).usage; inT = u?.inputTokens ?? null; outT = u?.outputTokens ?? null; } catch { /* none */ }
  }
  return inT == null ? null : { inputTokens: inT, outputTokens: outT ?? 0 };
}

export function usageUsd(cls, usage, p = DEFAULT_PRICES) {
  if (!usage) return null;
  return cls.kind === "embedding" ? (usage.inputTokens / 1000) * p.embedding : (usage.inputTokens / 1000) * p.llmIn + (usage.outputTokens / 1000) * p.llmOut;
}

/**
 * The gate. `upstream(req) → Promise<{status, headers, body}>` is injected (tests use a mock; the CLI signs for Bedrock).
 * Returns { server, state, close(), status() }.
 */
export function createGate({ maxCalls, maxUsd, upstream, prices = DEFAULT_PRICES, upstreamTimeoutMs = 180_000, ledgerPath = null, now = Date.now }) {
  if (!(maxCalls >= 0) || !(maxUsd >= 0)) throw new Error("provider gate needs explicit maxCalls and maxUsd");
  const st = { attempts: 0, refused: 0, completed: 0, failed: 0, unknown: 0, clientAborted: 0, inFlight: 0, closed: false,
    usd: { actual: 0, reserved: 0, unknownUpperBound: 0 }, tokens: { llmIn: 0, llmOut: 0, embeddingIn: 0 }, byKind: { llm: 0, embedding: 0 } };
  const log = (ev) => { if (ledgerPath) fs.appendFileSync(ledgerPath, JSON.stringify({ t: now(), ...ev }) + "\n"); };
  const status = () => ({ ...st, usd: { ...st.usd }, tokens: { ...st.tokens }, byKind: { ...st.byKind }, maxCalls, maxUsd,
    remainingCalls: Math.max(0, maxCalls - st.attempts), settled: st.closed && st.inFlight === 0,
    note: "attempts = HTTP requests sent upstream (each SDK retry counts); refused = never sent; usd = estimate from list prices, not AWS Billing" });

  /** Synchronous admission: decide and reserve in one step, before any await. */
  function admit(cls, body) {
    if (st.closed) return { ok: false, reason: "GATE_CLOSED" };
    if (st.attempts >= maxCalls) return { ok: false, reason: `CALL_LIMIT ${st.attempts}/${maxCalls}` };
    const est = estimateUsd(cls, body, prices);
    if (st.usd.actual + st.usd.reserved + est > maxUsd) return { ok: false, reason: `USD_LIMIT actual ${st.usd.actual.toFixed(4)} + reserved ${st.usd.reserved.toFixed(4)} + next ${est.toFixed(4)} > ${maxUsd}` };
    st.attempts++; st.byKind[cls.kind]++; st.inFlight++; st.usd.reserved += est;
    return { ok: true, est, seq: st.attempts };
  }

  const refuse = (res, reason) => {
    st.refused++;
    log({ ev: "refuse", reason });
    // AccessDeniedException is not retried by the AWS SDK, so a refusal never multiplies into retry attempts.
    res.writeHead(403, { "content-type": "application/json", "x-amzn-errortype": "AccessDeniedException:http://internal.amazon.com/coral/com.amazon.coral.service/" });
    res.end(JSON.stringify({ message: `Evaluation provider gate refused the call before the network: ${reason}` }));
  };

  const handler = (req, res) => {
    if (req.method === "GET" && req.url === "/health") { res.writeHead(200); return res.end("ok"); } // stack.mjs readiness probe
    if (req.url.startsWith("/__gate/")) {
      if (req.method === "GET" && req.url === "/__gate/status") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(status())); }
      if (req.method === "POST" && req.url === "/__gate/close") { st.closed = true; log({ ev: "close" }); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(status())); }
      res.writeHead(404); return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const cls = classify(req.method, req.url);
      if (!cls) return refuse(res, `UNKNOWN_OPERATION ${req.method} ${String(req.url).slice(0, 80)}`);
      const a = admit(cls, body);
      if (!a.ok) return refuse(res, a.reason);
      log({ ev: "reserve", seq: a.seq, kind: cls.kind, modelId: cls.modelId, estUsd: a.est });
      let left = false;
      res.on("close", () => { if (!res.writableFinished) left = true; });
      req.on("aborted", () => { left = true; });
      const gone = () => left || res.destroyed || !!res.stream?.destroyed || !!res.socket?.destroyed;
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), upstreamTimeoutMs); });
      Promise.race([upstream({ method: req.method, path: req.url, headers: req.headers, body, cls }).then((r) => ({ r }), (e) => ({ e })), timeout])
        .then((out) => {
          clearTimeout(timer);
          const clientGone = gone();
          st.inFlight--; st.usd.reserved -= a.est;
          if (out.timedOut) {
            st.unknown++; st.usd.unknownUpperBound += a.est;
            log({ ev: "unknown", seq: a.seq, kind: cls.kind, reason: "no provider answer within upstreamTimeoutMs — possibly billed" });
            if (!clientGone) { res.writeHead(504, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "provider gate: upstream did not answer" })); }
            return;
          }
          if (out.e) {
            st.failed++;
            log({ ev: "fail", seq: a.seq, kind: cls.kind, error: String(out.e?.code ?? out.e?.message ?? out.e).slice(0, 120) });
            if (!clientGone) { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "provider gate: upstream error" })); }
            return;
          }
          const { status: code, headers, body: rb } = out.r;
          const usage = readUsage(cls, code, headers, rb);
          const usd = usageUsd(cls, usage, prices);
          if (code >= 200 && code < 300) {
            st.completed++;
            if (usage) { if (cls.kind === "llm") { st.tokens.llmIn += usage.inputTokens; st.tokens.llmOut += usage.outputTokens; } else st.tokens.embeddingIn += usage.inputTokens; }
            // No usage reported on a success → keep the reservation as the cost (conservative), never zero.
            st.usd.actual += usd ?? a.est;
          } else st.failed++;
          if (clientGone) st.clientAborted++;
          log({ ev: code >= 200 && code < 300 ? "complete" : "fail", seq: a.seq, kind: cls.kind, status: code, usage, usd: usd ?? (code < 300 ? a.est : 0), clientAborted: clientGone });
          if (!clientGone) {
            // hop-by-hop headers are illegal on HTTP/2 and meaningless after buffering
            const pass = {}; for (const [k, v] of Object.entries(headers)) if (!/^(content-length|transfer-encoding|connection|keep-alive|upgrade|proxy-connection|http2-settings)$/i.test(k)) pass[k] = v;
            res.writeHead(code, pass); res.end(rb);
          }
        });
    });
  };

  // The AWS SDK's Bedrock Runtime client speaks HTTP/2 (cleartext h2c to an http:// endpoint); curl/fetch speak HTTP/1.1.
  // One port serves both: the first bytes of a connection decide (HTTP/2 always starts with the "PRI * HTTP/2.0" preface).
  const h1 = http.createServer(handler);
  const h2 = http2.createServer(handler);
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock); sock.on("close", () => sockets.delete(sock));
    sock.once("data", (buf) => {
      sock.pause(); sock.unshift(buf);
      (buf.subarray(0, 3).toString("latin1") === "PRI" ? h2 : h1).emit("connection", sock);
      process.nextTick(() => sock.resume());
    });
  });
  /** Stop listening and drop every open connection (keep-alive sockets would otherwise hold close() forever). */
  const shutdown = () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); });
  return { server, state: st, status, shutdown, close: () => { st.closed = true; } };
}

/**
 * End-of-run verdict. SETTLED only when the gate is closed (nothing new can start), nothing is in flight, and the run's queue
 * is verified empty. A call that never got a provider answer is SETTLED_WITH_UNKNOWN (possibly billed). Anything unverifiable
 * (queue unreadable, gate still open) is UNSETTLED — never assumed settled because logs went quiet.
 */
export function settleVerdict({ gate, queuePending }) {
  const reasons = [];
  if (!gate?.closed) reasons.push("gate still open — new calls could start");
  if ((gate?.inFlight ?? 1) > 0) reasons.push(`${gate?.inFlight ?? "?"} provider call(s) still in flight`);
  if (queuePending == null) reasons.push("run queue state could not be read");
  else if (queuePending > 0) reasons.push(`${queuePending} job(s) still queued in the run's Redis`);
  if (reasons.length) return { verdict: "UNSETTLED", reasons };
  if ((gate.unknown ?? 0) > 0) return { verdict: "SETTLED_WITH_UNKNOWN", reasons: [`${gate.unknown} call(s) got no provider answer — possibly billed`] };
  return { verdict: "SETTLED", reasons: [] };
}

// ── Real upstream: re-sign each request for Bedrock Runtime with the GATE's credentials (SigV4, service "bedrock") ─────────
class NodeSha256 {
  constructor(secret) { this.h = secret ? crypto.createHmac("sha256", secret) : crypto.createHash("sha256"); }
  update(d) { this.h.update(d); }
  digest() { return Promise.resolve(new Uint8Array(this.h.digest())); }
}

/** Builds the upstream function. `credentials` is a provider (async () => creds); signature deps resolve through the SDK. */
export function bedrockUpstream({ region, credentials, aiServiceDir, request = httpsRequest }) {
  const rc = createRequire(createRequire(path.join(aiServiceDir, "package.json")).resolve("@aws-sdk/client-bedrock-runtime"));
  const { SignatureV4 } = createRequire(rc.resolve("@aws-sdk/core"))("@smithy/signature-v4");
  const signer = new SignatureV4({ service: "bedrock", region, credentials, sha256: NodeSha256 });
  const hostname = `bedrock-runtime.${region}.amazonaws.com`;
  return async ({ method, path: p, headers, body }) => {
    const [pathname, query] = String(p).split("?");
    const signed = await signer.sign({
      method, protocol: "https:", hostname, path: pathname,
      query: query ? Object.fromEntries(new URLSearchParams(query)) : undefined,
      headers: { host: hostname, "content-type": headers["content-type"] ?? "application/json", accept: headers.accept ?? "application/json", "content-length": String(body.length) },
      body,
    });
    return request({ hostname, method, path: p, headers: signed.headers, body });
  };
}

function httpsRequest({ hostname, method, path: p, headers, body }) {
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname, method, path: p, headers }, (res) => {
      const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    r.on("error", reject); r.end(body);
  });
}

// ── CLI (started by stack.mjs; the only process given the AWS profile) ─────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const maxCalls = Number(arg("--max-calls")), maxUsd = Number(arg("--max-usd"));
  if (!Number.isFinite(maxCalls) || !Number.isFinite(maxUsd)) { console.error("provider-gate: --max-calls and --max-usd are required"); process.exit(2); }
  const aiServiceDir = path.resolve(arg("--ai-service-dir", "backend/services/ai-service"));
  const rc = createRequire(createRequire(path.join(aiServiceDir, "package.json")).resolve("@aws-sdk/client-bedrock-runtime"));
  const { defaultProvider } = rc("@aws-sdk/credential-provider-node");
  const region = arg("--region", "ap-southeast-1");
  const gate = createGate({ maxCalls, maxUsd, upstream: bedrockUpstream({ region, credentials: defaultProvider(), aiServiceDir }), ledgerPath: arg("--ledger", null), upstreamTimeoutMs: Number(arg("--upstream-timeout-ms", "180000")) });
  const port = Number(arg("--port", "13090"));
  gate.server.listen(port, "127.0.0.1", () => console.log(`provider-gate: 127.0.0.1:${port} maxCalls=${maxCalls} maxUsd=${maxUsd} region=${region}`));
  gate.server.on("error", (e) => { console.error(`provider-gate: ${e.message}`); process.exit(1); });
}
