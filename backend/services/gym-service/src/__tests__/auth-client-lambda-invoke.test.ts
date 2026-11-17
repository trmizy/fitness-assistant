/**
 * Partner report 2026-11-17: gym-service could not reach auth-service on AWS (AUTH_SERVICE_UNAVAILABLE, staff invites,
 * email). auth.client.ts / user.client.ts used axios-only to localhost. With AUTH_LAMBDA_NAME / USER_LAMBDA_NAME set they
 * must invoke the Lambda instead. The AWS SDK send() is replaced, so no network is touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LambdaClient } from "@aws-sdk/client-lambda";

type Invoked = { fn: string; event: any };
const invoked: Invoked[] = [];
let reply: { statusCode: number; body: unknown } = { statusCode: 200, body: {} };
const originalSend = LambdaClient.prototype.send;

test.before(() => {
  process.env.AUTH_LAMBDA_NAME = "fitness-assistant-dev-auth";
  process.env.USER_LAMBDA_NAME = "fitness-assistant-dev-user";
  process.env.INTERNAL_SERVICE_SECRET = "svc-secret";
  (LambdaClient.prototype as any).send = async function (cmd: any) {
    const input = cmd.input;
    invoked.push({ fn: input.FunctionName, event: JSON.parse(Buffer.from(input.Payload).toString("utf-8")) });
    return { StatusCode: 200, Payload: Buffer.from(JSON.stringify({ statusCode: reply.statusCode, body: JSON.stringify(reply.body) })) };
  };
});
test.after(() => {
  LambdaClient.prototype.send = originalSend;
  delete process.env.AUTH_LAMBDA_NAME;
  delete process.env.USER_LAMBDA_NAME;
});
test.beforeEach(() => { invoked.length = 0; reply = { statusCode: 200, body: {} }; });

test("authClient.sendEmail invokes the auth Lambda with the service secret and keeps the delivered:false rule", async () => {
  const { authClient } = await import("../clients/auth.client");
  reply = { statusCode: 200, body: { delivered: true } };
  assert.equal(await authClient.sendEmail({ to: "a@example.com", subject: "s", text: "t" }), true);
  assert.equal(invoked[0].fn, "fitness-assistant-dev-auth");
  assert.equal(invoked[0].event.rawPath, "/auth/internal/send-email");
  assert.equal(invoked[0].event.headers["x-service-secret"], "svc-secret");
  assert.deepEqual(JSON.parse(invoked[0].event.body), { to: "a@example.com", subject: "s", text: "t" });

  reply = { statusCode: 200, body: { delivered: false } };
  assert.equal(await authClient.sendEmail({ to: "a@example.com", subject: "s", text: "t" }), false);
});

test("authClient.createInvitedAccount: a 409 from the Lambda surfaces as err.response.status 409 (public-partner maps it to EMAIL_IN_USE)", async () => {
  const { authClient } = await import("../clients/auth.client");
  reply = { statusCode: 409, body: { error: "email in use" } };
  await assert.rejects(
    () => authClient.createInvitedAccount({ email: "a@example.com", password: "x", firstName: "A" }),
    (e: any) => e.response?.status === 409,
  );
  assert.equal(invoked[0].event.rawPath, "/auth/internal/partner-auth/create-invited-account");
});

test("authClient.getUser / getUsersBatch / emailStatus go through the Lambda", async () => {
  const { authClient } = await import("../clients/auth.client");
  reply = { statusCode: 200, body: { user: { id: "u1", email: "e", firstName: null, lastName: null, role: "CLIENT", isActive: true } } };
  assert.equal((await authClient.getUser("u1")).id, "u1");
  assert.equal(invoked[0].event.requestContext.http.method, "GET");
  assert.equal(invoked[0].event.rawPath, "/auth/internal/users/u1");

  reply = { statusCode: 200, body: { users: [{ id: "u1" }] } };
  assert.equal((await authClient.getUsersBatch(["u1"])).length, 1);

  reply = { statusCode: 200, body: { exists: true, role: "GYM_OWNER" } };
  assert.deepEqual(await authClient.emailStatus("a@example.com"), { exists: true, role: "GYM_OWNER" });
  assert.deepEqual(invoked.map((i) => i.event.rawPath), ["/auth/internal/users/u1", "/auth/internal/users/batch", "/auth/internal/partner-auth/email-status"]);
});

test("userClient notifications / admin-broadcast / ward lookup go through the user Lambda (dispute notices depend on this)", async () => {
  const { userClient } = await import("../clients/user.client");
  reply = { statusCode: 200, body: { ok: true } };
  assert.equal(await userClient.notifyUserChecked({ userId: "u", text: "t", eventType: "E", entityType: "T", entityId: "1" }), true);
  assert.equal(invoked[0].fn, "fitness-assistant-dev-user");
  assert.equal(invoked[0].event.rawPath, "/internal/notifications");
  assert.equal(invoked[0].event.headers["x-service-secret"], "svc-secret");

  reply = { statusCode: 500, body: { error: "boom" } };
  assert.equal(await userClient.notifyUserChecked({ userId: "u", text: "t", eventType: "E", entityType: "T", entityId: "1" }), false, "a failed notice must not count as delivered");

  reply = { statusCode: 200, body: { count: 3 } };
  assert.equal(await userClient.countActivePtContractsByGyms(["g1"]), 3);

  reply = { statusCode: 200, body: { code: 1, provinceCode: 2, centroid: { lat: 10, lng: 106 } } };
  const ward = await userClient.getWardGeoFailSoft(1);
  assert.equal(ward?.centroid?.lat, 10);
  const last = invoked[invoked.length - 1].event;
  assert.equal(last.rawPath, "/locations/wards/1");
  assert.equal(last.headers["x-service-secret"], undefined, "public route: no secret is sent");
});
