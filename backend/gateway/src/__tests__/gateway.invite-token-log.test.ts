import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { format } from "node:util";

// Synthetic value only: this test must never touch a real invitation token.
const TOKEN = "SYNTHETIC_INVITE_TOKEN_abc123";

process.env.NODE_ENV = "test";
process.env.GYM_SERVICE_URL = "http://127.0.0.1:1";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-invite-log-test";

const lines: string[] = [];
let server: Server;
let base: string;
let restore: () => void;

before(async () => {
  const { logger } = await import("@gym-coach/shared");
  const target = logger as unknown as Record<string, (...args: unknown[]) => void>;
  const con = console as unknown as Record<string, (...args: unknown[]) => void>;
  const saved: Array<() => void> = [];
  for (const level of ["info", "warn", "error", "debug"]) {
    const loggerFn = target[level];
    const consoleFn = con[level];
    target[level] = (...args) => { lines.push(JSON.stringify(args)); };
    con[level] = (...args) => { lines.push(format(...args)); };
    saved.push(() => { target[level] = loggerFn; con[level] = consoleFn; });
  }
  const consoleLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(format(...args)); };
  saved.push(() => { console.log = consoleLog; });
  restore = () => saved.forEach((fn) => fn());

  const { default: app } = await import("../app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  restore?.();
  await new Promise((resolve) => server.close(resolve));
});

test("gateway logs never contain the invitation token, on preview or accept", async () => {
  await fetch(`${base}/partner-invitations/${TOKEN}`);
  await fetch(`${base}/partner-invitations/${TOKEN}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", referer: `https://app.invalid/partner/invite/${TOKEN}` },
    body: "{}",
  });
  const output = lines.join("\n");
  assert.match(output, /partner-invitations\/\[REDACTED\]/, "sanity: the request was logged");
  assert.ok(!output.includes(TOKEN), "token must not appear in any log line");
});

test("sanitizeUrlForLog masks the token in API paths, web Referer, query and any casing", async () => {
  const { sanitizeUrlForLog } = await import("@gym-coach/shared");
  assert.equal(sanitizeUrlForLog(`/partner-invitations/${TOKEN}`), "/partner-invitations/[REDACTED]");
  assert.equal(sanitizeUrlForLog(`/partner-invitations/${TOKEN}/accept`), "/partner-invitations/[REDACTED]/accept");
  assert.equal(sanitizeUrlForLog(`/PARTNER-INVITATIONS/${TOKEN}`), "/PARTNER-INVITATIONS/[REDACTED]");
  assert.equal(sanitizeUrlForLog(`https://app.invalid/partner/invite/${TOKEN}`), "https://app.invalid/partner/invite/[REDACTED]");
  assert.equal(sanitizeUrlForLog(`/partner/invite/${TOKEN}?from=${TOKEN}#${TOKEN}`), "/partner/invite/[REDACTED]?from=[REDACTED]");
  assert.equal(sanitizeUrlForLog("/owner/partner-invitations"), "/owner/partner-invitations");
  assert.equal(sanitizeUrlForLog("/gyms/abc/stats"), "/gyms/abc/stats");
});
