/**
 * stream-lambda.ts — the response-streaming entrypoint for POST /ai/ask/stream.
 *
 * Drives createStreamHandler with a real loopback HTTP server standing in for
 * the Express app and a fake `HttpResponseStream.from` (the Lambda runtime
 * global is absent in tests). Proves: chunks reach the response stream while
 * the upstream response is still open (live, not buffered); only POST/OPTIONS
 * /ai/ask/stream are forwarded; request headers/body are replayed without
 * hop-by-hop headers; startup and loopback failures answer 503/502.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { createStreamHandler, STREAM_PATH } from "../stream-lambda";

type Captured = {
  metadata?: { statusCode: number; headers: Record<string, string> };
  chunks: { at: number; text: string }[];
  done: boolean;
  ended: Promise<void>;
};

function capture(): { fromStream: any; captured: Captured } {
  let markEnded!: () => void;
  const captured: Captured = { chunks: [], done: false, ended: new Promise((r) => (markEnded = r)) };
  const fromStream = (_rs: Writable, metadata: Captured["metadata"]) => {
    captured.metadata = metadata;
    return new Writable({
      write(chunk, _enc, cb) {
        captured.chunks.push({ at: Date.now(), text: chunk.toString() });
        cb();
      },
      final(cb) {
        captured.done = true;
        markEnded();
        cb();
      },
    });
  };
  return { fromStream, captured };
}

function event(overrides: Record<string, unknown> = {}): any {
  return {
    rawPath: STREAM_PATH,
    rawQueryString: "",
    headers: {
      host: "abc.lambda-url.ap-southeast-1.on.aws",
      authorization: "Bearer token-1",
      "content-type": "application/json",
      connection: "keep-alive",
    },
    body: JSON.stringify({ question: "Tập chân?" }),
    isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
    ...overrides,
  };
}

async function startUpstream(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { port: (server.address() as AddressInfo).port, close: () => server.close() };
}

test("streams upstream chunks live, before the upstream response ends", async () => {
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((r) => (releaseSecond = r));
  const upstream = await startUpstream(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.write('data: {"type":"status","message":"a"}\n\n');
    await secondGate;
    res.end('data: {"type":"done"}\n\n');
  });
  const { fromStream, captured } = capture();
  const handler = createStreamHandler({
    getPort: async () => upstream.port,
    beforeRequest: async () => {},
    fromStream,
  });

  const run = handler(event(), new Writable({ write: (_c, _e, cb) => cb() }));
  // The first event must arrive while the upstream is still holding the response open.
  for (let i = 0; i < 100 && captured.chunks.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(captured.chunks.length, 1, "first chunk should be forwarded before upstream ends");
  assert.match(captured.chunks[0].text, /"status"/);
  releaseSecond();
  await run;
  await captured.ended;

  assert.equal(captured.metadata?.statusCode, 200);
  assert.equal(captured.metadata?.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.equal(captured.metadata?.headers["transfer-encoding"], undefined);
  assert.match(captured.chunks.map((c) => c.text).join(""), /"done"/);
  upstream.close();
});

test("replays method, path, query, auth header and body; drops host/connection", async () => {
  let seen: { method?: string; url?: string; headers?: http.IncomingHttpHeaders; body?: string } = {};
  const upstream = await startUpstream((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = { method: req.method, url: req.url, headers: req.headers, body };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end("data: {}\n\n");
    });
  });
  const { fromStream } = capture();
  const handler = createStreamHandler({ getPort: async () => upstream.port, beforeRequest: async () => {}, fromStream });
  const payload = JSON.stringify({ question: "Ăn gì?" });

  await handler(
    event({ rawQueryString: "x=1", body: Buffer.from(payload).toString("base64"), isBase64Encoded: true }),
    new Writable({ write: (_c, _e, cb) => cb() }),
  );

  assert.equal(seen.method, "POST");
  assert.equal(seen.url, `${STREAM_PATH}?x=1`);
  assert.equal(seen.headers?.authorization, "Bearer token-1");
  assert.equal(seen.headers?.host, `127.0.0.1:${upstream.port}`);
  assert.equal(seen.headers?.["content-length"], String(Buffer.byteLength(payload)));
  assert.equal(seen.body, payload);
  upstream.close();
});

test("any other path or method is 404 and never reaches the app", async () => {
  let started = 0;
  for (const ev of [
    event({ rawPath: "/internal/personalized-service/orders/1/activate-after-payment" }),
    event({ rawPath: "/ai/ask" }),
    event({ requestContext: { http: { method: "GET" } } }),
  ]) {
    const { fromStream, captured } = capture();
    const handler = createStreamHandler({
      getPort: async () => {
        started++;
        return 1;
      },
      beforeRequest: async () => {},
      fromStream,
    });
    await handler(ev, new Writable({ write: (_c, _e, cb) => cb() }));
    assert.equal(captured.metadata?.statusCode, 404);
    assert.equal(captured.done, true, "the 404 body must be fully ended before the handler resolves");
  }
  assert.equal(started, 0);
});

test("app startup failure answers 503", async () => {
  const { fromStream, captured } = capture();
  const handler = createStreamHandler({
    getPort: async () => {
      throw new Error("secret unavailable");
    },
    beforeRequest: async () => {},
    fromStream,
  });
  await handler(event(), new Writable({ write: (_c, _e, cb) => cb() }));
  assert.equal(captured.metadata?.statusCode, 503);
});

test("loopback connection failure answers 502", async () => {
  const dead = await startUpstream(() => {});
  dead.close();
  const { fromStream, captured } = capture();
  const handler = createStreamHandler({ getPort: async () => dead.port, beforeRequest: async () => {}, fromStream });
  await handler(event(), new Writable({ write: (_c, _e, cb) => cb() }));
  assert.equal(captured.metadata?.statusCode, 502);
});

test("invocation does not wait for an empty event loop (loopback server stays open)", async () => {
  const { fromStream } = capture();
  const handler = createStreamHandler({ getPort: async () => 1, beforeRequest: async () => {}, fromStream });
  const context: any = { callbackWaitsForEmptyEventLoop: true };
  await handler(event({ rawPath: "/nope" }), new Writable({ write: (_c, _e, cb) => cb() }), context);
  assert.equal(context.callbackWaitsForEmptyEventLoop, false);
});
