import axios from "axios";
import { randomUUID } from "crypto";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { logger } from "@gym-coach/shared";

/**
 * Single point of contact for every call user-service makes to auth-service. Two transports:
 *
 *   A. AWS Lambda runtime (AUTH_LAMBDA_NAME is set): invoke fitness-assistant-dev-auth directly
 *      via the Lambda API, never through the public API Gateway. This is what lets
 *      /auth/internal/* stay unreachable from the internet — those routes are never registered
 *      on any API Gateway, only reachable by a service that can call lambda:InvokeFunction on
 *      this exact function.
 *   B. local/Docker development (AUTH_LAMBDA_NAME unset): the existing AUTH_SERVICE_URL HTTP
 *      call, byte-for-byte what every call site already did before this file existed. This
 *      path is untouched axios — no behavior change for local dev.
 *
 * Every method returns `{ status, data }` on a 2xx response — the same shape callers already
 * destructure from `axios.post(...)` (`const { data } = await ...`). On failure it throws:
 *   - AuthServiceUnavailableError — auth-service could not be reached at all (HTTP: connection
 *     refused/timeout/DNS; Lambda: SDK error, FunctionError, or a malformed/missing payload).
 *     Mirrors the existing GymServiceUnavailableError pattern in clients/gym.client.ts.
 *   - a plain Error with `.response = { status, data }` attached (axios-error-shaped) when
 *     auth-service was reached and answered with a non-2xx status — so every existing
 *     `catch (e) { const status = e?.response?.status; ... }` call site keeps working exactly
 *     as it did against real axios errors, with zero changes to that logic.
 */

// Read fresh from process.env on every call rather than captured once at module-load time —
// matches config/lambda-runtime.ts's own established pattern in this codebase. Matters for two
// real reasons, not just test convenience: a warm Lambda execution environment must not get
// stuck on whatever these were on a previous cold start if they're ever changed, and this file
// gets imported exactly once per process either way (module caching), so a captured constant
// would never re-read at all.
function authLambdaName(): string | undefined {
  return process.env.AUTH_LAMBDA_NAME;
}
function authServiceUrl(): string {
  return process.env.AUTH_SERVICE_URL || "http://localhost:3001";
}
function internalServiceSecret(): string {
  return process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";
}

const DEFAULT_TIMEOUT_MS = 5000;

export class AuthServiceUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`auth-service unreachable: ${(cause as Error)?.message ?? cause}`);
    this.name = "AuthServiceUnavailableError";
  }
}

let lambdaClient: LambdaClient | null = null;
function getLambdaClient(): LambdaClient {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION });
  }
  return lambdaClient;
}

type Result = { status: number; data: any };

function throwAxiosShapedError(status: number, data: any): never {
  throw Object.assign(new Error(`auth-service responded ${status}`), { response: { status, data } });
}

/**
 * Builds the minimum API Gateway HTTP API v2.0 proxy event auth-service's serverless-http
 * adapter (dist/lambda.handler) needs to route the request exactly like a normal HTTP call —
 * same shape verified against the real deployed auth Lambda (see
 * docs/aws-deployment and the auth-lambda.zip build's own handler tests). No cookies field:
 * auth-service never sets or reads cookies (Bearer-token only).
 */
function buildHttpApiV2Event(params: {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}) {
  const { method, path, headers, body } = params;
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers,
    requestContext: {
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "user-service-lambda-invoke/1.0",
      },
      requestId: randomUUID(),
      stage: "$default",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  };
}

async function invokeAuthLambda(params: {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}): Promise<Result> {
  const event = buildHttpApiV2Event(params);

  let response;
  try {
    response = await getLambdaClient().send(
      new InvokeCommand({
        FunctionName: authLambdaName(),
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(event)),
      }),
      { abortSignal: AbortSignal.timeout(params.timeoutMs) },
    );
  } catch (err) {
    // SDK-level failure: permissions, network, function not found, timeout, etc. Never log the
    // event body (may carry an Authorization header) — just the transport failure itself.
    logger.warn({ err: (err as Error)?.message, path: params.path }, "auth Lambda invoke failed");
    throw new AuthServiceUnavailableError(err);
  }

  if (response.FunctionError) {
    // The Lambda itself threw an unhandled exception (cold-start config failure, etc.) rather
    // than auth-service's own Express error handling answering normally. Payload here is
    // {errorType, errorMessage, trace} — never surfaced to callers/logs since it can leak
    // implementation details; the transport-failure classification is what matters to callers.
    logger.warn({ path: params.path }, "auth Lambda returned a FunctionError");
    throw new AuthServiceUnavailableError(new Error("auth Lambda FunctionError"));
  }

  if (!response.Payload || response.Payload.length === 0) {
    throw new AuthServiceUnavailableError(new Error("auth Lambda returned no Payload"));
  }

  let envelope: { statusCode?: number; body?: string; headers?: Record<string, string> };
  try {
    envelope = JSON.parse(Buffer.from(response.Payload).toString("utf8"));
  } catch (err) {
    throw new AuthServiceUnavailableError(new Error("auth Lambda payload was not valid JSON"));
  }

  if (typeof envelope.statusCode !== "number") {
    throw new AuthServiceUnavailableError(new Error("auth Lambda payload missing statusCode"));
  }

  let data: any = undefined;
  if (envelope.body !== undefined && envelope.body !== null && envelope.body !== "") {
    try {
      data = JSON.parse(envelope.body);
    } catch {
      // Non-JSON body — pass it through as-is rather than treating a 2xx with a plain-text
      // body as a transport failure.
      data = envelope.body;
    }
  }

  if (envelope.statusCode >= 200 && envelope.statusCode < 300) {
    return { status: envelope.statusCode, data };
  }
  throwAxiosShapedError(envelope.statusCode, data);
}

async function callHttp(params: {
  method: "get" | "post" | "patch";
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}): Promise<Result> {
  try {
    const { method, path, headers, body, timeoutMs } = params;
    const url = `${authServiceUrl()}${path}`;
    const { status, data } =
      method === "get"
        ? await axios.get(url, { headers, timeout: timeoutMs })
        : await axios[method](url, body ?? {}, { headers, timeout: timeoutMs });
    return { status, data };
  } catch (err: any) {
    if (axios.isAxiosError(err) && err.response) {
      // auth-service answered with a non-2xx status — not a transport failure. Preserve the
      // exact axios error shape (`.response.status` / `.response.data`) callers already check.
      throw err;
    }
    // No response at all: ECONNREFUSED, ETIMEDOUT, DNS failure, etc.
    throw new AuthServiceUnavailableError(err);
  }
}

async function call(params: {
  method: "get" | "post" | "patch";
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<Result> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (authLambdaName()) {
    return invokeAuthLambda({
      method: params.method.toUpperCase(),
      path: params.path,
      headers: params.headers,
      body: params.body,
      timeoutMs,
    });
  }
  return callHttp({ ...params, timeoutMs });
}

export const authServiceClient = {
  /** POST /auth/verify — forwards the caller's own Authorization header verbatim. */
  verifyToken(authorizationHeader: string, opts?: { timeoutMs?: number }): Promise<Result> {
    return call({
      method: "post",
      path: "/auth/verify",
      headers: { Authorization: authorizationHeader },
      body: {},
      timeoutMs: opts?.timeoutMs,
    });
  },

  /** GET /auth/internal/* — attaches x-service-secret. */
  internalGet(path: string, opts?: { timeoutMs?: number }): Promise<Result> {
    return call({
      method: "get",
      path,
      headers: { "x-service-secret": internalServiceSecret() },
      timeoutMs: opts?.timeoutMs,
    });
  },

  /** POST /auth/internal/* — attaches x-service-secret. */
  internalPost(path: string, body: unknown, opts?: { timeoutMs?: number }): Promise<Result> {
    return call({
      method: "post",
      path,
      headers: { "x-service-secret": internalServiceSecret() },
      body,
      timeoutMs: opts?.timeoutMs,
    });
  },

  /** PATCH /auth/internal/* — attaches x-service-secret. */
  internalPatch(path: string, body: unknown, opts?: { timeoutMs?: number }): Promise<Result> {
    return call({
      method: "patch",
      path,
      headers: { "x-service-secret": internalServiceSecret() },
      body,
      timeoutMs: opts?.timeoutMs,
    });
  },
};
