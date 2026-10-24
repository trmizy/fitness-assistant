/**
 * B30 - GET /internal/admin/sessions/today-count (the admin dashboard's "sessions today" KPI, called by the gateway
 * with the service secret) and B07 - POST /pt-applications/me/upload/presign without an upload bucket answers 503 + code.
 *
 * Evidence label: BACKEND INTEGRATION (real Express app, real SQL on an isolated *_test database; rows are TEST FIXTURE).
 *   DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test ./node_modules/.bin/tsx --test src/__tests__/internal-sessions-today-count-and-presign-503.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { vietnamDayRange } from "../utils/vi-datetime.util";
import { HOUR, addSession, cleanup, makeContract, makePt, skip } from "./pt-restriction.test-helpers";
import { SERVICE_SECRET, startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";

let app: App;
test.before(async () => {
  if (!skip) app = await startApp();
});
test.after(async () => {
  await app?.close();
});

const count = async (headers: Record<string, string> = SERVICE_SECRET) => app.call("GET", "/internal/admin/sessions/today-count", null, undefined, headers);

test("without the service secret the endpoint is closed (401)", { skip }, async () => {
  const res = await count({});
  assert.equal(res.status, 401);
});

test("counts the sessions that start today in Vietnam time, excluding cancelled and unanswered requests", { skip }, async () => {
  const before = (await count()).body.count as number;
  assert.equal(typeof before, "number");

  const { start, end } = vietnamDayRange(new Date());
  const pt = await makePt();
  const contract = await makeContract(pt);
  try {
    // counted: three that start today (first instant of the Vietnam day, mid, last instant)
    await addSession(contract, "CONFIRMED", start);
    await addSession(contract, "COMPLETED", new Date(start.getTime() + 5 * HOUR));
    await addSession(contract, "NO_SHOW", new Date(end.getTime() - 1000));
    // not counted
    await addSession(contract, "CANCELLED", new Date(start.getTime() + 3 * HOUR));
    await addSession(contract, "REQUESTED", new Date(start.getTime() + 4 * HOUR));
    await addSession(contract, "CONFIRMED", end); // tomorrow, first instant
    await addSession(contract, "CONFIRMED", new Date(start.getTime() - 1000)); // yesterday, last instant

    const res = await count();
    assert.equal(res.status, 200);
    assert.equal(res.body.count, before + 3);
    assert.match(res.body.date, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    await cleanup([pt], [contract.id]);
  }
});

test("B07: presign without USER_UPLOAD_BUCKET -> 503 with code UPLOAD_STORAGE_NOT_CONFIGURED (was 500); the 'not configured' text stays for the mobile multipart fallback", { skip }, async () => {
  const saved = process.env.USER_UPLOAD_BUCKET;
  delete process.env.USER_UPLOAD_BUCKET;
  const userId = `presign-${Date.now()}`;
  try {
    const res = await app.call("POST", "/pt-applications/me/upload/presign", tokenFor(userId, "CUSTOMER"), { contentType: "image/png" });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "UPLOAD_STORAGE_NOT_CONFIGURED");
    assert.match(res.body.error, /not configured/i);
  } finally {
    if (saved !== undefined) process.env.USER_UPLOAD_BUCKET = saved;
  }
});

test("B14: gym-service's partner-application rejection notice is accepted and stored (new event + entity type, applicant deep link)", { skip }, async () => {
  const { prisma } = await import("../repositories/profile.repository");
  const userId = `applicant-${Date.now()}`;
  const entityId = `partner-${Date.now()}`;
  try {
    const res = await app.call("POST", "/internal/notifications", null, {
      userId,
      text: "Hồ sơ đối tác phòng gym của bạn chưa được duyệt.",
      eventType: "GYM_PARTNER_APPLICATION_REJECTED",
      entityType: "GYM_PARTNER_APPLICATION",
      entityId,
      link: "/partner/application",
    }, SERVICE_SECRET);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await prisma.notification.findFirst({ where: { userId, entityId } });
    assert.ok(row);
    assert.equal(row!.eventType, "GYM_PARTNER_APPLICATION_REJECTED");
    assert.equal(row!.link, "/partner/application");
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
  }
});
