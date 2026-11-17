import { httpLogSerializers, sanitizeUrlForLog } from "@gym-coach/shared";

/**
 * What the HTTP request log line carries. pino-http's default request serializer writes EVERY header (user-agent, x-forwarded-for,
 * x-client-ip, authorization...) and the socket's remote address: the client's IP and browser, i.e. personal data that is kept for
 * 12 months in the database (services/ip-ua-retention.service.ts) and must not sit in the log stream beyond that. This keeps only what
 * is needed to follow one request through the logs.
 *
 * The URL goes through the shared sanitizer: its query VALUES are redacted (names kept), because a signed PT identity-document link
 * (`?exp=...&sig=...`) is a capability URL - whoever reads the signature can open the document. The response side reuses the shared
 * serializer (status + headers with credential headers redacted and Location / Set-Cookie sanitized), as auth-service does.
 */
export function logRequest(req: { id?: unknown; method?: string; url?: string }) {
  return { id: req.id, method: req.method, url: sanitizeUrlForLog(req.url) };
}

export const requestLogSerializers = { req: logRequest, res: httpLogSerializers.res };
