/**
 * AWS Lambda response-streaming entrypoint for POST /ai/ask/stream only.
 *
 * Handler: dist/stream-lambda.handler, on a SEPARATE function
 * (fitness-assistant-dev-ai-stream) behind a Lambda Function URL with
 * InvokeMode=RESPONSE_STREAM, reached through the frontend CloudFront
 * distribution's `/ai/ask/stream` behavior. lambda.ts (serverless-http behind
 * API Gateway) cannot stream: API Gateway buffers the whole Lambda response.
 *
 * How: the SAME Express `app` the other entrypoints use is started once per
 * cold start on a loopback port, and each invocation is replayed against it as
 * a real HTTP request. Express then writes the SSE events onto a real socket,
 * and the chunked response is piped into Lambda's response stream as it
 * arrives. Every middleware on the route (requireAuth via the Auth Lambda,
 * the per-user rate limiter, body validation, request-identity binding, the
 * forged x-user-id rejection) therefore runs exactly as it does everywhere
 * else — nothing is re-implemented here.
 *
 * Only POST/OPTIONS /ai/ask/stream are accepted. The Function URL is public
 * (AuthType NONE; the Bearer JWT is verified in-app, same as every Lambda
 * behind API Gateway), so every other path is answered 404 here and never
 * reaches the app — the /internal routes and the rest of the AI API stay
 * reachable only through their existing entrypoints.
 *
 * This entrypoint does NOT call markResponseTransportBuffered(): the transport
 * is live, so the typing-effect pacing and the SSE heartbeat stay on.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import type { Context, LambdaFunctionURLEvent } from "aws-lambda";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";
import { ensureVectorStoreChecked } from "./config/lambda-vector-store-check";

export const STREAM_PATH = "/ai/ask/stream";

/** Request headers never replayed onto the loopback request (hop-by-hop / recomputed). */
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "content-length",
  "transfer-encoding",
  "upgrade",
]);

/** Response headers Lambda's HTTP framing owns — never copied into the stream prelude. */
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
]);

type ResponseStreamFactory = (
  responseStream: Writable,
  metadata: { statusCode: number; headers: Record<string, string> },
) => Writable;

export interface StreamHandlerDeps {
  /** Resolves the loopback port the Express app listens on (started once). */
  getPort: () => Promise<number>;
  /** Called before each forwarded request (vector-store availability probe). */
  beforeRequest: () => Promise<void>;
  /** awslambda.HttpResponseStream.from — injected so tests run without the Lambda runtime. */
  fromStream: ResponseStreamFactory;
}

/**
 * Must be awaited: if the handler returns before the response stream has
 * finished, the Lambda runtime closes the invocation without a complete
 * response and the Function URL answers 502 (observed live on the first
 * deploy for the 404 path).
 */
async function writeJson(
  deps: StreamHandlerDeps,
  responseStream: Writable,
  statusCode: number,
  body: Record<string, unknown>,
): Promise<void> {
  const stream = deps.fromStream(responseStream, {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  // write() then end(): the response prelude must go out with a write, a bare end(chunk) on a
  // fresh HttpResponseStream answered 502 live.
  stream.write(JSON.stringify(body));
  stream.end();
  await finished(stream);
}

function requestHeaders(event: LambdaFunctionURLEvent, bodyLength: number): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value === undefined || DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    headers[name.toLowerCase()] = value;
  }
  if (bodyLength > 0) headers["content-length"] = String(bodyLength);
  return headers;
}

function responseHeaders(incoming: http.IncomingHttpHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name)) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

export function createStreamHandler(deps: StreamHandlerDeps) {
  return async (
    event: LambdaFunctionURLEvent,
    responseStream: Writable,
    context?: Context,
  ): Promise<void> => {
    // The loopback HTTP server, the Prisma pool and the SDK keep-alive sockets keep the event
    // loop busy forever; without this the invocation only ends at the function timeout (observed
    // live: a 401 delivered in 3 s still billed 90 s and held one of the account's 10 slots).
    if (context) context.callbackWaitsForEmptyEventLoop = false;

    const method =(event.requestContext?.http?.method ?? "GET").toUpperCase();
    const path = event.rawPath ?? "/";
    if (path !== STREAM_PATH || (method !== "POST" && method !== "OPTIONS")) {
      await writeJson(deps, responseStream, 404, { error: "NOT_FOUND" });
      return;
    }

    let port: number;
    try {
      port = await deps.getPort();
      await deps.beforeRequest();
    } catch (err) {
      console.error("[ai-stream] app startup failed", err);
      await writeJson(deps, responseStream, 503, { error: "SERVICE_UNAVAILABLE" });
      return;
    }

    const body = event.body
      ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
      : Buffer.alloc(0);
    const query = event.rawQueryString ? `?${event.rawQueryString}` : "";

    const upstream = await new Promise<http.IncomingMessage | Error>((resolve) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path: `${path}${query}`,
          headers: requestHeaders(event, body.length),
          // One-shot connection: nothing pooled is left open between invocations.
          agent: false,
        },
        resolve,
      );
      req.on("error", resolve);
      req.end(body);
    });

    if (upstream instanceof Error) {
      console.error("[ai-stream] loopback request failed", upstream);
      await writeJson(deps, responseStream, 502, { error: "BAD_GATEWAY" });
      return;
    }

    const stream = deps.fromStream(responseStream, {
      statusCode: upstream.statusCode ?? 502,
      headers: responseHeaders(upstream.headers),
    });
    try {
      await pipeline(upstream, stream);
    } catch (err) {
      // Status and headers are already out; all that is left is to record it.
      console.error("[ai-stream] response pipe failed", err);
    }
  };
}

let portPromise: Promise<number> | null = null;

/**
 * `./app` is imported lazily, AFTER DATABASE_URL has been resolved from
 * Secrets Manager — same ordering constraint as lambda.ts (Prisma rejects an
 * unset DATABASE_URL at construction time). A failed start is not cached, so
 * the next invocation retries instead of the container staying broken.
 */
function startApp(): Promise<number> {
  portPromise ??= (async () => {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    const { default: app } = await import("./app");
    const server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    return (server.address() as AddressInfo).port;
  })().catch((err) => {
    portPromise = null;
    throw err;
  });
  return portPromise;
}

// Only the real Node.js Lambda runtime provides streamifyResponse; a partial
// `awslambda` global can exist elsewhere (tests), so check the function itself.
const maybeRuntime = (globalThis as { awslambda?: Partial<typeof awslambda> }).awslambda;
const lambdaRuntime =
  typeof maybeRuntime?.streamifyResponse === "function" ? (maybeRuntime as typeof awslambda) : undefined;

const streamHandler = createStreamHandler({
  getPort: startApp,
  beforeRequest: ensureVectorStoreChecked,
  fromStream: (responseStream, metadata) => {
    if (!lambdaRuntime) throw new Error("awslambda runtime global is not available");
    return lambdaRuntime.HttpResponseStream.from(responseStream, metadata);
  },
});

/** Wrapped only inside the Lambda runtime, where the `awslambda` global exists. */
export const handler = lambdaRuntime
  ? lambdaRuntime.streamifyResponse(streamHandler)
  : streamHandler;
