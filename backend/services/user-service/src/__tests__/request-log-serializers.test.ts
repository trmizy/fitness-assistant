import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { logRequest, requestLogSerializers } from "../utils/request-log-serializers";

/**
 * The user-service request log line carries no IP and no browser string (they are personal data on a 12-month retention clock in the
 * database; the log must not keep them longer). UNIT test of the serializer + CODE AUDIT of the wiring in app.ts.
 */
test("logRequest keeps only id / method / url - no headers, no remote address, no user agent, no forwarded-for", () => {
  const req = {
    id: 7,
    method: "POST",
    url: "/pt-applications/terms/accept",
    headers: { "user-agent": "g9-private-agent/1.0", "x-forwarded-for": "203.0.113.9", "x-client-ip": "203.0.113.9", authorization: "Bearer secret" },
    remoteAddress: "::ffff:10.0.0.5",
    remotePort: 51234,
    ip: "203.0.113.9",
  };
  const out = logRequest(req as any);
  assert.deepEqual(out, { id: 7, method: "POST", url: "/pt-applications/terms/accept" });
  const text = JSON.stringify(out);
  for (const leaked of ["203.0.113.9", "g9-private-agent", "10.0.0.5", "secret", "headers", "remoteAddress"]) assert.equal(text.includes(leaked), false, leaked);
  assert.equal(requestLogSerializers.req, logRequest);
});

test("CODE AUDIT: app.ts hands those serializers to pino-http (the default serializer would log every header and the remote address)", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.ts"), "utf8");
  assert.match(app, /pinoHttp\(\{\s*logger,\s*serializers: requestLogSerializers,?\s*\}\)/);
  assert.doesNotMatch(app, /pinoHttp\(\{ logger \}\)/);
});

test("logRequest redacts query VALUES (a signed document link's sig/exp is a capability) but keeps the path and the parameter names", () => {
  const out = logRequest({ id: 1, method: "GET", url: "/pt-applications/documents/a.png?exp=1794555229469&sig=a21b73c8d4071bce#frag" });
  assert.deepEqual(out, { id: 1, method: "GET", url: "/pt-applications/documents/a.png?exp=[REDACTED]&sig=[REDACTED]" });
  assert.equal(JSON.stringify(out).includes("a21b73c8"), false);
});

test("the response side is the shared serializer: credential headers and a signed Location / Set-Cookie are redacted, status kept", () => {
  const out: any = requestLogSerializers.res({ statusCode: 302, headers: { location: "https://x.invalid/d?sig=SYN_LOC", "set-cookie": "s=SYN_COOKIE", "content-type": "text/html" } });
  assert.equal(out.statusCode, 302);
  assert.equal(out.headers.location, "https://x.invalid/d?sig=[REDACTED]");
  assert.equal(out.headers["set-cookie"], "[REDACTED]");
  assert.equal(out.headers["content-type"], "text/html");
});
