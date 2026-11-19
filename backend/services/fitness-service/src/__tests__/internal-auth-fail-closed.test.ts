import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

/**
 * Fail-closed internal authentication (2026-11-13 hotfix) — fitness-service internalAuthMiddleware + startup config.
 * Offline: REAL router + REAL internalAuthMiddleware + REAL controller over HTTP on 127.0.0.1; the Exercise table is an
 * in-memory stand-in (no database, no Redis, no network beyond loopback). Environment is changed per test and restored.
 */
process.env.FITNESS_DISABLE_REDIS = "true";
process.env.NODE_ENV = "test";

import express from "express";
import { prisma } from "../repositories/prisma";

const SECRET = "unit-only-internal-secret-Zq81";
const API_SECRET = "unit-only-api-secret-Kp42";
const ME = "user-me";
const OTHER = "user-other";

type Row = { id: string; exerciseName: string; bodyPart: string; muscleGroupsActivated: string[]; source: string; ownerId: string | null; status: string; archivedAt: Date | null };
const row = (id: string, over: Partial<Row> = {}): Row => ({ id, exerciseName: `name-${id}`, bodyPart: "LOWER_BODY", muscleGroupsActivated: ["quadriceps"], source: "SYSTEM", ownerId: null, status: "PUBLISHED", archivedAt: null, ...over });
const ROWS = [row("sys-pub"), row("my-custom", { source: "USER_CUSTOM", ownerId: ME }), row("other-custom", { source: "USER_CUSTOM", ownerId: OTHER })];
function matches(r: Record<string, unknown>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, c]) => {
    if (k === "OR") return (c as any[]).some((x) => matches(r, x));
    if (c !== null && typeof c === "object" && "in" in c) return (c.in as unknown[]).includes(r[k]);
    return r[k] === c;
  });
}
let dbCalls = 0;
Object.defineProperty(prisma, "exercise", {
  configurable: true, writable: true,
  value: { async findMany(a: { where: any; select: any }) { dbCalls++; return ROWS.filter((r) => matches(r as any, a.where)).map((r) => Object.fromEntries(Object.keys(a.select).map((k) => [k, (r as any)[k]]))); } },
});

let base = "";
let server: import("node:http").Server | undefined;
async function start() {
  if (server) return;
  const app = express();
  app.use(express.json());
  app.use("/internal", (await import("../routes/internal.routes")).default);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
test.after(async () => { if (server) { server.closeAllConnections(); await new Promise((r) => server!.close(() => r(undefined))); } });

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { await fn(); } finally { for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}
/** Captures everything written to stdout/stderr (pino logs) while `fn` runs. */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  let out = "";
  const ow = process.stdout.write.bind(process.stdout); const ew = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (c: any, ...a: any[]) => { out += String(c); return ow(c, ...a); };
  (process.stderr as any).write = (c: any, ...a: any[]) => { out += String(c); return ew(c, ...a); };
  try { return { value: await fn(), out }; } finally { (process.stdout as any).write = ow; (process.stderr as any).write = ew; }
}
async function call(headers: Record<string, string>, ids: string[] = ["sys-pub", "my-custom", "other-custom"]) {
  await start();
  const res = await fetch(`${base}/internal/exercises/muscle-profiles`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ exerciseIds: ids }) });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}
const ids = (b: any) => (b?.data?.exercises ?? []).map((e: any) => e.id).sort();
const NO_SECRETS = { INTERNAL_SERVICE_SECRET: undefined, INTERNAL_API_SECRET: undefined };

test("FC-1 valid secret + matching token → authenticated; x-user-id becomes the caller", async () => {
  await withEnv({ INTERNAL_SERVICE_SECRET: SECRET, NODE_ENV: "production" }, async () => {
    const r = await call({ "x-internal-token": SECRET, "x-user-id": ME });
    assert.equal(r.status, 200); assert.deepEqual(ids(r.body), ["my-custom", "sys-pub"]);
  });
});

test("FC-2 valid secret + wrong / missing / differently-cased token → 401, catalog never queried", async () => {
  await withEnv({ INTERNAL_SERVICE_SECRET: SECRET }, async () => {
    dbCalls = 0;
    for (const h of [{ "x-internal-token": "wrong", "x-user-id": ME }, { "x-user-id": ME }, { "x-internal-token": SECRET.toUpperCase(), "x-user-id": ME }, { "x-internal-token": SECRET.slice(0, -1), "x-user-id": ME }, { "x-internal-token": `${SECRET}x`, "x-user-id": ME }]) {
      // (leading/trailing whitespace is not tested over HTTP: header OWS is stripped by the transport before the server sees it)
      assert.equal((await call(h as any)).status, 401, JSON.stringify(Object.keys(h)));
    }
    assert.equal(dbCalls, 0);
  });
});

test("FC-3 no INTERNAL_SERVICE_SECRET (unset or blank) → every request rejected (500), nothing trusted", async () => {
  for (const blank of [undefined, "", "   "]) {
    await withEnv({ ...NO_SECRETS, INTERNAL_SERVICE_SECRET: blank }, async () => {
      dbCalls = 0;
      const r = await call({ "x-user-id": ME, "x-internal-token": "anything" });
      assert.equal(r.status, 500); assert.deepEqual(r.body, { error: "Service authentication is not configured" });
      assert.equal(dbCalls, 0);
    });
  }
  const { validateRequiredRuntimeConfig } = await import("../config/lambda-runtime");
  await withEnv({ ...NO_SECRETS }, () => { assert.throws(() => validateRequiredRuntimeConfig("http"), /INTERNAL_SERVICE_SECRET/); });
  await withEnv({ ...NO_SECRETS, INTERNAL_SERVICE_SECRET: "  " }, () => { assert.throws(() => validateRequiredRuntimeConfig(), /INTERNAL_SERVICE_SECRET/); });
});

test("FC-4 only INTERNAL_API_SECRET → HTTP startup fails closed and the middleware does not accept it; jobs startup unchanged", async () => {
  const { validateRequiredRuntimeConfig } = await import("../config/lambda-runtime");
  await withEnv({ INTERNAL_SERVICE_SECRET: undefined, INTERNAL_API_SECRET: API_SECRET }, async () => {
    assert.throws(() => validateRequiredRuntimeConfig("http"), /INTERNAL_SERVICE_SECRET must be configured/);
    assert.throws(() => validateRequiredRuntimeConfig(), /INTERNAL_SERVICE_SECRET/, "default role is the HTTP receiver");
    assert.doesNotThrow(() => validateRequiredRuntimeConfig("jobs"), "jobs Lambda (no /internal receiver) keeps the either-name rule");
    assert.equal((await call({ "x-internal-token": API_SECRET, "x-user-id": ME })).status, 500, "the API secret is never an internal token");
  });
  await withEnv({ ...NO_SECRETS }, () => { assert.throws(() => validateRequiredRuntimeConfig("jobs"), /INTERNAL_SERVICE_SECRET \(or INTERNAL_API_SECRET\)/); });
});

for (const [n, env] of [["FC-5", "development"], ["FC-6", "test"], ["FC-7", "production"], ["FC-7b", undefined], ["FC-7c", "staging"]] as const) {
  test(`${n} NODE_ENV=${env ?? "(unset)"} with the secret missing → bare x-user-id is NOT trusted`, async () => {
    await withEnv({ ...NO_SECRETS, NODE_ENV: env, ALLOW_INSECURE_DEV_SECRETS: "true" }, async () => {
      const { internalAuthMiddleware } = await import("../middleware/auth.middleware");
      let nextCalled = false; let status = 0;
      const res: any = { status(c: number) { status = c; return this; }, json() { return this; } };
      const req: any = { headers: { "x-user-id": "victim", "x-user-role": "ADMIN" }, path: "/internal/x" };
      internalAuthMiddleware(req, res, () => { nextCalled = true; });
      assert.equal(nextCalled, false); assert.equal(status, 500); assert.equal(req.user, undefined);
    });
  });
}

test("FC-8 forged x-user-id: without a valid token the identity header is never applied", async () => {
  await withEnv({ INTERNAL_SERVICE_SECRET: SECRET }, async () => {
    const { internalAuthMiddleware } = await import("../middleware/auth.middleware");
    for (const headers of [{ "x-user-id": OTHER, "x-user-role": "ADMIN" }, { "x-user-id": OTHER, "x-internal-token": "guess" }]) {
      let nextCalled = false; let status = 0;
      const res: any = { status(c: number) { status = c; return this; }, json() { return this; } };
      const req: any = { headers, path: "/internal/exercises/muscle-profiles" };
      internalAuthMiddleware(req, res, () => { nextCalled = true; });
      assert.equal(nextCalled, false); assert.equal(status, 401); assert.equal(req.user, undefined);
    }
    // a valid token without any identity is still refused
    assert.equal((await call({ "x-internal-token": SECRET })).status, 401);
  });
});

test("FC-9 cross-user: an authenticated caller for ME still cannot read OTHER's private exercise", async () => {
  await withEnv({ INTERNAL_SERVICE_SECRET: SECRET }, async () => {
    const r = await call({ "x-internal-token": SECRET, "x-user-id": ME }, ["other-custom"]);
    assert.equal(r.status, 200); assert.deepEqual(r.body.data.exercises, []);
    const own = await call({ "x-internal-token": SECRET, "x-user-id": OTHER }, ["other-custom"]);
    assert.deepEqual(ids(own.body), ["other-custom"]);
  });
});

test("FC-10 V1 consumers (ai-service / ai-worker / user-service send x-internal-token = INTERNAL_SERVICE_SECRET + x-user-id) keep working", async () => {
  await withEnv({ INTERNAL_SERVICE_SECRET: SECRET, NODE_ENV: "production" }, async () => {
    // same header shape as ai-service fitness-agent-tools.domain() / ai.worker.ts / user-service fitness-service.client.ts
    const r = await call({ "x-internal-token": SECRET, "x-user-id": ME, "x-user-role": "CUSTOMER", "x-gateway-secret": SECRET }, ["sys-pub", "my-custom"]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { success: true, data: { exercises: [
      { id: "sys-pub", name: "name-sys-pub", bodyPart: "LOWER_BODY", muscleGroups: ["quadriceps"] },
      { id: "my-custom", name: "name-my-custom", bodyPart: "LOWER_BODY", muscleGroups: ["quadriceps"] },
    ] } });
  });
});

test("FC-11 no secret disclosure: responses and logs never contain the secret or the presented token", async () => {
  const seen: string[] = [];
  await withEnv({ INTERNAL_SERVICE_SECRET: SECRET }, async () => {
    const { value, out } = await captureOutput(async () => [await call({ "x-internal-token": "presented-wrong-token-77", "x-user-id": ME }), await call({ "x-internal-token": SECRET, "x-user-id": ME })]);
    seen.push(out, ...value.map((v) => v.text));
  });
  await withEnv({ ...NO_SECRETS, INTERNAL_API_SECRET: API_SECRET }, async () => {
    const { value, out } = await captureOutput(async () => call({ "x-internal-token": "presented-wrong-token-88", "x-user-id": ME }));
    seen.push(out, value.text);
    const { validateRequiredRuntimeConfig } = await import("../config/lambda-runtime");
    try { validateRequiredRuntimeConfig("http"); } catch (e) { seen.push(String((e as Error).message)); }
  });
  const all = seen.join("\n");
  for (const s of [SECRET, API_SECRET, "presented-wrong-token-77", "presented-wrong-token-88"]) assert.ok(!all.includes(s), `leaked ${s.slice(0, 12)}…`);
});

test("FC-12 muscle-profiles authorization still applies after authentication (public + own only)", async () => {
  await withEnv({ INTERNAL_SERVICE_SECRET: SECRET }, async () => {
    const r = await call({ "x-internal-token": SECRET, "x-user-id": ME }, ["sys-pub", "my-custom", "other-custom", "missing"]);
    assert.deepEqual(ids(r.body), ["my-custom", "sys-pub"]);
  });
});
