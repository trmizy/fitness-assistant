import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { InvocationType, InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

/**
 * user-service → gym-service / payment-service on AWS Lambda.
 *
 * On Lambda there is no internal HTTP between services (there is no gateway, and API Gateway exposes no
 * `/internal/*` routes), so `GYM_SERVICE_URL` / `PAYMENT_SERVICE_URL` can never work there. gym-service,
 * fitness-service and chat-service already solve this by invoking the target Lambda directly with an
 * API-Gateway-v2-shaped event (`invokeHttpLambda`). user-service had no such client, so every call to gym or
 * payment (gym-options, PT contract checkout, release/no-show money steps, dispute evidence…) failed.
 *
 * Instead of rewriting ~30 call sites, a base URL is resolved with `serviceBaseUrl()`: when `<KIND>_LAMBDA_NAME`
 * is set it returns `lambda://<function-name>`, otherwise the usual `<KIND>_SERVICE_URL` (dev / compose / tests
 * are unchanged). A request interceptor on the shared axios instance swaps in `lambdaAdapter` for those URLs only,
 * so callers keep `axios.get/post`, their headers, params, timeouts and `err.response.status` handling.
 */

const LAMBDA_SCHEME = "lambda://";

let lambdaClient: LambdaClient | null = null;
function getLambdaClient(): LambdaClient {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION });
  }
  return lambdaClient;
}

/** `lambda://<function>` when `<KIND>_LAMBDA_NAME` is set (AWS), else `<KIND>_SERVICE_URL` / the given default. */
export function serviceBaseUrl(kind: "GYM" | "PAYMENT", fallback: string, env: NodeJS.ProcessEnv = process.env): string {
  const fn = env[`${kind}_LAMBDA_NAME`];
  if (fn) return `${LAMBDA_SCHEME}${fn}`;
  return env[`${kind}_SERVICE_URL`] || fallback;
}

export function parseLambdaUrl(fullUrl: string): { functionName: string; path: string; query: Record<string, string> } | null {
  if (!fullUrl.startsWith(LAMBDA_SCHEME)) return null;
  const rest = fullUrl.slice(LAMBDA_SCHEME.length);
  const slash = rest.indexOf("/");
  const functionName = slash === -1 ? rest : rest.slice(0, slash);
  const pathAndQuery = slash === -1 ? "/" : rest.slice(slash);
  const q = pathAndQuery.indexOf("?");
  const path = q === -1 ? pathAndQuery : pathAndQuery.slice(0, q);
  const query: Record<string, string> = {};
  if (q !== -1) new URLSearchParams(pathAndQuery.slice(q + 1)).forEach((v, k) => { query[k] = v; });
  if (!functionName) return null;
  return { functionName, path, query };
}

function withTimeout<T>(p: Promise<T>, ms: number | undefined, label: string): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`timeout of ${ms}ms exceeded (${label})`), { code: "ECONNABORTED" })), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

type InvokeFn = (input: { functionName: string; method: string; path: string; headers: Record<string, string>; query: Record<string, string>; body: unknown }) => Promise<{ statusCode: number; body: unknown }>;

const invokeViaSdk: InvokeFn = async ({ functionName, method, path, headers, query, body }) => {
  const rawQueryString = new URLSearchParams(query).toString();
  const event = {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString,
    headers: { "content-type": "application/json", ...headers },
    queryStringParameters: Object.keys(query).length ? query : undefined,
    requestContext: {
      http: { method, path, sourceIp: "user-service", userAgent: "user-service-lambda-invoke" },
      requestId: `user-${Date.now()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
  const response = await getLambdaClient().send(
    new InvokeCommand({ FunctionName: functionName, InvocationType: InvocationType.RequestResponse, Payload: Buffer.from(JSON.stringify(event)) }),
  );
  const payload = response.Payload ? JSON.parse(Buffer.from(response.Payload).toString("utf-8")) : {};
  const statusCode = Number(payload.statusCode ?? (response.FunctionError ? 502 : response.StatusCode ?? 500));
  let parsed: unknown = payload.body;
  if (typeof payload.body === "string" && payload.body) {
    try { parsed = JSON.parse(payload.body); } catch { parsed = payload.body; }
  }
  return { statusCode, body: parsed };
};

let invoke: InvokeFn = invokeViaSdk;
/** TEST SEAM: replace the real Lambda invoke. */
export function __setLambdaInvokeForTests(fn: InvokeFn | null): void {
  invoke = fn ?? invokeViaSdk;
}

/** axios adapter: turns one axios request into one Lambda invoke and returns/throws exactly like the HTTP adapter would. */
export async function lambdaAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const target = parseLambdaUrl(axios.getUri(config));
  if (!target) throw new AxiosError(`not a lambda:// url: ${String(config.url)}`, AxiosError.ERR_BAD_OPTION, config);

  const headers: Record<string, string> = {};
  const raw = (config.headers as unknown as { toJSON?: () => Record<string, unknown> })?.toJSON?.() ?? {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") headers[k.toLowerCase()] = v;

  let body: unknown = config.data;
  if (typeof body === "string" && body) {
    try { body = JSON.parse(body); } catch { /* keep the string */ }
  }
  const method = String(config.method || "get").toUpperCase();
  const out = await withTimeout(
    invoke({ functionName: target.functionName, method, path: target.path, headers, query: target.query, body: method === "GET" || method === "HEAD" ? undefined : body }),
    config.timeout,
    `${method} ${target.path}`,
  );

  const response: AxiosResponse = { data: out.body, status: out.statusCode, statusText: "", headers: {}, config, request: {} };
  const ok = config.validateStatus ? config.validateStatus(out.statusCode) : out.statusCode >= 200 && out.statusCode < 300;
  if (!ok) {
    throw new AxiosError(
      `Request failed with status code ${out.statusCode}`,
      out.statusCode >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    );
  }
  return response;
}

let installed = false;
/** Idempotent. Only requests whose URL starts with `lambda://` get the adapter; everything else is untouched. */
export function installLambdaAdapter(): void {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use((config) => {
    if (typeof config.url === "string" && config.url.startsWith(LAMBDA_SCHEME)) config.adapter = lambdaAdapter;
    return config;
  });
}
