/**
 * Phase 8 — CL-18 / CL-12 against the REAL backend through the gateway, using the same helpers the
 * screens use. Leaves no residue: the one order it creates is cancelled in the same test.
 *
 *   npx tsx --test e2e/phase8-plans.e2e.ts     (gateway http://localhost:3000, john.doe@example.com)
 *
 * Not covered here (needs a running LLM): generating an AI plan. Adopting a market plan is not run
 * automatically because it replaces the account's active workout program.
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { canCancel, canDispute, canRequestRefund, ORDER_STATUS_LABEL } from "../src/features/plans/personalizedOrder";
import { lowestPackagePrice } from "../src/features/plans/marketplace";
import { countInvalidExerciseIds, sortPlans, toPlanContent, toWeeklySchedule } from "../src/features/plans/aiPlans";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "john.doe@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
let token = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, data: json?.data ?? json };
}

before(async () => {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body: any = await res.json();
  token = body?.data?.accessToken ?? body?.accessToken;
  assert.ok(token, "login failed");
});

describe("CL-18 AI plans + market", () => {
  it("AI workout plans list reads through the screen helpers", async () => {
    const r = await call("GET", "/plans/current");
    assert.equal(r.status, 200);
    const plans = sortPlans(Array.isArray(r.data) ? r.data : r.data?.plans ?? []);
    for (const p of plans.filter((x) => x.status === "COMPLETED")) {
      const schedule = toWeeklySchedule(toPlanContent(p.plan)?.weeklySchedule);
      assert.ok(countInvalidExerciseIds(schedule) >= 0);
    }
  });

  it("AI nutrition plans and the applied meal plan load", async () => {
    assert.equal((await call("GET", "/plans/nutrition/current")).status, 200);
    assert.ok([200, 404].includes((await call("GET", "/nutrition/plans/current")).status));
  });

  it("market browse + detail: approved listings with a preview schedule", async () => {
    const r = await call("GET", "/marketplace/plans?sort=recommended");
    assert.equal(r.status, 200);
    for (const l of r.data.items) {
      assert.equal(l.moderationStatus, "APPROVED");
      const min = lowestPackagePrice(l);
      assert.ok(min === null || min > 0);
    }
    if (r.data.items[0]) {
      const d = await call("GET", `/marketplace/plans/${r.data.items[0].id}`);
      assert.equal(d.status, 200);
      assert.ok(Array.isArray(d.data.reviews));
    }
  });

  it("payment methods the purchase sheet lists are the server's configured ones", async () => {
    const r = await call("GET", "/me/payments/methods");
    assert.equal(r.status, 200);
    assert.ok(r.data.methods.some((m: any) => m.configured));
  });
});

describe("CL-12 1-1 order: purchase → PENDING_PAYMENT → cancel", () => {
  it("creates a real order for a verified PT's service, then cancels it (UI door rules match the server)", async () => {
    const browse = await call("GET", "/marketplace/services");
    assert.equal(browse.status, 200);
    const me = await call("GET", "/auth/verify");
    const myId = me.data?.user?.id ?? me.data?.id;
    const svc = browse.data.items.find((s: any) => s.sellerId !== myId);
    assert.ok(svc, "no purchasable service in this database");

    const methods = await call("GET", "/me/payments/methods");
    const provider = methods.data.defaultProvider ?? methods.data.methods.find((m: any) => m.configured).provider;
    const buy = await call("POST", `/marketplace/services/${svc.id}/purchase`, { provider });
    assert.equal(buy.status, 201, JSON.stringify(buy.data));
    const order = buy.data.order;
    assert.equal(order.status, "PENDING_PAYMENT");
    assert.ok(ORDER_STATUS_LABEL[order.status as keyof typeof ORDER_STATUS_LABEL]);
    // The screen offers exactly: cancel yes, refund no, dispute no.
    assert.equal(canCancel(order.status), true);
    assert.equal(canRequestRefund(order.status), false);
    assert.equal(canDispute(order.status), false);

    const cancel = await call("POST", `/marketplace/orders/${order.id}/cancel`, { reason: "E2E phase 8 — huỷ ngay" });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
    const after = await call("GET", `/marketplace/orders/${order.id}`);
    assert.equal(after.data.status, "CANCELLED");
    assert.equal(canCancel(after.data.status), false);
  });
});
