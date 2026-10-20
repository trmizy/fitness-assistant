import pino from "pino";
import { SENSITIVE_HEADERS, httpLogSerializers } from "./log-safety";

/**
 * Two layers, both bounded:
 *  1. `serializers` (log-safety.ts): req/res/err are projected into NEW objects for the log line
 *     only — credential headers (case-insensitive, one policy for HTTP and Axios carriers),
 *     query values, response Location and Axios config/request/response are sanitized.
 *     NOTE pino-http ignores logger-level req/res serializers, so services must pass
 *     `serializers: httpLogSerializers` to pinoHttp (auth-service and user-service do).
 *  2. `redact` paths: named credential fields 0-2 levels deep under any key, and the same header
 *     policy for explicit objects shaped `{ headers: {...} }` up to two levels deep. Field paths
 *     are case-sensitive and do NOT cover deeper nesting or free-text messages.
 */
const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "api_key",
  "secret",
];

const titleCase = (h: string) => h.replace(/(^|-)([a-z])/g, (_m, d, c) => d + c.toUpperCase());

function headerPaths(): string[] {
  const paths: string[] = [];
  for (const h of SENSITIVE_HEADERS) {
    for (const name of new Set([h, titleCase(h)])) {
      paths.push(`headers["${name}"]`, `*.headers["${name}"]`, `*.*.headers["${name}"]`);
    }
  }
  return paths;
}

function fieldPaths(): string[] {
  const paths: string[] = [];
  for (const key of SENSITIVE_KEYS) {
    paths.push(key, `*.${key}`, `*.*.${key}`);
  }
  return paths;
}

// Exported so tests can build a second pino instance with an in-memory destination and the same
// configuration; the runtime singleton below is what services actually use.
export const logRedactOptions = {
  paths: [...headerPaths(), ...fieldPaths()],
  censor: "[REDACTED]",
};

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: logRedactOptions,
  serializers: httpLogSerializers,
});

export { httpLogSerializers, sanitizeUrlForLog, sanitizeHeaders, SENSITIVE_HEADERS } from "./log-safety";

export * from "./types";
export * from "./schemas";
export * from "./errors";
export * from "./metrics";
export * from "./gatewayTrust";
export * from "./fitness-agent";
export * from "./fitness-agent-scoring";
export * from "./fitness-agent-context";
