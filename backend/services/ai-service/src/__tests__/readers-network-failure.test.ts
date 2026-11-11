/**
 * Phase 3 Batch 5 defect regression (found by the unified-coach E2E suite, journey 7):
 * readerDeps.get's `validateStatus: () => true` only suppresses HTTP 4xx/5xx from throwing — a real
 * network-level failure (connection refused/timeout) still rejects, and before this fix nothing in
 * readState/readContracts/etc. ever caught it, crashing the whole turn (an unhandled rejection
 * propagating all the way up through runGlobalTurn). Fixed at readState's single dispatcher level.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readState, readerDeps } from "../conversational-intelligence/global/readers";

const originalGet = readerDeps.get;
test.afterEach(() => { readerDeps.get = originalGet; });

test("a genuine network-level rejection (not an HTTP error status) degrades to an honest text, never crashes the caller", async () => {
  readerDeps.get = async () => { throw new Error("connect ECONNREFUSED"); };
  const result = await readState("PT_STATUS", { userId: "u1" } as any, "PT hiện tại của tôi là ai?", { getUserFitnessContext: async () => ({ profile: {} }) });
  assert.ok(result, "must return an honest degraded ReadResult, never throw/reject");
  assert.match(result!.text, /chưa đọc được/);
});

test("an HTTP error status (already-handled case) still works exactly as before — this fix only adds the network-rejection path", async () => {
  readerDeps.get = async () => ({ status: 503, data: {} });
  const result = await readState("PT_STATUS", { userId: "u1" } as any, "PT hiện tại của tôi là ai?", { getUserFitnessContext: async () => ({ profile: {} }) });
  assert.ok(result);
  assert.match(result!.text, /chưa đọc được/);
});

test("a successful read is completely unaffected by the new try/catch", async () => {
  readerDeps.get = async (url: string) => (url.endsWith("/contracts/client") ? { status: 200, data: [{ status: "ACTIVE", packageName: "Gói cơ bản", ptProfile: { firstName: "Minh" } }] } : { status: 404, data: {} });
  const result = await readState("PT_STATUS", { userId: "u1" } as any, "PT hiện tại của tôi là ai?", { getUserFitnessContext: async () => ({ profile: {} }) });
  assert.ok(result);
  assert.match(result!.text, /Minh/);
});
