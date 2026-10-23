/**
 * What the HTTP request log line carries. pino-http's default request serializer writes EVERY header (user-agent, x-forwarded-for,
 * x-client-ip, authorization...) and the socket's remote address: the client's IP and browser, i.e. personal data that is kept for
 * 12 months in the database (services/ip-ua-retention.service.ts) and must not sit in the log stream beyond that. This keeps only what
 * is needed to follow one request through the logs.
 */
export function logRequest(req: { id?: unknown; method?: string; url?: string }) {
  return { id: req.id, method: req.method, url: req.url };
}

export const requestLogSerializers = { req: logRequest };
