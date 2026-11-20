import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

/**
 * Workout Plan Review & Approval — HTTP contract + auth/role enforcement.
 * Evidence label: BACKEND INTEGRATION (real Express router + real controller/validation/service, REAL HTTP on a local port) with an
 * in-memory repository and stubbed token/contract lookups. It does NOT touch Postgres or any other service.
 */
process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused_test?schema=public"; // PrismaClient is constructed but never queried

const PT = "http-pt-1", PT_OTHER = "http-pt-2", CLIENT = "http-client-1", CLIENT_OTHER = "http-client-2";
const tokens: Record<string, { id: string; role: string }> = {
  "pt-a": { id: PT, role: "PT" },
  "pt-b": { id: PT_OTHER, role: "PT" },
  "client-a": { id: CLIENT, role: "CUSTOMER" },
  "client-b": { id: CLIENT_OTHER, role: "CUSTOMER" },
};
const roster = new Map<string, Set<string>>([[PT, new Set([CLIENT])]]);
let rosterDown = false;
let current = { hash: 10, version: 1 };

let server: import("node:http").Server;
let base = "";

test.before(async () => {
  const express = (await import("express")).default;
  const { authServiceClient } = await import("../clients/auth-service.client");
  (authServiceClient as any).verifyToken = async (header: string) => {
    const t = tokens[header.replace("Bearer ", "")];
    if (!t) throw new Error("bad token");
    return { user: { id: t.id, email: "", role: t.role } };
  };
  const { planReviewDeps } = await import("../services/plan-review");
  const { InMemoryPlanReviewRepository } = await import("../services/plan-review/plan-review.memory-repository");
  const memRepo = new InMemoryPlanReviewRepository();
  memRepo.subjectVersionOf = () => current.version; // stands in for the locked workout_programs.version read
  planReviewDeps.repo = memRepo;
  planReviewDeps.notify = null; // no outbound call from this HTTP contract test (delivery is covered by the service tests)
  planReviewDeps.fetchActiveClientIds = async (pt) => {
    if (rosterDown) throw new Error("down");
    return [...(roster.get(pt) ?? [])];
  };
  planReviewDeps.loadCurrentProgram = async (clientId) =>
    clientId === CLIENT
      ? {
          id: "6f1f6c0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", name: "P", version: current.version,
          days: [{ dayNumber: 1, title: "D1", exercises: [{ exerciseId: "e1", order: 1, sets: 3, reps: current.hash }] }],
        }
      : null;
  const routes = (await import("../routes/plan-review.routes")).default;
  const app = express();
  app.use(express.json());
  app.use("/plan-reviews", routes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.after(() => server?.close());

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

test("H01 no / bad token => 401 on every endpoint", async () => {
  for (const [m, p] of [["POST", "/plan-reviews"], ["GET", "/plan-reviews/mine"], ["GET", "/plan-reviews/inbox"], ["GET", "/plan-reviews/summary"], ["GET", "/plan-reviews/x"], ["POST", "/plan-reviews/x/decision"], ["POST", "/plan-reviews/x/cancel"]] as const) {
    assert.equal((await call(m, p, null, {})).status, 401, `${m} ${p}`);
    assert.equal((await call(m, p, "nope", {})).status, 401, `${m} ${p} bad token`);
  }
});

test("H02 body can never name the caller or their role: unknown keys (clientUserId, role, status) are a 400", async () => {
  for (const extra of [{ clientUserId: CLIENT_OTHER }, { role: "PT" }, { status: "APPROVED" }, { userId: PT }]) {
    const r = await call("POST", "/plan-reviews", "client-a", { ptUserId: PT, ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.json.code, "VALIDATION");
  }
  const d = await call("POST", "/plan-reviews/anything/decision", "pt-a", { decision: "APPROVE", ptUserId: PT_OTHER });
  assert.equal(d.status, 400);
  assert.equal((await call("POST", "/plan-reviews/anything/decision", "pt-a", { decision: "MAYBE" })).status, 400);
});

let requestId = "";
test("H03 submit -> 201 with snapshot + hash; the same submit again -> 200 replay (same id)", async () => {
  const a = await call("POST", "/plan-reviews", "client-a", { ptUserId: PT, clientNote: "xin duyệt" });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  requestId = a.json.request.id;
  assert.equal(a.json.request.status, "PENDING_REVIEW");
  assert.match(a.json.request.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(!("idempotencyKey" in a.json.request));
  const b = await call("POST", "/plan-reviews", "client-a", { ptUserId: PT });
  assert.equal(b.status, 200);
  assert.equal(b.json.request.id, requestId);
});

test("H04 submit without a contract => 403; with unreadable roster => 503 (fail closed)", async () => {
  assert.equal((await call("POST", "/plan-reviews", "client-b", { ptUserId: PT })).status, 403);
  rosterDown = true;
  const r = await call("POST", "/plan-reviews", "client-a", { ptUserId: PT });
  rosterDown = false;
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "AUTH_DEPENDENCY_UNAVAILABLE");
});

test("H05 IDOR: other client / other PT get 404 for another user's request; list endpoints are scoped", async () => {
  for (const tok of ["client-b", "pt-b"]) {
    assert.equal((await call("GET", `/plan-reviews/${requestId}`, tok)).status, 404, tok);
    assert.equal((await call("GET", `/plan-reviews/${requestId}/events`, tok)).status, 404, tok);
  }
  assert.equal((await call("POST", `/plan-reviews/${requestId}/cancel`, "client-b")).status, 404);
  assert.equal((await call("GET", "/plan-reviews/mine", "client-b")).json.requests.length, 0);
  assert.equal((await call("GET", "/plan-reviews/inbox", "pt-b")).json.requests.length, 0);
});

test("H06 role enforcement: a client cannot read the PT inbox or decide; PT inbox lists the request without the snapshot", async () => {
  assert.equal((await call("GET", "/plan-reviews/inbox", "client-a")).status, 403);
  assert.equal((await call("POST", `/plan-reviews/${requestId}/decision`, "client-a", { decision: "APPROVE" })).status, 403);
  const inbox = await call("GET", "/plan-reviews/inbox", "pt-a");
  assert.equal(inbox.status, 200);
  assert.equal(inbox.json.requests.length, 1);
  assert.ok(!("snapshot" in inbox.json.requests[0]));
  assert.equal((await call("GET", "/plan-reviews/inbox?status=NOPE", "pt-a")).status, 400);
  assert.equal((await call("GET", "/plan-reviews/summary", "pt-a")).json.pending, 1);
});

test("H07 PT opens, then request-changes needs a note (400); with a note => 200 CHANGES_REQUESTED; replay => 200", async () => {
  assert.equal((await call("POST", `/plan-reviews/${requestId}/start`, "pt-a")).json.request.status, "IN_REVIEW");
  assert.equal((await call("POST", `/plan-reviews/${requestId}/decision`, "pt-a", { decision: "REQUEST_CHANGES" })).status, 400);
  const ok = await call("POST", `/plan-reviews/${requestId}/decision`, "pt-a", { decision: "REQUEST_CHANGES", note: "Thêm bài vai" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.request.status, "CHANGES_REQUESTED");
  const again = await call("POST", `/plan-reviews/${requestId}/decision`, "pt-a", { decision: "REQUEST_CHANGES", note: "Thêm bài vai" });
  assert.equal(again.json.replayed, true);
  assert.equal((await call("POST", `/plan-reviews/${requestId}/decision`, "pt-a", { decision: "APPROVE" })).status, 409);
});

test("H08 client sees the feedback, edits the plan, resubmits a NEW request; the stale approval path is closed", async () => {
  const mine = await call("GET", "/plan-reviews/mine", "client-a");
  assert.equal(mine.json.requests[0].decisionNote, "Thêm bài vai");
  current = { hash: 12, version: 2 }; // client edits the plan (version bumped by the mutator)
  const re = await call("POST", "/plan-reviews", "client-a", { ptUserId: PT });
  assert.equal(re.status, 201);
  assert.notEqual(re.json.request.id, requestId, "a revision gets a fresh request; the old decision is not reused");
  const approve = await call("POST", `/plan-reviews/${re.json.request.id}/decision`, "pt-a", { decision: "APPROVE", expectedContentHash: re.json.request.contentHash });
  assert.equal(approve.status, 200);
  assert.equal(approve.json.request.effectiveState, "APPROVED_CURRENT");
  const events = await call("GET", `/plan-reviews/${re.json.request.id}/events`, "client-a");
  assert.deepEqual(events.json.events.map((e: any) => e.type), ["SUBMITTED", "APPROVED"]);
  assert.ok(events.json.events.every((e: any) => !("notifyUserId" in e)));
});

test("H09 PT whose contract ended gets 403 and no snapshot; client cancel on a decided request => 409", async () => {
  const fresh = await call("POST", "/plan-reviews", "client-a", { ptUserId: PT }); // current unchanged since the approved one => hash equal but no open request
  assert.ok([200, 201].includes(fresh.status));
  roster.get(PT)!.delete(CLIENT);
  const r = await call("GET", `/plan-reviews/${fresh.json.request.id}`, "pt-a");
  assert.equal(r.status, 403);
  assert.ok(!("request" in r.json), "no snapshot for a revoked PT");
  assert.equal((await call("POST", `/plan-reviews/${fresh.json.request.id}/cancel`, "client-a")).status, 409, "already ACCESS_REVOKED is terminal");
});
