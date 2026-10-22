/**
 * P1 disclosure regression - NO client-reachable route may hand back a contract's money split.
 *
 * A contract row stores the frozen revenue split (platformRate / ptRate / gymRate), the PT holdback snapshot, what was released to
 * each party and the PT-gym agreement it came from. Only the contract's PT and an admin may see them (contract-dto.ts).
 * Found by the real-HTTP E2E: `POST /contracts/:id/pay` returned the raw row to the client.
 *
 * Evidence label: unit / route-level (the REAL routers + controllers + auth middleware mounted in express; the service layer is a
 * TEST FIXTURE that answers with a raw contract row carrying every hidden field). No database.
 *
 * Two parts:
 *  1. ROUTE INVENTORY: every route of /contracts and /sessions is classified here, either "returns a contract (or embeds one)" -
 *     and is exercised below as the client - or "returns no contract row" with the reason. A new route fails this test until it is
 *     classified, so a contract-returning route cannot be added without going through the redaction.
 *  2. For each contract-returning route: called as the CLIENT, the body contains none of the hidden fields, at any depth; called as
 *     the contract's PT, the PT still sees their own split (the redaction is not over-eager).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { authServiceClient } from "../clients/auth-service.client";
import { contractService } from "../services/contract.service";
import { bookingService } from "../services/booking.service";
import { contractCheckoutContextService } from "../services/contract-checkout-context.service";
import { SPLIT_FIELDS_HIDDEN_FROM_CLIENT } from "../services/contract-dto";
import contractRoutes from "../routes/contract.routes";
import sessionRoutes from "../routes/session.routes";
import { bookingController } from "../controllers/booking.controller";

const PT = "pt-1";
const CLIENT = "client-1";

const rawContract = () => ({
  id: "c1",
  ptUserId: PT,
  clientUserId: CLIENT,
  status: "PENDING_PAYMENT",
  price: "4000000.00",
  totalSessions: 4,
  gymId: "g1",
  platformRate: "0.1000",
  ptRate: "0.5500",
  gymRate: "0.3500",
  ptHoldbackRate: "0.1000",
  ptHoldbackPolicyVersion: 1,
  holdbackReleasedAt: null,
  releasedToPt: "10.00",
  releasedToGym: "20.00",
  releasedToPlatform: "30.00",
  gymAgreementId: "a1",
  gymAgreementScope: "BRAND",
});
const rawSession = () => ({ id: "s1", contractId: "c1", ptUserId: PT, clientUserId: CLIENT, status: "REQUESTED", contract: rawContract() });

/** Hidden field names found anywhere in a JSON value. */
function leaks(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
    ...((SPLIT_FIELDS_HIDDEN_FROM_CLIENT as readonly string[]).includes(k) ? [`${path}.${k}`] : []),
    ...(k === "rates" ? [`${path}.rates`] : []),
    ...leaks(v, `${path}.${k}`),
  ]);
}

// ── 1. the inventory ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Routes that return a contract row (or embed one) to a caller who may be the CLIENT: each is exercised in part 2. */
const RETURNS_CONTRACT = [
  "POST /contracts/request",
  "PATCH /contracts/:id/accept",
  "PATCH /contracts/:id/reject",
  "PATCH /contracts/:id/cancel",
  "GET /contracts/pt",
  "GET /contracts/client",
  "GET /contracts/:id",
  "POST /contracts/:id/pay",
  "GET /contracts/:id/checkout-context",
  "GET /sessions/upcoming",
  "GET /sessions/pending-confirmation",
  "GET /sessions/no-show-reports",
];

/** Routes that return no contract row, with the reason. (money-breakdown / terminate return derived objects with their own whitelists.) */
const RETURNS_NO_CONTRACT: Record<string, string> = {
  "GET /contracts/gym-options": "gym choices for a package, no contract row",
  "GET /contracts/check-relationship": "{ related: boolean }",
  "GET /contracts/pt/earnings": "the PT's own earnings",
  "POST /contracts": "retired (410 gone)",
  "POST /contracts/:id/esign/send": "{ message }",
  "GET /contracts/:id/esign": "e-sign status",
  "GET /contracts/:id/pdf": "a file",
  "PATCH /contracts/:id/status": "retired (410 gone)",
  "PUT /contracts/:id": "retired (410 gone)",
  "POST /contracts/:id/session": "retired (410 gone)",
  "POST /contracts/:id/feedback": "{ message }",
  "GET /contracts/:id/money-breakdown": "derived object, redactBreakdownForViewer (whitelist)",
  "POST /contracts/:id/terminate": "{ contractId, reason, settlement } - redactSettlementForViewer (whitelist)",
  "POST /sessions": "the new session row, no contract include",
  "GET /sessions/contract/:contractId": "sessions without the contract include",
  "GET /sessions/:id": "one session without the contract include",
  "POST /sessions/:id/join": "a join token",
  "PATCH /sessions/:id/confirm": "the session row",
  "PATCH /sessions/:id/complete": "the session row",
  "PATCH /sessions/:id/cancel": "the session row",
  "PATCH /sessions/:id/no-show": "the session row",
  "POST /sessions/:id/confirm": "the session row",
  "POST /sessions/:id/dispute": "the session row",
  "POST /sessions/:id/report-no-show": "the session row",
  "POST /sessions/:id/respond-no-show": "the session row",
  "POST /sessions/:id/review": "a review",
  "POST /sessions/:id/review-client": "a review",
  "POST /sessions/:id/reschedule": "a reschedule request",
  "POST /sessions/reschedules/:id/respond": "a reschedule request",
  "DELETE /sessions/reschedules/:id": "a reschedule request",
  "GET /sessions/:id/reschedule-history": "reschedule requests",
};

function routesOf(prefix: string, router: any): string[] {
  return router.stack.filter((l: any) => l.route).flatMap((l: any) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${prefix}${l.route.path === "/" ? "" : l.route.path}`));
}

test("INVENTORY: every /contracts and /sessions route is classified - a new route cannot reach a client unclassified", () => {
  const actual = new Set([...routesOf("/contracts", contractRoutes), ...routesOf("/sessions", sessionRoutes)]);
  // the read router is mounted inside the contract router
  const nested = (contractRoutes as any).stack.filter((l: any) => !l.route && l.handle?.stack).flatMap((l: any) => routesOf("/contracts", l.handle));
  for (const r of nested) actual.add(r);
  const classified = new Set([...RETURNS_CONTRACT, ...Object.keys(RETURNS_NO_CONTRACT)]);
  assert.deepEqual([...actual].filter((r) => !classified.has(r)).sort(), [], "routes that are not classified (add them to RETURNS_CONTRACT or RETURNS_NO_CONTRACT)");
  assert.deepEqual([...classified].filter((r) => !actual.has(r)).sort(), [], "classified routes that no longer exist");
  assert.equal(RETURNS_CONTRACT.some((r) => r in RETURNS_NO_CONTRACT), false, "a route is in exactly one list");
});

// ── 2. the routes, as the client and as the PT ───────────────────────────────────────────────────────────────────────────────

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

async function withServer<T>(fn: (call: (method: string, path: string, as: "CLIENT" | "PT", body?: unknown) => Promise<{ status: number; body: any }>) => Promise<T>): Promise<T> {
  const restores = [
    patch(authServiceClient, "verifyToken", async (header: string) => {
      const [id, role] = header.replace("Bearer ", "").split("|");
      return { data: { user: { id, email: `${id}@test.local`, role } } };
    }),
    patch(contractService, "requestContract", async () => rawContract()),
    patch(contractService, "acceptContract", async () => rawContract()),
    patch(contractService, "rejectContract", async () => rawContract()),
    patch(contractService, "cancelContract", async () => rawContract()),
    patch(contractService, "getByPT", async () => [rawContract()]),
    patch(contractService, "getByClient", async () => [rawContract()]),
    patch(contractService, "getById", async () => ({ ...rawContract(), sessions: [] })),
    patch(contractService, "pay", async () => ({ contract: rawContract(), payment: { transactionId: "t1", status: "PENDING", redirectUrl: "http://pay" } })),
    patch(contractCheckoutContextService, "getCheckoutContext", async () => ({
      contractId: "c1",
      status: "PENDING_PAYMENT",
      amount: 4000000,
      rates: { platformRate: "0.1", ptRate: "0.55", gymRate: "0.35" },
      parties: { ptUserId: PT, gymId: "g1", clientUserId: CLIENT },
      gym: { gymId: "g1", brandId: "b1", agreementId: "a1", agreementScope: "BRAND" },
      payment: { paymentDueAt: null, hasPaymentTransaction: false },
    })),
    patch(bookingService, "getMyUpcoming", async () => [rawSession()]),
    patch(bookingService, "listPendingConfirmation", async () => [rawSession()]),
    patch(bookingService, "listNoShowReportsForPT", async () => [rawSession()]),
  ];
  const app = express();
  app.use(express.json());
  app.use("/contracts", contractRoutes);
  app.use("/sessions", sessionRoutes);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, as: "CLIENT" | "PT", body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", Authorization: `Bearer ${as === "PT" ? PT : CLIENT}|${as === "PT" ? "PT" : "CUSTOMER"}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    return await fn(call);
  } finally {
    server.close();
    restores.reverse().forEach((r) => r());
  }
}

/** [route as listed in RETURNS_CONTRACT, method, concrete path, body, who may legitimately call it]. */
const CASES: Array<[string, string, string, unknown, Array<"CLIENT" | "PT">]> = [
  ["POST /contracts/request", "POST", "/contracts/request", { ptUserId: PT, packageId: "p1" }, ["CLIENT"]],
  ["PATCH /contracts/:id/accept", "PATCH", "/contracts/c1/accept", {}, ["PT"]],
  ["PATCH /contracts/:id/reject", "PATCH", "/contracts/c1/reject", { reason: "x" }, ["PT"]],
  ["PATCH /contracts/:id/cancel", "PATCH", "/contracts/c1/cancel", { reason: "x" }, ["CLIENT", "PT"]],
  ["GET /contracts/pt", "GET", "/contracts/pt", undefined, ["PT"]],
  ["GET /contracts/client", "GET", "/contracts/client", undefined, ["CLIENT"]],
  ["GET /contracts/:id", "GET", "/contracts/c1", undefined, ["CLIENT", "PT"]],
  ["POST /contracts/:id/pay", "POST", "/contracts/c1/pay", { provider: "VNPAY" }, ["CLIENT"]],
  ["GET /contracts/:id/checkout-context", "GET", "/contracts/c1/checkout-context", undefined, ["CLIENT", "PT"]],
  ["GET /sessions/upcoming", "GET", "/sessions/upcoming", undefined, ["CLIENT", "PT"]],
  ["GET /sessions/pending-confirmation", "GET", "/sessions/pending-confirmation", undefined, ["CLIENT"]],
  ["GET /sessions/no-show-reports", "GET", "/sessions/no-show-reports", undefined, ["PT"]],
];

test("every contract-returning route: the case table covers exactly RETURNS_CONTRACT", () => {
  assert.deepEqual(CASES.map((c) => c[0]).sort(), [...RETURNS_CONTRACT].sort());
});

test("as the CLIENT no contract-returning route carries a split field (at any depth); a refused call carries none either", async () => {
  await withServer(async (call) => {
    for (const [route, method, path, body] of CASES) {
      const res = await call(method, path, "CLIENT", body);
      assert.deepEqual(leaks(res.body), [], `${route} -> ${res.status} leaks: ${JSON.stringify(res.body).slice(0, 300)}`);
      if (["GET /contracts/:id", "GET /contracts/client", "POST /contracts/:id/pay", "GET /contracts/:id/checkout-context", "GET /sessions/upcoming", "GET /sessions/pending-confirmation"].includes(route)) {
        assert.equal(res.status, route === "POST /contracts/request" ? 201 : 200, `${route} is reachable by the client (otherwise this test proves nothing)`);
      }
    }
  });
});

test("as the contract's PT the same routes still show their own split (the redaction is not over-eager); the client still gets what they need", async () => {
  await withServer(async (call) => {
    for (const [route, method, path, body, who] of CASES) {
      if (!who.includes("PT")) continue;
      const res = await call(method, path, "PT", body);
      if (res.status >= 400) continue; // e.g. a route the PT is refused on its merits
      assert.ok(leaks(res.body).length > 0, `${route}: the PT of the contract sees the split`);
    }
    const pay = await call("POST", "/contracts/c1/pay", "CLIENT", { provider: "VNPAY" });
    assert.equal(pay.body.contract.id, "c1");
    assert.equal(pay.body.contract.price, "4000000.00");
    assert.equal(pay.body.payment.redirectUrl, "http://pay");
    const ctx = await call("GET", "/contracts/c1/checkout-context", "CLIENT");
    assert.equal(ctx.body.amount, 4000000);
    assert.equal(ctx.body.gym.brandId, "b1");
    assert.equal(ctx.body.gym.agreementId, null);
    assert.equal("rates" in ctx.body, false);
  });
});

test("GET /admin/sessions/disputed (admin) embeds contracts: an admin sees them, a non-admin viewer would not", async () => {
  const out: any[] = [];
  const restore = patch(bookingService, "listDisputed", async () => [rawSession()]);
  try {
    const res = (role: string) => ({ json: (v: unknown) => out.push([role, v]), status: () => ({ json: (v: unknown) => out.push([role, v]) }) });
    await bookingController.listDisputed({ headers: { "x-user-id": "admin-1", "x-user-role": "ADMIN" } }, res("ADMIN") as any);
    await bookingController.listDisputed({ headers: { "x-user-id": CLIENT, "x-user-role": "CUSTOMER" } }, res("CUSTOMER") as any);
  } finally {
    restore();
  }
  assert.ok(leaks(out[0][1]).length > 0, "admin sees the split");
  assert.deepEqual(leaks(out[1][1]), [], "defence in depth: even if the role gate were bypassed, a client viewer would not");
});
