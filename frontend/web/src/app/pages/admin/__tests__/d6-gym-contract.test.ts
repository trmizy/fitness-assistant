/** TEST FIXTURE: gym-case client and money copy; fake HTTP only. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGymCaseApi, type GymHttpClient } from "../complaints/gymCaseApi";
import { OPEN_CLASS_OPTIONS, MONEY_NOT_BANK } from "../complaints/gymCaseLabels";
import { parseGymErrorBody } from "../complaints/gymCaseErrors";

describe("D6 gym complaint contract", () => {
  it("membership is required only for the three money-related classes", () => {
    assert.deepEqual(OPEN_CLASS_OPTIONS.filter((o) => o.needsMembership).map((o) => o.value), ["MEM_TXN", "MEM_CLOSED", "MEM_VIOLATION"]);
    assert.match(MONEY_NOT_BANK, /không phải chuyển khoản ngân hàng/);
  });
  it("old complaint page sends paging and parses server meta", async () => {
    let sent: unknown;
    const client: GymHttpClient = { request: async (config) => {
      sent = config;
      return { status: 200, data: { data: [{ id: "complaint-1" }], meta: { total: 23, limit: 10, offset: 10 } } as never };
    } };
    const page = await createGymCaseApi(client).listComplaintsPage({ status: "OPEN", limit: 10, offset: 10 });
    assert.equal(page.meta.total, 23);
    assert.deepEqual((sent as { params: unknown }).params, { status: "OPEN", limit: 10, offset: 10 });
  });
  it("member statement carries an Idempotency-Key and no actor/amount", async () => {
    let sent: unknown;
    const client: GymHttpClient = { request: async (config) => { sent = config; return { status: 201, data: { data: { id: "statement-1" } } as never }; } };
    await createGymCaseApi(client).submitStatement("case-1", { text: "Tôi đã đến phòng tập" }, "test-key-1");
    const request = sent as { headers: Record<string, string>; data: Record<string, unknown> };
    assert.equal(request.headers["Idempotency-Key"], "test-key-1");
    assert.deepEqual(request.data, { text: "Tôi đã đến phòng tập" });
  });
  it("GYM_CASE_DISABLED is a Vietnamese, non-retryable refusal", () => {
    const view = parseGymErrorBody(409, { code: "GYM_CASE_DISABLED", error: "internal" }, { action: "write" });
    assert.match(view.message, /chưa được bật/);
    assert.doesNotMatch(view.message, /GYM_CASE_DISABLED|internal/);
  });
});
