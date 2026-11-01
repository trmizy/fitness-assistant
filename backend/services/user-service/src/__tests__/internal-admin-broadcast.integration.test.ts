/**
 * POST /internal/admin-broadcast (Listing Management B22) - gym-service tells the admins' open sessions that a branch
 * listing revision was submitted. Realtime only: validates the body, answers 202, relays to the admin socket room, stores nothing.
 *
 * Evidence label: BACKEND INTEGRATION (real Express app; the chat-service push is stubbed at axios.post - TEST FIXTURE).
 *   DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test ./node_modules/.bin/tsx --test src/__tests__/internal-admin-broadcast.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { skip } from "./pt-restriction.test-helpers";
import { SERVICE_SECRET, startApp, type App } from "./pt-contract-scope.test-helpers";

let app: App;
test.before(async () => {
  if (!skip) app = await startApp();
});
test.after(async () => {
  await app?.close();
});

const body = {
  id: "gym-listing-rev-1",
  text: "Chủ gym vừa gửi tin chi nhánh X chờ duyệt",
  eventType: "GYM_LISTING_SUBMITTED",
  entityType: "GYM_LISTING",
  entityId: "gym-1",
  link: "/admin/listings?tab=gyms",
};

test("without the service secret the endpoint is closed (401)", { skip }, async () => {
  const res = await app.call("POST", "/internal/admin-broadcast", null, body, {});
  assert.equal(res.status, 401);
});

test("a bad body is 400 and pushes nothing; a good body is 202 and pushes an adminBroadcast", { skip }, async () => {
  const pushed: any[] = [];
  const original = axios.post;
  (axios as any).post = (url: string, payload: unknown) => {
    pushed.push({ url, payload });
    return Promise.resolve({ data: { ok: true } });
  };
  try {
    const bad = await app.call("POST", "/internal/admin-broadcast", null, { ...body, text: "" }, SERVICE_SECRET);
    assert.equal(bad.status, 400);
    assert.equal(pushed.length, 0);

    const ok = await app.call("POST", "/internal/admin-broadcast", null, body, SERVICE_SECRET);
    assert.equal(ok.status, 202);
    assert.equal(pushed.length, 1);
    assert.match(pushed[0].url, /\/internal\/push-notification$/);
    assert.equal(pushed[0].payload.adminBroadcast, true);
    assert.equal(pushed[0].payload.userId, undefined);
    assert.equal(pushed[0].payload.notification.eventType, "GYM_LISTING_SUBMITTED");
    assert.equal(pushed[0].payload.notification.link, "/admin/listings?tab=gyms");
    assert.equal(pushed[0].payload.notification.unread, true);
  } finally {
    (axios as any).post = original;
  }
});
