import pino from "pino";

/**
 * Log-representation safety for the shared Pino logger. Everything here builds NEW objects for
 * the log line only; the live request/response/error objects (and therefore req.url, the
 * redirect Location actually sent, signature verification input) are never mutated.
 *
 * Contract (bounded, not universal): known credential-bearing HTTP headers (case-insensitive),
 * URL query values, response Location, and Axios/HTTP-client error metadata are projected or
 * redacted. Arbitrary free-text messages and credential fields nested deeper than the redact
 * paths in index.ts are NOT sanitized.
 */
export const REDACTED = "[REDACTED]";

/** Lower-case names of headers that carry credentials in this codebase. */
export const SENSITIVE_HEADERS: readonly string[] = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-gateway-secret",
  "x-api-key",
  "x-service-secret",
  "x-internal-token",
  "x-internal-secret",
];
const SENSITIVE_HEADER_SET = new Set(SENSITIVE_HEADERS);

/** Headers whose VALUE is a URL that may carry a signed query (capability URLs). */
const URL_HEADERS = new Set(["location", "content-location", "referer", "referrer"]);

/** Strip the query values (and fragment) of a relative or absolute URL; keep path + param names. */
export function sanitizeUrlForLog<T>(value: T): T | string {
  if (typeof value !== "string") return value;
  const q = value.indexOf("?");
  const h = value.indexOf("#");
  if (q < 0) return h < 0 ? value : value.slice(0, h);
  const end = h >= 0 && h > q ? h : value.length;
  const names = value
    .slice(q + 1, end)
    .split("&")
    .filter(Boolean)
    .map((pair) => `${pair.split("=")[0]}=${REDACTED}`);
  return `${value.slice(0, q)}?${names.join("&")}`;
}

function entriesOf(headers: unknown): Array<[string, unknown]> {
  if (!headers || typeof headers !== "object") return [];
  const plain =
    typeof (headers as { toJSON?: unknown }).toJSON === "function"
      ? (headers as { toJSON: () => unknown }).toJSON()
      : headers;
  return plain && typeof plain === "object" ? Object.entries(plain as Record<string, unknown>) : [];
}

/** New header object: credential headers redacted regardless of casing, URL headers sanitized. */
export function sanitizeHeaders(headers: unknown): Record<string, unknown> | unknown {
  if (!headers || typeof headers !== "object") return headers;
  const out: Record<string, unknown> = {};
  for (const [name, value] of entriesOf(headers)) {
    const lower = name.toLowerCase();
    if (SENSITIVE_HEADER_SET.has(lower)) out[name] = REDACTED;
    else if (URL_HEADERS.has(lower)) out[name] = Array.isArray(value) ? value.map(sanitizeUrlForLog) : sanitizeUrlForLog(value);
    else out[name] = value;
  }
  return out;
}

function redactQueryObject(query: unknown): unknown {
  if (!query || typeof query !== "object") return query;
  return Object.fromEntries(Object.keys(query as object).map((k) => [k, REDACTED]));
}

export const reqLogSerializer = (req: any) => {
  // pino-http hands custom serializers an already-standard-serialized request; direct callers pass the raw one.
  const s = (req?.socket || req?.originalUrl ? pino.stdSerializers.req(req) : req) as any;
  return {
    id: s.id,
    method: s.method,
    url: sanitizeUrlForLog(s.url),
    query: redactQueryObject(s.query),
    params: s.params,
    headers: sanitizeHeaders(s.headers),
    remoteAddress: s.remoteAddress,
    remotePort: s.remotePort,
  };
};

export const resLogSerializer = (res: any) => {
  const s = (typeof res?.getHeaders === "function" ? pino.stdSerializers.res(res) : res) as any;
  return { statusCode: s.statusCode, headers: sanitizeHeaders(s.headers) };
};

/** Bounded projection of an HTTP-client request config: no body, no params, redacted headers. */
function projectConfig(config: any) {
  if (!config || typeof config !== "object") return undefined;
  return {
    method: config.method,
    url: sanitizeUrlForLog(config.url),
    baseURL: sanitizeUrlForLog(config.baseURL),
    timeout: config.timeout,
    headers: sanitizeHeaders(config.headers),
  };
}

/**
 * Error projection: pino's standard serializer output (type/message/stack/own enumerable props)
 * with the known HTTP-client carriers replaced by bounded, redacted projections. Axios attaches
 * `config` (headers + body), `request` (the raw ClientRequest, headers included) and `response`
 * (with its own config/request/data) to its errors.
 */
export const errLogSerializer = (err: any) => {
  const s = pino.stdSerializers.err(err) as any;
  if (!s || typeof s !== "object") return s;
  const { raw: _raw, request: _request, config, response, ...rest } = s;
  const out: Record<string, unknown> = { ...rest };
  if (config) out.config = projectConfig(config);
  if (response && typeof response === "object") {
    out.response = {
      status: response.status,
      statusText: response.statusText,
      config: projectConfig(response.config),
    };
  }
  return out;
};

export const httpLogSerializers = {
  req: reqLogSerializer,
  res: resLogSerializer,
  err: errLogSerializer,
};
