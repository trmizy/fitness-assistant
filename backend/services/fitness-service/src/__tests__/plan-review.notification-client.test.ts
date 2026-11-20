import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Contract of the strict delivery client toward user-service POST /internal/notifications.
 * Evidence label: TEST FIXTURE (a loopback HTTP stub stands in for user-service; the real user-service side — enum values, the
 * dedupeKey UNIQUE index, preference gating — is proven separately in user-service's notification-plan-review-dedupe test).
 */
let server: http.Server;
const seen: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
let respondWith = 200;
let deliver: (typeof import("../clients/notification.client"))["deliverPlanReviewNotification"];

test.before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
      res.statusCode = respondWith;
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.INTERNAL_SERVICE_SECRET = "test-secret-for-plan-review";
  delete process.env.USER_LAMBDA_NAME;
  deliver = (await import("../clients/notification.client")).deliverPlanReviewNotification; // read env at import time
});
test.after(() => server?.close());

const sample = (kind: "REQUESTED" | "DECIDED") => ({
  userId: "u-1", text: "Có một kế hoạch tập luyện mới đang chờ bạn duyệt.", kind, requestId: "req-1", dedupeKey: "plan-review-event:abc", link: "/pt/plan-reviews",
});

test("NC01 sends the right event/entity type, entity id, idempotency key and the internal secret — and nothing else", async () => {
  respondWith = 200;
  await deliver(sample("REQUESTED"));
  await deliver(sample("DECIDED"));
  assert.equal(seen[0].body.eventType, "PLAN_REVIEW_REQUESTED");
  assert.equal(seen[1].body.eventType, "PLAN_REVIEW_DECIDED");
  for (const s of seen) {
    assert.equal(s.body.entityType, "PLAN_REVIEW");
    assert.equal(s.body.entityId, "req-1");
    assert.equal(s.body.dedupeKey, "plan-review-event:abc");
    assert.equal(s.headers["x-service-secret"], "test-secret-for-plan-review");
    assert.deepEqual(Object.keys(s.body).sort(), ["dedupeKey", "entityId", "entityType", "eventType", "link", "text", "userId"], "no extra fields (no plan/health data)");
  }
});

test("NC02 a failed delivery THROWS (so the outbox keeps the event and retries) instead of being swallowed", async () => {
  respondWith = 500;
  await assert.rejects(deliver(sample("REQUESTED")));
  respondWith = 503;
  await assert.rejects(deliver(sample("DECIDED")));
});
