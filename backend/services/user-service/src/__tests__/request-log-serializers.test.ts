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
